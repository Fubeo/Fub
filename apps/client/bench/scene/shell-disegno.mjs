// La shell: il disegno, la Lavagna e i PDF.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.
import {
  clicSullEllisse,
  clicSullEllisseSemplice,
  focusWorkspaceButton,
  importBrokenKeySet,
  livelliCambiati,
  livelliFiltrati,
  openAllinea,
  openCampioni,
  openColoreTesto,
  openColumnGroup,
  openDesignoScelto,
  openDesignoVuoto,
  openDrawerScene,
  openDrawing,
  openDrawingKeys,
  openDrawingStanding,
  openDrawingWindow,
  openElaborazione,
  openEnginePrefs,
  openFormeFinestra,
  openFormeTendina,
  openLivelli,
  openMenuOggetto,
  openMenuUguale,
  openNavigatore,
  openNuovoCampione,
  openRailFlyout,
  openRighelli,
  openRisorse,
  openRuotaFinestra,
  openSaturaFinestra,
  openSezioneConUno,
  openSezionePunto,
  openSezioniTesto,
  openSpostaTracciato,
  openTavolozza,
  openTrasformaSezione,
  openUgualeTratto,
  openVisualizza,
  openWorkspaceErrorMenu,
  openWorkspaceMenu,
  openZoomMenu,
  scegliSelezioneDiretta,
  scegliSelezioneDirettaCoiPunti,
  sceltaConIlClic,
  scriviColTesto,
} from "./gesti-disegno.mjs";
import { openBoard } from "./gesti-scrittura.mjs";

