// La shell: la testata della nota, i suggerimenti e i diagrammi.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  caretLinePlace,
  chooseMode,
  openComments,
  openHeader,
  openLive,
  openNote,
  openNoteTypes,
  openOptionsEditor,
  openPropertyEditor,
  openRelationEditor,
  touchOn,
} from "./gesti-scrittura.mjs";
import { NOTE_NARROW } from "./misure.mjs";

export const S_TESTATA = [
  // La riga dei suggerimenti (T14): al centro della banda, i tasti per ciò che
  // si sta facendo. Una parola scelta a 1280 px; un blocco scelto nella
  // finestra minima, dove la riga toglie dalla fine le voci che non ci stanno.
  // La riga cambia dopo una pausa: il banco aspetta il contesto, non un tempo.
  ...[
    ["riga-dei-suggerimenti", "La riga dei suggerimenti con una parola scelta: grassetto, corsivo, collega", "selection"],
    ["riga-dei-suggerimenti-stretta", "La riga dei suggerimenti coi blocchi scelti, nella finestra minima: le voci che non ci stanno se ne vanno intere", "blocks", NOTE_NARROW],
  ].map(([id, title, context, viewport]) => ({
    id,
    title,
    query: "live=riga-attiva",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector('#status-hints[data-context="text"]');
      if (context === "selection") {
        for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
      } else {
        await page.keyboard.press("Escape");
        await page.waitForSelector(".pane.focus .cm-fub-block-selected");
      }
      await page.waitForSelector(`#status-hints[data-context="${context}"] .status-hints-item`);
    },
  })),
  // La testata in Scrittura e in Lettura (T6, E3, riga «La testata» del
  // prototipo): copertina, icona, titolo, quattro proprietà in evidenza,
  // «Altre 2», «Aggiungi una proprietà» e la riga dei dati; la stessa in
  // Lettura, a 700 px e sul telefono; poi i casi che non vanno lisci.
  ...[
    ["testata-01-scrittura", "testata", "La testata in Scrittura: copertina, icona, titolo, proprietà in evidenza", "live_preview"],
    ["testata-02-lettura", "testata", "La stessa testata in Lettura: senza strumenti né «Aggiungi»", "reading"],
    ["testata-03-lettura-stretta", "testata", "La testata in Lettura nella finestra minima, 800 px", "reading", { width: 800, height: 800 }],
    ["testata-04-altre", "testata", "La testata con «Altre 2 proprietà» aperto", "live_preview", null, "more"],
    ["testata-05-vuota", "testata-vuota", "La testata di una nota senza frontmatter: il titolo e «Aggiungi una proprietà»", "live_preview"],
    ["testata-06-illeggibile", "testata-illeggibile", "La testata col frontmatter illeggibile: lo dice, e lo YAML resta sotto", "live_preview"],
    ["testata-07-senza-immagine", "testata-senza-immagine", "La testata con la copertina che non si trova", "reading"],
  ].map(([id, live, title, mode, viewport, gesture]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openHeader(page, mode, gesture),
  })),
  // Gli editor dei tipi della testata (T8, E5, riga «Le proprietà» del
  // prototipo): le righe con la figura del tipo, poi ogni editor aperto, da
  // tastiera (il fuoco sul valore e Invio) o col puntatore; poi a 800 px.
  ...[
    ["proprieta-01-righe", "Le proprietà coi loro tipi: testo, stato, data, persone"],
    ["proprieta-02-testo", "Il testo si scrive al posto del valore (da tastiera)", "text"],
    ["proprieta-03-data", "Il riquadro della data, aperto da tastiera", "date"],
    ["proprieta-04-persone", "Il riquadro delle persone, aperto col puntatore", "people"],
    ["proprieta-05-elenco", "Il riquadro di un elenco, aperto col puntatore, con «Altre» aperto", "list"],
    ["proprieta-06-menu", "Il menu della proprietà, aperto dal nome", "menu"],
    ["proprieta-07-tipo", "Il menu «Tipo» della proprietà", "type"],
    ["proprieta-08-data-stretta", "Il riquadro della data nella finestra minima, 800 px", "date", { width: 800, height: 800 }],
    ["proprieta-09-persone-stretta", "Il riquadro delle persone nella finestra minima, 800 px", "people", { width: 800, height: 800 }],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=proprieta",
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openPropertyEditor(page, gesture),
  })),
  // Selezione, Stato e Url nella testata (T9, passo 4 del prototipo): le
  // pastiglie, l'indirizzo con la matita e uno Stato fuori dalle opzioni;
  // poi l'elenco delle opzioni dello Stato, da tastiera, e «Crea» su una
  // Selezione; poi a 800 px.
  ...[
    ["opzioni-01-righe", "Selezione, Stato, Url e (con «Altre» aperto) un valore fuori dalle opzioni nella testata", "more"],
    ["opzioni-02-stato", "L'elenco delle opzioni dello Stato nei tre gruppi, aperto da tastiera", "status"],
    ["opzioni-03-crea", "Una Selezione con «Crea» per un nome che non c'è", "create"],
    ["opzioni-04-stato-stretta", "L'elenco delle opzioni dello Stato nella finestra minima, 800 px", "status", { width: 800, height: 800 }],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=opzioni&tipi=1",
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openOptionsEditor(page, gesture),
  })),
  // La Relazione (T35, passo 4 del prototipo): il tipo e i libri legati come
  // nomi di note; poi il riquadro col puntatore, le note della cartella del
  // bersaglio sotto quelle legate; «Crea» per un nome che non c'è; a 800 px.
  ...[
    ["relazioni-01-righe", "Il tipo e una Relazione nella testata: i nomi delle note, sottolineati"],
    ["relazioni-02-editor", "Il riquadro della Relazione, aperto col puntatore: le legate spuntate, poi la cartella", "open"],
    ["relazioni-03-crea", "La Relazione con «Crea» per un nome che non c'è, da tastiera", "create"],
    ["relazioni-04-stretta", "Il riquadro della Relazione nella finestra minima, 800 px", "open", { width: 800, height: 800 }],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: "live=relazioni&tipi=1",
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openRelationEditor(page, gesture),
  })),
  // I tipi di nota (T33, E5; il prototipo `newNote()` e la sezione «Tipi» del
  // cassetto): «Nuova nota» che chiede il tipo, la testata di una nota con un
  // tipo, quella di una nota il cui tipo non c'è, e «Scegli il tipo»; poi a
  // 800 px.
  ...[
    ["tipi-01-nuova", "tipo", "«Nuova nota» chiede il tipo: la nota semplice in cima, poi i tipi; nel cassetto la sezione «Tipi»", "new"],
    ["tipi-02-testata", "tipo", "La testata di una nota con un tipo: l'icona del tipo, «tipo» e le proprietà in evidenza del tipo", "typed"],
    ["tipi-03-mancante", "tipo-mancante", "La testata di una nota il cui tipo non c'è: lo dice, con «Scegli il tipo»", "missing"],
    ["tipi-04-scegli", "tipo-mancante", "«Scegli il tipo» aperto dalla testata, da tastiera", "choose"],
    ["tipi-05-nuova-stretta", "tipo", "«Nuova nota» chiede il tipo nella finestra minima, 800 px", "new", { width: 800, height: 800 }],
    ["tipi-06-mancante-stretta", "tipo-mancante", "Il tipo che non c'è nella finestra minima, 800 px", "missing", { width: 800, height: 800 }],
  ].map(([id, live, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openNoteTypes(page, gesture),
  })),
  // La pagina del tipo (T33): in fondo alla nota del tipo, le note di quel
  // tipo con le sue proprietà in evidenza (la vista `note_type_page`).
  ...[
    ["tipi-07-pagina", "La pagina del tipo in fondo a «Libro»: le sue note, con le proprietà in evidenza", undefined],
    ["tipi-08-pagina-stretta", "La pagina del tipo nella finestra minima, 800 px", { width: 800, height: 800 }],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "live=tipo-pagina",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      // Nella finestra stretta l'albero è nel cassetto chiuso: la nota si apre
      // larga, poi la finestra si stringe.
      if (viewport) await page.setViewportSize({ width: 1280, height: 800 });
      await openNote(page, "Tipi/Libro.md");
      await chooseMode(page, "live_preview");
      if (viewport) {
        await page.setViewportSize(viewport);
        await page.waitForSelector("#layout.layout-compact");
      }
      await page.waitForSelector(".pane.focus .cm-day-page[data-type-page]:not([hidden]) .ui-section .ui-list-item");
      await page.$eval(".pane.focus .cm-day-page[data-type-page]", (section) => section.scrollIntoView({ block: "end" }));
      await page.mouse.move(0, 0);
    },
  })),
  // Scrittura coi Blocchi: la stessa nota, con la maniglia del blocco sotto il
  // puntatore e quella del blocco del cursore; poi la selezione di blocchi e il
  // menu.
  ...[
    ["blocchi-01-passaggio", "riga-attiva", "I Blocchi col puntatore su un titolo: «+» e maniglia accanto", "hover"],
    ["blocchi-02-selezione", "riga-attiva", "I Blocchi con due blocchi selezionati (Esc, Shift+↓)", "select"],
    ["blocchi-03-menu", "titolo-attivo", "I Blocchi col menu della maniglia aperto", "menu"],
    ["blocchi-04-stretta", "riga-attiva", "I Blocchi nella finestra minima, 800 px, col puntatore su un titolo", "hover", { width: 800, height: 800 }],
    ["blocchi-05-pagina", "pagina", "I Blocchi con la testata della pagina: icona, copertina, titolo e proprietà", "page"],
    ["blocchi-06-pagina-larga", "pagina-larga", "I Blocchi con la pagina a tutta larghezza, a 900 px", "page", { width: 900, height: 800 }],
    ["blocchi-07-pagina-larga-stretta", "pagina-larga", "I Blocchi con la pagina a tutta larghezza, a 800 px", "page", { width: 800, height: 800 }],
    // «Sposta in…» (E13): la nota, poi dove e che cosa resta; e il blocco
    // in mano sopra una nota del cassetto.
    ["blocchi-08-sposta-nota", "titolo-attivo", "«Sposta in…» dal menu del blocco: la scelta della nota", "move-note"],
    ["blocchi-09-sposta-dove", "titolo-attivo", "«Sposta in…»: dove va il blocco e che cosa resta al suo posto", "move-where"],
    ["blocchi-10-sposta-dove-stretta", "titolo-attivo", "«Sposta in…»: dove e che cosa resta, nella finestra minima", "move-where", { width: 800, height: 800 }],
    ["blocchi-11-sposta-cassetto", "riga-attiva", "Un blocco in mano sopra una nota del cassetto: «Sposta in «…»»", "move-drawer", { width: 1280, height: 800 }],
  ].map(([id, live, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles");
      // La testata della pagina arriva dopo che il cursore è stato portato in
      // vista: secondo chi vince, la nota resta in cima o scende di 78 px. Il
      // banco aspetta la testata e riparte dalla cima, ogni volta.
      await page.waitForSelector(".pane.focus .pane-editor .cm-fub-page-title");
      // Scrittura si apre già coi Blocchi, senza passare dal menu della banda:
      // il moto d'apertura della nota può essere ancora in corsa, e un gesto
      // di Playwright su un riquadro che si muove lo fa scorrere per portarlo
      // in vista. Si parte a scena ferma, come per il «/».
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await page.evaluate(() => { document.querySelector(".pane.focus .pane-editor .cm-scroller").scrollTop = 0; });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (gesture === "hover" || gesture === "move-drawer") return;
      if (gesture === "page") {
        if (live === "pagina-larga") await page.waitForSelector(".pane.focus.fub-note--wide");
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return;
      }
      if (gesture === "select") {
        await page.keyboard.press("Escape");
        await page.keyboard.press("Shift+ArrowDown");
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-selected");
      } else {
        await page.click(".pane.focus .pane-editor .cm-fub-block-grip");
        await page.waitForSelector("#context-menu");
      }
      if (gesture === "move-note" || gesture === "move-where") {
        await page.click("#context-menu [role^=menuitem]:has(.menu-label:text-is('Sposta in…'))");
        await page.waitForSelector(".modale [role=option]");
        if (gesture === "move-where") {
          // Una nota coi suoi titoli, perché «Dove» li mostri rientrati.
          await page.keyboard.type("Sintassi");
          await page.keyboard.press("Enter");
          await page.waitForSelector(".modale .palette-form select[name=where]");
        }
        await page.waitForFunction(() => document.getAnimations().length === 0);
      }
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
    // Il puntatore è l'ultimo gesto: `prepareScene` lo porta via prima.
    ...(gesture === "hover" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')");
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles[data-active=\"true\"]");
      },
    } : {}),
    // Il blocco preso per la maniglia e tenuto sulla prima nota del cassetto
    // che non è quella aperta: il puntatore è il gesto, e resta giù.
    ...(gesture === "move-drawer" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .pane-editor .cm-content .cm-line:has-text('Cose da fare')");
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-block-handles[data-active=\"true\"]");
        const grip = await page.locator(".pane.focus .pane-editor .cm-fub-block-handles[data-active=\"true\"] .cm-fub-block-grip").boundingBox();
        const row = await page.locator("#file-list .tree-row.note[data-path$='.md']:not([aria-current]):visible").first().boundingBox();
        if (!grip || !row) throw new Error("manca la maniglia o una nota nel cassetto");
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 12, { steps: 4 });
        await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 16 });
        await page.waitForSelector(".cm-fub-block-lift[data-free=\"true\"]");
        await page.waitForSelector("#file-list .tree-row[data-drop-hot]");
        await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      },
    } : {}),
  })),
  // I diagrammi (E26): a riposo e al passaggio soltanto il disegno, nessun
  // controllo dentro la cornice; il menu del tasto destro; i cinque stili;
  // uno stile che non esiste e un errore. Se dentro un diagramma c'è un
  // pulsante, la scena è rossa.
  ...[
    ["diagramma-01-riposo", "diagramma", "Un diagramma in Scrittura, a riposo: soltanto il disegno, sulla pagina"],
    ["diagramma-02-passaggio", "diagramma", "Col puntatore sul diagramma: nessun controllo dentro la cornice", "hover"],
    ["diagramma-03-menu", "diagramma", "Il menu del tasto destro: stile, «Vale per», orientamento, azioni", "menu"],
    ["diagramma-04-menu-stretta", "diagramma", "Il menu del tasto destro nella finestra minima", "menu", { width: 800, height: 800 }],
    ["diagramma-05-stili", "diagramma-stili", "I cinque stili, uno per diagramma: Armonia sulla pagina, gli altri sulla loro carta"],
    ["diagramma-06-casi", "diagramma-casi", "Uno stile che non esiste (vale quello generale) e un diagramma con un errore"],
    // Gli stili scritti nel diagramma (#528): Mermaid li scrive come
    // attributo sui nodi dell'SVG dove misura, e la CSP li rifiuterebbe. Un
    // `font-size` perso nelle misure fa uscire l'etichetta dal riquadro.
    ["diagramma-09-nodi-con-stile", "diagramma-nodi", "Nodi e collegamenti con uno stile scritto nel diagramma: riempimento, bordo, linea rossa, classe, un'etichetta grande che sta nel suo riquadro"],
  ].map(([id, live, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => {
        const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
        return all.length > 0 && all.every((figure) => figure.dataset.state !== "loading");
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // Il sorgente di un diagramma disegnato è nascosto, col suo «Copia»:
      // conta ciò che si vede. Con un errore il sorgente c'è, ed è suo.
      // La didascalia (il `title`, T58) è testo della figura, non un controllo.
      const controls = await page.evaluate(() => [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram:not([data-state='error']) :is(button, figcaption:not(.mermaid-diagram-caption))")]
        .filter((node) => node.getClientRects().length > 0).length);
      if (controls > 0) throw new Error(`un diagramma ha ${controls} controlli dentro la cornice`);
      if (gesture !== "menu") return;
      const box = await page.locator(".pane.focus .pane-editor .mermaid-diagram img").first().boundingBox();
      if (!box) throw new Error("il diagramma non ha un disegno");
      await page.mouse.click(box.x + box.width / 2, box.y + 24, { button: "right" });
      await page.waitForSelector(".diagram-menu");
      await page.waitForFunction(() => document.getAnimations().length === 0);
    },
    ...(gesture === "hover" ? {
      hover: async (page) => {
        await page.hover(".pane.focus .pane-editor .mermaid-diagram img");
        const controls = await page.evaluate(() => [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram *")]
          .filter((node) => node.matches("button, [role='button'], [role='toolbar']") && node.getClientRects().length > 0).length);
        if (controls > 0) throw new Error(`al passaggio il diagramma mostra ${controls} controlli`);
      },
    } : {}),
  })),
  // Il tracciato dei collegamenti (E26, T59): il flusso del prototipo, con un
  // ritorno e le etichette, giù e poi a destra, in ognuno dei cinque stili;
  // poi i casi limite (etichette lunghe, tratteggio, senza punta, sequenza).
  // La finestra è alta perché i due orientamenti stiano in uno scatto.
  ...[
    ...["armonia", "acquerello", "aurora", "blueprint", "inchiostro"].map((style) => [
      `diagramma-07-tracciato-${style}`,
      `diagramma-tracciato-${style}`,
      `Il tracciato in ${style[0].toUpperCase()}${style.slice(1)}: frecce che arrivano dritte, punte sottili, gomiti arrotondati, il ritorno di lato; giù e a destra`,
    ]),
    ["diagramma-08-tracciato-casi", "diagramma-tracciato-casi", "Il tracciato nei casi limite: un'etichetta lunga, un tratteggio, un collegamento senza punta, un diagramma di sequenza"],  ].map(([id, live, title]) => ({
    id,
    title,
    query: `live=${live}`,
    viewport: { width: 1280, height: 1500 },
    prepare: async (page) => {
      await openLive(page, [], "top");
      await page.waitForFunction(() => {
        const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
        return all.length > 0 && all.every((figure) => figure.dataset.state === "ready");
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  // Il sorgente del diagramma (T58): accanto al disegno, metà e metà, con
  // «Fatto» nella testata; con un errore il disegno di prima attenuato e la
  // riga che dice dove; uno sopra l'altro nel foglio stretto; a tutta
  // finestra sul fondo dello stile.
  ...[
    // Accanto serve un foglio di almeno 941 px: la finestra larga.
    ["diagramma-sorgente-01-accanto", "Il sorgente aperto: le righe a sinistra, il disegno accanto, la didascalia sotto", null, { width: 1600, height: 900 }],
    ["diagramma-sorgente-02-errore", "Un errore nel sorgente: il disegno di prima attenuato, «Riga N» in parole semplici", "errore", { width: 1600, height: 900 }],
    ["diagramma-sorgente-03-stretta", "Nel foglio stretto il sorgente e il disegno stanno uno sopra l'altro", "errore", { width: 800, height: 800 }],
    ["diagramma-sorgente-04-ingrandito", "Ingrandisci: il diagramma a tutta finestra, sul fondo dello stile", "ingrandisci"],
  ].map(([id, title, gesture, viewport]) => ({
    id,
    title,
    query: `live=${gesture === "ingrandisci" ? "diagramma" : "diagramma-sorgente"}`,
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "top");
      const ready = () => page.waitForFunction(() => {
        const all = [...document.querySelectorAll(".pane.focus .pane-editor .mermaid-diagram")];
        return all.length > 0 && all.every((figure) => figure.dataset.state !== "loading");
      });
      await ready();
      if (gesture === "ingrandisci") {
        // Dal menu del tasto destro: in Scrittura il clic porta il cursore nel recinto.
        const box = await page.locator(".pane.focus .pane-editor .mermaid-diagram img").first().boundingBox();
        if (!box) throw new Error("il diagramma non ha un disegno");
        await page.mouse.click(box.x + box.width / 2, box.y + 24, { button: "right" });
        await page.waitForSelector(".diagram-menu");
        await page.click(".diagram-menu [data-action='enlarge']");
        await page.waitForSelector(".lightbox.lightbox-diagram");
        await page.waitForFunction(() => document.getAnimations().length === 0);
        return;
      }
      await page.waitForSelector(".pane.focus .pane-editor .cm-fub-diagram-live .mermaid-diagram[data-state='ready']");
      if (gesture === "errore") {
        await page.evaluate(async () => {
          const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
          const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
          const at = view.state.doc.toString().indexOf("D[Cambia giorno]") + "D[Cambia giorno]".length;
          view.dispatch({ changes: { from: at, insert: "\n  D --> --> A" }, selection: { anchor: at + 14 }, userEvent: "input.type" });
        });
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-diagram-live .cm-fub-diagram-notice:not([hidden])", { timeout: 15000 });
        await page.waitForSelector(".pane.focus .pane-editor .cm-fub-diagram-live .mermaid-diagram.is-stale");
      }
      // Il recinto in cima al foglio: sotto si vedono il disegno e la didascalia.
      await page.evaluate(() => {
        const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
        const header = document.querySelector(".pane.focus .pane-editor .cm-fub-code-header");
        scroller.scrollTop += header.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
      });
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  // I commenti (T22): il segno nel margine con le iniziali e il numero dei
  // messaggi, la discussione aperta, il primo messaggio che chiede il nome, il
  // segno nel testo nella finestra minima, la Lettura e il pannello «Commenti».
  ...[
    ["commenti-01-margine", "commenti", "I commenti in Scrittura: il segno nel margine, l'archivio in fondo non si vede", "live_preview"],
    ["commenti-02-discussione", "commenti", "La discussione aperta dal segno: citazione, messaggi, risposta, Risolvi, Elimina", "live_preview", null, "open"],
    ["commenti-03-primo", "commenti-scelta", "Il primo messaggio: la citazione, il nome che si chiede e l'avviso che finisce nel file", "live_preview", null, "compose"],
    ["commenti-04-stretta", "commenti", "Nella finestra minima, 800 px (il foglio di 700 del prototipo): il segno sta nel testo", "live_preview", NOTE_NARROW],
    ["commenti-05-stretta-discussione", "commenti", "Nella finestra minima la discussione aperta dal segno nel testo", "live_preview", NOTE_NARROW, "open"],
    ["commenti-06-lettura", "commenti", "I commenti in Lettura: il segno nel margine, l'archivio non occupa posto", "reading"],
    ["commenti-07-pannello", "commenti", "Il pannello «Commenti»: gli aperti, poi i risolti con «Svuota i risolti»", "live_preview", null, "panel"],
  ].map(([id, live, title, mode, viewport, gesture]) => ({
    id,
    title,
    query: `live=${live}`,
    ...(viewport ? { viewport } : {}),
    prepare: (page) => openComments(page, mode, gesture),
  })),
  // Il menu «/» (N12, T84) su una riga vuota della Live, coi comandi veri di
  // `fub.formatting`: aperto, filtrato, un comando rapido, niente trovato, i
  // passi di tabella, colore e data, poi la finestra minima e il foglio.
  ...[
    ["slash-01-aperto", "Il menu «/» appena aperto: una colonna, le sei tessere dei più usati con la prima accesa, i gruppi e il disegno in fondo", ["/"]],
    ["slash-02-filtro", "Il menu «/» filtrato da «tit»: un elenco solo, la parte trovata in evidenza, «Cerca fra tutti i comandi» in fondo", ["/tit"]],
    ["slash-03-rapido", "Il menu «/» con un comando rapido: «/tab 3x4»", ["/tab 3x4"]],
    ["slash-04-nessuno", "Il menu «/» senza risultati: lo dice, e Invio cerca fra tutti i comandi", ["/qwerty"]],
    ["slash-05-tabella", "Il passo della tabella, allargato a 3 × 4", ["/tabella", "@Enter", "@ArrowRight"]],
    ["slash-06-colore", "Il passo del colore: il testo e il fondo, coi nomi", ["/colore", "@Enter"]],
    ["slash-07-data", "Il passo della data: i giorni a portata e il calendario", ["/data", "@Enter"]],
    ["slash-08-stretta", "Il menu «/» nella finestra minima, scesi nelle righe: il titolo del gruppo resta in cima", ["/", "@ArrowDown", "@Tab", "@Tab"], { width: 800, height: 800 }],
    ["slash-09-dito", "Il menu «/» toccato col dito: un foglio in fondo, righe da 44 px", ["/"], { width: 800, height: 800 }, true],
  ].map(([id, title, keys, viewport, touch]) => ({
    id,
    title,
    query: "live=riga-vuota&slash=1",
    ...(viewport ? { viewport } : {}),
    ...(touch ? { touch: true } : {}),
    prepare: async (page) => {
      // Col dito vuol dire `(pointer: coarse)`: Chromium lo dà quando
      // emula il tocco, e il pannello lo legge all'apertura.
      if (touch) await touchOn(page);
      await openLive(page, [], "top");
      // Il «/» si scrive a scena ferma: se un antenato del riquadro si sta
      // ancora muovendo quando il pannello nasce, CodeMirror lo crede in un
      // contenitore trasformato e lo posiziona in assoluto per sempre, e la
      // sua ombra cade un poco diversa da quella del moto ridotto.
      await page.waitForFunction(() => document.getAnimations().length === 0);
      for (const key of keys) {
        if (key.startsWith("@")) await page.keyboard.press(key.slice(1));
        else await page.keyboard.type(key);
      }
      await page.waitForSelector(".slash-panel");
      // Poi due fotogrammi, perché il pannello si posi.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
  })),
  // Il «/» sull'ultima riga di una nota scorsa fino in fondo: il menu si apre
  // sopra la riga e la vista non si muove. Nella WebView di Linux la vista
  // scendeva di una riga: mentre CodeMirror ridisegna la riga, il testo è per
  // un attimo più corto, e a fondo nota lo scorrimento si accorciava con lui.
  // La scena fa accorciare il testo per un attimo anche qui, poi scrive il «/».
  ...[
    ["slash-10-fondo", "Il menu «/» sull'ultima riga di una nota scorsa fino in fondo: sopra la riga, la vista ferma", null],
    ["slash-11-fondo-stretta", "Il menu «/» a fondo nota nella finestra minima: sopra la riga, la vista ferma", NOTE_NARROW],
  ].map(([id, title, viewport]) => ({
    id,
    title,
    query: "live=fondo-nota&slash=1",
    ...(viewport ? { viewport } : {}),
    prepare: async (page) => {
      await openLive(page, [], "bottom");
      await page.waitForFunction(() => document.getAnimations().length === 0);
      // Di nuovo in fondo: la prima misura di CodeMirror allunga la nota di
      // qualche pixel dopo lo scorrimento di `openLive`.
      await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
        view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const before = await caretLinePlace(page);
      if (before.scrollTop < before.maxScroll - 1) throw new Error(`la nota non è scorsa fino in fondo: ${before.scrollTop} di ${before.maxScroll}`);
      const shrunk = await page.evaluate(async () => {
        const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
        const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
        // Come CodeMirror quando ridisegna una riga: per un attimo l'ultima
        // riga non c'è, e la disposizione si calcola così.
        const last = view.contentDOM.lastElementChild;
        last.style.display = "none";
        void view.scrollDOM.scrollHeight;
        last.style.display = "";
        return view.scrollDOM.scrollTop;
      });
      if (shrunk !== before.scrollTop) throw new Error(`il testo accorciato per un attimo sposta la vista: da ${before.scrollTop} a ${shrunk} px`);
      await page.keyboard.type("/");
      await page.waitForSelector(".slash-panel");
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await caretLinePlace(page);
      if (after.scrollTop !== before.scrollTop || Math.abs(after.lineTop - before.lineTop) > 0.5) {
        throw new Error(`il «/» a fondo nota sposta la vista: scorrimento da ${before.scrollTop} a ${after.scrollTop} px, riga da ${before.lineTop} a ${after.lineTop}`);
      }
      const above = await page.$eval(".slash-panel", (panel) => panel.classList.contains("cm-tooltip-above"));
      if (!above) throw new Error("a fondo nota il menu «/» non si apre sopra la riga");
    },
  })),
];
