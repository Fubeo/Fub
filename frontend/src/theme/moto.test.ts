// Il pavimento del moto della scocca (§29.1): le durate e le curve che il
// foglio dichiara, e la pelle che le spende senza inventarne.
//
// Il moto è parte del foglio — non della struttura, non della pelle — e sta
// in **entrambi** i gemelli col medesimo valore. La ragione è la stessa del
// presidio della struttura (`struttura.test.ts`) e del contrasto
// (`contrast.test.ts`): i token stanno scritti in un file, e il confronto è
// aritmetica su stringhe, non rendering. Qui il DOM non serve affatto, e non
// lo si monta: tre file si leggono col `?raw` di Vite e si interrogano.
//
// # Cosa presidia questo banco
//
// Sei token — tre durate e tre curve — e il loro esatto valore, identico nei
// due fogli. La gemellatura del moto vale come quella della scala: una durata
// che divergesse fra scuro e chiaro sarebbe la duplicazione che diverge. La
// pelle, poi, li consume e non li dichiara: un `--nome:` nel chrome vorrebbe
// dire che il moto ha una seconda scala, fuori dal foglio, e un tema di terzi
// che la ridefinisse ne troverbbe due in gara. Lo stesso divieto della pelle
// sui token di colore, e per la stessa ragione.
//
// # Ciò che il moto non è
//
// Un loop infinito è decorazione, non moto: la scocca non respira, il brand
// non ruota, un pallino non pulsa. Chi scrive non deve vedere la pagina che
// si muove da sola, e l'editor è sacro — il moto si ferma alla soglia di
// `.cm-editor` e `.pane-editor`, e lì diventa `none`. L'ingresso di un'overlay
// si anima; la chiusura no, perché `[hidden]` è immediato nella struttura e
// non si combatte. Si anima ciò che entra, non ciò che sta.
//
// # Lime non è più un fascio
//
// Il fascio di terzi è stato rimosso: la cartella `terzi/lime` non esiste più,
// e nessun foglio di serie dichiara al suo nome. Ma il nome è stato lì, e un
// token o un keyframe che lo riprendesse — un `--lime-a`, un `@keyframes
// lime` — sarebbe il ritorno di ciò che si è tolto. Il banco lo cerca nei
// due fogli e nella pelle, e se lo trova è rosso: non per astio, ma perché la
// rimozione è una promessa, e la promessa si conta a ogni giro.
import { describe, expect, it } from "vitest";

import scuro from "./serie/foglio-scuro.css?raw";
import chiaro from "./serie/foglio-chiaro.css?raw";
import pelle from "./serie/pelle.css?raw";

/// I sei token del moto: tre durate e tre curve. È un elenco chiuso, e un
/// token di moto che non è qui non è moto — è debito. I valori attesi sono
/// il contratto: se il foglio ne dichiara uno diverso, è il foglio che deve
/// cedere, non il banco ad adattarsi.
const MOTO = {
  "duration-fast": "120ms",
  "duration-med": "180ms",
  "duration-slow": "240ms",
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  "ease-out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "ease-in": "cubic-bezier(0.3, 0, 1, 1)",
} as const;

const TOKEN_MOTO = Object.keys(MOTO) as readonly (keyof typeof MOTO)[];

/// I tre keyframe dell'ingresso: il fade del root, il rise della superficie,
/// e il rise corto dei menu. Sono il vocabolario dell'animazione di entrata,
/// e un nome che non è qui non è ingresso.
const KEYFRAMES_FUB = ["fub-enter-fade", "fub-enter-rise", "fub-enter-rise-sm"] as const;

