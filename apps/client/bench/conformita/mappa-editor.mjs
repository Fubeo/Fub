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
//   dell'app la luce della scena e la finestra del banco.
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
//   coi selettori dei due lati. `stati` (facoltativo) restringe gli stati della vista.
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
// Un task grafico aggiunge qui i suoi pezzi, rigenera i valori attesi con
// `estrai.mjs` e passa `npm run bench:conformita`.
import { BASE } from "./confronto.mjs";

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
};

/// Le traduzioni per contesto: ogni pezzo usa quella del suo `contesto`.
export const TRADUZIONI = {
  interfaccia: TRADUZIONE,
  documento: TRADUZIONE_DOCUMENTO,
};

/// Gli stati.`larghezza` è quella del prototipo (`piena`, `700`,
/// `telefono`); `finestra` la finestra del banco dell'app che le corrisponde.
export const STATI = {
  "chiaro-1280": { luce: "light", prototipo: { luce: "giorno", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "scuro-1280": { luce: "dark", prototipo: { luce: "notte", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "chiaro-700": { luce: "light", prototipo: { luce: "giorno", larghezza: "700" }, finestra: { width: 700, height: 800 } },
  "scuro-700": { luce: "dark", prototipo: { luce: "notte", larghezza: "700" }, finestra: { width: 700, height: 800 } },
};

const TUTTI = Object.keys(STATI);
/// L'anteprima del lanciatore c'è solo dove c'è posto: il prototipo la
/// nasconde a 700 px (riga 651), l'app sotto i 960 px (`PREVIEW_MIN_WIDTH`).
const LARGHI = ["chiaro-1280", "scuro-1280"];

export const VISTE = {
  /// Il lanciatore Ctrl O sul modo Tutto, con le note nell'elenco e
  /// l'anteprima della prima. Il prototipo lo apre dalla pillola (`cmdk()`,
  /// riga 4342) a campo vuoto: le «Recenti» sono note, e la prima è attiva
  /// con il suo foglio d'anteprima. L'app passa dalla scena del banco,
  /// che cerca «gui» e aspetta l'anteprima della riga attiva.
  lanciatore: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.click("#win #pill");
        await page.waitForSelector("#win .k .k-i.act");
      },
    },
    app: { scena: "launcher-files" },
  },

  /// Il menu della maniglia: il prototipo lo apre al passo «Al passaggio»
  /// (maniglie sul blocco «punto») col clic sulla presa; l'app dalla scena
  /// dei Blocchi col menu aperto su un titolo.
  "menu-blocco": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Al passaggio");
        await page.waitForSelector("#win #gutter.on");
        await page.click("#win #g-grip");
        await page.waitForSelector("#win .pop .m-s");
      },
    },
    app: { scena: "blocchi-03-menu" },
  },
  /// Il tasto destro su una selezione: testata, barra degli appunti, voci e
  /// piede che invita a scrivere. Il prototipo sceglie due parole al passo
  /// «Il tasto destro» e apre il menu da sé; l'app dalla scena del banco.
  "menu-selezione": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il tasto destro");
        await page.waitForSelector("#win .pop.cx .m-tiles");
      },
    },
    app: { scena: "menu-selezione" },
  },
  /// Le maniglie accanto a un blocco: «+» e la presa con gli occhi, col
  /// puntatore sul blocco e non sulle maniglie.
  maniglie: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Al passaggio");
        await page.waitForSelector("#win #gutter.on");
      },
    },
    app: { scena: "blocchi-01-passaggio" },
  },
  /// La tabella Markdown col fuoco e una cella scelta (non la tabella della
  /// Base, `.btab`): il prototipo al passo «La tabella, coi gesti del
  /// foglio» (A2:A4 scelte), l'app col cursore in una cella.
  tabella: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La tabella, coi gesti del foglio");
        await page.waitForSelector("#win #tb-grid .tg-sel .tg-fill");
      },
    },
    app: { scena: "live-14-tabella-attiva" },
  },
  /// La somma nella banda, con più celle numeriche scelte: il prototipo al
  /// passo «La somma nella banda», l'app allarga di una cella in giù la
  /// scelta nella colonna dei numeri.
  somma: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La somma nella banda");
        await page.waitForSelector("#win #band-words b");
      },
    },
    app: {
      scena: "live-14-tabella-attiva",
      prepara: async (page) => {
        await page.keyboard.press("Shift+ArrowDown");
        await page.waitForSelector(".status-sum-part[data-lead] > .status-sum-value");
      },
    },
  },
  /// La testata della nota a riposo, in Scrittura: copertina, strumenti
  /// (nascosti finché il puntatore non ci passa), titolo e riga dei dati. Il
  /// prototipo al primo passo, «A riposo».
  testata: {
    stati: TUTTI,
    prototipo: { prepara: (page) => passo(page, "A riposo") },
    app: { scena: "testata-01-scrittura" },
  },
  /// Le proprietà della nota, una riga per proprietà, a riposo.
  proprieta: {
    stati: TUTTI,
    prototipo: { prepara: (page) => passo(page, "A riposo") },
    app: { scena: "proprieta-01-righe" },
  },
  /// La riga dei suggerimenti al centro della banda, con dei tasti scritti:
  /// il prototipo al primo passo, «A riposo» (i tasti della riga
  /// qualunque), l'app con una parola scelta (grassetto, corsivo, collega).
  /// Il contesto cambia le parole, non gli stili che si leggono.
  suggerimenti: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.waitForSelector("#win #hint kbd");
      },
    },
    app: { scena: "riga-dei-suggerimenti" },
  },
};

