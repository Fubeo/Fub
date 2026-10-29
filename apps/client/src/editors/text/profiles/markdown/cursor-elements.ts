// Gli elementi in riga che contengono ogni cursore: è lo stato che la barra
// dice «premuto». Con la politica `mai` della Live i segni non si vedono, e
// questo è il modo in cui si sa dove sta il cursore: dentro un corsivo in un
// grassetto sono premuti «Grassetto» e «Corsivo».
//
// A cursore vuoto conta l'interno stretto, come le due fermate al bordo: alla
// fine di `**x**`, prima dei segni, si è dentro; dopo i segni, fuori. Una
// selezione conta se tutta dentro lo stesso elemento.
import { type EditorState, type SelectionRange, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { containerMath, isMathContainer } from "./render-inline";

export type CursorElement =
  | "strong"
  | "em"
  | "strike"
  | "sup"
  | "sub"
  | "underline"
  | "code"
  | "link"
  | "highlight"
  | "comment"
  | "wikilink"
  | "embed"
  | "math";

type Span = Pick<SelectionRange, "from" | "to" | "empty">;

/// Il nodo più interno di uno dei tipi dati che contiene `range`.
export function enclosingAt(state: EditorState, range: Span, names: ReadonlySet<string>): SyntaxNode | null {
  const { from, to, empty } = range;
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  for (; node; node = node.parent) {
    if (!names.has(node.name)) continue;
    if (empty ? node.from < from && from < node.to : node.from <= from && to <= node.to) return node;
  }
  if (!empty) return null;
  // A fine nodo `resolveInner(pos, 1)` guarda già oltre: si riprova a sinistra.
  node = syntaxTree(state).resolveInner(from, -1);
  for (; node; node = node.parent) {
    if (names.has(node.name) && node.from < from && from < node.to) return node;
  }
  return null;
}

/// Una coppia di delimitatori sulla riga di `range` lo contiene? Per `==`, `%%`
/// e i wikilink, che l'albero Lezer non conosce.
export function insidePairAt(state: EditorState, range: Span, pattern: RegExp): boolean {
  return pairAt(state, range, pattern) !== null;
}

/// La coppia che contiene `range`, come `insidePairAt`, o `null`.
function pairAt(state: EditorState, range: Span, pattern: RegExp): { from: number; to: number } | null {
  const { from, to } = range;
  const line = state.doc.lineAt(from);
  if (to > line.to) return null;
  const start = from - line.from;
  const end = to - line.from;
  for (const match of line.text.matchAll(pattern)) {
    const at = match.index;
    if (at < start && end < at + match[0].length || (at <= start && end <= at + match[0].length && start !== end)) {
      return { from: line.from + at, to: line.from + at + match[0].length };
    }
  }
  return null;
}

export const HIGHLIGHT_PAIR = /==(?=\S)(?:[^=\n]|=(?!=))*?\S==/g;
export const COMMENT_PAIR = /%%[^\n]*?%%/g;
export const WIKILINK_PAIR = /\[\[[^\]\n]*\]\]/g;
export const EMBED_PAIR = /!\[\[[^\]\n]*\]\]/g;
export const UNDERLINE_PAIR = /<u>(?:(?!<\/u>)[^\n])*?<\/u>/g;

/// I tag che un gesto scrive quando i segni non reggono (`<sup>a b</sup>`):
/// valgono come l'elemento dei segni.
export const HTML_TWIN: Partial<Record<CursorElement, string>> = {
  strong: "strong", em: "em", strike: "del", sup: "sup", sub: "sub", highlight: "mark",
};
const htmlPair = (tag: string): RegExp => new RegExp(`<${tag}>(?:(?!</${tag}>)[^\\n])*?</${tag}>`, "g");

/// Dentro una formula `$…$`, letta sul suo contenitore come fa la Lettura: può
/// cominciare su una riga e chiudere sulla seguente.
export function insideInlineMathAt(state: EditorState, range: Span): boolean {
  const { from, to } = range;
  let container: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1);
  while (container && !isMathContainer(container.name)) container = container.parent;
  if (!container) return false;
  return containerMath(state.sliceDoc(container.from, container.to), container).formulas.some((math) =>
    !math.display && (from === to ? math.from < from && from < math.to : math.from <= from && to <= math.to)
  );
}

