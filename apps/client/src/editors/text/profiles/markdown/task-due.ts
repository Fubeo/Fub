// La pastiglia della scadenza di un compito, in Live e in Lettura.
//
// La regola della `📅` è una sola, nel contratto (`fub_abi::rules::tasks`,
// gemelle `taskDue` e `dueUrgency` in `rules/mirrored.ts`), e vale sul **testo**
// del compito: il primo paragrafo, righe che lo continuano comprese, senza la
// sintassi — conta ciò che si legge. Il testo dentro `code`, l'etichetta di un
// link e l'interno di un wikilink senza alias contano; i segni, la destinazione
// di un link, un'immagine e un embed no. Qui sta solo come le due superfici
// ricavano quel testo — dall'albero Lezer la Live, dal DOM la Lettura — e come
// riportano il tratto trovato al loro posto. Il corpus (`corpus.test.ts`,
// famiglia «scadenza») le tiene d'accordo col modello.
import type { Tree } from "@lezer/common";
import { dueUrgency, taskDue, type TaskDue } from "../../../../rules/mirrored";
import { wikilink } from "../../../../rules/syntax";

/// Come si mostra una scadenza: rossa se è passata e arancio se è vicina,
/// col compito aperto; sbagliata se la data non si legge; normale altrimenti.
/// Scaduta e vicina vogliono dire la stessa cosa nella vista dei compiti
/// (`due_urgency` del contratto).
export type DueLook = "overdue" | "near" | "bad" | "plain";

/// Il giorno di chi guarda, nel fuso della macchina, in forma `AAAA-MM-GG`.
export function localDay(now: Date = new Date()): string {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/// L'aspetto della pastiglia di `due`.
export function dueLook(due: TaskDue, done: boolean, today: string): DueLook {
  if (due.date === null) return "bad";
  if (done) return "plain";
  const urgency = dueUrgency(due.date, today);
  return urgency === "later" ? "plain" : urgency;
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
/// del link e della citazione, la destinazione e il titolo di un link, e
/// un'immagine intera (si vede per ciò che mostra, non come testo).
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
  "QuoteMark",
  "HTMLTag",
  "Comment",
  "Image",
]);

/// I nodi dentro cui un `[[…]]` non è un wikilink: il codice, un indirizzo,
/// il markup HTML, un carattere protetto. Sono le esclusioni della Live.
const OPAQUE_NODES = new Set(["InlineCode", "URL", "Autolink", "HTMLTag", "Comment", "Escape"]);

/// La fine del compito che comincia alla casella in `boxFrom`: il nodo `Task`
/// di Lezer copre il primo paragrafo della voce, righe che lo continuano
/// comprese. Senza il nodo (un albero ancora a metà), la riga stessa.
export function liveTaskEnd(tree: Tree, boxFrom: number, rowEnd: number): number {
  for (let node: ReturnType<Tree["resolveInner"]> | null = tree.resolveInner(boxFrom, 1); node; node = node.parent) {
    if (node.name === "Task") return Math.max(node.to, rowEnd);
    if (node.name === "ListItem") break;
  }
  return rowEnd;
}

