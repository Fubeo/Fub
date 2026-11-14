// La pastiglia della scadenza di un compito, in Live e in Lettura.
//
// La regola della `📅` è una sola, nel contratto (`fub_abi::rules::tasks`,
// gemella `taskDue` in `rules/mirrored.ts`), e vale sul **testo** del compito:
// il primo paragrafo senza la sintassi (il testo dentro `code` e l'etichetta di
// un link contano, i segni e la destinazione no). Qui sta solo come le due
// superfici ricavano quel testo — dall'albero Lezer la Live, dal DOM la
// Lettura — e come riportano il tratto trovato al loro posto.
import type { Tree } from "@lezer/common";
import { taskDue, type TaskDue } from "../../../../rules/mirrored";

/// Quanti giorni prima della scadenza la pastiglia diventa arancio. Una
/// scadenza passata è vicina anche lei: il compito è ancora da fare.
export const NEAR_DAYS = 7;

/// Come si mostra una scadenza: arancio se è vicina e il compito è aperto,
/// sbagliata se la data non si legge, normale altrimenti.
export type DueLook = "near" | "bad" | "plain";

/// Il giorno di chi guarda, nel fuso della macchina, in forma `AAAA-MM-GG`.
export function localDay(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function isoOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/// Il giorno `days` dopo `day`.
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return isoOf(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/// La scadenza è vicina: passata, del giorno o entro [`NEAR_DAYS`] giorni.
export function dueIsNear(date: string, today: string): boolean {
  return date < shiftDay(today, NEAR_DAYS);
}

/// L'aspetto della pastiglia di `due`.
export function dueLook(due: TaskDue, done: boolean, today: string): DueLook {
  if (due.date === null) return "bad";
  return !done && dueIsNear(due.date, today) ? "near" : "plain";
}

/// Un testo leggibile e, per ogni sua unità, la posizione da cui viene.
export interface Projection {
  text: string;
  at: number[];
}

/// La scadenza di una proiezione, riportata alle posizioni d'origine:
/// `[from, to)` copre il segno e la data nel testo da cui la proiezione viene.
export function projectedDue(projection: Projection): (TaskDue & { source: [number, number] }) | null {
  const due = taskDue(projection.text);
  if (!due || due.to <= due.from) return null;
  return { ...due, source: [projection.at[due.from]!, projection.at[due.to - 1]! + 1] };
}

/// I nodi Lezer che sono sintassi e non testo: i segni dell'enfasi, del codice,
/// del link, e la destinazione e il titolo di un link.
const SYNTAX_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "LinkTitle",
  "LinkLabel",
  "StrikethroughMark",
  "SuperscriptMark",
  "SubscriptMark",
  "HighlightMark",
  "HTMLTag",
  "Comment",
]);

/// Il testo di `[from, to)` senza la sintassi inline, come lo legge la regola:
/// l'albero dice quali tratti sono segni. `text` è il sorgente da `offset` in
/// poi (una riga, di solito), e le posizioni sono quelle del documento. Una
/// barra che protegge un carattere non si legge; un a capo è uno spazio.
export function liveProjection(tree: Tree, text: string, offset: number, from: number, to: number): Projection {
  const skip: [number, number][] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (SYNTAX_NODES.has(node.name)) {
        skip.push([node.from, node.to]);
        return false;
      }
      if (node.name === "Escape") skip.push([node.from, node.from + 1]);
      return undefined;
    },
  });
  skip.sort((a, b) => a[0] - b[0]);
  let read = "";
  const at: number[] = [];
  let next = 0;
  for (let pos = from; pos < to; pos++) {
    while (next < skip.length && skip[next]![1] <= pos) next++;
    if (next < skip.length && skip[next]![0] <= pos) continue;
    const unit = text[pos - offset] ?? "";
    if (unit === "") break;
    read += unit === "\n" || unit === "\r" ? " " : unit;
    at.push(pos);
  }
  return { text: read, at };
}

/// Il testo del compito di una voce resa (`li.task`): i nodi di testo del suo
/// primo paragrafo, senza le sottovoci, con la posizione di ognuno.
export function readingProjection(item: HTMLElement): { projection: Projection; nodes: { node: Text; start: number }[] } {
  const firstParagraph = item.querySelector<HTMLElement>(":scope > p");
  const root = firstParagraph ?? item;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const at: number[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // Il testo di una sottovoce sta in un'altra `li`: non è questo compito.
    const parent = node.parentElement;
    if (!parent || parent.closest("li") !== item) continue;
    const start = text.length;
    nodes.push({ node, start });
    const value = node.data.replace(/[\r\n]/g, " ");
    text += value;
    for (let index = 0; index < value.length; index++) at.push(start + index);
  }
  return { projection: { text, at }, nodes };
}
