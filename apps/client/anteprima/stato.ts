// A che punto è il lavoro sull'editor di FubDraw: l'elenco che la pagina
// d'anteprima mostra accanto al foglio. Si aggiorna a mano quando un pacchetto
// cambia stato, nello stesso commit che lo porta nell'anteprima.

export type Stato = "qui" | "shell" | "revisione" | "corso" | "prossimo";

export interface Pacchetto {
  readonly codice: string;
  readonly titolo: string;
  readonly stato: Stato;
  /// La PR in bozza su Fubeo/Fub, se c'è.
  readonly pr?: number;
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
      "Il foglio è un file .svg: ogni tratto è un add, Svuota un batch di remove, annulla e ripeti l'undo esatto del motore. " +
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
    codice: "FD-405",
    titolo: "Plugin WASM versione 0",
    stato: "corso",
    nota: "Nel repo di FubDraw: il primo plugin di Fub che legge le scene.",
  },
  {
    codice: "FD-204",
    titolo: "Painter e strati inerti",
    stato: "prossimo",
    nota: "Prende il posto della cucitura provvisoria di questa pagina.",
  },
  {
    codice: "FD-205",
    titolo: "Strumenti del livello Essenziale",
    stato: "prossimo",
    nota: "Gomma, forme, selezione e il campo «Che cosa hai disegnato?».",
  },
  {
    codice: "FD-206b",
    titolo: "La superficie nella shell",
    stato: "prossimo",
    nota: "Da lì il disegno si apre nella shell, come una nota.",
  },
];

export const ORDINE_STATI: readonly Stato[] = ["qui", "shell", "revisione", "corso", "prossimo"];
