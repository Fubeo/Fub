// Le scene delle altre pagine: il kit, il telefono, la finestra documento, i cataloghi.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  openCalendar,
  openDocumentWindow,
  openExportSpace,
  openRibbon,
  openTimeline,
} from "./gesti-documenti.mjs";
import {
  openComments,
  openHeader,
  openLive,
  openNoteTypes,
  openRichDocument,
  scrollLiveToEnd,
  touchBlocks,
  touchFormula,
  touchGridHandles,
} from "./gesti-scrittura.mjs";
import { DOCUMENT_WINDOW, KIT_WINDOW, PHONE } from "./misure.mjs";

export const S_KIT = [
    {
      id: "kit",
      title: "Il kit: ogni primitiva nei suoi stati",
      viewport: KIT_WINDOW,
      prepare: async () => {},
    },
    {
      id: "kit-lingua",
      title: "Il kit: la lingua dei menu, righe, tessere ed etichette nei loro stati",
      query: "lingua",
      viewport: KIT_WINDOW,
      prepare: async (page) => {
        // La sezione sta in fondo alla colonna di destra: la si porta in cima.
        await page.evaluate(() => {
          const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent === "La lingua dei menu");
          if (!heading) throw new Error("manca la sezione «La lingua dei menu»");
          heading.closest("section").scrollIntoView({ block: "start" });
        });
      },
    },
    {
      id: "kit-popover",
      title: "Il kit: il popover che porta un menu, col fuoco sulla prima voce",
      prepare: async (page) => {
        await page.click("#sample-menu");
        await page.waitForSelector('.kit-popover [role="menuitem"]:focus');
      },
    },
    {
      id: "kit-panel",
      title: "Il kit: il popover che porta un riquadro, col suo campo",
      prepare: async (page) => {
        await page.click("#sample-panel");
        await page.waitForSelector(".kit-popover .kit-field-input:focus");
      },
    },
    {
      id: "kit-dialog",
      title: "Il kit: il dialogo sopra il suo velo",
      prepare: async (page) => {
        await page.click("#sample-dialog");
        await page.waitForSelector(".kit-dialog");
      },
    },
    {
      id: "kit-focus",
      title: "Il kit: il fuoco vero da tastiera, e la scheda che ne esce",
      viewport: KIT_WINDOW,
      prepare: async (page) => {
        // Da tastiera, perché l'anello sia quello di `:focus-visible` e non il
        // gemello che la pagina tiene fermo: quattro Tab portano al rimando.
        for (let step = 0; step < 4; step++) await page.keyboard.press("Tab");
        await page.waitForSelector("#sample-card:focus-visible");
        await page.waitForSelector(".kit-hover-card");
      },
    },
];

