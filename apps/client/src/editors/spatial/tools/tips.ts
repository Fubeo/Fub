// Le punte delle linee (livello Standard): all'inizio e alla fine di linee,
// spezzate e tracciati aperti, da una raccolta di forme in tre misure. Ciò
// che ne legge il pannello delle proprietà, le operazioni che le danno, le
// cambiano e le tolgono, e quelle che le tengono del colore della linea
// (formato della scena, risorse).
//
// - **Una punta è un marcatore condiviso.** Sta fra le risorse del disegno,
//   un `marker` con `fub:role="shared"`, e `fub:marker` dice com'è fatta:
//   forma, misura e capo, «triangle medium end». La linea lo nomina con
//   `marker-start` o `marker-end`, e quando nessuno lo usa più il motore lo
//   toglie, nello stesso passo. È della raccolta solo il marcatore che
//   FubDraw scriverebbe identico: ogni altro, anche con un `fub:marker`, è
//   «custom», e le operazioni lo lasciano com'è.
// - **Chi può averle.** Linee, spezzate e tracciati senza `Z`; e ogni
//   `path`, `line`, `polyline` o `polygon` che ne ha già, perché si possano
//   togliere. Non le frecce, i poligoni regolari e le stelle, i tratti a
//   penna, le linee a spessore variabile, i testi e le parti estranee. Un
//   gruppo o un collegamento passano il cambio alle parti, e una parte
//   bloccata dentro un gruppo scelto resta com'è. `marker-mid` non si scrive
//   e non si tocca.
// - **La misura è in spessori della linea**, come `markerUnits` di SVG: la
//   punta cresce e cala con la linea. La testa è larga 3,5, 5 o 7 spessori.
//   Il capo d'inizio è il capovolto di quello di fine, perché SVG 1.1 non
//   ha `auto-start-reverse`; la forma è un solo elemento, un `path` o un
//   `circle`.
// - **Una punta copre il capo della linea**, quadrato, tondo o netto che
//   sia: la cima del triangolo e del rombo sta 1,4 spessori oltre l'estremo,
//   quella della punta aperta mezzo spessore, e le sue braccia, tracciate
//   con estremi e angoli tondi, chiudono anche il canto di un estremo
//   quadrato. Il contenuto sta dentro il riquadro del marcatore, che SVG
//   ritaglia, con un margine di mezzo spessore.
// - **Una punta ha il colore della linea**: quello dello `stroke` che la
//   linea vede, scritto da lei o ereditato, con la sua opacità. Un colore
//   resta tale; un campione del documento si scrive `url(#id) #rrggbb`; per
//   un'altra sfumatura vale il colore che ha nel vertice dove sta la punta,
//   nelle coordinate della linea, e se non si sa calcolare, come per un
//   motivo, il ripiego del riferimento o il nero. Con `stroke="none"` la
//   punta non si vede ma resta, e riappare col contorno. Uno `stroke` che
//   non si legge lascia le punte com'erano.
// - **Si condividono.** Due linee dello stesso colore con la stessa punta
//   usano un marcatore solo, e un comando ne aggiunge uno per volta anche su
//   mille linee; un marcatore uguale che il disegno ha già si riusa.
// - **Le punte seguono la linea** ([`followTips`]): dopo ogni operazione il
//   motore chiede se qualche punta ha perso il colore della sua linea, e la
//   risposta entra nello stesso passo e nello stesso annulla. Cambiare il
//   colore o l'opacità del contorno, quello del gruppo che lo passa,
//   spostare la linea su una sfumatura, cambiare la sfumatura o ricolorare
//   un campione non lascia punte del colore di prima.
// - **Le punte vanno con lo stile.** Copiare lo stile di una linea porta le
//   punte, capo per capo: la forma e la misura, `none` per un capo senza
//   punta, niente per un capo con un marcatore di un altro programma. Chi
//   lo riceve le ricrea per nome con i marcatori del proprio disegno,
//   riusati o aggiunti una volta sola: l'id di un marcatore non passa da un
//   disegno all'altro. Il colore lo rimette il seguito, nello stesso passo.
// - **Le punte entrano nel contorno.** «Contorno in tracciato» fa della
//   linea e delle sue punte una forma sola: l'area di ogni punta si mette
//   dove la mette lo schermo (il vertice, il suo verso, lo spessore) e si
//   unisce a quella del contorno. Un marcatore che non è della raccolta, o a
//   metà del tracciato, non si sa contornare, e la forma resta com'è. Lo
//   scostamento non porta le punte sul tracciato nuovo, e lo spessore
//   variabile non le ha: una linea con le punte non lo cambia.
// - **Mille linee** si leggono entro un fotogramma: gli attributi di un
//   nodo e ciò che un contenitore passa ai figli si leggono una volta sola,
//   finché un'operazione non li cambia; i marcatori del disegno si leggono
//   una volta per comando; e il seguito guarda ciò che l'operazione ha
//   toccato, non il disegno intero.

import { formatNumber } from "../number";
import type { Role } from "../scene/analysis";
import { parsePath } from "../scene/geometry";
import type { Segment } from "../scene/geometry";
import { markerFit, markerMatrix, placed, vertices, type MarkerPlace, type Vertex } from "../scene/markers";
import type { Point } from "../scene/matrix";
import { elementChildren, writtenOf, type ContainerNode, type DocumentModel, type ElementPart, type LeafNode } from "../scene/model";
import type { Op } from "../scene/ops";
import { pathData, type Elem } from "../scene/serialize";
import { length, nonNegativeLength, opacity as parseOpacity, paint as parsePaint, paintReference, points as parsePoints, reference, trim } from "../scene/values";
import { elemOf, plainAttributes, Plan, type Arranged } from "./arrange";
import { mapped } from "./boolean";
import { gesture, type NewIds } from "./edit";
import { geometryBox, shapeSegments, type Unit } from "./hit";
import { strokeArea, type Cap, type Join } from "./offset";
import { gradientOf, gradientPaint, homeOf, paintCode, resourcesOf, swatchPaint, type Gradient, type Home } from "./resources";

