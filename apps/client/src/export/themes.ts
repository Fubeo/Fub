// I temi di stampa dello spazio «Esporta in PDF» (E28, T71; il prototipo
// `PXT`, `PXC`, `PXPAL`, `PX_TH`, `pxColors`, `pxCon`, passo 28).
//
// Un tema di stampa decide gli undici colori della pagina e i caratteri e
// l'impostazione del testo (carattere del testo e dei titoli, corpo,
// interlinea, paragrafi, allineamento, giustificato, titoli numerati, scala
// dei titoli, colonne). Il profilo tiene il tema per nome e, sopra, ciò che
// la persona ha cambiato: un colore in `colori`, una scelta del testo in
// `testo` (un campo pieno). Cambiando tema ciò che è tuo resta.
//
// Qui il tema diventa le variabili CSS delle pagine, in due mazzi, come le
// due velocità dell'impaginatore (`paginate/slices.ts`):
//
// - `lookVariables`: i colori, che cambiano solo l'aspetto. Sostituiscono
//   anche i colori dell'app che la resa della Lettura legge (`--accent`,
//   `--border`, `--sheet-2`, …): le pagine si stampano coi colori del tema
//   di stampa, chiare anche se l'app è al buio;
// - `typeVariables`: i caratteri e l'impostazione, che cambiano le misure e
//   rifanno l'impaginazione.
//
// Le regole che leggono le variabili `--print-*` stanno nella pelle
// (`skin/export.css`), sulla resa che si misura e sulle sue copie.

import { PRINT_PAPER } from "../editors/media/print-view";
import type { ExportProfile, ProfileText } from "./profile";

/// Gli undici colori della pagina, nell'ordine in cui la sezione li mostra
/// (`ChiaveColore` del core, senza i quattro dei diagrammi).
export const PAGE_COLORS = [
  "carta",
  "testo",
  "titoli",
  "accento",
  "link",
  "testo-secondario",
  "linee",
  "evidenziato",
  "riquadri",
  "codice",
  "intestazioni-tabella",
] as const;

export type PageColor = (typeof PAGE_COLORS)[number];
export type PageColors = Readonly<Record<PageColor, string>>;

/// Quale tavolozza di tondi pronti offre ogni colore: le carte, gli
/// inchiostri, i fondi.
export type PaletteKind = "carta" | "inchiostro" | "fondo";

export const COLOR_KIND: Readonly<Record<PageColor, PaletteKind>> = {
  carta: "carta",
  testo: "inchiostro",
  titoli: "inchiostro",
  accento: "inchiostro",
  link: "inchiostro",
  "testo-secondario": "inchiostro",
  linee: "fondo",
  evidenziato: "fondo",
  riquadri: "fondo",
  codice: "fondo",
  "intestazioni-tabella": "fondo",
};

/// I tondi pronti (`PXPAL`).
export const PALETTES: Readonly<Record<PaletteKind, readonly string[]>> = {
  carta: ["#ffffff", "#fffdf8", "#fbf5e9", "#f6f8f7", "#f1f4f8", "#f4f1ea", "#1c1a16", "#131c16"],
  inchiostro: ["#000000", "#18231c", "#1b2430", "#006e46", "#1f4f8f", "#5a3a8a", "#8d2d63", "#b3261e", "#a4552a", "#8f4a00", "#6f5600", "#5d6962"],
  fondo: ["#ffffff", "#f2f6f3", "#e7f4ec", "#e9f0fa", "#f3ebf9", "#fbeeea", "#f6f0e3", "#fbefba", "#ffe9a8", "#f0f0f0", "#d5ded8", "#bdbdbd"],
};

