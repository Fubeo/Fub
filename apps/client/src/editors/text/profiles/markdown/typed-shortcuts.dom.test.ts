// @vitest-environment happy-dom
// Le scorciatoie Markdown scritte a mano, carattere per carattere come la
// tastiera, nella superficie vera coi Blocchi spenti (la Live) e accesi: il
// testo che ne esce è il Markdown che si è scritto (IMP-611, IMP-419,
// IMP-718, IMP-719, IMP-620).
import { afterEach, describe, expect, it, vi } from "vitest";
import { completionStatus } from "@codemirror/autocomplete";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import type { SettingEntry } from "../../../../host/contract";
import { settings } from "../../../../host/query";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";

vi.mock("../../../../host/query", () => ({ settings: vi.fn() }));

function toggle(key: string, value: boolean): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "Editor", scope: "machine", kind: { kind: "toggle", default: true }, program_writable: false },
    value,
    source: "machine",
  };
}

const mounted: { ed: MarkdownSurface; parent: HTMLElement }[] = [];
afterEach(() => {
  for (const note of mounted.splice(0)) {
    note.ed.destroy();
    note.parent.remove();
  }
  vi.mocked(settings).mockReset();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function note(doc: string, blocks: boolean): Promise<EditorView> {
  vi.mocked(settings).mockResolvedValue([toggle("editor.blocks", blocks), toggle("editor.vim", false)]);
  const parent = document.createElement("div");
  document.body.append(parent);
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "Nota.md", parent }, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  mounted.push({ ed, parent });
  ed.buffer.setDoc(doc);
  await settle();
  await settle();
  const view = EditorView.findFromDOM(parent)!;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return view;
}

/// Scrive come la tastiera, un carattere alla volta: prima i tasti della
/// mappa (Invio, Tab), poi le regole d'ingresso, poi il testo. Dopo ogni
/// battuta fa ciò che il browser fa e happy-dom no: un cursore caduto dentro un
/// widget atomico non può stare nel DOM, e CodeMirror lo rilegge alla fine del
/// widget (IMP-6108).
async function type(view: EditorView, text: string): Promise<void> {
  for (const ch of text) {
    const key = ch === "\n" ? "Enter" : ch;
    if (!runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor")) {
      const { from, to } = view.state.selection.main;
      const insert = () => view.state.update(view.state.replaceSelection(ch), { userEvent: "input.type", scrollIntoView: true });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, ch, insert))) view.dispatch(insert());
    }
    await settle();
    const out = outOfWidget(view);
    if (out !== null) view.dispatch({ selection: { anchor: out }, userEvent: "select" });
  }
}

