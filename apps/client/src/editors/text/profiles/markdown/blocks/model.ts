// Il modello dei blocchi (H2): l'elenco dei blocchi della nota, in ordine,
// dall'albero Lezer. È la sola fonte per maniglie, selezione e spostamenti
// dei Blocchi. Un blocco va da inizio riga a fine riga e non comprende le
// righe vuote che lo seguono; fra due blocchi di primo livello ci sono
// soltanto righe vuote. Una voce d'elenco è un blocco, e le sue sottovoci
// sono blocchi figli dentro di lei; un `<details>` con il suo `</details>` è
// un blocco solo, coi blocchi fra i due come figli.
//
// Il campo si aggiorna come la resa della Live (F1): dopo una modifica rifà
// soltanto i blocchi di primo livello che la toccano, e si ferma al primo che
// torna uguale a uno di prima; il resto si sposta con le modifiche.
import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateField, type Text, type Transaction } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { calloutHead } from "../callout-head";
import { detailsHead, isDetailsClose as isDetailsCloseText } from "../details";
import { frontmatterRange } from "../render";
import { liveStrings } from "../strings";

export type BlockKind =
  | "frontmatter"
  | "paragraph"
  | "heading"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "callout"
  | "code"
  | "math"
  | "table"
  | "rule"
  | "html"
  | "details"
  | "footnote"
  | "other";

export interface Block {
  /// Inizio della prima riga.
  readonly from: number;
  /// Fine dell'ultima riga non vuota, figli compresi.
  readonly to: number;
  readonly kind: BlockKind;
  /// 0 per i blocchi di primo livello.
  readonly depth: number;
  /// L'indice del genitore in `BlockModel.blocks`, o -1.
  readonly parent: number;
  /// Il livello di un titolo, 0 per il resto.
  readonly level: number;
}

export interface BlockModel {
  readonly blocks: readonly Block[];
  /// Fin dove l'albero era già letto quando il modello è nato.
  readonly parsed: number;
}

const HEADING = /^(?:ATX|Setext)Heading(\d)$/;

/// La fine dell'ultima riga non vuota del nodo, mai prima della sua prima riga.
function lastLineEnd(doc: Text, from: number, to: number): number {
  let line = doc.lineAt(Math.max(from, to));
  if (to > from && to === line.from) line = doc.line(line.number - 1);
  const first = doc.lineAt(from).number;
  while (line.number > first && line.text.trim() === "") line = doc.line(line.number - 1);
  return line.to;
}

interface Draft {
  from: number;
  to: number;
  kind: BlockKind;
  depth: number;
  parent: number;
  level: number;
}

function kindOf(node: SyntaxNode, doc: Text): { kind: BlockKind; level: number } {
  const heading = HEADING.exec(node.name);
  if (heading) return { kind: "heading", level: Number(heading[1]) };
  switch (node.name) {
    case "Paragraph": {
      const text = doc.sliceString(node.from, Math.min(node.to, node.from + 2));
      return { kind: text === "$$" ? "math" : "paragraph", level: 0 };
    }
    case "Blockquote": {
      return { kind: calloutHead(doc.lineAt(node.from).text) ? "callout" : "quote", level: 0 };
    }
    case "FencedCode":
    case "CodeBlock": return { kind: "code", level: 0 };
    case "Table": return { kind: "table", level: 0 };
    case "HorizontalRule": return { kind: "rule", level: 0 };
    case "HTMLBlock": return { kind: "html", level: 0 };
    case "FootnoteDefinition": return { kind: "footnote", level: 0 };
    default: return { kind: "other", level: 0 };
  }
}

/// Le voci di un elenco, con le sottovoci dopo ognuna.
function pushList(list: SyntaxNode, doc: Text, depth: number, parent: number, out: Draft[]): void {
  const ordered = list.name === "OrderedList";
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue;
    const task = item.getChild("Task") ?? item.getChild("Paragraph")?.getChild("Task");
    const index = out.length;
    out.push({
      from: doc.lineAt(item.from).from,
      to: lastLineEnd(doc, item.from, item.to),
      kind: task ? "task" : ordered ? "ordered" : "bullet",
      depth,
      parent,
      level: 0,
    });
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name === "BulletList" || child.name === "OrderedList") pushList(child, doc, depth + 1, index, out);
    }
  }
}

