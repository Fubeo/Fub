// La nota delle scene della Live (`?live=<caso>`): i casi del piano «Live e
// Blocchi», ognuno con il suo testo e il punto del cursore.
//
// La nota sta in `Guida/Live.md` e la ha soltanto la scena che la chiede: le
// altre scene vedono l'albero delle loro baseline. Il cursore non è nel testo
// — un segnaposto nel file sarebbe un byte in più nella resa — ma accanto, come
// offset: la scena lo legge da `__fubLiveBench` e lo mette con una transazione.
//
// I casi `battuta-<n>` sono le note sintetiche del banco d'interazione
// (`interaction.mjs --only=battuta`): `n` sezioni con un po' di tutto, da 18
// righe l'una. Cinquanta sezioni fanno 901 righe, quattrocento 7.201.

/// Dove sta la nota nel vault del banco.
export const LIVE_DOC = "Guida/Live.md";

/// Un caso: il testo della nota e dove sta il cursore (`null`: la nota si
/// guarda senza fuoco, dall'alto).
/// `head`, se c'è, fa del cursore una selezione da `cursor` a `head`.
/// `files`, se c'è, mette nel vault altre note che il caso riporta (la
/// trasclusione viva).
export type LiveCase = Readonly<{ text: string; cursor: number | null; head?: number; files?: Readonly<Record<string, string>> }>;

/// La trasclusione viva (T29): la nota riporta le «Decisioni» della riunione,
/// che stanno in un'altra nota del vault e si scrivono da qui.
export const TRANSCLUSION_ORIGIN = "Riunioni/2026-11-04.md";
const TRANSCLUSION_NOTE = [
  "# Mostra di primavera",
  "",
  "Le decisioni della riunione del 4 novembre, riportate qui come stanno:",
  "",
  "![[Riunioni/2026-11-04#Decisioni]]",
  "",
  "Il resto del lavoro si divide la settimana prossima.",
].join("\n");
const TRANSCLUSION_MEETING = [
  "# Riunione del 4 novembre",
  "",
  "## Presenti",
  "",
  "Anna, Luca, Sara.",
  "",
  "## Decisioni",
  "",
  "- Le didascalie le scrive Anna, entro il 20 novembre.",
  "- I prestiti passano tutti da Luca.",
  "",
  "## Prossima riunione",
  "",
  "Il 18 novembre.",
  "",
].join("\n");

const FENCE = "```";

/// La nota con tutti i costrutti che la Live rende: è la nota delle foto 01–07,
/// 12–15.
const NOTE = [
  "# Viaggio a Lisbona",
  "",
  "Il **treno** parte alle *otto*, il ~~bus~~ no. Energia: E = mc^2^, acqua: H~2~O, ==da ricordare==, `codice`, [sito](https://example.com/guide/lisbona?lingua=it) e [[Itinerario]] #viaggio.",
  "",
  "## Cose da fare",
  "",
  "- [ ] Prenotare l'albergo",
  "- [x] Comprare i biglietti",
  "- Valigia",
  "  - Spazzolino",
  "1. Primo giorno",
  "2. Secondo giorno",
  "",
  "> Una città che si guarda dall'alto.",
  "",
  "> [!tip] Consiglio",
  "> Il tram 28 al mattino presto.",
  "",
  `${FENCE}js`,
  "const giorni = 3;",
  "console.log(giorni);",
  FENCE,
  "",
  "| Giorno | Posto |",
  "| --- | --- |",
  "| 1 | Alfama |",
  "| 2 | Belém |",
  "",
  "Formula $E = mc^2$ e nota[^1]. Premi <kbd>Ctrl</kbd>+<kbd>S</kbd>, <u>sottolineato</u>, <mark>evidenziato HTML</mark>.",
  "",
  "---",
  "",
  "[^1]: Una nota a piè di pagina.",
].join("\n");

/// Il segnaposto del cursore nei testi qui sotto: non arriva mai nel file.
const CARET = "§";

/// Un testo con il segnaposto diventa testo e offset.
function at(text: string): LiveCase {
  const cursor = text.indexOf(CARET);
  if (cursor === -1 || text.indexOf(CARET, cursor + 1) !== -1) {
    throw new RangeError("un caso della Live ha un segnaposto del cursore, uno solo");
  }
  return { text: text.slice(0, cursor) + text.slice(cursor + 1), cursor };
}

