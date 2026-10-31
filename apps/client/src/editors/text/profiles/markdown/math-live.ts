// Le formule con l'anteprima (C6). Con `mai` una formula in riga resta resa
// anche col cursore accanto: un clic, o → e ← che ci entrano, aprono un
// riquadro con il TeX e l'anteprima, come l'equazione di Notion; Invio o Esc lo
// chiudono e il cursore va dopo la formula. Con `elemento` la sorgente si vede
// col cursore dentro e l'anteprima sta in un riquadro sopra la riga, senza
// prendere il fuoco. Un blocco `$$` col cursore dentro ha la resa sotto, come
// il diagramma di C5.
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { openPopover, type PopoverHandle, textField } from "../../../../kit";
import { openLifetime, type Lifetime, type Teardown } from "../../../../ui/lifetime";
import { liveReveal } from "../../live-reveal";
import { mountMathBlocks } from "./math";
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

// ── Il riquadro della formula, con `mai` ─────────────────────────────────────

function editFormula(view: EditorView, formula: LiveFormula, anchor: Element, owner: Lifetime): PopoverHandle {
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

// ── L'anteprima sopra la riga, con `elemento` ────────────────────────────────

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

// ── Il blocco `$$` toccato ───────────────────────────────────────────────────

const blockMounts = new WeakMap<HTMLElement, Teardown>();

/// Sotto il sorgente di un blocco `$$` col cursore dentro, la sua resa.
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

// ── Il plugin ────────────────────────────────────────────────────────────────

/// Il riquadro delle formule della Live. `lookup` trova la formula in un punto.
export function mathPopovers(lookup: FormulaLookup): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      readonly life = openLifetime();
      editing: PopoverHandle | null = null;
      hovering: { popover: PopoverHandle; preview: Preview; from: number } | null = null;
      constructor(readonly view: EditorView) {}
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          // Fuori dal ciclo di aggiornamento: il riquadro misura la vista.
          queueMicrotask(() => this.follow());
        }
      }
      /// Con `elemento`, l'anteprima segue la formula che ha il cursore.
      follow(): void {
        const view = this.view;
        if (this.life.closed) return;
        const state = view.state;
        const formula = state.facet(liveReveal) === "elemento" && view.hasFocus && state.selection.ranges.length === 1
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
      open(formula: LiveFormula, anchor: Element | null): void {
        this.editing?.close();
        const view = this.view;
        const target = anchor ?? (() => {
          const node = view.domAtPos(formula.from).node;
          return node instanceof Element ? node : node.parentElement;
        })();
        if (!target) return;
        this.editing = editFormula(view, formula, target, this.life);
      }
      destroy(): void { this.life.close(); }
    },
    {
      eventHandlers: {
        mousedown(event, view) {
          if (view.state.facet(liveReveal) !== "mai" || event.button !== 0) return false;
          const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".cm-fub-math") : null;
          if (!target) return false;
          const formula = lookup(view, view.posAtDOM(target), 1);
          if (!formula) return false;
          event.preventDefault();
          this.open(formula, target);
          return true;
        },
      },
    },
  );
  const enter = (side: -1 | 1) => (view: EditorView): boolean => {
    const state = view.state;
    if (state.facet(liveReveal) !== "mai" || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
    const head = state.selection.main.head;
    const formula = lookup(view, head, side);
    if (!formula || (side === 1 ? formula.from !== head : formula.to !== head)) return false;
    view.plugin(plugin)?.open(formula, null);
    return true;
  };
  return [
    plugin,
    theme,
    Prec.high(keymap.of([
      { key: "ArrowRight", run: enter(1) },
      { key: "ArrowLeft", run: enter(-1) },
    ])),
  ];
}

const theme = EditorView.baseTheme({
  // I colori sono della pelle (`document.css`).
  ".cm-fub-math-live": { paddingBlock: "0.5rem", textAlign: "center" },
});
