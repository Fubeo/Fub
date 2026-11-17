// Quanto conta la ricetta a ogni cambio d'accento: le luminanze dei fondi si
// contano una volta per colore cercato, non a ogni tentativo della ricerca
// (`docs/product/performance-webview.md`, «Il quinto giro»).
import { describe, expect, it, vi } from "vitest";

const counted = vi.hoisted(() => ({ parsed: 0 }));

vi.mock("../contrast", async (importOriginal) => {
  const real = await importOriginal<typeof import("../contrast")>();
  // Ogni colore letto dal testo passa da qui: `contrast` ne legge due.
  return {
    ...real,
    luminance: (color: string) => {
      counted.parsed += 1;
      return real.luminance(color);
    },
    contrast: (a: string, b: string) => {
      counted.parsed += 2;
      return real.contrast(a, b);
    },
  };
});

const { palette } = await import("./recipe");

describe("il costo della ricetta", () => {
  it("non rilegge i fondi a ogni tentativo", () => {
    for (const light of ["light", "dark"] as const) {
      for (const level of ["normal", "high"] as const) {
        counted.parsed = 0;
        palette(light, level, 250);
        // Prima erano migliaia (una coppia per tentativo e per fondo).
        expect(counted.parsed, `${light} ${level}`).toBeLessThan(400);
      }
    }
  });
});
