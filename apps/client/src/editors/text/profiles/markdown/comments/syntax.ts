// I commenti nel testo, come li legge la shell: CriticMarkup,
// `{==passo==}{>>messaggio<<}`.
//
// È la gemella di `crates/fub-format-markdown/src/parse/comments.rs`, che li
// legge nel file per il modello: le regole sono quelle di
// `docs/reference/note-conventions.md`, e il corpus (`corpus.test.ts`, la
// famiglia «commenti») tiene le due letture d'accordo sulle stesse sorgenti.
// Qui la grammatica non conosce l'albero: chi la chiama le dà i tratti di
// testo di un contenitore (`commentLevels`), cioè ciò che per comrak sono i
// nodi di testo di un paragrafo, di un titolo, di una cella o di un'enfasi.
// Un segno dentro codice, formule, link, wikilink, HTML o una nota in riga non
// cade in nessun tratto, e non apre niente.
import type { NativeInline } from "../render-inline";

export interface Range {
  readonly from: number;
  readonly to: number;
}

/// Il passo di un commento: `{==` da `from` a `contentFrom`, il testo fino a
/// `contentTo`, `==}` fino a `to`.
export interface CommentPassage {
  readonly from: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly to: number;
}

/// Un commento: il passo, se c'è, e i messaggi in fila che lo seguono, ognuno
/// coi suoi due segni. `from`–`to` è tutto, dal primo segno all'ultimo.
export interface CommentThread {
  readonly from: number;
  readonly to: number;
  readonly passage: CommentPassage | null;
  readonly messages: readonly Range[];
}

/// Il nome della sintassi che li accende, la stessa dei commenti `%%…%%`.
export const COMMENTS_SYNTAX = "fub:comments";

/// Ogni segno è lungo tre caratteri.
export const MARK_LEN = 3;

type Mark = "range-open" | "range-close" | "message-open" | "message-close";

const MARKS: Readonly<Record<string, Mark>> = {
  "{==": "range-open",
  "==}": "range-close",
  "{>>": "message-open",
  "<<}": "message-close",
};

/// Un commento ha sempre un messaggio: senza `{>>` non c'è niente da cercare.
export function mayHaveComments(text: string): boolean {
  return text.includes("{>>");
}

