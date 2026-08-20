// Il contrasto dei token, contato invece che promesso (§12.4).
//
// È la metà del presidio di accessibilità che **non passa dal DOM**. L'altra
// (`ui/a11y-check.ts`) legge la struttura e non può decidere il contrasto: senza
// motore di rendering non esistono i colori calcolati, e uno strumento come
// `axe-core` su `happy-dom` risponderebbe «impossibile determinare» — cioè
// passerebbe. Qui il DOM non serve affatto: i colori stanno scritti in un file,
// il conto è aritmetica, e le coppie che formano le dichiarano i token stessi.
//
// # Cosa vuol dire «le coppie che i token dichiarano»
//
// Un token semantico dice un ruolo, e un ruolo dice **sopra cosa sta**:
// `--accent-contrast` esiste per stare sopra `--accent` — è scritto nel suo
// nome —, `--text` e `--muted` stanno sopra le quattro superfici, `--doc-fg`
// sopra `--doc-bg`. La tabella qui sotto è quell'elenco, e non un campione: se
// una coppia è nella tabella è perché una regola della **pelle** (`skin.css`)
// la mette davvero insieme, e il commento accanto dice quale.
//
// Il presidio non è il conto: il conto lo sapeva fare chiunque anche prima. Il
// presidio è che le coppie sono **enumerate in un posto solo** e ricontate a
// ogni giro, in **tutti e due i temi**. Un tema chiaro nasce ricopiando venti
// valori e cambiandone il verso, ed è l'operazione in cui un colore scelto per
// reggere sul nero finisce sopra il bianco senza che nessuno se ne accorga:
// tutto si vede, niente diventa rosso. Otto coppie sono entrate qui già rosse.
//
// # Cosa resta da presidiare adesso che i colori si ricavano
//
// Dalla §31.2 i colori non sono più scelti: la ricetta (`serie/recipe.ts`)
// dichiara di ogni ink la tinta, il croma, **sopra cosa sta** e quanto
// vuole reggere, e la chiarezza la trova cercandola. La domanda legittima è se
// questo banco non stia allora ricontando ciò che la generazione ha già contato.
//
// Non lo sta facendo, e per due ragioni che vale la pena tenere separate.
//
// - **Le soglie sono di un'altra autorità.** La ricetta insegue una *mira* — 5:1,
//   6:1, 11:1 — che è il disegno; qui si verifica il **minimo di legge**, 4,5:1
//   e 3:1, che è la WCAG. Sono due numeri diversi e uno solo dei due si può
//   abbassare per gusto. Una mira scesa sotto AA passa la generazione senza un
//   fiato e diventa rossa qui: è precisamente il caso che questo file esiste per
//   prendere.
// - **Le coppie sono di un'altra fonte.** La ricetta dice `sopra: SUPERFICI`
//   perché è ciò che *vuole garantire*; la tabella qui sotto dice
//   `["muted", "bg-chrome", …, "la barra di stato"]` perché è ciò che
//   **`skin.css` mette davvero insieme**. Le due liste si somigliano, e il
//   giorno in cui non si somigliano più è il giorno che interessa: una regola
//   nuova che accosta due ruoli che la ricetta non aveva messo in relazione.
//
// Il conto della chiarezza, quello sì, non si riconta: lo presidia
// `recipe.test.ts`, che è il posto in cui sta la generazione.
//
// # Le tre soglie, e perché non è una sola
//
// Le dà la WCAG 2.1, e sono le sue:
//
// - **4,5:1** per il testo. È la regola 1.4.3, ed è il caso normale.
// - **3:1** per il testo grande (un titolo) e per ciò che **non è testo** ma va
//   comunque distinto: un contorno di selezione, un anello di fuoco, il pallino
//   di un nodo nel grafo (regola 1.4.11).
// - Nessuna soglia per ciò che è decorativo, che infatti non sta in tabella.
//
// Usarne una sola sarebbe più corto e falso in tutte e due le direzioni:
// pretendere 4,5:1 da un bordo vorrebbe dire ridisegnare l'interfaccia per una
// regola che non la riguarda, e accontentarsi di 3:1 dal testo vorrebbe dire
// scrivere che si presidia il contrasto e presidiare qualcos'altro.
//
// # La tavolozza della sintassi, e il debito che aveva
//
// I `--syn-*` sono stati per un pezzo l'unico gruppo che **non** reggeva la
// soglia del testo, e stava scritto qui: erano One Dark e One Light presi
// **interi**, sette specie su dieci sotto AA in luce chiara, e l'elenco dei nomi
// stava in questo file come lucchetto. La ragione per non ritoccarli era buona —
// ritoccare una tavolozza famosa un colore alla volta lascia una tavolozza che
// non è più nessuna delle due, scelta da chi passava di lì.
//
// La §31.2 ha sciolto il nodo togliendo la premessa invece di aggirarla. Le
// specie non si prendono più da una tavolozza: si **dichiarano** — la tinta e il
// croma di ciascuna, presi misurando dov'erano quelle di One Dark, e una mira di
// contrasto sola per tutta la famiglia. La chiarezza la trova la ricetta, uguale
// per tutte e dieci, scegliendo quella che serve alla specie più difficile. Non
// è One Dark ritoccato: è una tavolozza che ha le sue tinte e la chiarezza di
// una famiglia, che è ciò che dieci colori scelti uno per volta non hanno mai.
//
// Il debito è pagato: nessuna specie sta sotto AA, in nessuna delle due luci, su
// nessuno dei tre fondi della carta. La **25.1** (alto contrasto) resta, perché
// è un'altra cosa — una tavolozza per chi ha bisogno di molto più di AA, non il
// recupero di un arretrato.
import { describe, expect, it } from "vitest";