/// Una forma della raccolta: il triangolo pieno, la punta aperta, il
/// cerchio, il quadrato, il rombo e la barra di traverso.
export type TipShape = "triangle" | "vee" | "circle" | "square" | "diamond" | "bar";

export const TIP_SHAPES: readonly TipShape[] = ["triangle", "vee", "circle", "square", "diamond", "bar"];

/// Quanto è grande una punta, in proporzione allo spessore della linea.
export type TipSize = "small" | "medium" | "large";

export const TIP_SIZES: readonly TipSize[] = ["small", "medium", "large"];

/// La misura di una punta nuova.
export const DEFAULT_TIP_SIZE: TipSize = "medium";

/// Il capo della linea dove sta una punta.
export type TipEnd = "start" | "end";

export const TIP_ENDS: readonly TipEnd[] = ["start", "end"];

/// Una punta della raccolta.
export interface Tip {
  readonly shape: TipShape;
  readonly size: TipSize;
}

/// Ciò che mostra un capo delle linee scelte, come lo dice il pannello: la
/// forma, `none` se non ne ha, `custom` per un marcatore che non è della
/// raccolta, `null` se le linee non sono d'accordo; la misura delle punte
/// della raccolta, `null` se non ce n'è nessuna o se sono di misure
/// diverse.
export interface EndLook {
  readonly shape: TipShape | "none" | "custom" | null;
  readonly size: TipSize | null;
}

/// Le punte della selezione: quante parti ne possono avere, e i due capi.
export interface TipsLook {
  readonly count: number;
  readonly start: EndLook;
  readonly end: EndLook;
}

/// Un cambio delle punte della selezione: la forma di un capo, `none` per
/// toglierla; la misura della punta di un capo; o le due punte scambiate.
export type TipChange =
  | { readonly end: TipEnd; readonly shape: TipShape | "none" }
  | { readonly end: TipEnd; readonly size: TipSize }
  | { readonly swap: true };

// ---------------------------------------------------------------------------
// Il marcatore di una punta.
// ---------------------------------------------------------------------------

/// Quanto è larga la testa di una punta, in spessori della linea.
const HEAD: Readonly<Record<TipSize, number>> = { small: 3.5, medium: 5, large: 7 };

/// Il coseno di 30°: le braccia della punta aperta e i lati del triangolo
/// stanno a 30° dall'asse.
const COS30 = Math.sqrt(3) / 2;

/// Quanto la cima del triangolo e del rombo sta oltre l'estremo della linea,
/// in spessori. Un estremo quadrato arriva mezzo spessore oltre, e in quel
/// punto il triangolo, che si stringe di 30° per parte, è largo quanto la
/// linea solo da 0,5 + 0,5 / tan 30° ≈ 1,366: con 1,4 il canto è coperto.
const REACH = 1.4;

/// Quanto l'angolo della punta aperta sta oltre l'estremo: il suo giro tondo,
/// di mezzo spessore, copre il canto di un estremo quadrato.
const VEE_REACH = 0.5;

/// Il margine fra il contenuto e il bordo del marcatore, in spessori: SVG
/// ritaglia al riquadro, e il bordo di un contorno tondo non deve toccarlo.
const MARGIN = 0.5;

/// Un punto nel riferimento del marcatore: l'estremo della linea è l'origine,
/// la linea arriva da −x e la punta guarda a +x.
type Spot = readonly [number, number];

/// Come è fatta una punta di fine nel suo riferimento.
interface Drawn {
  /// I vertici; per un cerchio il centro, nell'origine.
  readonly points: readonly Spot[];
  readonly closed: boolean;
  /// Gli estremi del contorno se la forma è tracciata, `null` se è piena.
  readonly stroke: "round" | "butt" | null;
  /// Quanto la forma sporge dai vertici, nei due assi: metà del contorno, o
  /// il raggio del cerchio.
  readonly pad: Spot;
  /// Il raggio, se la forma è un cerchio.
  readonly radius: number | null;
}

function filled(points: readonly Spot[]): Drawn {
  return { points, closed: true, stroke: null, pad: [0, 0], radius: null };
}

function stroked(points: readonly Spot[], stroke: "round" | "butt", pad: Spot): Drawn {
  return { points, closed: false, stroke, pad, radius: null };
}

/// La punta `tip` di fine, centrata sull'estremo della linea.
function drawn(tip: Tip): Drawn {
  const head = HEAD[tip.size];
  const half = head / 2;
  switch (tip.shape) {
    case "triangle": {
      const base = REACH - head * COS30;
      return filled([[REACH, 0], [base, half], [base, -half]]);
    }
    case "vee": {
      const back = VEE_REACH - head * COS30;
      return stroked([[back, -half], [VEE_REACH, 0], [back, half]], "round", [0.5, 0.5]);
    }
    case "circle": {
      const radius = 0.4 * head;
      return { points: [[0, 0]], closed: false, stroke: null, pad: [radius, radius], radius };
    }
    case "square": {
      const side = 0.35 * head;
      return filled([[-side, -side], [side, -side], [side, side], [-side, side]]);
    }
    case "diamond": {
      const across = 0.3 * head;
      return filled([[REACH, 0], [REACH - half, across], [REACH - head, 0], [REACH - half, -across]]);
    }
    case "bar":
      return stroked([[0, -half], [0, half]], "butt", [0.5, 0]);
  }
}

/// `value` portato ai centesimi per eccesso, senza lasciare che il rumore
/// dei decimali aggiunga un centesimo.
const above = (value: number): number => Math.ceil(value * 100 - 1e-9) / 100;

/// Un'opacità come la scrive il file: al più quattro decimali.
const rounded = (value: number): number => Number(formatNumber(value, 4));

/// Il nome di una punta in `fub:marker`: forma, misura e capo.
function tipName(tip: Tip, end: TipEnd): string {
  return `${tip.shape} ${tip.size} ${end}`;
}

/// La punta e il capo che dice `fub:marker`; `null` se non è un nome della
/// raccolta.
function tipNamed(text: string): { readonly tip: Tip; readonly end: TipEnd } | null {
  const [shape, size, end, ...rest] = text.split(" ");
  const found = TIP_SHAPES.find((each) => each === shape);
  const sized = TIP_SIZES.find((each) => each === size);
  const where = TIP_ENDS.find((each) => each === end);
  if (found === undefined || sized === undefined || where === undefined || rest.length > 0) return null;
  return { tip: { shape: found, size: sized }, end: where };
}

