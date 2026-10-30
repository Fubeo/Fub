// «Trasforma in» (H6): un blocco cambia specie e tiene il suo contenuto. Si
// riscrivono soltanto i prefissi — `#`, il segno della voce, la casella, i
// `>`, la testata del callout, i recinti, il `<details>` — e le righe dei
// figli si spostano con il rientro nuovo. `Mod-Alt-0…8` fanno lo stesso da
// tastiera, in Live e in Blocchi, come in Notion.
import { type ChangeSpec, type EditorState, EditorSelection, type StateCommand } from "@codemirror/state";
import { type KeyBinding } from "@codemirror/view";
import { backtickFence } from "../actions";
import { calloutHead } from "../callout-head";
import { blockGesture } from "../block-gesture";
import { blockModel, buildBlocks, subtreeEnd, type Block, type BlockKind } from "./model";

export type TransformTarget =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "callout"
  | "code"
  | "details";

/// Le specie che si sanno smontare: le altre (tabelle, righe, HTML, formule,
/// frontmatter) non si trasformano.
const TRANSFORMABLE: ReadonlySet<BlockKind> = new Set([
  "paragraph", "heading", "bullet", "ordered", "task", "quote", "callout", "code", "details",
]);

export function canTransform(block: Block): boolean {
  return TRANSFORMABLE.has(block.kind);
}

/// La specie del blocco detta come bersaglio: quella che non cambierebbe niente.
export function targetOf(block: Block): TransformTarget | null {
  if (block.kind === "heading") return `heading${Math.min(6, Math.max(1, block.level))}` as TransformTarget;
  return TRANSFORMABLE.has(block.kind) ? (block.kind as TransformTarget) : null;
}

/// Il blocco smontato: il rientro della prima riga, le righe del contenuto
/// senza prefissi e le righe dei figli tolte dal rientro del contenuto.
export interface Unwrapped {
  readonly indent: string;
  readonly own: string[];
  readonly children: string[];
  /// Dove comincia il contenuto nella prima riga, in colonne.
  readonly column: number;
}

