// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { markdownGrammar } from "./grammar";
import { italianTypography, TYPOGRAPHY_KEY, type TypographyOptions } from "./typography";

// La tipografia italiana (T38): una prova per regola e per ogni luogo dove
// non vale. `|` è il cursore; `type` batte i caratteri uno alla volta come la
// tastiera, passando dagli `inputHandler` come il browser.

const host = vi.hoisted(() => ({
  value: false as unknown,
  listeners: [] as ((event: { key: string }) => void)[],
}));
vi.mock("../../../../host/query", () => ({
  settings: () => Promise.resolve([{ spec: { key: "editor.typography" }, value: host.value }]),
}));
vi.mock("../../../../state/kernel", () => ({
  onEvent: (_type: string, handler: (event: { key: string }) => void) => {
    host.listeners.push(handler);
    return () => host.listeners.splice(host.listeners.indexOf(handler), 1);
  },
}));

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

const ON: TypographyOptions = { enabled: () => true, appLanguage: () => "it-IT" };

function mount(spec: string, options: TypographyOptions = ON, extra: Extension = []): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: spec.replace("|", ""),
      selection: { anchor: spec.indexOf("|") },
      extensions: [extra, markdown({ base: markdownGrammar }), history(), italianTypography(options)],
    }),
  });
  views.push(view);
  return view;
}

/// Un tasto: se nessun gestore lo prende, lo scrive il browser.
function key(view: EditorView, text: string): void {
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  const { from, to } = view.state.selection.main;
  const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, () => view.state.update({})));
  if (!handled) view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
}

function type(view: EditorView, text: string): void {
  for (const char of text) key(view, char);
}

const press = (view: EditorView, name: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key: name }), "editor");
const text = (view: EditorView) => view.state.doc.toString();

describe("le regole", () => {
  it("le virgolette aprono dopo uno spazio e chiudono dopo una parola", () => {
    const view = mount("|");
    type(view, "disse \"ciao\" e andò");
    expect(text(view)).toBe("disse «ciao» e andò");
  });

  it("aprono anche a inizio riga, dopo una parentesi e dentro il grassetto", () => {
    const view = mount("|");
    type(view, "\"a\" (\"b\") **\"c\"**");
    expect(text(view)).toBe("«a» («b») **«c»**");
  });

  it("dentro una citazione aperta diventano “ ”, e la chiusura torna a »", () => {
    const view = mount("|");
    type(view, "\"disse \"sì\" e poi\"");
    expect(text(view)).toBe("«disse “sì” e poi»");
  });

  it("due trattini diventano una lineetta", () => {
    const view = mount("|");
    type(view, "un inciso -- breve");
    expect(text(view)).toBe("un inciso — breve");
  });

  it("tre trattini nella riga restano tre trattini", () => {
    const view = mount("|");
    type(view, "a---b");
    expect(text(view)).toBe("a---b");
  });

  it("tre punti diventano i puntini, il quarto resta un punto", () => {
    const view = mount("|");
    type(view, "e poi...");
    expect(text(view)).toBe("e poi…");
    type(view, ".");
    expect(text(view)).toBe("e poi….");
  });

  it("l'apostrofo diventa ’, anche a inizio parola", () => {
    const view = mount("|");
    type(view, "l'anno '90 e 'sto");
    expect(text(view)).toBe("l’anno ’90 e ’sto");
  });
});

describe("annullare", () => {
  it("un annulla subito dopo toglie la sostituzione e lascia ciò che si era scritto", () => {
    const view = mount("|");
    type(view, "ciao \"");
    expect(text(view)).toBe("ciao «");
    undo(view);
    expect(text(view)).toBe("ciao \"");
    const dash = mount("|");
    type(dash, "a --");
    undo(dash);
    expect(text(dash)).toBe("a --");
  });

  it("Backspace subito dopo rimette ciò che si era scritto", () => {
    for (const [typed, back] of [["ciao \"", "ciao \""], ["a --", "a --"], ["e...", "e..."], ["l'", "l'"]] as const) {
      const view = mount("|");
      type(view, typed);
      expect(press(view, "Backspace")).toBe(true);
      expect(text(view)).toBe(back);
      expect(view.state.selection.main.head).toBe(back.length);
    }
  });

  it("Backspace più tardi cancella come sempre", () => {
    const view = mount("|");
    type(view, "l'a");
    expect(press(view, "Backspace")).toBe(false);
  });
});

