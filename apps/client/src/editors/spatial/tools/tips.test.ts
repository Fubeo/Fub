// Le punte delle linee: il marcatore che le disegna, coperto contro ogni
// estremo che una linea può avere; chi può averle e ciò che ne dice il
// pannello; le operazioni che le danno, le cambiano e le tolgono; quelle che
// le tengono del colore della linea, dentro lo stesso passo; e il tempo di
// mille linee. Ogni operazione si applica al motore, e un annulla riporta il
// testo al byte.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import type { LeafNode } from "../scene/model";
import type { AddOp, Op, SetOp } from "../scene/ops";
import { elemToOut, NamespaceScope, writeElement, type Elem } from "../scene/serialize";
import { doc, Mulberry32 } from "../scene/test-support";
import { FUB_NS, SVG_NS, XLINK_NS } from "../scene/xml";
import { elemOf, plainAttributes } from "./arrange";
import { gesture, NewIds } from "./edit";
import { arrowPath } from "./shapes";
import { recolorSwatchOps, removeSwatchOps } from "./swatches";
import { LAYER, open, type Opened } from "./test-support";
import {
  DEFAULT_TIP_SIZE,
  TIP_ENDS,
  TIP_SHAPES,
  TIP_SIZES,
  followTips,
  markerTip,
  tipElem,
  tipOps,
  tippable,
  tipsLookOf,
  type MarkerTip,
  type Tip,
  type TipChange,
  type TipEnd,
  type TipShape,
  type TipSize,
  type Tipped,
} from "./tips";

/// Lo scope di un documento FubDraw: SVG predefinito, `fub` e `xlink`.
const FUBDRAW = NamespaceScope.EMPTY.declare([
  [null, SVG_NS],
  ["fub", FUB_NS],
  ["xlink", XLINK_NS],
]);

/// Un elemento come lo scrive il motore, sulla sua riga e con i figli sotto.
const written = (elem: Elem): string => writeElement(elemToOut(elem, FUBDRAW), "");

/// Lo stesso su una riga sola, per confrontarlo a occhio.
const oneLine = (elem: Elem): string => written(elem).replace(/\n\s*/g, "");

/// Un elemento che un test ritocca.
interface Edit {
  tag: string;
  attrs: Record<string, string>;
  children?: Edit[];
}

const RED = "#d55e00";
const BLUE = "#0072b2";
const PINK = "#cc79a7";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const tip = (shape: TipShape, size: TipSize = "medium"): Tip => ({ shape, size });

/// Un marcatore della raccolta, scritto come lo scrive FubDraw.
const MARKER = (id: string, shape: TipShape, size: TipSize, end: TipEnd, paint = RED, opacity = 1): string => written(tipElem(id, tip(shape, size), end, paint, opacity));

/// Un marcatore che non è della raccolta.
const CUSTOM = (id: string): string =>
  `<marker id="${id}" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><circle cx="2" cy="2" r="2" fill="#000000"/></marker>`;

const DEFS = (...inner: string[]): string => `<defs id="fub-defs">${inner.join("")}</defs>`;
const SWATCH = (id: string, color: string): string =>
  `<linearGradient id="${id}" fub:role="swatch" fub:name="Campione" gradientUnits="userSpaceOnUse"><stop stop-color="${color}"/></linearGradient>`;