/// Porta il giro del prototipo al passo che si chiama `titolo`, dai pallini
/// della guida (ognuno ha il titolo «n. Nome del passo»): per nome, non per
/// numero, così un passo aggiunto in mezzo non sposta la vista.
async function passo(page, titolo) {
  await page.click(`#tour-steps [data-step][title$=". ${titolo}"]`);
}

const DIMENSIONI = ["width", "height"];
const ALLINEAMENTO = ["display", "align-items", "justify-content"];

export const PEZZI = [
  // ── il lanciatore Ctrl O (T13, #429) ──────────────────────────────────────
  {
    id: "lanciatore.superficie",
    vista: "lanciatore",
    prototipo: ".k",
    app: ".launcher",
    proprieta: [...BASE, "width"],
  },
  {
    id: "lanciatore.testa",
    vista: "lanciatore",
    prototipo: ".k-in",
    app: ".launcher-head",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "lanciatore.lente",
    vista: "lanciatore",
    prototipo: ".k-in > .i",
    app: ".launcher-lens > svg",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "lanciatore.campo",
    vista: "lanciatore",
    prototipo: ".k-in input",
    app: ".launcher-input",
    proprieta: ["padding", "border", "font", "color", "background"],
  },
  {
    id: "lanciatore.esc",
    vista: "lanciatore",
    prototipo: ".k-x",
    app: ".launcher-close",
    proprieta: [...BASE, "height"],
  },
  {
    id: "lanciatore.modi",
    vista: "lanciatore",
    prototipo: ".k-sc",
    app: ".launcher-modes",
    proprieta: [...BASE, "display"],
  },
  {
    id: "lanciatore.modo-scelto",
    vista: "lanciatore",
    prototipo: '.k-sc button[aria-selected="true"]',
    app: '.launcher-mode[aria-selected="true"]',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "lanciatore.modo",
    vista: "lanciatore",
    prototipo: '.k-sc button[aria-selected="false"]',
    app: '.launcher-mode[aria-selected="false"]',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "lanciatore.quadratino-scelto",
    vista: "lanciatore",
    prototipo: '.k-sc button[aria-selected="true"] .ti',
    app: '.launcher-mode[aria-selected="true"] .launcher-mode-tile',
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "lanciatore.quadratino",
    vista: "lanciatore",
    prototipo: '.k-sc button[aria-selected="false"] .ti',
    app: '.launcher-mode[aria-selected="false"] .launcher-mode-tile',
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "lanciatore.riga",
    vista: "lanciatore",
    prototipo: ".k-i:not(.act)",
    app: ".launcher-row:not([data-active])",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    // La riga attiva, senza il fondo: nell'app il fondo è un evidenziatore
    // che scorre sotto le righe (`.launcher-highlight`), il pezzo qui sotto.
    id: "lanciatore.riga-attiva",
    vista: "lanciatore",
    prototipo: ".k-i.act",
    app: ".launcher-row[data-active]",
    proprieta: ["padding", "margin", "gap", "font", "color", "height", ...ALLINEAMENTO],
  },
  {
    id: "lanciatore.riga-attiva-fondo",
    vista: "lanciatore",
    prototipo: ".k-i.act",
    app: ".launcher-highlight",
    proprieta: ["background-color", "border-radius"],
  },
  {
    id: "lanciatore.icona",
    vista: "lanciatore",
    prototipo: ".k-i:not(.act) .ic",
    app: ".launcher-row:not([data-active]) .launcher-row-icon",
    proprieta: ["color", "font-size", ...DIMENSIONI],
  },
  {
    id: "lanciatore.icona-attiva",
    vista: "lanciatore",
    prototipo: ".k-i.act .ic",
    app: ".launcher-row[data-active] .launcher-row-icon",
    proprieta: ["color"],
  },
  {
    id: "lanciatore.anteprima",
    vista: "lanciatore",
    stati: LARGHI,
    prototipo: ".k-prev",
    app: ".launcher-preview",
    proprieta: [...BASE, "width", "display"],
  },
  {
    id: "lanciatore.anteprima-foglio",
    vista: "lanciatore",
    stati: LARGHI,
    prototipo: ".kp-sheet",
    app: ".launcher-preview-sheet",
    proprieta: [...BASE],
  },
  {
    id: "lanciatore.anteprima-sfumatura",
    vista: "lanciatore",
    stati: LARGHI,
    prototipo: ".kp-sheet::after",
    app: ".launcher-preview-sheet::after",
    proprieta: ["height", "background-image"],
  },
  {
    id: "lanciatore.anteprima-testo",
    vista: "lanciatore",
    stati: LARGHI,
    prototipo: ".kp-sheet p",
    app: ".launcher-preview-page p",
    proprieta: ["font", "color"],
  },

  // ── i menu dell'editor (T81) e le maniglie dei blocchi (T2a): #431 ───────
  // Il tasto destro su una selezione.
  {
    id: "menu.superficie",
    vista: "menu-selezione",
    prototipo: ".pop.cx",
    app: ".context-menu",
    proprieta: [...BASE, "width", "min-width"],
  },
  {
    id: "menu.testa",
    vista: "menu-selezione",
    prototipo: ".m-head",
    app: ".context-menu .menu-head",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "menu.testa-icona",
    vista: "menu-selezione",
    prototipo: ".m-head .ic svg",
    app: ".context-menu .menu-head > svg",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "menu.testa-tipo",
    vista: "menu-selezione",
    prototipo: ".m-head b",
    app: ".context-menu .menu-head-kind",
    proprieta: ["font", "color"],
  },
  {
    id: "menu.testa-nome",
    vista: "menu-selezione",
    prototipo: ".m-head .x",
    app: ".context-menu .menu-head-name",
    proprieta: ["font", "color"],
  },
  {
    id: "menu.appunti",
    vista: "menu-selezione",
    prototipo: ".m-tiles",
    app: ".context-menu .menu-clipboard",
    proprieta: BASE,
  },
  {
    id: "menu.appunto",
    vista: "menu-selezione",
    prototipo: ".m-t",
    app: ".context-menu .menu-quick",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "menu.appunto-icona",
    vista: "menu-selezione",
    prototipo: ".m-t .ti svg",
    app: ".context-menu .menu-quick .kit-tile-icon svg",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "menu.voce",
    vista: "menu-selezione",
    prototipo: ".m-l > button.m-i:not(.act)",
    app: ".context-menu .menu-items > button.kit-row:not(.menu-lit)",
    proprieta: [...BASE, "min-height", ...ALLINEAMENTO],
  },
  {
    id: "menu.voce-icona",
    vista: "menu-selezione",
    prototipo: ".m-l > button.m-i:not(.act) .ic",
    app: ".context-menu .menu-items > button.kit-row:not(.menu-lit) .menu-icon",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "menu.voce-tasti",
    vista: "menu-selezione",
    prototipo: ".m-l > button.m-i:not(.act) kbd",
    app: ".context-menu .menu-items > button.kit-row:not(.menu-lit) .kit-row-keys",
    proprieta: ["font", "color", "padding", "background", "box-shadow", "border-radius"],
  },
  {
    id: "menu.piede",
    vista: "menu-selezione",
    prototipo: ".m-find",
    app: ".context-menu .menu-foot",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  // Il menu della maniglia.
  {
    id: "menu.superficie-blocco",
    vista: "menu-blocco",
    prototipo: ".pop",
    app: ".context-menu",
    proprieta: [...BASE, "min-width"],
  },
  {
    id: "menu.campo",
    vista: "menu-blocco",
    prototipo: ".m-s",
    app: ".context-menu .menu-field",
    proprieta: [...BASE, ...ALLINEAMENTO],
  },
  {
    id: "menu.campo-lente",
    vista: "menu-blocco",
    prototipo: ".m-s > svg",
    app: ".context-menu .menu-field > svg",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "menu.campo-testo",
    vista: "menu-blocco",
    prototipo: ".m-s input",
    app: ".context-menu .menu-field-input",
    proprieta: ["font", "color", "padding", "border", "background"],
  },
  {
    id: "menu.titolo",
    vista: "menu-blocco",
    prototipo: ".m-h",
    app: ".context-menu .menu-title",
    proprieta: ["font", "color", "padding", "margin", "text-transform"],
  },
  {
    id: "menu.voce-accesa",
    vista: "menu-blocco",
    prototipo: ".m-i.act",
    app: ".context-menu .kit-row.menu-lit",
    proprieta: ["color", "background", "font"],
  },
  {
    id: "menu.voce-accesa-icona",
    vista: "menu-blocco",
    prototipo: ".m-i.act .ic",
    app: ".context-menu .kit-row.menu-lit .menu-icon",
    proprieta: ["color", ...DIMENSIONI],
  },
  {
    id: "menu.scia",
    vista: "menu-blocco",
    prototipo: ".m-hl",
    app: ".context-menu .menu-glide",
    proprieta: ["background", "border-radius", "opacity"],
  },
  {
    id: "menu.separatore",
    vista: "menu-blocco",
    prototipo: ".m-sep",
    app: ".context-menu .menu-separator",
    proprieta: ["height", "margin", "background", "border"],
  },
  {
    id: "menu.voce-pericolo",
    vista: "menu-blocco",
    prototipo: ".m-i.danger",
    app: ".context-menu .kit-row.danger",
    proprieta: ["color", "background"],
  },
  {
    id: "menu.piede-tasti",
    vista: "menu-blocco",
    prototipo: ".m-foot",
    app: ".context-menu .menu-foot-keys",
    proprieta: BASE,
  },
  {
    id: "menu.piede-tasto",
    vista: "menu-blocco",
    prototipo: ".m-foot kbd",
    app: ".context-menu .menu-foot-keys kbd",
    proprieta: BASE,
  },
  // Le maniglie: «+» e la presa a due occhi.
  {
    id: "maniglie.aggiungi",
    vista: "maniglie",
    contesto: "documento",
    prototipo: "#g-add",
    app: '.cm-fub-block-handles[data-active="true"] .cm-fub-block-add',
    proprieta: [...DIMENSIONI, "border-radius", "color", "background", "opacity"],
  },
  {
    id: "maniglie.aggiungi-icona",
    vista: "maniglie",
    contesto: "documento",
    prototipo: "#g-add svg",
    app: '.cm-fub-block-handles[data-active="true"] .cm-fub-block-add svg',
    proprieta: DIMENSIONI,
  },
  {
    id: "maniglie.presa",
    vista: "maniglie",
    contesto: "documento",
    prototipo: "#g-grip",
    app: '.cm-fub-block-handles[data-active="true"] .cm-fub-block-grip',
    proprieta: [...DIMENSIONI, "border-radius", "color", "background", "opacity"],
  },
  {
    id: "maniglie.occhi",
    vista: "maniglie",
    contesto: "documento",
    prototipo: "#g-grip svg.ea",
    app: '.cm-fub-block-handles[data-active="true"] .cm-fub-block-grip-eyes svg',
    proprieta: DIMENSIONI,
  },

  // ── la tabella Markdown (T50) e la somma nella banda (T55): #432 ─────────
  // Le celle si scelgono lontano dal bordo esterno, che nel prototipo è un
  // anello della scatola (`.gr-box`) e nell'app il bordo delle celle di
  // fuori: i fili di dentro si confrontano sul lato basso.
  {
    id: "tabella.intestazione",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr tr:first-child td:nth-child(2)",
    app: '.tb-grid .tb-cell.tb-head[data-col="0"]',
    proprieta: ["padding", "font", "color", "background", "height", "white-space", "border-bottom-width", "border-bottom-style", "border-bottom-color"],
  },
  {
    id: "tabella.cella",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr tr:nth-child(2) td:nth-child(2)",
    app: '.tb-grid .tb-cell[data-row="1"][data-col="1"]',
    proprieta: ["padding", "font", "color", "background", "height", "white-space", "border-bottom-width", "border-bottom-style", "border-bottom-color"],
  },
  {
    id: "tabella.lettera",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr-let span:not(.on)",
    app: ".tb-grid .tb-letter:not(.is-selected)",
    proprieta: ["font", "color", "background"],
  },
  {
    id: "tabella.lettera-scelta",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr-let span.on",
    app: ".tb-grid .tb-letter.is-selected",
    proprieta: ["font", "color"],
  },
  // Nell'app il fondo della scelta è un `::before` sotto la lettera.
  {
    id: "tabella.lettera-scelta-fondo",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr-let span.on",
    app: ".tb-grid .tb-letter.is-selected::before",
    proprieta: ["background"],
  },
  {
    id: "tabella.numero",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr-num span:not(.on)",
    app: ".tb-grid .tb-rowhead:not(.is-selected)",
    proprieta: ["font", "color", "background"],
  },
  {
    id: "tabella.numero-scelto",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr-num span.on",
    app: ".tb-grid .tb-rowhead.is-selected",
    proprieta: ["font", "color"],
  },
  {
    id: "tabella.numero-scelto-fondo",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".gr-num span.on",
    app: ".tb-grid .tb-rowhead.is-selected::before",
    proprieta: ["background"],
  },
  {
    id: "tabella.riempi",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".tg-fill",
    app: ".tb-grid .tb-fill",
    proprieta: [...DIMENSIONI, "border-radius", "background", "box-shadow"],
  },
  {
    id: "tabella.aggiungi-riga",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".tg-add.row",
    app: '.tb-add[data-add="row"]',
    proprieta: ["height", "bottom", "border-radius", "color", "background", "opacity"],
  },
  {
    id: "tabella.aggiungi-colonna",
    vista: "tabella",
    contesto: "documento",
    prototipo: ".tg-add.col",
    app: '.tb-add[data-add="column"]',
    proprieta: ["width", "right", "border-radius", "color", "background", "opacity"],
  },
  {
    id: "somma.valore",
    vista: "somma",
    prototipo: "#band-words b",
    app: ".status-sum-part[data-lead] > .status-sum-value",
    proprieta: ["font", "color"],
  },

  // ── la testata (T7) e le proprietà (T8): #421 ────────────────────────────
  {
    id: "testata.copertina",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".cover",
    app: ".cm-fub-page-cover",
    proprieta: ["height", "border-radius"],
  },
  {
    id: "testata.strumenti",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".ptools",
    app: ".cm-fub-page-tools",
    proprieta: ["display", "gap", "height", "margin", "opacity"],
  },
  {
    id: "testata.strumento",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".ptools button",
    app: ".cm-fub-page-tool",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "testata.titolo",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".ptitle",
    app: ".cm-fub-page-title",
    proprieta: ["font", "color", "margin", "padding"],
  },
  {
    id: "testata.dati",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".facts",
    app: ".note-facts",
    proprieta: [...BASE, ...ALLINEAMENTO],
  },
  {
    id: "testata.dato",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".facts button:not(.tag)",
    app: ".note-fact:not(.note-fact-tags)",
    proprieta: ["padding", "margin", "gap", "border-radius", "font", "color"],
  },
  {
    id: "testata.etichetta",
    vista: "testata",
    attende: "#421",
    contesto: "documento",
    prototipo: ".facts .tag",
    app: ".note-tag",
    proprieta: BASE,
  },
  {
    id: "proprieta.elenco",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".props",
    app: ".cm-fub-page-props",
    proprieta: ["display", "row-gap", "margin", "font"],
  },
  {
    id: "proprieta.chiave",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".pk",
    app: ".cm-fub-page-prop-key",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "proprieta.valore",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".pv",
    app: ".cm-fub-page-prop-value",
    proprieta: [...BASE, "min-height", ...ALLINEAMENTO],
  },
  {
    id: "proprieta.persona",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".person",
    app: ".cm-fub-prop-person",
    proprieta: [...BASE, "height"],
  },
  {
    id: "proprieta.altre",
    vista: "proprieta",
    attende: "#421",
    contesto: "documento",
    prototipo: ".props .more",
    app: ".cm-fub-page-props-more",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },

  // ── la riga dei suggerimenti (T14): #383 ─────────────────────────────────
  {
    id: "suggerimenti.riga",
    vista: "suggerimenti",
    prototipo: ".hint",
    app: "#status-hints",
    proprieta: [...BASE, ...ALLINEAMENTO, "text-align", "white-space", "overflow-x", "text-overflow", "flex-grow", "flex-shrink", "flex-basis", "min-width"],
  },
  {
    id: "suggerimenti.tasto",
    vista: "suggerimenti",
    prototipo: ".hint kbd",
    app: "#status-hints .status-hints-key",
    proprieta: [...BASE, "white-space"],
  },
];

/// I pezzi che hanno ancora differenze, e chi li corregge. Non si
/// confrontano finché non passano in `PEZZI`.
export const DA_COPRIRE = [
  // ── il lanciatore: differenze trovate il 2026-11-16 dopo #429 ─────────────
  {
    id: "lanciatore.gruppo",
    prototipo: ".k-g",
    app: ".launcher-group",
    perche: "lo stile dei titoli dei gruppi («Recenti», «Note») va a T82 (corpo di #429)",
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
];
