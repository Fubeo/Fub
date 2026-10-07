// Le risorse viste dall'editor: dove stanno, dove vanno le nuove, chi le usa,
// il campione del pannello, e le copie delle private.

import { describe, expect, it } from "vitest";
import { elementChildren, type ContainerNode, type ElementPart } from "../scene/model";
import type { Elem } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { elemOf, plainAttributes } from "./arrange";
import { NewIds } from "./edit";
import { holdsEffect, homeOf, paintSample, resourceHome, resourcesOf, ResourceCopies, usesResources } from "./resources";
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

  it("li usa chi li nomina, o chi eredita un colore che è una risorsa", () => {
    const opened = open(
      doc(
        `${DEFS}${LAYER}<rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" clip-path="url(#rcccccccc)"/>` +
          '<rect id="obbbbbbbb" x="0" y="0" width="5" height="5" fill="#000000"/></g>',
      ),
    );
    const none = new Map<string, string>();
    expect(usesResources(node(opened, "oaaaaaaaa"), none)).toBe(true);
    expect(usesResources(node(opened, "obbbbbbbb"), none)).toBe(false);
    expect(usesResources(node(opened, "obbbbbbbb"), new Map([["stroke", "url(#rgggggggg) #000000"]]))).toBe(true);
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

  it("senza private non fanno niente", () => {
    const opened = open(doc(`${LAYER}<rect id="oaaaaaaaa" x="0" y="0" width="5" height="5" fill="#000000"/></g>`));
    const copies = new ResourceCopies(opened.engine.model!, new NewIds(() => false), elemOf);
    expect(copies.adopt(elemOf(node(opened, "oaaaaaaaa"))!)).toEqual(elemOf(node(opened, "oaaaaaaaa")));
    expect(copies.ops()).toEqual([]);
  });
});
