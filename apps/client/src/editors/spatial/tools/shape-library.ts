// Le raccolte del pannello «Forme»: le forme di base, i diagrammi di flusso,
// i fumetti, le frecce piene e la scuola. Ogni forma è una ricetta: dato il
// riquadro che deve occupare, dà i suoi pezzi, con la geometria e niente
// altro; chi la inserisce dà a ogni pezzo l'id, il colore e lo spessore, e al
// tutto il nome nel `<title>`.
//
// - **Un pezzo è un elemento del formato** (formato della scena, §4 e §6): un
//   `path`, un `rect`, un'ellisse, una linea, una freccia o un poligono
//   sintetici, o un testo d'una riga. Una forma di un pezzo s'inserisce come
//   quel pezzo; una di più pezzi come un gruppo.
// - **I numeri** hanno al più due decimali, come li scrive il file, e il `d`
//   di un tracciato si legge con `parsePath`: chi lo rilegge trova lo stesso
//   testo. Un `d` ha solo `M`, `L`, `C` e `Z`, assoluti: le ellissi sono
//   curve di Bézier, quattro per giro.
// - **Tutto sta nel riquadro**, a ogni misura, anche stretta o larga: le
//   proporzioni interne (le punte, le tacche, i raggi) sono frazioni dei
//   lati, limitate perché a misure estreme non si rovescino.
// - **Una forma chiusa è un pezzo solo,** chiuso: un rettangolo, un'ellisse,
//   un cerchio, un poligono, una stella, o un tracciato con almeno un
//   sottotracciato chiuso da `Z`. I tratti che porta con sé, come le righe
//   di un processo predefinito o il margine dei documenti dietro, stanno
//   nello stesso tracciato: così la forma riceve un'etichetta dentro, come
//   ogni forma chiusa, e un riempimento la colora tutta sotto il contorno.
//   Le forme della scuola non sono chiuse.

import { formatNumber } from "../number";
import { polygonalAttrs, polygonalVertices, STAR_RATIO, type PolygonalShape } from "../scene/parametric";
import type { DrawKey } from "../strings";

/// Le raccolte, nell'ordine del pannello.
export type LibraryGroup = "basic" | "flowchart" | "callouts" | "arrows" | "school";

export const LIBRARY_GROUPS: readonly LibraryGroup[] = ["basic", "flowchart", "callouts", "arrows", "school"];

/// Come si dipinge un pezzo:
/// - `outline`: il contorno del colore e dello spessore scelti, senza
///   riempimento, come le forme disegnate;
/// - `fine`: una linea di servizio, come le tacche di un asse: il colore
///   scelto e metà dello spessore;
/// - `paper`: le righe di un foglio di quaderno, d'un azzurro chiaro fisso e
///   sottili;
/// - `text`: un testo del colore scelto.
export type PiecePaint = "outline" | "fine" | "paper" | "text";

/// Un pezzo di una forma, senza id né stile.
export interface LibraryPiece {
  readonly tag: "path" | "rect" | "ellipse" | "circle" | "line" | "text";
  /// La geometria: `d` o `x`, `y`, `width`, `height`, `rx`; `cx`, `cy`,
  /// `rx`, `ry` o `r`; `x1`… `y2`; `fub:shape` e `fub:geom` per una forma
  /// sintetica; `x`, `y`, `text-anchor` e `font-size` per un testo.
  readonly attrs: Readonly<Record<string, string>>;
  readonly paint: PiecePaint;
  /// Il testo, per un pezzo `text`: una riga.
  readonly text?: string;
}

/// Una forma delle raccolte.
export interface LibraryShape {
  /// Stabile, in minuscolo e coi trattini: `flow-decision`.
  readonly id: string;
  readonly group: LibraryGroup;
  /// Il nome, nel catalogo del disegno: va nel `<title>`.
  readonly name: DrawKey;
  /// Altre parole con cui la si cerca, separate da virgole; nessuna se
  /// manca.
  readonly words?: DrawKey;
  /// La misura con cui s'inserisce, in unità della scena: larghezza e
  /// altezza.
  readonly size: readonly [number, number];
  /// Vero se può avere un'etichetta dentro: è un pezzo solo, chiuso.
  readonly closed: boolean;
  /// I pezzi nel riquadro da (0, 0) a (`width`, `height`).
  readonly build: (width: number, height: number) => readonly LibraryPiece[];
}

/// Un numero come lo scrive il file.
const n = (value: number): string => formatNumber(value, 2);

/// Un tracciato coi comandi e i numeri di `parts`, i numeri scritti come li
/// scrive il file: `d("M", 0, 0, "L", 10, 0, "Z")`.
export function d(...parts: readonly (string | number)[]): string {
  const out: string[] = [];
  for (const part of parts) {
    const last = out.length === 0 ? "" : out[out.length - 1]!;
    // Un comando si attacca al numero che lo segue, come nei tracciati che
    // scrive l'editor: `M10 20 L30 40 Z`.
    if (typeof part === "number" && /^[A-Za-z]$/.test(last)) out[out.length - 1] = last + n(part);
    else out.push(typeof part === "number" ? n(part) : part);
  }
  return out.join(" ");
}

/// Un tracciato chiuso dai punti `points`, in ordine.
export function polygonPath(points: readonly (readonly [number, number])[]): string {
  const parts: (string | number)[] = [];
  points.forEach(([x, y], i) => parts.push(i === 0 ? "M" : "L", x, y));
  parts.push("Z");
  return d(...parts);
}

type Pair = readonly [number, number];

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/// Quanto le maniglie di una curva che fa un quarto di cerchio sono lunghe,
/// in raggi: 4/3 · tan(90° / 4).
const QUARTER = (4 / 3) * Math.tan(Math.PI / 8);