/// Un nodo di primo livello: un blocco, o le voci del suo elenco.
function pushNode(node: SyntaxNode, doc: Text, depth: number, parent: number, out: Draft[]): void {
  if (node.name === "BulletList" || node.name === "OrderedList") {
    pushList(node, doc, depth, parent, out);
    return;
  }
  const { kind, level } = kindOf(node, doc);
  out.push({ from: doc.lineAt(node.from).from, to: lastLineEnd(doc, node.from, node.to), kind, depth, parent, level });
}

// La regola dei ripiegabili è quella della Lettura e della Live (`details.ts`).
const isDetailsOpen = (node: SyntaxNode, doc: Text) =>
  node.name === "HTMLBlock" && detailsHead(doc.sliceString(node.from, node.to)) !== null;
const isDetailsClose = (node: SyntaxNode, doc: Text) =>
  node.name === "HTMLBlock" && isDetailsCloseText(doc.sliceString(node.from, node.to));

/// I nodi di primo livello, a partire dal primo che finisce a `from` o dopo.
/// Uno alla volta: chi si ferma presto non legge il resto dell'albero, e il
/// primo nodo si trova scendendo, non contando dall'inizio.
function* topNodes(tree: Tree, from: number): Generator<SyntaxNode> {
  let node = from > 0 ? tree.topNode.childAfter(from - 1) : tree.topNode.firstChild;
  for (; node; node = node.nextSibling) yield node;
}

/// I blocchi dei nodi di primo livello dati, coi `<details>` accoppiati. Un
/// `<details>` senza chiusura resta un blocco HTML.
function draftsOf(nodes: readonly SyntaxNode[], doc: Text, skipTo: number): Draft[] {
  const out: Draft[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.from < skipTo) continue;
    if (isDetailsOpen(node, doc)) {
      let open = 0;
      let close = -1;
      for (let j = i + 1; j < nodes.length; j++) {
        if (isDetailsOpen(nodes[j]!, doc)) open++;
        else if (isDetailsClose(nodes[j]!, doc)) {
          if (open === 0) { close = j; break; }
          open--;
        }
      }
      if (close !== -1) {
        const end = nodes[close]!;
        const index = out.length;
        out.push({ from: doc.lineAt(node.from).from, to: lastLineEnd(doc, end.from, end.to), kind: "details", depth: 0, parent: -1, level: 0 });
        for (let j = i + 1; j < close; j++) pushNode(nodes[j]!, doc, 1, index, out);
        i = close;
        continue;
      }
    }
    pushNode(node, doc, 0, -1, out);
  }
  return out;
}

const LONE_ANCHOR = /^\^[A-Za-z0-9-]+[ \t]*$/;

/// Un `^id` su una riga sua, dopo un blocco, è l'indirizzo di quel blocco e
/// non un paragrafo: si attacca al blocco di primo livello sopra, come lo
/// legge il kernel, e si sposta e si elimina con lui.
function attachAnchors(blocks: Block[], doc: Text): Block[] {
  const drop = new Set<number>();
  const grow = new Map<number, number>();
  let lastTop = -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.depth !== 0) continue;
    const lone = block.kind === "paragraph" && lastTop >= 0 && blocks[lastTop]!.kind !== "frontmatter" &&
      block.to - block.from <= 80 && LONE_ANCHOR.test(doc.sliceString(block.from, block.to));
    if (lone) {
      drop.add(i);
      grow.set(lastTop, block.to);
      continue;
    }
    lastTop = i;
  }
  if (drop.size === 0) return blocks;
  // Un `^id` non ha figli: nessun genitore punta a un blocco tolto.
  const index: number[] = [];
  const out: Block[] = [];
  blocks.forEach((block, i) => {
    if (drop.has(i)) return;
    index[i] = out.length;
    out.push({ ...block, to: grow.get(i) ?? block.to, parent: block.parent === -1 ? -1 : index[block.parent]! });
  });
  return out;
}

