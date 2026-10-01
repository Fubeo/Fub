// I cinque stili dei diagrammi Mermaid: le tavolozze. Le variabili del tema
// `base` di Mermaid, il CSS che le rifinisce e le decorazioni della tavola
// stanno in `mermaid-drawing.ts`, che si carica soltanto per disegnare.
//
// Un diagramma arriva alla shell come `<img>` di un SVG: le variabili CSS della
// pagina non lo raggiungono, e nemmeno i suoi caratteri. Per questo i colori
// si fissano al momento della resa — ogni stile ha una variante chiara e una
// scura, e l'alto contrasto rinforza tratti e bordi — e il carattere dello
// stile si incorpora nell'SVG (`fontFaceCss`), mentre Mermaid misura le
// etichette con lo stesso carattere già caricato nella pagina.
//
// «Armonia» non ha colori suoi: li deriva dai token del tema montato (fondo,
// testo, accento, tavolozza della sintassi), così segue temi e accento.
//
// Tutto qui è puro — niente DOM — e si prova senza Mermaid.

import type { DiagramStyleId } from "../theme/diagram-style";

export type DiagramLight = "light" | "dark";
export type DiagramContrast = "normal" | "high";
export type DiagramFont = "inter" | "literata" | "mono";

/// Un riempimento con il suo bordo e il suo testo.
export interface DiagramFill {
  readonly fill: string;
  readonly border: string;
  readonly text: string;
}

export interface DiagramPalette {
  readonly dark: boolean;
  /// Il fondo della tavola; `null` la lascia trasparente (Armonia), e si vede
  /// la cornice del diagramma.
  readonly paper: string | null;
  /// Il fondo reale sotto il diagramma: la carta, o la cornice se la carta è
  /// trasparente. Su questo si misura il contrasto.
  readonly ground: string;
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  /// L'unica nota di colore forte: critico, oggi, attivo.
  readonly accent: string;
  readonly primary: DiagramFill;
  readonly secondary: DiagramFill;
  readonly tertiary: DiagramFill;
  readonly note: DiagramFill;
  readonly cluster: DiagramFill;
  /// Dodici colori per le serie: torte, mappe mentali, rami, barre.
  readonly series: readonly string[];
  /// Quanti colori della serie si alternano sui nodi di flowchart, stati ed
  /// entità, nell'ordine in cui il sorgente li nomina; `0` li lascia tutti del
  /// riempimento primario.
  readonly nodeHues: number;
  readonly font: DiagramFont;
  /// Raggio degli angoli e spessore dei tratti, in px.
  readonly radius: number;
  readonly stroke: number;
  /// Il disegno della carta: tinta unita, griglia tecnica, alone, vignetta.
  readonly texture: "none" | "grid" | "glow" | "paper";
  /// Il colore della griglia o dell'alone.
  readonly texture2?: string;
}

// ---------------------------------------------------------------------------
// Colori: esadecimali sRGB, e le poche operazioni che servono.
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1]!;
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbOf(hex: string): Rgb {
  return parseHex(hex) ?? [128, 128, 128];
}

/// `amount` di `a` sopra `b` (0 = tutto `b`, 1 = tutto `a`).
export function mix(a: string, b: string, amount: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHex([0, 1, 2].map((i) => x[i]! * amount + y[i]! * (1 - amount)) as unknown as Rgb);
}

/// Luminanza relativa WCAG.
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// Rapporto di contrasto WCAG fra due colori, da 1 a 21.
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/// Il candidato più leggibile su `background`; se nessuno arriva a `target`,
/// il migliore si spinge verso il nero o il bianco finché ci arriva.
export function readableOn(background: string, candidates: readonly string[], target = 4.5): string {
  let best = candidates[0] ?? "#000000";
  for (const candidate of candidates) {
    if (contrast(candidate, background) > contrast(best, background)) best = candidate;
  }
  if (contrast(best, background) >= target) return best;
  const pole = luminance(background) > 0.18 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step++) {
    const next = mix(pole, best, step / 20);
    if (contrast(next, background) >= target) return next;
  }
  return pole;
}

// ---------------------------------------------------------------------------
// Le tavolozze scritte a mano.
// ---------------------------------------------------------------------------

