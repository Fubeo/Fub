// Lo «spazio dell'interfaccia»: la cornice si stringe, i fogli no.
import { describe, expect, it } from "vitest";

import {
  CHROME_MEASURES,
  CHROME_MEASURE_TOKENS,
  chromeMeasure,
  COMPACTNESS_STEPS,
  compactnessTokens,
  normalizedCompactness,
  SHEET_MEASURE_TOKENS,
} from "./measures";
import { THEME_2_PREFERENCE_TOKENS } from "./profile";
import structure from "./structure.css?raw";

function declared(token: string): string | undefined {
  const root = /:root\s*\{([^}]*)\}/.exec(structure.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1] ?? "";
  return new RegExp(`--${token}:\\s*([^;]+);`).exec(root)?.[1]?.trim();
}

describe("le misure della cornice", () => {
  it("il passo 0 è ciò che la struttura dichiara, e non ridichiara niente", () => {
    for (const [token, loose] of CHROME_MEASURES) expect(declared(token), token).toBe(`${loose}px`);
    expect(compactnessTokens(0)).toEqual({});
  });

  it("l'ultimo passo è l'altro estremo, e in mezzo non si torna mai indietro", () => {
    const last = COMPACTNESS_STEPS - 1;
    for (const [token, loose, tight] of CHROME_MEASURES) {
      expect(chromeMeasure(token, last), token).toBe(tight);
      expect(tight, token).toBeLessThan(loose);
      let previous = loose;
      for (let step = 0; step < COMPACTNESS_STEPS; step++) {
        const value = chromeMeasure(token, step)!;
        expect(Number.isInteger(value), `${token}@${step}`).toBe(true);
        expect(value, `${token}@${step}`).toBeLessThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("ogni passo dopo il primo ridichiara tutte le misure, in pixel interi", () => {
    for (let step = 1; step < COMPACTNESS_STEPS; step++) {
      const tokens = compactnessTokens(step);
      expect(Object.keys(tokens).sort()).toEqual([...CHROME_MEASURE_TOKENS].sort());
      for (const value of Object.values(tokens)) expect(value).toMatch(/^\d+px$/);
    }
  });

  it("un bersaglio resta sempre premibile: mai sotto i 24 px", () => {
    for (let step = 0; step < COMPACTNESS_STEPS; step++) {
      expect(chromeMeasure("rail-target", step)!).toBeGreaterThanOrEqual(24);
      expect(chromeMeasure("chrome-btn", step)!).toBeGreaterThanOrEqual(22);
      expect(chromeMeasure("rail-w", step)!).toBeGreaterThanOrEqual(chromeMeasure("rail-target", step)!);
      expect(chromeMeasure("titlebar-h", step)!).toBeGreaterThanOrEqual(chromeMeasure("chrome-btn", step)!);
    }
  });

  it("un valore che non è un passo diventa un passo", () => {
    expect(normalizedCompactness(undefined)).toBe(0);
    expect(normalizedCompactness("3")).toBe(0);
    expect(normalizedCompactness(Number.NaN)).toBe(0);
    expect(normalizedCompactness(-2)).toBe(0);
    expect(normalizedCompactness(9)).toBe(COMPACTNESS_STEPS - 1);
    expect(normalizedCompactness(1.6)).toBe(2);
    expect(chromeMeasure("non-esiste", 2)).toBeNull();
  });
});

describe("le misure dei fogli", () => {
  it("sono della struttura, e nessuna preferenza le può ridichiarare", () => {
    for (const token of SHEET_MEASURE_TOKENS) {
      expect(declared(token), token).toBeDefined();
      expect(CHROME_MEASURE_TOKENS, token).not.toContain(token);
      expect(THEME_2_PREFERENCE_TOKENS, token).not.toContain(token);
    }
  });

  it("nessun passo le nomina", () => {
    for (let step = 0; step < COMPACTNESS_STEPS; step++) {
      for (const token of Object.keys(compactnessTokens(step))) expect(SHEET_MEASURE_TOKENS).not.toContain(token);
    }
  });
});