/// Un tracciato che si scrive un comando alla volta, coi numeri di `d`.
interface Pen {
  readonly move: (x: number, y: number) => Pen;
  readonly line: (x: number, y: number) => Pen;
  readonly cubic: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => Pen;
  /// Fino a (`x`, `y`) con un quarto di cerchio, o d'ellisse, il cui spigolo
  /// è in (`cx`, `cy`): l'angolo arrotondato di un riquadro.
  readonly bend: (cx: number, cy: number, x: number, y: number) => Pen;
  /// L'arco dell'ellisse di centro (`cx`, `cy`) e raggi `rx`, `ry` fra gli
  /// angoli `from` e `to`, in gradi, in senso orario sullo schermo da destra
  /// (0°) verso il basso (90°). Si spezza ai multipli di 90°, così le curve
  /// toccano il riquadro nei punti estremi e non lo passano.
  readonly arc: (cx: number, cy: number, rx: number, ry: number, from: number, to: number) => Pen;
  readonly close: () => Pen;
  readonly data: () => string;
}

function pen(): Pen {
  const parts: (string | number)[] = [];
  let x = 0;
  let y = 0;
  const self: Pen = {
    move(px, py) {
      parts.push("M", px, py);
      [x, y] = [px, py];
      return self;
    },
    line(px, py) {
      parts.push("L", px, py);
      [x, y] = [px, py];
      return self;
    },
    cubic(x1, y1, x2, y2, px, py) {
      parts.push("C", x1, y1, x2, y2, px, py);
      [x, y] = [px, py];
      return self;
    },
    bend(cx, cy, px, py) {
      return self.cubic(x + QUARTER * (cx - x), y + QUARTER * (cy - y), px + QUARTER * (cx - px), py + QUARTER * (cy - py), px, py);
    },
    arc(cx, cy, rx, ry, from, to) {
      const at = (degrees: number): Pair => [cx + rx * Math.cos(radians(degrees)), cy + ry * Math.sin(radians(degrees))];
      const [sx, sy] = at(from);
      if (parts.length === 0) self.move(sx, sy);
      else if (Math.hypot(sx - x, sy - y) > 1e-6) self.line(sx, sy);
      let angle = from;
      while (angle < to - 1e-9) {
        const next = Math.min(to, (Math.floor(angle / 90 + 1e-9) + 1) * 90);
        const reach = (4 / 3) * Math.tan(radians(next - angle) / 4);
        const [ex, ey] = at(next);
        const a = radians(angle);
        const b = radians(next);
        self.cubic(x - reach * rx * Math.sin(a), y + reach * ry * Math.cos(a), ex + reach * rx * Math.sin(b), ey - reach * ry * Math.cos(b), ex, ey);
        angle = next;
      }
      return self;
    },
    close() {
      parts.push("Z");
      return self;
    },
    data: () => d(...parts),
  };
  return self;
}

const outline = (tag: LibraryPiece["tag"], attrs: Record<string, string>): LibraryPiece => ({ tag, attrs, paint: "outline" });

/// Un tracciato di contorno.
const contour = (data: string): LibraryPiece => outline("path", { d: data });

/// Un testo d'una riga, con `baseline` come riga di base.
function label(text: string, x: number, baseline: number, anchor: "start" | "middle" | "end", size: number): LibraryPiece {
  return { tag: "text", attrs: { x: n(x), y: n(baseline), "text-anchor": anchor, "font-size": n(size) }, paint: "text", text };
}

/// Il contorno del riquadro come tracciato chiuso, da continuare coi tratti
/// che stanno dentro la forma.
const frame = (w: number, h: number): Pen => pen().move(0, 0).line(w, 0).line(w, h).line(0, h).close();

/// Il rettangolo del riquadro, con gli angoli arrotondati di `radius`.
function box(w: number, h: number, radius: number): LibraryPiece {
  const attrs: Record<string, string> = { x: "0", y: "0", width: n(w), height: n(h) };
  if (radius > 0) {
    attrs["rx"] = n(radius);
    attrs["ry"] = n(radius);
  }
  return outline("rect", attrs);
}

/// L'ellisse che riempie il riquadro.
const oval = (w: number, h: number): LibraryPiece => outline("ellipse", { cx: n(w / 2), cy: n(h / 2), rx: n(w / 2), ry: n(h / 2) });

// ---------------------------------------------------------------------------
// Forme di base

/// Un parallelogramma: la cima scivola a destra di `slant` volte la larghezza,
/// senza passare mezza altezza, così a misure strette l'inclinazione non
/// supera i 63°.
function parallelogram(w: number, h: number, slant: number): LibraryPiece {
  const s = Math.min(slant * w, 0.5 * h);
  return contour(polygonPath([[s, 0], [w, 0], [w - s, h], [0, h]]));
}

/// Un trapezio, con la base lunga in basso, o in alto se `flipped`: i lati si
/// accostano di `inset` volte la larghezza, e mai più di mezza altezza.
function trapezoid(w: number, h: number, inset: number, flipped: boolean): LibraryPiece {
  const t = Math.min(inset * w, 0.5 * h);
  return contour(polygonPath(flipped ? [[0, 0], [w, 0], [w - t, h], [t, h]] : [[t, 0], [w - t, 0], [w, h], [0, h]]));
}

/// Un poligono regolare, o una stella, che riempie il riquadro: i vertici
/// stanno tutti dentro, e il raggio è il più grande che li tiene. A
/// coincidere col centro del riquadro è quello del rettangolo dei vertici,
/// non il centro del cerchio che li porta: così un pentagono o una stella non
/// lasciano una fascia vuota in basso.
function regular(shape: PolygonalShape, count: number, w: number, h: number): LibraryPiece {
  const ratio = shape === "star" ? STAR_RATIO : null;
  const unit = polygonalVertices({ shape, cx: 0, cy: 0, r: 1, count, ratio, rotation: 0, corner: 0 });
  const xs = unit.map(([x]) => x);
  const ys = unit.map(([, y]) => y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  // Un centesimo di margine per parte: il file scrive due decimali.
  const r = Math.floor(Math.min((w - 0.02) / (x1 - x0), (h - 0.02) / (y1 - y0)) * 100) / 100;
  const attrs = r > 0 ? polygonalAttrs({ shape, cx: w / 2 - (r * (x0 + x1)) / 2, cy: h / 2 - (r * (y0 + y1)) / 2, r, count, ratio, rotation: 0, corner: 0 }) : null;
  if (attrs !== null) return outline("path", { ...attrs });
  // Un riquadro più piccolo di un centesimo non regge la geometria sintetica.
  return contour(polygonPath(unit.map(([x, y]): Pair => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h])));
}

