// @vitest-environment happy-dom
// La testata di una scheda di file (N6 T22): i conti «↩ N» dall'indice, le
// gemelle dal documento, i segni dopo il titolo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CITATIONS_IN_FLIGHT, CITATIONS_SETTLE_MS, CitationCounts, cardFilePath, syncCardHead, twinGroups, type CardCitations } from "./card-head";
import type { CanvasNode } from "./model";

afterEach(() => {
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Una porta finta: le risposte si danno a mano, `fire` è l'indice che avvisa. */
function fakeIndex() {
  const pending: { path: string; resolve: (count: number) => void; reject: (error: unknown) => void }[] = [];
  let changed: (() => void) | null = null;
  let stopped = 0;
  const port: CardCitations = {
    count: (path) => new Promise<number>((resolve, reject) => pending.push({ path, resolve, reject })),
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
    fire: () => changed?.(),
    stopped: () => stopped,
    answer(path: string, count: number): void {
      const index = pending.findIndex((entry) => entry.path === path);
      pending.splice(index, 1)[0]!.resolve(count);
    },
  };
}

function file(id: string, path: string, subpath?: string): CanvasNode {
  return { id, type: "file", x: 0, y: 0, width: 240, height: 160, file: path, ...(subpath ? { subpath } : {}) } as CanvasNode;
}

describe("CitationCounts", () => {
  it("chiede ogni file una volta, al più quattro insieme, e avvisa solo quando un conto cambia", async () => {
    const index = fakeIndex();
    const changed = vi.fn();
    const counts = new CitationCounts(index.port, changed);
    const paths = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"];
    for (const path of paths) expect(counts.get(path)).toBe(0);
    for (const path of paths) counts.get(path);
    expect(index.pending.map((entry) => entry.path)).toEqual(paths.slice(0, CITATIONS_IN_FLIGHT));
    index.answer("a.md", 2);
    index.answer("b.md", 0);
    await settle();
    expect(counts.get("a.md")).toBe(2);
    expect(counts.get("b.md")).toBe(0);
    // «b» era 0 e resta 0: un solo avviso, per «a».
    expect(changed).toHaveBeenCalledTimes(1);
    expect(index.pending.map((entry) => entry.path)).toEqual(["c.md", "d.md", "e.md", "f.md"]);
    counts.dispose();
  });

  it("dopo l'avviso dell'indice richiede tutto; una risposta del giro vecchio non scrive sopra la nuova", async () => {
    vi.useFakeTimers();
    const index = fakeIndex();
    const changed = vi.fn();
    const counts = new CitationCounts(index.port, changed);
    counts.get("a.md");
    counts.get("b.md");
    index.answer("a.md", 1);
    await settle();
    // «b» è ancora in volo quando l'indice avvisa.
    index.fire();
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
    // Il conto di prima resta in vista finché non arriva il nuovo.
    expect(counts.get("a.md")).toBe(4);
    expect(counts.get("b.md")).toBe(5);
    counts.dispose();
  });

  it("una domanda che fallisce non si ripete a ogni resa; chiusa, niente scrive più e l'ascolto finisce", async () => {
    const index = fakeIndex();
    const changed = vi.fn();
    const counts = new CitationCounts(index.port, changed);
    counts.get("a.md");
    index.pending.shift()!.reject(new Error("indice giù"));
    await settle();
    expect(counts.get("a.md")).toBe(0);
    expect(index.pending).toHaveLength(0);
    counts.get("b.md");
    counts.dispose();
    index.answer("b.md", 3);
    await settle();
    expect(changed).not.toHaveBeenCalled();
    expect(index.stopped()).toBe(1);
    expect(counts.get("c.md")).toBe(0);
    expect(index.pending).toHaveLength(0);
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
