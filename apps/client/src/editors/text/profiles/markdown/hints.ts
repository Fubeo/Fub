// I cenni della guida (07): sul titolo del cursore la pastiglia «H2» nel
// margine, che apre i livelli; sulla riga vuota del cursore un segnaposto che
// dice che cosa scrivere. Nessuno dei due è nel file né in ciò che si copia, e
// i lettori di schermo leggono la pastiglia come un pulsante, il segnaposto no.
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Line } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { createList, openPopover, type PopoverHandle } from "../../../../kit";
import { openLifetime } from "../../../../ui/lifetime";
import { lineHeading, MARKDOWN_ACTIONS, markdownActionState } from "./actions";
import { frontmatterRange } from "./render";
import { liveStrings } from "./strings";

const OPAQUE = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);

function opaque(state: EditorState, line: Line): boolean {
  const yaml = frontmatterRange(state.doc);
  if (yaml && line.from < yaml.to) return true;
  for (let node = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent!) {
    if (OPAQUE.has(node.name)) return true;
    if (!node.parent) break;
  }
  return false;
}

type HintKey =
  | "live.hint.empty" | "live.hint.empty.slash" | "live.hint.list" | "live.hint.task" | "live.hint.quote";

/// Il segnaposto della riga `text`, se è vuota o è un blocco senza testo.
export function placeholderFor(text: string, slash: boolean): { key: HintKey | "live.hint.heading"; level?: number } | null {
  if (text === "") return { key: slash ? "live.hint.empty.slash" : "live.hint.empty" };
  const heading = /^ {0,3}(#{1,6})[ \t]*$/.exec(text);
  if (heading) return { key: "live.hint.heading", level: heading[1]!.length };
  if (/^\s*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+$/.test(text)) return { key: "live.hint.task" };
  if (/^\s*(?:[-*+]|\d+[.)])[ \t]+$/.test(text)) return { key: "live.hint.list" };
  if (/^\s*(?:>[ \t]?)+$/.test(text) && text.includes("> ")) return { key: "live.hint.quote" };
  return null;
}

class PlaceholderWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: PlaceholderWidget): boolean { return other.text === this.text; }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-fub-placeholder";
    el.setAttribute("aria-hidden", "true");
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean { return false; }
}

const ATTR_LEVEL = "data-fub-level";

class HeadingPillWidget extends WidgetType {
  constructor(readonly level: number) { super(); }
  eq(other: HeadingPillWidget): boolean { return other.level === this.level; }
  toDOM(): HTMLElement {
    const holder = document.createElement("span");
    holder.className = "cm-fub-heading-pill";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-fub-heading-pill-button";
    button.setAttribute(ATTR_LEVEL, String(this.level));
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-label", liveStrings.t("live.heading.pill", { level: String(this.level) }));
    button.textContent = `H${this.level}`;
    holder.append(button);
    return holder;
  }
  // I clic arrivano ai gestori del plugin, che non spostano il cursore; i
  // tasti restano al pulsante, che con Invio e Spazio fa il suo clic.
  ignoreEvent(event: Event): boolean { return event instanceof KeyboardEvent; }
}

/// I livelli del menu della pastiglia: il testo normale e i sei titoli.
const LEVELS = [0, 1, 2, 3, 4, 5, 6] as const;
const levelAction = (level: number) => (level === 0 ? "markdown.paragraph" : `markdown.heading.${level}`);
const levelName = (level: number) =>
  level === 0 ? liveStrings.t("live.heading.paragraph") : liveStrings.t("live.heading.level", { level: String(level) });

function decorate(view: EditorView, slash: () => boolean): DecorationSet {
  const state = view.state;
  if (state.readOnly || state.selection.ranges.length > 1 || !state.selection.main.empty) return Decoration.none;
  const line = state.doc.lineAt(state.selection.main.head);
  if (opaque(state, line)) return Decoration.none;
  const out = [];
  const level = lineHeading(state, line);
  if (level > 0) out.push(Decoration.widget({ widget: new HeadingPillWidget(level), side: -1 }).range(line.from));
  const hint = view.hasFocus ? placeholderFor(line.text, slash()) : null;
  if (hint) {
    const text = hint.key === "live.hint.heading"
      ? liveStrings.t("live.hint.heading", { level: String(hint.level) })
      : liveStrings.t(hint.key);
    out.push(Decoration.widget({ widget: new PlaceholderWidget(text), side: 1 }).range(line.to));
  }
  return Decoration.set(out, true);
}

/// La pastiglia del titolo e i segnaposto. `slash` dice se il menu «/» c'è.
export function liveHints(slash: () => boolean = () => false): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      menu: PopoverHandle | null = null;
      readonly life = openLifetime();
      constructor(readonly view: EditorView) { this.decorations = decorate(view, slash); }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.focusChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = decorate(update.view, slash);
        }
      }
      /// Il menu dei livelli, sotto la pastiglia.
      open(button: HTMLElement): void {
        this.menu?.close();
        const view = this.view;
        const list = document.createElement("div");
        list.className = "cm-fub-heading-menu";
        const life = openLifetime();
        const current = lineHeading(view.state, view.state.doc.lineAt(view.state.selection.main.head));
        const handle = createList<number>({
          container: list,
          role: "menu",
          items: LEVELS,
          key: String,
          render: (level, row) => {
            row.textContent = levelName(level);
            row.setAttribute("role", "menuitemradio");
            row.setAttribute("aria-checked", String(level === current));
          },
          onActivate: (level) => {
            popover.close();
            const action = MARKDOWN_ACTIONS.get(levelAction(level));
            if (action && markdownActionState(action, view.state).enabled) action.run(view);
            view.focus();
          },
          focus: "roving",
          lifetime: life,
        });
        handle.setActive(String(current));
        const popover = openPopover({
          anchor: button,
          content: list,
          role: "presentation",
          className: "cm-fub-heading-popover",
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
      decorations: (value) => value.decorations,
      eventHandlers: {
        mousedown(event) {
          // Il clic sulla pastiglia non sposta il cursore e non toglie il fuoco.
          if ((event.target as Element | null)?.closest?.(".cm-fub-heading-pill-button")) event.preventDefault();
        },
        click(event) {
          const button = (event.target as Element | null)?.closest?.<HTMLElement>(".cm-fub-heading-pill-button");
          if (!button) return false;
          event.preventDefault();
          this.open(button);
          return true;
        },
      },
    },
  );
  return [plugin, theme];
}

const theme = EditorView.baseTheme({
  // I colori sono della pelle (`document.css`).
  ".cm-fub-placeholder": { pointerEvents: "none", userSelect: "none", fontStyle: "normal", fontWeight: "400" },
  ".cm-fub-heading-pill": { display: "inline-block", position: "relative", width: "0", height: "1em", verticalAlign: "baseline" },
  ".cm-fub-heading-pill-button": {
    position: "absolute",
    right: "0.6rem",
    bottom: "0",
    fontSize: "0.7rem",
    fontWeight: "500",
    lineHeight: "1.4",
    padding: "0 0.35rem",
    borderRadius: "4px",
    border: "0",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
});