/// Il cursore nella nota, `offset` caratteri dopo l'inizio di `needle`.
/// La nota `before + chosen + after` con `chosen` selezionato.
function selected(before: string, chosen: string, after: string): LiveCase {
  return { text: before + chosen + after, cursor: before.length, head: before.length + chosen.length };
}

function inNote(needle: string, offset: number, note = NOTE): LiveCase {
  const i = note.indexOf(needle);
  if (i === -1) throw new RangeError(`«${needle}» non è nella nota della Live`);
  return { text: note, cursor: i + offset };
}

const LONG =
  "Una voce d'elenco molto lunga che va a capo più volte nella misura stretta del foglio, per vedere dove ricomincia la seconda riga del testo e se resta allineata.";

/// Una sezione della nota sintetica della battuta: diciotto righe.
function section(i: number): string {
  return [
    `## Sezione ${i}`,
    "",
    `Testo **forte** e *corsivo* con [[Nota ${i}]], #tag${i} e \`codice\`, x^2^ e ==evidenza==.`,
    "",
    `- [ ] compito ${i}`,
    `- voce ${i}`,
    "",
    `${FENCE}js`,
    `const v${i} = ${i};`,
    FENCE,
    "",
    `> [!note] Callout ${i}`,
    "> corpo",
    "",
    "| a | b |",
    "| --- | --- |",
    `| ${i} | ${i + 1} |`,
    "",
  ].join("\n");
}

/// La nota sintetica di `sections` sezioni, con il cursore sul primo «Testo
/// **forte**» dopo la metà: è il punto in cui si scrive.
export function typingNote(sections: number): LiveCase {
  const text = `${Array.from({ length: sections }, (_, i) => section(i)).join("\n")}\nFine.`;
  return { text, cursor: text.indexOf("Testo **forte**", Math.floor(text.length / 2)) };
}

/// La nota lunga del banco dell'apertura (`interaction.mjs --only=apertura`):
/// `paragraphs` paragrafi di prosa semplice, «Paragrafo N: …», separati da una
/// riga vuota. Quattromila fanno circa 765 KB, come la nota con cui il
/// collaudo sull'app vera ha misurato l'apertura. Nessun cursore: la nota si
/// guarda dall'alto, come dopo un clic nell'albero.
export function longNote(paragraphs: number): LiveCase {
  const body =
    "una riga di prosa senza segni, abbastanza lunga da andare a capo nel foglio come il testo vero di una nota, " +
    "con qualche parola in più perché il paragrafo pesi circa centonovanta byte.";
  const text = Array.from({ length: paragraphs }, (_, i) => `Paragrafo ${i + 1}: ${body}`).join("\n\n");
  return { text: `${text}\n`, cursor: null };
}

/// La nota dei commenti (T22): due discussioni aperte, una con la risposta, e
/// l'archivio dei risolti in fondo, che in Scrittura e in Lettura non si vede.
const COMMENTS = [
  "# La mostra di primavera",
  "",
  "Il {==Museo Rossi==}{>>@Anna Bianchi 2026-11-08 17:40: Il prestito delle tre tele va confermato per iscritto.<<}{>>@Luca Ferri 2026-11-09 09:12: Ho scritto alla direttrice, risponde entro venerdì.<<} presta le tre tele del secondo piano; il trasporto è assicurato dal museo.",
  "",
  "L'allestimento comincia il 3 marzo. Le {==didascalie in due lingue==}{>>@Marta Rinaldi 2026-11-09 11:48: Chi le traduce? Serve un nome entro gennaio.<<} si stampano a febbraio, con il catalogo.",
  "",
  "L'inaugurazione è il 21 marzo alle 18.",
  "",
  "%%fub:risolto 2026-11-10 10:05: il budget del catalogo%%",
  "%%> @Anna Bianchi 2026-11-07 16:20: Restiamo sotto i 4.000 euro?%%",
  "%%> @Luca Ferri 2026-11-08 09:00: Sì, con la carta riciclata.%%",
  "",
].join("\n");

/// Un diagramma di flusso piccolo: un nodo, una scelta e una pillola, come le
/// miniature del menu.
const FLOW = ["flowchart TD", "  A[Prenota il treno] --> B{Posti liberi?}", "  B -->|sì| C([Parti])", "  B -->|no| D[Cambia giorno]"];
const fence = (...lines: string[]) => ["```mermaid", ...lines, "```"].join("\n");

