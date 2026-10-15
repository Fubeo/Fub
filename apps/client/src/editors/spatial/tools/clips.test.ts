import { describe, expect, it } from "vitest";
import { ellipsePath, rectPath, type Bounds } from "../scene/geometry";
import { IDENTITY, translate } from "../scene/matrix";
import { Clip, clipSegment, cut, inflate, intersect, needsBox, Region, type ClipLook, type ClipShape } from "./clips";

const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: [x0, y0], max: [x1, y1] });
const rect = (x: number, y: number, w: number, h: number, radius = 0): ClipShape => ({ segments: rectPath(x, y, w, h, 0, 0), matrix: IDENTITY, fill: true, radius, evenodd: false });
const look = (shapes: readonly ClipShape[], extra: Partial<ClipLook> = {}): ClipLook => ({ mask: false, boxContent: false, transform: IDENTITY, window: null, shapes, ...extra });

describe("i riquadri", () => {
  it("l'intersezione tiene anche ciò che tocca solo un lato, e dà null se non si toccano", () => {
    expect(intersect(box(0, 0, 10, 10), box(5, 5, 20, 20))).toEqual(box(5, 5, 10, 10));
    expect(intersect(box(0, 0, 10, 10), box(2, 2, 4, 4))).toEqual(box(2, 2, 4, 4));
    expect(intersect(box(0, 0, 10, 10), box(10, 0, 20, 10))).toEqual(box(10, 0, 10, 10));
    expect(intersect(box(0, 5, 10, 5), box(0, 0, 10, 10))).toEqual(box(0, 5, 10, 5));
    expect(intersect(box(0, 0, 10, 10), box(11, 0, 20, 10))).toBeNull();
    expect(intersect(box(0, 0, 10, 10), box(0, 11, 10, 20))).toBeNull();
  });

  it("allarga di un tanto per lato, e di zero lascia lo stesso riquadro", () => {
    const b = box(0, 0, 10, 10);
    expect(inflate(b, 0)).toBe(b);
    expect(inflate(b, 2)).toEqual(box(-2, -2, 12, 12));
  });

  it("serve il riquadro dell'elemento se il contenuto o la finestra lo usano", () => {
    expect(needsBox(look([]))).toBe(false);
    expect(needsBox(look([], { boxContent: true }))).toBe(true);
    expect(needsBox(look([], { mask: true, window: { box: false, x: 0, y: 0, width: 1, height: 1 } }))).toBe(false);
    expect(needsBox(look([], { mask: true, window: { box: true, x: -0.1, y: -0.1, width: 1.2, height: 1.2 } }))).toBe(true);
  });
});

