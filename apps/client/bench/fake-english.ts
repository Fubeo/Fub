// L'inglese della scenografia del banco.
//
// L'host vero parla la lingua della shell: titoli delle view, comandi,
// impostazioni e alberi delle view arrivano già tradotti dai cataloghi Rust.
// La scenografia di `fake-ipc.ts` è scritta in italiano, e con la shell in
// inglese le sue frasi restavano italiane accanto a quelle della shell. Qui
// sta la sua traduzione, presa dove c'è dai cataloghi veri (`fub-features`,
// `fub-host/src/settings.rs`).
//
// Si traduce **solo il testo dell'interfaccia**: i campi in `UI_FIELDS`, e una
// stringa soltanto se è una chiave intera del dizionario. Il contenuto del
// vault (titoli delle note, estratti, intestazioni della struttura) resta
// com'è, come lo lascerebbe l'host vero. In italiano la scenografia esce
// identica, byte per byte: le baseline visive non cambiano.
import { catalogLanguage, resolvedLanguage } from "../src/i18n/strings";

/// I campi del contratto che portano testo dell'host e non dati dell'utente.
const UI_FIELDS = new Set([
  "title",
  "label",
  "description",
  "group",
  "name",
  "content",
  "subtitle",
  "detail",
  "placeholder",
  "job",
]);

