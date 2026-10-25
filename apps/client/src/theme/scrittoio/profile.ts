/**
 * Il profilo `theme-2`: contro che cosa il cancello misura un tema quando la
 * shell è Scrittoio.
 *
 * Rispetto a `theme-1` cambiano quattro cose, e cambiano insieme:
 *
 * - **gli hook**: l'anatomia è un'altra (`./anatomia.ts`);
 * - **i ruoli e le coppie**: c'è un foglio distinto dalla scrivania, un fondo
 *   d'accento pieno sotto le righe selezionate, un confine dei controlli;
 * - **le preferenze**: la persona ridichiara anche le misure della cornice
 *   (lo «spazio dell'interfaccia») e, con l'accento, tutta la tavolozza;
 * - **il vocabolario**: una pelle `theme-2` può usare ciò che serve a
 *   disegnare questa shell e che a `theme-1` e ai frammenti resta negato.
 *
 * Finché il motore non entra nel contratto dell'host, questo profilo vive solo
 * nel client: lo dichiara l'ingresso della shell Scrittoio.
 */
import type { ThemeCssVocabulary } from "../../ui/sanitize-css";
import { THEME_CONTRAST_PAIRS, type ContrastPair } from "../contrast-fixture";
import type { ThemeProfile } from "../loader";
import { HOOKS } from "./anatomia";
import { CHROME_MEASURE_TOKENS } from "./measures";
import { COLOR_TOKENS } from "./recipe";

export const THEME_2_ENGINE = "theme-2";

const AA = 4.5;
const UI = 3;

/** Le coppie che questa shell mette insieme e la precedente no. */
export const SCRITTOIO_PAIRS: readonly ContrastPair[] = [
  ["text", "sheet", AA, "il testo dell'interfaccia dentro un foglio"],
  ["muted", "sheet", AA, "il percorso nella testata del foglio"],
  ["text", "sheet-2", AA, "un campo dentro un foglio"],
  ["muted", "sheet-2", AA, "il segnaposto di un campo"],
  ["text", "bg-active", AA, "una riga premuta sulla scrivania"],
  ["muted", "bg-active", AA, "il sottotitolo di una riga premuta"],
  ["text", "accent-wash", AA, "una riga selezionata nel cassetto"],
  ["muted", "accent-wash", AA, "il sottotitolo di una riga selezionata"],
  ["accent", "accent-wash", AA, "l'etichetta di un controllo acceso"],
  ["accent-soft", "accent-wash", AA, "un collegamento dentro una riga selezionata"],
  ["accent", "sheet", AA, "un collegamento nella testata del foglio"],
  ["accent-soft", "sheet", AA, "lo stesso collegamento sotto il puntatore"],
  ["danger", "sheet", AA, "un errore dentro un foglio"],
  ["warning", "bg", AA, "un avviso sulla scrivania"],
  ["warning", "sheet", AA, "un avviso dentro un foglio"],
  ["success", "bg", AA, "un esito riuscito sulla scrivania"],
  ["success", "sheet", AA, "un esito riuscito dentro un foglio"],
  ["info", "bg", AA, "una nota informativa sulla scrivania"],
  ["info", "sheet", AA, "una nota informativa dentro un foglio"],
  ["warning-contrast", "warning", AA, "il testo sopra un avviso pieno"],
  ["success-contrast", "success", AA, "il testo sopra un esito pieno"],
  ["info-contrast", "info", AA, "il testo sopra una nota piena"],
  ["outline", "bg", UI, "il confine di un controllo sulla scrivania"],
  ["outline", "sheet", UI, "il confine di un controllo dentro un foglio"],
  ["outline", "sheet-2", UI, "il confine di un controllo dentro un campo"],
  ["outline", "bg-elev", UI, "il confine di un controllo dentro un menu"],
  ["focus-ring", "sheet", UI, "l'anello del fuoco dentro un foglio"],
];

export const THEME_2_CONTRAST_PAIRS: readonly ContrastPair[] = [...THEME_CONTRAST_PAIRS, ...SCRITTOIO_PAIRS];

/**
 * Le coppie dei ruoli facoltativi (`OPTIONAL_ROLES` della ricetta): i segni di
 * Fub sulla carta del tema e sulla carta chiara di un file. Stanno a parte
 * perché i ruoli obbligatori sono proprio i ruoli delle coppie qui sopra; il
 * cancello le conta soltanto quando il tema dichiara i due ruoli.
 */