/// La croce, o il più: le braccia sono un terzo dei lati.
function cross(w: number, h: number): LibraryPiece {
  const [a, b, c, e] = [w / 3, (2 * w) / 3, h / 3, (2 * h) / 3];
  return contour(polygonPath([[a, 0], [b, 0], [b, c], [w, c], [w, e], [b, e], [b, h], [a, h], [a, e], [0, e], [0, c], [a, c]]));
}

/// Il cuore: due lobi che toccano i lati e la cima, la punta in basso al
/// centro, la valletta in alto a un quinto circa dell'altezza.
function heart(w: number, h: number): LibraryPiece {
  const point = (u: number, v: number): Pair => [u * w, v * h];
  const curve = (p: Pair, q: Pair, r: Pair): [number, number, number, number, number, number] => [...p, ...q, ...r];
  return contour(
    pen()
      .move(...point(0.5, 1))
      .cubic(...curve(point(0.4, 0.88), point(0, 0.58), point(0, 0.3)))
      .cubic(...curve(point(0, 0.134), point(0.112, 0), point(0.25, 0)))
      .cubic(...curve(point(0.36, 0), point(0.46, 0.08), point(0.5, 0.22)))
      .cubic(...curve(point(0.54, 0.08), point(0.64, 0), point(0.75, 0)))
      .cubic(...curve(point(0.888, 0), point(1, 0.134), point(1, 0.3)))
      .cubic(...curve(point(1, 0.58), point(0.6, 0.88), point(0.5, 1)))
      .close()
      .data(),
  );
}

// ---------------------------------------------------------------------------
// Diagrammi di flusso

/// L'ampiezza dell'onda in fondo a un documento largo `dw` e alto `dh`: un
/// decimo dell'altezza, e non più di un ottavo della larghezza, così in un
/// documento stretto non diventa un'ansa.
const waveAmp = (dw: number, dh: number): number => Math.min(0.1 * dh, 0.125 * dw);

/// Le maniglie di una mezza sinusoide: lungo la corda, e in ampiezza.
const SINE: Pair = [0.42, 4 / 3];

/// Il contorno di un documento nel riquadro (`x`, `y`, `dw`, `dh`): tre lati
/// dritti e il fondo a onda, che in basso a sinistra tocca il riquadro.
function documentData(x: number, y: number, dw: number, dh: number): string {
  const amp = waveAmp(dw, dh);
  const base = y + dh - amp;
  const right = x + dw;
  const half = dw / 2;
  const [along, lift] = SINE;
  return pen()
    .move(x, y)
    .line(right, y)
    .line(right, base)
    .cubic(right - along * half, base - lift * amp, right - (1 - along) * half, base - lift * amp, x + half, base)
    .cubic(x + half - along * half, base + lift * amp, x + half - (1 - along) * half, base + lift * amp, x, base)
    .close()
    .data();
}

/// Più documenti: quello davanti, intero, e dietro di lui altri due, di cui si
/// vede solo il margine, scalati in alto a destra; tutti in un tracciato.
function multidocument(w: number, h: number): LibraryPiece[] {
  const ox = 0.08 * w;
  const oy = 0.1 * h;
  const dw = w - 2 * ox;
  const dh = h - 2 * oy;
  const amp = waveAmp(dw, dh);
  const half = dw / 2;
  const [along, lift] = SINE;
  const behind = pen();
  // Del documento in `x`, `y` si vede il lato sinistro e quello in alto, il
  // destro, e l'inizio dell'onda finché non incontra il lato destro di quello
  // più avanti.
  for (const [x, y] of [[ox, oy], [2 * ox, 0]] as const) {
    const right = x + dw;
    const base = y + dh - amp;
    const p0: Pair = [right, base];
    const p1: Pair = [right - along * half, base - lift * amp];
    const p2: Pair = [right - (1 - along) * half, base - lift * amp];
    const p3: Pair = [right - half, base];
    const at = (t: number, a: number, b: number, c: number, e: number): number => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * e;
    // Il punto in cui l'onda arriva al lato destro del documento davanti,
    // `ox` più a sinistra, cercato per bisezione: `x` scende con `t`.
    let [low, high] = [0, 1];
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (at(mid, p0[0], p1[0], p2[0], p3[0]) > right - ox) low = mid;
      else high = mid;
    }
    const t = low;
    const lerp = (a: Pair, b: Pair): Pair => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const [a, b, c] = [lerp(p0, p1), lerp(p1, p2), lerp(p2, p3)];
    const [ab, bc] = [lerp(a, b), lerp(b, c)];
    const end = lerp(ab, bc);
    behind.move(x, y + oy).line(x, y).line(right, y).line(right, base).cubic(...a, ...ab, ...end);
  }
  return [contour(`${documentData(0, 2 * oy, dw, dh)} ${behind.data()}`)];
}

/// Quanto scivola la cima del parallelogramma dei dati, in volte la larghezza.
const FLOW_SLANT = 0.2;

/// Il cilindro di un database: il profilo con la parte posteriore del disco in
/// alto, e davanti la parte anteriore del disco, che lo chiude, nello stesso
/// tracciato.
function database(w: number, h: number): LibraryPiece[] {
  const ry = Math.min(0.15 * w, 0.25 * h);
  const rx = w / 2;
  const silhouette = pen().arc(rx, ry, rx, ry, 180, 360).line(w, h - ry).arc(rx, h - ry, rx, ry, 0, 180).close().data();
  const front = pen().arc(rx, ry, rx, ry, 0, 180).data();
  return [contour(`${silhouette} ${front}`)];
}

