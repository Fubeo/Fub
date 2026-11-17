// Le discussioni dei commenti come le legge chi le mostra: il margine, la
// discussione aperta, il pannello dell'ispettore. Qui niente DOM: il testo di
// un commento letto dal buffer (chi ha scritto, quando, che cosa) e il testo
// che un gesto ci scrive (un commento nuovo, una risposta).
//
// La grammatica è quella di `syntax.ts`; l'intestazione dei messaggi è la
// gemella di `header` in `crates/fub-format-markdown/src/parse/comments.rs`,
// con le forme di `docs/reference/note-conventions.md`.
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { wikilink, type SyntaxForm } from "../../../../../rules/syntax";
import { commentsDeclared, containerMath, isMathContainer, nativeInlines, writtenLink } from "../render-inline";
import { MARK_LEN, type CommentThread } from "./syntax";
import { threadsIn } from "./threads";

/// L'intestazione di un messaggio: `@Autore AAAA-MM-GG HH:MM: testo`.
export interface MessageHeader {
  readonly author: string | null;
  readonly date: string | null;
  readonly text: string;
}

/// `AAAA-MM-GG[ HH:MM]: testo` in testa a `s`: la data (con l'ora) e il testo.
function dated(s: string): { date: string; text: string } | null {
  const shaped = (shape: string) => shape.length <= s.length
    && [...shape].every((want, i) => (want === "9" ? /[0-9]/.test(s[i]!) : want === s[i]));
  if (!shaped("9999-99-99")) return null;
  const end = shaped("9999-99-99 99:99") ? 16 : 10;
  if (s[end] !== ":") return null;
  return { date: s.slice(0, end), text: s.slice(end + 1).trim() };
}

const nonEmpty = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/// Legge l'intestazione di un messaggio, come il provider. Ciò che non ha
/// nessuna delle forme è tutto testo, senza autore né data.
export function messageHeader(body: string): MessageHeader {
  const none = { author: null, date: null, text: body.trim() };
  if (body.startsWith("@")) {
    const after = body.slice(1);
    for (let at = after.indexOf(" "); at >= 0; at = after.indexOf(" ", at + 1)) {
      const found = dated(after.slice(at + 1));
      if (found) return { author: nonEmpty(after.slice(0, at)), date: found.date, text: found.text };
    }
    const colon = after.indexOf(":");
    return colon >= 0 ? { author: nonEmpty(after.slice(0, colon)), date: null, text: after.slice(colon + 1).trim() } : none;
  }
  const found = dated(body);
  return found ? { author: null, date: found.date, text: found.text } : none;
}

/// Un messaggio della discussione: dove sta (`{>>` compreso) e che cosa dice.
export interface DiscussionMessage extends MessageHeader {
  readonly from: number;
  readonly to: number;
}

/// Un commento letto dal buffer.
export interface Discussion {
  readonly thread: CommentThread;
  /// Il testo commentato, su una riga; vuoto per un commento su un punto.
  readonly quote: string;
  readonly messages: readonly DiscussionMessage[];
  /// Sta in una cella di tabella: la `|` dei messaggi si scrive `\|`.
  readonly inCell: boolean;
}

/// Dove si guarda un commento: il primo carattere commentato, o il punto.
export const discussionAnchor = (thread: CommentThread): number => thread.passage?.contentFrom ?? thread.from;

function inTableCell(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "TableCell" || node.name === "TableRow" || node.name === "TableHeader") return true;
  }
  return false;
}

/// La discussione del commento `thread` dello stato `state`.
export function discussionOf(state: EditorState, thread: CommentThread, tree: Tree = syntaxTree(state)): Discussion {
  const doc = state.doc;
  const inCell = inTableCell(tree, thread.from);
  const quote = thread.passage ? oneLine(doc.sliceString(thread.passage.contentFrom, thread.passage.contentTo)) : "";
  const messages = thread.messages.map((range) => {
    let body = doc.sliceString(range.from + MARK_LEN, range.to - MARK_LEN);
    if (inCell) body = body.replace(/\\\|/g, "|");
    return { from: range.from, to: range.to, ...messageHeader(body) };
  });
  return { thread, quote, messages, inCell };
}