export const THEME_2_OPTIONAL_PAIRS: readonly ContrastPair[] = [
  ["doc-ins", "doc-bg", AA, "il testo inserito di una revisione"],
  ["doc-del", "doc-bg", AA, "il testo tolto di una revisione"],
  ["doc-proof-spell", "doc-bg", UI, "l'onda di una parola sconosciuta"],
  ["doc-proof-gram", "doc-bg", UI, "l'onda di un suggerimento di grammatica"],
  ["doc-comment", "doc-bg", UI, "il filo di un commento"],
  ["doc-fg", "doc-find", AA, "il testo di un risultato della ricerca"],
  ["doc-fg", "doc-find-now", AA, "il testo del risultato corrente"],
  ["paper-ink", "paper-bg", AA, "il testo automatico sulla carta di un file"],
  ["paper-ink", "paper-selection", AA, "il testo selezionato sulla carta di un file"],
  ["paper-ink", "paper-active-line", AA, "la riga del cursore sulla carta di un file"],
  ["paper-link", "paper-bg", AA, "un collegamento di Fub sulla carta di un file"],
  ["paper-danger", "paper-bg", AA, "un errore sulla carta di un file"],
  ["paper-ins", "paper-bg", AA, "il testo inserito, sulla carta di un file"],
  ["paper-del", "paper-bg", AA, "il testo tolto, sulla carta di un file"],
  ["paper-caret", "paper-bg", UI, "il cursore sulla carta di un file"],
  ["paper-proof-spell", "paper-bg", UI, "l'onda del correttore sulla carta di un file"],
  ["paper-proof-gram", "paper-bg", UI, "l'onda della grammatica sulla carta di un file"],
  ["paper-comment", "paper-bg", UI, "il filo di un commento sulla carta di un file"],
  ["paper-ink", "paper-find", AA, "un risultato della ricerca sulla carta di un file"],
  ["paper-ink", "paper-find-now", AA, "il risultato corrente sulla carta di un file"],
];

export const THEME_2_REQUIRED_ROLES: readonly string[] = [
  ...new Set(THEME_2_CONTRAST_PAIRS.flatMap(([ink, background]) => [ink, background])),
];

/** La densità: i primi dieci gradini della spaziatura, il controllo e la riga. */
export const DENSITY_TOKENS: readonly string[] = [
  "space-1",
  "space-2",
  "space-3",
  "space-4",
  "space-5",
  "space-6",
  "space-7",
  "space-8",
  "space-9",
  "space-10",
  "control-h",
  "row-h",
];

export const READING_TOKENS: readonly string[] = [
  "font-reading",
  "text-reading",
  "leading-relaxed",
  "content-width",
  "font-ui",
  "font-mono",
];

/**
 * Ciò che la persona può ridichiarare, nell'ordine in cui lo si scrive.
 *
 * I colori ci sono tutti perché i neutri seguono la tinta dell'accento: un
 * accento diverso è una tavolozza diversa, non quattro token. Le misure dei
 * fogli non ci sono, e non per dimenticanza.
 */
export const THEME_2_PREFERENCE_TOKENS: readonly string[] = [
  ...DENSITY_TOKENS,
  ...READING_TOKENS,
  ...CHROME_MEASURE_TOKENS,
  ...COLOR_TOKENS,
];

/**
 * Il vocabolario in più. Ogni voce è qui perché una regola della pelle di
 * serie la usa, o perché senza di lei un autore dovrebbe aggirarla peggio.
 *
 * Resta della shell, e quindi fuori: `container-type` (decide chi è un
 * contenitore, cioè la struttura), `overscroll-behavior`, `scroll-margin` e
 * `scroll-padding`, `scrollbar-gutter`. Resta vietato a tutti
 * `backdrop-filter`: lo dice il sanificatore, non questo elenco.
 */
export const THEME_2_VOCABULARY: ThemeCssVocabulary = {
  properties: [
    // Disposizione interna di un componente.
    "row-gap",
    "translate",
    "scale",
    "rotate",
    "isolation",
    "object-fit",
    "will-change",
    // Barre di scorrimento.
    "scrollbar-width",
    "scrollbar-color",
    // Forme disegnate: solo forme di base e gradienti, mai `url()`.
    "clip-path",
    "mask-image",
    "mask-size",
    "mask-repeat",
    "mask-position",
    "-webkit-mask-image",
    "-webkit-mask-size",
    "-webkit-mask-repeat",
    "-webkit-mask-position",
    // Caratteri.
    "font-variation-settings",
    "font-optical-sizing",
    "text-wrap",
    "text-decoration-thickness",
    "overflow-wrap",
    "word-break",
    "tab-size",
    "-webkit-line-clamp",
    "-webkit-box-orient",
    // Tratti dei glifi.
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
  ],
  functions: [
    "minmax",
    "fit-content",
    "oklch",
    "color-mix",
    "inset",
    "polygon",
    "drop-shadow",
    "conic-gradient",
    "repeating-linear-gradient",
    "env",
  ],
  atRules: ["container"],
};

export const THEME_2_PROFILE: ThemeProfile = {
  engine: THEME_2_ENGINE,
  hooks: HOOKS,
  requiredRoles: THEME_2_REQUIRED_ROLES,
  contrastPairs: THEME_2_CONTRAST_PAIRS,
  optionalPairs: THEME_2_OPTIONAL_PAIRS,
  preferenceTokens: THEME_2_PREFERENCE_TOKENS,
  vocabulary: THEME_2_VOCABULARY,
};
