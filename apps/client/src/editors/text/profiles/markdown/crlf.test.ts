import { describe, expect, it } from "vitest";
import { CompletionContext, insertCompletionText, type CompletionResult } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Extension, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { propertiesDisplay } from "../../properties-display";
import { duplicateLines } from "../../commands";
import { loadDiagramTemplates, MARKDOWN_ACTIONS } from "./actions";
import { closeFenceEnter, toggleComment } from "./commands";
import { diagramTemplateSource } from "./completions";
import { toggleFormat } from "./format-toggle";
import { keepMarks } from "./keep-marks";
import { addProperty, moveProperty, propertiesExtension, setProperty } from "./properties";
import { retitled } from "./page/title";

// Gli inserimenti dell'editor Markdown in una nota tutta CRLF (#394). L'editor
// la apre col separatore `\r\n` (engine.ts), e CodeMirror divide il testo
// inserito solo lì: ogni a capo che un comando scrive deve diventare un a capo
// vero, e il file salvato (`sliceDoc()`) restare tutto CRLF. Un a capo vale
// una posizione qualunque sia il separatore, quindi il documento visto con
// `"\n"` e il cursore devono uscire uguali a quelli della stessa nota LF.
//
// `|` è il cursore, `‹…›` la selezione, come in `actions.test.ts`.

const CRLF = "\r\n";

