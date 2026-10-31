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
export type LiveCase = Readonly<{ text: string; cursor: number | null; head?: number }>;

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

/// I casi, per nome. Il nome è quello della query (`?live=…`).
export const LIVE_CASES: Readonly<Record<string, LiveCase>> = {
  panoramica: { text: NOTE, cursor: null },
  "riga-attiva": inNote("Il **treno**", 6),
  "titolo-attivo": inNote("## Cose da fare", 8),
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
  "immagine-selezionata": selected("Sopra, il testo.\n\n", "![Lo schema del viaggio|240](../Risorse/schema.png)", "\n\nSotto, il testo che segue."),
  // La testata della pagina dei Blocchi (H12, H13): icona, copertina e
  // proprietà; la seconda con la pagina a tutta larghezza.
  pagina: inNote("Il **treno**", 6, "---\nicon: 🧳\ncover: ../Risorse/schema.png\ntags: [viaggio]\n---\n" + NOTE),
  "pagina-larga": inNote("Il **treno**", 6, "---\nicon: 🧳\ncssclasses: [wide]\n---\n" + NOTE),
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
  "battuta-50": typingNote(50),
  "battuta-400": typingNote(400),
};

/// Il caso della query, o niente.
export function liveCase(name: string | null): LiveCase | null {
  if (name === null) return null;
  const found = LIVE_CASES[name];
  if (!found) throw new RangeError(`la Live del banco non ha il caso «${name}»`);
  return found;
}
