// Le formule della Live (C6, T60). Con `mai` una formula resta resa anche col
// cursore accanto, e di serie si modifica toccandola (E27): un clic, o → e ←
// che ci entrano, aprono sotto la formula in riga un riquadro di 392 px con la
// formula grande e il cursore dentro, e mentre si scrive cambia anche quella
// nella frase; un blocco `$$` toccato si modifica sul posto, col bordo
// d'accento. Il LaTeX non si vede (`math/`). Sotto la formula, in riga e a
// blocco, la tavolozza dei simboli (`math/palette.ts`, T62).
//
// Con «Mostra il LaTeX» (`editor.math.source`, T63) lo stesso riquadro ha
// sotto la formula il campo del suo LaTeX, con gli aiuti scelti
// (`editor.math.help`); i tre puntini del riquadro cambiano le due preferenze
// e le scrivono nelle Impostazioni. Coi tasti di Vim resta il comportamento di
// prima: il riquadro col TeX e l'anteprima, il blocco `$$` che torna sorgente
// con la resa sotto. Con `elemento` la sorgente si vede col cursore dentro e
// l'anteprima sta in un riquadro sopra la riga, senza prendere il fuoco.
//
// «Posto» nei tre puntini e il tasto destro (T65) passano una formula da riga
// a blocco e indietro (`math/place.ts`), e la riaprono nel posto nuovo.
import { syntaxTree } from "@codemirror/language";
import { Annotation, type ChangeDesc, type EditorState, type Extension, Facet, Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { errorText } from "../../../../host/errors";
import { api } from "../../../../host/ipc";
import { openPopover, type PopoverHandle, textField, type VirtualAnchor } from "../../../../kit";
import { openLifetime, type Lifetime, type Teardown } from "../../../../ui/lifetime";
import { notify } from "../../../../ui/notify";
import { liveReveal, MATH_HELP_SETTING, MATH_SOURCE_SETTING, mathClassic, mathHelp, mathSource } from "../../live-reveal";
import { lazyPart } from "../../../../ui/lazy-part";
import { mountMathBlocks } from "./math";
import type { LeaveReason, MathEditor, MathEditorOptions, MathPreferences, MathStart } from "./math/editor";
import { unwrapFormula } from "./math/paste";
import { toBlock, toInline } from "./math/place";
import { formulaAt } from "./menu";
import { liveStrings } from "./strings";

/// Il riquadro che modifica una formula, con la tavolozza: arriva con un
/// `import()` (`math-editing.ts`), fuori dal ponte dei documenti. La Live lo
/// chiede a thread libero appena monta, e al passaggio del puntatore su una
/// formula; un gesto che arriva prima aspetta il modulo e non si perde.
export const mathEditing = lazyPart(() => import("./math-editing"));
type MathEditing = typeof import("./math-editing");

/// Una formula in riga come la mostra la Live: dove sta, quanto sono lunghi i
/// suoi dollari, e il TeX.
export interface LiveFormula {
  readonly from: number;
  readonly to: number;
  readonly tex: string;
}

/// Chi sa dove sono le formule della vista (il plugin della Live).
export type FormulaLookup = (view: EditorView, pos: number, side: -1 | 0 | 1) => LiveFormula | null;

/// La lunghezza dei dollari d'apertura di una formula.
export function dollarsOf(state: EditorState, formula: LiveFormula): number {
  return state.sliceDoc(formula.from, formula.from + 2) === "$$" && state.sliceDoc(formula.to - 2, formula.to) === "$$"
    && formula.to - formula.from >= 4 ? 2 : 1;
}

/// Il TeX nuovo della formula: si riscrivono soltanto i byte fra i dollari.
export function setTex(state: EditorState, formula: LiveFormula, tex: string) {
  const dollars = dollarsOf(state, formula);
  return {
    changes: { from: formula.from + dollars, to: formula.to - dollars, insert: tex },
    userEvent: "input",
  } as const;
}

/// Il TeX di un blocco `$$`, senza dollari e senza `^id`.
export function blockTex(source: string): string {
  const trimmed = source.trim().replace(/\s+\^[\w-]+$/, "");
  return trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4 ? trimmed.slice(2, -2).trim() : trimmed;
}

/// Dove sta il TeX di un blocco `$$` che comincia in `from`: fra i dollari,
/// senza gli spazi e gli a capo che lo circondano. Un blocco vuoto
/// (`$$\n\n$$`) ha il TeX sulla riga dopo i dollari d'apertura.
export function blockTexRange(state: EditorState, from: number): { from: number; to: number } | null {
  const text = state.sliceDoc(from, Math.min(state.doc.length, from + 200_000));
  // Prima dei dollari soltanto il rientro: in una citazione o in un elenco
  // ogni riga ha i suoi segni, e il blocco resta sorgente.
  const open = /^[ \t]*\$\$/.exec(text);
  if (!open) return null;
  const close = text.indexOf("$$", open[0].length);
  if (close < 0) return null;
  const inner = text.slice(open[0].length, close);
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;
  let start = open[0].length + lead;
  let end = close - trail;
  if (end < start) {
    // Tutto spazi: il TeX va dopo il primo a capo, se c'è.
    const newline = inner.indexOf("\n");
    start = end = open[0].length + (newline < 0 ? 0 : newline + 1);
  }
  return { from: from + start, to: from + end };
}

/// Una formula toccata da Fub: la mappatura delle modifiche degli altri non la
/// sposta due volte.
const ownEdit = Annotation.define<true>();

/// Il segno della formula in riga che si sta modificando, nella frase.
const EDITING_CLASS = "cm-fub-math-on";

/// Chi trova le formule in riga: lo dà la Live.
const formulaLookup = Facet.define<FormulaLookup, FormulaLookup | null>({
  combine: (values) => values[0] ?? null,
});

/// La formula si apre nel suo riquadro (da toccare, o col campo del LaTeX):
/// `mai`, senza i tasti di Vim, e la nota non è in sola lettura.
export function mathTouchable(state: EditorState): boolean {
  return state.facet(liveReveal) === "mai" && !state.facet(mathClassic) && !state.readOnly;
}

/// Le due preferenze delle formule nella vista.
function preferencesOf(state: EditorState): MathPreferences {
  return { source: state.facet(mathSource), help: state.facet(mathHelp) };
}

function inTableRow(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "Table" || node.name === "TableRow" || node.name === "TableCell") return true;
  }
  return /^\s*\|/.test(state.doc.lineAt(pos).text);
}

