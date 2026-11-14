// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChangeSpec, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { type DecorationSet, EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdownGrammar } from "./grammar";
import { liveGapLines, liveInlineVisited, livePreview, pageIconsChanged } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";

// Le decorazioni in riga della Live (segni nascosti, stili, pastiglie) si
// rifanno soltanto nei nodi di primo livello che una battuta, la selezione o i
// blocchi resi cambiano: qui si prova che restano quelle rifatte da capo
// sullo stesso stato, e che una battuta legge poche righe.

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function extensions(policy: RevealPolicy) {
  return [markdown({ base: markdownGrammar }), Prec.highest(liveReveal.of(policy)), livePreview({ openWikilink() {}, searchTag() {} })];
}

/// Una vista sulla Live con l'albero in fondo.
function liveView(doc: string, policy: RevealPolicy, anchor = 0): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc, selection: EditorSelection.single(anchor), extensions: extensions(policy) }) });
  views.push(view);
  finish(view);
  return view;
}

/// L'albero in fondo, portato nello stato da una transazione.
function finish(view: EditorView): void {
  if (ensureSyntaxTree(view.state, view.state.doc.length, 10_000)) view.dispatch({});
}

/// Le decorazioni dei plugin della vista (le funzioni del facet), come testo.
function inlineOf(view: EditorView): string[] {
  const found: string[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    if (typeof source !== "function") continue;
    (source(view) as DecorationSet).between(0, view.state.doc.length, (from, to, value) => {
      const widget = value.spec.widget as object | undefined;
      const fields = widget
        ? Object.entries(widget).filter(([, field]) => field === null || typeof field !== "object" && typeof field !== "function")
        : [];
      found.push(`${from}-${to} ${String(value.spec.class ?? "")} ${JSON.stringify(value.spec.attributes ?? null)} ${String(value.spec.tagName ?? "")} ${widget ? widget.constructor.name + JSON.stringify(fields) : ""}`);
    });
  }
  return found;
}