const RAMP = (id: string, x2 = 100): string =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient>`;

/// Gli attributi di una linea che mostra i marcatori `start` e `end`.
const ENDS = (start: string | null, end: string | null): string => `${start === null ? "" : ` marker-start="url(#${start})"`}${end === null ? "" : ` marker-end="url(#${end})"`}`;

const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

/// Una linea orizzontale con il contorno `RED` di spessore 2, salvo `extra`.
const LINE = (id: string, extra = ` stroke="${RED}" stroke-width="2"`, y = 10): string => `<line id="${id}" x1="0" y1="${y}" x2="50" y2="${y}"${extra}/>`;

/// Le operazioni di `ops`, anche dentro i `batch`, in ordine.
function flat(ops: Op | readonly Op[]): Op[] {
  const list = Array.isArray(ops) ? (ops as readonly Op[]) : [ops as Op];
  return list.flatMap((op) => (op.op === "batch" ? flat(op.ops) : [op]));
}

const adds = (ops: Op | readonly Op[]): AddOp[] => flat(ops).filter((op): op is AddOp => op.op === "add" && "elem" in op);
const sets = (ops: Op | readonly Op[]): SetOp[] => flat(ops).filter((op): op is SetOp => op.op === "set");

/// Le punte di `units` come le legge il pannello.
const looks = (opened: Opened, units = opened.reindex().units): ReturnType<typeof tipsLookOf> => tipsLookOf(opened.engine.model!, units);

/// Le scelte su tutti gli oggetti del disegno, o su `units`.
function tipped(opened: Opened, change: TipChange, units = opened.reindex().units): Tipped {
  return tipOps(opened.engine.model!, units, change, ids(opened));
}

/// Applica `ops` in un passo, verifica che un annulla torni al byte e che
/// rifare torni al dopo, e lascia il motore al dopo.
function applied(opened: Opened, ops: readonly Op[]): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  const back = opened.engine.undo(outcome.undo);
  if (back.outcome !== "applied") throw new Error(`annulla rifiutato: ${back.detail}`);
  expect(opened.engine.text).toBe(before);
  const again = opened.engine.undo(back.undo);
  if (again.outcome !== "applied") throw new Error(`rifai rifiutato: ${again.detail}`);
  expect(opened.engine.text).toBe(after);
  expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  return after;
}

/// Le punte di `change` applicate a tutto il disegno.
function given(opened: Opened, change: TipChange, units = opened.reindex().units): Tipped {
  const made = tipped(opened, change, units);
  applied(opened, made.ops);
  return made;
}

/// Il motore di `source` con le punte che seguono la linea.
function followed(source: string, index = false): Opened {
  const opened = open(source);
  opened.engine.follow = (model, touched) => followTips(model, touched, ids(opened), index ? (id) => opened.engine.holder(id) : undefined);
  return opened;
}

/// Applica `op` al motore, con ciò che lo segue; verifica un solo annulla e
/// un solo rifai, e torna l'operazione com'è stata applicata.
function step(opened: Opened, op: Op): Op {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(op);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  const back = opened.engine.undo(outcome.undo);
  if (back.outcome !== "applied") throw new Error(`annulla rifiutato: ${back.detail}`);
  expect(opened.engine.text).toBe(before);
  const again = opened.engine.undo(back.undo);
  if (again.outcome !== "applied") throw new Error(`rifai rifiutato: ${again.detail}`);
  expect(opened.engine.text).toBe(after);
  expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  return outcome.forward;
}

const leaf = (opened: Opened, id: string): LeafNode => {
  const node = opened.engine.holder(id);
  if (node === null || node.kind !== "leaf") throw new Error(`nessuna foglia ${id}`);
  return node;
};

/// L'id del marcatore che il capo `end` di `line` nomina; `null` se non ne ha.
function usedBy(opened: Opened, line: string, end: TipEnd): string | null {
  const value = elemOf(opened.engine.holder(line)!)!.attrs[`marker-${end}`];
  return value === undefined ? null : (/^url\(#([^)]+)\)$/.exec(value)?.[1] ?? null);
}

/// La punta che il capo `end` di `line` mostra, se è della raccolta.
function shown(opened: Opened, line: string, end: TipEnd): (MarkerTip & { readonly id: string }) | null {
  const id = usedBy(opened, line, end);
  if (id === null) return null;
  const read = markerTip(leaf(opened, id));
  return read === null ? null : { ...read, id };
}

/// I marcatori che il disegno ha adesso.
const markersIn = (opened: Opened): string[] => [...opened.engine.text.matchAll(/<marker id="([^"]+)"/g)].map((match) => match[1]!);

/// Tutti gli id del testo di `opened`.
const everyId = (opened: Opened): Set<string> => new Set([...opened.engine.text.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!));

/// Verifica che una nuova richiesta di seguito non abbia più niente da fare.
function settled(opened: Opened, find = true): void {
  const again = followTips(opened.engine.model!, everyId(opened), ids(opened), find ? (id) => opened.engine.holder(id) : undefined);
  expect(again).toBeNull();
}

// ---------------------------------------------------------------------------
// Il disegno di una punta, misurato.
// ---------------------------------------------------------------------------

type Spot = readonly [number, number];

/// Come è disegnata una punta, letta dal marcatore.
interface Drawing {
  readonly kind: "fill" | "round" | "butt" | "circle";
  /// I vertici, nelle coordinate del marcatore.
  readonly points: readonly Spot[];
  readonly radius: number;
  /// Il punto di riferimento: dove sta l'estremo della linea.
  readonly ref: Spot;
  readonly width: number;
  readonly height: number;
}

function drawingOf(marker: Elem): Drawing {
  const ref: Spot = [Number(marker.attrs.refX), Number(marker.attrs.refY)];
  const base = { ref, width: Number(marker.attrs.markerWidth), height: Number(marker.attrs.markerHeight) };
  const content = marker.children![0]!;
  if (content.tag === "circle") {
    return { ...base, kind: "circle", points: [[Number(content.attrs.cx), Number(content.attrs.cy)]], radius: Number(content.attrs.r) };
  }
  const points: Spot[] = [];
  for (const segment of parsePath(content.attrs.d!)!) if (segment.kind !== "close") points.push([segment.to[0], segment.to[1]]);
  const kind = content.attrs.fill !== "none" ? "fill" : content.attrs["stroke-linecap"] === "round" ? "round" : "butt";
  return { ...base, kind, points, radius: 0 };
}

/// I vertici di `drawing` nel riferimento della linea: l'estremo è l'origine.
const localPoints = (drawing: Drawing): Spot[] => drawing.points.map((p) => [p[0] - drawing.ref[0], p[1] - drawing.ref[1]]);

/// Quanto la forma sporge dai vertici, nei due assi.
function padOf(drawing: Drawing): Spot {
  switch (drawing.kind) {
    case "circle":
      return [drawing.radius, drawing.radius];
    case "round":
      return [0.5, 0.5];
    case "butt":
      return [0.5, 0];
    case "fill":
      return [0, 0];
  }
}

const EPS = 1e-6;

function distanceToSegment(p: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insidePolygon(points: readonly Spot[], p: Spot): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/// Vero se il disegno, in coordinate della linea, ricopre il punto `p`.
function covers(drawing: Drawing, points: readonly Spot[], p: Spot): boolean {
  switch (drawing.kind) {
    case "circle":
      return Math.hypot(p[0] - points[0]![0], p[1] - points[0]![1]) <= drawing.radius + EPS;
    case "fill":
      return insidePolygon(points, p) || points.some((a, i) => distanceToSegment(p, a, points[(i + 1) % points.length]!) <= EPS);
    case "round":
      return points.slice(1).some((b, i) => distanceToSegment(p, points[i]!, b) <= 0.5 + EPS);
    case "butt": {
      // Un tratto solo con gli estremi netti: un rettangolo largo uno spessore.
      const a = points[0]!;
      const b = points[1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length;
      const across = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length;
      return along >= -EPS && along <= length + EPS && across <= 0.5 + EPS;
    }
  }
}

type Cap = "butt" | "round" | "square";

/// I punti dell'estremo di una linea di spessore 1 che finisce nell'origine,
/// con l'estremo `cap`, sul capo `end`: la linea arriva da −x per un capo di
/// fine e da +x per uno d'inizio, e l'estremo sporge oltre l'origine.
function capRegion(cap: Cap, end: TipEnd): Spot[] {
  const toward = end === "end" ? 1 : -1;
  const out: Spot[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const y = -0.5 + i / steps;
    if (cap === "butt") out.push([0, y]);
    for (let j = 1; j <= steps; j++) {
      const x = (0.5 * j) / steps;
      if (cap === "square") out.push([toward * x, y]);
      else if (cap === "round" && Math.hypot(x, y) <= 0.5) out.push([toward * x, y]);
    }
  }
  return out;
}

describe("la punta come è scritta", () => {
  it("è un marcatore condiviso: l'estremo della linea è il suo punto di riferimento, e il margine è di mezzo spessore", () => {
    expect(oneLine(tipElem("r1", tip("triangle"), "end", RED, 1))).toBe(
      '<marker id="r1" fub:role="shared" fub:marker="triangle medium end" refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto">' +
        `<path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="${RED}"/></marker>`,
    );
    expect(oneLine(tipElem("r2", tip("vee"), "end", RED, 1))).toBe(
      '<marker id="r2" fub:role="shared" fub:marker="vee medium end" refX="4.84" refY="3.5" markerWidth="6.34" markerHeight="7" orient="auto">' +
        `<path d="M1.01 1 L5.34 3.5 L1.01 6" fill="none" stroke="${RED}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    );
    expect(oneLine(tipElem("r3", tip("circle", "large"), "end", RED, 1))).toBe(
      '<marker id="r3" fub:role="shared" fub:marker="circle large end" refX="3.3" refY="3.3" markerWidth="6.6" markerHeight="6.6" orient="auto">' +
        `<circle cx="3.3" cy="3.3" r="2.8" fill="${RED}"/></marker>`,
    );
  });

  it("la punta d'inizio è il capovolto di quella di fine, perché SVG 1.1 non rovescia la punta", () => {
    expect(oneLine(tipElem("r1", tip("triangle", "small"), "start", RED, 1))).toBe(
      '<marker id="r1" fub:role="shared" fub:marker="triangle small start" refX="1.9" refY="2.25" markerWidth="4.04" markerHeight="4.5" orient="auto">' +
        `<path d="M0.5 2.25 L3.53 4 L3.53 0.5 Z" fill="${RED}"/></marker>`,
    );
    expect(oneLine(tipElem("r4", tip("vee", "small"), "start", RED, 1))).toBe(
      '<marker id="r4" fub:role="shared" fub:marker="vee small start" refX="1.5" refY="2.75" markerWidth="5.04" markerHeight="5.5" orient="auto">' +
        `<path d="M4.03 1 L1 2.75 L4.03 4.5" fill="none" stroke="${RED}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    );
    expect(oneLine(tipElem("r2", tip("bar", "small"), "start", RED, 1))).toBe(
      '<marker id="r2" fub:role="shared" fub:marker="bar small start" refX="1" refY="2.25" markerWidth="2" markerHeight="4.5" orient="auto">' +
        `<path d="M1 0.5 L1 4" fill="none" stroke="${RED}" stroke-width="1" stroke-linecap="butt"/></marker>`,
    );
    const gaps: string[] = [];
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        const last = drawingOf(tipElem("a", tip(shape, size), "end", RED, 1));
        const first = drawingOf(tipElem("b", tip(shape, size), "start", RED, 1));
        const mine = localPoints(last);
        const flipped = localPoints(first);
        const same = first.kind === last.kind && first.radius === last.radius && mine.length === flipped.length;
        if (!same || mine.some((p, i) => Math.abs(p[0] + flipped[i]![0]) > 0.0101 || Math.abs(p[1] - flipped[i]![1]) > 0.0101)) gaps.push(`${shape} ${size}`);
        // Il riquadro è lo stesso, a meno dell'arrotondamento ai centesimi.
        if (Math.abs(first.width - last.width) > 0.0101 || Math.abs(first.height - last.height) > 0.0101) gaps.push(`${shape} ${size} riquadro`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("ha un solo elemento di forma: un path, o un circle per il cerchio", () => {
    for (const shape of TIP_SHAPES) {
      for (const end of TIP_ENDS) {
        const marker = tipElem("a", tip(shape), end, RED, 1);
        expect(marker.tag).toBe("marker");
        expect(marker.children).toHaveLength(1);
        expect(marker.children![0]!.tag).toBe(shape === "circle" ? "circle" : "path");
        expect(marker.attrs).toMatchObject({ "fub:role": "shared", "fub:marker": `${shape} medium ${end}`, orient: "auto" });
        // La misura è in spessori, il default di SVG: niente `markerUnits` né `viewBox`.
        expect(Object.keys(marker.attrs).sort()).toEqual(["fub:marker", "fub:role", "id", "markerHeight", "markerWidth", "orient", "refX", "refY"]);
      }
    }
  });

  it("la testa è larga 3,5, 5 o 7 spessori, e ogni forma sta in proporzione", () => {
    const head = { small: 3.5, medium: 5, large: 7 };
    // La metà della larghezza della forma, in teste.
    const across: Record<TipShape, number> = { triangle: 0.5, vee: 0.5, circle: 0.4, square: 0.35, diamond: 0.3, bar: 0.5 };
    const wrong: string[] = [];
    for (const shape of TIP_SHAPES) {
      let before = 0;
      for (const size of TIP_SIZES) {
        const drawing = drawingOf(tipElem("a", tip(shape, size), "end", RED, 1));
        const half = Math.max(...localPoints(drawing).map((p) => Math.abs(p[1]))) + (drawing.kind === "circle" ? drawing.radius : 0);
        // I vertici sono scritti al centesimo.
        if (Math.abs(half - across[shape] * head[size]) > 0.0101) wrong.push(`${shape} ${size}: ${half}`);
        // Una misura più grande ha un riquadro più grande.
        if (drawing.width * drawing.height <= before) wrong.push(`${shape} ${size}: riquadro`);
        before = drawing.width * drawing.height;
      }
    }
    expect(wrong).toEqual([]);
  });

  it("il contenuto sta dentro il riquadro, con almeno un quarto di spessore di margine e non molto di più", () => {
    const wrong: string[] = [];
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        for (const end of TIP_ENDS) {
          const drawing = drawingOf(tipElem("a", tip(shape, size), end, RED, 1));
          const [padX, padY] = padOf(drawing);
          const xs = drawing.points.map((p) => p[0]);
          const ys = drawing.points.map((p) => p[1]);
          const margins = [Math.min(...xs) - padX, Math.min(...ys) - padY, drawing.width - Math.max(...xs) - padX, drawing.height - Math.max(...ys) - padY];
          if (margins.some((margin) => margin < 0.25 || margin > 0.55)) wrong.push(`${shape} ${size} ${end}: ${margins.map((m) => m.toFixed(3)).join(" ")}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("riferimento e riquadro sono multipli di un centesimo, perché l'estremo resti sul riferimento", () => {
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        for (const end of TIP_ENDS) {
          const marker = tipElem("a", tip(shape, size), end, RED, 1);
          for (const name of ["refX", "refY", "markerWidth", "markerHeight"]) expect(marker.attrs[name]).toMatch(/^\d+(\.\d{1,2})?$/);
        }
      }
    }
  });

  it("porta l'opacità sul riempimento di una forma piena e sul contorno di una tracciata, solo se minore di uno", () => {
    const content = (shape: TipShape, opacity: number): Record<string, string> => tipElem("a", tip(shape), "end", RED, opacity).children![0]!.attrs;
    expect(content("triangle", 1)).not.toHaveProperty("fill-opacity");
    expect(content("triangle", 0.5)).toMatchObject({ fill: RED, "fill-opacity": "0.5" });
    expect(content("circle", 0.3333)).toMatchObject({ "fill-opacity": "0.3333" });
    expect(content("vee", 1)).not.toHaveProperty("stroke-opacity");
    expect(content("vee", 0.25)).toMatchObject({ fill: "none", stroke: RED, "stroke-opacity": "0.25" });
    expect(content("bar", 0.5)).toMatchObject({ "stroke-opacity": "0.5" });
    expect(content("bar", 0.5)).not.toHaveProperty("fill-opacity");
    // Un valore che non è un'opacità non si scrive.
    expect(content("square", Number.NaN)).not.toHaveProperty("fill-opacity");
    expect(content("square", 7)).not.toHaveProperty("fill-opacity");
    expect(content("square", -1)).toMatchObject({ "fill-opacity": "0" });
  });

  it("scrive il colore dove la forma lo porta: riempimento per le piene, contorno per la punta aperta e la barra", () => {
    expect(tipElem("a", tip("diamond"), "end", BLUE, 1).children![0]!.attrs).toMatchObject({ fill: BLUE });
    expect(tipElem("a", tip("vee"), "end", BLUE, 1).children![0]!.attrs).toMatchObject({ fill: "none", stroke: BLUE });
    expect(tipElem("a", tip("bar"), "end", "none", 1).children![0]!.attrs).toMatchObject({ fill: "none", stroke: "none" });
    expect(tipElem("a", tip("square"), "end", "url(#rs) #0072b2", 1).children![0]!.attrs).toMatchObject({ fill: "url(#rs) #0072b2" });
  });
});

