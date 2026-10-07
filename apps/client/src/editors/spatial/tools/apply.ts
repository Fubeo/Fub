// «Applica trasformazione» (livello Esperto): la trasformazione degli
// oggetti scelti passa nella loro geometria, e `transform` se ne va, o resta
// solo per ciò che la forma non sa scrivere. Il comando diventa un `batch`
// solo, come quelli di «Disponi».
//
// - **Ciò che si vede resta.** Ogni forma prende la parte della
//   trasformazione che sa scrivere, e il resto rimane in `transform`, senza
//   traslazione. Percorsi, linee, spezzate, poligoni e frecce prendono
//   tutto; rettangoli, ellissi e immagini senza proporzioni la scala lungo i
//   loro assi; cerchi e immagini con le proporzioni una scala uguale nei due
//   versi; poligoni regolari e stelle le rotazioni e una scala uguale nei due
//   versi, che diventano centro, raggio, rotazione e raggio degli angoli.
//   Una linea a spessore variabile prende tutto: la linea si trasforma, le
//   larghezze si moltiplicano come uno spessore, e un ribaltamento scambia
//   i lati.
//   Senza tratteggio rettangoli, ellissi, cerchi, poligoni regolari e stelle
//   prendono anche i ribaltamenti e i quarti di giro che li lasciano uguali;
//   con il tratteggio no, perché comincerebbe altrove.
// - **Un tratto a penna** prende la trasformazione se non lo deforma:
//   rotazioni, ribaltamenti e scale uguali nei due versi. L'inchiostro e il
//   pennello si riscrivono, l'azimut della penna gira con il tratto, e il
//   motore ricalcola `d`. Altrimenti, o se non si ridisegna, il tratto tiene
//   la sua trasformazione; così il testo, le cui righe non hanno id.
// - **Il contorno scala con la forma.** Spessore e tratteggio si
//   moltiplicano per la radice del fattore dell'area: esatto per rotazioni e
//   scale uguali, una media per le altre. La punta di una freccia è quella
//   della sua regola, sul nuovo spessore.
// - **Un gruppo o un collegamento** passano la loro trasformazione ai figli
//   e la perdono. Uno con parti estranee la tiene, perché un elemento
//   estraneo non cambia, e i suoi figli applicano solo la loro.
// - **Niente che il file non sappia scrivere.** Un oggetto la cui geometria
//   nuova non si rileggerebbe, o il cui resto non si scrive in `matrix()`
//   (come in «Trasforma»), resta com'è. Un percorso con una forma o uno
//   strumento che questa versione non conosce tiene la sua trasformazione:
//   la sua geometria non è solo `d`.

