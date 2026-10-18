// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { PLACEHOLDER, ProofClient, type ProofPorts } from "../../../core/proof";
import { createMarkdownProfile } from "./profile";
import { markdownGrammar } from "./grammar";
import { extractProse, frontmatterLanguage, locate, markdownProof, proofTheme } from "./proof";

function state(doc: string): EditorState {
  const created = EditorState.create({ doc, extensions: markdown({ base: markdownGrammar }) });
  ensureSyntaxTree(created, created.doc.length, 5000);
  return created;
}

function prose(doc: string): string[] {
  const s = state(doc);
  return extractProse(s, [{ from: 0, to: s.doc.length }]).map((segment) => segment.text);
}

describe("extractProse", () => {
  it("tiene la prosa di titoli, paragrafi, voci, caselle, citazioni e celle", () => {
    expect(prose([
      "# Il titolo",
      "",
      "Un paragrafo",
      "su due righe.",
      "",
      "- una voce",
      "- [ ] una casella",
      "",
      "> una citazione",
      "> che continua",
      "",
      "| uno | due |",
      "|---|---|",
      "| tre | quattro |",
    ].join("\n"))).toEqual([
      "Il titolo",
      "Un paragrafo\nsu due righe.",
      "una voce",
      "una casella",
      "una citazione\nche continua",
      "uno", "due", "tre", "quattro",
    ]);
  });

  it("toglie il markup e lascia intera la parola che racchiude", () => {
    expect(prose("Una **parola** in _corsivo_, ~~barrata~~ e ==evidenziata==.")).toEqual([
      "Una parola in corsivo, barrata e evidenziata.",
    ]);
    expect(prose("Un [link](https://esempio.it \"titolo\") qui.")).toEqual(["Un link qui."]);
  });

  it("mette un segnaposto dove non c'è prosa", () => {
    const o = PLACEHOLDER;
    expect(prose("Vedi [[Nota|alias]], #tag, `codice`, $x^2$, <b>html</b> e https://fub.app ora.")).toEqual([
      `Vedi ${o}, ${o}, ${o}, ${o}, ${o}html${o} e ${o} ora.`,
    ]);
    expect(prose("Una nota[^1] e un commento %%nascosto%% qui. ^blocco")).toEqual([
      `Una nota${o} e un commento ${o} qui.`,
    ]);
  });

  it("non legge codice, frontmatter e definizioni di riferimento", () => {
    expect(prose([
      "---",
      "title: speling",
      "lang: it",
      "---",
      "",
      "```js",
      "const speling = 1;",
      "```",
      "",
      "    codice rientrato",
      "",
      "[ref]: https://esempio.it",
      "",
      "Solo questo.",
    ].join("\n"))).toEqual(["Solo questo."]);
  });

  it("legge il testo di una nota a piè di pagina, non la sua etichetta", () => {
    expect(prose("Testo[^a].\n\n[^a]: La nota vera.")).toEqual([`Testo${PLACEHOLDER}.`, "La nota vera."]);
  });

  it("scrive il carattere di un escape senza la barra", () => {
    expect(prose("Un \\*asterisco\\* letterale.")).toEqual(["Un *asterisco* letterale."]);
  });
});

describe("locate", () => {
  const doc = "Una **parola** sbagliata 😀 qui";
  const s = state(doc);
  const [segment] = extractProse(s, [{ from: 0, to: doc.length }]);

  it("riporta esatto ciò che sta dentro un tratto copiato", () => {
    const start = segment.text.indexOf("sbagliata");
    const where = locate(segment, start, start + "sbagliata".length)!;
    expect(where.exact).toBe(true);
    expect(doc.slice(where.from, where.to)).toBe("sbagliata");
    const after = segment.text.indexOf("qui");
    expect(doc.slice(locate(segment, after, after + 3)!.from, locate(segment, after, after + 3)!.to)).toBe("qui");
  });

  it("mostra ma non rende correggibile ciò che attraversa il markup", () => {
    const start = segment.text.indexOf("Una");
    const where = locate(segment, start, segment.text.indexOf("parola") + 6)!;
    expect(where.exact).toBe(false);
    expect(doc.slice(where.from, where.to)).toBe("Una **parola");
  });

  it("non riporta un intervallo vuoto o fuori dal segmento", () => {
    expect(locate(segment, 3, 3)).toBeNull();
    expect(locate(segment, 0, segment.text.length + 5)).toBeNull();
  });
});

describe("frontmatterLanguage", () => {
  it("legge `lang` dal frontmatter", () => {
    expect(frontmatterLanguage(state("---\nlang: en-GB\n---\nTesto"))).toBe("en-GB");
    expect(frontmatterLanguage(state("---\ntitle: x\n---\nTesto"))).toBeNull();
    expect(frontmatterLanguage(state("lang: en\n"))).toBeNull();
  });
});