/// Il corpo di un blocco `selettore { … }` di primo livello, coi commenti già
/// tolti: senza toglierli, un `--token: valore;` citato dentro una spiegazione
/// entrerebbe nella tavolozza come se fosse dichiarato. È lo stesso modo di
/// parsare di `struttura.test.ts` e `contrast.test.ts`.
function blocco(css: string, selettore: string): string {
  const chiuso = selettore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trovato = new RegExp(`^${chiuso}\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(css);
  if (!trovato) throw new Error(`«${selettore}» non è un blocco del file`);
  return trovato[1]!;
}

/// I token dichiarati in un corpo, come mappa `nome → valore` (valore grezzo,
/// spazi ai bordi tolti). È la stessa regex di `struttura.test.ts`: niente di
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

/// La pelle coi commenti già tolti: le stringhe citate in una spiegazione
/// («niente infinite») non devono far rosso il banco. Lo stesso principio
/// della dichiarazione dei token: si contano fuori dai commenti.
const PELLE = pelle.replace(/\/\*[\s\S]*?\*\//g, "");

const SCURO = tavolozza(scuro);
const CHIARO = tavolozza(chiaro);

describe("i sei token di moto esistono in entrambi i fogli, valori identici", () => {
  it("dichiarano ciascuno il valore atteso, in scuro e in chiaro", () => {
    // La gemellatura del moto vale come quella della scala: una durata o una
    // curva che divergesse fra i due fogli è la duplicazione che diverge. Il
    // valore atteso è il contratto: se il foglio ne dichiara uno diverso, è
    // il foglio che cede.
    const divergenti = TOKEN_MOTO.filter((n) => {
      const s = SCURO[n];
      const c = CHIARO[n];
      return s === undefined || c === undefined || s !== c || s !== MOTO[n];
    }).map((n) => {
      const s = SCURO[n] ?? "<mancante>";
      const c = CHIARO[n] ?? "<mancante>";
      const atteso = MOTO[n];
      return `${n}: scuro=${s} chiaro=${c} atteso=${atteso}`;
    });
    expect(
      divergenti,
      "i sei token di moto stanno in entrambi i fogli col medesimo valore, " +
        "e il valore è quello del contratto: una durata che diverge è la " +
        "duplicazione che diverge",
    ).toEqual([]);
  });
});

describe("la pelle spende tutti i token di moto", () => {
  it("per ogni nome, la pelle contiene var(--<nome>)", () => {
    // Un token dichiarato e non speso è debito: la pelle lo consuma, non lo
    // dichiara, e un token che nessuno legge è una promessa non mantenuta.
    const nonSpesi = TOKEN_MOTO.filter((n) => !PELLE.includes(`var(--${n})`));
    expect(
      nonSpesi,
      "la pelle spende ogni token di moto: un `var(--duration-slow)` che non " +
        "c'è è una durata che il chrome non usa, cioè debito",
    ).toEqual([]);
  });
});

describe("la pelle non dichiara token", () => {
  it("non contiene nessuna riga di dichiarazione `--nome:`", () => {
    // La pelle consume i ruoli del foglio e non li dichiara. Una dichiarazione
    // qui vorrebbe dire che il chrome porta una scala di moto propria, fuori
    // dal foglio, e un tema di terzi che la ridefinisse ne troverbbe due in
    // gara. Si cercano le dichiarazioni fuori dai commenti: una riga di
    // assegnazione a un custom property citata in una spiegazione non conta.
    // È lo stesso divieto della pelle sui token di colore (`struttura.test.ts`),
    // e per la stessa ragione.
    // `^\s*--` e non `--` in mezzo alla riga: un **modificatore BEM** e un
    // custom property si scrivono con gli stessi due caratteri, e
    // `.win-ctrl--close:hover {` letto come testo è indistinguibile da una
    // dichiarazione `--close: …`. Un selettore comincia con `.`, `#`, `[` o un
    // tag; una dichiarazione comincia con i due trattini. La differenza è dove
    // stanno nella riga, e finché nessuno aveva scritto un modificatore seguito
    // da una pseudo-classe il presidio passava per fortuna (§31.4).
    const dichiarazioni = [...PELLE.matchAll(/^[ \t]*--([\w-]+)\s*:/gm)].map((m) => m[1]!);
    expect(
      dichiarazioni,
      "la pelle dichiara zero token, di moto come di colore: un `--nome:` " +
        "qui vorrebbe dire che il chrome porta una scala propria",
    ).toEqual([]);
  });
});

describe("niente moto infinito", () => {
  it("la pelle non contiene `infinite`", () => {
    // Un loop infinito è decorazione, non moto: la scocca non respira, il
    // brand non ruota, un pallino non pulsa. La scrittura non si anima da
    // sola. Si cerca fuori dai commenti: un commento che dica «niente
    // infinite» non deve far rosso il banco.
    expect(
      PELLE,
      "la pelle non contiene `infinite`: un loop infinito è decorazione, " +
        "non moto, e la scocca non respira",
    ).not.toMatch(/infinite/);
  });
});

