// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { ensureSyntaxTree, forceParsing, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { editorTheme, highlightVisible, syntaxStyle } from "./theme";

// L'evidenziatore della sintassi lavora sui tratti visibili in una passata:
// le classi che dà devono essere quelle che dava `syntaxHighlighting` di
// CodeMirror, tratto per tratto, nelle due luci.

const FENCE = "```";
const codeLanguages = [
  LanguageDescription.of({ name: "javascript", alias: ["js"], support: javascript() }),
  LanguageDescription.of({ name: "css", support: css() }),
];

/// Un testo di prova con un po' di tutto quello che la sintassi colora.
function sample(sections: number): string {
  const out: string[] = [];
  for (let i = 0; i < sections; i++) {
    out.push(
      `## Titolo ${i}`,
      "",
      `Testo **forte** e *corsivo*, ~~barrato~~, \`codice\`, [legame](https://esempio.it/${i}) e <https://fub.it>.`,
      "",
      `- [ ] compito ${i}`,
      `> citazione ${i}`,
      "",
      `${FENCE}js`,
      `const v${i} = { nome: "x", n: ${i} }; // nota`,
      `function f${i}(a) { return a * 2 + /re/g.test("s"); }`,
      FENCE,
      "",
      `${FENCE}css`,
      `.c${i} { color: #fff; margin: 0 ${i}px; }`,
      FENCE,
      "",
      "| a | b |",
      "| --- | --- |",
      `| ${i} | ${i + 1} |`,
      "",
    );
  }
  return out.join("\n");
}

function stateOf(doc: string, extensions: Extension = []): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown({ codeLanguages }), extensions] });
  ensureSyntaxTree(state, doc.length, 5_000);
  return state;
}

/// Le classi come le dava CodeMirror: una chiamata a `highlightTree` per tratto.
function perRange(state: EditorState, ranges: readonly { from: number; to: number }[]): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000)!;
  const out: string[] = [];
  for (const { from, to } of ranges) highlightTree(tree, syntaxStyle, (a, b, classes) => out.push(`${a}-${b} ${classes}`), from, to);
  return out;
}

function joined(state: EditorState, ranges: readonly { from: number; to: number }[], joinGap?: number): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000)!;
  const out: string[] = [];
  highlightVisible(tree, syntaxStyle, ranges, (a, b, classes) => out.push(`${a}-${b} ${classes}`), joinGap);
  return out;
}

/// Tratti a caso, ordinati e disgiunti, come quelli fra i blocchi resi.
function randomRanges(length: number, seed: number): { from: number; to: number }[] {
  let x = seed;
  const next = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out: { from: number; to: number }[] = [];
  let at = Math.floor(next() * 50);
  while (at < length) {
    const to = Math.min(length, at + 1 + Math.floor(next() * 400));
    out.push({ from: at, to });
    at = to + 1 + Math.floor(next() * 300);
  }
  return out;
}

describe("highlightVisible", () => {
  it("dà le classi di una chiamata per tratto, tratti uniti o no", () => {
    const state = stateOf(sample(12));
    for (let seed = 1; seed <= 40; seed++) {
      const ranges = randomRanges(state.doc.length, seed);
      const expected = perRange(state, ranges);
      expect(expected.length).toBeGreaterThan(0);
      expect(joined(state, ranges)).toEqual(expected);
      expect(joined(state, ranges, 0)).toEqual(expected);
      expect(joined(state, ranges, 120)).toEqual(expected);
    }
  });

  it("un tratto che comincia o finisce dentro un segno lo taglia lì", () => {
    const doc = "Testo **forte** e `codice` qui.";
    const state = stateOf(doc);
    const ranges = [{ from: 0, to: doc.indexOf("forte") + 2 }, { from: doc.indexOf("odice"), to: doc.length }];
    expect(joined(state, ranges)).toEqual(perRange(state, ranges));
  });

  it("niente tratti, niente classi", () => {
    const state = stateOf(sample(1));
    expect(joined(state, [])).toEqual([]);
  });
});

class Box extends WidgetType {
  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.textContent = "blocco";
    return box;
  }
}

/// Blocchi resi finti sulle tabelle e sui recinti CSS: spezzano il tratto
/// della vista in molti pezzi, come nella Live.
function fakeBlocks(doc: string): Extension {
  const builder = new RangeSetBuilder<Decoration>();
  const box = Decoration.replace({ widget: new Box(), block: true });
  const lines = doc.split("\n");
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === `${FENCE}css` || lines[i] === "| a | b |") {
      const from = at;
      let to = at + lines[i]!.length;
      for (let j = 1; j <= 2; j++) to += 1 + lines[i + j]!.length;
      builder.add(from, to, box);
    }
    at += lines[i]!.length + 1;
  }
  const set = builder.finish();
  return StateField.define<DecorationSet>({
    create: () => set,
    update: (value, tr) => value.map(tr.changes),
    provide: (field) => EditorView.decorations.from(field),
  });
}

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });

function mount(doc: string, extensions: Extension): EditorView {
  const view = new EditorView({ parent: document.body, state: stateOf(doc, extensions) });
  views.push(view);
  // L'albero dello stato nasce da un esame a tempo limitato: sotto carico è
  // corto, e corto in modo diverso da una vista all'altra. Lo si porta in
  // fondo, come farebbe il lavoro inattivo di CodeMirror.
  expect(forceParsing(view, doc.length, 10_000)).toBe(true);
  return view;
}

/// Il testo disegnato con le classi di ogni pezzo: le stesse classi sugli
/// stessi caratteri danno gli stessi colori.
function painted(view: EditorView): string {
  return [...view.contentDOM.querySelectorAll("span")]
    .map((span) => `${span.className}|${span.textContent}`)
    .join("\n");
}

describe("le classi della sintassi nell'editor", () => {
  for (const light of ["dark", "light"] as const) {
    it(`sono quelle di syntaxHighlighting di CodeMirror (${light})`, () => {
      const doc = sample(6);
      for (const [split, blocks] of [[false, []], [true, fakeBlocks(doc)]] as const) {
        const ours = mount(doc, [blocks, editorTheme(light)]);
        const theirs = mount(doc, [blocks, syntaxHighlighting(syntaxStyle)]);
        if (split) expect(ours.visibleRanges.length).toBeGreaterThan(1);
        const text = painted(ours);
        expect(text.split("\n").filter((line) => !line.startsWith("|")).length).toBeGreaterThan(50);
        expect(text).toEqual(painted(theirs));
        // Una battuta, e di nuovo uguali.
        const at = doc.indexOf("forte");
        // Lo stesso per il riesame dopo la battuta.
        for (const view of [ours, theirs]) {
          view.dispatch({ changes: { from: at, insert: "x" } });
          expect(forceParsing(view, view.state.doc.length, 10_000)).toBe(true);
        }
        expect(painted(ours)).toEqual(painted(theirs));
      }
    });
  }
});
