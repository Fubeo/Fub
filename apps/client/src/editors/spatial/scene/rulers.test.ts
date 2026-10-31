import { describe, expect, it } from "vitest";
import { MAX_GUIDES, parseGuides, parseUnits, UNIT_SIZE } from "./rulers";
import cases from "../../../__fixtures__/scene-rulers/cases.json";

describe("unità e guide del documento", () => {
  for (const { value, unit } of cases.units) {
    it(`fub:units=${JSON.stringify(value)} è ${unit ?? "fuori grammatica"}`, () => {
      expect(parseUnits(value)).toBe(unit);
    });
  }

  for (const { value, guides } of cases.guides) {
    it(`fub:guides=${JSON.stringify(value)} ${guides === null ? "è fuori grammatica" : `ha ${guides.length} guide`}`, () => {
      expect(parseGuides(value)).toEqual(guides);
    });
  }

  it("le guide sono al più mille", () => {
    const many = (n: number): string => Array.from({ length: n }, (_, i) => `x ${i}`).join("; ");
    expect(parseGuides(many(MAX_GUIDES))).toHaveLength(MAX_GUIDES);
    expect(parseGuides(many(MAX_GUIDES + 1))).toBeNull();
  });


  it("un pollice è 96 unità utente, 2,54 centimetri e 72 punti", () => {
    expect(UNIT_SIZE.in).toBe(96);
    expect(UNIT_SIZE.cm * 2.54).toBeCloseTo(96, 12);
    expect(UNIT_SIZE.mm * 25.4).toBeCloseTo(96, 12);
    expect(UNIT_SIZE.pt * 72).toBeCloseTo(96, 12);
    expect(UNIT_SIZE.px).toBe(1);
  });
});