describe("la punta copre il capo della linea", () => {
  it("il controllo si accorge di una punta troppo corta", () => {
    const short: Drawing = { kind: "fill", points: [[0, 0], [-4, 2], [-4, -2]], radius: 0, ref: [0, 0], width: 0, height: 0 };
    expect(covers(short, short.points, [0.5, 0.5])).toBe(false);
    expect(covers(short, short.points, [-1, 0.5])).toBe(true);
    // Con la cima sull'estremo restano scoperti i canti di ogni estremo.
    for (const cap of ["butt", "round", "square"] as const) expect(capRegion(cap, "end").some((p) => !covers(short, short.points, p))).toBe(true);
    // E l'estremo d'inizio sta dall'altra parte.
    expect(capRegion("round", "start").every((p) => p[0] <= 0)).toBe(true);
    expect(capRegion("round", "end").every((p) => p[0] >= 0)).toBe(true);
    expect(capRegion("round", "end").length).toBeGreaterThan(100);
  });

  it.each([...TIP_SHAPES])("%s, di ogni misura e su ogni capo, copre l'estremo quadrato, tondo e netto", (shape) => {
    const gaps: string[] = [];
    for (const size of TIP_SIZES) {
      for (const end of TIP_ENDS) {
        const drawing = drawingOf(tipElem("a", tip(shape, size), end, RED, 1));
        const points = localPoints(drawing);
        for (const cap of ["butt", "round", "square"] as const) {
          const bare = capRegion(cap, end).filter((p) => !covers(drawing, points, p));
          if (bare.length > 0) gaps.push(`${shape} ${size} ${end} ${cap}: ${bare.length} punti scoperti, il primo ${bare[0]!.join(",")}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("la punta guarda oltre l'estremo: la cima sta davanti all'origine", () => {
    for (const shape of ["triangle", "diamond", "vee"] as const) {
      const end = localPoints(drawingOf(tipElem("a", tip(shape), "end", RED, 1)));
      const start = localPoints(drawingOf(tipElem("a", tip(shape), "start", RED, 1)));
      expect(Math.max(...end.map((p) => p[0]))).toBeGreaterThan(0.45);
      expect(Math.min(...start.map((p) => p[0]))).toBeLessThan(-0.45);
    }
  });
});

describe("riconoscere una punta della raccolta", () => {
  /// Un documento con i marcatori `markers`, e quello di id `m0` letto.
  function read(...markers: string[]): MarkerTip | null {
    const opened = open(doc(DEFS(...markers) + LAYER + LINE("oa") + "</g>"));
    return markerTip(leaf(opened, "m0"));
  }

  const base = (): Edit => structuredClone(tipElem("m0", tip("triangle", "large"), "end", RED, 1)) as Edit;

  it("ogni forma, misura e capo, col colore e l'opacità del suo contenuto, torna com'è stata scritta", () => {
    const paints = [RED, "none", "url(#rs) #0072b2"];
    const opacities = [1, 0.5, 0.3333];
    const all: Array<{ readonly id: string; readonly tip: Tip; readonly end: TipEnd; readonly paint: string; readonly opacity: number }> = [];
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        for (const end of TIP_ENDS) {
          for (const paint of paints) for (const opacity of opacities) all.push({ id: `m${all.length}`, tip: tip(shape, size), end, paint, opacity });
        }
      }
    }
    const opened = open(doc(DEFS(SWATCH("rs", BLUE), ...all.map((each) => written(tipElem(each.id, each.tip, each.end, each.paint, each.opacity)))) + LAYER + LINE("oa") + "</g>"));
    expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
    const wrong = all.filter((each) => {
      const read = markerTip(leaf(opened, each.id));
      return read === null || read.tip.shape !== each.tip.shape || read.tip.size !== each.tip.size || read.end !== each.end || read.paint !== each.paint || read.opacity !== each.opacity;
    });
    expect(wrong).toEqual([]);
    expect(all).toHaveLength(6 * 3 * 2 * 3 * 3);
  });

  it("si riconosce in qualunque ordine siano scritti gli attributi", () => {
    const markup = written(base());
    // Gli attributi di ogni tag, dall'ultimo al primo.
    const reversed = markup.replace(/<(\w+)((?: [\w:-]+="[^"]*")+)( ?\/?)>/g, (_, tag: string, attrs: string, close: string) => `<${tag}${(attrs.match(/ [\w:-]+="[^"]*"/g) ?? []).reverse().join("")}${close}>`);
    expect(reversed).not.toBe(markup);
    expect(reversed).toContain('orient="auto" markerHeight=');
    expect(read(reversed)).toMatchObject({ tip: tip("triangle", "large"), end: "end", paint: RED, opacity: 1 });
  });

  it("ogni altro marcatore è custom, anche se ne ha il nome", () => {
    const variants: Array<[string, (marker: Edit) => void]> = [
      ["un attributo in più", (marker) => (marker.attrs.markerUnits = "userSpaceOnUse")],
      ["un riquadro diverso", (marker) => (marker.attrs.markerWidth = "9")],
      ["un riferimento diverso", (marker) => (marker.attrs.refX = "1")],
      ["un orientamento diverso", (marker) => (marker.attrs.orient = "0")],
      ["la forma ritoccata", (marker) => (marker.children![0]!.attrs.d = "M0 0 L1 1 Z")],
      ["un attributo in più nel contenuto", (marker) => (marker.children![0]!.attrs["stroke-width"] = "2")],
      ["due forme", (marker) => marker.children!.push(structuredClone(marker.children![0]!))],
      ["nessuna forma", (marker) => (marker.children = [])],
      ["un nome che non è della raccolta", (marker) => (marker.attrs["fub:marker"] = "blob large end")],
      ["un nome senza il capo", (marker) => (marker.attrs["fub:marker"] = "triangle large")],
      ["un nome con altro in coda", (marker) => (marker.attrs["fub:marker"] = "triangle large end now")],
      ["un nome con spazi doppi", (marker) => (marker.attrs["fub:marker"] = "triangle  large end")],
      ["un nome vuoto", (marker) => (marker.attrs["fub:marker"] = "")],
      ["una misura che non c'è", (marker) => (marker.attrs["fub:marker"] = "triangle huge end")],
      ["un nome di un'altra forma", (marker) => (marker.attrs["fub:marker"] = "vee large end")],
      ["un nome di un'altra misura", (marker) => (marker.attrs["fub:marker"] = "triangle small end")],
      ["un nome dell'altro capo", (marker) => (marker.attrs["fub:marker"] = "triangle large start")],
      ["senza il ruolo di risorsa condivisa", (marker) => delete marker.attrs["fub:role"]],
      ["senza il colore", (marker) => delete marker.children![0]!.attrs.fill],
      ["un'opacità che non si legge", (marker) => (marker.children![0]!.attrs["fill-opacity"] = "molto")],
    ];
    const wrong: string[] = [];
    for (const [what, change] of variants) {
      const marker = base();
      change(marker);
      if (read(written(marker)) !== null) wrong.push(what);
    }
    expect(wrong).toEqual([]);
    // Il controllo di base: il marcatore intatto è della raccolta.
    expect(read(written(base()))).not.toBeNull();
    expect(read(CUSTOM("m0"))).toBeNull();
  });

  it("un marcatore con l'opacità scritta in un altro modo è custom, perché non è quello che FubDraw scriverebbe", () => {
    const marker = base();
    marker.children![0]!.attrs["fill-opacity"] = "0.50";
    expect(read(written(marker))).toBeNull();
    marker.children![0]!.attrs["fill-opacity"] = "0.5";
    expect(read(written(marker))).toMatchObject({ opacity: 0.5 });
  });

  it("l'engine accetta l'add di ogni punta, prima della linea che la nomina", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    const marker = tipElem("rmmmmmmmm", tip("diamond", "small"), "start", RED, 1);
    const adding: Op = { op: "add", parent: "fub-defs", pos: { last: true }, elem: marker };
    const naming: Op = { op: "set", id: "oa", attrs: { "marker-start": "url(#rmmmmmmmm)" } };
    expect(applied(opened, [adding, naming])).toContain('<marker id="rmmmmmmmm" fub:role="shared" fub:marker="diamond small start"');
    expect(markerTip(leaf(opened, "rmmmmmmmm"))).toMatchObject({ tip: tip("diamond", "small"), end: "start", paint: RED, opacity: 1 });
    // E senza la linea che lo nomina un marcatore nuovo, che nessuno usa, il motore lo lascia dov'è.
    const alone = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    expect(applied(alone, [{ op: "add", parent: "fub-defs", pos: { last: true }, elem: marker }])).toContain('id="rmmmmmmmm"');
  });
});

describe("chi può avere le punte", () => {
  const SOURCE = doc(
    DEFS(MARKER("m1", "triangle", "medium", "end"), MARKER("m1s", "triangle", "medium", "start")) +
      LAYER +
      LINE("ol") +
      `<polyline id="op" points="0,0 10,10 20,0" fill="none" stroke="${RED}"/>` +
      `<path id="oo" d="M0 0 L10 10 L20 0" fill="none" stroke="${RED}"/>` +
      `<path id="oc" d="M0 0 L10 10 L20 0 Z" fill="none" stroke="${RED}"/>` +
      `<path id="oz" d="M0 0 L10 10 L20 0 z" fill="none" stroke="${RED}"/>` +
      `<path id="ok" d="M0 0 L10 10 L20 0 Z" fill="none" stroke="${RED}" marker-end="url(#m1)"/>` +
      `<polygon id="og" points="0,0 10,0 10,10" fill="none" stroke="${RED}"/>` +
      `<polygon id="oh" points="0,0 10,0 10,10" fill="none" stroke="${RED}" marker-start="url(#m1s)"/>` +
      `<rect id="or" x="0" y="0" width="10" height="10" fill="none" stroke="${RED}"/>` +
      `<text id="ot" x="0" y="20" stroke="${RED}">Ciao</text>` +
      `<path id="oa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="${RED}" stroke-width="2"/>` +
      `<path id="oi" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="${RED}" fub:ink="${INK}"/>` +
      `<g id="oy">${LINE("o1")}</g>` +
      "</g>",
  );

  it("sono le linee, le spezzate e i tracciati aperti, e chi ne ha già, per poterle togliere", () => {
    const opened = open(SOURCE);
    const can = (id: string): boolean => tippable(opened.engine.holder(id)!);
    expect(["ol", "op", "oo", "ok", "oh", "o1"].filter(can)).toEqual(["ol", "op", "oo", "ok", "oh", "o1"]);
    expect(["oc", "oz", "og", "or", "ot", "oa", "oi", "oy"].filter(can)).toEqual([]);
  });

  it("il pannello conta le parti, non gli oggetti scelti, e un gruppo conta per le sue", () => {
    const opened = open(SOURCE);
    expect(looks(opened).count).toBe(6);
    const group = opened.reindex().units.filter((unit) => unit.id === "oy");
    expect(looks(opened, group).count).toBe(1);
    const closed = opened.reindex().units.filter((unit) => unit.id === "oc" || unit.id === "or" || unit.id === "ot");
    expect(looks(opened, closed)).toEqual({ count: 0, start: { shape: null, size: null }, end: { shape: null, size: null } });
  });
});

describe("le punte della selezione", () => {
  it("nessuna selezione non dice niente", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    expect(looks(opened, [])).toEqual({ count: 0, start: { shape: null, size: null }, end: { shape: null, size: null } });
  });

  it("senza punte i capi sono «none» e la misura non c'è", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + LINE("ob") + "</g>"));
    expect(looks(opened)).toEqual({ count: 2, start: { shape: "none", size: null }, end: { shape: "none", size: null } });
  });

  it("forma e misura in comune si dicono, per ogni capo", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), MARKER("mb", "vee", "large", "end", BLUE), MARKER("mc", "circle", "small", "start")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS("mc", "ma")}`) + LINE("ob", ` stroke="${BLUE}"${ENDS("mc", "mb")}`) + "</g>",
      ),
    );
    expect(looks(opened)).toEqual({ count: 2, start: { shape: "circle", size: "small" }, end: { shape: "vee", size: "large" } });
  });

  it("forme diverse non sono d'accordo, e una misura diversa lascia la forma", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), MARKER("mb", "vee", "small", "end"), MARKER("mc", "bar", "small", "end")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "mb")}`) + "</g>",
      ),
    );
    expect(looks(opened).end).toEqual({ shape: "vee", size: null });
    const mixed = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), MARKER("mc", "bar", "large", "end")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "mc")}`) + "</g>",
      ),
    );
    expect(looks(mixed).end).toEqual({ shape: null, size: "large" });
  });

  it("una linea con la punta e una senza non sono d'accordo, ma la misura delle punte c'è", () => {
    const opened = open(doc(DEFS(MARKER("ma", "square", "small", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob") + "</g>"));
    expect(looks(opened).end).toEqual({ shape: null, size: "small" });
    expect(looks(opened).start).toEqual({ shape: "none", size: null });
  });

  it("un marcatore che non è della raccolta è «custom», e non dà misura", () => {
    const opened = open(doc(DEFS(CUSTOM("cm"), MARKER("ma", "vee", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "cm")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "cm")}`) + "</g>"));
    expect(looks(opened).end).toEqual({ shape: "custom", size: null });
    const mixed = open(doc(DEFS(CUSTOM("cm"), MARKER("ma", "vee", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "cm")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "ma")}`) + "</g>"));
    expect(looks(mixed).end).toEqual({ shape: null, size: "large" });
  });

  it("una punta nominata sul capo sbagliato si legge per quello che è, forma e misura", () => {
    const opened = open(doc(DEFS(MARKER("ma", "diamond", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("ma", null)}`) + "</g>"));
    expect(looks(opened).start).toEqual({ shape: "diamond", size: "medium" });
  });

  it("il marcatore di mezzo non conta", () => {
    const opened = open(doc(DEFS(MARKER("ma", "diamond", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}" marker-mid="url(#ma)"`) + "</g>"));
    expect(looks(opened)).toEqual({ count: 1, start: { shape: "none", size: null }, end: { shape: "none", size: null } });
  });

  it("una parte bloccata dentro un gruppo scelto non conta, e un oggetto bloccato non si sceglie", () => {
    const opened = open(
      doc(
        DEFS() + LAYER +
          `<g id="og">${LINE("oa")}${LINE("ob", ` stroke="${RED}" fub:locked="true"`, 20)}${LINE("oc", ` stroke="${RED}"`, 30)}</g>` +
          "</g>",
      ),
    );
    expect(looks(opened).count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Dare le punte.
// ---------------------------------------------------------------------------

describe("dare una punta", () => {
  it("aggiunge il marcatore fra le risorse, e la linea lo nomina, nello stesso passo", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made.changed).toBe(1);
    expect(made.keys).toEqual(["oa"]);
    expect(made.ops.map((op) => op.op)).toEqual(["add", "set"]);
    const add = made.ops[0] as AddOp;
    expect(add.parent).toBe("fub-defs");
    expect(add.pos).toEqual({ last: true });
    const id = add.elem.attrs.id!;
    expect(id).toMatch(/^r/);
    expect(add.elem).toEqual(tipElem(id, tip("triangle"), "end", RED, 1));
    expect(made.ops[1]).toEqual({ op: "set", id: "oa", attrs: { "marker-end": `url(#${id})` } });
    const text = applied(opened, made.ops);
    expect(text).toContain(`marker-end="url(#${id})"`);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle"), end: "end", paint: RED, opacity: 1, id });
    expect(looks(opened).end).toEqual({ shape: "triangle", size: DEFAULT_TIP_SIZE });
  });

  it("senza risorse nasce fub-defs, per prima, e poi il marcatore", () => {
    const opened = open(doc(LAYER + LINE("oa") + "</g>"));
    const made = tipped(opened, { end: "start", shape: "circle" });
    expect(made.ops.map((op) => op.op)).toEqual(["add", "add", "set"]);
    expect((made.ops[0] as AddOp).elem.tag).toBe("defs");
    const text = applied(opened, made.ops);
    expect(text.indexOf('<defs id="fub-defs">')).toBeLessThan(text.indexOf("<marker"));
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("circle"), end: "start" });
  });

  it("due linee dello stesso colore condividono il marcatore, e un colore diverso ne vuole un altro", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + LINE("ob", undefined, 20) + LINE("oc", ` stroke="${BLUE}" stroke-width="2"`, 30) + LINE("od", ` stroke="${RED}" stroke-opacity="0.5"`, 40) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made.ops.map((op) => op.op)).toEqual(["add", "add", "add", "set", "set", "set", "set"]);
    expect(made.changed).toBe(4);
    applied(opened, made.ops);
    expect(markersIn(opened)).toHaveLength(3);
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
    expect(usedBy(opened, "oa", "end")).not.toBe(usedBy(opened, "oc", "end"));
    expect(shown(opened, "oc", "end")).toMatchObject({ paint: BLUE, opacity: 1 });
    expect(shown(opened, "od", "end")).toMatchObject({ paint: RED, opacity: 0.5 });
    expect(usedBy(opened, "od", "end")).not.toBe(usedBy(opened, "oa", "end"));
  });

  it("riusa un marcatore uguale che il disegno ha già, anche se non è di una linea della selezione", () => {
    const opened = open(doc(DEFS(MARKER("mx", "square", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mx")}`) + LINE("ob", undefined, 20) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "square" }, opened.reindex().units.filter((unit) => unit.id === "ob"));
    // Non c'è una misura da tenere: la nuova è la medium, un altro marcatore.
    expect(adds(made.ops)).toHaveLength(1);
    const same = tipped(opened, { end: "end", size: "large" }, opened.reindex().units.filter((unit) => unit.id === "ob"));
    expect(same.ops).toEqual([]);
    const linked = open(doc(DEFS(MARKER("mx", "square", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mx")}`) + LINE("ob", undefined, 20) + "</g>"));
    const reused = tipped(linked, { end: "end", shape: "square" }, linked.reindex().units.filter((unit) => unit.id === "ob"));
    expect(reused.ops).toEqual([{ op: "set", id: "ob", attrs: { "marker-end": "url(#mx)" } }]);
    applied(linked, reused.ops);
    expect(markersIn(linked)).toEqual(["mx"]);
  });

  it("la punta nuova ha la misura di quella che c'era, o la media", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), CUSTOM("cm")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob", undefined, 20) + LINE("oc", ` stroke="${RED}"${ENDS(null, "cm")}`, 30) + "</g>",
      ),
    );
    const made = tipped(opened, { end: "end", shape: "circle" });
    expect(made.changed).toBe(3);
    applied(opened, made.ops);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("circle", "large") });
    expect(shown(opened, "ob", "end")).toMatchObject({ tip: tip("circle", DEFAULT_TIP_SIZE) });
    expect(shown(opened, "oc", "end")).toMatchObject({ tip: tip("circle", DEFAULT_TIP_SIZE) });
    // Il marcatore custom non lo usa più nessuno, ma non è un'altra risorsa condivisa: resta.
    expect(markersIn(opened)).toContain("cm");
    expect(markersIn(opened)).not.toContain("ma");
  });

  it("il capo d'inizio e quello di fine sono indipendenti, e la misura non passa dall'uno all'altro", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    given(opened, { end: "end", size: "large" });
    given(opened, { end: "start", shape: "bar" });
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle", "large"), end: "end" });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("bar", "medium"), end: "start" });
  });

  it("una parte già come si chiede non cambia, e il motore non ha niente da fare", () => {
    const opened = open(doc(DEFS(MARKER("ma", "triangle", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + "</g>"));
    for (const change of [{ end: "end", shape: "triangle" }, { end: "end", size: "large" }, { end: "start", shape: "none" }] as const) {
      const made = tipped(opened, change);
      expect(made.ops).toEqual([]);
      expect(made.changed).toBe(0);
      expect(made.keys).toEqual(["oa"]);
    }
  });

  it("si può dare due volte senza che cambi niente la seconda", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + LINE("ob", ` stroke="${BLUE}"`, 20) + "</g>"));
    given(opened, { end: "end", shape: "diamond" });
    const text = opened.engine.text;
    expect(tipped(opened, { end: "end", shape: "diamond" }).changed).toBe(0);
    expect(opened.engine.text).toBe(text);
  });

  it("una linea senza id ne riceve uno, in testa, e la selezione la ritrova", () => {
    const opened = open(doc(DEFS() + LAYER + '<line x1="0" y1="10" x2="50" y2="10" stroke="#d55e00"/>' + "</g>"));
    const unit = opened.index.units[0]!;
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made.ops.map((op) => op.op)).toEqual(["ident", "add", "set"]);
    const set = made.ops[2] as SetOp;
    expect(made.keys).toEqual([set.id]);
    expect(made.keys[0]).not.toBe(unit.key);
    applied(opened, made.ops);
    expect(shown(opened, set.id, "end")).toMatchObject({ tip: tip("triangle") });
  });

  it("non tocca marker-mid", () => {
    const opened = open(doc(DEFS(MARKER("mm", "circle", "small", "end")) + LAYER + LINE("oa", ` stroke="${RED}" marker-mid="url(#mm)"`) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "none" });
    expect(made.ops).toEqual([]);
    for (const change of [{ end: "end", shape: "triangle" }, { swap: true }, { end: "start", shape: "bar" }] as const) {
      const done = tipped(opened, change);
      expect(sets(done.ops).every((op) => !("marker-mid" in op.attrs))).toBe(true);
    }
    given(opened, { end: "end", shape: "triangle" });
    expect(opened.engine.text).toContain('marker-mid="url(#mm)"');
    given(opened, { end: "end", shape: "none" });
    expect(opened.engine.text).toContain('marker-mid="url(#mm)"');
    expect(markersIn(opened)).toEqual(["mm"]);
  });

  it("un tracciato chiuso non ne riceve, ma se ne ha una la toglie", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "triangle", "medium", "end")) +
          LAYER +
          `<path id="oc" d="M0 0 L10 0 L10 10 Z" fill="none" stroke="${RED}"/>` +
          `<path id="ok" d="M0 20 L10 20 L10 30 Z" fill="none" stroke="${RED}"${ENDS(null, "ma")}/>` +
          "</g>",
      ),
    );
    const none = tipped(opened, { end: "end", shape: "none" });
    expect(none.changed).toBe(1);
    expect(sets(none.ops)).toEqual([{ op: "set", id: "ok", attrs: { "marker-end": null } }]);
    expect(tipped(opened, { end: "start", shape: "bar" }).changed).toBe(1);
    applied(opened, none.ops);
    expect(markersIn(opened)).toEqual([]);
    expect(looks(opened).count).toBe(0);
  });

  it("le forme che non hanno punte restano com'erano", () => {
    const opened = open(
      doc(
        DEFS() +
          LAYER +
          `<rect id="or" x="0" y="0" width="10" height="10" fill="none" stroke="${RED}"/>` +
          `<path id="oa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="${RED}" stroke-width="2"/>` +
          `<path id="oi" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="${RED}" fub:ink="${INK}"/>` +
          "</g>",
      ),
    );
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(made).toMatchObject({ ops: [], changed: 0 });
    expect(made.keys).toEqual(opened.index.units.map((unit) => unit.key));
  });
});

