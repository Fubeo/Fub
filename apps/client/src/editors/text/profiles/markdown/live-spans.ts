// Gli intervalli che la Live interroga a ogni battuta, letti ordinati invece
// che scorrendo ogni volta tutta la lista (PERF-12): le esclusioni del livello
// regex, gli inline nativi e i blocchi opachi di una riga, i pezzi sostituiti
// davanti alla punteggiatura, i segni intorno a una pastiglia. Ogni funzione
// risponde come il giro lineare che sostituisce, anche sugli intervalli vuoti
// e su quelli che si sovrappongono: le prove (`live-spans.test.ts`) la
// confrontano con quel giro.

export interface Span {
  readonly from: number;
  readonly to: number;
}

/// Il primo indice di `values` (ordinato) con un valore maggiore di `value`.
function upperBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/// Il primo indice di `values` (ordinato) con un valore almeno `value`.
function lowerBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/// Intervalli `[from, to)` ordinati per inizio, col massimo delle fini fino a
/// ogni posto: chiedere se qualcuno tocca un tratto costa una ricerca binaria.
/// Se ne aggiungono anche dopo; in coda, nell'ordine del testo, costa poco.
export class SpanIndex {
  private readonly froms: number[] = [];
  private readonly tos: number[] = [];
  /// `maxTo[i]`: la fine più lontana fra gli intervalli da 0 a `i`.
  private readonly maxTo: number[] = [];

  constructor(spans: Iterable<Span> = []) {
    const sorted = [...spans].sort((a, b) => a.from - b.from);
    for (const span of sorted) this.add(span);
  }

  get size(): number {
    return this.froms.length;
  }

  add(span: Span): void {
    const at = upperBound(this.froms, span.from);
    if (at === this.froms.length) {
      this.froms.push(span.from);
      this.tos.push(span.to);
      this.maxTo.push(Math.max(span.to, at > 0 ? this.maxTo[at - 1]! : -Infinity));
      return;
    }
    this.froms.splice(at, 0, span.from);
    this.tos.splice(at, 0, span.to);
    this.maxTo.splice(at, 0, 0);
    for (let i = at; i < this.froms.length; i++) {
      this.maxTo[i] = Math.max(this.tos[i]!, i > 0 ? this.maxTo[i - 1]! : -Infinity);
    }
  }

  /// Se qualche intervallo ha `from < b` e `to > a`: la negazione di «ognuno
  /// finisce entro `a` o comincia da `b`», anche per un tratto vuoto.
  overlaps(a: number, b: number): boolean {
    const last = lowerBound(this.froms, b) - 1;
    return last >= 0 && this.maxTo[last]! > a;
  }

  /// Se qualche intervallo contiene la posizione: `from <= at < to`.
  covers(at: number): boolean {
    return this.overlaps(at, at + 1);
  }
}

/// Gli intervalli di una lista che toccano una riga, per righe che scendono:
/// un cursore entra negli intervalli che cominciano prima della fine della
/// riga e lascia quelli finiti, così ogni intervallo si guarda una volta per
/// le righe che attraversa. Restituisce ciò che darebbe
/// `spans.filter((s) => s.from < to && from < s.to)`, nello stesso ordine.
export class RowSweep<T extends Span> {
  private readonly order: number[];
  private next = 0;
  private open: number[] = [];

  constructor(private readonly spans: readonly T[]) {
    this.order = spans.map((_, index) => index).sort((a, b) => spans[a]!.from - spans[b]!.from || a - b);
  }

  /// Le righe vanno chieste con `from` e `to` che non scendono mai.
  at(from: number, to: number): T[] {
    const { spans, order } = this;
    let added = false;
    while (this.next < order.length && spans[order[this.next]!]!.from < to) {
      this.open.push(order[this.next]!);
      this.next++;
      added = true;
    }
    if (this.open.length === 0) return [];
    this.open = this.open.filter((index) => spans[index]!.to > from);
    if (added) this.open.sort((a, b) => a - b);
    return this.open.map((index) => spans[index]!);
  }
}

/// I tratti coperti da una lista di intervalli, uniti: due che si toccano
/// fanno un tratto solo, come per chi guarda carattere per carattere.
export class Coverage {
  private readonly froms: number[] = [];
  private readonly tos: number[] = [];

  constructor(spans: readonly Span[]) {
    const sorted = spans.filter((span) => span.from < span.to).sort((a, b) => a.from - b.from);
    for (const span of sorted) {
      const last = this.tos.length - 1;
      if (last >= 0 && span.from <= this.tos[last]!) this.tos[last] = Math.max(this.tos[last]!, span.to);
      else {
        this.froms.push(span.from);
        this.tos.push(span.to);
      }
    }
  }

  /// Se ogni carattere da `a` a `b` sta in qualche intervallo (vero per un
  /// tratto vuoto).
  covers(a: number, b: number): boolean {
    if (a >= b) return true;
    const at = upperBound(this.froms, a) - 1;
    return at >= 0 && this.tos[at]! >= b;
  }
}

/// Il tratto più piccolo che contiene `from`–`to` e che nessun segno
/// attraversa: un segno che ne passa un bordo, senza contenerlo e senza
/// starci dentro, lo allarga fino a sé, finché non ce ne sono più. Il tratto
/// è unico (fra quelli che nessun segno attraversa, l'intersezione di due lo è
/// ancora), quindi l'ordine in cui si guardano i segni non conta: due finestre
/// sui segni ordinati per inizio e per fine, che si allargano soltanto,
/// guardano ogni segno una volta. I segni vanno dati non vuoti.
export function grownSpan(from: number, to: number, marks: readonly Span[]): Span {
  const byFrom = [...marks].sort((a, b) => a.from - b.from);
  const byTo = [...marks].sort((a, b) => a.to - b.to);
  const n = marks.length;
  // I segni che cominciano dentro (`from < m.from < to`): chi finisce oltre
  // `to` passa il bordo destro.
  let startHigh = upperBound(byFrom.map((mark) => mark.from), from);
  let startLow = startHigh;
  // I segni che finiscono dentro (`from < m.to < to`): chi comincia prima di
  // `from` passa il bordo sinistro.
  let endHigh = upperBound(byTo.map((mark) => mark.to), from);
  let endLow = endHigh;
  for (let moved = true; moved; ) {
    moved = false;
    while (startHigh < n && byFrom[startHigh]!.from < to) {
      to = Math.max(to, byFrom[startHigh++]!.to);
      moved = true;
    }
    while (startLow > 0 && byFrom[startLow - 1]!.from > from) {
      to = Math.max(to, byFrom[--startLow]!.to);
      moved = true;
    }
    while (endHigh < n && byTo[endHigh]!.to < to) {
      from = Math.min(from, byTo[endHigh++]!.from);
      moved = true;
    }
    while (endLow > 0 && byTo[endLow - 1]!.to > from) {
      from = Math.min(from, byTo[--endLow]!.from);
      moved = true;
    }
  }
  return { from, to };
}