/// Il marcatore `id` della punta `tip` al capo `end`, del colore `paint`
/// (`#rrggbb`, `none` o `url(#id) #rrggbb`) e dell'opacità `opacity`, come
/// lo scrive un `add`. L'estremo della linea sta nel punto di riferimento, e
/// la punta di inizio è il capovolto di quella di fine.
export function tipElem(id: string, tip: Tip, end: TipEnd, paint: string, opacity: number): Elem {
  const shape = drawn(tip);
  const flip = end === "end" ? 1 : -1;
  const points = shape.points.map((p): Spot => [flip * p[0], p[1]]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.min(...xs) - shape.pad[0];
  const top = Math.min(...ys) - shape.pad[1];
  // Il contenuto sta tutto nel quadrante positivo, con il suo margine.
  const dx = above(MARGIN - left);
  const dy = above(MARGIN - top);
  const width = above(Math.max(...xs) + shape.pad[0] + dx + MARGIN);
  const height = above(Math.max(...ys) + shape.pad[1] + dy + MARGIN);
  const attrs: Record<string, string> = {};
  const alpha = Number.isFinite(opacity) && opacity < 1 ? formatNumber(Math.max(0, opacity), 4) : null;
  if (shape.stroke === null) {
    attrs.fill = paint;
    if (alpha !== null) attrs["fill-opacity"] = alpha;
  } else {
    attrs.fill = "none";
    attrs.stroke = paint;
    attrs["stroke-width"] = "1";
    attrs["stroke-linecap"] = shape.stroke;
    if (shape.stroke === "round") attrs["stroke-linejoin"] = "round";
    if (alpha !== null) attrs["stroke-opacity"] = alpha;
  }
  let content: Elem;
  if (shape.radius !== null) {
    content = { tag: "circle", attrs: { cx: formatNumber(dx, 2), cy: formatNumber(dy, 2), r: formatNumber(shape.radius, 2), ...attrs } };
  } else {
    const segments: Segment[] = points.map((p, at) => ({ kind: at === 0 ? "move" : "line", to: [p[0] + dx, p[1] + dy] }));
    if (shape.closed) segments.push({ kind: "close" });
    content = { tag: "path", attrs: { d: pathData(segments), ...attrs } };
  }
  return {
    tag: "marker",
    attrs: {
      id,
      "fub:role": "shared",
      "fub:marker": tipName(tip, end),
      refX: formatNumber(dx, 2),
      refY: formatNumber(dy, 2),
      markerWidth: formatNumber(width, 2),
      markerHeight: formatNumber(height, 2),
      orient: "auto",
    },
    children: [content],
  };
}

/// Vero se `a` e `b` sono lo stesso elemento: stesso tag, stessi attributi
/// in qualunque ordine, stessi figli.
function sameElem(a: Elem, b: Elem): boolean {
  if (a.tag !== b.tag || (a.text ?? null) !== (b.text ?? null)) return false;
  const names = Object.keys(a.attrs);
  if (names.length !== Object.keys(b.attrs).length || names.some((name) => a.attrs[name] !== b.attrs[name])) return false;
  const inner = a.children ?? [];
  const other = b.children ?? [];
  return inner.length === other.length && inner.every((child, at) => sameElem(child, other[at]!));
}

/// Una punta della raccolta come un marcatore del disegno la dice.
export interface MarkerTip {
  readonly tip: Tip;
  readonly end: TipEnd;
  /// Il colore del contenuto: `#rrggbb`, `none` o `url(#id) #rrggbb`.
  readonly paint: string;
  readonly opacity: number;
}

const readTips = new WeakMap<LeafNode, { readonly raw: string; readonly tip: MarkerTip | null }>();

/// La punta della raccolta che è `node`, un marcatore del disegno; `null` se
/// non lo è. Lo è un marcatore modificabile, condiviso, il cui `fub:marker`
/// è un nome della raccolta e che è tutto ciò che FubDraw scriverebbe per
/// quel nome, col colore e l'opacità del suo contenuto: ogni altro è
/// «custom».
export function markerTip(node: LeafNode): MarkerTip | null {
  const known = readTips.get(node);
  if (known !== undefined && known.raw === node.raw) return known.tip;
  const tip = readTip(node);
  readTips.set(node, { raw: node.raw, tip });
  return tip;
}

function readTip(node: LeafNode): MarkerTip | null {
  const id = node.facts.id;
  if (id === null || node.facts.local !== "marker" || node.details?.role !== "resource" || node.details.lifecycle !== "shared") return null;
  const elem = elemOf(node);
  if (elem === null || elem.children === undefined || elem.children.length !== 1) return null;
  const named = tipNamed(elem.attrs["fub:marker"] ?? "");
  if (named === null) return null;
  // Una forma tracciata porta il colore sul contorno, una piena sul riempimento.
  const outlined = drawn(named.tip).stroke !== null;
  const content = elem.children[0]!;
  const paint = content.attrs[outlined ? "stroke" : "fill"];
  if (paint === undefined) return null;
  const alpha = content.attrs[outlined ? "stroke-opacity" : "fill-opacity"];
  const opacity = alpha === undefined ? 1 : parseOpacity(alpha);
  if (opacity === null) return null;
  return sameElem(elem, tipElem(id, named.tip, named.end, paint, opacity)) ? { tip: named.tip, end: named.end, paint, opacity } : null;
}

// ---------------------------------------------------------------------------
// Leggere.
// ---------------------------------------------------------------------------

const owns = new WeakMap<ElementPart, { readonly written: string; readonly own: ReadonlyMap<string, string> }>();

/// Gli attributi senza namespace di `node`, letti una volta finché non
/// cambiano: un'unità che un'operazione cambia è un nodo nuovo, un
/// contenitore riscrive il suo tag.
function ownOf(node: ElementPart): ReadonlyMap<string, string> {
  const known = owns.get(node);
  const written = writtenOf(node);
  if (known !== undefined && known.written === written) return known.own;
  const own = plainAttributes(node);
  owns.set(node, { written, own });
  return own;
}

/// Ciò che i figli ereditano del contorno: il colore e la sua opacità.
type Inherited = ReadonlyMap<string, string>;

const INITIAL: Inherited = new Map([
  ["stroke", "none"],
  ["stroke-opacity", "1"],
]);

const passes = new WeakMap<ElementPart, { readonly from: Inherited; readonly own: ReadonlyMap<string, string>; readonly out: Inherited }>();

/// Ciò che i figli di `node` ereditano, coi valori iniziali di SVG. Un
/// contenitore che resta lo stesso nodo si rilegge se cambia il suo tag, o se
/// il genitore gli passa altro.
function passedBy(node: ElementPart | null): Inherited {
  if (node === null) return INITIAL;
  const from = passedBy(node.parent);
  const own = ownOf(node);
  const known = passes.get(node);
  if (known !== undefined && known.from === from && known.own === own) return known.out;
  let out: Map<string, string> | null = null;
  for (const name of INITIAL.keys()) {
    const value = own.get(name);
    if (value === undefined || value === from.get(name)) continue;
    out ??= new Map(from);
    out.set(name, value);
  }
  const passed = out ?? from;
  passes.set(node, { from, own, out: passed });
  return passed;
}

/// I ruoli dove SVG disegna i marcatori.
const MARKED: ReadonlySet<Role> = new Set(["path", "line", "polyline", "polygon", "connector"]);

/// I ruoli che passano il cambio ai figli.
const CONTAINERS: ReadonlySet<Role> = new Set(["group", "link"]);

/// L'attributo del marcatore al capo `end`.
const markerName = (end: TipEnd): "marker-start" | "marker-end" => (end === "start" ? "marker-start" : "marker-end");

/// Vero se `own` ha un marcatore al capo `end`.
function marked(own: ReadonlyMap<string, string>, end: TipEnd): boolean {
  const value = own.get(markerName(end));
  return value !== undefined && reference(value) !== null;
}

/// Vero se `node` può avere le punte: una linea, una spezzata, un connettore
/// o un tracciato senza `Z`; e ogni forma su cui SVG disegna i marcatori che
/// ne ha già, perché si possano togliere. Non le frecce, i poligoni regolari
/// e le stelle, i tratti a penna, le linee a spessore variabile, i testi e le
/// parti estranee.
export function tippable(node: ElementPart): boolean {
  const role = node.details?.role;
  if (role === undefined || node.kind !== "leaf" || !MARKED.has(role)) return false;
  if (role === "line" || role === "polyline" || role === "connector") return true;
  const own = ownOf(node);
  if (role === "path" && !/[zZ]/.test(own.get("d") ?? "")) return true;
  return marked(own, "start") || marked(own, "end");
}

/// I nodi di `units`. I figli di un contenitore si elencano una volta sola:
/// mille oggetti di un livello non lo scorrono mille volte.
function nodesOf(model: DocumentModel, units: readonly Unit[]): ElementPart[] {
  const children = new Map<ElementPart, ElementPart[]>();
  return units.map((unit) => {
    let node: ElementPart = model.root;
    for (const at of unit.path) {
      let list = children.get(node);
      if (list === undefined) {
        list = elementChildren(node as ContainerNode);
        children.set(node, list);
      }
      node = list[at]!;
    }
    return node;
  });
}

/// Le parti di `nodes`, gli oggetti scelti, che possono avere le punte, in
/// ordine di documento. Una parte bloccata dentro un gruppo scelto resta
/// fuori.
function tipParts(nodes: readonly ElementPart[]): LeafNode[] {
  const out: LeafNode[] = [];
  const seen = new Set<ElementPart>();
  const visit = (node: ElementPart, chosen: boolean): void => {
    const role = node.details?.role;
    if (role === undefined || seen.has(node) || (!chosen && node.details?.locked === true)) return;
    seen.add(node);
    if (CONTAINERS.has(role)) {
      if (node.kind === "container") for (const child of elementChildren(node)) visit(child, false);
    } else if (node.kind === "leaf" && tippable(node)) {
      out.push(node);
    }
  };
  for (const node of nodes) visit(node, true);
  return out;
}

/// Vero se un contenitore bloccato, un livello, un gruppo o un collegamento,
/// contiene `node`: il motore non vi scrive.
function lockedAbove(node: ElementPart): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.details?.locked === true) return true;
  return false;
}