describe("togliere, cambiare la misura, scambiare", () => {
  it("none toglie il riferimento, e il motore toglie il marcatore che nessuno usa più", () => {
    const opened = open(
      doc(DEFS(MARKER("ma", "triangle", "medium", "end"), MARKER("mb", "triangle", "medium", "start")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("mb", "ma")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "ma")}`, 20) + "</g>"),
    );
    const made = tipped(opened, { end: "end", shape: "none" });
    expect(made.ops).toEqual([
      { op: "set", id: "oa", attrs: { "marker-end": null } },
      { op: "set", id: "ob", attrs: { "marker-end": null } },
    ]);
    const text = applied(opened, made.ops);
    expect(text).not.toContain('id="ma"');
    expect(text).toContain('id="mb"');
    expect(text).toContain('marker-start="url(#mb)"');
    expect(text).not.toContain("marker-end");
  });

  it("none su un capo senza punta non scrive niente, neanche per un marcatore custom nominato altrove", () => {
    const opened = open(doc(DEFS(CUSTOM("cm")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("cm", null)}`) + "</g>"));
    expect(tipped(opened, { end: "end", shape: "none" }).ops).toEqual([]);
    const cleared = tipped(opened, { end: "start", shape: "none" });
    expect(sets(cleared.ops)).toEqual([{ op: "set", id: "oa", attrs: { "marker-start": null } }]);
  });

  it("la misura cambia le sole punte della raccolta, di quel capo, e le altre restano", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "triangle", "medium", "end"), MARKER("mb", "bar", "small", "start"), CUSTOM("cm")) +
          LAYER +
          LINE("oa", ` stroke="${RED}"${ENDS("mb", "ma")}`) +
          LINE("ob", undefined, 20) +
          LINE("oc", ` stroke="${RED}"${ENDS(null, "cm")}`, 30) +
          "</g>",
      ),
    );
    const made = tipped(opened, { end: "end", size: "large" });
    expect(made.changed).toBe(1);
    expect(made.ops.map((op) => op.op)).toEqual(["add", "set"]);
    const text = applied(opened, made.ops);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle", "large") });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("bar", "small") });
    expect(usedBy(opened, "oc", "end")).toBe("cm");
    expect(usedBy(opened, "ob", "end")).toBeNull();
    expect(text).not.toContain('id="ma"');
    expect(tipped(opened, { end: "start", size: "small" }).changed).toBe(0);
  });

  it("scambia le due punte: la stessa forma e misura va sull'altro capo, nel suo marcatore", () => {
    const opened = open(
      doc(DEFS(MARKER("ma", "triangle", "small", "start"), MARKER("mb", "bar", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("ma", "mb")}`) + "</g>"),
    );
    const made = tipped(opened, { swap: true });
    expect(made.changed).toBe(1);
    expect(adds(made.ops)).toHaveLength(2);
    applied(opened, made.ops);
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("bar", "large"), end: "start", paint: RED });
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle", "small"), end: "end", paint: RED });
    expect(markersIn(opened)).toHaveLength(2);
    expect(markersIn(opened)).not.toContain("ma");
    expect(markersIn(opened)).not.toContain("mb");
  });

  it("scambiando, una punta sola passa all'altro capo e il suo capo resta senza", () => {
    const opened = open(doc(DEFS(MARKER("ma", "diamond", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + "</g>"));
    const made = tipped(opened, { swap: true });
    expect(sets(made.ops)).toHaveLength(1);
    expect(sets(made.ops)[0]!.attrs["marker-end"]).toBeNull();
    applied(opened, made.ops);
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("diamond"), end: "start" });
    expect(usedBy(opened, "oa", "end")).toBeNull();
    expect(looks(opened)).toMatchObject({ start: { shape: "diamond" }, end: { shape: "none" } });
  });

  it("scambiando, un marcatore custom passa com'è, e due uguali non cambiano", () => {
    const opened = open(
      doc(
        DEFS(CUSTOM("cm"), MARKER("mb", "circle", "large", "end"), MARKER("mc", "circle", "large", "start")) +
          LAYER +
          LINE("oa", ` stroke="${RED}"${ENDS("cm", "mb")}`) +
          LINE("ob", ` stroke="${RED}"${ENDS(null, "cm")}`, 20) +
          LINE("oc", ` stroke="${RED}"${ENDS("mc", "mb")}`, 30) +
          "</g>",
      ),
    );
    const made = tipped(opened, { swap: true });
    // Le punte di `oc` sono uguali ai due capi: scambiate, restano quelle.
    expect(made.changed).toBe(2);
    applied(opened, made.ops);
    expect(usedBy(opened, "oa", "end")).toBe("cm");
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("circle", "large"), end: "start" });
    expect(usedBy(opened, "ob", "start")).toBe("cm");
    expect(usedBy(opened, "ob", "end")).toBeNull();
    expect(usedBy(opened, "oc", "start")).toBe("mc");
    expect(usedBy(opened, "oc", "end")).toBe("mb");
  });

  it("scambiare due volte riporta le punte dove erano", () => {
    const opened = open(
      doc(DEFS(MARKER("ma", "triangle", "small", "start"), MARKER("mb", "bar", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("ma", "mb")}`) + LINE("ob", ` stroke="${RED}"`, 20) + "</g>"),
    );
    const before = looks(opened);
    given(opened, { swap: true });
    expect(looks(opened)).not.toEqual(before);
    given(opened, { swap: true });
    expect(looks(opened)).toEqual(before);
  });
});

