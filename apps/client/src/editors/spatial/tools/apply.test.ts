// «Applica trasformazione»: ogni forma prende ciò che sa scrivere della sua
// trasformazione, il contorno scala con lei, i gruppi passano la loro ai
// figli, e ciò che si vede resta. Le operazioni il motore le accetta così
// come sono, e un annulla le disfa al byte.

import { describe, expect, it } from "vitest";
import { parseBrush } from "../ink/brush";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import { parsePath, type Bounds } from "../scene/geometry";
import { apply, toRadians, type Matrix } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { applyOps, type Applied } from "./apply";
import { gesture, NewIds } from "./edit";
import type { SceneIndex } from "./hit";
import { polygonalAttrs, polygonalPath, readPolygonal, type PolygonalShape } from "../scene/parametric";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const STROKE = 'fill="none" stroke="#000000" stroke-width="1"';
const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

/// Applica la trasformazione di tutti gli oggetti del disegno.
function applied(opened: Opened, keys?: readonly string[]): Applied {
  const units = keys === undefined ? opened.index.units : keys.map((key) => opened.index.get(key)!);
  return applyOps(opened.engine.model!, units, ids(opened));
}

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: Applied): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

/// Il riquadro di ogni oggetto nella scena, senza contorno e con.
function looks(index: SceneIndex): Map<string, readonly [Bounds | null, Bounds | null]> {
  return new Map(index.units.map((unit) => [unit.key, [unit.geometry, unit.bounds] as const]));
}

/// Verifica che ogni oggetto stia dov'era, entro `tolerance`; `outlines`
/// confronta anche i riquadri col contorno.
function sameLook(before: SceneIndex, after: SceneIndex, tolerance = 0.02, outlines = true): void {
  const then = looks(before);
  for (const [key, [geometry, bounds]] of looks(after)) {
    const [was, wasOutlined] = then.get(key)!;
    const near = (a: Bounds | null, b: Bounds | null): void => {
      expect(a === null).toBe(b === null);
      if (a === null || b === null) return;
      [...a.min, ...a.max].forEach((value, at) => expect(Math.abs(value - [...b.min, ...b.max][at]!)).toBeLessThanOrEqual(tolerance));
    };
    near(geometry, was);
    if (outlines) near(bounds, wasOutlined);
  }
}

/// Quanto si confronta ciò che si vede prima e dopo: tutto, la geometria
/// senza il contorno, o niente.
type Look = "all" | "geometry" | "none";

/// Applica e scrive, verificando che ciò che si vede resti.
function bake(source: string, look: Look = "all"): { text: string; change: Applied } {
  const opened = open(doc(`${LAYER}${source}</g>`));
  const change = applied(opened);
  const text = written(opened, change);
  if (look !== "none") sameLook(opened.index, opened.reindex(), 0.02, look === "all");
  return { text, change };
}