const DIAGRAM_NOTE = [
  "# Il viaggio",
  "",
  "Come si decide la partenza:",
  "",
  fence("---", "title: La partenza", "---", ...FLOW),
  "",
  "Il resto del piano segue.",
].join("\n");

const DIAGRAM_STYLES = ["armonia", "acquerello", "aurora", "blueprint", "inchiostro"]
  .map((style) => `## ${style}\n\n${fence(`%% stile: ${style}`, "flowchart LR", "  A[Prenota] --> B{Posti?}", "  B --> C([Parti])")}`)
  .join("\n\n");

/// Il tracciato (E26, T59): il flusso del prototipo (`DG0`), con un ritorno e
/// le etichette sui collegamenti, giù e poi a destra, in uno stile.
const TRACE_FLOW = [
  "  A[Richiesta di prestito] --> B{Polizza consegnata?}",
  "  B -->|sì| C[Ritiro delle opere]",
  "  B -->|no| D[Sollecito al prestatore]",
  "  D --> B",
  "  C --> E[Allestimento in sala]",
  "  E --> F([Apertura, 20 marzo])",
];
const diagramTrace = (style: string) => [
  `Il flusso in ${style}, giù e poi a destra:`,
  "",
  fence("---", "title: Il percorso di un prestito", "---", `%% stile: ${style}`, "flowchart TD", ...TRACE_FLOW),
  "",
  fence(`%% stile: ${style}`, "flowchart LR", ...TRACE_FLOW),
].join("\n");

/// I casi limite del tracciato: etichette lunghe, un collegamento a tratti e
/// uno senza punta, e un diagramma di sequenza.
const DIAGRAM_TRACE_CASES = [
  "Un'etichetta lunga, un tratteggio, un collegamento senza punta:",
  "",
  fence(
    "flowchart TD",
    "  A[Domanda] -->|una risposta lunga che non sta sul tratto corto| B[Esito]",
    "  A -.->|forse| C[Rinvio]",
    "  B --- D[Archivio]",
    "  C --> D",
  ),
  "",
  fence(
    "sequenceDiagram",
    "  Museo->>Prestatore: Richiesta di prestito",
    "  Prestatore-->>Museo: Polizza",
    "  Museo-)Corriere: Ritiro",
  ),
].join("\n");

const DIAGRAM_CASES = [
  "Un diagramma con un errore mostra il sorgente:",
  "",
  fence("flowchart TD", "  A[Uno] --> --> B"),
  "",
  "Uno stile che non esiste vale come lo stile generale:",
  "",
  fence("%% stile: nebbia", "flowchart LR", "  A[Prenota] --> B{Posti?}", "  B --> C([Parti])"),
  "",
  "Fine.",
].join("\n");

