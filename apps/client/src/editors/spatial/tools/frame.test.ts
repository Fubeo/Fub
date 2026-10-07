// La cornice di trasformazione: dove stanno le maniglie, quale prende il
// puntatore, come tirarle ridimensiona e come gira la rotazione.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import { apply, compose, IDENTITY, rotate, translate, type Matrix, type Point } from "../scene/matrix";
import {
  angleOf,
  edgeView,
  frameCenter,
  frameGuides,
  frameSize,
  frameView,
  gridSnap,
  gripAt,
  gripCursor,
  normalized,
  resized,
  resizeMatrix,
  rotation,
  rotationMatrix,
  type Frame,
  type FrameView,
  type ResizeOptions,
} from "./frame";
import { GuideIndex, type GuideTarget } from "./guides";

const box = (x1: number, y1: number, x2: number, y2: number): Bounds => ({ min: [x1, y1], max: [x2, y2] });

const target = (bounds: Bounds): GuideTarget => ({ kind: "object", box: bounds, key: "" });

const exact = (values: readonly number[]): number[] => values.map((value) => Number(value.toFixed(6)) + 0);

const at = (view: FrameView, grip: string): number[] => exact(view.spots.find((spot) => spot.grip === grip)!.at);

/// I bordi di un riquadro, a meno dell'ultima cifra della virgola mobile.
const edges = (bounds: Bounds): number[] => exact([...bounds.min, ...bounds.max]);

const grips = (view: FrameView): string[] => view.spots.map((spot) => spot.grip);

/// Un rettangolo di 100 per 50 senza contorno, dritto.
const UPRIGHT: Frame = { matrix: IDENTITY, box: box(100, 100, 200, 150), geometry: box(100, 100, 200, 150) };

const FREE: ResizeOptions = { ratio: false, fromCenter: false, minimum: [1, 1], snap: null };