const gradients = new WeakMap<LeafNode, { readonly raw: string; readonly gradient: Gradient | null }>();

/// La sfumatura che è `node`, una risorsa; `null` se non è una sfumatura o
/// non si legge. Si legge una volta finché non cambia.
function gradientFor(node: LeafNode): Gradient | null {
  const known = gradients.get(node);
  if (known !== undefined && known.raw === node.raw) return known.gradient;
  const gradient = gradientOf(node);
  gradients.set(node, { raw: node.raw, gradient });
  return gradient;
}

/// Il vertice di `node` dove sta la punta del capo `end`, nelle coordinate
/// della linea: l'inizio del primo tratto, o la fine dell'ultimo, che in un
/// poligono, chiuso, torna al primo punto. `null` se non si legge.
function vertexOf(node: ElementPart, end: TipEnd, own: ReadonlyMap<string, string>): Point | null {
  switch (node.details?.role) {
    case "line": {
      const read = (name: string): number | null => {
        const value = own.get(name);
        return value === undefined ? 0 : length(value);
      };
      const x = read(end === "start" ? "x1" : "x2");
      const y = read(end === "start" ? "y1" : "y2");
      return x === null || y === null ? null : [x, y];
    }
    case "polyline":
    case "polygon": {
      const list = parsePoints(own.get("points") ?? "");
      const last = node.details?.role === "polygon" ? 0 : (list?.length ?? 0) - 1;
      const point = list === null || list.length === 0 ? undefined : list[end === "start" ? 0 : last];
      return point === undefined ? null : point;
    }
    case "path": {
      const segments = parsePath(own.get("d") ?? "");
      if (segments === null) return null;
      let first: Point | null = null;
      let start: Point | null = null;
      let current: Point | null = null;
      for (const segment of segments) {
        if (segment.kind === "close") {
          current = start;
          continue;
        }
        current = segment.to;
        if (segment.kind === "move") {
          start = segment.to;
          first ??= segment.to;
        }
      }
      return end === "start" ? first : current;
    }
    default:
      return null;
  }
}

