// Le operazioni booleane fra forme: i casi che due forme disegnate
// incontrano di continuo, e sulle aree le identità d'insieme, anche per le
// regioni del Costruttore di forme.

import { describe, expect, it } from "vitest";
import { pointAt } from "../scene/curves";
import { parsePath, type Segment } from "../scene/geometry";
import type { Matrix, Point } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { combine, mapped, regionsOf, type BooleanKind, type Regions, type Shape } from "./boolean";

const shape = (d: string, evenOdd = false, written = true): Shape => ({ segments: parsePath(d)!, evenOdd, written });

/// Il risultato di `kind` sui `d` dati, dal più in basso, come `d`.
const run = (kind: BooleanKind, ...ds: string[]): string[] | null => combine(kind, ds.map((d) => shape(d)))?.map(pathData) ?? null;

/// L'area di `segments` con la regola nonzero dei loro anelli, che girano
/// tutti in un verso e i buchi nell'altro: le curve fitte di corde.
function area(segments: readonly Segment[]): number {
  let sum = 0;
  let start: Point = [0, 0];
  let current: Point = [0, 0];
  const chord = (p: Point, q: Point): void => {
    sum += p[0] * q[1] - q[0] * p[1];
  };
  for (const segment of segments) {
    switch (segment.kind) {
      case "move":
        chord(current, start);
        start = current = segment.to;
        break;
      case "close":
        chord(current, start);
        current = start;
        break;
      default: {
        let p = current;
        for (let k = 1; k <= 512; k++) {
          const q = pointAt(current, segment, k / 512);
          chord(p, q);
          p = q;
        }
        current = segment.to;
      }
    }
  }
  chord(current, start);
  return Math.abs(sum / 2);
}

const areaOf = (paths: readonly Segment[][] | null): number => (paths ?? []).reduce((sum, path) => sum + area(path), 0);

