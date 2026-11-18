// L'impaginatore della prova del motore del PDF (ADR 0247): una riga non si
// spezza fra due pagine, un fondo sì, e ogni pezzo si sposta nella sua pagina
// coi margini. La misura vera (lettere, facce, linee di base) chiede un motore
// che impagini: la prova il banco `bench/pdf-prova.mjs`.

import { describe, expect, it } from "vitest";
import { paginate, type Measured, type PageGeometry } from "./probe";

/// Una pagina piccola: 100 px di altezza utile, margini di 10.
const PAGE: PageGeometry = { width: 120, height: 120, margin: { top: 10, right: 10, bottom: 10, left: 10 } };

function line(top: number, testo = "riga"): Measured {
  return {
    item: { tipo: "testo", x: 0, y: top + 8, larghezza: 40, faccia: 0, corpo: 10, colore: [0, 0, 0, 1], testo, posizioni: [...testo].map((_, i) => i * 10) },
    top,
    bottom: top + 12,
    whole: true,
  };
}

function fill(top: number, h: number): Measured {
  return { item: { tipo: "riquadro", x: 0, y: top, w: 100, h, colore: [240, 240, 240, 1] }, top, bottom: top + h, whole: false };
}

describe("paginate", () => {
  it("tiene in una pagina ciò che ci sta, spostato dei margini", () => {
    const { pages, cuts } = paginate([line(0), line(20)], PAGE);
    expect(cuts).toEqual([0]);
    expect(pages).toHaveLength(1);
    expect(pages[0].pezzi.map((p) => [p.x, p.y])).toEqual([[10, 18], [10, 38]]);
  });

  it("manda alla pagina dopo la riga che non sta, intera", () => {
    const { pages, cuts } = paginate([line(80, "prima"), line(95, "seconda")], PAGE);
    // La seconda finirebbe a 107: la pagina si taglia al suo bordo alto.
    expect(cuts).toEqual([0, 95]);
    expect(pages[1].pezzi).toEqual([expect.objectContaining({ testo: "seconda", y: 18 })]);
  });

  it("taglia un fondo fra le pagine che attraversa", () => {
    const { pages } = paginate([line(80), line(95), fill(70, 60)], PAGE);
    const fills = pages.map((p) => p.pezzi.filter((x) => x.tipo === "riquadro"));
    // 70..95 sulla prima (dal taglio a 95), 95..130 sulla seconda.
    expect(fills[0]).toEqual([expect.objectContaining({ y: 80, h: 25 })]);
    expect(fills[1]).toEqual([expect.objectContaining({ y: 10, h: 35 })]);
  });

  it("spezza un pezzo più alto di una pagina senza girare a vuoto", () => {
    const tall: Measured = { item: { tipo: "immagine", x: 0, y: 0, w: 50, h: 250, file: "alta.png" }, top: 0, bottom: 250, whole: true };
    const { pages, cuts } = paginate([tall], PAGE);
    expect(cuts).toEqual([0, 100, 200]);
    expect(pages[0].pezzi).toHaveLength(1);
  });
});
