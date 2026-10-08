// Il disegno del banco dei connettori (`connectors.mjs`): forme su una griglia
// larga, unite da connettori, come le lascia chi disegna un diagramma di
// flusso. Con `count` connettori ci sono due forme ogni tre connettori, e
// una etichetta ogni dieci: a 300 connettori, 200 forme e 30 etichette.
//
// - **Le forme** stanno una per cella, con un poco di scarto: rettangoli
//   (metà), ellissi e poligoni regolari, di tre, cinque o sei lati, girati.
//   Una su tre ha il contorno. Hanno tutte un id e un nome.
// - **I connettori** sono dritti, a gomito e curvi in parti uguali. Quasi
//   tutti hanno agganci automatici; gli altri il centro o un lato, per lo più
//   quello rivolto verso l'altra forma. Otto su dieci finiscono con una
//   punta, che ha il colore del connettore e sta fra le risorse, condivisa.
// - **I nodi.** Quattro connettori su dieci stanno su pochi nodi, forme con
//   una ventina di connettori ciascuna e vicini a loro: la prima serve a
//   provare il trascinamento di una forma con molti connettori. Gli altri
//   uniscono forme vicine nella griglia, qualcuna a due o tre celle.
// - **La geometria è quella dell'editor.** `fub:geom` e `d` li scrive il
//   calcolo dei percorsi dei connettori (`sceneRoute`) con la stima delle
//   larghezze del testo, che non dipende dai caratteri della macchina; le
//   etichette stanno dove le mette il seguito del motore. Il disegno è un
//   punto fisso di quel seguito: toccare tutte le forme non cambia niente.
//
// Il disegno è sempre lo stesso per lo stesso `count`.

import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { writeLabelPlace, type Anchor, type ConnectorKind } from "../src/editors/spatial/scene/connectors";
import { DEFS_ID } from "../src/editors/spatial/scene/ids";
import { elemToOut, NamespaceScope, writeElement, type Elem } from "../src/editors/spatial/scene/serialize";
import { FUB_NS, SVG_NS } from "../src/editors/spatial/scene/xml";
import { connectorElem, followConnectors, labelPlace, Router, sceneRoute, type EndInput } from "../src/editors/spatial/tools/connectors";
import { estimate } from "../src/editors/spatial/tools/measure";
import { textElem } from "../src/editors/spatial/tools/text";
import { tipElem } from "../src/editors/spatial/tools/tips";

/// Dove sta il disegno nel vault del banco.
export const CONNECTORS_DOC = "Connettori.svg";

/// Quanti connettori ha il disegno, da quanti a quanti: sei bastano per un
/// nodo e per ogni tipo di linea, e duemila stanno a un decimo del limite
/// degli elementi di una scena.
export const CONNECTOR_LIMITS = [6, 2_000] as const;

/// Lo spazio di una forma sulla griglia, e il margine attorno, in unità.
const CELL = [260, 190] as const;
const MARGIN = 80;
/// Di quanto una forma si scosta dal centro della sua cella, al più.
const JITTER = 16;

/// Quante forme ogni tre connettori, quante etichette ogni dieci e che
/// parte dei connettori sta sui nodi.
const SHAPES_PER_THREE = 2;
const LABEL_EVERY = 10;
const HUB_SHARE = 0.4;
/// Quante forme ogni nodo, al più, ha attorno quando sceglie i suoi
/// connettori: le più vicine.
const HUB_NEIGHBOURS = 4;
/// Quanti nodi, in forme.
const SHAPES_PER_HUB = 33;
/// Che parte dei connettori finisce con una punta.
const TIP_SHARE = 0.8;
/// Che parte dei capi ha un aggancio diverso da quello automatico.
const FIXED_ANCHOR_SHARE = 0.4;
/// Che parte delle forme ha il contorno.
const OUTLINED_SHARE = 0.35;

const FILLS = ["#fef3c7", "#e0f2fe", "#ecfccb", "#fce7f3", "#e9d8fd", "#fed7d7", "#c6f6d5", "#ffffff"];
const INKS = ["#1a202c", "#0072b2", "#d55e00"];
const WORDS = ["sì", "no", "ordine", "fattura", "consegna", "resi", "firma", "ok", "da fare", "urgente"];
const KINDS: readonly ConnectorKind[] = ["straight", "elbow", "curved"];
const SIDES: readonly Exclude<Anchor, "auto" | "center">[] = ["top", "right", "bottom", "left"];

