// Le schede delle note (E11, T20): ciò che la scheda legge dalle proprietà.
import { describe, expect, it, vi } from "vitest";
import type { DocumentMatch } from "../host/contract";
import { cardDate, createNoteCardHub, isNoteDoc, noteCardOf, type NoteCardQueries } from "./note-cards";

function match(properties: Record<string, unknown>): DocumentMatch {
  return {
    doc: "Luoghi/Biblioteca civica.md",
    properties: Object.entries(properties).map(([key, value]) => ({ key, value })),
  } as unknown as DocumentMatch;
}

describe("la scheda della nota", () => {
  it("prende icona, descrizione, copertina e la prima data che c'è", () => {
    const card = noteCardOf("Luoghi/Biblioteca civica.md", match({
      icon: "📚",
      description: "Orari, sale e prestito",
      cover: "#cfe7d6",
      updated: "2026-11-10",
      created: "2025-01-02",
    }), 6, "it");
    expect(card).toEqual({
      doc: "Luoghi/Biblioteca civica.md",
      title: "Biblioteca civica",
      icon: "📚",
      description: "Orari, sale e prestito",
      date: "10 novembre 2026",
      cover: "#cfe7d6",
      links: 6,
    });
  });

  it("senza proprietà è il solo titolo; una descrizione lunga si taglia", () => {
    expect(noteCardOf("Nota.md", undefined, 0, "it")).toEqual({ doc: "Nota.md", title: "Nota", icon: "", description: "", date: "", cover: "", links: 0 });
    const long = noteCardOf("Nota.md", match({ description: "x".repeat(400) }), 0, "it");
    expect(long.description.length).toBe(280);
    expect(long.description.endsWith("…")).toBe(true);
  });

  it("dice le date a parole; un testo breve resta com'è, uno lungo o una data impossibile no", () => {
    expect(cardDate("2026-11-10T08:30:00Z", "it")).toBe("10 novembre 2026");
    expect(cardDate("2026-02-30", "it")).toBe("2026-02-30");
    expect(cardDate("primavera 2026", "it")).toBe("primavera 2026");
    expect(cardDate("y".repeat(41), "it")).toBe("");
    expect(cardDate(null, "it")).toBe("");
  });

  it("è una scheda soltanto un link a una nota", () => {
    expect(isNoteDoc("a/Nota.md")).toBe(true);
    expect(isNoteDoc("a/Nota.MARKDOWN")).toBe(true);
    expect(isNoteDoc("Carte/Pianta.pdf")).toBe(false);
    expect(isNoteDoc("Conti.fubsheet")).toBe(false);
  });
});

/// Un indice finto: `Idea` porta a una nota diversa da ogni cartella.
function fakeQueries(now = { value: 0 }) {
  const calls = { resolve: [] as string[], documents: [] as string[][], links: [] as string[] };
  const queries: NoteCardQueries = {
    resolve: vi.fn(async (page: string, from: string | undefined) => {
      calls.resolve.push(`${from ?? ""}>${page}`);
      if (page === "Manca") return null;
      const folder = from?.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
      return `${folder}${page}.md`;
    }),
    documents: vi.fn(async (docs: readonly string[]) => {
      calls.documents.push([...docs]);
      return docs.map((doc) => ({ doc, properties: [{ key: "description", value: `di ${doc}` }] }) as unknown as DocumentMatch);
    }),
    links: vi.fn(async (doc: string) => {
      calls.links.push(doc);
      return 2;
    }),
    vault: () => "/vault",
    now: () => now.value,
  };
  return { queries, calls, now };
}

