// Il motore della superficie ricca: possiede l'`EditorView` di ProseMirror e
// ne fa una superficie con buffer.
//
// Il buffer della sessione è il testo della proiezione. Il motore lo legge in
// un documento ProseMirror, e a ogni transazione che lo cambia riscrive la
// proiezione (un blocco per volta, dalla cache di `BlockWriter`) e la consegna
// come `EditorChange`: la sessione, il salvataggio, le bozze e i conflitti sono
// quelli di ogni altro documento.
//
// Ciò che arriva da fuori (`syncDoc`: un altro riquadro, il disco) sostituisce
// soltanto i blocchi diversi e non entra nella cronologia locale. Il motore
// non scrive mai `k` che il documento non abbia già: lo garantisce il filtro
// di ciò che si incolla (`paste.ts`).
import { baseKeymap, chainCommands } from "prosemirror-commands";
import { history, isHistoryTransaction, redo, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Mark as PmMark, Node as PmNode, Slice } from "prosemirror-model";
import { EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { operationFromText, type EditorChange, type EditorChangeOrigin } from "../core/text-operation";
import { ProofClient, type ProofPorts } from "../core/proof";
import {
  applyFormat,
  backspace,
  deleteForward,
  formatAt,
  selectedLook,
  type LookState,
  fillTableKeys,
  insertBreak,
  insertTab,
  richActionState,
  RICH_ACTIONS,
  shiftListLevel,
  splitParagraph,
} from "./commands";
import { collectKeys, filterSlice, uniqueKeys } from "./paste";
import { parseProjection, writeHead, type Look, type ParaStyle, type Projection, type ReadOnlyReason } from "./projection";
import { richProof } from "./proof";
import { BlockWriter, richSchema, toDoc } from "./schema";

export { mountStrip } from "./strip";

export interface RichEngineOptions {
  readonly onChange: (change: EditorChange) => void;
  readonly onSelectionChange: () => void;
  /// Il correttore, se la shell lo offre.
  readonly proof?: { readonly ports: ProofPorts; readonly notify?: (message: string) => void };
  /// L'etichetta accessibile dell'area di scrittura, nella lingua corrente.
  readonly label: () => string;
}

/// Ciò che il motore sa del testo che ha ricevuto.
export type Intake =
  | { readonly kind: "ok"; readonly readonly: ReadOnlyReason | null }
  | { readonly kind: "invalid"; readonly reason: string };

export class RichEngine {
  readonly #view: EditorView;
  readonly #options: RichEngineOptions;
  readonly #writer = new BlockWriter();
  readonly #known = new Set<string>();
  readonly #listeners = new Set<() => void>();
  readonly #proofClient: ProofClient | null;
  #head: Pick<Projection, "readonly" | "lang" | "f" | "styles"> = {};
  /// Il testo del buffer come lo tiene il motore: quello ricevuto finché
  /// nessuno lo cambia, poi quello riscritto.
  #source = "";
  #intake: Intake = { kind: "invalid", reason: "" };
  #shellReadOnly = false;
  #destroyed = false;
  /// «Copia formato»: l'aspetto preso, che va sulla prossima selezione finita.
  #painter: readonly PmMark[] | null = null;
  /// Una selezione col puntatore o con Maiusc non è finita finché si tiene.
  #pointerDown = false;
  #shiftDown = false;

  constructor(parent: HTMLElement, options: RichEngineOptions) {
    this.#options = options;
    this.#proofClient = options.proof ? new ProofClient(options.proof.ports) : null;
    this.#view = new EditorView(parent, {
      state: this.#state(richSchema.nodes.doc.create(null, richSchema.nodes.para.create())),
      editable: () => this.editable(),
      attributes: () => ({
        class: "rich-content",
        // La dimensione di un paragrafo senza stile: quella di uno con uno
        // stile proprio si misura su questa.
        ...(this.#head.f?.size !== undefined ? { style: `--rich-doc-pt: ${this.#head.f.size}` } : {}),
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": options.label(),
        "aria-readonly": String(!this.editable()),
        spellcheck: "false",
      }),
      dispatchTransaction: (tr) => this.#dispatch(tr),
      transformPasted: (slice, view) => this.#filter(slice, view),
      handleDOMEvents: {
        pointerdown: () => {
          this.#pointerDown = true;
          return false;
        },
        pointerup: () => {
          this.#pointerDown = false;
          this.#paint();
          return false;
        },
        keydown: (_view, event) => {
          if (event.key === "Shift") this.#shiftDown = true;
          return false;
        },
        keyup: (_view, event) => {
          if (event.key !== "Shift") return false;
          this.#shiftDown = false;
          this.#paint();
          return false;
        },
      },
    });
  }

  #plugins(): Plugin[] {
    const plugins: Plugin[] = [
      history(),
      fillTableKeys,
      keymap(this.#keys()),
      keymap(baseKeymap),
    ];
    if (this.#proofClient) {
      plugins.push(
        richProof({
          client: this.#proofClient,
          language: () => this.#head.lang,
          notify: this.#options.proof?.notify,
        }),
      );
    }
    return plugins;
  }

  #keys(): Record<string, (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean> {
    const keys: Record<string, (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean> = {
      Enter: splitParagraph,
      "Shift-Enter": insertBreak("\n"),
      "Mod-Enter": insertBreak("\u000c"),
      Backspace: backspace,
      Delete: deleteForward,
      "Mod-y": redo,
      Tab: chainCommands(shiftListLevel(1), insertTab),
      "Shift-Tab": shiftListLevel(-1),
      Escape: () => {
        if (!this.#painter) return false;
        this.disarmPainter();
        return true;
      },
    };
    for (const [, action] of RICH_ACTIONS) {
      if (action.chord && !(action.chord in keys)) keys[action.chord] = action.run;
    }
    keys["Mod-z"] = undo;
    keys["Mod-Shift-z"] = redo;
    return keys;
  }

  #state(doc: PmNode): EditorState {
    return EditorState.create({ schema: richSchema, doc, plugins: this.#plugins() });
  }

  /// Il documento non si scrive: lo dice la proiezione, la shell, o il testo
  /// non si legge.
  editable(): boolean {
    return !this.#destroyed && !this.#shellReadOnly && this.#intake.kind === "ok" && this.#intake.readonly === null;
  }

  intake(): Intake {
    return this.#intake;
  }

  setDoc(source: string): void {
    if (this.#destroyed) return;
    this.#source = source;
    this.#known.clear();
    const projection = this.#read(source);
    this.#view.updateState(this.#state(projection ? toDoc(projection) : richSchema.nodes.doc.create(null, richSchema.nodes.para.create())));
    this.#notify();
  }

  syncDoc(update: { readonly text: string } | string): void {
    if (this.#destroyed) return;
    const source = typeof update === "string" ? update : update.text;
    if (source === this.#source) return;
    this.#source = source;
    const projection = this.#read(source);
    if (!projection) {
      this.#view.updateState(this.#state(richSchema.nodes.doc.create(null, richSchema.nodes.para.create())));
      this.#notify();
      return;
    }
    const next = toDoc(projection);
    const current = this.#view.state.doc;
    const start = current.content.findDiffStart(next.content);
    if (start === null) {
      this.#notify();
      return;
    }
    const end = current.content.findDiffEnd(next.content);
    let a = end ? end.a : current.content.size;
    let b = end ? end.b : next.content.size;
    // Le due estremità si sovrappongono quando il cambio ripete testo vicino.
    const overlap = start - Math.min(a, b);
    if (overlap > 0) {
      a += overlap;
      b += overlap;
    }
    const tr = this.#view.state.tr
      .replace(start, a, next.slice(start, b))
      .setMeta("addToHistory", false)
      .setMeta(SYNC, true);
    this.#view.dispatch(tr);
    this.#notify();
  }

  getDoc(): string {
    return this.#source;
  }

  #read(source: string): Projection | null {
    try {
      const projection = parseProjection(source);
      this.#head = { readonly: projection.readonly, lang: projection.lang, f: projection.f, styles: projection.styles };
      this.#intake = { kind: "ok", readonly: projection.readonly ?? null };
      // Un aggiornamento da fuori aggiunge ciò che porta: quello che l'utente
      // ha tagliato prima resta noto, e si può incollare.
      const doc = toDoc(projection);
      collectKeys(doc, this.#known);
      return projection;
    } catch (error) {
      this.#head = {};
      this.#intake = { kind: "invalid", reason: error instanceof Error ? error.message : String(error) };
      return null;
    }
  }

  #dispatch(tr: Transaction): void {
    if (this.#destroyed) return;
    const before = this.#view.state;
    const state = before.apply(tr);
    this.#view.updateState(state);
    if (tr.docChanged && !tr.getMeta(SYNC)) {
      // Ciò che il documento ha, l'ha avuto: un taglia e incolla lo ritrova.
      collectKeys(state.doc, this.#known);
      const previous = this.#source;
      this.#source = writeHead(this.#head) + this.#writer.write(state.doc).join(",") + "]}";
      if (this.#source !== previous) {
        this.#options.onChange({
          text: this.#source,
          operation: operationFromText(previous, this.#source),
          origin: originOf(tr, before, state),
        });
      }
    } else if (tr.docChanged) {
      collectKeys(state.doc, this.#known);
    }
    if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) {
      this.#options.onSelectionChange();
      this.#notify();
    }
    if (tr.selectionSet && !tr.docChanged) this.#paint();
  }

  /// Dà l'aspetto preso alla selezione, se ce n'è una finita.
  #paint(): void {
    const marks = this.#painter;
    if (!marks || this.#pointerDown || this.#shiftDown || this.#view.state.selection.empty) return;
    this.#painter = null;
    applyFormat(marks)(this.#view.state, (tr) => this.#view.dispatch(tr));
    this.#notify();
  }

  /// «Copia formato»: prende l'aspetto della selezione per la prossima. Un
  /// secondo tocco lo lascia.
  togglePainter(): void {
    if (!this.editable()) return;
    this.#painter = this.#painter ? null : formatAt(this.#view.state);
    this.#notify();
    this.#view.focus();
  }

  disarmPainter(): void {
    if (!this.#painter) return;
    this.#painter = null;
    this.#notify();
  }

  painterArmed(): boolean {
    return this.#painter !== null;
  }

  /// L'aspetto della selezione, per chi lo mostra.
  look(): LookState {
    return selectedLook(this.#view.state);
  }

  /// Legge lo stato dell'editor con `read`, per chi mostra la selezione.
  read<T>(read: (state: EditorState) => T): T {
    return read(this.#view.state);
  }

  /// Gli stili di paragrafo che il documento propone oltre ai ruoli.
  styles(): readonly ParaStyle[] {
    return this.#head.styles ?? [];
  }

  /// Il carattere e la dimensione di un paragrafo senza stile.
  documentLook(): Look | undefined {
    return this.#head.f;
  }

  /// I caratteri che il documento usa: i suoi paragrafi e i suoi tratti.
  fonts(): string[] {
    const out = new Set<string>();
    this.#view.state.doc.descendants((node) => {
      const base = (node.attrs.f as { font?: string } | null | undefined)?.font;
      if (base) out.add(base);
      for (const mark of node.marks) if (mark.type.name === "font") out.add(mark.attrs.family as string);
      return true;
    });
    return [...out];
  }

  /// Esegue un comando come una battuta. `focus`: il fuoco torna al testo
  /// (non da un modulo che resta aperto).
  apply(command: Command, focus = true): boolean {
    if (!this.editable()) return false;
    const done = command(this.#view.state, (tr) => this.#view.dispatch(tr), this.#view);
    if (done && focus) this.#view.focus();
    return done;
  }

  #filter(slice: Slice, view: EditorView): Slice {
    return filterSlice(slice, {
      known: this.#known,
      present: uniqueKeys(view.state.doc),
      moving: !!view.dragging?.move,
    });
  }

  /// Esegue un'azione del catalogo come una battuta.
  run(id: string): boolean {
    const action = RICH_ACTIONS.get(id);
    if (!action || !this.editable()) return false;
    const done = action.run(this.#view.state, (tr) => this.#view.dispatch(tr), this.#view);
    if (done) this.#view.focus();
    return done;
  }

  actionState(id: string): { enabled: boolean; active: boolean | null } {
    if (!this.editable()) return { enabled: false, active: null };
    return richActionState(id, this.#view.state);
  }

  /// Avvisa quando stato delle azioni, sola lettura o contenuto cambiano.
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  setReadOnly(readOnly: boolean): void {
    if (this.#shellReadOnly === readOnly) return;
    this.#shellReadOnly = readOnly;
    if (readOnly) this.#painter = null;
    // `editable` è una funzione: ProseMirror la rilegge a ogni aggiornamento.
    this.#view.setProps({});
    this.#notify();
  }

  /// Ridisegna gli attributi che dipendono dalla lingua.
  refresh(): void {
    if (!this.#destroyed) this.#view.setProps({});
  }

  focus(): void {
    if (!this.#destroyed) this.#view.focus();
  }

  /// Il testo selezionato, con un a-capo fra un blocco e l'altro.
  selectedText(): string | null {
    const { from, to, empty } = this.#view.state.selection;
    if (empty) return null;
    return this.#view.state.doc.textBetween(from, to, "\n", (leaf) => {
      if (leaf.type === richSchema.nodes.brk) return "\n";
      return (leaf.attrs.label as string | undefined) ?? "";
    });
  }

  /// Il cursore all'inizio del documento, per chi monta e mette il fuoco.
  selectStart(): void {
    const tr = this.#view.state.tr.setSelection(Selection.atStart(this.#view.state.doc));
    this.#view.dispatch(tr.setMeta("addToHistory", false));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#listeners.clear();
    this.#view.destroy();
    this.#proofClient?.dispose();
  }

  /// Per i test: lo stato corrente.
  get state(): EditorState {
    return this.#view.state;
  }

  /// Per i test: applica una transazione come un gesto dell'utente.
  dispatch(tr: Transaction): void {
    this.#view.dispatch(tr);
  }

  /// Per i test: incolla una fetta come l'incolla del browser.
  paste(slice: Slice): void {
    const filtered = this.#filter(slice, this.#view);
    this.#view.dispatch(this.#view.state.tr.replaceSelection(filtered).scrollIntoView().setMeta("uiEvent", "paste"));
  }

  /// Per i test: seleziona il testo da `from` a `to`.
  select(from: number, to = from): void {
    this.#view.dispatch(this.#view.state.tr.setSelection(TextSelection.create(this.#view.state.doc, from, to)));
  }
}

const SYNC = "fub-rich-sync";

/// La cronologia dice che una sua transazione è sua, non se annulla o
/// ripete: lo dice la profondità degli annullamenti che scende.
function originOf(tr: Transaction, before: EditorState, after: EditorState): EditorChangeOrigin {
  if (!isHistoryTransaction(tr)) return "input";
  return undoDepth(after) < undoDepth(before) ? "undo" : "redo";
}
