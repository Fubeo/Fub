// Cerca nella lavagna (N6 T60, H1): Ctrl+F cerca nel testo delle schede di
// testo, nelle etichette dei gruppi e dei fili, nei nomi dei file e negli
// indirizzi delle schede di link, e nel contenuto delle note della lavagna.
//
// - **Il file della lavagna.** `boardFindIndex` legge il documento una volta
//   (l'ordine di lettura di `reading-order.ts` e il testo già normalizzato di
//   ogni scheda e di ogni filo) e lo tiene finché il documento è lo stesso
//   oggetto; `boardMatches` è poi un `includes` per scheda: un tasto su una
//   lavagna di duemila schede non rifà né l'ordine né la normalizzazione.
// - **Le note.** Il loro contenuto lo sa l'indice del vault: una richiesta
//   `documents` con `searchExpression` (la stessa sintassi della ricerca del
//   vault) e il predicato `docs` delle sole note della lavagna. Chi la manda e
//   quando (una per ricerca, 200 ms dopo l'ultimo tasto) lo dice la barra
//   (`chrome/find-bar.ts`); qui solo la domanda (`notesQuery`) e la porta di
//   serie (`searchBoardNotes`).
// - **Maiuscole e accenti** come la ricerca del vault: le maiuscole non
//   contano, gli accenti sì, e una parola scritta in NFD (macOS) è la stessa
//   scritta in NFC. È `resolutionKey` di `rules/mirrored.ts`, la chiave con
//   cui il client confronta due nomi: qui non se ne scrive un'altra.
// - **Un risultato** è una scheda o un filo, una volta sola anche se la parola
//   ci compare più volte; vanno nell'ordine di lettura, e un filo viene subito
//   dopo la scheda da cui parte.
// - **Il velo** (`findMark`, `applyFindMarks`): le schede che non c'entrano
//   prendono `data-card-veiled`, quelle trovate `data-card-found` (`current`
//   la scheda del risultato di adesso, `match` le altre); il DOM si scrive solo
//   dove cambia, come `applyCardDetails` di `lod.ts`. I due capi di un filo
//   trovato non si velano: il filo si legge fra le sue schede.
//
// Qui niente DOM vivo oltre agli attributi, niente tela: funzioni che la tela
// e i test usano senza montare niente. La pagina di riferimento è
// `docs/reference/canvas-view.md` («Cercare»).

import type { QueryExpr } from "../../host/contract";
import { matchingDocuments, searchExpression } from "../../host/query";
import { resolutionKey } from "../../rules/mirrored";
import { cardKindOf } from "./cards";
import type { CanvasDocument, CanvasNode } from "./model";
import { readingOrder } from "./reading-order";

/** La chiave di un testo per la ricerca, come la ricerca del vault: le maiuscole non contano, gli accenti sì, NFC e NFD sono uguali. */
export function findKey(text: string): string {
  return resolutionKey(text);
}

/** Un risultato: una scheda o un filo, con le schede che la vista inquadra quando ci si arriva. */
export interface FindTarget {
  readonly kind: "node" | "edge";
  readonly id: string;
  /** Le schede da inquadrare: la scheda stessa, o i due capi del filo che ci sono. */
  readonly nodes: readonly string[];
}

/** Un posto che si può trovare, in ordine di lettura, col suo testo già normalizzato. */
interface FindEntry {
  readonly target: FindTarget;
  /** Il testo che si cerca, già passato per `findKey`; `""` se non ha testo suo. */
  readonly key: string;
  /** Il file della nota, se è una scheda di nota: il suo contenuto lo sa l'indice. */
  readonly note: string | null;
}

/** Il documento della lavagna letto per la ricerca: lo costruisce `boardFindIndex`. */
export interface BoardFindIndex {
  readonly entries: readonly FindEntry[];
  /** I file delle note della lavagna, una volta ciascuno, nell'ordine di lettura. */
  readonly notes: readonly string[];
}

/** Il percorso di un file senza `#…`: `Nota.md#Titolo` → `Nota.md`. */
function fileOf(node: CanvasNode): string {
  const file = typeof node.file === "string" ? node.file : "";
  const hash = file.indexOf("#");
  return hash < 0 ? file : file.slice(0, hash);
}

/** Il testo di una scheda che il file della lavagna dice: quello che la ricerca guarda. */
function nodeText(node: CanvasNode): string {
  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "group":
      return typeof node.label === "string" ? node.label : "";
    case "file":
      // Il nome, non la cartella: cercare il nome di una cartella non deve
      // trovare tutte le schede che ci stanno dentro.
      return fileOf(node).split("/").pop() ?? "";
    case "link":
      return typeof node.url === "string" ? node.url : "";
  }
}

const INDEXES = new WeakMap<CanvasDocument, BoardFindIndex>();

/**
 * Il documento `doc` letto per la ricerca: le schede in ordine di lettura,
 * ognuna seguita dai fili che partono da lei (i fili senza la scheda da cui
 * partono, alla fine). Si costruisce una volta per documento: la tela ne fa
 * uno nuovo a ogni modifica, e quello di prima si dimentica da solo.
 */
