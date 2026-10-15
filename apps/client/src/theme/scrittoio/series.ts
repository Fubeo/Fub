/**
 * La serie Scrittoio: ciò che la shell monta quando nessun tema installato è
 * scelto. L'ingresso della shell la dichiara con `declareThemeSeries`.
 *
 * L'identità resta `fub.serie`: chi ha scelto «il tema di serie» ha scelto
 * quello che c'è di serie, non una versione. Cambiano il motore, i fogli, la
 * pelle e i predefiniti.
 */
import type { Density, ThemeSeries } from "../theme";
import fonts from "./fonts.css?raw";
import { compactnessTokens } from "./measures";
import { THEME_2_ENGINE, THEME_2_PROFILE } from "./profile";
import { accentPalette, DEFAULT_ACCENT_HUE, SHEETS } from "./recipe";
import sheetDarkHigh from "./sheet-dark-high.css?raw";
import sheetDark from "./sheet-dark.css?raw";
import sheetLightHigh from "./sheet-light-high.css?raw";
import sheetLight from "./sheet-light.css?raw";
import skin from "./skin.css?raw";

const SHEET_TEXT: Readonly<Record<string, string>> = {
  [SHEETS.light.normal]: sheetLight,
  [SHEETS.light.high]: sheetLightHigh,
  [SHEETS.dark.normal]: sheetDark,
  [SHEETS.dark.high]: sheetDarkHigh,
};

/**
 * La densità: i dieci gradini che la seguono, poi l'altezza del controllo e
 * quella della riga. «Comoda» è ciò che il foglio dichiara, e per questo non
 * ridichiara niente.
 */
export const DENSITY_SCALE: Readonly<Record<Density, { spaces: readonly number[]; control: number; row: number }>> = {
  compact: { spaces: [2, 4, 4, 6, 8, 12, 16, 20, 24, 36], control: 28, row: 24 },
  comfortable: { spaces: [2, 4, 6, 8, 12, 16, 20, 24, 32, 48], control: 32, row: 28 },
  relaxed: { spaces: [2, 4, 8, 10, 14, 18, 24, 28, 36, 52], control: 36, row: 32 },
};

export function densityTokens(density: Density): Record<string, string> {
  if (density === "comfortable") return {};
  const scale = DENSITY_SCALE[density];
  const tokens: Record<string, string> = {};
  scale.spaces.forEach((space, index) => {
    tokens[`space-${index + 1}`] = `${space}px`;
  });
  tokens["control-h"] = `${scale.control}px`;
  tokens["row-h"] = `${scale.row}px`;
  return tokens;
}

export const SCRITTOIO_SERIES: ThemeSeries = {
  manifest: {
    id: "fub.serie",
    name: "Scrittoio",
    version: "2.0.0",
    engine: THEME_2_ENGINE,
    lights: ["dark", "light"],
    asset_namespace: "theme://fub.serie/",
    motion: ["opacity", "transform"],
  },
  profile: THEME_2_PROFILE,
  fonts,
  skin,
  defaults: {
    density: "comfortable",
    body: 17,
    lineHeight: 1.65,
    measure: 68,
    font: "newsreader",
    accent: DEFAULT_ACCENT_HUE,
    compactness: 0,
  },
  readingFonts: {
    newsreader: '"Newsreader Variable", Georgia, "Times New Roman", serif',
    hanken: '"Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    literata: '"Literata Variable", Georgia, "Times New Roman", serif',
    inter: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  sheet(light, contrast) {
    return SHEET_TEXT[SHEETS[light][contrast]]!;
  },
  tokens(value, light, contrast) {
    return {
      ...densityTokens(value.density),
      ...compactnessTokens(value.compactness ?? 0),
      ...accentPalette(light, contrast, value.accent),
    };
  },
};