function preview(tex: string, display: boolean): { element: HTMLElement; teardown: Teardown } {
  const holder = document.createElement(display ? "div" : "span");
  holder.className = "cm-fub-math-preview";
  const formula = document.createElement(display ? "div" : "span");
  formula.className = display ? "math-block" : "math-inline";
  formula.dataset.tex = tex;
  formula.textContent = tex;
  holder.append(formula);
  return { element: holder, teardown: mountMathBlocks(holder) };
}

/// L'anteprima di un riquadro: si rifà a ogni TeX nuovo, e chiude la vecchia.
class Preview {
  readonly element = document.createElement("div");
  private teardown: Teardown | null = null;
  private tex: string | null = null;
  constructor(life: Lifetime) {
    this.element.className = "cm-fub-math-popover-preview";
    life.add(() => this.teardown?.());
  }
  show(tex: string): void {
    if (tex === this.tex) return;
    this.tex = tex;
    this.teardown?.();
    const made = preview(tex, false);
    this.teardown = made.teardown;
    this.element.replaceChildren(made.element);
  }
}

// ── Il riquadro col TeX, con «Mostra il LaTeX» ───────────────────────────────

function editSource(view: EditorView, formula: LiveFormula, anchor: Element, owner: Lifetime): PopoverHandle {
  const life = openLifetime();
  let current = formula;
  const content = document.createElement("div");
  content.className = "cm-fub-math-popover";
  const shown = new Preview(life);
  const leave = () => {
    popover.close();
    const at = Math.min(current.to, view.state.doc.length);
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true, userEvent: "select" });
    view.focus();
  };
  const field = textField({
    label: liveStrings.t("live.math.source"),
    labelHidden: true,
    value: formula.tex,
    onInput: (tex) => {
      if (view.state.readOnly) return;
      const dollars = dollarsOf(view.state, current);
      view.dispatch(setTex(view.state, current, tex));
      current = { from: current.from, to: current.from + dollars * 2 + tex.length, tex };
      shown.show(tex);
    },
    onSubmit: leave,
    lifetime: life,
  });
  field.input.classList.add("cm-fub-math-field");
  field.input.spellcheck = false;
  // Una formula incollata coi suoi delimitatori entra senza (T65).
  life.listen(field.input, "paste", (event) => {
    const unwrapped = unwrapFormula(event.clipboardData?.getData("text/plain") ?? "");
    if (!unwrapped || field.input.readOnly) return;
    event.preventDefault();
    const input = field.input;
    input.setRangeText(unwrapped.tex, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (view.state.readOnly) field.input.readOnly = true;
  shown.show(formula.tex);
  content.append(field.element, shown.element);
  const popover = openPopover({
    anchor,
    content,
    label: liveStrings.t("live.math.title"),
    className: "cm-fub-math-popover-surface",
    lifetime: owner,
    onClose: (reason) => {
      life.close();
      if (reason === "escape") {
        const at = Math.min(current.to, view.state.doc.length);
        view.dispatch({ selection: { anchor: at }, userEvent: "select" });
        view.focus();
      }
    },
  });
  field.input.focus();
  field.input.select();
  return popover;
}

// ── La formula in riga toccata ───────────────────────────────────────────────

/// Il riquadro aperto su una formula in riga.
interface InlineSession {
  readonly popover: PopoverHandle;
  /// Sposta la formula con le modifiche degli altri (un'altra superficie).
  map(changes: ChangeDesc): void;
  /// Segna nella frase la formula che si modifica: il suo disegno si rifà a
  /// ogni TeX nuovo, e il segno con lui.
  mark(): void;
}

function editInline(parts: MathEditing, view: EditorView, plugin: MathPlugin, formula: LiveFormula, start: MathStart, owner: Lifetime): InlineSession {
  const life = openLifetime();
  const dollars = dollarsOf(view.state, formula);
  const marks = "$".repeat(dollars);
  // Dove sta la formula nella nota; `gone` quando è vuota e il testo non c'è
  // più (`$$` vuoti sarebbero un blocco, non una formula vuota).
  let from = formula.from;
  let to = formula.to;
  let gone = false;
  const anchor: VirtualAnchor = {
    getBoundingClientRect() {
      const a = view.coordsAtPos(from, 1);
      const b = gone ? a : view.coordsAtPos(to, -1) ?? a;
      if (!a || !b) return { left: 0, top: 0, width: 0, height: 0 };
      const left = Math.min(a.left, b.left);
      const top = Math.min(a.top, b.top);
      return { left, top, width: Math.max(a.right, b.right) - left, height: Math.max(a.bottom, b.bottom) - top };
    },
  };
  const write = (tex: string) => {
    if (view.state.readOnly) return;
    // Uno spazio prima del dollaro di chiusura farebbe del TeX testo (`$x $`).
    const text = tex.replace(/\s+$/, "");
    let changes: { from: number; to: number; insert: string };
    if (!text) {
      if (gone) return;
      changes = { from, to, insert: "" };
      gone = true;
      to = from;
    } else if (gone) {
      changes = { from, to: from, insert: marks + text + marks };
      gone = false;
      to = from + text.length + 2 * dollars;
    } else {
      if (view.state.sliceDoc(from + dollars, to - dollars) === text) return;
      changes = { from: from + dollars, to: to - dollars, insert: text };
      to = from + text.length + 2 * dollars;
    }
    view.dispatch({ changes, userEvent: "input", annotations: ownEdit.of(true) });
    popover.reposition();
  };
  const leave = (reason: LeaveReason) => {
    popover.close();
    const at = Math.min(reason === "before" ? from : to, view.state.doc.length);
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true, userEvent: "select" });
    view.focus();
  };
  const editor = new parts.MathEditor({
    tex: formula.tex,
    display: false,
    start,
    inTable: inTableRow(view.state, formula.from),
    ...plugin.editorOptions(),
    ...(formulaAt(view.state, formula.from)?.plain ? { onPlace: () => void plugin.place(from, true) } : {}),
    onChange: write,
    onLeave: leave,
    lifetime: life,
  });
  plugin.adopt(editor, life);
  parts.attachPalette(editor, life);
  const popover = openPopover({
    anchor,
    content: editor.element,
    label: liveStrings.t("live.math.title"),
    className: "cm-fub-mx-popover",
    align: "center",
    autoFocus: false,
    dismissOnEscape: false,
    lifetime: owner,
    onClose: () => {
      life.close();
      marked?.classList.remove(EDITING_CLASS);
      marked = null;
    },
  });
  let marked: HTMLElement | null = null;
  const mark = () => {
    if (life.closed) return;
    let found: HTMLElement | null = null;
    if (!gone) {
      for (const element of view.contentDOM.querySelectorAll<HTMLElement>(".cm-fub-math")) {
        if (view.posAtDOM(element) === from) {
          found = element;
          break;
        }
      }
    }
    if (found === marked) return;
    marked?.classList.remove(EDITING_CLASS);
    found?.classList.add(EDITING_CLASS);
    marked = found;
  };
  mark();
  editor.focus();
  return {
    popover,
    mark,
    map(changes) {
      from = changes.mapPos(from, 1);
      to = gone ? from : changes.mapPos(to, -1);
      if (to < from) popover.close();
    },
  };
}

