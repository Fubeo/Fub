import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Prec, type ChangeSpec, type Extension } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  freshBlocks,
  PREFIX_RENDER_FROM,
  renderMarkdown,
  renderMarkdownState,
  renderMarkdownStatePrefix,
  renderPatch,
  visitedBlocks,
} from "./render";
import { livePreview, liveBlocksVisited } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import type { MarkdownDocument } from "./render-types";

// La Live rende di nuovo soltanto i blocchi che una modifica tocca: gli altri
// tornano dalla resa di prima, spostati. Qui si prova che il risultato è quello
// di una resa da capo, e che il lavoro di una battuta è un blocco e i suoi
// vicini: né la resa né la Live fanno un giro su tutti i blocchi. È la guardia
// della CI per la battuta nei 4 ms, che il banco d'interazione misura fuori
// dalla CI.

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownGrammar })] });
}

/// Una resa come dati confrontabili.
function shape(document: MarkdownDocument) {
  return {
    blocks: document.blocks.map((block) => ({
      from: block.from,
      to: block.to,
      kind: block.kind,
      source: block.source,
      html: block.html,
      cells: block.cells ? [...block.cells] : null,
    })),
    anchors: [...document.anchors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    dependencies: document.dependencies,
    html: document.html,
  };
}

const CORPUS = [
  "---",
  "titolo: Prova",
  "---",
  "",
  "# Viaggio ^inizio",
  "",
  "Il **treno** parte alle *otto*[^1], vedi [la guida][guida] e [[Itinerario]] #viaggio.",
  "",
  "## Cose da fare",
  "",
  "- [ ] Prenotare",
  "- [x] Comprare[^2]",
  "  - dettaglio",
  "",
  "> [!tip] Consiglio",
  "> Il tram 28[^1].",
  "",
  "Un paragrafo con un ID a parte.",
  "",
  "^isolato",
  "",
  "```js",
  "const giorni = 3;",
  "```",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "## Cose da fare",
  "",
  "[guida]: https://example.com \"Guida\"",
  "",
  "[^1]: Una nota.",
  "",
  "[^2]: Un'altra **nota**.",
  "",
  "Fine.",
].join("\n");

/// Un generatore pseudo-casuale con un seme: la stessa serie a ogni giro.
// Le prove a caso fanno migliaia di passi: un tempo largo, perché la CI e le
// macchine cariche non le facciano scadere.
const FUZZ_TIMEOUT = 60_000;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/// Una nota con ciò che la resa incrementale deve saper lasciare alla resa
/// da capo: un ID a parte, ripiegabili, un indice, recinti, righe che fanno di
/// un paragrafo un titolo o una tabella.
const TRICKY = [
  "Primo paragrafo.",
  "^solo",
  "",
  "<details>",
  "<summary>Apri</summary>",
  "",
  "Dentro, con un richiamo[^a].",
  "",
  "</details>",
  "",
  "```toc",
  "```",
  "",
  "# Titolo",
  "",
  "Un paragrafo che diventa titolo",
  "",
  "    codice rientrato",
  "",
  "",
  "testo dopo il codice",
  "",
  "~~~",
  "un recinto",
  "~~~",
  "",
  "- uno",
  "- due[^a]",
  "",
  "Fine[^b].",
  "",
  "[^a]: Prima nota.",
  "[^b]: Seconda nota.",
].join("\n");

const INSERTS = [
  "a", " ", "\n", "\n\n", "**", "[^1]", "[^3]", "# ", "## ", "```", "> ", "- ", "|", "^id", "$$", "---", "[guida]", "[x]: /y",
  "\n^id\n", "===", "| --- |", "<details>", "</details>", "    ", "~~~", "[^a]", "\n---\n", "```toc\n```",
];

/// Una modifica a caso, sola o con altre in punti diversi del testo.
function randomChanges(next: () => number, length: number): ChangeSpec[] {
  const count = next() < 0.85 ? 1 : 2 + Math.floor(next() * 2);
  const points = Array.from({ length: count }, () => Math.floor(next() * (length + 1))).sort((a, b) => a - b);
  const changes: ChangeSpec[] = [];
  let free = 0;
  for (const at of points) {
    if (at < free) continue;
    if (next() < 0.7) {
      changes.push({ from: at, insert: INSERTS[Math.floor(next() * INSERTS.length)]! });
      free = at + 1;
    } else {
      const to = Math.min(length, at + 1 + Math.floor(next() * 6));
      changes.push({ from: at, to });
      free = to + 1;
    }
  }
  return changes;
}

/// La nota delle battute: `count` sezioni con titolo, paragrafo con un
/// richiamo, riquadro e tabella.
function sectionsNote(count: number): string {
  const sections = Array.from({ length: count }, (_, i) =>
    `## Sezione ${i}\n\nTesto **forte** ${i}[^1].\n\n> [!note] Nota ${i}\n> corpo\n\n| a | b |\n| --- | --- |\n| ${i} | x |\n`);
  return `${sections.join("\n")}\n[^1]: La nota.\n`;
}

describe("la resa incrementale della Live", () => {
  it("senza resa di prima è la resa da capo", () => {
    expect(shape(renderMarkdownState(stateOf(CORPUS)))).toEqual(shape(renderMarkdown(CORPUS)));
  });

  it("dopo ogni modifica, qualunque, è uguale alla resa da capo", () => {
    let steps = 0;
    let patched = 0;
    for (const [name, corpus] of [["corpus", CORPUS], ["difficile", TRICKY], ["frontmatter", `---\na: 1\n---\n\n${TRICKY}`]] as const) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const next = random(seed);
        let state = stateOf(corpus);
        let document = renderMarkdownState(state);
        for (let step = 0; step < 80; step++) {
          const transaction = state.update({ changes: randomChanges(next, state.doc.length) });
          state = transaction.state;
          document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
          // La resa da capo dello stesso albero: l'albero incrementale di
          // CodeMirror può dividere un paragrafo diversamente da una lettura
          // nuova, e qui si prova la resa, non il parser.
          expect(shape(document), `${name}, seme ${seed}, passo ${step}`).toEqual(shape(renderMarkdownState(state)));
          steps++;
          if (renderPatch(document)) patched++;
        }
      }
    }
    // La prova vale per la resa che lavora vicino alla modifica, non soltanto
    // per quella da capo che la sostituisce nei casi difficili.
    expect(patched / steps).toBeGreaterThan(0.3);
  }, FUZZ_TIMEOUT);

  it("una battuta in un paragrafo rende quel paragrafo e basta", () => {
    const text = sectionsNote(200);
    let state = stateOf(text);
    let document = renderMarkdownState(state);
    const at = text.indexOf("Testo **forte** 100") + "Testo".length;
    for (const letter of "abc") {
      const transaction = state.update({ changes: { from: at, insert: letter } });
      state = transaction.state;
      document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
      expect(freshBlocks(document)).toBe(1);
    }
    expect(document.blocks.length).toBeGreaterThan(800);
  });

  it("una battuta guarda soltanto i blocchi vicini, non tutti", () => {
    const text = sectionsNote(200);
    let state = stateOf(text);
    let document = renderMarkdownState(state);
    expect(visitedBlocks(document)).toBeGreaterThan(800);
    let at = text.indexOf("Testo **forte** 100") + "Testo".length;
    // Battute, un a capo, una cancellazione: una manciata di blocchi ciascuna.
    const keys: ({ insert: string } | { delete: number })[] = [{ insert: "a" }, { insert: "b" }, { insert: " " }, { insert: "\n" }, { insert: "c" }, { delete: 1 }];
    for (const change of keys) {
      const changes = "insert" in change ? { from: at, insert: change.insert } : { from: at - 1, to: at };
      const transaction = state.update({ changes });
      state = transaction.state;
      at = "insert" in change ? at + change.insert.length : at - 1;
      document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
      expect(visitedBlocks(document), JSON.stringify(change)).toBeLessThanOrEqual(6);
    }
    expect(shape(document)).toEqual(shape(renderMarkdownState(state)));
  });

  it("in un recinto lungo, in una tabella o in un riquadro la battuta resta vicina", () => {
    const fence = `\`\`\`js\n${Array.from({ length: 2_000 }, (_, i) => `const riga${i} = ${i};`).join("\n")}\n\`\`\`\n`;
    const text = `${sectionsNote(60)}\n${fence}\n${sectionsNote(60)}`;
    for (const needle of ["const riga1000 =", "| 30 | x |", "> corpo", "Nota 40"]) {
      expect(text.indexOf(needle), needle).toBeGreaterThan(0);
      let state = stateOf(text);
      let document = renderMarkdownState(state);
      const at = text.indexOf(needle) + 2;
      const transaction = state.update({ changes: { from: at, insert: "x" } });
      state = transaction.state;
      document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
      expect(visitedBlocks(document), needle).toBeLessThanOrEqual(6);
      expect(shape(document), needle).toEqual(shape(renderMarkdownState(state)));
    }
  });

  it("mille righe incollate si rendono, e il resto torna com'era", () => {
    const text = sectionsNote(100);
    let state = stateOf(text);
    let document = renderMarkdownState(state);
    const pasted = Array.from({ length: 1_000 }, (_, i) => (i % 10 === 0 ? `### Incollato ${i}` : `riga incollata ${i}`)).join("\n");
    const at = text.indexOf("## Sezione 50");
    const transaction = state.update({ changes: { from: at, insert: `${pasted}\n\n` } });
    state = transaction.state;
    document = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
    expect(shape(document)).toEqual(shape(renderMarkdownState(state)));
  });

  it("una definizione che cambia rifà tutti i blocchi, che potrebbero leggerla", () => {
    const text = "Vedi [la guida][g].\n\nAltro.\n\n[g]: /uno\n";
    let state = stateOf(text);
    const document = renderMarkdownState(state);
    const at = text.indexOf("/uno") + 1;
    const transaction = state.update({ changes: { from: at, to: at + 3, insert: "due" } });
    state = transaction.state;
    const next = renderMarkdownState(state, undefined, { document, changes: transaction.changes });
    expect(freshBlocks(next)).toBe(next.blocks.length);
    expect(next.blocks[0]!.html).toContain('href="/due"');
  });
});