// Il conto — WCAG 2.1, §1.4.3 e la definizione di rapporto di contrasto — stava
// qui dentro finché il lettore era uno solo. Adesso lo legge anche il catalogo
// della tavolozza del banco, che i colori li prende **resi** invece che dal
// foglio come testo: due misure della stessa promessa, e una formula sola
// (`theme/contrast.ts`).
import { contrast } from "./contrast";
import dark from "./serie/sheet-dark.css?raw";
import light from "./serie/sheet-light.css?raw";

/// La soglia del testo (WCAG 1.4.3).
const AA = 4.5;
/// La soglia del testo grande e di ciò che non è testo (WCAG 1.4.11).
const UI = 3;

/// Una coppia dichiarata: chi sta sopra chi, quanto deve reggere, e per quale
/// regola vera — la terza colonna è ciò che impedisce a questa tabella di
/// diventare una lista di buone intenzioni.
type Pair = readonly [ink: string, background: string, threshold: number, where: string];

const PAIRS: readonly Pair[] = [
  // Il testo della shell sulle quattro superfici. `--bg-hover` è una superficie
  // come le altre da quando le righe non si riempiono più d'accento.
  ["text", "bg", AA, "il corpo dell'app"],
  ["text", "bg-chrome", AA, "la titlebar, la barra degli strumenti, le linguette"],
  ["text", "bg-elev", AA, "topbar, pannelli, modali"],
  ["text", "bg-input", AA, "campi, pastiglie"],
  ["text", "bg-hover", AA, "una riga sotto il puntatore, o selezionata"],
  ["muted", "bg", AA, ".muted, i sottotitoli"],
  ["muted", "bg-chrome", AA, "#statusbar e #views-status, che sono tutte muted"],
  ["muted", "bg-elev", AA, "i sottotitoli dentro un pannello"],
  ["muted", "bg-input", AA, "i sottotitoli dentro una pastiglia"],
  ["muted", "bg-hover", AA, "il sottotitolo di una riga selezionata"],

  // I due token che esistono **per** stare sopra qualcosa: il nome lo dice.
  ["accent-contrast", "accent", AA, "il testo di un bottone pieno"],
  ["danger-contrast", "danger", AA, "il testo di un bottone distruttivo"],
  ["bg", "accent-soft", AA, "button:hover, #mode-switch attivo, .hit-snippet mark"],

  // L'accento come **ink**: è il ruolo di `--accent-soft`, ed è per
  // questo che i due esistono separati.
  ["accent-soft", "bg", AA, ".brand, i link-button al passaggio"],
  ["accent-soft", "bg-elev", AA, "il titolo di uno spazio, il chevron"],
  ["accent-soft", "bg-input", AA, ".ui-badge.intent-primary"],
  ["danger", "bg", AA, "un messaggio d'errore"],
  ["danger", "bg-elev", AA, "un errore dentro un pannello"],
  ["danger", "bg-input", AA, ".ui-badge.intent-danger"],

  // L'accento come **segno**: fondo di un bottone, contorno di una selezione,
  // riga sotto una scheda. Non è testo, e la soglia è quella dei segni.
  ["accent", "bg", UI, "il fondo di un bottone, il bordo di un campo a fuoco"],
  ["accent", "bg-elev", UI, "il bordo attivo di una scheda"],
  ["accent", "bg-hover", UI, "il contorno di una riga selezionata"],
  ["focus-ring", "bg", UI, "l'anello del fuoco"],
  ["focus-ring", "bg-elev", UI, "l'anello del fuoco dentro un pannello"],
  ["focus-ring", "bg-input", UI, "l'anello del fuoco su un campo"],

  // Il grafo disegna su canvas: nessuna regola CSS lo raggiunge, e i suoi
  // colori li legge `panels/graph.ts` da qui. È la superficie che si dimentica
  // per prima quando si cambia tema, ed è il motivo per cui sta in tabella.
  ["graph-node", "bg", UI, "un nodo del grafo"],
  ["graph-node-active", "bg", UI, "il nodo della nota aperta"],
  ["graph-node-hover", "bg", UI, "il nodo sotto il puntatore"],

  // La superficie del documento: qui il testo è la nota, e la soglia è quella
  // del testo — tranne i titoli, che sono testo grande per definizione.
  ["doc-fg", "doc-bg", AA, "il corpo di una nota"],
  ["doc-link", "doc-bg", AA, "un wikilink"],
  ["doc-danger", "doc-bg", AA, "un wikilink rotto"],
  ["doc-gutter-fg", "doc-bg", AA, "i numeri di riga"],
  ["doc-heading", "doc-bg", UI, "un titolo reso"],
  ["doc-caret", "doc-bg", UI, "il cursore di scrittura"],
];