describe("tagliare un segmento", () => {
  const area = box(0, 0, 10, 10);

  it("lo lascia com'è se sta dentro", () => {
    const a: [number, number] = [2, 2];
    const b: [number, number] = [8, 5];
    const out = clipSegment(a, b, area, 0)!;
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it("tiene la parte che sta dentro", () => {
    expect(clipSegment([-5, 5], [15, 5], area, 0)).toEqual([[0, 5], [10, 5]]);
    expect(clipSegment([5, 5], [20, 5], area, 0)).toEqual([[5, 5], [10, 5]]);
    expect(clipSegment([-10, -10], [20, 20], area, 0)).toEqual([[0, 0], [10, 10]]);
  });

  it("il margine allarga il riquadro", () => {
    expect(clipSegment([-5, 5], [15, 5], area, 2)).toEqual([[-2, 5], [12, 5]]);
    expect(clipSegment([-5, 5], [-3, 5], area, 2)).toBeNull();
  });

  it("dà null se nessuna parte sta dentro", () => {
    expect(clipSegment([-5, 20], [15, 20], area, 0)).toBeNull();
    expect(clipSegment([11, 0], [11, 10], area, 0)).toBeNull();
    expect(clipSegment([-5, 15], [15, 25], area, 0)).toBeNull();
    // Un segmento di un punto: dentro o fuori.
    expect(clipSegment([5, 5], [5, 5], area, 0)).toEqual([[5, 5], [5, 5]]);
    expect(clipSegment([15, 5], [15, 5], area, 0)).toBeNull();
  });

  it("un segmento sul bordo conta come dentro", () => {
    expect(clipSegment([0, -5], [0, 15], area, 0)).toEqual([[0, 0], [0, 10]]);
  });
});

describe("un ritaglio su un elemento", () => {
  it("ha il riquadro del suo contenuto nella scena, e lo ricorda", () => {
    const clip = new Clip(look([rect(10, 10, 30, 30)]), translate(100, 0), null);
    expect(clip.empty).toBe(false);
    expect(clip.sceneBox()).toEqual(box(110, 10, 140, 40));
    expect(clip.sceneBox()).toBe(clip.sceneBox());
    expect(clip.areaIn(IDENTITY)).toEqual(box(10, 10, 40, 40));
    expect(clip.areaIn(translate(0, 5))).toEqual(box(10, 15, 40, 45));
  });

  it("dà le forme una volta sola, già col riquadro misurato nella scena", () => {
    const clip = new Clip(look([rect(0, 0, 10, 10), rect(20, 0, 10, 10)]), translate(5, 5), null);
    const solids = clip.solids();
    expect(solids).toHaveLength(2);
    expect(clip.solids()).toBe(solids);
    expect(solids[1]!.matrix).toEqual(translate(5, 5));
    expect(solids[1]!.cache?.scene?.bounds).toEqual(box(25, 5, 35, 15));
    expect(solids[0]!.flat).toBeNull();
    expect(clip.covers()).toEqual([solids]);
    expect(clip.windowSolid()).toBeNull();
  });

  it("lega il riquadro delle forme a quello di tutte, col contorno di una maschera", () => {
    const clip = new Clip(look([rect(0, 0, 10, 10, 2), rect(30, 20, 10, 10)]), IDENTITY, null);
    expect(clip.sceneBox()).toEqual(box(-2, -2, 40, 30));
  });

  it("senza forme non lascia vedere niente", () => {
    const clip = new Clip(look([]), IDENTITY, null);
    expect(clip.empty).toBe(true);
    expect(clip.sceneBox()).toBeNull();
    expect(clip.areaIn(translate(1, 1))).toBeNull();
    expect(clip.solids()).toEqual([]);
    expect(clip.covers()).toEqual([]);
  });

  it("una forma che si trasforma da sé conta con la sua matrice", () => {
    const shape: ClipShape = { ...rect(0, 0, 10, 10), matrix: translate(50, 50) };
    expect(new Clip(look([shape]), IDENTITY, null).sceneBox()).toEqual(box(50, 50, 60, 60));
    const circle: ClipShape = { segments: ellipsePath([0, 0], [10, 10]), matrix: translate(20, 20), fill: true, radius: 0, evenodd: false };
    expect(new Clip(look([circle]), IDENTITY, null).sceneBox()).toEqual(box(10, 10, 30, 30));
  });
});

describe("le unità della scatola", () => {
  const unit = look([rect(0.25, 0.25, 0.5, 0.5)], { boxContent: true });

  it("il contenuto va nella scatola dell'elemento", () => {
    const clip = new Clip(unit, IDENTITY, box(20, 10, 60, 90));
    expect(clip.sceneBox()).toEqual(box(30, 30, 50, 70));
  });

  it("la scatola vale prima del transform del ritaglio", () => {
    const clip = new Clip({ ...unit, transform: translate(10, 0) }, IDENTITY, box(20, 10, 60, 90));
    expect(clip.sceneBox()).toEqual(box(40, 30, 60, 70));
    // Nelle coordinate dell'elemento: con la matrice del suo spazio sopra.
    expect(clip.areaIn(translate(0, 100))).toEqual(box(40, 130, 60, 170));
  });

  it("segue la matrice dell'elemento", () => {
    const clip = new Clip(unit, translate(100, 0), box(20, 10, 60, 90));
    expect(clip.sceneBox()).toEqual(box(130, 30, 150, 70));
  });

  it("senza una scatola con area non lascia vedere niente", () => {
    expect(new Clip(unit, IDENTITY, null).empty).toBe(true);
    expect(new Clip(unit, IDENTITY, box(0, 0, 0, 10)).empty).toBe(true);
    expect(new Clip(unit, IDENTITY, box(0, 0, 10, 0)).sceneBox()).toBeNull();
    // Senza unità della scatola, la scatola non serve.
    expect(new Clip(look([rect(0, 0, 5, 5)]), IDENTITY, null).empty).toBe(false);
  });
});

describe("una maschera", () => {
  const content = [rect(0, 0, 200, 200)];
  const standard = look(content, { mask: true, window: { box: true, x: -0.1, y: -0.1, width: 1.2, height: 1.2 } });

  it("senza unità scritte ha la finestra della scatola, allargata di un decimo per lato", () => {
    const clip = new Clip(standard, IDENTITY, box(20, 20, 80, 80));
    expect(clip.sceneBox()).toEqual(box(14, 14, 86, 86));
    expect(clip.covers()).toHaveLength(2);
    expect(clip.windowSolid()).not.toBeNull();
    expect(clip.windowSolid()).toBe(clip.windowSolid());
    expect(clip.windowSolid()!.cache?.scene?.bounds).toEqual(box(14, 14, 86, 86));
  });

  it("con la finestra in unità della pagina non serve la scatola", () => {
    const clip = new Clip(look([rect(30, 0, 100, 100)], { mask: true, window: { box: false, x: 10, y: 10, width: 50, height: 40 } }), IDENTITY, null);
    expect(clip.empty).toBe(false);
    expect(clip.sceneBox()).toEqual(box(30, 10, 60, 50));
  });

  it("una finestra senza area non lascia vedere niente", () => {
    const flat = look(content, { mask: true, window: { box: false, x: 0, y: 0, width: 0, height: 10 } });
    expect(new Clip(flat, IDENTITY, null).empty).toBe(true);
    expect(new Clip(flat, IDENTITY, null).windowSolid()).toBeNull();
    expect(new Clip(flat, IDENTITY, null).covers()).toEqual([]);
  });

  it("senza finestra scritta conta tutto il contenuto", () => {
    const clip = new Clip(look([rect(5, 5, 10, 10)], { mask: true }), translate(1, 1), null);
    expect(clip.sceneBox()).toEqual(box(6, 6, 16, 16));
    expect(clip.covers()).toHaveLength(1);
  });

  it("il contenuto in unità della scatola sta nella scatola, la finestra no se è in unità della pagina", () => {
    const clip = new Clip(look([rect(0, 0, 0.5, 0.5)], { mask: true, boxContent: true, window: { box: false, x: 0, y: 0, width: 35, height: 35 } }), IDENTITY, box(20, 20, 80, 80));
    expect(clip.sceneBox()).toEqual(box(20, 20, 35, 35));
  });
});

describe("la regione di un oggetto", () => {
  const clip = new Clip(look([rect(10, 10, 30, 30)]), translate(100, 0), null);

  it("nella scena è il riquadro del ritaglio", () => {
    expect(new Region(clip, null, true).area("scene")).toEqual(box(110, 10, 140, 40));
  });

  it("nelle coordinate dell'oggetto passa per la sua matrice, o resta nella scena se non si sa", () => {
    // La matrice dell'oggetto è quella dell'elemento del ritaglio: i due spazi coincidono.
    const framed = new Region(clip, IDENTITY, true);
    expect(framed.area("frame")).toEqual(box(10, 10, 40, 40));
    expect(framed.area("frame")).toBe(framed.area("frame"));
    expect(new Region(clip, translate(0, 5), true).area("frame")).toEqual(box(10, 15, 40, 45));
    expect(new Region(clip, null, true).area("frame")).toEqual(box(110, 10, 140, 40));
  });

  it("dopo uno spostamento si muove se è dell'oggetto, e resta dov'è se è di chi lo contiene", () => {
    const m = translate(5, 7);
    expect(new Region(clip, null, true).area(m)).toEqual(box(115, 17, 145, 47));
    expect(new Region(clip, null, false).area(m)).toEqual(box(110, 10, 140, 40));
    const follows = new Region(clip, null, true);
    expect(follows.area(m)).toBe(follows.area(m));
    expect(follows.area(translate(0, 0))).toEqual(box(110, 10, 140, 40));
    expect(follows.area(m)).toEqual(box(115, 17, 145, 47));
  });

  it("un ritaglio senza forme non lascia area in nessuno spazio", () => {
    const none = new Region(new Clip(look([]), IDENTITY, null), IDENTITY, true);
    expect(none.area("scene")).toBeNull();
    expect(none.area("frame")).toBeNull();
    expect(none.area(translate(1, 1))).toBeNull();
  });
});

describe("tagliare un riquadro per le regioni", () => {
  const a = new Region(new Clip(look([rect(0, 0, 50, 50)]), IDENTITY, null), null, true);
  const b = new Region(new Clip(look([rect(30, 30, 50, 50)]), IDENTITY, null), null, false);
  const none = new Region(new Clip(look([]), IDENTITY, null), null, true);

  it("senza regioni lascia il riquadro com'è", () => {
    const whole = box(0, 0, 100, 100);
    expect(cut(whole, [], "scene")).toBe(whole);
  });

  it("tiene ciò che sta dentro tutte", () => {
    expect(cut(box(0, 0, 100, 100), [a], "scene")).toEqual(box(0, 0, 50, 50));
    expect(cut(box(0, 0, 100, 100), [a, b], "scene")).toEqual(box(30, 30, 50, 50));
    expect(cut(box(40, 40, 45, 100), [a, b], "scene")).toEqual(box(40, 40, 45, 50));
  });

  it("dà null se non ne resta niente, o se una regione non lascia niente", () => {
    expect(cut(box(60, 0, 100, 20), [a], "scene")).toBeNull();
    expect(cut(box(0, 0, 10, 10), [a, b], "scene")).toBeNull();
    expect(cut(box(0, 0, 100, 100), [a, none], "scene")).toBeNull();
  });

  it("si misura nello spazio chiesto", () => {
    expect(cut(box(0, 0, 100, 100), [a, b], translate(10, 0))).toEqual(box(30, 30, 60, 50));
  });
});
