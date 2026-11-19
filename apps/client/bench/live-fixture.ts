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

import RICH_BENCH from "../src/__fixtures__/rich-bench.json";

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

/// La scheda di documento (T44): il verbale in ODT del banco, con la
/// proiezione vera di `fub-format-rich` (`tests/ts_bench.rs`), incorporato da
/// solo nel paragrafo; e un documento lungo, di cento pagine, che la scheda
/// tronca con «Apri».
export const DOCUMENT_CARD_FILE = "Riunioni/Verbale.odt";
export const DOCUMENT_CARD_LONG = "Riunioni/Relazione annuale.docx";
const DOCUMENT_CARD_NOTE = [
  "# Riunione di ottobre",
  "",
  "Il verbale, così come l'ha scritto Bea:",
  "",
  "![[Verbale.odt]]",
  "",
  "La relazione dell'anno, da rileggere prima dell'assemblea:",
  "",
  "![[Relazione annuale.docx#Bilancio]]",
  "",
  "Da chiedere: chi porta le cartoline.",
].join("\n");

/// Il documento lungo: cento pagine, dieci paragrafi l'una, coi titoli dei
/// capitoli. Una proiezione `fub-rich` come quella del codec, senza i pezzi
/// opachi (un paragrafo nuovo non ne ha).
function longDocument(pages: number): string {
  const blocks: unknown[] = [];
  for (let page = 1; page <= pages; page++) {
    if (page % 10 === 1) {
      blocks.push({ t: "para", role: { kind: "heading", level: 1 }, c: [{ t: "text", x: page === 1 ? "Bilancio" : `Capitolo ${Math.ceil(page / 10)}` }] });
    }
    for (let line = 1; line <= 10; line++) {
      blocks.push({ t: "para", role: { kind: "body" }, c: [{ t: "text", x: `Pagina ${page}, paragrafo ${line}: le entrate e le uscite dell'anno, voce per voce, con le note del tesoriere.` }] });
    }
  }
  return JSON.stringify({ format: "fub-rich", version: 4, blocks });
}

/// Come il kernel rende un documento incorporato (`render_embed`): il modello
/// comune di `fub-format-rich` passato dalla resa del Markdown. Qui dalla
/// proiezione: titoli, paragrafi, elenchi e tabelle, il testo dei pezzi.
export function documentEmbedHtml(projection: string): string {
  type Run = { readonly t: string; readonly x?: string; readonly m?: readonly string[] };
  type Para = { readonly t: "para"; readonly role?: { readonly kind: string; readonly level?: number; readonly ordered?: boolean }; readonly c?: readonly Run[] };
  type Table = { readonly t: "table"; readonly rows: readonly { readonly cells: readonly { readonly blocks: readonly Para[] }[] }[] };
  const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const runs = (para: Para): string => (para.c ?? []).map((run) => {
    const text = esc(run.x ?? "");
    return run.m?.includes("i") ? `<em>${text}</em>` : run.m?.includes("b") ? `<strong>${text}</strong>` : text;
  }).join("");
  const blocks = (JSON.parse(projection) as { blocks: readonly (Para | Table)[] }).blocks;
  const out: string[] = [];
  // L'elenco aperto: le voci consecutive dello stesso tipo ci entrano.
  const open: { list: { readonly tag: string; readonly items: string[] } | null } = { list: null };
  const flush = (): void => {
    const list = open.list;
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${list.tag}>`);
    open.list = null;
  };
  for (const block of blocks) {
    if (block.t === "table") {
      flush();
      const rows = block.rows.map((row) => `<tr>${row.cells.map((cell) => `<td>${cell.blocks.map(runs).join("<br>")}</td>`).join("")}</tr>`);
      out.push(`<table><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }
    const role = block.role ?? { kind: "body" };
    if (role.kind === "list") {
      const tag = role.ordered ? "ol" : "ul";
      if (open.list?.tag !== tag) flush();
      open.list ??= { tag, items: [] };
      open.list.items.push(runs(block));
      continue;
    }
    flush();
    if (role.kind === "heading") {
      const level = Math.min(6, role.level ?? 1);
      out.push(`<h${level}>${runs(block)}</h${level}>`);
    } else {
      out.push(`<p>${runs(block)}</p>`);
    }
  }
  flush();
  return out.join("\n");
}

