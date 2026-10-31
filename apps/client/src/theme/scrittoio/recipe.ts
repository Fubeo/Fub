/**
 * La ricetta della serie **Scrittoio**: si dichiara luminosità, croma e tinta
 * in OKLCH, ed escono i quattro fogli in esadecimale.
 *
 * # Che cosa decide
 *
 * La tavolozza «matita rossa e blu»: una scrivania color carta da zucchero, i
 * fogli sopra di lei sempre più chiari, un solo accento (la matita blu), il
 * rosso per i segni e l'evidenziatore per i risultati. Ogni colore ha un solo
 * significato, e nelle due luci il foglio resta più chiaro della scrivania: la
 * gerarchia non si inverte passando alla notte.
 *
 * I neutri non sono grigi: hanno croma sotto 0,02 e **la tinta dell'accento**.
 * Per questo l'accento scelto dalla persona non ridichiara quattro token ma
 * tutta la tavolozza (`accentPalette`), e la ricetta gira anche nella finestra,
 * non soltanto nel generatore.
 *
 * # Perché i valori sono punti di partenza
 *
 * Una coppia dichiarata «testo su fondo» deve reggere 4,5:1 (7:1 in alto
 * contrasto), e una tinta arbitraria non lo garantisce a nessuna luminosità
 * fissa: il giallo a 0,50 è più chiaro del blu a 0,50. `hold` parte dal valore
 * dichiarato e si allontana dalla carta finché la coppia regge, misurando
 * sull'esadecimale che esce davvero. Così la tabella qui sotto resta leggibile
 * come intenzione, e ciò che si monta è quello che passa il cancello.
 *
 * # Perché non importa la serie precedente
 *
 * Usa solo `oklch.ts` e `contrast.ts`. La serie precedente si toglie al
 * passaggio, e una ricetta che ne importasse gli aiutanti la terrebbe in vita
 * per tre funzioni.
 */
import { contrast } from "../contrast";
import { toHex, type Oklch } from "../oklch";
import type { CONTENT_COLORS } from "../../ui/sanitize";

export type Light = "light" | "dark";
export const LIGHTS = ["light", "dark"] as const;

export type ContrastLevel = "normal" | "high";
export const CONTRASTS = ["normal", "high"] as const;

/** La matita blu. */
export const DEFAULT_ACCENT_HUE = 265;

/** I campioni offerti nelle impostazioni del tema, oltre alla tinta libera. */
export const ACCENT_SWATCHES = [
  { id: "matita-blu", hue: 265 },
  { id: "viola", hue: 300 },
  { id: "prugna", hue: 340 },
  { id: "terracotta", hue: 55 },
  { id: "ocra", hue: 80 },
  { id: "salvia", hue: 130 },
  { id: "petrolio", hue: 205 },
] as const;

interface Thresholds {
  /** Testo che si legge. */
  readonly text: number;
  /** Confini, anelli, glifi: ciò che si deve distinguere, non leggere. */
  readonly ui: number;
}

const THRESHOLDS: Readonly<Record<ContrastLevel, Thresholds>> = {
  normal: { text: 4.5, ui: 3 },
  high: { text: 7, ui: 4.5 },
};

/// I nove colori del contenuto (`fub-color-*`, `fub-bg-*`): la tinta e la
/// croma di partenza; il grigio non ha tinta.
export const CONTENT_HUES: Readonly<Record<(typeof CONTENT_COLORS)[number], readonly [number, number]>> = {
  gray: [0, 0],
  brown: [50, 0.07],
  orange: [55, 0.16],
  yellow: [90, 0.14],
  green: [150, 0.14],
  blue: [250, 0.15],
  purple: [305, 0.15],
  pink: [350, 0.15],
  red: [27, 0.19],
};

/// Le tinte degli autori, nell'ordine dei posti: blu, rosso, verde, viola,
/// ocra, petrolio.
const AUTHOR_HUES: readonly number[] = [255, 25, 145, 310, 60, 200];

const lch = (l: number, c: number, h: number): Oklch => ({ l, c, h: ((h % 360) + 360) % 360 });