export const S_DISEGNO = [
  // **Il disegno**: il disegno dei connettori (`?connectors=6`, vedi
  // `fake-ipc.ts`), aperto e guardato com'è prima che l'impianto nuovo lo
  // rifaccia, largo e stretto. Le scene della colonna, dell'ispettore, del
  // menu e di «Semplice» arrivano con i loro cantieri.
  {
    id: "draw-open",
    title: "Il disegno appena aperto",
    query: "connectors=6",
    prepare: openDrawing,
  },
  // Il chip del motore del disegno (K5 T23, `?drawing=`, vedi `fake-ipc.ts`):
  // acceso con due parti che restano come sono, spento con «Accendi…», fermo
  // con «Riprova»; il chip premuto, col suo riquadro aperto (scene «2a», «3»
  // e «4» del prototipo `PLAN-ui/disegno-motore.html`, che resta nella storia
  // del ramo `piano/k5-disegno`, fino a 3d13d26e6).
  ...[
    ["draw-engine-on", "acceso", "Il disegno col motore acceso: due parti restano come sono, e «Che cosa manca?» aperto"],
    ["draw-engine-off", "spento", "Il disegno col motore spento: gli strumenti semplici, e «Accendi…»"],
    ["draw-engine-error", "errore", "Il disegno col motore fermo: gli strumenti semplici, e «Riprova»"],
  ].map(([id, drawing, title]) => ({
    id,
    title,
    query: `connectors=6&drawing=${drawing}`,
    prepare: (page) => openDrawingStanding(page, drawing === "acceso"),
  })),
  {
    id: "draw-selection",
    title: "Il disegno con un oggetto scelto da tastiera",
    query: "connectors=6",
    prepare: async (page) => {
      await openDrawing(page);
      await page.keyboard.press("v");
      // L'ellisse del disegno: la prima forma.
      const shape = await page.locator(".draw-editor .draw-surface ellipse[data-scene-id]").first().boundingBox();
      if (!shape) throw new Error("l'ellisse del disegno non c'è");
      await page.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    },
  },
  // Stretto: 900 px, e 800, la finestra minima del desktop (sotto, la shell
  // è quella del telefono).
  ...[
    ["draw-narrow", 900, "Il disegno in una finestra di 900 px"],
    ["draw-narrow-800", 800, "Il disegno nella finestra minima, 800 px"],
  ].map(([id, width, title]) => ({
    id,
    title,
    query: "connectors=6",
    viewport: { width, height: 800 },
    prepare: openDrawing,
  })),
  // **La scheda Risorse** (K6 T10): il Disegno completo, con la scheda Risorse
  // aperta. `campioni` dice quanti campioni del documento ha il disegno
  // (`?campioni=N`, vedi `fake-ipc.ts`): 24 come il prototipo, 500 per lo stato
  // con molte voci, 0 per il vuoto.
  ...[
    ["disegno-risorse", 24, "La scheda Risorse con 24 campioni del documento"],
    ["disegno-risorse-molti", 500, "La scheda Risorse con 500 campioni: scorre dentro la scheda, senza spostare il resto"],
    ["disegno-risorse-vuoto", 0, "La scheda Risorse senza campioni: lo stato vuoto"],
  ].map(([id, campioni, title]) => ({
    id,
    title,
    query: `connectors=6&drawing=acceso&campioni=${campioni}`,
    prepare: openRisorse,
  })),
  // **Design** (K6 T10): con un punto scelto (Posizione e misure), e senza
  // nulla scelto (il documento, con le sezioni del registro), a 1280 px. Sotto
  // gli 800 px del desktop la shell è quella del telefono, senza ispettore: il
  // Design a 700 px non ha una scena desktop.
  {
    id: "disegno-design",
    title: "Design con un punto scelto: Posizione e misure, a 1280 px",
    query: "connectors=6&drawing=acceso",
    prepare: openDesignoScelto,
  },
  {
    id: "disegno-design-vuoto",
    title: "Design senza nulla scelto: il documento, a 1280 px",
    query: "connectors=6&drawing=acceso",
    prepare: openDesignoVuoto,
  },
  // **La finestra del comando** (K6 T6, «Sposta tracciato» del prototipo
  // `PLAN-ui/disegno-completo.html`): la famiglia pronta, con l'anteprima accesa
  // a destra del foglio; la famiglia che si carica, e quella che non si carica
  // (la memoria dei motori piena, con «Riprova»). Ognuna a 1280 e a 700 px, in
  // giorno e notte. Le risposte sono quelle finte del motore del banco
  // (`fake-ipc.ts`, `window.bench.finestra`).
  ...[
    ["disegno-finestra", "finestra", "La finestra «Sposta tracciato» sul disegno, con l'anteprima accesa: lascia vedere il foglio"],
    ["disegno-finestra-caricamento", "caricamento", "La finestra mentre la famiglia si carica: il caricamento, e OK spento"],
    ["disegno-finestra-errore", "errore", "La finestra quando la famiglia non si carica: la memoria dei motori è piena, e «Riprova»"],
  ].flatMap(([id, stato, title]) => [
    {
      id,
      title,
      query: "connectors=6&drawing=acceso",
      prepare: (page) => openDrawingWindow(page, stato),
    },
    {
      id: `${id}-800`,
      title: `${title}, nella finestra minima del desktop (800 px)`,
      query: "connectors=6&drawing=acceso",
      viewport: { width: 800, height: 800 },
      prepare: (page) => openDrawingWindow(page, stato),
    },
  ]),
  // **Lo spazio di lavoro nella banda** (K6 T7): il bottone accanto alla
  // modalità, il suo menu aperto (Semplice, Completo, gli otto spazi del
  // Completo, le azioni), il Completo spento, il Completo che non si carica, e
  // il fuoco da tastiera. A 1280 e a 700 px, in giorno e in notte.
  ...[
    ["disegno-banda", 1280, "Lo spazio di lavoro nella banda, accanto alla modalità", null, openDrawing],
    ["disegno-banda-800", 800, "Lo spazio di lavoro nella banda in un foglio stretto, 800 px, la finestra minima del desktop", null, openDrawing],
    ["disegno-banda-aperta", 1280, "Lo spazio di lavoro aperto: Semplice, Completo, gli spazi del Completo, Ripristina, Salva e Gestisci", null, openWorkspaceMenu],
    ["disegno-banda-aperta-800", 800, "Lo spazio di lavoro aperto in un foglio stretto, 800 px, la finestra minima del desktop", null, openWorkspaceMenu],
    ["disegno-spento", 1280, "Il disegno completo spento: gli spazi del Completo grigi, con il perché, e «Apri Componenti…»", "componenti=motore-spento", openWorkspaceMenu],
    ["disegno-banda-errore", 1280, "Il disegno completo non si carica: il menu lo dice, e «Riprova»", null, openWorkspaceErrorMenu],
    ["disegno-banda-fuoco", 1280, "Il bottone dello spazio di lavoro col fuoco da tastiera", null, focusWorkspaceButton],
  ].map(([id, width, title, extra, prepare]) => ({
    id,
    title,
    query: extra === null ? "connectors=6" : `connectors=6&${extra}`,
    viewport: { width, height: 800 },
    prepare,
  })),
  // **La colonna del Completo** (K6 T8): la colonna a sei gruppi, la tendina di
  // una casella, il cassetto «Tutti gli strumenti» (con la ricerca), e la colonna
  // del Completo spento. A 1280 e a 700 px, in giorno e in notte.
  ...[
    ["disegno-completo", 1280, "La colonna del Completo: sei gruppi, le caselle che stanno, «Tutti gli strumenti» in fondo", null, openDrawing],
    ["disegno-completo-800", 800, "La colonna del Completo nella finestra minima del desktop, 800 px", null, openDrawing],
    ["disegno-gruppo", 1280, "La tendina della casella a più strumenti, aperta da tastiera con la freccia di lato", null, openColumnGroup],
    ["disegno-gruppo-800", 800, "La tendina della casella nella finestra minima del desktop, 800 px", null, openColumnGroup],
    ["disegno-cassetto", 1280, "Tutti gli strumenti: il cassetto con i gruppi per famiglia", null, openDrawerScene],
    ["disegno-cassetto-800", 800, "Il cassetto nella finestra minima del desktop, 800 px", null, openDrawerScene],
    ["disegno-cassetto-cerca", 1280, "Il cassetto con la ricerca scritta: restano i nomi che la contengono", null, (page) => openDrawerScene(page, "pe")],
    ["disegno-spento-colonna", 1280, "La colonna del Completo spento: la colonna nativa, 44 px di larghezza", "componenti=motore-spento", openDrawing],
  ].map(([id, width, title, extra, prepare]) => ({
    id,
    title,
    query: extra === null ? "connectors=6" : `connectors=6&${extra}`,
    viewport: { width, height: 800 },
    prepare,
  })),
  // **La famiglia «nucleo»** (K6 T11): gli strumenti del motore per scegliere
  // e per la vista nella colonna del Completo, col motore del banco acceso; la
  // tendina della casella «Scegli» aperta, e la Selezione diretta scelta (la
  // sua famiglia pronta, la fila delle opzioni in testata senza un gesto).
  ...[
    ["disegno-fam-nucleo", 1280, "Il nucleo nella colonna: Selezione, Selezione diretta, Lazo e la vista del motore, coi nomi e le icone", openDrawing],
    ["disegno-fam-nucleo-800", 800, "Il nucleo nella colonna nella finestra minima del desktop, 800 px", openDrawing],
    ["disegno-fam-nucleo-tendina", 1280, "La tendina della casella «Scegli»: Selezione di Fub e Selezione del motore", openColumnGroup],
    ["disegno-fam-nucleo-diretta", 1280, "La Selezione diretta del motore scelta: la casella accesa, e la famiglia pronta senza un gesto", scegliSelezioneDiretta],
    ["disegno-fam-nucleo-diretta-800", 800, "La Selezione diretta del motore scelta nella finestra minima del desktop, 800 px", scegliSelezioneDiretta],
    // La famiglia «vista» (K6 T11): il menu dello zoom della banda, aperto dalla
    // sua voce come lo apre chi preme.
    ["disegno-fam-vista", 1280, "Il menu dello zoom della banda: ingrandisci, riduci, 100 %, adatta tutto e il campo della percentuale", openZoomMenu],
    ["disegno-fam-vista-800", 800, "Il menu dello zoom della banda nella finestra minima del desktop, 800 px", openZoomMenu],
    // ≡ › Visualizza del Completo (K6 T11, giro E) e il navigatore della banda.
    ["disegno-visualizza", 1280, "≡ › Visualizza del Completo: le voci che il client fa, con la spunta vera, e il sottomenu aperto", openVisualizza],
    ["disegno-visualizza-800", 800, "≡ › Visualizza del Completo nella finestra minima del desktop, 800 px", openVisualizza],
    ["disegno-navigatore", 1280, "Il navigatore della banda acceso: la panoramica del foglio in basso a destra, con il riquadro della vista", openNavigatore],
    ["disegno-navigatore-800", 800, "Il navigatore della banda nella finestra minima del desktop, 800 px", openNavigatore],
    ["disegno-righelli", 1280, "I righelli del bordo del foglio, accesi da ≡ › Visualizza: tacche e numeri nell'unità del documento", openRighelli],
    ["disegno-righelli-800", 800, "I righelli del bordo nella finestra minima del desktop, 800 px", openRighelli],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "connectors=6&drawing=acceso",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **La famiglia «tracciati»** (K6 T12): la tendina della casella «Penna»
  // aperta, coi nove strumenti del motore; la Selezione diretta con un punto
  // scelto (`?punti=1`), con la fila dei punti in testata. A 1280 e a 800 px.
  ...[
    ["disegno-fam-tracciati-penna", 1280, "La tendina della casella «Penna»: la Penna di Bézier e gli strumenti dei punti", "", (page) => openRailFlyout(page, "motore:pen")],
    ["disegno-fam-tracciati-penna-800", 800, "La tendina della casella «Penna» nella finestra minima del desktop, 800 px", "", (page) => openRailFlyout(page, "motore:pen")],
    ["disegno-fam-tracciati-punto", 1280, "La Selezione diretta con un punto scelto: Converti, Punto e la posizione del punto", "&punti=1", scegliSelezioneDirettaCoiPunti],
    ["disegno-fam-tracciati-punto-800", 800, "La Selezione diretta con un punto scelto nella finestra minima del desktop, 800 px", "&punti=1", scegliSelezioneDirettaCoiPunti],
    // La sezione «Punto di ancoraggio» del Design coi punti scelti (giro 4), e
    // Sposta tracciato con l'anteprima del banco (`disegno-famiglie/tracciati.json`).
    ["disegno-fam-tracciati-sezione", 1280, "La sezione «Punto di ancoraggio» del Design con un punto scelto: Converti in angolo o morbido", "&punti=1&comandi=risposti", openSezionePunto],
    ["disegno-fam-tracciati-sezione-800", 800, "La sezione «Punto di ancoraggio» nella finestra minima del desktop, 800 px", "&punti=1&comandi=risposti", openSezionePunto],
    ["disegno-fam-tracciati-sposta", 1280, "Sposta tracciato da Ctrl+/ con l'anteprima del motore sul foglio", "&comandi=risposti", openSpostaTracciato],
    ["disegno-fam-tracciati-sposta-800", 800, "Sposta tracciato con l'anteprima nella finestra minima del desktop, 800 px", "&comandi=risposti", openSpostaTracciato],
  ].map(([id, width, title, extra, prepare]) => ({
    id,
    title,
    query: `connectors=6&drawing=acceso${extra}`,
    viewport: { width, height: 800 },
    prepare,
  })),
  // **Elaborazione tracciati** (K6 T12, giro 5): le due forme sovrapposte di `?elabora=1`
  // scelte col clic, con la sezione «Elaborazione tracciati» del Design in vista; poi
  // Unione e Meno davanti premuti, col tracciato del banco (`disegno-famiglie/tracciati.json`)
  // al posto delle due forme. A 1280 e a 800 px.
  ...[
    ["disegno-fam-elaborazione", 1280, "Due forme sovrapposte scelte e la sezione Elaborazione tracciati del Design: i metodi forma e le operazioni", (page) => openElaborazione(page)],
    ["disegno-fam-elaborazione-800", 800, "La sezione Elaborazione tracciati nel cassetto dell'ispettore, 800 px, con le due forme scelte", (page) => openElaborazione(page)],
    ["disegno-fam-elaborazione-prima-800", 800, "Le due forme sovrapposte scelte, a cassetto chiuso, prima dell'elaborazione, 800 px", (page) => openElaborazione(page, null, { foglio: true })],
    ["disegno-fam-elaborazione-unione", 1280, "Dopo Unione: un tracciato solo, con lo stile della forma davanti", (page) => openElaborazione(page, "object.pathfinder.unite")],
    ["disegno-fam-elaborazione-unione-800", 800, "Dopo Unione nella finestra minima del desktop, 800 px", (page) => openElaborazione(page, "object.pathfinder.unite")],
    ["disegno-fam-elaborazione-meno", 1280, "Dopo Meno davanti: il rettangolo dietro senza la parte coperta dal cerchio", (page) => openElaborazione(page, "object.pathfinder.minusFront")],
    ["disegno-fam-elaborazione-meno-800", 800, "Dopo Meno davanti nella finestra minima del desktop, 800 px", (page) => openElaborazione(page, "object.pathfinder.minusFront")],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "connectors=6&drawing=acceso&elabora=1",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **La famiglia «forme»** (K6 T13, giro 2): la tendina della casella delle forme,
  // la finestra «Rettangolo» da Ctrl+/ con l'anteprima sul foglio, e la sezione
  // Allinea nel Design con il disegno scelto. A 1280 e a 800 px.
  ...[
    ["disegno-fam-forme", 1280, "La tendina della casella delle forme: Rettangolo, Ellisse, Poligono, coi nomi del Completo", "", openFormeTendina],
    ["disegno-fam-forme-800", 800, "La tendina della casella delle forme nella finestra minima del desktop, 800 px", "", openFormeTendina],
    ["disegno-fam-allinea", 1280, "La sezione Allinea nel Design con il disegno scelto: i pulsanti e «Allinea a»", "", openAllinea],
    ["disegno-fam-allinea-800", 800, "La sezione Allinea nella finestra minima del desktop, 800 px", "", openAllinea],
    ["disegno-fam-trasforma", 1280, "La finestra «Ruota…» di Oggetto › Trasforma, con l'anteprima sul foglio", "", openRuotaFinestra],
    ["disegno-fam-trasforma-800", 800, "La finestra «Ruota…» nella finestra minima del desktop, 800 px", "", openRuotaFinestra],
    ["disegno-fam-trasforma-sezione", 1280, "La sezione Trasforma nel Design: posizione, misura, rotazione, inclinazione e il riquadro", "", openTrasformaSezione],
    ["disegno-scelte-trasforma", 1280, "La sezione Trasforma con un oggetto scelto: X, Y, larghezza, altezza e rotazione dal pannello", "", (page) => openSezioneConUno(page, ".draw-transform-grid")],
    ["disegno-scelte-trasforma-800", 800, "La sezione Trasforma con un oggetto scelto, nel cassetto dell'ispettore, 800 px", "", (page) => openSezioneConUno(page, ".draw-transform-grid")],
    // Il colore (K6 T14, giro 1): la sezione Colore del Design con un oggetto scelto, e la finestra «Satura…»
    // di Modifica › Modifica colori con l'anteprima che il banco risponde (`disegno-famiglie/colore.json`).
    ["disegno-fam-colore", 1280, "La sezione Colore del Design con un oggetto scelto: riempimento attivo, contorno, Scambia, Nessuno e Di serie", "", (page) => openSezioneConUno(page, ".draw-color")],
    ["disegno-fam-colore-800", 800, "La sezione Colore con un oggetto scelto, nel cassetto dell'ispettore, 800 px", "", (page) => openSezioneConUno(page, ".draw-color")],
    // Il contorno e la sfumatura (K6 T15, giro 5): la prima forma con un contorno spesso e tratteggiato, o con
    // una sfumatura lineare a tre punti (`?aspetto=`, `fake-ipc.ts`), e la sua sezione del Design in vista.
    ["disegno-fam-contorno", 1280, "La sezione Contorno del Design con una forma dal contorno spesso e tratteggiato: spessore, estremi, angoli, trattino e spazio", "&aspetto=contorno", (page) => openSezioneConUno(page, '#surface-panel-draw-design [data-section="contorno"]')],
    ["disegno-fam-contorno-800", 800, "La sezione Contorno con il contorno tratteggiato, nel cassetto dell'ispettore, 800 px", "&aspetto=contorno", (page) => openSezioneConUno(page, '#surface-panel-draw-design [data-section="contorno"]')],
    ["disegno-fam-sfumatura", 1280, "La sezione Sfumatura del Design con una forma dalla sfumatura lineare a tre punti: tipo, angolo, la striscia e i punti", "&aspetto=sfumatura", (page) => openSezioneConUno(page, '#surface-panel-draw-design [data-section="sfumatura"]')],
    ["disegno-fam-sfumatura-800", 800, "La sezione Sfumatura con la sfumatura a tre punti, nel cassetto dell'ispettore, 800 px", "&aspetto=sfumatura", (page) => openSezioneConUno(page, '#surface-panel-draw-design [data-section="sfumatura"]')],
    // I campioni (K6 T14, giro 2): Risorse › Campioni con 24 campioni e uno scelto, la finestra «Nuovo
    // campione», e la sezione Colore con un testo scelto: il contorno che un testo non ha è «Nessuno», spento.
    ["disegno-fam-campioni", 1280, "Risorse › Campioni: la griglia dei campioni del documento, uno scelto, e le azioni", "&campioni=24", openCampioni],
    ["disegno-fam-campioni-800", 800, "Risorse › Campioni nel cassetto dell'ispettore, 800 px", "&campioni=24", openCampioni],
    ["disegno-fam-campioni-nuovo", 1280, "La finestra «Nuovo campione» di Risorse › Campioni: il nome, il colore e la nota del campione globale", "&campioni=24", openNuovoCampione],
    ["disegno-fam-campioni-nuovo-800", 800, "La finestra «Nuovo campione» nella finestra minima del desktop, 800 px", "&campioni=24", openNuovoCampione],
    ["disegno-fam-colore-testo", 1280, "La sezione Colore con un testo scelto: il riempimento, e il contorno «Nessuno» spento col perché", "", openColoreTesto],
    ["disegno-fam-colore-testo-800", 800, "La sezione Colore con un testo scelto, nel cassetto dell'ispettore, 800 px", "", openColoreTesto],
    // Il testo (K6 T16, giro 1): Carattere e Paragrafo del Design con un'etichetta scelta, e il Testo del
    // motore che scrive nella casella aperta da un clic (il banco risponde l'anteprima, `fake-ipc.ts`).
    ["disegno-fam-testo", 1280, "Carattere e Paragrafo del Design con un testo scelto: famiglia, stile, corpo, spaziatura e allineamento", "", openSezioniTesto],
    ["disegno-fam-testo-800", 800, "Carattere e Paragrafo con un testo scelto, nel cassetto dell'ispettore, 800 px", "", openSezioniTesto],
    ["disegno-fam-testo-scrive", 1280, "Il Testo del Completo: un clic apre la casella, e le parole scritte si vedono col cursore", "", scriviColTesto],
    ["disegno-fam-testo-scrive-800", 800, "Il Testo del Completo che scrive nella finestra minima del desktop, 800 px", "", scriviColTesto],
    ["disegno-fam-colore-satura", 1280, "La finestra «Satura…» di Modifica colori, con l'intensità in % e l'anteprima sul foglio", "&comandi=risposti", openSaturaFinestra],
    ["disegno-fam-colore-satura-800", 800, "La finestra «Satura…» nella finestra minima del desktop, 800 px", "&comandi=risposti", openSaturaFinestra],
    ["disegno-scelte-pannello", 1280, "Il pannello Design del Completo con un oggetto scelto: senza Posizione e misure né Distribuisci", "", (page) => openSezioneConUno(page, ".draw-properties")],
    ["disegno-scelte-pannello-800", 800, "Il pannello Design del Completo nel cassetto dell'ispettore, 800 px: senza i doppioni", "", (page) => openSezioneConUno(page, ".draw-properties")],
    ["disegno-fam-trasforma-sezione-800", 800, "La sezione Trasforma nel cassetto dell'ispettore, 800 px", "", openTrasformaSezione],
    ["disegno-selezione-uguale", 1280, "≡ › Selezione › Uguale con l'ellisse scelta: le voci accese, e il perché di quelle spente", "", openMenuUguale],
    ["disegno-selezione-uguale-800", 800, "Lo stesso menu nella finestra minima del desktop, 800 px", "", openMenuUguale],
    ["disegno-selezione-tratto", 1280, "Uguale › Colore tratto: l'ellisse e le due linee con lo stesso tratto scelte insieme sul foglio", "", openUgualeTratto],
    ["disegno-selezione-tratto-800", 800, "Lo stesso risultato nella finestra minima del desktop, 800 px", "", openUgualeTratto],
    ["disegno-clic-ellisse", 1280, "Un clic del mouse sull'ellisse del disegno: la barra di stato dice che è scelta", "", clicSullEllisse],
    ["disegno-clic-ellisse-semplice", 1280, "Lo spazio Semplice: un clic del mouse sull'ellisse la sceglie, come nel Completo", "", clicSullEllisseSemplice],
    ["disegno-trasparenza", 1280, "Design › Trasparenza con l'ellisse scelta col clic: l'opacità e il metodo di fusione coi valori", "", (page) => openSezioneConUno(page, "#surface-panel-draw-design .draw-transparency-blend", sceltaConIlClic)],
    ["disegno-trasparenza-800", 800, "La sezione Trasparenza nel cassetto dell'ispettore, 800 px: l'ellisse scelta col clic", "", (page) => openSezioneConUno(page, "#surface-panel-draw-design .draw-transparency-blend", sceltaConIlClic)],
    // La scheda Livelli del Completo (K6 T15, giro 4): l'albero nativo, coi comandi che passano dal motore del
    // banco (`fake-ipc.ts`, `benchLivelliOutcome`). Due livelli, uno con gli oggetti; poi uno rinominato e
    // bloccato e uno nascosto; poi il filtro.
    ["disegno-fam-livelli", 1280, "La scheda Livelli del Completo: due livelli, Livello 1 aperto con i suoi oggetti, il nuovo in cima", "", openLivelli],
    ["disegno-fam-livelli-stati", 1280, "La scheda Livelli: «Sfondo» rinominato e bloccato, Livello 1 nascosto, coi segni sulla riga", "", livelliCambiati],
    ["disegno-fam-livelli-stati-800", 800, "La scheda Livelli nel cassetto dell'ispettore, 800 px: un livello rinominato e bloccato, uno nascosto", "", livelliCambiati],
    ["disegno-fam-livelli-filtro", 1280, "La scheda Livelli col filtro «Ellisse»: l'ellisse e i connettori che ne partono, dentro il loro livello", "", livelliFiltrati],
    ["disegno-fam-forme-finestra", 1280, "La finestra delle misure del Rettangolo (Completo), aperta col clic sul foglio dopo la scelta nella tendina", "", openFormeFinestra],
    ["disegno-fam-forme-finestra-800", 800, "La finestra delle misure del Rettangolo nella finestra minima del desktop, 800 px", "", openFormeFinestra],
  ].map(([id, width, title, extra, prepare]) => ({
    id,
    title,
    query: `connectors=6&drawing=acceso${extra}`,
    viewport: { width, height: 800 },
    prepare,
  })),
  // **Il menu ≡ e Ctrl+/ del Completo** (K6 T9a): le voci dell'indice di prova
  // (`?indice=prova`, vedi `fake-ipc.ts`). Il menu ≡ con Oggetto aperto, e la
  // tavolozza con la ricerca «sposta», a 1280 e a 800 px (la finestra minima).
  ...[
    ["disegno-menu", 1280, "Il menu ≡ del Completo con Oggetto aperto: le voci dell'indice, e quelle spente col perché", openMenuOggetto],
    ["disegno-menu-800", 800, "Il menu ≡ del Completo nella finestra minima del desktop, 800 px", openMenuOggetto],
    ["disegno-tavolozza", 1280, "Ctrl+/ con la ricerca «sposta»: le voci col posto e il tasto, e il perché di quella spenta", openTavolozza],
    ["disegno-tavolozza-800", 800, "Ctrl+/ con la ricerca «sposta» nella finestra minima del desktop, 800 px", openTavolozza],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "connectors=6&drawing=acceso&indice=prova",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **I tasti del Disegno completo in Impostazioni › Scorciatoie** (K6 T9c):
  // la sezione col riquadro aperto, sui comandi dell'indice di prova, con un
  // tasto di Fub che copre (Ctrl+G), un conflitto vinto dall'ultimo assegnato
  // e un comando lasciato senza tasto (`?tasti=conflitto`, vedi `fake-ipc.ts`);
  // poi l'errore di un file d'insieme rotto, che non cambia niente.
  ...[
    ["scorciatoie-disegno", 1280, "Scorciatoie › Disegno completo: i comandi coi tasti, un tasto di Fub che copre e un conflitto", openDrawingKeys],
    ["scorciatoie-disegno-800", 800, "Scorciatoie › Disegno completo nella finestra minima del desktop, 800 px", openDrawingKeys],
    ["scorciatoie-disegno-errore", 1280, "Scorciatoie › Disegno completo: un file d'insieme rotto lo dice e non cambia niente", importBrokenKeySet],
  ].map(([id, width, title, prepare]) => ({
    id,
    title,
    query: "indice=prova&tasti=conflitto",
    viewport: { width, height: 800 },
    prepare,
  })),
  // **Le preferenze del motore in Impostazioni › Disegni** (K6 T11): il
  // riquadro «Motore del disegno» aperto con la categoria «Guide e griglia»
  // (colori, scelte, numeri con l'unità), largo e nella finestra minima; poi
  // un `draw.motore` scritto da un Fub più nuovo, in sola lettura col perché
  // (`?motore=`, vedi `fake-ipc.ts`).
  ...[
    ["impostazioni-motore", 1280, "prova", "Impostazioni › Disegni › Motore del disegno: le categorie del motore, «Guide e griglia» aperta"],
    ["impostazioni-motore-800", 800, "prova", "Impostazioni › Disegni › Motore del disegno nella finestra minima del desktop, 800 px"],
    ["impostazioni-motore-nuovo", 1280, "nuovo", "Impostazioni › Disegni › Motore del disegno: preferenze di un Fub più nuovo, in sola lettura col perché"],
    ["impostazioni-motore-nuovo-800", 800, "nuovo", "Impostazioni › Disegni › Motore del disegno in sola lettura, 800 px"],
  ].map(([id, width, motore, title]) => ({
    id,
    title,
    query: `drawing=acceso&motore=${motore}`,
    viewport: { width, height: 800 },
    prepare: openEnginePrefs,
  })),
  // **La lavagna** (T61): vuota, con le schede e con una scheda attiva, le
  // lavagne di `?lavagna=1` (vedi `fake-ipc.ts`). Le schede si raggiungono
  // col Tab, come le raggiunge chi usa la tastiera, e ognuna ha il suo nome.
  {
    id: "lavagna-vuota",
    title: "Una lavagna vuota: il Tab va al primo pulsante per cominciare",
    query: "lavagna=1",
    prepare: async (page) => {
      await openBoard(page, "Lavagne/Vuota.canvas");
      await page.keyboard.press("Tab");
      await page.waitForSelector(".pane.focus .canvas-blank button:focus");
    },
  },
  {
    id: "lavagna",
    title: "Una lavagna con un gruppo, quattro schede e tre fili, col fuoco su una scheda raggiunta col Tab",
    query: "lavagna=1",
    prepare: async (page) => {
      await openBoard(page, "Lavagne/Statistica.canvas");
      // Il gruppo, poi la prima scheda dentro.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.waitForSelector('.pane.focus .canvas-node[data-node="varianza"][aria-label]:focus');
    },
  },
  {
    id: "lavagna-attiva",
    title: "La stessa lavagna con la scheda della nota attiva, entrata con Invio",
    query: "lavagna=1",
    prepare: async (page) => {
      await openBoard(page, "Lavagne/Statistica.canvas");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
      await page.waitForSelector('.pane.focus .canvas-node[data-node="media"]:focus');
      await page.keyboard.press("Enter");
      await page.waitForSelector('.pane.focus .canvas-node[data-node="media"][data-card-active]');
    },
  },
];
