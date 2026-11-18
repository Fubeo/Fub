// I gruppi del blocco nella barra di formato (T11): quale blocco c'è sotto il
// cursore, e che cosa fanno i gesti di ciascuno sul testo.
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { SurfaceBlockGroup } from "../../../core/registry";
import type { SurfaceMenuEntry, SurfaceMenuItem } from "../../../core/editor-menu";
import { blockAt, markdownBlockGroup, selectionBlock, toggleCalloutFoldable, type BlockGroupHost } from "./block-groups";

const stateOf = (doc: string, anchor = 0, head = anchor): EditorState => {
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
};

/// Una superficie finta: tiene lo stato, applica le modifiche, ricorda copie e
/// link aperti.
function hostOf(doc: string, at: number, { editable = true } = {}) {
  let state = stateOf(doc, at);
  const copied: string[] = [];
  const opened: [string, string | null, string | null][] = [];
  const host: BlockGroupHost = {
    read: (read) => read(state),
    write: (change) => {
      if (!editable) return false;
      const spec: TransactionSpec | null = change(state);
      if (!spec) return false;
      state = state.update(spec).state;
      ensureSyntaxTree(state, state.doc.length, 1000);
      return true;
    },
    view: () => false,
    editable: () => editable,
    copy: (text) => copied.push(text),
    openLink: (page, heading, block) => opened.push([page, heading, block]),
  };
  return { host, copied, opened, text: () => state.doc.toString() };
}

const item = (group: SurfaceBlockGroup | null, id: string): SurfaceMenuItem => {
  const found = group?.items.find((entry): entry is SurfaceMenuItem => typeof entry !== "string" && entry.id === id);
  if (!found) throw new Error(`nessuna voce ${id}`);
  return found;
};
const ids = (group: SurfaceBlockGroup | null): string[] =>
  (group?.items ?? []).map((entry: SurfaceMenuEntry) => (typeof entry === "string" ? entry : entry.id));

describe("il blocco sotto il cursore", () => {
  it("fra due blocchi, su un titolo o in un paragrafo non c'è un gruppo", () => {
    const doc = "- [ ] uno\n\n```js\nx\n```\n## Titolo\ntesto\n";
    expect(blockAt(stateOf(doc), doc.indexOf("\n\n") + 1)).toBeNull();
    expect(blockAt(stateOf(doc), doc.indexOf("Titolo"))).toBeNull();
    expect(blockAt(stateOf(doc), doc.indexOf("testo"))).toBeNull();
    expect(blockAt(stateOf(doc), 3)?.kind).toBe("task");
    expect(blockAt(stateOf(doc), doc.indexOf("x\n"))?.kind).toBe("code");
  });

  it("una selezione su più blocchi non ha gruppo; dentro un blocco sì", () => {
    const doc = "- [ ] uno\n- [ ] due\n\n> [!tip] Testa\n> corpo\n";
    expect(selectionBlock(stateOf(doc, 2, doc.indexOf("corpo")))).toBeNull();
    const head = doc.indexOf("Testa");
    expect(selectionBlock(stateOf(doc, head, doc.indexOf("corpo") + 2))?.kind).toBe("callout");
    const multi = EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(12)]), extensions: [markdown(), EditorState.allowMultipleSelections.of(true)] });
    expect(selectionBlock(multi)).toBeNull();
  });
});