describe("«Applica trasformazione» nelle forme che prendono tutto", () => {
  it("riscrive percorsi, linee, spezzate e poligoni, e toglie la trasformazione", () => {
    const { text, change } = bake(
      `<path id="p" d="M0 0 L10 0 Q10 10 20 10 C20 20 30 20 30 30 A5 5 0 0 1 40 30 Z" ${STROKE} transform="translate(5 5) scale(2)"/>`
        + `<line id="ln" x1="0" y1="0" x2="10" y2="0" ${STROKE} transform="rotate(90)"/>`
        + `<polyline id="pl" points="0,0 10,0 10,10" ${STROKE} transform="translate(1 2)"/>`
        + `<polygon id="pg" points="0,0 10,0 10,10" ${STROKE} transform="scale(-1 1)"/>`,
    );
    expect(text).toContain('<path id="p" d="M5 5 L25 5 Q25 25 45 25 C45 45 65 45 65 65 A10 10 0 0 1 85 65 Z" fill="none" stroke="#000000" stroke-width="2"/>');
    expect(text).toContain(`<line id="ln" x1="0" y1="0" x2="0" y2="10" ${STROKE}/>`);
    expect(text).toContain(`<polyline id="pl" points="1,2 11,2 11,12" ${STROKE}/>`);
    expect(text).toContain(`<polygon id="pg" points="0,0 -10,0 -10,10" ${STROKE}/>`);
    expect(change).toMatchObject({ changed: 4, kept: 0, keys: ["p", "ln", "pl", "pg"] });
  });

  it("gira, scala e ribalta gli archi", () => {
    const arc = (transform: string): string => {
      const { text } = bake(`<path id="a" d="M-20 0 A20 10 0 0 1 20 0" ${STROKE} transform="${transform}"/>`, "geometry");
      return /<path id="a" d="([^"]*)"/.exec(text)![1]!;
    };
    expect(arc("rotate(90)")).toBe("M0 -20 A20 10 90 0 1 0 20");
    // Un ribaltamento inverte il verso.
    expect(arc("scale(-1 1)")).toBe("M20 0 A20 10 0 0 0 -20 0");
    // Una scala che rende l'ellisse un cerchio la lascia senza rotazione.
    expect(arc("scale(1 2)")).toBe("M-20 0 A20 20 0 0 1 20 0");
    expect(arc("scale(0.5 2)")).toBe("M-10 0 A20 10 90 0 1 10 0");
    // La rotazione sta fra 0 e 180 gradi, e un cerchio non ne ha.
    expect(arc("rotate(-90)")).toBe("M0 20 A20 10 90 0 1 0 -20");
    expect(arc("rotate(-0.004)")).toBe("M-20 0 A20 10 0 0 1 20 0");
    // Gli estremi scritti con due decimali sono un poco più vicini: i raggi
    // si scrivono appena più piccoli, e SVG li riporta alla misura giusta
    // col centro nel mezzo, invece di spostarlo di lato.
    expect(arc("rotate(45) scale(1 2)")).toBe("M-14.14 -14.14 A19.99 19.99 0 0 1 14.14 14.14");
  });

  it("tengono un cerchio fatto di due metà dov'era, e un quarto di cerchio coi suoi raggi", () => {
    // Senza raggi più piccoli, il centro di ogni metà scapperebbe di lato di
    // quasi un'unità.
    const { text } = bake(`<path id="a" d="M-100 0 A100 100 0 0 1 100 0 A100 100 0 0 1 -100 0 Z" ${STROKE} transform="rotate(45)"/>`);
    expect(text).toContain('d="M-70.71 -70.71 A99.99 99.99 0 0 1 70.71 70.71 A99.99 99.99 0 0 1 -70.71 -70.71 Z"');
    // Dopo una chiusura, l'arco parte dall'inizio del suo percorso.
    const closed = bake(`<path id="a" d="M-100 0 L0 -100 Z A100 100 0 0 1 100 0" ${STROKE} transform="rotate(45)"/>`).text;
    expect(closed).toContain('d="M-70.71 -70.71 L70.71 -70.71 Z A99.99 99.99 0 0 1 70.71 70.71"');
    expect(bake(`<path id="a" d="M0 0 A20 20 0 0 1 20 20" ${STROKE} transform="rotate(45)"/>`).text).toContain('d="M0 0 A20 20 0 0 1 0 28.28"');
  });

  it("portano un'ellisse inclinata sull'ellisse giusta", () => {
    const m: Matrix = [1, 0.5, 0.3, 1.2, 0, 0];
    const { text } = bake(`<path id="a" d="M-20 0 A20 10 0 0 1 20 0 A20 10 0 0 1 -20 0 Z" ${STROKE} transform="matrix(${m.join(" ")})"/>`, "geometry");
    const segments = parsePath(/<path id="a" d="([^"]*)"/.exec(text)![1]!)!;
    const arc = segments[1]!;
    if (arc.kind !== "arc") throw new Error("non è un arco");
    const [rx, ry] = arc.radii;
    const turn = toRadians(arc.rotation);
    // Ogni punto dell'ellisse di prima, trasformato, sta sulla nuova.
    for (let step = 0; step < 16; step++) {
      const t = (step / 16) * 2 * Math.PI;
      const [x, y] = apply(m, [20 * Math.cos(t), 10 * Math.sin(t)]);
      const u = x * Math.cos(turn) + y * Math.sin(turn);
      const v = -x * Math.sin(turn) + y * Math.cos(turn);
      expect((u / rx) ** 2 + (v / ry) ** 2).toBeCloseTo(1, 2);
    }
  });

  it("disegnano un arco con un raggio nullo come una linea, come SVG", () => {
    const { text } = bake(`<path id="a" d="M0 0 A0 10 0 0 1 20 0" ${STROKE} transform="scale(2)"/>`);
    expect(text).toContain('d="M0 0 L40 0"');
    // Un arco minuscolo non perde i raggi per scriverli più piccoli.
    const tiny = bake(`<path id="a" d="M-0.6 0 A0.5 0.5 0 0 1 0.4 0" fill="#000000" transform="scale(0.01)"/>`).text;
    expect(tiny).toContain('d="M-0.01 0 A0.01 0.01 0 0 1 0 0"');
  });

  it("riscrivono una freccia con la punta della sua regola", () => {
    const arrow = (transform: string): string =>
      `<path id="f" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="#000000" stroke-width="2" transform="${transform}"/>`;
    expect(bake(arrow("rotate(90)")).text).toContain(
      `<path id="f" fub:shape="arrow" fub:geom="0 0 0 100" d="${arrowPath(0, 0, 0, 100, 2)}" fill="none" stroke="#000000" stroke-width="2"/>`,
    );
    // Senza spessore la punta è quella dello spessore iniziale.
    const thin = `<path id="f" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 1)}" fill="none" stroke="#000000" transform="rotate(90)"/>`;
    expect(bake(thin).text).toContain(`d="${arrowPath(0, 0, 0, 100, 1)}"`);
    // Lo spessore raddoppia, e la punta è quella della regola per uno
    // spessore doppio: più corta di quella che si vedeva, ingrandita.
    expect(bake(arrow("scale(2)"), "none").text).toContain(
      `<path id="f" fub:shape="arrow" fub:geom="0 0 200 0" d="${arrowPath(0, 0, 200, 0, 4)}" fill="none" stroke="#000000" stroke-width="4"/>`,
    );
  });
});