/// Il colore e l'opacità che una punta deve avere.
export interface Wanted {
  readonly paint: string;
  readonly opacity: number;
}

/// Il nero di SVG, dove il colore non si sa calcolare.
const BLACK: Wanted = { paint: "#000000", opacity: 1 };

/// Un marcatore del disegno, e la punta della raccolta che è.
export interface Marker {
  readonly node: LeafNode;
  readonly info: MarkerTip | null;
}

/// I marcatori delle `defs` della radice, per id, nell'ordine del documento;
/// di due con lo stesso id vale il primo. Non scorre le risorse che non lo
/// sono.
function markersOf(model: DocumentModel): Map<string, Marker> {
  const out = new Map<string, Marker>();
  for (const defs of model.root.parts) {
    if (typeof defs === "string" || defs.kind !== "container" || defs.details?.role !== "defs") continue;
    for (const part of defs.parts) {
      if (typeof part === "string" || part.kind !== "leaf") continue;
      const id = part.facts.id;
      if (id === null || part.facts.local !== "marker" || part.details?.role !== "resource" || out.has(id)) continue;
      out.set(id, { node: part, info: markerTip(part) });
    }
  }
  return out;
}

/// Ciò che un capo di una parte mostra: niente, un marcatore che non è della
/// raccolta (col suo riferimento com'è scritto), o una punta della raccolta.
type EndState =
  | { readonly kind: "none" }
  | { readonly kind: "custom"; readonly value: string }
  | { readonly kind: "tip"; readonly value: string; readonly id: string; readonly info: MarkerTip };

const NO_TIP: EndState = { kind: "none" };

/// Ciò che un comando legge del disegno, una volta sola e quando serve: i
/// marcatori, e le risorse dei colori.
class Reader {
  private markerList: ReadonlyMap<string, Marker> | null = null;
  private resourceList: ReadonlyMap<string, LeafNode> | null = null;

  constructor(readonly model: DocumentModel) {}

  get markers(): ReadonlyMap<string, Marker> {
    return (this.markerList ??= markersOf(this.model));
  }

  private get resources(): ReadonlyMap<string, LeafNode> {
    return (this.resourceList ??= resourcesOf(this.model));
  }

  /// Che cosa mostra il capo `end` di una parte che ha gli attributi `own`.
  state(own: ReadonlyMap<string, string>, end: TipEnd): EndState {
    const value = own.get(markerName(end));
    const id = value === undefined ? null : reference(value);
    if (value === undefined || id === null) return NO_TIP;
    const info = this.markers.get(id)?.info ?? null;
    return info === null ? { kind: "custom", value } : { kind: "tip", value, id, info };
  }

  /// Il colore e l'opacità che la punta del capo `end` di `node` deve
  /// avere, dallo `stroke` che la linea vede; `null` se non si legge.
  wanted(node: LeafNode, end: TipEnd): Wanted | null {
    const own = ownOf(node);
    const from = passedBy(node.parent);
    const value = trim(own.get("stroke") ?? from.get("stroke")!);
    if (value === "none") return { paint: "none", opacity: 1 };
    const opacity = rounded(parseOpacity(own.get("stroke-opacity") ?? from.get("stroke-opacity")!) ?? 1);
    const color = parsePaint(value);
    if (color !== null) return { paint: paintCode(color), opacity };
    const used = paintReference(value);
    if (used === null) return null;
    const resource = this.resources.get(used.id);
    const swatch = resource?.details?.lifecycle === "swatch" ? resource.details.swatch : undefined;
    if (swatch !== undefined) return { paint: swatchPaint({ id: used.id, color: swatch.color }), opacity };
    const gradient = resource === undefined ? null : gradientFor(resource);
    if (gradient !== null) {
      const at = vertexOf(node, end, own);
      const elem = at === null ? null : elemOf(node);
      const sampled = at === null ? null : gradientPaint(gradient, at, elem === null ? null : geometryBox(elem));
      if (sampled !== null) return { paint: paintCode(sampled.color), opacity: rounded(opacity * sampled.alpha) };
    }
    const fallback = used.fallback;
    return { paint: fallback === null || fallback === "none" ? BLACK.paint : paintCode(fallback), opacity };
  }
}

// ---------------------------------------------------------------------------
// I marcatori che si aggiungono.
// ---------------------------------------------------------------------------

/// La chiave di una punta, per riconoscerne un'uguale.
const keyOf = (tip: Tip, end: TipEnd, wanted: Wanted): string => `${tipName(tip, end)}|${wanted.paint}|${wanted.opacity}`;

/// I marcatori che un comando usa: quelli del disegno che sono uguali a ciò
/// che serve, e gli altri, aggiunti una volta sola. Un comando che scrive
/// punte della raccolta in un `Plan` ne chiede l'id qui.
export class Shelf {
  private readonly known = new Map<string, string>();
  private readonly adds: Op[] = [];
  private home: Home | null = null;

  constructor(
    private readonly model: DocumentModel,
    private readonly ids: NewIds,
    markers: ReadonlyMap<string, Marker> = markersOf(model),
  ) {
    for (const [id, marker] of markers) {
      if (marker.info === null) continue;
      const key = keyOf(marker.info.tip, marker.info.end, marker.info);
      if (!this.known.has(key)) this.known.set(key, id);
    }
  }

  /// L'id del marcatore della punta `tip` al capo `end`, di colore e
  /// opacità `wanted`; se il disegno non lo ha, si aggiunge.
  idFor(tip: Tip, end: TipEnd, wanted: Wanted): string {
    const key = keyOf(tip, end, wanted);
    let id = this.known.get(key);
    if (id === undefined) {
      id = this.ids.next("resource");
      this.home ??= homeOf(this.model);
      this.adds.push({ op: "add", parent: this.home.parent, pos: { last: true }, elem: tipElem(id, tip, end, wanted.paint, wanted.opacity) });
      this.known.set(key, id);
    }
    return id;
  }

