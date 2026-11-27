// Le viste della mappa dell'editor: come si porta l'app e il prototipo allo stesso punto.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
import { LARGHI, TUTTI, chiudiPannello, passo } from "./comuni.mjs";

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
  /// Lo spazio «Esporta in PDF» (T70): il prototipo al passo «Esporta in
  /// PDF: le pagine vere» (le sezioni Tema e Colori aperte), l'app dalla
  /// scena dello spazio (le sezioni chiuse). Le teste si confrontano su una
  /// sezione chiusa dai due lati, la Pagina.
  "esporta-pdf": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector("#win .px:not([hidden]) .px-slot");
      },
    },
    app: { scena: "esporta-pdf" },
  },
  /// La sezione Diagrammi dello spazio (T75): dai due lati aperta, la riga
  /// dei nodi aperta col blu della tavolozza (`#1f4f8f`) scelto; lo stile
  /// resta «Come nella nota», il fondo acceso.
  "esporta-pdf-diagrammi": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector("#win .px:not([hidden]) .px-slot");
        await page.click('#win .px-sec[data-sec="diagrammi"] .px-sh');
        await page.click('#win .px-sec[data-sec="diagrammi"] [data-col="dgn"]');
        await page.click('#win [data-colset="dgn"][data-v="#1f4f8f"]');
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "esporta-pdf-diagrammi" },
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
  // «Estrai» (T49): nel prototipo sulla scheda PDF attiva del passo «Ogni
  // formato è una scheda», nell'app sul foglio attivo con delle celle scelte
  // (sul PDF è spento finché non c'è il motore dei PDF: il piano, T49).
  "estratti-estrai": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Ogni formato è una scheda");
        await page.waitForSelector('#win .scard[data-kind="pdf"].active #pdf-ex');
      },
    },
    app: { scena: "estratti-01-estrai" },
  },
  // L'estratto (T49): nel prototipo quello che «Estrai» mette sotto la scheda
  // PDF, nell'app il passo di PDF scritto come lo scrive Obsidian.
  "estratti-passo": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Ogni formato è una scheda");
        await page.waitForSelector('#win .scard[data-kind="pdf"].active #pdf-ex');
        await page.click("#win #pdf-ex");
        await page.waitForSelector("#win .exc footer button");
        await page.evaluate(() => document.querySelector("#win .exc")?.scrollIntoView({ block: "center" }));
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "estratti-03-passo" },
  },
  // La zona lavagna (T47): quella del prototipo a riposo, la lavagna intera
  // nella sua zona; nel banco il percorso della visita, a riposo.
  "scheda-lavagna": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await page.waitForSelector('#win .scard[data-kind="canvas"] .cvz .cvn');
      },
    },
    app: { scena: "scheda-lavagna-01-riposo" },
  },
  /// Le sezioni Tema e Colori aperte (T71): dai due lati la riga
  /// dell'accento aperta, coi tondi, il selettore e il codice. A 700 px il
  /// pannello sta sotto le pagine, e i pezzi si leggono dove sono.
  "esporta-pdf-temi": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector("#win .px:not([hidden]) .px-slot");
        await page.click('#win .px-cb[data-col="acc"]');
        await page.waitForSelector("#win .px-pal");
        await page.evaluate(() => {
          const side = document.querySelector("#px-side");
          if (side) side.scrollTop = 0;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "esporta-pdf-temi" },
  },
  /// Le sezioni Contenuto e Interruzioni aperte (T74): dai due lati i
  /// commenti nel margine, le tabelle a griglia e il codice numerato.
  "esporta-pdf-contenuto": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector("#win .px:not([hidden]) .px-slot");
        await page.click('#win .px-sec[data-sec="contenuto"] .px-sh');
        await page.click('#win .px-sec[data-sec="interruzioni"] .px-sh');
        await page.click('#win .px-seg button[data-k="comments"][data-v="margine"]');
        await page.click('#win .px-seg button[data-k="tab"][data-v="griglia"]');
        await page.click('#win .px-tog[data-k="codeNum"]');
        await page.waitForSelector('#win .px-tog[data-k="codeNum"][aria-checked="true"]');
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "esporta-pdf-contenuto" },
  },
  /// Le sezioni Caratteri e Pagina aperte (T72), con la filigrana «BOZZA»
  /// scritta dai due lati: le righe, i caratteri come pulsanti, i cursori, i
  /// segmenti, i millimetri, il campo della filigrana, le guide e la
  /// filigrana sulla prima pagina.
  "esporta-pdf-caratteri": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector("#win .px:not([hidden]) .px-slot");
        await page.click('#win .px-sec[data-sec="caratteri"] .px-sh');
        await page.click('#win .px-sec[data-sec="pagina"] .px-sh');
        await page.fill('#win .px-in[data-k="wm"]', "BOZZA");
        await page.waitForFunction(() => document.querySelector("#win .px-wm")?.textContent === "BOZZA");
        await chiudiPannello(page, "#px-side");
      },
    },
    app: {
      scena: "esporta-pdf-caratteri",
      prepara: async (page) => {
        await page.fill("#export-page-watermark", "BOZZA");
        await page.press("#export-page-watermark", "Tab");
        await page.waitForSelector(".export-slot .export-watermark");
        await chiudiPannello(page, ".export-side");
      },
    },
  },
  /// Testata e piè, frontespizio e indice (T73): il prototipo al passo
  /// «Tutto il cambiabile, dal vivo» (il profilo «Relazione per il Comune»:
  /// tema Relazione, frontespizio, indice, sezione e titolo in testata, data
  /// e pagine nel piè, le sezioni Frontespizio e Testata aperte), l'app dalla
  /// scena che porta lo spazio allo stesso profilo coi suoi controlli.
  "esporta-pdf-testata": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Tutto il cambiabile, dal vivo");
        await page.waitForSelector("#win .px:not([hidden]) .px-hfp");
        await page.waitForSelector("#win .px:not([hidden]) .ptoc-r b");
        await page.evaluate(() => {
          const side = document.querySelector("#px-side");
          if (side) side.scrollTop = 0;
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "esporta-pdf-testata" },
  },
  /// Il menu dei profili (T79): il prototipo apre il pulsante del profilo
  /// al passo «Esporta in PDF: le pagine vere»; l'app dalla scena coi
  /// profili del vault, il menu aperto.
  "esporta-pdf-profili": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector("#win .px:not([hidden]) .px-slot");
        await page.click("#win #px-prof");
        await page.waitForSelector("#win .pop .m-l > button.m-i");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "esporta-pdf-profili" },
  },
  /// Il clic sulla pagina (T76): dai due lati il primo paragrafo cliccato,
  /// scelto, col suo menu aperto.
  "esporta-pdf-blocco": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Esporta in PDF: le pagine vere");
        await page.waitForSelector('#win .px:not([hidden]) .px-it[data-t="p"]');
        await page.click('#win .px:not([hidden]) .px-it[data-t="p"]');
        await page.waitForSelector("#win .px-it.sel");
        await page.mouse.move(0, 0);
      },
    },
    app: { scena: "esporta-pdf-blocco" },
  },
  /// La cornice della nota a riposo (T82, T14): la barra del titolo con la
  /// pillola, il vault e i pulsanti a destra, e la banda in fondo col
  /// pallino del salvato e la modalità. Il prototipo al primo passo, l'app
  /// dalla scena della testata, che ha la stessa cornice a riposo.
  cornice: {
    stati: TUTTI,
    prototipo: { prepara: (page) => passo(page, "A riposo") },
    app: { scena: "testata-01-scrittura" },
  },
  /// La barra di formato col cursore in un elenco (T11): il prototipo al
  /// primo passo (la barra dice «Elenco puntato»), l'app dalla scena della
  /// barra col cursore nella prima voce dell'elenco.
  "barra-formato": {
    stati: TUTTI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.waitForSelector("#win #fbar .fb.lbl");
      },
    },
    app: { scena: "barra-formato" },
  },
  /// L'ispettore a destra (T19): le schede in alto e il titolo della scheda.
  /// Solo largo: a 700 px il prototipo lo chiude, e l'app pure.
  ispettore: {
    stati: LARGHI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "A riposo");
        await page.waitForSelector("#win #insp .itabs");
      },
    },
    app: { scena: "inspector" },
  },
  /// La Sorgente (T5): il file com'è, in carattere fisso. Il prototipo al
  /// passo «Sorgente: il file», l'app dalla scena della Sorgente. Solo
  /// largo: la scena apre la nota dall'albero, che a 700 px sta nel cassetto.
  sorgente: {
    stati: LARGHI,
    prototipo: {
      prepara: async (page) => {
        await passo(page, "Sorgente: il file");
        await page.waitForSelector("#win #src");
      },
    },
    app: { scena: "source" },
  },
};