/// Le dieci specie della tavolozza di sintassi, tutte contro il fondo del
/// documento: è l'unico fondo su cui vivano.
const SYNTAX_TOKENS = [
  "keyword",
  "name",
  "function",
  "literal",
  "type",
  "operator",
  "comment",
  "string",
  "heading",
  "invalid",
] as const;

/// I tre fondi su cui una specie di sintassi può finire: la pagina, la riga
/// attiva, e la selezione. Sono tre e non uno perché il testo evidenziato è
/// ancora testo — e il fondo della selezione è il più lontano dei tre dalla
/// carta, cioè quello su cui un colore tarato solo sulla pagina cede per primo.
const PAPER_BACKGROUNDS = ["doc-bg", "doc-active-line", "doc-selection"] as const;

type Theme = "dark" | "light";

// ---------------------------------------------------------------------------
// I token, letti dal foglio vero.
// ---------------------------------------------------------------------------

/// Il corpo di un blocco `selettore { … }` di primo livello, coi commenti già
/// tolti: senza toglierli, un `--token: valore;` citato dentro una spiegazione
/// entrerebbe nella tavolozza come se fosse dichiarato.
function block(css: string, selector: string): string {
  const closed = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`^${closed}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(css);
  if (!found) throw new Error(`«${selector}» non è un blocco di tokens.css`);
  return found[1]!;
}
/// I temi come li vede il browser: fogli completi, montati per
/// **sostituzione**. Il chiaro non eredita più nulla dallo scuro — non è un
/// blocco `:root[data-theme="light"]` che ridichiara solo ciò che cambia, è un
/// gemello completo che il caricatore (`theme/loader.ts`) monta al posto del
/// gemello scuro. La cascata non c'è più, e con lei il risparmio di non
/// ricopiare i valori: il prezzo è liste che devono restare uguali, e lo tiene
/// `struttura.test.ts`. Qui ciascun file si legge da sé.
function palettes(
  dark: string,
  light: string,
): Record<Theme, Record<string, string>> {
  const token = (css: string): Record<string, string> => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    return Object.fromEntries(
      [...block(withoutComments, ":root").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
        m[1]!,
        m[2]!.trim(),
      ]),
    );
  };
  return { dark: token(dark), light: token(light) };
}

const PALETTES = palettes(dark, light);
const THEMES = ["dark", "light"] as const;

describe("il conto è quello della WCAG", () => {
  // I due estremi e un valore noto: senza, un errore di segno nella formula
  // renderebbe verde qualunque tabella.
  it("bianco su nero è 21:1, e un colore con sé stesso è 1:1", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#a3e635", "#a3e635")).toBeCloseTo(1, 5);
  });

  it("e il verso non conta", () => {
    expect(contrast("#ffffff", "#a3e635")).toBeCloseTo(contrast("#a3e635", "#ffffff"), 10);
  });

  it("il grigio a metà scala sopra il bianco sta poco sotto 4:1", () => {
    // `#767676` è l'esempio canonico della WCAG: il grigio più chiaro che
    // regge 4,5:1 sul bianco è `#767676`, e sta appena sopra.
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
  });
});

