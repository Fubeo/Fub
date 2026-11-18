// Invio in una formula a blocco (T65, E27): va a capo e allinea gli uguali, il
// modo di scrivere i passaggi di un conto. La prima volta la formula entra in
// un `aligned`, col primo `=` allineato (`&=`) e una riga nuova che comincia
// con `&= `; dopo, ogni Invio aggiunge una riga così. Ctrl Invio o Esc
// finiscono, e quelli li decide il riquadro (`editor.ts`). Senza DOM.
import type { MathState } from "./edit";

const BEGIN = "\\begin{aligned}";
const END = "\\end{aligned}";
/// Ciò che chiude una riga e apre la prossima, allineata sull'uguale.
export const NEW_ROW = " \\\\\n&= ";

/// La profondità delle graffe da `from` a `to`, saltando ciò che una `\`
/// protegge.
function depth(tex: string, from: number, to: number): number {
  let level = 0;
  for (let at = from; at < to; at++) {
    const ch = tex[at];
    if (ch === "\\") at++;
    else if (ch === "{") level++;
    else if (ch === "}") level--;
  }
  return level;
}

/// Il primo `=` fuori dalle graffe, o -1.
function firstEquals(tex: string): number {
  let level = 0;
  for (let at = 0; at < tex.length; at++) {
    const ch = tex[at];
    if (ch === "\\") {
      at++;
      continue;
    }
    if (ch === "{") level++;
    else if (ch === "}") level--;
    else if (ch === "=" && level === 0) return at;
  }
  return -1;
}

/// Dove finisce la riga dell'`aligned` che contiene `from`: il prossimo `\\`
/// fuori dalle graffe, o la fine del corpo senza gli spazi in coda.
function rowEnd(tex: string, from: number, bodyTo: number): number {
  let level = 0;
  for (let at = from; at < bodyTo; at++) {
    const ch = tex[at];
    if (ch === "\\") {
      if (tex[at + 1] === "\\" && level === 0) return trimEnd(tex, from, at);
      at++;
      continue;
    }
    if (ch === "{") level++;
    else if (ch === "}") level = Math.max(0, level - 1);
  }
  return trimEnd(tex, from, bodyTo);
}

function trimEnd(tex: string, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(tex[end - 1]!)) end--;
  return end;
}

/// Invio in una formula a blocco: la formula col suo `aligned` e una riga
/// nuova, il cursore in fondo alla riga nuova, dopo `&= `.
export function alignEnter(state: MathState): MathState {
  const { tex, caret } = state;
  const begin = tex.indexOf(BEGIN);
  const end = begin < 0 ? -1 : tex.indexOf(END, begin + BEGIN.length);
  if (begin >= 0 && end >= 0) {
    const bodyFrom = begin + BEGIN.length;
    // Nel corpo, fuori dalle graffe, la riga si spezza dove sta il cursore;
    // dentro un pezzo (una frazione, un testo) o fuori dall'`aligned` la riga
    // nuova va dopo quella del cursore, che resta intera.
    const inside = caret >= bodyFrom && caret <= end;
    const at = inside && depth(tex, bodyFrom, caret) === 0
      ? trimEnd(tex, bodyFrom, caret)
      : rowEnd(tex, inside ? caret : bodyFrom, end);
    // Il resto della riga spezzata va dopo `&= `, senza gli spazi di prima.
    let rest = at;
    while (rest < end && (tex[rest] === " " || tex[rest] === "\t")) rest++;
    const next = tex.slice(0, at) + NEW_ROW + tex.slice(rest);
    return { tex: next, caret: at + NEW_ROW.length };
  }
  const body = tex.trim();
  const equals = firstEquals(body);
  const aligned = equals < 0 ? body : `${body.slice(0, equals)}&${body.slice(equals)}`;
  const head = `${BEGIN}\n${aligned}${NEW_ROW}`;
  return { tex: `${head}\n${END}`, caret: head.length };
}

