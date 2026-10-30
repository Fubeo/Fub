import { describe, expect, it } from "vitest";
import { COLOR_ENTRY, SLASH_RECENT, SLASH_RESULTS, slashMenuEntries } from "./entries";
import { ALL, SPECS, spec } from "./fixture.test-data";

const OTHERS = [
  spec("markdown.bold", "Grassetto", ["toolbar"]),
  spec("note.daily", "Nota del giorno", ["slash"]),
];
const LIST = [...SPECS, ...OTHERS];
const today = new Date(2026, 9, 29);
const use = (recent: string[] = [], favorites: string[] = []) => ({ recent, favorites, chord: () => null, today });

describe("le voci del «/» nel testo", () => {
  it("a menu aperto: le linguette nell'ordine, solo ciò che è offerto al «/» e che la superficie sa fare", () => {
    const { entries, sections, filtering } = slashMenuEntries(LIST, "", ALL);
    expect(filtering).toBe(false);
    expect(sections).toEqual(["suggested", "text", "lists", "blocks", "code", "media", "people", "style", "page", "vault"]);
    expect(entries.some((entry) => entry.id === "markdown.bold")).toBe(false);
    expect(entries.find((entry) => entry.id === "note.daily")).toMatchObject({ section: "vault", action: false });
    expect(entries.find((entry) => entry.id === "markdown.heading.2" && entry.section !== "suggested")).toMatchObject({ hint: "##", icon: "fmt-h2", section: "text" });
    expect(entries.find((entry) => entry.id === "markdown.table")).toMatchObject({ picker: "table", icon: "fmt-table", section: "blocks" });
  });

  it("i colori sono una voce sola, «Colore ›», che apre la tavolozza", () => {
    const { entries } = slashMenuEntries(LIST, "", ALL);
    expect(entries.filter((entry) => entry.id.startsWith("markdown.color."))).toEqual([]);
    expect(entries.find((entry) => entry.id === COLOR_ENTRY)).toMatchObject({ picker: "color", section: "style", icon: "fmt-color" });
  });

  it("scrivendo, i colori si trovano lo stesso", () => {
    const ids = slashMenuEntries(LIST, "blu", ALL).entries.map((entry) => entry.id);
    expect(ids.slice(0, 2)).toEqual(["markdown.color.blue", "markdown.background.blue"]);
    expect(slashMenuEntries(LIST, "fondo giallo", ALL).entries[0]!.id).toBe("markdown.background.yellow");
  });

  it("i Suggeriti guardano il blocco sopra", () => {
    const afterHeading = slashMenuEntries(LIST, "", ALL, { line: "empty", above: "heading", inList: false }).entries;
    expect(afterHeading.filter((entry) => entry.section === "suggested").map((entry) => entry.id))
      .toEqual(["markdown.paragraph", "markdown.list.task", "markdown.list.bullet"]);
    const afterTask = slashMenuEntries(LIST, "", ALL, { line: "empty", above: "task", inList: true }).entries;
    expect(afterTask[0]!.id).toBe("markdown.list.task");
  });

  it("preferiti e recenti in cima, i recenti al più cinque, e niente ripetuto fra loro", () => {
    const { entries, sections } = slashMenuEntries(LIST, "", ALL, undefined, use(["note.daily", "markdown.table", "sparito", "markdown.rule"], ["markdown.rule"]));
    expect(sections.slice(0, 3)).toEqual(["suggested", "favorites", "recent"]);
    expect(entries.filter((entry) => entry.section === "favorites").map((entry) => entry.id)).toEqual(["markdown.rule"]);
    expect(entries.filter((entry) => entry.section === "recent").map((entry) => entry.id)).toEqual(["note.daily", "markdown.table"]);
    expect(SLASH_RECENT).toBe(5);
  });

  it("filtrando: un elenco solo, al più dodici, con la parte trovata e in inglese", () => {
    const { entries, filtering } = slashMenuEntries(LIST, "tab", ALL);
    expect(filtering).toBe(true);
    expect(entries[0]).toMatchObject({ id: "markdown.table", span: [0, 3] });
    expect(slashMenuEntries(LIST, "table", ALL).entries[0]!.id).toBe("markdown.table");
    expect(slashMenuEntries(LIST, "todo", ALL).entries[0]!.id).toBe("markdown.list.task");
    expect(slashMenuEntries(LIST, "e", ALL).entries.length).toBeLessThanOrEqual(SLASH_RESULTS);
    expect(slashMenuEntries(LIST, "qwerty", ALL).entries).toEqual([]);
  });

  it("un errore di battitura da quattro lettere: «/tabela» è Tabella, «forse»", () => {
    expect(slashMenuEntries(LIST, "tabela", ALL).entries[0]).toMatchObject({ id: "markdown.table", why: "forse" });
  });

  it("i comandi rapidi vanno in cima, coi loro argomenti", () => {
    const [first] = slashMenuEntries(LIST, "tab 3x4", ALL, undefined, use()).entries;
    expect(first).toMatchObject({ id: "markdown.table", quick: true, params: { rows: 3, cols: 4 }, picker: null });
    expect(slashMenuEntries(LIST, "venerdì", ALL, undefined, use()).entries[0]).toMatchObject({ id: "markdown.date", params: { date: "2026-10-30" } });
  });

  it("un comando rapido che la superficie non sa fare non c'è", () => {
    const entries = slashMenuEntries(LIST, "tab 3x4", (id) => id !== "markdown.table", undefined, use()).entries;
    expect(entries.some((entry) => entry.quick)).toBe(false);
  });

  it("le voci nascoste non ci sono, né aperto né scrivendo né come comando rapido", () => {
    const hiding = { ...use(), hidden: ["markdown.table", "markdown.color.red"] };
    expect(slashMenuEntries(LIST, "", ALL, undefined, hiding).entries.some((entry) => entry.id === "markdown.table")).toBe(false);
    expect(slashMenuEntries(LIST, "tab", ALL, undefined, hiding).entries.some((entry) => entry.id === "markdown.table")).toBe(false);
    expect(slashMenuEntries(LIST, "tab 3x4", ALL, undefined, hiding).entries.some((entry) => entry.quick)).toBe(false);
    expect(slashMenuEntries(LIST, "rosso", ALL, undefined, hiding).entries.some((entry) => entry.id === "markdown.color.red")).toBe(false);
  });

  it("le sezioni nell'ordine scelto; quelle non dette dopo, nel loro ordine; Suggeriti resta in cima", () => {
    const { sections } = slashMenuEntries(LIST, "", ALL, undefined, { ...use(), sections: ["code", "nessuna", "lists"] });
    expect(sections.slice(0, 4)).toEqual(["suggested", "code", "lists", "text"]);
  });
});