/// Il testo di `[from, to)` senza la sintassi inline, come lo legge la regola.
/// L'albero dice quali tratti sono segni; i wikilink, che il parser non
/// conosce (vi vede un `[link]` fra due parentesi), li riconosce la regola
/// della shell (`wikilink`), come fa la Live per decorarli: di un wikilink si
/// legge ciò che mostra — l'interno, o l'alias se c'è — e di un embed niente.
/// `text` è il sorgente da `offset` in poi e le posizioni sono quelle del
/// documento. Una barra che protegge un carattere non si legge; un a capo è
/// uno spazio.
export function liveProjection(tree: Tree, text: string, offset: number, from: number, to: number): Projection {
  const marks: [number, number][] = [];
  const opaque: [number, number][] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (OPAQUE_NODES.has(node.name)) opaque.push([node.from, node.to]);
      if (SYNTAX_NODES.has(node.name)) {
        marks.push([node.from, node.to]);
        return false;
      }
      if (node.name === "Escape") marks.push([node.from, node.from + 1]);
      return undefined;
    },
  });
  // I wikilink fuori dal codice e dagli indirizzi: dentro il loro tratto
  // valgono i loro segni e non quelli di Lezer.
  const links: [number, number][] = [];
  const skip: [number, number][] = [];
  for (const w of wikilink(text.slice(from - offset, to - offset))) {
    const linkFrom = from + w.from;
    const linkTo = from + w.to;
    if (opaque.some(([a, b]) => a < linkTo && linkFrom < b)) continue;
    links.push([linkFrom, linkTo]);
    if (w.embed) {
      skip.push([linkFrom, linkTo]);
      continue;
    }
    const innerA = from + w.innerA;
    let showFrom = from + w.innerFrom + (w.alias === null ? 0 : w.target.length + 1);
    while (showFrom < innerA && /[ \t]/.test(text[showFrom - offset] ?? "")) showFrom++;
    skip.push([linkFrom, showFrom], [innerA, linkTo]);
  }
  for (const mark of marks) {
    if (!links.some(([a, b]) => a < mark[1] && mark[0] < b)) skip.push(mark);
  }
  let read = "";
  const at: number[] = [];
  for (let pos = from; pos < to; pos++) {
    if (skip.some(([a, b]) => a <= pos && pos < b)) continue;
    const unit = text[pos - offset] ?? "";
    if (unit === "") break;
    read += unit === "\n" || unit === "\r" ? " " : unit;
    at.push(pos);
  }
  return { text: read, at };
}

/// Gli elementi che in una voce resa sono un blocco: dove uno di loro comincia,
/// il primo paragrafo di una voce stretta (senza `<p>`) è finito.
const BLOCK_TAGS = new Set([
  "P", "UL", "OL", "PRE", "BLOCKQUOTE", "DIV", "TABLE", "FIGURE", "DETAILS", "HR",
  "H1", "H2", "H3", "H4", "H5", "H6", "DL", "SECTION", "ASIDE",
]);

/// Il primo paragrafo di una voce resa (`li.task`): i nodi che ne fanno parte.
/// Una voce larga lo ha in un `<p>`; una stretta lo ha nudo, dalla casella
/// fino al primo blocco — una sottolista, un codice, una citazione. Una voce
/// che comincia con un altro blocco non ha testo, come nel modello.
function firstParagraph(item: HTMLElement): Node[] {
  const inline: Node[] = [];
  for (const child of item.childNodes) {
    if (child instanceof HTMLElement && BLOCK_TAGS.has(child.tagName)) {
      if (inline.some((node) => (node.textContent ?? "").trim() !== "")) break;
      return child.tagName === "P" ? [child] : [];
    }
    inline.push(child);
  }
  return inline;
}

/// Il testo del compito di una voce resa (`li.task`): i nodi di testo del suo
/// primo paragrafo, con la posizione di ognuno.
export function readingProjection(item: HTMLElement): { projection: Projection; nodes: { node: Text; start: number }[] } {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const at: number[] = [];
  const visit = (node: Node) => {
    if (node instanceof Text) {
      const start = text.length;
      nodes.push({ node, start });
      const value = node.data.replace(/[\r\n]/g, " ");
      text += value;
      for (let index = 0; index < value.length; index++) at.push(start + index);
      return;
    }
    // Una formula resa non è testo del compito, come nel modello; un elemento
    // nascosto non si legge.
    if (!(node instanceof HTMLElement) || node.hidden || node.matches(".math-inline, .math-block")) return;
    for (const child of node.childNodes) visit(child);
  };
  for (const node of firstParagraph(item)) visit(node);
  return { projection: { text, at }, nodes };
}