describe("i token si leggono davvero dal foglio", () => {
  // La prova che le tabelle qui sotto non passano perché la tavolozza è vuota,
  // che è il modo in cui un presidio su un file letto come testo smette di
  // presidiare senza dirlo — la stessa cautela del presidio della scocca.
  it("le due tavolozze sono piene, e sono due", () => {
    expect(Object.keys(PALETTES.dark).length).toBeGreaterThan(50);
    // Il riconoscimento passa dalla **carta**, che nella ricetta è l'estremo
    // dichiarato (0 al buio, 1 in luce) e non un valore che si ricava: un `--bg`
    // scritto qui farebbe diventare rosso il presidio del contrasto il giorno in
    // cui cambia il passo della scala, che è un'altra cosa e ha un altro banco.
    expect(PALETTES.dark["doc-bg"], "al buio la carta è il nero").toBe("#000000");
    expect(PALETTES.light["doc-bg"], "in luce la carta è il bianco").toBe("#ffffff");
    // I valori non-colore identici fra i fogli (la scala, il moto, i quattro
    // alpha) li presidia `struttura.test.ts`: qui conta il contrasto, non la
    // gemellarità del vocabolario.
  });

  it("ogni coppia dichiarata nomina token che esistono", () => {
    // Un token rinominato senza aggiornare la tabella lascerebbe una coppia
    // che non si conta più — e un presidio che salta le righe che non capisce
    // è un presidio che si spegne da solo.
    const missing = PAIRS.flatMap(([a, b]) =>
      THEMES.flatMap((theme) =>
        [a, b].filter((n) => PALETTES[theme][n] === undefined).map((n) => `${theme}: --${n}`),
      ),
    );
    expect(missing).toEqual([]);
  });
});

describe.each(THEMES)("il tema %s regge le soglie che dichiara", (theme) => {
  const palette = PALETTES[theme];
  const measurement = (a: string, b: string) => contrast(palette[a]!, palette[b]!);

  it.each(PAIRS)("%s sopra %s ≥ %d:1 (%s)", (ink, background, threshold, where) => {
    const v = measurement(ink, background);
    expect(
      v,
      `--${ink} (${palette[ink]}) sopra --${background} (${palette[background]}) sta a ` +
        `${v.toFixed(2)}:1, sotto la soglia ${threshold}:1 che «${where}» pretende`,
    ).toBeGreaterThanOrEqual(threshold);
  });

  it("ogni specie di sintassi regge la soglia del testo, su tutti e tre i fondi", () => {
    // Era il debito del file, ed era un elenco di sette nomi in luce chiara. La
    // §31.2 l'ha pagato ricavando le dieci specie da una mira sola invece che
    // prendendole da una tavolozza altrui, e qui non resta un elenco da tenere
    // aggiornato: resta la soglia. Un nome che ricomparisse in questa lista
    // sarebbe un debito **nuovo**, e andrebbe deciso — non ereditato.
    //
    // I fondi sono tre e non uno perché tre sono quelli su cui il codice finisce
    // davvero: la selezione è il più lontano dalla carta, ed è là che un colore
    // tarato solo sulla pagina cede.
    const below = SYNTAX_TOKENS.flatMap((s) =>
      PAPER_BACKGROUNDS.map((f) => [`syn-${s}`, f, measurement(`syn-${s}`, f)] as const),
    ).filter(([, , v]) => v < AA);
    expect(
      below.map(([s, f, v]) => `--${s} su --${f}: ${v.toFixed(2)}:1`),
      "una specie di sintassi sotto 4,5:1 è testo che non si legge: si alza la " +
        "mira della famiglia nella ricetta, non si scrive un'esenzione qui",
    ).toEqual([]);
  });

  it("e nemmeno l'ink del documento cede sul fondo più lontano", () => {
    // Le stesse tre superfici, per i ruoli non-sintassi che ci vivono sopra: il
    // corpo della nota, i wikilink, i numeri di riga. La tabella delle coppie li
    // conta sulla sola pagina perché è là che una regola di `skin.css` li mette;
    // la selezione invece non è una regola, è uno stato — e uno stato che
    // peggiora la leggibilità del testo che evidenzia sarebbe un difetto muto.
    const DOCUMENT_INKS = ["doc-fg", "doc-link", "doc-danger", "doc-gutter-fg"];
    const below = DOCUMENT_INKS.flatMap((n) =>
      PAPER_BACKGROUNDS.map((f) => [n, f, measurement(n, f)] as const),
    ).filter(([, , v]) => v < AA);
    expect(
      below.map(([n, f, v]) => `--${n} su --${f}: ${v.toFixed(2)}:1`),
      "selezionare una riga non deve renderla meno leggibile di prima",
    ).toEqual([]);
  });
});