/// Il ritardo: il lato sinistro dritto, il destro un semicerchio, o una mezza
/// ellisse se il riquadro è stretto.
function delay(w: number, h: number): LibraryPiece {
  const rx = Math.min(h / 2, w / 2);
  return contour(pen().move(0, 0).line(w - rx, 0).arc(w - rx, h / 2, rx, h / 2, 270, 450).line(0, h).close().data());
}

// ---------------------------------------------------------------------------
// Fumetti

/// La parte alta del riquadro che è il fumetto: sotto c'è la coda.
const BODY = 0.75;

/// La coda di un fumetto rettangolare: dal lato in basso, verso sinistra.
const TAIL_FROM = 0.25;
const TAIL_TO = 0.45;
const TAIL_TIP = 0.1;

/// Un fumetto rettangolare, con gli angoli arrotondati di `round` volte il lato
/// più corto del corpo.
function speechBox(w: number, h: number, round: number): LibraryPiece {
  const body = BODY * h;
  const tail = (p: Pen): Pen => p.line(TAIL_TO * w, body).line(TAIL_TIP * w, h).line(TAIL_FROM * w, body);
  if (!(round > 0)) {
    return contour(tail(pen().move(0, 0).line(w, 0).line(w, body)).line(0, body).close().data());
  }
  const r = round * Math.min(w, body);
  const p = pen().move(r, 0).line(w - r, 0).bend(w, 0, w, r).line(w, body - r).bend(w, body, w - r, body);
  return contour(tail(p).line(r, body).bend(0, body, 0, body - r).line(0, r).bend(0, 0, r, 0).close().data());
}

/// Un fumetto ovale: l'ellisse del corpo, con la coda che parte dal basso a
/// sinistra.
function speechOval(w: number, h: number): LibraryPiece {
  const body = BODY * h;
  const [cx, cy, rx, ry] = [w / 2, body / 2, w / 2, body / 2];
  return contour(pen().arc(cx, cy, rx, ry, 135, 465).line(TAIL_TIP * w, h).close().data());
}

/// I cerchi di una nuvola, in un riquadro unitario, in senso orario: il
/// centro e il raggio. Il contorno è l'insieme di questi cerchi, e ogni cerchio
/// vi mette l'arco fra il punto in cui incontra il precedente e quello in cui
/// incontra il successivo.
const CLOUD: readonly (readonly [number, number, number])[] = [
  [0.13, 0.6, 0.13],
  [0.2, 0.38, 0.15],
  [0.4, 0.22, 0.22],
  [0.66, 0.27, 0.19],
  [0.84, 0.46, 0.16],
  [0.86, 0.69, 0.13],
  [0.68, 0.82, 0.17],
  [0.48, 0.84, 0.16],
  [0.28, 0.8, 0.18],
];

/// Dei due punti in cui s'incontrano i cerchi `a` e `b`, quello più lontano dal
/// centro della nuvola.
function meeting(a: readonly [number, number, number], b: readonly [number, number, number]): Pair {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const distance = Math.hypot(dx, dy);
  const along = (a[2] ** 2 - b[2] ** 2 + distance ** 2) / (2 * distance);
  const across = Math.sqrt(Math.max(0, a[2] ** 2 - along ** 2));
  const [mx, my] = [a[0] + (dx * along) / distance, a[1] + (dy * along) / distance];
  const one: Pair = [mx - (dy * across) / distance, my + (dx * across) / distance];
  const other: Pair = [mx + (dy * across) / distance, my - (dx * across) / distance];
  const far = (p: Pair): number => Math.hypot(p[0] - 0.5, p[1] - 0.5);
  return far(one) >= far(other) ? one : other;
}

/// La nuvola nel riquadro (0, 0) – (`w`, `h`).
function cloudData(w: number, h: number): string {
  const p = pen();
  CLOUD.forEach((circle, i) => {
    const [cx, cy, r] = circle;
    const before = meeting(CLOUD[(i + CLOUD.length - 1) % CLOUD.length]!, circle);
    const after = meeting(circle, CLOUD[(i + 1) % CLOUD.length]!);
    const from = (Math.atan2(before[1] - cy, before[0] - cx) * 180) / Math.PI;
    let to = (Math.atan2(after[1] - cy, after[0] - cx) * 180) / Math.PI;
    while (to < from) to += 360;
    p.arc(cx * w, cy * h, r * w, r * h, from, to);
  });
  return p.close().data();
}

/// Le punte di un'esplosione: il raggio di ognuna e quello della valletta che
/// la segue, in volte il raggio massimo.
const BURST: readonly (readonly [number, number])[] = [
  [1, 0.6],
  [0.88, 0.66],
  [0.97, 0.58],
  [0.84, 0.64],
  [1, 0.6],
  [0.9, 0.66],
  [0.95, 0.58],
  [0.86, 0.64],
  [1, 0.6],
  [0.88, 0.66],
  [0.96, 0.58],
  [0.85, 0.64],
];

/// L'esplosione: una stella irregolare di dodici punte, stirata fino a
/// toccare i quattro lati del riquadro.
function burst(w: number, h: number): LibraryPiece {
  const unit: Pair[] = [];
  BURST.forEach(([tip, notch], i) => {
    const angle = radians(-90 + (360 * i) / BURST.length);
    const half = Math.PI / BURST.length;
    unit.push([tip * Math.cos(angle), tip * Math.sin(angle)], [notch * Math.cos(angle + half), notch * Math.sin(angle + half)]);
  });
  const [x0, x1] = [Math.min(...unit.map(([x]) => x)), Math.max(...unit.map(([x]) => x))];
  const [y0, y1] = [Math.min(...unit.map(([, y]) => y)), Math.max(...unit.map(([, y]) => y))];
  return contour(polygonPath(unit.map(([x, y]): Pair => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h])));
}

