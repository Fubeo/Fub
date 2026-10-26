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
//
// Mentre il documento registra le modifiche, ogni transazione dell'utente
// passa da `track.ts` prima di applicarsi: ciò che non si registra non entra.
// Allo stesso modo non entra ciò che cambia un blocco chiuso o, in un
// documento che si scrive soltanto nel corpo, ciò che sta fuori (`closed.ts`).
import { baseKeymap, chainCommands } from "prosemirror-commands";
import { history, isHistoryTransaction, redo, undo, undoDepth } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Mark as PmMark, Node as PmNode, Slice } from "prosemirror-model";
import { AllSelection, EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { PaperFit } from "../core/registry";
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
  ASK_ACTIONS,
  richActionState,
  paraLooksPlugin,
  RICH_ACTIONS,
  shiftListLevel,
  splitParagraph,
} from "./commands";
import { collectKeys, filterSlice, uniqueKeys } from "./paste";
import { parseProjection, writeComment, writeHead, writeRunning, type Look, type Page, type RunningText, type ParaStyle, type Projection, type ReadOnlyReason } from "./projection";
import { DEFAULT_PAGE, pageVariables, samePage, setRunningAt } from "./page";
import { openRunningEditor, type RunningEditor } from "./running";
import { DESK_INSET, fitScale, PX_PER_PT, runningInset, SheetDesk, sheetAt, sheetElement, sheetPlanOf, sheetsPlugin } from "./sheets";
import { richProof } from "./proof";
import { GO_TO, lineBoxes, RichMotion, type Rect } from "./rich-motion";
import { commentPlugin, commentsOf } from "./comments";
import { notePlugin } from "./notes";
import { sectionPlugin } from "./breaks";
import { setTint, tintPlugin } from "./tints";
import type { Paper } from "../../theme/adapt";
import { findPlugin, revisionPlugin, showMatches, type FindQuery } from "./review";
import { BlockWriter, lookVariables, richSchema, toDoc } from "./schema";
import { closedBlocks, keepsOutside } from "./closed";
import { deleteChar, reviewAuthor, trackable, trackTransaction, tracking } from "./track";

