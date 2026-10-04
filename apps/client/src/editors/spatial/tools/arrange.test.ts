// Disporre gli oggetti: le operazioni di ogni comando, che il motore le
// accetta così come sono, che ciò che si vede resta dove era e che un
// annulla riporta il testo identico.

import { describe, expect, it } from "vitest";
import { doc, HEAD } from "../scene/test-support";
import type { Op } from "../scene/ops";
import { alignOps, boundsOf, distributeOps, duplicateOps, elemOf, groupOps, nodeOf, orderOps, ungroupOps, type Arranged } from "./arrange";
import { gesture, NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Applica `arranged` e verifica che un annulla riporti il testo di prima.
function applied(opened: Opened, arranged: Arranged): SceneIndex {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(arranged.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  const back = opened.engine.undo(outcome.undo);
  expect(back.outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  const redo = opened.engine.apply(gesture(arranged.ops)!);
  expect(redo.outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return opened.reindex();
}

const keys = (index: SceneIndex): string[] => index.units.map((unit) => unit.key);
const units = (opened: Opened, ...wanted: string[]): Unit[] => opened.index.units.filter((unit) => wanted.includes(unit.key));

const RECT = (id: string, x: number, y = 0, extra = ""): string => `<rect id="${id}" x="${x}" y="${y}" width="10" height="10"${extra}/>`;

describe("duplicare", () => {
  it("mette la copia sopra l'originale, spostata, con un id nuovo", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20)}</g>`));
    const arranged = duplicateOps(opened.engine.model!, units(opened, "oaaaaaaaa"), 16, 16, ids(opened))!;
    const [copy] = arranged.keys;
    expect(copy).toMatch(/^o[a-z0-9]{8}$/);
    expect(arranged.ops).toEqual([
      {
        op: "add",
        parent: "l1",
        pos: { after: "oaaaaaaaa" },
        elem: { tag: "rect", attrs: { id: copy, x: "0", y: "0", width: "10", height: "10", transform: "matrix(1 0 0 1 16 16)" } },
      },
    ]);
    const index = applied(opened, arranged);
    expect(keys(index)).toEqual(["oaaaaaaaa", copy, "obbbbbbbb"]);
    expect(index.get(copy!)!.bounds).toEqual({ min: [16, 16], max: [26, 26] });
  });

  it("mette le copie in blocco sopra l'originale più in alto del livello, nell'ordine degli originali", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("oxxxxxxxx", 20)}${RECT("obbbbbbbb", 40)}</g>`));
    const arranged = duplicateOps(opened.engine.model!, units(opened, "oaaaaaaaa", "obbbbbbbb"), 5, 0, ids(opened))!;
    const index = applied(opened, arranged);
    expect(keys(index)).toEqual(["oaaaaaaaa", "oxxxxxxxx", "obbbbbbbb", ...arranged.keys]);
    expect(arranged.keys.map((key) => index.get(key)!.bounds!.min[0])).toEqual([5, 45]);
  });

  it("dà id nuovi a tutto il gruppo copiato, e un id all'originale che non l'aveva", () => {
    const opened = open(doc(`${LAYER}<g><title>Casa</title>${RECT("oaaaaaaaa", 0)}<rect x="20" y="0" width="5" height="5"/></g></g>`));
    const arranged = duplicateOps(opened.engine.model!, opened.index.units, 0, 10, ids(opened))!;
    expect(arranged.ops[0]).toMatchObject({ op: "ident", path: [0, 0], tag: "g" });
    const index = applied(opened, arranged);
    expect(index.units).toHaveLength(2);
    const text = opened.engine.text;
    expect(text.match(/id="oaaaaaaaa"/g)).toHaveLength(1);
    expect(text.match(/<title>Casa<\/title>/g)).toHaveLength(2);
    // Il motore vuole un id su ogni elemento aggiunto: il figlio che non ne
    // aveva lo riceve nella copia, non nell'originale.
    expect(text.match(/<rect x="20"/g)).toHaveLength(1);
    expect(text).toMatch(/<rect id="o[a-z0-9]{8}" x="20"/);
  });

  it("copia un tratto, un testo con le sue righe e un collegamento con i loro attributi", () => {
    const opened = open(doc(
      `${LAYER}<text id="otttttttt" x="0" y="20" font-size="12"><tspan x="0" dy="0">Uno &amp; due</tspan><tspan x="0" dy="14">tre</tspan></text>`
        + `<a id="olllllllll" href="Nota.md">${RECT("oaaaaaaaa", 0)}</a></g>`,
    ));
    const model = opened.engine.model!;
    expect(elemOf(nodeOf(model, opened.index.get("otttttttt")!))).toEqual({
      tag: "text",
      attrs: { id: "otttttttt", x: "0", y: "20", "font-size": "12" },
      children: [
        { tag: "tspan", attrs: { x: "0", dy: "0" }, text: "Uno & due" },
        { tag: "tspan", attrs: { x: "0", dy: "14" }, text: "tre" },
      ],
    });
    const arranged = duplicateOps(model, opened.index.units, 0, 30, ids(opened))!;
    applied(opened, arranged);
    expect(opened.engine.text.match(/Uno &amp; due/g)).toHaveLength(2);
    expect(opened.engine.text.match(/href="Nota.md"/g)).toHaveLength(2);
  });

  it("non copia un oggetto con parti estranee", () => {
    const opened = open(doc(`${LAYER}<g id="ogggggggg">${RECT("oaaaaaaaa", 0)}<use href="#oaaaaaaaa"/></g></g>`));
    expect(duplicateOps(opened.engine.model!, opened.index.units, 0, 10, ids(opened))).toBeNull();
  });
});