describe("dare le punte a un gruppo", () => {
  const GROUP = (inner: string, extra = ""): string => `<g id="og"${extra}>${inner}</g>`;

  it("passa il cambio alle parti, a ogni profondità, e non a quelle bloccate", () => {
    const opened = open(
      doc(
        DEFS() +
          LAYER +
          GROUP(
            LINE("oa") + LINE("ob", ` stroke="${RED}" fub:locked="true"`, 20) + `<g id="oi">${LINE("oc", ` stroke="${BLUE}"`, 30)}<rect id="or" x="0" y="0" width="5" height="5" fill="${RED}"/></g>`,
          ) +
          "</g>",
      ),
    );
    const group = opened.index.units.filter((unit) => unit.id === "og");
    expect(group).toHaveLength(1);
    const made = tipped(opened, { end: "end", shape: "vee" }, group);
    expect(made.changed).toBe(2);
    expect(made.keys).toEqual(["og"]);
    applied(opened, made.ops);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("vee"), paint: RED });
    expect(shown(opened, "oc", "end")).toMatchObject({ tip: tip("vee"), paint: BLUE });
    expect(usedBy(opened, "ob", "end")).toBeNull();
  });

  it("il colore di una parte è quello del suo gruppo, se non ne ha uno suo", () => {
    const opened = open(doc(DEFS() + LAYER + GROUP(LINE("oa", ` stroke-width="2"`) + LINE("ob", ` stroke="${BLUE}"`, 20), ` stroke="${PINK}"`) + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: BLUE });
  });

  it("l'opacità del contorno si legge dal gruppo come il colore, e l'opacità della linea non conta", () => {
    const opened = open(doc(DEFS() + LAYER + GROUP(LINE("oa", ` stroke-width="2" opacity="0.2"`) + LINE("ob", ` stroke-opacity="0.75"`, 20), ` stroke="${PINK}" stroke-opacity="0.5"`) + "</g>"));
    given(opened, { end: "end", shape: "square" });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK, opacity: 0.5 });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: PINK, opacity: 0.75 });
  });

  it("le parti di due gruppi annidati con lo stesso colore usano un marcatore solo", () => {
    const opened = open(doc(DEFS() + LAYER + GROUP(`<g id="oi" stroke="${RED}">${LINE("oa", "")}</g>${LINE("ob")}`) + "</g>"));
    const made = tipped(opened, { end: "end", shape: "triangle" });
    expect(adds(made.ops)).toHaveLength(1);
    applied(opened, made.ops);
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
  });
});

describe("il colore di una punta", () => {
  /// Il marcatore che `tipOps` darebbe alla linea `oa` di un documento con `extra` e `defs`.
  function colorOf(extra: string, defs = ""): MarkerTip | null {
    const opened = open(doc(DEFS(defs) + LAYER + LINE("oa", extra) + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    return shown(opened, "oa", "end");
  }

  it("è quello dello stroke della linea, scritto in minuscolo, e non cambia con il riempimento", () => {
    expect(colorOf(' stroke="#D55E00" fill="#0072b2"')).toMatchObject({ paint: RED, opacity: 1 });
    expect(colorOf(' stroke="#0f0"')).toMatchObject({ paint: "#00ff00" });
    expect(colorOf(' stroke="red"')).toMatchObject({ paint: "#ff0000" });
  });

  it("con stroke none la punta c'è ma non si vede, e l'opacità non conta", () => {
    expect(colorOf(' stroke="none" stroke-opacity="0.4"')).toMatchObject({ paint: "none", opacity: 1 });
    expect(colorOf("")).toMatchObject({ paint: "none", opacity: 1 });
  });

  it("l'opacità del contorno va sulla punta", () => {
    expect(colorOf(` stroke="${RED}" stroke-opacity="0.5"`)).toMatchObject({ paint: RED, opacity: 0.5 });
    expect(colorOf(` stroke="${RED}" stroke-opacity="0"`)).toMatchObject({ paint: RED, opacity: 0 });
    expect(colorOf(` stroke="${RED}" stroke-opacity="0.33333"`)).toMatchObject({ paint: RED, opacity: 0.3333 });
  });

  it("un campione del documento si scrive col suo colore, e la punta lo segue", () => {
    expect(colorOf(' stroke="url(#rs) #0072b2"', SWATCH("rs", BLUE))).toMatchObject({ paint: "url(#rs) #0072b2" });
  });

  it("una sfumatura dà il colore del vertice dove sta la punta", () => {
    const opened = open(doc(DEFS(RAMP("rg")) + LAYER + `<line id="oa" x1="0" y1="10" x2="100" y2="10" stroke="url(#rg)" stroke-width="2"/>` + "</g>"));
    given(opened, { end: "end", shape: "triangle" });
    given(opened, { end: "start", shape: "triangle" });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "oa", "start")).toMatchObject({ paint: RED });
  });

  it("una sfumatura che svanisce dà alla punta l'opacità che ha sul capo, per quella del contorno", () => {
    // Come la «Dissolvenza»: dal pieno al trasparente, e a metà strada.
    const FADE = (id: string): string =>
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${RED}" stop-opacity="0"/></linearGradient>`;
    const opened = open(
      doc(
        DEFS(FADE("rg")) +
          LAYER +
          `<line id="oa" x1="0" y1="10" x2="100" y2="10" stroke="url(#rg)" stroke-width="2"/>` +
          `<line id="ob" x1="0" y1="20" x2="50" y2="20" stroke="url(#rg)" stroke-opacity="0.5" stroke-width="2"/>` +
          "</g>",
      ),
    );
    given(opened, { end: "end", shape: "triangle" });
    given(opened, { end: "start", shape: "triangle" });
    expect(shown(opened, "oa", "start")).toMatchObject({ paint: RED, opacity: 1 });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED, opacity: 0 });
    expect(shown(opened, "ob", "start")).toMatchObject({ paint: RED, opacity: 0.5 });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: RED, opacity: 0.25 });
    expect(opened.engine.text).toContain('fill-opacity="0.25"');
  });

  it("il vertice è quello del capo anche per spezzate e tracciati, e l'ultimo se il tracciato si ripiega", () => {
    const opened = open(
      doc(
        DEFS(RAMP("rg"), CUSTOM("cm")) +
          LAYER +
          `<polyline id="op" points="0,0 50,10 100,0" fill="none" stroke="url(#rg)" stroke-width="2"/>` +
          `<path id="oq" d="M0 20 L100 20 L0 20" fill="none" stroke="url(#rg)" stroke-width="2"/>` +
          // Un poligono è chiuso: la fine torna al primo punto, come in SVG.
          `<polygon id="or" points="100,40 50,45 0,40" fill="none" stroke="url(#rg)" stroke-width="2"${ENDS("cm", "cm")}/>` +
          "</g>",
      ),
    );
    given(opened, { end: "end", shape: "circle" });
    given(opened, { end: "start", shape: "circle" });
    expect(shown(opened, "op", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "op", "start")).toMatchObject({ paint: RED });
    expect(shown(opened, "oq", "end")).toMatchObject({ paint: RED });
    expect(shown(opened, "oq", "start")).toMatchObject({ paint: RED });
    expect(shown(opened, "or", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "or", "start")).toMatchObject({ paint: BLUE });
  });

  it("un motivo, che non si sa calcolare, dà il ripiego, o il nero", () => {
    const pattern = '<pattern id="rp" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#d55e00"/></pattern>';
    expect(colorOf(' stroke="url(#rp) #cc79a7"', pattern)).toMatchObject({ paint: PINK });
    expect(colorOf(' stroke="url(#rp)"', pattern)).toMatchObject({ paint: "#000000" });
    expect(colorOf(' stroke="url(#rp) none"', pattern)).toMatchObject({ paint: "#000000" });
  });

  it("una sfumatura che non si calcola, come quella sul riquadro di una linea orizzontale, dà il ripiego o il nero", () => {
    const flat = '<linearGradient id="rf"><stop offset="0" stop-color="#d55e00"/><stop offset="1" stop-color="#0072b2"/></linearGradient>';
    expect(colorOf(' stroke="url(#rf) #cc79a7"', flat)).toMatchObject({ paint: PINK });
    expect(colorOf(' stroke="url(#rf)"', flat)).toMatchObject({ paint: "#000000" });
    expect(colorOf(' stroke="url(#rf) none"', flat)).toMatchObject({ paint: "#000000" });
  });
});