/// Le discussioni dei contenitori che toccano `[from, to]`, in ordine.
export function discussionsIn(state: EditorState, from: number, to: number, forms?: readonly SyntaxForm[]): Discussion[] {
  const tree = syntaxTree(state);
  const seen = new Set<number>();
  const out: Discussion[] = [];
  for (const thread of threadsIn(state, from, to, forms)) {
    if (seen.has(thread.from)) continue;
    seen.add(thread.from);
    out.push(discussionOf(state, thread, tree));
  }
  return out;
}

/// Quanto aspettare il parser per leggere tutta la nota (ms): oltre, si legge
/// ciò che l'albero ha già, e il resto al giro dopo.
const FULL_PARSE_MS = 80;

/// Tutte le discussioni della nota, per il pannello: si legge quando lo si
/// chiede, mai a ogni battuta.
export function allDiscussions(state: EditorState, forms?: readonly SyntaxForm[]): Discussion[] {
  if (!commentsDeclared(forms) || !state.doc.toString().includes("{>>")) return [];
  ensureSyntaxTree(state, state.doc.length, FULL_PARSE_MS);
  return discussionsIn(state, 0, state.doc.length, forms);
}

/// La discussione che contiene `pos` (dal primo segno all'ultimo messaggio).
export function discussionAt(state: EditorState, pos: number, forms?: readonly SyntaxForm[]): Discussion | null {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  return discussionsIn(state, at, at, forms).find((each) => each.thread.from <= at && at <= each.thread.to) ?? null;
}

/// Uno spazio al posto di ogni a capo: la citazione sta su una riga.
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

// ── Chi scrive ────────────────────────────────────────────────────────────

/// Come firma il vault (`comments.author`).
export type AuthorMode = "nome" | "iniziali" | "niente";

export function authorMode(value: unknown): AuthorMode {
  return value === "iniziali" || value === "niente" ? value : "nome";
}

/// Un nome che regge l'intestazione: niente due punti (chiuderebbero il nome),
/// niente a capo né segni dei commenti, gli spazi in fila diventano uno.
export function cleanName(name: string): string {
  return name.replace(/[:\r\n]/g, " ").replace(/\{(==|>>)|(==|<<)\}/g, " ").replace(/^@+/, "").replace(/\s+/g, " ").trim();
}

/// Le iniziali di un nome: la prima lettera delle prime due parole. `?` per chi
/// non ha nome.
export function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letter = (word: string) => [...word][0]!.toLocaleUpperCase();
  return words.slice(0, 2).map(letter).join("");
}

/// La firma di un commento nuovo: il nome, le sue iniziali o niente.
export function signature(name: string, mode: AuthorMode): string | null {
  const clean = cleanName(name);
  if (mode === "niente" || clean === "") return null;
  return mode === "iniziali" ? initials(clean) : clean;
}

/// Il nome breve di chi ha scritto, come nella discussione: la prima parola.
export function shortName(author: string | null, unnamed: string): string {
  return author ? author.split(/\s+/)[0]! : unnamed;
}

/// Uno dei quattro colori degli autori, sempre lo stesso per lo stesso nome.
export function authorSlot(author: string | null): number {
  if (!author) return 0;
  let hash = 0;
  for (const char of author) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return (hash % 4) + 1;
}

/// Quando, come si scrive nel file: `AAAA-MM-GG HH:MM`, nell'ora locale.
export function stamp(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
}

/// Il testo di un messaggio, come regge nel file: su una riga, senza la
/// chiusura `<<}` che lo finirebbe prima; in una cella la `|` è `\|`.
export function cleanMessage(text: string, inCell = false): string {
  let clean = oneLine(text).replace(/<<\}/g, "<< }");
  if (inCell) clean = clean.replace(/(^|[^\\])\|/g, "$1\\|").replace(/(^|[^\\])\|/g, "$1\\|");
  return clean;
}

/// Un messaggio come si scrive: `{>>@Autore AAAA-MM-GG HH:MM: testo<<}`, o
/// senza `@Autore` quando non si firma.
export function messageSource(author: string | null, date: string, text: string, inCell = false): string {
  const head = author ? `@${author} ${date}` : date;
  return `{>>${head}: ${cleanMessage(text, inCell)}<<}`;
}