describe("«Applica trasformazione» nelle forme che prendono una parte", () => {
  it("raddrizza un rettangolo girato di un quarto di giro, raggi compresi", () => {
    const { text, change } = bake(`<rect id="r" x="1" y="2" width="20" height="10" rx="2" ${STROKE} transform="translate(5 5) rotate(90) scale(2)"/>`);
    expect(text).toContain('<rect id="r" x="-19" y="7" width="20" height="40" rx="4" fill="none" stroke="#000000" stroke-width="2"/>');
    expect(change.kept).toBe(0);
  });

  it("scala i raggi degli angoli, e ne scrive uno solo se sono uguali", () => {
    expect(bake(`<rect id="r" x="0" y="0" width="20" height="20" rx="2" ${STROKE} transform="scale(2 1)"/>`, "geometry").text).toContain(
      '<rect id="r" x="0" y="0" width="40" height="20" rx="4" ry="2" fill="none" stroke="#000000" stroke-width="1.41"/>',
    );
    expect(bake(`<rect id="r" x="0" y="0" width="20" height="20" rx="1" ry="2" ${STROKE} transform="scale(2 1)"/>`, "geometry").text).toContain(
      '<rect id="r" x="0" y="0" width="40" height="20" rx="2" fill="none" stroke="#000000" stroke-width="1.41"/>',
    );
  });

  it("con il tratteggio tiene il quarto di giro, perché il tratteggio comincerebbe altrove", () => {
    const { text, change } = bake(
      `<rect id="r" x="1" y="2" width="20" height="10" ${STROKE} stroke-dasharray="4 2" transform="translate(5 5) rotate(90) scale(2)"/>`,
    );
    expect(text).toContain(
      '<rect id="r" x="7" y="-1" width="40" height="20" fill="none" stroke="#000000" stroke-width="2" stroke-dasharray="8 4" transform="matrix(0 1 -1 0 0 0)"/>',
    );
    expect(change.kept).toBe(1);
  });

  it("prende la scala lungo gli assi e lascia la rotazione, senza traslazione", () => {
    const { text } = bake(`<rect id="r" x="0" y="0" width="10" height="10" ${STROKE} transform="translate(7 3) rotate(30) scale(2 3)"/>`, "geometry");
    // La traslazione passa in x e y, nelle coordinate girate.
    const [x, y] = apply([Math.cos(toRadians(-30)), Math.sin(toRadians(-30)), -Math.sin(toRadians(-30)), Math.cos(toRadians(-30)), 0, 0], [7, 3]);
    expect(text).toContain(
      `<rect id="r" x="${x.toFixed(2).replace(/\.?0+$/, "")}" y="${y.toFixed(2).replace(/\.?0+$/, "")}" width="20" height="30" fill="none" stroke="#000000" stroke-width="2.45" transform="matrix(0.866 0.5 -0.5 0.866 0 0)"/>`,
    );
  });

  it("ribalta ellissi e cerchi senza tratteggio, e con il tratteggio tiene il ribaltamento", () => {
    expect(bake(`<ellipse id="e" cx="10" cy="5" rx="4" ry="2" ${STROKE} transform="scale(-1 1)"/>`).text).toContain(
      `<ellipse id="e" cx="-10" cy="5" rx="4" ry="2" ${STROKE}/>`,
    );
    expect(bake(`<ellipse id="e" cx="10" cy="5" rx="4" ry="2" ${STROKE} stroke-dasharray="1 1" transform="scale(-1 1)"/>`).text).toContain(
      `<ellipse id="e" cx="10" cy="5" rx="4" ry="2" ${STROKE} stroke-dasharray="1 1" transform="matrix(-1 0 0 1 0 0)"/>`,
    );
    // Un cerchio prende rotazione e scala, se non ha tratteggio.
    expect(bake(`<circle id="c" cx="10" cy="0" r="3" ${STROKE} transform="rotate(90) scale(2)"/>`).text).toContain(
      '<circle id="c" cx="0" cy="20" r="6" fill="none" stroke="#000000" stroke-width="2"/>',
    );
    expect(bake(`<circle id="c" cx="10" cy="0" r="3" ${STROKE} stroke-dasharray="1 2" transform="rotate(90) scale(2)"/>`).text).toContain(
      '<circle id="c" cx="20" cy="0" r="6" fill="none" stroke="#000000" stroke-width="2" stroke-dasharray="2 4" transform="matrix(0 1 -1 0 0 0)"/>',
    );
    // Una rotazione o un ribaltamento scritti con quattro decimali, appena
    // storti, sono ancora una similitudine.
    expect(bake(`<circle id="c" cx="10" cy="0" r="5" ${STROKE} transform="matrix(0.866 0.5 -0.5 0.86601 0 0)"/>`).text).toContain(
      `<circle id="c" cx="8.66" cy="5" r="5" ${STROKE}/>`,
    );
    expect(bake(`<circle id="c" cx="10" cy="0" r="5" ${STROKE} transform="matrix(-0.866 0.5 0.5 0.86601 0 0)"/>`).text).toContain(
      `<circle id="c" cx="-8.66" cy="5" r="5" ${STROKE}/>`,
    );
    // Un tratteggio di soli zeri disegna un contorno continuo.
    expect(bake(`<circle id="c" cx="10" cy="0" r="3" ${STROKE} stroke-dasharray="0 0" transform="rotate(90)"/>`).text).toContain(
      '<circle id="c" cx="0" cy="10" r="3" fill="none" stroke="#000000" stroke-width="1" stroke-dasharray="0 0"/>',
    );
  });

  it("porta in un poligono regolare e in una stella rotazione, scala e ribaltamenti", () => {
    const shape = (kind: PolygonalShape, geom: string, transform: string, extra = ""): string =>
      `<path id="p" fub:shape="${kind}" fub:geom="${geom}" d="${polygonalPath(readPolygonal(kind, geom)!)}" ${STROKE}${extra} transform="${transform}"/>`;
    const written = (kind: PolygonalShape, geom: string): string => {
      const attrs = polygonalAttrs(readPolygonal(kind, geom)!)!;
      return `fub:shape="${kind}" fub:geom="${attrs["fub:geom"]}" d="${attrs.d}"`;
    };
    // Il centro si muove, raggio e angoli scalano, la rotazione gira.
    expect(bake(shape("polygon", "10 0 5 6 0 1", "rotate(90) scale(2)")).text).toContain(
      `<path id="p" ${written("polygon", "0 20 10 6 90 2")} fill="none" stroke="#000000" stroke-width="2"/>`,
    );
    // Un ribaltamento porta l'angolo φ in -φ: la stella resta regolare.
    const flipped = bake(shape("star", "10 0 5 5 0.5 10 0", "scale(-1 1)"));
    expect(flipped.text).toContain(`<path id="p" ${written("star", "-10 0 5 5 0.5 -10 0")} ${STROKE}/>`);
    expect(flipped.change.kept).toBe(0);
    // Lo specchio sulla diagonale porta φ in 90° - φ: la punta da 280° a 170°.
    const turned = bake(shape("star", "10 0 5 5 0.5 10 1", "matrix(0 1 1 0 3 4)"));
    expect(turned.text).toContain(`<path id="p" ${written("star", "3 14 5 5 0.5 -100 1")} ${STROKE}/>`);
    // Col tratteggio il ribaltamento resta nella trasformazione.
    const dashed = bake(shape("polygon", "10 0 5 6 0 1", "scale(-1 1)", ' stroke-dasharray="2 1"'));
    expect(dashed.text).toContain('stroke-dasharray="2 1" transform="matrix(-1 0 0 1 0 0)"/>');
    expect(dashed.change.kept).toBe(1);
    // Una scala diversa nei due versi la deformerebbe: prende la scala
    // uguale e lascia il resto.
    const squashed = bake(shape("polygon", "10 10 5 4 0 0", "scale(2 1)"), "geometry");
    expect(squashed.text).toContain(`${written("polygon", "14.14 14.14 7.07 4 0 0")} fill="none" stroke="#000000" stroke-width="1.41" transform="matrix(1.4142 0 0 0.7071 0 0)"/>`);
    expect(squashed.change.kept).toBe(1);
  });

  it("dà a un cerchio deformato una scala uguale nei due versi, e lascia il resto", () => {
    const { text, change } = bake(`<circle id="c" cx="10" cy="10" r="5" ${STROKE} transform="scale(2 1)"/>`, "geometry");
    expect(text).toContain('<circle id="c" cx="14.14" cy="14.14" r="7.07" fill="none" stroke="#000000" stroke-width="1.41" transform="matrix(1.4142 0 0 0.7071 0 0)"/>');
    expect(change.kept).toBe(1);
  });

  it("scala un'immagine lungo gli assi senza proporzioni, e con le proporzioni nei due versi", () => {
    const image = (aspect: string, transform: string): string =>
      `<image id="i" x="1" y="1" width="10" height="10"${aspect} href="https://example.org/a.png" transform="${transform}"/>`;
    expect(bake(image(' preserveAspectRatio="none"', "scale(2 3)")).text).toContain(
      '<image id="i" x="2" y="3" width="20" height="30" preserveAspectRatio="none" href="https://example.org/a.png"/>',
    );
    expect(bake(image("", "scale(2 3)")).text).toContain(
      '<image id="i" x="2.45" y="2.45" width="24.49" height="24.49" transform="matrix(0.8165 0 0 1.2247 0 0)" href="https://example.org/a.png"/>',
    );
    // Un'immagine ribaltata si vedrebbe al contrario senza il ribaltamento.
    expect(bake(image(' preserveAspectRatio="none"', "scale(-2 2)")).text).toContain(
      '<image id="i" x="2" y="2" width="20" height="20" preserveAspectRatio="none" transform="matrix(-1 0 0 1 0 0)" href="https://example.org/a.png"/>',
    );
  });
});