const LIST_HEAD = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\][ \t]+)?/;
const ATX = /^(\s*)#{1,6}(?:[ \t]+|$)/;
const ATX_CLOSE = /[ \t]+#+[ \t]*$/;
const SETEXT = /^\s*(=+|-+)\s*$/;
const QUOTE = /^(\s*)>[ \t]?/;
const FENCE = /^(\s*)(`{3,}|~{3,})/;
const SUMMARY = /^\s*<summary>(.*?)<\/summary>\s*$/i;

/// Toglie fino a `width` colonne di spazio da `line`.
function dedent(line: string, width: number): string {
  let at = 0;
  while (at < width && (line[at] === " " || line[at] === "\t")) at++;
  return line.slice(at);
}

/// Il blocco `index` smontato, o `null` se la sua specie non si trasforma.
export function unwrap(state: EditorState, blocks: readonly Block[], index: number): Unwrapped | null {
  const block = blocks[index]!;
  if (!canTransform(block)) return null;
  const doc = state.doc;
  const end = subtreeEnd(blocks, index);
  // Le righe proprie finiscono dove comincia il primo figlio.
  const childFrom = end > index + 1 ? blocks[index + 1]!.from : -1;
  const ownTo = childFrom === -1 ? block.to : Math.max(block.from, childFrom - 1);
  const lines = doc.sliceString(block.from, ownTo).split("\n");
  const childLines = childFrom === -1 ? [] : doc.sliceString(childFrom, block.to).split("\n");
  const first = lines[0] ?? "";
  const indent = /^\s*/.exec(first)![0];
  switch (block.kind) {
    case "paragraph":
      return { indent, own: lines.map((line) => dedent(line, indent.length)), children: [], column: indent.length };
    case "heading": {
      if (lines.length > 1 && SETEXT.test(lines[lines.length - 1]!)) {
        return { indent, own: lines.slice(0, -1).map((line) => dedent(line, indent.length)), children: [], column: indent.length };
      }
      const head = ATX.exec(first)!;
      return { indent, own: [first.slice(head[0].length).replace(ATX_CLOSE, "")], children: [], column: head[0].length };
    }
    case "bullet":
    case "ordered":
    case "task": {
      const head = LIST_HEAD.exec(first);
      if (!head) return null;
      const width = head[1]!.length + head[2]!.length + Math.max(1, head[3]!.length);
      const column = head[0].length;
      const own = [first.slice(column), ...lines.slice(1).map((line) => dedent(line, width))];
      return { indent, own, children: childLines.map((line) => dedent(line, width)), column };
    }
    case "quote":
    case "callout": {
      const own = lines.map((line) => line.replace(QUOTE, ""));
      if (block.kind === "callout") {
        const head = calloutHead(first);
        const title = head ? first.slice(head.title.from, head.title.to) : "";
        own.shift();
        if (title !== "") own.unshift(title);
      }
      const column = (QUOTE.exec(first)?.[0].length ?? indent.length);
      return { indent, own: own.length > 0 ? own : [""], children: [], column };
    }
    case "code": {
      const fence = FENCE.exec(first);
      if (!fence) return { indent, own: lines.map((line) => dedent(line, 4)), children: [], column: 4 };
      const closed = lines.length > 1 && FENCE.test(lines[lines.length - 1]!) && lines[lines.length - 1]!.trim().startsWith(fence[2]!.slice(0, 3));
      const body = lines.slice(1, closed ? -1 : undefined).map((line) => dedent(line, indent.length));
      return { indent, own: body.length > 0 ? body : [""], children: [], column: 0 };
    }
    case "details": {
      const inner = doc.sliceString(block.from, block.to).split("\n");
      // Via la riga d'apertura e quella di chiusura; il sommario è la prima.
      inner.shift();
      inner.pop();
      let summary: string | null = null;
      const head = inner[0] !== undefined ? SUMMARY.exec(inner[0]) : null;
      if (head) { summary = head[1]!; inner.shift(); }
      while (inner.length > 0 && inner[0]!.trim() === "") inner.shift();
      while (inner.length > 0 && inner[inner.length - 1]!.trim() === "") inner.pop();
      const own = summary === null ? (inner.length > 0 ? [inner.shift()!] : [""]) : [summary];
      // Il contenuto del ripiegabile resta in blocchi suoi: diventa i figli.
      return { indent, own, children: inner, column: 0 };
    }
    default:
      return null;
  }
}

/// Le righe del blocco rimontato come `target`. `number` è il numero di una
/// voce numerata. Ridà anche la colonna dove comincia il contenuto.
export function rewrap(target: TransformTarget, parts: Unwrapped, number = 1): { text: string; column: number } {
  const { indent } = parts;
  const own = parts.own.length > 0 ? parts.own : [""];
  const line = (text: string) => (text === "" ? "" : indent + text);
  const nest = (prefix: string, lines: readonly string[]) => lines.map((text) => (text === "" ? "" : indent + prefix + text));
  switch (target) {
    case "paragraph":
      return { text: [...own.map(line), ...(parts.children.length > 0 ? ["", ...parts.children.map(line)] : [])].join("\n"), column: indent.length };
    case "heading1":
    case "heading2":
    case "heading3":
    case "heading4":
    case "heading5":
    case "heading6": {
      // Un titolo sta su una riga: le righe del contenuto si uniscono con
      // uno spazio, i figli restano blocchi sotto.
      const marks = "#".repeat(Number(target.slice(-1))) + " ";
      const title = own.map((text) => text.trim()).filter((text) => text !== "").join(" ");
      const rest = parts.children.length > 0 ? ["", ...parts.children] : [];
      return { text: [indent + marks + title, ...rest.map(line)].join("\n"), column: indent.length + marks.length };
    }
    case "bullet":
    case "ordered":
    case "task": {
      const marker = target === "bullet" ? "- " : target === "task" ? "- [ ] " : `${number}. `;
      const hang = " ".repeat(target === "ordered" ? marker.length : 2);
      return {
        text: [indent + marker + own[0]!, ...nest(hang, own.slice(1)), ...nest(hang, parts.children)].join("\n"),
        column: indent.length + marker.length,
      };
    }
    case "quote":
    case "callout": {
      const body = [...own, ...(parts.children.length > 0 ? ["", ...parts.children] : [])];
      const quoted = body.map((text) => indent + (text === "" ? ">" : "> " + text));
      if (target === "quote") return { text: quoted.join("\n"), column: indent.length + 2 };
      return { text: [indent + "> [!note]", ...quoted].join("\n"), column: indent.length + 2 };
    }
    case "code": {
      const body = [...own, ...parts.children];
      const fence = backtickFence(body.join("\n"));
      return { text: [indent + fence, ...body.map(line), indent + fence].join("\n"), column: 0 };
    }
    case "details": {
      const open = `${indent}<details>`;
      const summary = `${indent}<summary>${own[0]!}</summary>`;
      const body = [...own.slice(1), ...parts.children];
      const inner = body.length > 0 ? ["", ...body.map(line), ""] : [""];
      return { text: [open, summary, ...inner, `${indent}</details>`].join("\n"), column: indent.length + "<summary>".length };
    }
  }
}

/// Il numero che una voce numerata nuova prende dal fratello sopra.
function numberFor(state: EditorState, blocks: readonly Block[], index: number): number {
  const block = blocks[index]!;
  for (let i = index - 1; i >= 0; i--) {
    const other = blocks[i]!;
    if (other.depth < block.depth) break;
    if (other.depth > block.depth || other.parent !== block.parent) continue;
    if (other.kind !== "ordered") break;
    const found = /^\s*(\d+)/.exec(state.doc.lineAt(other.from).text);
    return found ? Number(found[1]) + 1 : 1;
  }
  return 1;
}

/// I blocchi da trasformare: quelli che le selezioni toccano, una volta
/// ciascuno, e mai un figlio insieme al suo genitore.
export function touchedBlocks(state: EditorState, blocks: readonly Block[]): number[] {
  const out = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (block.from > range.to) break;
      if (block.to < range.from) continue;
      // Il più interno che contiene il punto, se la selezione è vuota.
      if (range.empty) {
        let inner = i;
        for (let j = i + 1; j < subtreeEnd(blocks, i); j++) {
          if (blocks[j]!.from <= range.head && range.head <= blocks[j]!.to) inner = j;
        }
        out.add(inner);
        break;
      }
      out.add(i);
      i = subtreeEnd(blocks, i) - 1;
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function modelOf(state: EditorState): readonly Block[] {
  return (state.field(blockModel, false) ?? buildBlocks(state)).blocks;
}

/// Il comando: ogni blocco toccato diventa `target`. Un passo di annulla; il
/// cursore resta allo stesso punto del contenuto.
export function transformTo(target: TransformTarget, only?: readonly number[]): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const blocks = modelOf(state);
    const indices = only ?? touchedBlocks(state, blocks);
    const changes: ChangeSpec[] = [];
    const heads: { from: number; old: number; column: number; at: number }[] = [];
    for (const index of indices) {
      const block = blocks[index];
      if (!block) continue;
      const parts = unwrap(state, blocks, index);
      if (!parts) continue;
      const next = rewrap(target, parts, numberFor(state, blocks, index));
      const old = state.doc.sliceString(block.from, block.to);
      if (next.text === old) continue;
      changes.push({ from: block.from, to: block.to, insert: next.text });
      heads.push({ from: block.from, old: parts.column, column: next.column, at: block.from });
    }
    if (changes.length === 0) return false;
    const changeSet = state.changes(changes);
    // Il cursore nella prima riga resta sullo stesso carattere del contenuto.
    const main = state.selection.main;
    let selection = state.selection.map(changeSet, 1);
    for (const head of heads) {
      const line = state.doc.lineAt(head.from);
      if (main.empty && main.head >= line.from && main.head <= line.to && main.head - line.from >= head.old) {
        const offset = main.head - line.from - head.old;
        const from = changeSet.mapPos(head.from, -1);
        selection = EditorSelection.single(Math.min(from + head.column + offset, changeSet.newLength));
      }
    }
    // Il protagonista è il primo blocco trasformato, nel documento nuovo.
    const first = blocks[indices.find((index) => heads.some((head) => head.from === blocks[index]?.from)) ?? -1];
    const lead = first ? { from: changeSet.mapPos(first.from, -1), to: changeSet.mapPos(first.to, 1) } : undefined;
    const annotations = blockGesture.of({ kind: "transform", ...(lead ? { lead } : {}) });
    dispatch(state.update({ changes: changeSet, selection, userEvent: "input", scrollIntoView: true, annotations }));
    return true;
  };
}

/// I tasti di Notion: 0 il testo, 1–3 i titoli, 4 la voce da fare, 5 la voce,
/// 6 la voce numerata, 7 il ripiegabile, 8 il codice.
export const TRANSFORM_KEYS: readonly (readonly [string, TransformTarget])[] = [
  ["Mod-Alt-0", "paragraph"],
  ["Mod-Alt-1", "heading1"],
  ["Mod-Alt-2", "heading2"],
  ["Mod-Alt-3", "heading3"],
  ["Mod-Alt-4", "task"],
  ["Mod-Alt-5", "bullet"],
  ["Mod-Alt-6", "ordered"],
  ["Mod-Alt-7", "details"],
  ["Mod-Alt-8", "code"],
];

export const transformKeymap: readonly KeyBinding[] = TRANSFORM_KEYS.map(([key, target]) => ({ key, run: transformTo(target) }));
