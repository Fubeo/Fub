// Il blocco di codice della Live (C1–C3): la riga ```lingua diventa una
// testata con la lingua, «A capo» e «Copia», e la riga di chiusura si chiude.
// I recinti si vedono in Sorgente; in Live con `elemento` col cursore sulle
// loro righe, con `riga` sempre, come prima. Con `mai` il cursore non si posa
// sui recinti: ↑ dalla prima riga e ↓ dall'ultima escono dal blocco, e
// Backspace in un blocco vuoto lo toglie. «A capo» è della superficie: non
// scrive nel file, e due riquadri possono sceglierlo diversamente.
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection, EditorState, type Extension, type Line, Prec, type Range, StateEffect, StateField, type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { errorText } from "../../../../host/errors";
import { createList, openPopover, type PopoverHandle, textField } from "../../../../kit";
import { writeClipboardText } from "../../../../platform/clipboard";
import { notify } from "../../../../ui/notify";
import { openLifetime } from "../../../../ui/lifetime";
import { liveReveal } from "../../live-reveal";
import { CODE_LANGUAGES } from "./slash";
import { liveStrings } from "./strings";

/// I nomi delle lingue come si leggono; le altre col loro id.
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  bash: "Bash", c: "C", cpp: "C++", csharp: "C#", css: "CSS", diff: "Diff", go: "Go", html: "HTML", java: "Java",
  javascript: "JavaScript", js: "JavaScript", json: "JSON", kotlin: "Kotlin", latex: "LaTeX", markdown: "Markdown",
  md: "Markdown", mermaid: "Mermaid", php: "PHP", python: "Python", py: "Python", ruby: "Ruby", rust: "Rust", rs: "Rust",
  sql: "SQL", swift: "Swift", toml: "TOML", typescript: "TypeScript", ts: "TypeScript", xml: "XML", yaml: "YAML",
  yml: "YAML", sh: "Bash", shell: "Bash",
};

/// Il nome di una info string: la sua prima parola, o «Testo» se non c'è.
export function languageName(info: string): string {
  const word = info.trim().split(/\s+/)[0] ?? "";
  if (!word) return liveStrings.t("live.code.plain");
  return LANGUAGE_NAMES[word.toLowerCase()] ?? word;
}

/// Un recinto di codice: la riga d'apertura, quella di chiusura se c'è, e il
/// corpo fra le due.
export interface CodeFence {
  readonly from: number;
  readonly to: number;
  readonly open: Line;
  readonly close: Line | null;
  /// Il segno d'apertura (```` ``` ```` o `~~~`) e l'info string.
  readonly mark: { from: number; to: number };
  readonly info: { from: number; to: number } | null;
  /// Il corpo, senza i recinti; `null` se non ha righe.
  readonly body: { from: number; to: number } | null;
}

function fenceOf(state: EditorState, node: SyntaxNode): CodeFence | null {
  const marks = node.getChildren("CodeMark");
  const opener = marks[0];
  if (!opener) return null;
  const doc = state.doc;
  const open = doc.lineAt(opener.from);
  const last = marks.length > 1 ? marks[marks.length - 1]! : null;
  const close = last && doc.lineAt(last.from).number !== open.number ? doc.lineAt(last.from) : null;
  const info = node.getChild("CodeInfo");
  const firstBody = open.number + 1;
  const lastBody = close ? close.number - 1 : doc.lineAt(node.to).number;
  const body = firstBody <= lastBody && firstBody <= doc.lines
    ? { from: doc.line(firstBody).from, to: doc.line(lastBody).to }
    : null;
  return {
    from: node.from, to: node.to, open, close, mark: { from: opener.from, to: opener.to },
    info: info ? { from: info.from, to: info.to } : null, body,
  };
}

/// Il recinto che contiene `pos`, o `null`.
export function codeFenceAt(state: EditorState, pos: number): CodeFence | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "FencedCode") return fenceOf(state, node);
  }
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === "FencedCode") return fenceOf(state, node);
  }
  return null;
}

