// @vitest-environment happy-dom
// La forma che ritaglia una maschera, scelta con «Modifica maschera»: l'editor
// la tiene scelta anche se non è un figlio del gruppo, e i gesti che la
// spostano riscrivono la parte `[0]` del suo `clipPath`, mai un oggetto nuovo.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { throughClipShapes } from "./clip-shapes";
import { createDrawEditor, type DrawEditor } from "./editor";

const SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">
  <defs id="fub-defs">
    <clipPath id="rkcu808lm" fub:role="private" clipPathUnits="userSpaceOnUse">
      <path id="rf0rma001" d="M60 60 L220 60 L220 160 L60 160 Z" fill="#000000"/>
    </clipPath>
  </defs>
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="l1a2b3c4d" fub:layer="Livello 1">
    <g id="o9xkn1dta" clip-path="url(#rkcu808lm)" transform="translate(10 0)">
      <path id="oa1a1a1a1" d="M40 40 L160 40 L160 160 L40 160 Z" fill="#3366aa"/>
      <path id="oe5e5e5e5" d="M150 60 L250 60 L250 150 L150 150 Z" fill="#e69f00"/>
    </g>
  </g>
</svg>`;

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  editor = createDrawEditor(host, SceneEngine.open(SOURCE), owner);
  editor.setTool("select");
});

afterEach(() => {
  owner.close();
  host.remove();
});

function key(name: string, init: KeyboardEventInit = {}): void {
  host.querySelector<HTMLElement>(".draw-surface")!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

describe("la forma di una maschera di ritaglio", () => {
  it("resta scelta, sola, come la sceglie il motore", () => {
    editor.select(["rf0rma001"]);
    expect(editor.selection).toEqual(["rf0rma001"]);
  });

  it("le frecce la spostano dentro il suo clipPath, e annulla la rimette", () => {
    const before = editor.engine.text;
    editor.select(["rf0rma001"]);
    key("ArrowRight");
    const after = editor.engine.text;
    expect(after).not.toBe(before);
    // Il gruppo e il contenuto non cambiano; la forma resta l'unica del ritaglio.
    expect(after).toContain('<g id="o9xkn1dta" clip-path="url(#rkcu808lm)" transform="translate(10 0)">');
    expect(after).toContain('<path id="oa1a1a1a1" d="M40 40 L160 40 L160 160 L40 160 Z"');
    expect(after.match(/rf0rma001/g)).toHaveLength(1);
    expect(after).toMatch(/<clipPath[^>]*>\s*<path id="rf0rma001" d="M60 60 L220 60 L220 160 L60 160 Z" fill="#000000" transform="matrix\(1 0 0 1 1 0\)"\/>/);
    expect(editor.selection).toEqual(["rf0rma001"]);
    editor.undo();
    expect(editor.engine.text).toBe(before);
    editor.redo();
    expect(editor.engine.text).toBe(after);
  });

  it("Elimina non la toglie: il ritaglio resta com'è", () => {
    const before = editor.engine.text;
    editor.select(["rf0rma001"]);
    key("Delete");
    expect(editor.engine.text).toBe(before);
  });

  it("un id che non è la forma di un ritaglio non si sceglie da qui", () => {
    editor.select(["rkcu808lm"]);
    expect(editor.selection).toEqual([]);
  });
});

describe("throughClipShapes", () => {
  const engine = SceneEngine.open(SOURCE);
  const holder = (id: string) => engine.holder(id);

  it("un set sulla forma va alla parte [0] del clipPath, anche in un batch", () => {
    const attrs = { d: "M0 0 L1 1 Z" };
    expect(throughClipShapes({ op: "set", id: "rf0rma001", attrs }, holder)).toEqual({ op: "set", id: "rkcu808lm", part: [0], attrs });
    const other = { op: "set", id: "oa1a1a1a1", attrs } as const;
    expect(throughClipShapes({ op: "batch", ops: [other, { op: "set", id: "rf0rma001", attrs }] }, holder)).toEqual({
      op: "batch",
      ops: [other, { op: "set", id: "rkcu808lm", part: [0], attrs }],
    });
    expect(throughClipShapes(other, holder)).toBe(other);
  });

  it("toglierla o cambiarle il tipo si rifiuta", () => {
    expect(throughClipShapes({ op: "remove", target: "rf0rma001" }, holder)).toBe("draw.reason.clipShape");
    expect(throughClipShapes({ op: "set", id: "rf0rma001", tag: "rect", attrs: {} }, holder)).toBe("draw.reason.clipShape");
  });
});