// ---------------------------------------------------------------------------
// Frecce piene

type Heading = "right" | "left" | "up" | "down";

/// Una freccia piena che punta a `heading`: l'asta è la metà della larghezza
/// trasversale, la punta è lunga `head` volte la lunghezza, al più tre quarti
/// della larghezza trasversale.
function blockArrow(heading: Heading, w: number, h: number): LibraryPiece {
  const horizontal = heading === "right" || heading === "left";
  const [length, width] = horizontal ? [w, h] : [h, w];
  const head = Math.min(length / 3, 0.75 * width);
  // Una freccia che punta a destra, lungo `length` e larga `width`.
  const local: Pair[] = [[0, 0.25 * width], [length - head, 0.25 * width], [length - head, 0], [length, 0.5 * width], [length - head, width], [length - head, 0.75 * width], [0, 0.75 * width]];
  const place = ([u, v]: Pair): Pair => (heading === "right" ? [u, v] : heading === "left" ? [length - u, v] : heading === "down" ? [v, u] : [v, length - u]);
  return contour(polygonPath(local.map(place)));
}

/// Una freccia piena con la punta a tutti e due i capi, orizzontale o
/// verticale: ogni punta è un quarto della lunghezza.
function doubleArrow(horizontal: boolean, w: number, h: number): LibraryPiece {
  const [length, width] = horizontal ? [w, h] : [h, w];
  const head = Math.min(length / 4, 0.6 * width);
  const local: Pair[] = [
    [0, 0.5 * width],
    [head, 0],
    [head, 0.25 * width],
    [length - head, 0.25 * width],
    [length - head, 0],
    [length, 0.5 * width],
    [length - head, width],
    [length - head, 0.75 * width],
    [head, 0.75 * width],
    [head, width],
  ];
  return contour(polygonPath(local.map(([u, v]): Pair => (horizontal ? [u, v] : [v, u]))));
}

/// La freccia a quattro direzioni: un'asta per ogni verso, con la sua punta.
function quadArrow(w: number, h: number): LibraryPiece {
  const [cx, cy] = [w / 2, h / 2];
  const [headX, headY] = [0.24 * w, 0.24 * h];
  const [wideX, wideY] = [0.2 * w, 0.2 * h];
  const [shaftX, shaftY] = [0.09 * w, 0.09 * h];
  return contour(
    polygonPath([
      [cx, 0],
      [cx + wideX, headY],
      [cx + shaftX, headY],
      [cx + shaftX, cy - shaftY],
      [w - headX, cy - shaftY],
      [w - headX, cy - wideY],
      [w, cy],
      [w - headX, cy + wideY],
      [w - headX, cy + shaftY],
      [cx + shaftX, cy + shaftY],
      [cx + shaftX, h - headY],
      [cx + wideX, h - headY],
      [cx, h],
      [cx - wideX, h - headY],
      [cx - shaftX, h - headY],
      [cx - shaftX, cy + shaftY],
      [headX, cy + shaftY],
      [headX, cy + wideY],
      [0, cy],
      [headX, cy - wideY],
      [headX, cy - shaftY],
      [cx - shaftX, cy - shaftY],
      [cx - shaftX, headY],
      [cx - wideX, headY],
    ]),
  );
}

/// Il gallone, o il pentagono a freccia: la punta a destra, con lo spigolo
/// dentro a sinistra se `notched`.
function chevron(w: number, h: number, notched: boolean): LibraryPiece {
  const t = Math.min(0.4 * h, 0.35 * w);
  const points: Pair[] = notched ? [[0, 0], [w - t, 0], [w, h / 2], [w - t, h], [0, h], [t, h / 2]] : [[0, 0], [w - t, 0], [w, h / 2], [w - t, h], [0, h]];
  return contour(polygonPath(points));
}

/// L'inversione a U: sale a sinistra, gira in alto e scende a destra con la
/// punta. L'asta è larga un quinto del lato corto, e la punta il doppio.
function uTurn(w: number, h: number): LibraryPiece {
  const t = 0.2 * Math.min(w, h);
  const wide = 2 * t;
  const outer = w - wide / 2 + t / 2;
  const inner = outer - t;
  const bend = Math.min(outer / 2, h / 2);
  const small = bend - t;
  const base = h - Math.min(0.35 * h, wide);
  const middle = w - wide / 2;
  return contour(
    pen()
      .move(0, h)
      .line(0, bend)
      .bend(0, 0, bend, 0)
      .line(outer - bend, 0)
      .bend(outer, 0, outer, bend)
      .line(outer, base)
      .line(w, base)
      .line(middle, h)
      .line(w - wide, base)
      .line(inner, base)
      .line(inner, bend)
      .bend(inner, t, inner - small, t)
      .line(bend, t)
      .bend(t, t, t, bend)
      .line(t, h)
      .close()
      .data(),
  );
}

// ---------------------------------------------------------------------------
// Scuola

/// La distanza fra le tacche degli assi.
const AXES_STEP = 40;

/// Dove passa l'asse in una dimensione di `side`: il multiplo di `AXES_STEP`
/// più vicino a metà, se lascia posto a una tacca da ogni parte; altrimenti
/// metà.
function axisAt(side: number): number {
  const at = Math.round(side / 2 / AXES_STEP) * AXES_STEP;
  return at >= AXES_STEP && at <= side - AXES_STEP ? at : side / 2;
}

