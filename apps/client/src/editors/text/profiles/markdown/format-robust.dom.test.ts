// @vitest-environment happy-dom
// La Live regge a chi cambia idea: gesti della barra, lettere, spazi,
// Backspace e Canc in qualunque ordine non lasciano mai un segno a vista.
// Le sequenze vengono da un generatore con seme fisso, e chi fallisce si
// ripete col suo seme.
import { describe, expect, it } from "vitest";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { deleteCharBackward, deleteCharForward } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { createTextEngine } from "../../engine";
import { livePreview } from "./livepreview";
import { liveReveal } from "../../live-reveal";
import { inlineHtmlPartner } from "./render-inline";
import { emptyPairsOf } from "./empty-pair";
import { spans } from "../../../../rules/syntax";
import {
  toggleBold, toggleHighlight, toggleItalic, toggleStrikethrough, toggleSubscript, toggleSuperscript, toggleUnderline,
} from "./commands";

const GESTURES = {
  B: toggleBold, I: toggleItalic, X: toggleStrikethrough, U: toggleUnderline,
  S: toggleSuperscript, P: toggleSubscript, H: toggleHighlight,
} as const;

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = createTextEngine(parent, {
    onChange() {},
    onSelectionChange() {},
    extensions: () => [
      markdown({ base: markdownGrammar }),
      Prec.highest(liveReveal.of("mai")),
      livePreview({ openWikilink() {}, searchTag() {} }),
    ],
  });
  engine.setDoc(doc);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  return { view, cleanup: () => { engine.destroy(); parent.remove(); } };
}

/// Scrive come la tastiera: prima le regole della Live, poi il testo.
function type(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text), { userEvent: "input.type" });
  for (const handler of view.state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, text, insert)) return;
  }
  view.dispatch(insert());
}

function press(view: EditorView, key: "Backspace" | "Delete"): void {
  if (runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor")) return;
  (key === "Backspace" ? deleteCharBackward : deleteCharForward)(view);
}

/// I segni rimasti letterali: `*`, `~`, `^` che l'albero non legge come
/// segni, e i tag di formato senza compagno.
function strays(view: EditorView): string[] {
  const state = view.state;
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const text = state.doc.toString();
  // Quattro spazi a inizio riga fanno un blocco di codice, che mostra tutto
  // com'è scritto: è il Markdown, non un gesto.
  if (/^ {4}/.test(text)) return [];
  const signs = new Set<number>();
  const tags: { from: number; to: number; paired: boolean }[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name.endsWith("Mark")) for (let at = node.from; at < node.to; at++) signs.add(at);
      if (node.name === "HTMLTag") tags.push({ from: node.from, to: node.to, paired: false });
    },
  });
  // I segni di una coppia vuota aperta non si vedono: aspettano la lettera.
  const waiting = new Set<number>();
  for (const pair of emptyPairsOf(state)) for (let at = pair.from; at < pair.from + pair.open + pair.close; at++) waiting.add(at);
  const out: string[] = [];
  for (let at = 0; at < text.length; at++) {
    if ("*~^".includes(text[at]!) && !signs.has(at) && !waiting.has(at)) out.push(`«${text[at]}» in ${at}`);
  }
  tree.iterate({
    enter: (node) => {
      if (node.name !== "HTMLTag") return;
      const pair = inlineHtmlPartner((a, b) => state.sliceDoc(a, b), node.node);
      if (!pair) return;
      for (const tag of tags) if (tag.from === node.from || tag.from === pair.close.from) tag.paired = true;
    },
  });
  for (const tag of tags) if (!tag.paired && !waiting.has(tag.from)) out.push(`${state.sliceDoc(tag.from, tag.to)} in ${tag.from}`);
  // Quello che si vede: soltanto lettere, cifre e spazi, come quelli scritti.
  const shown = view.contentDOM.textContent ?? "";
  const odd = shown.replace(/[a-z0-9 \u200b\u00a0]/g, "");
  if (odd) out.push(`a vista «${odd}» in ${JSON.stringify(shown)}`);
  // Una coppia di `==` aperta e mai chiusa.
  const loose = [...text].filter((_char, at) => !waiting.has(at)).join("");
  // La regola è quella del provider, che la Live usa.
  let rest = loose;
  for (const span of spans(loose).reverse()) if (span.name.endsWith(":highlight")) rest = rest.slice(0, span.from) + rest.slice(span.to);
  if (/==/.test(rest)) out.push("«==» spaiato");
  return out;
}

/// Dove un cursore può stare: non dentro un segno o un tag nascosti.
function places(view: EditorView): number[] {
  const state = view.state;
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
  const inside = new Set<number>();
  tree.iterate({
    enter: (node) => {
      if (node.name.endsWith("Mark") || node.name === "HTMLTag") for (let at = node.from + 1; at < node.to; at++) inside.add(at);
    },
  });
  const text = state.doc.toString();
  for (const match of text.matchAll(/==/g)) inside.add(match.index + 1);
  const out: number[] = [];
  for (let at = 0; at <= state.doc.length; at++) if (!inside.has(at)) out.push(at);
  return out;
}

