// **La mappa del prototipo dell'editor**: quale elemento del prototipo
// corrisponde a quale elemento dell'app, in quali stati, e quali proprietà si
// confrontano. Scritta a mano; la leggono `estrai.mjs` (il lato del prototipo)
// e `verifica.mjs` (il lato dell'app).
//
// Gli elementi si identificano per classi e struttura, mai a occhio: la
// tabella Markdown del prototipo (`.gr`) e quella della Base (`.btab`) sono
// due cose diverse, anche se si somigliano.
//
// # La forma
//
// - `STATI`: le coordinate di uno stato, luce e larghezza. Dal lato del
//   prototipo sono i pulsanti Giorno/Notte e Piena/700/Telefono; dal lato
//   dell'app la luce della scena e la finestra del banco. `prototipo.monta`
//   e `app.monta` (facoltativi) mettono l'editor altrove prima della vista:
//   gli stati `*-foglio-*` lo mettono in un foglio stretto della cornice.
// - `VISTE`: come si arriva al pezzo dai due lati. `prototipo.prepara(page)`
//   gira dopo che luce e larghezza sono scelte (può premere «Avanti» fino a un
//   passo, chiamare una funzione del prototipo, scrivere); `app.scena` è l'id
//   di una scena di `bench/scene.mjs`, e `app.prepara(page)` (facoltativo) fa
//   i gesti in più dopo la scena.
// - `PEZZI`: un elemento per voce. `prototipo` è il selettore dentro `#win`,
//   `app` quello nella pagina del banco; `proprieta` usa i gruppi di
//   `confronto.mjs` (`padding`, `border`, `font`, …) e le proprietà lunghe.
//   `gesto` (facoltativo) porta puntatore o fuoco su un elemento dai due lati
//   prima di leggere: `{ tipo: "hover" | "focus" | "click", prototipo, app }`,
//   coi selettori dei due lati (un elenco passa da ognuno, in ordine:
//   `leggi.mjs`, `gesto`). `stati` (facoltativo) restringe gli stati della vista.
//   `attende` (facoltativo) nomina la PR o il ramo che porta il pezzo
//   nell'app: i suoi valori attesi si estraggono, ma la verifica non lo legge
//   finché c'è (con `--attese` sì, per misurare quel lavoro su un ramo locale
//   che lo contiene). Chi unisce il lavoro toglie `attende` dai suoi pezzi:
//   da lì le differenze sono rosse come le altre.
//   `contesto` (facoltativo, di base `interfaccia`) sceglie fra `TRADUZIONI`
//   quella dei token: `documento` per ciò che sta dentro la pagina.
// - `DA_COPRIRE`: ciò che ha ancora differenze e che correggono altri lavori,
//   in due forme. Un pezzo intero (`{ id, prototipo, app, perche }`, con un
//   id che non è in `PEZZI`) non si confronta affatto: sta qui perché si veda
//   che cosa manca. Le proprietà di un pezzo coperto (`{ id, proprieta,
//   perche }`, con l'id di un pezzo di `PEZZI`) si leggono e si confrontano,
//   ma la loro differenza non fa rosso; se però non differiscono più, è rosso
//   lo stesso, come un'eccezione non più usata, così chi le corregge le toglie
//   da qui. Non è un'eccezione: un'eccezione è una differenza voluta, con il
//   suo motivo in DECISIONS o nel piano (`eccezioni-<prototipo>.json`); qui
//   c'è una differenza da correggere.
//
// Un task grafico aggiunge i suoi pezzi nel file di `editor/pezzi-*.mjs` della
// sua area (le viste in `editor/viste.mjs`, gli stati e gli aiuti comuni in
// `editor/comuni.mjs`), rigenera i valori attesi con `estrai.mjs` e passa
// `npm run bench:conformita`. Nessun file di `editor/` comincia per `mappa-`:
// `verifica.mjs` lo prenderebbe per una mappa in più.
import { PEZZI_CORNICE_PANNELLI } from "./editor/pezzi-cornice-pannelli.mjs";
import { PEZZI_ESPORTA_PDF } from "./editor/pezzi-esporta-pdf.mjs";
import { PEZZI_ESPORTA_PAGINE } from "./editor/pezzi-esporta-pagine.mjs";
import { PEZZI_BLOCCHI_LIVE } from "./editor/pezzi-blocchi-live.mjs";
import { PEZZI_FOGLI_STRETTI } from "./editor/pezzi-fogli-stretti.mjs";
import { DA_COPRIRE_PARTE_2 } from "./editor/da-coprire-parte-2.mjs";
import { PEZZI_FORMULA_TABELLA_TESTATA } from "./editor/pezzi-formula-tabella-testata.mjs";
import { PEZZI_LANCIATORE_MENU } from "./editor/pezzi-lanciatore-menu.mjs";
import { PEZZI_SLASH_SCHEDE } from "./editor/pezzi-slash-schede.mjs";
export { STATI } from "./editor/comuni.mjs";
export { VISTE } from "./editor/viste.mjs";

