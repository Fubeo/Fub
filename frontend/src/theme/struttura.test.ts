// Il confine della struttura (§29.1): **ciò che nessun tema sostituisce**, e
// ciò che i due fogli non possono divergere.
//
// Il foglio visivo è spezzato in tre strati: la **struttura** (scocca, piani,
// garanzie) sta alla shell e non si tematizza; il **foglio** (scala, ruoli,
// moto) e la **pelle** (chrome) stanno nel fascio del tema e li monta il
// caricatore a sostituzione. Questo banco presidia i due confini che quella
// separazione disegna, e li presidia **senza DOM**: i quattro file si leggono
// col `?raw` di Vite e si confrontano come testo. La ragione è la stessa del
// presidio del contrasto (`contrast.test.ts`): i token stanno scritti in un
// file, e il confronto è aritmetica su stringhe, non rendering.
//
// # I due confini
//
// 1. **Struttura contro foglio.** La struttura dichiara otto token — le metriche
//    della scocca (`--titlebar-h`, `--rail-w`) e i piani (`--z-*`) — e nessun
//    altro. Non dichiara token del foglio e non ne consuma la scala: un
//    `--space-*` che comparisse qui vorrebbe dire che la geometria della
//    finestra si muove col tema, che è proprio ciò che la separazione evita.
//    Le uniche var() del foglio che la struttura consume sono l'anello del
//    fuoco (`--focus-ring`, `--focus-ring-width`, `--focus-ring-offset`): che
//    il fuoco si veda è una garanzia della shell, la forma dell'anello è un
//    ruolo, e il caricatore garantisce che un foglio è montato prima che la
//    regola possa valere.
//
// 2. **Foglio scuro contro foglio chiaro.** I due fogli sono gemelli completi:
//    lo stesso vocabolario, e i valori **non-colore** identici. Il colore, e
//    solo lui, è ciò che cambia. Il vocabolario si conta (stesso insieme di
//    nomi, stesso numero), e i valori non-colore si verificano per nome,
//    contro un elenco chiuso: la scala, il moto, le misure dell'anello, e i
//    quattro riempimenti in alpha scelti perché reggono su entrambi i fondi.
//    Un token di quell'elenco che divergesse sarebbe la duplicazione che
//    diverge — il motivo per cui il chiaro è completo e non un override.
//
// # Perché la pelle sta qui
//
// La pelle dichiara zero token: li consume, non li dichiara. Un `--nome:`
// dentro pelle.css vorrebbe dire che il chrome porta la propria scala, e un
// tema di terzi che la ridefinisse troverbbe due scale in gara. Il banco lo
// prova: nessuna riga di dichiarazione.
import { describe, expect, it } from "vitest";

import struttura from "./struttura.css?raw";
import scuro from "./serie/foglio-scuro.css?raw";
import chiaro from "./serie/foglio-chiaro.css?raw";
import pelle from "./serie/pelle.css?raw";

/// I otto token della scocca e dei piani: ciò che la struttura dichiara, e
/// nient'altro. Se ne compare un nono, il banco diventa rosso; se ne manca uno,
/// lo stesso. L'ordine è quello del file, ma il banco non lo presidia: presidia
/// l'insieme.
const TOKEN_STRUTTURA = [
  "titlebar-h",
  "rail-w",
  "z-menu",
  "z-picker",
  "z-popover",
  "z-dialog",
  "z-toast",
  "z-modal",
] as const;