/// Si allontana dalla carta finché la coppia regge su ogni fondo.
///
/// La bisezione trova la luminosità; i passi finali lavorano sull'esadecimale,
/// perché l'arrotondamento a otto bit e la riduzione del croma al gamut possono
/// togliere il centesimo che la bisezione aveva trovato.
function hold(start: Oklch, backgrounds: readonly string[], target: number, light: Light): string {
  const passes = (color: Oklch): boolean => {
    const hex = toHex(color);
    return backgrounds.every((background) => contrast(hex, background) >= target);
  };
  if (passes(start)) return toHex(start);

  const limit = light === "light" ? 0 : 1;
  let near = start.l;
  let far = limit;
  for (let round = 0; round < 32; round += 1) {
    const middle = (near + far) / 2;
    if (passes({ ...start, l: middle })) far = middle;
    else near = middle;
  }
  let l = far;
  const step = light === "light" ? -0.002 : 0.002;
  for (let guard = 0; guard < 600 && !passes({ ...start, l }); guard += 1) {
    l = Math.min(1, Math.max(0, l + step));
  }
  return toHex({ ...start, l });
}

/// Il colore che si legge sopra un pieno: quasi bianco o quasi nero, quello dei
/// due che regge di più.
function over(fill: string, hue: number): string {
  const pale = toHex(lch(0.99, 0.005, hue));
  const deep = toHex(lch(0.16, 0.03, hue));
  return contrast(pale, fill) >= contrast(deep, fill) ? pale : deep;
}

function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/// Un velo: lo stesso colore, con un'opacità. Sta sopra superfici che la ricetta
/// non conosce (una riga dentro un foglio, dentro un menu, dentro un cassetto).
function veil(hex: string, percent: number): string {
  const [r, g, b] = channels(hex);
  return `rgb(${r} ${g} ${b} / ${percent}%)`;
}