describe("l'ordine", () => {
  const SOURCE = doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 1)}${RECT("occcccccc", 2)}${RECT("odddddddd", 3)}</g>`);

  const reordered = (order: Parameters<typeof orderOps>[3], ...chosen: string[]): string[] => {
    const opened = open(SOURCE);
    const arranged = orderOps(opened.engine.model!, opened.index, units(opened, ...chosen), order, ids(opened));
    return keys(applied(opened, arranged));
  };

  it("porta in primo piano, avanti, indietro e in fondo", () => {
    expect(reordered("front", "obbbbbbbb")).toEqual(["oaaaaaaaa", "occcccccc", "odddddddd", "obbbbbbbb"]);
    expect(reordered("forward", "obbbbbbbb")).toEqual(["oaaaaaaaa", "occcccccc", "obbbbbbbb", "odddddddd"]);
    expect(reordered("backward", "occcccccc")).toEqual(["oaaaaaaaa", "occcccccc", "obbbbbbbb", "odddddddd"]);
    expect(reordered("back", "occcccccc")).toEqual(["occcccccc", "oaaaaaaaa", "obbbbbbbb", "odddddddd"]);
  });

  it("muove più oggetti insieme, e un blocco sale di un posto intero", () => {
    expect(reordered("forward", "obbbbbbbb", "occcccccc")).toEqual(["oaaaaaaaa", "odddddddd", "obbbbbbbb", "occcccccc"]);
    expect(reordered("forward", "oaaaaaaaa", "occcccccc")).toEqual(["obbbbbbbb", "oaaaaaaaa", "odddddddd", "occcccccc"]);
    expect(reordered("back", "obbbbbbbb", "odddddddd")).toEqual(["obbbbbbbb", "odddddddd", "oaaaaaaaa", "occcccccc"]);
  });

  it("non scrive niente se l'ordine resta quello", () => {
    const opened = open(SOURCE);
    expect(orderOps(opened.engine.model!, opened.index, units(opened, "odddddddd"), "front", ids(opened)).ops).toEqual([]);
    expect(orderOps(opened.engine.model!, opened.index, units(opened, "oaaaaaaaa", "obbbbbbbb"), "backward", ids(opened)).ops).toEqual([]);
  });

  it("dà un id a chi non l'ha, e la selezione lo segue", () => {
    const opened = open(doc(`${LAYER}<rect x="0" y="0" width="5" height="5"/>${RECT("obbbbbbbb", 1)}</g>`));
    const arranged = orderOps(opened.engine.model!, opened.index, [opened.index.units[0]!], "front", ids(opened));
    const index = applied(opened, arranged);
    expect(arranged.keys[0]).toMatch(/^o[a-z0-9]{8}$/);
    expect(keys(index)).toEqual(["obbbbbbbb", arranged.keys[0]]);
  });

  it("dà un id anche a un oggetto scelto che resta fermo", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}<rect x="1" y="0" width="5" height="5"/>${RECT("occcccccc", 2)}</g>`));
    const chosen = [opened.index.units[0]!, opened.index.units[1]!];
    const arranged = orderOps(opened.engine.model!, opened.index, chosen, "front", ids(opened));
    const index = applied(opened, arranged);
    expect(keys(index)).toEqual(["occcccccc", ...arranged.keys]);
    expect(arranged.keys[0]).toBe("oaaaaaaaa");
    expect(index.get(arranged.keys[1]!)!.bounds).toEqual({ min: [1, 0], max: [6, 5] });
  });

  it("in un disegno senza livelli, in fondo vuol dire sopra il titolo e la carta", () => {
    const opened = open(doc(`<title>Prova</title><rect fub:role="paper" width="100" height="100" fill="#ffffff"/>${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 1)}`));
    const arranged = orderOps(opened.engine.model!, opened.index, units(opened, "obbbbbbbb"), "back", ids(opened));
    expect(keys(applied(opened, arranged))).toEqual(["obbbbbbbb", "oaaaaaaaa"]);
    expect(opened.engine.text).toMatch(/<title>Prova<\/title><rect fub:role="paper"[^>]*\/>\s*<rect id="obbbbbbbb"/);
  });

  it("tiene ogni oggetto nel suo livello", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 1)}</g><g id="l2" fub:layer="Due">${RECT("occcccccc", 2)}${RECT("odddddddd", 3)}</g>`));
    const arranged = orderOps(opened.engine.model!, opened.index, units(opened, "oaaaaaaaa", "occcccccc"), "front", ids(opened));
    expect(keys(applied(opened, arranged))).toEqual(["obbbbbbbb", "oaaaaaaaa", "odddddddd", "occcccccc"]);
  });
});

describe("raggruppare", () => {
  it("mette gli oggetti in un gruppo nuovo, al posto del più alto", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("oxxxxxxxx", 20)}${RECT("obbbbbbbb", 40)}</g>`));
    const arranged = groupOps(opened.engine.model!, units(opened, "oaaaaaaaa", "obbbbbbbb"), ids(opened))!;
    const [group] = arranged.keys;
    const index = applied(opened, arranged);
    expect(keys(index)).toEqual(["oxxxxxxxx", group]);
    expect(index.get(group!)!.role).toBe("group");
    expect(index.get(group!)!.bounds).toEqual({ min: [0, 0], max: [50, 10] });
    expect(opened.engine.text).toMatch(new RegExp(`<g id="${group}">\\s*<rect id="oaaaaaaaa"[^>]*/>\\s*<rect id="obbbbbbbb"[^>]*/>\\s*</g>`));
  });

  it("rientra gli oggetti nel gruppo come il resto del file", () => {
    const opened = open(`${HEAD}\n  ${LAYER}\n    ${RECT("oaaaaaaaa", 0)}\n    ${RECT("obbbbbbbb", 40)}\n  </g>\n</svg>\n`);
    const arranged = groupOps(opened.engine.model!, opened.index.units, ids(opened))!;
    applied(opened, arranged);
    expect(opened.engine.text).toBe(
      `${HEAD}\n  ${LAYER}\n    <g id="${arranged.keys[0]}">\n      ${RECT("oaaaaaaaa", 0)}\n      ${RECT("obbbbbbbb", 40)}\n    </g>\n  </g>\n</svg>\n`,
    );
    const back = ungroupOps(opened.engine.model!, opened.reindex().units, ids(opened));
    if (back === "foreign") throw new Error("estraneo");
    applied(opened, back);
    expect(opened.engine.text).toBe(`${HEAD}\n  ${LAYER}\n    ${RECT("oaaaaaaaa", 0)}\n    ${RECT("obbbbbbbb", 40)}\n  </g>\n</svg>\n`);
  });

  it("lascia dov'è un oggetto che viene da un livello trasformato", () => {
    const opened = open(doc(`<g id="l1" fub:layer="Doppio" transform="scale(2)">${RECT("oaaaaaaaa", 5, 5)}</g><g id="l2" fub:layer="Due">${RECT("obbbbbbbb", 40)}</g>`));
    const before = opened.index.get("oaaaaaaaa")!.bounds;
    const arranged = groupOps(opened.engine.model!, opened.index.units, ids(opened))!;
    const index = applied(opened, arranged);
    expect(index.units).toHaveLength(1);
    expect(index.get(arranged.keys[0]!)!.bounds).toEqual({ min: [10, 0], max: [50, 30] });
    expect(before).toEqual({ min: [10, 10], max: [30, 30] });
    expect(opened.engine.text).toContain('<rect id="oaaaaaaaa" x="5" y="5" width="10" height="10" transform="matrix(2 0 0 2 0 0)"/>');
  });
});

