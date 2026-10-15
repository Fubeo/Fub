/**
 * Lo «spazio dell'interfaccia»: quanta finestra va alla cornice e quanta ai
 * fogli (`chrome.compactness`, da 0 a 4).
 *
 * A ogni passo le icone laterali rimpiccioliscono, i rientri e i margini
 * interni si accorciano e le barre si assottigliano; lo spazio tolto va ai
 * fogli. **I fogli non si toccano**: margine, raggio, linguette, testata e
 * barra di formattazione non compaiono in questa tabella, e un presidio lo
 * controlla.
 *
 * Qui stanno i due estremi. I passi intermedi sono interpolati e arrotondati
 * al pixel intero, così un'icona non finisce mai su mezzo pixel. Il passo 0 è
 * anche ciò che `structure.css` dichiara: se la persona non ha scelto niente,
 * il canale delle preferenze non ridichiara nulla e vale la struttura.
 */

export const COMPACTNESS_STEPS = 5;
export const DEFAULT_COMPACTNESS = 0;

/** `[token, passo 0, passo 4]`, in pixel al 100% di zoom. */
export const CHROME_MEASURES: readonly (readonly [token: string, loose: number, tight: number])[] = [
  ["titlebar-h", 40, 28],
  ["chrome-btn", 28, 22],
  ["win-ctrl-w", 46, 36],
  ["rail-w", 44, 28],
  ["rail-icon", 18, 14],
  ["rail-target", 32, 24],
  ["drawer-icon", 16, 14],
  ["tree-indent", 16, 8],
  ["drawer-pad", 12, 4],
  ["drawer-head-h", 36, 28],
  ["sidebar-w", 264, 216],
  ["sidebar-min", 208, 176],
  ["inspector-w", 300, 260],
  ["inspector-min", 248, 216],
  ["status-h", 26, 20],
];

export const CHROME_MEASURE_TOKENS: readonly string[] = CHROME_MEASURES.map(([token]) => token);

/** Le misure dei fogli: ferme a ogni passo, e per questo non sono preferenze. */
export const SHEET_MEASURE_TOKENS: readonly string[] = [
  "sheet-gap",
  "tab-h",
  "tab-min",
  "tab-max",
  "sheet-head-h",
  "format-bar-h",
  "tab-fillet",
  "tab-air",
  "tab-lap",
];

export function normalizedCompactness(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_COMPACTNESS;
  return Math.min(COMPACTNESS_STEPS - 1, Math.max(0, Math.round(value)));
}

/** La misura di un token a un passo, in pixel. */
export function chromeMeasure(token: string, step: number): number | null {
  const row = CHROME_MEASURES.find(([name]) => name === token);
  if (!row) return null;
  const [, loose, tight] = row;
  const at = normalizedCompactness(step) / (COMPACTNESS_STEPS - 1);
  return Math.round(loose + (tight - loose) * at);
}

/**
 * I token che il passo ridichiara. Al passo 0 non ce n'è nessuno: vale la
 * struttura, e il canale delle preferenze resta corto.
 */
export function compactnessTokens(step: number): Record<string, string> {
  const safe = normalizedCompactness(step);
  if (safe === DEFAULT_COMPACTNESS) return {};
  const tokens: Record<string, string> = {};
  for (const [token] of CHROME_MEASURES) tokens[token] = `${chromeMeasure(token, safe)}px`;
  return tokens;
}