// ── Il blocco `$$` toccato ───────────────────────────────────────────────────

const blockMounts = new WeakMap<HTMLElement, Teardown>();

/// Sotto il sorgente di un blocco `$$` col cursore dentro, la sua resa (con
/// «Mostra il LaTeX»).
export class MathBlockLiveWidget extends WidgetType {
  constructor(readonly tex: string) { super(); }
  get estimatedHeight(): number { return 64; }
  eq(other: MathBlockLiveWidget): boolean { return other.tex === this.tex; }
  toDOM(): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-fub-math-live markdown-rendered";
    root.contentEditable = "false";
    root.setAttribute("aria-label", liveStrings.t("live.math.preview"));
    root.setAttribute("role", "group");
    const made = preview(this.tex, true);
    root.append(made.element);
    blockMounts.set(root, made.teardown);
    return root;
  }
  destroy(root: HTMLElement): void {
    blockMounts.get(root)?.();
    blockMounts.delete(root);
  }
  ignoreEvent(): boolean { return true; }
}

/// Un blocco `$$` col cursore dentro, di serie: la formula si modifica sul
/// posto, col bordo d'accento. `from` è l'inizio della sua riga: lo stesso
/// blocco resta lo stesso riquadro mentre si scrive.
export class MathBlockEditWidget extends WidgetType {
  constructor(readonly from: number, readonly tex: string) { super(); }
  get estimatedHeight(): number { return 96; }
  eq(other: MathBlockEditWidget): boolean { return other.from === this.from; }
  updateDOM(): boolean { return true; }
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-fub-mx-block";
    root.contentEditable = "false";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", liveStrings.t("live.math.title"));
    const plugin = view.plugin(mathPlugin);
    const life = openLifetime();
    blockMounts.set(root, () => life.close());
    if (!plugin) return root;
    // Da dove si entra, e se il fuoco va nella formula: si decide adesso,
    // anche per un riquadro che aspetta il suo codice. Il fuoco va nella
    // formula quando ci arriva dalla nota (un clic, le frecce); una selezione
    // messa da fuori, a nota ferma, non lo ruba.
    const start = plugin.takeEntry(this.from);
    const focus = view.hasFocus || plugin.entryFocus;
    const placeable = formulaAt(view.state, this.from)?.plain === true;
    plugin.entryFocus = false;
    const mount = (parts: MathEditing, tex: string): void => {
      const editor = new parts.MathEditor({
        tex,
        display: true,
        start,
        ...plugin.editorOptions(),
        ...(placeable ? { onPlace: () => void (root.isConnected && plugin.place(view.posAtDOM(root), false)) } : {}),
        onChange: (next) => plugin.writeBlock(root, next),
        onLeave: (reason) => plugin.leaveBlock(root, reason),
        lifetime: life,
      });
      plugin.adopt(editor, life);
      parts.attachPalette(editor, life);
      root.replaceChildren(editor.element);
      if (focus) {
        queueMicrotask(() => {
          if (!life.closed && root.isConnected) editor.focus();
        });
      }
    };
    const parts = mathEditing.current();
    if (parts) {
      mount(parts, this.tex);
      return root;
    }
    // Il codice del riquadro non è ancora arrivato: intanto, al suo posto,
    // la formula resa com'era, e il riquadro appena arriva, col TeX di allora.
    const shown = preview(this.tex, true);
    root.append(shown.element);
    life.add(shown.teardown);
    mathEditing.run((loaded) => {
      shown.teardown();
      const range = root.isConnected ? blockTexRange(view.state, view.posAtDOM(root)) : null;
      mount(loaded, range ? view.state.sliceDoc(range.from, range.to) : this.tex);
    }, () => !life.closed && root.isConnected);
    return root;
  }
  destroy(root: HTMLElement): void {
    blockMounts.get(root)?.();
    blockMounts.delete(root);
  }
  ignoreEvent(): boolean { return true; }
}

