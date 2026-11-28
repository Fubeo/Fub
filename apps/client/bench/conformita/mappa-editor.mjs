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
//   perche }`, con l'id di un pezzo di `PEZZI`, e `stati` facoltativo per una
//   differenza che c'è solo in alcuni stati) si leggono e si confrontano,
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
import { PEZZI_COMMENTI_SBIRCIATA } from "./editor/pezzi-commenti-sbirciata.mjs";
import { PEZZI_CORNICE_PANNELLI } from "./editor/pezzi-cornice-pannelli.mjs";
import { PEZZI_DIAGRAMMA } from "./editor/pezzi-diagramma.mjs";
import { PEZZI_ESPORTA_PDF } from "./editor/pezzi-esporta-pdf.mjs";
import { PEZZI_FORMULA_TABELLA_TESTATA } from "./editor/pezzi-formula-tabella-testata.mjs";
import { PEZZI_LANCIATORE_MENU } from "./editor/pezzi-lanciatore-menu.mjs";
import { PEZZI_MENU_FINESTRE } from "./editor/pezzi-menu-finestre.mjs";
import { PEZZI_SLASH_SCHEDE } from "./editor/pezzi-slash-schede.mjs";
import { PEZZI_TABELLE_FOGLI } from "./editor/pezzi-tabelle-fogli.mjs";
import { VISTE_AREE } from "./editor/viste-aree.mjs";
import { VISTE as VISTE_PRIME } from "./editor/viste.mjs";
export { STATI } from "./editor/comuni.mjs";