export { mountRichRibbon } from "./ribbon";
export { mountRichSide } from "./side";
export { richStatus } from "./status";
export { richStanding } from "./standing";

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
  /// Chi apre le richieste delle azioni che chiedono (un link, trova e
  /// sostituisci): la striscia.
  readonly #asks = new Map<string, Set<() => void>>();
  readonly #proofClient: ProofClient | null;
  /// L'intestazione dell'ultima proiezione letta. Versione e schema si
  /// ricopiano come sono arrivati; prima di ogni lettura non si scrive niente
  /// che un formato accetti, ma la forma resta quella della versione 3.
  #head: Pick<Projection, "version" | "opaque_schema" | "readonly" | "body_only" | "lang" | "f" | "styles" | "roles"> = { version: 3 };
  /// Il testo del buffer come lo tiene il motore: quello ricevuto finché
  /// nessuno lo cambia, poi quello riscritto.
  #source = "";
  #intake: Intake = { kind: "invalid", reason: "" };
  /// I blocchi chiusi della proiezione letta, come li scrive la proiezione.
  #closed: readonly string[] = [];
  /// L'ultima transazione dell'utente non è entrata: cambiava ciò che non si
  /// scrive.
  #refused = false;
  #shellReadOnly = false;
  #destroyed = false;
  /// «Copia formato»: l'aspetto preso, che va sulla prossima selezione finita.
  #painter: readonly PmMark[] | null = null;
  /// Una selezione col puntatore o con Maiusc non è finita finché si tiene.
  #pointerDown = false;
  #shiftDown = false;
  /// Fino a quando un Tab esce dal documento invece di scrivere: un Esc lo
  /// concede per due secondi, come in CodeMirror.
  #tabLeaves = 0;
  #stopPage: () => void;
  /// La scrivania: la carta e il testo che ci sta sopra. Porta le misure
  /// della pagina come variabili di dato, che la carta e il testo leggono.
  readonly #desk: HTMLElement;
  #drawnPage = "";
  #paper: Paper | null = null;
  /// I fogli di Pagina e di Lettura, e l'intestazione che si scrive sul posto.
  readonly #sheets: SheetDesk;
  #running: RunningEditor | null = null;
  /// Un campo dell'intestazione si chiude per aprirne un altro.
  #swapping = false;
  /// Il moto della carta: modalità, zoom, fogli che nascono.
  readonly #motion: RichMotion;
  /// La transazione in corso va a un punto (`GO_TO`), con l'anello o no; e
  /// l'ultima occorrenza a cui è andato Trova.
  #goingTo: { ring: boolean } | null = null;
  #lastFound = -1;

  constructor(parent: HTMLElement, options: RichEngineOptions) {
    this.#options = options;
    this.#proofClient = options.proof ? new ProofClient(options.proof.ports) : null;
    // La carta è una sagoma dietro il testo, non il testo: la disegna la
    // pelle, e il testo resta trasparente sopra.
    this.#desk = document.createElement("div");
    this.#desk.className = "rich-desk";
    const sheets = document.createElement("div");
    sheets.className = "rich-sheets";
    sheets.setAttribute("aria-hidden", "true");
    sheets.append(sheetElement());
    this.#desk.append(sheets);
    parent.append(this.#desk);
    this.#sheets = new SheetDesk(this.#desk, sheets);
    this.#view = new EditorView(this.#desk, {
      state: this.#state(richSchema.nodes.doc.create(null, richSchema.nodes.para.create())),
      editable: () => this.editable(),
      attributes: () => ({
        class: "rich-content",
        // L'aspetto del documento, come dato: il carattere e la misura del
        // testo che non ne dice altri.
        style: lookVariables(this.#head.f ?? {}).join("; "),
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": options.label(),
        "aria-readonly": String(!this.editable()),
        spellcheck: "false",
        tabindex: "-1",
      }),
      dispatchTransaction: (tr) => this.#dispatch(tr),
      // Andare a un punto ha il suo scorrimento (`RichMotion.goTo`, dopo
      // l'aggiornamento); il resto scorre quanto basta, come sempre.
      handleScrollToSelection: () => this.#goingTo !== null,
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
    // Come nell'editor di testo il Tab si ferma sul foglio che scorre, non
    // dentro il documento, dove scrive: Invio porta a scrivere, Esc e Tab
    // riportano fuori.
    parent.tabIndex = 0;
    parent.setAttribute("role", "document");
    parent.setAttribute("aria-label", options.label());
    const enter = (event: KeyboardEvent) => {
      if (event.target !== parent || event.key !== "Enter") return;
      event.preventDefault();
      this.focus();
    };
    parent.addEventListener("keydown", enter);
    this.#motion = new RichMotion({
      page: parent,
      desk: this.#desk,
      layer: sheets,
      content: () => this.#view.dom,
      scale: () => Number.parseFloat(this.#desk.style.zoom) || 1,
      measure: () => void this.#sheets.measure(),
    });
    this.#sheets.onRedraw((previous) => this.#motion.redraw(previous));
    this.#stopPage = () => {
      parent.removeEventListener("keydown", enter);
      for (const name of ["tabindex", "role", "aria-label"]) parent.removeAttribute(name);
    };
  }

  #plugins(): Plugin[] {
    const plugins: Plugin[] = [
      history(),
      fillTableKeys,
      findPlugin,
      revisionPlugin,
      commentPlugin,
      notePlugin,
      sectionPlugin,
      sheetsPlugin(this.#sheets, (zone) => this.#openRunning(zone.kind, zone.sheet)),
      tintPlugin,
      paraLooksPlugin(() => ({ body: this.#head.f, roles: this.#head.roles, styles: this.#head.styles })),
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
      Backspace: chainCommands(backspace, deleteChar(-1)),
      Delete: chainCommands(deleteForward, deleteChar(1)),
      "Mod-y": redo,
      // Dopo un Esc il Tab porta fuori dal documento, come nell'editor di testo.
      Tab: (state, dispatch) => Date.now() > this.#tabLeaves && chainCommands(shiftListLevel(1), insertTab)(state, dispatch),
      "Shift-Tab": (state, dispatch) => Date.now() > this.#tabLeaves && shiftListLevel(-1)(state, dispatch),
      Escape: () => {
        this.#tabLeaves = Date.now() + 2000;
        if (!this.#painter) return false;
        this.disarmPainter();
        return true;
      },
    };
    for (const [id, action] of RICH_ACTIONS) {
      if (!action.chord || action.chord in keys) continue;
      keys[action.chord] = ASK_ACTIONS.has(id) ? (state) => action.run(state) && this.#ask(id) : action.run;
    }
    keys["Mod-z"] = undo;
    keys["Mod-Shift-z"] = redo;
    return keys;
  }

  #state(doc: PmNode): EditorState {
    const state = EditorState.create({ schema: richSchema, doc, plugins: this.#plugins() });
    // Un documento nuovo resta sulla carta di prima.
    const tint = setTint(state, this.#paper, this.#head.f?.size);
    return tint ? state.apply(tint) : state;
  }

  /// La carta su cui portare i colori del file (l'aspetto adattato), o `null`
  /// negli altri aspetti, dove i colori restano quelli del file.
  setPaper(paper: Paper | null): void {
    if (this.#destroyed) return;
    this.#paper = paper;
    const tr = setTint(this.#view.state, paper, this.#head.f?.size);
    if (tr) this.#view.updateState(this.#view.state.apply(tr));
  }

  /// Il documento non si scrive: lo dice la proiezione, la shell, o il testo
  /// non si legge.
  editable(): boolean {
    return !this.#destroyed && !this.#shellReadOnly && this.#intake.kind === "ok" && this.#intake.readonly === null;
  }

  intake(): Intake {
    return this.#intake;
  }

  /// La lingua che il file dice per il suo testo (`w:lang` dei predefiniti),
  /// `null` se non la dice: la usa la rilettura, la mostra Proprietà.
  language(): string | null {
    return this.#head.lang ?? null;
  }

  setDoc(source: string): void {
    if (this.#destroyed) return;
    this.#source = source;
    this.#known.clear();
    this.#running?.close(false);
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
    const tr = this.#view.state.tr;
    const start = current.content.findDiffStart(next.content);
    if (start !== null) {
      const end = current.content.findDiffEnd(next.content);
      let a = end ? end.a : current.content.size;
      let b = end ? end.b : next.content.size;
      // Le due estremità si sovrappongono quando il cambio ripete testo vicino.
      const overlap = start - Math.min(a, b);
      if (overlap > 0) {
        a += overlap;
        b += overlap;
      }
      tr.replace(start, a, next.slice(start, b));
    }
    const comments = commentsOf(next);
    if (comments.map(writeComment).join() !== commentsOf(current).map(writeComment).join()) {
      tr.setDocAttribute("comments", comments);
    }
    if (tracking(next) !== tracking(current)) tr.setDocAttribute("track", tracking(next));
    if (!samePage(next.attrs.page as Page | null, current.attrs.page as Page | null)) tr.setDocAttribute("page", next.attrs.page);
    for (const key of ["header", "footer"] as const) {
      const [a, b] = [next.attrs[key] as RunningText | null, current.attrs[key] as RunningText | null];
      if ((a ? writeRunning(a) : "") !== (b ? writeRunning(b) : "")) tr.setDocAttribute(key, a);
    }
    if (!tr.docChanged) {
      this.#notify();
      return;
    }
    this.#view.dispatch(tr.setMeta("addToHistory", false).setMeta(SYNC, true));
    this.#notify();
  }

  getDoc(): string {
    return this.#source;
  }

  #read(source: string): Projection | null {
    try {
      const projection = parseProjection(source);
      this.#head = {
        version: projection.version,
        opaque_schema: projection.opaque_schema,
        readonly: projection.readonly,
        body_only: projection.body_only,
        lang: projection.lang,
        f: projection.f,
        styles: projection.styles,
        roles: projection.roles,
      };
      this.#intake = { kind: "ok", readonly: projection.readonly ?? null };
      this.#closed = closedBlocks(projection.blocks);
      // Un aggiornamento da fuori aggiunge ciò che porta: quello che l'utente
      // ha tagliato prima resta noto, e si può incollare.
      const doc = toDoc(projection);
      collectKeys(doc, this.#known);
      return projection;
    } catch (error) {
      this.#head = { version: this.#head.version, opaque_schema: this.#head.opaque_schema };
      this.#closed = [];
      this.#intake = { kind: "invalid", reason: error instanceof Error ? error.message : String(error) };
      return null;
    }
  }

  #dispatch(given: Transaction): void {
    if (this.#destroyed) return;
    const before = this.#view.state;
    let tr = given;
    if (tracking(before.doc) && tr.docChanged && !tr.getMeta(SYNC)) {
      const tracked = trackTransaction(before, tr, reviewAuthor());
      // Ciò che non ha una revisione da scrivere non cambia il documento.
      if (!tracked) {
        this.#notify();
        return;
      }
      tr = tracked;
    }
    const state = before.apply(tr);
    const user = tr.docChanged && !tr.getMeta(SYNC);
    const blocks = user ? this.#admitted(before.doc, state.doc) : null;
    if (user && !blocks) {
      this.#refused = true;
      this.#notify();
      return;
    }
    // Un foglio che nasce da ciò che si scrive si muove; uno che arriva col
    // documento no.
    if (user) this.#sheets.local();
    const goTo = tr.getMeta(GO_TO) as true | "find" | undefined;
    if (goTo) {
      // Trova che resta sulla stessa occorrenza mentre si scrive la parola non
      // riaccende l'anello.
      const at = state.selection.from;
      this.#goingTo = { ring: goTo !== "find" || at !== this.#lastFound };
      this.#lastFound = goTo === "find" ? at : -1;
    }
    try {
      this.#view.updateState(state);
    } finally {
      // Anche senza il fuoco, che ProseMirror vuole per scorrere: si va a un
      // punto dalla barra di Trova o dal pannello.
      const going = this.#goingTo;
      this.#goingTo = null;
      if (going) this.#motion.goTo(this.#lines(this.#view), going.ring);
    }
    if (blocks) {
      // Ciò che il documento ha, l'ha avuto: un taglia e incolla lo ritrova.
      collectKeys(state.doc, this.#known);
      const previous = this.#source;
      this.#source = writeHead({ ...this.#head, track: tracking(state.doc), page: (state.doc.attrs.page as Page | null) ?? undefined,
          header: (state.doc.attrs.header as RunningText | null) ?? undefined,
          footer: (state.doc.attrs.footer as RunningText | null) ?? undefined,
          comments: commentsOf(state.doc) }) + blocks.join(",") + "]}";
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

  /// I blocchi di `after` in JSON, se `after` tiene ciò che non si scrive:
  /// i blocchi chiusi uguali e in ordine e, quando il documento si scrive
  /// soltanto nel corpo, ciò che `before` aveva fuori.
  #admitted(before: PmNode, after: PmNode): string[] | null {
    const closed: string[] = [];
    const blocks = this.#writer.write(after, closed);
    if (closed.length !== this.#closed.length || closed.some((block, i) => block !== this.#closed[i])) return null;
    if (this.bodyOnly() && !keepsOutside(before, after)) return null;
    return blocks;
  }

  /// Il documento si scrive soltanto nel corpo: il formato non riscriverebbe
  /// senza perdite qualcosa fuori, o un blocco chiuso.
  bodyOnly(): boolean {
    return this.#head.body_only === true;
  }

  /// Il documento ha blocchi chiusi.
  hasClosed(): boolean {
    return this.#closed.length > 0;
  }

  /// `command` si può eseguire e ciò che scrive entra: per chi mostra
  /// un'azione che il catalogo non ha.
  allows(command: Command): boolean {
    if (!this.editable()) return false;
    let admitted = true;
    const state = this.#view.state;
    const runs = command(state, (tr) => {
      if (tr.docChanged) admitted &&= this.#admitted(state.doc, state.apply(tr).doc) !== null;
    }, this.#view);
    return runs && admitted;
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
    this.#refused = false;
    const done = command(this.#view.state, (tr) => this.#view.dispatch(tr), this.#view) && !this.#refused;
    if (done && focus) this.#view.focus();
    return done;
  }

  /// Un gesto che sposta soltanto la selezione, come andare a una revisione o
  /// a un commento: vale anche in sola lettura. Se il comando toccasse il
  /// documento non si applica.
  browse(command: Command, focus = true): boolean {
    if (this.#destroyed) return false;
    let moved = false;
    command(this.#view.state, (tr) => {
      if (tr.docChanged) return;
      this.#view.dispatch(tr);
      moved = true;
    }, this.#view);
    if (moved && focus) this.#view.focus();
    return moved;
  }

  /// Le righe della selezione sullo schermo; del cursore, se è vuota.
  #lines(view: EditorView): Rect[] {
    const { from, to, empty } = view.state.selection;
    try {
      if (!empty) {
        const start = view.domAtPos(from);
        const end = view.domAtPos(to);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const lines = typeof range.getClientRects === "function" ? lineBoxes([...range.getClientRects()]) : [];
        if (lines.length > 0) return lines;
      }
      const at = view.coordsAtPos(from);
      return [{ left: at.left, top: at.top, width: Math.max(1, at.right - at.left), height: at.bottom - at.top }];
    } catch {
      return [];
    }
  }

  #filter(slice: Slice, view: EditorView): Slice {
    return filterSlice(slice, {
      known: this.#known,
      present: uniqueKeys(view.state.doc),
      moving: !!view.dragging?.move,
    });
  }

  /// Esegue un'azione del catalogo come una battuta. Un'azione che chiede
  /// (il link, trova e sostituisci) passa a chi lo sa chiedere.
  run(id: string): boolean {
    const action = RICH_ACTIONS.get(id);
    if (!action || !this.editable()) return false;
    if (ASK_ACTIONS.has(id)) return action.run(this.#view.state) && this.#ask(id);
    this.#refused = false;
    const done = action.run(this.#view.state, (tr) => this.#view.dispatch(tr), this.#view) && !this.#refused;
    if (done) this.#view.focus();
    return done;
  }

  actionState(id: string): { enabled: boolean; active: boolean | null } {
    if (!this.editable()) return { enabled: false, active: null };
    const state = richActionState(id, this.#view.state);
    // Mentre si registra, un'azione che non si registra non si offre; né
    // un'azione che cambia ciò che non si scrive.
    const guarded = this.hasClosed() || this.bodyOnly();
    if (state.enabled && (this.tracking() || guarded) && !ASK_ACTIONS.has(id)) {
      let offered = true;
      const before = this.#view.state;
      RICH_ACTIONS.get(id)!.run(before, (tr) => {
        if (this.tracking()) offered &&= trackable(tr);
        if (guarded && tr.docChanged) offered &&= this.#admitted(before.doc, before.apply(tr).doc) !== null;
      });
      if (!offered) return { ...state, enabled: false };
    }
    return state;
  }

  /// Il documento registra le modifiche.
  tracking(): boolean {
    return tracking(this.#view.state.doc);
  }

  /// Il foglio del cursore, da 1, e quanti sono: `null` se la carta non si
  /// vede (in Scrittura) o non c'è ancora.
  sheetOf(): { readonly at: number; readonly total: number } | null {
    const plan = this.#sheets.plan;
    if (!plan || !this.#sheets.visible()) return null;
    return { at: sheetAt(plan, this.#view.state.selection.head) + 1, total: plan.sheets.length };
  }

  /// Il foglio di `pos`, da 1: `null` se la carta non si vede o non c'è
  /// ancora.
  sheetFor(pos: number): number | null {
    const plan = this.#sheets.plan;
    if (!plan || !this.#sheets.visible()) return null;
    return sheetAt(plan, pos) + 1;
  }

  /// Mostra le occorrenze di una ricerca (nessuna con `null`) e seleziona
  /// quella di indice `current`. Non cambia il documento: vale anche quando
  /// non si scrive, così una ricerca chiusa non lascia segni.
  find(query: FindQuery | null, current = -1): void {
    if (this.#destroyed) return;
    showMatches(query, current)(this.#view.state, (tr) => this.#view.dispatch(tr));
  }

  /// Avvisa quando stato delle azioni, sola lettura o contenuto cambiano.
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /// Avvisa quando qualcuno chiede l'azione `id` (`Mod-k` per un link, o
  /// l'azione dalla barra).
  onAsk(id: string, listener: () => void): () => void {
    let listeners = this.#asks.get(id);
    if (!listeners) this.#asks.set(id, (listeners = new Set()));
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  #ask(id: string): boolean {
    const listeners = this.#asks.get(id);
    if (!listeners || listeners.size === 0 || !this.editable()) return false;
    for (const listener of [...listeners]) listener();
    return true;
  }

  #notify(): void {
    this.#drawPage();
    for (const listener of [...this.#listeners]) listener();
  }

  /// Le misure della pagina sulla scrivania, se sono cambiate.
  #drawPage(): void {
    // La scrivania è larga quanto il primo foglio.
    const variables = pageVariables(sheetPlanOf(this.#view.state)?.sections[0]?.page ?? null);
    const drawn = JSON.stringify(variables);
    if (drawn === this.#drawnPage) return;
    for (const name of Object.keys(JSON.parse(this.#drawnPage || "{}") as Record<string, string>)) this.#desk.style.removeProperty(name);
    for (const [name, value] of Object.entries(variables)) this.#desk.style.setProperty(name, value);
    this.#drawnPage = drawn;
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
    if (this.#destroyed) return;
    this.#view.dom.parentElement?.setAttribute("aria-label", this.#options.label());
    this.#view.setProps({});
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

  /// Il tasto destro in un punto della finestra: fuori dalla selezione il
  /// cursore va lì, dentro la selezione resta, come in Word. Torna la
  /// posizione nel documento, o `null` fuori dal testo.
  pointAt(x: number, y: number): number | null {
    if (this.#destroyed) return null;
    const hit = this.#view.posAtCoords({ left: x, top: y });
    if (!hit) return null;
    const { from, to } = this.#view.state.selection;
    if (hit.pos < from || hit.pos > to) {
      const tr = this.#view.state.tr.setSelection(TextSelection.near(this.#view.state.doc.resolve(hit.pos)));
      this.#view.dispatch(tr.setMeta("addToHistory", false));
    }
    return hit.pos;
  }

  /// Ciò che sta al cursore, per il menu del tasto destro.
  menuTarget(): { readonly href: string | null; readonly table: boolean; readonly revision: boolean } {
    const { $from } = this.#view.state.selection;
    // Un link non si estende oltre la sua fine: al suo primo carattere lo
    // dice il nodo che segue.
    const marks = [...$from.marks(), ...($from.nodeAfter?.marks ?? [])];
    const link = marks.find((mark) => mark.type === richSchema.marks.link);
    let table = false;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === richSchema.nodes.cell) table = true;
    }
    const revision = marks.some((mark) => mark.type === richSchema.marks.ins || mark.type === richSchema.marks.del);
    return { href: link ? (link.attrs.href as string) : null, table, revision };
  }

  /// Il riquadro della selezione nella finestra, per la bolla e il menu
  /// aperto dalla tastiera.
  selectionBox(): { left: number; top: number; right: number; bottom: number } | null {
    if (this.#destroyed) return null;
    const { from, to } = this.#view.state.selection;
    try {
      const start = this.#view.coordsAtPos(from, 1);
      const end = this.#view.coordsAtPos(to, -1);
      return {
        left: Math.min(start.left, end.left),
        top: Math.min(start.top, end.top),
        right: Math.max(start.right, end.right),
        bottom: Math.max(start.bottom, end.bottom),
      };
    } catch {
      return null;
    }
  }

  /// La selezione come la copierebbe Mod-c: l'HTML di ProseMirror e il testo.
  clipboardContent(): { readonly html: string; readonly text: string } | null {
    const selection = this.#view.state.selection;
    if (selection.empty) return null;
    const { dom, text } = this.#view.serializeForClipboard(selection.content());
    return { html: dom.innerHTML, text };
  }

  /// Toglie la selezione, come il secondo tempo di «Taglia».
  deleteSelection(): boolean {
    return this.apply((state, dispatch) => {
      if (state.selection.empty) return false;
      dispatch?.(state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
      return true;
    });
  }

  /// Incolla come l'incolla del browser: passa dallo stesso filtro.
  pasteContent(text: string, html: string | null): boolean {
    if (!this.editable()) return false;
    this.#view.focus();
    return html !== null ? this.#view.pasteHTML(html) : this.#view.pasteText(text);
  }

  /// Apre sul posto l'intestazione o il piè del foglio del cursore. Riesce
  /// soltanto sulla carta (Pagina e Lettura), in un documento che si scrive,
  /// con una pagina, e se il testo non è bloccato.
  editRunning(kind: "header" | "footer"): boolean {
    const plan = sheetPlanOf(this.#view.state);
    return plan !== null && this.#openRunning(kind, sheetAt(plan, this.#view.state.selection.from));
  }

  /// Adatta la carta alla vista `view` (in px): larga quanto la vista, o il
  /// primo foglio intero; `null` è la carta vera. Con `moved` (un bottone) la
  /// carta si scala attorno al centro della vista.
  fitPaper(fit: PaperFit | null, view: { readonly width: number; readonly height: number }, moved = false): void {
    const page = sheetPlanOf(this.#view.state)?.sheets[0]?.page ?? DEFAULT_PAGE;
    this.setScale(fit === null ? 1 : fitScale(fit, view, { width: page.w * PX_PER_PT, height: page.h * PX_PER_PT }, DESK_INSET), moved);
  }

  /// La scala della carta: 1 è la carta vera. Lo zoom porta con sé la
  /// scrivania intera, e la misura dei fogli lo legge dal rettangolo. Con
  /// `moved` il punto al centro della vista resta lì e la carta si scala
  /// attorno a lui; senza (la vista che cambia misura) cambia e basta.
  setScale(scale: number, moved = false): void {
    if (this.#destroyed) return;
    const value = Math.abs(scale - 1) < 0.001 ? "" : String(Math.round(scale * 1000) / 1000);
    if (this.#desk.style.zoom === value) return;
    const apply = () => {
      this.#desk.style.zoom = value;
      this.#sheets.schedule();
    };
    if (moved) this.#motion.zoom(apply);
    else apply();
  }

  /// La carta segue la modalità e l'aspetto scritti su `targets`, e la barra
  /// `ribbon` che si nasconde o si raccoglie.
  followView(targets: readonly HTMLElement[], ribbon: HTMLElement | null): void {
    if (!this.#destroyed) this.#motion.follow(targets, ribbon);
  }

  /// L'intestazione o il piè del foglio del cursore non si cambia: ha
  /// immagini, tabelle o aspetti che Fub non scrive.
  runningLocked(kind: "header" | "footer"): boolean {
    const plan = sheetPlanOf(this.#view.state);
    return plan?.sheets[sheetAt(plan, this.#view.state.selection.from)]?.[kind]?.locked === true;
  }

  /// L'intestazione o il piè si sta scrivendo sul posto.
  writingRunning(): boolean {
    return this.#running !== null;
  }

  #openRunning(kind: "header" | "footer", index: number): boolean {
    const plan = sheetPlanOf(this.#view.state);
    const sheet = plan?.sheets[index];
    if (!plan || !sheet || !this.editable() || this.tracking()) return false;
    const section = plan.sections[sheet.section]!;
    const running = sheet[kind];
    if (!section.page || running?.locked || !this.#sheets.measure()) return false;
    const box = this.#sheets.box(index);
    if (!box) return false;
    const page = sheet.page;
    const inset = runningInset(kind === "header" ? page.top : page.bottom);
    const left = `left: calc(${box.left}px + ${page.left}pt); width: ${page.w - page.left - page.right}pt`;
    const place = kind === "header" ? `top: calc(${box.top}px + ${inset}pt); ${left}` : `top: calc(${box.top + box.height}px - ${inset}pt); transform: translateY(-100%); ${left}`;
    // Dall'intestazione al piè il corpo resta attenuato: niente corsa.
    const swapping = this.#running !== null;
    this.#swapping = swapping;
    this.#running?.close(true);
    this.#swapping = false;
    this.#desk.classList.add("rich-desk-running");
    if (!swapping) this.#motion.running(true);
    this.#running = openRunningEditor({
      host: this.#desk,
      kind,
      section: sheet.section + 1,
      running,
      place,
      commit: (next) => {
        this.apply(setRunningAt(kind, section.pos, next), false);
      },
      closed: (back) => {
        this.#running = null;
        this.#desk.classList.remove("rich-desk-running");
        if (!this.#swapping) this.#motion.running(false);
        if (back) this.focus();
      },
    });
    return true;
  }

  /// Seleziona tutto il documento.
  selectAll(): void {
    if (this.#destroyed) return;
    this.#view.dispatch(this.#view.state.tr.setSelection(new AllSelection(this.#view.state.doc)));
    this.#view.focus();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#running?.close(false);
    this.#destroyed = true;
    this.#stopPage();
    this.#motion.destroy();
    this.#sheets.destroy();
    this.#listeners.clear();
    this.#asks.clear();
    this.#view.destroy();
    this.#desk.remove();
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