/// Gli intervalli atomici dei plugin della vista.
function atomicOf(view: EditorView): string[] {
  const found: string[] = [];
  for (const source of view.state.facet(EditorView.atomicRanges)) {
    source(view).between(0, view.state.doc.length, (from, to) => {
      found.push(`${from}-${to}`);
    });
  }
  return found;
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const SECTION = (i: number) => [
  `## Sezione ${i}`,
  "",
  `Testo **forte ${i}** e *corsivo*, ~~via~~, ==evidenza==, \`codice\`, [[Nota ${i}|alias]] e #tag${i}.`,
  `Un [link](https://example.com/${i}) e una formula $x^${i}$ e una nota[^n${i}].`,
  "",
  `> [!note] Riquadro ${i}`,
  "> dentro **il** riquadro",
  "",
  `- [ ] compito ${i}`,
  `- [x] fatto ${i}`,
  "",
  "```js",
  `const x = ${i};`,
  "```",
  "",
  `[^n${i}]: La nota ${i}.`,
  "",
].join("\n");

const PIECES = [
  "a", " ", "   ", "    ", "\n", "\n\n", "**", "*", "~~", "==", "`", "[[", "]]", "#", "# ", "> ", "> > ", "- ", "1. ", "- [ ] ",
  "```\n", "$", "[^n1]", "<u>", "</u>", "---\n", "|", "===\n", "![foto](foto.png)", "\n- a\n  b\n", "<details>\n", "%%",
];

describe("le decorazioni in riga della Live a ogni battuta", () => {
  for (const policy of ["mai", "elemento", "riga"] as const) {
    it(`dopo modifiche e cursori a caso sono quelle rifatte da capo (${policy})`, () => {
      const corpus = Array.from({ length: 4 }, (_, i) => SECTION(i)).join("\n");
      let patched = 0;
      let steps = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const next = random(seed * 7 + policy.length);
        const view = liveView(corpus, policy);
        for (let step = 0; step < 50; step++) {
          const length = view.state.doc.length;
          const head = Math.floor(next() * (length + 1));
          if (next() < 0.65) {
            const remove = next() < 0.3 ? Math.min(length - head, Math.floor(next() * 6)) : 0;
            const insert = PIECES[Math.floor(next() * PIECES.length)]!;
            const changes: ChangeSpec[] = [{ from: head, to: head + remove, insert }];
            // A volte un secondo punto, più avanti, nella stessa transazione.
            const other = head + remove + 1 + Math.floor(next() * 200);
            if (next() < 0.15 && other <= length) changes.push({ from: other, insert: PIECES[Math.floor(next() * PIECES.length)]! });
            view.dispatch({ changes, selection: { anchor: head + insert.length }, userEvent: "input.type" });
          } else {
            view.dispatch({ selection: { anchor: head, head: Math.min(length, head + Math.floor(next() * 4)) } });
          }
          // Su una macchina carica il parser può non arrivare in fondo nel
          // suo tempo: allora le decorazioni si rifanno tutte quando arriva,
          // come prima, e il passo non si confronta.
          const tree = syntaxTree(view.state);
          if (tree.length === view.state.doc.length) {
            const lines = liveInlineVisited(view)!;
            const patchedInline = inlineOf(view);
            const patchedAtomic = atomicOf(view);
            const visible = JSON.stringify(view.visibleRanges);
            // Le icone delle pagine che cambiano rifanno tutto, nella stessa
            // vista, sullo stesso albero e sullo stesso tratto visibile: il
            // termine di paragone.
            view.dispatch({ effects: pageIconsChanged.of(null) });
            const label = `${policy}, seme ${seed}, passo ${step}`;
            // Su una macchina carica il parser dei recinti può finire proprio
            // in questo aggiornamento e dare un albero nuovo: il paragone non
            // sarebbe sullo stesso albero, e il passo non si confronta.
            if (syntaxTree(view.state) === tree) {
              expect(JSON.stringify(view.visibleRanges), label).toBe(visible);
              expect(patchedInline, label).toEqual(inlineOf(view));
              expect(patchedAtomic, label).toEqual(atomicOf(view));
              steps++;
              if (lines < liveInlineVisited(view)!) patched++;
            }
          }
          finish(view);
        }
      }
      // La prova vale per l'aggiornamento che rifà soltanto un tratto, non
      // soltanto per quello che rifà tutto.
      expect(steps).toBeGreaterThan(100);
      expect(patched / steps).toBeGreaterThan(0.5);
    }, 120_000);
  }

  it("una battuta e un cursore che si muove leggono soltanto le righe vicine", () => {
    const text = Array.from({ length: 200 }, (_, i) => SECTION(i)).join("\n");
    let at = text.indexOf("Testo **forte 1**") + "Testo".length;
    const view = liveView(text, "mai", at);
    const whole = liveInlineVisited(view)!;
    expect(whole).toBeGreaterThan(30);
    for (const letter of "abc") {
      view.dispatch({ changes: { from: at, insert: letter }, selection: { anchor: at + 1 }, userEvent: "input.type" });
      at++;
      expect(liveInlineVisited(view), letter).toBeLessThanOrEqual(8);
    }
    view.dispatch({ selection: { anchor: text.indexOf("compito 1") } });
    expect(liveInlineVisited(view)).toBeLessThanOrEqual(12);
  });
});

// Le righe vuote dopo un blocco reso si nascondono: il campo le sa in tutta la
// nota, la vista ne prende soltanto quelle del suo tratto, e le disegna.
describe("le righe nascoste dopo i blocchi resi", () => {
  it("sono quelle del campo nel tratto della vista, anche dopo una battuta", () => {
    const section = (i: number) => `## Sezione ${i}\n\n| a | b |\n| --- | --- |\n| ${i} | ${i + 1} |\n\n\nTesto ${i}.\n`;
    const text = Array.from({ length: 300 }, (_, i) => section(i)).join("\n");
    const view = liveView(text, "mai", text.indexOf("Testo 150"));
    const check = () => {
      const all = liveGapLines(view.state)!;
      expect(all.size).toBeGreaterThan(300);
      const { from, to } = view.viewport;
      const expected: number[] = [];
      all.between(from, to, (start) => {
        expected.push(start);
      });
      const drawn: number[] = [];
      for (const source of view.state.facet(EditorView.decorations)) {
        if (typeof source !== "function") continue;
        (source(view) as DecorationSet).between(0, view.state.doc.length, (start, _end, value) => {
          if (value.spec.class === "cm-markdown-gap") drawn.push(start);
        });
      }
      expect(expected.length).toBeGreaterThan(0);
      expect(drawn).toEqual(expected);
      const lines = [...view.contentDOM.querySelectorAll(".cm-line.cm-markdown-gap")].map((line) => view.posAtDOM(line));
      expect(lines).toEqual(expected.filter((at) => at >= view.visibleRanges[0]!.from && at <= view.visibleRanges[view.visibleRanges.length - 1]!.to));
    };
    check();
    view.dispatch({ changes: { from: view.state.selection.main.head, insert: "a" }, selection: { anchor: view.state.selection.main.head + 1 } });
    finish(view);
    check();
  });
});
