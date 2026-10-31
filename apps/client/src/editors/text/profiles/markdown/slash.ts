// Il menu «/» nel testo, come in AnyType: si scrive «/tit» nella nota e il
// menu dei blocchi e dei comandi si filtra mentre si scrive. Scelta una voce,
// «/tit» sparisce e la voce si esegue; con Esc il menu si chiude e il testo
// resta com'è.
//
// È una sorgente dell'autocompletamento di CodeMirror, come `[[` e `#`
// (`completions.ts`): le voci le dà la shell (`panels/slash-menu.ts`), già
// filtrate, e la superficie dice come eseguirle (`SlashMenuSource.choose`).
// Qui stanno il riconoscimento del contesto, puro sul testo come gli altri, e
// i completamenti che una voce riapre dopo di sé: il tipo di callout e il
// linguaggio di un blocco di codice.
import {
  closeCompletion,
  completionStatus,
  selectedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, StateEffect, StateField, type StateCommand, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type { SlashMenuEntry, SlashSection } from "../../../core/editor-menu";
import { t, type Key } from "../../../../i18n/strings";
import type { ContextMatch } from "./completions";
import { MARKDOWN_ACTIONS, markdownActionState } from "./actions";

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

/// Le voci e il modo di eseguirle: la superficie li dà al profilo.
export interface SlashMenuSource {
  entries(query: string): readonly SlashMenuEntry[];
  /// Esegue la voce: `from..to` è il «/query» da togliere.
  choose(view: EditorView, entry: SlashMenuEntry, from: number, to: number): void;
  /// L'icona di una voce, dal repertorio della shell.
  icon?(name: string): Element | null;
}

const SECTION_KEYS: Readonly<Record<SlashSection, Key>> = {
  recent: "slash_menu.section.recent",
  text: "slash_menu.section.text",
  lists: "slash_menu.section.lists",
  insert: "slash_menu.section.insert",
  vault: "slash_menu.section.vault",
};
const SECTION_RANK: Readonly<Record<SlashSection, number>> = { recent: 0, text: 1, lists: 2, insert: 3, vault: 4 };

/// Il tipo delle voci del «/»: lo legge chi disegna l'icona e chi gestisce Esc.
export const SLASH_TYPE = "fub-slash";

/// Le voci di ogni completamento del «/», per disegnarne l'icona.
const entryOf = new WeakMap<Completion, SlashMenuEntry>();

/// Il «/» che Esc ha lasciato come testo: finché resta lì, il menu non si
/// riapre da sé scrivendo dopo.
const dismissSlash = StateEffect.define<number>();
export const slashDismissed = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(dismissSlash)) return effect.value;
    if (value === null || !tr.docChanged) return value;
    const at = tr.changes.mapPos(value, 1, 1);
    // Il «/» cancellato porta via anche la scelta di lasciarlo.
    return at === null || at < 0 || tr.newDoc.sliceString(at, at + 1) !== "/" ? null : at;
  },
});

/// Il «/» aperto alla posizione `pos`, letto sullo stato: dove comincia, la
/// query, e se il punto è testo letterale.
function slashAt(ctx: Pick<CompletionContext, "state" | "pos">): { from: number; query: string } | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = ctx.state.sliceDoc(line.from, ctx.pos);
  const match = slashContext(before);
  if (!match) return null;
  const from = line.from + match.from;
  const nodes: string[] = [];
  for (let node: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(from, -1); node; node = node.parent) {
    nodes.push(node.name);
  }
  if (cursorIsLiteral({ nodes, lineBefore: before.slice(0, match.from) })) return null;
  return { from, query: match.query };
}

/// La sorgente del «/»: niente a contesto spento, nel letterale, dopo Esc o
/// quando nessuna voce risponde — allora il menu si chiude e il testo resta.
export function slashSource(menu: SlashMenuSource): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const slash = slashAt(ctx);
    if (!slash || ctx.state.field(slashDismissed, false) === slash.from) return null;
    const entries = menu.entries(slash.query);
    if (entries.length === 0) return null;
    const filtering = slash.query !== "";
    const options = entries.map((entry, index): Completion => {
      const option: Completion = {
        label: entry.label,
        ...(entry.hint ? { detail: entry.hint } : {}),
        ...(entry.description ? { info: entry.description } : {}),
        type: SLASH_TYPE,
        // Le sezioni a menu appena aperto; filtrando conta la pertinenza.
        ...(filtering ? {} : { section: { name: t(SECTION_KEYS[entry.section]), rank: SECTION_RANK[entry.section] } }),
        boost: Math.max(-99, 99 - index),
        apply: (view: EditorView, _completion: Completion, from: number, to: number) => menu.choose(view, entry, from, to),
      };
      entryOf.set(option, entry);
      return option;
    });
    return { from: slash.from, to: ctx.pos, options, filter: false };
  };
}

/// L'icona di una voce del «/», nella riga del completamento.
export function slashIcon(menu: SlashMenuSource): { render(completion: Completion): Node | null; position: number } {
  return {
    position: 20,
    render(completion) {
      const entry = entryOf.get(completion);
      if (!entry) return null;
      const box = document.createElement("span");
      box.className = "cm-fub-slash-icon";
      box.setAttribute("aria-hidden", "true");
      const icon = entry.icon ? menu.icon?.(entry.icon) ?? null : null;
      if (icon) box.append(icon);
      return box;
    },
  };
}

/// Esc su un menu «/» aperto: si chiude e il «/query» resta testo, anche
/// scrivendo dopo.
export function dismissSlashMenu(view: EditorView): boolean {
  if (completionStatus(view.state) !== "active" || selectedCompletion(view.state)?.type !== SLASH_TYPE) return false;
  const slash = slashAt({ state: view.state, pos: view.state.selection.main.head });
  if (slash) view.dispatch({ effects: dismissSlash.of(slash.from) });
  closeCompletion(view);
  return true;
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

/// Esegue dal «/» l'azione dell'editor `id`: toglie «/query», applica
/// l'azione nella stessa transazione e, per le voci che chiedono un seguito,
/// riapre il completamento dove serve — le note dopo `[[` e `![[`, i modelli
/// nel recinto `mermaid`, il tipo del callout, il linguaggio del codice.
export function runSlashAction(view: EditorView, id: string, from: number, to: number): boolean {
  const action = MARKDOWN_ACTIONS.get(id);
  const lineStart = view.state.doc.lineAt(from).from;
  const ran = action !== undefined &&
    removeThenRun(view, from, to, (target) =>
      markdownActionState(action, target.state).enabled && action.run(target));
  if (!action) {
    view.dispatch({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent: "input.complete" });
    return false;
  }
  if (!ran) return false;
  if (id === "markdown.callout" || id === "markdown.codeblock") {
    // Il tipo e il linguaggio stanno sulla prima riga del blocco, che comincia
    // dove cominciava la riga del «/».
    const head = view.state.doc.lineAt(lineStart);
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

/// I tipi di callout, come li riconosce la resa.
export const CALLOUT_TYPES = [
  "note", "abstract", "info", "todo", "tip", "success", "question",
  "warning", "failure", "danger", "bug", "example", "quote",
] as const;

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

/// I linguaggi proposti su un recinto di codice appena aperto: i più comuni.
export const CODE_LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "diff", "go", "html", "java", "javascript", "json",
  "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift",
  "toml", "typescript", "xml", "yaml",
] as const;

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