/// Una forma del disegno.
export interface FixtureShape {
  readonly id: string;
  readonly name: string;
  readonly kind: "rect" | "ellipse" | "polygon";
  /// La geometria, nelle coordinate della forma: `x y larghezza altezza` di
  /// un rettangolo, `cx cy rx ry` di un'ellisse, `x y` dei vertici di un
  /// poligono, uno dopo l'altro.
  readonly geometry: readonly number[];
  /// Mezzo spessore del contorno; 0 per una forma senza.
  readonly reach: number;
}

/// Un connettore del disegno.
export interface FixtureConnector {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly from: { readonly id: string; readonly anchor: Anchor };
  readonly to: { readonly id: string; readonly anchor: Anchor };
  /// Vero se finisce con una punta.
  readonly tip: boolean;
  /// L'id della sua etichetta; `null` se non ne ha.
  readonly label: string | null;
}

export interface ConnectorsFixture {
  /// Il testo del file.
  readonly text: string;
  /// Le forme, nel loro ordine.
  readonly shapes: readonly FixtureShape[];
  /// I connettori, nel loro ordine.
  readonly connectors: readonly FixtureConnector[];
  /// Gli id delle forme nodo, quelle che hanno molti connettori.
  readonly hubs: readonly string[];
  /// Gli id delle etichette.
  readonly labels: readonly string[];
  /// Gli elementi del file, tutti.
  readonly elements: number;
  /// FNV-1a del testo, in esadecimale: dice quale disegno si è misurato.
  readonly digest: string;
}

/// Un generatore pseudocasuale con il suo seme (mulberry32): lo stesso seme,
/// gli stessi numeri.
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/// Un numero al centesimo, come lo scrive FubDraw.
const round = (value: number): number => Math.round(value * 100) / 100 || 0;

/// FNV-1a a 32 bit di `text`.
export function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const SCOPE = NamespaceScope.EMPTY.declare([
  [null, SVG_NS],
  ["fub", FUB_NS],
]);

/// Un elemento come lo scrive il motore, alla riga con rientro `indent`.
const written = (elem: Elem, indent: string): string => writeElement(elemToOut(elem, SCOPE), indent);