/// Le schede vive (T41): il contratto in PDF e la cartella di Excel del banco
/// (`pdf-scena`, `workbook=1`) incorporati da soli nel paragrafo, poi un
/// file che non c'è più e un formato che la nota non sa mostrare.
const LIVE_CARDS_NOTE = [
  "# Affitto di via Roma",
  "",
  "Il contratto, così com'è arrivato dall'agenzia:",
  "",
  "![[contratto-affitto.pdf]]",
  "",
  "I conti della casa, da tenere aggiornati:",
  "",
  "![[Conti.xlsx#Conti!A1:C4]]",
  "",
  "Il budget dell'anno scorso, un intervallo che non c'è più:",
  "",
  "![[Conti.xlsx#Budget!A1:E7]]",
  "",
  "La versione vecchia, spostata chissà dove:",
  "",
  "![[Contratto vecchio.pdf]]",
  "",
  "Le foto dell'appartamento, in un archivio:",
  "",
  "![[foto-appartamento.zip]]",
  "",
  "Da chiedere all'agenzia: chi paga la caldaia.",
].join("\n");

/// La misura e il posto delle schede (T42): il contratto e i conti affiancati
/// in un `[!columns]`, i conti a tutta pagina e bassi (`|900x260`), il
/// contratto come riga (`|row`).
const LIVE_CARDS_SIZE_NOTE = [
  "# Affitto di via Roma",
  "",
  "Il contratto e i conti, uno accanto all'altro:",
  "",
  "> [!columns]",
  "> > [!column]",
  "> > ![[contratto-affitto.pdf]]",
  ">",
  "> > [!column]",
  "> > ![[Conti.xlsx]]",
  "",
  "I conti a tutta pagina, bassi:",
  "",
  "![[Conti.xlsx|900x260]]",
  "",
  "Il contratto, solo come riga:",
  "",
  "![[contratto-affitto.pdf|row]]",
  "",
  "Da chiedere all'agenzia: chi paga la caldaia.",
].join("\n");