function fill(fillColor: string, border: string, text: string): DiagramFill {
  return { fill: fillColor, border, text };
}

type Written = Omit<DiagramPalette, "ground" | "nodeHues"> & { paper: string };

/// Gli stili a colori alternano quattro tinte sui nodi; Blueprint e
/// Inchiostro restano monocromi, e il colore resta alle serie dei grafici.
const NODE_HUES: Record<DiagramStyleId, number> = {
  armonia: 4,
  acquerello: 4,
  aurora: 4,
  blueprint: 0,
  inchiostro: 0,
};

const ACQUERELLO: Record<DiagramLight, Written> = {
  light: {
    dark: false,
    paper: "#fbf7ef",
    ink: "#3a3632",
    muted: "#6b645a",
    line: "#8d8173",
    accent: "#c4613f",
    primary: fill("#fde4d6", "#e2a283", "#4a2a1c"),
    secondary: fill("#deedde", "#8fb593", "#213d27"),
    tertiary: fill("#e9e3f6", "#a596cf", "#2e2650"),
    note: fill("#fcf0c8", "#d9b95c", "#4a3a10"),
    cluster: fill("#f5efe3", "#d6cab5", "#4a4239"),
    series: [
      "#f5c3a9", "#b9d8bd", "#cdc2ea", "#b7d5ee", "#f2bfcd", "#f3dd9f",
      "#b3dfd3", "#e4cfb5", "#dcc4e6", "#d3e5b0", "#f4b3a2", "#c6d0f0",
    ],
    font: "literata",
    radius: 14,
    stroke: 1.5,
    texture: "paper",
    texture2: "#f1e8d8",
  },
  dark: {
    dark: true,
    paper: "#23201c",
    ink: "#efe8dd",
    muted: "#b5ab9c",
    line: "#a39888",
    accent: "#f0936f",
    primary: fill("#4a3328", "#c98c70", "#fbe9df"),
    secondary: fill("#2d3f30", "#86ad8b", "#e3f0e4"),
    tertiary: fill("#362f4b", "#a596cf", "#ece8f7"),
    note: fill("#453c20", "#c9ae5f", "#f7edd0"),
    cluster: fill("#2a2621", "#4d463c", "#e5ddd0"),
    series: [
      "#8c5a45", "#51704f", "#665a8c", "#4b6a88", "#8a5366", "#806f3c",
      "#44756a", "#78644c", "#765b84", "#627443", "#95594a", "#566391",
    ],
    font: "literata",
    radius: 14,
    stroke: 1.5,
    texture: "paper",
    texture2: "#1b1916",
  },
};

const AURORA: Record<DiagramLight, Written> = {
  light: {
    dark: false,
    paper: "#fcfbff",
    ink: "#1f1a3d",
    muted: "#57507a",
    line: "#6a58c9",
    accent: "#d6336c",
    primary: fill("#ede8ff", "#7b5cf0", "#2c1a78"),
    secondary: fill("#fde6f3", "#d6479a", "#6b0f45"),
    tertiary: fill("#d9f6f1", "#139d92", "#054840"),
    note: fill("#fff3d3", "#eca42a", "#573700"),
    cluster: fill("#f6f3ff", "#c3b4fb", "#2c2459"),
    series: [
      "#a996fb", "#f28cc0", "#5fd4c4", "#fbc15a", "#86b4f7", "#f59a9a",
      "#7fd49b", "#cfa2f7", "#6fd0e6", "#f9a867", "#f5a3c7", "#a3a7f7",
    ],
    font: "inter",
    radius: 12,
    stroke: 1.75,
    texture: "glow",
    texture2: "#efe9ff",
  },
  dark: {
    dark: true,
    paper: "#15122c",
    ink: "#f0ecff",
    muted: "#b3abd9",
    line: "#9d8cf7",
    accent: "#ff6b9d",
    primary: fill("#2a2163", "#8d6eff", "#f0ecff"),
    secondary: fill("#3d1741", "#f062b8", "#fde7f5"),
    tertiary: fill("#0e3a3b", "#2dd4bf", "#dcfaf6"),
    note: fill("#3b2d0e", "#f5b93b", "#fff3d6"),
    cluster: fill("#1c1839", "#4d40a0", "#ded8ff"),
    series: [
      "#6c4ae6", "#c12c79", "#0c8579", "#9a5c00", "#2c68d6", "#c43c3c",
      "#18834a", "#8a3fd6", "#0a7a99", "#b85410", "#c23f7f", "#4a4fd8",
    ],
    font: "inter",
    radius: 12,
    stroke: 1.75,
    texture: "glow",
    texture2: "#261e55",
  },
};