// ── Il plugin ────────────────────────────────────────────────────────────────

class MathPlugin {
  readonly life = openLifetime();
  editing: PopoverHandle | null = null;
  inline: InlineSession | null = null;
  hovering: { popover: PopoverHandle; preview: Preview; from: number } | null = null;
  /// Dove è caduto l'ultimo clic su un blocco `$$` reso: il cursore va lì.
  private click: { x: number; y: number; at: number } | null = null;
  /// Il cursore della nota prima di entrare in un blocco: da sopra si entra
  /// all'inizio della formula, da sotto alla fine.
  private lastHead = 0;
  /// Il prossimo blocco aperto prende il fuoco anche se la nota non lo ha.
  entryFocus = false;
  /// Le formule aperte adesso: cambiano con le preferenze.
  private readonly editors = new Set<MathEditor>();
  /// Le preferenze come le vede la vista (le Impostazioni).
  private preferences: MathPreferences;
  /// L'ultima scrittura dai tre puntini: una risposta vecchia non disfa una
  /// scelta nuova.
  private writes = 0;
  /// Una formula in riga toccata prima che il codice del riquadro arrivasse:
  /// si apre appena arriva, se il cursore non è andato altrove.
  private queued: { from: number; readonly start: MathStart } | null = null;

  constructor(readonly view: EditorView) {
    this.lastHead = view.state.selection.main.head;
    this.preferences = preferencesOf(view.state);
    if (mathTouchable(view.state)) mathEditing.warm();
  }