  /// Le operazioni che aggiungono i marcatori nuovi, da fare prima di chi li
  /// usa; nessuna se non ce ne sono. Con `prelude` falso senza quella che
  /// crea la `defs` del disegno, se un'altra aggiunta dello stesso passo l'ha
  /// già fatta.
  ops(prelude = true): Op[] {
    return this.adds.length === 0 ? [] : [...(prelude ? this.home!.prelude : []), ...this.adds];
  }
}

// ---------------------------------------------------------------------------
// Il pannello.
// ---------------------------------------------------------------------------

/// Ciò che le parti dicono di un capo, per `EndLook`.
function endLook(shapes: ReadonlyArray<TipShape | "none" | "custom">, sizes: readonly TipSize[]): EndLook {
  const shape = shapes.length > 0 && shapes.every((each) => each === shapes[0]) ? shapes[0]! : null;
  const size = sizes.length > 0 && sizes.every((each) => each === sizes[0]) ? sizes[0]! : null;
  return { shape, size };
}

/// Le punte di `units`, come le mostra il pannello: quante parti possono
/// averne, e per ogni capo la forma e la misura che hanno in comune. Un
/// gruppo o un collegamento contano per le parti che contengono.
export function tipsLookOf(model: DocumentModel, units: readonly Unit[]): TipsLook {
  const parts = tipParts(nodesOf(model, units));
  const reader = new Reader(model);
  const shapes: Record<TipEnd, Array<TipShape | "none" | "custom">> = { start: [], end: [] };
  const sizes: Record<TipEnd, TipSize[]> = { start: [], end: [] };
  for (const node of parts) {
    const own = ownOf(node);
    for (const end of TIP_ENDS) {
      const state = reader.state(own, end);
      if (state.kind === "tip") {
        shapes[end].push(state.info.tip.shape);
        sizes[end].push(state.info.tip.size);
      } else {
        shapes[end].push(state.kind);
      }
    }
  }
  return { count: parts.length, start: endLook(shapes.start, sizes.start), end: endLook(shapes.end, sizes.end) };
}

// ---------------------------------------------------------------------------
// Dare le punte.
// ---------------------------------------------------------------------------

/// Un cambio pronto, e quante parti cambia.
export interface Tipped extends Arranged {
  readonly changed: number;
}

/// Scrive in `attrs` il marcatore del capo `end` di una parte che ha gli
/// attributi `own`: `value`, il riferimento che deve avere, o `null` se non
/// ne deve avere. Se la parte lo mostra già, non scrive niente.
function put(attrs: Record<string, string | null>, own: ReadonlyMap<string, string>, end: TipEnd, value: string | null): void {
  const name = markerName(end);
  const now = own.get(name);
  const shown = now === undefined ? null : reference(now);
  if (value === null) {
    if (shown !== null) attrs[name] = null;
  } else if (shown === null || shown !== reference(value)) {
    attrs[name] = value;
  }
}

/// Il riferimento che il capo `to` prende da `from`, il capo opposto, quando
/// le punte si scambiano: nessuno, quello com'è se non è della raccolta, o
/// la stessa punta nel marcatore del suo nuovo capo.
function carried(from: EndState, to: TipEnd, url: (tip: Tip, end: TipEnd) => string): string | null {
  switch (from.kind) {
    case "none":
      return null;
    case "custom":
      return from.value;
    case "tip":
      return url(from.info.tip, to);
  }
}

/// Gli attributi che danno `change` a `node`, una parte; `null` se la parte
/// mostra già ciò che si chiede.
function retip(reader: Reader, shelf: Shelf, node: LeafNode, change: TipChange): Record<string, string | null> | null {
  const own = ownOf(node);
  const attrs: Record<string, string | null> = {};
  const url = (tip: Tip, end: TipEnd): string => `url(#${shelf.idFor(tip, end, reader.wanted(node, end) ?? BLACK)})`;
  if ("swap" in change) {
    const start = reader.state(own, "start");
    const end = reader.state(own, "end");
    put(attrs, own, "start", carried(end, "start", url));
    put(attrs, own, "end", carried(start, "end", url));
  } else if ("shape" in change) {
    if (change.shape === "none") {
      put(attrs, own, change.end, null);
    } else {
      // La misura di chi c'è già, se è della raccolta.
      const state = reader.state(own, change.end);
      put(attrs, own, change.end, url({ shape: change.shape, size: state.kind === "tip" ? state.info.tip.size : DEFAULT_TIP_SIZE }, change.end));
    }
  } else {
    // Cambia soltanto le punte della raccolta.
    const state = reader.state(own, change.end);
    if (state.kind !== "tip") return null;
    put(attrs, own, change.end, url({ shape: state.info.tip.shape, size: change.size }, change.end));
  }
  return Object.keys(attrs).length === 0 ? null : attrs;
}

/// Le operazioni che danno `change` alle parti di `units`, in un `batch`
/// solo: prima i marcatori che mancano, una volta sola, poi i `set` delle
/// linee. La selezione resta la stessa; una parte senza id che cambia ne
/// riceve uno.
export function tipOps(model: DocumentModel, units: readonly Unit[], change: TipChange, ids: NewIds): Tipped {
  const plan = new Plan(model, ids);
  const reader = new Reader(model);
  const shelf = new Shelf(model, ids, reader.markers);
  const sets: Op[] = [];
  const nodes = nodesOf(model, units);
  for (const node of tipParts(nodes)) {
    const attrs = retip(reader, shelf, node, change);
    if (attrs !== null) sets.push({ op: "set", id: plan.idOf(node), attrs });
  }
  plan.ops.push(...shelf.ops(), ...sets);
  const keys = sets.length === 0 ? units.map((unit) => unit.key) : units.map((unit, at) => plan.keyOf(nodes[at]!, unit.key));
  return { ...plan.finish(keys), changed: sets.length };
}

// ---------------------------------------------------------------------------
// Copiare le punte con lo stile.
// ---------------------------------------------------------------------------

/// Ciò che uno stile copiato dice di un capo: una punta della raccolta;
/// `none` se il capo non ne ha; `null` se non si copia, perché il suo
/// marcatore non è della raccolta, e chi riceve lo stile tiene il suo.
export type EndStyle = Tip | "none" | null;