/// Il testo del corpo, senza i recinti: ciò che «Copia» mette negli appunti.
export function codeBodyText(state: EditorState, fence: CodeFence): string {
  return fence.body ? state.sliceDoc(fence.body.from, fence.body.to) : "";
}

/// La lingua nuova: si riscrivono soltanto i byte dell'info string.
export function setLanguage(fence: CodeFence, language: string): TransactionSpec {
  const range = fence.info ?? { from: fence.mark.to, to: fence.mark.to };
  return { changes: { from: range.from, to: range.to, insert: language }, userEvent: "input" };
}

// ── «A capo», della superficie ───────────────────────────────────────────────

const toggleWrap = StateEffect.define<number>();

/// Gli inizi dei blocchi che non vanno a capo, portati attraverso le modifiche.
const unwrapped = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged ? value.map((pos) => tr.changes.mapPos(pos, 1)) : value;
    for (const effect of tr.effects) {
      if (!effect.is(toggleWrap)) continue;
      next = next.includes(effect.value) ? next.filter((pos) => pos !== effect.value) : [...next, effect.value];
    }
    return next;
  },
});

/// Il blocco che comincia a `from` va a capo.
export function codeWraps(state: EditorState, from: number): boolean {
  return !(state.field(unwrapped, false) ?? []).includes(from);
}

/// L'aggiornamento ha cambiato «A capo» di qualche blocco.
export function codeWrapChanged(update: ViewUpdate): boolean {
  return update.startState.field(unwrapped, false) !== update.state.field(unwrapped, false);
}

const noWrapLine = Decoration.line({ class: "cm-fub-code-nowrap" });

function wrapDecorations(view: EditorView): DecorationSet {
  const off = view.state.field(unwrapped, false) ?? [];
  if (!off.length) return Decoration.none;
  const out: Range<Decoration>[] = [];
  for (const start of off) {
    const fence = codeFenceAt(view.state, start);
    if (!fence?.body) continue;
    const doc = view.state.doc;
    for (let n = doc.lineAt(fence.body.from).number; n <= doc.lineAt(fence.body.to).number; n++) out.push(noWrapLine.range(doc.line(n).from));
  }
  return Decoration.set(out, true);
}

// ── La testata ───────────────────────────────────────────────────────────────

export class CodeHeaderWidget extends WidgetType {
  constructor(readonly info: string, readonly wraps: boolean) { super(); }
  eq(other: CodeHeaderWidget): boolean { return other.info === this.info && other.wraps === this.wraps; }
  toDOM(): HTMLElement {
    const header = document.createElement("span");
    header.className = "cm-fub-code-header";
    const language = document.createElement("button");
    language.type = "button";
    language.className = "cm-fub-code-lang";
    language.setAttribute("aria-haspopup", "listbox");
    language.setAttribute("aria-label", liveStrings.t("live.code.language", { language: languageName(this.info) }));
    language.textContent = `${languageName(this.info)} ▾`;
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className = "cm-fub-code-wrap";
    wrap.textContent = liveStrings.t("live.code.wrap");
    wrap.setAttribute("aria-pressed", String(this.wraps));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-fub-code-copy";
    copy.textContent = liveStrings.t("live.code.copy");
    header.append(language, wrap, copy);
    return header;
  }
  // I clic arrivano ai gestori del plugin; i tasti restano ai pulsanti, che
  // con Invio e Spazio fanno il loro clic.
  ignoreEvent(event: Event): boolean { return event instanceof KeyboardEvent; }
}

// ── Il cursore e i recinti, con `mai` ────────────────────────────────────────

const quiet = (state: EditorState): boolean => state.facet(liveReveal) !== "mai" || state.readOnly;

