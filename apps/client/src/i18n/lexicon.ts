// Il lessico dei menu: un solo nome per ogni azione, in tutta l'app. Le
// parole a sinistra sono quelle che Fub dice; quelle a destra sono le varianti
// che non devono rientrare. `ui/menu-budget.test.ts` le cerca nelle voci di
// ogni menu.

export interface LexiconEntry {
  /// Come si dice.
  readonly say: string;
  /// Le varianti che non si dicono più.
  readonly instead: readonly string[];
  /// Perché.
  readonly why: string;
}

export const LEXICON: readonly LexiconEntry[] = [
  { say: "Sposta nel cestino", instead: ["Cestina"], why: "Dice che cosa succede davvero, e che si può recuperare" },
  { say: "Togli il link", instead: ["Rimuovi il link"], why: "«Togli» quando il contenuto resta altrove" },
  { say: "Apri con un'altra app", instead: ["Apri con l'app di sistema", "Apri con l'applicazione esterna"], why: "Corto, e vale anche per le app Craft" },
  { say: "Mostra nella cartella del sistema", instead: ["Mostra nel file manager"], why: "«File manager» non lo dice nessuno" },
  { say: "Copia il percorso", instead: ["Copia percorso"], why: "Sempre con l'articolo" },
  { say: "Copia il link", instead: ["Copia la destinazione"], why: "Il link nella forma che Fub incolla; per un indirizzo web «Copia l'indirizzo»" },
  { say: "Incolla senza formattazione", instead: ["Incolla come testo semplice"], why: "Dice che cosa si perde" },
  { say: "Cerca nel documento", instead: ["Cerca nella nota"], why: "Vale per tutto" },
  { say: "Mostra nell'esploratore", instead: ["Mostra la nota attiva nell'albero"], why: "Dice dove, senza «attiva»" },
  { say: "Tabella", instead: ["Inserisci tabella"], why: "Il verbo sta già nel sottomenu" },
  { say: "Riquadro, Elenco di attività, Blocco di codice, Colonne", instead: ["Callout", "In colonne"], why: "Le stesse parole dei comandi e del «/»" },
  { say: "Pagina web", instead: ["Segnalibro web"], why: "«Pagina web» è la parola della lavagna" },
  { say: "Arancione, Blu", instead: ["Arancio", "Azzurro"], why: "Una tavolozza sola: i nove colori dei Blocchi" },
  // I componenti (K2): le parole della pagina Componenti, del riquadro «solo
  // come file» e della riga di comando sono queste, dappertutto.
  { say: "Componente", instead: ["Plugin", "Estensione", "Modulo"], why: "Una parola sola per ciò che si accende e si spegne" },
  { say: "Accendi", instead: ["Abilita", "Attiva il componente"], why: "Come un interruttore, che è ciò che si tocca" },
  { say: "Spegni", instead: ["Disabilita", "Disattiva"], why: "Il contrario di «Accendi»" },
  { say: "Serve a", instead: ["Serve per", "Richiesto da", "Necessario a", "Usato da"], why: "Dice chi ne ha bisogno, senza gergo" },
  { say: "Non serve più", instead: ["Orfano", "Inutilizzato", "Non più necessario"], why: "Dice perché si può togliere" },
  { say: "Togli", instead: ["Disinstalla"], why: "Si spegne, e i file restano" },
  { say: "Tienili", instead: ["Mantienili", "Conservali"], why: "Corto, e risponde a «Non servono più»" },
  { say: "Profilo", instead: ["Preset"], why: "Un insieme di componenti con un nome" },
  { say: "personalizzato", instead: ["Personalizzata", "Custom"], why: "Il profilo, al maschile e in italiano" },
  { say: "più avanti", instead: ["In arrivo", "Prossimamente"], why: "Non promette una data" },
  { say: "solo come file", instead: ["Solo file", "Non supportato", "Formato sconosciuto"], why: "Il file c'è e si apre altrove: dice che cosa si può fare lo stesso" },
];

/// Le varianti, tutte: nessuna voce di menu le contiene. «Arancio» è anche
/// dentro «Arancione»: si cerca come parola intera.
export const FORBIDDEN: readonly string[] = LEXICON.flatMap((entry) => entry.instead);

/// La voce `label` usa una variante vietata (come parola o frase intera).
export function forbiddenIn(label: string): string | null {
  for (const word of FORBIDDEN) {
    const at = label.indexOf(word);
    if (at < 0) continue;
    const before = label[at - 1];
    const after = label[at + word.length];
    if ((before === undefined || !/\p{L}/u.test(before)) && (after === undefined || !/\p{L}/u.test(after))) return word;
  }
  return null;
}