/// Le viste: quelle di `editor/viste.mjs` e quelle aggiunte dal controllo
/// del 2026-11-28 (`editor/viste-aree.mjs`). Un id solo per vista.
export const VISTE = { ...VISTE_PRIME, ...VISTE_AREE };
// Un id ripetuto coprirebbe in silenzio la vista del primo file.
for (const id of Object.keys(VISTE_AREE)) {
  if (id in VISTE_PRIME) throw new Error(`la vista «${id}» è sia in editor/viste.mjs sia in editor/viste-aree.mjs`);
}

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
  ...PEZZI_TABELLE_FOGLI,
  ...PEZZI_DIAGRAMMA,
  ...PEZZI_COMMENTI_SBIRCIATA,
  ...PEZZI_MENU_FINESTRE,
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
    prototipo: ".pop .m",
    app: null,
    perche: "gli editor dei tipi aperti (#421, scene proprieta-02…09): la mappa non ha ancora le loro viste; il calendario (`.pop .dp`) è coperto dai pezzi `data.*` dal 2026-11-28",
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
  // ── controllo del 2026-11-28: tabelle e fogli, diagramma, commenti, menu
  // e finestre, sbirciata ───────────────────────────────────────────────────
  // docs/misure/2026-11-21-conformita-editor.md, sezione del 2026-11-28. Le
  // differenze non si correggono qui: quando una torna uguale al prototipo la
  // voce diventa rossa. I numeri sono «prototipo → app», giorno e notte.
  // I pezzi interi che nessuna vista apre dai due lati, o che l'app non ha.
  {
    id: "tabella.fantasma",
    prototipo: ".tg-ghost",
    app: ".tb-grid .tb-drop",
    perche: "controllo del 2026-11-28: la riga o la colonna fantasma si vede solo mentre se ne trascina una, e nessuna vista la tiene ferma a metà gesto",
  },
  {
    id: "tabella.riempi-anteprima",
    prototipo: ".tg .gr td.fillp",
    app: ".tb-grid .tb-cell.is-fill",
    perche: "controllo del 2026-11-28: le celle che il riempimento raggiungerà si vedono solo mentre si tira la maniglia, e nessuna vista la tiene ferma a metà gesto",
  },
  {
    id: "foglio.intestazione",
    prototipo: ".scard .gr td.hd",
    app: ".live-card .grid-paper",
    perche: "controllo del 2026-11-28: nel foglio nella nota l'app disegna il testo delle celle nella tela (`.grid-paper`): intestazioni, numeri, totali, formule ed errori non sono elementi da leggere",
  },
  {
    id: "foglio.numero",
    prototipo: ".scard .gr td.num",
    app: ".live-card .grid-paper",
    perche: "controllo del 2026-11-28: il numero allineato a destra è testo disegnato nella tela del foglio",
  },
  {
    id: "foglio.totale",
    prototipo: ".scard .gr td.tot",
    app: ".live-card .grid-paper",
    perche: "controllo del 2026-11-28: la riga del totale è testo disegnato nella tela del foglio",
  },
  {
    id: "foglio.formula",
    prototipo: ".scard .gr td.fx::after",
    app: ".live-card .grid-paper",
    perche: "controllo del 2026-11-28: il segno della formula nell'angolo della cella è disegnato nella tela del foglio",
  },
  {
    id: "foglio.errore",
    prototipo: ".scard .gr td.err",
    app: ".live-card .grid-paper",
    perche: "controllo del 2026-11-28: la cella in errore è disegnata nella tela del foglio",
  },
  {
    id: "diagramma.pannello",
    prototipo: ".dg-ed",
    app: null,
    perche: "controllo del 2026-11-28: il prototipo apre il sorgente in un riquadro accanto al disegno (fondo del vassoio, angoli da 10); l'app lo scrive nelle righe del blocco di codice sopra il disegno, e il riquadro non c'è",
  },
  {
    id: "diagramma.nodo",
    prototipo: ".dg-svg .box",
    app: ".mermaid-diagram-view img",
    perche: "controllo del 2026-11-28: l'app mostra il diagramma come immagine (`<img>` dal disegno di Mermaid): nodi, rombi, pillole, frecce ed etichette non sono elementi da leggere",
  },
  {
    id: "diagramma.rombo",
    prototipo: ".dg-svg .dec",
    app: ".mermaid-diagram-view img",
    perche: "controllo del 2026-11-28: il rombo della scelta sta dentro l'immagine del diagramma",
  },
  {
    id: "diagramma.pillola",
    prototipo: ".dg-svg .pill",
    app: ".mermaid-diagram-view img",
    perche: "controllo del 2026-11-28: la pillola d'inizio e di fine sta dentro l'immagine del diagramma",
  },
  {
    id: "diagramma.arco",
    prototipo: ".dg-svg .dg-e",
    app: ".mermaid-diagram-view img",
    perche: "controllo del 2026-11-28: le frecce stanno dentro l'immagine del diagramma",
  },
  {
    id: "diagramma.etichetta",
    prototipo: ".dg-svg .lt",
    app: ".mermaid-diagram-view img",
    perche: "controllo del 2026-11-28: le etichette delle frecce stanno dentro l'immagine del diagramma",
  },
  {
    id: "anteprima.scheda",
    prototipo: ".hovercard",
    app: ".link-preview",
    perche: "controllo del 2026-11-28: l'anteprima di un collegamento al passaggio: nel banco Ctrl e passaggio su un collegamento della Live non la apre, e nessuna scena la mostra",
  },
  {
    id: "anteprima.titolo",
    prototipo: ".hovercard h4",
    app: ".link-preview h4",
    perche: "controllo del 2026-11-28: il titolo dell'anteprima di un collegamento: nessuna scena la apre",
  },
  {
    id: "avviso.azione",
    prototipo: ".toast button",
    app: null,
    perche: "controllo del 2026-11-28: l'avviso del prototipo ha un'azione verde («Annulla», «Apri»); quello dell'app ha solo la crocetta per chiudere",
  },
  {
    id: "avviso.codice",
    prototipo: ".toast code",
    app: null,
    perche: "controllo del 2026-11-28: un tasto o un nome scritto nell'avviso (`code`): l'app scrive l'avviso come testo semplice",
  },
  {
    id: "sbirciata.icona",
    prototipo: ".peek-b .pi",
    app: null,
    perche: "controllo del 2026-11-28: l'icona grande della nota in testa alla sbirciata: la nota del banco non ha un'icona, e la sbirciata dell'app mostra la nota com'è",
  },
  // Le differenze misurate dei pezzi nuovi.
  {
    id: "tabella.cornice",
    proprieta: ["padding"],
    perche: "controllo del 2026-11-28: sotto la tabella l'app tiene 33,85 px d'aria per la barra «Aggiungi una riga», il prototipo 0",
  },
  {
    id: "tabella.scatola",
    proprieta: ["border-radius", "box-shadow", "background"],
    perche: "controllo del 2026-11-28: il prototipo chiude la tabella in una scatola (angoli da 8, filo interno da 1 px, fondo del foglio); l'app disegna i fili sulle celle e arrotonda le celle d'angolo, e la sua `.tb-grid` è senza angoli, filo né fondo",
  },
  {
    id: "tabella.lettera-passaggio",
    proprieta: ["color"],
    perche: "controllo del 2026-11-28: la lettera della colonna al passaggio è rgb(23, 34, 27) invece di rgb(31, 41, 35) (notte rgb(228, 233, 230) invece di rgb(218, 224, 220))",
  },
  {
    id: "tabella.lettera-passaggio-fondo",
    proprieta: ["background"],
    perche: "controllo del 2026-11-28: al passaggio la lettera della colonna prende il fondo pieno rgb(220, 230, 221) (notte rgb(15, 26, 19)) invece del velo rgba(23, 34, 27, 0.04) (notte rgba(228, 233, 230, 0.06))",
  },
  {
    id: "tabella.numero-passaggio-fondo",
    proprieta: ["background"],
    perche: "controllo del 2026-11-28: al passaggio il numero della riga resta senza fondo; il prototipo il velo rgba(23, 34, 27, 0.04) (notte rgba(228, 233, 230, 0.06))",
  },
  {
    id: "tabella.numero-passaggio",
    proprieta: ["color"],
    perche: "controllo del 2026-11-28: il numero della riga al passaggio resta grigio, rgb(91, 102, 95) invece di rgb(31, 41, 35)",
  },
  {
    id: "tabella.aggiungi-passaggio",
    proprieta: ["color", "background"],
    perche: "controllo del 2026-11-28: la barra «+» al passaggio ha un fondo pieno rgb(220, 230, 221) (notte rgb(15, 26, 19)) invece del velo rgba(23, 34, 27, 0.04), e il testo rgb(23, 34, 27) invece di rgb(31, 41, 35)",
  },
  {
    id: "tabella.riempi-passaggio",
    proprieta: ["transform"],
    perche: "controllo del 2026-11-28: la maniglia di riempimento al passaggio non si ingrandisce (il prototipo scale 1.25); la transform dell'app la mette soltanto al suo posto",
  },
  {
    id: "tabella.scelta-multipla",
    proprieta: ["background"],
    perche: "controllo del 2026-11-28: il velo di più celle scelte è rgba(0, 110, 70, 0.12) invece di 0.13, di notte rgba(83, 196, 142, 0.2) invece di rgba(85, 198, 144, 0.17)",
  },
  {
    id: "tabella.modifica",
    proprieta: ["padding", "border-radius", "background"],
    perche: "controllo del 2026-11-28: il campo della cella in modifica è dentro la cella, senza margini né angoli né fondo; il prototipo lo stende sopra la cella con 12 px ai lati, angoli da 6 e il fondo del foglio",
  },
  {
    id: "foglio.testata-esc",
    proprieta: ["color"],
    perche: "controllo del 2026-11-28: «Esc per uscire» è rgb(0, 110, 70) invece di rgb(0, 96, 60) (notte rgb(83, 196, 142) invece di rgb(117, 217, 166))",
  },
  {
    id: "foglio.testata-tasto",
    proprieta: ["padding", "border"],
    perche: "controllo del 2026-11-28: il tasto «Esc» ha un filo da 1 px e margini 2/4/1/4 px; il prototipo nessun filo e margini 3/5/2/5 px",
  },
  {
    id: "foglio.corpo",
    proprieta: ["padding"],
    perche: "controllo del 2026-11-28: il corpo della scheda del foglio non ha margini interni; il prototipo 22/14/14/30 px attorno alla griglia",
  },
  {
    id: "foglio.numero-riga",
    proprieta: ["width"],
    perche: "controllo del 2026-11-28: la colonna dei numeri di riga è larga 52 px invece di 16",
  },
  {
    id: "foglio.cella",
    proprieta: ["height", "border-bottom-color", "border-right-color", "background"],
    perche: "controllo del 2026-11-28: le celle del foglio sono alte 28 px invece di 34, coi fili più scuri (rgba(23, 34, 27, 0.3) invece di 0.16) e il fondo del foglio invece di trasparenti",
  },
  {
    id: "diagramma.stile",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: il nome dello stile ha l'interlinea a 12,6 px invece di 14,7",
  },
  {
    id: "diagramma.segmenti",
    proprieta: ["background"],
    perche: "controllo del 2026-11-28: la guida dei due segmenti è rgb(243, 247, 244) invece di rgb(234, 240, 236) (notte rgb(27, 36, 30) invece di rgb(31, 41, 34))",
  },
  {
    id: "diagramma.didascalia",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: la didascalia è in Newsreader da 12 px su 18 invece che in Hanken Grotesk da 13 su 19,5",
  },
  {
    id: "diagramma.didascalia",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno la didascalia è rgb(87, 98, 91) invece di rgb(91, 102, 95)",
  },
  {
    id: "diagramma.sorgente-testata",
    proprieta: ["height", "padding", "font", "color"],
    perche: "controllo del 2026-11-28: la testata del sorgente è la riga del recinto di codice (alta 17,5 px, mono da 14, senza margini, del colore del testo); il prototipo una barra alta 32 px, 12 px a sinistra, Hanken Grotesk da 12 a voce bassa",
  },
  {
    id: "diagramma.sorgente-fatto",
    proprieta: ["padding", "border-radius", "font", "color", "height"],
    perche: "controllo del 2026-11-28: «Fatto» è alto 17,5 px con testo da 9,75, margini da 4,4 e angoli da 4, rgb(0, 110, 70); il prototipo alto 24 con testo da 12, margini da 9 e angoli da 6, rgb(0, 96, 60)",
  },
  {
    id: "diagramma.sorgente",
    proprieta: ["font", "background", "white-space"],
    perche: "controllo del 2026-11-28: le righe del sorgente sono da 14 px invece di 12, sul fondo rgb(243, 247, 244) del blocco di codice invece che trasparenti, e vanno a capo (`break-spaces`) invece di scorrere (`pre`)",
  },
  {
    id: "diagramma.errore",
    proprieta: ["margin", "border-top-color", "background"],
    perche: "controllo del 2026-11-28: l'avviso d'errore sale di 10 px, ha un filo pieno rgb(209, 218, 212) invece del velo rgba(23, 34, 27, 0.16) e un fondo rgba(23, 34, 27, 0.05) invece di nessuno",
  },
  {
    id: "diagramma.errore",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno il testo dell'avviso d'errore è rgb(87, 98, 91) invece di rgb(91, 102, 95)",
  },
  {
    id: "diagramma.errore-riga",
    proprieta: ["color"],
    perche: "controllo del 2026-11-28: il numero di riga dell'errore è rgb(23, 34, 27) invece di rgb(31, 41, 35) (notte rgb(228, 233, 230) invece di rgb(218, 224, 220))",
  },
  {
    id: "diagramma.ingrandito",
    proprieta: ["background", "padding"],
    perche: "controllo del 2026-11-28: il diagramma ingrandito ha 16 px di margine interno e il fondo al 96% invece del 97%",
  },
  {
    id: "diagramma.ingrandito-chiudi",
    proprieta: ["top", "right", "border-radius", "background"],
    perche: "controllo del 2026-11-28: la crocetta dell'ingrandito non è a 12 px dall'angolo (top e right `auto`), è tonda (999 px invece di 9) e ha un fondo pieno rgb(255, 255, 255) (notte rgb(30, 41, 35)) invece di trasparente",
  },
  {
    id: "diagramma.ingrandito-aiuto",
    proprieta: ["bottom", "font"],
    perche: "controllo del 2026-11-28: l'aiuto in basso dell'ingrandito non è a 14 px dal fondo (`auto`) e ha l'interlinea a 17,4 px invece di `normal`",
  },
  {
    id: "commenti.bolla-scelta",
    proprieta: ["color"],
    stati: ["chiaro-1280"],
    perche: "controllo del 2026-11-28: di giorno la bolla scelta è rgb(87, 98, 91) invece di rgb(91, 102, 95)",
  },
  {
    id: "commenti.bolla",
    proprieta: ["color"],
    stati: ["chiaro-1280"],
    perche: "controllo del 2026-11-28: di giorno la bolla è rgb(87, 98, 91) invece di rgb(91, 102, 95)",
  },
  {
    id: "commenti.bolla-passaggio",
    proprieta: ["color"],
    perche: "controllo del 2026-11-28: la bolla al passaggio è rgb(23, 34, 27) invece di rgb(31, 41, 35) (notte rgb(228, 233, 230) invece di rgb(218, 224, 220))",
  },
  {
    id: "commenti.bolla-nel-testo-scelta",
    proprieta: ["width", "height", "padding"],
    perche: "controllo del 2026-11-28: a 700 px l'app porta la bolla nel testo, alta 20 px e larga 34,2 invece di 26 e 41,5 al margine, con margini 2/6 px invece di 3/8",
  },
  {
    id: "commenti.bolla-nel-testo-scelta",
    proprieta: ["color"],
    stati: ["chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno la bolla nel testo è rgb(87, 98, 91) invece di rgb(91, 102, 95)",
  },
  {
    id: "commenti.bolla-nel-testo",
    proprieta: ["width", "height", "padding"],
    perche: "controllo del 2026-11-28: a 700 px l'app porta la bolla nel testo, alta 20 px e larga 34,2 invece di 26 e 41,5 al margine, con margini 2/6 px invece di 3/8",
  },
  {
    id: "commenti.bolla-nel-testo",
    proprieta: ["color"],
    stati: ["chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno la bolla nel testo è rgb(87, 98, 91) invece di rgb(91, 102, 95)",
  },
  {
    id: "commenti.segno",
    proprieta: ["box-shadow", "background"],
    perche: "controllo del 2026-11-28: il segno del commento ha un velo più chiaro (alfa 0,38 invece di 0,55) e il filo sotto rgb(250, 222, 78) invece di rgb(246, 219, 107); di notte il filo è rgba(216, 189, 81, 0.3) invece di rgb(108, 89, 21)",
  },
  {
    id: "commenti.segno-scelto",
    proprieta: ["box-shadow", "background"],
    perche: "controllo del 2026-11-28: il segno scelto non ha il filo sotto e somma due veli (rgba(250, 222, 78, 0.55) più un gradiente) invece del fondo pieno rgb(246, 219, 107) (notte rgb(108, 89, 21))",
  },
  {
    id: "commenti.riquadro",
    proprieta: ["border-radius"],
    perche: "controllo del 2026-11-28: il riquadro della discussione ha angoli da 12 px invece di 14",
  },
  {
    id: "commenti.discussione",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: la discussione è scritta a 12 px su 16,8 invece di 13 su 18,2",
  },
  {
    id: "commenti.citazione",
    proprieta: ["border-left-color"],
    perche: "controllo del 2026-11-28: il filo della citazione è rgb(250, 222, 78) invece di rgb(246, 219, 107); di notte rgba(216, 189, 81, 0.3) invece di rgb(108, 89, 21)",
  },
  {
    id: "commenti.autore",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: il nome dell'autore è a 12 px su 16,8 invece di 13 su 18,2",
  },
  {
    id: "commenti.ora",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno l'ora è rgb(91, 102, 95) invece di rgb(87, 98, 91)",
  },
  {
    id: "commenti.testo",
    proprieta: ["font", "color"],
    perche: "controllo del 2026-11-28: il testo del messaggio è a 12 px su 17,4 invece di 13 su 18,85, rgb(31, 41, 35) invece di rgb(23, 34, 27) (notte rgb(218, 224, 220) invece di rgb(228, 233, 230))",
  },
  {
    id: "commenti.risposta",
    proprieta: ["box-shadow"],
    perche: "controllo del 2026-11-28: la casella della risposta ha l'anello d'accento da 2 px (rgb(0, 110, 70)) invece del filo da 1 px rgb(176, 187, 179): l'app la apre col fuoco, il prototipo no",
  },
  {
    id: "commenti.campo",
    proprieta: ["padding", "font"],
    perche: "controllo del 2026-11-28: il campo della risposta ha margini 6/8 px invece di 2, e testo a 12 px su 16,8 invece di 13 su 18,2",
  },
  {
    id: "commenti.invia",
    proprieta: ["color", "opacity"],
    perche: "controllo del 2026-11-28: «Invia» a campo vuoto è spento (opacità 0,45) e la freccia è rgb(249, 253, 251) invece di rgb(255, 255, 255); il prototipo lo tiene acceso",
  },
  {
    id: "sbirciata.superficie",
    proprieta: ["width", "border-radius"],
    perche: "controllo del 2026-11-28: la sbirciata è larga 382 px invece di 455 a 1280 (346 invece di 353 a 700) e ha angoli da 12 px anche a destra, dove il prototipo la tiene a filo (0)",
  },
  {
    id: "sbirciata.pulsante-passaggio",
    proprieta: ["background"],
    perche: "controllo del 2026-11-28: «Apri qui» al passaggio ha il fondo pieno rgb(220, 230, 221) (notte rgb(15, 26, 19)) invece del velo rgba(23, 34, 27, 0.05)",
  },
  {
    id: "sbirciata.corpo",
    proprieta: ["padding", "font"],
    perche: "controllo del 2026-11-28: il corpo della sbirciata non ha margini propri (il prototipo 26/30/40/30 px) e la sua scritta di base è Hanken Grotesk da 13 su 18,85 invece di Newsreader da 16,5 su 26,4; la nota dentro ha i suoi caratteri (`sbirciata.paragrafo`)",
  },
  {
    id: "sbirciata.titolo",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: il titolo della nota nella sbirciata è da 31 px su 37 con spaziatura -0,372 invece di 30 su 36 senza spaziatura",
  },
  {
    id: "sbirciata.paragrafo",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: il testo della nota nella sbirciata ha l'interlinea a 27,2 px invece di 26,4",
  },
  {
    id: "data.finestra",
    proprieta: ["padding", "border-radius", "box-shadow", "background"],
    perche: "controllo del 2026-11-28: il riquadro della data ha 4 px di margine interno, angoli da 10 invece di 14, l'ombra dei riquadri di Fub invece di quella del prototipo (anello da 1 px più due ombre) e il fondo rgb(255, 255, 255) (notte rgb(30, 41, 35)) invece di rgb(252, 254, 253) (notte rgb(19, 28, 22))",
  },
  {
    id: "data.corpo",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: il calendario ha l'interlinea a 18,85 px invece di 18,2",
  },
  {
    id: "data.campo-testo",
    proprieta: ["padding", "font", "color"],
    perche: "controllo del 2026-11-28: il testo del campo della data non ha margini (il prototipo 1/2 px), interlinea 18,85 invece di 18,2, colore rgb(31, 41, 35) invece di rgb(23, 34, 27) (notte rgb(218, 224, 220) invece di rgb(228, 233, 230))",
  },
  {
    id: "data.rapida",
    proprieta: ["font", "color", "background"],
    perche: "controllo del 2026-11-28: le scelte rapide hanno il velo rgba(23, 34, 27, 0.08) invece del fondo rgb(243, 247, 244), testo rgb(31, 41, 35) invece di rgb(23, 34, 27) e interlinea 17,4 invece di 16,8",
  },
  {
    id: "data.rapida-passaggio",
    proprieta: ["color", "background"],
    perche: "controllo del 2026-11-28: la scelta rapida al passaggio ha il fondo pieno rgb(204, 238, 218) (notte rgb(3, 61, 38)) invece del velo d'accento rgba(0, 110, 70, 0.12), e il testo resta rgb(31, 41, 35) invece di prendere l'accento",
  },
  {
    id: "data.mese",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: il mese ha l'interlinea a 18,85 px invece di 18,2",
  },
  {
    id: "data.mese-freccia",
    proprieta: ["width", "height", "border-radius"],
    perche: "controllo del 2026-11-28: le frecce del mese sono da 26 px con angoli da 6 invece di 28 e 7",
  },
  {
    id: "data.mese-freccia",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno le frecce del mese sono rgb(91, 102, 95) invece di rgb(87, 98, 91)",
  },
  {
    id: "data.giorno-settimana",
    proprieta: ["font", "color"],
    perche: "controllo del 2026-11-28: le iniziali dei giorni sono più chiare, rgb(120, 130, 124) invece di rgb(87, 98, 91) (notte rgb(124, 134, 127) invece di rgb(158, 167, 161)), con interlinea 15,2 px invece di 14,7",
  },
  {
    id: "data.giorno",
    proprieta: ["font", "color"],
    perche: "controllo del 2026-11-28: il giorno è rgb(31, 41, 35) invece di rgb(23, 34, 27) (notte rgb(218, 224, 220) invece di rgb(228, 233, 230)) con interlinea 18,85 px invece di 18,2",
  },
  {
    id: "data.giorno-passaggio",
    proprieta: ["color", "background"],
    perche: "controllo del 2026-11-28: il giorno al passaggio ha il velo all'alfa 0,04 invece di 0,05 (notte 0,06 invece di 0,07) e il testo rgb(31, 41, 35) invece di rgb(23, 34, 27)",
  },
  {
    id: "data.giorno-scelto",
    proprieta: ["color"],
    perche: "controllo del 2026-11-28: il giorno scelto è scritto rgb(249, 253, 251) invece di bianco; di notte rgb(2, 17, 9), scuro sull'accento, invece di bianco",
  },
  {
    id: "data.piede",
    proprieta: ["border-top-color"],
    perche: "controllo del 2026-11-28: il filo sopra «Togli la data» è il velo rgba(23, 34, 27, 0.16) invece del filo pieno rgb(209, 218, 212)",
  },
  {
    id: "data.azione",
    proprieta: ["font"],
    perche: "controllo del 2026-11-28: «Togli la data» ha l'interlinea a 18,85 px invece di 18,2",
  },
  {
    id: "data.azione",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: "controllo del 2026-11-28: di giorno «Togli la data» è rgb(91, 102, 95) invece di rgb(87, 98, 91)",
  },
  {
    id: "avviso.superficie",
    proprieta: ["padding", "gap", "box-shadow", "font", "color", "background"],
    perche: "controllo del 2026-11-28: l'avviso dell'app è un riquadro chiaro (rgb(255, 255, 255), notte rgb(30, 41, 35)) col testo scuro e l'ombra dei riquadri, margini 12/8/12/16 e spazio 8; il prototipo un'etichetta scura rovesciata (rgb(27, 38, 32) col testo rgb(238, 243, 240), di notte il contrario), margini 9/10/9/14, spazio 12, interlinea 18,1 invece di 18,85",
  },
  {
    id: "avviso.testo",
    proprieta: ["font", "color"],
    perche: "controllo del 2026-11-28: il testo dell'avviso è scuro su chiaro (rgb(23, 34, 27)) invece che chiaro su scuro (rgb(238, 243, 240)), con interlinea 18,85 px invece di 18,1",
  },
];