/// Le punte di uno stile copiato. Sono la forma e la misura, mai l'id di un
/// marcatore: lo stile vale anche in un altro disegno, dove la punta si
/// riscrive con questo nome.
export interface TipsStyle {
  readonly start: EndStyle;
  readonly end: EndStyle;
}

/// Le punte di `node` per uno stile copiato; `null` se non può averne, come
/// un rettangolo o un testo, e chi riceve lo stile tiene le sue.
export function tipsStyleOf(model: DocumentModel, node: ElementPart): TipsStyle | null {
  if (!tippable(node)) return null;
  const reader = new Reader(model);
  const own = ownOf(node);
  const styled = (end: TipEnd): EndStyle => {
    const state = reader.state(own, end);
    if (state.kind === "custom") return null;
    return state.kind === "none" ? "none" : { shape: state.info.tip.shape, size: state.info.tip.size };
  };
  return { start: styled("start"), end: styled("end") };
}

/// Le punte che dice `node`, uno stile grafico, capo per capo: quella della
/// raccolta che nomina, `none` per un capo che dice `none`, e `null`, così
/// chi lo segue tiene la sua, per un capo che non scrive o che nomina un
/// marcatore che non è della raccolta.
export function protoTips(model: DocumentModel, node: ElementPart): TipsStyle {
  const reader = new Reader(model);
  const own = ownOf(node);
  const styled = (end: TipEnd): EndStyle => {
    const value = own.get(markerName(end));
    if (value === undefined) return null;
    const state = reader.state(own, end);
    if (state.kind === "tip") return { shape: state.info.tip.shape, size: state.info.tip.size };
    return state.kind === "none" && trim(value) === "none" ? "none" : null;
  };
  return { start: styled("start"), end: styled("end") };
}

/// Le punte che un comando dà a più parti, in un `Plan`: i marcatori giusti,
/// riusati se il disegno li ha e aggiunti una volta sola se no.
export class Tipper {
  private readonly reader: Reader;
  private readonly shelf: Shelf;

  constructor(model: DocumentModel, ids: NewIds) {
    this.reader = new Reader(model);
    this.shelf = new Shelf(model, ids, this.reader.markers);
  }

  /// Gli attributi che danno a `node` le punte di `tips`: `marker-start` e
  /// `marker-end` dei capi che lo stile dice, tolti con `none`. Il colore
  /// della punta è quello che la linea ha adesso; se lo stesso comando lo
  /// cambia, [`followTips`] lo porta in pari nello stesso passo. `null` se
  /// la parte non può averne, o se le mostra già.
  give(node: ElementPart, tips: TipsStyle): Record<string, string | null> | null {
    if (node.kind !== "leaf" || !tippable(node)) return null;
    const own = ownOf(node);
    const attrs: Record<string, string | null> = {};
    for (const end of TIP_ENDS) {
      const wanted = tips[end];
      if (wanted === null) continue;
      put(attrs, own, end, wanted === "none" ? null : `url(#${this.shelf.idFor(wanted, end, this.reader.wanted(node, end) ?? BLACK)})`);
    }
    return Object.keys(attrs).length === 0 ? null : attrs;
  }

  /// Le operazioni che aggiungono i marcatori nuovi, da fare prima di chi li
  /// usa: come [`Shelf.ops`].
  ops(prelude = true): Op[] {
    return this.shelf.ops(prelude);
  }
}

// ---------------------------------------------------------------------------
// Le punte nel contorno.
// ---------------------------------------------------------------------------

/// I tag su cui SVG disegna i marcatori.
const MARKED_TAGS: ReadonlySet<string> = new Set(["path", "line", "polyline", "polygon"]);

/// Le proprietà dei marcatori, coi vertici dove ciascuna li mette.
const MARKER_PLACES: ReadonlyArray<readonly [MarkerPlace, string]> = [["start", "marker-start"], ["mid", "marker-mid"], ["end", "marker-end"]];

/// Dove `node` ha un marcatore, della raccolta o no: all'inizio, a metà, alla
/// fine. Vuoto per una forma su cui SVG non li disegna.
export function markedPlaces(node: ElementPart): ReadonlySet<MarkerPlace> {
  const out = new Set<MarkerPlace>();
  if (node.details === null || !MARKED_TAGS.has(node.details.tag)) return out;
  const own = ownOf(node);
  for (const [place, name] of MARKER_PLACES) {
    const value = own.get(name);
    if (value !== undefined && reference(value) !== null) out.add(place);
  }
  return out;
}

const capOf = (value: string | undefined): Cap => (value === "round" || value === "square" ? value : "butt");
const joinOf = (value: string | undefined): Join => (value === "round" || value === "bevel" ? value : "miter");

/// Le aree che il contenuto di un marcatore della raccolta dipinge, nelle
/// coordinate del marcatore, una per forma: la forma com'è se si riempie, il
/// suo contorno se si traccia. `null` se un contorno non diventa un'area.
function contentAreas(children: readonly Elem[]): Segment[][] | null {
  const out: Segment[][] = [];
  for (const child of children) {
    const segments = shapeSegments(child.tag, Object.entries(child.attrs));
    if (segments.length === 0) continue;
    const { fill, stroke } = child.attrs;
    if (fill === undefined || trim(fill) !== "none") out.push([...segments]);
    if (stroke === undefined || trim(stroke) === "none") continue;
    const width = nonNegativeLength(child.attrs["stroke-width"] ?? "1") ?? 1;
    const area = strokeArea(segments, { width, cap: capOf(child.attrs["stroke-linecap"]), join: joinOf(child.attrs["stroke-linejoin"]), miterLimit: 4, dashes: [] });
    if (typeof area === "string") return null;
    if (area.length > 0) out.push(area);
  }
  return out;
}

