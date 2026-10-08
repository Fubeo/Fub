// Il motore, quando c'è chi segue, lascia lette le unità che una `batch` di
// molti `set` ha appena riscritto (`rememberHead`): chi segue le legge subito
// dopo, e non deve rileggerle. Ciò che ne ricava deve essere ciò che ricava
// leggendole da capo.

import { describe, expect, it } from "vitest";
import { SceneEngine, type Applied, type Outcome } from "../scene/engine";
import { HEADS, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { elemOf, fubAttributes, plainAttributes, readHead } from "./arrange";

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1"';
const idOf = (i: number): string => `o${i.toString(36).padStart(8, "0")}`;
const rect = (i: number, indent: string, extra = ""): string => `${indent}<rect id="${idOf(i)}"${extra} x="${i}" y="1" width="4" height="4" fill="#e69f00"/>`;

/// Due livelli, e nel primo un gruppo che dichiara il suo namespace `zz` e usa il
/// suo prefisso.
const SOURCE = [
  `<svg ${NS} fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">`,
  '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>',
  '  <g id="l3f8a0c2d" fub:layer="Livello 1">',
  rect(0, "    "),
  rect(1, "    "),
  '    <g id="g1aaaaaaa" xmlns:zz="urn:zz" transform="translate(5 5)">',
  rect(10, "      ", ' zz:tag="a"'),
  rect(11, "      ", ' zz:tag="b"'),
  rect(12, "      ", ' zz:tag="c"'),
  "    </g>",
  rect(2, "    "),
  "  </g>",
  '  <g id="l9k8j7h6g" fub:layer="Livello 2">',
  rect(3, "    "),
  `    <path id="${idOf(4)}"\n          d="M 1 1 L 5 5 Z" fill="none" stroke="#000000"/>`,
  rect(5, "    "),
  "  </g>",
  "</svg>",
  "",
].join("\n");

const set = (i: number, attrs: Record<string, string | null>): Op => ({ op: "set", id: idOf(i), attrs });

const applied = (outcome: Outcome): Applied => {
  if (outcome.outcome !== "applied") throw new Error(`rifiutata: ${outcome.reason} (${outcome.detail})`);
  return outcome;
};

/// Un tag d'apertura letto, senza i riferimenti alla posizione nel testo.
function headOf(node: ElementPart) {
  const read = readHead(node);
  return read === null
    ? null
    : { name: read.element.local, attrs: read.element.attrs.map((attr) => [attr.name, attr.local, read.doc.namespaces[attr.ns] ?? "", attr.value]) };
}

const OPS: Op[] = [
  set(0, { fill: "#112233", "fub:name": "Uno" }),
  set(10, { "zz:tag": "nuovo", fill: "#abcdef" }),
  set(1, { fill: null, stroke: "#0072b2" }),
  set(4, { fill: "#ff0000" }),
  set(11, { transform: "translate(3 4)" }),
  set(3, { "stroke-width": "2" }),
  set(12, { "zz:tag": null }),
  set(2, { "fub:name": "Due" }),
  set(5, { opacity: "0.5" }),
];

describe("le unità che una batch di molti set riscrive, per chi segue", () => {
  it("si trovano già lette, e si leggono come da capo", () => {
    const engine = SceneEngine.open(SOURCE);
    engine.follow = () => null;
    const out = applied(engine.apply({ op: "batch", ops: OPS }));
    const fresh = SceneEngine.open(out.text);
    const ids = OPS.map((op) => (op as { id: string }).id);
    for (const id of ids) {
      const node = engine.holder(id)!;
      const again = fresh.holder(id)!;
      expect(again).not.toBeNull();
      if (node.kind !== "leaf") throw new Error("non è un'unità");
      // Lette dal motore, non da chi segue; il resto di un modello nuovo no.
      const seeded = HEADS.get(node);
      expect(seeded?.raw).toBe(node.raw);
      expect(HEADS.get(again)).toBeUndefined();
      // E chi segue la usa: non la sostituisce con una lettura sua.
      readHead(node);
      expect(HEADS.get(node)).toBe(seeded);
      expect(headOf(node)).toEqual(headOf(again));
      expect(Object.fromEntries(plainAttributes(node))).toEqual(Object.fromEntries(plainAttributes(again)));
      expect(Object.fromEntries(fubAttributes(node))).toEqual(Object.fromEntries(fubAttributes(again)));
      expect(elemOf(node)).toEqual(elemOf(again));
    }
    // Il testo non è cambiato per averle lette.
    expect(engine.text).toBe(out.text);
  });

  it("si leggono ancora giuste dopo un altro set, un annulla e un ripeti", () => {
    const engine = SceneEngine.open(SOURCE);
    engine.follow = () => null;
    const out = applied(engine.apply({ op: "batch", ops: OPS }));
    const more = applied(engine.apply(set(10, { fill: "#000001" })));
    expect(plainAttributes(engine.holder(idOf(10))!).get("fill")).toBe("#000001");
    applied(engine.undo(more.undo));
    expect(plainAttributes(engine.holder(idOf(10))!).get("fill")).toBe("#abcdef");
    const undone = applied(engine.undo(out.undo));
    expect(undone.text).toBe(SOURCE);
    for (const op of OPS) {
      const node = engine.holder((op as { id: string }).id)!;
      expect(headOf(node)).toEqual(headOf(SceneEngine.open(SOURCE).holder((op as { id: string }).id)!));
    }
    const again = applied(engine.apply(out.forward));
    const fresh = SceneEngine.open(again.text);
    for (const op of OPS) {
      const id = (op as { id: string }).id;
      expect(headOf(engine.holder(id)!)).toEqual(headOf(fresh.holder(id)!));
    }
  });

  it("senza chi segue non si tiene niente", () => {
    const engine = SceneEngine.open(SOURCE);
    applied(engine.apply({ op: "batch", ops: OPS }));
    for (const op of OPS) expect(HEADS.get(engine.holder((op as { id: string }).id)!)).toBeUndefined();
  });
});
