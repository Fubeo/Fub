import { describe, expect, it } from "vitest";
import { BASE_ENTRY, COLOR_ENTRY, SLASH_RESULTS, SLASH_TOP, SYNC_BLOCK_ENTRY, slashMenuEntries } from "./entries";
import { ALL, SPECS, spec } from "./fixture.test-data";

const OTHERS = [
  spec("markdown.bold", "Grassetto", ["toolbar"]),
  spec("note.daily", "Nota del giorno", ["slash"]),
];
const LIST = [...SPECS, ...OTHERS];
const today = new Date(2026, 9, 29);
const use = (recent: string[] = [], favorites: string[] = []) => ({ recent, favorites, chord: () => null, today });

describe("le voci del «/» nel testo", () => {
  it("a menu aperto: i gruppi nell'ordine, solo ciò che è offerto al «/» e che la superficie sa fare", () => {
    const { entries, sections, filtering } = slashMenuEntries(LIST, "", ALL);
    expect(filtering).toBe(false);
    expect(sections).toEqual(["text", "lists", "blocks", "code", "media", "people", "style", "page", "vault"]);
    expect(entries.some((entry) => entry.id === "markdown.bold")).toBe(false);
    expect(entries.find((entry) => entry.id === "note.daily")).toMatchObject({ section: "vault", action: false });
    expect(entries.find((entry) => entry.id === "markdown.heading.2")).toMatchObject({ hint: "##", icon: "fmt-h2", section: "text" });
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

  it("le tessere: in un vault nuovo Attività, Titolo, Riquadro, Tabella, poi gli altri blocchi; mai stili né comandi", () => {
    const { top } = slashMenuEntries(LIST, "", ALL);
    expect(top.map((entry) => entry.id)).toEqual([
      "markdown.list.task", "markdown.heading.2", "markdown.callout", "markdown.table", "markdown.list.bullet", "markdown.codeblock",
    ]);
    expect(top).toHaveLength(SLASH_TOP);
  });

  it("le tessere seguono l'uso: preferiti, poi recenti; un comando del vault o uno stile non diventano tessere", () => {
    const { top, entries } = slashMenuEntries(LIST, "", ALL, undefined, use(["note.daily", "markdown.rule", COLOR_ENTRY, "markdown.table"], ["markdown.quote"]));
    expect(top.map((entry) => entry.id)).toEqual([
      "markdown.quote", "markdown.rule", "markdown.table", "markdown.list.task", "markdown.heading.2", "markdown.callout",
    ]);
    // Le righe restano tutte, nei loro gruppi, anche quelle che sono tessere.
    expect(entries.find((entry) => entry.id === "markdown.quote")).toMatchObject({ section: "text" });
  });

  it("una tessera nascosta lascia il posto alla seguente; scrivendo, niente tessere", () => {
    const { top } = slashMenuEntries(LIST, "", ALL, undefined, { ...use(), hidden: ["markdown.callout"] });
    expect(top.map((entry) => entry.id)).toEqual([
      "markdown.list.task", "markdown.heading.2", "markdown.table", "markdown.list.bullet", "markdown.codeblock", "markdown.quote",
    ]);
    expect(slashMenuEntries(LIST, "tab", ALL).top).toEqual([]);
  });

  it("spento `fub.formatting`, restano i comandi del vault e nessuna tessera", () => {
    const { top, entries } = slashMenuEntries(LIST, "", () => false);
    expect(top).toEqual([]);
    expect(entries.map((entry) => entry.id)).toEqual(["note.daily"]);
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

  it("i gruppi nell'ordine scelto (`editor.slash.sections`); quelli non detti dopo, nel loro ordine", () => {
    const { sections, entries } = slashMenuEntries(LIST, "", ALL, undefined, { ...use(), sections: ["code", "nessuna", "lists"] });
    expect(sections.slice(0, 3)).toEqual(["code", "lists", "text"]);
    expect(entries[0]!.section).toBe("code");
  });
});

describe("la Base dal «/» (T18)", () => {
  // `base.view.add` c'è soltanto con la componente delle Basi accesa.
  const WITH_BASES = [...LIST, spec("base.view.add", "Aggiungi una vista", ["toolbar"])];

  it("sta fra i blocchi subito dopo la Tabella, con la sua figura e «/base»", () => {
    const { entries } = slashMenuEntries(WITH_BASES, "", ALL);
    const ids = entries.map((entry) => entry.id);
    expect(ids[ids.indexOf("markdown.table") + 1]).toBe(BASE_ENTRY);
    expect(entries.find((entry) => entry.id === BASE_ENTRY)).toMatchObject({
      label: "Base", section: "blocks", action: true, picker: null, icon: "collection", hint: "/base",
    });
  });

  it("in un vault nuovo è la tessera dopo Tabella", () => {
    const { top } = slashMenuEntries(WITH_BASES, "", ALL);
    expect(top.map((entry) => entry.id)).toEqual([
      "markdown.list.task", "markdown.heading.2", "markdown.callout", "markdown.table", BASE_ENTRY, "markdown.list.bullet",
    ]);
  });

  it("scrivendo «/base» o «database» la si trova per prima", () => {
    expect(slashMenuEntries(WITH_BASES, "base", ALL).entries[0]!.id).toBe(BASE_ENTRY);
    expect(slashMenuEntries(WITH_BASES, "database", ALL).entries[0]!.id).toBe(BASE_ENTRY);
  });

  it("non c'è senza le Basi, dove la superficie non sa crearla, né se è nascosta", () => {
    expect(slashMenuEntries(LIST, "", ALL).entries.some((entry) => entry.id === BASE_ENTRY)).toBe(false);
    expect(slashMenuEntries(WITH_BASES, "", (id) => id !== BASE_ENTRY && ALL(id)).entries.some((entry) => entry.id === BASE_ENTRY)).toBe(false);
    expect(slashMenuEntries(WITH_BASES, "base", ALL, undefined, { ...use(), hidden: [BASE_ENTRY] }).entries.some((entry) => entry.id === BASE_ENTRY)).toBe(false);
  });
});

describe("il blocco di un'altra nota dal «/» (T30)", () => {
  it("subito dopo la trasclusione, con la lente del prototipo, senza forma da scrivere", () => {
    const { entries } = slashMenuEntries(LIST, "", ALL);
    const ids = entries.map((entry) => entry.id);
    expect(ids[ids.indexOf("markdown.embed") + 1]).toBe(SYNC_BLOCK_ENTRY);
    expect(entries.find((entry) => entry.id === SYNC_BLOCK_ENTRY)).toMatchObject({
      label: "Blocco di un'altra nota", section: "media", action: true, picker: null, icon: "search", hint: null,
    });
  });

  it("scrivendo «sincronizzato» la si trova per prima; non c'è dove la superficie non la sa fare", () => {
    expect(slashMenuEntries(LIST, "sincronizzato", ALL).entries[0]!.id).toBe(SYNC_BLOCK_ENTRY);
    expect(slashMenuEntries(LIST, "", (id) => id !== SYNC_BLOCK_ENTRY && ALL(id)).entries.some((entry) => entry.id === SYNC_BLOCK_ENTRY)).toBe(false);
  });
});