const BLUEPRINT: Record<DiagramLight, Written> = {
  light: {
    dark: false,
    paper: "#f4f8fd",
    ink: "#15345e",
    muted: "#4a6386",
    line: "#2d5a94",
    accent: "#d9642b",
    primary: fill("#ffffff", "#2d5a94", "#15345e"),
    secondary: fill("#e3eef9", "#4f86c2", "#15345e"),
    tertiary: fill("#dff2f7", "#2b8fae", "#0d3a4a"),
    note: fill("#fff6e8", "#d9924b", "#5a3310"),
    cluster: fill("#eaf1fa", "#7fa3cc", "#15345e"),
    series: [
      "#9fc0e6", "#8fd3e3", "#b8c7dc", "#a7d7cf", "#c3b8e6", "#f2c29b",
      "#b0cde9", "#9ee0dc", "#cfd8e6", "#bfe3b8", "#e0c3e6", "#f0d59a",
    ],
    font: "mono",
    radius: 3,
    stroke: 1.25,
    texture: "grid",
    texture2: "#dfe8f4",
  },
  dark: {
    dark: true,
    paper: "#0f2e56",
    ink: "#eaf3ff",
    muted: "#a9c3e4",
    line: "#9cc9ff",
    accent: "#ffb45e",
    primary: fill("#15396a", "#cfe3ff", "#eaf3ff"),
    secondary: fill("#12436e", "#79c7f2", "#eaf6ff"),
    tertiary: fill("#0d4a5e", "#5fd3f3", "#e3faff"),
    note: fill("#4a3a1e", "#ffb45e", "#fff1dc"),
    cluster: fill("#12345f", "#6f9fd6", "#dcebff"),
    series: [
      "#2f63a8", "#1b7a99", "#4d6384", "#1f7a70", "#5b4fa0", "#a45a1e",
      "#2a5f95", "#18806e", "#526b8c", "#3f7a3a", "#7a4f94", "#8a6a1a",
    ],
    font: "mono",
    radius: 3,
    stroke: 1.25,
    texture: "grid",
    texture2: "#1b4274",
  },
};

const INCHIOSTRO: Record<DiagramLight, Written> = {
  light: {
    dark: false,
    paper: "#fbf8f1",
    ink: "#1c1a17",
    muted: "#5d5850",
    line: "#3a3631",
    accent: "#c2381f",
    primary: fill("#fffdf8", "#2a2724", "#1c1a17"),
    secondary: fill("#f2eee5", "#5d5850", "#1c1a17"),
    tertiary: fill("#fffdf8", "#c2381f", "#1c1a17"),
    note: fill("#f7f1e1", "#9b927f", "#2a2622"),
    cluster: fill("#f6f2e9", "#a79f91", "#1c1a17"),
    series: [
      "#c2381f", "#3a3631", "#8c857a", "#d8d2c6", "#5d5850", "#e6a594",
      "#b3aca0", "#2a2724", "#efe9dd", "#77716a", "#9e2c17", "#c9c2b5",
    ],
    font: "literata",
    radius: 2,
    stroke: 1,
    texture: "paper",
    texture2: "#f3eee3",
  },
  dark: {
    dark: true,
    paper: "#181715",
    ink: "#eee9df",
    muted: "#b1aa9e",
    line: "#d4cdc0",
    accent: "#ff6a4d",
    primary: fill("#1f1d1a", "#e6e0d5", "#eee9df"),
    secondary: fill("#2a2723", "#9d968a", "#eee9df"),
    tertiary: fill("#1f1d1a", "#ff6a4d", "#eee9df"),
    note: fill("#2b2720", "#8d8577", "#efe8da"),
    cluster: fill("#1d1b18", "#5a554c", "#eee9df"),
    series: [
      "#ff6a4d", "#e6e0d5", "#8d867b", "#4a4640", "#bdb6aa", "#a8412c",
      "#6b665d", "#f2ece2", "#35322d", "#a39c90", "#ff9a82", "#57524a",
    ],
    font: "literata",
    radius: 2,
    stroke: 1,
    texture: "paper",
    texture2: "#12110f",
  },
};

