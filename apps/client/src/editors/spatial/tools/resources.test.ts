// Le risorse viste dall'editor: dove stanno, dove vanno le nuove, chi le usa,
// il campione del pannello, il colore di una sfumatura in un punto, e le
// copie delle private.

import { describe, expect, it } from "vitest";
import { elementChildren, type ContainerNode, type ElementPart } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { elemOf, plainAttributes } from "./arrange";
import { NewIds } from "./edit";
import { gradientColor, gradientOf, holdsEffect, homeOf, paintCode, paintSample, privateResources, resourceHome, resourcesOf, ResourceCopies, usersOf } from "./resources";
import { LAYER, open, type Opened } from "./test-support";

const STOP = '<stop offset="0" stop-color="#ffffff"/>';

/// L'elemento di id `id`.
function node(opened: Opened, id: string): ElementPart {
  const found = opened.engine.holder(id);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  return found;
}

describe("dove stanno le risorse", () => {
  it("sono i figli delle defs della radice; di due con lo stesso id vale la prima", () => {
    const opened = open(
      doc(
        `<defs><linearGradient id="rgggggggg">${STOP}</linearGradient><title>Risorse</title></defs>` +
          `<defs id="altre"><linearGradient id="rhhhhhhhh">${STOP}</linearGradient></defs>${LAYER}</g>`,
      ),
    );
    expect([...resourcesOf(opened.engine.model!).keys()]).toEqual(["rgggggggg", "rhhhhhhhh"]);
  });

  it("le nuove vanno nella defs di FubDraw, o nella prima della radice con un id", () => {
    const fub = open(doc(`<defs id="altre"></defs><defs id="fub-defs"></defs>${LAYER}</g>`));
    expect(resourceHome(fub.engine.model!)!.facts.id).toBe("fub-defs");
    expect(homeOf(fub.engine.model!)).toEqual({ parent: "fub-defs", prelude: [] });
    const other = open(doc(`<defs></defs><defs id="altre"></defs>${LAYER}</g>`));
    expect(homeOf(other.engine.model!)).toEqual({ parent: "altre", prelude: [] });
  });

  it("senza una defs con un id, il comando crea quella di FubDraw per prima", () => {
    const opened = open(doc(`<defs></defs>${LAYER}</g>`));
    expect(resourceHome(opened.engine.model!)).toBeNull();
    expect(homeOf(opened.engine.model!)).toEqual({
      parent: "fub-defs",
      prelude: [{ op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } }],
    });
  });
});

describe("chi usa le risorse", () => {
  const DEFS = `<defs id="fub-defs"><linearGradient id="rgggggggg">${STOP}</linearGradient><clipPath id="rcccccccc"><circle cx="5" cy="5" r="5"/></clipPath></defs>`;

  it("un ritaglio, una maschera o un filtro sono effetti; un colore no", () => {
    expect(holdsEffect(new Map([["clip-path", "url(#rcccccccc)"]]))).toBe(true);
    expect(holdsEffect(new Map([["filter", " url(#rffffffff) "]]))).toBe(true);
    expect(holdsEffect(new Map([["mask", "none"]]))).toBe(false);
    expect(holdsEffect(new Map([["fill", "url(#rgggggggg)"]]))).toBe(false);
  });

  it("li usa chi li nomina: un elemento una volta sola, un'unità con ciò che contiene", () => {
    const opened = open(
      doc(
        `${DEFS}${LAYER}<rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" clip-path="url(#rcccccccc)" fill="url(#rgggggggg)" stroke="url(#rgggggggg)"/>` +
          '<g id="obbbbbbbb" fill="url(#rgggggggg)"><rect x="0" y="0" width="5" height="5"/></g>' +
          '<text id="occcccccc" x="0" y="20"><tspan x="0" dy="0" fill="url(#rgggggggg)">Ciao</tspan></text></g>',
      ),
    );
    const users = usersOf(opened.engine.model!);
    expect(users.get("rgggggggg")).toBe(3);
    expect(users.get("rcccccccc")).toBe(1);
    expect(holdsEffect(plainAttributes(node(opened, "oaaaaaaaa")))).toBe(true);
  });
});

