// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { propertiesDisplay, propertiesDisplayOf, type PropertiesDisplay } from "../../properties-display";
import readability from "../../../../__fixtures__/frontmatter-readability.json";
import { addProperty, clearProperties, hasAnchors, moveProperty, propertiesExtension, propertyBlock, propertyValue, setProperty } from "./properties";

// `|` è il cursore, come in `actions.test.ts`.
function mk(spec: string, display: PropertiesDisplay = "source", readOnly = false): EditorState {
  const bar = spec.indexOf("|");
  return EditorState.create({
    doc: spec.replace("|", ""),
    selection: EditorSelection.single(bar === -1 ? 0 : bar),
    extensions: [propertiesDisplay.of(display), EditorState.readOnly.of(readOnly)],
  });
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const head = state.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
}

function run(command: typeof addProperty, spec: string): string | null {
  let state = mk(spec);
  const ok = command({ state, dispatch: (tr: Transaction) => { state = tr.state; } });
  return ok ? show(state) : null;
}

describe("le voci del frontmatter", () => {
  it("legge chiavi, liste, testi su più righe e virgolette", () => {
    const block = propertyBlock(mk([
      "---",
      "title: \"Una nota\"",
      "tags:",
      "  - uno",
      "  - 'due'",
      "aliases: [a, \"b\"]",
      "# commento",
      "note: |",
      "  prima riga",
      "  seconda",
      "\"chiave: strana\": sì",
      "vuota:",
      "---",
      "Testo",
    ].join("\n")));
    expect(block?.entries.map((entry) => [entry.key, entry.value])).toEqual([
      ["title", "Una nota"],
      ["tags", "uno, due"],
      ["aliases", "a, b"],
      ["note", "prima riga seconda"],
      ["chiave: strana", "sì"],
      ["vuota", ""],
    ]);
  });

  it("una lista a margine zero appartiene ancora alla sua chiave", () => {
    const block = propertyBlock(mk("---\ntags:\n- uno\n- due\n---\n"));
    expect(block?.entries).toHaveLength(1);
    expect(block?.entries[0]?.value).toBe("uno, due");
  });

  // La stessa fixture la legge `frontmatter_readability.rs` col modello: la
  // testata e il modello dicono «non si legge» negli stessi casi.
  it.each(readability.cases)("si legge come nel modello: $name", ({ source, readable }) => {
    const block = propertyBlock(mk(source));
    expect(block).not.toBeNull();
    expect(block!.unreadable).toBe(!readable);
  });

  it("una riga vuota dentro un testo a blocco non chiude la voce", () => {
    const block = propertyBlock(mk("---\nnote: |\n  uno\n\n  due\nstato: x\n---\n"));
    expect(block?.entries.map((entry) => [entry.key, entry.value])).toEqual([["note", "uno due"], ["stato", "x"]]);
    expect(block?.unreadable).toBe(false);
  });

  it("con due voci uguali vale l'ultima, come nel modello", () => {
    const state = mk("---\nstato: a\nstato: b\n---\n");
    expect(propertyValue(state, "stato")).toBe("b");
    const change = setProperty(state, "stato", "c")!;
    expect(state.update({ changes: change }).state.doc.toString()).toBe("---\nstato: a\nstato: c\n---\n");
  });

  it("un commento in coda non è parte del valore, e la voce non è semplice", () => {
    const block = propertyBlock(mk("---\ncover: foto.jpg # dalla gita\nicona: '⭐'\nog: &img a.png\nfoto: *img\nsolo: b\n---\n"));
    expect(block?.entries.map((entry) => [entry.key, entry.value, entry.simple])).toEqual([
      ["cover", "foto.jpg", false],
      ["icona", "⭐", true],
      ["og", "a.png", false],
      ["foto", "*img", false],
      ["solo", "b", true],
    ]);
  });

  it("un valore con un a capo si scrive fra virgolette, con le sequenze di YAML", () => {
    const change = setProperty(mk("---\n---\n"), "titolo", "uno\ndue\tfine")!;
    expect(change.insert).toBe("titolo: \"uno\\ndue\\tfine\"\n");
  });

  it("un testo che YAML leggerebbe come un altro tipo si scrive fra virgolette (revisione #421)", () => {
    const write = (value: string) => setProperty(mk("---\n---\n"), "a", value)!.insert;
    for (const value of ["1e3", "1E-3", ".5", "-.5", "0x1F", "0o17", "0b101", "017", "1_000", ".inf", "-.INF", ".NaN", "~", "null", "Null", "NULL",
      "true", "TRUE", "False", "yes", "YES", "No", "y", "N", "on", "OFF", "2026-03-20", "2026-03-20T10:30:45+01:00", "2026-03-20 10:30", "12:30:00"]) {
      expect(write(value), value).toBe(`a: \"${value}\"\n`);
    }
    for (const value of ["Torino", "1a", "v1.2", "x.inf", "nullo", "sì"]) expect(write(value), value).toBe(`a: ${value}\n`);
  });

  it("una data scritta come data resta nuda, perché YAML la legga data", () => {
    const write = (date: string) => setProperty(mk("---\n---\n"), "d", { date })!.insert;
    expect(write("2026-03-20")).toBe("d: 2026-03-20\n");
    expect(write("2026-03-20T10:30:45+01:00")).toBe("d: 2026-03-20T10:30:45+01:00\n");
    expect(write("non una data")).toBe("d: non una data\n");
    expect(write("")).toBe("d:\n");
  });

  it("le ancore e gli alias del frontmatter si riconoscono", () => {
    const has = (doc: string) => hasAnchors(mk(doc), propertyBlock(mk(doc))!);
    expect(has("---\nbase: &b x\naltro: *b\n---\n")).toBe(true);
    expect(has("---\nl:\n  - &a uno\n---\n")).toBe(true);
    expect(has("---\nl: [*a, b]\n---\n")).toBe(true);
    expect(has("---\nt: a & b\nu: 2 * 3\nv: \"&x\"\n---\n")).toBe(false);
  });

  it("senza frontmatter non c'è niente", () => {
    expect(propertyBlock(mk("# Titolo\n\n---\n"))).toBeNull();
  });

  it("l'impostazione accetta solo i tre modi, e il default è quello dell'host, le righe", () => {
    expect(propertiesDisplayOf("visible")).toBe("visible");
    expect(propertiesDisplayOf("hidden")).toBe("hidden");
    expect(propertiesDisplayOf("source")).toBe("source");
    expect(propertiesDisplayOf("tabella")).toBe("visible");
    expect(propertiesDisplayOf(undefined)).toBe("visible");
  });
});