/// I valori non-colore che i due fogli dichiarano identici: la scala (spazi,
/// raggi, tipografia, pesi, interlinea, tracking), il moto (durate e curve), le
/// misure dell'annello del fuoco, e i quattro riempimenti/righe in alpha scelti
/// perché reggono su entrambi i fondi. Un token di questo elenco che divergesse
/// fra i due fogli è la duplicazione che diverge.
const NON_COLORE_IDENTICI = [
  // La scala.
  "space-1", "space-2", "space-3", "space-4", "space-5",
  "space-6", "space-7", "space-8", "space-9", "space-10",
  "radius-xs", "radius-sm", "radius-md", "radius-lg", "radius-pill",
  "font-ui", "font-mono",
  "text-xs", "text-sm", "text-base", "text-md", "text-lg", "text-xl",
  "weight-medium", "weight-bold",
  "leading-tight",
  "tracking-caps",
  // Il moto.
  "duration-fast", "duration-med", "duration-slow",
  "ease", "ease-out", "ease-in",
  // Le misure dell'anello del fuoco: viaggiano col colore ma sono parte della
  // forma, e la forma non cambia col tema.
  "focus-ring-width", "focus-ring-offset",
  // I quattro riempimenti/righe in alpha su grigio: scelti perché reggono su
  // entrambi i fondi, e per questo identici nei due fogli.
  "doc-fill", "doc-fill-soft", "doc-rule", "doc-rule-soft",
] as const;

/// Le uniche var() del foglio che la struttura può consumare: l'anello del
/// fuoco. `--focus-ring` è il colore, le altre due le misure. Tutto il resto
/// del foglio (la scala, i ruoli, il moto) non si legge da qui. È una tabella
/// statica di chiavi stringa: membership con `Record<string, true>`, e non
/// un `Set`, perché nessun inserimento a runtime.
const VAR_FOGLIO_PERMESSE_NELLA_STRUTTURA: Record<string, true> = Object.fromEntries(
  ["focus-ring", "focus-ring-width", "focus-ring-offset"].map((n) => [n, true]),
);