// ---------------------------------------------------------------------------
// Seguire la linea.
// ---------------------------------------------------------------------------

describe.each([
  ["trovando gli elementi da sola", false],
  ["con l'indice del motore", true],
])("le punte seguono la linea, %s", (_, index) => {
  const marked = (extra = "", markers = MARKER("mr", "triangle", "medium", "end")): string =>
    doc(DEFS(markers) + LAYER + LINE("oa", ` stroke="${RED}" stroke-width="2"${ENDS(null, "mr")}${extra}`) + "</g>");

  it("cambiato il colore del contorno, la punta cambia nello stesso passo e nello stesso annulla", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle"), paint: BLUE, opacity: 1 });
    // La punta di prima non la usa più nessuno: se n'è andata.
    expect(markersIn(opened)).toHaveLength(1);
    expect(markersIn(opened)).not.toContain("mr");
    expect(adds(forward)).toHaveLength(1);
    expect(flat(forward).filter((op) => op.op === "remove")).toEqual([{ op: "remove", target: "mr" }]);
    settled(opened);
  });

  it("l'opacità del contorno cambia l'opacità della punta, e una linea invisibile la lascia", () => {
    const opened = followed(marked(), index);
    step(opened, { op: "set", id: "oa", attrs: { "stroke-opacity": "0.5" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED, opacity: 0.5 });
    step(opened, { op: "set", id: "oa", attrs: { stroke: "none" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: "none", opacity: 1 });
    step(opened, { op: "set", id: "oa", attrs: { stroke: PINK, "stroke-opacity": null } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK, opacity: 1 });
    settled(opened);
  });

  it("il contorno che torna com'era riusa il marcatore di prima, se esiste ancora", () => {
    const opened = followed(marked(), index);
    const other = doc(DEFS(MARKER("mr", "triangle", "medium", "end"), MARKER("mb", "triangle", "medium", "end", BLUE)) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + "</g>");
    const reuse = followed(other, index);
    const forward = step(reuse, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(adds(forward)).toHaveLength(0);
    expect(usedBy(reuse, "oa", "end")).toBe("mb");
    expect(markersIn(reuse)).toEqual(["mb"]);
    settled(opened);
    settled(reuse);
  });

  it("il colore passato da un gruppo cambia le punte di chi lo eredita, con un marcatore solo", () => {
    const source = doc(
      DEFS(MARKER("mr", "vee", "large", "end"), MARKER("ms", "vee", "large", "start")) +
        LAYER +
        `<g id="og" stroke="${RED}">${LINE("oa", ` stroke-width="2"${ENDS("ms", "mr")}`)}${LINE("ob", ` stroke-width="2"${ENDS("ms", "mr")}`, 20)}${LINE("oc", ` stroke="${BLUE}"`, 30)}</g>` +
        "</g>",
    );
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "og", attrs: { stroke: PINK } });
    expect(adds(forward)).toHaveLength(2);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("vee", "large"), end: "end", paint: PINK });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("vee", "large"), end: "start", paint: PINK });
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
    expect(usedBy(opened, "oa", "start")).toBe(usedBy(opened, "ob", "start"));
    expect(sets(forward).map((op) => op.id).sort()).toEqual(["oa", "ob", "og"]);
    settled(opened);
  });

  it("una linea senza id, in un gruppo che cambia colore, riceve un id e la sua punta lo segue nello stesso passo", () => {
    const source = doc(
      DEFS(MARKER("mr", "triangle", "medium", "end")) +
        LAYER +
        `<g id="og" stroke="${RED}"><line x1="0" y1="10" x2="50" y2="10" stroke-width="2"${ENDS(null, "mr")}/></g>` +
        "</g>",
    );
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "og", attrs: { stroke: BLUE } });
    // L'id è dato prima di tutto, perché `set` indirizza per id.
    expect(flat(forward).map((op) => op.op).slice(0, 3)).toEqual(["set", "ident", "add"]);
    const id = /<line id="(o[0-9a-z]{8})"/.exec(opened.engine.text)?.[1];
    expect(id).toBeDefined();
    expect(shown(opened, id!, "end")).toMatchObject({ tip: tip("triangle"), paint: BLUE, opacity: 1 });
    expect(markersIn(opened)).toHaveLength(1);
    expect(markersIn(opened)).not.toContain("mr");
    settled(opened);
  });

  it("cambiato il contorno di un gruppo che passa lo stesso colore a una linea con il suo, questa resta com'è", () => {
    const source = doc(DEFS(MARKER("mb", "triangle", "medium", "end", BLUE)) + LAYER + `<g id="og" stroke="${RED}">${LINE("oa", ` stroke="${BLUE}"${ENDS(null, "mb")}`)}</g>` + "</g>");
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "og", attrs: { stroke: PINK } });
    expect(sets(forward).map((op) => op.id)).toEqual(["og"]);
    expect(usedBy(opened, "oa", "end")).toBe("mb");
  });

  it("un campione ricolorato porta con sé la punta, e non c'è altro da fare", () => {
    const source = doc(
      DEFS(SWATCH("rs", BLUE), MARKER("mr", "triangle", "medium", "end", "url(#rs) #0072b2")) +
        LAYER +
        LINE("oa", ` stroke="url(#rs) #0072b2" stroke-width="2"${ENDS(null, "mr")}`) +
        "</g>",
    );
    const opened = followed(source, index);
    const made = recolorSwatchOps(opened.engine.model!, "rs", PINK, opened.reindex().units, ids(opened));
    const forward = step(opened, gesture(made.ops)!);
    expect(adds(forward)).toHaveLength(0);
    expect(shown(opened, "oa", "end")).toMatchObject({ id: "mr", paint: "url(#rs) #cc79a7" });
    expect(opened.engine.text).toContain('stroke="url(#rs) #cc79a7"');
    settled(opened);
  });

  it("un campione tolto lascia la punta del colore che la linea scrive adesso", () => {
    const source = doc(
      DEFS(SWATCH("rs", BLUE), MARKER("mr", "circle", "small", "end", "url(#rs) #0072b2")) +
        LAYER +
        LINE("oa", ` stroke="url(#rs) #0072b2" stroke-width="2"${ENDS(null, "mr")}`) +
        "</g>",
    );
    const opened = followed(source, index);
    const made = removeSwatchOps(opened.engine.model!, "rs", opened.reindex().units, ids(opened));
    step(opened, gesture(made.ops)!);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("circle", "small"), paint: BLUE });
    expect(opened.engine.text).not.toContain('id="rs"');
    expect(opened.engine.text).not.toContain("url(#rs)");
    settled(opened);
  });

  it("una linea che passa a una sfumatura prende il colore del vertice, e lo cambia con lui", () => {
    const source = doc(DEFS(RAMP("rg"), MARKER("mr", "triangle", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}" stroke-width="2"${ENDS(null, "mr")}`) + "</g>");
    const opened = followed(source, index);
    step(opened, { op: "set", id: "oa", attrs: { stroke: "url(#rg)", x2: "100" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    const back = shown(opened, "oa", "end")!.id;
    // Spostato l'estremo a metà della sfumatura, il colore è quello di metà.
    step(opened, { op: "set", id: "oa", attrs: { x2: "50" } });
    const middle = shown(opened, "oa", "end")!;
    expect(middle.id).not.toBe(back);
    expect(middle.paint).toMatch(/^#[0-9a-f]{6}$/);
    expect(middle.paint).not.toBe(BLUE);
    expect(middle.paint).not.toBe(RED);
    // A metà fra #d55e00 e #0072b2: 106,5 / 104 / 89.
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(middle.paint.slice(at, at + 2), 16));
    expect(Math.abs(r! - 106.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(g! - 104)).toBeLessThanOrEqual(1);
    expect(Math.abs(b! - 89)).toBeLessThanOrEqual(1);
    settled(opened);
  });

  it("una sfumatura cambiata porta con sé le punte di chi la usa, anche in un gruppo e a ogni profondità", () => {
    const source = doc(
      DEFS(RAMP("rg")) +
        LAYER +
        `<line id="oa" x1="0" y1="10" x2="50" y2="10" stroke="url(#rg)" stroke-width="2"/>` +
        `<g id="og"><g id="oi"><line id="ob" x1="0" y1="20" x2="50" y2="20" stroke="url(#rg)" stroke-width="2"/></g></g>` +
        `<line id="oc" x1="0" y1="30" x2="50" y2="30" stroke="${RED}" stroke-width="2"/>` +
        "</g>",
    );
    const opened = followed(source, index);
    given(opened, { end: "end", shape: "triangle" });
    const before = shown(opened, "oa", "end")!;
    expect(before.paint).not.toBe(BLUE);
    // Il vertice di fine sta a metà della sfumatura: spostata la fine della sfumatura a 50, ne è il capo.
    step(opened, { op: "set", id: "rg", attrs: { x2: "50" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "oc", "end")).toMatchObject({ paint: RED });
    settled(opened);
  });

  it("una punta tolta non torna: con il riferimento il marcatore se ne va", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { "marker-end": null } });
    expect(markersIn(opened)).toEqual([]);
    expect(adds(forward)).toHaveLength(0);
    expect(opened.engine.text).not.toContain("marker-end");
    settled(opened);
  });

  it("cambiare altro in una linea non fa niente alle punte", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { "stroke-width": "6", x2: "70" } });
    expect(forward).toEqual({ op: "set", id: "oa", attrs: { "stroke-width": "6", x2: "70" } });
    expect(markersIn(opened)).toEqual(["mr"]);
  });

  it("aggiungere una linea, o muoverla, non cambia punte che hanno già il colore giusto", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "add", parent: "l1", pos: { last: true }, elem: { tag: "line", attrs: { id: "obbbbbbbb", x1: "0", y1: "0", x2: "5", y2: "5", stroke: RED, "marker-end": "url(#mr)" } } });
    expect(adds(forward)).toHaveLength(1);
    expect(usedBy(opened, "obbbbbbbb", "end")).toBe("mr");
    step(opened, { op: "set", id: "obbbbbbbb", attrs: { transform: "translate(5 5)" } });
    expect(markersIn(opened)).toEqual(["mr"]);
  });

  it("una linea incollata con una punta di un altro colore la prende del suo", () => {
    const opened = followed(marked(), index);
    step(opened, { op: "add", parent: "l1", pos: { last: true }, elem: { tag: "line", attrs: { id: "obbbbbbbb", x1: "0", y1: "0", x2: "5", y2: "5", stroke: BLUE, "marker-end": "url(#mr)" } } });
    expect(shown(opened, "obbbbbbbb", "end")).toMatchObject({ paint: BLUE });
    expect(usedBy(opened, "oa", "end")).toBe("mr");
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED });
    settled(opened);
  });

  it("una punta nominata dal capo sbagliato passa al marcatore del suo capo", () => {
    const opened = followed(marked(), index);
    step(opened, { op: "set", id: "oa", attrs: { "marker-start": "url(#mr)", "marker-end": null } });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("triangle"), end: "start", paint: RED });
    expect(usedBy(opened, "oa", "start")).not.toBe("mr");
    settled(opened);
  });

  it("un marcatore custom e il marcatore di mezzo non si toccano, né le linee che non possono avere punte", () => {
    const source = doc(
      DEFS(MARKER("mr", "triangle", "medium", "end"), CUSTOM("cm")) +
        LAYER +
        LINE("oa", ` stroke="${RED}" marker-mid="url(#mr)"${ENDS("cm", null)}`) +
        `<path id="oc" d="M0 0 L10 0 L10 10 Z" fill="none" stroke="${RED}"/>` +
        "</g>",
    );
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(forward).toEqual({ op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(opened.engine.text).toContain('marker-mid="url(#mr)"');
    expect(usedBy(opened, "oa", "start")).toBe("cm");
  });

  it("una parte sotto un livello bloccato non ferma le altre quando la sfumatura cambia", () => {
    const line = (id: string, y: number): string => `<line id="${id}" x1="0" y1="${y}" x2="50" y2="${y}" stroke="url(#rg)" stroke-width="2"/>`;
    const opened = followed(doc(DEFS(RAMP("rg")) + LAYER + line("oa", 10) + "</g>" + '<g id="l2" fub:layer="Secondo">' + line("ob", 20) + "</g>"), index);
    given(opened, { end: "end", shape: "triangle" });
    const second = shown(opened, "ob", "end")!;
    step(opened, { op: "set", id: "l2", attrs: { "fub:locked": "true" } });
    // Se il seguito scrivesse anche sotto il livello bloccato, il motore lo rifiuterebbe intero, e `oa` non cambierebbe.
    const forward = step(opened, { op: "set", id: "rg", attrs: { x2: "50" } });
    expect(adds(forward)).toHaveLength(1);
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    // La linea bloccata resta com'era, con la sua punta.
    expect(usedBy(opened, "ob", "end")).toBe(second.id);
    expect(markersIn(opened)).toContain(second.id);
    settled(opened);
  });

  it("una linea bloccata di per sé, in un livello libero, segue: il motore la lascia scrivere", () => {
    const opened = followed(marked(` fub:locked="true"`), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(adds(forward)).toHaveLength(1);
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
  });
});

describe("il seguito non sbaglia", () => {
  it("non fa niente senza punte della raccolta, senza ciò che è cambiato, o con ciò che non esiste", () => {
    const none = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    expect(followTips(none.engine.model!, new Set(["oa"]), ids(none))).toBeNull();
    const custom = open(doc(DEFS(CUSTOM("cm")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "cm")}`) + "</g>"));
    expect(followTips(custom.engine.model!, new Set(["oa", "cm"]), ids(custom))).toBeNull();
    const some = open(doc(DEFS(MARKER("mr", "triangle", "medium", "end", BLUE)) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + "</g>"));
    expect(followTips(some.engine.model!, new Set(), ids(some))).toBeNull();
    expect(followTips(some.engine.model!, new Set(["nessuno", "mr"]), ids(some))).toBeNull();
    expect(followTips(some.engine.model!, new Set(["oa"]), ids(some))).not.toBeNull();
    // Un livello toccato porta con sé le sue linee.
    expect(followTips(some.engine.model!, new Set(["l1"]), ids(some))).not.toBeNull();
  });

  it("un seguito ha prima i marcatori e poi i set, e il motore lo accetta", () => {
    const opened = open(doc(DEFS(MARKER("mr", "triangle", "medium", "end", BLUE)) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "mr")}`, 20) + "</g>"));
    const op = followTips(opened.engine.model!, new Set(["oa", "ob"]), ids(opened), (id) => opened.engine.holder(id))!;
    expect(flat(op).map((each) => each.op)).toEqual(["add", "set", "set"]);
    expect(sets(op).map((each) => each.id)).toEqual(["oa", "ob"]);
    const before = opened.engine.text;
    const outcome = opened.engine.apply(op);
    expect(outcome.outcome).toBe("applied");
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED });
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
    expect(markersIn(opened)).toHaveLength(1);
    if (outcome.outcome === "applied") expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
  });

  it("dà lo stesso risultato con l'indice del motore e senza", () => {
    const opened = open(
      doc(
        DEFS(MARKER("mr", "triangle", "medium", "end", BLUE), MARKER("ms", "bar", "small", "start", BLUE)) +
          LAYER +
          `<g id="og" stroke="${RED}">${LINE("oa", ` stroke-width="2"${ENDS("ms", "mr")}`)}${LINE("ob", ` stroke-width="2"${ENDS(null, "mr")}`, 20)}</g>` +
          "</g>",
      ),
    );
    const touched = new Set(["og", "oa", "ob"]);
    const withIndex = followTips(opened.engine.model!, touched, new NewIds(() => false), (id) => opened.engine.holder(id));
    const without = followTips(opened.engine.model!, touched, new NewIds(() => false));
    // Gli id dei marcatori nuovi sono a caso: il resto è lo stesso.
    const plain = (op: Op | null): string => JSON.stringify(op).replace(/r[0-9a-z]{8}/g, "R");
    expect(plain(without)).toBe(plain(withIndex));
    expect(sets(withIndex!).map((op) => op.id)).toEqual(["oa", "ob"]);
  });

  it("un id che non c'è, o che è di un nodo tolto, si salta", () => {
    const opened = followed(doc(DEFS(MARKER("mr", "triangle", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + LINE("ob", ` stroke="${RED}"`, 20) + "</g>"));
    step(opened, { op: "remove", target: "ob" });
    expect(usedBy(opened, "oa", "end")).toBe("mr");
  });

  it("dati strani non lo fanno lanciare: percorsi, punti, coordinate e colori che non si leggono", () => {
    const odd = doc(
      DEFS(RAMP("rg"), MARKER("mr", "triangle", "medium", "end", BLUE), MARKER("ms", "vee", "small", "start", "none"), MARKER("mt", "circle", "large", "end", "url(#rg) #123456")) +
        LAYER +
        `<path id="o1" d="M" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<path id="o2" d="M 1 2 L foo" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<path id="o3" d="" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<polyline id="o4" points="a b c" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<polyline id="o5" points="" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<polyline id="o6" points="1,2,3" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<line id="o7" x1="foo" y1="bar" x2="" y2="1e999" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<line id="o8" stroke="url(#)"${ENDS("ms", "mr")}/>` +
        `<line id="o9" x2="9" stroke="url(#nessuno) #zzz"${ENDS("ms", "mr")}/>` +
        `<line id="oa" x2="9" stroke="rgb(1,2)" stroke-opacity="x"${ENDS("ms", "mr")}/>` +
        `<line id="ob" x2="9" stroke="inherit"${ENDS("ms", "mr")}/>` +
        `<line id="oc" x2="9" stroke="currentColor"${ENDS("ms", "mt")}/>` +
        `<line id="od" x2="9" stroke=" url( #rg ) "${ENDS("ms", "mr")}/>` +
        `<line id="oe" x2="9" stroke="url(#rg)" marker-end="url(#mr)" marker-start="url(#mr)" marker-mid="url(#mr)" fub:locked="true"/>` +
        `<g id="og" stroke="${RED}"><g id="oh" stroke="bogus"><line id="oi" x2="9"${ENDS("ms", "mr")}/></g></g>` +
        "</g>",
    );
    const opened = followed(odd);
    const touched = everyId(opened);
    expect(() => followTips(opened.engine.model!, touched, ids(opened), (id) => opened.engine.holder(id))).not.toThrow();
    expect(() => followTips(opened.engine.model!, touched, ids(opened))).not.toThrow();
    expect(() => tipsLookOf(opened.engine.model!, opened.index.units)).not.toThrow();
    for (const change of [{ end: "end", shape: "triangle" }, { end: "start", size: "large" }, { swap: true }, { end: "end", shape: "none" }] as const) {
      expect(() => tipped(opened, change)).not.toThrow();
    }
    // Il motore applica anche un passo che le fa lavorare.
    expect(opened.engine.apply({ op: "set", id: "rg", attrs: { x2: "20" } }).outcome).toBe("applied");
    expect(opened.engine.apply({ op: "set", id: "og", attrs: { stroke: PINK } }).outcome).toBe("applied");
  });

  it("anche in un documento con marcatori estranei, custom o fuori dalle risorse", () => {
    const source = doc(
      `<marker id="mx" markerWidth="2" markerHeight="2"><circle cx="1" cy="1" r="1"/></marker>` +
        DEFS(MARKER("mr", "triangle", "medium", "end", BLUE), `<marker id="mx2"><foo/></marker>`) +
        LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + "</g>",
    );
    const opened = followed(source);
    expect(opened.engine.apply({ op: "set", id: "oa", attrs: { stroke: PINK } }).outcome).toBe("applied");
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK });
  });
});