describe("le schede tenute", () => {
  it("chiede una volta sola le proprietà di tutte le schede nuove, e risolve dalla nota del link", async () => {
    const { queries, calls } = fakeQueries();
    const hub = createNoteCardHub(queries);
    const changed = vi.fn();
    hub.watch(changed);
    expect(hub.view("Idea", "A/Uno.md")).toEqual({ kind: "loading" });
    hub.view("Idea", "B/Due.md");
    hub.view("Manca", "A/Uno.md");
    await hub.settled();
    expect(calls.documents).toEqual([["A/Idea.md", "B/Idea.md"]]);
    expect(calls.resolve.sort()).toEqual(["A/Uno.md>Idea", "A/Uno.md>Manca", "B/Due.md>Idea"]);
    const first = hub.view("Idea", "A/Uno.md");
    expect(first.kind === "card" && first.card.doc).toBe("A/Idea.md");
    expect(first.kind === "card" && first.card.links).toBe(2);
    const second = hub.view("Idea", "B/Due.md");
    expect(second.kind === "card" && second.card.doc).toBe("B/Idea.md");
    expect(hub.view("Manca", "A/Uno.md")).toEqual({ kind: "missing" });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("un cambio dell'indice richiede soltanto le schede tenute, senza risolverle di nuovo", async () => {
    const { queries, calls, now } = fakeQueries();
    const hub = createNoteCardHub(queries);
    const release = hub.hold("Idea", "A/Uno.md");
    hub.view("Altra", "A/Uno.md");
    await hub.settled();
    calls.resolve.length = 0;
    calls.documents.length = 0;
    hub.refresh();
    await hub.settled();
    expect(calls.documents).toEqual([["A/Idea.md"]]);
    expect(calls.resolve).toEqual([]);
    // Lasciata e passato il tempo di grazia, la scheda si dimentica e un
    // cambio dell'indice non chiede più niente.
    release();
    now.value += 10_000;
    calls.documents.length = 0;
    hub.refresh();
    await hub.settled();
    expect(calls.documents).toEqual([]);
  });

  it("un documento spostato rifà le risoluzioni delle schede tenute", async () => {
    const { queries, calls } = fakeQueries();
    const hub = createNoteCardHub(queries);
    hub.hold("Idea", "A/Uno.md");
    await hub.settled();
    calls.resolve.length = 0;
    hub.moved();
    await hub.settled();
    expect(calls.resolve).toEqual(["A/Uno.md>Idea"]);
  });

  it("una risposta di prima non copre quella di adesso", async () => {
    const { queries } = fakeQueries();
    let first = true;
    let releaseFirst: () => void = () => {};
    queries.documents = vi.fn(async (docs: readonly string[]) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return docs.map((doc) => ({ doc, properties: [{ key: "description", value: "vecchia" }] }) as unknown as DocumentMatch);
      }
      return docs.map((doc) => ({ doc, properties: [{ key: "description", value: "nuova" }] }) as unknown as DocumentMatch);
    });
    const hub = createNoteCardHub(queries);
    hub.hold("Idea", "A/Uno.md");
    // La prima tornata aspetta le proprietà; intanto l'indice cambia.
    await vi.waitFor(() => expect(queries.documents).toHaveBeenCalledTimes(1));
    hub.refresh();
    await vi.waitFor(() => {
      const seen = hub.view("Idea", "A/Uno.md");
      expect(seen.kind === "card" && seen.card.description).toBe("nuova");
    });
    releaseFirst();
    await hub.settled();
    const seen = hub.view("Idea", "A/Uno.md");
    expect(seen.kind === "card" && seen.card.description).toBe("nuova");
  });

  it("un vault nuovo dimentica le risposte e richiede le schede tenute", async () => {
    const { queries, calls } = fakeQueries();
    const hub = createNoteCardHub(queries);
    hub.hold("Idea", "A/Uno.md");
    hub.view("Altra", "A/Uno.md");
    await hub.settled();
    calls.documents.length = 0;
    hub.forget();
    expect(hub.view("Idea", "A/Uno.md")).toEqual({ kind: "loading" });
    await hub.settled();
    expect(calls.documents).toEqual([["A/Idea.md"]]);
  });
});