/// Il velo come lo si vede su un fondo pieno: serve a misurare, non a dipingere.
function composed(hex: string, percent: number, background: string): string {
  const top = channels(hex);
  const bottom = channels(background);
  const alpha = percent / 100;
  const mix = top.map((value, index) => Math.round(value * alpha + bottom[index]! * (1 - alpha)));
  return `#${mix.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function shadow(light: Light, near: readonly [number, number, number], far: readonly [number, number, number]): string {
  // L'ombra non segue l'accento: è il colore dell'inchiostro di giorno e nero di
  // notte, sempre lo stesso, o cambiando accento si muoverebbe anche il rilievo.
  const ink = light === "light" ? "24 28 44" : "0 0 0";
  const layer = ([y, blur, alpha]: readonly [number, number, number]) => `0 ${y}px ${blur}px rgb(${ink} / ${alpha}%)`;
  return `${layer(near)}, ${layer(far)}`;
}

/// I sette livelli del rilievo: due strati morbidi, vicino e lontano.
const SHADOWS: Readonly<Record<Light, readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[]>> = {
  light: [
    [[1, 1, 5], [6, 20, 7]],
    [[1, 2, 6], [10, 28, 10]],
    [[2, 4, 8], [14, 36, 14]],
    [[3, 8, 9], [20, 52, 18]],
    [[4, 10, 10], [28, 70, 22]],
    [[6, 14, 12], [32, 80, 24]],
    [[10, 24, 16], [40, 96, 28]],
  ],
  dark: [
    [[1, 1, 25], [6, 20, 22]],
    [[1, 2, 28], [10, 28, 28]],
    [[2, 4, 30], [14, 36, 38]],
    [[3, 8, 32], [20, 52, 44]],
    [[4, 10, 35], [28, 70, 50]],
    [[6, 14, 38], [32, 80, 54]],
    [[10, 24, 42], [40, 96, 60]],
  ],
};

/// Le tinte della sintassi. Restano dove sono al cambio d'accento: una parola
/// chiave viola è un'abitudine di lettura, non un tono della scrivania.
const SYNTAX_HUES: Readonly<Record<string, number | null>> = {
  keyword: 305,
  name: 25,
  function: 255,
  literal: 55,
  type: 85,
  operator: 205,
  comment: null,
  string: 150,
  heading: null,
  invalid: 27,
};

/**
 * Tutti i colori di una variante. L'ordine delle chiavi è quello del foglio.
 */
export function palette(
  light: Light,
  level: ContrastLevel,
  accentHue: number = DEFAULT_ACCENT_HUE,
): Record<string, string> {
  const day = light === "light";
  const high = level === "high";
  const T = THRESHOLDS[level];
  const hue = ((accentHue % 360) + 360) % 360;
  // Di giorno la carta da zucchero vira appena verso il freddo rispetto
  // all'inchiostro; di notte tutto sta sulla stessa tinta.
  const paper = day ? hue - 10 : hue - 3;
  const pen = hue - 3;

  // ── Le superfici ────────────────────────────────────────────────────────
  const bg = toHex(day ? lch(0.945, 0.012, paper) : lch(0.165, 0.018, paper));
  const bgHover = toHex(day ? lch(0.915, 0.016, paper) : lch(0.205, 0.02, paper));
  const bgActive = toHex(day ? lch(0.885, 0.02, paper) : lch(0.24, 0.022, paper));
  const sheetColor = toHex(day ? lch(0.995, 0.002, paper) : lch(0.215, 0.016, paper));
  const sheet2 = toHex(day ? lch(0.972, 0.005, paper) : lch(0.25, 0.018, paper));
  const raise = toHex(day ? lch(1, 0, 0) : lch(0.27, 0.02, paper));
  const accentWash = toHex(day ? lch(0.92, 0.045, hue) : lch(0.32, 0.07, hue));
  const selection = toHex(day ? lch(0.9, 0.045, hue) : lch(0.34, 0.07, hue));
  const activeLine = toHex(day ? lch(0.975, 0.006, paper) : lch(0.24, 0.017, paper));

  /// Dove può finire del testo dell'interfaccia.
  const surfaces = [bg, bgHover, bgActive, sheetColor, sheet2, raise, accentWash];
  /// Dove può finire del testo del documento.
  const papers = [sheetColor, activeLine, selection];

  // ── L'inchiostro ────────────────────────────────────────────────────────
  const text = hold(
    day ? lch(high ? 0.16 : 0.24, 0.02, pen) : lch(high ? 0.97 : 0.93, 0.008, pen),
    surfaces,
    T.text,
    light,
  );
  const muted = hold(day ? lch(0.5, 0.018, pen) : lch(0.72, 0.014, pen), surfaces, T.text, light);
  const border = high
    ? hold(day ? lch(0.62, 0.018, pen) : lch(0.55, 0.02, pen), [bg, sheetColor, raise], T.ui, light)
    : toHex(day ? lch(0.88, 0.012, pen) : lch(0.31, 0.018, pen));
  const borderStrong = high
    ? hold(day ? lch(0.5, 0.02, pen) : lch(0.66, 0.02, pen), [bg, sheetColor, raise], T.ui, light)
    : toHex(day ? lch(0.78, 0.016, pen) : lch(0.4, 0.02, pen));
  // Il confine di un controllo: deve distinguersi dal fondo accanto (WCAG
  // 1.4.11), cosa che il filo — che separa, non delimita — non promette.
  const outline = hold(
    day ? lch(0.62, 0.018, pen) : lch(0.58, 0.02, pen),
    [bg, sheetColor, sheet2, raise],
    T.ui,
    light,
  );

  // ── La matita blu ───────────────────────────────────────────────────────
  const accent = hold(day ? lch(0.5, 0.19, hue) : lch(0.74, 0.13, hue), surfaces, T.text, light);
  const accentSoft = hold(day ? lch(0.43, 0.19, hue) : lch(0.81, 0.12, hue), surfaces, T.text, light);
  const accentContrast = over(accent, hue);
  const focusRing = accent;

  // ── I segni ─────────────────────────────────────────────────────────────
  const plain = [bg, bgHover, sheetColor, sheet2, raise];
  const sign = (dayColor: Oklch, nightColor: Oklch): string => hold(day ? dayColor : nightColor, plain, T.text, light);
  const danger = sign(lch(0.55, 0.21, 27), lch(0.7, 0.17, 25));
  const warning = sign(lch(0.56, 0.13, 70), lch(0.8, 0.13, 75));
  const success = sign(lch(0.52, 0.13, 155), lch(0.74, 0.13, 155));
  const info = sign(lch(0.52, 0.12, 240), lch(0.76, 0.1, 240));
  const wash = day ? 12 : 18;

  // L'evidenziatore si vede, non si legge: di notte è un velo, o un giallo
  // pieno su un foglio scuro abbaglierebbe la riga che vuole indicare.
  const marker = toHex(day ? lch(0.9, 0.16, 98) : lch(0.8, 0.13, 95));
  const amber = toHex(day ? lch(0.68, 0.15, 70) : lch(0.8, 0.13, 75));

  // ── La carta e la sintassi ──────────────────────────────────────────────
  const docFg = hold(
    day ? lch(high ? 0.18 : 0.27, 0.018, pen) : lch(high ? 0.96 : 0.9, 0.008, pen),
    papers,
    T.text,
    light,
  );
  const docLink = hold(day ? lch(0.5, 0.19, hue) : lch(0.74, 0.13, hue), papers, T.text, light);
  const docDanger = hold(day ? lch(0.55, 0.21, 27) : lch(0.7, 0.17, 25), papers, T.text, light);
  const gutter = hold(day ? lch(0.5, 0.018, pen) : lch(0.72, 0.014, pen), papers, T.text, light);
  const syntax = Object.fromEntries(
    Object.entries(SYNTAX_HUES).map(([token, tokenHue]) => {
      if (token === "heading") return [`syn-${token}`, docFg];
      const start = tokenHue === null
        ? (day ? lch(0.5, 0.02, pen) : lch(0.7, 0.02, pen))
        : (day ? lch(0.48, 0.13, tokenHue) : lch(0.78, 0.11, tokenHue));
      return [`syn-${token}`, hold(start, papers, T.text, light)];
    }),
  );

  // ── I segni sulla carta del tema ────────────────────────────────────────
  // Una revisione si legge, quindi regge come il testo; un'onda del
  // correttore o il filo di un commento si distinguono, quindi reggono come un
  // confine. Il fondo di un risultato della ricerca si misura dal testo che
  // gli sta sopra: si allontana dall'inchiostro finché lo lascia leggere.
  const docSpell = hold(day ? lch(0.55, 0.21, 27) : lch(0.7, 0.17, 25), papers, T.ui, light);
  const docGram = hold(day ? lch(0.56, 0.13, 70) : lch(0.8, 0.13, 75), papers, T.ui, light);
  const docComment = hold(day ? lch(0.68, 0.15, 70) : lch(0.8, 0.13, 75), papers, T.ui, light);
  const away = day ? "dark" : "light";
  const docFind = hold(day ? lch(0.92, 0.1, 98) : lch(0.36, 0.06, 95), [docFg], T.text, away);
  // Un colore per autore (`rich-autore-*`): sei tinte lontane fra loro, che
  // si leggono come il testo su ogni fondo della carta.
  const docAuthors = Object.fromEntries(
    AUTHOR_HUES.map((tint, i) => [`doc-author-${i + 1}`, hold(day ? lch(0.5, 0.17, tint) : lch(0.76, 0.12, tint), papers, T.text, light)]),
  );
  // ── La Live e i Blocchi ─────────────────────────────────────────────────
  // Un segno che si vede ancora in Live sta un passo sotto la sintassi della
  // Sorgente, ma si distingue come un confine; il testo fantasma e l'onda di
  // un segno aperto pure. I nove colori del contenuto si leggono come il
  // testo, e i loro fondi lasciano leggere l'inchiostro.
  const docSyntaxNear = hold(day ? lch(0.64, 0.08, 150) : lch(0.62, 0.07, 150), papers, T.ui, light);
  const docGhost = hold(day ? lch(0.64, 0.015, pen) : lch(0.6, 0.015, pen), papers, T.ui, light);
  const docWavy = hold(day ? lch(0.6, 0.14, 70) : lch(0.72, 0.13, 75), papers, T.ui, light);
  const contentColors = Object.fromEntries(Object.entries(CONTENT_HUES).flatMap(([name, [tint, chroma]]) => {
    const neutral = chroma === 0 ? pen : tint;
    return [
      [`doc-color-${name}`, hold(day ? lch(0.5, chroma || 0.015, neutral) : lch(0.76, chroma ? chroma * 0.75 : 0.015, neutral), papers, T.text, light)],
      [`doc-tint-${name}`, hold(day ? lch(0.93, chroma ? chroma * 0.35 : 0.01, neutral) : lch(0.32, chroma ? chroma * 0.4 : 0.012, neutral), [docFg], T.text, away)],
    ];
  }));
  const docFindNow = hold(day ? lch(0.84, 0.14, 80) : lch(0.46, 0.09, 75), [docFg], T.text, away);

  // ── La carta chiara di un file ──────────────────────────────────────────
  // Nell'aspetto `file` il contenuto sta sulla sua carta, che è bianca anche
  // di notte: i segni di Fub prendono i colori della carta chiara, o un
  // cursore fatto per il foglio scuro sparirebbe.
  const paperBg = "#ffffff";
  const paperActive = toHex(lch(0.975, 0.006, hue - 10));
  const paperSelection = toHex(lch(0.9, 0.045, hue));
  const paperPapers = [paperBg, paperActive, paperSelection];
  const paperInk = hold(lch(high ? 0.12 : 0.2, 0.008, pen), paperPapers, T.text, "light");
  const paperLink = hold(lch(0.5, 0.19, hue), paperPapers, T.text, "light");
  const paperDanger = hold(lch(0.55, 0.21, 27), paperPapers, T.text, "light");
  const paperVeil = (percent: number): string => veil(paperInk, percent);
  const paperMarker = toHex(lch(0.9, 0.16, 98));
  const paperAuthors = Object.fromEntries(AUTHOR_HUES.map((tint, i) => [`paper-author-${i + 1}`, hold(lch(0.5, 0.17, tint), paperPapers, T.text, "light")]));

  const graphNode = hold(day ? lch(0.62, 0.02, pen) : lch(0.58, 0.02, pen), [bg, sheetColor], T.ui, light);
  const levels = SHADOWS[light].map(([near, far]) => shadow(light, near, far));
  const inkVeil = (percent: number): string => veil(text, percent);

  return {
    // Le superfici, dalla scrivania al rialzo.
    bg,
    "bg-chrome": bg,
    "bg-panel": bg,
    "bg-hover": bgHover,
    "bg-active": bgActive,
    sheet: sheetColor,
    "sheet-2": sheet2,
    "bg-input": sheet2,
    "bg-elev": raise,
    "overlay-hover": inkVeil(day ? 5 : 7),
    "overlay-active": inkVeil(day ? 9 : 12),
    scrim: day ? veil(toHex(lch(0.2, 0.03, pen)), 32) : "rgb(0 0 0 / 52%)",

    // L'inchiostro e il filo.
    text,
    muted,
    border,
    "border-strong": borderStrong,
    outline,

    // La matita blu.
    accent,
    "accent-soft": accentSoft,
    "accent-contrast": accentContrast,
    "accent-wash": accentWash,
    "accent-veil": veil(accent, day ? 12 : 20),
    "focus-ring": focusRing,

    // I segni.
    danger,
    "danger-wash": veil(danger, wash),
    "danger-contrast": over(danger, 27),
    warning,
    "warning-wash": veil(warning, wash + 2),
    "warning-contrast": over(warning, 70),
    success,
    "success-wash": veil(success, wash + 2),
    "success-contrast": over(success, 155),
    info,
    "info-wash": veil(info, wash),
    "info-contrast": over(info, 240),
    highlight: day ? marker : veil(marker, 30),
    amber,

    // Il rilievo.
    "shadow-1": levels[0]!,
    "shadow-2": levels[1]!,
    "shadow-3": levels[2]!,
    "shadow-4": levels[3]!,
    "shadow-5": levels[4]!,
    "shadow-6": levels[5]!,
    "shadow-7": levels[6]!,
    "shadow-sm": levels[0]!,
    "shadow-md": levels[2]!,
    "shadow-lg": levels[4]!,
    "elevation-paper-surface": sheetColor,
    "elevation-paper-border": sheetColor,
    "elevation-paper-shadow": levels[0]!,
    "elevation-base-surface": bg,
    "elevation-base-border": bg,
    "elevation-base-shadow": "none",
    "elevation-chrome-surface": bg,
    "elevation-chrome-border": bg,
    "elevation-chrome-shadow": "none",
    "elevation-floating-surface": raise,
    "elevation-floating-border": high ? border : raise,
    "elevation-floating-shadow": levels[2]!,
    "elevation-dialog-surface": raise,
    "elevation-dialog-border": high ? border : raise,
    "elevation-dialog-shadow": levels[4]!,

    // La scrivania del disegno, attorno alla carta bianca: chiara di giorno,
    // e di notte abbastanza chiara da non far abbagliare la carta.
    "draw-desk": toHex(day ? lch(0.95, 0.004, 260) : lch(0.3, 0.008, 260)),

    // Il grafo.
    "graph-node": graphNode,
    "graph-node-active": accent,
    "graph-node-hover": accentSoft,

    // La carta.
    "doc-bg": sheetColor,
    "doc-active-line": activeLine,
    "doc-selection": selection,
    "doc-tooltip-bg": raise,
    "doc-fill": inkVeil(day ? 8 : 11),
    "doc-fill-soft": inkVeil(day ? 5 : 7),
    "doc-rule": inkVeil(day ? 30 : 34),
    "doc-rule-soft": inkVeil(day ? 16 : 20),
    "doc-highlight": veil(marker, day ? 55 : 30),
    "doc-fg": docFg,
    "doc-link": docLink,
    "doc-heading": docFg,
    "doc-danger": docDanger,
    "doc-gutter-fg": gutter,
    "doc-caret": accent,
    ...syntax,

    // I segni sulla carta del tema: ruoli facoltativi (`OPTIONAL_ROLES`).
    "doc-ins": docLink,
    "doc-del": docDanger,
    "doc-proof-spell": docSpell,
    "doc-proof-gram": docGram,
    "doc-find": docFind,
    "doc-find-now": docFindNow,
    "doc-comment": docComment,
    ...docAuthors,
    "doc-syntax-near": docSyntaxNear,
    "doc-ghost": docGhost,
    "doc-wavy": docWavy,
    "doc-block-hover": inkVeil(day ? 4 : 6),
    "doc-block-selected": veil(accent, day ? 12 : 20),
    "doc-drop-line": accent,
    ...contentColors,

    // La carta chiara di un file, con i suoi segni: facoltativi anche questi.
    "paper-bg": paperBg,
    "paper-ink": paperInk,
    "paper-link": paperLink,
    "paper-danger": paperDanger,
    "paper-rule": paperVeil(30),
    "paper-rule-soft": paperVeil(16),
    "paper-fill": paperVeil(8),
    "paper-fill-soft": paperVeil(5),
    "paper-caret": paperLink,
    "paper-selection": paperSelection,
    "paper-active-line": paperActive,
    "paper-highlight": veil(paperMarker, 55),
    "paper-ins": paperLink,
    "paper-del": paperDanger,
    "paper-proof-spell": hold(lch(0.55, 0.21, 27), paperPapers, T.ui, "light"),
    "paper-proof-gram": hold(lch(0.56, 0.13, 70), paperPapers, T.ui, "light"),
    "paper-find": hold(lch(0.92, 0.1, 98), [paperInk], T.text, "dark"),
    "paper-find-now": hold(lch(0.84, 0.14, 80), [paperInk], T.text, "dark"),
    "paper-comment": hold(lch(0.68, 0.15, 70), paperPapers, T.ui, "light"),
    ...paperAuthors,
  };
}

/// Il velo come lo vede chi guarda: per i presidi che misurano una coppia il
/// cui fondo è un velo.
export function composedOn(veilValue: string, background: string): string {
  const match = veilValue.match(/^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/);
  if (!match) return veilValue;
  const hex = `#${[match[1], match[2], match[3]].map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
  return composed(hex, Number(match[4]), background);
}