  /// Le opzioni comuni delle formule aperte in questa vista.
  editorOptions(): Pick<MathEditorOptions, "preferences" | "onPreferences" | "tell"> {
    return {
      preferences: this.preferences,
      onPreferences: (next) => this.choose(next),
      tell: (message) => notify(message),
    };
  }

  adopt(editor: MathEditor, life: Lifetime): void {
    this.editors.add(editor);
    life.add(() => this.editors.delete(editor));
  }

  /// Una scelta dai tre puntini: vale subito in tutte le formule aperte, e
  /// si scrive nelle Impostazioni, che la rimandano a ogni vista. Se la
  /// scrittura non riesce, la scelta di prima torna e lo si dice.
  private choose(next: MathPreferences): void {
    const before = this.preferences;
    this.apply(next);
    const write = ++this.writes;
    const writes: Promise<void>[] = [];
    if (next.source !== before.source) writes.push(api.setSetting(MATH_SOURCE_SETTING, next.source));
    if (next.help !== before.help) writes.push(api.setSetting(MATH_HELP_SETTING, next.help));
    void Promise.all(writes).catch((error: unknown) => {
      if (this.life.closed) return;
      if (write === this.writes) this.apply(preferencesOf(this.view.state));
      notify(liveStrings.t("live.math.options.failed", { reason: errorText(error) }), "guasto");
    });
  }

