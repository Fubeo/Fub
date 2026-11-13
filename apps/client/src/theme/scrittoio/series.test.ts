// La serie completa il foglio di un tema installato con i colori del logo
// (D26): un tema fatto a mano che non dichiara `--logo-*` non si ritrova la
// cartella verde di serie sopra i suoi colori.
import { describe, expect, it } from "vitest";
import misureLogo from "../../../../../assets/logo/misure.json?raw";
import { validateThemeBundle } from "../loader";
import { completeLogoSheet, SCRITTOIO_SERIES } from "./series";
import { LOGO_ROLES, sheet as seriesSheet, type ContrastLevel, type Light } from "./recipe";

/// I tre temi d'esempio del piano, misurati sul prototipo (`logo-temi.mjs`):
/// accento e fondi per luce e contrasto, e i colori attesi.
const MISURE = JSON.parse(misureLogo) as {
  temi: {
    id: string;
    varianti: Record<string, { accento: string; fondi: [string, string]; colori: Record<string, string> }>;
  }[];
};

/// Le dichiarazioni `--logo-*` dell'ultima regola che il completamento ha
/// aggiunto, con le chiavi senza prefisso come in `misure.json`.
function addedLogo(completed: string, original: string): Record<string, string> {
  const added = completed.slice(original.length);
  return Object.fromEntries(
    [...added.matchAll(/--logo-([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}

describe("la serie dà i colori del logo a un tema che non li dichiara", () => {
  const casi = MISURE.temi.flatMap((tema) =>
    Object.entries(tema.varianti).map(([variante, valori]) => {
      const [light, contrast] = variante.split("-") as [Light, ContrastLevel];
      return {
        tema: tema.id,
        light,
        contrast,
        valori,
        normale: tema.varianti[`${light}-normal`]!,
        alto: tema.varianti[`${light}-high`]!,
      };
    }),
  );

  it.each(casi)("$tema, $light × $contrast: i colori misurati nel piano", ({ light, contrast, valori, normale, alto }) => {
    // Il foglio di una luce: il contrasto alto ridice solo l'accento.
    const foglio = [
      ":root {",
      `  --accent: ${normale.accento};`,
      `  --bg: ${normale.fondi[0]};`,
      `  --bg-elev: ${normale.fondi[1]};`,
      "}",
      ':root[data-contrast="high"] {',
      `  --accent: ${alto.accento};`,
      "}",
      "",
    ].join("\n");
    const completo = completeLogoSheet(foglio, light, contrast);
    expect(completo.startsWith(foglio)).toBe(true);
    expect(addedLogo(completo, foglio)).toEqual(valori.colori);
  });

  it("passa dal montaggio: `completeSheet` è quello della serie", () => {
    expect(SCRITTOIO_SERIES.completeSheet).toBe(completeLogoSheet);
  });

  it("un tema senza i ruoli del logo, completato, passa il cancello", () => {
    for (const light of ["light", "dark"] as const) {
      for (const contrast of ["normal", "high"] as const) {
        const senza = seriesSheet(light, contrast).replace(/^\s*--logo-[\w-]+:[^;]*;\n/gm, "");
        expect(senza).not.toContain("--logo-");
        const completo = completeLogoSheet(senza, light, contrast);
        for (const role of LOGO_ROLES) expect(completo).toContain(`--${role}: #`);
        const reasons = validateThemeBundle(
          {
            manifest: {
              id: "prova",
              name: "Prova",
              version: "1.0.0",
              engine: SCRITTOIO_SERIES.manifest.engine,
              lights: [light],
              asset_namespace: "theme://prova/",
              motion: ["opacity", "transform"],
            },
            sheet: completo,
            skin: SCRITTOIO_SERIES.skin,
            assets: {},
          },
          light,
        );
        expect(reasons, `${light} × ${contrast}`).toEqual([]);
      }
    }
  });

  it("un tema che dichiara anche un solo ruolo del logo si tiene i suoi", () => {
    const foglio = ":root {\n  --accent: #a33f00;\n  --bg: #e3e4e6;\n  --logo-foglio-1: #ffcc00;\n}\n";
    expect(completeLogoSheet(foglio, "light", "normal")).toBe(foglio);
  });

  it("una regola di un'altra luce o del solo contrasto alto non conta", () => {
    const foglio = [
      ':root[data-theme="dark"] { --logo-cartella: #ffffff; }',
      ':root[data-contrast="high"] { --logo-cartella: #000000; }',
      ":root { --accent: #1d4f91; --bg: #e6ebf1; --bg-elev: #ffffff; }",
      "",
    ].join("\n");
    expect(addedLogo(completeLogoSheet(foglio, "light", "normal"), foglio).cartella).toBe("#5787ca");
    expect(completeLogoSheet(foglio, "light", "high")).toBe(foglio);
  });

  it("senza un accento leggibile il foglio resta com'è: la pelle ripiega sull'accento", () => {
    for (const foglio of [
      ":root { --bg: #ffffff; }",
      ":root { --accent: var(--altro); --bg: #ffffff; }",
      ":root { --accent: rgb(0 0 0 / 50%); }",
      "",
    ]) {
      expect(completeLogoSheet(foglio, "light", "normal")).toBe(foglio);
    }
  });

  it("un accento quasi grigio dà una cartella quasi grigia", () => {
    const foglio = ":root { --accent: #6b6e70; --bg: #f2f2f2; --bg-elev: #ffffff; }";
    const colori = addedLogo(completeLogoSheet(foglio, "light", "normal"), foglio);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(colori.cartella!.slice(i, i + 2), 16));
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThan(12);
  });
});