/// Il prototipo: dove sta, e come si chiamano i file che ne nascono.
export const PROTOTIPO = {
  nome: "editor",
  ramo: "piano/editor-completo",
  file: "PLAN-ui/editor.html",
};

/// Con quale token di Fub si scrive ogni token di colore del prototipo. È la
/// tabella di PLAN.md, «Dal prototipo» (`--acc` → `--accent`, …, `--faint` →
/// `--muted` perché Fub non ha un terzo grigio), con due righe che il piano
/// non scrive e che le regole del confronto del 2026-11-16 fissano: il
/// `--acc-soft` del prototipo è un velo, e da fondo diventa `--accent-veil`;
/// l'inchiostro d'accento `--acc-ink` diventa `--accent-soft`. `--ink-2` (il
/// secondo inchiostro) diventa `--text`, per la stessa ragione di `--faint`:
/// Fub ne ha uno solo. Il velo di passaggio `--hover` diventa quello della
/// pelle, `--overlay-hover`; il rosso `--danger` diventa il `--danger` del
/// tema, che la ricetta genera col contrasto garantito (decisioni
/// dell'orchestratore del 2026-11-16). Un token che qui non c'è (`--tray-2`,
/// `--sh-pop`…) non ha un equivalente scritto, e il suo valore si confronta
/// crudo: se l'app ne usa un altro, è un'eccezione col suo motivo.
export const TRADUZIONE = {
  "--sheet": ["--sheet"],
  "--tray": ["--sheet-2"],
  "--line": ["--border"],
  "--line-2": ["--border-strong"],
  "--ink": ["--text"],
  "--ink-2": ["--text"],
  "--muted": ["--muted"],
  "--faint": ["--muted"],
  "--acc": ["--accent"],
  "--acc-ink": ["--accent-soft"],
  "--acc-soft": ["--accent-soft", "--accent-veil"],
  "--acc-wash": ["--accent-wash"],
  "--mark": ["--highlight"],
  "--hover": ["--overlay-hover"],
  "--danger": ["--danger"],
  // I colori delle etichette (`.k-green`): `--c-<colore>` → `--doc-color-<colore>`
  // e il suo fondo `--doc-tint-<colore>`, come dice la tabella del piano. Per
  // ora il verde (le note del calendario, T17) e l'arancio (lo stato «In
  // corso» della testata, T9) e il blu (il promemoria, T36), quelli che un
  // pezzo usa.
  "--c-green": ["--doc-color-green"],
  "--c-green-b": ["--doc-tint-green"],
  "--c-orange": ["--doc-color-orange"],
  "--c-orange-b": ["--doc-tint-orange"],
  "--c-blue": ["--doc-color-blue"],
  "--c-blue-b": ["--doc-tint-blue"],
};

/// La traduzione dei pezzi dentro la pagina del documento (`contesto:
/// "documento"`: tabella Markdown, testata, proprietà, riga dei dati,
/// maniglie dei blocchi). La pagina ha la sua tavolozza, che si cambia a parte
/// da quella dell'interfaccia (`--doc-*`, `structure.css` e `skin/document.css`):
/// il foglio è `--doc-bg`, l'inchiostro `--doc-fg`, il grigio `--doc-gutter-fg`,
/// i fili `--doc-rule-soft` e `--doc-rule`, i fondi tenui `--doc-fill-soft` e
/// `--doc-fill`, l'evidenziatore `--doc-highlight`, il passaggio sopra un
/// blocco `--doc-block-hover`, il rosso `--doc-danger`. L'accento non ha una
/// voce del documento, e resta quello dell'interfaccia. Gli stessi token di
/// `TRADUZIONE`, nello stesso ordine: le sentinelle sono le stesse.
export const TRADUZIONE_DOCUMENTO = {
  "--sheet": ["--doc-bg"],
  "--tray": ["--doc-fill-soft", "--doc-fill"],
  "--line": ["--doc-rule-soft"],
  "--line-2": ["--doc-rule"],
  "--ink": ["--doc-fg"],
  "--ink-2": ["--doc-fg"],
  "--muted": ["--doc-gutter-fg"],
  "--faint": ["--doc-gutter-fg"],
  "--acc": ["--accent"],
  "--acc-ink": ["--accent-soft"],
  "--acc-soft": ["--accent-soft", "--accent-veil"],
  "--acc-wash": ["--accent-wash"],
  "--mark": ["--doc-highlight"],
  "--hover": ["--doc-block-hover"],
  "--danger": ["--doc-danger"],
  "--c-green": ["--doc-color-green"],
  "--c-green-b": ["--doc-tint-green"],
  "--c-orange": ["--doc-color-orange"],
  "--c-orange-b": ["--doc-tint-orange"],
  "--c-blue": ["--doc-color-blue"],
  "--c-blue-b": ["--doc-tint-blue"],
};