/// Il lato dell'oggetto rivolto verso `(dx, dy)`: dove va una linea che parte
/// di lì.
function facing(dx: number, dy: number): Exclude<Anchor, "auto" | "center"> {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/// Il disegno con `count` connettori, da [`CONNECTOR_LIMITS`].
export function connectorsFixture(count: number): ConnectorsFixture {
  const [least, most] = CONNECTOR_LIMITS;
  if (!Number.isInteger(count) || count < least || count > most) {
    throw new RangeError(`il disegno del banco ha da ${least} a ${most} connettori`);
  }
  const random = generator(0xc0eec7);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number): number => low + random() * (high - low);
  let serial = 0;
  const id = (prefix: string): string => `${prefix}${(++serial).toString(36).padStart(8, "0")}`;

  // Le forme, una per cella.
  const total = Math.round((count * SHAPES_PER_THREE) / 3);
  const columns = Math.ceil(Math.sqrt(total * 2));
  const rows = Math.ceil(total / columns);
  const width = round(MARGIN * 2 + columns * CELL[0]);
  const height = round(MARGIN * 2 + rows * CELL[1]);
  const centres: Array<readonly [number, number]> = [];
  const shapes: FixtureShape[] = [];
  const shapeElems: Elem[] = [];
  for (let i = 0; i < total; i++) {
    const cx = round(MARGIN + (i % columns) * CELL[0] + CELL[0] / 2 + between(-JITTER, JITTER));
    const cy = round(MARGIN + Math.floor(i / columns) * CELL[1] + CELL[1] / 2 + between(-JITTER, JITTER));
    centres.push([cx, cy]);
    const shapeId = id("o");
    const form = random();
    const attrs: Record<string, string> = { id: shapeId, "fub:name": `Forma ${i + 1}` };
    let geometry: number[];
    let kind: FixtureShape["kind"];
    let tag: string;
    if (form < 0.5) {
      const w = round(between(110, 150));
      const h = round(between(60, 90));
      geometry = [round(cx - w / 2), round(cy - h / 2), w, h];
      kind = "rect";
      tag = "rect";
      Object.assign(attrs, { x: String(geometry[0]), y: String(geometry[1]), width: String(w), height: String(h) });
      if (random() < 0.3) attrs.rx = "8";
    } else if (form < 0.8) {
      const rx = round(between(55, 75));
      const ry = round(between(32, 45));
      geometry = [cx, cy, rx, ry];
      kind = "ellipse";
      tag = "ellipse";
      Object.assign(attrs, { cx: String(cx), cy: String(cy), rx: String(rx), ry: String(ry) });
    } else {
      const sides = pick([3, 5, 6]);
      const radius = between(45, 60);
      const turn = between(0, (2 * Math.PI) / sides);
      geometry = [];
      for (let k = 0; k < sides; k++) {
        const angle = turn + (2 * Math.PI * k) / sides - Math.PI / 2;
        geometry.push(round(cx + radius * Math.cos(angle)), round(cy + radius * Math.sin(angle)));
      }
      kind = "polygon";
      tag = "polygon";
      attrs.points = Array.from({ length: sides }, (_, k) => `${geometry[2 * k]},${geometry[2 * k + 1]}`).join(" ");
    }
    attrs.fill = pick(FILLS);
    const outlined = random() < OUTLINED_SHARE;
    if (outlined) {
      attrs.stroke = INKS[0]!;
      attrs["stroke-width"] = "2";
    }
    shapes.push({ id: shapeId, name: attrs["fub:name"]!, kind, geometry, reach: outlined ? 1 : 0 });
    shapeElems.push({ tag, attrs });
  }

  // Chi è unito a chi: prima i nodi con le forme che hanno attorno, poi le
  // forme vicine nella griglia. Mai la stessa coppia due volte.
  const pairs: Array<readonly [number, number]> = [];
  const seen = new Set<string>();
  const join = (a: number, b: number): boolean => {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (a === b || seen.has(key)) return false;
    seen.add(key);
    pairs.push([a, b]);
    return true;
  };
  const hubCount = Math.max(1, Math.round(total / SHAPES_PER_HUB));
  const hubRows = Math.ceil(hubCount / 3);
  const hubs: number[] = [];
  for (let k = 0; k < hubCount; k++) {
    const column = Math.min(columns - 1, Math.floor((columns * (1 + 2 * (k % 3))) / 6));
    const row = Math.min(rows - 1, Math.floor((rows * (1 + 2 * Math.floor(k / 3))) / (2 * hubRows)));
    let at = row * columns + column;
    while (at >= total || hubs.includes(at)) at = (at + 1) % total;
    hubs.push(at);
  }
  const degree = Math.max(1, Math.floor((count * HUB_SHARE) / hubCount));
  for (const hub of hubs) {
    const [hx, hy] = centres[hub]!;
    const near = centres
      .map((centre, at) => ({ at, apart: Math.hypot(centre[0] - hx, centre[1] - hy) }))
      .filter((each) => each.at !== hub)
      .sort((a, b) => a.apart - b.apart || a.at - b.at)
      .slice(0, degree * HUB_NEIGHBOURS)
      .map((each) => each.at);
    let made = 0;
    while (made < degree && pairs.length < count && near.length > 0) {
      const [other] = near.splice(Math.floor(random() * near.length), 1);
      const hubFirst = random() < 0.5;
      if (join(hubFirst ? hub : other!, hubFirst ? other! : hub)) made++;
    }
  }
  const OFFSETS = [[1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [0, 2], [2, 1], [1, 2], [3, 0], [-2, 1]] as const;
  for (let attempt = 0; pairs.length < count; attempt++) {
    if (attempt > 200 * count) throw new RangeError(`le forme del disegno non bastano a ${count} connettori`);
    const a = Math.floor(random() * total);
    const [dc, dr] = pick(OFFSETS);
    const column = (a % columns) + dc;
    const row = Math.floor(a / columns) + dr;
    if (column < 0 || column >= columns || row < 0) continue;
    const b = row * columns + column;
    if (b >= total) continue;
    if (random() < 0.5) join(a, b);
    else join(b, a);
  }

  // I percorsi, calcolati su un motore che ha le forme: sono quelli che
  // scriverebbe l'editor.
  const layerId = id("l");
  const lines: Elem[] = [];
  const connectors: FixtureConnector[] = [];
  const markers = INKS.map((ink) => ({ ink, id: id("r"), elem: null as Elem | null }));
  const probe = SceneEngine.open([
    `<svg xmlns="${SVG_NS}" xmlns:fub="${FUB_NS}" fub:version="1" viewBox="0 0 ${width} ${height}">`,
    `<g id="${layerId}" fub:layer="Livello 1">${shapeElems.map((elem) => written(elem, "")).join("")}</g>`,
    "</svg>",
  ].join(""));
  const router = new Router(estimate);
  const node = (at: number) => probe.holder(shapes[at]!.id)!;
  const labelled: string[] = [];
  const labels: Elem[] = [];
  pairs.forEach(([a, b], index) => {
    const kind = KINDS[Math.floor(random() * 3)]!;
    const [ax, ay] = centres[a]!;
    const [bx, by] = centres[b]!;
    const anchorFor = (towards: readonly [number, number], from: readonly [number, number]): Anchor => {
      if (random() >= FIXED_ANCHOR_SHARE) return "auto";
      if (random() < 0.15) return "center";
      return random() < 0.7 ? facing(towards[0] - from[0], towards[1] - from[1]) : pick(SIDES);
    };
    const from: { id: string; anchor: Anchor } = { id: shapes[a]!.id, anchor: anchorFor([bx, by], [ax, ay]) };
    const to: { id: string; anchor: Anchor } = { id: shapes[b]!.id, anchor: anchorFor([ax, ay], [bx, by]) };
    const ends: [EndInput, EndInput] = [{ node: node(a), anchor: from.anchor }, { node: node(b), anchor: to.anchor }];
    const path = sceneRoute(kind, ends[0], ends[1], estimate, router);
    const ink = markers[index % markers.length]!;
    const tip = random() < TIP_SHARE;
    const lineId = id("o");
    const line = connectorElem(lineId, kind, path, from, to, { paint: ink.ink, width: 2, tip: ink.id });
    if (tip) ink.elem ??= tipElem(ink.id, { shape: "triangle", size: "medium" }, "end", ink.ink, 1);
    lines.push(tip ? line : { ...line, attrs: Object.fromEntries(Object.entries(line.attrs).filter(([name]) => name !== "marker-end")) });
    let label: string | null = null;
    if (index % LABEL_EVERY === LABEL_EVERY / 2 - 1) {
      label = id("o");
      const place = { ...labelPlace(lineId), t: pick([0.3, 0.5, 0.7]), offset: pick([4, -4, 6]) };
      const elem = textElem(label, [0, 0], [WORDS[labelled.length % WORDS.length]!], { color: INKS[0]!, size: 16 });
      labels.push({ ...elem, attrs: { ...elem.attrs, "text-anchor": "middle", "fub:along": writeLabelPlace(place) } });
      labelled.push(lineId);
    }
    connectors.push({ id: lineId, kind, from, to, tip, label });
  });

  const defs: Elem = { tag: "defs", attrs: { id: DEFS_ID }, children: markers.flatMap((each) => (each.elem === null ? [] : [each.elem])) };
  const out = [
    `<svg xmlns="${SVG_NS}" xmlns:fub="${FUB_NS}" fub:version="1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    "  <title>Connettori del banco</title>",
    `  ${written(defs, "  ")}`,
    `  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `  <g id="${layerId}" fub:layer="Livello 1">`,
    ...[...shapeElems, ...lines, ...labels].map((elem) => `    ${written(elem, "    ")}`),
    "  </g>",
    "</svg>",
    "",
  ];
  const full = out.join("\n");

  // Le etichette vanno dove le mette il seguito del motore: si chiede ai
  // connettori che le hanno.
  const engine = SceneEngine.open(full);
  const op = followConnectors(engine.model!, new Set(labelled), (each) => engine.holder(each), estimate);
  if (op !== null) {
    const outcome = engine.apply(op);
    if (outcome.outcome !== "applied") throw new Error(`il banco non riesce a mettere le etichette: ${outcome.detail}`);
  }
  const text = engine.text;
  const elements = (text.match(/<[a-zA-Z]/g) ?? []).length;
  return {
    text,
    shapes,
    connectors,
    hubs: hubs.map((at) => shapes[at]!.id),
    labels: labels.map((elem) => elem.attrs.id!),
    elements,
    digest: fnv(text),
  };
}
