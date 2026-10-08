// I nodi di ogni forma, per lo strumento «Nodi» del livello Esperto: come in
// Illustrator ogni oggetto che si disegna ha nodi da trascinare, non solo i
// tracciati. Qui si leggono, e la modifica si riscrive. Senza DOM.
//
// - **Una forma mostra i nodi del tracciato con cui SVG 2 la definisce**,
//   con gli archi fatti cubiche: un'ellisse ha quattro nodi con le maniglie,
//   un rettangolo arrotondato otto. Un poligono regolare e una stella hanno
//   quelli del loro `d`; una linea, una spezzata e un poligono i loro punti.
// - **La forma resta lei finché può.** Un rettangolo resta un rettangolo se
//   i nodi ne disegnano ancora uno coi suoi raggi, un'ellisse un'ellisse e un
//   cerchio un cerchio; una linea, una spezzata e un poligono finché i
//   segmenti sono linee; un poligono regolare e una stella finché i nodi si
//   spostano tutti insieme. Altrimenti diventa un tracciato nello stesso
//   passo di annulla, come con «Oggetto in tracciato».
// - **Una freccia ha i due capi dell'asta**, e resta una freccia: la punta
//   segue. Ciò che le darebbe altri nodi o una curva si rifiuta.
// - **Un tratto a penna ha i nodi della sua spina** (`spine.ts`), e resta un
//   tratto: l'inchiostro segue la spina, e il contorno lo ricalcola il
//   pennello. Spezzarlo o chiuderlo si rifiuta.
// - **Una linea a spessore variabile ha i nodi della sua linea** (`profile.ts`),
//   e resta lei: il profilo segue la linea, alla stessa frazione della
//   lunghezza, e il contorno si ricalcola. Spezzarla in più pezzi si
//   rifiuta.
// - **Un testo su tracciato ha i nodi del tracciato che segue**, la sua
//   risorsa, nelle coordinate del testo: la modifica cambia quel tracciato,
//   e il testo lo segue. Il tracciato resta lungo più di zero, o il testo
//   non avrebbe dove scorrere.
// - **Le punte stanno ai capi** (`endtips.ts`). SVG le disegna sul primo e
//   sull'ultimo vertice: inserire, togliere o spezzare nodi le lascia dov'è
//   il primo e l'ultimo. Una modifica che unisce due capi, e uno di loro non
//   è più un capo, si porta via la sua punta; una che lascia l'oggetto senza
//   sottotracciati aperti, chiudendo l'ultimo, toglie `marker-start` e
//   `marker-end`.

