// La tipografia italiana mentre si scrive (`editor.typography`, spenta di
// serie): `"` diventa « o », e “ ” dentro una citazione già aperta; `--`
// diventa —; `...` diventa …; l'apostrofo diventa ’.
//
// - Scatta soltanto sul tasto che chiude la forma, un carattere battuto dalla
//   tastiera (`inputHandler`): l'incolla, il trascinamento, un testo arrivato
//   in un colpo e la composizione (IME) restano come sono. Nessun lavoro per
//   le altre battute: i quattro caratteri che la fanno scattare si guardano
//   prima di ogni altra cosa.
// - Mai fuori dalla prosa: codice, formule, link e wikilink, HTML e commenti,
//   frontmatter, una riga di soli trattini (il separatore `---`, la riga di
//   una tabella). Una forma ancora aperta sulla riga (un `` ` ``, un `$`, un
//   `[[` senza chiusura) conta già come chiusa: si sta scrivendo lì dentro.
// - Vale nelle note in italiano: la lingua dichiarata dalla nota (`lang:`),
//   altrimenti quella dell'app.
// - Il carattere battuto entra prima da solo, poi la sostituzione in un passo
//   suo della cronologia: un annulla subito dopo toglie la sostituzione e
//   lascia ciò che si era scritto. Backspace subito dopo fa lo stesso.
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { settings } from "../../../../host/query";
import { resolvedLanguage } from "../../../../i18n/strings";
import { inlineDelimiters, spans, wikilink, type SyntaxForm } from "../../../../rules/syntax";
import { onEvent } from "../../../../state/kernel";
import { isStrictlyInsideCode } from "./parser";
import { declaredLanguage, frontmatterRange } from "./render";

/// L'impostazione della macchina che la accende (`crates/fub-host/src/settings.rs`).
export const TYPOGRAPHY_KEY = "editor.typography";

/// I soli caratteri che possono chiudere una forma.
const TRIGGERS = new Set(["\"", "'", "-", "."]);

/// Una sostituzione da fare: `[from, pos)` più il carattere battuto in `pos`
/// diventano `insert`. `original` è ciò che c'era scritto, e che Backspace
/// rimette.
export interface Substitution {
  readonly from: number;
  readonly insert: string;
  readonly original: string;
}

/// L'ultima sostituzione, finché il cursore resta subito dopo e niente
/// cambia: è quella che Backspace disfa.
interface Done {
  readonly from: number;
  readonly to: number;
  readonly original: string;
}

const remember = StateEffect.define<Done | null>();

const lastSubstitution = StateField.define<Done | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(remember)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/// I nodi a blocco che non sono prosa: il cursore in fondo all'ultima riga
/// è ancora dentro.
const LITERAL_BLOCKS = new Set([
  "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock", "LinkReference", "HorizontalRule", "TableDelimiter",
]);
/// I nodi in linea che non sono prosa: subito dopo la chiusura si è fuori.
const LITERAL_INLINE = new Set([
  "InlineCode", "Link", "Image", "URL", "Autolink", "HTMLTag", "Comment", "ProcessingInstruction", "Entity",
]);
/// Le sintassi dichiarate il cui contenuto è prosa (come nel correttore).
const PROSE_INLINE = new Set(["fub:highlight"]);
/// I blocchi di prosa: dentro di loro si contano le virgolette aperte e i
/// `$$` delle formule.
const PROSE_BLOCKS = new Set([
  "Paragraph",
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2",
  "TableCell",
  "Task",
  "FootnoteDefinition",
]);
/// Quanto testo prima del cursore si guarda, al più, per le virgolette.
const LOOKBEHIND = 4000;

/// Dove comincia il blocco di prosa che contiene `pos` (al più `LOOKBEHIND`
/// prima): le virgolette e le formule aperte si contano da lì.
function blockStart(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  for (let node = syntaxTree(state).resolveInner(pos, -1); ; node = node.parent!) {
    if (PROSE_BLOCKS.has(node.name)) return Math.max(node.from, pos - LOOKBEHIND);
    if (!node.parent) break;
  }
  return line.from;
}

/// Una formula in linea aperta e non chiusa nel testo della riga: un `$` che
/// apre ha subito dopo un carattere che non è uno spazio, uno che chiude
/// subito prima (come `INLINE_MATH` del correttore).
function openInlineMath(before: string): boolean {
  let open = false;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== "$") continue;
    if (before[i - 1] === "\\") continue;
    if (before[i + 1] === "$") {
      i += 1;
      continue;
    }
    if (!open) {
      if (i + 1 < before.length && !/\s/.test(before[i + 1]!)) open = true;
    } else if (!/\s/.test(before[i - 1] ?? " ")) {
      open = false;
    }
  }
  return open;
}

