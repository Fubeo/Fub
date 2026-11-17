// I bersagli fuori dalla colonna (E2, «Fuori dalla colonna»): dove può
// cadere un blocco staccato dal testo, ognuno col suo rettangolo, la sua
// etichetta e la sua azione. Li offre la shell con la porta di
// `editors/core/registry.ts` (`dropOffers`), che dice soltanto dove sta un
// posto e come si chiama; che cosa fa il rilascio lì lo decide l'editor, qui.
//
// Oggi il solo bersaglio sono i titoli della Struttura della stessa nota:
// «In fondo a …» porta il blocco in fondo alla sezione di quel titolo, in un
// passo d'annullamento. Il cassetto (T32) e la lavagna a lato (T48) ne
// aggiungono altri. Niente DOM: rettangoli e testo.
import type { EditorState } from "@codemirror/state";
import type { SurfaceDropOffer, SurfaceRect } from "../../../../core/registry";
import { byteToNormalizedCharIndices } from "../../../../../rules/offsets";
import { liveStrings } from "../strings";
import type { Block } from "./model";
import { type BlockRun, headingText, type MoveSpec, moveSiblings, pinnedFirst, siblingsOf } from "./move";

/// Un posto fuori dalla colonna dove il blocco in mano può cadere.
export interface DropTarget {
  readonly rect: SurfaceRect;
  /// Ciò che dicono il cartellino e l'annuncio: «In fondo a «I conti»».
  readonly label: string;
  /// La shell mostra il bersaglio sotto il puntatore.
  hover(on: boolean): void;
  /// La transazione del rilascio sul documento di adesso; `null` se non
  /// sposta niente.
  drop(state: EditorState, blocks: readonly Block[], run: BlockRun): MoveSpec | null;
}

/// Il titolo che un posto della Struttura nomina: quello che comincia dove
/// dice lo span (byte UTF-8 della sorgente com'è sul disco, `\r` compresi),
/// o, se la Struttura è rimasta indietro di una battuta, il titolo più vicino
/// con quel nome. `-1` se non c'è.
///
/// `source` è la sorgente coi suoi a capo: `state.sliceDoc()` rende quelli
/// del file (`EditorState.lineSeparator`), e il ponte
/// `byteToNormalizedCharIndices` la porta sugli offset del documento, che ha
/// soltanto `\n`, come fa `revealByteOffset` del motore.
export function headingOfPlace(state: EditorState, blocks: readonly Block[], span: { readonly start: number }, title: string, source = state.sliceDoc()): number {
  return headingAt(state, blocks, byteToNormalizedCharIndices(source, [span.start])[0]!, title);
}

/// `headingOfPlace` con lo span già portato sugli offset del documento.
function headingAt(state: EditorState, blocks: readonly Block[], at: number, title: string): number {
  const line = state.doc.lineAt(Math.min(at, state.doc.length)).from;
  const wanted = title.trim();
  let best = -1;
  let distance = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.kind !== "heading") continue;
    // La riga dello span basta: il nome serve soltanto da ripiego, e la
    // Struttura lo scrive in testo puro, non come la riga Markdown.
    if (block.from === line) return i;
    if (wanted === "" || headingPlainText(state, block) !== wanted) continue;
    const d = Math.abs(block.from - line);
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}

