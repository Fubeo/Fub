// I segni del tracciato aperto e gli insiemi degli strumenti dei tracciati
// (piano K6, T12), senza DOM.

import { describe, expect, it } from "vitest";
import type { DrawingOverlay } from "../../../host/contract";
import { A_PIU_CLIC, segniComeForma, STRUMENTI_DEI_TRACCIATI } from "./tracciati";

describe("gli strumenti dei tracciati", () => {
  it("sono ventuno, e quelli a più clic stanno fra loro", () => {
    expect(STRUMENTI_DEI_TRACCIATI.size).toBe(21);
    for (const id of A_PIU_CLIC) expect(STRUMENTI_DEI_TRACCIATI.has(id), id).toBe(true);
  });
});

describe("segniComeForma", () => {
  it("niente da disegnare: nessuna forma; le etichette scritte non si disegnano", () => {
    expect(segniComeForma([], 1)).toBeNull();
  });

  it("le linee sotto, i punti sopra, coi colori del tema e le misure divise per lo zoom", () => {
    const segni: DrawingOverlay[] = [
      { kind: "anchor", at: [10, 20], role: "selection", filled: true, size: 8 },
      { kind: "path", d: "M0 0 L10 20", role: "preview", width: 1, dashed: false },
    ];
    const forma = segniComeForma(segni, 2)!;
    expect(forma.attrs.class).toBe("draw-engine-marks");
    const figli = forma.children as { tag: string; attrs: Record<string, string> }[];
    expect(figli.map((f) => f.tag)).toEqual(["path", "rect"]);
    expect(figli[0]!.attrs.style).toBe("stroke: var(--accent)");
    // Un quadratino di 8 px sullo schermo, a zoom 2: 4 unità di scena, centrato.
    expect(figli[1]!.attrs).toEqual(expect.objectContaining({ x: "8", y: "18", width: "4", height: "4" }));
    expect(JSON.stringify(forma)).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