// ── Dove va un commento nuovo ─────────────────────────────────────────────

/// Dove va un commento nuovo sulla selezione.
export type CommentPlace =
  /// Sul passo `[from, to)`: `clipped` se la selezione andava oltre il primo
  /// blocco, e il commento sta nel primo.
  | { readonly kind: "passage"; readonly from: number; readonly to: number; readonly clipped: boolean; readonly inCell: boolean }
  /// Su un punto, in un paragrafo nuovo dopo il blocco che finisce a `at`
  /// (codice, formula, tabella, HTML): lì un commento non sta.
  | { readonly kind: "after"; readonly at: number; readonly block: "code" | "math" | "other" }
  /// Dove c'è già un commento: si apre quello.
  | { readonly kind: "existing"; readonly discussion: Discussion }
  /// Niente da commentare: una riga vuota, la testata.
  | { readonly kind: "none" };

interface Span {
  from: number;
  to: number;
}

/// Il blocco di primo livello che contiene `pos`.
function topBlock(tree: Tree, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = tree.resolveInner(pos, 1);
  while (node?.parent && node.parent.name !== "Document") node = node.parent;
  return node && node.name !== "Document" ? node : null;
}

/// Il contenitore di testo che contiene `pos`: un paragrafo, un titolo, una
/// cella, la voce di un compito.
function containerAt(tree: Tree, pos: number): SyntaxNode | null {
  for (let side = 1; side >= -1; side -= 2) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side as 1 | -1); node; node = node.parent) {
      if (isMathContainer(node.name)) return node;
    }
  }
  return null;
}

/// Il testo di un contenitore senza i segni di blocco in testa (`#`, la
/// casella) e in coda (la riga `===` di un titolo, i `#` di chiusura).
function containerText(doc: Text, container: SyntaxNode): Span {
  let from = container.from;
  let to = container.to;
  for (let child = container.firstChild; child; child = child.nextSibling) {
    if (child.name === "HeaderMark" || child.name === "TaskMarker") {
      if (child.from <= from + 1) from = Math.max(from, child.to);
      else to = Math.min(to, child.from);
    }
  }
  while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from += 1;
  while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to -= 1;
  return { from, to };
}

/// Ciò che dentro un contenitore non si taglia: un inline nativo (enfasi,
/// codice, link), una formula, un wikilink. Un segno del commento cade
/// soltanto nel testo, ai bordi di questi pezzi.
function solidPieces(state: EditorState, container: SyntaxNode): { pieces: Span[]; display: Span[] } {
  const doc = state.doc;
  const text = doc.sliceString(container.from, container.to);
  const formulas = containerMath(text, container).formulas;
  const slice = (a: number, b: number) => doc.sliceString(a, b);
  const natives = nativeInlines(container, container.from, container.to, (link) => writtenLink(slice, link), formulas);
  const pieces: Span[] = [
    ...natives.map((native) => ({ from: native.from, to: native.to })),
    ...formulas.map((formula) => ({ from: formula.from, to: formula.to })),
    ...wikilink(text).map((link) => ({ from: container.from + link.from, to: container.from + link.to })),
  ];
  return { pieces, display: formulas.filter((formula) => formula.display).map((f) => ({ from: f.from, to: f.to })) };
}