/// Uno stato con la Live, l'albero in fondo e la resa completa.
function liveState(doc: string, selection: EditorSelection, policy: RevealPolicy = "mai"): EditorState {
  const extensions: Extension = [
    markdown({ base: markdownGrammar }),
    Prec.highest(liveReveal.of(policy)),
    livePreview({ openWikilink() {}, searchTag() {} }),
  ];
  const state = EditorState.create({ doc, selection, extensions });
  ensureSyntaxTree(state, doc.length, 10_000);
  // Una transazione porta l'albero nello stato, e la resa a metà si completa.
  return state.update({}).state;
}

/// Le decorazioni che i campi dello stato danno alla vista, come testo: un
/// widget per il suo tipo e la sorgente del suo blocco.
function decorationsOf(state: EditorState): string[] {
  const found: string[] = [];
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue;
    (source as DecorationSet).between(0, state.doc.length, (from, to, value) => {
      const widget = value.spec.widget as { constructor: { name: string }; block?: { source: string } } | undefined;
      found.push(`${from}-${to} ${String(value.spec.class ?? "")} ${widget ? `${widget.constructor.name}:${widget.block?.source ?? ""}` : ""}`);
    });
  }
  return found;
}

describe("i blocchi resi della Live a ogni battuta", () => {
  for (const policy of ["mai", "elemento", "riga"] as const) {
    it(`dopo modifiche e cursori a caso sono quelli di una Live appena aperta (${policy})`, () => {
      for (const [name, corpus] of [["corpus", CORPUS], ["difficile", TRICKY], ["sezioni", sectionsNote(30)]] as const) {
        for (const seed of [1, 2, 3, 4, 5, 6]) {
          const next = random(seed);
          let state = liveState(corpus, EditorSelection.single(0), policy);
          for (let step = 0; step < 40; step++) {
            const length = state.doc.length;
            const head = Math.floor(next() * (length + 1));
            // Due volte su tre una modifica col cursore dopo, una volta il
            // cursore che salta altrove.
            state = next() < 0.67
              ? state.update({ changes: randomChanges(next, length), userEvent: "input.type" }).state
              : state.update({ selection: { anchor: head, head: Math.min(length, head + Math.floor(next() * 3)) } }).state;
            // L'albero incrementale di CodeMirror può dividere un paragrafo
            // diversamente da una lettura nuova: lì una Live appena aperta non
            // è il termine di paragone.
            const blocksOf = (document: MarkdownDocument) => document.blocks.map((block) => `${block.from}-${block.to}`).join();
            if (blocksOf(renderMarkdownState(state)) !== blocksOf(renderMarkdown(state.doc.toString()))) continue;
            const fresh = liveState(state.doc.toString(), state.selection, policy);
            expect(decorationsOf(state), `${policy}, ${name}, seme ${seed}, passo ${step}`).toEqual(decorationsOf(fresh));
          }
        }
      }
    }, FUZZ_TIMEOUT);
  }

  it("una battuta e un cursore che si muove guardano soltanto i blocchi vicini", () => {
    const text = sectionsNote(200);
    let at = text.indexOf("Testo **forte** 100") + "Testo".length;
    let state = liveState(text, EditorSelection.single(at));
    expect(liveBlocksVisited(state)).toBeGreaterThan(800);
    for (const letter of "abc") {
      state = state.update({ changes: { from: at, insert: letter }, selection: { anchor: at + 1 }, userEvent: "input.type" }).state;
      at++;
      expect(liveBlocksVisited(state)).toBeLessThanOrEqual(6);
    }
    // Il cursore entra in una tabella resa e ne esce: rifà quella e basta.
    const table = state.doc.toString().indexOf("| 150 | x |") + 2;
    state = state.update({ selection: { anchor: table } }).state;
    expect(liveBlocksVisited(state)).toBeLessThanOrEqual(4);
    state = state.update({ selection: { anchor: at } }).state;
    expect(liveBlocksVisited(state)).toBeLessThanOrEqual(4);
    expect(decorationsOf(state)).toEqual(decorationsOf(liveState(state.doc.toString(), state.selection)));
  });
});