/// Le frasi della scenografia, italiano → inglese.
export const ENGLISH: Readonly<Record<string, string>> = {
  // View.
  Struttura: "Outline",
  Collegamenti: "Links",
  Proprietà: "Properties",
  Cronologia: "History",
  Statistiche: "Statistics",
  Tag: "Tags",
  Grafo: "Graph",
  Cestino: "Trash",
  // Comandi della palette.
  "Crea una nota": "Create a note",
  "Una nota nuova nella cartella corrente": "A new note in the current folder",
  "Rinomina la nota": "Rename the note",
  "Cambia il nome del documento aperto": "Changes the name of the open document",
  "Cestina la nota": "Trash the note",
  "Sposta il documento nel cestino": "Moves the document to the trash",
  "Cerca nel vault": "Search the vault",
  "Apre il pannello di ricerca": "Opens the search panel",
  "Apri la nota di oggi": "Open today's note",
  "Il diario del giorno, creandolo se manca": "The daily note, created if missing",
  "Annulla l'ultima operazione": "Undo the last operation",
  "La pila strutturale": "The structural stack",
  "Svuota il cestino": "Empty the trash",
  "Cancella davvero ciò che è cestinato": "Really deletes what is in the trash",
  "Statistiche del documento": "Document statistics",
  "Parole, caratteri, collegamenti": "Words, characters, links",
  // Barra di formattazione (`fub-features/src/formatting.rs`).
  Annulla: "Undo",
  Ripeti: "Redo",
  "Titolo 1": "Heading 1",
  "Titolo 2": "Heading 2",
  Grassetto: "Bold",
  Corsivo: "Italic",
  Codice: "Code",
  Collegamento: "Link",
  "Elenco puntato": "Bulleted list",
  "Elenco di cose da fare": "Task list",
  Citazione: "Quote",
  // Impostazioni (`fub-host/src/settings.rs`).
  Aspetto: "Appearance",
  Diagnostica: "Diagnostics",
  Disegni: "Drawings",
  "Spazio dell'interfaccia": "Interface spacing",
  "Quanto posto prendono le barre attorno ai fogli: 0 comoda, 4 minima. I fogli non cambiano.":
    "How much room the bars around the sheets take: 0 roomy, 4 minimal. The sheets do not change.",
  Tema: "Theme",
  "In che luce si guarda Fub. Vuoto = come il sistema.": "The light Fub is seen in. Empty = like the system.",
  "Come il sistema": "Like the system",
  Chiaro: "Light",
  Scuro: "Dark",
  Contrasto: "Contrast",
  "Segue il sistema oppure usa sempre il contrasto normale o alto.":
    "Follows the system, or always uses normal or high contrast.",
  Normale: "Normal",
  Alto: "High",
  Densità: "Density",
  "Compatta o allarga la spaziatura dei componenti senza muovere la scocca.":
    "Tightens or widens the spacing of components without moving the frame.",
  Compatta: "Compact",
  Comoda: "Comfortable",
  Rilassata: "Relaxed",
  "Corpo del testo (px)": "Text size (px)",
  "Dimensione del testo nelle superfici di lettura.": "Size of the text on reading surfaces.",
  Interlinea: "Line height",
  "Passo verticale della prosa lunga.": "Vertical rhythm of long prose.",
  "Misura della riga (caratteri)": "Line length (characters)",
  "Larghezza massima della colonna di lettura.": "Maximum width of the reading column.",
  "Carattere di lettura": "Reading typeface",
  "Famiglia usata per la prosa lunga.": "Family used for long prose.",
  "Del sistema": "System",
  "Tinta dell'accento (0–360)": "Accent hue (0–360)",
  "Tinta OKLCH; chiarezza e croma vengono derivati per mantenere il contrasto.":
    "OKLCH hue; lightness and chroma are derived to keep the contrast.",
  "Zoom interfaccia": "Interface zoom",
  "Scala nativa della finestra, da 0,5 a 2.": "Native window scale, from 0.5 to 2.",
  "Numeri di riga": "Line numbers",
  "Mostra la grondaia con il numero di ogni riga.": "Shows the gutter with the number of each line.",
  "Larghezza della colonna": "Column width",
  "In caratteri. Sotto i quaranta la prosa si spezza.": "In characters. Below forty the prose breaks.",
  "Cartella del diario": "Daily notes folder",
  "Dove finiscono le note del giorno.": "Where the daily notes go.",
  "Cartelle escluse": "Excluded folders",
  "Non entrano nell'indice e non compaiono nella ricerca.": "They stay out of the index and out of search.",
  "Livello del log": "Log level",
  "Quanto scrive Fub sul proprio diario di bordo.": "How much Fub writes to its own log.",
  "Solo errori": "Errors only",
  Avvisi: "Warnings",
  Informazioni: "Information",
  "Livello d'interfaccia": "Interface level",
  Essenziale: "Essential",
  // Componenti e lavori.
  Versioni: "Versions",
  "Reindicizzazione del vault": "Reindexing the vault",
  "Snapshot delle versioni": "Version snapshot",
  // Alberi delle view (`fub-features`: backlinks, properties, versioning,
  // stats, tags, trash, graph).
  "Entranti · 2": "Incoming · 2",
  "Uscenti · 2": "Outgoing · 2",
  "Menzioni non collegate · 1": "Unlinked mentions · 1",
  Collega: "Link",
  "Menzioni uscenti non collegate · 0": "Outgoing unlinked mentions · 0",
  "Nessuna menzione non collegata.": "No unlinked mentions.",
  "Filtro avanzato": "Advanced filter",
  "Filtro (QueryExpr JSON)": "Filter (QueryExpr JSON)",
  Parole: "Words",
  Modificata: "Modified",
  "Versioni: 4": "Versions: 4",
  "19 agosto 2026, 09:12": "August 19, 2026, 09:12",
  "18 agosto 2026, 17:40": "August 18, 2026, 17:40",
  "18 agosto 2026, 11:02": "August 18, 2026, 11:02",
  "12 agosto 2026, 11:05": "August 12, 2026, 11:05",
  "Versione attuale": "Current version",
  "+22 byte": "+22 bytes",
  "+1.139 byte": "+1,139 bytes",
  "Prima versione · 2.251 byte": "First version · 2,251 bytes",
  "Versione del 18 agosto 2026, 17:40": "Version of August 18, 2026, 17:40",
  Ripristina: "Restore",
  "Mostra il testo": "Show the text",
  "Copia il testo": "Copy the text",
  "Chiudi l'anteprima": "Close the preview",
  "Rispetto a questa versione, la nota attuale ha 2 righe in più e 1 in meno.":
    "Compared with this version, the current note has 2 more lines and 1 fewer.",
  "… 4 righe uguali": "… 4 unchanged lines",
  "412 parole": "412 words",
  "2 min di lettura": "2 min read",
  "12 note": "12 notes",
  "7 note": "7 notes",
  "3 note": "3 notes",
  "9 note": "9 notes",
  "4 note": "4 notes",
  "2 note": "2 notes",
  "Il cestino è vuoto": "The trash is empty",
  "Ciò che si cestina resta qui finché non lo si svuota.": "What you trash stays here until you empty it.",
  "Il grafo, per chi non sa disegnarlo.": "The graph, for those who cannot draw it.",
};

/// La scenografia nella lingua in cui parla adesso la shell.
/// `dictionary` serve a chi aggiunge frasi sue alla scenografia.
export function inShellLanguage<T>(value: T, dictionary: Readonly<Record<string, string>> = ENGLISH): T {
  return catalogLanguage(resolvedLanguage()) === "en" ? translated(value, dictionary) : value;
}

/// `value` con ogni testo dell'interfaccia passato da `dictionary`. Separata
/// dalla lingua corrente perché la si prova senza toccare quella della shell.
export function translated<T>(value: T, dictionary: Readonly<Record<string, string>>): T {
  return walk(value, false, dictionary) as T;
}

function walk(value: unknown, ui: boolean, dictionary: Readonly<Record<string, string>>): unknown {
  if (typeof value === "string") {
    return ui && Object.prototype.hasOwnProperty.call(dictionary, value) ? dictionary[value] : value;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, ui, dictionary));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, walk(item, UI_FIELDS.has(key), dictionary)]),
    );
  }
  return value;
}