describe("«Applica trasformazione» nei tratti a penna", () => {
  const stroke = (transform: string, ink = INK): string => {
    let d = "M0 0";
    try {
      d = pf1(inkToQuantized(decodeInk(ink)), parseBrush(BRUSH));
    } catch {
      // Un inchiostro che non si ridisegna tiene il suo `d`.
    }
    return `<path id="s" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="${ink}" d="${d}" transform="${transform}"/>`;
  };

  it("gira l'inchiostro e l'azimut della penna, e il motore ricalcola il tratto", () => {
    const opened = open(doc(`${LAYER}${stroke("rotate(90)", "1 s100 cxyptaz 12050,3020,128,0,45,10 25,-3,2,8,0,-10")}</g>`));
    const text = written(opened, applied(opened));
    const ink = decodeInk(/fub:ink="([^"]*)"/.exec(text)![1]!);
    // (x, y) diventa (-y, x); l'azimut gira di 90°, attraverso lo zero.
    expect(ink.values).toEqual([-3020, 12050, 128, 0, 45, 100, -3017, 12075, 130, 8, 45, 90]);
    expect(text).not.toContain("transform=");
    sameLook(opened.index, opened.reindex(), 0.05);
  });

  it("scala l'inchiostro e il pennello", () => {
    const opened = open(doc(`${LAYER}${stroke("translate(1 1) scale(2)")}</g>`));
    const text = written(opened, applied(opened));
    expect(text).toContain('fub:brush="pf1 size=8 thinning=0.5');
    expect(decodeInk(/fub:ink="([^"]*)"/.exec(text)![1]!).values).toEqual([24200, 6140, 128, 0, 24250, 6134, 130, 8, 24312, 6124, 130, 16]);
    sameLook(opened.index, opened.reindex(), 0.05);
  });

  it("tiene la trasformazione di un tratto il cui inchiostro, riscritto, sarebbe troppo lungo", () => {
    // Coordinate da quindici cifre che, scalate, ne hanno sedici, e tempi che
    // vanno avanti e indietro: il testo cresce oltre il limite.
    const samples = ["0,0,0,0"];
    for (let i = 1; i < 9700; i++) samples.push(i % 2 === 1 ? "700000000000000,700000000000000,0,9000000000000000" : "-700000000000000,-700000000000000,0,-9000000000000000");
    const ink = `1 s100 cxypt ${samples.join(" ")}`;
    const opened = open(doc(`${LAYER}<path id="s" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="${ink}" d="M0 0" transform="scale(1.5)"/></g>`));
    expect(applied(opened)).toEqual({ ops: [], keys: ["s"], changed: 0, kept: 1 });
  });

  it("tiene la trasformazione che lo deformerebbe, e quella di un tratto che non si ridisegna", () => {
    const opened = open(doc(`${LAYER}${stroke("scale(2 1)")}</g>`));
    expect(applied(opened)).toEqual({ ops: [], keys: ["s"], changed: 0, kept: 1 });
    const unknown = open(doc(`${LAYER}${stroke("rotate(90)", "1 s100 cxyq 1,1,1 1,1,1")}</g>`));
    expect(applied(unknown)).toEqual({ ops: [], keys: ["s"], changed: 0, kept: 1 });
  });
});