import { formatNumber } from "../number";
import { checkBrush, formatBrush, parseBrush } from "../ink/brush";
import { createInk, decodeInk, encodeInk, INK_MAX_BYTES } from "../ink/codec";
import { quantizeAzimuth, quantizeCoordinate } from "../ink/sample";
import { svgAttribute } from "../scene/classify";
import { parsePath, type Segment } from "../scene/geometry";
import { apply, compose, IDENTITY, invert, mappedEllipse, toRadians, type Matrix, type Point } from "../scene/matrix";
import { elementChildren, type ContainerNode, type DocumentModel, type ElementPart } from "../scene/model";
import { polygonalAttrs } from "../scene/parametric";
import { spineOf } from "../scene/varwidth";
import { pathData } from "../scene/serialize";
import { length, nonNegativeLength, points as parsePoints, transform as parseTransform } from "../scene/values";
import { SVG_NS } from "../scene/xml";
import { fubAttributes, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { transformValue, type NewIds } from "./edit";
import type { Unit } from "./hit";
import { inheritedBy, passed, type Inherited } from "./outline";
import { scaledProfile, swappedProfile, widthAttrs } from "./profile";
import { arrowPath } from "./shapes";
import { writable } from "./transform";

/// Gli attributi di un percorso che dicono che la sua geometria non è solo
/// `d`: una forma o uno strumento di FubDraw.
const SHAPED: readonly string[] = ["shape", "geom", "tool", "ink", "brush"];

/// Gli attributi di geometria che, assenti, valgono zero: non si scrivono se
/// restano zero.
const ZERO: ReadonlySet<string> = new Set(["x", "y", "cx", "cy", "x1", "y1", "x2", "y2", "width", "height", "r", "rx", "ry"]);

/// I ruoli che SVG disegna con un contorno: un'immagine e un testo non
/// cambiano il loro.
const STROKED: ReadonlySet<string> = new Set(["arrow", "ngon", "star", "path", "rect", "ellipse", "circle", "line", "polyline", "polygon", "stroke"]);

/// Un numero della geometria come lo scrive il file.
const place = (value: number): string => formatNumber(value, 2);

const linear = (m: Matrix): Matrix => [m[0], m[1], m[2], m[3], 0, 0];

const determinant = (m: Matrix): number => m[0] * m[3] - m[1] * m[2];

// ---------------------------------------------------------------------------
// Che cosa prende una forma.
// ---------------------------------------------------------------------------

/// `m` divisa in ciò che la forma prende e ciò che resta: `m` = `rest` ·
/// `geometry`, `rest` senza traslazione, e `taken` è la parte lineare di
/// `geometry`.
interface Split {
  readonly geometry: Matrix;
  readonly taken: Matrix;
  readonly rest: Matrix;
}

/// La forma prende tutta `m`.
const whole = (m: Matrix): Split => ({ geometry: m, taken: linear(m), rest: IDENTITY });

/// La forma prende `taken`, una matrice lineare, e la traslazione che
/// resta; `null` se `taken` o il resto non si invertono.
function split(m: Matrix, taken: Matrix): Split | null {
  const inverse = invert(taken);
  if (inverse === null) return null;
  const rest = compose(linear(m), inverse);
  const back = invert(rest);
  if (back === null) return null;
  const [x, y] = apply(back, [m[4], m[5]]);
  return { geometry: [taken[0], taken[1], taken[2], taken[3], x, y], taken, rest };
}

/// Vero se il resto di `m` dopo `taken` si scrive come l'identità.
const leavesNothing = (m: Matrix, taken: Matrix): boolean => {
  const inverse = invert(taken);
  return inverse !== null && transformValue(compose(linear(m), inverse)) === null;
};

/// La scala lungo gli assi di `m`: le lunghezze delle sue colonne.
function axisScale(m: Matrix): Matrix {
  return [Math.hypot(m[0], m[1]), 0, 0, Math.hypot(m[2], m[3]), 0, 0];
}

/// La scala uguale nei due versi con l'area di `m`.
function uniformScale(m: Matrix): Matrix {
  const g = Math.sqrt(Math.abs(determinant(m)));
  return [g, 0, 0, g, 0, 0];
}

/// `m` come scala lungo gli assi, con ribaltamenti e quarti di giro: ciò
/// che lascia un rettangolo coi lati sugli assi. `null` se, scritto, ne
/// resterebbe qualcosa.
function axisAligned(m: Matrix): Matrix | null {
  const [a, b, c, d] = m;
  const candidates: Matrix[] = [[a, 0, 0, d, 0, 0], [0, b, c, 0, 0, 0]];
  return candidates.find((taken) => leavesNothing(m, taken)) ?? null;
}

/// `m` come similitudine, una rotazione o un ribaltamento per una scala
/// uguale nei due versi: ciò che non deforma. `null` se, scritto, ne
/// resterebbe qualcosa.
function similar(m: Matrix): Matrix | null {
  const [a, b, c, d] = m;
  if ((a === d && b === -c) || (a === -d && b === c)) return determinant(m) === 0 ? null : linear(m);
  // La similitudine più vicina: il fattore ortogonale della decomposizione
  // polare, per la radice del fattore dell'area.
  const det = determinant(m);
  const g = Math.sqrt(Math.abs(det));
  if (!(g > 0)) return null;
  const turns = det > 0;
  const angle = turns ? Math.atan2(b - c, a + d) : Math.atan2(b + c, a - d);
  const cos = g * Math.cos(angle);
  const sin = g * Math.sin(angle);
  const taken: Matrix = turns ? [cos, sin, -sin, cos, 0, 0] : [cos, sin, sin, -cos, 0, 0];
  return leavesNothing(m, taken) ? taken : null;
}

// ---------------------------------------------------------------------------
// La geometria dopo.
// ---------------------------------------------------------------------------

/// Quanto un arco da `from` a `to` riempie l'ellisse dei suoi raggi: 1 se va
/// da un capo all'altro, di più se i raggi sono troppo piccoli e SVG li
/// ingrandisce (Λ delle note di implementazione di SVG).
function fill(from: Point, to: Point, radii: Point, degrees: number): number {
  const angle = toRadians(degrees);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x = Math.cos(angle) * dx + Math.sin(angle) * dy;
  const y = Math.cos(angle) * dy - Math.sin(angle) * dx;
  return (x / radii[0]) ** 2 + (y / radii[1]) ** 2;
}

/// Un numero positivo della geometria arrotondato per difetto, senza
/// perdere un centesimo per gli errori del calcolo: un raggio di 10 che il
/// calcolo dà 9,9999999999 resta 10.
const floor = (value: number): number => Math.floor(value * 100 + 1e-6) / 100;

/// I segmenti di un percorso dopo `m`. Un arco con un raggio nullo è una
/// linea, come lo disegna SVG; un ribaltamento inverte il verso degli archi.
///
/// Un arco che va da un capo all'altro della sua ellisse, come le due metà
/// di un cerchio, ha il centro nel mezzo degli estremi; scritti con due
/// decimali, gli estremi potrebbero allontanarsi meno dei raggi, e il centro
/// scapperebbe di lato. I suoi raggi si scrivono allora appena più piccoli
/// del necessario: SVG li riporta alla misura giusta, col centro nel mezzo.
function mappedSegments(segments: readonly Segment[], m: Matrix): Segment[] {
  const at = (p: Point): Point => apply(m, p);
  const written = (p: Point): Point => [Number(place(p[0])), Number(place(p[1]))];
  const flips = determinant(m) < 0;
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  return segments.map((segment): Segment => {
    const from = current;
    if (segment.kind === "close") current = start;
    else current = segment.to;
    if (segment.kind === "move") start = segment.to;
    switch (segment.kind) {
      case "move":
      case "line":
        return { kind: segment.kind, to: at(segment.to) };
      case "quad":
        return { kind: "quad", control: at(segment.control), to: at(segment.to) };
      case "cubic":
        return { kind: "cubic", c1: at(segment.c1), c2: at(segment.c2), to: at(segment.to) };
      case "arc": {
        const rx = Math.abs(segment.radii[0]);
        const ry = Math.abs(segment.radii[1]);
        if (rx === 0 || ry === 0) return { kind: "line", to: at(segment.to) };
        const mapped = mappedEllipse(m, rx, ry, segment.rotation);
        let radii = mapped.radii;
        // Un milionesimo di tolleranza: le metà di un cerchio scritte a mano.
        if (fill(from, segment.to, [rx, ry], segment.rotation) >= 1 - 1e-6) {
          const scale = Math.sqrt(fill(written(at(from)), written(at(segment.to)), radii, mapped.rotation));
          const smaller: Point = [floor(radii[0] * scale), floor(radii[1] * scale)];
          if (smaller[0] > 0 && smaller[1] > 0) radii = smaller;
        }
        return { kind: "arc", radii, rotation: mapped.rotation, large: segment.large, sweep: segment.sweep !== flips, to: at(segment.to) };
      }
      case "close":
        return segment;
    }
  });
}

/// `fub:ink` e `fub:brush` di un tratto dopo `m`, una similitudine con la
/// sua traslazione: i punti e l'azimut della penna si muovono, pressione,
/// tempo e altitudine restano; il pennello scala come il tratto. Il pennello
/// resta com'è se scalato si scriverebbe uguale. `null` se l'inchiostro o il
/// pennello non si scrivono.
function movedInk(fub: ReadonlyMap<string, string>, m: Matrix): Record<string, string> | null {
  try {
    const ink = decodeInk(fub.get("ink") ?? "");
    const width = ink.channels.length;
    const azimuth = ink.channels.indexOf("z");
    const values = [...ink.values];
    for (let row = 0; row < values.length; row += width) {
      const [x, y] = apply(m, [values[row]! / ink.scale, values[row + 1]! / ink.scale]);
      values[row] = quantizeCoordinate(x, ink.scale);
      values[row + 1] = quantizeCoordinate(y, ink.scale);
      if (azimuth >= 0) {
        const angle = toRadians(values[row + azimuth]!);
        const [dx, dy] = apply(linear(m), [Math.cos(angle), Math.sin(angle)]);
        values[row + azimuth] = quantizeAzimuth((Math.atan2(dy, dx) * 180) / Math.PI);
      }
    }
    const text = encodeInk(createInk(ink.scale, ink.channels, values));
    // L'inchiostro è ASCII: un carattere è un byte.
    if (text.length > INK_MAX_BYTES) return null;
    const out: Record<string, string> = { "fub:ink": text };
    const brush = parseBrush(fub.get("brush") ?? "");
    const k = Math.sqrt(Math.abs(determinant(m)));
    const lengths = [brush.size, brush.taperStart, brush.taperEnd];
    if (lengths.some((value) => place(value * k) !== place(value))) {
      const [size, taperStart, taperEnd] = lengths.map((value) => Number(place(value * k))) as [number, number, number];
      const scaled = { ...brush, size, taperStart, taperEnd };
      checkBrush(scaled);
      out["fub:brush"] = formatBrush(scaled);
    }
    return out;
  } catch {
    return null;
  }
}

/// Un contorno che si vede: lo spessore e i trattini, `null` se continuo.
interface Outline {
  readonly width: number;
  readonly dashes: readonly number[] | null;
}

/// Il contorno che si vede di un elemento con gli attributi `own` che eredita
/// `from`; `null` se non se ne vede.
function outlineOf(own: ReadonlyMap<string, string>, from: Inherited): Outline | null {
  const value = (name: string): string => own.get(name) ?? from.get(name)!;
  if (value("stroke").trim() === "none") return null;
  const width = nonNegativeLength(value("stroke-width")) ?? 1;
  if (!(width > 0)) return null;
  const text = value("stroke-dasharray").trim();
  if (text === "none") return { width, dashes: null };
  const dashes = text.split(/[\t\n\f\r ,]+/).filter((part) => part !== "").map((part) => nonNegativeLength(part));
  // Un tratteggio che non si legge, o tutto zero, disegna un contorno continuo.
  if (dashes.length === 0 || dashes.some((dash) => dash === null) || dashes.every((dash) => dash === 0)) return { width, dashes: null };
  return { width, dashes: dashes as number[] };
}

/// Una forma con la geometria nuova: gli attributi, e come si è divisa la
/// trasformazione.
interface Reshaped extends Split {
  readonly attrs: Record<string, string | null>;
}

/// `node`, con gli attributi `own` e una trasformazione `m`, con la
/// geometria che prende ciò che sa scrivere di `m`. `dashed` dice se il suo
/// contorno ha un tratteggio che si vede. `null` se tiene `m`.
function reshape(node: ElementPart, own: ReadonlyMap<string, string>, m: Matrix, dashed: boolean): Reshaped | null {
  const details = node.details!;
  const at = (name: string): number => length(own.get(name) ?? "") ?? 0;
  const attrs: Record<string, string | null> = {};
  switch (details.role) {
    case "path": {
      const fub = fubAttributes(node);
      if (SHAPED.some((name) => fub.has(name))) return null;
      const d = own.get("d");
      if (d !== undefined) attrs.d = pathData(mappedSegments(parsePath(d) ?? [], m));
      return { ...whole(m), attrs };
    }
    case "line": {
      const [x1, y1] = apply(m, [at("x1"), at("y1")]);
      const [x2, y2] = apply(m, [at("x2"), at("y2")]);
      Object.assign(attrs, { x1: place(x1), y1: place(y1), x2: place(x2), y2: place(y2) });
      return { ...whole(m), attrs };
    }
    case "polyline":
    case "polygon": {
      const list = parsePoints(own.get("points") ?? "");
      if (list !== null && list.length > 0) attrs.points = list.map((p) => apply(m, p).map(place).join(",")).join(" ");
      return { ...whole(m), attrs };
    }
    case "arrow": {
      // La punta si ridisegna dopo, quando lo spessore è deciso.
      const [x1, y1, x2, y2] = details.arrow!;
      attrs["fub:geom"] = [...apply(m, [x1, y1]), ...apply(m, [x2, y2])].map(place).join(" ");
      return { ...whole(m), attrs };
    }
    case "rect":
    case "image": {
      const aspect = details.role === "image" && (own.get("preserveAspectRatio") ?? "").trim().split(/[\t\n\f\r ]+/)[0] !== "none";
      // Un'immagine non si ribalta e non gira: si vedrebbe al contrario.
      const taken = aspect ? uniformScale(m) : details.role === "rect" && !dashed ? (axisAligned(m) ?? axisScale(m)) : axisScale(m);
      const parts = split(m, taken);
      if (parts === null) return null;
      const [x, y] = [at("x"), at("y")];
      const [x0, y0] = apply(parts.geometry, [x, y]);
      const [x1, y1] = apply(parts.geometry, [x + at("width"), y + at("height")]);
      Object.assign(attrs, { x: place(Math.min(x0, x1)), y: place(Math.min(y0, y1)), width: place(Math.abs(x1 - x0)), height: place(Math.abs(y1 - y0)) });
      if (details.role === "rect") {
        const [rx, ry] = radiiAfter(own, taken);
        attrs.rx = place(rx);
        // Un raggio solo vale per tutti e due.
        if (place(rx) !== place(ry)) attrs.ry = place(ry);
        else if (own.has("ry")) attrs.ry = null;
      }
      return { ...parts, attrs };
    }
    case "ellipse": {
      const parts = split(m, (dashed ? null : axisAligned(m)) ?? axisScale(m));
      if (parts === null) return null;
      const [cx, cy] = apply(parts.geometry, [at("cx"), at("cy")]);
      const [rx, ry] = radiiAfter(own, parts.taken);
      Object.assign(attrs, { cx: place(cx), cy: place(cy), rx: place(rx), ry: place(ry) });
      return { ...parts, attrs };
    }
    case "circle": {
      const parts = split(m, (dashed ? null : similar(m)) ?? uniformScale(m));
      if (parts === null) return null;
      const [cx, cy] = apply(parts.geometry, [at("cx"), at("cy")]);
      Object.assign(attrs, { cx: place(cx), cy: place(cy), r: place(at("r") * Math.sqrt(Math.abs(determinant(parts.taken)))) });
      return { ...parts, attrs };
    }
    case "ngon":
    case "star": {
      const shape = details.polygonal;
      if (shape === undefined) return null;
      const similarity = similar(m);
      const taken = similarity !== null && !(dashed && determinant(similarity) < 0) ? similarity : uniformScale(m);
      const parts = split(m, taken);
      if (parts === null) return null;
      const [cx, cy] = apply(parts.geometry, [shape.cx, shape.cy]);
      const k = Math.sqrt(Math.abs(determinant(taken)));
      const turn = (Math.atan2(taken[1], taken[0]) * 180) / Math.PI;
      // Un ribaltamento porta l'angolo φ in -φ: la forma resta regolare, con
      // la rotazione -180 - a, poi gira con il resto.
      const rotation = determinant(taken) > 0 ? shape.rotation + turn : turn - 180 - shape.rotation;
      const written = polygonalAttrs({ ...shape, cx, cy, r: shape.r * k, rotation, corner: shape.corner * k });
      if (written === null) return null;
      Object.assign(attrs, { "fub:geom": written["fub:geom"], d: written.d });
      return { ...parts, attrs };
    }
    case "width": {
      const v = details.varwidth;
      if (v === undefined) return null;
      // Come uno spessore: esatto per rotazioni e scale uguali, una media
      // per le altre. Ribaltata, la destra di chi percorre la linea va a
      // sinistra.
      const profile = scaledProfile(v.profile, Math.sqrt(Math.abs(determinant(m))));
      const written = widthAttrs({ cap: v.cap, join: v.join, profile: determinant(m) < 0 ? swappedProfile(profile) : profile, spine: mappedSegments(spineOf(v), m) });
      if (written === null) return null;
      Object.assign(attrs, { "fub:geom": written.geom, d: written.d });
      return { ...whole(m), attrs };
    }
    case "stroke": {
      if (details.stroke?.redrawable !== true) return null;
      const taken = similar(m);
      const parts = taken === null ? null : split(m, taken);
      if (parts === null) return null;
      const ink = movedInk(fubAttributes(node), parts.geometry);
      return ink === null ? null : { ...parts, attrs: ink };
    }
    default:
      return null;
  }
}

/// I raggi di un'ellisse o degli angoli di un rettangolo dopo `taken`, una
/// scala lungo gli assi con al più un quarto di giro. In SVG 2 un raggio
/// assente vale l'altro.
function radiiAfter(own: ReadonlyMap<string, string>, taken: Matrix): Point {
  const rx = nonNegativeLength(own.get("rx") ?? "");
  const ry = nonNegativeLength(own.get("ry") ?? "");
  const [x, y] = [rx ?? ry ?? 0, ry ?? rx ?? 0];
  return [Math.abs(taken[0]) * x + Math.abs(taken[2]) * y, Math.abs(taken[1]) * x + Math.abs(taken[3]) * y];
}

// ---------------------------------------------------------------------------
// Gli elementi.
// ---------------------------------------------------------------------------

/// Gli attributi da scrivere su un elemento.
interface Change {
  readonly node: ElementPart;
  readonly attrs: Record<string, string | null>;
}

/// Ciò che diventa un oggetto: i cambi, e se a lui o a una sua parte resta
/// una trasformazione.
interface Baked {
  readonly changes: readonly Change[];
  readonly kept: boolean;
}

/// `node` tiene `m` come trasformazione: com'è scritta, se non gliel'ha
/// data il gruppo che la passa (`pushed`). `null` se `m` non si scrive.
function keep(node: ElementPart, own: ReadonlyMap<string, string>, m: Matrix, pushed: boolean): Baked | null {
  const value = transformValue(m);
  if (value !== null && pushed && !writable(m)) return null;
  const current = own.get("transform");
  const same = value === null ? current === undefined : !pushed || value === current;
  return { changes: same ? [] : [{ node, attrs: { transform: value } }], kept: value !== null };
}

/// `node` con la sua trasformazione, e `pushed` del gruppo che la passa,
/// nella geometria. `from` è ciò che eredita. `null` se un gruppo deve
/// tenere `pushed` per lui.
function bake(node: ElementPart, pushed: Matrix | null, from: Inherited): Baked | null {
  const role = node.details!.role;
  if ((role === "group" || role === "link") && node.kind === "container") return bakeContainer(node, pushed, from);
  const own = plainAttributes(node);
  const before = parseTransform(own.get("transform") ?? "") ?? IDENTITY;
  const m = pushed === null ? before : compose(pushed, before);
  const kept = (): Baked | null => keep(node, own, m, pushed !== null);
  // Una trasformazione che schiaccia il piano non ha una geometria in cui
  // passare: l'oggetto non si vede, e resta com'è.
  if (transformValue(m) === null || !(determinant(m) !== 0 && Number.isFinite(determinant(m)))) return kept();
  const outline = STROKED.has(role) ? outlineOf(own, from) : null;
  const reshaped = reshape(node, own, m, outline !== null && outline.dashes !== null);
  if (reshaped === null) return kept();
  const attrs = { ...reshaped.attrs };
  const k = Math.sqrt(Math.abs(determinant(reshaped.taken)));
  if (outline !== null) {
    const width = place(outline.width * k);
    if (width === "0") return kept();
    if (width !== place(outline.width)) attrs["stroke-width"] = width;
    if (outline.dashes !== null) {
      const dashes = outline.dashes.map((dash) => place(dash * k));
      if (dashes.every((dash) => dash === "0")) return kept();
      if (dashes.join(" ") !== outline.dashes.map(place).join(" ")) attrs["stroke-dasharray"] = dashes.join(" ");
    }
  }
  if (role === "arrow") {
    // La punta della regola, sullo spessore scritto: senza, quello iniziale.
    const written = attrs["stroke-width"] ?? own.get("stroke-width");
    const [x1, y1, x2, y2] = attrs["fub:geom"]!.split(" ").map(Number) as [number, number, number, number];
    attrs.d = arrowPath(x1, y1, x2, y2, written === undefined || written === null ? 1 : (nonNegativeLength(written) ?? 1));
  }
  const rest = transformValue(reshaped.rest);
  if (rest !== null && !writable(reshaped.rest)) return kept();
  attrs.transform = rest;
  const tag = node.details!.tag;
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && !name.includes(":") && !svgAttribute(tag, name, value)) return kept();
  }
  // Ciò che resta uguale non si scrive, e uno zero assente resta assente.
  const fub = Object.keys(attrs).some((name) => name.startsWith("fub:")) ? fubAttributes(node) : null;
  for (const [name, value] of Object.entries(attrs)) {
    const current = name.startsWith("fub:") ? fub!.get(name.slice(4)) : own.get(name);
    if (value === null ? current === undefined : value === current || (current === undefined && value === "0" && ZERO.has(name))) delete attrs[name];
  }
  return { changes: Object.keys(attrs).length === 0 ? [] : [{ node, attrs }], kept: rest !== null };
}