/// Le aree che le punte di `node` coprono, nelle coordinate della forma, una
/// per punta e per forma del suo contenuto; `segments` è il tracciato di
/// `node` e `width` lo spessore del suo contorno. Ogni punta sta dove la
/// mette il disegno: sul vertice del suo capo, girata come il tracciato e
/// grande quanto lo spessore, con le regole di `scene/markers.ts`. Il
/// contenuto non si ritaglia col riquadro del marcatore, che SVG applica:
/// nessuna punta della raccolta lo supera.
///
/// Vuoto se `node` non ha punte. `null` se non si possono mettere nel
/// contorno: un marcatore che non è della raccolta a un capo, un marcatore a
/// metà (FubDraw non ne scrive), o un'area che non si calcola.
export function tipAreas(model: DocumentModel, node: ElementPart, segments: readonly Segment[], width: number): Segment[][] | null {
  const marked = markedPlaces(node);
  if (marked.size === 0) return [];
  if (marked.has("mid")) return null;
  const reader = new Reader(model);
  const own = ownOf(node);
  const out: Segment[][] = [];
  let list: readonly Vertex[] | null = null;
  for (const end of TIP_ENDS) {
    const state = reader.state(own, end);
    if (state.kind === "none") continue;
    if (state.kind === "custom") return null;
    const elem = elemOf(reader.markers.get(state.id)!.node);
    if (elem === null || elem.children === undefined) return null;
    const fit = markerFit((name) => elem.attrs[name]);
    if (fit === null) continue;
    const content = contentAreas(elem.children);
    if (content === null) return null;
    list ??= vertices(segments);
    for (const vertex of placed(list, end)) {
      const matrix = markerMatrix(fit, vertex, end, width);
      for (const area of content) out.push(mapped(area, matrix));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seguire la linea.
// ---------------------------------------------------------------------------

/// Gli elementi che portano gli id di `touched`, in un passo solo sul
/// documento: l'elemento che ha l'id, o l'unità che lo contiene.
function locate(model: DocumentModel, touched: ReadonlySet<string>): (id: string) => ElementPart | null {
  const found = new Map<string, ElementPart>();
  const visit = (node: ElementPart): void => {
    if (node.kind === "leaf") {
      for (const id of node.ids) if (touched.has(id)) found.set(id, node);
      return;
    }
    const id = node.facts.id;
    if (id !== null && touched.has(id)) found.set(id, node);
    for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") visit(part);
  };
  visit(model.root);
  return (id) => found.get(id) ?? null;
}

/// Vero se `node` è una risorsa che dà il colore a chi la usa.
function paintServer(node: LeafNode): boolean {
  const tag = node.facts.local;
  return tag === "linearGradient" || tag === "radialGradient" || tag === "pattern";
}

/// Le parti che l'operazione ha toccato e che hanno una punta della
/// raccolta: ciò che ha un id in `touched`, le parti dei contenitori toccati,
/// e se è cambiata una sfumatura o un motivo tutte quelle del disegno.
function followers(model: DocumentModel, touched: ReadonlySet<string>, markers: ReadonlyMap<string, Marker>, find: ((id: string) => ElementPart | null) | undefined): LeafNode[] {
  const out: LeafNode[] = [];
  const seen = new Set<ElementPart>();
  const take = (node: LeafNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.refs.length > 0 && node.refs.some((id) => markers.get(id)?.info != null) && tippable(node) && !lockedAbove(node)) out.push(node);
  };
  const walk = (node: ElementPart): void => {
    if (node.kind === "leaf") {
      take(node);
      return;
    }
    const role = node.details?.role;
    if (seen.has(node) || (role !== "layer" && role !== "group" && role !== "link")) return;
    seen.add(node);
    for (const part of node.parts) if (typeof part !== "string" && part.kind !== "other") walk(part);
  };
  const lookup = find ?? locate(model, touched);
  let everything = false;
  for (const id of touched) {
    const node = lookup(id);
    if (node === null) continue;
    if (node.kind === "container") walk(node);
    else if (node.details?.role !== "resource") take(node);
    else if (paintServer(node)) everything = true;
  }
  if (everything) for (const part of model.root.parts) if (typeof part !== "string" && part.kind !== "other") walk(part);
  return out;
}

/// Le operazioni che tengono le punte del colore della linea, dopo
/// un'operazione che ha toccato gli id `touched` di `model`: per ogni capo
/// con una punta della raccolta che non ha più il colore e l'opacità dello
/// `stroke` della sua linea, o che è del capo sbagliato, il marcatore giusto,
/// riusato o aggiunto una volta sola. `null` se non c'è niente da cambiare.
///
/// Guarda gli elementi toccati, i figli dei contenitori toccati, e tutte le
/// parti se è cambiata una sfumatura o un motivo; `find` dice quale elemento
/// porta un id (il motore ha un indice, `SceneEngine.holder`), e senza il
/// documento si scorre una volta. Le parti che il motore non lascia scrivere,
/// sotto un contenitore bloccato, restano come sono, e ciò che non si legge
/// si salta: non lancia.
export function followTips(model: DocumentModel, touched: ReadonlySet<string>, ids: NewIds, find?: (id: string) => ElementPart | null): Op | null {
  if (touched.size === 0) return null;
  const reader = new Reader(model);
  const markers = reader.markers;
  let library = false;
  for (const marker of markers.values()) {
    if (marker.info !== null) {
      library = true;
      break;
    }
  }
  if (!library) return null;
  const parts = followers(model, touched, markers, find);
  if (parts.length === 0) return null;
  const plan = new Plan(model, ids);
  const shelf = new Shelf(model, ids, markers);
  const sets: Op[] = [];
  for (const node of parts) {
    const own = ownOf(node);
    const attrs: Record<string, string> = {};
    for (const end of TIP_ENDS) {
      const state = reader.state(own, end);
      if (state.kind !== "tip") continue;
      const wanted = reader.wanted(node, end);
      if (wanted === null) continue;
      const info = state.info;
      if (info.end === end && info.paint === wanted.paint && info.opacity === wanted.opacity) continue;
      attrs[markerName(end)] = `url(#${shelf.idFor(info.tip, end, wanted)})`;
    }
    if (Object.keys(attrs).length > 0) sets.push({ op: "set", id: plan.idOf(node), attrs });
  }
  if (sets.length === 0) return null;
  plan.ops.push(...shelf.ops(), ...sets);
  return gesture(plan.finish([]).ops);
}