/// Il cursore che cade su un recinto nascosto va nel corpo: dalla testata
/// all'inizio della prima riga, dalla chiusura alla fine dell'ultima.
/// Chi scrive il recinto (```` ```js ````) resta dove scrive: si sposta soltanto
/// un cursore mosso, non uno portato da una modifica.
const offFences = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || quiet(tr.state)) return tr;
  const selection = tr.selection;
  if (selection.ranges.length > 1 || !selection.main.empty) return tr;
  const head = selection.main.head;
  const state = tr.state;
  const line = state.doc.lineAt(head);
  const fence = codeFenceAt(state, head);
  if (!fence) return tr;
  let target: number | null = null;
  if (line.number === fence.open.number) target = fence.body ? fence.body.from : null;
  else if (fence.close && line.number === fence.close.number) target = fence.body ? fence.body.to : null;
  if (target === null || target === head) return tr;
  return [tr, { selection: EditorSelection.cursor(target), sequential: true }];
});

/// ↑ dalla prima riga del corpo e ↓ dall'ultima escono dal blocco.
function leave(direction: -1 | 1) {
  return (view: EditorView): boolean => {
    const state = view.state;
    if (quiet(state) || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
    const head = state.selection.main.head;
    const fence = codeFenceAt(state, head);
    if (!fence?.body) return false;
    const line = state.doc.lineAt(head);
    const edge = direction === -1 ? state.doc.lineAt(fence.body.from) : state.doc.lineAt(fence.body.to);
    if (line.number !== edge.number) return false;
    const beyond = direction === -1 ? fence.open.number - 1 : (fence.close ?? edge).number + 1;
    if (beyond < 1 || beyond > state.doc.lines) return false;
    const target = state.doc.line(beyond);
    const column = head - line.from;
    view.dispatch({ selection: { anchor: target.from + Math.min(column, target.length) }, scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

/// Backspace in un blocco senza testo lo toglie tutto, recinti compresi.
export function removeEmptyBlock(state: EditorState): TransactionSpec | null {
  if (quiet(state) || state.selection.ranges.length > 1 || !state.selection.main.empty) return null;
  const head = state.selection.main.head;
  const fence = codeFenceAt(state, head);
  if (!fence || (fence.body && state.sliceDoc(fence.body.from, fence.body.to).trim() !== "")) return null;
  const to = (fence.close ?? fence.open).to;
  return {
    changes: { from: fence.open.from, to },
    selection: { anchor: fence.open.from },
    userEvent: "delete.backward",
    scrollIntoView: true,
  };
}

// ── I gesti della testata ────────────────────────────────────────────────────

function header(event: Event): { el: HTMLElement; part: "lang" | "wrap" | "copy" } | null {
  const target = event.target instanceof Element ? event.target : null;
  const el = target?.closest<HTMLElement>(".cm-fub-code-lang, .cm-fub-code-wrap, .cm-fub-code-copy");
  if (!el) return null;
  const part = el.classList.contains("cm-fub-code-lang") ? "lang" : el.classList.contains("cm-fub-code-wrap") ? "wrap" : "copy";
  return { el, part };
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    menu: PopoverHandle | null = null;
    readonly life = openLifetime();
    constructor(readonly view: EditorView) { this.decorations = wrapDecorations(view); }
    update(update: ViewUpdate): void {
      if (update.docChanged || codeWrapChanged(update)) {
        this.decorations = wrapDecorations(update.view);
      }
    }
    fence(el: HTMLElement): CodeFence | null {
      const at = this.view.posAtDOM(el);
      return codeFenceAt(this.view.state, at);
    }
    /// L'elenco delle lingue, con il filtro.
    languages(button: HTMLElement): void {
      this.menu?.close();
      const view = this.view;
      const start = this.fence(button)?.from;
      if (start === undefined) return;
      const life = openLifetime();
      const content = document.createElement("div");
      content.className = "cm-fub-code-languages";
      const rows = document.createElement("div");
      rows.setAttribute("aria-label", liveStrings.t("live.code.languages"));
      const all: readonly string[] = [...CODE_LANGUAGES];
      const choose = (language: string) => {
        popover.close();
        const fence = codeFenceAt(view.state, start);
        if (fence) view.dispatch(setLanguage(fence, language));
        view.focus();
      };
      const opened = codeFenceAt(view.state, start);
      const current = opened?.info ? view.state.sliceDoc(opened.info.from, opened.info.to).trim().split(/\s+/)[0] ?? "" : "";
      const field = textField({
        label: liveStrings.t("live.code.filter"),
        labelHidden: true,
        placeholder: liveStrings.t("live.code.filter"),
        onInput: (value) => {
          const query = value.trim().toLowerCase();
          list.setItems(all.filter((language) => language.includes(query) || languageName(language).toLowerCase().includes(query)));
        },
        onSubmit: () => {
          const active = list.active();
          if (active) choose(active);
        },
        lifetime: life,
      });
      const list = createList<string>({
        container: rows,
        role: "listbox",
        items: all,
        key: (language) => language,
        render: (language, row) => { row.textContent = languageName(language); },
        onActivate: (language) => choose(language),
        selected: (language) => language === current,
        owner: field.input,
        lifetime: life,
      });
      if (all.includes(current)) list.setActive(current);
      content.append(field.element, rows);
      const popover = openPopover({
        anchor: button,
        content,
        label: liveStrings.t("live.code.languages"),
        className: "cm-fub-code-popover",
        lifetime: this.life,
        onClose: () => {
          life.close();
          if (this.menu === popover) this.menu = null;
          button.setAttribute("aria-expanded", "false");
        },
      });
      button.setAttribute("aria-expanded", "true");
      this.menu = popover;
      field.input.focus();
    }
    copy(button: HTMLElement): void {
      const fence = this.fence(button);
      if (!fence) return;
      const text = codeBodyText(this.view.state, fence);
      void writeClipboardText(text).then(
        () => { if (!this.life.closed) notify(liveStrings.t("live.code.copied")); },
        (error: unknown) => { if (!this.life.closed) notify(liveStrings.t("live.code.copy_failed", { reason: errorText(error) }), "guasto"); },
      );
    }
    destroy(): void { this.life.close(); }
  },
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      mousedown(event) {
        if (header(event)) event.preventDefault();
      },
      click(event) {
        const hit = header(event);
        if (!hit) return false;
        event.preventDefault();
        if (hit.part === "lang") this.languages(hit.el);
        else if (hit.part === "copy") this.copy(hit.el);
        else {
          const fence = this.fence(hit.el);
          if (fence) this.view.dispatch({ effects: toggleWrap.of(fence.from) });
        }
        return true;
      },
    },
  },
);

const theme = EditorView.baseTheme({
  // I colori sono della pelle (`document.css`).
  ".cm-fub-code-header": { display: "inline-flex", width: "100%", gap: "0.4em", alignItems: "center", userSelect: "none" },
  ".cm-fub-code-header button": {
    border: "0", background: "none", padding: "0.1em 0.45em", borderRadius: "4px", cursor: "pointer",
    fontSize: "0.75rem", lineHeight: "1.6",
  },
  ".cm-fub-code-lang": { marginRight: "auto" },
  ".cm-fub-fence-close-line": { fontSize: "0", lineHeight: "0" },
  ".cm-fub-code-nowrap": { whiteSpace: "pre", overflowX: "auto" },
  // Il disegno sotto il diagramma che si scrive (C5): la resa nuova si prova
  // fuori vista e prende il posto della vecchia quando è pronta.
  ".cm-fub-diagram-live": { position: "relative" },
  ".cm-fub-diagram-trying": { position: "absolute", insetInline: "0", top: "0", visibility: "hidden", pointerEvents: "none" },
  ".cm-fub-diagram-notice": { margin: "0.25rem 0 0", fontSize: "0.8rem" },
});

/// Il blocco di codice della Live: testata, recinti chiusi, «A capo».
export function codeBlocks(): Extension {
  return [
    unwrapped, plugin, theme, offFences,
    Prec.high(keymap.of([
      { key: "ArrowUp", run: leave(-1) },
      { key: "ArrowDown", run: leave(1) },
      {
        key: "Backspace",
        run: (view) => {
          const spec = removeEmptyBlock(view.state);
          if (!spec) return false;
          view.dispatch(spec);
          return true;
        },
      },
    ])),
  ];
}
