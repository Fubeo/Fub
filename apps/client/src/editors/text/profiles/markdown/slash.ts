// Il menu «/» nel testo: si scrive «/tit» nella nota e il pannello dei
// blocchi e dei comandi si filtra mentre si scrive. Scelta una voce, «/tit»
// sparisce e la voce si esegue; con Esc il pannello si chiude e il testo resta
// com'è.
//
// Il pannello è della shell (`panels/slash/panel.ts`), disegnato coi pezzi
// del kit; qui stanno il riconoscimento del contesto, puro sul testo, e lo
// stato: uno `StateField` con dove sta il «/» e ciò che si è scritto dopo. Il
// campo dà un tooltip di CodeMirror (`showTooltip`) che posa il pannello sotto
// la riga, o sopra se sotto non c'è posto, e un keymap a precedenza alta passa
// al pannello i tasti mentre è aperto. Restano qui anche i completamenti che
// una voce riapre dopo di sé quando la si esegue senza il suo passo: il tipo
// di riquadro e il linguaggio di un blocco di codice.
import { startCompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  Facet,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { EditorView, keymap, showTooltip, ViewPlugin, type Tooltip, type TooltipView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { SlashChoice, SlashPanel, SlashPanelEvents, SlashPlace } from "../../../core/editor-menu";

/// Ciò che il pannello dice all'editor; il resto glielo aggiunge la superficie.
export type SlashPanelCore = Pick<SlashPanelEvents, "choose" | "dismiss" | "active">;
import type { ContextMatch } from "./completions";
import { loadDiagramTemplates, MARKDOWN_ACTIONS, markdownActionState } from "./actions";
import { CALLOUT_TYPES, CODE_LANGUAGES } from "./kinds";

export { CALLOUT_TYPES, CODE_LANGUAGES };

/// Quanto si scrive dopo il «/» prima che smetta di essere una ricerca.
export const SLASH_QUERY_MAX = 32;

/// I nodi Markdown dentro cui una battuta resta testo: codice, formula, link,
/// URL, HTML, commento e frontmatter.
const LITERAL_NODE = /code|url|link|math|html|comment|frontmatter/i;

/// Il cursore sta dove un carattere è testo letterale: dentro uno di quei
/// nodi, o in un wikilink ancora da chiudere, che un nodo non ce l'ha ancora.
export function cursorIsLiteral(cursor: { readonly nodes: readonly string[]; readonly lineBefore: string }): boolean {
  if (cursor.nodes.some((name) => LITERAL_NODE.test(name))) return true;
  return cursor.lineBefore.lastIndexOf("[[") > cursor.lineBefore.lastIndexOf("]]");
}

/// Il «/» comincia una parola: a inizio riga o dopo uno spazio. Poi al più
/// `SLASH_QUERY_MAX` caratteri, senza un altro «/», senza cominciare con uno
/// spazio e senza due spazi di fila: «/titolo 2» cerca ancora, «e/o», «24/09»
/// e gli URL non aprono niente.
const SLASH = new RegExp(`(?:^|\\s)\\/((?! )(?:[^\\s/]| (?! )){0,${SLASH_QUERY_MAX}})$`, "u");

/// C'è un «/» aperto prima del cursore? `from` è dove sta il «/» nel testo
/// passato, `query` ciò che si è scritto dopo.
export function slashContext(before: string): ContextMatch | null {
  const match = SLASH.exec(before);
  if (!match) return null;
  return { from: before.length - match[1]!.length - 1, query: match[1]! };
}

/// Il pannello e il modo di eseguire una scelta: la superficie li dà al
/// profilo.
export interface SlashMenuSource {
  /// Il «/» può aprire il pannello adesso: acceso, in scrittura, sul
  /// documento del riquadro. Altrimenti resta testo.
  enabled(): boolean;
  /// Un pannello nuovo, per un'apertura; `transform` quando agisce sulla
  /// selezione.
  panel(events: SlashPanelCore, transform: boolean): SlashPanel;
  /// Esegue la scelta: `from..to` è il «/query» da togliere; `transform`
  /// quando agisce sulla selezione, che resta dov'è.
  choose(view: EditorView, choice: SlashChoice, from: number, to: number, transform: boolean): void;
}

/// Il menu della superficie: uno solo per editor.
const slashMenu = Facet.define<SlashMenuSource, SlashMenuSource | null>({ combine: (values) => values[0] ?? null });

/// Un «/» aperto: dove sta, ciò che si è scritto dopo, e il tooltip che lo
/// mostra, lo stesso finché il «/» resta lì.
interface SlashOpen {
  readonly from: number;
  readonly query: string;
  readonly tooltip: Tooltip;
  /// Il «/» su una selezione («Trasforma»): niente «/» nel testo, e la query
  /// la tiene il pannello.
  readonly transform: boolean;
}

interface SlashValue {
  readonly open: SlashOpen | null;
  /// Il «/» che Esc ha lasciato come testo: finché resta lì, il pannello non
  /// si riapre da sé scrivendo dopo.
  readonly dismissed: number | null;
}

/// Apre il pannello sul «/» che sta in `pos` (il «+» della maniglia).
const openSlash = StateEffect.define<number>();
/// Apre «Trasforma» sulla selezione.
const openTransform = StateEffect.define<null>();
/// Chiude il pannello; con `dismiss` il «/query» resta testo anche scrivendo
/// dopo.
const closeSlash = StateEffect.define<{ readonly dismiss: boolean }>();

/// Il «/» aperto alla posizione `pos`, letto sullo stato: dove comincia, la
/// query, e se il punto è testo letterale.
function slashAt(state: EditorState, pos: number): { from: number; query: string } | null {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const match = slashContext(before);
  if (!match) return null;
  const from = line.from + match.from;
  const nodes: string[] = [];
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1); node; node = node.parent) {
    nodes.push(node.name);
  }
  if (cursorIsLiteral({ nodes, lineBefore: before.slice(0, match.from) })) return null;
  return { from, query: match.query };
}