/// Il corpo di un blocco `selettore { … }` di primo livello, coi commenti già
/// tolti: senza toglierli, un `--token: valore;` citato dentro una spiegazione
/// entrerebbe nella tavolozza come se fosse dichiarato. È lo stesso modo di
/// parsare di `contrast.test.ts`.
function blocco(css: string, selettore: string): string {
  const chiuso = selettore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trovato = new RegExp(`^${chiuso}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(css);
  if (!trovato) throw new Error(`«${selettore}» non è un blocco del file`);
  return trovato[1]!;
}

/// I token dichiarati in un corpo, come mappa `nome → valore` (valore grezzo,
/// spazi ai bordi tolti). È la stessa regex di `contrast.test.ts`: niente di
/// nuovo da mantenere.
function tokenDi(corpo: string): Record<string, string> {
  return Object.fromEntries(
    [...corpo.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

/// I token dichiarati in `:root` di un file, coi commenti già tolti.
function tavolozza(file: string): Record<string, string> {
  const senzaCommenti = file.replace(/\/\*[\s\S]*?\*\//g, "");
  return tokenDi(blocco(senzaCommenti, ":root"));
}

const STRUTTURA = tavolozza(struttura);
const SCURO = tavolozza(scuro);
const CHIARO = tavolozza(chiaro);

describe("la struttura dichiara la scocca e i piani, e nient'altro", () => {
  it("dichiara esattamente gli otto token scocca+piani, in :root", () => {
    const dichiarati = Object.keys(STRUTTURA).sort();
    const attesi = [...TOKEN_STRUTTURA].sort();
    expect(
      dichiarati,
      "la struttura dichiara otto token e solo quelli: un nono vorrebbe dire " +
        "che la scocca legge dal foglio, un mancante che un piano non ha più nome",
    ).toEqual(attesi);
  });

  it("non dichiara nessun token del foglio (scala, ruoli, moto)", () => {
    // Un token del foglio nella struttura vorrebbe dire che la geometria della
    // finestra si muove col tema. La scala (`--space-*`, `--radius-*`, …) sta
    // nel foglio, e la scocca non la consuma.
    const delFoglio = Object.keys(STRUTTURA).filter((n) => !TOKEN_STRUTTURA.includes(n as never));
    expect(
      delFoglio,
      "la struttura non dichiara token del foglio: la scocca non si tematizza",
    ).toEqual([]);
  });
});

describe("la struttura non consuma la scala del foglio", () => {
  it("ogni var() citata in struttura.css è un token di struttura o l'anello del fuoco", () => {
    // Si cercano le `var(--x)` in tutto il file (non solo nel `:root`): le
    // regole geometriche consumano i token di struttura, e l'unica regola
    // che legge il foglio è l'anello del fuoco. Un `--space-*` qui vorrebbe
    // dire che la scocca si muove col tema.
    const senzaCommenti = struttura.replace(/\/\*[\s\S]*?\*\//g, "");
    const citate = new Set(
      [...senzaCommenti.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]!),
    );
    // Le chiavi permesse sono tabelle statiche: `TOKEN_STRUTTURA` (array) e
    // `VAR_FOGLIO_PERMESSE_NELLA_STRUTTURA` (Record). Membership su un Record
    // unificato, senza costruire un `Set` da letterali.
    const permesso: Record<string, true> = { ...VAR_FOGLIO_PERMESSE_NELLA_STRUTTURA };
    for (const n of TOKEN_STRUTTURA) permesso[n] = true;
    const fuori = [...citate].filter((n) => !permesso[n]);
    expect(
      fuori,
      "struttura.css cita solo token di struttura o l'anello del fuoco: " +
        "un `--space-*` qui vorrebbe dire che la geometria dipende dal tema",
    ).toEqual([]);
  });
});

describe("i due fogli sono gemelli: stesso vocabolario", () => {
  it("dichiarano lo stesso insieme di nomi, e sono pieni (floor > 75)", () => {
    const nomiScuro = Object.keys(SCURO).sort();
    const nomiChiaro = Object.keys(CHIARO).sort();
    expect(
      Object.keys(SCURO).length,
      "il foglio scuro è pieno: sotto 75 token un gemello è incompleto",
    ).toBeGreaterThan(75);
    expect(
      Object.keys(CHIARO).length,
      "il foglio chiaro è pieno quanto il gemello",
    ).toBeGreaterThan(75);
    expect(
      nomiScuro,
      "i due fogli dichiarano gli stessi nomi: un token in più o in meno è " +
        "un gemello che diverge",
    ).toEqual(nomiChiaro);
  });

  it("nessuno dei due dichiara un token di struttura (scocca o piani)", () => {
    // I token della struttura appartengono alla shell, non al tema. Un foglio
    // che li ridichiara si prenderebbe la scocca, e la sostituzione la
    // porterebbe via.
    const scuroStruttura = Object.keys(SCURO).filter((n) => TOKEN_STRUTTURA.includes(n as never));
    const chiaroStruttura = Object.keys(CHIARO).filter((n) =>
      TOKEN_STRUTTURA.includes(n as never),
    );
    expect(
      scuroStruttura,
      "il foglio scuro non dichiara token di struttura: la scocca non si tematizza",
    ).toEqual([]);
    expect(
      chiaroStruttura,
      "il foglio chiaro non dichiara token di struttura: la scocca non si tematizza",
    ).toEqual([]);
  });
});

describe("i due fogli hanno i valori non-colore identici", () => {
  it("ogni token dell'elenco condiviso ha lo stesso valore nei due fogli", () => {
    // È il cuore del gemello: la scala, il moto, le misure dell'anello, e i
    // quattro alpha. Un valore che diverge è la duplicazione che diverge —
    // il motivo per cui il chiaro è completo e non un override.
    const divergenti = NON_COLORE_IDENTICI.filter((n) => {
      const s = SCURO[n];
      const c = CHIARO[n];
      return s === undefined || c === undefined || s !== c;
    }).map((n) => {
      const s = SCURO[n] ?? "<mancante>";
      const c = CHIARO[n] ?? "<mancante>";
      return `${n}: scuro=${s} chiaro=${c}`;
    });
    expect(
      divergenti,
      "i valori non-colore dei due fogli coincidono: un token dell'elenco " +
        "condiviso che diverge è la duplicazione che diverge",
    ).toEqual([]);
  });

  it("i due fogli differiscono davvero sui colori (non sono copie identiche)", () => {
    // La prova complementare: se i due fogli fossero identici per intero, il
    // test sopra passerebbe ma il gemello sarebbe un falso.
    //
    // I due discriminanti sono quelli che i fogli **dichiarano**, non quelli che
    // la ricetta ricava. Dalla §31.2 un `--bg` è il gradino `n` di una scala, e
    // il suo esadecimale cambia se cambia il passo: scriverlo qui vorrebbe dire
    // far diventare rosso il presidio della struttura per una ragione che con la
    // struttura non c'entra. La carta invece è **l'estremo**, dichiarato tale
    // nella ricetta (0 al buio, 1 in luce), e `color-scheme` è la riga con cui
    // ciascun foglio dice in che luce sta. Nessuna delle due si ricava.
    expect(SCURO["doc-bg"], "al buio la carta è il nero, e resta l'estremo").toBe("#000000");
    expect(CHIARO["doc-bg"], "in luce la carta è il bianco").toBe("#ffffff");
    expect(scuro, "il foglio scuro si dichiara scuro al motore").toContain("color-scheme: dark;");
    expect(chiaro, "il foglio chiaro si dichiara chiaro").toContain("color-scheme: light;");
  });

  it("e fuori da quell'elenco, ciò che resta uguale nelle due luci è dichiarato", () => {
    // Il verso complementare, ed è il più utile dei due: `NON_COLORE_IDENTICI`
    // dice cosa **deve** coincidere, questo dice che non coincide nient'altro.
    // Un colore uguale nei due fogli senza essere in elenco è il sintomo di una
    // luce che si ricopia dall'altra invece di ricavarsi dalla propria carta —
    // ed è esattamente il difetto che il gemello completo rischia di reintrodurre
    // ogni volta che qualcuno aggiunge un ruolo.
    //
    // L'unica eccezione vera sono i **controcolori**: `--accent-contrast` è il
    // nero in tutte e due le luci perché l'accento è un lime chiaro in tutte e
    // due, e il nero ci regge sopra da entrambe le parti. Non è una copia: è due
    // conti indipendenti che danno lo stesso risultato.
    const COLORI_CHE_COINCIDONO = ["accent-contrast"];
    const fuoriElenco = Object.keys(SCURO).filter(
      (n) =>
        SCURO[n] === CHIARO[n] &&
        !NON_COLORE_IDENTICI.includes(n as never) &&
        !COLORI_CHE_COINCIDONO.includes(n),
    );
    expect(
      fuoriElenco.map((n) => `${n}: ${SCURO[n]}`),
      "un colore identico nei due fogli e non dichiarato tale: o va in " +
        "`NON_COLORE_IDENTICI` perché non è colore, o fra i controcolori perché " +
        "il conto dà lo stesso esito, o è una luce che ha ricopiato l'altra",
    ).toEqual([]);
  });
});

describe("la pelle dichiara zero token", () => {
  it("non contiene nessuna riga di dichiarazione `--nome:`", () => {
    // La pelle consume i ruoli del foglio e non li dichiara. Una dichiarazione
    // qui vorrebbe dire che il chrome porta la propria scala, e un tema di
    // terzi che la ridefinisse troverbbe due scale in gara. Si cercano le
    // dichiarazioni fuori dai commenti: un `--token: valore;` citato in una
    // spiegazione non conta.
    const senzaCommenti = pelle.replace(/\/\*[\s\S]*?\*\//g, "");
    const dichiarazioni = [...senzaCommenti.matchAll(/--([\w-]+)\s*:[^;]+;/g)].map((m) => m[1]!);
    expect(
      dichiarazioni,
      "la pelle dichiara zero token: un `--nome:` qui vorrebbe dire che il " +
        "chrome porta una scala propria, fuori dal foglio",
    ).toEqual([]);
  });
});