/// Il modello rifatto da capo: la regola, e il confronto della prova.
export function buildBlocks(state: EditorState): BlockModel {
  const tree = syntaxTree(state);
  const doc = state.doc;
  const out: Block[] = [];
  const front = frontmatterRange(doc);
  if (front) out.push({ from: 0, to: lastLineEnd(doc, 0, front.to), kind: "frontmatter", depth: 0, parent: -1, level: 0 });
  const skipTo = front ? front.to : 0;
  for (const draft of fixParents(draftsOf([...topNodes(tree, 0)], doc, skipTo), out.length)) out.push(draft);
  return { blocks: attachAnchors(out, doc), parsed: tree.length };
}

/// `draftsOf` costruisce i genitori relativi al proprio elenco: qui diventano
/// indici dell'elenco intero, che comincia a `offset`.
function fixParents(drafts: readonly Draft[], offset: number): Draft[] {
  return drafts.map((draft) => (draft.parent === -1 ? draft : { ...draft, parent: draft.parent + offset }));
}

function sameBlock(a: Block, b: Block): boolean {
  return a.from === b.from && a.to === b.to && a.kind === b.kind && a.depth === b.depth && a.level === b.level;
}

/// L'indice del primo blocco che comincia a `pos` o dopo: i blocchi sono in
/// ordine di inizio, i figli dopo il genitore.
function firstFrom(blocks: readonly Block[], pos: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (blocks[mid]!.from < pos) low = mid + 1;
    else high = mid;
  }
  return low;
}

/// Il blocco di primo livello che contiene il blocco `index`.
function topOf(blocks: readonly Block[], index: number): number {
  let top = index;
  while (blocks[top]!.parent !== -1) top = blocks[top]!.parent;
  return top;
}

/// Dove comincia il primo gruppo di primo livello da rifare per una modifica
/// che parte da `fromA`: restano i gruppi che finiscono prima della modifica,
/// tranne l'ultimo, perché un testo che gli si attacca sotto, o una riga
/// rientrata dopo una vuota, lo allunga.
function restartGroup(blocks: readonly Block[], fromA: number): number {
  const last = firstFrom(blocks, fromA) - 1;
  if (last < 0) return 0;
  const top = topOf(blocks, last);
  if (blocks[top]!.to + 1 < fromA || top === 0) return top;
  return topOf(blocks, top - 1);
}

