// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { computeDecorations, type LiveDeco } from "./livepreview";
import { renderMarkdown } from "./render";
import { markTaskDues } from "./query-block";
import corpus from "../../../../__fixtures__/corpus-syntax.json";

// **La scadenza di un compito, letta tre volte sullo stesso testo.** Il
// modello la trova sul testo del compito (`fub_abi::rules::tasks`: la ricerca
// e la vista dei compiti), la Live sul buffer e la Lettura sul DOM reso. La
// fixture la emette `crates/fub-format-markdown/tests/the_corpus.rs` (famiglia
// `due`): per ogni compito con una `📅`, il tratto che la regola vede e la
// data. Le due superfici devono trovare le stesse scadenze, con la stessa
// data che si legge o non si legge — un wikilink, un codice, una riga che
// continua il compito, un evidenziato, una sottovoce: è qui che tre letture
// dissentivano.
//
// Sta fuori da `corpus.test.ts` perché la Lettura vuole un DOM.

interface DueCase {
  name: string;
  source: string;
  due: { span: string; date: string | null }[];
}

const cases = (corpus as DueCase[]).filter((testCase) => Array.isArray(testCase.due));

/// Il testo che si vede di un tratto della Live: senza ciò che vi è nascosto.
function visible(source: string, deco: LiveDeco, all: LiveDeco[]): string {
  let out = "";
  for (let at = deco.from; at < deco.to; at++) {
    if (all.some((d) => d.kind === "hide" && d.from <= at && at < d.to)) continue;
    out += source[at] === "\n" ? " " : source[at];
  }
  return out;
}

describe("la scadenza: modello, Live e Lettura dicono la stessa cosa", () => {
  it("la fixture porta abbastanza scadenze da poter divergere", () => {
    expect(cases.reduce((n, c) => n + c.due.length, 0)).toBeGreaterThan(5);
  });

  for (const testCase of cases) {
    it(`«${testCase.name}»`, () => {
      const expected = testCase.due.map((due) => [due.span, due.date === null]);

      // La Live, con nessuna riga attiva: i segni nascosti non si vedono.
      const state = EditorState.create({ doc: testCase.source, extensions: [markdown({ base: markdownGrammar })] });
      const decorations = computeDecorations(state, new Set());
      const live = decorations
        .filter((d) => d.kind === "task-due")
        .map((d) => [visible(testCase.source, d, decorations), d.data === "bad"]);
      expect(live, "Live").toEqual(expected);

      // La Lettura: la pastiglia sul DOM reso.
      const container = document.createElement("div");
      container.className = "markdown-rendered";
      container.innerHTML = renderMarkdown(testCase.source).html;
      markTaskDues(container, "2000-01-01");
      const reading = [...container.querySelectorAll<HTMLElement>(".task-due")]
        .map((pill) => [pill.textContent, pill.classList.contains("task-due-bad")]);
      expect(reading, "Lettura").toEqual(expected);
      // Gli span di posizione divisi dalla pastiglia portano ognuno il suo
      // tratto di sorgente: il testo e il tratto si corrispondono ancora.
      for (const span of container.querySelectorAll<HTMLElement>(".task-due > span[data-md-from]:not([class])")) {
        expect(testCase.source.slice(Number(span.dataset.mdFrom), Number(span.dataset.mdTo))).toBe(span.textContent);
      }
    });
  }
});
