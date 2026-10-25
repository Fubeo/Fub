import { describe, expect, it } from "vitest";
import type { CommandSpec } from "../host/contract";
import { SLASH_RECENT, slashMenuEntries, slashScore } from "./slash-menu";

function spec(id: string, title: string, surfaces: CommandSpec["surfaces"] = ["toolbar", "slash"]): CommandSpec {
  return {
    id, title, description: "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces,
  };
}

const SPECS = [
  spec("markdown.heading.2", "Titolo 2"),
  spec("markdown.list.task", "Elenco di attività"),
  spec("markdown.table", "Tabella"),
  spec("markdown.bold", "Grassetto", ["toolbar"]),
  spec("note.daily", "Nota del giorno", ["slash"]),
  spec("markdown.callout", "Callout"),
];
const KNOWN = new Set(["markdown.heading.2", "markdown.list.task", "markdown.table", "markdown.bold"]);
const has = (id: string) => KNOWN.has(id);

describe("le voci del «/» nel testo", () => {
  it("a menu aperto: le sezioni nell'ordine di sempre, solo ciò che è offerto al «/» e che la superficie sa fare", () => {
    const entries = slashMenuEntries(SPECS, "", has);
    expect(entries.map((entry) => [entry.id, entry.section, entry.action])).toEqual([
      ["markdown.heading.2", "text", true],
      ["markdown.list.task", "lists", true],
      ["markdown.table", "insert", true],
      ["note.daily", "vault", false],
    ]);
    expect(entries[0]!.hint).toBe("##");
    expect(entries[0]!.icon).toBe("");
    expect(entries[2]!.icon).toBe("fmt-table");
  });

  it("i recenti stanno in cima, al più cinque, e non si ripetono sotto", () => {
    const entries = slashMenuEntries(SPECS, "", has, ["note.daily", "markdown.table", "sparito"]);
    expect(entries.slice(0, 2).map((entry) => [entry.id, entry.section])).toEqual([
      ["note.daily", "recent"],
      ["markdown.table", "recent"],
    ]);
    expect(entries.filter((entry) => entry.id === "markdown.table")).toHaveLength(1);
    expect(SLASH_RECENT).toBe(5);
  });

  it("filtrando: un elenco solo, dal più pertinente, anche con altri nomi e in inglese", () => {
    expect(slashMenuEntries(SPECS, "tab", has).map((entry) => entry.id)).toEqual(["markdown.table"]);
    expect(slashMenuEntries(SPECS, "table", has).map((entry) => entry.id)).toEqual(["markdown.table"]);
    expect(slashMenuEntries(SPECS, "todo", has)[0]!.id).toBe("markdown.list.task");
    expect(slashMenuEntries(SPECS, "h2", has)[0]!.id).toBe("markdown.heading.2");
    expect(slashMenuEntries(SPECS, "attivita", has)[0]!.id).toBe("markdown.list.task");
    expect(slashMenuEntries(SPECS, "qwerty", has)).toEqual([]);
  });

  it("una query con uno spazio vuole parole intere, non lettere sparse", () => {
    const entry = { id: "markdown.heading.2", label: "Titolo 2", description: "" };
    expect(slashScore(entry, "titolo 2")).toBe(0);
    expect(slashScore(entry, "ti o")).toBeNull();
    expect(slashScore(entry, "tlo")).not.toBeNull();
  });
});
