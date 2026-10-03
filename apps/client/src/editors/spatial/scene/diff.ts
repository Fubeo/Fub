// La `TextOperation` di un'operazione sulla scena (`operazioni.md` §6): le
// modifiche fra il testo di prima e quello di dopo, tutti e due a LF.
//
// Il motore cambia l'albero della sorgente, e il testo nuovo è l'albero
// scritto; qui si trova che cosa è cambiato. Prima le righe comuni in testa e
// in coda; poi, nel mezzo, un diff per righe di Myers, perché la scrittura
// canonica mette un elemento per riga: un `move` è una riga tolta e una
// aggiunta, un `page` il tag della radice e la riga della carta, e quello che
// sta fra le due resta fuori dalla patch.
//
// Ogni blocco prende poi la forma di §6:
//
// - righe solo tolte o solo aggiunte diventano `"\n" + rientro + elemento`,
//   in coda alla riga che le precede, come le descrivono `add` e `remove`;
// - righe cambiate perdono il prefisso e il suffisso comuni, così un `set`
//   di `fill` tocca il valore e non la riga intera.
//
// Il diff ha un tetto: oltre `MAX_SCRIPT` righe di differenza il mezzo resta
// una patch sola, che è sempre giusta.

import { operationFromText, operationYields, type TextEdit, type TextOperation } from "../../core/text-operation";

/// Quante righe tolte o aggiunte cerca al massimo il diff, oltre le quali il
/// mezzo diventa una patch sola.
export const MAX_SCRIPT = 512;

/// Le righe di `text` con il loro `\n`; l'ultima può non averlo.
function lines(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", from)) {
    out.push(text.slice(from, i + 1));
    from = i + 1;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

/// Un blocco di righe: `[a0, a1)` di prima diventano `[b0, b1)` di dopo.
interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/// I blocchi del diff di Myers fra `a` e `b`, in ordine; `null` se la
/// differenza supera `max` righe.
function myers(a: readonly string[], b: readonly string[], max: number): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // `trace[d]` è la frontiera prima del passo `d`.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  // Il cammino all'indietro: ogni passo è una riga tolta o aggiunta, fra due
  // diagonali di righe uguali.
  const steps: Hunk[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const frontier = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = frontier[offset + prevK]!;
    const prevY = prevX - prevK;
    steps.push(down ? { a0: prevX, a1: prevX, b0: prevY, b1: prevY + 1 } : { a0: prevX, a1: prevX + 1, b0: prevY, b1: prevY });
    x = prevX;
    y = prevY;
  }
  steps.reverse();

  const hunks: Hunk[] = [];
  for (const step of steps) {
    const last = hunks[hunks.length - 1];
    if (last !== undefined && last.a1 === step.a0 && last.b1 === step.b0) {
      last.a1 = step.a1;
      last.b1 = step.b1;
    } else {
      hunks.push({ ...step });
    }
  }
  return hunks;
}

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/// La modifica che porta `deleted` in `inserted` a partire da `from`, senza i
/// caratteri comuni ai bordi; `null` se i due testi sono uguali.
function tight(from: number, deleted: string, inserted: string): TextEdit | null {
  if (deleted === inserted) return null;
  let prefix = 0;
  const minimum = Math.min(deleted.length, inserted.length);
  while (prefix < minimum && deleted.charCodeAt(prefix) === inserted.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < minimum - prefix
    && deleted.charCodeAt(deleted.length - 1 - suffix) === inserted.charCodeAt(inserted.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Una coppia surrogata non si taglia a metà: il bordo torna indietro di uno.
  if (prefix > 0 && isHigh(deleted.charCodeAt(prefix - 1))) prefix--;
  if (suffix > 0 && isLow(deleted.charCodeAt(deleted.length - suffix))) suffix--;
  return {
    from: from + prefix,
    to: from + deleted.length - suffix,
    deleted: deleted.slice(prefix, deleted.length - suffix),
    inserted: inserted.slice(prefix, inserted.length - suffix),
  };
}

/// Righe solo tolte o solo aggiunte, `text` a partire da `at` in `before`,
/// spostate all'indietro finché il testo comincia con l'a capo che le
/// precede: la forma di §6. Spostare un blocco così non cambia il risultato,
/// perché il carattere che entra a sinistra è quello che esce a destra. Se
/// nessuna posizione comincia con un a capo, il blocco resta dov'è.
function slide(before: string, at: number, text: string): [at: number, text: string] {
  let position = at;
  let rotated = text;
  while (position > 0 && rotated.length > 0 && before.charCodeAt(position - 1) === rotated.charCodeAt(rotated.length - 1)) {
    position--;
    rotated = rotated.slice(-1) + rotated.slice(0, -1);
    if (rotated.charCodeAt(0) === 0x0a) return [position, rotated];
  }
  return [at, text];
}

/// L'inizio della riga che contiene l'indice `i` di `text`.
function lineStart(text: string, i: number): number {
  return i <= 0 ? 0 : text.lastIndexOf("\n", i - 1) + 1;
}

/// L'operazione che porta `before` in `after`, tutti e due a LF, nella forma
/// di §6. Si verifica applicandola; se non dà `after`, che sarebbe un errore
/// di questo modulo, si ripiega su `operationFromText`, che è sempre giusta.
export function sceneOperation(before: string, after: string, max: number = MAX_SCRIPT): TextOperation {
  const whole = operationFromText(before, after);
  const only = whole.edits[0];
  if (only === undefined) return whole;

  // Le righe comuni: il prefisso si ferma all'inizio della riga in cui i due
  // testi divergono, il suffisso all'inizio della riga dopo.
  const head = lineStart(before, only.from);
  let tailBefore = only.to;
  if (tailBefore > 0 && tailBefore < before.length && before.charCodeAt(tailBefore - 1) !== 0x0a) {
    const next = before.indexOf("\n", tailBefore);
    tailBefore = next < 0 ? before.length : next + 1;
  }
  const delta = after.length - before.length;
  const tailAfter = tailBefore + delta;
  if (tailAfter < head) return whole;
  const a = lines(before.slice(head, tailBefore));
  const b = lines(after.slice(head, tailAfter));
  const hunks = myers(a, b, max);
  if (hunks === null) return whole;

  const startsA = new Array<number>(a.length + 1);
  startsA[0] = head;
  for (let i = 0; i < a.length; i++) startsA[i + 1] = startsA[i]! + a[i]!.length;
  const edits: TextEdit[] = [];
  for (const hunk of hunks) {
    const from = startsA[hunk.a0]!;
    const deleted = a.slice(hunk.a0, hunk.a1).join("");
    const inserted = b.slice(hunk.b0, hunk.b1).join("");
    if (deleted === "" || inserted === "") {
      const [at, text] = slide(before, from, deleted === "" ? inserted : deleted);
      if (deleted === "") edits.push({ from: at, to: at, deleted: "", inserted: text });
      else edits.push({ from: at, to: at + text.length, deleted: text, inserted: "" });
      continue;
    }
    const edit = tight(from, deleted, inserted);
    if (edit !== null) edits.push(edit);
  }
  const operation: TextOperation = { beforeLength: before.length, afterLength: after.length, edits };
  return operationYields(before, operation, after) ? operation : whole;
}
