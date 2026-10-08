import { describe, expect, it } from "vitest";
import { readInside } from "./labels";
import { escapeAttribute } from "./serialize";
import { at, doc, load } from "./test-support";
import cases from "../../../__fixtures__/scene-labels/cases.json";

describe("le etichette nelle forme", () => {
  it("i casi sono tanti quanti il formato ne chiede", () => {
    const read = cases.inside.filter((row) => row.read !== null).length;
    expect(read).toBeGreaterThanOrEqual(6);
    expect(cases.inside.length - read).toBeGreaterThanOrEqual(6);
  });

  for (const { text, read } of cases.inside) {
    it(`fub:inside=${JSON.stringify(text)} ${read === null ? "è fuori grammatica" : "si legge"}`, () => {
      expect(readInside(text)).toBe(read);
    });
  }

  it("un testo porta la forma scritta, e una che non si legge non la porta", () => {
    for (const { text, read } of cases.inside) {
      const scene = load(doc(`<text fub:inside="${escapeAttribute(text)}" x="5" y="5"><tspan x="5" dy="0">Sì</tspan></text>`));
      const item = at(scene, [0])!;
      expect(item.role, text).toBe("text");
      expect(item.inside, text).toBe(read === null ? undefined : read);
    }
  });

  it("fub:inside conta solo su un testo", () => {
    const scene = load(doc('<rect fub:inside="r1" x="0" y="0" width="10" height="10"/>'));
    expect(at(scene, [0])!.role).toBe("rect");
    expect(at(scene, [0])!.inside).toBeUndefined();
  });
});