describe("«Applica trasformazione» nei gruppi", () => {
  it("passa la trasformazione di un gruppo ai figli; un testo la tiene", () => {
    const { text, change } = bake(
      '<g id="g" transform="translate(10 0)">'
        + `<rect id="r" x="0" y="0" width="10" height="10" ${STROKE}/>`
        + '<text id="t" x="0" y="20" transform="rotate(30)"><tspan x="0" dy="0">Ciao</tspan></text></g>',
    );
    expect(text).toContain('<g id="g">');
    expect(text).toContain(`<rect id="r" x="10" y="0" width="10" height="10" ${STROKE}/>`);
    expect(text).toContain('<text id="t" x="0" y="20" transform="matrix(0.866 0.5 -0.5 0.866 10 0)">');
    expect(change).toMatchObject({ changed: 1, kept: 1, keys: ["g"] });
  });

  it("passa anche la trasformazione di un collegamento", () => {
    const { text } = bake(`<a id="a" href="nota.md" transform="translate(5 0)"><rect id="r" x="0" y="0" width="10" height="10" ${STROKE}/></a>`);
    expect(text).toContain(`<a id="a" href="nota.md"><rect id="r" x="5" y="0" width="10" height="10" ${STROKE}/></a>`);
  });

  it("scrive sul figlio il contorno ereditato, scalato, e non cambia quello che non si vede", () => {
    const { text } = bake(
      '<g id="g" stroke="#000000" stroke-width="3" stroke-dasharray="2 1" transform="scale(2)">'
        + '<rect id="r" x="1" y="1" width="10" height="10" fill="none"/>'
        + '<image id="i" x="1" y="1" width="10" height="10" href="https://example.org/a.png"/></g>'
        + '<g id="h" stroke="#000000" stroke-width="3" transform="translate(1 0)"><rect id="s" x="1" y="1" width="10" height="10" fill="none"/></g>',
    );
    expect(text).toContain('<g id="g" stroke="#000000" stroke-width="3" stroke-dasharray="2 1">');
    expect(text).toContain('<rect id="r" x="2" y="2" width="20" height="20" fill="none" stroke-width="6" stroke-dasharray="4 2"/>');
    // Un'immagine non ha contorno; una traslazione non cambia lo spessore.
    expect(text).toContain('<image id="i" x="2" y="2" width="20" height="20" href="https://example.org/a.png"/>');
    expect(text).toContain('<rect id="s" x="2" y="1" width="10" height="10" fill="none"/>');
  });

  it("prende il contorno dal livello che contiene l'oggetto", () => {
    const opened = open(doc('<g id="l1" fub:layer="Livello 1" stroke="#000000" stroke-width="2"><rect id="r" x="0" y="0" width="10" height="10" fill="none" transform="scale(2)"/></g>'));
    expect(written(opened, applied(opened))).toContain('<rect id="r" x="0" y="0" width="20" height="20" fill="none" stroke-width="4"/>');
  });

  it("tiene la sua se un figlio non saprebbe scrivere la trasformazione composta", () => {
    const opened = open(doc(
      `${LAYER}<g id="g" transform="scale(0.001)">`
        + `<rect id="r" x="0" y="0" width="1000" height="1000" ${STROKE}/>`
        + '<text id="t" x="0" y="20" transform="rotate(30)"><tspan x="0" dy="0">Ciao</tspan></text></g></g>',
    ));
    expect(applied(opened)).toEqual({ ops: [], keys: ["g"], changed: 0, kept: 1 });
  });

  it("con parti estranee tiene la sua, e i figli applicano solo la loro", () => {
    const { text, change } = bake(
      '<g id="g" transform="translate(10 0)">'
        + `<rect id="r" x="0" y="0" width="10" height="10" ${STROKE} transform="translate(0 5)"/>`
        + '<foreignObject width="10" height="10"/></g>',
    );
    expect(text).toContain('<g id="g" transform="translate(10 0)">');
    expect(text).toContain(`<rect id="r" x="0" y="5" width="10" height="10" ${STROKE}/>`);
    expect(change).toMatchObject({ changed: 1, kept: 1 });
  });

  it("nomina con un id ciò che cambia senza averne uno", () => {
    const opened = open(doc(`${LAYER}<g transform="translate(5 0)"><rect x="0" y="0" width="10" height="10"/></g></g>`));
    const change = applied(opened);
    expect(change.ops.filter((op) => op.op === "ident")).toHaveLength(2);
    const text = written(opened, change);
    expect(text).toMatch(/<g id="o[^"]+"><rect id="o[^"]+" x="5" y="0" width="10" height="10"\/><\/g>/);
    expect(change.keys).toEqual([/<g id="(o[^"]+)">/.exec(text)![1]]);
  });
});