function mk(spec: string, separator: string | null, extensions: Extension = []): EditorState {
  const open = spec.indexOf("‹");
  const stripped = open === -1 ? spec.replace("|", "") : spec.replace("‹", "").replace("›", "");
  const selection = open === -1
    ? EditorSelection.single(Math.max(0, spec.indexOf("|")))
    : EditorSelection.single(open, spec.replace("‹", "").indexOf("›"));
  return EditorState.create({
    doc: separator === null ? stripped : stripped.replace(/\n/g, separator),
    selection,
    extensions: [
      ...(separator === null ? [] : [EditorState.lineSeparator.of(separator)]),
      markdown({ base: markdownLanguage }),
      extensions,
    ],
  });
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

/// Il file che si salverebbe: in una nota CRLF, senza a capo nudi.
function saved(state: EditorState): string {
  const text = state.sliceDoc();
  if (state.lineBreak === CRLF) expect(text.replace(/\r\n/g, ""), "a capo misti nel file").not.toMatch(/[\r\n]/);
  return text;
}

type Make = (state: EditorState) => TransactionSpec | null;

/// Il comando `make` in LF e in CRLF: in CRLF esce lo stesso documento con
/// gli a capo CRLF, e il cursore allo stesso posto. Restituisce il risultato
/// LF, `null` se il comando non ha scritto.
function both(spec: string, make: Make, extensions: Extension = []): string | null {
  const [lf, crlf] = [null, CRLF].map((separator) => {
    const state = mk(spec, separator, extensions);
    const tr = make(state);
    return tr === null ? null : state.update(tr).state;
  });
  if (lf === null || crlf === null) {
    expect(crlf).toBe(lf);
    return null;
  }
  expect(saved(crlf)).toBe(saved(lf).replace(/\n/g, CRLF));
  expect(show(crlf)).toBe(show(lf));
  return show(lf!);
}

/// Un comando, con la sua transazione (una sola).
function command(run: StateCommand): Make {
  return (state) => {
    const specs: TransactionSpec[] = [];
    if (!run({ state, dispatch: (tr) => { specs.push({ changes: tr.changes, selection: tr.selection }); } })) return null;
    expect(specs).toHaveLength(1);
    return specs[0]!;
  };
}

function action(id: string, params: Readonly<Record<string, unknown>> = {}): Make {
  const found = MARKDOWN_ACTIONS.get(id);
  if (!found) throw new Error(`${id} non è nel catalogo`);
  const run = Object.keys(params).length > 0 ? found.withParams!(params)! : found.run;
  return command(run);
}

describe("le azioni della barra in una nota CRLF", () => {
  it("il riquadro, su una riga vuota e attorno alle righe scelte", () => {
    expect(both("Prima\n\n|\n\nDopo", action("markdown.callout"))).toBe("Prima\n\n> [!note]\n> |\n\nDopo");
    expect(both("‹Uno\n\ndue›", action("markdown.callout"))).toBe("> [!‹note›]\n> Uno\n>\n> due");
    expect(both("‹Uno\ndue›", action("markdown.callout", { type: "tip" }))).toBe("> [!tip]\n> Uno\n> due|");
  });

  it("le colonne e il ripiegabile", () => {
    expect(both("‹Uno\n\nDue›", action("markdown.columns"))).toBe("> [!columns]\n> > [!column]\n> > Uno|\n>\n> > [!column]\n> > Due");
    expect(both("|", action("markdown.details"))).toBe("<details>\n<summary>|</summary>\n\n\n\n</details>");
    expect(both("‹Uno\ndue›", action("markdown.details"))).toBe("<details>\n<summary>|</summary>\n\nUno\ndue\n\n</details>");
  });

  it("il blocco di codice: vuoto, attorno alle righe, col linguaggio e tolto", () => {
    expect(both("Testo\n|\nDopo", action("markdown.codeblock"))).toBe("Testo\n```\n|\n```\nDopo");
    expect(both("‹uno\ndue›", action("markdown.codeblock"))).toBe("```\n‹uno\ndue›\n```");
    expect(both("|", action("markdown.codeblock", { language: "ts" }))).toBe("```ts\n|\n```");
    // Qui la selezione non segue il linguaggio scritto, anche in LF: conta il testo.
    expect(both("‹uno\ndue›", action("markdown.codeblock", { language: "ts" }))?.replace(/[‹›|]/g, "")).toBe("```ts\nuno\ndue\n```");
    // Togliere il recinto toglie le sue righe, e non un carattere di più.
    expect(both("Prima\n```\nun|o\ndue\n```\nDopo", action("markdown.codeblock"))).toBe("Prima\nun|o\ndue\nDopo");
    expect(both("$$\nx|\n$$", action("markdown.mathblock"))).toBe("x|");
  });

  it("riga, indice, tabella e segnalibro aggiungono righe vere, col cursore al suo posto", () => {
    expect(both("Testo|", action("markdown.rule"))).toBe("Testo\n\n---\n|");
    expect(both("Testo|\nDopo", action("markdown.toc"))).toBe("Testo\n\n```toc\n```\n|\nDopo");
    expect(both("Testo|", action("markdown.table"))).toBe("Testo\n\n| ‹Colonna 1› | Colonna 2 |\n| --- | --- |\n|  |  |\n");
    expect(both("Testo|", action("markdown.table", { rows: 2, cols: 2 }))).toBe("Testo\n\n| ‹Colonna 1› | Colonna 2 |\n| --- | --- |\n|  |  |\n");
    expect(both("‹a\tb\nc\td›", action("markdown.table"))).toBe("‹| a | b |\n| --- | --- |\n| c | d |›");
    expect(both("Testo|", action("markdown.linkcard"))).toBe("Testo\n\nhttps://|\n");
  });

  it("il diagramma: il recinto vuoto e il modello", async () => {
    expect(both("Testo|", action("markdown.diagram"))).toBe("Testo\n```mermaid\n|\n```");
    await loadDiagramTemplates();
    const out = both("Testo|", action("markdown.diagram", { template: "pie" }));
    expect(out).toMatch(/^Testo\n```mermaid\npie[^|]*\|\n```$/);
  });

  it("la nota a piè di pagina: in fondo, staccata da una riga vuota; e tolta", () => {
    expect(both("Testo|\nfine", action("markdown.footnote"))).toBe("Testo[^1]\nfine\n\n[^1]: |");
    expect(both("Testo|\n", action("markdown.footnote"))).toBe("Testo[^1]\n\n[^1]: |");
    expect(both("Testo|\n\n", action("markdown.footnote"))).toBe("Testo[^1]\n\n[^1]: |");
    expect(both("Testo[^1]|\n\n[^1]: nota\n", action("markdown.footnote.delete"))).toBe("Testo|\n");
  });

  it("il link attorno a un testo su due righe seleziona ciò che resta da scrivere", () => {
    expect(both("‹uno\ndue›", action("markdown.link"))).toBe("[uno\ndue](|)");
    expect(both("[uno\ndu|e](x)", action("markdown.link"))).toBe("‹uno\ndue›");
  });
});

describe("gli altri comandi in una nota CRLF", () => {
  it("Invio dopo un recinto aperto lo chiude su righe vere", () => {
    expect(both("Testo\n```js|", command(closeFenceEnter))).toBe("Testo\n```js\n|\n```");
    expect(both("  ~~~|", command(closeFenceEnter))).toBe("  ~~~\n  |\n  ~~~");
  });

  it("le proprietà: Mod-; e una proprietà scritta, col frontmatter nuovo o no", () => {
    const display = propertiesDisplay.of("source");
    expect(both("Testo|", command(addProperty), display)).toBe("---\n|\n---\nTesto");
    expect(both("---\ntitle: x\n---\nTesto|", command(addProperty), display)).toBe("---\ntitle: x\n|\n---\nTesto");
    const set = (key: string, value: string): Make => (state) => ({ changes: setProperty(state, key, value)! });
    expect(both("Testo|", set("title", "Nota"))).toBe("---\ntitle: Nota\n---\nTesto|");
    expect(both("---\ntitle: x\n---\nTesto|", set("tags", "a"))).toBe("---\ntitle: x\ntags: a\n---\nTesto|");
  });

  it("le proprietà scritte dalla testata: elenchi, date, valori su più righe sostituiti (revisione #421)", () => {
    const set = (key: string, value: Parameters<typeof setProperty>[2]): Make => (state) => ({ changes: setProperty(state, key, value)! });
    expect(both("---\ntags:\n  - a\n  - b\nx: 1\n---\nTesto|", set("tags", ["c", "d e"]))).toBe("---\ntags:\n  - c\n  - d e\nx: 1\n---\nTesto|");
    expect(both("---\nd: 2026-03-02\n---\nTesto|", set("d", { date: "2026-03-20T10:30:45+01:00" }))).toBe("---\nd: 2026-03-20T10:30:45+01:00\n---\nTesto|");
    expect(both("---\nnote: >\n  uno\n  due\n---\nTesto|", set("note", "1e3"))).toBe("---\nnote: \"1e3\"\n---\nTesto|");
    expect(both("---\na: x\n---\nTesto|", set("a", "uno\ndue"))).toBe("---\na: \"uno\\ndue\"\n---\nTesto|");
  });

  it("la rinomina dal titolo riscrive l'H1 ripiegato senza toccare gli a capo (revisione #421)", () => {
    const rename: Make = (state) => {
      const change = retitled(state.doc, 0, "Mostra", "Mostra d'estate");
      return change === null ? null : { changes: change };
    };
    expect(both("# Mostra\n\nTesto|", rename)).toBe("# Mostra d'estate\n\nTesto|");
    const body: Make = (state) => {
      const from = state.doc.line(4).from;
      const change = retitled(state.doc, from, "Mostra", "Altro");
      return change === null ? null : { changes: change };
    };
    expect(both("---\na: 1\n---\n# Mostra #\nTesto|", body)).toBe("---\na: 1\n---\n# Altro #\nTesto|");
  });

  it("Alt-↑/↓ sposta una proprietà su più righe, col cursore che la segue", () => {
    const doc = "---\ntitle: x\ntags:\n  - a\n  - b\n---\nTesto";
    expect(both(doc.replace("tags:", "ta|gs:"), command(moveProperty(-1)))).toBe("---\nta|gs:\n  - a\n  - b\ntitle: x\n---\nTesto");
    expect(both(doc.replace("title:", "ti|tle:"), command(moveProperty(1)))).toBe("---\ntags:\n  - a\n  - b\nti|tle: x\n---\nTesto");
  });

  it("ciò che si incolla prima del widget delle proprietà scende sotto, righe comprese", () => {
    const extensions = [propertiesDisplay.of("visible"), propertiesExtension()];
    const paste = (state: EditorState): TransactionSpec => ({
      changes: { from: 0, insert: state.toText("uno\ndue".replace(/\n/g, state.lineBreak)) },
      selection: { anchor: 7 },
      userEvent: "input.paste",
    });
    expect(both("---\ntitle: x\n---\nTesto", paste, extensions)).toBe("---\ntitle: x\n---\nuno\ndue|Testo");
    expect(both("---\ntitle: x\n---", paste, extensions)).toBe("---\ntitle: x\n---\nuno\ndue|");
  });

  it("incollare righe su un pezzo di grassetto tiene i segni, e le righe restano righe", () => {
    const paste = (state: EditorState): TransactionSpec => ({
      changes: { from: state.selection.main.from, to: state.selection.main.to, insert: state.toText("X\nY".replace(/\n/g, state.lineBreak)) },
      userEvent: "input.paste",
    });
    expect(both("Prima\nun‹o **d›ue** tre", paste, keepMarks())).toBe("Prima\nunX\nY|**ue** tre");
  });

  it("Mod-d duplica le righe col cursore sulla copia", () => {
    expect(both("u|no\ndue\ntre", command(duplicateLines))).toBe("uno\nu|no\ndue\ntre");
    expect(both("‹uno\ndue›\ntre", command(duplicateLines))).toBe("uno\ndue\n‹uno\ndue›\ntre");
  });

  it("il grassetto lascia fuori gli a capo ai bordi della selezione", () => {
    expect(both("uno‹\ndue›", command(toggleComment))).toBe("uno\n%%‹due›%%");
    expect(both("uno‹\ndue›", command(toggleFormat("strong")))).toBe("uno\n**‹due›**");
    expect(both("‹uno\n›due", command(toggleFormat("em")))).toBe("*‹uno›*\ndue");
  });

  it("il modello di diagramma scelto dal completamento entra a righe vere", async () => {
    const run = async (separator: string | null) => {
      const state = mk("```mermaid\npie|", separator);
      const context = new CompletionContext(state, state.selection.main.head, false);
      const result = await diagramTemplateSource(() => new Date(2026, 9, 1))(context) as CompletionResult;
      return state.update(insertCompletionText(state, result.options[0]!.apply as string, result.from, result.to ?? result.from)).state;
    };
    const [lf, crlf] = [await run(null), await run(CRLF)];
    expect(show(lf)).toMatch(/^```mermaid\npie[^|]*\n```\|$/);
    expect(saved(crlf)).toBe(saved(lf).replace(/\n/g, CRLF));
    expect(show(crlf)).toBe(show(lf));
  });
});
