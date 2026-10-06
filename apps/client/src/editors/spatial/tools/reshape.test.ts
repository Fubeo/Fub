// Le forme coi parametri: ciò che il pannello ne legge, le operazioni dei
// suoi campi, che il motore accetta e che un annulla disfa al byte, e la
// maniglia degli angoli.

import { describe, expect, it } from "vitest";
import { polygonalAttrs, readPolygonal, type PolygonalShape } from "../scene/parametric";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import type { Unit } from "./hit";
import { cornerAttrs, cornerCursor, cornerDrag, cornerGrip, cornerSpot, shapeFacts, shapeOps, toolFacts, toolWith, type ShapeChange } from "./reshape";
import { POLYGON_TOOL } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Un poligono o una stella con `fub:geom` `geom`, col suo `d`.
function shape(id: string, kind: PolygonalShape, geom: string, extra = ""): string {
  const attrs = polygonalAttrs(readPolygonal(kind, geom)!)!;
  return `<path id="${id}" fub:shape="${kind}" fub:geom="${attrs["fub:geom"]}" d="${attrs.d}" fill="none" stroke="#000000" stroke-width="2"${extra}/>`;
}

const HEX = shape("ohex", "polygon", "0 0 50 6 0 0");
const STAR = shape("ostar", "star", "200 0 40 5 0.382 0 0");
const RECT = '<rect id="orect" x="10" y="20" width="100" height="40" rx="4" fill="none" stroke="#000000"/>';
const ELLIPSE = '<ellipse id="oellipse" cx="0" cy="200" rx="30" ry="20" fill="none" stroke="#000000"/>';

/// Il disegno con `body` nel livello.
const opened = (body: string): Opened => open(doc(`${LAYER}${body}</g>`));

/// Gli oggetti di id `wanted`.
function units(at: Opened, ...wanted: string[]): Unit[] {
  return wanted.map((id) => {
    const unit = at.index.units.find((each) => each.id === id);
    if (unit === undefined) throw new Error(`nessun oggetto ${id}`);
    return unit;
  });
}

