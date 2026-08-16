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
// una coppia è nella tabella è perché una regola di `style.css` la mette
// davvero insieme, e il commento accanto dice quale.
//
// Il presidio non è il conto: il conto lo sapeva fare chiunque anche prima. Il
// presidio è che le coppie sono **enumerate in un posto solo** e ricontate a
// ogni giro, in **tutti e due i temi**. Un tema chiaro nasce ricopiando venti
// valori e cambiandone il verso, ed è l'operazione in cui un colore scelto per
// reggere sul nero finisce sopra il bianco senza che nessuno se ne accorga:
// tutto si vede, niente diventa rosso. Otto coppie sono entrate qui già rosse.
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
// # La tavolozza della sintassi, e il debito che porta con sé
//
// I `--syn-*` sono l'unico gruppo che **non** regge la soglia del testo, ed è
// una scelta dichiarata invece che un'omissione. Sono One Dark e One Light presi
// **interi**: è la coppia a rendere vera l'affermazione di `tokens.css` — «la
// stessa nota in due luci» — e ritoccarne i colori uno alla volta per portarli
// a 4,5:1 lascerebbe una tavolozza che non è più nessuna delle due, scelta un
// colore per volta da chi passava di lì.
//
// Quindi: pavimento a 3:1 per tutti, e l'elenco di quelli che stanno **sotto**
// la soglia del testo scritto qui dentro, per nome, e verificato uguale. Non è
// un'esenzione — un'esenzione si scrive una volta e non si guarda più. È un
// lucchetto: un colore che scende sotto AA senza essere in elenco è rosso, e
// uno che sale e resta in elenco è rosso pure lui. Il debito ha già la sua
// voce, ed è il **25.1** (alto contrasto), che esiste per dare a chi legge una
// tavolozza che questa soglia la passa tutta.
import { describe, expect, it } from "vitest";

import tokens from "./tokens.css?raw";

/// La soglia del testo (WCAG 1.4.3).
const AA = 4.5;
/// La soglia del testo grande e di ciò che non è testo (WCAG 1.4.11).
const UI = 3;

/// Una coppia dichiarata: chi sta sopra chi, quanto deve reggere, e per quale
/// regola vera — la terza colonna è ciò che impedisce a questa tabella di
/// diventare una lista di buone intenzioni.
type Coppia = readonly [inchiostro: string, fondo: string, soglia: number, dove: string];

