// Il callout (D1). La testata `[!tipo]±titolo` la leggono una volta sola la
// Lettura (`render.ts`) e la Live: qui c'è la sua espressione. In Live, col
// cursore dentro, il callout resta un riquadro: le righe hanno il fondo del
// tipo, `[!tip]` è la pastiglia del tipo, che apre i tipi, e `+`/`-` sono la
// freccia della ripiegatura. Con `elemento` la sorgente torna col cursore nel
// prefisso.
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { createList, openPopover, type PopoverHandle } from "../../../../kit";
import { openLifetime } from "../../../../ui/lifetime";
import { CALLOUT_TYPES } from "./slash";
import { liveStrings } from "./strings";
import { calloutHead } from "./callout-head";

/// Il nome di un tipo come si legge.
export function calloutName(type: string): string {
  return type ? type[0]!.toUpperCase() + type.slice(1) : type;
}

const ATTR_TYPE = "data-fub-callout";

/// La pastiglia del tipo, al posto di `[!tipo]`; con la ripiegatura, la freccia.
export class CalloutTypeWidget extends WidgetType {
  constructor(readonly type: string, readonly fold: "+" | "-" | null) { super(); }
  eq(other: CalloutTypeWidget): boolean { return other.type === this.type && other.fold === this.fold; }
  toDOM(): HTMLElement {
    const holder = document.createElement("span");
    holder.className = "cm-fub-callout-head";
    if (this.fold) {
      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.className = "cm-fub-callout-fold";
      arrow.setAttribute("aria-expanded", String(this.fold === "+"));
      arrow.setAttribute("aria-label", liveStrings.t(this.fold === "+" ? "live.callout.fold.open" : "live.callout.fold.closed"));
      arrow.textContent = this.fold === "+" ? "▾" : "▸";
      holder.append(arrow);
    }
    // Le colonne (K3) non sono un tipo da cambiare: il nome soltanto, come
    // l'etichetta di ogni colonna.
    if (this.type.toLowerCase() === "columns") {
      const label = document.createElement("span");
      label.className = "cm-fub-column-label";
      label.textContent = liveStrings.t("live.columns");
      holder.append(label);
      return holder;
    }
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "cm-fub-callout-type";
    pill.setAttribute(ATTR_TYPE, this.type);
    pill.setAttribute("aria-haspopup", "menu");
    pill.setAttribute("aria-label", liveStrings.t("live.callout.type", { type: calloutName(this.type) }));
    pill.textContent = calloutName(this.type);
    holder.append(pill);
    return holder;
  }
  // I tasti restano ai pulsanti, che con Invio e Spazio fanno il loro clic.
  ignoreEvent(event: Event): boolean { return event instanceof KeyboardEvent; }
}

/// La testata del callout che sta sulla riga di `pos`, in posizioni del documento.
function headAt(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  const head = calloutHead(line.text);
  return head ? { line, head } : null;
}

/// Il tipo nuovo: si riscrivono soltanto i byte fra `[!` e `]`.
export function setCalloutType(state: EditorState, pos: number, type: string) {
  const found = headAt(state, pos);
  if (!found) return null;
  const { line, head } = found;
  return { changes: { from: line.from + head.typeText.from, to: line.from + head.typeText.to, insert: type }, userEvent: "input" } as const;
}

/// La ripiegatura nuova: `+` aperto, `-` chiuso.
export function toggleCalloutFold(state: EditorState, pos: number) {
  const found = headAt(state, pos);
  if (!found?.head.fold) return null;
  const at = found.line.from + found.head.mark.to - 1;
  return { changes: { from: at, to: at + 1, insert: found.head.fold === "+" ? "-" : "+" }, userEvent: "input" } as const;
}

/// I gesti della testata: il menu dei tipi e la freccia.
export function calloutGestures(): Extension {
  return ViewPlugin.fromClass(
    class {
      menu: PopoverHandle | null = null;
      readonly life = openLifetime();
      constructor(readonly view: EditorView) {}
      open(button: HTMLElement): void {
        this.menu?.close();
        const view = this.view;
        const at = view.posAtDOM(button);
        const current = button.getAttribute(ATTR_TYPE) ?? "";
        const list = document.createElement("div");
        list.className = "cm-fub-callout-menu";
        list.setAttribute("aria-label", liveStrings.t("live.callout.types"));
        const life = openLifetime();
        const handle = createList<string>({
          container: list,
          role: "menu",
          items: CALLOUT_TYPES,
          key: (type) => type,
          render: (type, row) => {
            row.textContent = calloutName(type);
            row.setAttribute("role", "menuitemradio");
            row.setAttribute("aria-checked", String(type === current));
          },
          onActivate: (type) => {
            popover.close();
            const spec = setCalloutType(view.state, at, type);
            if (spec && !view.state.readOnly) view.dispatch(spec);
            view.focus();
          },
          focus: "roving",
          lifetime: life,
        });
        if ((CALLOUT_TYPES as readonly string[]).includes(current)) handle.setActive(current);
        const popover = openPopover({
          anchor: button,
          content: list,
          role: "presentation",
          className: "cm-fub-callout-popover",
          lifetime: this.life,
          onClose: () => {
            life.close();
            if (this.menu === popover) this.menu = null;
            button.setAttribute("aria-expanded", "false");
          },
        });
        button.setAttribute("aria-expanded", "true");
        this.menu = popover;
      }
      destroy(): void { this.life.close(); }
    },
    {
      eventHandlers: {
        mousedown(event) {
          if ((event.target as Element | null)?.closest?.(".cm-fub-callout-type, .cm-fub-callout-fold")) event.preventDefault();
        },
        click(event, view) {
          const target = event.target as Element | null;
          const pill = target?.closest?.<HTMLElement>(".cm-fub-callout-type");
          if (pill) {
            event.preventDefault();
            this.open(pill);
            return true;
          }
          const fold = target?.closest?.<HTMLElement>(".cm-fub-callout-fold");
          if (!fold) return false;
          event.preventDefault();
          const spec = view.state.readOnly ? null : toggleCalloutFold(view.state, view.posAtDOM(fold));
          if (spec) view.dispatch(spec);
          return true;
        },
      },
    },
  );
}