describe("i gruppi", () => {
  it("Compito: «Scadenza» porta il cursore in fondo al compito e apre la @ della data", () => {
    const doc = "- [ ] comprare il pane\naltro\n";
    const { host, text } = hostOf(doc, 4);
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("task");
    expect(group?.label).toBe("Compito");
    const due = item(group, "markdown.date");
    expect(due.label).toBe("Scadenza");
    expect(due.action).toBe("markdown.date");
    due.run?.();
    expect(host.read((state) => state.selection.main.head)).toBe(doc.indexOf("\n"));
    expect(text()).toBe(doc);
  });

  it("Compito: «Promemoria» porta il cursore in fondo al compito e apre la scelta del giorno e dell'ora", () => {
    const doc = "- [ ] comprare il pane\naltro\n";
    const { host, text } = hostOf(doc, 4);
    const group = markdownBlockGroup(host, null);
    expect(ids(group)).toEqual(["markdown.date", "markdown.reminder"]);
    const reminder = item(group, "markdown.reminder");
    expect(reminder.label).toBe("Promemoria");
    expect(reminder.icon).toBe("fmt-alarm");
    expect(reminder.action).toBe("markdown.reminder");
    reminder.run?.();
    expect(host.read((state) => state.selection.main.head)).toBe(doc.indexOf("\n"));
    expect(text()).toBe(doc);
  });

  it("Riquadro: il tipo si sceglie fra quelli noti, e «Ripiegabile» scrive e toglie il segno", () => {
    const doc = "> [!tip] Il punto\n> corpo\n";
    const { host, text } = hostOf(doc, doc.indexOf("corpo"));
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("callout");
    expect(ids(group)).toEqual(["markdown.callout.type", "markdown.callout.fold"]);
    const type = item(group, "markdown.callout.type");
    const warning = type.items!.find((entry): entry is SurfaceMenuItem => typeof entry !== "string" && entry.id === "markdown.callout.type.warning")!;
    expect(type.items!.some((entry) => typeof entry !== "string" && entry.checked === true && entry.id === "markdown.callout.type.tip")).toBe(true);
    warning.run?.();
    expect(text()).toBe("> [!warning] Il punto\n> corpo\n");
    const fold = item(markdownBlockGroup(host, null), "markdown.callout.fold");
    expect(fold.checked).toBe(false);
    fold.run?.();
    expect(text()).toBe("> [!warning]+ Il punto\n> corpo\n");
    expect(item(markdownBlockGroup(host, null), "markdown.callout.fold").checked).toBe(true);
    item(markdownBlockGroup(host, null), "markdown.callout.fold").run?.();
    expect(text()).toBe("> [!warning] Il punto\n> corpo\n");
  });

  it("la ripiegatura chiusa (`-`) si toglie come quella aperta", () => {
    const state = stateOf("> [!note]- Chiuso\n");
    const spec = toggleCalloutFoldable(state, 0)!;
    expect(state.update(spec).state.doc.toString()).toBe("> [!note] Chiuso\n");
  });

  it("Base: «A tutta pagina» apre la base", () => {
    const { host, opened } = hostOf("![[Opere.base]]\n", 3);
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("base");
    item(group, "markdown.link.open").run?.();
    expect(opened).toEqual([["Opere.base", null, null]]);
  });

  it("Trasclusione: «Apri l'origine» porta alla nota, al blocco", () => {
    const { host, opened } = hostOf("![[Riunioni/2026-11-04#^decisioni]]\n", 3);
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("transclusion");
    // Il blocco di un'altra nota è il blocco sincronizzato (T30).
    expect(group?.label).toBe("Blocco sincronizzato");
    item(group, "markdown.link.open").run?.();
    expect(opened).toEqual([["Riunioni/2026-11-04", null, "decisioni"]]);
    // Un PDF incorporato non è una trasclusione: è una scheda viva (T41).
    expect(markdownBlockGroup(hostOf("![[Atto.pdf]]\n", 3).host, null)?.id).toBe("card");
    // Un'immagine non è né l'una né l'altra.
    expect(markdownBlockGroup(hostOf("![[foto.png]]\n", 3).host, null)?.id).not.toBe("card");
  });

  it("Scheda: «Apri» alla parte, «Togli dalla nota» toglie l'embed e non il file", () => {
    const { host, opened, text } = hostOf("Prima\n\n![[Conti.xlsx#Budget]]\n\nDopo\n", 8);
    const group = markdownBlockGroup(host, null);
    expect(group?.label).toBe("Scheda");
    expect(ids(group)).toEqual(["markdown.link.open", "markdown.card.remove"]);
    item(group, "markdown.link.open").run?.();
    expect(opened).toEqual([["Conti.xlsx", "Budget", null]]);
    item(group, "markdown.card.remove").run?.();
    expect(text()).toBe("Prima\n\nDopo\n");
  });

  it("Trasclusione: «Modifica qui» c'è per una sezione o un blocco, dove si scrive", () => {
    const edited: number[] = [];
    const withEdit = (doc: string, editable = true) => {
      const made = hostOf(doc, 3, { editable });
      made.host.editHere = (start) => {
        edited.push(start);
        return true;
      };
      return made.host;
    };
    const group = markdownBlockGroup(withEdit("testo\n\n![[Riunioni/2026-11-04#^decisioni]]\n"), "testo\n\n".length + 2);
    expect(ids(group)).toEqual(["markdown.link.open", "markdown.transclusion.edit"]);
    // Il blocco è un blocco sincronizzato (T30): si scrive dove sta.
    expect(group?.label).toBe("Blocco sincronizzato");
    expect(item(group, "markdown.transclusion.edit").label).toBe("Scrivi qui");
    item(group, "markdown.transclusion.edit").run?.();
    expect(edited).toEqual(["testo\n\n".length]);
    const section = markdownBlockGroup(withEdit("![[Diario#Riunione]]\n"), null);
    expect(section?.label).toBe("Trasclusione");
    expect(item(section, "markdown.transclusion.edit").label).toBe("Modifica qui");
    // La nota intera si apre e basta; in sola lettura non si scrive niente.
    expect(ids(markdownBlockGroup(withEdit("![[Diario]]\n"), null))).toEqual(["markdown.link.open"]);
    expect(ids(markdownBlockGroup(withEdit("![[Diario#^a1]]\n", false), null))).toEqual(["markdown.link.open"]);
    // Senza la trasclusione viva della superficie la voce non c'è.
    expect(ids(markdownBlockGroup(hostOf("![[Diario#^a1]]\n", 3).host, null))).toEqual(["markdown.link.open"]);
  });

  it("Tabella: riga, colonna e ordina sono le azioni della tabella", () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const { host } = hostOf(doc, doc.indexOf("1"));
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("table");
    expect(item(group, "markdown.table.row.after").action).toBe("markdown.table.row.after");
    expect(item(group, "markdown.table.column.after").action).toBe("markdown.table.column.after");
    const sort = item(group, "markdown.table.sort");
    expect(sort.items!.map((entry) => (typeof entry === "string" ? entry : entry.action))).toEqual([
      "markdown.table.sort.ascending",
      "markdown.table.sort.descending",
    ]);
    // Tutte le righe della tabella sono lo stesso blocco.
    expect(blockAt(host.read((s) => s), 1)?.start).toBe(blockAt(host.read((s) => s), doc.indexOf("2"))?.start);
  });

  it("Codice: il linguaggio si riscrive dopo il recinto, e «Copia» copia il contenuto", () => {
    const doc = "```python\nprint(1)\n```\n";
    const { host, copied, text } = hostOf(doc, doc.indexOf("print"));
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("code");
    const language = item(group, "markdown.code.language");
    expect(language.label).toBe("Python");
    const rust = language.items!.find((entry): entry is SurfaceMenuItem => typeof entry !== "string" && entry.id === "markdown.code.language.rust")!;
    rust.run?.();
    expect(text()).toBe("```rust\nprint(1)\n```\n");
    item(markdownBlockGroup(host, null), "markdown.code.copy").run?.();
    expect(copied).toEqual(["print(1)"]);
  });

  it("Immagine: larghezza e testo alternativo, misurati soltanto quando il menu si apre", async () => {
    const { host } = hostOf("![Gatto](gatto.png)\n", 3);
    const group = markdownBlockGroup(host, null);
    expect(group?.id).toBe("image");
    expect(ids(group)).toEqual(["markdown.image.width", "markdown.image.replace"]);
    const width = item(group, "markdown.image.width");
    expect(width.items).toBeUndefined();
    const choices = await width.load!();
    expect(choices.length).toBeGreaterThan(0);
  });

  it("in sola lettura restano soltanto i gesti che non scrivono", () => {
    expect(markdownBlockGroup(hostOf("- [ ] uno\n", 3, { editable: false }).host, null)).toBeNull();
    expect(markdownBlockGroup(hostOf("> [!tip] x\n", 3, { editable: false }).host, null)).toBeNull();
    expect(markdownBlockGroup(hostOf("![Gatto](gatto.png)\n", 3, { editable: false }).host, null)).toBeNull();
    const code = markdownBlockGroup(hostOf("```js\nx\n```\n", 7, { editable: false }).host, null);
    expect(ids(code)).toEqual(["markdown.code.copy"]);
    expect(ids(markdownBlockGroup(hostOf("![[Opere.base]]\n", 3, { editable: false }).host, null))).toEqual(["markdown.link.open"]);
  });

  it("un punto dato (il tasto destro) sceglie il blocco lì, non quello del cursore", () => {
    const doc = "- [ ] uno\n\n```js\nx\n```\n";
    const { host } = hostOf(doc, 3);
    expect(markdownBlockGroup(host, doc.indexOf("x\n"))?.id).toBe("code");
  });
});