const COPPIE: readonly Coppia[] = [
  // Il testo della shell sulle quattro superfici. `--bg-hover` è una superficie
  // come le altre da quando le righe non si riempiono più d'accento.
  ["text", "bg", AA, "il corpo dell'app"],
  ["text", "bg-elev", AA, "topbar, pannelli, modali"],
  ["text", "bg-input", AA, "campi, pastiglie"],
  ["text", "bg-hover", AA, "una riga sotto il puntatore, o selezionata"],
  ["muted", "bg", AA, ".muted, i sottotitoli"],
  ["muted", "bg-elev", AA, "i sottotitoli dentro un pannello"],
  ["muted", "bg-input", AA, "i sottotitoli dentro una pastiglia"],
  ["muted", "bg-hover", AA, "il sottotitolo di una riga selezionata"],

  // I due token che esistono **per** stare sopra qualcosa: il nome lo dice.
  ["accent-contrast", "accent", AA, "il testo di un bottone pieno"],
  ["danger-contrast", "danger", AA, "il testo di un bottone distruttivo"],
  ["bg", "accent-soft", AA, "button:hover, #mode-switch attivo, .hit-snippet mark"],

  // L'accento come **inchiostro**: è il ruolo di `--accent-soft`, ed è per
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
const SINTASSI = [
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

/// Il debito dichiarato: le specie di sintassi che stanno **sotto** la soglia
/// del testo, tema per tema. Un elenco, non un'esenzione — chi entra o esce da
/// qui lo fa apposta, e il test lo dice.
const SOTTO_AA: Record<Tema, readonly string[]> = {
  dark: [],
  light: ["name", "function", "type", "operator", "comment", "string", "heading"],
};

type Tema = "dark" | "light";

// ---------------------------------------------------------------------------
// Il conto: WCAG 2.1, §1.4.3 e la definizione di rapporto di contrasto.
// ---------------------------------------------------------------------------

/// `#rrggbb` → i tre canali. Solo esadecimale: i token in `rgb(… / …)` sono
/// veli e ombre, cioè colori che stanno **sopra** qualcosa di variabile, e il
/// loro contrasto non è una funzione dei soli token.
function canali(colore: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colore);
  if (!m) throw new Error(`«${colore}» non è un colore esadecimale a sei cifre`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/// La luminanza relativa (WCAG, *relative luminance*).
function luminanza(colore: string): number {
  const [r, g, b] = canali(colore).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// Il rapporto di contrasto fra due colori: `(L1 + 0,05) / (L2 + 0,05)`, col
/// più chiaro sopra. È simmetrico — quale dei due sia l'inchiostro non cambia
/// il numero, e infatti la tabella li ordina per leggibilità e non per conto.
export function contrasto(a: string, b: string): number {
  const [x, y] = [luminanza(a), luminanza(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---------------------------------------------------------------------------
// I token, letti dal foglio vero.
// ---------------------------------------------------------------------------

/// Il corpo di un blocco `selettore { … }` di primo livello, coi commenti già
/// tolti: senza toglierli, un `--token: valore;` citato dentro una spiegazione
/// entrerebbe nella tavolozza come se fosse dichiarato.
function blocco(css: string, selettore: string): string {
  const chiuso = selettore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trovato = new RegExp(`^${chiuso}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(css);
  if (!trovato) throw new Error(`«${selettore}» non è un blocco di tokens.css`);
  return trovato[1]!;
}

/// I due temi, come li vede il browser: lo scuro è `:root`, il chiaro è
/// `:root` **più** ciò che ridichiara — che è esattamente la cascata, e il
/// motivo per cui il chiaro può permettersi di ridichiarare solo i colori che
/// cambiano.
function tavolozze(css: string): Record<Tema, Record<string, string>> {
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const token = (corpo: string): Record<string, string> =>
    Object.fromEntries(
      [...corpo.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
    );
  const dark = token(blocco(senzaCommenti, ":root"));
  return { dark, light: { ...dark, ...token(blocco(senzaCommenti, ':root[data-theme="light"]')) } };
}

const TAVOLOZZE = tavolozze(tokens);
const TEMI = ["dark", "light"] as const;

describe("il conto è quello della WCAG", () => {
  // I due estremi e un valore noto: senza, un errore di segno nella formula
  // renderebbe verde qualunque tabella.
  it("bianco su nero è 21:1, e un colore con sé stesso è 1:1", () => {
    expect(contrasto("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrasto("#a3e635", "#a3e635")).toBeCloseTo(1, 5);
  });

  it("e il verso non conta", () => {
    expect(contrasto("#ffffff", "#a3e635")).toBeCloseTo(contrasto("#a3e635", "#ffffff"), 10);
  });

  it("il grigio a metà scala sopra il bianco sta poco sotto 4:1", () => {
    // `#767676` è l'esempio canonico della WCAG: il grigio più chiaro che
    // regge 4,5:1 sul bianco è `#767676`, e sta appena sopra.
    expect(contrasto("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrasto("#777777", "#ffffff")).toBeLessThan(4.5);
  });
});

describe("i token si leggono davvero dal foglio", () => {
  // La prova che le tabelle qui sotto non passano perché la tavolozza è vuota,
  // che è il modo in cui un presidio su un file letto come testo smette di
  // presidiare senza dirlo — la stessa cautela del presidio della scocca.
  it("le due tavolozze sono piene, e il chiaro ne ridichiara una parte", () => {
    expect(Object.keys(TAVOLOZZE.dark).length).toBeGreaterThan(50);
    expect(TAVOLOZZE.dark.bg).toBe("#000000");
    expect(TAVOLOZZE.light.bg).toBe("#f7f7f9");
    // Il chiaro eredita le dimensioni invece di ricopiarle: se un giorno
    // ridichiarasse tutto, sarebbe la duplicazione che tokens.css evita.
    expect(TAVOLOZZE.light["space-4"]).toBe(TAVOLOZZE.dark["space-4"]);
  });

  it("ogni coppia dichiarata nomina token che esistono", () => {
    // Un token rinominato senza aggiornare la tabella lascerebbe una coppia
    // che non si conta più — e un presidio che salta le righe che non capisce
    // è un presidio che si spegne da solo.
    const mancanti = COPPIE.flatMap(([a, b]) =>
      TEMI.flatMap((tema) =>
        [a, b].filter((n) => TAVOLOZZE[tema][n] === undefined).map((n) => `${tema}: --${n}`),
      ),
    );
    expect(mancanti).toEqual([]);
  });
});

describe.each(TEMI)("il tema %s regge le soglie che dichiara", (tema) => {
  const palette = TAVOLOZZE[tema];
  const misura = (a: string, b: string) => contrasto(palette[a]!, palette[b]!);

  it.each(COPPIE)("%s sopra %s ≥ %d:1 (%s)", (inchiostro, fondo, soglia, dove) => {
    const v = misura(inchiostro, fondo);
    expect(
      v,
      `--${inchiostro} (${palette[inchiostro]}) sopra --${fondo} (${palette[fondo]}) sta a ` +
        `${v.toFixed(2)}:1, sotto la soglia ${soglia}:1 che «${dove}» pretende`,
    ).toBeGreaterThanOrEqual(soglia);
  });

  it("nessun colore di sintassi scende sotto il pavimento dei segni", () => {
    const sotto = SINTASSI.map((s) => [s, misura(`syn-${s}`, "doc-bg")] as const).filter(
      ([, v]) => v < UI,
    );
    expect(
      sotto.map(([s, v]) => `--syn-${s}: ${v.toFixed(2)}:1`),
      "sotto 3:1 un colore di sintassi non si distingue più dal fondo: " +
        "il pavimento vale anche per la tavolozza che il debito AA se lo tiene",
    ).toEqual([]);
  });

  it("e il debito AA della tavolozza di sintassi è quello dichiarato, né uno di più né uno di meno", () => {
    // Le due direzioni contano tutte e due. Uno di più è un colore peggiorato
    // che nessuno ha deciso di peggiorare; uno di meno è un elenco che si porta
    // dietro un debito già pagato, cioè la ragione per cui gli elenchi di
    // esenzioni smettono di dire il vero.
    const sotto = SINTASSI.filter((s) => misura(`syn-${s}`, "doc-bg") < AA);
    expect(
      [...sotto].sort(),
      "aggiorna SOTTO_AA in questo file: l'elenco è il lucchetto, non un'esenzione",
    ).toEqual([...SOTTO_AA[tema]].sort());
  });
});