describe("il campione del pannello", () => {
  const sample = (resource: string, value = "url(#rgggggggg)"): ReturnType<typeof paintSample> =>
    paintSample(open(doc(`<defs id="fub-defs">${resource}</defs>${LAYER}</g>`)).engine.model!, value);

  it("mostra i punti di una sfumatura, col loro colore e la loro opacità", () => {
    const linear = '<linearGradient id="rgggggggg" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#d55e00" stop-opacity="0.5"/><stop offset="100%" stop-color="#000000"/></linearGradient>';
    expect(sample(linear)).toEqual({
      kind: "gradient",
      image: "linear-gradient(to right, rgb(255 255 255 / 1) 0%, rgb(213 94 0 / 0.5) 50%, rgb(0 0 0 / 1) 100%)",
    });
    const radial = '<radialGradient id="rgggggggg"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></radialGradient>';
    expect(sample(radial, "url(#rgggggggg) #ff0000")!.image).toBe("radial-gradient(circle, rgb(255 255 255 / 1) 0%, rgb(0 0 0 / 1) 100%)");
  });

  it("tiene ogni punto fra 0 e 1, mai prima del precedente, e allarga un punto solo", () => {
    const back = '<linearGradient id="rgggggggg"><stop offset="0.8" stop-color="#ffffff"/><stop offset="0.2" stop-color="#000000"/><stop offset="2" stop-color="#ffffff"/></linearGradient>';
    expect(sample(back)!.image).toBe("linear-gradient(to right, rgb(255 255 255 / 1) 80%, rgb(0 0 0 / 1) 80%, rgb(255 255 255 / 1) 100%)");
    const one = '<linearGradient id="rgggggggg"><stop offset="0.3" stop-color="#d55e00"/></linearGradient>';
    expect(sample(one)!.image).toBe("linear-gradient(to right, rgb(213 94 0 / 1) 30%, rgb(213 94 0 / 1) 100%)");
    expect(sample('<linearGradient id="rgggggggg"/>')).toEqual({ kind: "gradient", image: null });
  });

  it("un motivo è un motivo; un ritaglio o una risorsa che non c'è non hanno campione", () => {
    const pattern = '<pattern id="rgggggggg" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="#000000"/></pattern>';
    expect(sample(pattern)).toEqual({ kind: "pattern", image: null });
    expect(sample('<clipPath id="rgggggggg"/>')).toBeNull();
    expect(sample(pattern, "url(#altro)")).toBeNull();
    expect(sample(pattern, "#ff0000")).toBeNull();
  });

  it("un campione del documento ha il suo nome, com'è scritto, e il suo colore", () => {
    const swatch = '<linearGradient id="rgggggggg" fub:role="swatch" fub:name="Blu  mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072B2"/></linearGradient>';
    expect(sample(swatch, "url(#rgggggggg) #000000")).toEqual({ kind: "swatch", image: null, name: "Blu  mare", color: "#0072b2" });
    // Con due punti non è un campione: è la sfumatura che si vede.
    const two = `<linearGradient id="rgggggggg" fub:role="swatch" fub:name="Blu">${STOP}<stop offset="1" stop-color="#000000"/></linearGradient>`;
    expect(sample(two)!.kind).toBe("gradient");
  });
});

