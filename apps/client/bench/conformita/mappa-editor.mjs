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
  /// «Nuova nota» che chiede il tipo (T33, `newNote()` del prototipo): il
  /// menu sotto il pulsante del cassetto. Solo largo: nel prototipo il
  /// cassetto c'è a finestra piena.
  "nuova-nota": {
    stati: LARGHI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.click("#win #new-note");
        await page.waitForSelector("#win .pop .m-i .ic.tile");
      },
    },
    app: { scena: "tipi-01-nuova" },
  },
  /// Il promemoria di un compito (T36): il prototipo lo ha a riposo nel
  /// compito «Chiedere il preventivo» (`remChip`, riga 2717); l'app dalla
  /// Live coi promemoria, la prima pastiglia aperta.
  promemoria: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.waitForSelector("#win .rem");
      },
    },
    app: { scena: "live-28-promemoria" },
  },
  /// Le proposte dei simboli (T61): la formula in riga aperta, in fondo `+`
  /// e `\fr`. Il prototipo al passo «La formula si tocca», che apre la terza
  /// formula della nota; l'app dalla scena del banco.
  "formula-simboli": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La formula si tocca");
        await page.waitForSelector("#win .mx");
        await page.keyboard.press("End");
        await page.keyboard.type("+\\fr");
        await page.waitForSelector("#win .mx-ac:not([hidden]) button.act");
      },
    },
    app: { scena: "formula-04-simboli" },
  },
  /// La tavolozza (T62): la formula in riga aperta e «Tutti» aperto, col
  /// puntatore fuori. Il prototipo al passo «La formula si tocca»; l'app dalla
  /// scena del banco.
  "formula-tavolozza": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La formula si tocca");
        await page.waitForSelector("#win .mx");
        await page.click("#win .mx-all");
        await page.waitForSelector("#win .mx-full:not([hidden]) .mx-grid .mx-s");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "formula-06-tavolozza" },
  },
  /// La mini-barra sul testo scelto (T12): il prototipo la mostra al passo
  /// «La mini-barra sulla selezione», che sceglie due parole; l'app dalla
  /// scena del banco con la barra del foglio nascosta.
  "mini-barra": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La mini-barra sulla selezione");
        await page.waitForSelector("#win #minibar:not([hidden])");
      },
    },
    app: { scena: "mini-barra-selezione" },
  },
  /// Il LaTeX a vista (T63): il campo sotto la formula, coi tre puntini. Il
  /// prototipo al passo «Il LaTeX, per chi lo vuole», che apre una formula
  /// nuova col campo; l'app dalla scena del banco, con la preferenza accesa.
  "formula-latex": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il LaTeX, per chi lo vuole");
        await page.waitForSelector("#win .mx .mx-tex");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "formula-11-latex" },
  },
  /// I tre puntini aperti (T63): «Mostra il LaTeX» e gli aiuti.
  "formula-latex-opzioni": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il LaTeX, per chi lo vuole");
        await page.waitForSelector("#win .mx .mx-tex");
        await page.click("#win .mx .mx-more");
        await page.waitForSelector("#win .mx .mx-opts:not([hidden])");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "formula-12-latex-opzioni" },
  },
  /// Gli errori in chiaro (T64): un nome che non c'è nel campo del LaTeX,
  /// dopo la pausa la frase e «Usa \alpha». Il prototipo al passo «Il LaTeX,
  /// per chi lo vuole», col campo riempito com'è (senza la scrittura veloce);
  /// l'app dalla scena del banco.
  "formula-latex-errore": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il LaTeX, per chi lo vuole");
        await page.waitForSelector("#win .mx .mx-tex");
        await page.evaluate(() => {
          const field = document.querySelector("#win .mx .mx-tex");
          field.value = "v + \\alfa";
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.waitForSelector("#win .mx .mx-err:not([hidden]) button");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "formula-16-latex-errore" },
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
  /// Selezione e Stato nella testata (T9): le stesse righe, col registro dei
  /// tipi che fa dello stato una pastiglia.
  opzioni: {
    stati: TUTTI,
    prototipo: { prepara: (page) => passo(page, "A riposo") },
    app: { scena: "opzioni-01-righe" },
  },
  /// Il calendario della Base: il prototipo al passo «Bacheca e calendario»
  /// con la vista Calendario scelta, l'app dalla scena del calendario.
  calendario: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Bacheca e calendario");
        await page.click('#win .bview[data-bv="calendario"]');
        await page.waitForSelector("#win .cal .today");
      },
    },
    app: { scena: "base-calendario" },
  },
  /// La linea del tempo della Base: il prototipo allo stesso passo con la
  /// vista Linea del tempo scelta, l'app dalla scena della linea del tempo.
  tempo: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Bacheca e calendario");
        await page.click('#win .bview[data-bv="tempo"]');
        await page.waitForSelector("#win .tl .tl-b");
      },
    },
    app: { scena: "base-tempo" },
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
  /// Il «/» appena aperto su una riga vuota (T84): le sei tessere con la
  /// prima accesa, le righe a gruppi e il disegno in fondo. Il prototipo al
  /// passo «Il «/»» (lo scrive da sé sull'ultimo blocco), l'app dalla scena
  /// del banco.
  slash: {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il «/»");
        await page.waitForSelector("#win .pop.slash .sl-q.act");
      },
    },
    app: { scena: "slash-01-aperto" },
  },
  /// La Base incorporata nella nota (T18, E12, E19): il prototipo al passo
  /// «La Base si costruisce a vista», l'app dalla scena con
  /// `![[Opere.base#Tabella]]` nella nota della Live.
  "base-nota": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La Base si costruisce a vista");
        await page.waitForSelector('#win .blk[data-t="base"]');
      },
    },
    app: { scena: "base-nota" },
  },
  /// La trasclusione viva che si scrive (T29): il prototipo al passo «La
  /// trasclusione viva» (`editTx(true)`), l'app dalla scena del banco dopo
  /// «Modifica qui».
  "trasclusione-scrive": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "La trasclusione viva");
        await page.waitForSelector("#win .tx.editing");
      },
    },
    app: { scena: "trasclusione-viva-02-scrive" },
  },
  /// Il foglio nella nota da attivo (T43): il prototipo al passo «Il foglio
  /// nella nota» (`activateSheet(true)`, la cella C3 scelta), l'app dalla
  /// scena col foglio attivo e la barra di formato, che aspetta la cella nel
  /// gruppo «Foglio». A 700 px la cella del gruppo non c'è dai due lati
  /// (riga 784 del prototipo), e i suoi pezzi stanno solo nei larghi.
  "foglio-nella-nota": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Il foglio nella nota");
        await page.waitForSelector("#win .scard.active");
      },
    },
    app: { scena: "schede-vive-02-attiva" },
  },
  /// La scheda di documento a riposo (T44): il prototipo al passo «Ogni
  /// formato è una scheda» (la lettera in `.docx` accanto al PDF, che il passo
  /// attiva), l'app dalla scena del verbale a riposo.
  "scheda-documento": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Ogni formato è una scheda");
        await page.waitForSelector('#win .scard[data-kind="doc"] .docp p');
      },
    },
    app: { scena: "scheda-documento-01-riposo" },
  },
  /// Le schede affiancate (T42): nel prototipo la coppia `.pair` del
  /// documento d'apertura (il contratto e la lettera), nell'app il
  /// `[!columns]` col contratto e i conti della scena `schede-misura`.
  "schede-affiancate": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.waitForSelector("#win .pair .scard");
      },
    },
    app: { scena: "schede-misura-01-affiancate" },
  },
  // La scheda PDF (T45): quella della coppia del prototipo, a riposo; nel
  // banco il manuale del giro, dalla pagina 2.
  "scheda-pdf": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.waitForSelector('#win .pair .scard[data-kind="pdf"] .pdfn');
      },
    },
    app: { scena: "schede-pdf-01-riposo" },
  },
  // I valori di cella nel testo (T53): nel prototipo il paragrafo `p-conti`
  // del documento d'apertura («Finora abbiamo speso … su … previsti»), nel
  // banco lo stesso paragrafo sulla cartella del banco.
  "valori-cella": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.waitForSelector('#win [data-id="p-conti"] .cellv');
      },
    },
    app: { scena: "valori-cella-01-scrittura" },
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
  {
    // Il titolo di un gruppo («Recenti», «Note»): fermo in cima mentre
    // l'elenco scorre (T82).
    id: "lanciatore.gruppo",
    vista: "lanciatore",
    prototipo: ".k-g",
    app: ".launcher-group",
    proprieta: [...BASE, "position", "top"],
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
  // «Nuova nota di tipo» (T33).
  {
    id: "nuova-nota.testa",
    vista: "nuova-nota",
    prototipo: ".pop .m-h",
    app: ".note-type-popover .note-type-menu-head",
    proprieta: ["font", "color", "padding"],
  },
  {
    id: "nuova-nota.voce",
    vista: "nuova-nota",
    prototipo: ".pop .m-l > button.m-i:not(.act)",
    app: ".note-type-popover .note-type-menu-item:not([data-active])",
    proprieta: [...BASE, "min-height", ...ALLINEAMENTO],
  },
  {
    id: "nuova-nota.tassello",
    vista: "nuova-nota",
    prototipo: ".pop .m-l > button.m-i:not(.act) .ic.tile",
    app: ".note-type-popover .note-type-menu-item:not([data-active]) .note-type-menu-tile",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "nuova-nota.sotto",
    vista: "nuova-nota",
    prototipo: ".pop .m-l > button.m-i:not(.act) small",
    app: ".note-type-popover .note-type-menu-item:not([data-active]) .note-type-menu-sub",
    proprieta: ["font", "color"],
  },
  {
    id: "nuova-nota.piede",
    vista: "nuova-nota",
    prototipo: ".pop .m-foot",
    app: ".note-type-popover .note-type-menu-foot",
    proprieta: [...BASE],
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
    // La riga piccola sotto una voce (T30: «lo stesso blocco in più note»
    // sotto «Sincronizza in un'altra nota…»).
    id: "menu.voce-descrizione",
    vista: "menu-blocco",
    prototipo: ".m-i small",
    app: ".context-menu .menu-description",
    proprieta: ["font", "color", "margin", "white-space"],
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
  // ── le proposte dei simboli della formula (T61) ───────────────────────────
  {
    id: "formula.proposte",
    vista: "formula-simboli",
    prototipo: ".mx-ac",
    app: ".cm-fub-mx-popover .cm-fub-mx-symbols",
    // La larghezza è quella del riquadro (T60): il prototipo lo stringe a 380 px
    // col `max-width` di `.pop`, l'app lo tiene a 392 come il piano.
    proprieta: BASE,
  },
  {
    id: "formula.proposta-scelta",
    vista: "formula-simboli",
    prototipo: ".mx-ac button.act",
    app: '.cm-fub-mx-popover .cm-fub-mx-symbol[aria-selected="true"]',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "formula.proposta",
    vista: "formula-simboli",
    prototipo: ".mx-ac button:not(.act)",
    app: '.cm-fub-mx-popover .cm-fub-mx-symbol[aria-selected="false"]',
    proprieta: ["padding", "gap", "font", "color", "background", "height"],
  },
  {
    id: "formula.proposta-disegno",
    vista: "formula-simboli",
    prototipo: ".mx-ac button.act .g",
    app: '.cm-fub-mx-popover .cm-fub-mx-symbol[aria-selected="true"] .cm-fub-mx-symbol-glyph',
    proprieta: ["width", "font", "color", ...ALLINEAMENTO],
  },
  // ── la tavolozza della formula (T62) ──────────────────────────────────────
  {
    id: "formula.tavolozza",
    vista: "formula-tavolozza",
    prototipo: ".mx-pal",
    app: ".cm-fub-mx-popover .cm-fub-mx-palette",
    proprieta: ["border", "padding", "background"],
  },
  {
    id: "formula.pezzi",
    vista: "formula-tavolozza",
    prototipo: ".mx-quick",
    app: ".cm-fub-mx-popover .cm-fub-mx-quick",
    proprieta: ["padding", "gap", "height", ...ALLINEAMENTO],
  },
  {
    id: "formula.pezzo",
    vista: "formula-tavolozza",
    prototipo: ".mx-quick .mx-s",
    app: ".cm-fub-mx-popover .cm-fub-mx-quick .cm-fub-mx-tile",
    proprieta: [...DIMENSIONI, "border-radius", "font", "color", "background"],
  },
  {
    id: "formula.tutti",
    vista: "formula-tavolozza",
    prototipo: ".mx-all",
    app: ".cm-fub-mx-popover .cm-fub-mx-all",
    // Non il margine a sinistra: spinge «Tutti» in fondo alla fila, e la fila
    // è larga quanto il riquadro, 392 px nell'app e 380 nel prototipo (T60).
    proprieta: ["padding", "font", "color", "background", "border-radius", "height", "gap", ...ALLINEAMENTO],
  },
  {
    id: "formula.tutti-aperto",
    vista: "formula-tavolozza",
    prototipo: ".mx-full",
    app: ".cm-fub-mx-popover .cm-fub-mx-full",
    proprieta: ["padding"],
  },
  {
    id: "formula.cerca",
    vista: "formula-tavolozza",
    // La scatola del prototipo è l'etichetta; nell'app è il campo, che ha il
    // fuoco e il suo anello (la lente gli sta sopra).
    prototipo: ".mx-find",
    app: ".cm-fub-mx-popover .cm-fub-mx-find-input",
    proprieta: ["height", "border-radius", "background"],
  },
  {
    id: "formula.cerca-spazio",
    vista: "formula-tavolozza",
    prototipo: ".mx-find",
    app: ".cm-fub-mx-popover .cm-fub-mx-find",
    proprieta: ["margin-bottom"],
  },
  {
    id: "formula.gruppo-scelto",
    vista: "formula-tavolozza",
    prototipo: '.mx-tabs button[aria-selected="true"]',
    app: '.cm-fub-mx-popover .cm-fub-mx-group[aria-selected="true"]',
    proprieta: ["height", "border-radius", "font", "color", "background"],
  },
  {
    id: "formula.gruppo",
    vista: "formula-tavolozza",
    prototipo: '.mx-tabs button[aria-selected="false"]',
    app: '.cm-fub-mx-popover .cm-fub-mx-group[aria-selected="false"]',
    proprieta: ["height", "border-radius", "font", "color", "background"],
  },
  {
    id: "formula.griglia",
    vista: "formula-tavolozza",
    prototipo: ".mx-grid",
    app: ".cm-fub-mx-popover .cm-fub-mx-grid",
    // Le colonne sono dieci dai due lati; la loro misura segue la larghezza
    // del riquadro (392 px contro 380, T60), e non si confronta.
    proprieta: ["gap", "min-height"],
  },
  {
    id: "formula.simbolo",
    vista: "formula-tavolozza",
    prototipo: ".mx-grid .mx-s",
    app: ".cm-fub-mx-popover .cm-fub-mx-grid .cm-fub-mx-tile",
    proprieta: ["height", "border-radius", "font", "color", "background"],
  },
  {
    id: "formula.nome",
    vista: "formula-tavolozza",
    prototipo: ".mx-tip",
    app: ".cm-fub-mx-popover .cm-fub-mx-tip",
    proprieta: ["height", "padding", "font", "color"],
  },
  // ── il LaTeX a vista e i tre puntini (T63) ────────────────────────────────
  {
    id: "formula.latex-riga",
    vista: "formula-latex",
    prototipo: ".mx .mx-row",
    app: ".cm-fub-mx-popover .cm-fub-mx-row",
    proprieta: ["padding", "gap", ...ALLINEAMENTO],
  },
  {
    id: "formula.latex",
    vista: "formula-latex",
    prototipo: ".mx .mx-tex",
    app: ".cm-fub-mx-popover .cm-fub-mx-latex",
    proprieta: ["height", "padding", "font", "color", "border-radius", "box-shadow"],
  },
  {
    id: "formula.puntini",
    vista: "formula-latex",
    prototipo: ".mx .mx-row .mx-more",
    app: ".cm-fub-mx-popover .cm-fub-mx-row .cm-fub-mx-more",
    proprieta: [...DIMENSIONI, "border-radius", "color", "background"],
  },
  {
    id: "formula.opzioni",
    vista: "formula-latex-opzioni",
    prototipo: ".mx .mx-opts",
    app: ".cm-fub-mx-popover .cm-fub-mx-options",
    proprieta: ["padding", "gap"],
  },
  {
    id: "formula.opzione",
    vista: "formula-latex-opzioni",
    prototipo: ".mx .mx-opts > div",
    app: ".cm-fub-mx-popover .cm-fub-mx-option",
    proprieta: ["font", "color", "gap", ...ALLINEAMENTO],
  },
  {
    id: "formula.opzione-scelta",
    vista: "formula-latex-opzioni",
    prototipo: '.mx .mx-opts .seg2 button[aria-pressed="true"]',
    app: '.cm-fub-mx-popover .cm-fub-mx-segment[aria-pressed="true"]',
    proprieta: ["height", "padding", "border-radius", "font", "color", "background", "box-shadow"],
  },
  {
    id: "formula.opzione-altra",
    vista: "formula-latex-opzioni",
    prototipo: '.mx .mx-opts .seg2 button[aria-pressed="false"]',
    app: '.cm-fub-mx-popover .cm-fub-mx-segment[aria-pressed="false"]',
    proprieta: ["height", "padding", "border-radius", "font", "color", "background"],
  },
  // ── il posto della formula nei tre puntini (T65) ─────────────────────────
  {
    id: "formula.posto",
    vista: "formula-latex-opzioni",
    prototipo: ".mx .mx-opts > div:last-child",
    app: ".cm-fub-mx-popover .cm-fub-mx-option:last-child",
    proprieta: ["font", "color", "gap", ...ALLINEAMENTO],
  },
  {
    id: "formula.posto-scelto",
    vista: "formula-latex-opzioni",
    prototipo: '.mx .mx-opts [data-disp="0"]',
    app: '.cm-fub-mx-popover [data-place="inline"]',
    proprieta: ["height", "padding", "border-radius", "font", "color", "background", "box-shadow"],
  },
  // ── gli errori in chiaro (T64) ────────────────────────────────────────────
  {
    id: "formula.errore",
    vista: "formula-latex-errore",
    prototipo: ".mx .mx-err",
    app: ".cm-fub-mx-popover .cm-fub-mx-error",
    proprieta: ["margin", "padding", "gap", "border-radius", "background", "font", "color", ...ALLINEAMENTO],
  },
  {
    id: "formula.errore-codice",
    vista: "formula-latex-errore",
    prototipo: ".mx .mx-err code",
    app: ".cm-fub-mx-popover .cm-fub-mx-error code",
    proprieta: ["font", "background", "padding"],
  },
  {
    id: "formula.errore-correzione",
    vista: "formula-latex-errore",
    prototipo: ".mx .mx-err button",
    app: ".cm-fub-mx-popover .cm-fub-mx-error-fix",
    proprieta: ["height", "padding", "border-radius", "font", "color", "background"],
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
    id: "opzioni.stato",
    vista: "opzioni",
    contesto: "documento",
    prototipo: ".props .opt.st",
    app: '.cm-fub-page-prop[data-key="stato"] .cm-fub-prop-opt',
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
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
  // ── il calendario della Base (T17) ──────────────────────────────────────
  // Il prototipo mostra novembre 2026 (oggi il 9), l'app agosto 2026 (oggi il
  // 19): i giorni si scelgono per colonna, un martedì dai due lati, perché
  // l'ultima colonna non ha il filo a destra.
  {
    id: "calendario.griglia",
    vista: "calendario",
    prototipo: ".cal",
    app: ".base-cal-grid",
    proprieta: [...BASE, "display", "min-width"],
  },
  {
    id: "calendario.nome-giorno",
    vista: "calendario",
    prototipo: ".cal > .dow",
    app: ".base-cal-dow",
    proprieta: [...BASE, "letter-spacing", "text-transform"],
  },
  {
    id: "calendario.giorno",
    vista: "calendario",
    prototipo: '.cal > div[data-day="2026-11-03"]',
    app: '.base-cal-day[data-day="2026-08-04"]',
    proprieta: [...BASE, "min-height"],
  },
  {
    id: "calendario.fuori",
    vista: "calendario",
    prototipo: ".cal > .out",
    app: '.base-cal-day[data-out="true"]',
    proprieta: [...BASE, "min-height"],
  },
  {
    id: "calendario.numero",
    vista: "calendario",
    prototipo: '.cal > div[data-day="2026-11-03"] .d',
    app: '.base-cal-day[data-day="2026-08-04"] .base-cal-num',
    proprieta: [...BASE, "min-width", "height", "display"],
  },
  {
    id: "calendario.oggi",
    vista: "calendario",
    prototipo: ".cal > .today .d",
    app: '.base-cal-day[data-today="true"] .base-cal-num',
    proprieta: [...BASE, "min-width", "height"],
  },
  {
    id: "calendario.nota",
    vista: "calendario",
    prototipo: ".cal .ev.k-green",
    app: ".base-cal-event",
    proprieta: [...BASE, "display", "white-space", "text-overflow"],
  },

  // ── la linea del tempo della Base (T34) ─────────────────────────────────
  // Il prototipo mostra otto settimane da metà ottobre a dicembre in quattro
  // colonne, l'app otto settimane in otto: il fondo della traccia (le righe
  // delle colonne) non si confronta, i pezzi sì.
  {
    id: "tempo.griglia",
    vista: "tempo",
    prototipo: ".tl",
    app: ".base-tl",
    proprieta: [...BASE, "min-width"],
  },
  {
    id: "tempo.scala",
    vista: "tempo",
    prototipo: ".tl-a",
    app: ".base-tl-axis",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "tempo.oggi",
    vista: "tempo",
    prototipo: ".tl-s .now",
    app: ".base-tl-now",
    proprieta: [...BASE, "white-space"],
  },
  {
    id: "tempo.riga",
    vista: "tempo",
    prototipo: ".tl-r",
    app: ".base-tl-row",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "tempo.nome",
    vista: "tempo",
    prototipo: ".tl-r > span",
    app: ".base-tl-name",
    proprieta: [...BASE, "white-space", "text-overflow"],
  },
  {
    id: "tempo.barra",
    vista: "tempo",
    prototipo: ".tl-b.k-green",
    app: '.base-tl-bar:not([data-inverted="true"]):not([data-clip-start="true"]):not([data-clip-end="true"])',
    proprieta: [...BASE, "height", "top", "white-space"],
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

  // ── il «/» in una colonna (T84) ───────────────────────────────────────────
  {
    id: "slash.superficie",
    vista: "slash",
    prototipo: ".pop.slash",
    app: ".cm-tooltip.slash-panel",
    proprieta: [...BASE, "width"],
  },
  {
    id: "slash.tessere",
    vista: "slash",
    prototipo: ".sl-quick",
    app: ".slash-top",
    proprieta: [...BASE, "display", "grid-template-columns"],
  },
  {
    id: "slash.tessera-accesa",
    vista: "slash",
    prototipo: ".sl-q.act .ti",
    app: ".slash-tile[data-lit] .kit-tile-icon",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "slash.tessera",
    vista: "slash",
    prototipo: ".sl-q:not(.act) .ti",
    app: ".slash-tile:not([data-lit]) .kit-tile-icon",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "slash.elenco",
    vista: "slash",
    prototipo: ".sl-list",
    app: ".slash-list",
    proprieta: ["padding", "max-height"],
  },
  {
    id: "slash.gruppo",
    vista: "slash",
    prototipo: ".sl-g",
    app: ".slash-group-label",
    proprieta: [...BASE, "position", "top"],
  },
  {
    id: "slash.riga",
    vista: "slash",
    prototipo: ".sl-i:not(.act)",
    app: ".slash-row:not([data-lit])",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "slash.sintassi",
    vista: "slash",
    prototipo: ".sl-i .sy",
    app: ".slash-row .slash-syntax-note",
    proprieta: ["font-family", "font-size", "color", "white-space"],
  },
  {
    id: "slash.disegno",
    vista: "slash",
    prototipo: ".sl-det",
    app: ".slash-detail",
    proprieta: [...BASE, "display", "grid-template-columns", "min-height"],
  },
  {
    id: "slash.miniatura",
    vista: "slash",
    prototipo: ".sl-th",
    app: ".slash-thumb",
    proprieta: [...BASE, ...DIMENSIONI],
  },
  {
    id: "slash.descrizione",
    vista: "slash",
    prototipo: ".sl-tx .d",
    app: ".slash-description",
    proprieta: ["font", "color"],
  },
  {
    id: "slash.come-si-scrive",
    vista: "slash",
    prototipo: ".sl-tx .y",
    app: ".slash-syntax",
    proprieta: ["font", "color", "margin", "white-space", "text-overflow"],
  },
  // ── la Base nella nota (T18) ────────────────────────────────────────────
  // Oltre la colonna fino al margine a tutta larghezza, nella colonna a 700.
  {
    id: "base.incorporata",
    vista: "base-nota",
    prototipo: '.blk[data-t="base"]',
    app: '.pane.focus .base-surface[data-embedded="true"]',
    proprieta: ["margin-right"],
  },
  // ── le schede affiancate (T42) ──────────────────────────────────────────
  // Alla pari, 14 px fra l'una e l'altra, 64 px oltre il testo dai due lati
  // a tutta larghezza e nella colonna a 700.
  {
    id: "schede.affiancate",
    vista: "schede-affiancate",
    prototipo: ".pair",
    app: '.pane.focus .pane-editor .fub-columns[data-live-cards="true"]',
    proprieta: ["column-gap", "margin-left", "margin-right", "align-items"],
  },
  // ── la scheda PDF (T45) ───────────────────────────────────────────────────
  // Il vassoio con 16 px intorno alla pagina (sotto, la fascia di 40 px del
  // numero è una riga della griglia, non un padding), la pagina con le sue
  // ombre, il numero e le frecce di 24 px, velate a riposo.
  {
    id: "schede.pdf.vassoio",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] .pdfw',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf',
    proprieta: ["background-color", "padding-top", "padding-left", "padding-right"],
  },
  {
    id: "schede.pdf.pagina",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] .pdfp',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-page',
    proprieta: ["border-radius", "box-shadow", "filter"],
  },
  {
    id: "schede.pdf.numero",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] .pdfn > span',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-status',
    proprieta: ["font", "color", "font-variant-numeric"],
  },
  {
    id: "schede.pdf.freccia",
    vista: "scheda-pdf",
    contesto: "documento",
    prototipo: '.pair .scard[data-kind="pdf"] #pdf-prev',
    app: '.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-previous',
    proprieta: [...DIMENSIONI, "border-radius", "color", "opacity"],
  },
  // ── il valore di una cella nel testo (T53) ──────────────────────────────
  // Il tratteggio d'accento sotto, le cifre tabellari, mai a capo, il
  // puntatore della mano; al passaggio il velo d'accento con gli angoli di 3 px.
  {
    id: "valori-cella.valore",
    vista: "valori-cella",
    contesto: "documento",
    prototipo: '[data-id="p-conti"] .cellv',
    app: '.pane.focus .pane-editor .cm-fub-cell-value[data-cell-state="value"]',
    // Il carattere è quello del paragrafo; l'interlinea è del corpo del testo
    // (non di questo pezzo), e qui non si confronta.
    proprieta: ["border-bottom-width", "border-bottom-style", "border-bottom-color", "cursor", "font-variant-numeric", "white-space", "color", "font-family", "font-size", "font-weight", "background-color"],
  },
  {
    id: "valori-cella.passaggio",
    vista: "valori-cella",
    contesto: "documento",
    prototipo: '[data-id="p-conti"] .cellv',
    app: '.pane.focus .pane-editor .cm-fub-cell-value[data-cell-state="value"]',
    gesto: { tipo: "hover", prototipo: '[data-id="p-conti"] .cellv', app: '.pane.focus .pane-editor .cm-fub-cell-value[data-cell-state="value"]' },
    proprieta: ["background-color", "border-radius"],
  },
  // ── la mini-barra (T12) ───────────────────────────────────────────────────
  {
    id: "mini-barra.superficie",
    vista: "mini-barra",
    prototipo: "#minibar",
    app: ".selection-bubble .mini-bar",
    proprieta: [...BASE, "height", ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.grassetto",
    vista: "mini-barra",
    prototipo: '#minibar [data-mx="bold"]',
    app: '.selection-bubble .mini-bar [data-command="markdown.bold"]',
    proprieta: ["padding", "border-radius", "color", "background", ...DIMENSIONI, ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.trasforma",
    vista: "mini-barra",
    prototipo: '#minibar [data-mx="turn"]',
    app: '.selection-bubble .mini-bar [data-command="mini-bar.transform"]',
    proprieta: ["padding", "gap", "border-radius", "font", "color", "background", "height", ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.commenta",
    vista: "mini-barra",
    prototipo: '#minibar [data-mx="comment"]',
    app: '.selection-bubble .mini-bar [data-command="markdown.comment.add"]',
    proprieta: ["padding", "gap", "border-radius", "font", "color", "background", "height", ...ALLINEAMENTO],
  },
  {
    id: "mini-barra.filo",
    vista: "mini-barra",
    prototipo: "#minibar .sepv",
    app: ".selection-bubble .mini-bar .mini-bar-rule",
    proprieta: ["margin", "background", ...DIMENSIONI],
  },
  // ── la trasclusione viva (T29) ──────────────────────────────────────────
  {
    id: "trasclusione.vassoio",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: ".tx.editing",
    app: ".embed.transclusion-editing",
    proprieta: ["padding", "border-radius", "box-shadow", "background-color"],
  },
  {
    id: "trasclusione.testata",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: ".tx-h",
    app: ".transclusion-head",
    proprieta: ["height", "gap", "font", "color", ...ALLINEAMENTO],
  },
  {
    id: "trasclusione.modifica",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: "#tx-edit",
    app: ".transclusion-edit",
    proprieta: ["height", "padding", "gap", "border-radius", "font", "color", "opacity", ...ALLINEAMENTO],
  },
  {
    id: "trasclusione.fascia",
    vista: "trasclusione-scrive",
    contesto: "documento",
    prototipo: ".tx-band",
    app: ".transclusion-band",
    proprieta: ["padding", "margin", "gap", "border-radius", "background-color", "font", "color", ...ALLINEAMENTO],
  },
  // ── il foglio nella nota (T43) ──────────────────────────────────────────
  // La cella attiva e la sua formula nel gruppo «Foglio» della barra (`.fxr`).
  {
    id: "foglio-nella-nota.cella",
    vista: "foglio-nella-nota",
    stati: LARGHI,
    prototipo: "#fx-sheet",
    app: ".format-bar-context .format-bar-context-cell",
    proprieta: ["font", "color", "padding", "max-width", "white-space"],
  },
  // Le lettere delle colonne, che a scheda attiva compaiono piccole e senza fondo.
  {
    id: "foglio-nella-nota.lettere",
    vista: "foglio-nella-nota",
    contesto: "documento",
    prototipo: ".scard .gr-let",
    app: '.live-card[data-card-active="true"] .canvas-card-sheet .grid-column-header',
    proprieta: ["font-size", "font-weight", "color"],
  },
  // ── il promemoria (T36) ───────────────────────────────────────────────────
  // Il colore, il fondo, la forma e il peso della `.rem`. La misura (12 px,
  // alta 21) no: nella pagina la pastiglia segue il testo in `em`, come la
  // scadenza accanto (`.px-pg :is(.due, .pill-in)` del prototipo, riga 1090).
  {
    id: "promemoria.pastiglia",
    vista: "promemoria",
    contesto: "documento",
    prototipo: ".rem",
    app: ".cm-content .cm-fub-reminder:not(.cm-fub-reminder-done)",
    proprieta: ["color", "background", "box-shadow", "border-radius", "font-weight", "font-family", "white-space", ...ALLINEAMENTO],
  },
  {
    id: "promemoria.sveglia",
    vista: "promemoria",
    contesto: "documento",
    prototipo: ".rem svg",
    app: ".cm-content .cm-fub-reminder:not(.cm-fub-reminder-done) svg",
    proprieta: ["color"],
  },
  // ── la scheda di documento (T44) ──────────────────────────────────────────
  // Il margine del testo (`.docw`) e l'inchiostro e lo spazio dei paragrafi
  // (`.docp`). Il carattere no: il prototipo lo scrive con `var(--f-text)`,
  // un token che non dichiara, e la regola `font` intera cade (il testo
  // eredita quello della nota); l'app tiene la misura scritta, 14/1,6.
  {
    id: "scheda-documento.testo",
    vista: "scheda-documento",
    contesto: "documento",
    prototipo: '.scard[data-kind="doc"] .docw',
    app: '.live-card[data-card-kind="document"] .canvas-card-document-content',
    proprieta: ["padding"],
  },
  {
    id: "scheda-documento.paragrafo",
    vista: "scheda-documento",
    contesto: "documento",
    prototipo: '.scard[data-kind="doc"] .docp p:not(.r)',
    app: '.live-card[data-card-kind="document"] .canvas-card-document-content > p',
    proprieta: ["margin", "color"],
  },
];

/// I pezzi che hanno ancora differenze, e chi li corregge. Non si
/// confrontano finché non passano in `PEZZI`.
export const DA_COPRIRE = [
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
