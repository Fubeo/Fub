// **La mappa del prototipo delle ricette** (piano A1, T12–T13): quale elemento di
// `PLAN-ui/ricette.html` corrisponde a quale elemento dell'app, in quali stati, e
// quali proprietà si confrontano. Scritta a mano; la leggono `estrai.mjs` (il lato
// del prototipo) e `verifica.mjs` (il lato dell'app).
//
// Il prototipo non ha la finestra `#win` dell'editor: la sua cornice è `#stage`,
// dove stanno la sezione «Ricette», l'avviso e la finestra (`PROTOTIPO.radice`). I
// suoi stati si scelgono coi pulsanti della sua barra (`imposta`), non con i
// `data-set` dell'editor.
//
// La misura «700» del prototipo è la regola sotto i 760 px della pelle (una
// colonna per riga). Il computer non ha una finestra di 700 px (la minima è 800): il
// banco la misura a 700 perché è la stessa regola, come fa la mappa dell'editor.
// Le larghezze della sezione, che dipendono dalla finestra, non si confrontano.
//
// Le viste dicono come si arriva a un pezzo dai due lati: il pulsante della barra
// del prototipo (`prepara`), la scena del banco (`app.scena`). Un pezzo sta in una
// vista; dove un elemento c'è solo in alcuni stati, il pezzo lo dice con `stati`.
import { BASE } from "./confronto.mjs";

/// Il prototipo: dove sta, il suo ramo, e la cornice dentro cui si leggono i pezzi.
/// La cornice è tutto il `body`, non `#stage`: il colore del testo è ereditato dal
/// `body` (`color: var(--text)`), e la seconda lettura, quella che riconosce i token,
/// mette le sentinelle proprio lì; su `#stage` non arriverebbero a chi eredita.
export const PROTOTIPO = {
  nome: "ricette",
  ramo: "piano/a1-base-per-ai",
  file: "PLAN-ui/ricette.html",
  radice: "body",
};

/// Con quale token di Fub si scrive ogni token di colore del prototipo. La pelle
/// ha gli stessi nomi, e il valore del tema vince sotto l'elemento: il colore
/// dell'accento, per esempio, è quello del tema di Fub, non il blu del prototipo.
/// Le ombre (`--shadow-*`) non stanno qui: si confrontano per valore, parte per
/// parte.
export const TRADUZIONE = {
  "--bg": ["--bg"],
  "--bg-hover": ["--bg-hover"],
  "--bg-active": ["--bg-active"],
  "--sheet": ["--sheet"],
  "--sheet-2": ["--sheet-2"],
  "--bg-input": ["--bg-input"],
  "--bg-elev": ["--bg-elev"],
  "--overlay-hover": ["--overlay-hover"],
  "--overlay-active": ["--overlay-active"],
  "--scrim": ["--scrim"],
  "--text": ["--text"],
  "--muted": ["--muted"],
  "--border": ["--border"],
  "--border-strong": ["--border-strong"],
  "--outline": ["--outline"],
  "--accent": ["--accent"],
  "--accent-soft": ["--accent-soft"],
  "--accent-contrast": ["--accent-contrast"],
  "--accent-wash": ["--accent-wash"],
  "--accent-veil": ["--accent-veil"],
  "--focus-ring": ["--focus-ring"],
  "--danger": ["--danger"],
  "--danger-wash": ["--danger-wash"],
  "--danger-contrast": ["--danger-contrast"],
  "--warning": ["--warning"],
  "--warning-wash": ["--warning-wash"],
  "--success": ["--success"],
  "--success-wash": ["--success-wash"],
  "--info": ["--info"],
};

/// Una sola traduzione: il prototipo non ha una pagina del documento.
export const TRADUZIONI = {
  interfaccia: TRADUZIONE,
};

/// Un clic su un pulsante della barra del prototipo (`data-group` e `data-value`).
const clic = (gruppo, valore) => async (page) => {
  await page.click(`.proto-bar button[data-group="${gruppo}"][data-value="${valore}"]`);
};