// ---------------------------------------------------------------------------
// Armonia: derivata dai token del tema.
// ---------------------------------------------------------------------------

/// Legge un token del tema montato già risolto in esadecimale, o `null`.
/// `ground` è il fondo della cornice dei diagrammi (`--doc-fill-soft` sopra
/// `--doc-bg`).
export type TokenReader = (token: string) => string | null;

export const ARMONIA_TOKENS = [
  "ground", "--doc-fg", "--muted", "--accent", "--warning",
  "--syn-function", "--syn-keyword", "--syn-string", "--syn-literal",
  "--syn-operator", "--syn-name", "--syn-type",
] as const;

/// I valori del tema di serie: valgono quando un token manca (un tema di
/// terzi che non lo dichiara, o i test senza tela).
const ARMONIA_FALLBACK: Record<DiagramLight, Record<(typeof ARMONIA_TOKENS)[number], string>> = {
  light: {
    ground: "#f2f0ed",
    "--doc-fg": "#34312e",
    "--muted": "#605c56",
    "--accent": "#4c6a28",
    "--warning": "#7f5300",
    "--syn-function": "#2b5f92",
    "--syn-keyword": "#744981",
    "--syn-string": "#3e6840",
    "--syn-literal": "#814f22",
    "--syn-operator": "#236775",
    "--syn-name": "#8c443a",
    "--syn-type": "#705a12",
  },
  dark: {
    ground: "#222120",
    "--doc-fg": "#d5d1cc",
    "--muted": "#aba7a1",
    "--accent": "#a7ca85",
    "--warning": "#d59d49",
    "--syn-function": "#7bb2ea",
    "--syn-keyword": "#c799d6",
    "--syn-string": "#8dbb8e",
    "--syn-literal": "#d79f72",
    "--syn-operator": "#77b8c8",
    "--syn-name": "#e59587",
    "--syn-type": "#c3ab68",
  },
};

function armonia(light: DiagramLight, read: TokenReader): DiagramPalette {
  const dark = light === "dark";
  const token = (name: (typeof ARMONIA_TOKENS)[number]): string => {
    const value = read(name);
    return value && parseHex(value) ? value : ARMONIA_FALLBACK[light][name];
  };
  const ground = token("ground");
  const ink = token("--doc-fg");
  const muted = token("--muted");
  const accent = token("--accent");
  const hues = [
    token("--syn-function"), token("--syn-keyword"), token("--syn-string"), token("--syn-literal"),
    token("--syn-operator"), token("--syn-name"), token("--syn-type"), accent,
  ];
  // Nei riempimenti la tinta è poca: il testo dei nodi resta il testo della
  // nota. Nelle serie è di più, ma ognuna ha l'etichetta leggibile.
  const tint = dark ? 0.24 : 0.14;
  const edge = dark ? 0.72 : 0.62;
  const tone = (hue: string): DiagramFill => {
    const f = mix(hue, ground, tint);
    return fill(f, mix(hue, ground, edge), readableOn(f, [ink]));
  };
  const deep = dark ? 0.5 : 0.36;
  const soft = dark ? 0.34 : 0.22;
  return {
    dark,
    paper: null,
    ground,
    ink,
    muted,
    line: readableOn(ground, [mix(ink, ground, 0.62)], 3),
    accent,
    primary: tone(accent),
    secondary: tone(hues[0]!),
    tertiary: tone(hues[1]!),
    note: tone(token("--warning")),
    cluster: fill(mix(ink, ground, dark ? 0.05 : 0.035), mix(ink, ground, 0.28), ink),
    series: [...hues.map((hue) => mix(hue, ground, deep)), ...hues.slice(0, 4).map((hue) => mix(hue, ground, soft))],
    nodeHues: NODE_HUES.armonia,
    font: "inter",
    radius: 10,
    stroke: 1.5,
    texture: "none",
  };
}

