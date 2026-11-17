import { describe, expect, it } from "vitest";
import { anchorAt, cellAnchorAt, isCellAddress, pageAnchorAt, StrokeBox, strokeBounds, type Bounds } from "./anchor";
import type { CanvasNode } from "./model";
import anchorSource from "./anchor.ts?raw";

function card(id: string, x: number, y: number, width: number, height: number, type: CanvasNode["type"] = "text"): CanvasNode {
  return { id, type, x, y, width, height };
}

const always = (): boolean => true;
const notGroups = (node: CanvasNode): boolean => node.type !== "group";
const box = (x: number, y: number, width: number, height: number): Bounds => ({ x, y, width, height });

describe("strokeBounds", () => {
  it("allarga il riquadro dei punti di metà spessore da ogni lato", () => {
    const points = [
      { x: 10, y: 20 },
      { x: 30, y: 5 },
      { x: 18, y: 40 },
    ];
    expect(strokeBounds(points, 4)).toEqual({ x: 8, y: 3, width: 24, height: 39 });
  });

  it("un tratto di un punto solo ha comunque l'area dello spessore", () => {
    expect(strokeBounds([{ x: 10, y: 20 }], 4)).toEqual({ x: 8, y: 18, width: 4, height: 4 });
  });

  it("accetta qualunque iterabile, anche un generatore", () => {
    function* points(): Generator<{ x: number; y: number }> {
      yield { x: 1, y: 1 };
      yield { x: 3, y: 2 };
    }
    expect(strokeBounds(points(), 2)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  });

  it("uno spessore zero, negativo o non finito conta come zero, mai NaN", () => {
    for (const size of [0, -4, Number.NaN, Infinity, -Infinity]) {
      expect(strokeBounds([{ x: 10, y: 20 }], size), String(size)).toEqual({ x: 10, y: 20, width: 0, height: 0 });
    }
  });

  it("salta i punti non finiti; senza punti utili il riquadro è quello vuoto nell'origine", () => {
    const points = [
      { x: Number.NaN, y: 0 },
      { x: 5, y: 5 },
      { x: Infinity, y: 9 },
      { x: 7, y: -Infinity },
    ];
    expect(strokeBounds(points, 2)).toEqual({ x: 4, y: 4, width: 2, height: 2 });
    expect(strokeBounds([], 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(strokeBounds([{ x: Number.NaN, y: Number.NaN }], 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("oltre 2^53 arrotonda come i double, senza NaN", () => {
    // 2^53 + 1 cade a metà fra 2^53 e 2^53 + 2 e va al pari (2^53); 2^53 + 3
    // cade a metà fra 2^53 + 2 e 2^53 + 4 e va al pari (2^53 + 4).
    expect(strokeBounds([{ x: 2 ** 53 + 2, y: 2 }], 2)).toEqual({ x: 2 ** 53, y: 1, width: 4, height: 2 });
  });

  it("ai limiti di number la larghezza diventa infinita ma non NaN", () => {
    const b = strokeBounds(
      [
        { x: -Number.MAX_VALUE, y: 0 },
        { x: Number.MAX_VALUE, y: 0 },
      ],
      2,
    );
    expect(b).toEqual({ x: -Number.MAX_VALUE, y: -1, width: Infinity, height: 2 });
  });
});

describe("StrokeBox", () => {
  it("un punto alla volta dà lo stesso riquadro di strokeBounds, anche coi punti non finiti", () => {
    const points = [
      { x: 10, y: 20 },
      { x: Number.NaN, y: 0 },
      { x: 30, y: 5 },
      { x: Infinity, y: 9 },
      { x: 18, y: 40 },
    ];
    const box = new StrokeBox();
    for (let i = 0; i < points.length; i++) {
      box.add(points[i]!.x, points[i]!.y);
      for (const size of [0, 4, -1, Number.NaN]) expect(box.bounds(size)).toEqual(strokeBounds(points.slice(0, i + 1), size));
    }
    expect(new StrokeBox().bounds(4)).toEqual(strokeBounds([], 4));
  });

  it("add dice se il riquadro è cresciuto: un punto dentro, ripetuto o non finito no", () => {
    const box = new StrokeBox();
    expect(box.add(10, 10)).toBe(true);
    expect(box.add(10, 10)).toBe(false);
    expect(box.add(20, 5)).toBe(true);
    expect(box.add(15, 8)).toBe(false);
    expect(box.add(Number.NaN, 100)).toBe(false);
    expect(box.add(15, 11)).toBe(true);
  });
});

describe("anchorAt", () => {
  const sheet = card("a", 0, 0, 100, 100);

  it("un tratto dentro una scheda è suo; sul vuoto o senza schede è libero", () => {
    expect(anchorAt([sheet], box(40, 40, 20, 20), always)).toBe(sheet);
    expect(anchorAt([sheet], box(300, 300, 20, 20), always)).toBeNull();
    expect(anchorAt([], box(40, 40, 20, 20), always)).toBeNull();
  });

  it("il centro esattamente sul bordo conta dentro", () => {
    // Centro (100, 50) sul bordo destro, metà esatta del riquadro dentro.
    expect(anchorAt([sheet], box(90, 40, 20, 20), always)).toBe(sheet);
    // Centro (50, 0) sul bordo alto.
    expect(anchorAt([sheet], box(40, -10, 20, 20), always)).toBe(sheet);
    // Centro (100, 100) sull'angolo: è dentro, ma ci sta solo un quarto.
    expect(anchorAt([sheet], box(90, 90, 20, 20), always)).toBeNull();
    // Mezzo pixel più in là il centro è fuori e dentro ne sta meno di metà.
    expect(anchorAt([sheet], box(90.5, 40, 20, 20), always)).toBeNull();
  });

  it("metà esatta dell'area basta, meno di metà no", () => {
    // Un riquadro alto il doppio della scheda: dentro c'è 0,5 esatto e il centro
    // (5, 10) sta sul bordo basso.
    const small = card("s", 0, 0, 10, 10);
    expect(anchorAt([small], box(0, 0, 10, 20), always)).toBe(small);
    // Alto 20,5: dentro 10/20,5 < 0,5 e il centro (5, 10,25) è fuori.
    expect(anchorAt([small], box(0, 0, 10, 20.5), always)).toBeNull();
  });

  it("il centro dentro non basta se dentro sta meno di metà", () => {
    // Una striscia sottile: largo 200 e alto 10, centro (50, 50), dentro 100/200
    // in orizzontale per 1 in verticale = 0,5: suo. Largo 202: 100/202 < 0,5.
    expect(anchorAt([sheet], box(-50, 45, 200, 10), always)).toBe(sheet);
    expect(anchorAt([sheet], box(-51, 45, 202, 10), always)).toBeNull();
  });

  it("un tratto di un punto solo", () => {
    expect(anchorAt([sheet], strokeBounds([{ x: 30, y: 30 }], 4), always)).toBe(sheet);
    expect(anchorAt([sheet], strokeBounds([{ x: 101, y: 30 }], 4), always)).toBeNull();
    // Sul bordo: metà dentro e centro sul bordo.
    expect(anchorAt([sheet], strokeBounds([{ x: 100, y: 30 }], 4), always)).toBe(sheet);
  });

  it("un riquadro senza area è un punto sull'asse che non ha lunghezza", () => {
    // Spessore zero: il punto è dentro (bordi compresi) o fuori.
    expect(anchorAt([sheet], strokeBounds([{ x: 30, y: 30 }], 0), always)).toBe(sheet);
    expect(anchorAt([sheet], strokeBounds([{ x: 100, y: 100 }], 0), always)).toBe(sheet);
    expect(anchorAt([sheet], strokeBounds([{ x: 100.001, y: 30 }], Number.NaN), always)).toBeNull();
    // Una riga orizzontale senza spessore: conta solo la lunghezza dentro.
    expect(anchorAt([sheet], box(-20, 50, 140, 0), always)).toBe(sheet);
    expect(anchorAt([sheet], box(-80, 50, 140, 0), always)).toBeNull();
    expect(anchorAt([sheet], box(-20, 100.5, 140, 0), always)).toBeNull();
  });

  it("un gruppo sotto un figlio: sul figlio è del figlio, sul vuoto del gruppo è del gruppo", () => {
    const group = card("g", 0, 0, 400, 400, "group");
    const child = card("c", 100, 100, 100, 100);
    const nodes = [group, child];
    expect(anchorAt(nodes, box(140, 140, 20, 20), always)).toBe(child);
    expect(anchorAt(nodes, box(300, 300, 20, 20), always)).toBe(group);
    // Toccato il figlio, il gruppo sotto non conta più.
    expect(anchorAt(nodes, box(190, 140, 40, 20), always)).toBeNull();
  });

  it("con canHold falso sui gruppi: sul figlio è del figlio, sul vuoto del gruppo è libero", () => {
    const group = card("g", 0, 0, 400, 400, "group");
    const child = card("c", 100, 100, 100, 100);
    const nodes = [group, child];
    expect(anchorAt(nodes, box(140, 140, 20, 20), notGroups)).toBe(child);
    expect(anchorAt(nodes, box(300, 300, 20, 20), notGroups)).toBeNull();
  });

  it("due schede uguali sovrapposte: vince l'ultima", () => {
    const first = card("uno", 0, 0, 100, 100);
    const second = card("due", 0, 0, 100, 100);
    expect(anchorAt([first, second], box(40, 40, 20, 20), always)).toBe(second);
    expect(anchorAt([second, first], box(40, 40, 20, 20), always)).toBe(first);
  });

  it("canHold falso sulla più alta resta libero anche se una sotto andrebbe bene", () => {
    const below = card("sotto", 0, 0, 100, 100);
    const above = card("sopra", 20, 20, 60, 60);
    const asked: string[] = [];
    const refuseAbove = (node: CanvasNode): boolean => {
      asked.push(node.id);
      return node.id !== "sopra";
    };
    expect(anchorAt([below, above], box(40, 40, 20, 20), refuseAbove)).toBeNull();
    expect(asked).toEqual(["sopra"]);
  });

  it("solo la più alta toccata conta, anche se il tratto è quasi tutto su una sotto", () => {
    const below = card("sotto", 0, 0, 100, 100);
    const above = card("sopra", 55, 0, 100, 100);
    // Il riquadro 40..60 tocca "sopra" per un quarto: la più alta toccata è lei e
    // non lo prende, quindi il tratto è libero.
    expect(anchorAt([below, above], box(40, 40, 20, 20), always)).toBeNull();
  });

  it("una scheda che tocca il riquadro solo sul bordo non lo tocca", () => {
    const below = card("sotto", 0, 0, 100, 100);
    const beside = card("accanto", 60, 0, 100, 100);
    expect(anchorAt([below, beside], box(40, 40, 20, 20), always)).toBe(below);
  });

  it("le schede con misure non finite o non positive non toccano niente", () => {
    const below = card("sotto", 0, 0, 100, 100);
    const broken = [
      card("nan-x", Number.NaN, 0, 100, 100),
      card("inf-y", 0, -Infinity, 100, 100),
      card("zero", 0, 0, 0, 100),
      card("negativa", 0, 0, 100, -100),
      card("nan-alta", 0, 0, 100, Number.NaN),
      card("infinita", 0, 0, Infinity, 100),
    ];
    for (const node of broken) {
      expect(anchorAt([below, node], box(40, 40, 20, 20), always), node.id).toBe(below);
    }
  });

  it("un riquadro con misure non finite o negative è libero", () => {
    for (const b of [
      box(Number.NaN, 0, 10, 10),
      box(0, Infinity, 10, 10),
      box(0, 0, Infinity, 10),
      box(0, 0, 10, Number.NaN),
      box(10, 10, -5, 10),
    ]) {
      expect(anchorAt([sheet], b, always), JSON.stringify(b)).toBeNull();
    }
  });

  it("coordinate oltre 2^53: si ottiene l'arrotondamento dei double, mai NaN né eccezioni", () => {
    // Scheda 2^53..2^53+4: il punto 2^53+2 con spessore 2 dà 2^53..2^53+4,
    // tutto dentro.
    const far = card("lontana", 2 ** 53, 0, 4, 4);
    expect(anchorAt([far], strokeBounds([{ x: 2 ** 53 + 2, y: 2 }], 2), always)).toBe(far);
    // Larga 1 a 2^53: 2^53 + 1 torna 2^53, sull'asse la scheda non ha
    // lunghezza e un riquadro lungo non la tocca.
    const thin = card("sottile", 2 ** 53, 0, 1, 4);
    expect(anchorAt([thin], box(2 ** 53, 0, 4, 4), always)).toBeNull();
    // Schede e riquadri enormi: le aree non traboccano in Infinity/Infinity.
    const huge = card("enorme", 0, 0, 1e200, 1e200);
    expect(anchorAt([huge], box(0, 0, 1e200, 1e200), always)).toBe(huge);
    expect(anchorAt([huge], box(0, 0, 2e200, 1e200), always)).toBe(huge);
    expect(anchorAt([huge], box(0, 0, 3e200, 1e200), always)).toBeNull();
    // Una scheda il cui bordo trabocca in Infinity contiene ancora il riquadro.
    const edge = card("bordo", Number.MAX_VALUE / 2, 0, Number.MAX_VALUE, 10);
    expect(anchorAt([edge], box(Number.MAX_VALUE / 2, 0, 1e300, 10), always)).toBe(edge);
    // Il riquadro di larghezza infinita di strokeBounds è libero.
    const wide = strokeBounds(
      [
        { x: -Number.MAX_VALUE, y: 0 },
        { x: Number.MAX_VALUE, y: 0 },
      ],
      2,
    );
    expect(anchorAt([card("tutto", -Number.MAX_VALUE, -10, Number.MAX_VALUE, 20)], wide, always)).toBeNull();
  });
});

describe("pageAnchorAt (T19)", () => {
  const pdf = card("p", 100, 50, 300, 460, "file");
  const page = { page: 3, size: { width: 595, height: 842 }, rect: box(0, 36, 300, 424) };

  it("un tratto che comincia sulla pagina prende la pagina, i bordi compresi", () => {
    expect(pageAnchorAt(pdf, page, { x: 250, y: 200 })).toBe(page);
    expect(pageAnchorAt(pdf, page, { x: 100, y: 86 })).toBe(page);
    expect(pageAnchorAt(pdf, page, { x: 400, y: 510 })).toBe(page);
  });

  it("sulla scheda ma fuori dalla pagina, o senza pagina, niente: l'ancora resta card", () => {
    // Sulla testata, sopra la pagina.
    expect(pageAnchorAt(pdf, page, { x: 250, y: 60 })).toBeNull();
    expect(pageAnchorAt(pdf, null, { x: 250, y: 200 })).toBeNull();
    expect(pageAnchorAt(pdf, undefined, { x: 250, y: 200 })).toBeNull();
    expect(pageAnchorAt(pdf, page, undefined)).toBeNull();
  });

  it("conta dove comincia, non dove finisce", () => {
    const start = { x: 250, y: 500 };
    expect(pageAnchorAt(pdf, page, start)).toBe(page);
  });

  it("una pagina che non vale non prende niente", () => {
    const start = { x: 250, y: 200 };
    expect(pageAnchorAt(pdf, { ...page, page: 0 }, start)).toBeNull();
    expect(pageAnchorAt(pdf, { ...page, page: 1.5 }, start)).toBeNull();
    expect(pageAnchorAt(pdf, { ...page, size: { width: 0, height: 842 } }, start)).toBeNull();
    expect(pageAnchorAt(pdf, { ...page, rect: box(0, 36, 300, 0) }, start)).toBeNull();
    expect(pageAnchorAt(pdf, { ...page, rect: box(Number.NaN, 36, 300, 424) }, start)).toBeNull();
    expect(pageAnchorAt(card("zero", 100, 50, 0, 460, "file"), page, start)).toBeNull();
  });
});

describe("cellAnchorAt (T37)", () => {
  const sheet = card("f", 100, 50, 480, 320, "file");
  const b3 = { sheet: "Foglio1", cell: "B3", rect: box(60, 70, 40, 12), zoom: 1 };
  /// La griglia di prova: B3 fra (60, 70) e (100, 82) dall'angolo della
  /// scheda; sopra y = 20 le intestazioni.
  const grid = (point: { x: number; y: number }) =>
    point.y < 20 ? null : point.x >= 60 && point.x <= 100 && point.y >= 70 && point.y <= 82 ? b3 : { ...b3, cell: "A1", rect: box(0, 20, 60, 12) };

  it("un tratto prende la cella sotto il centro del suo riquadro, in unità dall'angolo della scheda", () => {
    const seen: { x: number; y: number }[] = [];
    const spy = (point: { x: number; y: number }) => {
      seen.push(point);
      return grid(point);
    };
    // Comincia in A1 (x 140 → 40) ma il centro sta in B3.
    expect(cellAnchorAt(sheet, box(140, 120, 70, 10), spy)).toBe(b3);
    expect(seen).toEqual([{ x: 75, y: 75 }]);
  });

  it("sopra le intestazioni, su una scheda che non è un foglio o con una cella che non vale, niente: l'ancora resta card", () => {
    expect(cellAnchorAt(sheet, box(170, 55, 10, 4), grid)).toBeNull();
    expect(cellAnchorAt(sheet, box(170, 120, 10, 4), null)).toBeNull();
    expect(cellAnchorAt(sheet, box(170, 120, 10, 4), undefined)).toBeNull();
    for (const bad of [
      { ...b3, sheet: "" },
      { ...b3, cell: "A0" },
      { ...b3, cell: "b3" },
      { ...b3, rect: box(60, 70, 0, 12) },
      { ...b3, rect: box(Number.NaN, 70, 40, 12) },
      { ...b3, zoom: 0 },
      { ...b3, zoom: Number.NaN },
    ]) {
      expect(cellAnchorAt(sheet, box(170, 120, 10, 4), () => bad), JSON.stringify(bad)).toBeNull();
    }
    expect(cellAnchorAt(card("zero", 100, 50, 0, 320, "file"), box(170, 120, 10, 4), grid)).toBeNull();
    expect(cellAnchorAt(sheet, box(Number.NaN, 120, 10, 4), grid)).toBeNull();
  });

  it("isCellAddress: A1 in maiuscolo, da A1 a XFD1048576", () => {
    for (const ok of ["A1", "B3", "Z26", "AA1", "XFD1048576", "XFC1"]) expect(isCellAddress(ok), ok).toBe(true);
    for (const no of ["", "A0", "B", "3", "b3", "$B$3", "B03", "XFE1", "AAAA1", "A1048577", " B3", "B3 ", 3, null]) {
      expect(isCellAddress(no), String(no)).toBe(false);
    }
  });
});

describe("il confine di anchor.ts", () => {
  it("importa solo il modello, come tipo, e non usa globali del DOM", () => {
    const code = anchorSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = [...code.matchAll(/^\s*import\s[^;]*;/gm)].map(([line]) => line.trim());
    expect(imports).toEqual(['import type { CanvasNode } from "./model";']);
    expect(code).not.toMatch(/\b(?:document|window|navigator|globalThis|HTMLElement|Element|DOMRect|PointerEvent|addEventListener|requestAnimationFrame)\b/);
  });
});