describe("il colore di una sfumatura in un punto", () => {
  const WHITE_BLACK = '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/>';
  /// La sfumatura `resource`, di id `rgggggggg`, letta per il colore.
  const gradient = (resource: string): ReturnType<typeof gradientOf> =>
    gradientOf(resourcesOf(open(doc(`<defs id="fub-defs">${resource}</defs>${LAYER}</g>`)).engine.model!).get("rgggggggg")!);
  const BOX = { min: [0, 0] as const, max: [100, 50] as const };

  it("lungo una sfumatura lineare nel riquadro, coi colori mescolati fra due punti", () => {
    const g = gradient(`<linearGradient id="rgggggggg">${WHITE_BLACK}</linearGradient>`)!;
    expect(g).toMatchObject({ kind: "linear", coords: [0, 0, 1, 0], inBox: true, spread: "pad" });
    expect(gradientColor(g, [0, 10], BOX)).toEqual([255, 255, 255]);
    expect(gradientColor(g, [25, 40], BOX)).toEqual([191, 191, 191]);
    expect(gradientColor(g, [100, 0], BOX)).toEqual([0, 0, 0]);
    // Oltre i capi resta il colore del capo.
    expect(gradientColor(g, [-50, 0], BOX)).toEqual([255, 255, 255]);
    expect(gradientColor(g, [150, 0], BOX)).toEqual([0, 0, 0]);
    // Un riquadro senza altezza non disegna la sfumatura.
    expect(gradientColor(g, [10, 0], { min: [0, 0], max: [100, 0] })).toBeNull();
    expect(paintCode(gradientColor(g, [50, 0], BOX)!)).toBe("#808080");
  });

  it("nelle coordinate di chi la usa, con la sua trasformazione, e coi punti dove stanno", () => {
    const g = gradient(
      '<linearGradient id="rgggggggg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="40" gradientTransform="translate(100 10)">' +
        '<stop offset="0" stop-color="#ff0000"/><stop offset="25%" stop-color="#00ff00"/><stop offset="1" stop-color="#0000ff"/></linearGradient>',
    )!;
    expect(g.inBox).toBe(false);
    // Il riquadro non conta.
    expect(gradientColor(g, [500, 10], null)).toEqual([255, 0, 0]);
    expect(gradientColor(g, [100, 20], null)).toEqual([0, 255, 0]);
    expect(gradientColor(g, [100, 35], null)).toEqual([0, 128, 128]);
  });

  it("radiale dal fuoco al cerchio, anche col fuoco fuori dal centro", () => {
    const centered = gradient(`<radialGradient id="rgggggggg">${WHITE_BLACK}</radialGradient>`)!;
    const square = { min: [0, 0] as const, max: [100, 100] as const };
    expect(gradientColor(centered, [50, 50], square)).toEqual([255, 255, 255]);
    expect(gradientColor(centered, [75, 50], square)).toEqual([128, 128, 128]);
    expect(gradientColor(centered, [50, 0], square)).toEqual([0, 0, 0]);
    const focal = gradient(`<radialGradient id="rgggggggg" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="50" fx="25" fy="50">${WHITE_BLACK}</radialGradient>`)!;
    expect(gradientColor(focal, [25, 50], null)).toEqual([255, 255, 255]);
    // A metà fra il fuoco e il cerchio, da una parte e dall'altra.
    expect(gradientColor(focal, [12.5, 50], null)).toEqual([128, 128, 128]);
    expect(gradientColor(focal, [62.5, 50], null)).toEqual([128, 128, 128]);
    expect(gradientColor(focal, [100, 50], null)).toEqual([0, 0, 0]);
  });

  it("oltre i capi si ripete o si specchia, come dice `spreadMethod`", () => {
    const at = (spread: string, x: number): unknown =>
      gradientColor(gradient(`<linearGradient id="rgggggggg" gradientUnits="userSpaceOnUse" x2="100" spreadMethod="${spread}">${WHITE_BLACK}</linearGradient>`)!, [x, 0], null);
    expect(at("repeat", 125)).toEqual([191, 191, 191]);
    expect(at("reflect", 125)).toEqual([64, 64, 64]);
    expect(at("reflect", -25)).toEqual([191, 191, 191]);
    expect(at("pad", 125)).toEqual([0, 0, 0]);
  });

  it("due capi uguali danno l'ultimo colore; non è una sfumatura un motivo, né una sfumatura senza punti", () => {
    const flat = gradient(`<linearGradient id="rgggggggg" x2="0">${WHITE_BLACK}</linearGradient>`)!;
    expect(gradientColor(flat, [30, 30], BOX)).toEqual([0, 0, 0]);
    expect(gradient('<pattern id="rgggggggg" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="#000000"/></pattern>')).toBeNull();
    expect(gradient('<linearGradient id="rgggggggg"/>')).toBeNull();
  });
});