/// Il codice in linea aperto e non chiuso: una corsa di backtick che non ha
/// ancora trovato la sua gemella della stessa lunghezza.
function openInlineCode(before: string): boolean {
  let open = 0;
  for (const run of before.match(/`+/g) ?? []) {
    if (open === 0) open = run.length;
    else if (run.length === open) open = 0;
  }
  return open !== 0;
}

/// Ciò che si sta scrivendo sulla riga, prima del cursore, e che non è
/// ancora un nodo dell'albero perché non è chiuso.
function openOnLine(before: string, declared: ReturnType<typeof inlineDelimiters>): boolean {
  if (openInlineCode(before) || openInlineMath(before)) return true;
  if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return true;
  if (/\[\^[^\]\s]*$/.test(before)) return true;
  if (/\]\([^)]*$/.test(before)) return true;
  if (/<\/?[A-Za-z][^<>]*$/.test(before) || /<!-?$/.test(before)) return true;
  if (before.lastIndexOf("<!--") > before.lastIndexOf("-->")) return true;
  if (/(?:https?:\/\/|www\.)\S*$/.test(before)) return true;
  for (const d of declared) {
    if (PROSE_INLINE.has(d.name) || d.open === "" || d.close === "") continue;
    if (d.open === d.close ? before.split(d.open).length % 2 === 0 : before.lastIndexOf(d.open) > before.lastIndexOf(d.close)) {
      return true;
    }
  }
  return false;
}

/// Se in `pos` si scrive prosa: fuori dal frontmatter, dal codice, dalle
/// formule, dai link e da ogni sintassi che non lo è.
export function isProseAt(state: EditorState, pos: number, forms?: readonly SyntaxForm[]): boolean {
  const front = frontmatterRange(state.doc);
  if (front && pos < front.to) return false;
  if (isStrictlyInsideCode(state, pos)) return false;
  for (let node = syntaxTree(state).resolveInner(pos, -1); ; node = node.parent!) {
    if (LITERAL_BLOCKS.has(node.name) && node.from < pos && pos <= node.to) return false;
    if (LITERAL_INLINE.has(node.name) && node.from < pos && pos < node.to) return false;
    if (!node.parent) break;
  }
  const line = state.doc.lineAt(pos);
  const row = line.text;
  const at = pos - line.from;
  const declared = inlineDelimiters(forms);
  if (wikilink(row).some((found) => found.from < at && at < found.to)) return false;
  if (spans(row, declared).some((span) => !PROSE_INLINE.has(span.name) && span.from < at && at < span.to)) return false;
  if (openOnLine(row.slice(0, at), declared)) return false;
  // Una formula a blocco `$$ … $$` dentro il paragrafo, che Lezer non conosce.
  const block = state.sliceDoc(blockStart(state, pos), pos).replace(/\\\$/g, "");
  return (block.match(/\$\$/g)?.length ?? 0) % 2 === 0;
}

/// Se la nota è in italiano: la lingua dichiarata (`lang:`), altrimenti quella
/// dell'app.
export function isItalian(state: EditorState, appLanguage: string): boolean {
  const language = declaredLanguage(state.doc) ?? appLanguage;
  return language.toLowerCase().split(/[-_]/)[0] === "it";
}

/// Le virgolette aperte e non chiuse prima di `pos`, nel blocco: «, “.
function openQuotes(state: EditorState, pos: number): string[] {
  const stack: string[] = [];
  for (const char of state.sliceDoc(blockStart(state, pos), pos)) {
    if (char === "«" || char === "“") stack.push(char);
    else if ((char === "»" || char === "”") && stack[stack.length - 1] === (char === "»" ? "«" : "“")) stack.pop();
  }
  return stack;
}

/// Dopo questi caratteri (o a inizio riga) una virgoletta apre.
const OPENS_AFTER = /[\s([{«“‘—–\-/>]/;
/// I segni di Markdown fra cui una virgoletta può stare: `**"` apre ancora.
const MARKUP = /[*_~=]/;

/// La sostituzione del carattere `typed` battuto in `pos`, se c'è. Non guarda
/// né la lingua né l'impostazione: soltanto il testo e il posto.
export function substitutionFor(
  state: EditorState,
  pos: number,
  typed: string,
  forms?: readonly SyntaxForm[],
): Substitution | null {
  if (!TRIGGERS.has(typed)) return null;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  let result: Substitution | null = null;
  if (typed === "'") {
    result = { from: pos, insert: "’", original: "'" };
  } else if (typed === "\"") {
    let i = before.length;
    while (i > 0 && MARKUP.test(before[i - 1]!)) i -= 1;
    const opening = i === 0 || OPENS_AFTER.test(before[i - 1]!);
    const open = openQuotes(state, pos);
    const top = open[open.length - 1];
    const insert = opening ? (top === "«" ? "“" : "«") : top === "“" ? "”" : "»";
    result = { from: pos, insert, original: "\"" };
  } else if (typed === "-") {
    // Una riga di soli trattini, barre e due punti è un separatore, una
    // riga di tabella o la sottolineatura di un titolo, non un inciso.
    if (before.endsWith("-") && !before.endsWith("--") && !/^[\s|:+>*-]*$/.test(before) && !before.endsWith("<!-")) {
      result = { from: pos - 1, insert: "—", original: "--" };
    }
  } else if (before.endsWith("..") && !before.endsWith("...")) {
    result = { from: pos - 2, insert: "…", original: "..." };
  }
  if (!result || !isProseAt(state, result.from, forms)) return null;
  return result;
}

/// Vim in modo normale: i tasti sono comandi, non testo.
function vimNormal(view: EditorView): boolean {
  const cm = getCM(view);
  if (cm == null) return false;
  return !(cm.state as { vim?: { insertMode?: boolean } }).vim?.insertMode;
}

export interface TypographyOptions {
  /// Se è accesa; di serie la legge dall'impostazione `editor.typography`.
  readonly enabled?: () => boolean;
  /// La lingua dell'app, per le note che non dichiarano la loro.
  readonly appLanguage?: () => string;
  /// Le sintassi dichiarate del documento, per sapere cosa non è prosa.
  readonly forms?: () => readonly SyntaxForm[] | undefined;
}

/// L'impostazione, letta una volta e tenuta aggiornata finché almeno una
/// vista la usa. Il valore resta fra un `setState` e l'altro.
function settingHolder(): { enabled: () => boolean; plugin: Extension } {
  let on = false;
  let users = 0;
  let generation = 0;
  let stop: (() => void) | null = null;
  const read = (): void => {
    const mine = ++generation;
    void Promise.resolve().then(() => settings()).then(
      (entries) => {
        if (mine !== generation || users === 0) return;
        on = entries.find((entry) => entry.spec.key === TYPOGRAPHY_KEY)?.value === true;
      },
      () => {
        // Prima di un vault o con le impostazioni guaste resta com'era.
      },
    );
  };
  const plugin = ViewPlugin.define(() => {
    users += 1;
    if (users === 1) {
      stop = onEvent("setting_changed", (event) => {
        if (event.key === TYPOGRAPHY_KEY) read();
      });
      read();
    }
    return {
      destroy() {
        users -= 1;
        if (users === 0) {
          stop?.();
          stop = null;
          generation += 1;
        }
      },
    };
  });
  return { enabled: () => on, plugin };
}

/// Il carattere battuto, poi la sostituzione in un passo suo: un annulla
/// subito dopo torna al carattere battuto.
function apply(view: EditorView, pos: number, typed: string, sub: Substitution): void {
  view.dispatch({ changes: { from: pos, insert: typed }, selection: { anchor: pos + typed.length }, userEvent: "input.type" });
  const to = pos + typed.length;
  view.dispatch({
    changes: { from: sub.from, to, insert: sub.insert },
    selection: { anchor: sub.from + sub.insert.length },
    effects: remember.of({ from: sub.from, to: sub.from + sub.insert.length, original: sub.original }),
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
    userEvent: "input.type.typography",
  });
}

/// Backspace subito dopo una sostituzione rimette ciò che si era scritto.
function restore(view: EditorView): boolean {
  const done = view.state.field(lastSubstitution, false);
  const { main } = view.state.selection;
  if (!done || view.state.selection.ranges.length > 1 || !main.empty || main.head !== done.to) return false;
  if (view.composing || vimNormal(view)) return false;
  if (view.state.sliceDoc(done.from, done.to) === "") return false;
  view.dispatch({
    changes: { from: done.from, to: done.to, insert: done.original },
    selection: { anchor: done.from + done.original.length },
    effects: remember.of(null),
    scrollIntoView: true,
    userEvent: "delete.backward",
  });
  return true;
}

/// La tipografia italiana, per il profilo Markdown.
export function italianTypography(options: TypographyOptions = {}): Extension {
  const holder = options.enabled ? null : settingHolder();
  const enabled = options.enabled ?? holder!.enabled;
  const appLanguage = options.appLanguage ?? resolvedLanguage;
  const typing = EditorView.inputHandler.of((view, from, to, text) => {
    if (!TRIGGERS.has(text) || from !== to || !enabled()) return false;
    const { state } = view;
    if (state.readOnly || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
    if (view.compositionStarted || view.composing || vimNormal(view)) return false;
    // Un `-` subito dopo un — appena fatto: era un `---`, il separatore.
    const done = state.field(lastSubstitution, false);
    if (text === "-" && done?.original === "--" && done.to === from) {
      view.dispatch({
        changes: { from: done.from, to: done.to, insert: "---" },
        selection: { anchor: done.from + 3 },
        effects: remember.of(null),
        userEvent: "input.type",
      });
      return true;
    }
    if (!isItalian(state, appLanguage())) return false;
    const sub = substitutionFor(state, from, text, options.forms?.());
    if (!sub) return false;
    apply(view, from, text, sub);
    return true;
  });
  return [
    lastSubstitution,
    holder ? holder.plugin : [],
    Prec.highest(typing),
    Prec.highest(keymap.of([{ key: "Backspace", run: restore }])),
  ];
}
