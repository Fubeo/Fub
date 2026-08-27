import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { computeDecorations, type LiveDeco, type LiveDecoKind } from "./livepreview";
import { parseWikilinkInner } from "../../../../rules/syntax";
import corpus from "../../../../__fixtures__/corpus-syntax.json";

// **Il corpus su cui le due passate devono concordare** (§4.4, decisione 0115).
//
// Sullo stesso testo passano due riconoscitori che non si vedono: il modello,
// che legge il file, e questa passata, che legge il buffer. Le due grammatiche
// restano due perché stanno su due oggetti diversi (0018) — ma finché restavano
// due *senza un presidio*, la loro divergenza non era rossa da nessuna parte, e
// il difetto che ne usciva non è un crash: è che ciò che si vede scrivendo e ciò
// che viene reso e indicizzato dicono due cose diverse sullo stesso testo.
//
// La fixture la emette `crates/fub-format-markdown/tests/il_corpus.rs` dalle
// **stesse** sorgenti che quel file già confronta col modello: un costrutto
// nuovo entra là perché quelle proprietà lo pretendono, e arriva qui da solo.
//
// Le divergenze si **dichiarano**, non si scoprono: ogni caso che non concorda
// sta in `DIVERGENZE` con la sua ragione. Non dicono «va bene così»: dicono
// «succede questo, ed è scritto». Il giorno in cui una si ripara, la riga
// diventa rossa e va tolta — che è il modo in cui una divergenza smette di
// essere silenziosa. La forma è quella di `divergenze_dichiarate` di là.

interface CorpusCase {
  name: string;
  source: string;
  tag: { name: string; from: number; to: number }[];
  wikilink: { page: string; embed: boolean; from: number; to: number }[];
  task: { symbol: string; from: number; to: number }[];
}

const cases = corpus as CorpusCase[];

/// Le divergenze note fra la passata del modello e quella della shell.
///
/// La chiave è `"<nome del caso>/<famiglia>"`; il valore è la ragione, che è
/// la parte che conta — una riga senza ragione è un caso spento, non una
/// divergenza dichiarata.
const DIVERGENCES: Record<string, string> = {
  // **CodeMirror normalizza i terminatori di riga, il modello no** — ma solo il
  // CRLF costa un carattere. `EditorState.create` spezza il documento su
  // `\r\n`, `\r` e `\n` e lo ricompone col proprio separatore: un `\r` nudo
  // diventa un `\n`, cioè un carattere per un carattere e nessuno spostamento
  // (e infatti i casi «cr solo» concordano, riga per riga); un `\r\n` diventa
  // un `\n`, e da lì in poi tutto scala di uno.
  //
  // Non è una divergenza di grammatica: le due passate riconoscono lo **stesso**
  // costrutto, e il disaccordo è su cosa sia il testo — sta a monte di questo
  // modulo, ed è del §15.5. La misura di quale delle due forme di `\r` costi è
  // arrivata da qui: dichiarati tutti e tre i casi «cr», due sono diventati
  // rossi perché **non** divergevano.
  // **La shell decora dentro il frontmatter, il modello no.** Su
  // `relazione: "[[Nota]]"` la vivi preview disegna un wikilink cliccabile,
  // mentre per il modello quello è il valore di una proprietà e non un legame del
  // corpo. Trovata da qui, smettendo di saltare i casi che il modello legge
  // vuoti.
  //
  // Non si ripara in questo giro, e la ragione è la voce stessa: per escludere
  // il frontmatter la shell dovrebbe riconoscerlo, cioè scrivere una **seconda**
  // grammatica di `fub:frontmatter` — il moltiplicatore che la §4.4 toglie. Il
  // confine si vede a occhio in `sintassi.generated.ts`: `fub:frontmatter` ha
  // `trigger: null`, cioè è una grammatica del provider, e finché resta tale chi
  // decora un buffer non ha modo di sapere dove finisce. Il giorno in cui la
  // dichiarasse, questa riga diventa rossa.
  "frontmatter con ogni specie di proprietà/wikilink":
    "la shell non sa dove finisce il frontmatter: `fub:frontmatter` non dichiara una forma",
  "crlf/wikilink": "un `\r\n` diventa `\n` nel buffer: da lì gli offset scalano di uno",
  "terminatori misti/wikilink": "un `\r\n` diventa `\n` nel buffer: gli offset scalano",
};

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
}