describe("le copie delle private", () => {
  it("copiano prima ciò che usano, una volta sola, e lasciano le condivise", () => {
    const opened = open(
      doc(
        '<defs id="fub-defs">' +
          `<linearGradient id="rgggggggg" fub:role="private">${STOP}</linearGradient>` +
          `<linearGradient id="rhhhhhhhh" fub:role="shared">${STOP}</linearGradient>` +
          '<pattern id="rpppppppp" fub:role="private" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="url(#rgggggggg)" stroke="url(#rhhhhhhhh)"/></pattern>' +
          `</defs>${LAYER}<rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" fill="url(#rpppppppp)" stroke="url(#rgggggggg)"/></g>`,
      ),
    );
    const model = opened.engine.model!;
    const copies = new ResourceCopies(model, new NewIds((id) => opened.engine.holder(id) !== null), elemOf);
    const copy = copies.adopt(elemOf(node(opened, "oaaaaaaaa"))!)!;
    // Le copie sono `add` di un elemento.
    const ops = copies.ops() as unknown as ReadonlyArray<{ readonly op: string; readonly parent: string; readonly elem: Elem }>;
    expect(ops.map((op) => op.elem.tag)).toEqual(["linearGradient", "pattern"]);
    const [gradient, pattern] = ops.map((op) => op.elem.attrs.id!);
    expect(copy.attrs.fill).toBe(`url(#${pattern})`);
    expect(copy.attrs.stroke).toBe(`url(#${gradient})`);
    const inner = ops[1]!.elem.children![0]!;
    expect(inner.attrs.fill).toBe(`url(#${gradient})`);
    expect(inner.attrs.stroke).toBe("url(#rhhhhhhhh)");
    // Tutte nella defs che c'è, in fondo.
    expect(ops.every((op) => op.op === "add" && op.parent === "fub-defs")).toBe(true);
    expect(elementChildren(node(opened, "fub-defs") as ContainerNode)).toHaveLength(3);
  });

  describe("per un colore preso da un altro oggetto", () => {
    const DEFS =
      '<defs id="fub-defs">' +
      `<linearGradient id="rgggggggg" fub:role="private" gradientUnits="userSpaceOnUse" x2="10" gradientTransform="translate(0 5)">${STOP}</linearGradient>` +
      `<linearGradient id="rhhhhhhhh" fub:role="shared">${STOP}</linearGradient>` +
      '<pattern id="rpppppppp" fub:role="private" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="url(#rgggggggg)"/></pattern>' +
      "</defs>";
    const setup = (): { opened: Opened; copies: ResourceCopies; adds: () => Elem[] } => {
      const opened = open(doc(`${DEFS}${LAYER}</g>`));
      const copies = new ResourceCopies(opened.engine.model!, new NewIds((id) => opened.engine.holder(id) !== null), elemOf);
      const adds = (): Elem[] => (copies.ops() as unknown as ReadonlyArray<{ readonly elem: Elem }>).map((op) => op.elem);
      return { opened, copies, adds };
    };

    it("ne fanno una copia per chi lo riceve, la stessa per i suoi colori, e lasciano le altre", () => {
      const { copies, adds } = setup();
      const [one, two] = [{}, {}];
      const fill = copies.paint("url(#rgggggggg) #0072b2", one, () => null)!;
      expect(copies.paint("url(#rgggggggg)", one, () => null)).toBe(fill.replace(" #0072b2", ""));
      const other = copies.paint("url(#rgggggggg) #0072b2", two, () => null)!;
      expect(other).not.toBe(fill);
      expect(fill).toMatch(/^url\(#r\w+\) #0072b2$/);
      expect(adds().map((elem) => elem.attrs.id)).toEqual([/#(\w+)/.exec(fill)![1], /#(\w+)/.exec(other)![1]]);
      expect(copies.paint("url(#rhhhhhhhh) none", one, () => null)).toBe("url(#rhhhhhhhh) none");
      expect(copies.paint("#d55e00", one, () => null)).toBe("#d55e00");
      expect(copies.paint("url(#altro) #000000", one, () => null)).toBe("url(#altro) #000000");
    });

    it("adattano una sfumatura nelle coordinate di chi la usa, e un motivo lo copiano com'è con ciò che usa", () => {
      const { copies, adds } = setup();
      let asked = 0;
      const fit = (): [number, number, number, number, number, number] => {
        asked++;
        return [2, 0, 0, 1, 100, 0];
      };
      copies.paint("url(#rgggggggg)", {}, fit);
      expect(adds()[0]!.attrs.gradientTransform).toBe("matrix(2 0 0 1 100 5)");
      copies.paint("url(#rpppppppp)", {}, fit);
      const [, gradient, pattern] = adds();
      // Il motivo non si adatta; la sfumatura dentro di lui non è nelle
      // coordinate di chi usa il motivo, e resta com'era.
      expect(asked).toBe(1);
      expect(pattern!.attrs).not.toHaveProperty("patternTransform");
      expect(gradient!.attrs.gradientTransform).toBe("translate(0 5)");
      expect(pattern!.children![0]!.attrs.fill).toBe(`url(#${gradient!.attrs.id})`);
    });

    it("prendono una risorsa com'era quando lo stile si è copiato, anche se non c'è più", () => {
      const { opened } = setup();
      const model = opened.engine.model!;
      const kept = privateResources(model, ["url(#rpppppppp) #000000", "url(#rhhhhhhhh)", "#ffffff"], elemOf);
      // Il motivo porta con sé la sfumatura che usa; la condivisa resta del
      // disegno.
      expect([...kept.keys()]).toEqual(["rpppppppp", "rgggggggg"]);
      const empty = open(doc(`${LAYER}</g>`));
      const copies = new ResourceCopies(empty.engine.model!, new NewIds(() => false), elemOf, kept);
      expect(copies.paint("url(#rpppppppp) #000000", {}, () => null)).toMatch(/^url\(#r\w+\) #000000$/);
      const ops = copies.ops() as unknown as ReadonlyArray<{ readonly op: string; readonly elem: Elem }>;
      // Senza defs, la crea per prima.
      expect(ops.map((op) => op.elem.tag)).toEqual(["defs", "linearGradient", "pattern"]);
      expect(privateResources(model, ["#ffffff", "none"], elemOf).size).toBe(0);
    });
  });

  it("senza private non fanno niente", () => {
    const opened = open(doc(`${LAYER}<rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" fill="#000000"/></g>`));
    const copies = new ResourceCopies(opened.engine.model!, new NewIds(() => false), elemOf);
    expect(copies.adopt(elemOf(node(opened, "oaaaaaaaa"))!)).toEqual(elemOf(node(opened, "oaaaaaaaa")));
    expect(copies.ops()).toEqual([]);
  });
});