/// Applica `change` a `wanted`, verifica che un annulla riporti il testo di
/// prima, e torna il testo di dopo.
function changed(at: Opened, change: ShapeChange, ...wanted: string[]): string {
  const reshaped = shapeOps(at.engine.model!, units(at, ...wanted), change, ids(at), POLYGON_TOOL);
  const before = at.engine.text;
  const outcome = at.engine.apply(gesture(reshaped.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = at.engine.text;
  expect(at.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(at.engine.text).toBe(before);
  return after;
}

describe("ciò che il pannello legge", () => {
  it("dice forma, lati e rapporto quando sono gli stessi, e altrimenti che sono misti", () => {
    const at = opened(HEX + STAR + RECT + ELLIPSE);
    expect(shapeFacts(at.engine.model!, units(at, "ohex"))).toEqual({
      shape: { count: 1, value: "polygon" },
      count: { count: 1, value: 6 },
      ratio: { count: 0, value: null },
      corner: { count: 1, value: 0 },
    });
    expect(shapeFacts(at.engine.model!, units(at, "ohex", "ostar", "orect"))).toEqual({
      shape: { count: 2, value: null },
      count: { count: 2, value: null },
      ratio: { count: 1, value: 0.382 },
      corner: { count: 3, value: null },
    });
    // Un'ellisse non ha niente di questo.
    expect(shapeFacts(at.engine.model!, units(at, "oellipse"))).toBeNull();
  });

  it("misura gli angoli nella scena, e due raggi diversi di un rettangolo non sono un raggio solo", () => {
    const at = opened(
      shape("obig", "polygon", "0 0 50 6 0 3", ' transform="scale(2)"') +
        '<rect id="oy" x="0" y="0" width="10" height="10" ry="2.5"/>' +
        '<rect id="oxy" x="0" y="0" width="10" height="10" rx="1" ry="2"/>',
    );
    expect(shapeFacts(at.engine.model!, units(at, "obig"))!.corner).toEqual({ count: 1, value: 6 });
    // Un raggio solo vale per tutti e due.
    expect(shapeFacts(at.engine.model!, units(at, "oy"))!.corner).toEqual({ count: 1, value: 2.5 });
    expect(shapeFacts(at.engine.model!, units(at, "oxy"))!.corner).toEqual({ count: 1, value: null });
    expect(shapeFacts(at.engine.model!, units(at, "oxy"))!.shape).toEqual({ count: 0, value: null });
  });

  it("mostra lo strumento Poligono, e lo cambia entro i suoi limiti", () => {
    expect(toolFacts(POLYGON_TOOL)).toEqual({
      shape: { count: 1, value: "polygon" },
      count: { count: 1, value: 6 },
      ratio: { count: 0, value: null },
      corner: { count: 1, value: 0 },
    });
    const star = toolWith(POLYGON_TOOL, { shape: "star" });
    expect(toolFacts(star).count.value).toBe(5);
    expect(toolFacts(star).ratio.value).toBe(0.382);
    expect(toolWith(star, { count: 9 })).toEqual({ ...star, points: 9 });
    expect(toolWith(star, { ratio: 0 }).ratio).toBe(0.01);
    expect(toolWith(star, { ratio: 3 }).ratio).toBe(1);
    expect(toolWith(star, { corner: -2 }).corner).toBe(0);
  });
});

describe("i cambi della forma", () => {
  it("riscrivono `fub:geom` e `d`, e un annulla torna al byte", () => {
    const at = opened(HEX);
    const after = changed(at, { count: 8 }, "ohex");
    const eight = polygonalAttrs(readPolygonal("polygon", "0 0 50 8 0 0")!)!;
    expect(after).toContain(`fub:geom="0 0 50 8 0 0" d="${eight.d}"`);
  });

  it("passano dal poligono alla stella col rapporto dello strumento, e ritorno", () => {
    const at = opened(HEX + STAR);
    const star = polygonalAttrs(readPolygonal("star", "0 0 50 6 0.382 0 0")!)!;
    expect(changed(at, { shape: "star" }, "ohex")).toContain(`<path id="ohex" fub:shape="star" fub:geom="0 0 50 6 0.382 0 0" d="${star.d}"`);
    expect(changed(at, { shape: "polygon" }, "ostar")).toContain('<path id="ostar" fub:shape="polygon" fub:geom="200 0 40 5 0 0"');
    // Già così: niente da scrivere.
    expect(shapeOps(at.engine.model!, units(at, "ohex"), { shape: "polygon" }, ids(at), POLYGON_TOOL).ops).toEqual([]);
    // Il rapporto è soltanto delle stelle.
    expect(shapeOps(at.engine.model!, units(at, "ohex"), { ratio: 0.5 }, ids(at), POLYGON_TOOL).ops).toEqual([]);
    expect(changed(at, { ratio: 0.5 }, "ostar")).toContain('fub:geom="200 0 40 5 0.5 0 0"');
  });

  it("scrivono il raggio degli angoli diviso per la scala dell'oggetto", () => {
    const at = opened(shape("obig", "polygon", "0 0 50 6 0 0", ' transform="scale(2)"'));
    expect(changed(at, { corner: 6 }, "obig")).toContain('fub:geom="0 0 50 6 0 3"');
  });

  it("danno a un rettangolo `rx`, tolgono `ry`, e con zero li tolgono tutti e due", () => {
    const at = opened('<rect id="orect" x="0" y="0" width="100" height="40" rx="4" ry="6"/>');
    expect(changed(at, { corner: 5 }, "orect")).toContain('<rect id="orect" x="0" y="0" width="100" height="40" rx="5"/>');
    expect(changed(at, { corner: 0 }, "orect")).toContain('<rect id="orect" x="0" y="0" width="100" height="40"/>');
    const same = opened('<rect id="orect" x="0" y="0" width="100" height="40" rx="5"/>');
    expect(shapeOps(same.engine.model!, units(same, "orect"), { corner: 5 }, ids(same), POLYGON_TOOL).ops).toEqual([]);
  });

  it("cambiano soltanto gli oggetti che ne hanno, e lo contano", () => {
    const at = opened(HEX + RECT + ELLIPSE);
    const reshaped = shapeOps(at.engine.model!, units(at, "ohex", "orect", "oellipse"), { corner: 2 }, ids(at), POLYGON_TOOL);
    expect(reshaped.changed).toBe(2);
    expect(reshaped.keys).toEqual(["ohex", "orect", "oellipse"]);
    const after = changed(at, { corner: 2 }, "ohex", "orect", "oellipse");
    expect(after).toContain('fub:geom="0 0 50 6 0 2"');
    expect(after).toContain('rx="2"');
    expect(after).toContain(ELLIPSE);
  });
});

describe("la maniglia degli angoli", () => {
  const H = Math.SQRT1_2;
  const IDENTITY = [1, 0, 0, 1, 0, 0] as const;

  it("sta sull'angolo in alto a sinistra di un rettangolo, anche ruotato", () => {
    const at = opened(RECT);
    const [rect] = units(at, "orect");
    const grip = cornerGrip(rect!.node, rect!.role, IDENTITY)!;
    expect(grip).toEqual({ vertex: [10, 20], inward: [H, H], reach: Math.SQRT2, max: 20, radius: 4 });
    // Capovolto, in alto a sinistra sullo schermo c'è l'angolo opposto.
    const turned = cornerGrip(rect!.node, rect!.role, [-1, 0, 0, -1, 0, 0])!;
    expect(turned.vertex).toEqual([110, 60]);
    expect(turned.inward).toEqual([-H, -H]);
    // Un raggio che non entra si vede ridotto.
    const big = opened('<rect id="orect" x="0" y="0" width="10" height="40" rx="30"/>');
    const [wide] = units(big, "orect");
    expect(cornerGrip(wide!.node, wide!.role, IDENTITY)!.radius).toBe(5);
  });

  it("sta sul vertice più in alto di un poligono, e su una punta della stella", () => {
    const at = opened(HEX + STAR + ELLIPSE);
    const [hex, star, ellipse] = units(at, "ohex", "ostar", "oellipse");
    const grip = cornerGrip(hex!.node, hex!.role, IDENTITY)!;
    // Due vertici in alto: quello a sinistra.
    expect(grip.vertex[0]).toBeCloseTo(-25, 9);
    expect(grip.vertex[1]).toBeCloseTo(-43.30127, 4);
    expect(grip.inward[0]).toBeCloseTo(0.5, 9);
    expect(grip.inward[1]).toBeCloseTo(Math.sqrt(3) / 2, 9);
    expect(grip.reach).toBeCloseTo(2 / Math.sqrt(3), 9);
    // Gli archi si toccano a metà lato: 25 · tan 60°.
    expect(grip.max).toBeCloseTo(25 * Math.sqrt(3), 9);
    expect(grip.radius).toBe(0);
    const tip = cornerGrip(star!.node, star!.role, IDENTITY)!;
    expect(tip.vertex[0]).toBeCloseTo(200, 9);
    expect(tip.vertex[1]).toBeCloseTo(-40, 9);
    expect(tip.inward[0]).toBeCloseTo(0, 9);
    expect(tip.inward[1]).toBeCloseTo(1, 9);
    expect(cornerGrip(ellipse!.node, ellipse!.role, IDENTITY)).toBeNull();
  });

  it("scorre lungo la bisettrice quanto il puntatore che la tira, fra zero e il raggio più grande", () => {
    const grip = { vertex: [10, 20] as const, inward: [H, H] as const, reach: Math.SQRT2, max: 20, radius: 4 };
    const spot = cornerSpot(grip, IDENTITY, 4, 5);
    const along = 5 + 4 * Math.SQRT2;
    expect(spot[0]).toBeCloseTo(10 + along * H, 9);
    expect(spot[1]).toBeCloseTo(20 + along * H, 9);
    // Tirata di 3√2 in diagonale, il raggio cresce di 3 e la maniglia di 3√2.
    expect(cornerDrag(grip, [0, 0], [3, 3], 4)).toBeCloseTo(7, 9);
    const moved = cornerSpot(grip, IDENTITY, 7, 5);
    expect(Math.hypot(moved[0] - spot[0], moved[1] - spot[1])).toBeCloseTo(3 * Math.SQRT2, 9);
    // Di traverso non cambia niente; oltre i limiti si ferma.
    expect(cornerDrag(grip, [0, 0], [5, -5], 4)).toBeCloseTo(4, 9);
    expect(cornerDrag(grip, [0, 0], [-50, -50], 4)).toBe(0);
    expect(cornerDrag(grip, [0, 0], [50, 50], 4)).toBe(20);
    // Nella scena la segue la matrice dell'oggetto.
    expect(cornerSpot(grip, [2, 0, 0, 2, 100, 0], 0, 5)).toEqual([100 + 2 * (10 + 5 * H), 2 * (20 + 5 * H)]);
  });

  it("ha il cursore della sua direzione sullo schermo", () => {
    const grip = { vertex: [0, 0] as const, inward: [H, H] as const, reach: Math.SQRT2, max: 20, radius: 0 };
    expect(cornerCursor(grip, IDENTITY)).toBe("nwse");
    expect(cornerCursor(grip, [0, 1, -1, 0, 0, 0])).toBe("nesw");
    expect(cornerCursor({ ...grip, inward: [0, 1] }, IDENTITY)).toBe("ns");
    expect(cornerCursor({ ...grip, inward: [-1, 0] }, IDENTITY)).toBe("ew");
  });

  it("scrive il raggio nelle coordinate dell'oggetto, come l'anteprima lo mostra", () => {
    const at = opened(HEX + RECT);
    const [hex, rect] = units(at, "ohex", "orect");
    const rounded = polygonalAttrs(readPolygonal("polygon", "0 0 50 6 0 5")!)!;
    expect(cornerAttrs(hex!.node, hex!.role, 5)).toEqual({ "fub:geom": "0 0 50 6 0 5", d: rounded.d });
    expect(cornerAttrs(hex!.node, hex!.role, 0)).toBeNull();
    expect(cornerAttrs(rect!.node, rect!.role, 7.256)).toEqual({ rx: "7.26" });
  });
});