/// Un gruppo o un collegamento passa la sua trasformazione ai figli, se sono
/// tutti modificabili e la sanno prendere; altrimenti la tiene, e i figli
/// applicano solo la loro.
function bakeContainer(node: ContainerNode, pushed: Matrix | null, from: Inherited): Baked | null {
  const own = plainAttributes(node);
  const before = parseTransform(own.get("transform") ?? "") ?? IDENTITY;
  const m = pushed === null ? before : compose(pushed, before);
  const inner = passed(node, from);
  // Titolo e descrizione non si disegnano.
  const children = elementChildren(node).filter((child) => !(child.facts.uri === SVG_NS && (child.facts.local === "title" || child.facts.local === "desc")));
  if (transformValue(m) !== null && children.every((child) => child.details !== null)) {
    const baked = children.map((child) => bake(child, m, inner));
    if (baked.every((one) => one !== null)) {
      const changes: Change[] = own.has("transform") ? [{ node, attrs: { transform: null } }] : [];
      for (const one of baked) changes.push(...one!.changes);
      return { changes, kept: baked.some((one) => one!.kept) };
    }
  }
  const self = keep(node, own, m, pushed !== null);
  if (self === null) return null;
  const changes = [...self.changes];
  let kept = self.kept;
  for (const child of children) {
    if (child.details === null) continue;
    // Senza niente da passare, un figlio non chiede mai al gruppo di tenere.
    const one = bake(child, null, inner)!;
    changes.push(...one.changes);
    kept ||= one.kept;
  }
  return { changes, kept };
}

/// «Applica trasformazione» pronta: le operazioni, quanti oggetti scelti
/// cambiano, e quanti, dopo, hanno ancora una trasformazione, in sé o in una
/// parte.
export interface Applied extends Arranged {
  readonly changed: number;
  readonly kept: number;
}

/// Le operazioni che portano la trasformazione di `units` nella loro
/// geometria. La selezione resta la stessa; un elemento che cambia senza id
/// ne riceve uno.
export function applyOps(model: DocumentModel, units: readonly Unit[], ids: NewIds): Applied {
  const plan = new Plan(model, ids);
  let changed = 0;
  let kept = 0;
  for (const unit of units) {
    const node = nodeOf(model, unit);
    // Un oggetto scelto non ha un gruppo che gli passi qualcosa: `bake` lo
    // fa sempre.
    const baked = bake(node, null, inheritedBy(node))!;
    for (const change of baked.changes) plan.ops.push({ op: "set", id: plan.idOf(change.node), attrs: change.attrs });
    if (baked.changes.length > 0) changed++;
    if (baked.kept) kept++;
  }
  const keys = units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key));
  return { ...plan.finish(keys), changed, kept };
}
