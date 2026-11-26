// La shell: i documenti di videoscrittura e le note.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  LINE_WORDS,
  chooseMode,
  expectVeilOnCard,
  expectWordPainted,
  openLive,
  openNote,
  openRichDocument,
  placeCursorOn,
  runScrittoioCommand,
  scrollLiveToEnd,
  scrollerAtRest,
  selectWords,
  selectionBox,
  settleBar,
  touchFormula,
  waitForCardPart,
  writingAtRest,
} from "./gesti-scrittura.mjs";
import { DOCUMENT_WINDOW, NOTE_NARROW, SYNCED_BLOCK, TRANSCLUSION_HEAD } from "./misure.mjs";

export const S_SCRITTURA = [
  // **I documenti di videoscrittura**: un `.docx` e un `.odt` aperti dalla
  // proiezione vera del codec (`?rich=…`, vedi `fake-ipc.ts`), largo e nella
  // finestra di un documento appena aperto.
  ...[
    ["document-docx", "docx", "Prova.docx", "Un .docx con un po' di tutto: titoli, elenco, tabella, revisioni, un commento"],
    ["document-docx-narrow", "docx", "Prova.docx", "Lo stesso .docx in una finestra di 900 px"],
    ["document-odt", "odt", "Verbale.odt", "Un .odt: il verbale di una riunione"],
    ["document-objects", "objects", "Oggetti.docx", "Gli oggetti che la superficie tiene com'erano: immagine, forma, casella, formula, note, salti"],
    ["document-readonly", "readonly", "Riservato.docx", "Un .docx protetto, aperto in sola lettura"],
    ["document-closed", "closed", "Chiuso.docx", "Un .docx con un paragrafo e una tabella chiusi, che restano come sono nel file"],
  ].map(([id, rich, name, title]) => ({
    id,
    title,
    query: `rich=${rich}`,
    ...(id.endsWith("-narrow") ? { viewport: DOCUMENT_WINDOW } : {}),
    prepare: (page) => openRichDocument(page, `Documenti/${name}`),
  })),
  {
    id: "nota-tre-modi",
    title: "La stessa nota in Sorgente, Live e Lettura: tre fogli affiancati",
    prepare: async (page) => {
      // La modalità del riquadro a fuoco si sceglie dalla banda.
      await openNote(page, "Guida/Sintassi di Fub.md");
      await chooseMode(page, "source");
      await runScrittoioCommand(page, "Dividi il riquadro a destra");
      await chooseMode(page, "live_preview");
      await runScrittoioCommand(page, "Dividi il riquadro a destra");
      await chooseMode(page, "reading");
      await page.waitForSelector('.pane[data-mode="source"] .pane-editor .cm-content');
      await page.waitForSelector('.pane[data-mode="live_preview"] .pane-editor .cm-content');
      await page.waitForSelector('.pane[data-mode="reading"] .pane-preview');
    },
  },
  // **Scrittoio 2** (il prototipo `PLAN-ui/scrittoio-2.html` resta nella storia
  // del ramo `piano/scrittoio-2`, fino a 480a538d9): gli stati del prototipo che
  // prima non avevano una foto. La nota è quella che il banco apre per prima;
  // la finestra «stretta» è la minima della finestra vera (800 px, come
  // `minWidth` di Tauri), lo stato a 700 px più vicino che il computer mostri.
  {
    id: "banda-modalita",
    title: "La nota col menu delle modalità aperto dalla banda",
    prepare: async (page) => {
      await page.waitForSelector(".pane.focus .pane-editor .cm-content");
      await page.click("#status-mode");
      await page.waitForSelector('#context-menu [role="menuitemradio"][aria-checked="true"]');
      await page.waitForSelector('#status-mode[aria-expanded="true"]');
    },
  },
  {
    id: "nota-stretta",
    title: "La nota nella finestra minima, 800 px: i cassetti ritirati, la banda intera",
    viewport: NOTE_NARROW,
    prepare: async (page) => {
      await page.waitForSelector("#layout.layout-compact");
      await page.waitForSelector(".pane.focus .pane-editor .cm-content");
    },
  },
  ...[
    ["barra-formato", "La nota con la barra di formato, sul computer"],
    ["barra-formato-stretta", "La barra di formato nella finestra minima, 800 px: ciò che non ci sta va in «…»", NOTE_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    // `?formatbar=1` dà alla finestra principale i comandi di formato che
    // l'host finto dà solo al telefono: senza, le scene di oggi restano com'erano.
    query: "formatbar=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // Il cursore nella prima voce dell'elenco, come il prototipo: la barra
      // dice premuto «Elenco puntato». La barra si monta coi comandi, che
      // arrivano dopo la nota: la scena aspetta i suoi pulsanti e lo stato.
      await page.click('.pane.focus .pane-editor .cm-content .cm-line:has-text("Un elenco corto")');
      await page.keyboard.press("End");
      await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
      await page.waitForSelector('.pane.focus .format-bar .kit-bar-button[aria-pressed="true"]');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  // **La barra che segue il blocco** (T11, E8 del prototipo dell'editor): la
  // barra compatta col gruppo del blocco del cursore, sulla nota della
  // sintassi; a 700 px ciò che non entra scende in «…»; poi i due menu della
  // barra, «Trasforma in» e «+ Inserisci». Il telefono è `mobile-keyboard`.
  ...[
    ["barra-blocco-compito", "La barra che segue il blocco: il cursore in un compito, «Compito · Scadenza»", "Da fare", "task"],
    ["barra-blocco-codice", "La barra che segue il blocco: il cursore nel codice, il linguaggio e «Copia»", "let (x, y)", "code"],
    ["barra-blocco-stretta", "La barra che segue il blocco nella finestra minima (800 px), nel codice: la fila compatta entra intera", "let (x, y)", "code", { width: 800, height: 800 }],
  ].map(([id, title, line, block, viewport]) => ({
    id,
    title,
    query: "formatbar=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // La nota si apre dall'albero, che a 700 px sta nel cassetto chiuso: si
      // apre a finestra larga, poi la finestra torna quella della scena.
      await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Guida/Sintassi di Fub.md");
      if (viewport) await page.setViewportSize(viewport);
      // Il codice sta in fondo alla nota, fuori dalle righe che CodeMirror
      // disegna: prima il cursore in fondo, poi la riga.
      if (block === "code") {
        await page.click(".pane.focus .pane-editor .cm-content");
        await page.keyboard.press("Control+End");
        // In fondo e fermo prima del clic: la riga del codice è già in vista,
        // e il clic non scorre.
        await scrollerAtRest(page, { toEnd: true });
      }
      await placeCursorOn(page, line);
      await scrollerAtRest(page);
      // Il gruppo arriva dopo la pausa della barra (un tempo vero: l'orologio
      // fermo del banco ferma la data, non i timer).
      await page.waitForSelector(`.pane.focus .format-bar-context[data-block="${block}"]`, { state: "attached" });
      await settleBar(page);
    },
  })),
  {
    id: "barra-blocco-trasforma",
    title: "La barra che segue il blocco: lo stile del blocco apre «Trasforma in»",
    // `slash=1`: i comandi di «Testo» e «Titolo 3» li dà il «/» dell'host finto.
    query: "formatbar=1&slash=1",
    prepare: async (page) => {
      await placeCursorOn(page, "Un elenco corto");
      await page.waitForSelector(".pane.focus .format-bar-style:not(:disabled)");
      await page.click(".pane.focus .format-bar-style");
      await page.waitForSelector('#context-menu [role="menuitemradio"][aria-checked="true"]');
      await page.mouse.move(0, 0);
    },
  },
  {
    id: "barra-blocco-inserisci",
    title: "La barra che segue il blocco: «+ Inserisci», gli stessi blocchi del «/» coi nomi",
    // `slash=1` dà all'host finto i comandi del «/»: «+ Inserisci» offre quelli.
    query: "formatbar=1&slash=1",
    prepare: async (page) => {
      await placeCursorOn(page, "Un elenco corto");
      await page.waitForSelector(".pane.focus .format-bar-insert:not(:disabled)");
      await page.click(".pane.focus .format-bar-insert");
      await page.waitForSelector("#context-menu .menu-field-input");
      await page.mouse.move(0, 0);
    },
  },
  // **La mini-barra** (T12, E8 del prototipo dell'editor): sul testo scelto
  // a barra del foglio nascosta, nella finestra larga e nella minima; poi il
  // pannello «Colore»; infine in testa al menu del tasto destro (E29), con la
  // barra compatta.
  ...[
    ["mini-barra-selezione", "La mini-barra sul testo scelto, a barra del foglio nascosta", null, false],
    ["mini-barra-stretta", "La mini-barra sul testo scelto nella finestra minima (800 px)", { width: 800, height: 800 }, false],
    ["mini-barra-colore", "La mini-barra: «Colore» apre le due righe dei nove colori, testo e sfondo", null, true],
  ].map(([id, title, viewport, colors]) => ({
    id,
    title,
    // `toolbar=nascosta`: la barra del foglio spenta, la mini-barra sul testo.
    query: "formatbar=1&slash=1&toolbar=nascosta",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await selectWords(page, "Questa è la nota");
      await page.waitForSelector(".selection-bubble:not([hidden]) .mini-bar [data-command='markdown.bold']");
      if (colors) {
        // La bolla ferma prima del clic (#511): con un suo menu aperto la bolla
        // non si riposa più (`selection-bubble.ts`, `holding`), e un clic che
        // arrivava mentre un riposizionamento era ancora in coda la lasciava,
        // col pannello dei colori, 2 px più in là in una corsa su tante.
        await settleBar(page);
        await page.click(".selection-bubble .mini-bar [data-command='mini-bar.color']");
        await page.waitForSelector(".mini-bar-colors .mini-bar-swatch");
      }
      await settleBar(page);
    },
  })),
  {
    id: "mini-barra-menu",
    title: "La mini-barra in testa al menu del tasto destro, sul testo scelto",
    query: "formatbar=1&slash=1",
    prepare: async (page) => {
      await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
      await selectWords(page, "Questa è la nota");
      // Il clic al centro del testo scelto: dello strato già ridisegnato, non
      // di quello del tasto di prima (il menu cadeva 2 px più in qua o più in
      // là secondo chi arrivava primo, #488).
      const box = await selectionBox(page);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await page.waitForSelector(".context-strip.context-strip-mini .mini-bar [data-command='markdown.bold']");
      await page.mouse.move(0, 0);
    },
  },
  ...[
    ["icone-figure", "Il selettore dell'icona su una cartella: le figure del vault", ""],
    ["icone-emoji", "Il selettore dell'icona su una cartella, col vault delle emoji", "icone=emoji"],
  ].map(([id, title, query]) => ({
    id,
    title,
    query,
    prepare: async (page) => {
      // Dalla strada vera: il tasto destro sulla cartella, poi «Organizza» e
      // «Icona…», con un clic ciascuno (il passaggio del puntatore apre il
      // sottomenu dopo una pausa, e l'orologio del banco è fermo). Il
      // selettore nasce dove si è cliccato col tasto destro, come nel prototipo.
      await page.click('#file-list li[data-path="Guida"] > .tree-row', { button: "right", position: { x: 40, y: 18 } });
      await page.click('#context-menu [role="menuitem"]:has-text("Organizza")');
      await page.click('.context-submenu [role="menuitem"]:has-text("Icona…")');
      await page.waitForSelector('#icon-picker .icon-grid--figures [data-icon^="fub:"]');
      await page.waitForSelector("#context-menu", { state: "detached" });
      await page.waitForSelector("#icon-picker input:focus");
    },
  })),
  // **La Live** (`?live=<caso>`, vedi `live-fixture.ts`): le scene del piano
  // «Live e Blocchi», ognuna con il suo testo, il cursore nel punto che il caso
  // dice e, dove serve, i tasti che scrive. È il «prima» con cui ogni fase si
  // confronta. Il numero è quello delle foto del piano; la 18 non c'è.
  ...[
    ["live-01-panoramica", "panoramica", "La Live dall'alto, senza cursore: ogni costrutto della nota"],
    ["live-02-riga-attiva", "riga-attiva", "La Live col cursore nel paragrafo degli stili"],
    ["live-03-titolo-attivo", "titolo-attivo", "La Live col cursore su un titolo di livello 2"],
    ["live-04-codice-attivo", "codice-attivo", "La Live col cursore in un blocco di codice"],
    ["live-05-callout-attivo", "callout-attivo", "La Live col cursore nel corpo di un callout"],
    ["live-06-elenco-attivo", "elenco-attivo", "La Live col cursore su una voce numerata"],
    ["live-07-html-attivo", "html-attivo", "La Live col cursore sulla riga della formula e dell'HTML"],
    ["live-08-apice-digitando", "apice-digitando", "La Live mentre si scrive un apice non ancora chiuso", ["^2"]],
    ["live-09-pedice-digitando", "pedice-digitando", "La Live mentre si scrive un pedice non ancora chiuso", ["~2"]],
    ["live-10-apice-chiuso", "apice-chiuso", "La Live con un apice appena chiuso e il cursore dopo", ["^2^", " e poi"]],
    ["live-11-grassetto-digitando", "grassetto-digitando", "La Live mentre si scrive un grassetto non ancora chiuso", ["**importante"]],
    ["live-12-stretta", "panoramica", "La Live dall'alto nella finestra minima, 800 px", [], { width: 800, height: 800 }],
    ["live-13-panoramica-fondo", "panoramica-fondo", "La Live in fondo alla nota: formula, HTML e definizione della nota"],
    ["live-14-tabella-attiva", "tabella-attiva", "La Live col cursore in una cella della tabella"],
    ["live-15-callout-titolo", "callout-titolo", "La Live col cursore sul titolo di un callout"],
    ["live-16-elenco-a-capo", "elenco-a-capo", "La Live con voci lunghe che vanno a capo, a 900 px", [], { width: 900, height: 800 }],
    ["live-17-recinto-digitando", "recinto-digitando", "La Live mentre si apre un recinto di codice", ["```js", "@Enter", "const a = 1;"]],
    ["live-19-link-in-modifica", "link-in-modifica", "La Live col cursore sulla riga di un link lungo"],
    ["live-20-wikilink-alias", "wikilink-alias", "La Live col cursore sulla riga di un wikilink con alias"],
    ["live-21-riga-vuota", "riga-vuota", "La Live su una nota nuova, col cursore sulla riga vuota"],
    ["live-22-immagine-selezionata", "immagine-selezionata", "La Live con un'immagine da sola nel paragrafo, selezionata: contorno, maniglia e didascalia"],
    ["live-23-colori", "colori", "La Live coi nove colori del testo e del fondo"],
    ["live-24-ripiegabile", "ripiegabile", "La Live con un ripiegabile chiuso e uno aperto con un altro dentro"],
    ["live-25-colonne", "colonne", "La Live con due e tre colonne, a 900 px", [], { width: 900, height: 800 }],
    ["live-27-indice", "indice", "La Live con l'indice dei titoli in cima alla nota"],
    ["live-28-promemoria", "promemoria", "La Live coi promemoria: le pastiglie blu con l'ora, il giorno se non è oggi, grigia col compito fatto"],
    ["live-29-promemoria-stretta", "promemoria", "I promemoria nella finestra minima, 800 px", [], { width: 800, height: 800 }],
    ["live-26-colonne-stretta", "colonne", "La Live con le colonne nella finestra minima, 800 px", [], { width: 800, height: 800 }],
  ].map(([id, live, title, keys = [], viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openLive(page, keys, live === "panoramica-fondo" ? "bottom" : "top"),
  })),
  // **Il doppio clic con la barra di formato** (#411 A-05, #399): una parola
  // scelta col doppio clic si dipinge come la parola, non fino a fine riga.
  // A 1100 px, con la barra, la prima riga della panoramica va a capo dopo
  // apici, pedici e marche nascoste: con CodeMirror fino alla 6.43.7 la
  // selezione di «il», «bus» e «treno» si dipingeva come il resto della riga
  // più la riga sotto (col caso seminato del banco, ogni volta). La scena
  // sceglie due volte ogni parola della riga (non i link, che il clic segue)
  // e lancia se un disegno non è la parola: col caso seminato quale parola
  // cadeva cambiava con la luce, e con tutte almeno una cadeva sempre. La
  // foto resta su «treno», la parola del collaudo.
  {
    id: "live-30-doppio-clic-barra",
    title: "La Live con la barra di formato: «treno» scelto col doppio clic si dipinge come la parola",
    query: "live=panoramica&formatbar=1",
    viewport: { width: 1100, height: 800 },
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(".pane.focus .format-bar.kit-bar .kit-bar-button");
      for (let round = 0; round < 2; round++) {
        for (const word of LINE_WORDS) await expectWordPainted(page, word);
      }
      await settleBar(page);
    },
  },
  // La scelta del promemoria (T36): il clic sulla pastiglia la apre sotto di
  // lei, coi giorni vicini, il mese col giorno scelto e l'ora; il piede
  // toglie il promemoria. Ciò che non è un giorno resta scritto e lo dice.
  ...[
    ["promemoria-01-scelta", "La scelta del promemoria aperta dalla pastiglia: le parole, i giorni vicini, il mese e l'ora", null],
    ["promemoria-02-parole", "Le parole nella scelta del promemoria: «Non capisco» per ciò che non è un giorno", "quando capita"],
  ].map(([id, title, words]) => ({
    id,
    title,
    query: "live=promemoria",
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.locator(".cm-content .cm-fub-reminder").nth(1).click();
      await page.waitForSelector(".cm-fub-reminder-picker");
      if (words !== null) {
        const field = page.locator(".cm-fub-reminder-picker input").first();
        await field.fill(words);
        await field.press("Enter");
        await page.waitForSelector(".cm-fub-reminder-picker .cm-fub-prop-note:not([hidden])");
      }
      await page.mouse.move(0, 0);
    },
  })),
  // La formula che si modifica toccandola (T60, E27): → davanti alla formula
  // in riga apre sotto di lei il riquadro con la formula grande, il cursore
  // nel numeratore; il blocco `$$` si apre col clic, sul posto, e la scena
  // prova i clic su numeratore, denominatore, esponente e radice (il posto
  // detto al lettore di schermo), se no è rossa; la formula con un errore si
  // apre col suo LaTeX (il telefono sta fra le scene di `mobile.html`).
  ...[
    ["formula-01-riga", "formula-toccata", "La formula in riga toccata: il riquadro sotto, la formula grande col cursore nel numeratore", "inline"],
    ["formula-02-blocco", "formula-toccata", "Il blocco $$ toccato: la formula sul posto col bordo d'accento, il cursore dove cade il clic", "block"],
    ["formula-03-errore", "formula-errore", "Una formula con un errore si apre col suo LaTeX e sotto che cosa non va, con la correzione", "error"],
    // Le proposte dei simboli (T61): `\fr` in fondo alla formula in riga
    // propone le frazioni e le frecce, disegnate e col nome; `\s` nel
    // blocco le radici, la somma e il sigma.
    ["formula-04-simboli", "formula-toccata", "La barra rovesciata e le prime lettere: le proposte dei simboli, disegnati e col nome, sotto la formula", "symbols"],
    ["formula-05-simboli-blocco", "formula-toccata", "Le proposte dei simboli sotto il blocco $$ toccato", "symbols-block"],
    // La tavolozza (T62): «Tutti» aperto sui sette gruppi; la ricerca a
    // parole, con e senza risultati; il blocco; la fila dei pezzi da
    // tastiera, col nome in fondo.
    ["formula-06-tavolozza", "formula-toccata", "La tavolozza sotto la formula: gli otto pezzi, «Tutti» aperto sui sette gruppi e la griglia della struttura", "palette"],
    ["formula-07-ricerca", "formula-toccata", "La ricerca a parole nella tavolozza: «freccia» dà le frecce, poi il vettore", "search"],
    ["formula-08-ricerca-vuota", "formula-toccata", "Una ricerca senza risultati: la frase che dice come cercare", "search-empty"],
    ["formula-09-tavolozza-blocco", "formula-toccata", "La tavolozza sotto il blocco $$ toccato, in una scheda, con «Tutti» aperto", "palette-block"],
    ["formula-10-tavolozza-tastiera", "formula-toccata", "Alt ↓ porta alla fila dei pezzi: il pezzo col fuoco e il suo nome in fondo", "palette-keys"],
    // «Mostra il LaTeX» e gli aiuti (T63): il campo sotto la formula, con la
    // scrittura veloce (`a/` è già una frazione, il cursore nel
    // denominatore); i tre puntini aperti; i discreti col pulsante della
    // tavolozza; gli spenti, soltanto il LaTeX e l'anteprima; il blocco.
    ["formula-11-latex", "formula-toccata&mathsource=1", "Mostra il LaTeX: sotto la formula il campo, e «a/» è già una frazione col cursore nel denominatore", "source"],
    ["formula-12-latex-opzioni", "formula-toccata&mathsource=1", "I tre puntini aperti: Mostra il LaTeX e gli aiuti, Pieni scelti", "source-options"],
    ["formula-13-latex-discreti", "formula-toccata&mathsource=1&mathhelp=discrete", "Gli aiuti discreti: il completamento resta, la tavolozza a richiesta col pulsante «Simboli»", "source-discrete"],
    ["formula-14-latex-spenti", "formula-toccata&mathsource=1&mathhelp=spente", "Gli aiuti spenti: soltanto il LaTeX e la sua anteprima", "source-off"],
    ["formula-15-latex-blocco", "formula-toccata&mathsource=1", "Il blocco $$ con Mostra il LaTeX: la formula sopra, il campo e la tavolozza sotto", "source-block"],
    // Gli errori in chiaro (T64): dopo la pausa, sotto il campo, la frase
    // con la correzione quando è una sola; con più correzioni nessun
    // pulsante. Il TeX non cambia da solo.
    ["formula-16-latex-errore", "formula-toccata&mathsource=1", "Un nome che non c'è: «Non conosco \\alfa. Forse volevi \\alpha?» e «Usa \\alpha»", "source-unknown"],
    ["formula-17-latex-graffa", "formula-toccata&mathsource=1&mathhelp=spente", "Una graffa aperta con gli aiuti spenti: «Manca una } di chiusura» e «Chiudi»", "source-brace"],
    ["formula-18-latex-piu-correzioni", "formula-toccata&mathsource=1&mathhelp=spente", "Un nome con più simboli vicini: la frase li elenca, senza pulsante", "source-guesses"],
    // Il tasto destro e Invio a blocco (T65): il menu della formula, con le
    // copie e il posto; Invio nel blocco va a capo e allinea gli uguali.
    ["formula-19-menu", "formula-toccata", "Il tasto destro su una formula: Modifica, «Copia come» in riga e «Da riga a blocco»", "menu"],
    ["formula-20-allinea", "formula-toccata", "Invio in un blocco $$: un aligned con gli uguali allineati e la riga nuova", "align"],
    // Scegliere un pezzo e le matrici (T66): Maiusc ← sceglie pezzi interi,
    // colorati; in una matrice Tab va alla cella dopo, Invio alla riga dopo.
    ["formula-21-scelta", "formula-toccata", "Maiusc ← nel blocco $$: la radice, il + e x² scelti come pezzi interi", "choose"],
    ["formula-22-matrice", "formula-toccata", "Una matrice dalla tavolozza: Tab e Invio fra le celle, e dall'ultima riga una riga nuova", "matrix"],
  ].map(([id, live, title, gesture]) => ({
    id,
    title,
    query: `live=${live}`,
    prepare: (page) => touchFormula(page, gesture),
  })),
  // Scrittura a riposo (T3, E1, passo 1 del prototipo): la pagina mostra solo
  // ciò che si legge. Prima della foto la scena prova i livelli di presenza:
  // al passaggio maniglie e strumenti della testata compaiono senza spostare
  // il testo; a foglio fermo nessun elemento `data-presence` e nessun pulsante
  // che non sia contenuto si vede. Se no, la scena è rossa.
  {
    id: "scrittura-a-riposo",
    title: "Scrittura a riposo: testata, proprietà e testo, senza maniglie né pulsanti sul foglio",
    query: "live=pagina",
    prepare: (page) => writingAtRest(page),
  },
  // La trasclusione viva (T29, il prototipo `.tx`): al passaggio la testata
  // con «Modifica qui» e «Apri»; «Modifica qui» apre l'editor del tratto col
  // bordo d'accento e la fascia di chi scrive; lo stesso nella finestra stretta.
  ...[
    ["trasclusione-viva-01-passaggio", "La trasclusione viva al passaggio: la provenienza, «Modifica qui» e «Apri»", false],
    ["trasclusione-viva-02-scrive", "«Modifica qui»: l'editor del tratto, il bordo d'accento e «Scrivi in …: si salva là»", true],
    ["trasclusione-viva-03-stretta", "La trasclusione che si scrive nella finestra stretta, 800 px", true, NOTE_NARROW],
  ].map(([id, title, writing, viewport]) => ({
    id,
    title,
    query: "live=trasclusione",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(`${TRANSCLUSION_HEAD} .transclusion-edit`);
      if (!writing) return;
      await page.click(`${TRANSCLUSION_HEAD} .transclusion-edit`);
      // Il cursore va in fondo al tratto, sull'ultima voce: il titolo resta reso.
      await page.waitForSelector(".pane.focus .pane-editor .transclusion-editing .transclusion-editor .cm-content:focus");
    },
    // Il passaggio è l'ultimo gesto, dopo che il palco ha portato via il
    // puntatore.
    ...(writing ? {} : { hover: (page) => page.hover(TRANSCLUSION_HEAD) }),
  })),
  // Il blocco sincronizzato (T30): un blocco della nota col filo discreto a
  // sinistra; al passaggio la targhetta «Sincronizzato con …»; un clic lo
  // scrive dove sta. Sotto, un blocco d'origine cancellato: «Blocco non
  // trovato».
  ...[
    ["blocco-sincronizzato-01-passaggio", "Il blocco sincronizzato al passaggio: «Sincronizzato con …» e «Apri»; sotto, «Blocco non trovato»", false],
    ["blocco-sincronizzato-02-scrive", "Un clic sul blocco sincronizzato: si scrive dove sta, senza fascia", true],
    ["blocco-sincronizzato-03-stretta", "Il blocco sincronizzato al passaggio nella finestra stretta, 800 px", false, NOTE_NARROW],
  ].map(([id, title, writing, viewport]) => ({
    id,
    title,
    query: "live=sincronizzato",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(`${SYNCED_BLOCK} .transclusion-body p`);
      await page.waitForSelector(".pane.focus .pane-editor .embed-missing");
      if (!writing) return;
      await page.click(`${SYNCED_BLOCK} .transclusion-body p`);
      await page.waitForSelector(`${SYNCED_BLOCK}.transclusion-editing .transclusion-editor .cm-content:focus`);
    },
    ...(writing ? {} : {
      hover: async (page) => {
        await page.hover(`${SYNCED_BLOCK} .transclusion-body`);
        await page.waitForFunction((selector) => getComputedStyle(document.querySelector(selector)).opacity === "1", `${SYNCED_BLOCK} > .transclusion-head`);
      },
    }),
  })),
  // Le schede vive nella nota (T41, il prototipo `.scard`, passi 16–18): il
  // PDF e il foglio a riposo, col nome del file in testata; il foglio attivo,
  // col bordo d'accento e «Esc per uscire»; in fondo un file mancante e un
  // formato che la nota non sa mostrare; la stessa nota nella finestra minima.
  ...[
    ["schede-vive-01-riposo", "Le schede vive a riposo: il contratto in PDF e il foglio dei conti, col nome del file in testata", "top", null],
    ["schede-vive-02-attiva", "Il foglio attivo: bordo d'accento, «Esc per uscire», «Apri» e «A tutta pagina»; le lettere e i numeri, e la cella attiva nel gruppo «Foglio» della barra", "top", "sheet", null, "&formatbar=1"],
    ["schede-vive-03-mancante", "Un file mancante («Ritrova…», «Togli dalla nota») e un formato che la nota non mostra («Apri»)", "bottom", null],
    ["schede-vive-04-stretta", "Le schede vive nella finestra minima, 800 px", "top", null, NOTE_NARROW],
    ["schede-vive-05-parte-persa", "Il foglio di cui l'intervallo non c'è più: «Intervallo non trovato: Budget!A1:E7» e «Scegli di nuovo» (T43)", "lost", null],
    ["schede-vive-06-scelta", "Il foglio scelto coi Blocchi (un clic sulla testata): il filo della selezione lo circonda (T56)", "top", null, null, null, "sheet"],
  ].map(([id, title, scroll, activate, viewport, extra, choose]) => ({
    id,
    title,
    query: `live=schede-vive&pdf-scena=domanda&workbook=1${extra ?? ""}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], scroll === "bottom" ? "bottom" : "top");
      await page.waitForFunction(() => {
        const cards = [...document.querySelectorAll(".pane.focus .pane-editor .live-card")];
        return cards.length > 0 && cards.every((card) => card.dataset.cardState !== "loading");
      });
      // I fogli hanno letto la loro parte e preso l'altezza delle righe vere.
      await page.waitForFunction(() => [...document.querySelectorAll('.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-sheet')]
        .every((sheet) => sheet.dataset.cardState === "content" || sheet.dataset.cardState === "lost"));
      if (scroll === "bottom") {
        // In fondo con ogni blocco disegnato e misurato (#510): le ultime
        // schede ci sono di sicuro, anche se lo scorrimento di `openLive` era
        // arrivato prima che quelle in alto prendessero la loro altezza.
        await scrollLiveToEnd(page);
        await page.waitForSelector('.pane.focus .pane-editor .live-card[data-card-state="missing"]');
        const last = '.pane.focus .pane-editor .live-card[data-card-state="unsupported"]';
        await page.waitForSelector(last);
        await page.waitForFunction((selector) => {
          const card = document.querySelector(selector)?.getBoundingClientRect();
          return card !== undefined && card.bottom <= window.innerHeight;
        }, last);
      }
      if (scroll === "lost") {
        // La parte persa sta sotto il foglio: la si porta in alto nella vista.
        const lost = '.pane.focus .pane-editor .live-card .canvas-card-lost';
        await page.waitForSelector(lost);
        await page.evaluate((selector) => document.querySelector(selector)?.closest(".live-card")?.scrollIntoView({ block: "center" }), lost);
      }
      if (choose) {
        const card = `.pane.focus .pane-editor .live-card[data-card-kind="${choose}"]`;
        await page.click(`${card} .live-card-name`);
        await page.waitForSelector(`${card}[data-card-chosen="true"]`);
        await expectVeilOnCard(page, card);
      }
      if (activate) {
        const body = `.pane.focus .pane-editor .live-card[data-card-kind="${activate}"] .live-card-body`;
        await page.click(body);
        await page.waitForSelector(`.pane.focus .pane-editor .live-card[data-card-kind="${activate}"][data-card-active="true"]`);
        // La griglia scrive dalla prima cella della parte, e la barra lo dice
        // (sotto i 760 px la cella non si vede: c'è, senza `hidden`).
        if (extra) await page.waitForSelector(".format-bar-context .format-bar-context-cell:not([hidden])", { state: "attached" });
      }
    },
  })),
  // Gli estratti (T49, il prototipo `.scard .act` e `.exc`, passi 17–18): il
  // foglio dei conti attivo con due righe scelte e «Estrai» d'accento in
  // testata; dopo «Estrai», l'estratto sotto la scheda; il passo del
  // contratto scritto come lo scrive Obsidian, una citazione con la fonte e
  // «Vai alla pagina»; il passo nella finestra minima.
  ...[
    ["estratti-01-estrai", "Il foglio attivo con A1:B2 scelte: «Estrai» d'accento in testata", "choose"],
    ["estratti-02-estratto", "Dopo «Estrai»: l'estratto delle celle scelte sotto la scheda, legato al foglio", "extract"],
    ["estratti-03-passo", "Un passo del contratto (`#page=1&selection=…`): la citazione con la fonte e «Vai alla pagina»", "passage"],
    ["estratti-04-stretta", "Il passo nella finestra minima, 800 px", "passage", NOTE_NARROW],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=estratti&pdf-scena=domanda&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const sheet = '.pane.focus .pane-editor .live-card[data-card-kind="sheet"]';
      const passage = '.pane.focus .pane-editor .live-card[data-card-state="passage"]';
      await openLive(page, [], "top");
      await page.waitForSelector(`${sheet} .canvas-card-sheet[data-card-state="content"]`);
      await page.waitForSelector(`${passage} .live-card-excerpt-go`);
      if (gesture === "passage") {
        await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), passage);
        return;
      }
      await page.click(`${sheet} .live-card-body`);
      await page.waitForSelector(`${sheet}[data-card-active="true"]`);
      // Due righe e due colonne scelte trascinando, da A1 a B2 (il finto dà
      // solo le finestre che partono da A1, e l'estratto ci parte).
      const cell = async (row, column) => {
        // Le celle dell'editor attivo (`aria-selected`), non quelle ferme sotto.
        const box = await page.locator(`${sheet} .grid-cell[aria-selected][data-row="${row}"][data-column="${column}"]`).boundingBox();
        if (!box) throw new Error(`la cella ${row},${column} del foglio non si vede`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const from = await cell(0, 0);
      const to = await cell(1, 1);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      await page.waitForSelector(`${sheet}[data-card-extract="ready"] .live-card-extract`);
      if (gesture === "extract") {
        await page.click(`${sheet} .live-card-extract`);
        await page.waitForFunction(() => document.querySelectorAll('.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-sheet[data-card-state="content"]').length === 2);
        await page.evaluate(() => {
          const cards = document.querySelectorAll('.pane.focus .pane-editor .live-card[data-card-kind="sheet"]');
          cards[1]?.scrollIntoView({ block: "center" });
        });
      }
    },
  })),
  // I valori di cella nel testo (T53, il prototipo `.cellv` del paragrafo
  // `p-conti`): in Scrittura il valore col tratteggio d'accento, i casi limite
  // (vuota, #DIV/0!, foglio che non c'è, file mancante) e la cella da sola con
  // `|value`; al passaggio il velo d'accento; in Lettura testo come il resto;
  // nella finestra minima (i 700 px del prototipo li guarda la conformità).
  ...[
    ["valori-cella-01-scrittura", "I valori di cella in Scrittura: 680 su 800, la cella vuota «—», #DIV/0!, il foglio e il file che non ci sono, -120 da solo", "live_preview", null, false],
    ["valori-cella-02-passaggio", "Il puntatore sul primo valore: il velo d'accento", "live_preview", null, true],
    ["valori-cella-03-lettura", "I valori di cella in Lettura: testo come il resto, col formato del foglio", "reading", null, false],
    ["valori-cella-04-stretta", "I valori di cella nella finestra minima, 800 px", "live_preview", NOTE_NARROW, false],
  ].map(([id, title, mode, viewport, hover]) => ({
    id,
    title,
    query: "live=valori-cella&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const value = mode === "reading"
        ? '.pane.focus[data-mode="reading"] .markdown-rendered .fub-cell-value'
        : ".pane.focus .pane-editor .cm-fub-cell-value";
      if (mode === "reading") await chooseMode(page, "reading");
      // Ogni valore ha avuto la sua risposta: nessuno è ancora «…».
      await page.waitForFunction((selector) => {
        const all = [...document.querySelectorAll(selector)];
        return all.length >= 6 && all.every((each) => each.dataset.cellState !== undefined && each.dataset.cellState !== "loading");
      }, value);
    },
    ...(hover ? { hover: (page) => page.hover(".pane.focus .pane-editor .cm-fub-cell-value >> nth=0") } : {}),
  })),
  // I grafici (T54): il grafico «Vendite» del foglio come scheda, disegnato
  // da GridCraft e alto quanto la sua proporzione; un grafico che il file non
  // ha («Intervallo non trovato»); la tabella col recinto Mermaid che
  // «Grafico da questa tabella» le ha scritto sotto; il menu della tabella
  // con la voce; la finestra minima.
  ...[
    ["grafici-01-scrittura", "Il grafico del foglio come scheda, alto quanto la sua proporzione", "top", false, null],
    ["grafici-05-perso", "Il fondo del grafico del foglio e, sotto, un grafico che il file non ha", "lost", false, null],
    ["grafici-02-tabella", "La tabella dei preventivi e la torta scritta dalla tabella", "table", false, null],
    ["grafici-03-menu", "Il menu della tabella con «Rigenera il grafico dalla tabella»", "table", true, null],
    ["grafici-04-stretta", "I grafici nella finestra minima, 800 px", "top", false, NOTE_NARROW],
  ].map(([id, title, scroll, menu, viewport]) => ({
    id,
    title,
    query: "live=grafici&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      // Il grafico ha il suo disegno e la scheda persa il suo avviso. Se uno
      // dei due non arriva, l'errore dice quale e com'erano le schede (#505).
      await waitForCardPart(page, '.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-sheet-chart img', "il disegno del grafico «Vendite»");
      await waitForCardPart(page, '.pane.focus .pane-editor .live-card[data-card-kind="sheet"] .canvas-card-lost', "l'avviso della scheda persa");
      if (scroll === "table") {
        // La torta si disegna quando entra in vista.
        await page.evaluate(() => document.querySelector(".pane.focus .pane-editor .tb-frame")?.scrollIntoView({ block: "start" }));
        await page.waitForFunction(() => {
          const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
          return all.length > 0 && all.every((figure) => figure.dataset.state !== "loading");
        });
        await page.evaluate(() => document.querySelector(".pane.focus .pane-editor .tb-frame")?.scrollIntoView({ block: "start" }));
      }
      if (scroll === "lost") {
        await page.evaluate(() => document.querySelector(".pane.focus .pane-editor .canvas-card-lost")?.closest(".live-card")?.scrollIntoView({ block: "end" }));
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (menu) {
        await page.click('.pane.focus .pane-editor .tb-grid [data-row="1"][data-col="0"]', { button: "right" });
        await page.waitForSelector("#context-menu [role=menuitem]");
      }
    },
  })),
  // La scheda di documento (T44, il prototipo `.docw`, passo 17): il verbale
  // in ODT a riposo, in continuo e senza pagine; scelto coi Blocchi (attivo,
  // poi Esc); attivo, con l'editor dei documenti in Scrittura e la sua barra.
  // In fondo la relazione di cento pagine, tronca con «Apri».
  ...[
    ["scheda-documento-01-riposo", "Il verbale in ODT a riposo: il testo reso in continuo, senza pagine", "top", "rest"],
    ["scheda-documento-02-scelta", "Il verbale scelto coi Blocchi, dopo Esc", "top", "chosen"],
    ["scheda-documento-03-attiva", "Il verbale attivo: si scrive nel documento, con la barra dei documenti", "top", "active"],
    ["scheda-documento-04-lunga", "Un documento di cento pagine: la scheda si ferma e offre «Apri»", "bottom", "rest"],
    ["scheda-documento-05-stretta", "Il verbale a riposo nella finestra minima, 800 px (T56)", "top", "rest", NOTE_NARROW],
  ].map(([id, title, scroll, state, viewport]) => ({
    id,
    title,
    query: "live=scheda-documento",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const cards = '.pane.focus .pane-editor .live-card[data-card-kind="document"]';
      await page.waitForFunction((selector) => {
        const all = [...document.querySelectorAll(selector)];
        return all.length === 2 && all.every((card) => card.dataset.cardState === "view");
      }, cards);
      if (scroll === "bottom") {
        await page.waitForSelector(`${cards} .canvas-card-document-more`);
        await page.evaluate((selector) => document.querySelectorAll(selector)[1]?.scrollIntoView({ block: "end" }), cards);
      }
      if (state === "rest") return;
      await page.click(`.pane.focus .pane-editor .live-card[data-card-kind="document"] .live-card-body`);
      // Il fuoco nel testo del documento: si scrive lì.
      await page.waitForSelector(`.pane.focus .pane-editor .live-card[data-card-kind="document"][data-card-active="true"] .rich-content.ProseMirror-focused`);
      if (state === "active") return;
      await page.keyboard.press("Escape");
      await page.waitForSelector(`.pane.focus .pane-editor .live-card[data-card-kind="document"][data-card-chosen="true"]`);
    },
  })),
  // La misura e il posto delle schede (T42, il prototipo `.pair` e la lavagna
  // a tutta pagina, passo 17): due schede affiancate in un `[!columns]`, una
  // a tutta pagina e bassa, una come riga; il bordo che si trascina sotto il
  // puntatore; la stessa nota a 700 px, dove la scheda larga torna nella
  // colonna.
  ...[
    ["schede-misura-01-affiancate", "Il contratto e i conti affiancati in due colonne, sopra i conti a tutta pagina", "top", false],
    ["schede-misura-02-riga", "I conti bassi col bordo da trascinare sotto il puntatore, e il contratto come riga", "bottom", true],
    ["schede-misura-03-stretta", "Nella finestra minima le schede affiancate stanno una sotto l'altra, e quella larga torna nella colonna", "wide", false, NOTE_NARROW],
  ].map(([id, title, scroll, hover, viewport]) => ({
    id,
    title,
    query: "live=schede-misura&pdf-scena=domanda&workbook=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => {
        const cards = [...document.querySelectorAll(".pane.focus .pane-editor .live-card")];
        return cards.length >= 4 && cards.every((card) => card.dataset.cardState !== "loading");
      });
      if (scroll === "bottom") {
        await page.evaluate(() => {
          const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
        });
        await page.waitForSelector('.pane.focus .pane-editor .live-card[data-card-display="row"]');
      }
      if (scroll === "wide") {
        // La seconda scheda delle colonne in alto, sopra quella larga.
        await page.evaluate(() => {
          const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
          const second = document.querySelectorAll(".pane.focus .pane-editor .fub-column > .live-card")[1];
          if (scroller && second) scroller.scrollTop += second.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
        });
      }
    },
    ...(hover ? {
      hover: async (page) => {
        const sized = '.pane.focus .pane-editor .live-card[data-card-height="set"]';
        await page.hover(`${sized} .live-card-resize`);
        await page.waitForSelector(`${sized}[data-card-resizable="true"]`);
      },
    } : {}),
  })),
  // La scheda PDF (T45, il prototipo `.pdfw` e `.pdfn`, passo 17): il manuale
  // di quattro pagine del giro, dalla pagina 2 con «2 / 4». A riposo; scelta
  // (un clic sulla testata, i Blocchi accesi); attiva, col puntatore sopra
  // (le frecce accanto al numero) e una riga del testo della pagina scelta;
  // la stessa nota a riposo nella finestra minima (i 700 px del prototipo li
  // guarda la conformità).
  ...[
    ["schede-pdf-01-riposo", "La scheda PDF a riposo: la pagina 2 sulla carta, «2 / 4» sotto", null],
    ["schede-pdf-02-scelta", "La scheda PDF scelta coi Blocchi: il filo della selezione la circonda", "choose"],
    ["schede-pdf-03-attiva", "La scheda PDF attiva: bordo d'accento, le frecce accanto al numero, una riga del testo scelta", "activate"],
    ["schede-pdf-04-stretta", "La scheda PDF nella finestra minima, 800 px: la pagina si stringe con la carta", null, NOTE_NARROW],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=schede-pdf&giro=editor",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      const card = '.pane.focus .pane-editor .live-card[data-card-kind="pdf"]';
      await openLive(page, [], "top");
      await page.waitForSelector(`${card}[data-card-state="view"] .canvas-card-pdf[data-card-state="content"]`);
      await page.waitForFunction((selector) => document.querySelector(`${selector} .canvas-card-pdf-status`)?.textContent === "2 / 4", card);
      // La scheda intera in vista, col numero sotto la pagina.
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), card);
      if (gesture === "choose") {
        await page.click(`${card} .live-card-name`);
        await page.waitForSelector(`${card}[data-card-chosen="true"]`);
        await expectVeilOnCard(page, card);
      }
      if (gesture === "activate") {
        await page.click(`${card} .live-card-body`);
        await page.waitForSelector(`${card}[data-card-active="true"]`);
        // Il clic ha portato il puntatore sulla scheda, che ha steso il testo;
        // se ne sceglie la seconda riga, come farebbe un trascinamento.
        await page.waitForSelector(`${card} .canvas-card-pdf-text span`);
        await page.evaluate((selector) => {
          const pieces = [...document.querySelectorAll(`${selector} .canvas-card-pdf-text span`)];
          const line = pieces.find((piece) => piece.textContent.startsWith("Una nota"));
          if (!line) throw new Error("la pagina 2 del manuale non ha la sua riga");
          const range = document.createRange();
          range.selectNodeContents(line);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        }, card);
      }
    },
    ...(gesture === "activate" ? {
      hover: async (page) => {
        // Sulla scheda attiva il testo sta sopra la pagina e prende il puntatore.
        await page.hover('.pane.focus .pane-editor .live-card[data-card-kind="pdf"] .canvas-card-pdf-text');
      },
    } : {}),
  })),
];