// Un documento grande appena aperto si rende fin dove il parser arriva in
// fretta: la prima schermata non aspetta la lettura di tutto il file.
describe("resa dell'inizio di un documento grande", () => {
  /// Una nota ben oltre `PREFIX_RENDER_FROM`, con una tabella in cima e una
  /// definizione di link in fondo.
  function largeNote(): string {
    const paragraphs = Array.from({ length: 2_000 }, (_, i) => `Paragrafo ${i + 1}: una riga di prosa senza segni, lunga quanto basta.`);
    return `Vedi [la guida][g].\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n${paragraphs.join("\n\n")}\n\n[g]: /guida\n`;
  }

  it("un documento piccolo si rende tutto, come renderMarkdownState", () => {
    const state = stateOf(CORPUS);
    const { document, complete } = renderMarkdownStatePrefix(state);
    expect(complete).toBe(true);
    expect(shape(document)).toEqual(shape(renderMarkdownState(stateOf(CORPUS))));
  });

  it("un documento grande si ferma a un blocco chiuso, senza leggere tutto il file", () => {
    const text = largeNote();
    expect(text.length).toBeGreaterThan(PREFIX_RENDER_FROM * 4);
    const state = stateOf(text);
    const { document, complete } = renderMarkdownStatePrefix(state);
    expect(complete).toBe(false);
    // L'albero dello stato non è stato portato in fondo.
    expect(syntaxTreeAvailable(state, text.length)).toBe(false);
    expect(document.source.length).toBeGreaterThanOrEqual(PREFIX_RENDER_FROM / 2);
    expect(document.source.length).toBeLessThan(PREFIX_RENDER_FROM * 2);
    expect(text.startsWith(document.source)).toBe(true);
    // I blocchi resi sono quelli della resa completa, uno per uno; la
    // definizione in fondo non c'è ancora.
    const full = renderMarkdownState(stateOf(text));
    const last = document.blocks[document.blocks.length - 1]!;
    expect(last.to).toBeLessThanOrEqual(document.source.length);
    expect(document.blocks.map((block) => [block.from, block.to, block.kind]))
      .toEqual(full.blocks.slice(0, document.blocks.length).map((block) => [block.from, block.to, block.kind]));
    expect(document.blocks[1]!.kind).toBe(full.blocks[1]!.kind);
    expect(document.blocks[0]!.html).not.toContain('href="/guida"');
    expect(full.blocks[0]!.html).toContain('href="/guida"');
  });

  it("con l'albero in fondo la resa è completa e uguale a quella da capo", () => {
    const text = largeNote();
    const state = stateOf(text);
    const partial = renderMarkdownStatePrefix(state);
    expect(ensureSyntaxTree(state, text.length, 10_000)).not.toBeNull();
    const { document, complete } = renderMarkdownStatePrefix(state, undefined, { document: partial.document, changes: state.changes() });
    expect(complete).toBe(true);
    expect(shape(document)).toEqual(shape(renderMarkdownState(stateOf(text))));
  });
});