describe("le maniglie della cornice", () => {
  it("stanno sul riquadro col margine, e quella che ruota sopra il lato in alto", () => {
    const view = frameView(UPRIGHT, 1)!;
    expect(view.padded).toEqual(box(96, 96, 204, 154));
    expect(grips(view)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"]);
    expect(at(view, "nw")).toEqual([96, 96]);
    expect(at(view, "e")).toEqual([204, 125]);
    expect(at(view, "s")).toEqual([150, 154]);
    expect(exact(view.stem)).toEqual([150, 96]);
    expect(at(view, "rotate")).toEqual([150, 72]);
  });

  it("hanno la stessa misura sullo schermo a ogni zoom", () => {
    const view = frameView(UPRIGHT, 2)!;
    expect(view.padded).toEqual(box(98, 98, 202, 152));
    expect(at(view, "rotate")).toEqual([150, 86]);
  });

  it("perdono quelle di mezzo sui lati corti sullo schermo, non gli angoli", () => {
    const small: Frame = { matrix: IDENTITY, box: box(0, 0, 20, 10), geometry: box(0, 0, 20, 10) };
    expect(grips(frameView(small, 1)!)).toEqual(["nw", "ne", "se", "sw", "rotate"]);
    // Ingrandita, la cornice ha di nuovo spazio.
    expect(grips(frameView(small, 4)!)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"]);
  });

  it("non hanno angoli né lati per l'asse che misura zero, anche se il contorno lo allarga", () => {
    const line: Frame = { matrix: IDENTITY, box: box(99, 99, 201, 101), geometry: box(100, 100, 200, 100) };
    expect(grips(frameView(line, 1)!)).toEqual(["e", "w", "rotate"]);
  });

  it("ruotano con l'oggetto: un quarto di giro porta la maniglia che ruota a destra", () => {
    const turned: Frame = { ...UPRIGHT, matrix: compose(translate(150, 125), compose(rotate(90), translate(-150, -125))) };
    const view = frameView(turned, 1)!;
    expect(at(view, "n")).toEqual([179, 125]);
    expect(at(view, "rotate")).toEqual([203, 125]);
  });

  it("non ci sono per una cornice che schiaccia il piano", () => {
    expect(frameView({ ...UPRIGHT, matrix: [1, 0, 0, 0, 0, 0] }, 1)).toBeNull();
  });
});

describe("la maniglia sotto il puntatore", () => {
  const view = frameView(UPRIGHT, 1)!;

  it("fuori dalla cornice si prende da più lontano col dito che col mouse", () => {
    expect(gripAt(view, [214, 164], 1, "mouse")).toBeNull();
    expect(gripAt(view, [214, 164], 1, "touch")).toBe("se");
    expect(gripAt(view, [209, 159], 1, "mouse")).toBe("se");
  });

  it("dentro la cornice si prende solo da vicino: il resto è dell'oggetto", () => {
    expect(gripAt(view, [200, 150], 1, "touch")).toBe("se");
    expect(gripAt(view, [190, 140], 1, "touch")).toBeNull();
  });

  it("su una cornice piccola, dentro vince sempre l'oggetto", () => {
    const small = frameView({ matrix: IDENTITY, box: box(0, 0, 12, 12), geometry: box(0, 0, 12, 12) }, 1)!;
    expect(gripAt(small, [12, 12], 1, "mouse")).toBeNull();
    expect(gripAt(small, [17, 17], 1, "mouse")).toBe("se");
  });

  it("fra due a portata, la più vicina", () => {
    // Fra il lato in alto e la maniglia che ruota, 24 pixel più su.
    expect(gripAt(view, [150, 86], 1, "touch")).toBe("n");
    expect(gripAt(view, [150, 82], 1, "touch")).toBe("rotate");
  });
});

describe("la cornice di una tavola", () => {
  const sheet = box(0, 0, 400, 200);

  it("ha le maniglie sui bordi, senza margine e senza quella che ruota", () => {
    const view = edgeView(sheet, 1)!;
    expect(view.padded).toEqual(sheet);
    expect(grips(view)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
    expect(at(view, "nw")).toEqual([0, 0]);
    expect(at(view, "e")).toEqual([400, 100]);
    expect(at(view, "s")).toEqual([200, 200]);
  });

  it("su un lato corto sullo schermo ha soltanto gli angoli", () => {
    // A un decimo, 40 per 20 pixel: i lati verticali sono corti.
    expect(grips(edgeView(sheet, 0.1)!)).toEqual(["nw", "n", "ne", "se", "s", "sw"]);
  });

  it("si prende dal bordo, e dentro solo da vicino", () => {
    const view = edgeView(sheet, 1)!;
    expect(gripAt(view, [404, 204], 1, "mouse")).toBe("se");
    expect(gripAt(view, [390, 190], 1, "mouse")).toBeNull();
  });

  it("non c'è a una scala che non è positiva", () => {
    expect(edgeView(sheet, 0)).toBeNull();
  });
});

describe("il cursore di una maniglia", () => {
  it("segue la direzione in cui tira sullo schermo", () => {
    expect(gripCursor(UPRIGHT, "se")).toBe("nwse");
    expect(gripCursor(UPRIGHT, "ne")).toBe("nesw");
    expect(gripCursor(UPRIGHT, "e")).toBe("ew");
    expect(gripCursor(UPRIGHT, "n")).toBe("ns");
    expect(gripCursor(UPRIGHT, "rotate")).toBe("rotate");
  });

  it("gira con la cornice, e un angolo resta in diagonale anche in una cornice lunga", () => {
    expect(gripCursor({ ...UPRIGHT, matrix: rotate(90) }, "e")).toBe("ns");
    expect(gripCursor({ ...UPRIGHT, matrix: rotate(45) }, "e")).toBe("nwse");
    expect(gripCursor({ ...UPRIGHT, box: box(0, 0, 1000, 10) }, "se")).toBe("nwse");
  });
});

describe("ridimensionare", () => {
  const BOX = box(100, 100, 200, 150);

  it("un angolo tira due bordi, e tiene fermo quello opposto", () => {
    expect(edges(resized(BOX, "se", [50, 25], FREE))).toEqual([100, 100, 250, 175]);
    expect(edges(resized(BOX, "nw", [-10, 20], FREE))).toEqual([90, 120, 200, 150]);
  });

  it("un lato ne tira uno solo", () => {
    expect(edges(resized(BOX, "e", [50, 25], FREE))).toEqual([100, 100, 250, 150]);
    expect(edges(resized(BOX, "n", [50, -25], FREE))).toEqual([100, 75, 200, 150]);
  });

  it("dal centro, il bordo opposto si muove al contrario", () => {
    expect(edges(resized(BOX, "e", [20, 0], { ...FREE, fromCenter: true }))).toEqual([80, 100, 220, 150]);
  });

  it("con le proporzioni, il puntatore va sulla diagonale", () => {
    expect(edges(resized(BOX, "se", [50, 0], { ...FREE, ratio: true }))).toEqual([100, 100, 240, 170]);
  });

  it("non scende sotto la misura minima e non ribalta", () => {
    expect(edges(resized(BOX, "e", [-500, 0], FREE))).toEqual([100, 100, 101, 150]);
    expect(edges(resized(BOX, "se", [-500, -500], { ...FREE, ratio: true }))).toEqual([100, 100, 102, 101]);
    // Un lato già più corto del minimo può crescere, non calare.
    const thin = box(0, 0, 0.5, 10);
    expect(edges(resized(thin, "e", [-1, 0], FREE))).toEqual([0, 0, 0.5, 10]);
  });

  it("lascia com'è un asse che misura zero", () => {
    expect(edges(resized(box(100, 100, 200, 100), "se", [50, 25], FREE))).toEqual([100, 100, 250, 100]);
  });

  it("con la griglia porta il bordo sulla riga, e oltre il punto fermo la prima riga dopo", () => {
    const snap = gridSnap(IDENTITY, 20);
    expect(edges(resized(BOX, "e", [33, 0], { ...FREE, snap }))).toEqual([100, 100, 240, 150]);
    expect(edges(resized(BOX, "e", [-95, 0], { ...FREE, snap }))).toEqual([100, 100, 120, 150]);
    // Con le proporzioni comanda l'asse più lungo.
    expect(edges(resized(BOX, "se", [33, 0], { ...FREE, ratio: true, snap }))).toEqual([100, 100, 220, 160]);
  });

  it("con le guide il bordo va sul bersaglio entro la soglia, e fra bersaglio e riga sul più vicino", () => {
    const guides = frameGuides(new GuideIndex([target(box(0, 0, 237, 40))]), IDENTITY, 6, 1);
    // Tirato a 233, il bordo destro si ferma sul 237, a 4 pixel.
    expect(edges(resized(BOX, "e", [33, 0], { ...FREE, guides }))).toEqual([100, 100, 237, 150]);
    // A 12 pixel resta dov'è.
    expect(edges(resized(BOX, "e", [25, 0], { ...FREE, guides }))).toEqual([100, 100, 225, 150]);
    const snap = gridSnap(IDENTITY, 20);
    // La riga 240 è a 7, il bersaglio a 4; a 229 il bersaglio è fuori soglia.
    expect(edges(resized(BOX, "e", [33, 0], { ...FREE, snap, guides }))).toEqual([100, 100, 237, 150]);
    expect(edges(resized(BOX, "e", [29, 0], { ...FREE, snap, guides }))).toEqual([100, 100, 220, 150]);
  });

  it("con le proporzioni si ferma l'asse più vicino al suo bersaglio, sullo schermo", () => {
    const both = frameGuides(new GuideIndex([target(box(250, 0, 300, 10)), target(box(0, 171, 10, 200))]), IDENTITY, 6, 1);
    // Il puntatore porta l'angolo a 247,2 per 173,6: il 171 è a 2,6, il 250 a 2,8.
    expect(edges(resized(BOX, "se", [48, 22], { ...FREE, ratio: true, guides: both }))).toEqual([100, 100, 242, 171]);
    const across = frameGuides(new GuideIndex([target(box(250, 0, 300, 10))]), IDENTITY, 6, 1);
    expect(edges(resized(BOX, "se", [48, 22], { ...FREE, ratio: true, guides: across }))).toEqual([100, 100, 250, 175]);
  });

  it("un bersaglio oltre il bordo fermo non ribalta, e una cornice ruotata non ha guide", () => {
    const index = new GuideIndex([target(box(96, 300, 98, 310))]);
    expect(edges(resized(BOX, "e", [-98, 0], { ...FREE, guides: frameGuides(index, IDENTITY, 6, 1) }))).toEqual([100, 100, 102, 150]);
    expect(frameGuides(index, rotate(30), 6, 1)).toBeNull();
    // Su una cornice scalata la x 118 è la 236 della scena, a uno dal 237.
    const scaled = frameGuides(new GuideIndex([target(box(0, 0, 237, 40))]), [2, 0, 0, 1, 0, 0], 6, 1)!;
    expect(scaled.near(0, 118)).toBe(118.5);
    expect(scaled.pixels(0)).toBe(2);
  });

  it("la griglia segue una cornice scalata o ribaltata, non una ruotata", () => {
    const flipped = gridSnap([-2, 0, 0, 1, 300, 0], 20)!;
    // x della cornice 33 è 234 nella scena: la riga 240 è la x 30.
    expect(flipped.near(0, 33)).toBe(30);
    expect(flipped.beyond(0, 30, 1)).toBe(40);
    expect(gridSnap(rotate(30), 20)).toBeNull();
  });

  it("su una cornice ruotata scala lungo i suoi assi, senza inclinare", () => {
    const turned: Frame = { ...UPRIGHT, matrix: compose(translate(150, 125), compose(rotate(30), translate(-150, -125))) };
    const m = resizeMatrix(turned, BOX, box(100, 100, 250, 150))!;
    const after = compose(m, turned.matrix);
    // Le colonne restano perpendicolari: niente inclinazione.
    expect(Math.abs(after[0] * after[2] + after[1] * after[3])).toBeLessThan(1e-9);
    expect(exact(frameSize({ ...turned, matrix: after }))).toEqual([150, 50]);
    // Il lato sinistro resta dov'era.
    expect(exact(apply(m, apply(turned.matrix, [100, 125])))).toEqual(exact(apply(turned.matrix, [100, 125])));
  });
});

describe("ruotare", () => {
  const PIVOT: Point = [0, 0];
  const FREE_TURN = { step: null, magnet: 0 };

  it("segue l'angolo del puntatore attorno al centro, in senso orario", () => {
    expect(rotation(PIVOT, [0, -10], [10, 0], 0, FREE_TURN)).toBe(90);
    expect(rotation(PIVOT, [0, -10], [-10, 0], 0, FREE_TURN)).toBe(-90);
    expect(rotation(PIVOT, [10, 0], [10, 10 * Math.tan(Math.PI / 9)], 0, FREE_TURN)).toBe(20);
  });

  it("va al decimo di grado, e a passi porta sui multipli l'angolo che avrà", () => {
    expect(rotation(PIVOT, [10, 0], [10, 3.3], 0, FREE_TURN)).toBe(18.3);
    expect(rotation(PIVOT, [10, 0], [10, 3.3], 0, { step: 15, magnet: 0 })).toBe(15);
    // Già ruotato di 10°: il passo lo porta a 30, cioè di 20.
    expect(rotation(PIVOT, [10, 0], [10, 3.3], 10, { step: 15, magnet: 0 })).toBe(20);
  });

  it("si ferma da solo vicino a un angolo retto, se la calamita c'è", () => {
    const at89: Point = [Math.cos((89 * Math.PI) / 180), Math.sin((89 * Math.PI) / 180)];
    expect(rotation(PIVOT, [10, 0], at89, 0, { step: null, magnet: 1.5 })).toBe(90);
    expect(rotation(PIVOT, [10, 0], at89, 0, FREE_TURN)).toBe(89);
    // Un oggetto storto di un grado torna dritto appena lo si gira.
    expect(rotation(PIVOT, [10, 0], [10, 0.001], 1, { step: null, magnet: 1.5 })).toBe(-1);
  });

  it("non gira attorno a sé stesso", () => {
    expect(rotation(PIVOT, PIVOT, [10, 0], 0, FREE_TURN)).toBe(0);
  });

  it("gira attorno al centro della cornice", () => {
    const m = rotationMatrix(frameCenter(UPRIGHT), 90);
    expect(exact(apply(m, [200, 125]))).toEqual([150, 175]);
    expect(exact(apply(m, [150, 125]))).toEqual([150, 125]);
  });
});

describe("gli angoli", () => {
  it("stanno fra -180 escluso e 180", () => {
    expect(normalized(190)).toBe(-170);
    expect(normalized(-180)).toBe(180);
    expect(normalized(540)).toBe(180);
    expect(Object.is(normalized(-0), 0)).toBe(true);
  });

  it("di una cornice sono quelli del suo asse orizzontale", () => {
    const m: Matrix = compose(rotate(-30), [2, 0, 0, 1, 0, 0]);
    expect(Number(angleOf(m).toFixed(9))).toBe(-30);
    expect(angleOf(IDENTITY)).toBe(0);
  });
});