describe("separare", () => {
  it("porta i figli al posto del gruppo, con la sua trasformazione e lo stile che ereditavano", () => {
    const opened = open(doc(
      `${LAYER}${RECT("oxxxxxxxx", 90)}<g id="ogggggggg" transform="translate(10 20)" fill="#d55e00" stroke-width="2"><title>Coppia</title>`
        + `${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20, 0, ' fill="#0072b2" transform="translate(1 1)"')}</g>${RECT("oyyyyyyyy", 90)}</g>`,
    ));
    const arranged = ungroupOps(opened.engine.model!, units(opened, "ogggggggg"), ids(opened));
    if (arranged === "foreign") throw new Error("estraneo");
    const index = applied(opened, arranged);
    expect(keys(index)).toEqual(["oxxxxxxxx", "oaaaaaaaa", "obbbbbbbb", "oyyyyyyyy"]);
    expect(new Set(arranged.keys)).toEqual(new Set(["oaaaaaaaa", "obbbbbbbb"]));
    expect(index.get("oaaaaaaaa")!.bounds).toEqual({ min: [10, 20], max: [20, 30] });
    expect(index.get("obbbbbbbb")!.bounds).toEqual({ min: [31, 21], max: [41, 31] });
    const text = opened.engine.text;
    expect(text).not.toContain("Coppia");
    expect(text).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="#d55e00" stroke-width="2" transform="matrix(1 0 0 1 10 20)"/>');
    expect(text).toContain('<rect id="obbbbbbbb" x="20" y="0" width="10" height="10" fill="#0072b2" stroke-width="2" transform="matrix(1 0 0 1 11 21)"/>');
  });

  it("moltiplica l'opacità del gruppo in quella dei figli", () => {
    const opened = open(doc(`${LAYER}<g id="ogggggggg" opacity="0.5">${RECT("oaaaaaaaa", 0, 0, ' opacity="0.4"')}${RECT("obbbbbbbb", 20)}</g></g>`));
    const arranged = ungroupOps(opened.engine.model!, opened.index.units, ids(opened));
    if (arranged === "foreign") throw new Error("estraneo");
    applied(opened, arranged);
    expect(opened.engine.text).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" opacity="0.2"/>');
    expect(opened.engine.text).toContain('<rect id="obbbbbbbb" x="20" y="0" width="10" height="10" opacity="0.5"/>');
  });

  it("porta fuori anche una parte estranea, se il gruppo non ha niente da darle", () => {
    const opened = open(doc(`${LAYER}<g id="ogggggggg">${RECT("oaaaaaaaa", 0)}<use href="#oaaaaaaaa"/><rect x="30" y="0" width="5" height="5"/></g></g>`));
    const arranged = ungroupOps(opened.engine.model!, opened.index.units, ids(opened));
    if (arranged === "foreign") throw new Error("estraneo");
    const index = applied(opened, arranged);
    expect(opened.engine.text).not.toContain("ogggggggg");
    expect(opened.engine.text).toMatch(/<rect id="oaaaaaaaa"[^>]*\/>\s*<use href="#oaaaaaaaa"\/>\s*<rect id="o[a-z0-9]{8}" x="30"/);
    expect(index.units).toHaveLength(2);
  });

  it("non separa un gruppo trasformato con una parte estranea, che non cambierebbe con lui", () => {
    const opened = open(doc(`${LAYER}<g id="ogggggggg" transform="translate(5 0)">${RECT("oaaaaaaaa", 0)}<use href="#oaaaaaaaa"/></g></g>`));
    expect(ungroupOps(opened.engine.model!, opened.index.units, ids(opened))).toBe("foreign");
  });

  it("dà un id a un oggetto scelto senza, che i figli portati fuori spostano", () => {
    const opened = open(doc(`${LAYER}<g id="ogggggggg">${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20)}</g><rect x="50" y="0" width="5" height="5"/></g>`));
    const arranged = ungroupOps(opened.engine.model!, opened.index.units, ids(opened));
    if (arranged === "foreign") throw new Error("estraneo");
    const index = applied(opened, arranged);
    const named = arranged.keys.find((key) => key !== "oaaaaaaaa" && key !== "obbbbbbbb")!;
    expect(index.get(named)!.bounds).toEqual({ min: [50, 0], max: [55, 5] });
  });

  it("separa più gruppi in un passo, e lascia scelti gli altri oggetti", () => {
    const opened = open(doc(`${LAYER}<g id="og1111111">${RECT("oaaaaaaaa", 0)}</g>${RECT("oxxxxxxxx", 50)}<g id="og2222222">${RECT("obbbbbbbb", 20)}${RECT("occcccccc", 30)}</g></g>`));
    const arranged = ungroupOps(opened.engine.model!, opened.index.units, ids(opened));
    if (arranged === "foreign") throw new Error("estraneo");
    const index = applied(opened, arranged);
    expect(keys(index)).toEqual(["oaaaaaaaa", "oxxxxxxxx", "obbbbbbbb", "occcccccc"]);
    expect(new Set(arranged.keys)).toEqual(new Set(keys(index)));
  });
});

