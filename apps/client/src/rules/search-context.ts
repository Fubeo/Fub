// Il contesto di un'occorrenza: le righe attorno al punto che ha combaciato,
// lette dal sorgente della nota. Il kernel dà un estratto breve per nota e la
// posizione di ogni occorrenza; «più contesto» è la shell che rilegge il testo
// attorno a quella posizione, senza chiedere un estratto più lungo a ogni
// ricerca. **Solo logica**, il DOM sta in `panels/search.ts`.
import type { Span } from "../host/contract";

/// Quanti byte al massimo per lato: un paragrafo su una riga sola non diventa
/// un muro di testo.
const SIDE_LIMIT = 300;
const NEWLINE = 0x0a;
const ELLIPSIS = "…";

export interface OccurrenceContext {
  readonly text: string;
  /// L'occorrenza dentro `text`, in byte, per `highlighted`.
  readonly highlight: Span;
}

function lineStart(bytes: Uint8Array, pos: number): number {
  let at = pos;
  while (at > 0 && bytes[at - 1] !== NEWLINE) at--;
  return at;
}

function lineEnd(bytes: Uint8Array, pos: number): number {
  let at = pos;
  while (at < bytes.length && bytes[at] !== NEWLINE) at++;
  return at;
}

/// Un byte di continuazione UTF-8 (`10xxxxxx`) non è l'inizio di un carattere.
function charBoundary(bytes: Uint8Array, pos: number): number {
  let at = pos;
  while (at < bytes.length && (bytes[at]! & 0xc0) === 0x80) at++;
  return at;
}

/// La riga dell'occorrenza `[start, end)` (byte del sorgente) con `around`
/// righe prima e dopo. Un sorgente cambiato dopo l'indice può avere la
/// posizione oltre la fine: si stringe al testo che c'è.
export function occurrenceContext(source: Uint8Array, start: number, end: number, around = 1): OccurrenceContext {
  const from0 = Math.min(Math.max(start, 0), source.length);
  const to0 = Math.min(Math.max(end, from0), source.length);
  let from = lineStart(source, from0);
  for (let k = 0; k < around && from > 0; k++) from = lineStart(source, from - 1);
  let to = lineEnd(source, to0);
  for (let k = 0; k < around && to < source.length; k++) to = lineEnd(source, to + 1);
  let head = "";
  let tail = "";
  if (from0 - from > SIDE_LIMIT) {
    from = charBoundary(source, from0 - SIDE_LIMIT);
    head = ELLIPSIS;
  }
  if (to - to0 > SIDE_LIMIT) {
    to = charBoundary(source, to0 + SIDE_LIMIT);
    tail = ELLIPSIS;
  }
  const decoder = new TextDecoder();
  // I `\r` dei terminatori CRLF non si disegnano: si tolgono e se ne tiene il
  // conto, perché l'occorrenza resti sulle sue parole.
  // Le righe vuote ai bordi non sono contesto: lascerebbero un vuoto.
  const before = decoder.decode(source.subarray(from, from0)).replace(/\r/gu, "").replace(/^(?:[ \t]*\n)+/u, "");
  const match = decoder.decode(source.subarray(from0, to0)).replace(/\r/gu, "");
  const after = decoder.decode(source.subarray(to0, to)).replace(/\r/gu, "").replace(/(?:\n[ \t]*)+$/u, "");
  const encoder = new TextEncoder();
  const offset = encoder.encode(head + before).length;
  return {
    text: head + before + match + after + tail,
    highlight: { start: offset, end: offset + encoder.encode(match).length },
  };
}