describe("aggiungere una proprietà", () => {
  it("apre una riga prima della chiusura", () => {
    expect(run(addProperty, "---\ntitle: x\n---\nTesto|")).toBe("---\ntitle: x\n|\n---\nTesto");
    expect(run(clearProperties, "---\ntitle: x\ntags: [a]\n---\nTesto|")).toBe("|Testo");
    expect(run(clearProperties, "Testo|")).toBeNull();
  });

  it("riusa una riga vuota già pronta", () => {
    expect(run(addProperty, "---\ntitle: x\n\n---\nTesto|")).toBe("---\ntitle: x\n|\n---\nTesto");
  });

  it("senza frontmatter lo crea in cima", () => {
    expect(run(addProperty, "Testo|")).toBe("---\n|\n---\nTesto");
  });

  it("in sola lettura non scrive", () => {
    const state = mk("Testo|", "source", true);
    expect(addProperty({ state, dispatch: () => { throw new Error("scritto"); } })).toBe(false);
  });
});

describe("riordinare le proprietà", () => {
  const doc = "---\na: 1\ntags:\n  - x\n  - y\nb: 2\n---\nTesto";

  it("sposta la voce intera, con le righe rientrate", () => {
    expect(run(moveProperty(1), doc.replace("a: 1", "a|: 1"))).toBe("---\ntags:\n  - x\n  - y\na|: 1\nb: 2\n---\nTesto");
    expect(run(moveProperty(-1), doc.replace("b: 2", "b: |2"))).toBe("---\na: 1\nb: |2\ntags:\n  - x\n  - y\n---\nTesto");
    expect(run(moveProperty(-1), doc.replace("tags:", "ta|gs:"))).toBe("---\nta|gs:\n  - x\n  - y\na: 1\nb: 2\n---\nTesto");
  });

  it("ai bordi trattiene il tasto, così la chiave non esce dal frontmatter", () => {
    expect(run(moveProperty(-1), doc.replace("a: 1", "|a: 1"))).toBe(doc.replace("a: 1", "|a: 1"));
    expect(run(moveProperty(1), doc.replace("b: 2", "b: 2|"))).toBe(doc.replace("b: 2", "b: 2|"));
  });

  it("fuori da una riga di chiave lascia fare ad Alt-↑/↓ delle righe", () => {
    expect(run(moveProperty(-1), doc.replace("  - y", "  - |y"))).toBeNull();
    expect(run(moveProperty(-1), doc.replace("Testo", "Te|sto"))).toBeNull();
  });
});