/// Le traduzioni per contesto: ogni pezzo usa quella del suo `contesto`.
export const TRADUZIONI = {
  interfaccia: TRADUZIONE,
  documento: TRADUZIONE_DOCUMENTO,
};
export const PEZZI = [
  ...PEZZI_LANCIATORE_MENU,
  ...PEZZI_FORMULA_TABELLA_TESTATA,
  ...PEZZI_CORNICE_PANNELLI,
  ...PEZZI_SLASH_SCHEDE,
  ...PEZZI_ESPORTA_PDF,
  ...PEZZI_ESPORTA_PAGINE,
  ...PEZZI_BLOCCHI_LIVE,
  ...PEZZI_FOGLI_STRETTI,
];

/// I pezzi che hanno ancora differenze, e chi li corregge. Non si
/// confrontano finché non passano in `PEZZI`.
export const DA_COPRIRE = [
  {
    id: "esporta.dg-togli-stili",
    prototipo: '.px-sec[data-sec="diagrammi"] .px-link.in',
    app: "#export-dg-clear-own",
    perche: "«Togli lo stile dato a N» c'è solo con uno stile dato a un diagramma solo, e quello lo dà il clic sulla pagina (T76): nessuna vista lo apre ancora dai due lati",
  },
  // ── pezzi che la mappa nomina ma non può ancora leggere ──────────────────
  {
    id: "compiti.ispettore",
    prototipo: ".trow",
    app: '.declared-view[data-view-id="tasks"] .ui-list-item',
    perche:
      "i Compiti nell'ispettore (#432, `.ith`/`.trow`): il banco non ha una scena con la vista dei compiti, e l'ispettore del banco non ne ha la scheda",
  },
  {
    id: "compiti.nota",
    prototipo: ".chk",
    app: null,
    perche: "la casella dei compiti nel testo della nota: nessun lavoro l'ha ancora portata dal prototipo",
  },
  {
    id: "tabella.taglio",
    prototipo: ".tg-cut",
    app: ".tb-grid .tb-cut",
    perche: "il tratteggio del taglio (#432) si vede solo dopo Ctrl X: nessuna vista lo apre ancora dai due lati",
  },
  {
    id: "proprieta.opzione",
    prototipo: ".opt",
    app: null,
    perche: "la pastiglia di una scelta (lo Stato): fino a T9 Selezione e Stato si scrivono come testo (#421)",
  },
  {
    id: "proprieta.editor",
    prototipo: ".pop .dp, .pop .m",
    app: null,
    perche: "gli editor dei tipi aperti (#421, scene proprieta-02…09): la mappa non ha ancora le loro viste",
  },
  // ── differenze trovate dal controllo del 2026-11-21 ─────────────────────
  // docs/misure/2026-11-21-conformita-editor.md: nessun lavoro le ha ancora
  // corrette; quando una torna uguale al prototipo la voce diventa rossa.
  {
    id: "base.vista-scelta",
    proprieta: ["line-height"],
    perche: "controllo del 2026-11-21: l'interlinea delle schede delle viste segue quella del testo dell'app",
  },
  {
    id: "base.vista",
    proprieta: ["line-height"],
    perche: "controllo del 2026-11-21: l'interlinea delle schede delle viste segue quella del testo dell'app",
  },
  {
    id: "base.attrezzo",
    proprieta: ["padding", "line-height", "opacity"],
    perche: "controllo del 2026-11-21: attrezzi più stretti; il primo («Nuova vista») nell'app è spento dentro la nota, nel prototipo no",
  },
  {
    id: "base.nuova-riga",
    proprieta: ["font-weight", "color"],
    perche: "controllo del 2026-11-21: «Nuova riga» nell'app è in colore testo e semigrassetto, nel prototipo attenuata",
  },
  {
    id: "cornice.barra",
    proprieta: ["height", "padding", "gap", "color"],
    perche: "controllo del 2026-11-21: barra del titolo alta 40 invece di 44, senza margini e spazi propri",
  },
  {
    id: "cornice.pillola",
    proprieta: ["padding", "margin", "border-radius", "box-shadow", "font-size", "line-height", "background-color", "height"],
    perche: "controllo del 2026-11-21: pillola alta 28, a 14 px, senza filo, su un altro fondo",
  },
  {
    id: "cornice.pillola-testo",
    proprieta: ["font-size", "line-height"],
    perche: "controllo del 2026-11-21: il titolo nella pillola a 14 px invece di 13",
  },
  {
    id: "cornice.vault",
    proprieta: ["padding", "border-radius"],
    perche: "controllo del 2026-11-21: angoli e margine sinistro del nome del vault",
  },
  {
    id: "cornice.pulsante",
    proprieta: ["gap", "border-radius", "font-size", "line-height"],
    perche: "controllo del 2026-11-21: i pulsanti della barra del titolo a 12 px e con angoli da 8",
  },
  {
    id: "banda.fascia",
    proprieta: ["height", "padding", "gap"],
    perche: "controllo del 2026-11-21: la banda di stato alta 26 invece di 32",
  },
  {
    id: "banda.salvato",
    proprieta: ["width", "height", "border-radius", "background-color", "margin-right"],
    perche: "controllo del 2026-11-21: il pallino «salvato» da 6 px, nel verde di --success invece dell'accento, attaccato al testo",
  },
  {
    id: "banda.modo",
    proprieta: ["padding", "gap", "border-radius", "font-weight", "color", "height"],
    perche: "controllo del 2026-11-21: il pulsante del modo più basso, attenuato e non semigrassetto",
  },
  {
    id: "banda.modo-freccia",
    proprieta: ["width", "height"],
    perche: "controllo del 2026-11-21: la freccia del modo da 12 px invece di 14",
  },
  {
    id: "barra.superficie",
    proprieta: ["font-size", "line-height", "color", "height"],
    perche: "controllo del 2026-11-21: barra di formato alta 36 a 12 px, in colore attenuato",
  },
  {
    id: "barra.pulsante",
    proprieta: ["font-size", "line-height", "opacity"],
    perche: "controllo del 2026-11-21: pulsanti della barra a 12 px; nella scena il primo (Annulla) è spento, nel prototipo acceso",
  },
  {
    id: "barra.stile",
    proprieta: ["font-size", "line-height"],
    perche: "controllo del 2026-11-21: il menu dello stile a 12 px",
  },
  {
    id: "barra.freccia",
    proprieta: ["width", "height"],
    perche: "controllo del 2026-11-21: la freccia dello stile da 12 px invece di 14",
  },
  {
    id: "barra.inserisci",
    proprieta: ["font-size", "line-height"],
    perche: "controllo del 2026-11-21: «Inserisci» a 12 px",
  },
  {
    id: "ispettore.superficie",
    proprieta: ["width", "padding", "background-color"],
    perche: "controllo del 2026-11-21: l'ispettore largo 264 su fondo pieno, senza margini interni",
  },
  {
    id: "ispettore.schede",
    proprieta: ["margin", "border-radius", "background-color", "height"],
    perche: "controllo del 2026-11-21: le schede dell'ispettore alte 30, angoli da 8, su un altro fondo",
  },
  {
    id: "ispettore.scheda-scelta",
    proprieta: ["border-radius", "box-shadow", "background-color", "height"],
    perche: "controllo del 2026-11-21: la scheda scelta alta 26, angoli da 6, ombra e fondo diversi",
  },
  {
    id: "ispettore.scheda",
    proprieta: ["border-radius", "height"],
    perche: "controllo del 2026-11-21: le schede alte 26 con angoli da 6",
  },
  {
    id: "sorgente.testo",
    proprieta: ["font-size", "white-space"],
    perche: "controllo del 2026-11-21: la Sorgente a 14 px invece di 13",
  },
  // ── controllo del 2026-11-28, parte 2 (`editor/da-coprire-parte-2.mjs`) ──
  ...DA_COPRIRE_PARTE_2,
];
