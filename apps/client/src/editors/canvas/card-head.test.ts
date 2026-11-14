// @vitest-environment happy-dom
// La testata di una scheda di file (N6 T22): i conti «↩ N» dall'indice, solo
// per la zona e solo quelli che un cambio può toccare; le gemelle dal
// documento; i segni dopo il titolo.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CITATIONS_IN_FLIGHT,
  CITATIONS_SETTLE_MS,
  CITATIONS_TOUCHED_MAX,
  CitationCounts,
  cardFilePath,
  headZonePaths,
  syncCardHead,
  twinGroups,
  type CardCitations,
} from "./card-head";
import type { CanvasNode } from "./model";

afterEach(() => {
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Una porta finta: le risposte si danno a mano, `fire` è l'indice che avvisa,
 * `links` dice che cosa cita adesso ogni documento.
 */
function fakeIndex(links: Record<string, readonly string[]> = {}) {
  const pending: { path: string; resolve: (total: number, citers?: readonly string[] | null) => void; reject: (error: unknown) => void }[] = [];
  const asked: string[] = [];
  const linksAsked: string[] = [];
  let changed: ((docs: readonly string[] | null) => void) | null = null;
  let stopped = 0;
  const port: CardCitations = {
    count: (path) => {
      asked.push(path);
      return new Promise((resolve, reject) =>
        pending.push({ path, resolve: (total, citers = null) => resolve({ total, citers }), reject }));
    },
    linksFrom: async (doc, among) => {
      linksAsked.push(doc);
      return among.filter((path) => links[doc]?.includes(path));
    },
    watch: (listener) => {
      changed = listener;
      return () => {
        stopped++;
      };
    },
  };
  return {
    port,
    pending,
    asked,
    linksAsked,
    fire: (docs: readonly string[] | null) => changed?.(docs),
    stopped: () => stopped,
    answer(path: string, total: number, citers: readonly string[] | null = null): void {
      const index = pending.findIndex((entry) => entry.path === path);
      pending.splice(index, 1)[0]!.resolve(total, citers);
    },
  };
}

function file(id: string, path: string, subpath?: string, x = 0, y = 0): CanvasNode {
  return { id, type: "file", x, y, width: 240, height: 160, file: path, ...(subpath ? { subpath } : {}) } as CanvasNode;
}

describe("CitationCounts", () => {
  it("chiede solo i file della zona, ognuno una volta, al più quattro insieme, e avvisa solo quando un conto cambia", async () => {
    const index = fakeIndex();
    const changed = vi.fn();
    const counts = new CitationCounts(index.port, changed);
    // Leggere non chiede niente.
    expect(counts.get("fuori.md")).toBe(0);
    expect(index.asked).toEqual([]);
    const paths = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"];
    counts.want(paths);
    counts.want(paths);
    expect(index.asked).toEqual(paths.slice(0, CITATIONS_IN_FLIGHT));
    index.answer("a.md", 2);
    index.answer("b.md", 0);
    await settle();
    expect(counts.get("a.md")).toBe(2);
    expect(counts.get("b.md")).toBe(0);
    // «b» era 0 e resta 0: un solo avviso, per «a».
    expect(changed).toHaveBeenCalledTimes(1);
    expect(index.pending.map((entry) => entry.path)).toEqual(["c.md", "d.md", "e.md", "f.md"]);
    // La zona si sposta: «g» si chiede, la coda non tiene chi è uscito.
    counts.want(["g.md"]);
    index.answer("c.md", 1);
    await settle();
    expect(index.asked.slice(6)).toEqual(["g.md"]);
    counts.dispose();
  });

  it("con «non so» tutti i conti invecchiano, ma si richiedono solo quelli della zona; gli altri quando ci entrano", async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    const counts = new CitationCounts(index.port, () => {});
    counts.want(["a.md", "b.md"]);
    index.answer("a.md", 1);
    index.answer("b.md", 2);
    await settle();
    counts.want(["a.md"]);
    index.fire(null);
    vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
    expect(index.asked).toEqual(["a.md", "b.md", "a.md"]);
    // Il conto vecchio resta in vista finché non arriva il nuovo: niente lampo.
    expect(counts.get("b.md")).toBe(2);
    counts.want(["a.md", "b.md"]);
    expect(index.asked).toEqual(["a.md", "b.md", "a.md", "b.md"]);
    counts.dispose();
  });

  it("coi documenti cambiati si richiedono solo i conti che citavano o citano quei documenti", async () => {
    vi.useFakeTimers();
    // «nota.md» adesso cita «c.md» (prima no) e non più «a.md».
    const index = fakeIndex({ "nota.md": ["c.md"] });
    const counts = new CitationCounts(index.port, () => {});
    const zone = ["a.md", "b.md", "c.md", "d.md"];
    counts.want(zone);
    index.answer("a.md", 1, ["nota.md"]);
    index.answer("b.md", 1, ["altra.md"]);
    index.answer("c.md", 0, []);
    // Di «d» l'indice non ha dato tutte le note: ogni cambio di link può toccarlo.
    index.answer("d.md", 80, null);
    await settle();
    index.fire(["nota.md"]);
    vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
    await settle();
    expect(index.linksAsked).toEqual(["nota.md"]);
    expect(index.asked.slice(zone.length).sort()).toEqual(["a.md", "c.md", "d.md"]);
    // Il documento cambiato che è sulla lavagna invecchia anche lui.
    index.answer("a.md", 0, []);
    index.answer("c.md", 1, ["nota.md"]);
    index.answer("d.md", 80, null);
    await settle();
    index.fire(["b.md"]);
    vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
    await settle();
    expect(index.asked.slice(zone.length + 3).sort()).toEqual(["b.md", "d.md"]);
    counts.dispose();
  });

  it("troppi documenti in una pausa fanno come «non so»", async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    const counts = new CitationCounts(index.port, () => {});
    counts.want(["a.md"]);
    index.answer("a.md", 1, ["x.md"]);
    await settle();
    index.fire(Array.from({ length: CITATIONS_TOUCHED_MAX + 1 }, (_, i) => `n${i}.md`));
    vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
    await settle();
    expect(index.linksAsked).toEqual([]);
    expect(index.asked).toEqual(["a.md", "a.md"]);
    counts.dispose();
  });

  it("la corsa: una risposta chiesta prima che il conto invecchiasse non scrive, e vale quella nuova", async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    const changed = vi.fn();
    const counts = new CitationCounts(index.port, changed);
    counts.want(["a.md", "b.md"]);
    index.answer("a.md", 1);
    await settle();
    // «b» è ancora in volo quando l'indice avvisa.
    index.fire(null);
    vi.advanceTimersByTime(CITATIONS_SETTLE_MS);
    expect(index.pending.map((entry) => entry.path)).toEqual(["b.md", "a.md"]);
    index.answer("b.md", 9);
    await settle();
    // La risposta vecchia di «b» non vale: si chiede di nuovo, e il conto resta.
    expect(counts.get("b.md")).toBe(0);
    expect(index.pending.map((entry) => entry.path)).toEqual(["a.md", "b.md"]);
    index.answer("a.md", 4);
    index.answer("b.md", 5);
    await settle();
    expect(counts.get("a.md")).toBe(4);
    expect(counts.get("b.md")).toBe(5);
    expect(changed).toHaveBeenCalledTimes(3);
    counts.dispose();
  });

  it("una domanda che fallisce non si ripete a ogni resa; chiusa, niente scrive più e l'ascolto finisce", async () => {
    const index = fakeIndex();
    const changed = vi.fn();
    const counts = new CitationCounts(index.port, changed);
    counts.want(["a.md"]);
    index.pending.shift()!.reject(new Error("indice giù"));
    await settle();
    counts.want(["a.md"]);
    expect(counts.get("a.md")).toBe(0);
    expect(index.pending).toHaveLength(0);
    counts.want(["b.md"]);
    counts.dispose();
    index.answer("b.md", 3);
    await settle();
    expect(changed).not.toHaveBeenCalled();
    expect(index.stopped()).toBe(1);
    counts.want(["c.md"]);
    expect(index.pending).toHaveLength(0);
  });
});