/**
 * Ciò che non dipende né dalla luce né dall'accento: scala, forma, caratteri,
 * tempi, molle. Sta nel foglio e non nella struttura perché è **del tema**: un
 * altro tema `theme-2` può avere altri raggi e altre molle, non un'altra
 * barra del titolo.
 */
const CONSTANTS: readonly (readonly [string, string])[] = [
  // La spaziatura: undici gradini. I primi dieci seguono la densità scelta.
  ["space-1", "2px"],
  ["space-2", "4px"],
  ["space-3", "6px"],
  ["space-4", "8px"],
  ["space-5", "12px"],
  ["space-6", "16px"],
  ["space-7", "20px"],
  ["space-8", "24px"],
  ["space-9", "32px"],
  ["space-10", "48px"],
  ["space-11", "64px"],
  // Il controllo e la riga: anche loro della densità.
  ["control-h", "32px"],
  ["row-h", "28px"],

  // I raggi, per ruolo.
  ["radius-xs", "4px"],
  ["radius-chip", "6px"],
  ["radius-control", "8px"],
  ["radius-menu", "10px"],
  ["radius-sheet", "12px"],
  ["radius-dialog", "14px"],
  ["radius-pill", "999px"],
  // I nomi di scala che il resto della shell spende già.
  ["radius-sm", "6px"],
  ["radius-md", "8px"],
  ["radius-lg", "12px"],

  // I caratteri.
  ["font-ui", '"Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  ["font-reading", '"Newsreader Variable", Georgia, "Times New Roman", serif'],
  ["font-mono", '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'],
  ["text-xs", "11px"],
  ["text-sm", "12px"],
  ["text-base", "13px"],
  ["text-md", "14px"],
  ["text-lg", "15px"],
  ["text-xl", "16px"],
  ["text-2xl", "19px"],
  ["text-3xl", "23px"],
  ["text-reading", "17px"],
  ["text-source", "14px"],
  ["weight-regular", "400"],
  ["weight-medium", "500"],
  ["weight-bold", "600"],
  ["leading-tight", "1.3"],
  ["leading-normal", "1.45"],
  ["leading-relaxed", "1.65"],
  ["content-width", "68ch"],
  ["tracking-caps", "0.06em"],

  // I tempi: stato, scambio, breve, ampio; la scena è dei momenti rari.
  ["duration-state", "90ms"],
  ["duration-fast", "140ms"],
  ["duration-med", "220ms"],
  ["duration-slow", "360ms"],
  ["duration-scene", "560ms"],
  ["ease", "cubic-bezier(0.25, 0.1, 0.25, 1)"],
  ["ease-out", "cubic-bezier(0.22, 1, 0.36, 1)"],
  ["ease-in", "cubic-bezier(0.32, 0, 0.67, 0)"],

  // Le molle: rigidezza e smorzamento, massa 1. `src/moto/` le legge come
  // numeri; nessuna regola CSS le spende.
  ["spring-snap-k", "560"],
  ["spring-snap-c", "38"],
  ["spring-soft-k", "300"],
  ["spring-soft-c", "30"],
  ["spring-wide-k", "170"],
  ["spring-wide-c", "24"],
  ["spring-elastic-k", "420"],
  ["spring-elastic-c", "20"],
  ["spring-jelly-k", "260"],
  ["spring-jelly-c", "12"],

  // L'anello del fuoco.
  ["focus-ring-width", "2px"],
  ["focus-ring-offset", "2px"],
];

/** I token di colore, cioè tutto ciò che `palette` decide. */
export const COLOR_TOKENS: readonly string[] = Object.keys(palette("light", "normal"));

/**
 * I ruoli che la serie dichiara e che un tema può non dichiarare: i segni
 * sulla carta del tema (`--doc-ins`, `--doc-find`, …) e la carta chiara di un
 * file (`--paper-*`), e la scrivania del disegno (`--draw-desk`). Facoltativi perché un ruolo obbligatorio nuovo farebbe
 * rifiutare ogni tema `theme-2` di oggi; chi non li dichiara ha il ripiego di
 * `structure.css`, e le loro coppie si contano solo quando ci sono
 * (`THEME_2_OPTIONAL_PAIRS`).
 */
export const OPTIONAL_ROLES: readonly string[] = COLOR_TOKENS.filter(
  (name) => name.startsWith("paper-") || name.startsWith("doc-author-") || name.startsWith("doc-color-") || name.startsWith("doc-tint-") ||
    ["doc-ins", "doc-del", "doc-proof-spell", "doc-proof-gram", "doc-find", "doc-find-now", "doc-comment", "draw-desk",
      "doc-syntax-near", "doc-ghost", "doc-wavy", "doc-block-hover", "doc-block-selected", "doc-drop-line"].includes(name),
);

/** Ogni ruolo che un foglio della serie dichiara e che un tema deve dichiarare. */
export function roles(): string[] {
  return [...CONSTANTS.map(([name]) => name), ...COLOR_TOKENS.filter((name) => !OPTIONAL_ROLES.includes(name))];
}

export const SHEETS: Readonly<Record<Light, Readonly<Record<ContrastLevel, string>>>> = {
  light: { normal: "sheet-light.css", high: "sheet-light-high.css" },
  dark: { normal: "sheet-dark.css", high: "sheet-dark-high.css" },
};

export const VARIANTS: readonly { readonly light: Light; readonly contrast: ContrastLevel }[] = LIGHTS.flatMap(
  (light) => CONTRASTS.map((contrastLevel) => ({ light, contrast: contrastLevel })),
);

const TITLES: Readonly<Record<Light, string>> = { light: "giorno", dark: "notte" };

/** Il testo di un foglio: ciò che il generatore scrive e il caricatore monta. */
export function sheet(light: Light, level: ContrastLevel): string {
  const colors = palette(light, level);
  const line = ([name, value]: readonly [string, string]): string => `  --${name}: ${value};`;
  return [
    `/* Il foglio della serie Scrittoio: ${TITLES[light]}${level === "high" ? ", alto contrasto" : ""}.`,
    " *",
    " * GENERATO da `theme/scrittoio/recipe.ts`: non si modifica qui. Si tocca la",
    " * ricetta e si rigenera con `npm run theme:generate`; un esadecimale ritoccato",
    " * a mano sparisce alla prima rigenerazione.",
    " *",
    " * Qui stanno i valori: scala, forma, caratteri, tempi, molle e colori. La",
    " * pelle li consuma e non li dichiara; le misure della finestra sono della",
    " * struttura (`theme/scrittoio/structure.css`) e non si tematizzano.",
    " */",
    ":root {",
    ...CONSTANTS.map(line),
    ...Object.entries(colors).map(line),
    `  color-scheme: ${light};`,
    "  font-family: var(--font-ui);",
    "  font-size: var(--text-base);",
    "}",
    "",
  ].join("\n");
}

/**
 * La tavolozza per un accento scelto dalla persona: tutti i colori, perché i
 * neutri ne seguono la tinta. Con l'accento di serie non c'è niente da
 * ridichiarare, e il canale delle preferenze resta corto.
 */
export function accentPalette(light: Light, level: ContrastLevel, accentHue: number): Record<string, string> {
  const hue = Math.round(((accentHue % 360) + 360) % 360);
  if (hue === DEFAULT_ACCENT_HUE) return {};
  return palette(light, level, hue);
}
