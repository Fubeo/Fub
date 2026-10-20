// @vitest-environment happy-dom
// L'ordine dei segnalibri come lo si vede: dentro un gruppo vale l'ordine del
// gruppo, fuori dai gruppi quello dell'elenco, e i gruppi hanno il loro.
import { describe, expect, it } from "vitest";
import { bookmarkDropped, bookmarkMatches, listBookmarks, listGroups, setBookmarksForTest, stepBookmark, stepGroup } from "./bookmarks";

const doc = (id: string) => ({ id, title: id, target: { k: "doc" as const, doc: `${id}.md` }, created: 0 });

function store() {
  setBookmarksForTest({
    v: 1,
    bookmarks: ["a", "b", "c", "d", "e"].map(doc),
    groups: [
      { id: "g1", title: "Uno", bookmarkIds: ["d", "sparito", "b"] },
      { id: "g2", title: "Due", bookmarkIds: [] },
    ],
  });
}

const loose = () => {
  const grouped = new Set(listGroups().flatMap((g) => g.bookmarkIds));
  return listBookmarks().filter((b) => !grouped.has(b.id)).map((b) => b.id);
};

describe("riordinare i segnalibri", () => {
  it("dentro un gruppo si muove nell'ordine del gruppo, saltando chi non c'è più", () => {
    store();
    expect(stepBookmark("b", -1)).toBe(true);
    expect(listGroups()[0]!.bookmarkIds).toEqual(["b", "sparito", "d"]);
    expect(stepBookmark("b", -1)).toBe(false);
    // L'elenco intero non cambia: il gruppo ha il suo ordine.
    expect(listBookmarks().map((b) => b.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("fuori dai gruppi scambia col vicino che si vede, non con uno di un gruppo", () => {
    store();
    expect(loose()).toEqual(["a", "c", "e"]);
    expect(stepBookmark("c", 1)).toBe(true);
    expect(loose()).toEqual(["a", "e", "c"]);
    expect(stepBookmark("c", 1)).toBe(false);
    expect(stepBookmark("a", -1)).toBe(false);
  });

  it("i gruppi si spostano fra loro", () => {
    store();
    expect(stepGroup("g2", -1)).toBe(true);
    expect(listGroups().map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(stepGroup("g2", -1)).toBe(false);
    expect(stepGroup("manca", 1)).toBe(false);
  });
});

describe("filtro dei segnalibri", () => {
  it("trova nel titolo o nella destinazione, senza maiuscole", () => {
    expect(bookmarkMatches("Diario", "note/diario.md", "")).toBe(true);
    expect(bookmarkMatches("Diario", "note/diario.md", "  dia ")).toBe(true);
    expect(bookmarkMatches("Diario", "note/Viaggi.md", "VIAGGI")).toBe(true);
    expect(bookmarkMatches("Diario", "note/diario.md", "ricette")).toBe(false);
  });

  it("le parole stanno nel nome o nel percorso, e -parola toglie la cartella intera", () => {
    expect(bookmarkMatches("Diario", "note/viaggi/oslo.md", "diario oslo")).toBe(true);
    expect(bookmarkMatches("Diario", "note/viaggi/oslo.md", "diario roma")).toBe(false);
    expect(bookmarkMatches("Diario", "note/viaggi/oslo.md", "diario -viaggi")).toBe(false);
    expect(bookmarkMatches("Diario", "note/oslo.md", "-diario")).toBe(false);
    expect(bookmarkMatches("Diario", "note/oslo.md", "-viaggi")).toBe(true);
    expect(bookmarkMatches("Diario", "note/Viaggi in treno.md", '"viaggi in"')).toBe(true);
  });
});

describe("rilascio sul pannello", () => {
  it("ogni voce lasciata cadere diventa un segnalibro col suo nome", () => {
    setBookmarksForTest({ v: 1, bookmarks: [], groups: [] });
    expect(bookmarkDropped(["note/Diario.md", "foto.png"])).toBe(2);
    expect(listBookmarks().map((b) => [b.title, b.target])).toEqual([
      ["Diario.md", { k: "doc", doc: "note/Diario.md" }],
      ["foto.png", { k: "doc", doc: "foto.png" }],
    ]);
  });
});