/// Il modello dopo `tr`, rifacendo soltanto la parte toccata.
export function updateBlocks(model: BlockModel, tr: Transaction): BlockModel {
  const before = syntaxTree(tr.startState);
  const after = syntaxTree(tr.state);
  if (!tr.docChanged) return before === after ? model : buildBlocks(tr.state);
  const doc = tr.state.doc;
  // Il frontmatter cambia la lettura di quello che lo segue; un albero ancora
  // a metà si rilegge quando arriva in fondo.
  if (model.blocks[0]?.kind === "frontmatter" || frontmatterRange(doc) || after.length < doc.length) {
    return buildBlocks(tr.state);
  }
  let fromA = Infinity;
  let toB = -1;
  tr.changes.iterChangedRanges((fa, _ta, _fb, tb) => {
    fromA = Math.min(fromA, fa);
    toB = Math.max(toB, tb);
  });
  const old = model.blocks;
  const headEnd = restartGroup(old, fromA);
  const head = old.slice(0, headEnd);
  const startB = headEnd < old.length ? tr.changes.mapPos(old[headEnd]!.from, -1) : doc.length;
  const restart = Math.min(startB, tr.changes.mapPos(fromA, -1));
  // I gruppi vecchi dopo la modifica, spostati, sono candidati a tornare
  // uguali: dopo l'ultima modifica le posizioni scalano tutte di `delta`, e
  // il gruppo si cerca per inizio, senza scorrere l'elenco.
  const delta = tr.changes.newLength - tr.changes.length;
  const tailGroup = (fromB: number): number | undefined => {
    const fromOld = fromB - delta;
    if (fromOld <= fromA) return undefined;
    const index = firstFrom(old, fromOld);
    if (index < headEnd || index >= old.length) return undefined;
    const block = old[index]!;
    if (block.from !== fromOld || block.depth !== 0) return undefined;
    return tr.changes.mapPos(fromOld, 1) === fromB ? index : undefined;
  };
  const fresh: Block[] = [];
  for (const node of topNodes(after, restart)) {
    if (node.name === "HTMLBlock") return buildBlocks(tr.state);
    const drafts = fixParents(draftsOf([node], doc, 0), head.length + fresh.length);
    // Le voci di un elenco che comincia prima di `restart` sono già in testa:
    // si saltano, e i genitori di quelle dopo scalano di tanto.
    let skipped = 0;
    for (let i = 0; i < drafts.length; i = subtreeEnd(drafts, i)) {
      const top = drafts[i]!;
      const end = subtreeEnd(drafts, i);
      if (top.from < restart) {
        // Soltanto le voci già in testa, uguali: altrimenti si rifà tutto.
        if (!head.some((block) => block.depth === 0 && sameBlock(block, top))) return buildBlocks(tr.state);
        skipped += end - i;
        continue;
      }
      const start = top.from > toB ? tailGroup(top.from) : undefined;
      if (start !== undefined) {
        const was = old[start]!;
        if (sameBlock({ ...was, from: top.from, to: tr.changes.mapPos(was.to, -1) }, top)) {
          const shift = head.length + fresh.length - start;
          const rest = old.slice(start).map((block) => ({
            ...block,
            from: tr.changes.mapPos(block.from, 1),
            to: tr.changes.mapPos(block.to, -1),
            parent: block.parent === -1 ? -1 : block.parent + shift,
          }));
          return { blocks: attachAnchors([...head, ...fresh, ...rest], doc), parsed: after.length };
        }
      }
      for (let k = i; k < end; k++) {
        const draft = drafts[k]!;
        fresh.push(draft.parent === -1 ? draft : { ...draft, parent: draft.parent - skipped });
      }
    }
  }
  return { blocks: attachAnchors([...head, ...fresh], doc), parsed: after.length };
}

export const blockModel = StateField.define<BlockModel>({
  create: buildBlocks,
  update: updateBlocks,
});

/// Il blocco più interno che contiene `pos`, o -1. Le righe vuote fra due
/// blocchi non sono di nessuno.
export function blockAt(state: EditorState, pos: number): number {
  return innermostAt(state.field(blockModel).blocks, pos);
}

/// Come `blockAt`, su un elenco dato. I blocchi che contengono `pos` sono gli
/// antenati dell'ultimo che comincia prima: si trova lui cercando, e si sale.
export function innermostAt(blocks: readonly Block[], pos: number): number {
  let index = firstFrom(blocks, pos + 1) - 1;
  while (index >= 0 && pos > blocks[index]!.to) index = blocks[index]!.parent;
  return index;
}

/// Il blocco che comincia in `from` alla profondità `depth`, o -1.
export function blockStartingAt(blocks: readonly Block[], from: number, depth: number): number {
  for (let i = firstFrom(blocks, from); i < blocks.length && blocks[i]!.from === from; i++) {
    if (blocks[i]!.depth === depth) return i;
  }
  return -1;
}

/// Il blocco e i suoi discendenti: gli indici `[index, end)`.
export function subtreeEnd(blocks: readonly Block[], index: number): number {
  const depth = blocks[index]!.depth;
  let end = index + 1;
  while (end < blocks.length && blocks[end]!.depth > depth) end++;
  return end;
}

/// Il nome della specie, per la maniglia, per «Trasforma in» e per la regione
/// viva.
export function kindName(block: Pick<Block, "kind" | "level">): string {
  if (block.kind === "heading") return liveStrings.t("blocks.kind.heading", { level: String(block.level) });
  return liveStrings.t(`blocks.kind.${block.kind}`);
}
