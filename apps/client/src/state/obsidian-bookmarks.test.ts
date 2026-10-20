// @vitest-environment happy-dom
// I segnalibri di Obsidian diventano segnalibri di Fub: ogni voce che Fub sa
// dire ha la sua gemella, le altre tornano per nome, e una seconda
// importazione non raddoppia niente.
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = new Map<string, unknown>();
vi.mock("./store", () => ({
  state: { vaultRoot: "/vault" },
  readState: async (key: string) => saved.get(key) ?? null,
  writeState: (key: string, value: unknown) => {
    saved.set(key, JSON.parse(JSON.stringify(value)));
  },
}));

const { importObsidianBookmarks, translateObsidianBookmarks } = await import("./obsidian-bookmarks");
const { listBookmarks, listGroups } = await import("./bookmarks");

const ITEMS = [
  { type: "file", ctime: 1, path: "Diario/Oggi.md" },
  { type: "file", ctime: 2, path: "Nota.md", subpath: "#Capitolo#Sezione", title: "Qui" },
  { type: "file", ctime: 3, path: "Nota.md", subpath: "#^abc" },
  { type: "group", ctime: 4, title: "Lavoro", items: [
    { type: "folder", ctime: 5, path: "Progetti/" },
    { type: "search", ctime: 6, query: "tag:#urgente" },
    { type: "group", ctime: 7, title: "Dentro", items: [{ type: "url", ctime: 8, url: "https://example.org", title: "Sito" }] },
  ] },
  { type: "graph", ctime: 9, title: "Mappa" },
  { type: "url", ctime: 10, url: "javascript:alert(1)" },
];

describe("i segnalibri di Obsidian", () => {
  beforeEach(() => saved.clear());

  it("ogni specie che Fub sa dire ha la sua gemella, le altre tornano per nome", () => {
    const { entries, lost } = translateObsidianBookmarks(ITEMS);
    expect(entries).toEqual([
      { title: "Oggi", target: { k: "doc", doc: "Diario/Oggi.md" }, group: null },
      { title: "Qui", target: { k: "doc", doc: "Nota.md", heading: "Sezione" }, group: null },
      { title: "Nota › abc", target: { k: "doc", doc: "Nota.md", block: "abc" }, group: null },
      { title: "Progetti", target: { k: "folder", path: "Progetti" }, group: "Lavoro" },
      { title: "tag:#urgente", target: { k: "search", query: "tag:#urgente" }, group: "Lavoro" },
      { title: "Sito", target: { k: "web", url: "https://example.org" }, group: "Dentro" },
    ]);
    expect(lost).toEqual(["graph «Mappa»", "url"]);
  });

  it("si scrivono nello store coi loro gruppi, e una seconda volta non si raddoppiano", async () => {
    const first = await importObsidianBookmarks(ITEMS);
    expect(first).toEqual({ added: 6, same: 0, lost: ["graph «Mappa»", "url"], refused: false });
    expect(listBookmarks().map((b) => b.title)).toEqual(["Oggi", "Qui", "Nota › abc", "Progetti", "tag:#urgente", "Sito"]);
    const groups = listGroups();
    expect(groups.map((g) => [g.title, g.bookmarkIds.length])).toEqual([["Lavoro", 2], ["Dentro", 1]]);

    const again = await importObsidianBookmarks(ITEMS);
    expect(again).toMatchObject({ added: 0, same: 6, refused: false });
    expect(listBookmarks()).toHaveLength(6);
    expect(listGroups()).toHaveLength(2);
  });

  it("uno store di una versione futura non si tocca, e lo si dice", async () => {
    saved.set("bookmarks", { v: 9, bookmarks: [], groups: [] });
    const done = await importObsidianBookmarks(ITEMS);
    expect(done).toMatchObject({ added: 0, refused: true });
    expect(saved.get("bookmarks")).toEqual({ v: 9, bookmarks: [], groups: [] });
  });
});
