// @vitest-environment happy-dom
// Cerca nella lavagna (N6 T60): le corrispondenze nel documento, l'ordine di
// lettura, maiuscole e accenti come la ricerca del vault, la domanda delle
// note all'indice e il velo che scrive solo dove cambia.
import { describe, expect, it } from "vitest";
import { applyFindMarks, boardFindIndex, boardMatches, findKey, findMarks, notesQuery, type FindMark, type FindMarkTarget } from "./find";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";

/** L'ultimo elemento di una lista che non è vuota. */
function last<T>(list: readonly T[]): T {
  return list[list.length - 1]!;
}

function node(partial: Partial<CanvasNode> & Pick<CanvasNode, "id" | "type">): CanvasNode {
  return { x: 0, y: 0, width: 200, height: 100, ...partial };
}

function board(nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasDocument {
  return { nodes, edges };
}

/** Gli id dei risultati, nell'ordine. */
function ids(doc: CanvasDocument, query: string, notes: readonly string[] = []): string[] {
  return boardMatches(boardFindIndex(doc), query, new Set(notes)).map((target) => target.id);
}

describe("le corrispondenze nel documento (T60)", () => {
  const doc = board([
    // Nell'array al contrario: l'ordine dei risultati è quello di lettura.
    node({ id: "giu", type: "text", x: 0, y: 400, text: "La varianza in fondo" }),
    node({ id: "destra", type: "file", x: 400, y: 0, file: "Statistica/Varianza.md" }),
    node({ id: "sinistra", type: "text", x: 0, y: 0, text: "# Idee\n\nla **varianza** campionaria" }),
    node({ id: "gruppo", type: "group", x: -50, y: 700, width: 600, height: 300, label: "Varianza e media" }),
    node({ id: "dentro", type: "text", x: 0, y: 750, text: "varianza dentro il gruppo" }),
    node({ id: "sito", type: "link", x: 800, y: 0, url: "https://example.com/varianza" }),
    node({ id: "cartella", type: "file", x: 1200, y: 0, file: "Varianza/altro.pdf" }),
    node({ id: "niente", type: "text", x: 1600, y: 0, text: "media" }),
  ], [
    { id: "filo", fromNode: "sinistra", toNode: "giu", label: "spiega la varianza" },
    { id: "muto", fromNode: "sinistra", toNode: "giu" },
  ]);

  it("trova il testo delle schede, i nomi dei file, gli indirizzi, le etichette dei gruppi e dei fili, in ordine di lettura", () => {
    // Prima i gruppi col loro contenuto (`readingOrder`), poi le righe dall'alto;
    // il filo subito dopo la scheda da cui parte.
    expect(ids(doc, "varianza")).toEqual(["gruppo", "dentro", "sinistra", "filo", "destra", "sito", "giu"]);
  });

  it("il nome di un file è il nome, non la cartella", () => {
    expect(ids(doc, "altro")).toEqual(["cartella"]);
    expect(ids(doc, "statistica")).toEqual([]);
  });

  it("cerca in tutto il testo della scheda, segni del Markdown compresi, non solo nel nome", () => {
    expect(ids(doc, "campionaria")).toEqual(["sinistra"]);
    expect(ids(doc, "**varianza**")).toEqual(["sinistra"]);
  });

  it("una ricerca vuota, o di soli spazi, non trova niente", () => {
    expect(ids(doc, "")).toEqual([]);
    expect(ids(doc, "   ")).toEqual([]);
  });

  it("le maiuscole non contano, gli accenti sì, e NFD vale NFC: come la ricerca del vault", () => {
    const accents = board([
      node({ id: "nfc", type: "text", text: "La Città di Perù" }),
      node({ id: "nfd", type: "text", x: 300, text: "la città vecchia" }),
      node({ id: "senza", type: "text", x: 600, text: "la citta nuova" }),
    ]);
    expect(ids(accents, "CITTÀ")).toEqual(["nfc", "nfd"]);
    expect(ids(accents, "città")).toEqual(["nfc", "nfd"]);
    expect(ids(accents, "citta")).toEqual(["senza"]);
    expect(findKey("  PERÙ ")).toBe("perù");
  });

  it("le schede delle note trovate dall'indice sono risultati anche se il loro nome non c'entra", () => {
    const notes = board([
      node({ id: "a", type: "file", file: "Note/a.md" }),
      node({ id: "b", type: "file", x: 300, file: "Note/b.md" }),
      node({ id: "b2", type: "file", x: 600, file: "Note/b.md", subpath: "#Titolo" }),
    ]);
    expect(ids(notes, "deviazione", ["Note/b.md"])).toEqual(["b", "b2"]);
    // Le note della lavagna, una volta ciascuna.
    expect(boardFindIndex(notes).notes).toEqual(["Note/a.md", "Note/b.md"]);
  });

  it("un filo trovato inquadra i suoi due capi, e quello senza la scheda da cui parte va in fondo", () => {
    const edges = board([node({ id: "a", type: "text", text: "a" }), node({ id: "b", type: "text", x: 300, text: "b" })], [
      { id: "orfano", fromNode: "via", toNode: "b", label: "ponte" },
      { id: "e", fromNode: "a", toNode: "b", label: "ponte" },
    ]);
    const found = boardMatches(boardFindIndex(edges), "ponte");
    expect(found.map((target) => target.id)).toEqual(["e", "orfano"]);
    expect(found[0]!.nodes).toEqual(["a", "b"]);
    expect(found[1]!.nodes).toEqual(["b"]);
  });

  it("il documento si legge una volta: lo stesso oggetto dà lo stesso indice, uno nuovo lo rifà", () => {
    const first = boardFindIndex(doc);
    expect(boardFindIndex(doc)).toBe(first);
    expect(boardFindIndex({ ...doc })).not.toBe(first);
  });

  it("una lavagna di 2000 schede: un tasto è un giro di `includes`, l'indice si fa una volta", () => {
    const nodes: CanvasNode[] = [];
    for (let i = 0; i < 2000; i++) {
      nodes.push(node({ id: `n${i}`, type: i % 4 === 0 ? "file" : "text", x: (i % 50) * 260, y: Math.floor(i / 50) * 160, text: `Scheda ${i} sulla Varianza numero ${i * 7}`, file: `Cartella/nota ${i}.md` }));
    }
    const big = board(nodes);
    const built = performance.now();
    const index = boardFindIndex(big);
    const indexMs = performance.now() - built;
    const typed = performance.now();
    let found = 0;
    for (const query of ["v", "va", "var", "vari", "varia", "varian", "varianz", "varianza"]) found = boardMatches(index, query).length;
    const perKey = (performance.now() - typed) / 8;
    expect(found).toBe(1500);
    // Misurato su questa macchina: circa 3 ms l'indice, 0,15 ms un tasto. Qui
    // un tetto largo, per le macchine lente.
    expect(indexMs).toBeLessThan(500);
    expect(perKey).toBeLessThan(20);
  });
});

describe("la domanda delle note all'indice (T60)", () => {
  it("la riga della ricerca del vault, ristretta alle note della lavagna in ogni clausola", () => {
    const query = notesQuery("deviazione OR media", ["a.md", "b.md"]);
    expect(query).not.toBeNull();
    expect(query!.any.length).toBe(2);
    for (const clause of query!.any) {
      expect(last(clause.all)).toEqual({ negated: false, predicate: { kind: "docs", docs: ["a.md", "b.md"] } });
      expect(clause.all.length).toBe(2);
    }
  });

  it("niente da chiedere senza note, con una riga vuota o con una riga che non è una ricerca", () => {
    expect(notesQuery("deviazione", [])).toBeNull();
    expect(notesQuery("  ", ["a.md"])).toBeNull();
    expect(notesQuery('"aperta', ["a.md"])).toBeNull();
  });
});

describe("il velo (T60)", () => {
  const doc = board([
    node({ id: "a", type: "text", text: "uno" }),
    node({ id: "b", type: "text", x: 300, text: "due" }),
    node({ id: "c", type: "text", x: 600, text: "tre" }),
    node({ id: "d", type: "text", x: 900, text: "quattro" }),
  ], [{ id: "e", fromNode: "c", toNode: "d", label: "uno" }]);

  function targets(): Map<string, FindMarkTarget> {
    return new Map(doc.nodes.map((n) => {
      const article = document.createElement("article");
      return [n.id, { article, find: null as FindMark }];
    }));
  }

  it("le trovate segnate, quella di adesso `current`, le altre velate, i capi di un filo trovato liberi", () => {
    const matches = boardMatches(boardFindIndex(doc), "uno");
    expect(matches.map((target) => target.id)).toEqual(["a", "e"]);
    const marks = findMarks(matches, 0);
    expect(["a", "b", "c", "d"].map(marks)).toEqual(["current", "veiled", null, null]);
    expect(["a", "b"].map(findMarks(matches, 1))).toEqual(["match", "veiled"]);
  });

  it("senza ricerca nessun segno; una ricerca senza risultati vela tutto", () => {
    expect(findMarks(null, -1)("a")).toBeNull();
    expect(findMarks([], -1)("a")).toBe("veiled");
  });

  it("scrive gli attributi solo dove il segno cambia", () => {
    const map = targets();
    const matches = boardMatches(boardFindIndex(doc), "t");
    expect(matches.map((target) => target.id)).toEqual(["c", "d"]);
    expect(applyFindMarks(map, findMarks(matches, 0))).toBe(4);
    expect(map.get("a")!.article.hasAttribute("data-card-veiled")).toBe(true);
    expect(map.get("c")!.article.dataset.cardFound).toBe("current");
    expect(map.get("d")!.article.dataset.cardFound).toBe("match");
    // Il risultato seguente: cambiano due schede sole.
    expect(applyFindMarks(map, findMarks(matches, 1))).toBe(2);
    expect(applyFindMarks(map, findMarks(matches, 1))).toBe(0);
    // Via la ricerca: via tutto.
    expect(applyFindMarks(map, findMarks(null, -1))).toBe(4);
    for (const { article } of map.values()) {
      expect(article.hasAttribute("data-card-veiled")).toBe(false);
      expect(article.hasAttribute("data-card-found")).toBe(false);
    }
  });
});
