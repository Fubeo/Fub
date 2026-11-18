// Il callout (D1). La testata `[!tipo]±titolo` la leggono una volta sola la
// Lettura (`render.ts`) e la Live: qui c'è la sua espressione. In Live, col
// cursore dentro, il callout resta un riquadro: le righe hanno il fondo del
// tipo, `[!tip]` è la pastiglia del tipo, che apre i tipi, e `+`/`-` sono la
// freccia della ripiegatura. Con `elemento` la sorgente torna col cursore nel
// prefisso.
import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
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

// ── Le colonne con le schede (T42) ─────────────────────────────────────────
// Le schede affiancate sono le colonne di K3 (`blocks/columns.ts` le fa, col
// menu del blocco e con «Accanto»). Qui c'è soltanto ciò che serve quando una
// scheda dentro una colonna se ne va: la sua colonna sparisce, e con una
// colonna sola rimasta il riquadro torna il suo contenuto.

const COLUMNS_LINE = /^>[ \t]?\[!columns\][ \t]*$/i;
const COLUMN_LINE = /^>[ \t]?>[ \t]?\[!column\][ \t]*$/i;
/// Il prefisso di una riga dentro una colonna: `> > ` (o `> >` vuota).
const COLUMN_PREFIX = /^>[ \t]?>[ \t]?/;

/// Le colonne del `[!columns]` che contiene `pos`: dove sta il riquadro, e il
/// testo di ogni colonna senza i prefissi. `null` fuori da un `[!columns]`.
export function columnsAround(state: EditorState, pos: number): { from: number; to: number; columns: { from: number; to: number; text: string }[] } | null {
  const doc = state.doc;
  let head = doc.lineAt(pos);
  while (!COLUMNS_LINE.test(head.text)) {
    if (head.number === 1 || !head.text.startsWith(">")) return null;
    head = doc.line(head.number - 1);
  }
  let last = head;
  while (last.number < doc.lines && doc.line(last.number + 1).text.startsWith(">")) last = doc.line(last.number + 1);
  if (pos > last.to) return null;
  const columns: { from: number; to: number; text: string }[] = [];
  let current: { from: number; to: number; lines: string[] } | null = null;
  for (let n = head.number + 1; n <= last.number; n++) {
    const line = doc.line(n);
    if (COLUMN_LINE.test(line.text)) {
      if (current) columns.push({ from: current.from, to: current.to, text: current.lines.join("\n") });
      current = { from: line.from, to: line.to, lines: [] };
      continue;
    }
    if (!current) continue;
    // `>` da sola stacca una colonna dalla dopo: non è del suo testo.
    if (!COLUMN_PREFIX.test(line.text)) continue;
    current.lines.push(line.text.replace(COLUMN_PREFIX, ""));
    current.to = line.to;
  }
  if (current) columns.push({ from: current.from, to: current.to, text: current.lines.join("\n") });
  return { from: head.from, to: last.to, columns };
}

/// Toglie la colonna che contiene `pos`. Restano due colonne o più: il
/// riquadro le tiene; ne resta una: il riquadro diventa il suo testo; nessuna:
/// il riquadro se ne va. Un passo d'annullamento; `null` fuori da una colonna.
export function removeColumnAt(state: EditorState, pos: number): TransactionSpec | null {
  const found = columnsAround(state, pos);
  if (!found) return null;
  const gone = found.columns.findIndex((column) => pos >= column.from && pos <= column.to);
  if (gone < 0) return null;
  const nl = state.lineBreak;
  const rest = found.columns.filter((_, index) => index !== gone).map((column) => column.text);
  const quoted = (text: string) => ["> > [!column]", ...text.split("\n").map((line) => (line === "" ? "> >" : `> > ${line}`))].join(nl);
  const insert = rest.length >= 2
    ? ["> [!columns]", rest.map(quoted).join(`${nl}>${nl}`)].join(nl)
    : rest.length === 1 ? rest[0]!.split("\n").join(nl) : "";
  return { changes: { from: found.from, to: found.to, insert }, selection: { anchor: found.from }, userEvent: "delete.block", scrollIntoView: true };
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