/// Il nome di un titolo come lo scrive la Struttura: il testo puro del
/// provider (`Heading.text` in `crates/fub-format-markdown/src/parse.rs`),
/// senza i segni del titolo, l'ancora `^id` in coda, l'enfasi, il codice, i
/// collegamenti e gli escape. Imita il parser vero quanto basta al ripiego
/// per nome: la prova che conta resta la riga dello span.
export function headingPlainText(state: EditorState, block: Block): string {
  return headingText(state, block)
    .replace(/\s+\^[A-Za-z0-9][A-Za-z0-9_-]*\s*$/, "")
    .replace(/!?\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/!?\[\[([^\]]*)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(`+)([^`]*?)\1/g, "$2")
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(\*|_|~|\^)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/// Dove finisce la sezione del titolo `heading`: il fratello davanti a cui va
/// un blocco «in fondo» (il primo titolo dello stesso livello o più alto),
/// o `-1` per la fine della nota.
export function sectionEnd(blocks: readonly Block[], heading: number): number {
  const level = blocks[heading]!.level;
  for (const i of siblingsOf(blocks, heading)) {
    if (i <= heading) continue;
    const block = blocks[i]!;
    if (block.kind === "heading" && block.level <= level) return i;
  }
  return -1;
}

/// Lo spostamento di `run` in fondo alla sezione di `heading`, o `null` se
/// non si può o non cambia niente: il titolo dentro la tratta in mano, una
/// tratta che non sta al primo livello come i titoli, il frontmatter, o una
/// tratta che sta già in fondo a quella sezione.
export function moveToSectionEnd(state: EditorState, blocks: readonly Block[], run: BlockRun, heading: number): MoveSpec | null {
  if (heading < 0 || heading >= blocks.length || blocks[heading]!.kind !== "heading") return null;
  if (!blocks[run.first] || !blocks[run.last]) return null;
  if (heading >= run.first && heading <= run.last) return null;
  if (blocks[run.first]!.parent !== blocks[heading]!.parent) return null;
  const sibs = siblingsOf(blocks, run.first);
  if (pinnedFirst(blocks, sibs) && sibs[0] === run.first) return null;
  return moveSiblings(state, blocks, run.first, run.last, sectionEnd(blocks, heading));
}

/// I bersagli che i posti offerti danno per la tratta `run`: un titolo della
/// nota per riga della Struttura, tolti quelli dove il rilascio non farebbe
/// niente (il titolo in mano, la sezione dove la tratta sta già in fondo).
export function placeTargets(state: EditorState, blocks: readonly Block[], run: BlockRun, offers: readonly SurfaceDropOffer[]): DropTarget[] {
  const out: DropTarget[] = [];
  if (offers.length === 0) return out;
  // Un passaggio solo sulla sorgente per tutti gli span.
  const starts = byteToNormalizedCharIndices(state.sliceDoc(), offers.map((offer) => offer.span.start));
  for (const [index, offer] of offers.entries()) {
    if (offer.kind !== "place") continue;
    const rect = offer.rect;
    if (!(rect.right > rect.left && rect.bottom > rect.top)) continue;
    const heading = headingAt(state, blocks, starts[index]!, offer.title);
    if (heading < 0 || !moveToSectionEnd(state, blocks, run, heading)) continue;
    const name = offer.title.trim() || headingText(state, blocks[heading]!);
    const key = { from: blocks[heading]!.from, title: headingText(state, blocks[heading]!) };
    out.push({
      rect,
      label: liveStrings.t("blocks.drag.end", { name }),
      hover: (on) => offer.hover(on),
      // Il titolo si ritrova nel documento del rilascio: dalla presa il testo
      // non cambia (un cambio annulla il gesto), ma il conto non lo dà per buono.
      drop: (now, nowBlocks, nowRun) => {
        let found = nowBlocks.findIndex((block) => block.from === key.from && block.kind === "heading");
        if (found < 0 || headingText(now, nowBlocks[found]!) !== key.title) found = -1;
        return found < 0 ? null : moveToSectionEnd(now, nowBlocks, nowRun, found);
      },
    });
  }
  return out;
}

/// Il bersaglio sotto il punto (`x`, `y`), in coordinate dello schermo.
export function targetAt(targets: readonly DropTarget[], x: number, y: number): DropTarget | null {
  for (const target of targets) {
    const { left, top, right, bottom } = target.rect;
    if (x >= left && x <= right && y >= top && y <= bottom) return target;
  }
  return null;
}