/// Un host che segna «speling» con il suggerimento «spelling».
function ports(overrides: Partial<ProofPorts> = {}): ProofPorts {
  const encoder = new TextEncoder();
  return {
    queryIndex: async (query) => {
      if (query.kind !== "custom") throw new Error("query inattesa");
      const q = query.query as { segments: string[]; language: string };
      return {
        kind: "custom",
        value: {
          language: { code: q.language, spelling: true, grammar: true, missing_dictionary: null },
          segments: q.segments.map((segment) => {
            const out = [];
            for (let at = segment.indexOf("speling"); at >= 0; at = segment.indexOf("speling", at + 1)) {
              const start = encoder.encode(segment.slice(0, at)).length;
              out.push({ start, end: start + 7, kind: "spelling", message: "Parola sconosciuta", suggestions: ["spelling"] });
            }
            return out;
          }),
        },
      };
    },
    invokeCommand: vi.fn(async () => ({ notify: "aggiunta" })),
    settings: async () => [{
      spec: { key: "proof.language", label: "", description: "", group: "", scope: "vault" },
      value: "auto",
      source: "default",
    }] as never,
    interfaceLanguage: () => "it",
    watch: () => () => {},
    ...overrides,
  };
}

function mount(text: string, client: ProofClient) {
  vi.useFakeTimers();
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const changes = vi.fn();
  const profile = createMarkdownProfile({
    callbacks: { openWikilink: () => {}, searchTag: () => {}, mountRendered: () => () => {} } as never,
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  profile.setProof([markdownProof({ client }), proofTheme]);
  const engine = createTextEngine(parent, {
    onChange: changes,
    onSelectionChange: () => {},
    extensions: () => profile.extensions(),
  });
  engine.setDoc(text);
  const view = EditorView.findFromDOM(parent)!;
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  return { engine, view, changes, parent };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await vi.advanceTimersByTimeAsync(500);
  }
}

function diagnostics(view: EditorView): Diagnostic[] {
  const out: Diagnostic[] = [];
  forEachDiagnostic(view.state, (diagnostic, from, to) => out.push({ ...diagnostic, from, to }));
  return out;
}

describe("markdownProof", () => {
  it("segna una parola e la corregge come una battuta annullabile", async () => {
    const client = new ProofClient(ports());
    const { engine, view, changes } = mount("Un **testo** con 😀 speling qui.", client);
    await settle();
    const [found] = diagnostics(view);
    expect(view.state.sliceDoc(found.from, found.to)).toBe("speling");
    expect(found.actions?.map((action) => action.name)).toEqual(["spelling", "Aggiungi al dizionario", "Ignora"]);

    changes.mockClear();
    found.actions![0].apply(view, found.from, found.to);
    expect(engine.getDoc()).toBe("Un **testo** con 😀 spelling qui.");
    expect(changes).toHaveBeenCalledTimes(1);
    undo(view);
    expect(engine.getDoc()).toBe("Un **testo** con 😀 speling qui.");
    engine.destroy();
    client.dispose();
    vi.useRealTimers();
  });

  it("non sostituisce un testo cambiato sotto un'azione rimasta aperta", async () => {
    const client = new ProofClient(ports());
    const { engine, view } = mount("Uno speling.", client);
    await settle();
    const [found] = diagnostics(view);
    view.dispatch({ changes: { from: found.from, to: found.to, insert: "spelinx" } });
    found.actions![0].apply(view, found.from, found.to);
    expect(engine.getDoc()).toBe("Uno spelinx.");
    engine.destroy();
    client.dispose();
    vi.useRealTimers();
  });

  it("aggiunge al dizionario con il comando e toglie subito il segno", async () => {
    const p = ports();
    const client = new ProofClient(p);
    const { engine, view } = mount("Uno speling e un altro speling.", client);
    await settle();
    expect(diagnostics(view)).toHaveLength(2);
    const [found] = diagnostics(view);
    found.actions!.find((action) => action.name === "Aggiungi al dizionario")!.apply(view, found.from, found.to);
    await settle();
    expect(p.invokeCommand).toHaveBeenCalledWith("proof.word.add", { word: "speling" });
    expect(diagnostics(view)).toHaveLength(0);
    engine.destroy();
    client.dispose();
    vi.useRealTimers();
  });

  it("non offre correzioni in sola lettura", async () => {
    const client = new ProofClient(ports());
    const { engine, view } = mount("Uno speling.", client);
    engine.setReadOnly(true);
    await settle();
    const [found] = diagnostics(view);
    expect(found.actions?.map((action) => action.name)).toEqual(["Aggiungi al dizionario", "Ignora"]);
    engine.destroy();
    client.dispose();
    vi.useRealTimers();
  });

  it("senza la feature non segna niente e l'editor scrive come prima", async () => {
    const client = new ProofClient(ports({
      queryIndex: async () => {
        throw { kind: "unserved", message: "namespace non montato" };
      },
    }));
    const { engine, view, changes } = mount("Uno speling.", client);
    await settle();
    expect(diagnostics(view)).toHaveLength(0);
    view.dispatch({ changes: { from: 0, insert: "Ancora " }, userEvent: "input" });
    expect(engine.getDoc()).toBe("Ancora Uno speling.");
    expect(changes).toHaveBeenCalled();
    engine.destroy();
    client.dispose();
    vi.useRealTimers();
  });

  it("smette di chiedere quando la superficie è distrutta", async () => {
    const queryIndex = vi.fn(ports().queryIndex);
    const client = new ProofClient(ports({ queryIndex }));
    const { engine } = mount("Uno speling.", client);
    engine.destroy();
    await settle();
    expect(queryIndex).not.toHaveBeenCalled();
    client.dispose();
    vi.useRealTimers();
  });
});