function escapedAt(text: string, at: number): boolean {
  let backslashes = 0;
  for (let j = at - 1; j >= 0 && text.charCodeAt(j) === 92; j -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/// I segni dei tratti `runs`, in ordine. `text` comincia a `base`; i tratti
/// sono posizioni assolute, ordinati e disgiunti. Un segno sta tutto in un
/// tratto, come in un nodo di testo; `{==` e `{>>` dopo una `\` dispari sono i
/// caratteri.
function marksOf(text: string, base: number, runs: readonly Range[]): { at: number; mark: Mark }[] {
  const out: { at: number; mark: Mark }[] = [];
  for (const run of runs) {
    const from = run.from - base;
    const to = run.to - base;
    for (let at = text.indexOf("{", from), close = text.indexOf("}", from); ;) {
      // Le aperture cominciano con `{`, le chiusure finiscono con `}`: si
      // guarda ogni candidato una volta, nell'ordine.
      const next = Math.min(at < 0 ? Infinity : at, close < 0 ? Infinity : close - 2);
      if (next === Infinity || next + MARK_LEN > to) break;
      if (next >= from) {
        const mark = MARKS[text.slice(next, next + MARK_LEN)];
        if (mark && !((mark === "range-open" || mark === "message-open") && escapedAt(text, next))) {
          out.push({ at: base + next, mark });
        }
      }
      if (next === at) at = text.indexOf("{", at + 1);
      else close = text.indexOf("}", close + 1);
    }
  }
  return out;
}

/// I commenti di un livello di un contenitore: i tratti `runs` sono il suo
/// testo, e `text` (che comincia a `base`) lo copre. È `matched` di
/// `comments.rs`: un passo si chiude sul primo `==}` se nessun'altra apertura
/// viene prima, ed è un commento solo se lo segue subito un messaggio; ogni
/// messaggio si chiude sul primo `<<}` e sta su una riga; i messaggi in fila
/// sono una discussione.
export function scanComments(text: string, base: number, runs: readonly Range[]): CommentThread[] {
  const marks = marksOf(text, base, runs);
  if (marks.length === 0) return [];
  const firstFrom = (pos: number): number => {
    let low = 0;
    let high = marks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (marks[middle]!.at < pos) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const opensMessageAt = (pos: number) => marks[firstFrom(pos)]?.at === pos && marks[firstFrom(pos)]!.mark === "message-open";
  const chain = (start: number): Range[] => {
    const messages: Range[] = [];
    let pos = start;
    while (opensMessageAt(pos)) {
      let close = firstFrom(pos + MARK_LEN);
      while (close < marks.length && marks[close]!.mark !== "message-close") close += 1;
      const closing = marks[close];
      if (!closing) break;
      const body = text.slice(pos - base, closing.at - base);
      if (body.includes("\n") || body.includes("\r")) break;
      messages.push({ from: pos, to: closing.at + MARK_LEN });
      pos = closing.at + MARK_LEN;
    }
    return messages;
  };
  const threads: CommentThread[] = [];
  let floor = 0;
  for (let index = 0; index < marks.length; index += 1) {
    const { at, mark } = marks[index]!;
    if (at < floor) continue;
    let passage: CommentPassage | null = null;
    let messages: Range[];
    if (mark === "range-open") {
      let closing: { at: number; mark: Mark } | undefined;
      for (let next = index + 1; next < marks.length; next += 1) {
        const candidate = marks[next]!;
        if (candidate.at < at + MARK_LEN || candidate.mark === "message-close") continue;
        closing = candidate;
        break;
      }
      if (!closing || closing.mark !== "range-close") continue;
      passage = { from: at, contentFrom: at + MARK_LEN, contentTo: closing.at, to: closing.at + MARK_LEN };
      messages = chain(passage.to);
    } else if (mark === "message-open") {
      messages = chain(at);
    } else {
      continue;
    }
    const last = messages[messages.length - 1];
    if (!last) continue;
    floor = last.to;
    threads.push({ from: passage?.from ?? messages[0]!.from, to: last.to, passage, messages });
  }
  return threads;
}

/// I livelli di testo di un contenitore da `from` a `to`: il contenitore, e il
/// contenuto di ogni inline nativo che ne ha uno (un'enfasi, l'etichetta di un
/// link), ognuno coi suoi tratti. Da un livello si tolgono gli inline nativi e
/// gli `atoms` (formule, wikilink, note in riga, segni di blocco) che vi
/// cadono; quello che lo contiene tutto è il suo padrone, e resta.
export function commentLevels(
  from: number,
  to: number,
  natives: readonly NativeInline[],
  atoms: readonly Range[],
): Range[][] {
  const levels: Range[] = [{ from, to }];
  for (const native of natives) if (native.content && native.content.from < native.content.to) levels.push(native.content);
  const solid: Range[] = [...natives, ...atoms].filter((range) => range.from < range.to).sort((a, b) => a.from - b.from);
  return levels.map((level) => {
    const runs: Range[] = [];
    let at = level.from;
    for (const cut of solid) {
      if (cut.to <= level.from || cut.from >= level.to) continue;
      if (cut.from <= level.from && level.to <= cut.to) continue;
      if (cut.from > at) runs.push({ from: at, to: cut.from });
      at = Math.max(at, cut.to);
    }
    if (at < level.to) runs.push({ from: at, to: level.to });
    return runs;
  });
}

/// I commenti di un contenitore, livello per livello, in ordine.
export function containerThreads(
  text: string,
  base: number,
  natives: readonly NativeInline[],
  atoms: readonly Range[],
): CommentThread[] {
  if (!mayHaveComments(text)) return [];
  const threads: CommentThread[] = [];
  for (const runs of commentLevels(base, base + text.length, natives, atoms)) {
    if (runs.length > 0) threads.push(...scanComments(text, base, runs));
  }
  return threads.sort((a, b) => a.from - b.from);
}

/// Ciò che di un commento non è testo della nota: i due segni del passo e i
/// messaggi, in ordine.
export function threadCuts(thread: CommentThread): Range[] {
  const cuts: Range[] = [];
  if (thread.passage) cuts.push({ from: thread.passage.from, to: thread.passage.contentFrom });
  if (thread.passage) cuts.push({ from: thread.passage.contentTo, to: thread.passage.to });
  cuts.push(...thread.messages);
  return cuts;
}

/// La coda di un commento: la chiusura del passo e i messaggi, che stanno
/// attaccati e si nascondono come un pezzo solo.
export function threadTail(thread: CommentThread): Range {
  return { from: thread.passage ? thread.passage.contentTo : thread.from, to: thread.to };
}