const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/;

/// Il genere di una riga, per i Suggeriti.
function kindOf(text: string): SlashPlace["above"] {
  if (/^#{1,6}\s/.test(text)) return "heading";
  if (/^\s*[-*+]\s+\[.\]/.test(text)) return "task";
  if (LIST_MARK.test(text)) return "list";
  if (/^\s*>/.test(text)) return "quote";
  return "paragraph";
}

/// Dove si scrive il «/» in `from..to`: la riga vuota o col testo, il blocco
/// sopra, l'elenco.
export function slashPlace(state: EditorState, from: number, to: number): SlashPlace {
  const line = state.doc.lineAt(from);
  const rest = (state.sliceDoc(line.from, from) + state.sliceDoc(to, line.to)).replace(LIST_MARK, "").replace(/^\s*>\s?/, "");
  let above: SlashPlace["above"] = null;
  for (let n = line.number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (text.trim() === "") continue;
    above = kindOf(text);
    break;
  }
  return { line: rest.trim() === "" ? "empty" : "after-text", above, inList: LIST_MARK.test(line.text) };
}

function tooltipAt(from: number): Tooltip {
  return { pos: from, above: false, strictSide: false, create: (view) => slashTooltip(view) };
}

/// La selezione che «Trasforma» guarda, finché resta quella.
function transformOf(value: SlashValue, tr: Transaction): SlashValue {
  if (!tr.docChanged && !tr.selection) return value;
  return { open: null, dismissed: value.dismissed };
}

const slashField = StateField.define<SlashValue>({
  create: () => ({ open: null, dismissed: null }),
  update(value, tr) {
    let dismissed = value.dismissed;
    if (dismissed !== null && tr.docChanged) {
      const at = tr.changes.mapPos(dismissed, 1, 1);
      // Il «/» cancellato porta via anche la scelta di lasciarlo.
      dismissed = at === null || at < 0 || tr.newDoc.sliceString(at, at + 1) !== "/" ? null : at;
    }
    let explicit: number | null = null;
    for (const effect of tr.effects) {
      if (effect.is(closeSlash)) {
        if (effect.value.dismiss && value.open && !value.open.transform) dismissed = tr.changes.mapPos(value.open.from, 1);
        return { open: null, dismissed };
      }
      if (effect.is(openSlash)) explicit = effect.value;
      if (effect.is(openTransform)) {
        const main = tr.state.selection.main;
        if (main.empty || !tr.state.facet(slashMenu)?.enabled()) return { open: null, dismissed };
        return { open: { from: main.from, query: "", tooltip: tooltipAt(main.from), transform: true }, dismissed };
      }
    }
    if (value.open?.transform) return transformOf(value, tr);
    const was = value.open;
    if (!was && explicit === null && !tr.isUserEvent("input.type")) return dismissed === value.dismissed ? value : { open: null, dismissed };
    if (!was && explicit === null && !tr.state.facet(slashMenu)?.enabled()) return { open: null, dismissed };
    if (explicit !== null && !tr.state.facet(slashMenu)?.enabled()) return { open: null, dismissed };
    const main = tr.state.selection.main;
    const at = main.empty && tr.state.selection.ranges.length === 1 ? slashAt(tr.state, main.head) : null;
    if (!at || at.from === dismissed || (explicit !== null && at.from !== explicit)) return { open: null, dismissed };
    const mapped = was ? tr.changes.mapPos(was.from, 1) : null;
    if (was && mapped === at.from) {
      return was.query === at.query && mapped === was.from ? value : { open: { ...was, from: at.from, query: at.query }, dismissed };
    }
    // Un «/» nuovo, o lo stesso spostato da una modifica prima: un tooltip
    // nuovo, perché CodeMirror lo riconosce dall'identità.
    if (was && mapped !== at.from && explicit === null && !tr.isUserEvent("input.type")) return { open: null, dismissed };
    return { open: { from: at.from, query: at.query, tooltip: tooltipAt(at.from), transform: false }, dismissed };
  },
  provide: (field) => [
    showTooltip.from(field, (value) => value.open?.tooltip ?? null),
    // Finché il pannello è aperto l'editor dice che ha un elenco che completa,
    // come il completamento di CodeMirror: resta una casella di testo a più
    // righe (`aria-multiline`), che il ruolo combobox non ammette.
    EditorView.contentAttributes.from(field, (value): Record<string, string> =>
      value.open ? { "aria-haspopup": "listbox", "aria-autocomplete": "list" } : {}),
  ],
});

/// Il «/» aperto adesso, o `null`.
export function openSlashMenu(state: EditorState): { from: number; query: string; transform: boolean } | null {
  const open = state.field(slashField, false)?.open;
  return open ? { from: open.from, query: open.query, transform: open.transform } : null;
}

/// I pannelli aperti, per editor: il keymap passa loro i tasti.
const panels = new WeakMap<EditorView, SlashPanel>();

function slashTooltip(view: EditorView): TooltipView {
  const menu = view.state.facet(slashMenu)!;
  // Il passo «Diagramma» mette un modello: che ci sia quando lo si sceglie.
  void loadDiagramTemplates();
  const current = () => view.state.field(slashField, false)?.open ?? null;
  let placed = false;
  const events: SlashPanelCore = {
    choose(choice) {
      const open = current();
      if (!open) return;
      const to = open.transform ? open.from : open.from + 1 + open.query.length;
      view.dispatch({ effects: closeSlash.of({ dismiss: false }) });
      menu.choose(view, choice, open.from, to, open.transform);
      view.focus();
    },
    dismiss() {
      view.dispatch({ effects: closeSlash.of({ dismiss: true }) });
      view.focus();
    },
    active(id) {
      if (id) view.contentDOM.setAttribute("aria-activedescendant", id);
      else view.contentDOM.removeAttribute("aria-activedescendant");
    },
  };
  const panel = menu.panel(events, current()?.transform ?? false);
  let seen = "";
  const refresh = () => {
    const open = current();
    if (!open) return;
    if (open.transform) {
      if (seen === "") panel.update("", slashPlace(view.state, open.from, open.from));
      seen = "transform";
      return;
    }
    const place = slashPlace(view.state, open.from, open.from + 1 + open.query.length);
    const key = `${open.query}\u0000${place.line}\u0000${place.above}\u0000${place.inList}`;
    if (key === seen) return;
    seen = key;
    panel.update(open.query, place);
  };
  return {
    dom: panel.dom,
    offset: { x: -16, y: 8 },
    mount() {
      panels.set(view, panel);
      view.contentDOM.setAttribute("aria-controls", panel.listId);
      refresh();
    },
    update(update) {
      if (update.docChanged || update.selectionSet) refresh();
    },
    positioned() {
      // Qui CodeMirror sta scrivendo la sua misura e non lascia leggere il
      // layout: la posizione del «/» si legge nella misura che segue.
      const open = placed ? null : current();
      placed = true;
      view.requestMeasure({
        key: panel,
        read: () => {
          const caret = open ? view.coordsAtPos(open.from) : null;
          return caret ? caret.left - panel.dom.getBoundingClientRect().left : 0;
        },
        write: (caretX) => panel.placed(panel.dom.classList.contains("cm-tooltip-above"), caretX),
      });
    },
    destroy() {
      if (panels.get(view) === panel) panels.delete(view);
      view.contentDOM.removeAttribute("aria-controls");
      view.contentDOM.removeAttribute("aria-activedescendant");
      panel.close();
    },
  };
}

/// Apre il pannello su un «/» appena scritto in `pos` (il «+» della
/// maniglia, che mette un blocco vuoto e ci scrive il «/»).
/// Il «/» può aprire il pannello in questo editor, adesso.
export function slashAvailable(state: EditorState): boolean {
  return state.facet(slashMenu)?.enabled() ?? false;
}

export function openSlashAt(view: EditorView, pos: number): boolean {
  if (!view.state.facet(slashMenu)?.enabled()) return false;
  view.dispatch({ effects: openSlash.of(pos) });
  return openSlashMenu(view.state) !== null;
}

/// Apre «Trasforma» sulla selezione: il «/» premuto con del testo scelto.
export function openSlashTransform(view: EditorView): boolean {
  if (view.state.selection.main.empty || !view.state.facet(slashMenu)?.enabled()) return false;
  view.dispatch({ effects: openTransform.of(null) });
  return openSlashMenu(view.state) !== null;
}

/// Chiude il pannello quando il «/» se ne va, **prima** che CodeMirror tolga
/// il tooltip: l'uscita parte dal pannello ancora al suo posto, con le righe
/// che stavano entrando. Sta prima del campo, così il suo aggiornamento
/// precede quello dei tooltip.
const closeBeforeRemoval = ViewPlugin.define((view) => ({
  update(update) {
    const was = update.startState.field(slashField, false)?.open ?? null;
    const now = update.state.field(slashField, false)?.open ?? null;
    if (was && was.tooltip !== now?.tooltip) panels.get(view)?.close();
  },
}));

/// Il «/» nel testo: il campo, il tooltip e i tasti del pannello.
export function slashMenuExtension(menu: SlashMenuSource): Extension {
  return [
    slashMenu.of(menu),
    closeBeforeRemoval,
    slashField,
    Prec.highest(keymap.of([{
      any: (view, event) => {
        const panel = panels.get(view);
        if (!panel || !openSlashMenu(view.state) || event.isComposing) return false;
        return panel.key(event);
      },
    }])),
  ];
}

/// Toglie `from..to` ed esegue `command` sul testo che resta, in una sola
/// transazione: un Annulla riporta il «/query» com'era. `false` se il comando
/// non ha fatto niente; il «/query» se ne va comunque.
export function removeThenRun(view: EditorView, from: number, to: number, command: StateCommand): boolean {
  const removal = { changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: "input.complete" };
  const removed = view.state.update(removal);
  let next: Transaction | null = null;
  const ran = command({ state: removed.state, dispatch: (tr) => { next = tr; } });
  const after = next as Transaction | null;
  if (!ran || !after) {
    view.dispatch(removal);
    return false;
  }
  view.dispatch(removal, {
    changes: after.changes,
    ...(after.selection ? { selection: after.selection } : {}),
    effects: after.effects,
    scrollIntoView: true,
    sequential: true,
  });
  return true;
}

/// Le azioni che fanno un blocco: dopo del testo nasce un blocco nuovo sotto,
/// invece di trasformare la riga. Le altre entrano nel testo dov'è il «/».
const BLOCK_ACTIONS = new Set([
  "markdown.paragraph", "markdown.heading.1", "markdown.heading.2", "markdown.heading.3",
  "markdown.heading.4", "markdown.heading.5", "markdown.heading.6", "markdown.list.bullet",
  "markdown.list.ordered", "markdown.list.task", "markdown.quote", "markdown.callout",
  "markdown.details", "markdown.columns", "markdown.table", "markdown.rule", "markdown.codeblock",
  "markdown.mathblock", "markdown.diagram", "markdown.toc", "markdown.linkcard",
]);

/// `command` su una riga nuova sotto quella del cursore: la riga perde gli
/// spazi in coda, e la nuova eredita il rientro dell'elenco o della citazione.
function onNewLineBelow(command: StateCommand): StateCommand {
  return ({ state, dispatch }) => {
    const line = state.doc.lineAt(state.selection.main.head);
    const tail = /\s*$/.exec(line.text)![0].length;
    const split = state.update({
      changes: { from: line.to - tail, to: line.to, insert: state.lineBreak },
      selection: EditorSelection.cursor(line.to - tail + state.lineBreak.length),
    });
    let next: Transaction | null = null;
    if (!command({ state: split.state, dispatch: (tr) => { next = tr; } }) || !next) return false;
    const after = next as Transaction;
    dispatch(state.update({
      changes: split.changes.compose(after.changes),
      ...(after.selection ? { selection: after.selection } : {}),
      effects: after.effects,
      scrollIntoView: true,
      userEvent: "input",
    }));
    return true;
  };
}

/// Esegue dal «/» l'azione dell'editor `id`: toglie «/query», applica
/// l'azione nella stessa transazione e, per le voci eseguite senza il loro
/// passo, riapre il completamento dove serve — le note dopo `[[` e `![[`, i
/// modelli nel recinto `mermaid`, il tipo del riquadro, il linguaggio del
/// codice. `params` sono gli argomenti del passo o del comando rapido;
/// `below` (⇧↵) mette il blocco sotto anche su una riga vuota.
export function runSlashAction(
  view: EditorView,
  id: string,
  from: number,
  to: number,
  params: Readonly<Record<string, unknown>> = {},
  below = false,
): boolean {
  const action = MARKDOWN_ACTIONS.get(id);
  const given = Object.keys(params).length > 0;
  const base = action ? (given ? action.withParams?.(params) ?? null : action.run) : null;
  if (!action || !base) {
    view.dispatch({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: "input.complete" });
    return false;
  }
  const lineStart = view.state.doc.lineAt(from).from;
  const under = BLOCK_ACTIONS.has(id) && (below || slashPlace(view.state, from, to).line === "after-text");
  const command = under ? onNewLineBelow(base) : base;
  const ran = removeThenRun(view, from, to, (target) =>
    markdownActionState(action, target.state).enabled && command(target));
  if (!ran || given) return ran;
  if (id === "markdown.callout" || id === "markdown.codeblock") {
    // Il tipo e il linguaggio stanno sulla prima riga del blocco, che comincia
    // dove cominciava la riga del «/», o sulla riga dopo se è nato sotto.
    const head = under ? view.state.doc.line(view.state.doc.lineAt(lineStart).number + 1) : view.state.doc.lineAt(lineStart);
    const at = id === "markdown.callout"
      ? (() => {
          const open = head.text.indexOf("[!");
          const close = open < 0 ? -1 : head.text.indexOf("]", open);
          return close < 0 ? null : head.from + close;
        })()
      : /^[\s>]*(?:`{3,}|~{3,})/.test(head.text) ? head.to : null;
    if (at === null) return true;
    view.dispatch({ selection: EditorSelection.cursor(at) });
  } else if (id !== "markdown.wikilink" && id !== "markdown.embed" && id !== "markdown.diagram" && id !== "markdown.mention" && id !== "markdown.date") {
    return true;
  }
  startCompletion(view);
  return true;
}

// ── I completamenti che una voce riapre ──────────────────────────────────────

/// Il tipo di un callout che si sta scrivendo: `> [!` e la parola fino al
/// cursore, con la `]` dopo o ancora da scrivere.
export function calloutTypeContext(before: string, after: string): ContextMatch | null {
  const match = /^([\s>]*>\s*\[!)([A-Za-z-]*)$/.exec(before);
  if (!match || !/^[A-Za-z-]*\]?/.test(after)) return null;
  return { from: match[1]!.length, query: match[2]! };
}

/// Dopo un callout appena scritto il tipo è scelto (`note`), ed è il
/// completamento a proporre gli altri. Il cursore poi va nel corpo.
export function calloutTypeSource(): CompletionSource {
  return (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = calloutTypeContext(ctx.state.sliceDoc(line.from, ctx.pos), ctx.state.sliceDoc(ctx.pos, line.to));
    if (!match || (match.query === "" && !ctx.explicit)) return null;
    const from = line.from + match.from;
    const word = /^[A-Za-z-]*/.exec(ctx.state.sliceDoc(ctx.pos, line.to))![0];
    const query = ctx.explicit ? "" : match.query.toLowerCase();
    const options = CALLOUT_TYPES.filter((type) => type.startsWith(query)).map((type): Completion => ({
      label: type,
      type: "keyword",
      apply: (view, _completion, at, to) => {
        const next = view.state.doc.lineAt(at).number < view.state.doc.lines ? view.state.doc.line(view.state.doc.lineAt(at).number + 1) : null;
        const body = next && /^\s*>/.test(next.text) ? next.to - (to - at) + type.length : null;
        view.dispatch({
          changes: { from: at, to, insert: type },
          selection: EditorSelection.cursor(body ?? at + type.length),
          userEvent: "input.complete",
        });
      },
    }));
    if (options.length === 0) return null;
    return { from, to: ctx.pos + word.length, options, filter: false };
  };
}

/// Il linguaggio di un recinto: la riga d'apertura, fino al cursore, e niente
/// dopo.
export function codeLanguageContext(before: string, after: string): ContextMatch | null {
  const match = /^([\s>]*(?:`{3,}|~{3,}))([\w+#.-]*)$/.exec(before);
  if (!match || after.trim() !== "") return null;
  return { from: match[1]!.length, query: match[2]! };
}

/// Il linguaggio si sceglie sulla riga d'apertura di un recinto; scelto, il
/// cursore scende nel corpo.
export function codeLanguageSource(): CompletionSource {
  return (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const match = codeLanguageContext(ctx.state.sliceDoc(line.from, ctx.pos), ctx.state.sliceDoc(ctx.pos, line.to));
    if (!match || (match.query === "" && !ctx.explicit)) return null;
    // Una riga di chiusura non sceglie un linguaggio: serve un recinto aperto
    // che cominci qui.
    let node: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    while (node && node.name !== "FencedCode") node = node.parent;
    if (!node || ctx.state.doc.lineAt(node.from).number !== line.number) return null;
    const query = match.query.toLowerCase();
    const options = CODE_LANGUAGES.filter((language) => language.startsWith(query)).map((language): Completion => ({
      label: language,
      type: "keyword",
      apply: (view, _completion, from, to) => {
        const here = view.state.doc.lineAt(from);
        const below = here.number < view.state.doc.lines ? view.state.doc.line(here.number + 1) : null;
        const shift = language.length - (to - from);
        view.dispatch({
          changes: { from, to, insert: language },
          selection: EditorSelection.cursor(below ? below.from + shift : from + language.length),
          userEvent: "input.complete",
        });
      },
    }));
    if (options.length === 0) return null;
    return { from: line.from + match.from, to: ctx.pos, options, filter: false };
  };
}