// ---------------------------------------------------------------------------
// La tavolozza di uno stile, e l'alto contrasto.
// ---------------------------------------------------------------------------

const WRITTEN: Record<Exclude<DiagramStyleId, "armonia">, Record<DiagramLight, Written>> = {
  acquerello: ACQUERELLO,
  aurora: AURORA,
  blueprint: BLUEPRINT,
  inchiostro: INCHIOSTRO,
};

/// Bordi e tratti verso l'inchiostro, tratti più spessi: l'alto contrasto
/// non cambia lo stile, lo rende più netto.
function sharpened(p: DiagramPalette): DiagramPalette {
  const firm = (f: DiagramFill): DiagramFill => ({
    fill: f.fill,
    border: mix(p.ink, f.border, 0.55),
    text: readableOn(f.fill, [f.text], 7),
  });
  return {
    ...p,
    ink: readableOn(p.ground, [p.ink], 7),
    muted: readableOn(p.ground, [p.muted], 4.5),
    line: readableOn(p.ground, [mix(p.ink, p.line, 0.5)], 4.5),
    primary: firm(p.primary),
    secondary: firm(p.secondary),
    tertiary: firm(p.tertiary),
    note: firm(p.note),
    cluster: firm(p.cluster),
    stroke: p.stroke + 0.75,
  };
}

export function paletteFor(
  style: DiagramStyleId,
  light: DiagramLight,
  level: DiagramContrast = "normal",
  read: TokenReader = () => null,
): DiagramPalette {
  const base: DiagramPalette = style === "armonia"
    ? armonia(light, read)
    : { ...WRITTEN[style][light], ground: WRITTEN[style][light].paper, nodeHues: NODE_HUES[style] };
  return level === "high" ? sharpened(base) : base;
}

/// L'etichetta leggibile su un colore della serie.
export function seriesLabel(p: DiagramPalette, color: string): string {
  return readableOn(color, [p.ink, p.dark ? p.ground : p.primary.fill, p.dark ? "#101010" : "#ffffff"]);
}

/// Il bordo di un nodo tinto: la sua tinta, spinta verso l'inchiostro.
export function seriesBorder(p: DiagramPalette, color: string): string {
  return mix(p.ink, color, 0.35);
}

/// La tinta più piena di un colore della serie su cui l'inchiostro si legge
/// ancora: per i riquadri del percorso utente, che Mermaid scrive sempre col
/// colore del testo.
export function inkTint(p: DiagramPalette, color: string): string {
  for (const amount of [1, 0.8, 0.62, 0.46, 0.32, 0.2]) {
    const tint = mix(color, p.ground, amount);
    if (contrast(p.ink, tint) >= 4.5) return tint;
  }
  return p.ground;
}

// ---------------------------------------------------------------------------
// Caratteri.
// ---------------------------------------------------------------------------

/// Le famiglie, come le dichiara `theme/serie/fonts.css`, con il ripiego del
/// sistema in coda; il file è quello che la shell serve già.
export const DIAGRAM_FONTS: Record<DiagramFont, { family: string; stack: string; file: string; size: number }> = {
  inter: {
    family: "Inter Variable",
    stack: '"Inter Variable", Inter, "Segoe UI", system-ui, sans-serif',
    file: "/fonts/inter-latin-wght-normal.woff2",
    size: 15,
  },
  literata: {
    family: "Literata Variable",
    stack: '"Literata Variable", Literata, Georgia, serif',
    file: "/fonts/literata-latin-wght-normal.woff2",
    size: 15,
  },
  mono: {
    family: "JetBrains Mono Variable",
    stack: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
    file: "/fonts/jetbrains-mono-latin-wght-normal.woff2",
    size: 13,
  },
};

/// La striscia di colori che rappresenta lo stile nel menu.
export function swatchesOf(p: DiagramPalette): string[] {
  return [p.paper ?? p.ground, p.primary.border, p.series[0]!, p.series[1]!, p.series[2]!, p.accent];
}