  private apply(next: MathPreferences): void {
    this.preferences = next;
    for (const editor of this.editors) editor.configure(next);
  }

  update(update: ViewUpdate): void {
    const before = preferencesOf(update.startState);
    const after = preferencesOf(update.state);
    if (before.source !== after.source || before.help !== after.help) this.apply(after);
    if (mathTouchable(update.state)) mathEditing.warm();
    for (const transaction of update.transactions) {
      if (transaction.docChanged && !transaction.annotation(ownEdit)) this.inline?.map(transaction.changes);
      if (this.queued) {
        // Il cursore spostato da chi scrive vale più del tocco di prima.
        if (transaction.isUserEvent("select")) this.queued = null;
        else if (transaction.docChanged) this.queued.from = transaction.changes.mapPos(this.queued.from, 1);
      }
    }
    if (update.selectionSet) this.lastHead = update.startState.selection.main.head;
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      // Fuori dal ciclo di aggiornamento: il riquadro misura la vista.
      queueMicrotask(() => this.follow());
    }
    if (this.inline && (update.docChanged || update.viewportChanged)) {
      // Il disegno della formula nella frase è nuovo dopo l'aggiornamento.
      const inline = this.inline;
      queueMicrotask(() => inline.mark());
    }
  }

  takeEntry(from: number): MathStart {
    const click = this.click;
    this.click = null;
    if (click && click.at === from) return { x: click.x, y: click.y };
    return this.lastHead <= from ? "start" : "end";
  }

  noteClick(x: number, y: number, at: number): void {
    this.click = { x, y, at };
  }

  /// Con `elemento`, l'anteprima segue la formula che ha il cursore.
  follow(): void {
    const view = this.view;
    if (this.life.closed) return;
    const state = view.state;
    const lookup = state.facet(formulaLookup);
    const formula = lookup && state.facet(liveReveal) === "elemento" && view.hasFocus && state.selection.ranges.length === 1
      ? lookup(view, state.selection.main.head, 0) : null;
    if (!formula) {
      this.hovering?.popover.close();
      this.hovering = null;
      return;
    }
    if (this.hovering && this.hovering.from === formula.from) {
      this.hovering.preview.show(formula.tex);
      return;
    }
    this.hovering?.popover.close();
    const node = view.domAtPos(formula.from).node;
    const anchor = node instanceof Element ? node : node.parentElement;
    if (!anchor) return;
    const opened = hoverPreview(formula, anchor, this.life);
    this.hovering = { ...opened, from: formula.from };
  }

  open(formula: LiveFormula, anchor: Element | null, start: MathStart): void {
    this.editing?.close();
    this.inline = null;
    this.queued = null;
    const view = this.view;
    if (mathTouchable(view.state)) {
      const parts = mathEditing.current();
      if (!parts) {
        this.wait(formula, start);
        return;
      }
      const session = editInline(parts, view, this, formula, start, this.life);
      this.inline = session;
      this.editing = session.popover;
      return;
    }
    const target = anchor ?? (() => {
      const node = view.domAtPos(formula.from).node;
      return node instanceof Element ? node : node.parentElement;
    })();
    if (!target) return;
    this.editing = editSource(view, formula, target, this.life);
  }

  /// Il tocco su una formula in riga quando il codice del riquadro non c'è
  /// ancora: la formula si apre appena arriva, ritrovata dov'è adesso.
  private wait(formula: LiveFormula, start: MathStart): void {
    const queued = { from: formula.from, start };
    this.queued = queued;
    mathEditing.run(() => {
      if (this.queued !== queued) return;
      this.queued = null;
      const found = this.view.state.facet(formulaLookup)?.(this.view, queued.from, 1);
      if (found && found.from === queued.from) this.open(found, null, queued.start);
    }, () => !this.life.closed);
  }

  /// Il TeX nuovo di un blocco aperto: soltanto i byte fra i dollari.
  writeBlock(root: HTMLElement, tex: string): void {
    const view = this.view;
    if (view.state.readOnly || !root.isConnected) return;
    const range = blockTexRange(view.state, view.posAtDOM(root));
    if (!range) return;
    const text = tex.trim();
    if (view.state.sliceDoc(range.from, range.to) === text) return;
    view.dispatch({ changes: { from: range.from, to: range.to, insert: text }, userEvent: "input", annotations: ownEdit.of(true) });
  }

  /// Il cursore esce da un blocco aperto: sopra, sulla riga prima; altrimenti
  /// sulla riga dopo. Un blocco in fondo alla nota ne prende una nuova, perché
  /// il cursore abbia dove stare.
  leaveBlock(root: HTMLElement, reason: LeaveReason): void {
    const view = this.view;
    if (!root.isConnected) return;
    const from = view.posAtDOM(root);
    const range = blockTexRange(view.state, from);
    const close = range ? view.state.doc.sliceString(range.to).indexOf("$$") : -1;
    const end = range && close >= 0 ? view.state.doc.lineAt(range.to + close + 2).to : view.state.doc.lineAt(from).to;
    if (reason === "before" || reason === "up") {
      if (from === 0) return;
      view.dispatch({ selection: { anchor: from - 1 }, scrollIntoView: true, userEvent: "select" });
    } else if (end >= view.state.doc.length) {
      view.dispatch({ changes: { from: end, insert: "\n" }, selection: { anchor: end + 1 }, scrollIntoView: true, userEvent: "input" });
    } else {
      view.dispatch({ selection: { anchor: end + 1 }, scrollIntoView: true, userEvent: "select" });
    }
    view.focus();
  }

  /// «Posto»: la formula in `at` passa da riga a blocco o indietro, con un
  /// passo d'annullamento, e si riapre nel posto nuovo.
  place(at: number, display: boolean): boolean {
    const view = this.view;
    if (view.state.readOnly || this.life.closed) return false;
    const formula = formulaAt(view.state, at);
    if (!formula) return false;
    const change = display ? toBlock(view.state, formula) : toInline(formula);
    if (!change) return false;
    this.editing?.close();
    this.editing = null;
    this.inline = null;
    if (display) {
      // Il blocco si apre toccandolo: il cursore va al suo inizio, e la
      // formula prende il fuoco.
      this.entryFocus = true;
      this.click = null;
      view.dispatch({ changes: change.changes, selection: { anchor: change.at }, scrollIntoView: true, userEvent: "input" });
      return true;
    }
    const end = change.at + change.changes.insert.length;
    view.dispatch({ changes: change.changes, selection: { anchor: end }, scrollIntoView: true, userEvent: "input" });
    view.focus();
    queueMicrotask(() => {
      if (this.life.closed) return;
      const formula = this.view.state.facet(formulaLookup)?.(this.view, change.at, 1);
      if (formula && formula.from === change.at) this.open(formula, null, "end");
    });
    return true;
  }

  destroy(): void { this.life.close(); }
}