/// I casi, per nome. Il nome è quello della query (`?live=…`).
export const LIVE_CASES: Readonly<Record<string, LiveCase>> = {
  commenti: { text: COMMENTS, cursor: null },
  "commenti-scelta": {
    text: COMMENTS,
    cursor: COMMENTS.indexOf("inaugurazione"),
    head: COMMENTS.indexOf("inaugurazione") + "inaugurazione".length,
  },
  panoramica: { text: NOTE, cursor: null },
  "riga-attiva": inNote("Il **treno**", 6),
  "titolo-attivo": inNote("## Cose da fare", 8),
  "compito-attivo": inNote("- [ ] Prenotare", 15),
  "codice-attivo": inNote("const giorni", 6),
  "callout-attivo": inNote("> Il tram 28", 6),
  "elenco-attivo": inNote("1. Primo giorno", 5),
  "html-attivo": inNote("Premi <kbd>", 3),
  "apice-digitando": at("Energia: E = mc§\n\nAltro testo sotto."),
  "pedice-digitando": at("Acqua: H§\n\nAltro testo sotto."),
  "apice-chiuso": at("Energia: E = mc§\n\nAltro testo sotto."),
  "grassetto-digitando": at("Una parola §\n\nAltro testo sotto."),
  "panoramica-fondo": { text: `Testo in cima.\n\n${NOTE}`, cursor: null },
  "tabella-attiva": inNote("| 1 | Alfama", 4),
  "callout-titolo": inNote("[!tip] Consiglio", 3),
  "elenco-a-capo": {
    text: `Testo.\n\n- ${LONG}\n  - Sottovoce: ${LONG}\n1. ${LONG}\n- [ ] ${LONG}\n\n> ${LONG}`,
    cursor: null,
  },
  "recinto-digitando": at("Prima riga.\n\n§\n\nDopo."),
  "link-in-modifica": at(
    "Vedi [la guida completa](https://example.com/una/strada/molto/lunga/che/occupa/spazio?utm=1) per i dettagli, e §poi basta.",
  ),
  "wikilink-alias": at(
    "Vedi [[Itinerario dettagliato#Giorno 2|il secondo giorno]] domani, §ok.\n\nVedi [[Itinerario dettagliato#Giorno 2|il secondo giorno]] domani.",
  ),
  "riga-vuota": at("# Nota nuova\n\n§"),
  // La Base nella nota (T18, con `?base=nota`): una riga vuota fra due
  // paragrafi per «/base», e la Base già incorporata, larga fino al margine.
  "base-slash": at("# Letture\n\nI libri dell'anno, in una tabella.\n\n§\n\nSotto, il testo che segue."),
  "base-incorporata": {
    text: "# Letture\n\nI libri dell'anno, in una tabella.\n\n![[Opere.base#Tabella]]\n\nSotto, il testo che segue.",
    cursor: null,
  },
  // La formula che si modifica toccandola (T60): una in riga col cursore
  // davanti, un blocco `$$` da cliccare; poi una formula con un errore.
  "formula-toccata": at(
    "# Il moto\n\nLa velocità media è §$v = \\frac{s}{t}$, e lo spazio cresce con $t^{2}$.\n\n$$\n\\frac{a+b}{c} + x^{2} + \\sqrt{y}\n$$\n\nSotto, il testo che segue.",
  ),
  "formula-errore": at("# Il moto\n\nUna formula rotta: §$\\frac{a}$ da correggere.\n\nSotto, il testo che segue."),
  "immagine-selezionata": selected("Sopra, il testo.\n\n", "![Lo schema del viaggio|240](../Risorse/schema.png)", "\n\nSotto, il testo che segue."),
  // La testata della pagina dei Blocchi (H12, H13): icona, copertina e
  // proprietà; la seconda con la pagina a tutta larghezza.
  pagina: inNote("Il **treno**", 6, "---\nicon: 🧳\ncover: ../Risorse/schema.png\ntags: [viaggio]\n---\n" + NOTE),
  "pagina-larga": inNote("Il **treno**", 6, "---\nicon: 🧳\ncssclasses: [wide]\n---\n" + NOTE),
  // La testata in Scrittura e in Lettura (T6, E3), da guardare con
  // `?properties=visible`: copertina, icona, titolo, quattro proprietà in
  // evidenza e «Altre 2»; poi senza frontmatter, illeggibile, con la
  // copertina che non si trova. Il cursore resta fuori: la testata a riposo.
  testata: {
    text: "---\nicon: 🧳\ncover: ../Risorse/schema.png\ntipo: Viaggio\nstato: In corso\npartenza: 2027-03-20\npersone: [Anna, Luca]\nluogo: Lisbona\nbudget:\ntags: [viaggio]\n---\n" + NOTE,
    cursor: null,
  },
  "testata-vuota": { text: NOTE, cursor: null },
  // Gli editor dei tipi (T8): una voce per tipo, le prime quattro come nella
  // riga «Le proprietà» del prototipo.
  proprieta: {
    text: "---\nicon: 📚\ntipo: Progetto\nstato: In corso\nscadenza: 2027-03-20\npersone: [\"[[Anna Bianchi]]\", \"[[Luca Ferri]]\"]\nluogo: Biblioteca civica\nbudget: 4800\nfatto: false\nluoghi: [Torino, Lisbona, Porto]\n---\n" + NOTE,
    cursor: null,
  },
  // Selezione, Stato e Url (T9), col registro dei tipi di `?tipi=1`: uno
  // Stato, una Selezione, un indirizzo e uno Stato fuori dalle sue opzioni.
  opzioni: {
    text: "---\nicon: 📚\ntipo: Progetto\nstato: In viaggio\nsala: Grande\nsito: https://example.org/mostra\nfase: Rivista\n---\n" + NOTE,
    cursor: null,
  },
  "testata-illeggibile": { text: "---\nicon: 🧳\nuna riga che non è una chiave\nstato: In corso\n---\n" + NOTE, cursor: null },
  "testata-senza-immagine": { text: "---\ncover: ../Risorse/non-c-e.png\nstato: In corso\n---\n" + NOTE, cursor: null },
  // I colori del contenuto (K1): i nove del testo e i nove del fondo, uno per
  // riga, col cursore fuori.
  colori: at([
    "# I colori",
    "",
    ...["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].map((name) =>
      `<span class="fub-color-${name}">Testo ${name}</span> e <mark class="fub-bg-${name}">fondo ${name}</mark>`),
    "",
    '- <mark class="fub-color-red fub-bg-yellow">Tutti e due</mark> in una voce',
    "",
    "§",
  ].join("\n")),
  // Il ripiegabile (K2): uno chiuso, uno aperto con un altro dentro.
  ripiegabile: at([
    "# I ripiegabili",
    "",
    "<details>",
    "<summary>Chiuso: gli ingredienti</summary>",
    "",
    "- farina",
    "- acqua",
    "",
    "</details>",
    "",
    "<details open>",
    "<summary>Aperto: il procedimento</summary>",
    "",
    "Si impasta **a lungo**, poi si lascia riposare.",
    "",
    "<details>",
    "<summary>Dentro: i tempi</summary>",
    "",
    "Due ore.",
    "",
    "</details>",
    "",
    "</details>",
    "",
    "§",
  ].join("\n")),
  // Le colonne (K3): due e tre colonne, e sotto il testo che le segue.
  colonne: at([
    "# Le colonne",
    "",
    "> [!columns]",
    "> > [!column]",
    "> > ## Pro",
    "> > - si scrive **affiancato**",
    "> > - resta Markdown",
    ">",
    "> > [!column]",
    "> > ## Contro",
    "> > Negli altri programmi si legge come due citazioni annidate.",
    "",
    "> [!columns]",
    "> > [!column]",
    "> > Primo",
    ">",
    "> > [!column]",
    "> > Secondo, un po' più lungo del primo",
    ">",
    "> > [!column]",
    "> > Terzo",
    "",
    "Il testo dopo le colonne.",
    "",
    "§",
  ].join("\n")),
  // L'indice (K4): i titoli della nota, rientrati per livello.
  indice: at([
    "# Il viaggio",
    "",
    "```toc",
    "```",
    "",
    "## Prima di partire",
    "",
    "La valigia, i documenti, le chiavi.",
    "",
    "### Che cosa portare",
    "",
    "Poco, e leggero.",
    "",
    "## Il *mare*",
    "",
    "Le spiagge a sud.",
    "",
    "## Il ritorno",
    "",
    "§",
  ].join("\n")),
  // I diagrammi (E26): uno a riposo col titolo nel frontmatter, poi i cinque
  // stili, uno per diagramma, e i casi limite (uno stile che non esiste, un
  // errore). Il cursore resta fuori: si vede il disegno, non il sorgente.
  diagramma: { text: DIAGRAM_NOTE, cursor: null },
  "diagramma-stili": { text: DIAGRAM_STYLES, cursor: null },
  "diagramma-casi": { text: DIAGRAM_CASES, cursor: null },
  ...Object.fromEntries(["armonia", "acquerello", "aurora", "blueprint", "inchiostro"]
    .map((style) => [`diagramma-tracciato-${style}`, { text: diagramTrace(style), cursor: null }])),
  "diagramma-tracciato-casi": { text: DIAGRAM_TRACE_CASES, cursor: null },
  // Il sorgente aperto (T58): il cursore nel recinto, dopo «Posti liberi?».
  "diagramma-sorgente": { text: DIAGRAM_NOTE, cursor: DIAGRAM_NOTE.indexOf("Posti liberi?") + "Posti liberi?".length },
  trasclusione: { text: TRANSCLUSION_NOTE, cursor: null, files: { [TRANSCLUSION_ORIGIN]: TRANSCLUSION_MEETING } },
  "battuta-50": typingNote(50),
  "battuta-400": typingNote(400),
  "lunga-4000": longNote(4000),
};

/// Il caso della query, o niente.
export function liveCase(name: string | null): LiveCase | null {
  if (name === null) return null;
  const found = LIVE_CASES[name];
  if (!found) throw new RangeError(`la Live del banco non ha il caso «${name}»`);
  return found;
}