/// Allarga `span` finché nessun suo bordo cade dentro un pezzo intero.
function widen(span: Span, pieces: readonly Span[]): Span {
  const out = { ...span };
  for (let round = 0; round < 8; round += 1) {
    let changed = false;
    for (const piece of pieces) {
      const cutsStart = piece.from < out.from && out.from < piece.to;
      const cutsEnd = piece.from < out.to && out.to < piece.to;
      if (cutsStart || cutsEnd) {
        out.from = Math.min(out.from, piece.from);
        out.to = Math.max(out.to, piece.to);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

const CODE_BLOCKS: Readonly<Record<string, "code" | "other">> = {
  FencedCode: "code", CodeBlock: "code", HTMLBlock: "other", CommentBlock: "other", Table: "other",
};

/// Dove va un commento nuovo sulla selezione principale. Il passo resta nel
/// primo blocco della selezione e non taglia un inline a metà (si allarga a
/// prenderlo intero); in un blocco di codice, in una formula da sola o in una
/// tabella fuori dalle celle il commento va su un punto, dopo il blocco.
/// Senza selezione si commenta il testo del blocco del cursore.
export function placeComment(state: EditorState, forms?: readonly SyntaxForm[]): CommentPlace {
  if (!commentsDeclared(forms)) return { kind: "none" };
  const doc = state.doc;
  const selection = state.selection.main;
  const tree = ensureSyntaxTree(state, Math.min(doc.length, selection.to + 1), FULL_PARSE_MS) ?? syntaxTree(state);
  const existing = discussionsIn(state, selection.from, selection.to, forms)
    .find((each) => each.thread.from < Math.max(selection.to, selection.from + 1) && selection.from <= each.thread.to);
  if (existing) return { kind: "existing", discussion: existing };
  const container = containerAt(tree, selection.from);
  if (!container) {
    const block = topBlock(tree, selection.from);
    if (!block || block.name === "FrontMatter" || block.name === "Frontmatter") return { kind: "none" };
    const end = doc.lineAt(Math.max(block.from, block.to - (doc.sliceString(block.to - 1, block.to) === "\n" ? 1 : 0))).to;
    const fence = block.name === "FencedCode" ? doc.lineAt(block.from).text.trim().replace(/^[`~]+/, "").trim().split(/\s/)[0] : "";
    const kind = fence === "math" || fence === "latex" ? "math" : CODE_BLOCKS[block.name] ?? "other";
    return { kind: "after", at: end, block: kind };
  }
  const own = containerText(doc, container);
  if (own.from >= own.to) return { kind: "none" };
  const { pieces, display } = solidPieces(state, container);
  let span: Span = selection.empty ? own : { from: Math.max(selection.from, own.from), to: Math.min(selection.to, own.to) };
  const clipped = !selection.empty && selection.to > own.to;
  while (span.from < span.to && /\s/.test(doc.sliceString(span.from, span.from + 1))) span.from += 1;
  while (span.to > span.from && /\s/.test(doc.sliceString(span.to - 1, span.to))) span.to -= 1;
  if (span.from >= span.to) span = own;
  span = widen(span, pieces);
  // Una formula da sola nel paragrafo è un blocco: il commento va dopo.
  if (display.some((formula) => formula.from <= span.from && span.to <= formula.to && formula.from === own.from && formula.to === own.to)) {
    return { kind: "after", at: doc.lineAt(own.to).to, block: "math" };
  }
  return { kind: "passage", from: span.from, to: span.to, clipped, inCell: container.name === "TableCell" };
}

/// Le modifiche che scrivono il commento nuovo `message` (già intero, coi due
/// segni) al posto `place`, e il punto da cui la discussione si guarda dopo.
export function newCommentChanges(
  doc: Text,
  place: Extract<CommentPlace, { kind: "passage" | "after" }>,
  message: string,
): { changes: { from: number; to?: number; insert: string }[]; anchor: number } {
  if (place.kind === "passage") {
    return {
      changes: [{ from: place.from, insert: "{==" }, { from: place.to, insert: `==}${message}` }],
      anchor: place.from + MARK_LEN,
    };
  }
  const nextLine = place.at < doc.length ? doc.lineAt(place.at + 1) : null;
  const tail = nextLine && nextLine.text.trim() !== "" ? "\n" : "";
  return { changes: [{ from: place.at, insert: `\n\n${message}${tail}` }], anchor: place.at + 2 };
}

/// Il commento nuovo si legge davvero come commento nello stato `after`?
/// La rete di sicurezza di `placeComment`: un passo che il parser non vede
/// come commento non si scrive.
export function readsAsComment(after: EditorState, anchor: number, forms?: readonly SyntaxForm[]): boolean {
  ensureSyntaxTree(after, Math.min(after.doc.length, anchor + 1), FULL_PARSE_MS);
  const found = discussionAt(after, anchor, forms);
  return found !== null && discussionAnchor(found.thread) === anchor && found.messages.length === 1;
}
