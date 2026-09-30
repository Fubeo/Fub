import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { MARKDOWN_ACTIONS, markdownActionState } from "./actions";
import { markdownKeymap } from "./commands";
import { t } from "../../../../i18n/strings";

// Stesse convenzioni di `commands.test.ts`: `|` è il cursore, `‹…›` la
// selezione, e i comandi si provano su un `EditorState` senza view.

function mk(spec: string): EditorState {
  const open = spec.indexOf("‹");
  if (open !== -1) {
    const stripped = spec.replace("‹", "");
    const close = stripped.indexOf("›");
    return EditorState.create({
      doc: stripped.replace("›", ""),
      selection: EditorSelection.single(open, close),
      extensions: [markdown({ base: markdownLanguage })],
    });
  }
  const bar = spec.indexOf("|");
  return EditorState.create({
    doc: spec.replace("|", ""),
    selection: EditorSelection.single(bar === -1 ? 0 : bar),
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

function action(id: string) {
  const found = MARKDOWN_ACTIONS.get(id);
  if (!found) throw new Error(`${id} non è nel catalogo`);
  return found;
}

/// Esegue l'azione e restituisce il testo che ne esce; lo stato di partenza
/// se l'azione non ha scritto niente.
function run(id: string, spec: string): string {
  const state = mk(spec);
  let tr: Transaction | null = null;
  action(id).run({ state, dispatch: (transaction) => { tr = transaction; } });
  return show(tr === null ? state : (tr as Transaction).state);
}

function stateAt(id: string, spec: string) {
  return markdownActionState(action(id), mk(spec));
}

describe("titoli e paragrafo", () => {
  it("fanno della riga un titolo, col cursore dove si stava scrivendo", () => {
    expect(run("markdown.heading.2", "Ciao| mondo")).toBe("## Ciao| mondo");
    expect(run("markdown.heading.1", "|")).toBe("# |");
  });

  it("cambiano livello, e sullo stesso livello tornano paragrafo", () => {
    expect(run("markdown.heading.1", "### Ciao|")).toBe("# Ciao|");
    expect(run("markdown.heading.2", "## Ciao|")).toBe("Ciao|");
    expect(run("markdown.paragraph", "## Titolo|")).toBe("Titolo|");
  });

  it("tengono il pallino di una voce e saltano le righe vuote di una selezione", () => {
    expect(run("markdown.heading.2", "- voce|")).toBe("- ## voce|");
    expect(run("markdown.heading.1", "‹uno\n\ndue›")).toBe("# ‹uno\n\n# due›");
  });

  it("dicono il livello della riga del cursore", () => {
    expect(stateAt("markdown.heading.2", "## Ciao|")).toEqual({ enabled: true, active: true });
    expect(stateAt("markdown.heading.1", "## Ciao|")).toEqual({ enabled: true, active: false });
    expect(stateAt("markdown.paragraph", "Ciao|")).toEqual({ enabled: true, active: true });
  });
});

describe("testo in riga", () => {
  it("il grassetto è premuto dentro, non subito fuori, e non confonde il corsivo", () => {
    expect(stateAt("markdown.bold", "**gra|ssetto**").active).toBe(true);
    expect(stateAt("markdown.bold", "**grassetto**|").active).toBe(false);
    expect(stateAt("markdown.italic", "**gra|ssetto**").active).toBe(false);
    expect(stateAt("markdown.italic", "*cor|sivo*").active).toBe(true);
  });

  it("evidenziato e commento si riconoscono dai loro delimitatori", () => {
    expect(stateAt("markdown.highlight", "==im|portante==").active).toBe(true);
    expect(stateAt("markdown.highlight", "niente| qui").active).toBe(false);
    expect(stateAt("markdown.comment", "%%na|scosto%%").active).toBe(true);
    expect(run("markdown.highlight", "paro|la")).toBe("==‹parola›==");
  });

  it("la formula in riga è premuta dentro `$…$`", () => {
    expect(stateAt("markdown.math", "vale $x|^2$ qui").active).toBe(true);
    expect(stateAt("markdown.math", "costa 5|$").active).toBe(false);
  });

  it("dentro il codice si spengono, tranne il codice stesso", () => {
    const fence = "```\nx|\n```";
    expect(stateAt("markdown.bold", fence)).toEqual({ enabled: false, active: false });
    expect(stateAt("markdown.codeblock", fence)).toEqual({ enabled: true, active: true });
  });

  it("cancellare la formattazione toglie i marcatori dei tratti presi per intero", () => {
    expect(run("markdown.clear", "‹**grassetto** e *corsivo*›")).toBe("‹grassetto e corsivo›");
    expect(run("markdown.clear", "**gras|setto**")).toBe("gras|setto");
    expect(run("markdown.clear", "==ev|id==")).toBe("ev|id");
    expect(stateAt("markdown.clear", "te|sto").enabled).toBe(false);
  });
});

describe("collegamenti e rimandi", () => {
  it("un link prende la parola come testo e lascia il cursore sull'indirizzo", () => {
    expect(run("markdown.link", "paro|la")).toBe("[parola](|)");
    expect(run("markdown.link", "‹https://fub.app›")).toBe("[|](https://fub.app)");
    expect(run("markdown.link", "|")).toBe("[|]()");
  });

  it("dentro un link lo toglie, e resta il testo", () => {
    expect(stateAt("markdown.link", "[te|sto](https://x.y)").active).toBe(true);
    expect(run("markdown.link", "[te|sto](https://x.y)")).toBe("‹testo›");
  });

  it("un'immagine usa la selezione come testo alternativo", () => {
    expect(run("markdown.image", "‹gatto›")).toBe("![gatto](|)");
    expect(run("markdown.image", "|")).toBe("![|]()");
  });

  it("una nota prende il primo numero libero e si scrive in fondo", () => {
    expect(run("markdown.footnote", "Testo|")).toBe("Testo[^1]\n\n[^1]: |");
    expect(run("markdown.footnote", "Uno[^1] e due|\n\n[^1]: prima\n")).toBe(
      "Uno[^1] e due[^2]\n\n[^1]: prima\n\n[^2]: |",
    );
  });
});

describe("liste", () => {
  it("un'attività nasce da una riga o da una voce, e torna voce", () => {
    expect(run("markdown.list.task", "compra il pane|")).toBe("- [ ] compra il pane|");
    expect(run("markdown.list.task", "- voce|")).toBe("- [ ] voce|");
    expect(run("markdown.list.task", "- [ ] voce|")).toBe("- voce|");
  });

  it("puntato, numerato e attività si escludono nello stato", () => {
    expect(stateAt("markdown.list.bullet", "- vo|ce").active).toBe(true);
    expect(stateAt("markdown.list.bullet", "- [ ] vo|ce").active).toBe(false);
    expect(stateAt("markdown.list.task", "- [ ] vo|ce").active).toBe(true);
    expect(stateAt("markdown.list.ordered", "1. vo|ce").active).toBe(true);
  });

  it("il rientro vale soltanto sulle voci", () => {
    expect(stateAt("markdown.list.indent", "- vo|ce").enabled).toBe(true);
    expect(stateAt("markdown.list.indent", "para|grafo").enabled).toBe(false);
  });
});

describe("blocchi", () => {
  it("la citazione commuta, e tiene dentro le righe vuote", () => {
    expect(run("markdown.quote", "uno|")).toBe("> uno|");
    expect(run("markdown.quote", "> uno|")).toBe("uno|");
    expect(run("markdown.quote", "‹uno\n\ndue›")).toBe("> ‹uno\n>\n> due›");
    expect(stateAt("markdown.quote", "> uno|").active).toBe(true);
  });

  it("il callout mette l'intestazione sopra le righe e seleziona il tipo", () => {
    expect(run("markdown.callout", "|")).toBe("> [!note]\n> |");
    expect(run("markdown.callout", "Nota|")).toBe("> [!‹note›]\n> Nota");
  });

  it("il blocco di codice avvolge la selezione e si toglie da dentro", () => {
    expect(run("markdown.codeblock", "|")).toBe("```\n|\n```");
    expect(run("markdown.codeblock", "‹let x = 1›")).toBe("```\n‹let x = 1›\n```");
    expect(run("markdown.codeblock", "```\nlet| x\n```")).toBe("let| x");
    expect(run("markdown.codeblock", "````\n```|\n````")).toBe("```|");
  });

  it("il blocco di formula è premuto fra i suoi `$$`, e non fra due blocchi", () => {
    expect(run("markdown.mathblock", "|")).toBe("$$\n|\n$$");
    expect(stateAt("markdown.mathblock", "$$\nx|\n$$").active).toBe(true);
    expect(stateAt("markdown.mathblock", "$$\na\n$$\n\ntesto|").active).toBe(false);
    expect(run("markdown.mathblock", "$$\nx|\n$$")).toBe("x|");
  });

  it("la linea sta su righe sue, con una riga vuota sopra", () => {
    expect(run("markdown.rule", "Testo|")).toBe("Testo\n\n---\n|");
    expect(run("markdown.rule", "uno|\ndue")).toBe("uno\n\n---\n|\ndue");
    expect(run("markdown.rule", "|")).toBe("---\n|");
    expect(run("markdown.rule", "Testo\n|")).toBe("Testo\n\n---\n|");
  });
});

describe("tabelle", () => {
  const table = "| a | b |\n| --- | --- |\n| 1| 2 |";

  it("si inserisce con la prima intestazione selezionata", () => {
    const first = t("editor.table.column", { n: 1 });
    const second = t("editor.table.column", { n: 2 });
    expect(run("markdown.table", "|")).toBe(`| ‹${first}› | ${second} |\n| --- | --- |\n|  |  |\n`);
  });

  it("righe separate da tabulazioni diventano la tabella", () => {
    expect(run("markdown.table", "‹nome\tvoto\nAda\t10›")).toBe("‹| nome | voto |\n| --- | --- |\n| Ada | 10 |›");
  });

  it("le operazioni valgono dentro una tabella e sono spente fuori", () => {
    // `|` è sintassi della tabella: il cursore qui è una selezione vuota.
    expect(stateAt("markdown.table.row.after", table.replace("| 1", "| 1‹›")).enabled).toBe(true);
    expect(stateAt("markdown.table.column.delete", table.replace("| 1", "| 1‹›")).enabled).toBe(true);
    expect(stateAt("markdown.table.row.after", "fuori|").enabled).toBe(false);
    expect(stateAt("markdown.table.column.delete", "fuori|").enabled).toBe(false);
  });
});

describe("il catalogo", () => {
  it("ogni accordo suggerito è quello della keymap del profilo", () => {
    const keys = new Set(markdownKeymap.map((binding) => binding.key));
    for (const [id, entry] of MARKDOWN_ACTIONS) {
      if (entry.chord) expect(keys.has(entry.chord), `${id}: ${entry.chord}`).toBe(true);
    }
  });

  it("in sola lettura niente si esegue", () => {
    const state = EditorState.create({
      doc: "parola",
      extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(true)],
    });
    for (const [id, entry] of MARKDOWN_ACTIONS) {
      let wrote = false;
      entry.run({ state, dispatch: () => { wrote = true; } });
      expect(wrote, id).toBe(false);
    }
  });
});