describe("«Applica trasformazione» con le risorse", () => {
  const DEFS =
    '<defs id="fub-defs"><linearGradient id="rgggggggg" x1="0" x2="10" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>' +
    '<clipPath id="rcccccccc"><circle cx="5" cy="5" r="5"/></clipPath></defs>';

  it("tiene la trasformazione di chi usa una risorsa, sua o ereditata", () => {
    const opened = open(
      doc(
        `${DEFS}${LAYER}<rect id="r" x="0" y="0" width="10" height="10" fill="url(#rgggggggg)" transform="translate(5 0)"/>` +
          '<g id="g" stroke="url(#rgggggggg)"><rect id="s" x="0" y="0" width="10" height="10" fill="none" transform="scale(2)"/></g>' +
          '<rect id="t" x="0" y="0" width="10" height="10" transform="translate(5 0)"/></g>',
      ),
    );
    const text = written(opened, applied(opened));
    expect(text).toContain('<rect id="r" x="0" y="0" width="10" height="10" fill="url(#rgggggggg)" transform="translate(5 0)"/>');
    expect(text).toContain('<rect id="s" x="0" y="0" width="10" height="10" fill="none" transform="scale(2)"/>');
    expect(text).toContain('<rect id="t" x="5" y="0" width="10" height="10"/>');
  });

  it("non passa ai figli la trasformazione di un gruppo con un ritaglio", () => {
    const opened = open(doc(`${DEFS}${LAYER}<g id="g" clip-path="url(#rcccccccc)" transform="translate(5 0)"><rect id="r" x="0" y="0" width="10" height="10" transform="translate(0 5)"/></g></g>`));
    const text = written(opened, applied(opened));
    expect(text).toContain('<g id="g" clip-path="url(#rcccccccc)" transform="translate(5 0)"><rect id="r" x="0" y="5" width="10" height="10"/></g>');
  });
});