describe("allineare e distribuire", () => {
  const SOURCE = doc(`${LAYER}${RECT("oaaaaaaaa", 0, 0)}<rect id="obbbbbbbb" x="30" y="40" width="20" height="20"/>${RECT("occcccccc", 15, 80)}</g>`);

  it("allinea ai bordi e ai centri del riquadro di riferimento", () => {
    const cases: Array<[Parameters<typeof alignOps>[1], number[][]]> = [
      ["left", [[0, 0], [0, 40], [0, 80]]],
      ["center", [[20, 0], [15, 40], [20, 80]]],
      ["right", [[40, 0], [30, 40], [40, 80]]],
      ["top", [[0, 0], [30, 0], [15, 0]]],
      ["middle", [[0, 40], [30, 35], [15, 40]]],
      ["bottom", [[0, 80], [30, 70], [15, 80]]],
    ];
    for (const [edge, mins] of cases) {
      const opened = open(SOURCE);
      const arranged = alignOps(opened.index.units, edge, boundsOf(opened.index.units)!, ids(opened));
      const index = applied(opened, arranged);
      expect(index.units.map((unit) => unit.bounds!.min), edge).toEqual(mins);
    }
  });

  it("non tocca un oggetto già al suo posto", () => {
    const opened = open(SOURCE);
    const arranged = alignOps(opened.index.units, "left", boundsOf(opened.index.units)!, ids(opened));
    expect(arranged.ops.map((op: Op) => (op.op === "set" ? op.id : op.op))).toEqual(["obbbbbbbb", "occcccccc"]);
    expect(arranged.keys).toEqual(["oaaaaaaaa", "obbbbbbbb", "occcccccc"]);
  });

  it("distribuisce lo spazio fra gli oggetti, coi due estremi fermi", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 15)}<rect id="occcccccc" x="100" y="0" width="20" height="10"/>${RECT("odddddddd", 70)}</g>`));
    const arranged = distributeOps(opened.index.units, "x", ids(opened));
    const index = applied(opened, arranged);
    // Fra 10 e 100 restano 70 unità dopo i due oggetti in mezzo: 70 / 3.
    const mins = index.units.map((unit) => unit.bounds!.min[0]);
    expect(mins[0]).toBe(0);
    expect(mins[2]).toBe(100);
    expect(mins[1]).toBeCloseTo(10 + 70 / 3, 1);
    expect(mins[3]).toBeCloseTo(10 + (2 * 70) / 3 + 10, 1);
  });

  it("con meno di tre oggetti non distribuisce", () => {
    const opened = open(SOURCE);
    expect(distributeOps(opened.index.units.slice(0, 2), "y", ids(opened)).ops).toEqual([]);
  });
});