/// La luce e la larghezza del prototipo, dai loro pulsanti della barra.
const colore = (luce, larghezza) => async (page) => {
  await clic("theme", luce)(page);
  await clic("width", larghezza)(page);
};

/// Gli stati: la luce e la larghezza del prototipo, e la finestra dell'app che le
/// corrisponde (`finestra`). La luce dell'app è quella della scena del banco.
export const STATI = {
  "chiaro-1280": { luce: "light", prototipo: { imposta: colore("light", "piena") }, finestra: { width: 1280, height: 800 } },
  "scuro-1280": { luce: "dark", prototipo: { imposta: colore("dark", "piena") }, finestra: { width: 1280, height: 800 } },
  "chiaro-700": { luce: "light", prototipo: { imposta: colore("light", "700") }, finestra: { width: 700, height: 800 } },
  "scuro-700": { luce: "dark", prototipo: { imposta: colore("dark", "700") }, finestra: { width: 700, height: 800 } },
};

const TUTTI = Object.keys(STATI);
const NESSUNA = async () => {};

export const VISTE = {
  /// La sezione con le sue ricette, la più parte del prototipo: il banner in cima,
  /// le righe con lo stato, i problemi e i pulsanti.
  sezione: {
    stati: TUTTI,
    prototipo: { prepara: NESSUNA },
    app: { scena: "settings-recipes" },
  },
  "sezione-vuota": {
    stati: TUTTI,
    prototipo: { prepara: clic("section", "vuota") },
    app: { scena: "settings-recipes-empty" },
  },
  "sezione-problemi": {
    stati: TUTTI,
    prototipo: { prepara: clic("section", "problemi") },
    app: { scena: "settings-recipes-problems" },
  },
  "sezione-carica": {
    stati: TUTTI,
    prototipo: { prepara: clic("section", "carica") },
    app: { scena: "settings-recipes-loading" },
  },
  "sezione-errore": {
    stati: TUTTI,
    prototipo: { prepara: clic("section", "errore") },
    app: { scena: "settings-recipes-error" },
  },
  "sezione-limite": {
    stati: TUTTI,
    prototipo: { prepara: clic("section", "cinquecento") },
    app: { scena: "settings-recipes-limit" },
  },
  /// L'avviso all'apertura, col suo «Guarda»: la prima scena del banco che lo mostra
  /// è l'app senza la sezione, e il prototipo lo mostra nella sua sezione piena.
  avviso: {
    stati: TUTTI,
    prototipo: { prepara: NESSUNA },
    app: { scena: "recipes-notice" },
  },
  finestra: {
    stati: TUTTI,
    prototipo: { prepara: clic("dialog", "aperta") },
    app: { scena: "recipe-dialog" },
  },
  "finestra-prova": {
    stati: TUTTI,
    prototipo: { prepara: clic("dialog", "prova") },
    app: { scena: "recipe-dialog-trial-loading" },
  },
  "finestra-prova-errore": {
    stati: TUTTI,
    prototipo: { prepara: clic("dialog", "prova-errore") },
    app: { scena: "recipe-dialog-trial-error" },
  },
  "finestra-nessuna-nota": {
    stati: TUTTI,
    prototipo: { prepara: clic("dialog", "nessuna-nota") },
    app: { scena: "recipe-dialog-no-note" },
  },
  "finestra-venti": {
    stati: TUTTI,
    prototipo: { prepara: clic("dialog", "venti") },
    app: { scena: "recipe-dialog-twenty-top" },
  },
  "finestra-cambiata": {
    stati: TUTTI,
    prototipo: { prepara: clic("dialog", "cambiata") },
    app: { scena: "recipe-dialog-changed" },
  },
};

/// Le proprietà di un testo: il carattere, il colore, e ciò che il suo blocco
/// aggiunge intorno.
const TESTO = ["font", "color"];
/// Un pulsante della pelle: il suo bordo, il suo fondo, il suo carattere e la sua
/// altezza, che è fissa.
/// Il margine di un pulsante è `margin-left: auto` nella riga, e lo spazio che resta
/// dipende dalla larghezza della finestra: non si confronta.
const PULSANTE = [...BASE.filter((p) => p !== "margin"), "height"];