describe("niente keyframe lime", () => {
  it("la pelle non dichiara @keyframes lime né usa nomi lime-", () => {
    // Lime non è più un fascio: se un keyframe o un nome col suo nome
    // ricomparisse, è il ritorno di ciò che si è tolto, ed è rosso. Lo si
    // cerca nella pelle — il foglio lo presidia il caso seguente — e lo si
    // cerca fuori dai commenti.
    expect(
      PELLE,
      "la pelle non contiene `@keyframes lime` né un nome `lime-`: il fascio " +
        "di terzi è rimosso, e il suo nome non deve tornare",
    ).not.toMatch(/@keyframes\s+lime\b|--lime-|lime-/);
  });
});

describe("hard-stop dell'editor", () => {
  it("la pelle ferma il moto su .cm-editor con animation: none", () => {
    // L'editor è sacro: il moto si ferma alla soglia di `.cm-editor` e
    // `.pane-editor`, e lì diventa `none`. Chi scrive non deve vedere la
    // pagina che si muove da sola sotto le proprie mani. Basta che il file
    // includa entrambe le stringhe: il banco non ricostruisce la regola, ne
    // presidia la presenza.
    expect(
      PELLE,
      "la pelle contiene `.cm-editor`: l'editor è il confine del moto",
    ).toContain(".cm-editor");
    expect(
      PELLE,
      "la pelle contiene `animation: none`: lì il moto si ferma, e la " +
        "scrittura non si anima",
    ).toContain("animation: none");
  });
});

describe("i tre keyframe fub esistono come @keyframes", () => {
  it("fub-enter-fade, fub-enter-rise, fub-enter-rise-sm sono dichiarati", () => {
    // Sono il vocabolario dell'ingresso: il fade del root, il rise della
    // superficie, il rise corto dei menu. Un nome che non è qui non è
    // ingresso — e un ingresso senza keyframe è un'animazione che non parte.
    const mancanti = KEYFRAMES_FUB.filter((k) => !PELLE.includes(`@keyframes ${k}`));
    expect(
      mancanti,
      "i tre keyframe fub dell'ingresso sono dichiarati nella pelle: un " +
        "mancante è un'overlay che non entra",
    ).toEqual([]);
  });
});

describe("niente fascio lime nei fogli di serie", () => {
  it("i fogli non dichiarano --lime-a né --duration-live", () => {
    // Il fascio di terzi è stato rimosso, e i suoi token con esso. Un
    // `--lime-a` in un foglio di serie sarebbe il ritorno di un colore che
    // non appartiene alla pelle di serie; un `--duration-live` sarebbe una
    // durata che il contratto non ha, e che nessuno spende. Entrambi sono
    // debito, e debito fuori contratto. Lo si cerca nel testo intero dei due
    // fogli, non solo nel `:root`: una regola che li usasse è già debito.
    const senzaCommentiScuro = scuro.replace(/\/\*[\s\S]*?\*\//g, "");
    const senzaCommentiChiaro = chiaro.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(
      senzaCommentiScuro,
      "il foglio scuro non dichiara `--lime-a`: il colore del fascio di " +
        "terzi non appartiene alla pelle di serie",
    ).not.toMatch(/--lime-a\b/);
    expect(
      senzaCommentiChiaro,
      "il foglio chiaro non dichiara `--lime-a`: il colore del fascio di " +
        "terzi non appartiene alla pelle di serie",
    ).not.toMatch(/--lime-a\b/);
    expect(
      senzaCommentiScuro,
      "il foglio scuro non dichiara `--duration-live`: il contratto del " +
        "moto non ha quella durata, e nessuno la spende",
    ).not.toMatch(/--duration-live\b/);
    expect(
      senzaCommentiChiaro,
      "il foglio chiaro non dichiara `--duration-live`: il contratto del " +
        "moto non ha quella durata, e nessuno la spende",
    ).not.toMatch(/--duration-live\b/);
  });
});