describe("il frontmatter in Live", () => {
  const doc = "---\ntitle: Nota\ntags: [a, b]\n---\nTesto";

  function mount(display: PropertiesDisplay, head: number): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    return new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(head),
        extensions: [propertiesDisplay.of(display), propertiesExtension()],
      }),
    });
  }

  it("visibile è una tabella di proprietà, e lo YAML non si vede", () => {
    const view = mount("visible", doc.length);
    const widget = view.dom.querySelector(".cm-fub-properties-visible");
    expect(widget?.getAttribute("role")).toBe("group");
    expect([...widget!.querySelectorAll("dt")].map((node) => node.textContent)).toEqual(["title", "tags"]);
    expect([...widget!.querySelectorAll("dd")].map((node) => node.textContent)).toEqual(["Nota", "a, b"]);
    expect(view.contentDOM.textContent).not.toContain("title: Nota");
    view.destroy();
  });

  it("nascoste sono una riga sola col conto", () => {
    const view = mount("hidden", doc.length);
    expect(view.dom.querySelector(".cm-fub-properties-hidden")?.textContent).toContain("2");
    view.destroy();
  });

  it("YAML, o col cursore dentro, resta il testo", () => {
    const source = mount("source", doc.length);
    expect(source.dom.querySelector(".cm-fub-properties")).toBeNull();
    source.destroy();
    const inside = mount("visible", 6);
    expect(inside.dom.querySelector(".cm-fub-properties")).toBeNull();
    expect(inside.contentDOM.textContent).toContain("title: Nota");
    inside.destroy();
  });

  it("un click su una riga apre lo YAML su quella proprietà", () => {
    const view = mount("visible", doc.length);
    const row = view.dom.querySelectorAll<HTMLElement>(".cm-fub-properties-row")[1]!;
    row.querySelector("dd")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("tags: [a, b]");
    expect(view.dom.querySelector(".cm-fub-properties")).toBeNull();
    view.destroy();
  });

  it("la chiusura non si attacca alla voce: l'a capo prima di `---` resta", () => {
    const view = mount("visible", doc.length);
    const closing = doc.indexOf("---", 4);
    // Canc in fondo alla voce, o un incolla che finisce sulla chiusura da metà riga.
    view.dispatch({ changes: { from: closing - 1, to: closing }, userEvent: "delete.forward" });
    view.dispatch({ changes: { from: closing - 3, to: closing, insert: "c]" }, userEvent: "input.paste" });
    expect(view.state.doc.toString()).toBe(doc);
    // Da un inizio di riga fino alla chiusura sì: la riga se ne va intera.
    const line = doc.indexOf("tags:");
    view.dispatch({ changes: { from: line, to: closing, insert: "tags: [c]\n" }, userEvent: "input.paste" });
    expect(view.state.doc.toString()).toBe("---\ntitle: Nota\ntags: [c]\n---\nTesto");
    view.destroy();
  });

  it("ciò che si scrive prima del widget scende sotto il frontmatter", () => {
    const view = mount("visible", 0);
    expect(view.dom.querySelector(".cm-fub-properties")).not.toBeNull();
    view.dispatch({ changes: { from: 0, insert: "Ciao" }, selection: { anchor: 4 }, userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe("---\ntitle: Nota\ntags: [a, b]\n---\nCiaoTesto");
    expect(view.state.selection.main.head).toBe(doc.indexOf("Testo") + 4);
    view.dispatch({ changes: { from: 0, to: 1 }, userEvent: "delete.forward" });
    expect(view.state.doc.toString().startsWith("---\n")).toBe(true);
    view.destroy();
  });
});
