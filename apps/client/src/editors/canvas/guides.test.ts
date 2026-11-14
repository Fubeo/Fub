import { describe, expect, it } from "vitest";
import { GUIDE_SCREEN_PX, snapGuides, type GuideRect, type GuideSide } from "./guides";

const ALL: readonly GuideSide[] = ["start", "center", "end"];

/** Una scheda sulla lavagna, in unità. */
const box = (x: number, y: number, width: number, height: number): GuideRect => ({ x, y, width, height });

/** Una guida con la soglia di 6 unità e lo spostamento a tutti i lati. */
function guides(moving: GuideRect, others: readonly GuideRect[], threshold = 6) {
  return snapGuides({ moving, others, threshold, sides: { x: ALL, y: ALL } });
}

describe("guide della lavagna (T71)", () => {
  it("la soglia di serie è 6 px sullo schermo", () => {
    expect(GUIDE_SCREEN_PX).toBe(6);
  });

  it("il bordo iniziale si aggancia al bordo iniziale di un'altra scheda, con la sua linea", () => {
    const result = guides(box(103, 0, 100, 50), [box(100, 200, 80, 50)]);
    expect(result.dx).toBe(-3);
    expect(result.guidedX).toBe(true);
    expect(result.dy).toBe(0);
    expect(result.guidedY).toBe(false);
    const line = result.segments.find((segment) => segment.kind === "edge");
    expect(line).toBeDefined();
    expect(line!.x1).toBe(100);
    expect(line!.x2).toBe(100);
    // La linea va dalla scheda in movimento alla scheda con cui si allinea.
    expect(line!.y1).toBe(0);
    expect(line!.y2).toBe(250);
  });

  it("il bordo finale si aggancia al bordo finale, e il centro al centro", () => {
    // Il bordo finale della scheda (100) sta a 2 dal bordo finale dell'altra (102):
    // il bordo iniziale è a 20 da quello dell'altra, il centro a 9: vince il finale.
    const end = guides(box(0, 0, 100, 50), [box(-20, 200, 122, 50)]);
    expect(end.dx).toBe(2);
    const centre = guides(box(95, 0, 100, 50), [box(100, 200, 90, 50)]);
    // Il centro (145) coincide: vince con scarto zero, prima del bordo a 5.
    expect(centre.dx).toBe(0);
    expect(centre.guidedX).toBe(true);
    expect(centre.segments.some((segment) => segment.kind === "center")).toBe(true);
  });

  it("entro la soglia la guida si prende, fuori no", () => {
    const inside = guides(box(106, 0, 100, 50), [box(100, 200, 80, 50)]);
    expect(inside.guidedX).toBe(true);
    expect(inside.dx).toBe(-6);
    const outside = guides(box(107, 0, 100, 50), [box(100, 200, 80, 50)]);
    expect(outside.guidedX).toBe(false);
    expect(outside.dx).toBe(0);
    expect(outside.segments).toEqual([]);
  });

  it("vince la guida più vicina su ogni asse", () => {
    // Il bordo iniziale della scheda (96) è a 4 dal bordo iniziale di A (100) e
    // a 1 dal bordo finale di B (97): vince B, con la linea di un bordo.
    const result = guides(box(96, 0, 100, 50), [box(100, 300, 40, 40), box(-3, 500, 100, 40)]);
    expect(result.dx).toBe(1);
    expect(result.segments.every((segment) => segment.kind !== "gap")).toBe(true);
  });

  it("a parità di distanza un bordo prevale sullo spazio uguale", () => {
    // P (0–100) e Q (200–300) con spazio 100: lo spazio «dopo Q» porta a 400. Una
    // terza scheda ha il bordo iniziale a 400 e sta fuori dalla fila: stessa
    // distanza (3), vince il bordo; lo spazio resta fra le linee mostrate.
    const others = [box(0, 0, 100, 50), box(200, 0, 100, 50), box(400, 200, 50, 50)];
    const result = guides(box(397, 0, 50, 50), others);
    expect(result.dx).toBe(3);
    expect(result.segments.some((segment) => segment.kind === "edge")).toBe(true);
  });

  it("tre schede in fila: la terza va alla stessa distanza dalla seconda che la seconda dalla prima", () => {
    // P (0–100), Q (200–300): spazio di 100. La scheda va dopo Q con spazio 100,
    // cioè a 400; la mettiamo a 403 e la guida la porta a 400.
    const result = guides(box(403, 0, 50, 50), [box(0, 0, 100, 50), box(200, 0, 100, 50)]);
    expect(result.dx).toBe(-3);
    expect(result.guidedX).toBe(true);
    const gaps = result.segments.filter((segment) => segment.kind === "gap");
    // Lo spazio di riferimento (100–200) e quello nuovo (300–400), sulla stessa riga.
    expect(gaps.map((segment) => [segment.x1, segment.x2])).toEqual([[100, 200], [300, 400]]);
    expect(gaps[0]!.y1).toBe(gaps[0]!.y2);
    expect(gaps[1]!.y1).toBe(gaps[0]!.y1);
  });

  it("la scheda prima della coppia, con lo stesso spazio", () => {
    // P a 200–300, Q a 400–500: spazio 100. La scheda prima di P sta con il
    // lato finale a 100, cioè parte da 50 se è larga 50: la mettiamo a 47.
    const result = guides(box(47, 0, 50, 50), [box(200, 0, 100, 50), box(400, 0, 100, 50)]);
    expect(result.dx).toBe(3);
    expect(result.segments.filter((segment) => segment.kind === "gap").map((segment) => [segment.x1, segment.x2])).toContainEqual([100, 200]);
  });

  it("in mezzo a due schede: due spazi uguali", () => {
    // P (0–100), Q (300–400): spazio di 200. Una scheda larga 50 sta in mezzo
    // con spazi di 75: parte da 175. La mettiamo a 172.
    const result = guides(box(172, 0, 50, 50), [box(0, 0, 100, 50), box(300, 0, 100, 50)]);
    expect(result.dx).toBe(3);
    const gaps = result.segments.filter((segment) => segment.kind === "gap").map((segment) => [segment.x1, segment.x2]);
    expect(gaps).toEqual([[100, 175], [225, 300]]);
  });

  it("lo spazio uguale vale solo per schede in fila, e non fra schede che si sovrappongono", () => {
    // Stessa distanza, ma P e Q non stanno su una riga con la scheda in movimento.
    const far = guides(box(403, 0, 50, 50), [box(0, 300, 100, 50), box(200, 300, 100, 50)]);
    expect(far.segments.some((segment) => segment.kind === "gap")).toBe(false);
    // P e Q sovrapposte: lo spazio è negativo, non c'è niente da uguagliare.
    const overlapping = guides(box(303, 0, 50, 50), [box(0, 0, 100, 50), box(50, 0, 100, 50)]);
    expect(overlapping.segments.some((segment) => segment.kind === "gap")).toBe(false);
  });

  it("il ridimensionamento porta solo il lato che tira", () => {
    // La scheda finisce a 205, il bordo iniziale di A è a 200: tirando solo il
    // lato finale si aggancia a -5; tirando il lato iniziale no, anche se è vicino.
    const others = [box(200, 300, 50, 50)];
    const end = snapGuides({ moving: box(0, 0, 205, 50), others, threshold: 6, sides: { x: ["end"], y: [] } });
    expect(end.dx).toBe(-5);
    expect(end.guidedX).toBe(true);
    const start = snapGuides({ moving: box(203, 0, 100, 50), others, threshold: 6, sides: { x: ["end"], y: [] } });
    expect(start.guidedX).toBe(false);
  });

  it("senza lati su un asse, quell'asse non si aggancia", () => {
    const result = snapGuides({ moving: box(103, 103, 100, 50), others: [box(100, 100, 50, 50)], threshold: 6, sides: { x: ALL, y: [] } });
    expect(result.dx).toBe(-3);
    expect(result.guidedY).toBe(false);
    expect(result.dy).toBe(0);
  });

  it("senza altre schede, o con soglia nulla, niente guida", () => {
    expect(guides(box(0, 0, 10, 10), [])).toEqual({ dx: 0, dy: 0, guidedX: false, guidedY: false, segments: [] });
    expect(snapGuides({ moving: box(1, 1, 10, 10), others: [box(0, 0, 10, 10)], threshold: 0, sides: { x: ALL, y: ALL } }).guidedX).toBe(false);
  });

  it("due bordi allineati alla stessa coordinata danno due linee", () => {
    // Il bordo iniziale sta a 100 su P (sopra) e su Q (più in basso): due linee.
    const result = guides(box(100, 0, 60, 50), [box(100, -100, 40, 40), box(100, 200, 40, 200)]);
    expect(result.dx).toBe(0);
    expect(result.guidedX).toBe(true);
    expect(result.segments.filter((segment) => segment.kind === "edge" && segment.x1 === 100)).toHaveLength(2);
  });
});