export const PEZZI = [
  // ── la sezione «Ricette» (vista `sezione`, la piena) ──────────────────────────
  { id: "sezione.titolo", vista: "sezione", prototipo: "#recipes-title", app: "#settings-recipes .settings-section-title", proprieta: [...BASE] },
  { id: "sezione.meta", vista: "sezione", prototipo: ".settings-section-meta", app: "#settings-recipes .settings-section-meta", proprieta: [...BASE] },
  { id: "sezione.nuova", vista: "sezione", prototipo: ".recipe-new", app: "#settings-recipes .recipe-new", proprieta: PULSANTE },
  { id: "sezione.indizio", vista: "sezione", prototipo: ".settings-section-hint", app: "#settings-recipes .settings-section-hint", proprieta: [...TESTO, "margin"] },
  { id: "banner", vista: "sezione", prototipo: ".settings-banner", app: "#settings-recipes .settings-banner", proprieta: [...BASE] },
  { id: "banner.titolo", vista: "sezione", prototipo: ".settings-banner > .setting-label", app: "#settings-recipes .settings-banner > .setting-label", proprieta: TESTO },
  { id: "banner.nota", vista: "sezione", prototipo: ".settings-banner > .muted", app: "#settings-recipes .settings-banner > .muted", proprieta: TESTO },
  { id: "banner.riga", vista: "sezione", prototipo: ".settings-banner .setting-row", app: "#settings-recipes .settings-banner .setting-row", proprieta: ["display", "padding", "gap"] },
  { id: "banner.guarda", vista: "sezione", prototipo: ".settings-banner .settings-btn", app: "#settings-recipes .settings-banner .settings-btn", proprieta: PULSANTE },
  { id: "lista", vista: "sezione", prototipo: ".recipe-list", app: "#settings-recipes .recipe-list", proprieta: [...BASE] },
  { id: "riga", vista: "sezione", prototipo: ".recipe-list > .setting-row", app: "#settings-recipes .recipe-list > .setting-row", proprieta: ["display", "padding", "gap"] },
  { id: "riga.nome", vista: "sezione", prototipo: ".recipe-name", app: "#settings-recipes .recipe-name", proprieta: [...TESTO, "overflow-wrap"] },
  { id: "riga.dove", vista: "sezione", prototipo: ".recipe-where", app: "#settings-recipes .recipe-where", proprieta: ["font", "color", "overflow-wrap"] },
  { id: "riga.stato.proposta", vista: "sezione", prototipo: '.recipe-status[data-status="proposta"]', app: '#settings-recipes .recipe-status[data-status="proposta"]', proprieta: [...TESTO, "display"] },
  { id: "riga.stato.proposta.punto", vista: "sezione", prototipo: '.recipe-status[data-status="proposta"]::before', app: '#settings-recipes .recipe-status[data-status="proposta"]::before', proprieta: ["background-color", "width", "height", "border-radius"] },
  { id: "riga.stato.adottata.punto", vista: "sezione", prototipo: '.recipe-status[data-status="adottata"]::before', app: '#settings-recipes .recipe-status[data-status="adottata"]::before', proprieta: ["background-color", "width", "height", "border-radius"] },
  { id: "riga.stato.cambiata.punto", vista: "sezione", prototipo: '.recipe-status[data-status="cambiata"]::before', app: '#settings-recipes .recipe-status[data-status="cambiata"]::before', proprieta: ["background-color", "width", "height", "border-radius"] },
  { id: "riga.stato.problemi.punto", vista: "sezione", prototipo: '.recipe-status[data-status="problemi"]::before', app: '#settings-recipes .recipe-status[data-status="problemi"]::before', proprieta: ["background-color", "width", "height", "border-radius"] },
  { id: "riga.problemi", vista: "sezione", prototipo: ".recipe-problems", app: "#settings-recipes .recipe-problems", proprieta: [...BASE] },
  { id: "riga.problema.codice", vista: "sezione", prototipo: ".recipe-problem-code", app: "#settings-recipes .recipe-problem-code", proprieta: [...BASE, "font"] },
  { id: "riga.problema.messaggio", vista: "sezione", prototipo: ".recipe-problem-message", app: "#settings-recipes .recipe-problem-message", proprieta: TESTO },
  { id: "riga.spegni", vista: "sezione", prototipo: ".settings-btn--danger", app: "#settings-recipes .settings-btn--danger", proprieta: PULSANTE },

  // ── la sezione vuota: la domanda da fare a un'AI ──────────────────────────────
  { id: "vuota.riquadro", vista: "sezione-vuota", prototipo: ".settings-empty", app: "#settings-recipes .settings-empty", proprieta: [...BASE, "text-align"] },
  { id: "vuota.testo", vista: "sezione-vuota", prototipo: ".settings-empty-text", app: "#settings-recipes .settings-empty-text", proprieta: [...TESTO, "margin"] },
  { id: "vuota.domanda", vista: "sezione-vuota", prototipo: ".recipe-ask", app: "#settings-recipes .recipe-ask", proprieta: [...BASE, "font", "max-width"] },
  { id: "vuota.nuova", vista: "sezione-vuota", prototipo: ".settings-empty .settings-btn", app: "#settings-recipes .settings-empty .settings-btn", proprieta: PULSANTE },

  // ── la sezione con problemi: le righe senza «Guarda» ─────────────────────────
  { id: "problemi.riga", vista: "sezione-problemi", prototipo: ".recipe-list > .setting-row", app: "#settings-recipes .recipe-list > .setting-row", proprieta: ["display", "padding", "gap"] },
  { id: "problemi.lista", vista: "sezione-problemi", prototipo: ".recipe-problems", app: "#settings-recipes .recipe-problems", proprieta: [...BASE] },
  { id: "problemi.codice", vista: "sezione-problemi", prototipo: ".recipe-problem-code", app: "#settings-recipes .recipe-problem-code", proprieta: [...BASE, "font"] },
  { id: "problemi.messaggio", vista: "sezione-problemi", prototipo: ".recipe-problem-message", app: "#settings-recipes .recipe-problem-message", proprieta: TESTO },

  // ── la sezione in caricamento: lo scheletro ──────────────────────────────────
  { id: "carica.righe", vista: "sezione-carica", prototipo: ".skeleton-rows", app: "#settings-recipes .skeleton-rows", proprieta: [...BASE] },
  { id: "carica.riga", vista: "sezione-carica", prototipo: ".skeleton-line", app: "#settings-recipes .skeleton-line", proprieta: ["display", "height", "background-color", "border-radius"] },

  // ── la sezione in errore: la frase e «Riprova» ───────────────────────────────
  { id: "errore.riquadro", vista: "sezione-errore", prototipo: ".settings-empty", app: "#settings-recipes .settings-empty", proprieta: [...BASE, "text-align"] },
  { id: "errore.messaggio", vista: "sezione-errore", prototipo: ".setting-error", app: "#settings-recipes .setting-error", proprieta: [...TESTO, "margin"] },
  { id: "errore.parola", vista: "sezione-errore", prototipo: ".setting-error-message", app: "#settings-recipes .setting-error-message", proprieta: TESTO },
  { id: "errore.riprova", vista: "sezione-errore", prototipo: ".settings-empty .settings-btn", app: "#settings-recipes .settings-empty .settings-btn", proprieta: PULSANTE },

  // ── la sezione oltre il limite: la riga che lo dice ──────────────────────────
  { id: "limite.riga", vista: "sezione-limite", prototipo: ".recipe-limit", app: "#settings-recipes .recipe-limit", proprieta: [...BASE, "font"] },

  // ── l'avviso all'apertura ────────────────────────────────────────────────────
  { id: "avviso.aviso", vista: "avviso", prototipo: "#toasts .toast", app: "#toasts .toast", proprieta: [...BASE] },
  { id: "avviso.testo", vista: "avviso", prototipo: "#toasts .toast-text", app: "#toasts .toast-text", proprieta: [...TESTO, "white-space"] },
  { id: "avviso.guarda", vista: "avviso", prototipo: "#toasts .toast-action", app: "#toasts .toast-action", proprieta: [...TESTO, "min-height"] },

  // ── la finestra di una ricetta (vista `finestra`, la prova ferma) ────────────
  { id: "finestra.dialogo", vista: "finestra", prototipo: ".kit-dialog.recipe-dialog", app: ".kit-dialog.recipe-dialog", proprieta: [...BASE, "width"] },
  { id: "finestra.titolo", vista: "finestra", prototipo: ".kit-dialog-title", app: ".kit-dialog-title", proprieta: [...TESTO, "overflow-wrap"] },
  { id: "finestra.descrizione", vista: "finestra", prototipo: ".kit-dialog-description", app: ".kit-dialog-description", proprieta: [...TESTO, "margin", "white-space"] },
  { id: "finestra.origine", vista: "finestra", prototipo: ".recipe-origin", app: ".recipe-origin", proprieta: [...TESTO, "margin"] },
  { id: "finestra.blocco", vista: "finestra", prototipo: ".recipe-block-title", app: ".recipe-block-title", proprieta: [...TESTO, "letter-spacing", "text-transform"] },
  { id: "finestra.passi", vista: "finestra", prototipo: ".recipe-steps", app: ".recipe-steps", proprieta: [...BASE] },
  { id: "finestra.passo", vista: "finestra", prototipo: ".recipe-step", app: ".recipe-step", proprieta: [...BASE, "display"] },
  { id: "finestra.passo.numero", vista: "finestra", prototipo: ".recipe-step-n", app: ".recipe-step-n", proprieta: [...TESTO, "min-width", "text-align"] },
  { id: "finestra.passo.titolo", vista: "finestra", prototipo: ".recipe-step-title", app: ".recipe-step-title", proprieta: TESTO },
  { id: "finestra.passo.argomenti", vista: "finestra", prototipo: ".recipe-step-args", app: ".recipe-step-args", proprieta: [...TESTO, "overflow-wrap"] },
  { id: "finestra.fatti", vista: "finestra", prototipo: ".recipe-facts", app: ".recipe-facts", proprieta: [...BASE, "display"] },
  { id: "finestra.fatto", vista: "finestra", prototipo: ".recipe-fact", app: ".recipe-fact", proprieta: [...BASE, "display"] },
  { id: "finestra.fatto.etichetta", vista: "finestra", prototipo: ".recipe-fact-label", app: ".recipe-fact-label", proprieta: TESTO },
  { id: "finestra.non-ora", vista: "finestra", prototipo: ".kit-dialog-actions .kit-button:not([data-kind=\"primary\"])", app: ".kit-dialog-actions .kit-button:not([data-kind=\"primary\"])", proprieta: [...PULSANTE, "font"] },
  { id: "finestra.accendi", vista: "finestra", prototipo: ".kit-dialog-actions .kit-button[data-kind=\"primary\"]", app: ".kit-dialog-actions .kit-button[data-kind=\"primary\"]", proprieta: [...PULSANTE, "font"] },
  { id: "finestra.prova.voce", vista: "finestra", prototipo: ".recipe-try-item", app: ".recipe-try-item", proprieta: [...TESTO, "gap", "display"] },
  { id: "finestra.prova.voce.punto", vista: "finestra", prototipo: ".recipe-try-item::before", app: ".recipe-try-item::before", proprieta: ["background-color", "width", "height", "border-radius"] },
  { id: "finestra.prova.nota", vista: "finestra", prototipo: ".recipe-try-note", app: ".recipe-try-note", proprieta: [...TESTO, "margin"] },

  // ── la finestra con la prova in corso ────────────────────────────────────────
  { id: "prova.caricamento", vista: "finestra-prova", prototipo: ".kit-dialog .skeleton-rows", app: ".recipe-dialog .skeleton-rows", proprieta: [...BASE] },

  // ── la finestra con la prova in errore ───────────────────────────────────────
  { id: "prova.errore.riga", vista: "finestra-prova-errore", prototipo: ".kit-dialog .setting-error", app: ".recipe-dialog .setting-error", proprieta: [...TESTO, "margin"] },
  { id: "prova.errore.parola", vista: "finestra-prova-errore", prototipo: ".kit-dialog .setting-error-message", app: ".recipe-dialog .setting-error-message", proprieta: TESTO },
  { id: "prova.errore.riprova", vista: "finestra-prova-errore", prototipo: ".kit-dialog .recipe-block .kit-button", app: ".recipe-dialog .recipe-block .kit-button", proprieta: [...PULSANTE, "font"] },

  // ── la finestra senza una nota aperta ────────────────────────────────────────
  { id: "nessuna-nota.nota", vista: "finestra-nessuna-nota", prototipo: ".recipe-try-note", app: ".recipe-try-note", proprieta: [...TESTO, "margin"] },

  // ── la finestra con venti passi e una nota fissa ─────────────────────────────
  { id: "venti.passi", vista: "finestra-venti", prototipo: ".recipe-steps", app: ".recipe-steps", proprieta: [...BASE] },
  { id: "venti.fatto.altre", vista: "finestra-venti", prototipo: '.recipe-fact[data-reach="altre"]', app: '.recipe-fact[data-reach="altre"]', proprieta: [...BASE, "display"] },

  // ── la finestra con la ricetta cambiata ──────────────────────────────────────
  { id: "cambiata.fascia", vista: "finestra-cambiata", prototipo: ".recipe-stale", app: ".recipe-stale", proprieta: [...BASE] },
  { id: "cambiata.testo", vista: "finestra-cambiata", prototipo: ".recipe-stale-text", app: ".recipe-stale-text", proprieta: [...TESTO, "margin"] },
  { id: "cambiata.accendi", vista: "finestra-cambiata", prototipo: ".kit-dialog-actions .kit-button[data-kind=\"primary\"]", app: ".kit-dialog-actions .kit-button[data-kind=\"primary\"]", proprieta: ["opacity", "background-color", "color"] },
];

