// Il disegno a parole: l'albero degli oggetti dalle voci della scena, e il
// nome di ciascuno.

import { describe as group, expect, it } from "vitest";
import { countObjects, describe, keyOf, outline, type OutlineNode } from "./describe";
import { readScene } from "./scene/read";
import { doc, ink } from "./scene/test-support";

const SOURCE = doc(
  "<title>Casa</title><desc>La pianta</desc>" +
    '<g id="l1" fub:layer="Sfondo" fub:locked="true"><rect id="o1" x="0" y="0" width="10" height="10"/></g>' +
    '<g id="l2" fub:layer="Disegno">' +
    '<rect x="1" y="1" width="2" height="2"/>' +
    '<g id="g1"><title>Porta  d’ingresso</title><circle r="1"/><line x2="1"/></g>' +
    '<text id="t1" x="0" y="10"><tspan x="0" dy="0">Cucina</tspan><tspan x="0" dy="1.2">e sala</tspan></text>' +
    "</g>" +
    '<g id="l3" fub:layer="Note" display="none"/>' +
    '<ellipse id="e1" rx="2" ry="1"/>',
);

const tree = (): OutlineNode[] => outline(readScene(SOURCE).items);

function labels(nodes: readonly OutlineNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [`${"  ".repeat(depth)}${describe(node, { parts: true })}`, ...labels(node.children, depth + 1)]);
}

group("l'albero degli oggetti", () => {
  it("segue il documento: livelli, i loro oggetti, i figli dei gruppi, gli oggetti alla radice", () => {
    expect(labels(tree())).toEqual([
      "Livello «Sfondo», bloccato",
      "  Rettangolo",
      "Livello «Disegno»",
      "  Rettangolo",
      "  Gruppo «Porta d’ingresso», 2 oggetti",
      "    Cerchio",
      "    Linea",
      "  Testo «Cucina e sala»",
      "Livello «Note», nascosto",
      "Ellisse",
    ]);
  });

  it("dà a ogni oggetto la chiave con cui l'editor lo sceglie", () => {
    const [locked, drawing, , ellipse] = tree();
    expect(locked!.key).toBe("l1");
    expect(drawing!.children.map((node) => node.key)).toEqual(["@3.0", "g1", "t1"]);
    expect(ellipse!.key).toBe("e1");
    expect(keyOf({ id: null, path: [1, 3] })).toBe("@1.3");
  });

  it("conta gli oggetti come li sceglie l'editor: un gruppo per uno", () => {
    expect(countObjects(tree())).toBe(5);
    expect(countObjects([])).toBe(0);
  });

  it("aggiunge il colore quando chi descrive lo sa", () => {
    const rect = tree()[1]!.children[0]!;
    expect(describe(rect, { color: "Blu" })).toBe("Rettangolo, Blu");
  });

  it("taglia un testo lungo con i puntini", () => {
    const long = "parola ".repeat(20);
    const node = outline(readScene(doc(`<text><tspan>${long}</tspan></text>`)).items)[0]!;
    expect(node.name!.endsWith("…")).toBe(true);
    expect(Array.from(node.name!)).toHaveLength(60);
  });

  it("chiama tratto ogni tratto a penna", () => {
    const [source] = ink(7);
    const strokes = outline(readScene(source).items).flatMap((node) => [node, ...node.children]).filter((node) => node.item.role === "stroke");
    expect(strokes.length).toBeGreaterThan(0);
    for (const node of strokes) expect(describe(node)).toMatch(/^(Tratto|Evidenziatura)$/);
  });
});