function generator(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

describe("la Live a chi cambia idea", () => {
  it("gesti, lettere, spazi e cancellazioni non lasciano segni a vista", () => {
    const { view, cleanup } = mount("");
    try {
      for (let seed = 1; seed <= 500; seed++) {
        const random = generator(seed);
        const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "alfa beta gamma" }, selection: { anchor: 4 } });
        const steps: string[] = [];
        for (let step = 0; step < 24; step++) {
          const roll = random();
          if (roll < 0.35) {
            const gesture = pick(Object.keys(GESTURES) as (keyof typeof GESTURES)[]);
            steps.push(gesture);
            GESTURES[gesture](view);
          } else if (roll < 0.6) {
            const letter = pick(["a", "b", "x", "2", " "]);
            steps.push(JSON.stringify(letter));
            type(view, letter);
          } else if (roll < 0.75) {
            const key = pick(["Backspace", "Delete"] as const);
            steps.push(key);
            press(view, key);
          } else {
            const spots = places(view);
            const anchor = pick(spots);
            const head = random() < 0.5 ? anchor : pick(spots);
            steps.push(`@${anchor}-${head}`);
            view.dispatch({ selection: EditorSelection.single(anchor, head) });
          }
          const left = strays(view);
          if (left.length) {
            expect.fail(`seme ${seed}: ${steps.join(" ")} → ${JSON.stringify(view.state.doc.toString())}: ${left.join(", ")}`);
          }
        }
      }
    } finally {
      cleanup();
    }
  }, 60_000);
  // Le sequenze che il generatore ha trovato rotte, una per difetto: le
  // coppie in attesa che se ne vanno, gli elementi divisi che tornano uno, i
  // tag annidati, l'evidenziato letto con la regola del provider.
  it.each([
    // Apice, 2, pedice, 3: il caso da cui è partito tutto.
    ['S "2" P "3" " " "e"', "alfa^2^~3~ e beta gamma"],
    ["@15-8 S B U \"a\" H I \" \" U S I @11-11", "alfa bet**a** "],
    ["\"x\" I @7-6 Delete @0-9 P S H \"x\" \"x\" \"b\" U \"a\" Backspace @20-20 I I S Backspace X @9-24", "<mark>^xxb^</mark> ^amma^"],
    ["Delete @11-11 Delete @8-13 @2-6 \"x\" Backspace Delete \" \" \"b\" X S \"2\" S Backspace \"a\" @13-15 Backspace @3-3 I H @17-17", "al ~~baa~~ ga"],
    ["S U \"2\" Delete H @16-18 B X H S \"x\" Backspace @17-17 Backspace I @9-9 S @10-10 B P U @30-30", "alfa<u>^2^</u>*bea* gamma"],
    ["H I @34-34 Backspace H \"a\" @1-12 @1-1 \" \" H", "a <mark></mark>lfa beta ==gamma=="],
    ["\"a\" B B U \" \" Backspace X Backspace B B I @8-16 Delete \"x\" I @3-4 I @12-8 @6-7 @3-11 B", "alf***a*** ***bxa***"],
    ["\"x\" @3-3 @5-5 Delete \"a\" Backspace B \" \" X P I X", "**alfax <em><sub></sub></em>beta** gamma"],
    ["\"2\" \" \" Backspace @16-16 B Backspace @7-1 \"2\" B @3-6 P @16-16 \" \" U S P @2-2 @4-4 I P B @22-22", "**a~2et~a** gamm "],
    ["@3-3 S H @20-8 \"a\" U @30-30 @21-21 Delete U \"x\" @0-22 @8-20 @6-7 P H P Delete", "<mark>^a^</mark><u>betaxgamma</u>"],
    ["@12-14 @0-0 S I B P \"b\" \"a\" S Backspace S I", "<strong>~b~^^</strong>alfa beta gamma"],
    ["@15-15 Delete \"a\" Delete X \" \" @18-18 \"x\" H \"b\" Delete \"b\" \"a\" @3-3 \" \" \" \" U S \"2\" P \"a\" I H U", "alf  ^2^~a~<em>====</em>a beta gammaa x<mark>b</mark>ba"],
    ["\"2\" @2-10 P @21-13 U \"x\" Backspace Backspace X U @39-39 @7-10 \" \" X Backspace Delete U Backspace Backspace @5-5 X P", "<del></del>b gamma"],
    ["Backspace \"x\" @12-12 \"a\" B P P P \"a\" Backspace @8-8 H @0-20 @10-16 H \"x\" B H Backspace", "alfx bet<strong>~gaamma~</strong>"],
    ["Backspace I P \"2\" P @2-2 U B Backspace @13-13 H I Backspace Backspace X I @22-22 Backspace H B U S @39-15", "<em><sup>2</sup></em> beta gamma"],
    ["@1-1 S \"b\" \"b\" @9-18 \"b\" Delete \"b\" @2-11 I \"x\" Delete \"2\" \"a\" U H @2-12 I @3-3 P P X S Delete S X @26-26 Delete @2-2 @1-1 P S X", "~~<sup></sup>~~^ax^"],
    ["\" \" Backspace @15-15 \" \" @14-14 @12-12 S Delete X \"b\" \"2\" Delete S I P Backspace \" \" Backspace H @21-8 @33-21 @0-0 I P \"b\"", "<em><sub>b</sub></em>alfa beta <del><em><sub>==gaba==</sub></em></del> "],
    ["P \"x\" @4-5 S \"y\"", "alfa^y^~x~ beta gamma"],
  ])("%s", (sequence, expected) => {
    const { view, cleanup } = mount("alfa beta gamma");
    try {
      view.dispatch({ selection: { anchor: 4 } });
      for (const step of sequence.match(/"[^"]*"|\S+/g)!) {
        if (step.startsWith('"')) type(view, JSON.parse(step) as string);
        else if (step === "Backspace" || step === "Delete") press(view, step);
        else if (step.startsWith("@")) {
          const [anchor, head] = step.slice(1).split("-").map(Number);
          view.dispatch({ selection: EditorSelection.single(anchor!, head!) });
        } else GESTURES[step as keyof typeof GESTURES](view);
      }
      expect(view.state.doc.toString()).toBe(expected);
      expect(strays(view)).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
