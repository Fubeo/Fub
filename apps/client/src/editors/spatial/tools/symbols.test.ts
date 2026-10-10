// I comandi dei simboli: le operazioni, che il motore le accetta così come
// sono, che ciò che si vede resta dove era, che gli agganci restano veri e
// che un annulla riporta il testo identico.

import { describe, expect, it } from "vitest";
import { titleOf, type ContainerNode } from "../scene/model";
import { doc } from "../scene/test-support";
import { anchorPoints, attachable, followConnectors } from "./connectors";
import { gesture, NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { cyclingSymbols, detachOps, documentSymbols, freshSymbolName, instanceCounts, instanceSymbol, renameSymbolOps, swapOps, symbolNameProblem, symbolOps, type SymbolMade } from "./symbols";
import type { Arranged } from "./arrange";
import { estimate } from "./measure";
import { LAYER, open, type Opened } from "./test-support";
import { attrOf } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Applica `arranged` e verifica che un annulla riporti il testo di prima.
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

const units = (opened: Opened, ...wanted: string[]): Unit[] => opened.index.units.filter((unit) => wanted.includes(unit.key));

const made = (result: SymbolMade | string): SymbolMade => {
  if (typeof result === "string") throw new Error(`rifiutato: ${result}`);
  return result;
};

const SHAPES = doc(
  `${LAYER}<rect id="oa" x="0" y="0" width="10" height="10"/><circle id="ob" cx="30" cy="5" r="5"/>`
    + '<rect id="oc" x="60" y="0" width="10" height="10"/></g>',
);

describe("Crea simbolo", () => {
  it("sposta gli oggetti in un simbolo nuovo e lascia un'istanza dov'era il più alto, col disegno com'era", () => {
    const opened = open(SHAPES);
    const result = made(symbolOps(opened.engine.model!, units(opened, "oa", "ob"), "Simbolo", ids(opened)));
    expect(result.name).toBe("Simbolo");
    expect(result.keys).toEqual([result.instance]);
    const index = applied(opened, result);
    expect(index.units.map((unit) => unit.key)).toEqual([result.instance, "oc"]);
    expect(index.get(result.instance)?.bounds).toEqual({ min: [0, 0], max: [35, 10] });
    const text = opened.engine.text;
    // L'origine è il centro di ciò che si vede, a numeri interi.
    expect(text).toContain(`<use id="${result.instance}" transform="matrix(1 0 0 1 18 5)" href="#${result.id}"/>`);
    expect(text).toContain(`<symbol id="${result.id}" overflow="visible">`);
    expect(attrOf(opened, "oa", "transform")).toBe("matrix(1 0 0 1 -18 -5)");
    const [symbol] = documentSymbols(opened.engine.model!);
    expect([symbol!.id, symbol!.name, symbol!.source]).toEqual([result.id, "Simbolo", null]);
    expect(instanceSymbol(opened.engine.model!, opened.engine.holder(result.instance)!)?.id).toBe(result.id);
  });

  it("porta dentro gli oggetti di un altro livello senza spostarli, e usa una defs che c'è già", () => {
    const opened = open(doc(
      '<defs id="fub-defs"/>'
        + `${LAYER}<rect id="oa" x="0" y="0" width="10" height="10"/></g>`
        + '<g id="l2" fub:layer="Sopra" transform="translate(100 0)"><rect id="ob" x="0" y="20" width="10" height="10" transform="rotate(90 5 25)"/></g>',
    ));
    const before = units(opened, "oa", "ob").map((unit) => unit.bounds);
    const result = made(symbolOps(opened.engine.model!, units(opened, "oa", "ob"), "Simbolo", ids(opened)));
    const index = applied(opened, result);
    // L'istanza sta nel livello del più alto.
    expect(index.get(result.instance)?.layer).toBe("l2");
    const box = before.reduce((a, b) => ({ min: [Math.min(a!.min[0], b!.min[0]), Math.min(a!.min[1], b!.min[1])], max: [Math.max(a!.max[0], b!.max[0]), Math.max(a!.max[1], b!.max[1])] }));
    expect(index.get(result.instance)?.bounds).toEqual(box);
    expect(opened.engine.text.match(/<defs/g)).toHaveLength(1);
  });

  it("dà il primo nome libero", () => {
    const opened = open(doc(
      '<defs id="fub-defs"><symbol id="r1" overflow="visible"><title>Simbolo</title></symbol><symbol id="r2" overflow="visible"><title>simbolo 2</title></symbol></defs>'
        + `${LAYER}<rect id="oa" x="0" y="0" width="10" height="10"/></g>`,
    ));
    expect(freshSymbolName(opened.engine.model!, "Simbolo")).toBe("Simbolo 3");
    expect(freshSymbolName(opened.engine.model!, "  Presa ")).toBe("Presa");
    expect(made(symbolOps(opened.engine.model!, units(opened, "oa"), "Simbolo", ids(opened))).name).toBe("Simbolo 3");
  });

  it("non si fa con niente che si veda", () => {
    const opened = open(doc(`${LAYER}<g id="og"/></g>`));
    expect(symbolOps(opened.engine.model!, units(opened, "og"), "Simbolo", ids(opened))).toBe("empty");
  });

  it("tiene veri gli agganci: fuori all'istanza, dentro fra gli oggetti che entrano, il resto si stacca", () => {
    const connector = (id: string, from: string | null, to: string | null): string =>
      `<path id="${id}" fub:shape="connector" fub:geom="straight 10 5 60 5"${from === null ? "" : ` fub:from="${from}"`}${to === null ? "" : ` fub:to="${to}"`} d="M10 5 L60 5" fill="none" stroke="#000000"/>`;
    const opened = open(doc(
      `${LAYER}<rect id="oa" x="0" y="0" width="10" height="10"/><circle id="ob" cx="30" cy="5" r="5"/>`
        + '<rect id="oc" x="60" y="0" width="10" height="10"/>'
        + connector("k1", "oa right", "oc left") + connector("k2", "oa auto", "ob auto") + connector("k3", "ob center", "oc auto") + connector("k4", "oa auto", "ob auto")
        + '</g>',
    ));
    const result = made(symbolOps(opened.engine.model!, units(opened, "oa", "ob", "k3"), "Simbolo", ids(opened)));
    applied(opened, result);
    // Fuori: il capo sull'oggetto che entra passa all'istanza, col suo punto.
    expect(attrOf(opened, "k1", "fub:from")).toBe(`${result.instance} right`);
    expect(attrOf(opened, "k1", "fub:to")).toBe("oc left");
    // Fuori coi due capi dentro: unirebbe l'istanza a sé stessa, e si stacca.
    expect(attrOf(opened, "k2", "fub:from")).toBeNull();
    expect(attrOf(opened, "k4", "fub:to")).toBeNull();
    // Dentro: il capo su ciò che resta fuori si stacca, l'altro resta.
    expect(attrOf(opened, "k3", "fub:from")).toBe("ob center");
    expect(attrOf(opened, "k3", "fub:to")).toBeNull();
  });
});

describe("Scollega", () => {
  const INSTANCES = doc(
    '<defs id="fub-defs"><linearGradient id="rg" fub:role="private"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>'
      + '<symbol id="r1" overflow="visible"><title>Presa</title><rect id="o1" x="-5" y="-5" width="10" height="10" fill="url(#rg)"/>'
      + '<g id="og"><circle id="o2" cx="10" cy="0" r="2"/></g></symbol></defs>'
      + `${LAYER}<use id="i1" transform="translate(100 50)" opacity="0.5" href="#r1"/>`
      + '<use id="i2" transform="translate(0 50)" href="#r1"><title>Presa del bagno</title></use>'
      + '<rect id="oc" x="200" y="0" width="10" height="10"/>'
      + '<path id="k" fub:shape="connector" fub:geom="straight 110 50 200 5" fub:from="i1 auto" fub:to="oc auto" d="M110 50 L200 5" fill="none" stroke="#000000"/></g>',
  );

  it("mette al posto dell'istanza un gruppo con una copia del contenuto, e il simbolo resta", () => {
    const opened = open(INSTANCES);
    const before = opened.index.get("i1")!.bounds;
    const arranged = detachOps(opened.engine.model!, units(opened, "i1"), ids(opened));
    if (typeof arranged === "string") throw new Error(arranged);
    const [group] = arranged.keys;
    const index = applied(opened, arranged);
    expect(index.units.map((unit) => unit.key)).toEqual([group, "i2", "oc", "k"]);
    expect(index.get(group!)?.bounds).toEqual(before);
    expect(index.get(group!)?.role).toBe("group");
    const text = opened.engine.text;
    expect(attrOf(opened, group!, "transform")).toBe("translate(100 50)");
    expect(attrOf(opened, group!, "opacity")).toBe("0.5");
    // Il nome del simbolo, e le copie con id nuovi.
    expect(titleOf(opened.engine.holder(group!) as ContainerNode)).toBe("Presa");
    expect(text.match(/id="o1"/g)).toHaveLength(1);
    expect(documentSymbols(opened.engine.model!)).toHaveLength(1);
    // La sfumatura privata del contenuto si copia, come per un duplicato.
    expect(text.match(/<linearGradient/g)).toHaveLength(2);
    expect(text.match(/fill="url\(#rg\)"/g)).toHaveLength(1);
    // Il connettore agganciato all'istanza si aggancia al gruppo.
    expect(attrOf(opened, "k", "fub:from")).toBe(`${group} auto`);
  });

  it("tiene il nome dell'istanza, e lascia scelto ciò che non è un'istanza", () => {
    const opened = open(INSTANCES);
    const arranged = detachOps(opened.engine.model!, units(opened, "i2", "oc"), ids(opened));
    if (typeof arranged === "string") throw new Error(arranged);
    expect(arranged.keys[1]).toBe("oc");
    applied(opened, arranged);
    expect(opened.engine.text).toContain("<title>Presa del bagno</title>");
    expect(opened.engine.text).not.toMatch(/<title>Presa<\/title>\s*<title>/);
  });

  it("non si fa se il contenuto ha parti estranee, e non fa niente senza istanze", () => {
    const opened = open(doc(
      '<defs id="fub-defs"><symbol id="r1" overflow="visible"><rect id="o1" x="0" y="0" width="10" height="10"/><x:cosa xmlns:x="urn:altro"/></symbol></defs>'
        + `${LAYER}<use id="i1" href="#r1"/><rect id="oc" x="20" y="0" width="10" height="10"/></g>`,
    ));
    expect(detachOps(opened.engine.model!, units(opened, "i1"), ids(opened))).toBe("content");
    expect(detachOps(opened.engine.model!, units(opened, "oc"), ids(opened))).toEqual({ ops: [], keys: ["oc"] });
  });
});

describe("i connettori e le istanze", () => {
  const LINKED = doc(
    '<defs id="fub-defs"><symbol id="r1" overflow="visible"><rect id="o1" x="-5" y="-5" width="10" height="10"/></symbol>'
      + '<symbol id="r2" overflow="visible"><use id="o2" transform="translate(0 0)" href="#r1"/></symbol></defs>'
      + `${LAYER}<use id="i1" transform="translate(100 50)" href="#r1"/><use id="i2" transform="translate(100 150) scale(2)" href="#r2"/>`
      + '<rect id="oc" x="200" y="45" width="10" height="10"/>'
      + '<path id="k1" fub:shape="connector" fub:geom="straight 105 50 200 50" fub:from="i1 right" fub:to="oc left" d="M105 50 L200 50" fill="none" stroke="#000000"/>'
      + '<path id="k2" fub:shape="connector" fub:geom="straight 110 150 200 50" fub:from="i2 right" fub:to="oc left" d="M110 150 L200 50" fill="none" stroke="#000000"/></g>',
  );
  const find = (opened: Opened) => (id: string) => opened.engine.holder(id);

  it("un'istanza si aggancia, coi punti del suo contenuto portati dove sta", () => {
    const opened = open(LINKED);
    expect(attachable(opened.engine.holder("i1")!)).toBe(true);
    expect(anchorPoints(opened.engine.holder("i1")!, estimate)?.get("right")).toEqual([105, 50]);
    // Attraverso un altro simbolo, e ingrandita.
    expect(anchorPoints(opened.engine.holder("i2")!, estimate)?.get("right")).toEqual([110, 150]);
    // Le linee scritte toccano già i punti: se nessuno cambia, niente da fare.
    expect(followConnectors(opened.engine.model!, new Set(["oc"]), find(opened), estimate)).toBeNull();
  });

  it("un connettore segue l'istanza quando cambia il contenuto del simbolo, anche attraverso un altro", () => {
    const opened = open(LINKED);
    expect(opened.engine.apply({ op: "set", id: "o1", attrs: { width: "20" } }).outcome).toBe("applied");
    const op = followConnectors(opened.engine.model!, new Set(["o1"]), find(opened), estimate);
    expect(op).not.toBeNull();
    expect(opened.engine.apply(op!).outcome).toBe("applied");
    expect(attrOf(opened, "k1", "d")).toBe("M115 50 L200 50");
    expect(attrOf(opened, "k2", "d")).toBe("M130 150 L200 50");
  });
});

describe("Scambia e Rinomina", () => {
  const LIBRARY = doc(
    '<defs id="fub-defs"><symbol id="r1" overflow="visible"><title>Presa</title><circle id="o1" r="5"/></symbol>'
      + '<symbol id="r2" overflow="visible"><title>Interruttore</title><rect id="o2" x="-5" y="-5" width="10" height="10"/></symbol>'
      + '<symbol id="r3" overflow="visible"><title>Quadro</title><use id="o3" href="#r1"/></symbol></defs>'
      + `${LAYER}<use id="ia" transform="translate(10 10)" xlink:href="#r1"/><use id="ib" transform="translate(50 10)" href="#r2"/>`
      + '<use id="ic" transform="translate(80 10)" href="#r3"/><rect id="od" x="0" y="50" width="10" height="10"/></g>',
  );

  it("conta le istanze di ogni simbolo, anche quelle dentro un altro simbolo", () => {
    const opened = open(LIBRARY);
    expect([...instanceCounts(opened.engine.model!)].sort()).toEqual([["r1", 2], ["r2", 1], ["r3", 1]]);
  });

  it("dà alle istanze scelte un altro simbolo al loro posto, e lascia il resto com'è", () => {
    const opened = open(LIBRARY);
    const swapped = swapOps(opened.engine.model!, units(opened, "ia", "ib", "od"), "r2", ids(opened));
    // Soltanto l'istanza che ne ha un altro cambia; `href` prende il posto
    // di `xlink:href`.
    expect(swapped.ops).toEqual([{ op: "set", id: "ia", attrs: { href: "#r2", "xlink:href": null } }]);
    expect(swapped.keys).toEqual(["ia", "ib", "od"]);
    const index = applied(opened, swapped);
    expect(opened.engine.text).toContain('<use id="ia" transform="translate(10 10)" href="#r2"/>');
    expect(index.get("ia")?.bounds).toEqual({ min: [5, 5], max: [15, 15] });
    expect(instanceCounts(opened.engine.model!).get("r1")).toBe(1);
  });

  it("sa quali simboli conterrebbero sé stessi", () => {
    const opened = open(LIBRARY);
    const model = opened.engine.model!;
    // Sul foglio un'istanza può avere ogni simbolo.
    expect(cyclingSymbols(model, units(opened, "ia", "ic"))).toEqual(new Set());
    // Nel contenuto di «Presa» no «Presa», né «Quadro», che usa «Presa».
    const inside = (id: string): Unit => ({ node: opened.engine.holder(id)! }) as unknown as Unit;
    expect(cyclingSymbols(model, [inside("o1")])).toEqual(new Set(["r1", "r3"]));
    expect(cyclingSymbols(model, [inside("o3")])).toEqual(new Set(["r3"]));
  });

  it("rinomina un simbolo con un nome che nessun altro ha", () => {
    const opened = open(LIBRARY);
    const model = opened.engine.model!;
    expect(symbolNameProblem(model, "")).toBe("empty");
    // I nomi si confrontano come li legge una persona.
    expect(symbolNameProblem(model, "PRESA")).toBe("taken");
    expect(symbolNameProblem(model, "presa", "r1")).toBeNull();
    expect(symbolNameProblem(model, "Lampada")).toBeNull();
    const [presa] = documentSymbols(model);
    const renamed = renameSymbolOps(model, presa!, "Presa doppia", ids(opened));
    if (renamed === "foreign") throw new Error("estraneo");
    applied(opened, renamed);
    expect(documentSymbols(opened.engine.model!).map((symbol) => symbol.name)).toEqual(["Presa doppia", "Interruttore", "Quadro"]);
    // Un simbolo senza nome ne riceve uno.
    const unnamed = open(doc('<defs id="fub-defs"><symbol id="r1" overflow="visible"><circle id="o1" r="5"/></symbol></defs>'));
    const named = renameSymbolOps(unnamed.engine.model!, documentSymbols(unnamed.engine.model!)[0]!, "Punto", ids(unnamed));
    if (named === "foreign") throw new Error("estraneo");
    applied(unnamed, named);
    expect(documentSymbols(unnamed.engine.model!)[0]!.name).toBe("Punto");
  });
});