/// Ciò che la pelle non fa come il prototipo, e che va corretto in T12 (in
/// `skin/settings.css`, già chiuso): non è una scelta, quindi non è un'eccezione. Si
/// legge e si confronta, e diventa rosso quando coincide, perché la si tolga di qui.
export const DA_COPRIRE = [
  {
    id: "sezione.indizio",
    proprieta: ["margin-top", "margin-bottom"],
    perche: "il prototipo azzera il margine del testo della sezione; la pelle lo lascia al «p» del fondo (13 px). Da correggere in T12: .settings-section-hint { margin: 0 } in skin/settings.css",
  },
  {
    id: "vuota.testo",
    proprieta: ["margin-top", "margin-bottom"],
    perche: "il prototipo azzera il margine del testo della sezione vuota; la pelle lo lascia al «p» del fondo (14 px). Da correggere in T12: .settings-empty-text { margin: 0 } in skin/settings.css",
  },
  {
    id: "errore.messaggio",
    proprieta: ["margin-bottom"],
    perche: "il prototipo non mette margine sotto il messaggio d'errore; la pelle ne aggiunge 12 px. Da correggere in T12: .setting-error in skin/settings.css",
  },
  {
    id: "prova.errore.riga",
    proprieta: ["margin-bottom"],
    perche: "stesso scarto del messaggio d'errore della sezione, nella finestra della prova. Da correggere in T12 con .setting-error",
  },
  {
    id: "banner.nota",
    proprieta: ["font-size", "line-height", "color"],
    perche: "nel prototipo la riga sotto il titolo del banner è testo pieno a 13 px; la pelle la rende come .muted (12 px, colore attenuato). Da decidere in T12: o il prototipo o la pelle",
  },
];