describe("«Applica trasformazione» quando non c'è niente da applicare", () => {
  it("non cambia un oggetto senza trasformazione, e un testo tiene la sua", () => {
    const opened = open(doc(`${LAYER}<rect id="r" x="0" y="0" width="10" height="10"/><text id="t" x="0" y="20" transform="rotate(30)"><tspan x="0" dy="0">Ciao</tspan></text></g>`));
    expect(applied(opened)).toEqual({ ops: [], keys: ["r", "t"], changed: 0, kept: 1 });
    // Un gruppo senza trasformazione con un testo che tiene la sua ne conserva una.
    const group = open(doc(`${LAYER}<g id="g"><text id="t" x="0" y="20" transform="rotate(30)"><tspan x="0" dy="0">Ciao</tspan></text></g></g>`));
    expect(applied(group)).toEqual({ ops: [], keys: ["g"], changed: 0, kept: 1 });
  });

  it("toglie una trasformazione che è l'identità, e non scrive gli zeri che mancavano", () => {
    expect(bake('<rect id="r" width="10" height="10" transform="translate(0 0)"/>').text).toContain('<rect id="r" width="10" height="10"/>');
    const { text, change } = bake('<rect id="r" width="10" height="10" transform="translate(0 5)"/>');
    expect(text).toContain('<rect id="r" y="5" width="10" height="10"/>');
    expect(change.ops).toEqual([{ op: "set", id: "r", attrs: { y: "5", transform: null } }]);
  });

  it("tiene ciò che il file non saprebbe scrivere", () => {
    // Il resto, quasi schiacciato, non si scrive in quattro decimali.
    const opened = open(doc(`${LAYER}<rect id="r" x="0" y="0" width="10" height="10" transform="skewX(89.99)"/></g>`));
    expect(applied(opened)).toEqual({ ops: [], keys: ["r"], changed: 0, kept: 1 });
    // Una geometria che, scritta, uscirebbe dai numeri del formato.
    const huge = open(doc(`${LAYER}<rect id="r" x="0" y="0" width="1e20" height="10" transform="scale(1e20)"/></g>`));
    expect(applied(huge)).toEqual({ ops: [], keys: ["r"], changed: 0, kept: 1 });
    // Un contorno che diventerebbe zero, e una trasformazione che schiaccia.
    const thin = open(doc(`${LAYER}<rect id="r" x="0" y="0" width="1000" height="1000" fill="none" stroke="#000000" stroke-width="0.4" transform="scale(0.01)"/></g>`));
    expect(applied(thin)).toEqual({ ops: [], keys: ["r"], changed: 0, kept: 1 });
    const flat = open(doc(`${LAYER}<path id="p" d="M0 0 L10 10" transform="scale(0)"/></g>`));
    expect(applied(flat)).toEqual({ ops: [], keys: ["p"], changed: 0, kept: 1 });
    // Un percorso con una forma che questa versione non conosce.
    const shaped = open(doc(`${LAYER}<path id="p" fub:shape="star" fub:geom="0 0 10" d="M0 0 L10 0" transform="scale(2)"/></g>`));
    expect(applied(shaped)).toEqual({ ops: [], keys: ["p"], changed: 0, kept: 1 });
  });
});