describe("la zona dei conti", () => {
  it("le schede di file che toccano la vista allargata di metà per lato, dallo zoom 0,35; più quelle che lavorano", () => {
    const view = { x: 0, y: 0, width: 800, height: 600 };
    const nodes = [
      file("dentro", "dentro.md"),
      file("bordo", "bordo.md", undefined, 1190, 0),
      file("fuori", "fuori.md", undefined, 1300, 0),
      file("attiva", "attiva.md", undefined, 5000, 5000),
      { id: "t", type: "text", x: 0, y: 0, width: 100, height: 100, text: "x" } as CanvasNode,
    ];
    expect([...headZonePaths(nodes, view, 1, new Set(["attiva"]))].sort()).toEqual(["attiva.md", "bordo.md", "dentro.md"]);
    // Da lontano la testata non si vede: solo chi lavora.
    expect([...headZonePaths(nodes, view, 0.2, new Set(["attiva"]))]).toEqual(["attiva.md"]);
  });
});

describe("le gemelle e la testata", () => {
  it("le gemelle sono i file con più schede, col `subpath` o senza; un file solo non c'è", () => {
    const nodes = [file("a", "Note/idea.md"), file("b", "Note/idea.md#Titolo"), file("c", "/Note/idea.md", "#Altro"), file("d", "foto.png")];
    expect([...twinGroups(nodes)]).toEqual([["Note/idea.md", ["a", "b", "c"]]]);
    expect(cardFilePath({ id: "t", type: "text", x: 0, y: 0, width: 1, height: 1, text: "x" } as CanvasNode)).toBe("");
  });

  it("«↩ N» e «×N» dopo il titolo, prima del resto; via quando non servono", () => {
    const handle = document.createElement("div");
    const title = document.createElement("span");
    title.className = "canvas-node-title";
    const connect = document.createElement("button");
    handle.append(title, connect);
    syncCardHead(title, 1, 3);
    expect([...handle.children].map((el) => el.className)).toEqual(["canvas-node-title", "canvas-node-cites", "canvas-node-twins", ""]);
    expect(handle.querySelector(".canvas-node-cites .sr-only")?.textContent).toBe("Citata da una nota");
    expect(handle.querySelector(".canvas-node-twins")?.textContent).toBe("×3");
    const twins = handle.querySelector(".canvas-node-twins");
    syncCardHead(title, 0, 3);
    expect(handle.querySelector(".canvas-node-cites")).toBeNull();
    // Lo stesso pulsante, non uno nuovo: il fuoco resta.
    expect(handle.querySelector(".canvas-node-twins")).toBe(twins);
    syncCardHead(title, 0, 1);
    expect([...handle.children].map((el) => el.className)).toEqual(["canvas-node-title", ""]);
  });
});
