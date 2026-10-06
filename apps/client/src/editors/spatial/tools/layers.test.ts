// I livelli: le operazioni di ogni comando, che il motore le accetta così
// come sono, che ciò che si vede resta dove era e che un annulla riporta il
// testo identico.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import type { Arranged } from "./arrange";
import { gesture, NewIds } from "./edit";
import type { SceneIndex } from "./hit";
import {
  addLayerOps,
  canShiftLayer,
  freshLayerName,
  hideLayerOps,
  intoLayerOps,
  layerName,
  lockLayerOps,
  MAX_LAYER_NAME,
  removeLayerOps,
  renameLayerOps,
  shiftLayerOps,
} from "./layers";
import { open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Applica `arranged` e verifica che annulla e ripeti diano il testo di
/// prima e quello di dopo.
function applied(opened: Opened, arranged: Arranged): SceneIndex {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(arranged.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(arranged.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return opened.reindex();
}

const RECT = (id: string, x: number): string => `<rect id="${id}" x="${x}" y="0" width="10" height="10"/>`;
const names = (index: SceneIndex): string[] => index.layers.map((layer) => layer.name);

const TWO = doc(`<g id="laaaaaaaa" fub:layer="Sfondo">${RECT("oaaaaaaaa", 0)}</g><g id="lbbbbbbbb" fub:layer="Note">${RECT("obbbbbbbb", 20)}</g>`);

describe("il nome di un livello", () => {
  it("perde gli spazi ai bordi e si ferma a 80 caratteri", () => {
    expect(layerName("  Sfondo  ")).toBe("Sfondo");
    expect(layerName("   ")).toBe("");
    expect(Array.from(layerName("è".repeat(100)))).toHaveLength(MAX_LAYER_NAME);
    expect(layerName(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });

  it("di un livello nuovo è il primo numero libero", () => {
    const nameFor = (n: number): string => `Livello ${n}`;
    const index = open(TWO).index;
    expect(freshLayerName(index.layers, nameFor)).toBe("Livello 3");
    const taken = open(doc('<g id="laaaaaaaa" fub:layer="Livello 2"></g><g id="lbbbbbbbb" fub:layer="Livello 3"></g>')).index;
    expect(freshLayerName(taken.layers, nameFor)).toBe("Livello 4");
    expect(freshLayerName([], nameFor)).toBe("Livello 1");
  });
});

describe("creare un livello", () => {
  it("lo mette subito sopra quello corrente, vuoto e in forma aperta", () => {
    const opened = open(TWO);
    const arranged = addLayerOps(opened.engine.model!, opened.index.layers[0]!, "Schizzi", ids(opened));
    const [id] = arranged.keys;
    expect(id).toMatch(/^l[a-z0-9]{8}$/);
    const index = applied(opened, arranged);
    expect(names(index)).toEqual(["Sfondo", "Schizzi", "Note"]);
    expect(opened.engine.text).toMatch(new RegExp(`<g id="${id}" fub:layer="Schizzi">\\s*</g>`));
  });

  it("in cima, in un documento senza livelli", () => {
    const opened = open(doc(RECT("oaaaaaaaa", 0)));
    const index = applied(opened, addLayerOps(opened.engine.model!, null, "Livello 1", ids(opened)));
    expect(names(index)).toEqual(["Livello 1"]);
    expect(index.layers[0]!.path).toEqual([1]);
  });

  it("dà un id al livello corrente che non l'aveva", () => {
    const opened = open(doc('<g fub:layer="Vecchio"></g>'));
    const arranged = addLayerOps(opened.engine.model!, opened.index.layers[0]!, "Nuovo", ids(opened));
    expect(arranged.ops[0]).toMatchObject({ op: "ident", path: [0], tag: "g" });
    expect(names(applied(opened, arranged))).toEqual(["Vecchio", "Nuovo"]);
  });
});

describe("cambiare un livello", () => {
  it("lo rinomina, e niente se il nome è lo stesso", () => {
    const opened = open(TWO);
    const [sfondo] = opened.index.layers;
    expect(renameLayerOps(opened.engine.model!, sfondo!, "Sfondo", ids(opened)).ops).toEqual([]);
    const arranged = renameLayerOps(opened.engine.model!, sfondo!, "Carta & «bozza»", ids(opened));
    expect(names(applied(opened, arranged))).toEqual(["Carta & «bozza»", "Note"]);
    expect(opened.engine.text).toContain('fub:layer="Carta &amp; «bozza»"');
  });

  it("lo nasconde con display e lo mostra togliendolo: i suoi oggetti spariscono e tornano", () => {
    const opened = open(TWO);
    const hidden = applied(opened, hideLayerOps(opened.engine.model!, opened.index.layers[1]!, true, ids(opened)));
    expect(opened.engine.text).toContain('<g id="lbbbbbbbb" fub:layer="Note" display="none">');
    expect(hidden.layers[1]!.hidden).toBe(true);
    expect(hidden.units.map((unit) => unit.key)).toEqual(["oaaaaaaaa"]);
    const shown = applied(opened, hideLayerOps(opened.engine.model!, hidden.layers[1]!, false, ids(opened)));
    expect(opened.engine.text).toBe(TWO);
    expect(shown.units.map((unit) => unit.key)).toEqual(["oaaaaaaaa", "obbbbbbbb"]);
    expect(hideLayerOps(opened.engine.model!, shown.layers[1]!, false, ids(opened)).ops).toEqual([]);
  });

  it("lo blocca e lo sblocca, e bloccato non se ne tocca il contenuto", () => {
    const opened = open(TWO);
    const locked = applied(opened, lockLayerOps(opened.engine.model!, opened.index.layers[0]!, true, ids(opened)));
    expect(opened.engine.text).toContain('<g id="laaaaaaaa" fub:layer="Sfondo" fub:locked="true">');
    expect(locked.layers[0]!.locked).toBe(true);
    expect(locked.units.map((unit) => unit.key)).toEqual(["obbbbbbbb"]);
    // Bloccato è ciò che contiene, non il livello: lo si sblocca con un set.
    applied(opened, lockLayerOps(opened.engine.model!, locked.layers[0]!, false, ids(opened)));
    expect(opened.engine.text).toBe(TWO);
  });
});

describe("l'ordine dei livelli", () => {
  const THREE = doc(
    '<g id="laaaaaaaa" fub:layer="A"></g><rect id="ozzzzzzzz" x="0" y="0" width="1" height="1"/><g id="lbbbbbbbb" fub:layer="B"></g><g id="lcccccccc" fub:layer="C"></g>',
  );

  it("sale sopra quello che ha sopra e scende sotto quello che ha sotto", () => {
    const opened = open(THREE);
    const [a, b, c] = opened.index.layers;
    expect(canShiftLayer(opened.index.layers, c!, "up")).toBe(false);
    expect(canShiftLayer(opened.index.layers, a!, "down")).toBe(false);
    expect(shiftLayerOps(opened.engine.model!, opened.index.layers, c!, "up", ids(opened)).ops).toEqual([]);
    let index = applied(opened, shiftLayerOps(opened.engine.model!, opened.index.layers, a!, "up", ids(opened)));
    expect(names(index)).toEqual(["B", "A", "C"]);
    index = applied(opened, shiftLayerOps(opened.engine.model!, index.layers, index.layers[2]!, "down", ids(opened)));
    expect(names(index)).toEqual(["B", "C", "A"]);
    expect(b).toBeDefined();
  });

  it("lascia dove sono gli oggetti alla radice", () => {
    const opened = open(THREE);
    const index = applied(opened, shiftLayerOps(opened.engine.model!, opened.index.layers, opened.index.layers[1]!, "down", ids(opened)));
    expect(names(index)).toEqual(["B", "A"].concat("C"));
    expect(opened.engine.text.indexOf('id="ozzzzzzzz"')).toBeGreaterThan(opened.engine.text.indexOf('fub:layer="A"'));
  });
});

describe("l'ordine dei livelli, in fondo", () => {
  it("scende sotto il primo livello restando dopo titolo e carta", () => {
    const paper = '<title>Casa</title><rect id="fub-paper" fub:role="paper" x="0" y="0" width="100" height="100" fill="#ffffff"/>';
    const opened = open(doc(`${paper}<g id="laaaaaaaa" fub:layer="A"></g><g id="lbbbbbbbb" fub:layer="B"></g>`));
    const arranged = shiftLayerOps(opened.engine.model!, opened.index.layers, opened.index.layers[1]!, "down", ids(opened));
    expect(arranged.ops).toEqual([{ op: "move", target: "lbbbbbbbb", parent: "#root", pos: { first: true } }]);
    const index = applied(opened, arranged);
    expect(names(index)).toEqual(["B", "A"]);
    expect(opened.engine.text.indexOf("fub-paper")).toBeLessThan(opened.engine.text.indexOf('fub:layer="B"'));
  });

  it("sotto un elemento estraneo, fa salire quello di sotto", () => {
    const opened = open(doc('<x:nota xmlns:x="urn:x"/><g id="laaaaaaaa" fub:layer="A"></g><g id="lbbbbbbbb" fub:layer="B"></g>'));
    const arranged = shiftLayerOps(opened.engine.model!, opened.index.layers, opened.index.layers[1]!, "down", ids(opened));
    expect(arranged.ops).toEqual([{ op: "move", target: "laaaaaaaa", parent: "#root", pos: { after: "lbbbbbbbb" } }]);
    expect(names(applied(opened, arranged))).toEqual(["B", "A"]);
  });
});

describe("eliminare un livello", () => {
  it("lo toglie con ciò che contiene, e annulla lo rimette com'era", () => {
    const opened = open(TWO);
    const index = applied(opened, removeLayerOps(opened.index.layers[0]!));
    expect(names(index)).toEqual(["Note"]);
    expect(index.units.map((unit) => unit.key)).toEqual(["obbbbbbbb"]);
  });

  it("anche senza id", () => {
    const opened = open(doc(`<g fub:layer="Senza">${RECT("oaaaaaaaa", 0)}</g>${RECT("obbbbbbbb", 0)}`));
    const index = applied(opened, removeLayerOps(opened.index.layers[0]!));
    expect(index.layers).toEqual([]);
  });
});

describe("portare gli oggetti in un livello", () => {
  it("li mette in cima, nell'ordine in cui stavano", () => {
    const opened = open(doc(`<g id="laaaaaaaa" fub:layer="A">${RECT("oaaaaaaaa", 0)}${RECT("occcccccc", 40)}</g><g id="lbbbbbbbb" fub:layer="B">${RECT("obbbbbbbb", 20)}</g>`));
    const chosen = opened.index.units.filter((unit) => unit.key !== "obbbbbbbb");
    const arranged = intoLayerOps(opened.engine.model!, chosen, opened.index.layers[1]!, ids(opened))!;
    expect(arranged.ops).toEqual([
      { op: "move", target: "oaaaaaaaa", parent: "lbbbbbbbb", pos: { last: true } },
      { op: "move", target: "occcccccc", parent: "lbbbbbbbb", pos: { last: true } },
    ]);
    const index = applied(opened, arranged);
    expect(index.units.map((unit) => [unit.key, unit.layer])).toEqual([
      ["obbbbbbbb", "lbbbbbbbb"],
      ["oaaaaaaaa", "lbbbbbbbb"],
      ["occcccccc", "lbbbbbbbb"],
    ]);
    expect(arranged.keys).toEqual(["oaaaaaaaa", "occcccccc"]);
  });

  it("lascia dove si vede un oggetto che viene da un livello con un'altra trasformazione", () => {
    const opened = open(doc(`<g id="laaaaaaaa" fub:layer="A" transform="scale(2)">${RECT("oaaaaaaaa", 5)}</g><g id="lbbbbbbbb" fub:layer="B" transform="translate(10 0)"></g>`));
    const before = opened.index.units[0]!.bounds;
    const index = applied(opened, intoLayerOps(opened.engine.model!, opened.index.units, opened.index.layers[1]!, ids(opened))!);
    expect(index.units[0]!.bounds).toEqual(before);
    expect(opened.engine.text).toContain('<rect id="oaaaaaaaa" x="5" y="0" width="10" height="10" transform="matrix(2 0 0 2 -10 0)"/>');
  });

  it("un oggetto tiene lo stile che ereditava, e un livello che dà lo stesso non chiede niente", () => {
    const opened = open(doc(`<g id="laaaaaaaa" fub:layer="A" fill="#d55e00" stroke-width="3">${RECT("oaaaaaaaa", 0)}</g><g id="lbbbbbbbb" fub:layer="B" stroke-width="3" stroke="#0072b2"></g>`));
    const arranged = intoLayerOps(opened.engine.model!, opened.index.units, opened.index.layers[1]!, ids(opened))!;
    expect(arranged.ops[0]).toEqual({ op: "set", id: "oaaaaaaaa", attrs: { fill: "#d55e00", stroke: "none" } });
    applied(opened, arranged);
    expect(opened.engine.text).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="#d55e00" stroke="none"/>');
  });

  it("porta dentro anche gli oggetti alla radice, e dà loro un id", () => {
    const opened = open(doc(`<rect x="0" y="0" width="10" height="10"/><g id="laaaaaaaa" fub:layer="A"></g>`));
    const arranged = intoLayerOps(opened.engine.model!, opened.index.units, opened.index.layers[0]!, ids(opened))!;
    expect(arranged.ops[0]).toMatchObject({ op: "ident", path: [0], tag: "rect" });
    const index = applied(opened, arranged);
    expect(index.units.map((unit) => unit.key)).toEqual(arranged.keys);
    expect(index.units[0]!.layer).toBe("laaaaaaaa");
  });

  it("non fa niente se stanno già tutti lì", () => {
    const opened = open(TWO);
    const arranged = intoLayerOps(opened.engine.model!, opened.index.units.slice(1), opened.index.layers[1]!, ids(opened))!;
    expect(arranged).toEqual({ ops: [], keys: ["obbbbbbbb"] });
  });

  it("rifiuta un livello che schiaccia il piano", () => {
    const opened = open(doc(`${RECT("oaaaaaaaa", 0)}<g id="laaaaaaaa" fub:layer="A" transform="scale(0)"></g>`));
    expect(intoLayerOps(opened.engine.model!, opened.index.units, opened.index.layers[0]!, ids(opened))).toBeNull();
  });
});