/// I caratteri di stampa di Fub (gli id di `Testo::carattere_testo`), con
/// la pila CSS. Georgia e Palatino sono del sistema: dove mancano, la pila
/// ricade su Literata, che Fub porta con sé.
export const PRINT_FONTS: Readonly<Record<string, { readonly name: string; readonly stack: string }>> = {
  newsreader: { name: "Newsreader", stack: '"Newsreader Variable", Georgia, "Times New Roman", serif' },
  hanken: { name: "Hanken Grotesk", stack: '"Hanken Grotesk Variable", system-ui, sans-serif' },
  georgia: { name: "Georgia", stack: 'Georgia, "Literata Variable", "Times New Roman", serif' },
  palatino: { name: "Palatino", stack: '"Palatino Linotype", Palatino, "Book Antiqua", "Literata Variable", Georgia, serif' },
  plex: { name: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace' },
};

/// Ciò che un tema decide del testo, tutto pieno.
export interface ThemeText {
  readonly carattere_testo: string;
  readonly carattere_titoli: string;
  /// In punti.
  readonly corpo: number;
  readonly interlinea: number;
  readonly paragrafi: "spazio" | "rientro";
  readonly giustificato: boolean;
  readonly titoli_numerati: boolean;
  readonly scala_titoli: number;
  readonly allineamento_titoli: "sinistra" | "centro";
  readonly colonne: 1 | 2;
}

/// Ciò che vale quando il tema non lo dice (`PX_TH`).
const TEXT_DEFAULT: ThemeText = {
  carattere_testo: "newsreader",
  carattere_titoli: "hanken",
  corpo: 11,
  interlinea: 1.5,
  paragrafi: "spazio",
  giustificato: false,
  titoli_numerati: false,
  scala_titoli: 1.2,
  allineamento_titoli: "sinistra",
  colonne: 1,
};

/// Le chiavi del testo che il tema decide finché non le decidi tu
/// (`ChiaveTesto::TUTTE`). La sillabazione non è fra loro.
export const THEME_TEXT_KEYS = Object.keys(TEXT_DEFAULT) as readonly (keyof ThemeText)[];

export interface PrintTheme {
  readonly id: string;
  readonly colors: PageColors;
  readonly text: ThemeText;
}

function theme(id: string, c: readonly string[], text: Partial<ThemeText> = {}): PrintTheme {
  const colors = Object.fromEntries(PAGE_COLORS.map((key, index) => [key, c[index]])) as Record<PageColor, string>;
  return { id, colors, text: { ...TEXT_DEFAULT, ...text } };
}

// I colori nell'ordine di `PAGE_COLORS`: carta, testo, titoli, accento, link,
// testo secondario, linee, evidenziato, riquadri, codice, intestazioni.
const THEMES: readonly PrintTheme[] = [
  theme("fub", ["#ffffff", "#18231c", "#0f1a14", "#006e46", "#00573a", "#5d6962", "#d5ded8", "#fbefba", "#e7f4ec", "#f2f6f3", "#eef3ef"]),
  theme("classico", ["#fffdf8", "#1c1a17", "#1c1a17", "#8a2b1d", "#8a2b1d", "#6b655c", "#d9d3c7", "#f7e9b0", "#f6f0e3", "#f4efe6", "#f1ebdf"], { carattere_titoli: "newsreader", giustificato: true, paragrafi: "rientro", allineamento_titoli: "centro" }),
  theme("relazione", ["#ffffff", "#1b2430", "#12305c", "#1f4f8f", "#1f4f8f", "#5a6675", "#d3dbe6", "#fff0b3", "#e9f0fa", "#f1f4f8", "#e3ebf6"], { carattere_testo: "hanken", titoli_numerati: true, corpo: 10.5 }),
  theme("rivista", ["#ffffff", "#161616", "#111111", "#c8371f", "#c8371f", "#666666", "#dcdcdc", "#ffe9a8", "#fbeeea", "#f4f4f4", "#f0f0f0"], { colonne: 2, scala_titoli: 1.36, giustificato: true, corpo: 10 }),
  theme("accademico", ["#ffffff", "#111111", "#111111", "#333333", "#1a3f7a", "#555555", "#bdbdbd", "#f3e7a8", "#f3f3f3", "#f5f5f5", "#ececec"], { carattere_testo: "georgia", carattere_titoli: "georgia", giustificato: true, titoli_numerati: true, paragrafi: "rientro", interlinea: 1.6 }),
  theme("quaderno", ["#fbf5e9", "#3a2e22", "#2b2018", "#a4552a", "#8a4521", "#7a6a58", "#e2d6c1", "#f6e2a0", "#f3e9d6", "#f1e8d6", "#eee2cc"], { carattere_titoli: "newsreader", carattere_testo: "palatino" }),
  theme("essenziale", ["#ffffff", "#000000", "#000000", "#000000", "#000000", "#444444", "#8f8f8f", "#e6e6e6", "#ffffff", "#ffffff", "#ffffff"], { carattere_testo: "hanken", corpo: 10.5 }),
  theme("notte", ["#131c16", "#e4eae6", "#f1f5f2", "#55c690", "#7fd8ad", "#a0aaa4", "#313d35", "#5c4d16", "#17251c", "#19221c", "#1f2922"]),
];

const BY_ID = new Map(THEMES.map((entry) => [entry.id, entry]));

/// Gli id dei temi, nell'ordine della griglia.
export const THEME_IDS: readonly string[] = THEMES.map((entry) => entry.id);

/// Il tema `id`: uno che questa versione non conosce è il tema Fub, come lo
/// mostra la vista (`IdTema`).
export function printTheme(id: string): PrintTheme {
  return BY_ID.get(id) ?? THEMES[0];
}

// ── I colori ────────────────────────────────────────────────────────────────

/// Un colore scritto a mano: `#rrggbb` o `#rgb`, maiuscole o minuscole, come
/// lo legge il core (`Rgb::leggi`). Torna la forma del file, `#rrggbb`
/// minuscolo; uno scritto male torna `null`.
export function parseColor(text: string): string | null {
  const digits = text.trim().replace(/^#/u, "");
  if (!/^[0-9a-f]+$/iu.test(digits)) return null;
  if (digits.length === 6) return `#${digits.toLowerCase()}`;
  if (digits.length === 3) return `#${[...digits.toLowerCase()].map((d) => d + d).join("")}`;
  return null;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/// La luminanza relativa di WCAG 2 (`pxLum`).
export function luminance(hex: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/// Il contrasto fra due colori, da 1 a 21 (`pxCon`).
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/// Il grigio di un colore, con la sua luminosità percepita (`pxGray`).
export function grayOf(hex: string): string {
  const [r, g, b] = channels(hex);
  const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b).toString(16).padStart(2, "0");
  return `#${v}${v}${v}`;
}

/// Il minimo del testo sulla carta e dell'accento sulla carta.
export const TEXT_CONTRAST_MIN = 4.5;
export const ACCENT_CONTRAST_MIN = 3;

export interface ContrastReport {
  readonly text: number;
  readonly accent: number;
  readonly textLow: boolean;
  readonly accentLow: boolean;
}

export function contrastOf(colors: PageColors): ContrastReport {
  const text = contrast(colors.testo, colors.carta);
  const accent = contrast(colors.accento, colors.carta);
  return { text, accent, textLow: text < TEXT_CONTRAST_MIN, accentLow: accent < ACCENT_CONTRAST_MIN };
}

/// I colori che la persona ha cambiato nel profilo, solo quelli scritti
/// bene: uno scritto male resta quello del tema.
export function ownColors(profile: ExportProfile): Partial<Record<PageColor, string>> {
  const own: Partial<Record<PageColor, string>> = {};
  for (const key of PAGE_COLORS) {
    const value = profile.colori[key];
    const color = value === undefined ? null : parseColor(value);
    if (color) own[key] = color;
  }
  return own;
}

/// I colori della pagina come escono: quelli del tema, i tuoi sopra, poi il
/// risparmio d'inchiostro e il bianco e nero (`pxColors`). `themeId` mostra
/// un altro tema coi tuoi colori sopra (l'anteprima al passaggio).
export function pageColorsOf(profile: ExportProfile, themeId = profile.tema): PageColors {
  const c: Record<PageColor, string> = { ...printTheme(themeId).colors, ...ownColors(profile) };
  if (profile.inchiostro.risparmio) {
    // Niente fondi pieni, carta bianca; un inchiostro chiaro (la Notte)
    // diventa scuro, o sul bianco non si leggerebbe.
    c.carta = c.riquadri = c.codice = c["intestazioni-tabella"] = "#ffffff";
    if (luminance(c.testo) > 0.4) {
      c.testo = c.titoli = "#111111";
      c["testo-secondario"] = "#555555";
      c.linee = "#999999";
      c.accento = c.link = "#222222";
    }
  }
  if (profile.inchiostro.bianco_e_nero) for (const key of PAGE_COLORS) c[key] = grayOf(c[key]);
  return c;
}

/// Se la carta è scura (la Notte): il testo colorato e il codice prendono i
/// loro toni chiari.
export function darkPaper(colors: PageColors): boolean {
  return luminance(colors.carta) < 0.3;
}

/// Il testo colorato della nota sulla pagina (`--c-*` del prototipo): sulla
/// carta chiara e su quella scura, sempre gli stessi, qualunque sia la luce
/// dell'app.
const INKS_LIGHT: Readonly<Record<string, readonly [string, string]>> = {
  gray: ["#5b625e", "#ebeeec"],
  brown: ["#7a5232", "#f1e6dc"],
  orange: ["#8f4a00", "#fbe4cc"],
  yellow: ["#6f5600", "#f7eebf"],
  green: ["#1c6a3b", "#d6efdd"],
  blue: ["#1f4f8f", "#dce8f8"],
  purple: ["#5a3a8a", "#ebe2f6"],
  pink: ["#8d2d63", "#f8dfec"],
  red: ["#9e2b20", "#f8ddd7"],
};
const INKS_DARK: Readonly<Record<string, readonly [string, string]>> = {
  gray: ["#c5ccc8", "#29302c"],
  brown: ["#e0b893", "#3a2b1f"],
  orange: ["#f3b26b", "#3e2a12"],
  yellow: ["#ead170", "#393013"],
  green: ["#85d6a1", "#163322"],
  blue: ["#9ec3f5", "#182a44"],
  purple: ["#cbb2f1", "#2c2241"],
  pink: ["#f1a6cf", "#3d1d30"],
  red: ["#f29b8e", "#3f1d18"],
};

/// I colori del codice sulla carta scura (quelli del foglio scuro di Fub).
const SYNTAX_DARK: Readonly<Record<string, string>> = {
  "--doc-danger": "#ff7b74",
  "--syn-keyword": "#c8a5f0",
  "--syn-name": "#f69b94",
  "--syn-function": "#87bafd",
  "--syn-literal": "#eea471",
  "--syn-type": "#d8b260",
  "--syn-operator": "#4fccd9",
  "--syn-comment": "#99a79e",
  "--syn-string": "#82cb92",
  "--syn-invalid": "#f69c91",
};

/// Le variabili dei colori della pagina: cambiano solo l'aspetto, nessuna
/// reimpaginazione. Valgono sulla resa che si misura, sulle pagine dello
/// spazio e su quelle che vanno alla stampa.
export function lookVariables(profile: ExportProfile, themeId = profile.tema): Record<string, string> {
  const c = pageColorsOf(profile, themeId);
  const dark = darkPaper(c);
  const vars: Record<string, string> = { ...PRINT_PAPER, ...(dark ? SYNTAX_DARK : {}) };
  const set = (value: string, ...names: string[]) => {
    for (const name of names) vars[name] = value;
  };
  set(c.carta, "--doc-bg", "--sheet");
  set(c.testo, "--doc-fg", "--text");
  set(c.titoli, "--doc-heading", "--syn-heading");
  set(c.accento, "--print-accent", "--accent", "--accent-soft");
  set(c.link, "--doc-link");
  set(c["testo-secondario"], "--muted", "--doc-gutter-fg");
  set(c.linee, "--doc-rule", "--doc-rule-soft", "--border", "--border-strong");
  set(c.evidenziato, "--doc-highlight");
  set(c.riquadri, "--print-callout", "--accent-wash");
  set(c.codice, "--print-code", "--doc-fill-soft", "--sheet-2");
  set(c["intestazioni-tabella"], "--print-table-head", "--doc-fill");
  // Un fondo uguale alla carta non si vede più: il riquadro e il codice
  // prendono il filo delle linee (il risparmio d'inchiostro, l'Essenziale).
  set(c.riquadri === c.carta ? c.linee : "transparent", "--print-callout-edge");
  set(c.codice === c.carta ? c.linee : "transparent", "--print-code-edge");
  for (const [name, [ink, tint]] of Object.entries(dark ? INKS_DARK : INKS_LIGHT)) {
    vars[`--doc-color-${name}`] = profile.inchiostro.bianco_e_nero ? grayOf(ink) : ink;
    vars[`--doc-tint-${name}`] = profile.inchiostro.bianco_e_nero ? grayOf(tint) : tint;
  }
  // Il bianco e nero vale anche per ciò che i colori non raggiungono: le
  // immagini, i diagrammi, i colori scritti nella nota.
  if (profile.inchiostro.bianco_e_nero) vars["--print-filter"] = "grayscale(1)";
  return vars;
}

// ── I caratteri e l'impostazione ────────────────────────────────────────────

/// Il testo come esce: ciò che hai scelto tu, se no ciò che decide il tema.
/// Un valore che questa versione non conosce vale come quello del tema.
export function textOf(profile: ExportProfile, themeId = profile.tema): ThemeText {
  const base = printTheme(themeId).text;
  const own = profile.testo;
  const font = (value: string | null | undefined, fallback: string) => (value && value in PRINT_FONTS ? value : fallback);
  const number = (value: number | null | undefined, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);
  return {
    carattere_testo: font(own.carattere_testo, base.carattere_testo),
    carattere_titoli: font(own.carattere_titoli, base.carattere_titoli),
    corpo: number(own.corpo, base.corpo),
    interlinea: number(own.interlinea, base.interlinea),
    paragrafi: own.paragrafi === "spazio" || own.paragrafi === "rientro" ? own.paragrafi : base.paragrafi,
    giustificato: typeof own.giustificato === "boolean" ? own.giustificato : base.giustificato,
    titoli_numerati: typeof own.titoli_numerati === "boolean" ? own.titoli_numerati : base.titoli_numerati,
    scala_titoli: number(own.scala_titoli, base.scala_titoli),
    allineamento_titoli: own.allineamento_titoli === "sinistra" || own.allineamento_titoli === "centro" ? own.allineamento_titoli : base.allineamento_titoli,
    colonne: own.colonne === 1 || own.colonne === 2 ? own.colonne : base.colonne,
  };
}

const round = (value: number) => String(Math.round(value * 1000) / 1000);

/// Le variabili del testo: cambiano le misure, e rifanno l'impaginazione.
export function typeVariables(profile: ExportProfile, themeId = profile.tema): Record<string, string> {
  const text = textOf(profile, themeId);
  const hs = text.scala_titoli;
  return {
    "--font-reading": PRINT_FONTS[text.carattere_testo].stack,
    "--print-font-headings": PRINT_FONTS[text.carattere_titoli].stack,
    // Il corpo in punti, sulla pagina in pixel CSS: 96 per pollice, 72 punti.
    "--text-reading": `${round((text.corpo * 96) / 72)}px`,
    "--leading-relaxed": round(text.interlinea),
    "--print-h1": `${round(hs * hs * hs * 1.18)}em`,
    "--print-h2": `${round(hs * hs)}em`,
    "--print-h3": `${round(hs)}em`,
    "--print-text-align": text.giustificato ? "justify" : "start",
    "--print-heading-align": text.allineamento_titoli === "centro" ? "center" : "start",
    // Col rientro i paragrafi si toccano: il margine sopra del secondo
    // annulla quello sotto del primo.
    "--print-paragraph-pull": text.paragrafi === "rientro" ? "1" : "0",
    "--print-indent": text.paragrafi === "rientro" ? "1.5em" : "0",
    "--print-heading-numbers": text.titoli_numerati ? "inline" : "none",
  };
}

// ── Ciò che è tuo ───────────────────────────────────────────────────────────

/// Le scelte del testo che hai fatto tu (un campo pieno).
function ownTextKeys(text: ProfileText): (keyof ThemeText)[] {
  return THEME_TEXT_KEYS.filter((key) => text[key] !== undefined && text[key] !== null);
}

/// Quante regolazioni tue stanno sopra il tema: i colori (anche quelli dei
/// diagrammi) e le scelte del testo.
export function ownCount(profile: ExportProfile): number {
  return Object.keys(profile.colori).length + ownTextKeys(profile.testo).length;
}

/// Il profilo senza le regolazioni tue: torna tutto al tema.
export function withoutOwn(profile: ExportProfile): ExportProfile {
  const testo: Record<string, unknown> = { ...profile.testo };
  for (const key of THEME_TEXT_KEYS) delete testo[key];
  return { ...profile, colori: {}, testo: testo as unknown as ProfileText };
}

/// Il profilo con un colore tuo, o senza (`null`: torna a quello del tema).
export function withColor(profile: ExportProfile, key: PageColor, value: string | null): ExportProfile {
  const colori: Record<string, string> = { ...profile.colori };
  if (value === null) delete colori[key];
  else colori[key] = value;
  return { ...profile, colori };
}

// ── I titoli numerati ───────────────────────────────────────────────────────

/// Scrive su ogni titolo della resa il suo numero (`1`, `1.2`, `1.2.3`), in
/// `data-print-number`: la pelle lo mostra davanti al titolo quando il tema
/// li vuole numerati (`--print-heading-numbers`). Si contano tre livelli a
/// partire dal più alto che la nota usa, così una nota che comincia dai
/// Titoli 2 numera «1», non «0.1».
export function numberHeadings(root: HTMLElement): void {
  const headings = [...root.querySelectorAll<HTMLElement>(".markdown-rendered :is(h1, h2, h3, h4, h5, h6)")];
  const levels = headings.map((heading) => Number(heading.tagName.slice(1)));
  const top = levels.length > 0 ? Math.min(...levels) : 1;
  const counts = [0, 0, 0];
  headings.forEach((heading, index) => {
    const depth = levels[index] - top;
    if (depth > 2) {
      heading.removeAttribute("data-print-number");
      return;
    }
    counts[depth] += 1;
    for (let deeper = depth + 1; deeper < counts.length; deeper++) counts[deeper] = 0;
    heading.dataset["printNumber"] = counts.slice(0, depth + 1).map((n) => Math.max(1, n)).join(".");
  });
}