/// La fine del widget atomico che copre il cursore, se lo copre davvero (il
/// cursore sta dentro, non su un suo bordo).
function outOfWidget(view: EditorView): number | null {
  const head = view.state.selection.main.head;
  for (const ranges of view.state.facet(EditorView.atomicRanges)) {
    let end: number | null = null;
    ranges(view).between(head, head, (from, to) => {
      if (from < head && head < to) end = to;
    });
    if (end !== null) return end;
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/// La pausa di chi scrive e guarda: il completamento che la riga apre si
/// mostra e resta in vista oltre l'`interactionDelay` di CodeMirror, dopo il
/// quale Invio lo sceglie invece di andare a capo.
async function pause(view: EditorView): Promise<void> {
  for (let waited = 0; waited < 1000 && completionStatus(view.state) !== "active"; waited += 20) await sleep(20);
  await sleep(200);
}

const START = "Testo.\n\n";

const CASES: readonly { name: string; typed: string; saved: string }[] = [
  { name: "il grassetto scritto coi suoi asterischi (IMP-611)", typed: "Paragrafo normale: **grassetto** qui.", saved: "Paragrafo normale: **grassetto** qui." },
  { name: "il corsivo e il grassetto insieme", typed: "Un *corsivo* e un **forte**.", saved: "Un *corsivo* e un **forte**." },
  { name: "le voci da fare scritte riga dopo riga (IMP-419, IMP-718)", typed: "- [ ] attività di prova\n- [ ] seconda", saved: "- [ ] attività di prova\n- [ ] seconda" },
  { name: "un elenco che cambia tipo a ogni riga (IMP-718)", typed: "- voce\n- [x] fatta\n1. uno", saved: "- voce\n- [x] fatta\n1. uno" },
  { name: "la formula a blocco scritta coi dollari (IMP-719)", typed: "$$x^2 + y^2 = r^2$$\nDopo la formula.", saved: "$$x^2 + y^2 = r^2$$\nDopo la formula." },
  { name: "il richiamo «[!tip]» scritto a mano (IMP-6108)", typed: "> [!tip] Consiglio di prova\ntesto", saved: "> [!tip] Consiglio di prova\n> testo" },
  { name: "il richiamo «[!note]» scritto a mano (IMP-6108)", typed: "> [!note] Titolo del richiamo", saved: "> [!note] Titolo del richiamo" },
  { name: "il blocco mermaid scritto a mano e chiuso a mano (IMP-6107)", typed: "```mermaid\nflowchart TD\nA -->\n```\nDopo.", saved: "```mermaid\nflowchart TD\nA -->\n```\nDopo." },
  { name: "la frazione a blocco scritta in LaTeX (IMP-420)", typed: "$$r = \\frac{\\ln L_t}{t}$$\nFine.", saved: "$$r = \\frac{\\ln L_t}{t}$$\nFine." },
];

for (const blocks of [false, true]) {
  describe(blocks ? "coi Blocchi" : "nella Live", () => {
    for (const { name, typed, saved } of CASES) {
      it(name, async () => {
        const view = await note(START, blocks);
        await type(view, typed);
        expect(view.state.doc.toString()).toBe(START + saved);
      });
    }

    it("Invio dopo «```mermaid» col menu dei linguaggi aperto va a capo nel recinto (IMP-6107)", async () => {
      const view = await note(START, blocks);
      await type(view, "```mermaid");
      await pause(view);
      expect(completionStatus(view.state)).toBe("active");
      await type(view, "\nflowchart TD\nA -->\n```\nDopo.");
      expect(view.state.doc.toString()).toBe(`${START}\`\`\`mermaid\nflowchart TD\nA -->\n\`\`\`\nDopo.`);
    });

    it("il recinto vuoto chiuso a mano dopo il menu dei linguaggi resta uno (IMP-6107)", async () => {
      const view = await note(START, blocks);
      await type(view, "```mermaid");
      await pause(view);
      await type(view, "\n```\nDopo.");
      expect(view.state.doc.toString()).toBe(`${START}\`\`\`mermaid\n\`\`\`\nDopo.`);
    });

    it("la chiusura scritta a mano a metà del codice resta dov'è: la chiusura vecchia non è la riga dopo", async () => {
      const view = await note(`${START}\`\`\`js\n\nuno\n\`\`\``, blocks);
      view.dispatch({ selection: { anchor: START.length + "```js\n".length } });
      await type(view, "```");
      expect(view.state.doc.toString()).toBe(`${START}\`\`\`js\n\`\`\`\nuno\n\`\`\``);
    });

    it("Invio nel sommario di un ripiegabile va al contenuto (IMP-620)", async () => {
      const skeleton = "<details>\n<summary></summary>\n\n\n\n</details>";
      const view = await note(`${START}${skeleton}`, blocks);
      view.dispatch({ selection: { anchor: START.length + "<details>\n<summary>".length } });
      await type(view, "Quando il sugo si asciuga\nAggiungi acqua.");
      expect(view.state.doc.toString()).toBe(`${START}<details>\n<summary>Quando il sugo si asciuga</summary>\n\nAggiungi acqua.\n\n</details>`);
    });

    it("la tabella appena scritta col cursore dentro prende il fuoco sulla sua cella (IMP-612)", async () => {
      const view = await note(START, blocks);
      const table = "| Colonna 1 | Colonna 2 |\n| --- | --- |\n|  |  |";
      const at = view.state.doc.length;
      // Come la barra e il «/»: la tabella e la prima intestazione scelta, in
      // una transazione sola, prima che la griglia sia disegnata.
      view.dispatch({ changes: { from: at, insert: table }, selection: { anchor: at + 2, head: at + 11 }, userEvent: "input" });
      await settle();
      await settle();
      expect(document.activeElement?.closest(".tb-frame")).not.toBeNull();
    });
  });
}
