// Le formule della Live (C6, T60). Con `mai` una formula resta resa anche col
// cursore accanto, e di serie si modifica toccandola (E27): un clic, o → e ←
// che ci entrano, aprono sotto la formula in riga un riquadro di 392 px con la
// formula grande e il cursore dentro, e mentre si scrive cambia anche quella
// nella frase; un blocco `$$` toccato si modifica sul posto, col bordo
// d'accento. Il LaTeX non si vede (`math/`).
//
// Con «Mostra il LaTeX» (`editor.math.source`) o coi tasti di Vim resta il
// comportamento di prima: il riquadro col TeX e l'anteprima, il blocco `$$`
// che torna sorgente con la resa sotto. Con `elemento` la sorgente si vede col
// cursore dentro e l'anteprima sta in un riquadro sopra la riga, senza
// prendere il fuoco.
import { syntaxTree } from "@codemirror/language";
import { Annotation, type ChangeDesc, type EditorState, type Extension, Facet, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { openPopover, type PopoverHandle, textField, type VirtualAnchor } from "../../../../kit";
import { openLifetime, type Lifetime, type Teardown } from "../../../../ui/lifetime";
import { liveReveal, mathSource } from "../../live-reveal";
import { mountMathBlocks } from "./math";
import { MathEditor, type LeaveReason, type MathStart } from "./math/editor";
import { liveStrings } from "./strings";

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

/// La formula in riga che si sta modificando, segnata nella frase. `owner` è
/// il riquadro che l'ha segnata: chiudendosi toglie il suo segno, non quello
/// del riquadro aperto dopo.
interface Editing {
  readonly owner: object;
  readonly marks: DecorationSet;
}
const markEditing = StateEffect.define<{ owner: object; range: { from: number; to: number } | null }>();
const editingMark = Decoration.mark({ class: "cm-fub-math-on" });
const editingField = StateField.define<Editing | null>({
  create: () => null,
  update(value, transaction) {
    let next = value && { owner: value.owner, marks: value.marks.map(transaction.changes) };
    for (const effect of transaction.effects) {
      if (!effect.is(markEditing)) continue;
      const { owner, range } = effect.value;
      if (range) {
        next = { owner, marks: range.to > range.from ? Decoration.set([editingMark.range(range.from, range.to)]) : Decoration.none };
      } else if (next?.owner === owner) {
        next = null;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value?.marks ?? Decoration.none),
});

/// Chi trova le formule in riga: lo dà la Live.
const formulaLookup = Facet.define<FormulaLookup, FormulaLookup | null>({
  combine: (values) => values[0] ?? null,
});

/// La formula si modifica toccandola: `mai`, senza «Mostra il LaTeX» né Vim, e
/// la nota non è in sola lettura.
export function mathTouchable(state: EditorState): boolean {
  return state.facet(liveReveal) === "mai" && !state.facet(mathSource) && !state.readOnly;
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
}

function editInline(view: EditorView, formula: LiveFormula, start: MathStart, owner: Lifetime): InlineSession {
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
    view.dispatch({ changes, effects: markEditing.of({ owner: life, range: { from, to } }), userEvent: "input", annotations: ownEdit.of(true) });
    popover.reposition();
  };
  const leave = (reason: LeaveReason) => {
    popover.close();
    const at = Math.min(reason === "before" ? from : to, view.state.doc.length);
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true, userEvent: "select" });
    view.focus();
  };
  const editor = new MathEditor({
    tex: formula.tex,
    display: false,
    start,
    inTable: inTableRow(view.state, formula.from),
    onChange: write,
    onLeave: leave,
    lifetime: life,
  });
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
      // Fuori dal giro: il riquadro può chiudersi mentre la vista si aggiorna.
      queueMicrotask(() => {
        if (!owner.closed) view.dispatch({ effects: markEditing.of({ owner: life, range: null }) });
      });
    },
  });
  view.dispatch({ effects: markEditing.of({ owner: life, range: { from, to } }) });
  editor.focus();
  return {
    popover,
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
    const editor = new MathEditor({
      tex: this.tex,
      display: true,
      start: plugin.takeEntry(this.from),
      onChange: (tex) => plugin.writeBlock(root, tex),
      onLeave: (reason) => plugin.leaveBlock(root, reason),
      lifetime: life,
    });
    root.append(editor.element);
    // Il fuoco va nella formula quando ci arriva dalla nota (un clic, le
    // frecce); una selezione messa da fuori, a nota ferma, non lo ruba.
    if (view.hasFocus || plugin.entryFocus) {
      plugin.entryFocus = false;
      queueMicrotask(() => {
        if (!life.closed && root.isConnected) editor.focus();
      });
    }
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

  constructor(readonly view: EditorView) {
    this.lastHead = view.state.selection.main.head;
  }

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      if (transaction.docChanged && !transaction.annotation(ownEdit)) this.inline?.map(transaction.changes);
    }
    if (update.selectionSet) this.lastHead = update.startState.selection.main.head;
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      // Fuori dal ciclo di aggiornamento: il riquadro misura la vista.
      queueMicrotask(() => this.follow());
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
    const view = this.view;
    if (mathTouchable(view.state)) {
      const session = editInline(view, formula, start, this.life);
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

  destroy(): void { this.life.close(); }
}

const mathPlugin = ViewPlugin.fromClass(MathPlugin, {
  eventHandlers: {
    mousedown(event, view) {
      if (view.state.facet(liveReveal) !== "mai" || event.button !== 0) return false;
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
          this.noteClick(event.clientX, event.clientY, at);
          this.entryFocus = true;
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
      this.open(formula, inline, { x: event.clientX, y: event.clientY });
      return true;
    },
  },
});

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
    editingField,
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