const SQUARE = "M0 0 L10 0 L10 10 L0 10 Z";
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx + r} ${cy} A${r} ${r} 0 0 1 ${cx} ${cy + r} A${r} ${r} 0 0 1 ${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;

describe("le operazioni su due quadrati", () => {
  const OTHER = "M5 5 L15 5 L15 15 L5 15 Z";

  it("unione, intersezione, differenza ed esclusione", () => {
    expect(run("union", SQUARE, OTHER)).toEqual(["M0 0 L10 0 L10 5 L15 5 L15 15 L5 15 L5 10 L0 10 Z"]);
    // Comincia dal primo nodo della forma in basso che c'è ancora.
    expect(run("intersection", SQUARE, OTHER)).toEqual(["M10 10 L5 10 L5 5 L10 5 Z"]);
    expect(run("difference", SQUARE, OTHER)).toEqual(["M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z"]);
    expect(run("exclusion", SQUARE, OTHER)).toEqual(["M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z"]);
  });

  it("la divisione fa un tracciato per pezzo", () => {
    expect(run("division", SQUARE, OTHER)).toEqual(["M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z", "M10 10 L5 10 L5 5 L10 5 Z"]);
  });

  it("la differenza toglie dalla forma in basso", () => {
    // Il primo nodo della forma in basso è dentro il quadrato: comincia dal
    // secondo.
    expect(run("difference", OTHER, SQUARE)).toEqual(["M15 5 L15 15 L5 15 L5 10 L10 10 L10 5 Z"]);
  });
});

describe("i bordi coincidenti", () => {
  it("due forme uguali", () => {
    expect(run("union", SQUARE, SQUARE)).toEqual([SQUARE]);
    expect(run("intersection", SQUARE, SQUARE)).toEqual([SQUARE]);
    expect(run("difference", SQUARE, SQUARE)).toEqual([]);
    expect(run("exclusion", SQUARE, SQUARE)).toEqual([]);
    // Partendo da un altro nodo, e nell'altro verso.
    expect(run("union", SQUARE, "M10 10 L10 0 L0 0 L0 10 Z")).toEqual([SQUARE]);
    expect(run("difference", SQUARE, "M10 10 L10 0 L0 0 L0 10 Z")).toEqual([]);
  });

  it("un lato in comune, e la linea dritta resta una", () => {
    expect(run("union", SQUARE, "M10 0 L20 0 L20 10 L10 10 Z")).toEqual(["M0 0 L20 0 L20 10 L0 10 Z"]);
    expect(run("intersection", SQUARE, "M10 0 L20 0 L20 10 L10 10 Z")).toEqual([]);
    expect(run("difference", SQUARE, "M10 0 L20 0 L20 10 L10 10 Z")).toEqual([SQUARE]);
  });

  it("un lato in comune in parte", () => {
    expect(run("union", SQUARE, "M10 5 L20 5 L20 15 L10 15 Z")).toEqual(["M0 0 L10 0 L10 5 L20 5 L20 15 L10 15 L10 10 L0 10 Z"]);
    expect(run("union", SQUARE, "M10 2 L20 2 L20 8 L10 8 Z")).toEqual(["M0 0 L10 0 L10 2 L20 2 L20 8 L10 8 L10 10 L0 10 Z"]);
  });

  it("i punti che si scrivono al centesimo da calcoli diversi coincidono", () => {
    expect(run("union", SQUARE, "M10.004 0 L20 0 L20 10 L10.006 10.003 Z")).toEqual(["M0 0 L20 0 L20 10 L0 10 Z"]);
    expect(run("intersection", SQUARE, "M0.01 0 L10 0.01 L9.99 10 L0 9.995 Z")).toEqual([SQUARE]);
  });

  it("un nodo che la forma aveva su un lato dritto resta", () => {
    expect(run("union", "M0 0 L5 0 L10 0 L10 10 L0 10 Z")).toEqual(["M0 0 L5 0 L10 0 L10 10 L0 10 Z"]);
  });

  it("un gradino di due centesimi resta", () => {
    expect(run("union", SQUARE, "M10 0.02 L20 0.02 L20 10 L10 10 Z")).toEqual(["M0 0 L10 0 L10 0.02 L20 0.02 L20 10 L0 10 Z"]);
  });

  it("due lati in comune in parte, uno dritto e uno sotto una curva", () => {
    // Le forme hanno in comune un pezzo del lato in alto e uno di quello in
    // basso, dove la cubica arriva quasi dritta: ogni operazione, dai due
    // lati.
    const A = "M0 0 L50 0 L50 50 L0 50 Z";
    const B = "M30 0 L90 0 C90 40 70 50 30 50 Z";
    const [outside, inside, under] = ["C90 32.66 76.67 45.32 50 48.87", "C44.01 49.66 37.34 50 30 50", "C37.34 50 44.01 49.66 50 48.87"];
    expect(run("union", A, B)).toEqual([`M0 0 L90 0 ${outside} L50 50 L0 50 Z`]);
    expect(run("union", B, A)).toEqual([`M90 0 ${outside} L50 50 L0 50 L0 0 Z`]);
    expect(run("intersection", A, B)).toEqual([`M50 0 L50 48.87 ${inside} L30 0 Z`]);
    expect(run("intersection", B, A)).toEqual([`M30 0 L50 0 L50 48.87 ${inside} Z`]);
    expect(run("difference", A, B)).toEqual([`M0 0 L30 0 L30 50 L0 50 Z M50 50 L30 50 ${under} Z`]);
    expect(run("difference", B, A)).toEqual([`M90 0 ${outside} L50 0 Z`]);
    expect(run("exclusion", A, B)).toEqual([`M0 0 L30 0 L30 50 L0 50 Z M50 0 L90 0 ${outside} Z M50 50 L30 50 ${under} Z`]);
    expect(run("division", A, B)).toEqual(["M0 0 L30 0 L30 50 L0 50 Z", `M50 0 L50 48.87 ${inside} L30 0 Z`, `M50 50 L30 50 ${under} Z`]);
    expect(run("division", B, A)).toEqual([`M30 0 L50 0 L50 48.87 ${inside} Z`, `M90 0 ${outside} L50 0 Z`]);
  });
});

describe("i contatti e le tangenze", () => {
  it("due forme che si toccano in un vertice restano due anelli", () => {
    const corner = "M10 10 L20 10 L20 20 L10 20 Z";
    expect(run("union", SQUARE, corner)).toEqual([`${SQUARE} M10 10 L20 10 L20 20 L10 20 Z`]);
    expect(run("intersection", SQUARE, corner)).toEqual([]);
    expect(run("difference", SQUARE, corner)).toEqual([SQUARE]);
  });

  it("un nodo a meno della tolleranza da un lato, vicino a un capo, va sul capo", () => {
    // A un centesimo dal lato e a un centesimo e mezzo dal suo capo: si fonde
    // col capo, invece di spezzare il lato in un pezzo più corto della
    // tolleranza.
    expect(run("union", SQUARE, "M0.012 -0.011 L5 -5 L-5 -5 Z")).toEqual(["M0 0 L10 0 L10 10 L0 10 Z M0 0 L-5 -5 L5 -5 Z"]);
  });

  it("due nodi a un centesimo e mezzo si fondono, e le maniglie li seguono", () => {
    // Il nodo della forma sopra va su quello della forma in basso; la cubica
    // che ne parte, o che vi arriva, sposta con lui la maniglia vicina.
    expect(run("union", SQUARE, "M10.01 10.01 C15 10.01 20 15 20 20 L10.01 20 Z")).toEqual([`${SQUARE} M10 10 C14.99 10 20 15 20 20 L10.01 20 Z`]);
    expect(run("union", SQUARE, "M10.01 10.01 L20 10.01 L20 20 L10.01 20 C12 17 12 13 10.01 10.01 Z")).toEqual([
      `${SQUARE} M10 10 L20 10.01 L20 20 L10.01 20 C12 17 11.99 12.99 10 10 Z`,
    ]);
  });

  it("un nodo a un centesimo da un lato resta dov'è, e il lato non si piega", () => {
    expect(run("union", SQUARE, "M5 -0.01 L8 -5 L2 -5 Z")).toEqual([`${SQUARE} M5 -0.01 L2 -5 L8 -5 Z`]);
    expect(run("union", SQUARE, "M5 0.01 L8 -5 L2 -5 Z")).toEqual([`${SQUARE} M5 0.01 L2 -5 L8 -5 Z`]);
    expect(run("difference", SQUARE, "M5 -0.01 L8 -5 L2 -5 Z")).toEqual([SQUARE]);
  });

  it("un lato che taglia un angolo a pochi centesimi dal vertice", () => {
    const corner = "M9.9 10.05 L10.05 9.9 L12 12 Z";
    expect(run("union", SQUARE, corner)).toEqual(["M0 0 L10 0 L10 9.95 L10.05 9.9 L12 12 L9.9 10.05 L9.95 10 L0 10 Z"]);
    expect(run("intersection", SQUARE, corner)).toEqual(["M10 10 L9.95 10 L10 9.95 Z"]);
  });

  it("un cerchio tangente a un lato, da fuori e da dentro", () => {
    const outside = circle(15, 5, 5);
    expect(run("intersection", SQUARE, outside)).toEqual([]);
    expect(areaOf(combine("union", [shape(SQUARE), shape(outside)]))).toBeCloseTo(100 + 25 * Math.PI, 1);
    // Tangente ai quattro lati: dove li sfiora resta il cerchio.
    const inside = circle(5, 5, 5);
    expect(run("intersection", SQUARE, inside)).toEqual([inside]);
    expect(areaOf(combine("difference", [shape(SQUARE), shape(inside)]))).toBeCloseTo(100 - 25 * Math.PI, 1);
  });

  it("una retta tangente a una cubica che più in là la incrocia", () => {
    // La cubica è y = 60t(1-t)(2t-1) con x = 30t; la retta la tocca in
    // t = 0,3 e la incrocia in t = 0,9.
    const wave = "M0 0 C10 -20 20 20 30 0 L30 30 L0 30 Z";
    expect(run("union", wave, "M0 -9.72 L30 5.88 L30 -20 L0 -20 Z")).toEqual([
      "M0 0 C3 -6 6 -6.6 9 -5.04 L0 -9.72 L0 -20 L30 -20 L30 30 L0 30 Z M9 -5.04 C15 -1.92 21 9.84 27 4.32 Z",
    ]);
  });
});

describe("il contenimento e i buchi", () => {
  const BIG = "M0 0 L100 0 L100 100 L0 100 Z";
  const HOLE = circle(50, 50, 20);
  const REVERSED = "M70 50 A20 20 0 0 0 50 30 A20 20 0 0 0 30 50 A20 20 0 0 0 50 70 A20 20 0 0 0 70 50 Z";

  it("una forma dentro l'altra", () => {
    expect(run("union", BIG, HOLE)).toEqual([BIG]);
    expect(run("intersection", BIG, HOLE)).toEqual([HOLE]);
    expect(run("difference", BIG, HOLE)).toEqual([`${BIG} ${REVERSED}`]);
    expect(run("exclusion", BIG, HOLE)).toEqual([`${BIG} ${REVERSED}`]);
    expect(run("difference", HOLE, BIG)).toEqual([]);
  });

  it("un buco si riempie, e si attraversa", () => {
    const ring = `${BIG} ${REVERSED}`;
    // Il cerchio riempie il buco.
    expect(run("union", ring, HOLE)).toEqual([BIG]);
    // Un rettangolo che attraversa il buco ne riempie una striscia.
    const band = "M40 -10 L60 -10 L60 110 L40 110 Z";
    const union = combine("union", [shape(ring), shape(band)]);
    expect(union).toHaveLength(1);
    const lens = areaOf(combine("intersection", [shape(HOLE), shape(band)]));
    expect(areaOf(union)).toBeCloseTo(10000 - 400 * Math.PI + lens + 2 * 200, 1);
  });

  it("con fill-rule evenodd due anelli nello stesso verso fanno un buco", () => {
    const twice = `${BIG} ${HOLE}`;
    expect(combine("union", [shape(twice, true)])!.map(pathData)).toEqual([`${BIG} ${REVERSED}`]);
    expect(combine("union", [shape(twice, false)])!.map(pathData)).toEqual([BIG]);
  });
});

describe("tre forme", () => {
  it("l'esclusione tiene le aree coperte un numero dispari di volte", () => {
    // In mezzo le tre forme si coprono tutte: resta.
    expect(run("exclusion", "M0 0 L20 0 L20 20 L0 20 Z", "M10 0 L30 0 L30 20 L10 20 Z", "M5 10 L25 10 L25 30 L5 30 Z")).toEqual([
      "M0 0 L10 0 L10 10 L5 10 L5 20 L0 20 Z M20 0 L30 0 L30 20 L25 20 L25 10 L20 10 Z M20 20 L25 20 L25 30 L5 30 L5 20 L10 20 L10 10 L20 10 Z",
    ]);
  });
});

describe("le forme disgiunte e i risultati vuoti", () => {
  const FAR = "M20 0 L30 0 L30 10 L20 10 Z";

  it("le forme lontane", () => {
    expect(run("union", SQUARE, FAR)).toEqual([`${SQUARE} ${FAR}`]);
    expect(run("intersection", SQUARE, FAR)).toEqual([]);
    expect(run("difference", SQUARE, FAR)).toEqual([SQUARE]);
    expect(run("exclusion", SQUARE, FAR)).toEqual([`${SQUARE} ${FAR}`]);
  });

  it("ciò che non racchiude niente", () => {
    expect(run("union", "M0 0 L10 10")).toEqual([]);
    expect(run("union", "M0 0 L10 0 L20 0")).toEqual([]);
    expect(run("union", "")).toEqual([]);
    expect(run("difference", SQUARE, "M-5 -5 L15 -5 L15 15 L-5 15 Z")).toEqual([]);
    // Una linea non toglie niente, e non lascia nodi.
    expect(run("difference", SQUARE, "M-5 5 L15 5")).toEqual([SQUARE]);
  });
});

describe("le curve", () => {
  const ONE = circle(0, 0, 10);
  const TWO = circle(10, 0, 10);

  it("restano curve, coi capi sugli incroci veri", () => {
    expect(run("union", ONE, TWO)).toEqual([
      "M0 10 A10 10 0 0 1 -10 0 A10 10 0 0 1 0 -10 A10 10 0 0 1 5 -8.66 A10 10 0 0 1 10 -10 A10 10 0 0 1 20 0 A10 10 0 0 1 10 10 A10 10 0 0 1 5 8.66 A10 10 0 0 1 0 10 Z",
    ]);
    expect(run("intersection", ONE, TWO)).toEqual(["M10 0 A10 10 0 0 1 5 8.66 A10 10 0 0 1 0 0 A10 10 0 0 1 5 -8.66 A10 10 0 0 1 10 0 Z"]);
  });

  it("una cubica si taglia nel punto giusto", () => {
    // Una goccia di cubiche tagliata a metà altezza da un rettangolo.
    const drop = "M0 0 C20 0 20 20 0 40 C-20 20 -20 0 0 0 Z";
    const out = combine("intersection", [shape(drop), shape("M-50 -10 L50 -10 L50 20 L-50 20 Z")])!;
    expect(out).toHaveLength(1);
    for (const segment of out[0]!) {
      if (segment.kind === "move" || segment.kind === "close") continue;
      expect(segment.to[1]).toBeLessThanOrEqual(20);
    }
    const cut = out[0]!.flatMap((segment) => (segment.kind === "cubic" ? [segment.to] : []));
    // I capi sul taglio stanno esattamente a y = 20, sulla curva.
    expect(cut.some(([, y]) => Math.abs(y - 20) < 1e-9)).toBe(true);
  });

  it("un arco trasformato si scrive in quarti di giro", () => {
    const half = "M0 0 A10 10 0 0 1 20 0 Z";
    expect(combine("union", [shape(half)])!.map(pathData)).toEqual([half]);
    expect(combine("union", [shape(half, false, false)])!.map(pathData)).toEqual(["M0 0 A10 10 0 0 1 10 -10 A10 10 0 0 1 20 0 Z"]);
  });

  it("una forma pulita resta com'era", () => {
    for (const d of [SQUARE, ONE, "M0 0 C20 0 20 20 0 40 C-20 20 -20 0 0 0 Z", "M0 0 Q10 -10 20 0 L20 20 L0 20 Z", "M0 0 L0 10 L10 10 L10 0 Z"]) {
      expect(run("union", d)).toEqual([d]);
    }
  });

  it("un sottotracciato aperto si riempie come se fosse chiuso", () => {
    expect(run("union", "M0 0 L10 0 L10 10")).toEqual(["M0 0 L10 0 L10 10 Z"]);
  });

  it("un arco senza raggi, o coi capi nello stesso punto, è una linea", () => {
    expect(run("union", "M0 0 A0 5 0 0 1 10 0 L10 10 L0 10 A5 5 0 0 1 0 10 Z")).toEqual([SQUARE]);
  });

  it("le curve di pochi centesimi restano com'erano", () => {
    // La spezzata di una curva così corta non ha punti più vicini della
    // tolleranza, che si fonderebbero schiacciandola.
    for (const tiny of [
      "M0.02 0 C0.02 0.01 0.01 0.02 0 0.02 C-0.01 0.02 -0.02 0.01 -0.02 0 C-0.02 -0.01 -0.01 -0.02 0 -0.02 C0.01 -0.02 0.02 -0.01 0.02 0 Z",
      "M0 0 C0 0.03 0.03 0.03 0.03 0 Z",
      "M0 0 C0 0.04 0.04 0.04 0.04 0 Z",
      "M0 0 C0 0.05 0.05 0.05 0.05 0 Z",
      "M0 0 Q0.02 0.04 0.04 0 Z",
    ]) {
      expect(run("union", tiny)).toEqual([tiny]);
    }
  });

  it("accanto a una forma grande, una curva piccola si incrocia dove passa", () => {
    // La spezzata del cerchio resta a due millesimi dalla curva anche dove
    // l'arrangiamento è largo mille: il lato a x = 9 lo incrocia a y = ±√19.
    const wide = "M9 -500 L1000 -500 L1000 500 L9 500 Z";
    expect(run("union", ONE, wide)).toEqual([
      "M0 10 A10 10 0 0 1 -10 0 A10 10 0 0 1 0 -10 A10 10 0 0 1 9 -4.36 L9 -500 L1000 -500 L1000 500 L9 500 L9 4.36 A10 10 0 0 1 0 10 Z",
    ]);
    expect(run("intersection", ONE, wide)).toEqual(["M10 0 A10 10 0 0 1 9 4.36 L9 -4.36 A10 10 0 0 1 10 0 Z"]);
  });

  it("due cerchi grandi a tre centesimi l'uno dall'altro fanno un anello", () => {
    // I nodi del cerchio dentro stanno a 30°, fra quelli della spezzata di
    // fuori: le due spezzate restano lontane più della tolleranza.
    const inner = "M173.21 100 A200 200 0 0 1 -100 173.21 A200 200 0 0 1 -173.21 -100 A200 200 0 0 1 100 -173.21 A200 200 0 0 1 173.21 100 Z";
    expect(run("difference", circle(0, 0, 200.03), inner)).toEqual([
      `${circle(0, 0, 200.03)} M173.21 100 A200 200 0 0 0 100 -173.21 A200 200 0 0 0 -173.21 -100 A200 200 0 0 0 -100 173.21 A200 200 0 0 0 173.21 100 Z`,
    ]);
    expect(run("union", circle(0, 0, 200.03), inner)).toEqual([circle(0, 0, 200.03)]);
  });

  it("dove due curve corrono fuse vale quella della forma in basso", () => {
    // La quadratica e la cubica stanno a meno di tre millesimi l'una
    // dall'altra: la differenza lascia la forma com'era.
    const bowl = "M0 0 Q5 4 10 0 L10 10 L0 10 Z";
    expect(run("difference", bowl, "M0 0 C3.33 2.67 6.67 2.67 10 0 L10 -10 L0 -10 Z")).toEqual([bowl]);
  });
});

describe("il verso e l'inizio", () => {
  it("il risultato gira come la forma in basso", () => {
    // Antiorario sullo schermo.
    const turned = "M0 0 L0 10 L10 10 L10 0 Z";
    expect(run("union", turned, "M5 5 L15 5 L15 15 L5 15 Z")).toEqual(["M0 0 L0 10 L5 10 L5 15 L15 15 L15 5 L10 5 L10 0 Z"]);
  });

  it("gli anelli seguono l'ordine dei nodi della forma in basso", () => {
    const two = "M20 0 L30 0 L30 10 L20 10 Z M0 0 L10 0 L10 10 L0 10 Z";
    expect(run("union", two)).toEqual([two]);
  });

  it("un anello senza nodi della forma in basso viene dopo, e comincia dall'incrocio più a sinistra", () => {
    // Del primo quadrato resta una striscia fra quattro incroci.
    expect(run("difference", `${SQUARE} M20 0 L30 0 L30 10 L20 10 Z`, "M-1 -1 L3 -1 L3 11 L-1 11 Z M7 -1 L11 -1 L11 11 L7 11 Z")).toEqual([
      "M20 0 L30 0 L30 10 L20 10 Z M3 0 L7 0 L7 10 L3 10 Z",
    ]);
    // Gli anelli fatti solo di incroci, da sinistra, poi dall'alto.
    expect(run("intersection", "M0 4 L30 4 L30 6 L0 6 Z", "M20 0 L25 0 L25 10 L20 10 Z M5 0 L10 0 L10 10 L5 10 Z")).toEqual([
      "M5 4 L10 4 L10 6 L5 6 Z M20 4 L25 4 L25 6 L20 6 Z",
    ]);
    expect(run("intersection", "M4 0 L6 0 L6 30 L4 30 Z", "M0 20 L10 20 L10 25 L0 25 Z M0 5 L10 5 L10 10 L0 10 Z")).toEqual([
      "M4 5 L6 5 L6 10 L4 10 Z M4 20 L6 20 L6 25 L4 25 Z",
    ]);
  });
});

describe("i tracciati che si intrecciano", () => {
  const STAR = "M50 0 L79.39 90.45 L2.45 34.55 L97.55 34.55 L20.61 90.45 Z";

  it("una stella con nonzero è piena, con evenodd ha il pentagono vuoto", () => {
    const full = combine("union", [shape(STAR)])!;
    expect(full).toHaveLength(1);
    // Dieci nodi: cinque punte e cinque incroci.
    expect(full[0]!.filter((segment) => segment.kind === "line")).toHaveLength(9);
    const hollow = combine("union", [shape(STAR, true)])!;
    expect(areaOf(hollow)).toBeLessThan(areaOf(full));
    const pentagon = areaOf(full) - areaOf(hollow);
    expect(areaOf(combine("difference", [shape(STAR), shape(STAR, true)]))).toBeCloseTo(pentagon, 3);
  });
});

describe("la divisione", () => {
  it("una linea taglia la forma in due", () => {
    expect(run("division", SQUARE, "M5 -5 L5 15")).toEqual(["M0 0 L5 0 L5 10 L0 10 Z", "M10 0 L10 10 L5 10 L5 0 Z"]);
  });

  it("un cerchio dentro ritaglia un disco e lascia un anello", () => {
    const BIG = "M0 0 L100 0 L100 100 L0 100 Z";
    const pieces = combine("division", [shape(BIG), shape(circle(50, 50, 20))])!;
    expect(pieces.map(pathData)).toEqual([
      `${BIG} M70 50 A20 20 0 0 0 50 30 A20 20 0 0 0 30 50 A20 20 0 0 0 50 70 A20 20 0 0 0 70 50 Z`,
      circle(50, 50, 20),
    ]);
  });

  it("un taglio aperto che svolta resta aperto", () => {
    // Chiuso, tornerebbe indietro tagliando anche l'angolo in alto a destra.
    expect(run("division", SQUARE, "M5 -5 L5 5 L15 8")).toEqual(["M0 0 L5 0 L5 5 L10 6.5 L10 10 L0 10 Z", "M10 0 L10 6.5 L5 5 L5 0 Z"]);
  });

  it("dove tre linee si incrociano quasi nello stesso punto vale l'incrocio della forma in basso", () => {
    // I tagli incrociano il lato a x = 5 e a x = 5,012, e fra loro poco
    // sopra: un vertice solo, sul primo incrocio.
    expect(run("division", SQUARE, "M-5 10 L10 -5", "M0.012 -5 L15.012 10")).toEqual([
      "M0 0 L5 0 L0 5 Z",
      "M10 0 L10 4.99 L5 0 Z",
      "M10 10 L0 10 L0 5 L5 0 L10 4.99 Z",
    ]);
  });

  it("un taglio che non attraversa lascia la forma intera", () => {
    expect(run("division", SQUARE, "M5 -5 L5 5")).toEqual([SQUARE]);
  });

  it("due tagli che si incrociano fanno quattro pezzi", () => {
    const pieces = combine("division", [shape(SQUARE), shape("M5 -5 L5 15"), shape("M-5 5 L15 5")])!;
    expect(pieces).toHaveLength(4);
    for (const piece of pieces) expect(area(piece)).toBeCloseTo(25, 6);
  });

  it("una forma sotto che non racchiude niente non ha pezzi", () => {
    expect(run("division", "M0 0 L10 10", SQUARE)).toEqual([]);
  });
});

describe("le identità delle aree", () => {
  const ellipse = (cx: number, cy: number, rx: number, ry: number, k = 0.5523): string =>
    `M${cx + rx} ${cy} C${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} C${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} C${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} C${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} Z`;
  const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
    ["due cerchi", circle(0, 0, 30), circle(25, 10, 20)],
    ["un cerchio e un'ellisse di cubiche", circle(0, 0, 30), ellipse(10, 5, 40, 12)],
    ["una stella e un cerchio", "M50 0 L79.39 90.45 L2.45 34.55 L97.55 34.55 L20.61 90.45 Z", circle(50, 50, 30)],
    ["un rettangolo arrotondato e un anello", "M10 0 L90 0 A10 10 0 0 1 100 10 L100 50 A10 10 0 0 1 90 60 L10 60 A10 10 0 0 1 0 50 L0 10 A10 10 0 0 1 10 0 Z", `${circle(70, 50, 30)} M80 50 A10 10 0 0 0 70 40 A10 10 0 0 0 60 50 A10 10 0 0 0 70 60 A10 10 0 0 0 80 50 Z`],
    ["quadratiche che si intrecciano", "M0 0 Q50 80 100 0 Q50 -80 0 0 Z", "M0 -30 Q120 0 0 30 Z"],
    ["due forme con due lati in comune in parte", "M0 0 L50 0 L50 50 L0 50 Z", "M30 0 L90 0 C90 40 70 50 30 50 Z"],
    // Tre lati che passano a pochi centesimi l'uno dall'altro: l'incrocio
    // va dove si incrociano i due più vicini, non sulla punta di uno.
    [
      "due poligoni intrecciati con incroci a pochi centesimi",
      "M66.96 6.48 L35.47 44.97 L33.38 61.11 L14.33 63.1 L84.17 41.81 L33.6 67.71 Z",
      "M53.54 41.17 L28.4 75.67 L28.68 74.88 L78.53 31.74 L76.39 84.64 L84.64 38.91 Z",
    ],
    // A un centesimo dalla cubica, dove la tolleranza le fa toccare, la retta
    // non ha incroci: il vertice resta lì, non va dove si incrociano più in
    // là.
    ["una retta a un centesimo da una cubica, che la incrocia più in là", "M0 0 C10 -20 20 20 30 0 L30 30 L0 30 Z", "M0 -9.73 L30 5.87 L30 -20 L0 -20 Z"],
    // Una svolta stretta dove i lati vicini si avvicinano più della
    // tolleranza senza toccarsi: i vertici si fondono, e l'arrangiamento
    // non si spezza senza fine.
    [
      "un poligono intrecciato e una forma di cubiche con una svolta stretta",
      "M7.05 33.96 L90.34 70.43 L44.94 101.32 L61.37 21.84 Z",
      "M65.75 50 C79.96 64.43 47.77 86.74 45.02 80.31 C36.92 70.05 9.08 49.13 9.69 50 C7.99 62.9 59.92 24.68 45.02 18.99 C41.21 22.13 51.26 39.08 65.75 50 Z",
    ],
  ];

  /// Le identità d'insieme sulle aree di `a` e `b`, a meno di cinque
  /// decimillesimi della loro somma; con `cut` le forme si sovrappongono e la
  /// divisione fa più pezzi.
  const identities = (a: string, b: string, cut = true): void => {
    const [A, B] = [shape(a), shape(b)];
    // L'area di una forma è quella della sua unione con niente: una stella
    // conta il pentagono in mezzo una volta sola.
    const [sizeA, sizeB] = [areaOf(combine("union", [A])), areaOf(combine("union", [B]))];
    const results = (["union", "intersection", "difference", "exclusion", "division"] as const).map((kind) => combine(kind, [A, B]));
    for (const result of results) expect(result).not.toBeNull();
    const [union, intersection, difference, exclusion, division] = results.map(areaOf);
    const tolerance = 5e-4 * (sizeA + sizeB);
    expect(Math.abs(union! - (sizeA + sizeB - intersection!))).toBeLessThan(tolerance);
    expect(Math.abs(difference! - (sizeA - intersection!))).toBeLessThan(tolerance);
    expect(Math.abs(exclusion! - (union! - intersection!))).toBeLessThan(tolerance);
    expect(Math.abs(division! - sizeA)).toBeLessThan(tolerance);
    if (cut) {
      expect(intersection).toBeGreaterThan(0);
      expect(results[4]!.length).toBeGreaterThan(1);
    }
    regionIdentities(A, B, sizeA, sizeB, union!);
  };

  /// Le stesse identità sulle regioni: quelle coperte da una forma fanno la
  /// forma, tutte insieme l'unione; una regione unita da sola ha la sua area,
  /// e la forma che la perde ha la sua area di meno.
  const regionIdentities = (A: Shape, B: Shape, sizeA: number, sizeB: number, union: number): void => {
    const found = regionsOf([A, B], [false, false]) as Regions | null;
    expect(found).not.toBeNull();
    const { regions } = found!;
    const tolerance = 5e-4 * (sizeA + sizeB);
    const areas = regions.map((region) => area(region.segments));
    regions.forEach((region, r) => expect(Math.abs(region.area - areas[r]!)).toBeLessThan(tolerance));
    const covered = (k: number): number => areas.reduce((sum, size, r) => (regions[r]!.cover.includes(k) ? sum + size : sum), 0);
    expect(Math.abs(covered(0) - sizeA)).toBeLessThan(tolerance);
    expect(Math.abs(covered(1) - sizeB)).toBeLessThan(tolerance);
    expect(Math.abs(areas.reduce((sum, size) => sum + size, 0) - union)).toBeLessThan(tolerance);
    regions.forEach((region, r) => {
      const top = region.cover[region.cover.length - 1]!;
      expect(Math.abs(area(found!.path((other) => other === r, null, top)!) - areas[r]!)).toBeLessThan(tolerance);
      for (const k of region.cover) {
        const rest = found!.path((other) => other !== r, k, k)!;
        expect(Math.abs(area(rest) - ((k === 0 ? sizeA : sizeB) - areas[r]!))).toBeLessThan(tolerance);
      }
    });
  };

  for (const [name, a, b] of PAIRS) {
    it(name, () => {
      identities(a, b);
      identities(b, a);
    });
  }

  it("cinquanta coppie di forme a caso, poligoni intrecciati e cubiche", () => {
    // Un generatore con il seme fisso, perché la prova sia sempre la stessa.
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const hundredth = (v: number): number => Math.round(v * 100) / 100;
    const polygon = (cx: number, cy: number, r: number): string => {
      const n = 3 + Math.floor(random() * 8);
      const points = Array.from({ length: n }, () => {
        const [angle, radius] = [random() * 2 * Math.PI, r * (0.3 + random())];
        return `${hundredth(cx + radius * Math.cos(angle))} ${hundredth(cy + radius * Math.sin(angle))}`;
      });
      return `M${points.join(" L")} Z`;
    };
    const blob = (cx: number, cy: number, r: number): string => {
      const n = 3 + Math.floor(random() * 5);
      const points = Array.from({ length: n }, (_, i): Point => {
        const [angle, radius] = [(i / n) * 2 * Math.PI, r * (0.6 + 0.6 * random())];
        return [hundredth(cx + radius * Math.cos(angle)), hundredth(cy + radius * Math.sin(angle))];
      });
      const near = (p: Point): string => `${hundredth(p[0] + (random() - 0.5) * r)} ${hundredth(p[1] + (random() - 0.5) * r)}`;
      const curves = points.map((p, i) => {
        const q = points[(i + 1) % n]!;
        return `C${near(p)} ${near(q)} ${q[0]} ${q[1]}`;
      });
      return `M${points[0]![0]} ${points[0]![1]} ${curves.join(" ")} Z`;
    };
    for (let k = 0; k < 50; k++) {
      const a = k % 2 === 0 ? polygon(50, 50, 40) : blob(50, 50, 30);
      const [cx, cy] = [50 + (random() - 0.5) * 40, k % 3 === 0 ? 50 + (random() - 0.5) * 40 : 50];
      const b = k % 3 === 0 ? polygon(cx, cy, 40) : blob(cx, cy, 30);
      identities(a, b, false);
    }
  });
});