export const S_TELEFONO = [
    // Le schede vive nella nota sul telefono (T56), una scena per specie a
    // riposo: il foglio e il PDF (con il file mancante e il formato senza
    // vista sotto), il contratto di quattro pagine, il verbale, la pianta,
    // la zona lavagna e il file Craft.
    ...[
      ["mobile-schede-vive", "Il telefono: il contratto e i conti come schede vive", "live=schede-vive&pdf-scena=domanda&workbook=1"],
      ["mobile-schede-mancante", "Il telefono: un file mancante e un formato che la nota non mostra", "live=schede-vive&pdf-scena=domanda&workbook=1", "unsupported"],
      ["mobile-scheda-pdf", "Il telefono: la scheda PDF, dalla pagina 2", "live=schede-pdf&giro=editor", "pdf"],
      ["mobile-scheda-documento", "Il telefono: il verbale in ODT a riposo", "live=scheda-documento", "document"],
      ["mobile-scheda-disegno", "Il telefono: la pianta a riposo", "live=scheda-disegno", "drawing"],
      ["mobile-scheda-lavagna", "Il telefono: il percorso della visita a riposo", "live=scheda-lavagna", "canvas"],
      ["mobile-scheda-craft", "Il telefono: il logo di VectorCraft senza anteprima", "live=scheda-craft&craft-scheda=spente", "craft"],
    ].map(([id, title, query, focus]) => ({
      id,
      title,
      query,
      viewport: PHONE,
      prepare: async (page) => {
        await openLive(page, [], "top");
        await page.waitForFunction(() => {
          const cards = [...document.querySelectorAll(".pane.focus .pane-editor .live-card")];
          return cards.length > 0 && cards.every((card) => card.dataset.cardState !== "loading")
            && [...document.querySelectorAll(".pane.focus .pane-editor .canvas-card-sheet")]
              .every((sheet) => sheet.dataset.cardState === "content" || sheet.dataset.cardState === "lost");
        });
        if (!focus) return;
        if (focus === "unsupported") {
          // Le schede sopra hanno preso la loro altezza: si va in fondo, dove
          // CodeMirror monta le ultime, con ogni blocco misurato (#510).
          await scrollLiveToEnd(page);
        }
        const card = focus === "unsupported"
          ? '.pane.focus .pane-editor .live-card[data-card-state="unsupported"]'
          : `.pane.focus .pane-editor .live-card[data-card-kind="${focus}"]`;
        await page.waitForSelector(card);
        // Il PDF ha la sua pagina sulla carta prima della foto.
        if (focus === "pdf") await page.waitForSelector(`${card} .canvas-card-pdf[data-card-state="content"]`);
        if (focus !== "unsupported") {
          await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), card);
          return;
        }
        // Le schede sopra crescono anche dopo il salto: si riporta la scheda
        // in fondo a ogni fotogramma finché altezza e posto restano gli
        // stessi per dieci fotogrammi di fila (prima la foto cambiava di
        // corsa in corsa).
        await page.waitForFunction((selector) => {
          const scroller = document.querySelector(".pane.focus .pane-editor .cm-scroller");
          const target = document.querySelector(selector);
          if (!scroller || !target) return false;
          target.scrollIntoView({ block: "end" });
          const firma = `${scroller.scrollHeight}:${scroller.scrollTop}:${Math.round(target.getBoundingClientRect().bottom)}`;
          const fermo = window.__finoFirma === firma ? (window.__finoFermo ?? 0) + 1 : 0;
          window.__finoFirma = firma;
          window.__finoFermo = fermo;
          return fermo >= 10;
        }, card, { polling: "raf" });
      },
    })),
    // Lo spazio «Esporta in PDF» (T70) sul telefono: la prima forma, col
    // pannello sotto le pagine.
    {
      id: "mobile-esporta-pdf",
      title: "Il telefono: lo spazio «Esporta in PDF», col pannello sotto le pagine",
      viewport: PHONE,
      prepare: (page) => openExportSpace(page),
    },
    // La formula in riga toccata (T60) sul telefono: il riquadro non esce
    // dallo schermo.
    {
      id: "mobile-formula",
      title: "Il telefono: la formula in riga toccata, il riquadro dentro lo schermo",
      query: "live=formula-toccata",
      viewport: PHONE,
      prepare: (page) => touchFormula(page, "inline"),
    },
    // La tavolozza (T62) sul telefono: sotto la formula, a tutta larghezza,
    // la griglia a otto colonne.
    {
      id: "mobile-formula-tavolozza",
      title: "Il telefono: la tavolozza della formula a tutta larghezza, con «Tutti» aperto",
      query: "live=formula-toccata",
      viewport: PHONE,
      prepare: (page) => touchFormula(page, "palette"),
    },
    // Al tocco (T66): il dito porta il cursore nella formula, la tavolozza
    // sta sotto e dice «Tocca», nessun velo di passaggio.
    {
      id: "mobile-formula-tocco",
      title: "Al tocco: il dito porta il cursore sotto la radice, la tavolozza sotto la formula",
      query: "live=formula-toccata",
      viewport: PHONE,
      touch: true,
      prepare: (page) => touchFormula(page, "touch"),
    },
    // La testata della pagina (T6) sul telefono: la copertina bassa, le
    // colonne delle proprietà strette.
    {
      id: "mobile-testata",
      title: "Il telefono: la testata in Scrittura, con la copertina bassa e le colonne strette",
      query: "live=testata",
      viewport: PHONE,
      prepare: (page) => openHeader(page, "live_preview"),
    },
    // I tipi di nota (T33) sul telefono: «Nuova nota» dal cassetto chiede il
    // tipo dentro lo schermo; l'avviso del tipo che non c'è va a capo.
    {
      id: "mobile-tipi-nuova",
      title: "Il telefono: «Nuova nota» chiede il tipo, il menu dentro lo schermo",
      query: "live=tipo",
      viewport: PHONE,
      prepare: (page) => openNoteTypes(page, "new"),
    },
    {
      id: "mobile-tipi-mancante",
      title: "Il telefono: la testata di una nota il cui tipo non c'è, con «Scegli il tipo»",
      query: "live=tipo-mancante",
      viewport: PHONE,
      prepare: (page) => openNoteTypes(page, "missing"),
    },
    // I commenti (T22) sul telefono: il segno sta nel testo, e la discussione
    // si apre larga quanto la vista.
    {
      id: "mobile-commenti",
      title: "Il telefono: i commenti con il segno nel testo",
      query: "live=commenti",
      viewport: PHONE,
      prepare: (page) => openComments(page, "live_preview"),
    },
    {
      id: "mobile-commenti-discussione",
      title: "Il telefono: la discussione di un commento",
      query: "live=commenti",
      viewport: PHONE,
      prepare: (page) => openComments(page, "live_preview", "open"),
    },
    {
      id: "mobile-startup",
      title: "Il telefono: il foglio, la barra del titolo ridotta, la barra inferiore",
      viewport: PHONE,
      prepare: async (page) => {
        await page.waitForSelector("#rail .rail-btn-inspector");
      },
    },
    {
      id: "mobile-sheet",
      title: "Il telefono: il cassetto che sale dal basso, col velo e la maniglia",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click('#views-ribbon .rail-btn[data-panel="files"]');
        await page.waitForSelector("#sidebar-scrim:not([hidden])");
        // Il fuoco va alla maniglia, non al campo di ricerca: niente tastiera.
        await page.waitForSelector("#sidebar > .sheet-grip:focus");
        // La maniglia resta alta 28 px: la regola dei 44 px del tocco non la
        // prende, perché le sue esclusioni non pesano (`shells/mobile/mobile.css`).
        await page.waitForFunction(() => {
          const grip = document.querySelector("#sidebar > .sheet-grip");
          return grip instanceof HTMLElement && Math.abs(grip.getBoundingClientRect().height - 28) < 0.5;
        }, null, { timeout: 5_000 });
      },
    },
    {
      id: "mobile-inspector",
      title: "Il telefono: l'ispettore, dalla barra inferiore",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#rail .rail-btn-inspector");
        await page.waitForSelector('#rail .rail-btn-inspector[aria-expanded="true"]');
        await page.waitForSelector("#inspector-scrim:not([hidden])");
      },
    },
    // Le impostazioni in piedi, scheda «Componenti»: gli interruttori sono il
    // binario della pelle con un tocco di 44 px attorno, e le schede scorrono
    // di lato coi nomi interi (`shells/mobile/mobile.css`, PA T47).
    {
      id: "mobile-settings",
      title: "Il telefono: le impostazioni sui componenti, gli interruttori e le schede intere",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#open-settings");
        await page.click('#settings-tabs button[data-tab="components"]');
        await page.waitForSelector('#settings-body input[role="switch"]');
        await page.$eval('#settings-body input[role="switch"]', (first) => first.scrollIntoView({ block: "center" }));
        await page.waitForFunction(() => {
          const scroll = document.querySelector("#settings-scroll") ?? document.querySelector("#settings-body");
          if (!scroll) return false;
          const box = scroll.getBoundingClientRect();
          // Visibile: per intero dentro la parte che scorre.
          const switches = [...document.querySelectorAll('#settings-body input[role="switch"]')].filter((input) => {
            const r = input.getBoundingClientRect();
            return r.width > 0 && r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
          });
          if (switches.length === 0) return false;
          const touchable = switches.every((input) => {
            const r = input.getBoundingClientRect();
            if (Math.round(r.width) !== 32 || Math.round(r.height) !== 18) return false;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            return document.elementFromPoint(x, y - 10) === input
              && document.elementFromPoint(x, y + 10) === input
              && document.elementFromPoint(r.left - 5, y) === input;
          });
          const whole = [...document.querySelectorAll(".settings-tab")].every((tab) => tab.scrollWidth <= tab.clientWidth);
          return touchable && whole;
        }, null, { timeout: 5_000 });
      },
    },
    // Il cestino con tre file, in piedi: i bottoni «Ripristina» di due righe
    // vicine non si toccano (`shells/mobile/mobile.css`, PA T47).
    {
      id: "mobile-trash",
      title: "Il telefono: il cestino con tre file, i bottoni staccati",
      query: "cestino=3",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click('#views-ribbon .rail-btn[data-panel="trash"]');
        await page.waitForFunction(() => {
          const buttons = [...document.querySelectorAll(".ui-list > .ui-stack > .ui-button")]
            .filter((button) => button.getClientRects().length > 0);
          if (buttons.length !== 3) return false;
          const boxes = buttons.map((button) => button.getBoundingClientRect());
          return boxes.slice(1).every((box, index) => box.top - boxes[index].bottom >= 8);
        }, null, { timeout: 5_000 });
      },
    },
    // Il documento in piedi: la carta sta nella vista, e il pannello del
    // documento sale dal basso, aperto dal pulsante col numero dei commenti.
    {
      id: "mobile-document",
      title: "Il telefono: un .docx con la carta larga quanto la vista e il pulsante dei commenti",
      query: "rich=docx",
      viewport: PHONE,
      prepare: async (page) => {
        await openRichDocument(page, "Documenti/Prova.docx");
        // Il documento si scrive tutto: «Si scrive» sta in «…», e la testata
        // non lo mostra (`shells/scrittoio/mobile/mobile.css`). Gli altri
        // stati sì: il pallino resta il chip di 24 px del computer, non un
        // cerchio di 44, e si tocca lo stesso 10 px sopra e sotto il suo
        // centro (`shells/mobile/mobile.css`, PA T47). Lo si misura come
        // «parti chiuse», per lo spazio di una misura sola: nello stesso giro
        // il tipo torna quello vero, e la foto non lo vede.
        await page.waitForFunction(() => {
          const chip = document.querySelector(".pane.focus .pane-toolbar .pane-standing-chip");
          const standing = chip?.parentElement;
          if (!(chip instanceof HTMLElement) || !(standing instanceof HTMLElement) || standing.hidden) return false;
          if (standing.dataset.standing !== "writes" || chip.getClientRects().length !== 0) return false;
          const measure = () => {
            if (chip.getClientRects().length === 0) return false;
            const r = chip.getBoundingClientRect();
            if (r.height > 24.5 || r.width >= 44) return false;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            // Il suo tocco non copre il bottone della modalità.
            const mode = document.querySelector(".pane.focus > .pane-mode-current");
            const m = mode?.getBoundingClientRect();
            const modeFree = !m || m.width === 0
              || document.elementFromPoint(m.left + 1, m.top + m.height / 2)?.closest(".pane-mode-current") === mode;
            return modeFree
              && document.elementFromPoint(x, y - 10)?.closest(".pane-standing-chip") === chip
              && document.elementFromPoint(x, y + 10)?.closest(".pane-standing-chip") === chip;
          };
          standing.dataset.standing = "closed";
          try {
            return measure();
          } finally {
            standing.dataset.standing = "writes";
          }
        }, null, { timeout: 5_000 });
        // Il fuoco della tastiera sul bottone della modalità: dal menu «…»
        // un passo avanti (il documento non ha la barra di formato), così
        // l'anello è quello di `:focus-visible`. Il bottone è il tondo sulla
        // carta: l'anello sta dentro il suo rettangolo, cioè lo scarto è
        // negativo e largo almeno quanto la linea (`shells/mobile/mobile.css`,
        // PA T47).
        await page.focus(".pane.focus [data-pane-menu]");
        await page.keyboard.press("Tab");
        await page.waitForFunction(() => {
          const mode = document.activeElement;
          if (!(mode instanceof HTMLElement) || !mode.matches(".pane.focus .pane-mode-current:focus-visible")) return false;
          const style = getComputedStyle(mode);
          const width = parseFloat(style.outlineWidth);
          const offset = parseFloat(style.outlineOffset);
          return style.outlineStyle !== "none" && width > 0 && offset < 0 && -offset >= width;
        }, null, { timeout: 5_000 });
        // Col fuoco della tastiera la didascalia del bottone arriva dopo 500 ms
        // di timer vero (`ui/tooltip.ts`): la si aspetta, perché è lo stato
        // vero del fuoco e una foto scattata prima la prenderebbe o no (#461).
        await page.waitForSelector(".shell-tooltip:not([hidden])");
      },
    },
    {
      id: "mobile-document-panel",
      title: "Il telefono: i commenti del .docx nel foglio che sale dal basso",
      query: "rich=docx",
      viewport: PHONE,
      prepare: async (page) => {
        await openRichDocument(page, "Documenti/Prova.docx");
        await page.click(".pane.focus .rich-side-open");
        await page.waitForSelector("#inspector-scrim:not([hidden])");
        await page.waitForSelector(".rich-side-comments .rich-side-comment");
      },
    },
    // Il calendario della Base in piedi (T17): una colonna di giorni, col nome
    // del giorno accanto al numero.
    {
      id: "mobile-base-calendario",
      title: "Il telefono: il calendario della Base in una colonna di giorni",
      query: "base=calendario",
      viewport: PHONE,
      prepare: openCalendar,
    },
    // La linea del tempo della Base in piedi (T34): il nome sopra la barra.
    {
      id: "mobile-base-tempo",
      title: "Il telefono: la linea del tempo della Base, il nome sopra la barra",
      query: "base=tempo",
      viewport: PHONE,
      prepare: openTimeline,
    },
    // La barra dei fogli in piedi: la Home in tre colonne di due foglietti
    // chiusi, e uno di loro aperto sul posto.
    {
      id: "mobile-grid-ribbon",
      title: "Il telefono: la barra dei fogli a riposo",
      query: "workbook=1",
      viewport: PHONE,
      prepare: (page) => openRibbon(page, "phone"),
    },
    {
      id: "mobile-grid-ribbon-open",
      title: "Il telefono: la barra dei fogli col foglietto «Allineamento» aperto sul posto",
      query: "workbook=1",
      viewport: PHONE,
      prepare: async (page) => {
        await openRibbon(page, "phone");
        await page.click('.pane.focus .grid-ribbon [data-group="alignment"] .grid-ribbon-group-toggle');
        await page.waitForSelector('.pane.focus .grid-ribbon [data-group="alignment"][data-open="true"]');
        // Il puntatore lascia l'interruttore: il suo tooltip arriva dopo 500 ms
        // di timer vero, e la foto lo prenderebbe o no (#459).
        await page.mouse.move(0, 0);
      },
    },
    // La griglia al dito (griglia T7 e T8), sulla cartella grande: un tocco
    // lungo su B3 mette le due maniglie, e quella di fine tirata fino a B6
    // allarga la selezione, come lo stato «Al telefono» del prototipo.
    {
      id: "mobile-grid-tocco-lungo",
      title: "Il telefono: la griglia con le maniglie del tocco lungo su B3:B6",
      query: "workbook=large",
      viewport: PHONE,
      touch: true,
      prepare: touchGridHandles,
    },
    {
      id: "mobile-launcher",
      title: "Il telefono: il lanciatore, dalla pillola",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#pill");
        await page.waitForSelector(".launcher-input:focus");
      },
    },
    {
      id: "mobile-launcher-commands",
      title: "Il telefono: il lanciatore col prefisso dei comandi, la scorciatoia a destra e nessuna anteprima",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click("#pill");
        await page.waitForSelector(".launcher-input:focus");
        await page.fill(".launcher-input", ">");
        await page.waitForSelector(".launcher-row-meta[data-mono]");
      },
    },
    {
      id: "mobile-keyboard",
      title: "Il telefono: la tastiera su, la barra di formattazione sopra i tasti",
      viewport: PHONE,
      prepare: async (page) => {
        await page.click(".pane.focus .pane-editor .cm-content");
        // La tastiera a schermo non esiste in un browser senza schermo: ciò
        // che la shell ne sa è che il viewport visivo si accorcia.
        await page.evaluate(() => {
          const view = window.visualViewport;
          Object.defineProperty(view, "height", { configurable: true, get: () => window.innerHeight - 320 });
          view.dispatchEvent(new Event("resize"));
        });
        await page.waitForSelector(':root[data-mobile-keyboard="visible"]');
        await page.waitForSelector(".pane.focus > .format-bar", { state: "visible" });
        await page.waitForSelector("#rail", { state: "hidden" });
      },
    },
    // **La regola al tocco** (T26a, E18 «Al tocco»): dove non c'è il
    // puntatore il «+» e la maniglia stanno sul blocco del cursore, e la
    // barra sopra la tastiera porta il gruppo di quel blocco. Il tocco è
    // quello emulato da Chromium (`(hover: none)`, `(pointer: coarse)`).
    // A riposo, senza cursore: niente maniglie. Col cursore in un compito,
    // la tastiera su: maniglia sul compito, «Compito · Scadenza» nella barra.
    // La presa: il dito tenuto 300 ms sulla maniglia prende il blocco.
    ...[
      ["mobile-tocco-01-riposo", "Al tocco, a riposo: la nota senza cursore, nessuna maniglia", "panoramica", "rest"],
      ["mobile-tocco-02-cursore", "Al tocco, il cursore in un compito: «+» e maniglia sul compito, «Compito» nella barra sopra la tastiera", "compito-attivo", "cursor"],
      ["mobile-tocco-03-presa", "Al tocco, la presa: il dito tenuto 300 ms sulla maniglia prende il compito", "compito-attivo", "hold"],
    ].map(([id, title, live, gesture]) => ({
      id,
      title,
      query: `live=${live}`,
      viewport: PHONE,
      touch: true,
      prepare: (page) => touchBlocks(page, gesture),
    })),
    {
      id: "mobile-welcome",
      title: "Il telefono: il benvenuto, senza un vault",
      query: "vault=vuoto",
      viewport: PHONE,
      prepare: async (page) => {
        await page.waitForSelector("#app[data-welcome]");
      },
    },
    {
      id: "mobile-landscape",
      title: "Il telefono sdraiato: binario a sinistra, cassetto di lato",
      viewport: { width: PHONE.height, height: PHONE.width },
      prepare: async (page) => {
        await page.click('#views-ribbon .rail-btn[data-panel="files"]');
        await page.waitForSelector("#sidebar-scrim:not([hidden])");
      },
    },
    {
      id: "avvio-telefono",
      title: "L'avvio sul telefono: il marchio e la riga del vault",
      query: "avvio=attesa",
      viewport: PHONE,
      ready: () => document.querySelector('.avvio[data-stato="attesa"][data-fase="vault"]') !== null,
      prepare: async () => {},
    },
];

export const S_DOCUMENTO = [
    {
      id: "window-document",
      title: "La finestra documento: il foglio, la linguetta, lo stato nella testata",
      viewport: DOCUMENT_WINDOW,
      prepare: async (page) => {
        await openDocumentWindow(page);
      },
    },
    {
      id: "window-invalid",
      title: "La finestra documento senza un documento valido",
      viewport: DOCUMENT_WINDOW,
      prepare: async (page) => {
        await page.waitForSelector("#document-window.document-window-invalid");
      },
    },
];

export const S_CATALOGO = [
    {
      id: "catalog-components",
      title: "Catalogo: ogni componente in ogni stato",
      query: "catalog=components",
      prepare: async () => {},
    },
    {
      id: "catalog-palette",
      title: "Catalogo: ogni token col suo contrasto",
      query: "catalog=palette",
      prepare: async () => {},
    },
    {
      id: "catalog-samples",
      title: "Catalogo: la scala tipografica",
      query: "catalog=samples",
      prepare: async () => {},
    },
];
