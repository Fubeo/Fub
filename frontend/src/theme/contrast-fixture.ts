/// Una coppia dichiarata: chi sta sopra chi, quanto deve reggere e dove accade.
export type ContrastPair = readonly [
  ink: string,
  background: string,
  threshold: number,
  where: string,
];

export const AA = 4.5;
const UI = 3;

/// Coppie reali che la pelle mette insieme. È fixture del contratto, non del test.
export const PAIRS = [
  ["text", "bg", AA, "il corpo dell'app"],
  ["text", "bg-chrome", AA, "la titlebar, la barra degli strumenti, le linguette"],
  ["text", "bg-elev", AA, "topbar, pannelli, modali"],
  ["text", "bg-input", AA, "campi, pastiglie"],
  ["text", "bg-hover", AA, "una riga sotto il puntatore, o selezionata"],
  ["muted", "bg", AA, ".muted, i sottotitoli"],
  ["muted", "bg-chrome", AA, "#statusbar e #views-status, che sono tutte muted"],
  ["muted", "bg-elev", AA, "i sottotitoli dentro un pannello"],
  ["muted", "bg-input", AA, "i sottotitoli dentro una pastiglia"],
  ["muted", "bg-hover", AA, "il sottotitolo di una riga selezionata"],
  ["accent-contrast", "accent", AA, "il testo di un bottone pieno"],
  ["danger-contrast", "danger", AA, "il testo di un bottone distruttivo"],
  ["bg", "accent-soft", AA, "button:hover, #mode-switch attivo, .hit-snippet mark"],
  ["accent-soft", "bg", AA, ".brand, i link-button al passaggio"],
  ["accent-soft", "bg-elev", AA, "il titolo di uno spazio, il chevron"],
  ["accent-soft", "bg-input", AA, ".ui-badge.intent-primary"],
  ["danger", "bg", AA, "un messaggio d'errore"],
  ["danger", "bg-elev", AA, "un errore dentro un pannello"],
  ["danger", "bg-input", AA, ".ui-badge.intent-danger"],
  ["accent", "bg", UI, "il fondo di un bottone, il bordo di un campo a fuoco"],
  ["accent", "bg-elev", UI, "il bordo attivo di una scheda"],
  ["accent", "bg-hover", UI, "il contorno di una riga selezionata"],
  ["focus-ring", "bg", UI, "l'anello del fuoco"],
  ["focus-ring", "bg-elev", UI, "l'anello del fuoco dentro un pannello"],
  ["focus-ring", "bg-input", UI, "l'anello del fuoco su un campo"],
  ["graph-node", "bg", UI, "un nodo del grafo"],
  ["graph-node-active", "bg", UI, "il nodo della nota aperta"],
  ["graph-node-hover", "bg", UI, "il nodo sotto il puntatore"],
  ["doc-fg", "doc-bg", AA, "il corpo di una nota"],
  ["doc-link", "doc-bg", AA, "un wikilink"],
  ["doc-danger", "doc-bg", AA, "un wikilink rotto"],
  ["doc-gutter-fg", "doc-bg", AA, "i numeri di riga"],
  ["doc-heading", "doc-bg", UI, "un titolo reso"],
  ["doc-caret", "doc-bg", UI, "il cursore di scrittura"],
] as const satisfies readonly ContrastPair[];

export const SYNTAX_TOKENS = [
  "keyword",
  "name",
  "function",
  "literal",
  "type",
  "operator",
  "comment",
  "string",
  "heading",
  "invalid",
] as const;

export const PAPER_BACKGROUNDS = ["doc-bg", "doc-active-line", "doc-selection"] as const;

/** Tutte le coppie che il cancello ricalcola prima del montaggio. */
export const THEME_CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...PAIRS,
  ...SYNTAX_TOKENS.flatMap((token) =>
    PAPER_BACKGROUNDS.map(
      (background) =>
        [`syn-${token}`, background, AA, `la sintassi ${token} sulla carta`] as const,
    ),
  ),
];

/// I ruoli che un foglio deve dichiarare perché tutte le coppie siano misurabili.
export const REQUIRED_THEME_ROLES = [
  ...new Set(THEME_CONTRAST_PAIRS.flatMap(([ink, background]) => [ink, background])),
] as const;
