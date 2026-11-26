// Le finestre Opzioni testo in area e Opzioni testo su tracciato partono dal testo scelto, come in
// VectorCraft: i campi vengono dalla lettura del motore (gli stessi comandi senza valori).

import { describe, expect, it } from "vitest";

import { PARTENZE_LETTE } from "./partenze";

describe("partenze delle finestre del testo", () => {
  it("Opzioni testo in area legge le misure, le righe e le colonne del testo scelto", () => {
    const partenza = PARTENZE_LETTE["text.areaOptions"];
    expect(partenza?.lettura).toBe("text.areaOptions");
    // La lettura del motore per un testo in area 200×20 (caso `text.areaOptions` delle famiglie).
    const campi = partenza?.campi({
      rows: 1,
      columns: 1,
      gutter: 18,
      inset: 0,
      firstBaseline: "ascent",
      firstBaselineMin: 0,
      verticalAlign: "top",
      fit: "autoHeight",
      flow: "columns",
      rowGutter: 18,
      fitMinPercent: 50,
      width: 200,
      height: 20,
      overflow: false,
      fitScale: 1,
    });
    expect(campi).toEqual({
      width: 200,
      height: 20,
      rows: 1,
      columns: 1,
      gutter: 18,
      rowGutter: 18,
      inset: 0,
      firstBaseline: "ascent",
      firstBaselineMin: 0,
      verticalAlign: "top",
      flow: "columns",
      fit: "autoHeight",
      fitMinPercent: 50,
    });
  });

  it("Opzioni testo su tracciato legge l'inizio e lascia vuota la fine che non c'è", () => {
    const partenza = PARTENZE_LETTE["type.pathOptions"];
    expect(partenza?.lettura).toBe("type.pathOptions");
    const campi = partenza?.campi({
      start: 0.25,
      end: null,
      flip: false,
      effect: "rainbow",
      alignToPath: "baseline",
      spacing: 0,
    });
    expect(campi).toEqual({
      start: 0.25,
      flip: false,
      effect: "rainbow",
      alignToPath: "baseline",
      spacing: 0,
    });
  });

  it("una lettura vuota o di tipo sbagliato lascia i valori di serie", () => {
    expect(PARTENZE_LETTE["type.pathOptions"]?.campi(null)).toEqual({});
    expect(
      PARTENZE_LETTE["text.areaOptions"]?.campi({ width: "200", fit: 3 }),
    ).toEqual({});
  });
});