describe("le forme trasformate", () => {
  it("un arco dopo una scala e un ribaltamento", () => {
    const flip: Matrix = [2, 0, 0, -1, 0, 0];
    expect(pathData(mapped(parsePath(circle(0, 0, 10))!, flip))).toBe(
      "M20 0 A20 10 0 0 0 0 -10 A20 10 0 0 0 -20 0 A20 10 0 0 0 0 10 A20 10 0 0 0 20 0 Z",
    );
    const turn: Matrix = [0, 1, -1, 0, 5, 5];
    expect(pathData(mapped(parsePath("M0 0 L10 0 Q10 10 0 10 C-5 10 -5 0 0 0 Z")!, turn))).toBe("M5 5 L5 15 Q-5 15 -5 5 C-5 0 5 0 5 5 Z");
  });
});

describe("le regioni", () => {
  const OTHER = "M5 5 L15 5 L15 15 L5 15 Z";
  const regions = (cuts: boolean[], ...ds: string[]) => regionsOf(ds.map((d) => shape(d)), cuts) as Regions;
  const outlines = (found: ReturnType<typeof regions>): string[] => found.regions.map((region) => pathData(region.segments));
  const thousandth = (value: number): number => Math.round(value * 1000) / 1000;

  it("con un limite ai pezzi delle spezzate, rinunciano quando li passano, anche dopo gli incroci", () => {
    const shapes = [shape(SQUARE), shape("M5.3 5.3 L15.3 5.3 L15.3 15.3 L5.3 15.3 Z")];
    // I lati dei due quadrati fanno 336 pezzi; i due incroci, ciascuno a
    // metà di due pezzi, li portano a 340.
    expect(regionsOf(shapes, [false, false], 335)).toBe("complex");
    expect(regionsOf(shapes, [false, false], 336)).toBe("complex");
    expect((regionsOf(shapes, [false, false], 340) as Regions).regions).toHaveLength(3);
  });

  it("due quadrati fanno tre regioni, da sinistra, ciascuna con le forme che la coprono", () => {
    const found = regions([], SQUARE, OTHER);
    expect(outlines(found)).toEqual(["M0 0 L10 0 L10 5 L5 5 L5 10 L0 10 Z", "M10 10 L5 10 L5 5 L10 5 Z", "M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z"]);
    expect(found.regions.map((region) => region.cover)).toEqual([[0], [0, 1], [1]]);
    expect(found.regions.map((region) => thousandth(region.area))).toEqual([75, 25, 75]);
    expect([found.at([2, 2]), found.at([7, 7]), found.at([12, 12]), found.at([20, 20])]).toEqual([0, 1, 2, -1]);
  });

  it("unire, togliere e separare sono tracciati delle regioni", () => {
    const found = regions([], SQUARE, OTHER);
    expect(pathData(found.path(() => true, null, 0)!)).toBe("M0 0 L10 0 L10 5 L15 5 L15 15 L5 15 L5 10 L0 10 Z");
    expect(pathData(found.path((r) => r <= 1, null, 0)!)).toBe(SQUARE);
    // La forma 1 senza la regione in comune.
    expect(pathData(found.path((r) => r !== 1, 1, 1)!)).toBe("M10 10 L10 5 L15 5 L15 15 L5 15 L5 10 Z");
    // Una forma che perde tutte le sue regioni non ha più niente.
    expect(found.path((r) => r === 2, 0, 0)).toEqual([]);
  });

  it("le curve restano curve", () => {
    const found = regions([], circle(10, 10, 6), SQUARE);
    expect(outlines(found)).toEqual([
      "M4 10 L0 10 L0 0 L10 0 L10 4 A6 6 0 0 0 4 10 Z",
      "M4 10 A6 6 0 0 1 10 4 L10 10 Z",
      "M16 10 A6 6 0 0 1 10 16 A6 6 0 0 1 4 10 L10 10 L10 4 A6 6 0 0 1 16 10 Z",
    ]);
    expect(found.regions.map((region) => region.cover)).toEqual([[1], [0, 1], [0]]);
  });

  it("una linea che attraversa una forma la divide, e resta fuori dalle regioni", () => {
    const found = regions([false, true], SQUARE, "M-5 5 L15 5");
    expect(outlines(found)).toEqual(["M0 0 L10 0 L10 5 L0 5 Z", "M10 10 L0 10 L0 5 L10 5 Z"]);
    expect(found.regions.map((region) => region.cover)).toEqual([[0], [0]]);
    // Una che entra e si ferma non divide niente.
    expect(outlines(regions([false, true], SQUARE, "M-5 5 L5 5"))).toEqual([SQUARE]);
  });

  it("i casi difficili: forme uguali, contatti, tangenze e intrecci", () => {
    // Due forme uguali sono una regione coperta da tutte e due.
    expect(regions([], SQUARE, SQUARE).regions.map((region) => region.cover)).toEqual([[0, 1]]);
    // Due quadrati che si toccano in un vertice, due cerchi tangenti.
    expect(regions([], SQUARE, "M10 10 L20 10 L20 20 L10 20 Z").regions.map((region) => thousandth(region.area))).toEqual([100, 100]);
    expect(regions([], circle(0, 0, 5), circle(10, 0, 5)).regions).toHaveLength(2);
    // Una forma che si intreccia: il fiocco fa due triangoli, la stella le
    // sue punte e il pentagono in mezzo.
    expect(outlines(regions([], "M0 0 L20 20 L20 0 L0 20 Z"))).toEqual(["M0 0 L10 10 L0 20 Z", "M20 20 L10 10 L20 0 Z"]);
    expect(regions([], "M50 0 L79 90 L2 35 L98 35 L21 90 Z").regions).toHaveLength(6);
    // Tre cerchi fanno le sette regioni del diagramma di Venn.
    const venn = regions([], circle(0, 0, 10), circle(12, 0, 10), circle(6, 10, 10));
    expect(venn.regions.map((region) => region.cover.length).sort()).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it("una faccia troppo sottile per vedersi va con la regione accanto", () => {
    const found = regions([], SQUARE, "M0 0 L10.02 0 L10.02 10 L0 10 Z");
    expect(found.regions).toHaveLength(1);
    expect(found.regions[0]!.cover).toEqual([0, 1]);
    expect(pathData(found.path(() => true, null, 0)!)).toBe("M0 0 L10.02 0 L10.02 10 L0 10 Z");
    // La forma che la perde non ne tiene un filo.
    expect(found.path(() => false, 1, 1)).toEqual([]);
  });

  it("senza forme non ci sono regioni", () => {
    expect(regions([]).regions).toEqual([]);
    expect(regions([true], "M0 0 L10 10").regions).toEqual([]);
  });
});