const mathPlugin = ViewPlugin.fromClass(MathPlugin);

/// «Modifica» dal tasto destro: la formula in `pos` si apre come se la si
/// toccasse. Dove non si tocca (Sorgente, le altre rivelazioni) il suo TeX si
/// sceglie nella nota.
export function editFormulaAt(view: EditorView, pos: number): boolean {
  const formula = formulaAt(view.state, pos);
  if (!formula) return false;
  const plugin = view.plugin(mathPlugin);
  if (plugin && formula.block && mathTouchable(view.state) && blockTexRange(view.state, formula.container.from)) {
    plugin.entryFocus = true;
    view.dispatch({ selection: { anchor: formula.container.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  if (plugin && !formula.block && view.state.facet(liveReveal) === "mai") {
    const live = view.state.facet(formulaLookup)?.(view, formula.from, 1);
    if (live && live.from === formula.from) {
      plugin.open(live, null, "end");
      return true;
    }
  }
  view.dispatch({
    selection: { anchor: formula.from + formula.dollars, head: formula.to - formula.dollars },
    scrollIntoView: true,
    userEvent: "select",
  });
  view.focus();
  return true;
}

/// «Da riga a blocco» e «Da blocco a riga» dal tasto destro. Nella Live la
/// formula si riapre nel posto nuovo; in Sorgente cambia soltanto il testo.
export function placeFormulaAt(view: EditorView, pos: number, display: boolean): boolean {
  const plugin = view.plugin(mathPlugin);
  if (plugin && view.state.facet(liveReveal) === "mai") return plugin.place(pos, display);
  if (view.state.readOnly) return false;
  const formula = formulaAt(view.state, pos);
  const change = formula ? (display ? toBlock(view.state, formula) : toInline(formula)) : null;
  if (!change) return false;
  view.dispatch({ changes: change.changes, selection: { anchor: change.at }, scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}

/// Il clic su una formula. Prima degli altri gestori della Live: il clic su un
/// blocco reso altrimenti lo sceglie, e il cursore della formula non saprebbe
/// dov'è caduto.
const mathClicks = Prec.highest(EditorView.domEventHandlers({
  // Il puntatore su una formula: il riquadro che la modifica, se non è già
  // arrivato, si chiede adesso, prima del clic.
  pointerover(event) {
    if (!mathEditing.current() && event.target instanceof Element && event.target.closest(".cm-fub-math, .math-block")) {
      void mathEditing.load().catch(() => {});
    }
    return false;
  },
  mousedown(event, view) {
    const plugin = view.plugin(mathPlugin);
    if (!plugin || view.state.facet(liveReveal) !== "mai" || event.button !== 0) return false;
    const target = event.target instanceof Element ? event.target : null;
    // Un clic su un blocco `$$` reso: il cursore della formula va dove cade.
    const block = target?.closest<HTMLElement>(".math-block");
    if (block && mathTouchable(view.state) && !block.closest(".cm-fub-mx")) {
      const host = block.closest<HTMLElement>(".cm-widgetBuffer, .markdown-rendered") ?? block;
      let at: number | null = null;
      try {
        at = view.lineBlockAt(view.posAtDOM(host)).from;
      } catch {
        at = null;
      }
      if (at !== null) {
        plugin.noteClick(event.clientX, event.clientY, at);
        plugin.entryFocus = true;
        event.preventDefault();
        view.dispatch({ selection: { anchor: at }, userEvent: "select.pointer" });
        return true;
      }
    }
    const inline = target?.closest<HTMLElement>(".cm-fub-math");
    if (!inline) return false;
    const lookup = view.state.facet(formulaLookup);
    const formula = lookup?.(view, view.posAtDOM(inline), 1);
    if (!formula) return false;
    event.preventDefault();
    plugin.open(formula, inline, { x: event.clientX, y: event.clientY });
    return true;
  },
}));

function hoverPreview(formula: LiveFormula, anchor: Element, owner: Lifetime): { popover: PopoverHandle; preview: Preview } {
  const life = openLifetime();
  const shown = new Preview(life);
  shown.show(formula.tex);
  const popover = openPopover({
    anchor,
    content: shown.element,
    placement: "top",
    role: "presentation",
    className: "cm-fub-math-popover-surface",
    autoFocus: false,
    returnFocus: false,
    dismissOnOutside: false,
    lifetime: owner,
    onClose: () => life.close(),
  });
  return { popover, preview: shown };
}

/// Le formule della Live. `lookup` trova la formula in riga in un punto.
export function mathPopovers(lookup: FormulaLookup): Extension {
  const enter = (side: -1 | 1) => (view: EditorView): boolean => {
    const state = view.state;
    if (state.facet(liveReveal) !== "mai" || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
    const head = state.selection.main.head;
    const formula = lookup(view, head, side);
    if (!formula || (side === 1 ? formula.from !== head : formula.to !== head)) return false;
    view.plugin(mathPlugin)?.open(formula, null, side === 1 ? "start" : "end");
    return true;
  };
  return [
    formulaLookup.of(lookup),
    mathPlugin,
    mathClicks,
    theme,
    Prec.high(keymap.of([
      { key: "ArrowRight", run: enter(1) },
      { key: "ArrowLeft", run: enter(-1) },
    ])),
  ];
}

const theme = EditorView.baseTheme({
  // I colori sono della pelle (`document.css`, `math.css`).
  ".cm-fub-math-live": { paddingBlock: "0.5rem", textAlign: "center" },
});
