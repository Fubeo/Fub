// I segni del tracciato aperto e gli insiemi degli strumenti dei tracciati
// (piano K6, T12), senza DOM.

import { describe, expect, it } from "vitest";
import type { DrawingOverlay } from "../../../host/contract";
import { A_PIU_CLIC, segniComeForma, STRUMENTI_DEI_TRACCIATI } from "./tracciati";

describe("gli strumenti dei tracciati", () => {
  it("sono ventidue, e quelli a più clic stanno fra loro", () => {
    expect(STRUMENTI_DEI_TRACCIATI.size).toBe(22);
    for (const id of A_PIU_CLIC) expect(STRUMENTI_DEI_TRACCIATI.has(id), id).toBe(true);
  });
});

describe("segniComeForma", () => {
  it("niente da disegnare: nessuna forma", () => {
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
    // Il colore sta nella pelle: sull'elemento solo le classi, nessuno stile.
    expect(figli[0]!.attrs.class).toBe("draw-engine-line");
    expect(figli[1]!.attrs.class).toBe("draw-engine-point draw-engine-point-pieno");
    expect(JSON.stringify(forma)).not.toContain("style");
    // Un quadratino di 8 px sullo schermo, a zoom 2: 4 unità di scena, centrato.
    expect(figli[1]!.attrs).toEqual(expect.objectContaining({ x: "8", y: "18", width: "4", height: "4" }));
    expect(JSON.stringify(forma)).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("le scritte del motore si vedono: misura, etichetta, distanza con la sua linea, evidenziazione e campione", () => {
    const segni: DrawingOverlay[] = [
      { kind: "measure", at: [5, 6], text: "L: 10 px" },
      { kind: "label", at: [1, 2], text: "ancoraggio", role: "guide" },
      { kind: "distance", a: [0, 0], b: [10, 0], text: "10 px", role: "guide" },
      { kind: "highlight", quad: [[0, 0], [4, 0], [4, 2], [0, 2]], role: "selection" },
      { kind: "swatch", at: [20, 20], color: "#ff000080", selected: true },
    ];
    const forma = segniComeForma(segni, 2)!;
    const figli = forma.children as { tag: string; attrs: Record<string, string>; children?: unknown }[];
    // L'evidenziazione sotto, poi la linea della distanza, il campione e le tre scritte sopra.
    expect(figli.map((f) => f.tag)).toEqual(["path", "path", "rect", "text", "text", "text"]);
    expect(figli[0]!.attrs.class).toBe("draw-engine-highlight");
    expect(figli[0]!.attrs.d).toBe("M0 0 L4 0 L4 2 L0 2 Z");
    expect(figli[2]!.attrs.fill).toBe("#ff000080");
    const righe = (f: { children?: unknown }) => (f.children as { text: string }[]).map((r) => r.text);
    expect(figli.slice(3).map(righe)).toEqual([["L: 10 px"], ["ancoraggio"], ["10 px"]]);
    // 11 px sullo schermo a zoom 2; la distanza scrive a metà.
    expect(figli[3]!.attrs).toEqual(expect.objectContaining({ x: "5", y: "6", "font-size": "5.5", class: "draw-engine-text" }));
    expect(figli[5]!.attrs).toEqual(expect.objectContaining({ x: "5", y: "0" }));
  });

  it("la misura del motore va a capo dove il motore va a capo: «W» sopra «H»", () => {
    const forma = segniComeForma([{ kind: "measure", at: [5, 6], text: "W: 100 px\nH: 110 px" }], 1)!;
    const testo = (forma.children as unknown as { tag: string; children: { attrs: Record<string, string>; text: string }[] }[]).find((f) => f.tag === "text")!;
    expect(testo.children.map((r) => r.text)).toEqual(["W: 100 px", "H: 110 px"]);
    expect(testo.children.map((r) => r.attrs.x)).toEqual(["5", "5"]);
    expect(testo.children.map((r) => r.attrs.dy)).toEqual(["0", "13"]);
  });
});