/// Gli assi cartesiani: le due frecce, le tacche ogni `AXES_STEP` dall'origine
/// e le lettere x, y e O.
function axes(w: number, h: number): LibraryPiece[] {
  const [ox, oy] = [axisAt(w), axisAt(h)];
  const half = 4;
  const ticks = pen();
  for (let x = ox - AXES_STEP; x >= AXES_STEP / 2; x -= AXES_STEP) ticks.move(x, oy - half).line(x, oy + half);
  for (let x = ox + AXES_STEP; x <= w - AXES_STEP / 2; x += AXES_STEP) ticks.move(x, oy - half).line(x, oy + half);
  for (let y = oy - AXES_STEP; y >= AXES_STEP / 2; y -= AXES_STEP) ticks.move(ox - half, y).line(ox + half, y);
  for (let y = oy + AXES_STEP; y <= h - AXES_STEP / 2; y += AXES_STEP) ticks.move(ox - half, y).line(ox + half, y);
  const size = 20;
  const arrow = (x1: number, y1: number, x2: number, y2: number): LibraryPiece => ({
    tag: "path",
    attrs: { "fub:shape": "arrow", "fub:geom": `${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)}` },
    paint: "outline",
  });
  const pieces: LibraryPiece[] = [arrow(0, oy, w, oy), arrow(ox, h, ox, 0)];
  const data = ticks.data();
  if (data !== "") pieces.push({ tag: "path", attrs: { d: data }, paint: "fine" });
  pieces.push(
    label("x", Math.max(0, w - 8), Math.min(h, oy + 24), "end", size),
    label("y", Math.min(w, ox + 10), Math.min(h, 18), "start", size),
    label("O", Math.max(0, ox - 8), Math.min(h, oy + 22), "end", size),
  );
  return pieces;
}

/// La retta dei numeri: una freccia a destra, undici tacche per 0…10 e sotto
/// i numeri, di 16 unità; più piccoli se il riquadro è basso o stretto, perché
/// non si tocchino fra loro né le tacche.
function numberLine(w: number, h: number): LibraryPiece[] {
  const unit = Math.min(1, h / 48);
  const margin = Math.min(30, w / 12);
  const step = (w - 2 * margin) / 10;
  const base = h - 4 * unit;
  const y = base - 24 * unit;
  const half = 7 * unit;
  const size = Math.min(16 * unit, step / 1.4);
  const ticks = pen();
  const numbers: LibraryPiece[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = margin + i * step;
    ticks.move(x, y - half).line(x, y + half);
    numbers.push(label(String(i), x, base, "middle", size));
  }
  return [
    { tag: "path", attrs: { "fub:shape": "arrow", "fub:geom": `0 ${n(y)} ${n(w)} ${n(y)}` }, paint: "outline" },
    { tag: "path", attrs: { d: ticks.data() }, paint: "fine" },
    ...numbers,
  ];
}

/// Le righe di un foglio: tante quante ci stanno ogni `step`, da 0, con un
/// tetto perché un foglio enorme non diventi mille righe.
function rulings(length: number, step: number): number[] {
  const spacing = step * Math.max(1, Math.ceil(length / step / 400));
  const out: number[] = [];
  for (let at = 0; at <= length + 1e-9; at += spacing) out.push(at);
  return out;
}

/// Un foglio a quadretti: righe ogni 20 unità in tutti e due i versi, e il
/// bordo destro e quello in basso se non cadono su una riga.
function squaredPaper(w: number, h: number): LibraryPiece[] {
  const [xs, ys] = [rulings(w, 20), rulings(h, 20)];
  const sheet = pen();
  if (xs[xs.length - 1]! < w - 0.005) xs.push(w);
  if (ys[ys.length - 1]! < h - 0.005) ys.push(h);
  for (const x of xs) sheet.move(x, 0).line(x, h);
  for (const y of ys) sheet.move(0, y).line(w, y);
  return [{ tag: "path", attrs: { d: sheet.data() }, paint: "paper" }];
}

/// Un foglio a righe: una riga ogni 30 unità, da quella in alto.
function linedPaper(w: number, h: number): LibraryPiece[] {
  const sheet = pen();
  for (const y of rulings(h, 30)) sheet.move(0, y).line(w, y);
  return [{ tag: "path", attrs: { d: sheet.data() }, paint: "paper" }];
}

// ---------------------------------------------------------------------------