/// La passata della shell con **tutte** le righe attive: la sorgente resta
/// visibile, e ogni wikilink produce esattamente una decorazione sul suo
/// interno. È la forma in cui i confini si confrontano senza doverli dedurre
/// dagli `hide`.
function decorateAllActive(doc: string): LiveDeco[] {
  const state = stateOf(doc);
  const active = new Set<number>();
  for (let n = 1; n <= state.doc.lines; n++) active.add(n);
  return computeDecorations(state, active);
}

function ofKind(ds: LiveDeco[], kind: LiveDecoKind): LiveDeco[] {
  return ds.filter((d) => d.kind === kind);
}

/// Il confronto, con la divergenza dichiarata al posto dell'asserzione.
function compare(testCase: CorpusCase, family: string, expected: unknown, actual: unknown): void {
  const key = `${testCase.name}/${family}`;
  const reason = DIVERGENCES[key];
  if (reason) {
    // Una divergenza dichiarata che **non** si presenta più è rossa: è così che
    // la lista non diventa un ricordo.
    expect(actual, `«${key}» non diverge più: remove la row da DIVERGENZE`).not.toEqual(expected);
    return;
  }
  expect(actual, `«${key}»`).toEqual(expected);
}

describe("il corpus: le due passate dicono la stessa cosa", () => {
  it("la fixture porta abbastanza casi da poter divergere", () => {
    expect(cases.length).toBeGreaterThan(30);
    const count = (f: (c: CorpusCase) => unknown[]) =>
      cases.reduce((n, c) => n + f(c).length, 0);
    expect(count((c) => c.tag)).toBeGreaterThan(2);
    expect(count((c) => c.wikilink)).toBeGreaterThan(2);
    expect(count((c) => c.task)).toBeGreaterThan(2);
  });

  // **Nessun caso si salta, nemmeno quello che il modello vede vuoto.** È la
  // metà che conta di più: un caso che il modello legge senza costrutti è la
  // sola forma in cui si vede una passata che ne riconosce **di troppo** — un
  // `[[Nota]]` dentro un recinto di codice, un `#tag` dentro un backtick.
  // Misurato: saltando i casi vuoti, togliere alla shell l'esclusione delle
  // righe di codice lasciava questo file **verde** su tutte le sorgenti.
  for (const testCase of cases) {
    it(`«${testCase.name}»`, () => {
      const active = decorateAllActive(testCase.source);

      // --- i tag: confini esatti, e sono quelli della regola del contratto ---
      compare(
        testCase,
        "tag",
        testCase.tag.map((t) => [t.name, t.from, t.to]),
        ofKind(active, "tag").map((d) => [d.data, d.from, d.to]),
      );

      // --- i wikilink: la decorazione copre l'INTERNO, il modello il match ---
      compare(
        testCase,
        "wikilink",
        // Lo span del modello comprende il `!` dell'embed; la decorazione
        // copre l'interno, quindi il salto è di tre da quel lato e di due
        // dall'altro. È una differenza dichiarata, non un `+2` da indovinare.
        testCase.wikilink.map((w) => [w.page, w.from + (w.embed ? 3 : 2), w.to - 2]),
        ofKind(active, "wikilink").map((d) => [
          parseWikilinkInner(d.data ?? "").page,
          d.from,
          d.to,
        ]),
      );

      // --- le task: il modello dà il SIMBOLO, la shell decora `[x]` intero ---
      // La casella si vede solo fuori dalla riga attiva: è la modalità in cui
      // la live preview mette un widget al posto della sorgente.
      const inactive = computeDecorations(stateOf(testCase.source), new Set());
      compare(
        testCase,
        "task",
        testCase.task.map((t) => [t.from - 1, t.to + 1]),
        ofKind(inactive, "checkbox").map((d) => [d.from, d.to]),
      );
    });
  }
});