/// Il blocco sincronizzato (T30): la nota riporta un blocco della riunione
/// col suo id, che si scrive dove sta, e uno il cui blocco non c'è più.
const SYNCED_NOTE = [
  "# Mostra di primavera",
  "",
  "Chi fa che cosa, come deciso alla riunione:",
  "",
  "![[Riunioni/2026-11-04#^didascalie]]",
  "",
  "Il resto del lavoro si divide la settimana prossima.",
  "",
  "![[Riunioni/2026-11-04#^sparito]]",
].join("\n");
const SYNCED_MEETING = [
  "# Riunione del 4 novembre",
  "",
  "Le didascalie le scrive Anna, entro il 20 novembre; i prestiti passano tutti da Luca. ^didascalie",
  "",
  "Il 18 novembre la prossima.",
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

/// La nota della battuta con le schede (T43, A-5): `sections` sezioni come
/// in `typingNote`, e dopo ciascuna delle prime `cards` un foglio vivo, la
/// stessa parte della cartella del banco.
export function typingCardsNote(sections: number, cards: number): LiveCase {
  const parts = Array.from({ length: sections }, (_, i) => (i < cards ? `${section(i)}\n![[Conti.xlsx#Conti!A1:C4]]\n` : section(i)));
  const text = `${parts.join("\n")}\nFine.`;
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
/// I tipi di nota del vault delle scene `tipo-*` (E5): uno con le proprietà
/// coi loro tipi e una cartella, uno con un'icona emoji, uno senza icona; due
/// note che li nominano, per i conteggi del cassetto.
const TYPE_FILES: Readonly<Record<string, string>> = {
  "Tipi/Libro.md": "---\nicon: book\nproperties:\n  autore: testo\n  letto: casella\n  generi: elenco\nfeatured: [autore, letto]\nfolder: Biblioteca\n---\n# {{title}}\n\nNote di lettura.\n",
  "Tipi/Progetto.md": "---\nicon: 🌱\nproperties:\n  stato: stato\n  scadenza: data\n  persone: persone\nfeatured: [stato, scadenza, persone]\nfolder: Progetti\n---\n## Obiettivo\n\n## Prossimi passi\n",
  "Tipi/Riunione.md": "---\nproperties:\n  data: data\n  presenti: persone\n---\n## Ordine del giorno\n",
  "Biblioteca/Dune.md": "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Frank Herbert\n---\nIl deserto.\n",
  "Progetti/Mostra di primavera.md": "---\ntipo: \"[[Tipi/Progetto]]\"\nstato: In corso\n---\nLe sale e le opere.\n",
};

/// Il tipo «Viaggio» della nota delle scene `testata-*` (T6): la nota lo
/// nomina, e senza il suo file la testata mostrerebbe l'avviso del tipo che
/// non c'è, che quelle scene non vogliono fotografare. In evidenza `tipo` e
/// tre proprietà del tipo, così «Altre 2» resta com'era.
const TRAVEL_TYPE_FILES: Readonly<Record<string, string>> = {
  "Tipi/Viaggio.md": "---\nicon: 🧳\nproperties:\n  stato: stato\n  partenza: data\n  persone: persone\n  luogo: testo\n  budget: numero\nfeatured: [stato, partenza, persone]\n---\n## Itinerario\n",
};

/// Il tipo «Progetto» della nota delle scene `proprieta-*` (T8): la nota lo
/// nomina, e senza il suo file la testata mostrerebbe l'avviso del tipo che
/// non c'è. È il «Progetto» dei tipi (E5): in evidenza `tipo` e le tre che
/// la nota mette prima, così le righe e «Altre 4» restano com'erano. L'icona
/// del tipo non si vede, la nota ha la sua.
const PROJECT_TYPE_FILES: Readonly<Record<string, string>> = {
  "Tipi/Progetto.md": TYPE_FILES["Tipi/Progetto.md"]!,
};

/// Lo stesso tipo per le scene `opzioni-*` (T9), con in evidenza le tre
/// proprietà che la nota mette prima: Stato, Selezione e Url restano in
/// vista e la fase fuori dalle opzioni resta dietro «Altre».
const OPTIONS_TYPE_FILES: Readonly<Record<string, string>> = {
  "Tipi/Progetto.md": "---\nicon: 🌱\nproperties: [stato, sala, sito, fase]\nfeatured: [stato, sala, sito]\nfolder: Progetti\n---\n## Obiettivo\n",
};

/// La scheda di disegno (T46): uno schizzo di Fub che si disegna sul posto e,
/// più giù, un SVG fatto altrove, che resta un'immagine ferma.
export const DRAWING_CARD_FILE = "Schizzi/Pianta del soggiorno.svg";
const DRAWING_CARD_FOREIGN = "Schizzi/Logo della festa.svg";
const DRAWING_CARD_NOTE = [
  "# Il soggiorno nuovo",
  "",
  "La pianta come l'abbiamo pensata sabato: il divano sotto la finestra.",
  "",
  `![[${DRAWING_CARD_FILE}]]`,
  "",
  "Il logo della festa, arrivato dalla tipografia:",
  "",
  `![[${DRAWING_CARD_FOREIGN}]]`,
  "",
  "Da chiedere: le misure della porta.",
].join("\n");
const DRAWING_CARD_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 640 360" width="640" height="360">',
  "  <title>Pianta del soggiorno</title>",
  '  <g id="l0a1b2c3d" fub:role="layer" fub:name="Livello 1">',
  '    <rect id="o1a2b3c4d" x="80" y="40" width="480" height="280" fill="none" stroke="#2f3a4a" stroke-width="4"/>',
  '    <rect id="o2a2b3c4d" x="120" y="250" width="200" height="50" rx="10" fill="#cfe3f7" stroke="#2f3a4a" stroke-width="2"/>',
  '    <ellipse id="o3a2b3c4d" cx="430" cy="170" rx="60" ry="40" fill="#f7e2b5" stroke="#2f3a4a" stroke-width="2"/>',
  '    <line id="o4a2b3c4d" x1="250" y1="40" x2="390" y2="40" stroke="#7fb3e6" stroke-width="8"/>',
  '    <path id="o5a2b3c4d" d="M 520 300 Q 545 250 560 300" fill="none" stroke="#2f3a4a" stroke-width="2"/>',
  '    <text id="o6a2b3c4d" x="160" y="232" font-size="18" fill="#2f3a4a">divano</text>',
  '    <text id="o7a2b3c4d" x="402" y="176" font-size="18" fill="#2f3a4a">tavolo</text>',
  "  </g>",
  "</svg>",
  "",
].join("\n");
const DRAWING_CARD_FOREIGN_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="320" height="120">',
  '  <rect width="320" height="120" rx="16" fill="#e8563f"/>',
  '  <text x="160" y="74" font-size="40" text-anchor="middle" fill="#ffffff" font-family="sans-serif">FESTA</text>',
  "</svg>",
  "",
/// La scheda PDF (T45): il manuale di quattro pagine del giro (`giro=editor`,
/// `giro-fixture.ts`), un PDF vero col testo che pdf.js stende, mostrato dalla
/// pagina 2 (`#page=2`).
const LIVE_CARDS_PDF_NOTE = [
  "# Imparare Fub",
  "",
  "Il manuale, dalla pagina sulle note:",
  "",
  "![[Manuale di Fub.pdf#page=2]]",
  "",
  "Da rileggere prima della riunione di giovedì.",
].join("\n");

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
    files: TRAVEL_TYPE_FILES,
  },
  "testata-vuota": { text: NOTE, cursor: null },
  // Gli editor dei tipi (T8): una voce per tipo, le prime quattro come nella
  // riga «Le proprietà» del prototipo.
  proprieta: {
    text: "---\nicon: 📚\ntipo: Progetto\nstato: In corso\nscadenza: 2027-03-20\npersone: [\"[[Anna Bianchi]]\", \"[[Luca Ferri]]\"]\nluogo: Biblioteca civica\nbudget: 4800\nfatto: false\nluoghi: [Torino, Lisbona, Porto]\n---\n" + NOTE,
    cursor: null,
    files: PROJECT_TYPE_FILES,
  },
  // Selezione, Stato e Url (T9), col registro dei tipi di `?tipi=1`: uno
  // Stato, una Selezione, un indirizzo e uno Stato fuori dalle sue opzioni.
  opzioni: {
    text: "---\nicon: 📚\ntipo: Progetto\nstato: In viaggio\nsala: Grande\nsito: https://example.org/mostra\nfase: Rivista\n---\n" + NOTE,
    cursor: null,
    files: OPTIONS_TYPE_FILES,
  },
  // I tipi di nota (T33, E5): tre tipi nella cartella `Tipi`, due note che
  // li usano; la nota della Live è un libro, poi una nota il cui tipo non
  // c'è più. Con `?live=tipo` anche «Nuova nota» chiede il tipo, e il
  // cassetto ha la sezione «Tipi».
  tipo: {
    text: "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Frank Herbert\nletto: true\ngeneri: [fantascienza, classici]\npagine: 412\neditore: Chilton\n---\n" + NOTE,
    cursor: null,
    files: TYPE_FILES,
  },
  // La pagina del tipo (T33): lo stesso vault; la scena apre `Tipi/Libro.md`.
  "tipo-pagina": {
    text: "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Frank Herbert\nletto: true\n---\n" + NOTE,
    cursor: null,
    files: TYPE_FILES,
  },
  "tipo-mancante": {
    text: "---\ntipo: \"[[Tipi/Romanzo]]\"\nautore: Frank Herbert\nletto: true\n---\n" + NOTE,
    cursor: null,
    files: TYPE_FILES,
  },
  // La Relazione (T35, passo 4 del prototipo), col registro di `?tipi=1`
  // (`libri` è una Relazione verso la cartella `Biblioteca`): il tipo come
  // nome della nota, due libri legati, uno rotto; altri libri da legare.
  relazioni: {
    text: "---\nicon: 📚\ntipo: \"[[Tipi/Riunione]]\"\nlibri: [\"[[Biblioteca/Dune]]\", \"[[Biblioteca/Solaris]]\", \"[[Il libro perduto]]\"]\nluogo: Biblioteca civica\n---\n" + NOTE,
    cursor: null,
    files: {
      ...TYPE_FILES,
      "Tipi/Riunione.md": "---\nicon: 🗓️\nproperties:\n  libri: relazione\n  luogo: testo\nfeatured: [libri, luogo]\n---\n## Ordine del giorno\n",
      "Biblioteca/Solaris.md": "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Stanisław Lem\n---\nL'oceano.\n",
      "Biblioteca/Ubik.md": "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Philip K. Dick\n---\nIl tempo.\n",
      "Biblioteca/La mano sinistra del buio.md": "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Ursula K. Le Guin\n---\nIl ghiaccio.\n",
    },
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
  // I promemoria (T36), col banco fermo a mercoledì 19 agosto 2026, 9:30:
  // oggi soltanto l'ora, un altro giorno anche il giorno, un altro anno
  // anche l'anno; il compito fatto grigio; uno che non si legge resta testo;
  // la scadenza accanto. Il cursore resta sotto, fuori dai compiti.
  promemoria: at([
    "# La settimana",
    "",
    "- [ ] Chiamare Anna ⏰ 2026-08-19 15:30",
    "- [ ] Mandare il preventivo ⏰ 2026-08-21 09:00 📅 2026-08-24",
    "- [ ] Rinnovare il dominio ⏰ 2027-01-04",
    "- [x] Prenotare il treno ⏰ 2026-08-14 09:00",
    "- [ ] Ritirare il pacco ⏰ 2026-02-30",
    "",
    "Le altre cose della settimana.§",
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
  sincronizzato: { text: SYNCED_NOTE, cursor: null, files: { [TRANSCLUSION_ORIGIN]: SYNCED_MEETING } },
  "schede-vive": { text: LIVE_CARDS_NOTE, cursor: null, files: { "Casa/foto-appartamento.zip": "" } },
  "scheda-documento": {
    text: DOCUMENT_CARD_NOTE,
    cursor: null,
    files: { [DOCUMENT_CARD_FILE]: RICH_BENCH.odt, [DOCUMENT_CARD_LONG]: longDocument(100) },
  },
  "schede-misura": { text: LIVE_CARDS_SIZE_NOTE, cursor: null },
  // La scheda di disegno (T46): il banco accende la feature `draw` perché fra
  // i file c'è un `.svg` (`fake-ipc.ts`).
  "scheda-disegno": {
    text: DRAWING_CARD_NOTE,
    cursor: null,
    files: { [DRAWING_CARD_FILE]: DRAWING_CARD_SVG, [DRAWING_CARD_FOREIGN]: DRAWING_CARD_FOREIGN_SVG },
  },
  "schede-pdf": { text: LIVE_CARDS_PDF_NOTE, cursor: null },
  "battuta-50": typingNote(50),
  "battuta-400": typingNote(400),
  "battuta-schede-20": typingCardsNote(50, 20),
  "lunga-4000": longNote(4000),
};

/// Il caso della query, o niente.
export function liveCase(name: string | null): LiveCase | null {
  if (name === null) return null;
  const found = LIVE_CASES[name];
  if (!found) throw new RangeError(`la Live del banco non ha il caso «${name}»`);
  return found;
}
