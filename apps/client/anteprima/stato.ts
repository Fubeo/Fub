// A che punto è il lavoro sull'editor di FubDraw: l'elenco che la pagina
// d'anteprima mostra accanto al foglio. Si aggiorna a mano quando un pacchetto
// cambia stato, nello stesso commit che lo porta nell'anteprima.

export type Stato = "qui" | "shell" | "revisione" | "corso" | "prossimo";

export interface Pacchetto {
  readonly codice: string;
  readonly titolo: string;
  readonly stato: Stato;
  /// La PR in bozza, se c'è: su Fubeo/Fub, se `repo` non dice altro.
  readonly pr?: number;
  /// Il repository della PR quando non è Fub.
  readonly repo?: "FubDraw";
  /// Dove si vede, o che cosa manca, in una riga.
  readonly nota: string;
}

export const STATI: Readonly<Record<Stato, string>> = {
  qui: "In questa pagina",
  shell: "Nella shell",
  revisione: "Fatto, in revisione",
  corso: "In corso",
  prossimo: "Prossimi",
};

export const PACCHETTI: readonly Pacchetto[] = [
  {
    codice: "FD-207",
    titolo: "Accessibilità della superficie",
    stato: "qui",
    pr: 115,
    nota:
      "Clicca sul foglio, poi lascia il mouse: le frecce muovono il cursore, Spazio preme e rilascia, e ogni strumento disegna da tastiera. " +
      "Con una selezione le frecce la spostano, Ctrl+frecce la ridimensionano, Tab passa all'oggetto dopo e Invio apre le misure. " +
      "«Oggetti» apre l'albero, «?» l'elenco dei tasti; nella shell la Lettura (Ctrl+E) dice la descrizione e gli oggetti.",
  },
  {
    codice: "FD-205",
    titolo: "Strumenti del livello Essenziale",
    stato: "qui",
    pr: 110,
    nota:
      "L'editor del foglio: selezione, penna, gomma, rettangolo, ellisse, linea e freccia, otto colori con la loro forma, " +
      "tre spessori, annulla e ripeti per gesto, tastiera e annunci, e il campo «Che cosa hai disegnato?».",
  },
  {
    codice: "FD-204",
    titolo: "Painter e strati inerti",
    stato: "qui",
    pr: 108,
    nota:
      "Il foglio lo disegna il painter dalla scena del motore: gli oggetti modificabili negli strati vivi, " +
      "il resto in immagini inerti; il tratto in corso, le forme e gli spostamenti come anteprime sopra la scena.",
  },
  {
    codice: "FD-203",
    titolo: "Penna e pennello pf1",
    stato: "qui",
    pr: 99,
    nota: "Ogni tratto del foglio passa dalla pipeline vera: penna, mouse e dito, palmo ignorato, campioni quantizzati e contorno pf1.",
  },
  {
    codice: "FD-202",
    titolo: "Motore delle operazioni",
    stato: "qui",
    pr: 107,
    nota:
      "Il foglio è un file .svg: ogni gesto è un'operazione, o un batch, e annulla e ripeti l'undo esatto del motore. " +
      "Il pannello del file mostra le righe che cambiano.",
  },
  {
    codice: "FD-201",
    titolo: "La scena in TypeScript",
    stato: "qui",
    pr: 106,
    nota: "Ogni tratto del foglio è riletto dal testo del file, con il codec di fub:ink e il pennello.",
  },
  {
    codice: "FD-101",
    titolo: "Camera condivisa",
    stato: "qui",
    pr: 96,
    nota: "Zoom al cursore e adatta alla finestra, con i limiti 0,1…32 della superficie.",
  },
  {
    codice: "FD-206b",
    titolo: "La superficie del disegno nella shell",
    stato: "shell",
    pr: 113,
    nota:
      "Nella shell (/index.html): apri Disegni/Casa.svg dall'esplora e disegna; Ctrl+E passa alla Lettura. " +
      "Logo esterno.svg si guarda come immagine, e «Modifica» lo adotta; Rotto.svg dice perché non si legge. " +
      "«Apri come sorgente», dalla palette (Ctrl+Maiusc+P), mostra il testo sulla stessa sessione.",
  },
  {
    codice: "FD-206a",
    titolo: "Modalità per ruolo e vista sorgente",
    stato: "shell",
    pr: 100,
    nota: "Nella shell: apri una nota, poi la palette (Ctrl+Maiusc+P) e «Passa a Sorgente» o «Passa a Live».",
  },
  {
    codice: "FD-102–105",
    titolo: "fub-scene, il lettore Rust delle scene",
    stato: "revisione",
    pr: 102,
    nota: "Classifica, indicizza e diagnostica i file .svg di FubDraw.",
  },
  {
    codice: "FD-005",
    titolo: "ADR 0203, superfici spaziali su sorgenti SVG",
    stato: "revisione",
    pr: 95,
    nota: "La decisione su cui poggia tutto il resto.",
  },
  {
    codice: "FD-301",
    titolo: "ADR 0204, sessione live",
    stato: "revisione",
    pr: 101,
    nota: "Proposta: si accoglie dopo le misure sul tablet.",
  },
  {
    codice: "FD-106–107",
    titolo: "Il formato svg nel kernel",
    stato: "revisione",
    pr: 105,
    nota: "I disegni diventano file del vault: indicizzati, cercabili, incorporabili nelle note.",
  },
  {
    codice: "FD-302",
    titolo: "fub-live, protocollo e server",
    stato: "revisione",
    pr: 103,
    nota: "Il server della sessione live: il tablet come penna del PC.",
  },
  {
    codice: "FD-303",
    titolo: "Adattatore Tauri della sessione live",
    stato: "revisione",
    pr: 104,
    nota: "Il canale fra fub-live e la shell.",
  },
  {
    codice: "FD-208",
    titolo: "Disegni incorporati nelle note",
    stato: "revisione",
    pr: 109,
    nota: "In Lettura, ![[disegno]] è un'immagine del vault col nome del disegno come testo alternativo.",
  },
  {
    codice: "FD-403",
    titolo: "Comandi di export",
    stato: "revisione",
    pr: 111,
    nota: "Esportare un disegno in PNG e PDF, per chi lo apre fuori da Fub.",
  },
  {
    codice: "FD-405",
    titolo: "Plugin WASM versione 0",
    stato: "revisione",
    pr: 38,
    repo: "FubDraw",
    nota: "Il primo plugin di Fub che legge le scene: galleria dei disegni, ispezione e lint.",
  },
  {
    codice: "FD-501",
    titolo: "Provider fubann",
    stato: "revisione",
    pr: 112,
    nota: "Il formato delle annotazioni sui PDF: il collegamento al PDF annotato e il testo delle note, cercabile nel vault.",
  },
  {
    codice: "FD-209",
    titolo: "«Nuovo disegno» e immagini incollate",
    stato: "corso",
    pr: 114,
    nota: "«Nuovo disegno» dalla palette è fatto, in revisione; lo screenshot incollato da annotare è in corso.",
  },
  {
    codice: "FD-502",
    titolo: "Profilo pdf",
    stato: "corso",
    nota: "Annotare un PDF del vault: le pagine come sfondo, e il PDF resta com'è.",
  },
  {
    codice: "FD-304",
    titolo: "La sessione live nella shell",
    stato: "corso",
    nota: "Il tablet come penna del PC: l'inchiostro effimero, il QR, «Segui il tablet».",
  },
  {
    codice: "FD-210",
    titolo: "Banco del disegno",
    stato: "prossimo",
    nota: "Prestazioni, fotografie e accessibilità della superficie misurate nella CI.",
  },
  {
    codice: "FD-503",
    titolo: "Export del PDF annotato",
    stato: "prossimo",
    nota: "Un PDF nuovo con le annotazioni; l'originale non si scrive mai.",
  },
];

export const ORDINE_STATI: readonly Stato[] = ["qui", "shell", "revisione", "corso", "prossimo"];