export function boardFindIndex(doc: CanvasDocument): BoardFindIndex {
  const known = INDEXES.get(doc);
  if (known) return known;
  const present = new Set(doc.nodes.map((node) => node.id));
  const edgesFrom = new Map<string, FindEntry[]>();
  const orphans: FindEntry[] = [];
  for (const edge of doc.edges) {
    const label = typeof edge.label === "string" ? edge.label : "";
    const ends = [edge.fromNode, edge.toNode].filter((id, index, all) => present.has(id) && all.indexOf(id) === index);
    const entry: FindEntry = { target: { kind: "edge", id: edge.id, nodes: ends }, key: label === "" ? "" : findKey(label), note: null };
    const list = present.has(edge.fromNode) ? edgesFrom.get(edge.fromNode) : orphans;
    if (list) list.push(entry);
    else edgesFrom.set(edge.fromNode, [entry]);
  }
  const entries: FindEntry[] = [];
  const notes: string[] = [];
  const seenNotes = new Set<string>();
  for (const { node } of readingOrder(doc.nodes)) {
    const text = nodeText(node);
    const note = node.type === "file" && cardKindOf(node) === "note" ? fileOf(node) : null;
    if (note !== null && note !== "" && !seenNotes.has(note)) {
      seenNotes.add(note);
      notes.push(note);
    }
    entries.push({ target: { kind: "node", id: node.id, nodes: [node.id] }, key: text === "" ? "" : findKey(text), note: note || null });
    const out = edgesFrom.get(node.id);
    if (out) entries.push(...out);
  }
  entries.push(...orphans);
  const index: BoardFindIndex = { entries, notes };
  INDEXES.set(doc, index);
  return index;
}

/**
 * I risultati di `query` nella lavagna, in ordine di lettura: le schede e i
 * fili il cui testo la contiene, e le schede delle note in `noteHits` (i file
 * che l'indice del vault ha trovato). Una ricerca vuota non trova niente.
 */
export function boardMatches(index: BoardFindIndex, query: string, noteHits: ReadonlySet<string> = EMPTY): FindTarget[] {
  const needle = findKey(query);
  if (needle === "") return [];
  const out: FindTarget[] = [];
  for (const entry of index.entries) {
    if ((entry.key !== "" && entry.key.includes(needle)) || (entry.note !== null && noteHits.has(entry.note))) out.push(entry.target);
  }
  return out;
}

const EMPTY: ReadonlySet<string> = new Set();

// --- le note: la domanda all'indice --------------------------------------------

/**
 * La domanda all'indice per il contenuto delle note `notes`: la riga come la
 * legge la ricerca del vault (`searchExpression`), ristretta alle note della
 * lavagna con il predicato `docs` in ogni clausola. `null` se non c'è niente
 * da chiedere: nessuna nota, una riga vuota, o una riga che non è una ricerca
 * (una virgoletta aperta): allora conta solo il file della lavagna.
 */
export function notesQuery(query: string, notes: readonly string[]): QueryExpr | null {
  if (notes.length === 0 || query.trim() === "") return null;
  let expr: QueryExpr;
  try {
    expr = searchExpression(query);
  } catch {
    return null;
  }
  if (expr.any.length === 0) return null;
  const only = { negated: false, predicate: { kind: "docs" as const, docs: [...notes] } };
  return { any: expr.any.map((clause) => ({ all: [...clause.all, only] })) };
}

/** Chi chiede all'indice quali note contengono `query`: i loro file. Una promessa rifiutata vuol dire «senza indice». */
export type FindNotesPort = (query: string, notes: readonly string[]) => Promise<ReadonlySet<string>>;

/**
 * La porta di serie: una richiesta `documents` sola, senza estratti (la barra
 * non li mostra), con una finestra grande quanto le note della lavagna.
 */
export const searchBoardNotes: FindNotesPort = async (query, notes) => {
  const matching = notesQuery(query, notes);
  if (matching === null) return EMPTY;
  const page = await matchingDocuments(matching, { offset: 0, limit: notes.length }, "omit");
  return new Set(page.items.map((match) => match.doc));
};

// --- il velo ------------------------------------------------------------------

/** Che cosa è una scheda per la ricerca di adesso: `null` senza ricerca, o per i capi di un filo trovato. */
export type FindMark = "current" | "match" | "veiled" | null;

/**
 * Il segno di ogni scheda con i risultati `matches` e quello di adesso
 * (`current`, `-1` per nessuno): una funzione da id a segno. Senza risultati
 * (ricerca vuota) nessuna scheda è segnata; con una ricerca che non trova
 * niente tutte sono velate.
 */
export function findMarks(matches: readonly FindTarget[] | null, current: number): (id: string) => FindMark {
  if (matches === null) return () => null;
  const found = new Set<string>();
  const ends = new Set<string>();
  for (const target of matches) {
    if (target.kind === "node") found.add(target.id);
    else for (const id of target.nodes) ends.add(id);
  }
  const now = current >= 0 ? matches[current] : undefined;
  const currentId = now?.kind === "node" ? now.id : null;
  return (id) => {
    if (id === currentId) return "current";
    if (found.has(id)) return "match";
    return ends.has(id) ? null : "veiled";
  };
}

/** Una scheda come la legge `applyFindMarks`: il suo nodo e il segno che ha adesso (tenuto dalla tela). */
export interface FindMarkTarget {
  readonly article: HTMLElement;
  find: FindMark;
}

/**
 * Mette a ogni scheda il segno `markOf(id)`, scrivendo il DOM solo dove
 * cambia (`data-card-veiled`, `data-card-found`). Ritorna quante schede sono
 * cambiate.
 */
export function applyFindMarks(targets: Iterable<readonly [string, FindMarkTarget]>, markOf: (id: string) => FindMark): number {
  let changed = 0;
  for (const [id, target] of targets) {
    const next = markOf(id);
    if (target.find === next) continue;
    const article = target.article;
    if (next === "veiled") article.dataset.cardVeiled = "";
    else delete article.dataset.cardVeiled;
    if (next === "current" || next === "match") article.dataset.cardFound = next;
    else delete article.dataset.cardFound;
    target.find = next;
    changed++;
  }
  return changed;
}
