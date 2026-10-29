// «Copia il link al blocco» (H4): l'indirizzo con cui un'altra nota punta a
// questo blocco. Un titolo si indirizza col suo testo; gli altri con un
// `^id`, che si riusa se c'è e altrimenti si scrive dove il kernel lo legge:
// in coda alla riga per un testo, un titolo e una voce, su una riga sua dopo
// una riga vuota per i blocchi che finiscono con un delimitatore (codice,
// tabella, citazione, callout, ripiegabile, riga, formula).
import { type ChangeSpec, type EditorState } from "@codemirror/state";
import { type Block, type BlockKind } from "./model";
import { subtreeEnd } from "./model";

const ID_AT_END = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const LONE = /^\^([A-Za-z0-9-]+)[ \t]*$/;
const ATX = /^\s{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/// Le specie che hanno una coda di testo dove scrivere l'id.
const INLINE: ReadonlySet<BlockKind> = new Set(["paragraph", "heading", "bullet", "ordered", "task"]);

export interface BlockAnchor {
  /// Ciò che segue `#` nel link: `^id`, o il testo del titolo.
  readonly fragment: string;
  /// La modifica che scrive l'id, se non c'era.
  readonly changes: ChangeSpec | null;
}

/// L'ultima riga del contenuto proprio del blocco, figli esclusi.
function ownLastLine(state: EditorState, blocks: readonly Block[], index: number) {
  const block = blocks[index]!;
  const end = subtreeEnd(blocks, index);
  const to = end > index + 1 ? Math.max(block.from, blocks[index + 1]!.from - 1) : block.to;
  return state.doc.lineAt(to);
}

/// Un id nuovo, che nella nota non c'è ancora.
function freshId(state: EditorState, random: () => number): string {
  const text = state.doc.toString();
  for (;;) {
    const id = Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
    if (!text.includes(`^${id}`)) return id;
  }
}

export function blockAnchor(state: EditorState, blocks: readonly Block[], index: number, random: () => number = Math.random): BlockAnchor {
  const block = blocks[index]!;
  const last = ownLastLine(state, blocks, index);
  if (INLINE.has(block.kind)) {
    const found = ID_AT_END.exec(last.text);
    if (found) return { fragment: `^${found[1]}`, changes: null };
    if (block.kind === "heading") {
      const heading = ATX.exec(state.doc.lineAt(block.from).text);
      // Un titolo setext non ha una riga sola col testo: prende un id.
      if (heading && heading[1]!.trim() !== "") return { fragment: heading[1]!.trim(), changes: null };
    }
    const id = freshId(state, random);
    const insert = (/[ \t]$/.test(last.text) || last.text === "" ? "" : " ") + `^${id}`;
    return { fragment: `^${id}`, changes: { from: last.to, insert } };
  }
  // Il `^id` su una riga sua, attaccato al blocco dal modello.
  const tail = state.doc.lineAt(block.to);
  const lone = LONE.exec(tail.text);
  if (lone && tail.from > block.from) return { fragment: `^${lone[1]}`, changes: null };
  const id = freshId(state, random);
  return { fragment: `^${id}`, changes: { from: block.to, insert: `\n\n^${id}` } };
}

/// Il link wiki al blocco, nella nota `page` (vuota: questa nota).
export function blockLink(page: string | null, fragment: string): string {
  return `[[${page ?? ""}#${fragment}]]`;
}