// ---------------------------------------------------------------------------
// A caso.
// ---------------------------------------------------------------------------

describe("a caso", () => {
  const COLORS = [RED, BLUE, PINK, "#000000", "#009e73"];
  /// I contorni: colori, nessuno, una sfumatura e due campioni.
  const STROKES = [...COLORS, "none", "red", "#abc", "url(#rg)", "url(#rs)", "url(#rs) #0072b2", "url(#rt) #123456"];
  /// Contorni che il disegno non accetta: il motore li rifiuta interi.
  const WRONG = ["currentColor", "url(#manca)"];
  const MARKERS = ["m0", "m1", "m2", "m3", "m4", "m5", "cm"];

  /// Un disegno a caso: sei marcatori della raccolta e uno no; linee,
  /// spezzate e tracciati aperti e chiusi, nel livello, in due gruppi
  /// annidati, in un terzo e in un livello bloccato, con contorni, opacità e
  /// marcatori qualunque. Per ogni linea, i contenitori sopra di lei.
  function drawing(rng: Mulberry32): { source: string; lines: string[]; above: Map<string, string[]> } {
    const pick = <T,>(list: readonly T[]): T => list[rng.below(list.length)]!;
    const chance = (p: number): boolean => rng.below(1000) < p * 1000;
    const lines: string[] = [];
    const above = new Map<string, string[]>();
    const defs = [RAMP("rg"), SWATCH("rs", BLUE), SWATCH("rt", "#123456"), CUSTOM("cm")];
    for (let at = 0; at < 6; at++) {
      const paint = chance(0.2) ? "url(#rs) #0072b2" : pick(COLORS);
      defs.push(MARKER(`m${at}`, pick(TIP_SHAPES), pick(TIP_SIZES), pick(TIP_ENDS), paint, chance(0.3) ? 0.5 : 1));
    }
    const line = (chain: string[]): string => {
      const id = `o${String(lines.length + 1).padStart(2, "0")}`;
      lines.push(id);
      above.set(id, chain);
      const y = 10 * lines.length;
      let attrs = "";
      if (chance(0.6)) attrs += ` stroke="${pick(STROKES)}"`;
      if (chance(0.25)) attrs += ` stroke-opacity="${pick(["0.5", "0.25", "1", "0.3333"])}"`;
      if (chance(0.5)) attrs += ` marker-end="url(#${pick(MARKERS)})"`;
      if (chance(0.4)) attrs += ` marker-start="url(#${pick(MARKERS)})"`;
      switch (rng.below(5)) {
        case 0:
        case 1:
          return `<line id="${id}" x1="0" y1="${y}" x2="${30 + 10 * (lines.length % 7)}" y2="${y}" stroke-width="2"${attrs}/>`;
        case 2:
          return `<polyline id="${id}" points="0,${y} 20,${y + 5} 40,${y}" fill="none" stroke-width="2"${attrs}/>`;
        case 3:
          return `<path id="${id}" d="M0 ${y} L30 ${y + 4} L60 ${y}${chance(0.3) ? " Z" : ""}" fill="none" stroke-width="2"${attrs}/>`;
        default:
          return `<polygon id="${id}" points="0,${y} 20,${y + 5} 40,${y}" fill="none" stroke-width="2"${attrs}/>`;
      }
    };
    const group = (id: string, inner: () => string): string => {
      const stroke = chance(0.7) ? ` stroke="${pick(STROKES)}"` : "";
      const opacity = chance(0.25) ? ` stroke-opacity="${pick(["0.5", "1"])}"` : "";
      return `<g id="${id}"${stroke}${opacity}>${inner()}</g>`;
    };
    let body = line(["l1"]) + line(["l1"]) + line(["l1"]);
    body += group("g1", () => line(["g1", "l1"]) + line(["g1", "l1"]) + group("g2", () => line(["g2", "g1", "l1"]) + line(["g2", "g1", "l1"])));
    body += group("g3", () => line(["g3", "l1"]));
    const locked = `<g id="l2" fub:layer="Bloccato" fub:locked="true">${line(["l2"])}${line(["l2"])}</g>`;
    return { source: doc(DEFS(...defs) + LAYER + body + "</g>" + locked), lines, above };
  }

  /// Il colore che deve avere la punta di una linea col contorno `stroke`,
  /// dove si dice senza leggere la sfumatura: `null` se non si dice.
  function expected(opened: Opened, stroke: string): string | null {
    if (stroke === "none" || /^#[0-9a-f]{6}$/.test(stroke)) return stroke;
    if (stroke === "red") return "#ff0000";
    if (stroke === "#abc") return "#aabbcc";
    const swatch = /^url\(#(rs|rt)\)/.exec(stroke)?.[1];
    if (swatch === undefined) return null;
    const color = new RegExp(`<linearGradient id="${swatch}"[^>]*>\\s*<stop[^>]*stop-color="(#[0-9a-f]{6})"`).exec(opened.engine.text)?.[1];
    return color === undefined ? null : `url(#${swatch}) ${color}`;
  }

  /// Ogni riferimento a un marcatore c'è, il seguito non ha niente da fare, e
  /// ogni punta della raccolta fuori dal livello bloccato ha il colore e
  /// l'opacità del contorno della sua linea.
  function check(opened: Opened, lines: readonly string[], above: ReadonlyMap<string, string[]>): void {
    const present = everyId(opened);
    for (const match of opened.engine.text.matchAll(/marker-(?:start|mid|end)="url\(#([^)]+)\)"/g)) expect(present.has(match[1]!), match[1]).toBe(true);
    settled(opened);
    const seen = (line: string, name: string): string | undefined => {
      for (const id of [line, ...above.get(line)!]) {
        const node = opened.engine.holder(id);
        const value = node === null ? undefined : plainAttributes(node).get(name);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    for (const line of lines) {
      const node = opened.engine.holder(line);
      if (node === null || above.get(line)!.includes("l2") || !["line", "polyline", "path"].includes(node.details?.role ?? "")) continue;
      for (const end of TIP_ENDS) {
        const tip = shown(opened, line, end);
        if (tip === null) continue;
        const stroke = (seen(line, "stroke") ?? "none").trim();
        const paint = expected(opened, stroke);
        if (paint === null) continue;
        expect([line, end, tip.end, tip.paint, tip.opacity]).toEqual([line, end, end, paint, stroke === "none" ? 1 : Number(Number(seen(line, "stroke-opacity") ?? "1").toFixed(4))]);
      }
    }
  }

  it("le punte restano del colore della linea, il motore non rifiuta il seguito, e un annulla torna al byte", () => {
    let applied = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new Mulberry32(seed);
      const pick = <T,>(list: readonly T[]): T => list[rng.below(list.length)]!;
      const { source, lines, above } = drawing(rng);
      const opened = followed(source, seed % 2 === 0);
      // Un primo passo tocca tutte le linee libere, e il seguito le mette a posto.
      const settle = lines.filter((line) => !above.get(line)!.includes("l2")).map((id): Op => ({ op: "set", id, attrs: { "stroke-linecap": "butt" } }));
      expect(opened.engine.apply({ op: "batch", ops: settle }).outcome).toBe("applied");
      check(opened, lines, above);
      for (let at = 0; at < 25; at++) {
        const line = pick(lines);
        const target = pick([line, line, line, "g1", "g2", "g3"]);
        let op: Op | null;
        switch (rng.below(10)) {
          case 0:
          case 1:
            op = { op: "set", id: target, attrs: { stroke: rng.below(10) === 0 ? null : rng.below(10) === 0 ? pick(WRONG) : pick(STROKES) } };
            break;
          case 2:
            op = { op: "set", id: target, attrs: { "stroke-opacity": rng.below(3) === 0 ? null : pick(["0.5", "0.25", "1", "0.6667"]) } };
            break;
          case 3:
            op = { op: "set", id: line, attrs: { [`marker-${pick(TIP_ENDS)}`]: rng.below(3) === 0 ? null : `url(#${pick(MARKERS)})` } };
            break;
          case 4:
          case 5: {
            const units = opened.reindex().units.filter(() => rng.below(2) === 0);
            const change = pick<TipChange>([
              { end: pick(TIP_ENDS), shape: pick(TIP_SHAPES) },
              { end: pick(TIP_ENDS), shape: "none" },
              { end: pick(TIP_ENDS), size: pick(TIP_SIZES) },
              { swap: true },
            ]);
            op = gesture(tipped(opened, change, units).ops);
            break;
          }
          case 6:
            op = gesture(recolorSwatchOps(opened.engine.model!, pick(["rs", "rt"]), pick(COLORS), opened.reindex().units, ids(opened)).ops);
            break;
          case 7:
            op = { op: "set", id: "rg", attrs: { x2: pick(["20", "50", "100", "200"]) } };
            break;
          case 8:
            op = { op: "set", id: target, attrs: { transform: pick(["translate(5 5)", "rotate(30)", null]) } };
            break;
          default:
            op = { op: "set", id: pick(["l1", "l2"]), attrs: { "fub:locked": rng.below(2) === 0 ? "true" : null } };
        }
        if (op === null) continue;
        const before = opened.engine.text;
        const outcome = opened.engine.apply(op);
        if (outcome.outcome !== "applied") {
          expect(opened.engine.text).toBe(before);
          continue;
        }
        applied++;
        const after = opened.engine.text;
        const back = opened.engine.undo(outcome.undo);
        expect([back.outcome, opened.engine.text === before]).toEqual(["applied", true]);
        const again = opened.engine.undo(back.outcome === "applied" ? back.undo : outcome.undo);
        expect([again.outcome, opened.engine.text === after]).toEqual(["applied", true]);
        expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
        check(opened, lines, above);
      }
    }
    // Il caso deve arrivare a operazioni vere, non soltanto rifiutate.
    expect(applied).toBeGreaterThan(600);
  });
});

// ---------------------------------------------------------------------------
// Mille linee.
// ---------------------------------------------------------------------------

describe("mille linee", () => {
  const COUNT = 1000;
  const COLORS = [RED, BLUE, PINK, "#009e73"];

  /// Mille linee, ognuna di un colore su quattro, con una punta di fine e a metà con una d'inizio.
  function thousand(match = true): Opened {
    const markers: string[] = [];
    COLORS.forEach((color, at) => {
      markers.push(MARKER(`me${at}`, "triangle", "medium", "end", match ? color : "#000000"), MARKER(`ms${at}`, "vee", "small", "start", match ? color : "#000000"));
    });
    let body = "";
    for (let i = 0; i < COUNT; i++) {
      body += `<line id="l${String(i).padStart(4, "0")}" x1="0" y1="${i}" x2="50" y2="${i}" stroke="${COLORS[i % 4]}" stroke-width="2"${ENDS(i % 2 === 0 ? `ms${i % 4}` : null, `me${i % 4}`)}/>`;
    }
    return open(doc(DEFS(...markers) + LAYER + body + "</g>"));
  }

  /// Il tempo tipico di `run`: la mediana di cinque prove dopo una di prova.
  function median(run: () => void): number {
    run();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      run();
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    return runs[2]!;
  }

  it("si leggono in meno di un fotogramma", () => {
    const opened = thousand();
    const units = opened.index.units;
    expect(units).toHaveLength(COUNT);
    const look = tipsLookOf(opened.engine.model!, units);
    expect(look).toEqual({ count: COUNT, start: { shape: null, size: "small" }, end: { shape: "triangle", size: "medium" } });
    expect(median(() => void tipsLookOf(opened.engine.model!, units))).toBeLessThan(16);
  });

  it("si tengono del colore della linea, di colpo, in meno di un fotogramma, e il seguito aggiunge i marcatori una volta sola", () => {
    const opened = thousand(false);
    const touched = everyId(opened);
    const model = opened.engine.model!;
    const find = (id: string) => opened.engine.holder(id);
    const op = followTips(model, touched, ids(opened), find)!;
    expect(op).not.toBeNull();
    // Quattro colori in fondo; in testa solo due, perché le linee pari sono quelle dei colori 0 e 2.
    expect(adds(op)).toHaveLength(6);
    expect(sets(op)).toHaveLength(COUNT);
    expect(median(() => void followTips(model, touched, ids(opened), find))).toBeLessThan(16);
    expect(median(() => void followTips(model, touched, ids(opened)))).toBeLessThan(16);
  });

  it("e quando sono già a posto, il seguito non trova niente da fare, subito", () => {
    const opened = thousand();
    const touched = everyId(opened);
    const model = opened.engine.model!;
    expect(followTips(model, touched, ids(opened), (id) => opened.engine.holder(id))).toBeNull();
    expect(median(() => void followTips(model, touched, ids(opened), (id) => opened.engine.holder(id)))).toBeLessThan(16);
    expect(median(() => void followTips(model, touched, ids(opened)))).toBeLessThan(16);
  });

  it("si cambiano insieme in meno di un fotogramma, con un marcatore per colore", () => {
    const opened = thousand();
    const units = opened.index.units;
    const model = opened.engine.model!;
    const made = tipOps(model, units, { end: "end", shape: "diamond" }, ids(opened));
    expect(made.changed).toBe(COUNT);
    expect(adds(made.ops)).toHaveLength(4);
    expect(median(() => void tipOps(model, units, { end: "end", shape: "diamond" }, ids(opened)))).toBeLessThan(16);
    expect(median(() => void tipOps(model, units, { swap: true }, ids(opened)))).toBeLessThan(16);
    expect(tipOps(model, units, { end: "end", shape: "none" }, ids(opened)).changed).toBe(COUNT);
  });

  it("e il motore le accetta in un passo solo, e un annulla le riporta al byte", () => {
    const opened = thousand();
    const made = tipped(opened, { end: "end", shape: "circle" });
    const text = applied(opened, made.ops);
    expect(text.match(/fub:marker="circle medium end"/g)).toHaveLength(4);
    expect(looks(opened).end).toEqual({ shape: "circle", size: "medium" });
  });
});