const NODES: readonly [CursorElement, ReadonlySet<string>][] = [
  ["strong", new Set(["StrongEmphasis"])],
  ["em", new Set(["Emphasis"])],
  ["strike", new Set(["Strikethrough"])],
  ["sup", new Set(["Superscript"])],
  ["sub", new Set(["Subscript"])],
  ["code", new Set(["InlineCode"])],
  ["link", new Set(["Link"])],
];
const HTML_PAIRS = new Map(Object.entries(HTML_TWIN).map(([name, tag]) => [name as CursorElement, htmlPair(tag)] as const));
const PAIRS: readonly [CursorElement, RegExp][] = [
  ["highlight", HIGHLIGHT_PAIR],
  ["comment", COMMENT_PAIR],
  ["wikilink", WIKILINK_PAIR],
  ["embed", EMBED_PAIR],
  ["underline", UNDERLINE_PAIR],
  ...HTML_PAIRS,
];

/// Un elemento coi suoi segni: `[from, openTo)` apre, `[closeFrom, to)` chiude.
export interface ElementMarks {
  from: number;
  openTo: number;
  closeFrom: number;
  to: number;
}

const MARK_OF: Partial<Record<CursorElement, string>> = {
  strong: "EmphasisMark", em: "EmphasisMark", strike: "StrikethroughMark", sup: "SuperscriptMark", sub: "SubscriptMark",
};
const PAIR_MARKS: Partial<Record<CursorElement, readonly [number, number]>> = { highlight: [2, 2], underline: [3, 4] };
const TWIN_MARKS = (tag: string): readonly [number, number] => [tag.length + 2, tag.length + 3];

/// L'elemento `element` più interno che contiene `range`, coi suoi segni: ciò
/// che un gesto «alla Word» toglie quando il cursore ci sta dentro.
export function elementMarksAt(state: EditorState, range: Span, element: CursorElement): ElementMarks | null {
  const mark = MARK_OF[element];
  const nodes = NODES.find(([name]) => name === element)?.[1];
  let found: ElementMarks | null = null;
  if (mark && nodes) {
    const node = enclosingAt(state, range, nodes);
    const marks = node?.getChildren(mark) ?? [];
    if (node && marks.length >= 2) {
      found = { from: marks[0]!.from, openTo: marks[0]!.to, closeFrom: marks[marks.length - 1]!.from, to: marks[marks.length - 1]!.to };
    }
  }
  const twin = HTML_TWIN[element];
  for (const [name, pattern] of PAIRS) {
    if (name !== element) continue;
    // `==` e `<mark>` sono lo stesso evidenziato, coi loro segni.
    const lengths = pattern !== HTML_PAIRS.get(element) ? PAIR_MARKS[element] : twin ? TWIN_MARKS(twin) : undefined;
    const pair = lengths ? pairAt(state, range, pattern) : null;
    // Fra i segni e i tag vince il più interno.
    if (!pair || !lengths || (found && found.from > pair.from)) continue;
    found = { from: pair.from, openTo: pair.from + lengths[0], closeFrom: pair.to - lengths[1], to: pair.to };
  }
  return found;
}

/// Gli elementi che contengono `range`.
export function elementsAt(state: EditorState, range: Span): ReadonlySet<CursorElement> {
  const found = new Set<CursorElement>();
  for (const [name, nodes] of NODES) if (enclosingAt(state, range, nodes)) found.add(name);
  for (const [name, pattern] of PAIRS) if (insidePairAt(state, range, pattern)) found.add(name);
  if (insideInlineMathAt(state, range)) found.add("math");
  // Per Lezer `[[Nota]]` contiene il link `[Nota]`: un wikilink non è anche un
  // link Markdown.
  if (found.has("wikilink") || found.has("embed")) found.delete("link");
  return found;
}

/// Gli elementi di ogni cursore, nell'ordine delle selezioni. Si rifanno a ogni
/// modifica o spostamento, soltanto per i cursori: costa quanto la barra che
/// li legge.
export const cursorElements = StateField.define<readonly ReadonlySet<CursorElement>[]>({
  create: (state) => state.selection.ranges.map((range) => elementsAt(state, range)),
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    const { state } = transaction;
    return state.selection.ranges.map((range) => elementsAt(state, range));
  },
});

/// Gli elementi del cursore principale: dal campo, se lo stato lo porta.
export function mainElements(state: EditorState): ReadonlySet<CursorElement> {
  const field = state.field(cursorElements, false);
  return field?.[state.selection.mainIndex] ?? elementsAt(state, state.selection.main);
}
