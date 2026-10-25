// Le tinte del file sulla carta adattata.
//
// Nell'aspetto adattato il documento sta sulla carta del tema, che di notte è
// scura: ogni colore del file passa dalla funzione comune della shell
// (`theme/adapt.ts`), che tiene la tinta e il contrasto che il colore aveva sul
// bianco, mai sotto la soglia. Il colore portato dipende dalla carta, e la
// carta è della vista: per questo sta in una decorazione e non nel documento,
// che resta com'è. Sull'elemento va soltanto la variabile di dato
// (`--file-color-a`, `--file-hl-a`); la usa la regola di `look-adattato` in
// `structure.css`. Senza carta (gli altri aspetti) non c'è niente.
import type { Mark as PmMark, Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { adapter, AUTO_INK, textUse, type Adapter, type Paper } from "../../theme/adapt";
import { COLOR_AUTO, HIGHLIGHT_DEFAULT, type Look, type Role } from "./projection";

/// La misura del testo che non dice la sua, in punti.
const BODY_PT = 11;

interface Tints {
  readonly paper: Paper | null;
  /// La misura del testo del documento, in punti: decide il testo grande.
  readonly pt: number;
  readonly decorations: DecorationSet;
}

export const tintKey = new PluginKey<Tints>("fub-rich-tints");

function solid(color: string | undefined): color is string {
  return color !== undefined && color !== COLOR_AUTO;
}

/// Le decorazioni di un blocco di testo che comincia a `pos`.
function tintBlock(block: PmNode, pos: number, paint: Adapter, docPt: number, out: Decoration[]): void {
  const look = block.attrs.f as Look | null;
  const role = block.attrs.role as Role | undefined;
  const heading = role?.kind === "heading";
  const blockPt = look?.size ?? docPt;
  if (solid(look?.color)) {
    out.push(Decoration.node(pos, pos + block.nodeSize, { class: "rich-tinted", style: `--file-color-a: ${paint.color(look.color, textUse(blockPt, heading))}` }));
  }
  block.forEach((child, offset) => {
    if (!child.isText) return;
    const marks = child.marks;
    const markOf = (name: string): PmMark | undefined => marks.find((mark) => mark.type.name === name);
    const color = markOf("color")?.attrs.value as string | undefined;
    const highlight = markOf("h");
    if (!solid(color) && !highlight) return;
    const pt = (markOf("size")?.attrs.pt as number | undefined) ?? blockPt;
    const use = textUse(pt, heading || markOf("b") !== undefined);
    const style: string[] = [];
    const attrs: Record<string, string> = { class: "rich-tint" };
    if (highlight) {
      const fill = (highlight.attrs.color as string | null) ?? HIGHLIGHT_DEFAULT;
      // Prima il fondo rispetto alla carta, poi il testo rispetto al fondo nuovo.
      const pair = paint.pair(fill, solid(color) ? color : AUTO_INK, use);
      style.push(`--file-hl-a: ${pair.fill}`, `--file-color-a: ${pair.text}`);
      attrs["data-tint-hl"] = "";
      attrs["data-tint-color"] = "";
    } else if (solid(color)) {
      style.push(`--file-color-a: ${paint.color(color, use)}`);
      attrs["data-tint-color"] = "";
    }
    attrs.style = style.join("; ");
    const from = pos + 1 + offset;
    out.push(Decoration.inline(from, from + child.nodeSize, attrs));
  });
}

/// Le decorazioni dei blocchi di testo fra `from` e `to`.
function tintRange(doc: PmNode, from: number, to: number, paint: Adapter, pt: number): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    tintBlock(node, pos, paint, pt, out);
    return false;
  });
  return out;
}

function tintAll(doc: PmNode, paper: Paper | null, pt: number): DecorationSet {
  if (!paper) return DecorationSet.empty;
  return DecorationSet.create(doc, tintRange(doc, 0, doc.content.size, adapter(paper), pt));
}

/// Dopo un cambio, si ridipingono soltanto i blocchi toccati.
function retint(previous: DecorationSet, tr: Transaction, paper: Paper, pt: number): DecorationSet {
  let set = previous.map(tr.mapping, tr.doc);
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => ranges.push([after.map(newStart, -1), after.map(newEnd, 1)]));
  });
  const paint = adapter(paper);
  for (const [from, to] of ranges) {
    const start = Math.max(0, Math.min(from, tr.doc.content.size));
    const end = Math.max(start, Math.min(to, tr.doc.content.size));
    // Il blocco intero: un colore si decide sul paragrafo.
    const blocks: [number, number][] = [];
    tr.doc.nodesBetween(start, end, (node, pos) => {
      if (!node.isTextblock) return true;
      blocks.push([pos, pos + node.nodeSize]);
      return false;
    });
    for (const [a, b] of blocks) set = set.remove(set.find(a, b));
    if (blocks.length > 0) set = set.add(tr.doc, tintRange(tr.doc, blocks[0]![0], blocks[blocks.length - 1]![1], paint, pt));
  }
  return set;
}

export const tintPlugin = new Plugin<Tints>({
  key: tintKey,
  state: {
    init: () => ({ paper: null, pt: BODY_PT, decorations: DecorationSet.empty }),
    apply(tr, value, _old, state: EditorState) {
      const asked = tr.getMeta(tintKey) as { paper: Paper | null; pt: number } | undefined;
      if (asked) return { ...asked, decorations: tintAll(state.doc, asked.paper, asked.pt) };
      if (!value.paper || !tr.docChanged) return value;
      return { ...value, decorations: retint(value.decorations, tr, value.paper, value.pt) };
    },
  },
  props: {
    decorations: (state) => tintKey.getState(state)?.decorations ?? DecorationSet.empty,
  },
});

/// La carta su cui portare le tinte, o `null`, per un documento il cui testo
/// misura `pt` punti. `null` se non cambia niente.
export function setTint(state: EditorState, paper: Paper | null, pt = BODY_PT): Transaction | null {
  const now = tintKey.getState(state);
  const same = (a: Paper | null, b: Paper | null) => a === b || (a !== null && b !== null && a.bg === b.bg && a.ink === b.ink);
  if (now && same(now.paper, paper) && now.pt === pt) return null;
  return state.tr.setMeta(tintKey, { paper, pt }).setMeta("addToHistory", false);
}