import { formatNumber } from "../number";
import { parseBrush, type Pf1Brush } from "../ink/brush";
import { decodeInk, encodeInk, INK_MAX_BYTES, inkLength, inkPoint, inkToQuantized, type Ink } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { parsePath, Track, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import type { ElementPart } from "../scene/model";
import { polygonalAttrs, type Polygonal } from "../scene/parametric";
import { pathData, type Elem } from "../scene/serialize";
import { spineOf as widthSpine } from "../scene/varwidth";
import { nonNegativeLength } from "../scene/values";
import { fubAttributes, plainAttributes, type Plan } from "./arrange";
import { tipsAfter } from "./cut";
import { tipAttrs, type EndTips } from "./endtips";
import { shapeSegments } from "./hit";
import { arcsAsCubics, readNodes, writeNodes, type NodeKey, type Subpath } from "./nodes";
import { arrowPath } from "./shapes";
import { widthAttrs, widthOutline, type WidthShape } from "./profile";
import { fitSpine, followedInk, spineMoves, spineTolerance, type Spine } from "./spine";
import { GEOMETRY, replaceWithPath, syntheticNulls, withoutStill } from "./topath";

/// Le forme coi nodi della loro geometria SVG.
export type ShapeTag = "rect" | "ellipse" | "circle" | "line" | "polyline" | "polygon";

/// Un oggetto di cui lo strumento Nodi modifica i nodi, coi nodi che mostra
/// e ciò che serve a riscriverlo.
export type Nodable =
  | { readonly kind: "path"; readonly subs: readonly Subpath[] }
  | { readonly kind: "shape"; readonly tag: ShapeTag; readonly attrs: ReadonlyMap<string, string>; readonly subs: readonly Subpath[] }
  | { readonly kind: "polygonal"; readonly shape: Polygonal; readonly subs: readonly Subpath[] }
  | { readonly kind: "arrow"; readonly width: number; readonly subs: readonly Subpath[] }
  | { readonly kind: "stroke"; readonly ink: Ink; readonly brush: Pf1Brush; readonly spine: Spine; readonly subs: readonly Subpath[] }
  | { readonly kind: "width"; readonly shape: WidthShape; readonly subs: readonly Subpath[] }
  /// Il tracciato che un testo segue: la risorsa `target`.
  | { readonly kind: "track"; readonly target: string; readonly subs: readonly Subpath[] };

/// Perché un oggetto non ha nodi da modificare: un testo, un'immagine, dati
/// che non si leggono, una forma che non disegna niente, un tratto che non
/// si ridisegna, una parte di un altro programma, che resta com'è, o un
/// oggetto che non è una forma.
export type NoNodes = "text" | "image" | "connector" | "unreadable" | "empty" | "stroke" | "foreign" | "other";

/// La spina di un inchiostro: `text` è il suo `fub:ink`, per chi la ricorda.
export type SpineOf = (text: string, ink: Ink, tolerance: number) => Spine;

/// La spina dei campioni di `ink`, entro `tolerance`.
export const inkSpine = (ink: Ink, tolerance: number): Spine =>
  fitSpine(Array.from({ length: inkLength(ink) }, (_, i) => inkPoint(ink, i)), tolerance);

const freshSpine: SpineOf = (_text, ink, tolerance) => inkSpine(ink, tolerance);

/// Il `d` del tracciato `id` che un testo segue; `null` se non c'è o non è
/// un tracciato.
export type TrackOf = (id: string) => string | null;

/// La distanza fra i campioni che basta a un tratto di pennello `size`,
/// quando la spina si allunga.
const sampleGap = (size: number): number => Math.max(0.5, size / 4);

/// Quanto due nodi possono scostarsi ed essere lo stesso: le coordinate si
/// scrivono al centesimo, e due punti scritti al centesimo sbagliano al più
/// di un centesimo e mezzo fra loro.
const SAME = 0.02;

const text = (value: number): string => formatNumber(value, 2);

/// I nodi di `segments`, con gli archi fatti cubiche.
const nodesOf = (segments: readonly Segment[]): Subpath[] => arcsAsCubics(readNodes(segments));

/// I nodi della forma `tag` con gli attributi `attrs`: quelli del tracciato
/// che SVG 2 le dà, senza i lati che gli angoli arrotondati consumano.
function shapeSubs(tag: ShapeTag, attrs: ReadonlyMap<string, string>): Subpath[] {
  let segments = shapeSegments(tag, [...attrs]);
  if (tag === "rect") segments = withoutStill(segments);
  return nodesOf(segments);
}

/// Il tracciato `d` come nodi; `null` se non si legge.
function pathSubs(d: string | undefined): Subpath[] | null {
  const segments = parsePath(d ?? "");
  return segments === null ? null : readNodes(segments);
}

/// Ciò che lo strumento Nodi modifica in `node`, o perché niente. `spineOf`
/// dà la spina di un tratto: chi modifica la ricorda, così i nodi restano
/// quelli di prima dopo una modifica e dopo un annulla. `trackOf` dà il
/// tracciato di un testo su tracciato: senza, un testo non ha nodi.
export function nodableOf(node: ElementPart, spineOf: SpineOf = freshSpine, trackOf?: TrackOf): Nodable | NoNodes {
  const details = node.details;
  if (details === null) return "foreign";
  const attrs = plainAttributes(node);
  const nodable = (made: Nodable): Nodable | NoNodes => (made.subs.length === 0 ? "empty" : made);
  switch (details.role) {
    case "text": {
      const target = details.textPath;
      if (target === undefined || trackOf === undefined) return "text";
      const d = trackOf(target);
      const subs = d === null ? null : pathSubs(d);
      return subs === null ? "unreadable" : nodable({ kind: "track", target, subs });
    }
    case "image":
      return "image";
    // Il percorso lo calcola FubDraw dagli agganci.
    case "connector":
      return "connector";
    case "path": {
      const subs = pathSubs(attrs.get("d"));
      return subs === null ? "unreadable" : nodable({ kind: "path", subs });
    }
    case "rect":
    case "ellipse":
    case "circle":
    case "line":
    case "polyline":
    case "polygon":
      return nodable({ kind: "shape", tag: details.role, attrs, subs: shapeSubs(details.role, attrs) });
    case "ngon":
    case "star": {
      const segments = parsePath(attrs.get("d") ?? "");
      if (segments === null) return "unreadable";
      const shape = details.polygonal;
      const subs = nodesOf(segments);
      return nodable(shape === undefined ? { kind: "path", subs: readNodes(segments) } : { kind: "polygonal", shape, subs });
    }
    case "arrow": {
      const ends = details.arrow;
      if (ends === undefined) return "unreadable";
      const written = attrs.get("stroke-width");
      const width = written === undefined ? 1 : (nonNegativeLength(written) ?? 1);
      return { kind: "arrow", width, subs: [{ nodes: [[ends[0], ends[1]], [ends[2], ends[3]]], links: [{ kind: "line" }], closed: false }] };
    }
    case "width": {
      const v = details.varwidth;
      if (v === undefined) return "unreadable";
      const shape: WidthShape = { cap: v.cap, join: v.join, profile: v.profile, spine: widthSpine(v) };
      return nodable({ kind: "width", shape, subs: readNodes(shape.spine) });
    }
    case "stroke": {
      if (details.stroke?.redrawable !== true) return "stroke";
      const fub = fubAttributes(node);
      const written = fub.get("ink") ?? "";
      try {
        const ink = decodeInk(written);
        const brush = parseBrush(fub.get("brush") ?? "");
        const spine = spineOf(written, ink, spineTolerance(brush.size));
        return { kind: "stroke", ink, brush, spine, subs: [spine.sub] };
      } catch {
        return "unreadable";
      }
    }
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// La riscrittura.
// ---------------------------------------------------------------------------

/// Ciò che una modifica dei nodi fa dell'oggetto.
export type Rewrite =
  /// L'oggetto resta lui, con questi attributi; `look` è il `d` che si vedrà,
  /// quando non lo dicono gli attributi, e `spine` la spina nuova di un
  /// tratto. `tips` dice le punte dei suoi capi, se la modifica le cambia.
  | { readonly kind: "set"; readonly attrs: Readonly<Record<string, string>>; readonly look?: string; readonly spine?: Spine; readonly tips?: EndTips }
  /// Diventa un `path` con questo `d`, e queste punte, se la modifica le
  /// cambia.
  | { readonly kind: "path"; readonly d: string; readonly tips?: EndTips }
  /// Il tracciato che il testo segue diventa `d`.
  | { readonly kind: "track"; readonly target: string; readonly d: string }
  /// Non disegna più niente.
  | { readonly kind: "remove" }
  /// Resta com'è: la modifica non arriva al centesimo.
  | { readonly kind: "same" }
  /// Non si fa: una freccia ha due capi e un'asta dritta, un tratto è un
  /// tratto solo e aperto, una linea a spessore variabile è un pezzo solo,
  /// un inchiostro troppo lungo non si scrive, e il tracciato di un testo
  /// resta lungo più di zero.
  | { readonly kind: "refused"; readonly reason: "arrow" | "stroke" | "width" | "long" | "track" };

/// Vero se `a` e `b` hanno gli stessi nodi, gli stessi segmenti e le stesse
/// maniglie, al centesimo.
export function sameSubs(a: readonly Subpath[], b: readonly Subpath[]): boolean {
  const near = (p: Point, q: Point): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME;
  return a.length === b.length && a.every((sub, s) => {
    const other = b[s]!;
    if (sub.closed !== other.closed || sub.nodes.length !== other.nodes.length || sub.links.length !== other.links.length) return false;
    if (!sub.nodes.every((node, at) => near(node, other.nodes[at]!))) return false;
    return sub.links.every((link, i) => {
      const that = other.links[i]!;
      if (link.kind !== that.kind) return false;
      switch (link.kind) {
        case "line": return true;
        case "quad": return near(link.control, (that as typeof link).control);
        case "cubic": return near(link.c1, (that as typeof link).c1) && near(link.c2, (that as typeof link).c2);
        case "arc": {
          const arc = that as typeof link;
          return near(link.radii, arc.radii) && Math.abs(link.rotation - arc.rotation) <= SAME && link.large === arc.large && link.sweep === arc.sweep;
        }
      }
    });
  });
}

/// Il riquadro dei nodi di `subs`.
function nodesBox(subs: readonly Subpath[]): { readonly min: Point; readonly max: Point } | null {
  let min: Point | null = null;
  let max: Point | null = null;
  for (const sub of subs) {
    for (const [x, y] of sub.nodes) {
      min = min === null ? [x, y] : [Math.min(min[0], x), Math.min(min[1], y)];
      max = max === null ? [x, y] : [Math.max(max[0], x), Math.max(max[1], y)];
    }
  }
  return min === null || max === null ? null : { min, max };
}

/// La geometria della forma `tag` che i nodi `subs` potrebbero disegnare,
/// coi numeri come li scrive il file; `null` se di sicuro non ne disegnano
/// una. Chi la usa verifica rifacendone i nodi.
function shapeGeometry(tag: ShapeTag, subs: readonly Subpath[]): Record<string, string> | null {
  if (subs.length !== 1) return null;
  const sub = subs[0]!;
  const list = (): string => sub.nodes.map(([x, y]) => `${text(x)},${text(y)}`).join(" ");
  switch (tag) {
    case "line": {
      if (sub.closed || sub.nodes.length !== 2) return null;
      const [[x1, y1], [x2, y2]] = sub.nodes as [Point, Point];
      return { x1: text(x1), y1: text(y1), x2: text(x2), y2: text(y2) };
    }
    case "polyline":
      return sub.closed ? null : { points: list() };
    case "polygon":
      return sub.closed ? { points: list() } : null;
    default: {
      const box = nodesBox(subs);
      if (box === null || !sub.closed) return null;
      const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
      if (tag === "rect") return { x: text(box.min[0]), y: text(box.min[1]), width: text(w), height: text(h) };
      const [cx, cy] = [text(box.min[0] + w / 2), text(box.min[1] + h / 2)];
      if (tag === "ellipse") return { cx, cy, rx: text(w / 2), ry: text(h / 2) };
      return text(w / 2) === text(h / 2) ? { cx, cy, r: text(w / 2) } : null;
    }
  }
}

/// Gli attributi della forma che resta lei con i nodi `subs`, solo quelli
/// che cambiano; `null` se i nodi non ne disegnano più una come lei.
function keptShape(nodable: Extract<Nodable, { readonly kind: "shape" }>, subs: readonly Subpath[]): Record<string, string> | null {
  const geometry = shapeGeometry(nodable.tag, subs);
  if (geometry === null) return null;
  const attrs = new Map(nodable.attrs);
  for (const [name, value] of Object.entries(geometry)) attrs.set(name, value);
  if (!sameSubs(shapeSubs(nodable.tag, attrs), subs)) return null;
  const changed: Record<string, string> = {};
  for (const [name, value] of Object.entries(geometry)) if (nodable.attrs.get(name) !== value) changed[name] = value;
  return changed;
}

/// `fub:geom` e `d` del poligono regolare o della stella spostati con i nodi
/// `subs`; `null` se i nodi non si sono spostati tutti insieme.
function keptPolygonal(nodable: Extract<Nodable, { readonly kind: "polygonal" }>, subs: readonly Subpath[]): Record<string, string> | null {
  const was = nodable.subs[0]?.nodes[0];
  const now = subs[0]?.nodes[0];
  if (was === undefined || now === undefined) return null;
  const { shape } = nodable;
  const attrs = polygonalAttrs({ ...shape, cx: shape.cx + now[0] - was[0], cy: shape.cy + now[1] - was[1] });
  if (attrs === null) return null;
  const segments = parsePath(attrs.d);
  return segments !== null && sameSubs(nodesOf(segments), subs) ? { "fub:geom": attrs["fub:geom"], d: attrs.d } : null;
}

/// I capi dell'asta di una freccia coi nodi `subs`; `null` se non sono due
/// nodi con una linea fra loro.
function arrowEnds(subs: readonly Subpath[]): [number, number, number, number] | null {
  const sub = subs[0];
  if (subs.length !== 1 || sub === undefined || sub.closed || sub.nodes.length !== 2 || sub.links[0]?.kind !== "line") return null;
  const [[x1, y1], [x2, y2]] = sub.nodes as [Point, Point];
  return [x1, y1, x2, y2];
}

/// L'inchiostro di un tratto che segue la spina diventata `subs`, con i nodi
/// portati da `moved`; `null` se non si può.
function strokeFollowing(nodable: Extract<Nodable, { readonly kind: "stroke" }>, subs: readonly Subpath[], moved: ReadonlyMap<NodeKey, NodeKey> | null): { readonly ink: Ink; readonly spine: Spine } | null {
  const sub = subs[0];
  if (subs.length !== 1 || sub === undefined || sub.closed) return null;
  const { brush } = nodable;
  return followedInk(nodable.ink, nodable.spine, sub, moved === null ? null : spineMoves(moved), { dense: !brush.sim, gap: sampleGap(brush.size) });
}

/// Ciò che diventa `nodable` coi nodi `subs`. `moved` porta ogni nodo che
/// resta dove è finito, se la modifica ne ha aggiunti o tolti; senza, i nodi
/// sono gli stessi. Le punte di un tracciato o di una linea seguono i nodi
/// che sono i loro capi, a meno che `tips` non dica altro: la modifica che
/// porta in un oggetto i capi di un altro.
export function rewrite(nodable: Nodable, subs: readonly Subpath[], moved: ReadonlyMap<NodeKey, NodeKey> | null, tips?: EndTips): Rewrite {
  const segments = writeNodes(subs);
  if (nodable.kind === "track") {
    return new Track(segments).length > 0 ? { kind: "track", target: nodable.target, d: pathData(segments) } : { kind: "refused", reason: "track" };
  }
  if (segments.length === 0) return { kind: "remove" };
  const d = pathData(segments);
  switch (nodable.kind) {
    case "path": {
      const ends = tips ?? tipsAfter(nodable.subs, subs, moved);
      return ends === undefined ? { kind: "set", attrs: { d } } : { kind: "set", attrs: { d }, tips: ends };
    }
    case "shape": {
      const attrs = keptShape(nodable, subs);
      const ends = tips ?? tipsAfter(nodable.subs, subs, moved);
      if (attrs === null) return ends === undefined ? { kind: "path", d } : { kind: "path", d, tips: ends };
      if (Object.keys(attrs).length === 0) return { kind: "same" };
      return ends === undefined ? { kind: "set", attrs } : { kind: "set", attrs, tips: ends };
    }
    case "polygonal": {
      const attrs = keptPolygonal(nodable, subs);
      return attrs === null ? { kind: "path", d } : { kind: "set", attrs };
    }
    case "arrow": {
      const ends = arrowEnds(subs);
      if (ends === null) return { kind: "refused", reason: "arrow" };
      const geom = ends.map(text);
      return { kind: "set", attrs: { "fub:geom": geom.join(" "), d: arrowPath(...(geom.map(Number) as [number, number, number, number]), nodable.width) } };
    }
    case "width": {
      if (subs.length !== 1) return { kind: "refused", reason: "width" };
      const written = widthAttrs({ ...nodable.shape, spine: segments });
      return written === null ? { kind: "refused", reason: "width" } : { kind: "set", attrs: { "fub:geom": written.geom, d: written.d } };
    }
    case "stroke": {
      const followed = strokeFollowing(nodable, subs, moved);
      if (followed === null) return { kind: "refused", reason: "stroke" };
      const ink = encodeInk(followed.ink);
      // Il testo è ASCII: i caratteri sono i byte.
      if (ink.length > INK_MAX_BYTES) return { kind: "refused", reason: "long" };
      return { kind: "set", attrs: { "fub:ink": ink }, look: pf1(inkToQuantized(followed.ink), nodable.brush), spine: followed.spine };
    }
  }
}

/// Il `d` che si vede mentre i nodi di `nodable` diventano `subs`, prima di
/// scriverli: la freccia con la sua punta, il tratto col suo contorno.
/// `null` se la modifica non si farà.
export function draftOf(nodable: Nodable, subs: readonly Subpath[]): string | null {
  if (nodable.kind === "arrow") {
    const ends = arrowEnds(subs);
    return ends === null ? null : arrowPath(...ends, nodable.width);
  }
  if (nodable.kind === "stroke") {
    const followed = strokeFollowing(nodable, subs, null);
    return followed === null ? null : pf1(inkToQuantized(followed.ink), nodable.brush);
  }
  if (nodable.kind === "width") {
    const outline = subs.length === 1 ? widthOutline({ ...nodable.shape, spine: writeNodes(subs) }) : null;
    return outline === null || typeof outline === "string" || outline.length === 0 ? null : pathData(outline);
  }
  return pathData(writeNodes(subs));
}

/// Le operazioni di `change` su `node`, nel piano `plan`: gli attributi, o
/// il `path` al suo posto, con lo stesso id e allo stesso posto. Torna
/// l'elemento com'è dopo, per misurarlo; `null`, senza operazioni, se un
/// attributo dell'oggetto non si sa riscrivere su un `path`.
export function rewriteOps(plan: Plan, node: ElementPart, change: Extract<Rewrite, { readonly kind: "set" | "path" }>): Elem | null {
  const tag = node.details!.tag;
  const own = plainAttributes(node);
  const plain = Object.fromEntries(own);
  const tips = change.tips === undefined ? {} : tipAttrs(own, change.tips);
  // L'elemento com'è dopo, senza gli attributi che le punte tolgono.
  const tipped = (after: Record<string, string>): Record<string, string> => {
    for (const [name, value] of Object.entries(tips)) {
      if (value === null) delete after[name];
      else after[name] = value;
    }
    return after;
  };
  if (change.kind === "set") {
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs: { ...change.attrs, ...tips } });
    const after: Record<string, string> = { ...plain };
    for (const [name, value] of Object.entries(change.attrs)) if (!name.includes(":")) after[name] = value;
    if (change.look !== undefined) after.d = change.look;
    return { tag, attrs: tipped(after) };
  }
  if (tag === "path") {
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs: { ...syntheticNulls(node), d: change.d, ...tips } });
  } else if (!replaceWithPath(plan, node, change.d)) {
    return null;
  } else if (Object.keys(tips).length > 0) {
    // Il `path` nuovo ha le punte che aveva la forma: le sue sono queste.
    plan.ops.push({ op: "set", id: plan.idOf(node), attrs: tips });
  }
  const geometry = GEOMETRY[tag] ?? [];
  const after: Record<string, string> = { d: change.d };
  for (const [name, value] of Object.entries(plain)) if (!geometry.includes(name) && name !== "d") after[name] = value;
  return { tag: "path", attrs: tipped(after) };
}
