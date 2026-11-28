// Ciò che il controllo del 2026-11-28, parte 2 ha trovato da correggere
// nell'app: esporta in PDF (le pagine), blocchi Live e fogli stretti. Un
// blocco di `DA_COPRIRE` di `bench/conformita/mappa-editor.mjs`, che lo
// monta; la forma è quella scritta lì. In questo giro non si corregge niente
// nell'app: ogni differenza ha qui i suoi numeri.

const C = "controllo del 2026-11-28 (parte 2)";

export const DA_COPRIRE_PARTE_2 = [
  // ── esporta in PDF: le differenze misurate sulla pagina ──────────────────
  {
    id: "esporta.pagina-titolo",
    proprieta: ["font-size","line-height","letter-spacing","margin-top","margin-bottom"],
    perche: `${C}: il titolo della pagina stampata. Prototipo → app: font-size: 29.90px → 26.50px; line-height: 33.49px → 38.43px; letter-spacing: -0.44px → normal; margin-top, margin-bottom: 0px → 17.75px`,
  },
  {
    id: "esporta.pagina-titolo2",
    proprieta: ["font-weight","line-height"],
    perche: `${C}: il titolo di sezione stampato. Prototipo → app: font-weight: 650 → 600; line-height: 25.76px → 27.03px`,
  },
  {
    id: "esporta.pagina-titolo2-spazio",
    proprieta: ["margin-top","margin-bottom"],
    perche: `${C}: lo spazio attorno al titolo di sezione: nel prototipo sta sul blocco che lo contiene, nell'app il titolo non ne ha. Prototipo → app: margin-top: 22px → 0px; margin-bottom: 7.33px → 0px`,
  },
  {
    id: "esporta.pagina-richiamo",
    proprieta: ["padding-top","padding-right","padding-bottom","padding-left","border-top-width","border-top-style","border-top-color","border-right-width","border-right-style","border-right-color","border-bottom-width","border-bottom-style","border-bottom-color","border-left-width","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"],
    perche: `${C}: il richiamo stampato: nel prototipo un filo verde a sinistra, nell'app una cornice grigia con l'icona nel margine. Prototipo → app: padding-top: 10.26px → 12px; padding-right: 13.93px → 20px; padding-bottom: 11px → 12px; padding-left: 13.93px → 44px; border-top-width, border-right-width, border-bottom-width: 0px → 1px; border-top-style, border-right-style, border-bottom-style: none → solid; border-top-color, border-right-color, border-bottom-color: none → rgb(213, 222, 216); border-left-width: 3px → 1px; border-left-color: rgb(0, 110, 70) → rgb(213, 222, 216); border-top-left-radius, border-top-right-radius, border-bottom-right-radius, border-bottom-left-radius: 7.33px → 8px`,
  },
  {
    id: "esporta.pagina-richiamo-titolo",
    proprieta: ["font-size","font-weight","line-height","letter-spacing","color","margin-bottom"],
    perche: `${C}: il titolo del richiamo stampato. Prototipo → app: font-size: 12.32px → 14px; font-weight: 650 → 600; line-height: 16.01px → 21.7px; letter-spacing: 0.12px → normal; color: rgb(0, 110, 70) → rgb(15, 26, 20); margin-bottom: 2.46px → 0px`,
  },
  {
    id: "esporta.pagina-compito",
    proprieta: ["display","row-gap","column-gap"],
    perche: `${C}: il compito stampato: nel prototipo una riga flessibile con la casella, nell'app un elemento d'elenco. Prototipo → app: display: flex → list-item; row-gap, column-gap: 9.09px → normal`,
  },
  {
    id: "esporta.pagina-casella",
    proprieta: ["width","height","border-top-color","border-right-color","border-bottom-color","border-left-color","background-color"],
    perche: `${C}: la casella del compito stampato. Prototipo → app: width, height: 13.92px → 16px; border-top-color, border-right-color, border-bottom-color, border-left-color: rgb(93, 105, 98) → rgb(126, 138, 130) (giorno 1280, giorno 700); rgb(93, 105, 98) → rgb(113, 126, 118) (notte 1280, notte 700); background-color: rgba(0, 0, 0, 0) → rgb(255, 255, 255) (giorno 1280, giorno 700); rgba(0, 0, 0, 0) → rgb(30, 41, 35) (notte 1280, notte 700)`,
  },
  {
    id: "esporta.pagina-tabella",
    proprieta: ["font-size","line-height","border-collapse"],
    perche: `${C}: la tabella stampata. Prototipo → app: font-size: 12.61px → 11.00px; line-height: 17.65px → 15.40px; border-collapse: collapse → separate`,
  },
  {
    id: "esporta.pagina-intestazione",
    proprieta: ["padding-top","padding-right","padding-bottom","padding-left","font-weight","text-align"],
    perche: `${C}: l'intestazione della tabella stampata. Prototipo → app: padding-top, padding-bottom: 5.67px → 0px; padding-right, padding-left: 8.82px → 12px; font-weight: 650 → 600; text-align: left → start`,
  },
  {
    id: "esporta.pagina-cella",
    proprieta: ["padding-top","padding-right","padding-bottom","padding-left"],
    perche: `${C}: la cella della tabella stampata. Prototipo → app: padding-top, padding-bottom: 5.04px → 0px; padding-right, padding-left: 8.82px → 12px`,
  },
  // ── esporta in PDF: i tipi di blocco che la nota della scena non ha ─────
  // La scena `esporta-pdf` stampa «Sintassi di Fub», che non ha ripiegabili,
  // figure con didascalia, formule in blocco, trasclusioni né schede: l'app
  // li sa stampare (`src/export/content/`), il banco non li apre.
  {
    id: "esporta.pagina-ripiegabile",
    prototipo: ".px-slot .ptog-h",
    app: ".export-slot .print-body .fub-details",
    perche: `${C}: la nota della scena non ha un ripiegabile; il prototipo lo stampa aperto, titolo a 650 e corpo rientrato col filo`,
  },
  {
    id: "esporta.pagina-didascalia",
    prototipo: ".px-slot .pfig figcaption",
    app: ".export-slot .export-card-caption",
    perche: `${C}: la nota della scena non ha schede né figure; nel prototipo la didascalia è a 0,76 em, centrata, grigia`,
  },
  {
    id: "esporta.pagina-formula",
    prototipo: ".px-slot .pmath",
    app: ".export-slot .print-body .math-block",
    perche: `${C}: la nota della scena non ha una formula in blocco`,
  },
  {
    id: "esporta.pagina-trasclusione",
    prototipo: ".px-slot .ptx",
    app: ".export-slot .print-body .embed",
    perche: `${C}: la nota della scena non ha una trasclusione; nel prototipo è un filo a sinistra con la fonte sotto (\`.ptx-s\`)`,
  },
  {
    id: "esporta.pagina-scheda",
    prototipo: ".px-slot .pcard",
    app: ".export-slot .export-card-name",
    perche: `${C}: la nota della scena non ha la scheda di una nota`,
  },
  {
    id: "esporta.pagina-citazione",
    prototipo: ".px-slot .pq",
    app: ".export-slot .print-body blockquote",
    perche: `${C}: al contrario, la nota del prototipo non ha una citazione (il suo CSS sì, riga 1099): dal lato del prototipo non c'è un elemento da leggere`,
  },
  // ── blocchi Live: le differenze misurate ────────────────────────────────
  {
    id: "live.paragrafo",
    proprieta: ["line-height"],
    perche: `${C}: il paragrafo: interlinea 1,62 nel prototipo, 1,65 nell'app. Prototipo → app: line-height: 29.16px → 29.7px`,
  },
  {
    id: "live.compito",
    proprieta: ["line-height"],
    perche: `${C}: il compito: la stessa interlinea del paragrafo. Prototipo → app: line-height: 29.16px → 29.7px`,
  },
  {
    id: "live.casella",
    proprieta: ["width","height","border-top-width","border-top-style","border-top-color","border-right-width","border-right-style","border-right-color","border-bottom-width","border-bottom-style","border-bottom-color","border-left-width","border-left-style","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","box-shadow","background-color"],
    perche: `${C}: la casella del compito: 17 px con un'ombra interna nel prototipo, 16 px con un bordo nell'app. Prototipo → app: width, height: 17px → 16px; border-top-width, border-right-width, border-bottom-width, border-left-width: 0px → 1px; border-top-style, border-right-style, border-bottom-style, border-left-style: none → solid; border-top-color, border-right-color, border-bottom-color, border-left-color: none → rgb(126, 138, 130) (giorno 1280, giorno 700); none → rgb(113, 126, 118) (notte 1280, notte 700); border-top-left-radius, border-top-right-radius, border-bottom-right-radius, border-bottom-left-radius: 5px → 4px; box-shadow: rgba(23, 34, 27, 0.3) 0px 0px 0px 1.5px inset → none (giorno 1280, giorno 700); rgba(228, 233, 230, 0.34) 0px 0px 0px 1.5px inset → none (notte 1280, notte 700); background-color: rgba(0, 0, 0, 0) → rgb(255, 255, 255) (giorno 1280, giorno 700); rgba(0, 0, 0, 0) → rgb(30, 41, 35) (notte 1280, notte 700)`,
  },
  {
    id: "live.casella-fatta",
    proprieta: ["width","height","border-top-width","border-top-style","border-top-color","border-right-width","border-right-style","border-right-color","border-bottom-width","border-bottom-style","border-bottom-color","border-left-width","border-left-style","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"],
    perche: `${C}: la casella del compito fatto. Prototipo → app: width, height: 17px → 16px; border-top-width, border-right-width, border-bottom-width, border-left-width: 0px → 1px; border-top-style, border-right-style, border-bottom-style, border-left-style: none → solid; border-top-color, border-right-color, border-bottom-color, border-left-color: none → rgb(0, 110, 70) (giorno 1280, giorno 700); none → rgb(83, 196, 142) (notte 1280, notte 700); border-top-left-radius, border-top-right-radius, border-bottom-right-radius, border-bottom-left-radius: 5px → 4px`,
  },
  {
    id: "live.fatto",
    proprieta: ["text-decoration-color"],
    perche: `${C}: il testo del compito fatto. Prototipo → app: color: rgb(91, 102, 95) → rgb(87, 98, 91) (giorno 1280, giorno 700); text-decoration-color: rgba(23, 34, 27, 0.3) → rgb(87, 98, 91) (giorno 1280, giorno 700); rgba(228, 233, 230, 0.34) → rgb(158, 167, 161) (notte 1280, notte 700)`,
  },
  {
    id: "live.fatto",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: `${C}: il colore del documento attenuato, diverso solo di giorno (di notte coincide): vedi la voce sopra`,
  },
  {
    id: "live.richiamo",
    proprieta: ["padding-top","padding-right","padding-bottom","padding-left","row-gap","column-gap","border-top-width","border-top-style","border-top-color","border-right-width","border-right-style","border-right-color","border-bottom-width","border-bottom-style","border-bottom-color","border-left-width","border-left-style","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","box-shadow","font-family","font-size","line-height","background-color","display"],
    perche: `${C}: il richiamo: nel prototipo una riga flessibile (icona e testo) col carattere di lettura; nell'app un blocco col carattere dell'interfaccia e l'icona nel margine. Prototipo → app: padding-top, padding-bottom: 14px → 12px; padding-right: 16px → 20px; padding-left: 16px → 44px; row-gap, column-gap: 12px → normal; border-top-width, border-right-width, border-bottom-width, border-left-width: 0px → 1px; border-top-style, border-right-style, border-bottom-style, border-left-style: none → solid; border-top-color, border-right-color, border-bottom-color, border-left-color: none → rgb(209, 218, 212) (giorno 1280, giorno 700); none → rgb(41, 51, 45) (notte 1280, notte 700); border-top-left-radius, border-top-right-radius, border-bottom-right-radius, border-bottom-left-radius: 10px → 8px; box-shadow: color(srgb 0 0.43 0.27 / 0.14) 0px 0px 0px 1px inset → none (giorno 1280, giorno 700); color(srgb 0.32 0.76 0.55 / 0.14) 0px 0px 0px 1px inset → none (notte 1280, notte 700); font-family: Newsreader, Georgia, "Times New Roman", serif → "Hanken Grotesk Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 18px → 14px; line-height: 29.16px → 21.7px; background-color: color(srgb 0.92 0.96 0.94) → rgb(243, 247, 244) (giorno 1280, giorno 700); color(srgb 0.08 0.14 0.11) → rgb(27, 36, 30) (notte 1280, notte 700); display: flex → block`,
  },
  {
    id: "live.richiamo-titolo",
    proprieta: ["line-height","color","margin-right","margin-bottom"],
    perche: `${C}: il titolo del richiamo. Prototipo → app: line-height: 19.6px → 21.7px; color: rgb(0, 96, 60) → rgb(31, 41, 35) (giorno 1280, giorno 700); rgb(117, 217, 166) → rgb(218, 224, 220) (notte 1280, notte 700); margin-right: 0px → 4px; margin-bottom: 2px → 0px`,
  },
  {
    id: "live.collegamento",
    proprieta: ["color","text-decoration-color","text-underline-offset"],
    perche: `${C}: il collegamento: nel prototipo testo del documento sottolineato in verde, nell'app testo verde. Prototipo → app: color: rgb(31, 41, 35) → rgb(0, 114, 73) (giorno 1280, giorno 700); rgb(218, 224, 220) → rgb(83, 196, 142) (notte 1280, notte 700); text-decoration-color: color(srgb 0 0.43 0.27 / 0.5) → oklab(0.48 -0.10 0.03 / 0.42) (giorno 1280, giorno 700); color(srgb 0.32 0.76 0.55 / 0.5) → oklab(0.74 -0.12 0.04 / 0.42) (notte 1280, notte 700); text-underline-offset: 3px → 3.96px`,
  },
  {
    id: "live.ripiegabile-titolo",
    proprieta: ["line-height"],
    perche: `${C}: la riga del ripiegabile: la stessa interlinea del paragrafo. Prototipo → app: line-height: 29.16px → 29.7px`,
  },
  {
    id: "live.ripiegabile-freccia",
    proprieta: ["height","padding-right","padding-left","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"],
    perche: `${C}: la freccia del ripiegabile. Prototipo → app: height: 22px → 18px; padding-right, padding-left: 0px → 2.7px; border-top-left-radius, border-top-right-radius, border-bottom-right-radius, border-bottom-left-radius: 5px → 4px`,
  },
  {
    id: "live.immagine",
    proprieta: ["border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","background-color"],
    perche: `${C}: gli angoli e il fondo dell'immagine. Prototipo → app: border-top-left-radius, border-top-right-radius, border-bottom-right-radius, border-bottom-left-radius: 10px → 6px; background-color: rgba(23, 34, 27, 0.08) → rgba(0, 0, 0, 0) (giorno 1280, giorno 700); rgba(228, 233, 230, 0.11) → rgba(0, 0, 0, 0) (notte 1280, notte 700)`,
  },
  {
    id: "live.didascalia",
    proprieta: ["font-size", "line-height", "padding-top"],
    perche: `${C}: la didascalia dell'immagine. Prototipo → app: font-size: 13px → 12px; line-height: 19.5px → 17.4px; color: rgb(91, 102, 95) → rgb(87, 98, 91) (giorno 1280, giorno 700); padding-top: 8px → 0px`,
  },
  {
    id: "live.didascalia",
    proprieta: ["color"],
    stati: ["chiaro-1280", "chiaro-700"],
    perche: `${C}: il colore del documento attenuato, diverso solo di giorno (di notte coincide): vedi la voce sopra`,
  },
  {
    id: "live.trasclusione",
    proprieta: ["line-height"],
    perche: `${C}: la trasclusione: la stessa interlinea del paragrafo. Prototipo → app: line-height: 29.16px → 29.7px`,
  },
  {
    id: "live.scadenza-vicina",
    proprieta: ["padding-top","padding-bottom","margin-left","row-gap","column-gap","font-size","line-height","height"],
    perche: `${C}: la pastiglia della scadenza vicina. Prototipo → app: padding-top, padding-bottom: 0px → 1.72px; margin-left: 4px → 0px; row-gap, column-gap: 4px → normal; font-size: 12px → 14.4px; line-height: 12px → 23.76px; height: 21px → auto`,
  },
  // ── blocchi Live: ciò che il banco non apre ancora ──────────────────────
  {
    id: "live.scheda-nota",
    prototipo: ".card",
    app: ".cm-fub-note-card",
    perche: `${C}: la scheda di una nota (un paragrafo che è solo il collegamento a una nota) c'è nell'app (\`link-card.ts\`), ma nessuna scena del banco la mostra; aggiungerla vuole le foto del runner`,
  },
  {
    id: "live.scheda-nota-titolo",
    prototipo: ".card-t",
    app: ".cm-fub-note-card-title",
    perche: `${C}: come la scheda della nota; nel prototipo il titolo è 600 16 px/1.3 col carattere di lettura`,
  },
  {
    id: "live.scheda-nota-copertina",
    prototipo: ".card-img",
    app: ".cm-fub-note-card-cover",
    perche: `${C}: come la scheda della nota; nel prototipo la copertina è larga 132 px`,
  },
  {
    id: "live.richiamo-icona",
    prototipo: ".callout-i",
    app: ".pane.focus .cm-markdown-block .callout-title::before",
    perche: `${C}: nel prototipo l'icona del richiamo è un elemento a sé, 20 px, accanto al testo; nell'app è nel margine sinistro del richiamo (44 px di rientro) e non ha un elemento da leggere`,
  },
  {
    id: "live.scadenza",
    prototipo: ".due:not(.soon)",
    app: ".pane.focus .cm-fub-due:not(.cm-fub-due-near)",
    perche: `${C}: la scadenza lontana (grigia): la scena dei promemoria ha solo una scadenza vicina`,
  },
  {
    id: "live.persona",
    prototipo: ".pill-in.at",
    app: ".pane.focus .cm-fub-person",
    perche: `${C}: la persona in riga (@): nessuna scena della Live la mostra`,
  },
  {
    id: "live.ripiegabile-corpo",
    prototipo: ".toggle-b",
    app: ".pane.focus .cm-fub-details-body",
    perche: `${C}: il prototipo ha il ripiegabile chiuso in ogni passo: il corpo non è visibile dal suo lato`,
  },
  // ── fogli stretti: le differenze misurate ───────────────────────────────
  {
    id: "foglio.pagina",
    proprieta: ["padding-left","padding-right"],
    perche: `${C}: i margini della pagina nel foglio stretto: il prototipo tiene 60 e 24 px (\`cornice-embed.css\`), l'app li stringe a 104/96 a 620, 40/20 a 540 e 18 sotto. Prototipo → app: padding-left: 60px → 104px (620); 60px → 40px (540); 60px → 18px (400, 340); padding-right: 24px → 96px (620); 24px → 20px (540); 24px → 18px (400, 340)`,
  },
  {
    id: "foglio.inserisci",
    proprieta: ["width","padding-left","padding-right"],
    perche: `${C}: «Inserisci» nel foglio stretto: il prototipo lo riduce all'icona, l'app tiene la parola. Prototipo → app: width: 85.35px → 83.64px (620); 28px → 83.64px (540, 400, 340); padding-left: 6px → 8px (540, 400, 340); padding-right: 6px → 10px (540, 400, 340)`,
  },
  {
    id: "foglio.copertina",
    proprieta: ["margin-left", "margin-right"],
    perche: `${C}: la copertina segue i margini della pagina, dai due lati (misurata con \`--attese\`, il pezzo aspetta #421). Prototipo → app: margin-left: -60px → -104px (620); -60px → -40px (540); -60px → -18px (400, 340); margin-right: -24px → -96px (620); -24px → -20px (540); -24px → -18px (400, 340)`,
  },
  // ── fogli stretti: ciò che non si legge come stile ──────────────────────
  {
    id: "foglio.gruppi-barra",
    prototipo: ".fbar > .fg",
    app: ".pane.focus .format-bar > .format-bar-group",
    perche: `${C}: nel foglio stretto il prototipo toglie il primo gruppo (annulla e ripeti) a 400 px e sotto, e il quarto a 340 e sotto (\`cornice-embed.css\`), senza un menu «Altro»; l'app tiene sempre annulla e ripeti e toglie i gruppi da destra: a 340 restano annulla e ripeti, lo stile del blocco, «Altro» e «Inserisci». Un gruppo nascosto non ha stili da leggere: si confronta guardando quali restano`,
  },
  {
    id: "foglio.sbirciata",
    prototipo: ".peek",
    app: ".note-peek",
    perche: `${C}: nel foglio sotto i 620 px la sbirciata del prototipo prende tutto il foglio meno 40 px; l'app ha \`.note-peek\`, ma nessuna scena del banco la apre`,
  },
];