/// Le forme, raccolta per raccolta, nell'ordine del pannello.
export const LIBRARY: readonly LibraryShape[] = [
  {
    id: "basic-rectangle",
    group: "basic",
    name: "draw.library.basic-rectangle",
    words: "draw.library.basic-rectangle.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [box(w, h, 0)],
  },
  {
    id: "basic-rounded",
    group: "basic",
    name: "draw.library.basic-rounded",
    words: "draw.library.basic-rounded.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [box(w, h, 0.15 * Math.min(w, h))],
  },
  {
    id: "basic-ellipse",
    group: "basic",
    name: "draw.library.basic-ellipse",
    words: "draw.library.basic-ellipse.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [oval(w, h)],
  },
  {
    id: "basic-circle",
    group: "basic",
    name: "draw.library.basic-circle",
    words: "draw.library.basic-circle.words",
    size: [100, 100],
    closed: true,
    build: (w, h) => [oval(w, h)],
  },
  {
    id: "basic-triangle",
    group: "basic",
    name: "draw.library.basic-triangle",
    words: "draw.library.basic-triangle.words",
    size: [140, 120],
    closed: true,
    build: (w, h) => [contour(polygonPath([[w / 2, 0], [w, h], [0, h]]))],
  },
  {
    id: "basic-right-triangle",
    group: "basic",
    name: "draw.library.basic-right-triangle",
    words: "draw.library.basic-right-triangle.words",
    size: [120, 120],
    closed: true,
    build: (w, h) => [contour(polygonPath([[0, 0], [w, h], [0, h]]))],
  },
  {
    id: "basic-diamond",
    group: "basic",
    name: "draw.library.basic-diamond",
    words: "draw.library.basic-diamond.words",
    size: [120, 120],
    closed: true,
    build: (w, h) => [contour(polygonPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))],
  },
  {
    id: "basic-parallelogram",
    group: "basic",
    name: "draw.library.basic-parallelogram",
    words: "draw.library.basic-parallelogram.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [parallelogram(w, h, 0.25)],
  },
  {
    id: "basic-trapezoid",
    group: "basic",
    name: "draw.library.basic-trapezoid",
    size: [160, 100],
    closed: true,
    build: (w, h) => [trapezoid(w, h, 0.2, false)],
  },
  {
    id: "basic-pentagon",
    group: "basic",
    name: "draw.library.basic-pentagon",
    words: "draw.library.basic-pentagon.words",
    size: [150, 143],
    closed: true,
    build: (w, h) => [regular("polygon", 5, w, h)],
  },
  {
    id: "basic-hexagon",
    group: "basic",
    name: "draw.library.basic-hexagon",
    words: "draw.library.basic-hexagon.words",
    size: [160, 139],
    closed: true,
    build: (w, h) => [regular("polygon", 6, w, h)],
  },
  {
    id: "basic-octagon",
    group: "basic",
    name: "draw.library.basic-octagon",
    words: "draw.library.basic-octagon.words",
    size: [120, 120],
    closed: true,
    build: (w, h) => [regular("polygon", 8, w, h)],
  },
  {
    id: "basic-star",
    group: "basic",
    name: "draw.library.basic-star",
    words: "draw.library.basic-star.words",
    size: [150, 143],
    closed: true,
    build: (w, h) => [regular("star", 5, w, h)],
  },
  {
    id: "basic-cross",
    group: "basic",
    name: "draw.library.basic-cross",
    words: "draw.library.basic-cross.words",
    size: [120, 120],
    closed: true,
    build: (w, h) => [cross(w, h)],
  },
  {
    id: "basic-heart",
    group: "basic",
    name: "draw.library.basic-heart",
    words: "draw.library.basic-heart.words",
    size: [140, 126],
    closed: true,
    build: (w, h) => [heart(w, h)],
  },
  {
    id: "flow-process",
    group: "flowchart",
    name: "draw.library.flow-process",
    words: "draw.library.flow-process.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [box(w, h, 0)],
  },
  {
    id: "flow-alternate",
    group: "flowchart",
    name: "draw.library.flow-alternate",
    words: "draw.library.flow-alternate.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [box(w, h, Math.min(w, h) / 6)],
  },
  {
    id: "flow-decision",
    group: "flowchart",
    name: "draw.library.flow-decision",
    words: "draw.library.flow-decision.words",
    size: [140, 90],
    closed: true,
    build: (w, h) => [contour(polygonPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]))],
  },
  {
    id: "flow-data",
    group: "flowchart",
    name: "draw.library.flow-data",
    words: "draw.library.flow-data.words",
    size: [160, 90],
    closed: true,
    build: (w, h) => [parallelogram(w, h, FLOW_SLANT)],
  },
  {
    id: "flow-predefined",
    group: "flowchart",
    name: "draw.library.flow-predefined",
    words: "draw.library.flow-predefined.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => {
      const x = Math.min(0.1 * w, 0.25 * h);
      return [contour(frame(w, h).move(x, 0).line(x, h).move(w - x, 0).line(w - x, h).data())];
    },
  },
  {
    id: "flow-internal-storage",
    group: "flowchart",
    name: "draw.library.flow-internal-storage",
    words: "draw.library.flow-internal-storage.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => {
      const x = Math.min(0.12 * w, 0.25 * h);
      const y = Math.min(0.15 * h, 0.25 * w);
      return [contour(frame(w, h).move(0, y).line(w, y).move(x, 0).line(x, h).data())];
    },
  },
  {
    id: "flow-document",
    group: "flowchart",
    name: "draw.library.flow-document",
    words: "draw.library.flow-document.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [contour(documentData(0, 0, w, h))],
  },
  {
    id: "flow-multidocument",
    group: "flowchart",
    name: "draw.library.flow-multidocument",
    words: "draw.library.flow-multidocument.words",
    size: [170, 120],
    closed: true,
    build: multidocument,
  },
  {
    id: "flow-terminator",
    group: "flowchart",
    name: "draw.library.flow-terminator",
    words: "draw.library.flow-terminator.words",
    size: [160, 70],
    closed: true,
    build: (w, h) => [box(w, h, Math.min(w, h) / 2)],
  },
  {
    id: "flow-preparation",
    group: "flowchart",
    name: "draw.library.flow-preparation",
    words: "draw.library.flow-preparation.words",
    size: [160, 90],
    closed: true,
    build: (w, h) => {
      const s = Math.min(0.2 * w, 0.5 * h);
      return [contour(polygonPath([[0, h / 2], [s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h]]))];
    },
  },
  {
    id: "flow-manual-input",
    group: "flowchart",
    name: "draw.library.flow-manual-input",
    words: "draw.library.flow-manual-input.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [contour(polygonPath([[0, 0.2 * h], [w, 0], [w, h], [0, h]]))],
  },
  {
    id: "flow-manual-operation",
    group: "flowchart",
    name: "draw.library.flow-manual-operation",
    words: "draw.library.flow-manual-operation.words",
    size: [160, 90],
    closed: true,
    build: (w, h) => [trapezoid(w, h, 0.2, true)],
  },
  {
    id: "flow-reference",
    group: "flowchart",
    name: "draw.library.flow-reference",
    words: "draw.library.flow-reference.words",
    size: [60, 60],
    closed: true,
    build: (w, h) => [oval(w, h)],
  },
  {
    id: "flow-offpage",
    group: "flowchart",
    name: "draw.library.flow-offpage",
    words: "draw.library.flow-offpage.words",
    size: [90, 100],
    closed: true,
    build: (w, h) => {
      const t = Math.min(0.25 * h, 0.3 * w);
      return [contour(polygonPath([[0, 0], [w, 0], [w, h - t], [w / 2, h], [0, h - t]]))];
    },
  },
  {
    id: "flow-delay",
    group: "flowchart",
    name: "draw.library.flow-delay",
    words: "draw.library.flow-delay.words",
    size: [120, 80],
    closed: true,
    build: (w, h) => [delay(w, h)],
  },
  {
    id: "flow-database",
    group: "flowchart",
    name: "draw.library.flow-database",
    words: "draw.library.flow-database.words",
    size: [100, 120],
    closed: true,
    build: database,
  },
  {
    id: "callout-rectangle",
    group: "callouts",
    name: "draw.library.callout-rectangle",
    words: "draw.library.callout-rectangle.words",
    size: [160, 120],
    closed: true,
    build: (w, h) => [speechBox(w, h, 0)],
  },
  {
    id: "callout-rounded",
    group: "callouts",
    name: "draw.library.callout-rounded",
    words: "draw.library.callout-rounded.words",
    size: [160, 120],
    closed: true,
    build: (w, h) => [speechBox(w, h, 0.15)],
  },
  {
    id: "callout-oval",
    group: "callouts",
    name: "draw.library.callout-oval",
    words: "draw.library.callout-oval.words",
    size: [160, 120],
    closed: true,
    build: (w, h) => [speechOval(w, h)],
  },
  {
    id: "callout-thought",
    group: "callouts",
    name: "draw.library.callout-thought",
    words: "draw.library.callout-thought.words",
    size: [160, 130],
    closed: true,
    build: (w, h) => {
      const r = Math.min(0.056 * w, 0.075 * h);
      const circle = (cx: number, cy: number, radius: number): string => pen().arc(cx, cy, radius, radius, 0, 360).close().data();
      return [contour(`${cloudData(w, 0.72 * h)} ${circle(0.19 * w, 0.82 * h, r)} ${circle(0.09 * w, 0.935 * h, 0.6 * r)}`)];
    },
  },
  {
    id: "callout-cloud",
    group: "callouts",
    name: "draw.library.callout-cloud",
    words: "draw.library.callout-cloud.words",
    size: [160, 110],
    closed: true,
    build: (w, h) => [contour(cloudData(w, h))],
  },
  {
    id: "callout-burst",
    group: "callouts",
    name: "draw.library.callout-burst",
    words: "draw.library.callout-burst.words",
    size: [160, 140],
    closed: true,
    build: (w, h) => [burst(w, h)],
  },
  {
    id: "arrow-right",
    group: "arrows",
    name: "draw.library.arrow-right",
    words: "draw.library.arrow-right.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [blockArrow("right", w, h)],
  },
  {
    id: "arrow-left",
    group: "arrows",
    name: "draw.library.arrow-left",
    words: "draw.library.arrow-left.words",
    size: [160, 100],
    closed: true,
    build: (w, h) => [blockArrow("left", w, h)],
  },
  {
    id: "arrow-up",
    group: "arrows",
    name: "draw.library.arrow-up",
    words: "draw.library.arrow-up.words",
    size: [100, 160],
    closed: true,
    build: (w, h) => [blockArrow("up", w, h)],
  },
  {
    id: "arrow-down",
    group: "arrows",
    name: "draw.library.arrow-down",
    words: "draw.library.arrow-down.words",
    size: [100, 160],
    closed: true,
    build: (w, h) => [blockArrow("down", w, h)],
  },
  {
    id: "arrow-left-right",
    group: "arrows",
    name: "draw.library.arrow-left-right",
    words: "draw.library.arrow-left-right.words",
    size: [180, 100],
    closed: true,
    build: (w, h) => [doubleArrow(true, w, h)],
  },
  {
    id: "arrow-up-down",
    group: "arrows",
    name: "draw.library.arrow-up-down",
    words: "draw.library.arrow-up-down.words",
    size: [100, 180],
    closed: true,
    build: (w, h) => [doubleArrow(false, w, h)],
  },
  {
    id: "arrow-quad",
    group: "arrows",
    name: "draw.library.arrow-quad",
    words: "draw.library.arrow-quad.words",
    size: [140, 140],
    closed: true,
    build: (w, h) => [quadArrow(w, h)],
  },
  {
    id: "arrow-chevron",
    group: "arrows",
    name: "draw.library.arrow-chevron",
    words: "draw.library.arrow-chevron.words",
    size: [140, 100],
    closed: true,
    build: (w, h) => [chevron(w, h, true)],
  },
  {
    id: "arrow-pentagon",
    group: "arrows",
    name: "draw.library.arrow-pentagon",
    words: "draw.library.arrow-pentagon.words",
    size: [140, 100],
    closed: true,
    build: (w, h) => [chevron(w, h, false)],
  },
  {
    id: "arrow-u-turn",
    group: "arrows",
    name: "draw.library.arrow-u-turn",
    words: "draw.library.arrow-u-turn.words",
    size: [140, 140],
    closed: true,
    build: (w, h) => [uTurn(w, h)],
  },
  {
    id: "school-axes",
    group: "school",
    name: "draw.library.school-axes",
    words: "draw.library.school-axes.words",
    size: [400, 400],
    closed: false,
    build: axes,
  },
  {
    id: "school-number-line",
    group: "school",
    name: "draw.library.school-number-line",
    words: "draw.library.school-number-line.words",
    size: [460, 48],
    closed: false,
    build: numberLine,
  },
  {
    id: "school-squared",
    group: "school",
    name: "draw.library.school-squared",
    words: "draw.library.school-squared.words",
    size: [400, 280],
    closed: false,
    build: squaredPaper,
  },
  {
    id: "school-lined",
    group: "school",
    name: "draw.library.school-lined",
    words: "draw.library.school-lined.words",
    size: [400, 300],
    closed: false,
    build: linedPaper,
  },
];

const BY_ID = new Map(LIBRARY.map((shape) => [shape.id, shape]));

/// La forma `id` delle raccolte, se c'è.
export function libraryShape(id: string): LibraryShape | null {
  return BY_ID.get(id) ?? null;
}
