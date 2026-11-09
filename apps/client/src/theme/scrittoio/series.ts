/**
 * La serie Scrittoio: ciò che la shell monta quando nessun tema installato è
 * scelto. L'ingresso della shell la dichiara con `declareThemeSeries`.
 *
 * L'identità resta `fub.serie`: chi ha scelto «il tema di serie» ha scelto
 * quello che c'è di serie, non una versione. Cambiano il motore, i fogli, la
 * pelle e i predefiniti.
 */
import { channels } from "../contrast";
import { fromHex } from "../oklch";
import type { Density, ThemeSeries } from "../theme";
import fonts from "./fonts.css?raw";
import { compactnessTokens } from "./measures";
import { THEME_2_ENGINE, THEME_2_PROFILE } from "./profile";
import {
  accentPalette,
  type ContrastLevel,
  DEFAULT_ACCENT_HUE,
  type Light,
  LOGO_ROLES,
  logoColors,
  SHEETS,
} from "./recipe";
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
    uiFont: "hanken",
    monoFont: "plex",
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
  // Le prime voci sono le pile dei fogli: scelte, non cambiano un pixel.
  uiFonts: {
    hanken: '"Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    inter: '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  monoFonts: {
    plex: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    jetbrains: '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    system: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
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
  completeSheet: completeLogoSheet,
};

/// La croma dell'accento a cui la cartella ha la croma piena dei file
/// dell'utente: sotto, la cartella scala verso il grigio.
const LOGO_FULL_CHROMA = 0.08;

/// Le dichiarazioni delle regole `:root` di un foglio che valgono per questa
/// luce e questo contrasto, nell'ordine in cui il foglio le scrive. Contano
/// `:root` da solo e con gli attributi `data-theme` e `data-contrast`; una
/// regola con altri attributi o altri selettori non è dei colori del foglio.
function rootDeclarations(sheet: string, light: Light, contrast: ContrastLevel): Record<string, string> {
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const rule of text.matchAll(/(:root[^{};]*)\{([^{}]*)\}/g)) {
    const selector = rule[1]!.trim();
    if (!/^:root(\[[^\]]+\])*$/.test(selector)) continue;
    const attributes = [...selector.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!.replace(/\s+/g, ""));
    const applies = attributes.every((attribute) => {
      if (attribute === `data-theme="${light}"`) return true;
      if (attribute === 'data-contrast="high"') return contrast === "high";
      return false;
    });
    if (!applies) continue;
    for (const declaration of rule[2]!.matchAll(/--([_a-zA-Z][_a-zA-Z0-9-]*)\s*:\s*([^;{}]+)/g)) {
      out[declaration[1]!] = declaration[2]!.trim();
    }
  }
  return out;
}

/// Un colore pieno come `#rrggbb`, o `null` se il conto non lo sa leggere (un
/// `var()`, un velo con l'alfa, un nome).
function solidHex(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    return `#${channels(value).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

/**
 * I colori del logo per un tema installato che non li dichiara (D26): la
 * cartella prende la tinta e la croma del suo `--accent` e si stacca dai suoi
 * `--bg` e `--bg-elev`, con la stessa regola della serie (`logoColors`). Un
 * tema che dichiara anche uno solo dei ruoli `--logo-*` si tiene i suoi, e
 * quelli che non dice cadono nel ripiego della pelle. Senza un accento
 * leggibile il foglio resta com'è, e la pelle ripiega sull'accento.
 */
export function completeLogoSheet(sheet: string, light: Light, contrast: ContrastLevel): string {
  const declared = rootDeclarations(sheet, light, contrast);
  if (LOGO_ROLES.some((role) => Object.prototype.hasOwnProperty.call(declared, role))) return sheet;
  const accent = solidHex(declared.accent);
  if (accent === null) return sheet;
  const backgrounds = [solidHex(declared.bg), solidHex(declared["bg-elev"])].filter(
    (value): value is string => value !== null,
  );
  const { h, c } = fromHex(accent);
  const colors = logoColors(light, contrast, h, backgrounds, Math.min(1, c / LOGO_FULL_CHROMA));
  const lines = Object.entries(colors).map(([role, value]) => `  --${role}: ${value};`);
  const separator = sheet.endsWith("\n") ? "" : "\n";
  return [
    `${sheet}${separator}`,
    "/* I colori del logo, ricavati da Fub dall'accento e dai fondi del tema (D26). */",
    ":root {",
    ...lines,
    "}",
    "",
  ].join("\n");
}