describe("dove non vale", () => {
  const untouched: [string, string, string][] = [
    ["nel codice in linea", "`a|`", "\"--..."],
    ["nel codice in linea ancora aperto", "`a |", "\"x\""],
    ["nel blocco di codice", "```\n|\n```", "\"a\" -- b..."],
    ["nel blocco rientrato", "    |", "it's"],
    ["nella formula", "$x|$", "'"],
    ["nella formula ancora aperta", "$x |", "\"a\""],
    ["nella formula a blocco", "$$\nx = |", "\"a\""],
    ["nell'indirizzo di un link", "[a](b|)", "--"],
    ["nell'indirizzo che si sta scrivendo", "[a](http://x|", "'"],
    ["nel testo di un link", "[a|](b)", "\"x\""],
    ["in un wikilink", "[[No|ta]]", "'"],
    ["in un wikilink ancora aperto", "[[Nota|", "'"],
    ["in un indirizzo nudo", "vedi https://x.it/a|", "..."],
    ["nel frontmatter", "---\ntitolo: |\n---\n", "\"l'a\""],
    ["in un tag HTML", "<span title=|", "\"a\""],
    ["in un commento HTML", "<!-- |", "\"a\" -- b"],
    ["in un commento %%", "%% |", "\"a\""],
    ["in una riga di soli trattini", "|", "---"],
    ["nella riga di una tabella", "| a |\n|", "--|--|"],
  ];
  for (const [where, spec, typed] of untouched) {
    it(where, () => {
      const view = mount(spec);
      const at = spec.indexOf("|");
      type(view, typed);
      const doc = spec.replace("|", "");
      expect(text(view)).toBe(doc.slice(0, at) + typed + doc.slice(at));
    });
  }

  it("dopo il codice in linea chiuso torna a valere", () => {
    const view = mount("`a` |");
    type(view, "\"b\"");
    expect(text(view)).toBe("`a` «b»");
  });

  it("dopo il frontmatter vale", () => {
    const view = mount("---\nlang: it\n---\n|");
    type(view, "l'a");
    expect(text(view)).toBe("---\nlang: it\n---\nl’a");
  });

  it("nell'incolla", () => {
    const view = mount("|");
    view.dispatch({ changes: { from: 0, insert: "\"a\" -- l'b..." }, userEvent: "input.paste" });
    expect(text(view)).toBe("\"a\" -- l'b...");
  });

  it("in un testo arrivato in un colpo", () => {
    const view = mount("ab|");
    key(view, "..");
    key(view, "'\"");
    expect(text(view)).toBe("ab..'\"");
  });

  it("durante la composizione (IME)", () => {
    const view = mount("|");
    Object.defineProperty(view, "compositionStarted", { get: () => true });
    type(view, "l'a");
    expect(text(view)).toBe("l'a");
  });

  it("con una selezione da sostituire o più cursori", () => {
    const view = mount("|abc");
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    key(view, "'");
    expect(text(view)).toBe("'");
  });

  it("spenta (di serie)", () => {
    const view = mount("|", { enabled: () => false, appLanguage: () => "it" });
    type(view, "\"a\" -- l'b...");
    expect(text(view)).toBe("\"a\" -- l'b...");
  });

  it("in una nota in un'altra lingua: quella della nota vince su quella dell'app", () => {
    const english = mount("---\nlang: en-GB\n---\n|");
    type(english, "it's");
    expect(text(english)).toBe("---\nlang: en-GB\n---\nit's");
    const italian = mount("---\nlang: it\n---\n|", { enabled: () => true, appLanguage: () => "en-US" });
    type(italian, "l'a");
    expect(text(italian)).toBe("---\nlang: it\n---\nl’a");
  });

  it("con l'app in un'altra lingua e la nota senza lingua", () => {
    const view = mount("|", { enabled: () => true, appLanguage: () => "en-US" });
    type(view, "it's");
    expect(text(view)).toBe("it's");
  });
});

describe("Vim", () => {
  it("in inserimento vale; in modo normale i tasti sono comandi e Backspace resta di Vim", () => {
    const view = mount("|", ON, vim());
    const cm = getCM(view)!;
    Vim.handleKey(cm, "i", "user");
    type(view, "l'");
    expect(text(view)).toBe("l’");
    Vim.handleKey(cm, "<Esc>", "user");
    const { head } = view.state.selection.main;
    expect(view.state.facet(EditorView.inputHandler).some((handler) => handler(view, head, head, "'", () => view.state.update({})))).toBe(false);
    press(view, "Backspace");
    expect(text(view)).toBe("l’");
  });
});

describe("l'impostazione", () => {
  beforeEach(() => {
    host.value = false;
    host.listeners.length = 0;
  });

  it("si legge da `editor.typography` e segue i cambi; la vista chiusa smette di ascoltare", async () => {
    host.value = true;
    const view = mount("|", { appLanguage: () => "it" });
    await vi.waitFor(() => {
      type(view, "'");
      expect(text(view).endsWith("’")).toBe(true);
    });
    host.value = false;
    for (const listener of [...host.listeners]) listener({ key: TYPOGRAPHY_KEY });
    await vi.waitFor(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
      type(view, "'");
      expect(text(view)).toBe("'");
    });
    expect(host.listeners.length).toBe(1);
    view.destroy();
    expect(host.listeners.length).toBe(0);
  });
});
