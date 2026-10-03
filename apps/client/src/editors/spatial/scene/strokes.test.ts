// I tratti di una scena: la parte di `crates/fub-scene/tests/ink.rs` che
// legge `fub:ink` e `fub:brush` dentro un documento, con la diagnostica S004 e
// S010. Il codec e il pennello da soli stanno in `ink/codec.test.ts` e
// `ink/brush.test.ts`.

import { describe, expect, it } from "vitest";
import { isEditable } from "./read";
import { at, doc, findings, load } from "./test-support";

/// Un tratto con inchiostro e pennello dati.
function strokeDoc(attributes: string): string {
  return doc(`<path id="o1" fub:tool="pen" d="M0 0 Q1 1 2 2 Z" fill="#0072b2" ${attributes}/>`);
}

const BRUSH = 'fub:brush="pf1 size=4 sim=0"';

describe("i tratti di una scena (ink.rs)", () => {
  it("un tratto valido si ridisegna", () => {
    const scene = load(strokeDoc(`${BRUSH} fub:ink="1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8"`));
    const stroke = at(scene, [0])!.stroke!;
    expect(stroke.redrawable).toBe(true);
    expect([stroke.samples, stroke.duration]).toEqual([3, 16]);
    expect(findings(scene)).toEqual([]);
    expect(isEditable(scene)).toBe(true);
  });

  it("un inchiostro o un pennello non validi sono S004 e il tratto resta modificabile", () => {
    for (const [attributes, details] of [
      [`${BRUSH} fub:ink="1 s100 cxy 0,0 1"`, ["fub:ink arity 1"]],
      [`${BRUSH} fub:ink="1 s100 cxyp 0,0,300"`, ["fub:ink range 0 p"]],
      [BRUSH, ["fub:ink missing"]],
      ['fub:ink="1 s10 cxy 0,0"', ["fub:brush missing"]],
      ['fub:ink="1 s10 cxy 0,0" fub:brush="pf1 size=4 size=4"', ["fub:brush repeated size"]],
      ['fub:ink="2 s10 cxy 0,0" fub:brush="pf2"', ["fub:ink version", "fub:brush algorithm"]],
    ] as const) {
      const scene = load(strokeDoc(attributes));
      const element = at(scene, [0])!;
      expect(element.role, attributes).toBe("stroke");
      expect(element.stroke!.redrawable).toBe(false);
      const found = findings(scene);
      expect(
        found.map((d) => d.detail),
        attributes,
      ).toEqual(details);
      expect(found.every((d) => d.code === "S004" && d.severity === "error")).toBe(true);
      for (const d of found) expect({ bytes: d.bytes, utf16: d.utf16 }).toEqual({ bytes: element.bytes, utf16: element.utf16 });
      // Il documento resta modificabile.
      expect(isEditable(scene)).toBe(true);
    }
  });

  it("i canali sconosciuti sono S010", () => {
    const scene = load(strokeDoc(`${BRUSH} fub:ink="1 s100 cxytq 0,0,0,5 1,1,4,-5"`));
    const stroke = at(scene, [0])!.stroke!;
    expect(stroke.redrawable).toBe(false);
    expect([stroke.samples, stroke.duration]).toEqual([2, 4]);
    const found = findings(scene);
    expect(found.length).toBe(1);
    const diagnostic = found[0]!;
    expect([diagnostic.code, diagnostic.severity]).toEqual(["S010", "info"]);
    expect(diagnostic.detail).toBe("q");
  });

  it("inchiostro e pennello contano solo sui tratti", () => {
    // Su un tracciato o su un elemento estraneo non si leggono.
    const source = doc('<path d="M0 0" fub:ink="rotto" fub:brush="rotto"/><use fub:tool="pen" fub:ink="x"/>');
    const scene = load(source);
    expect(findings(scene).every((d) => d.code === "S002")).toBe(true);
    expect(at(scene, [0])!.stroke).toBeUndefined();
  });
});
