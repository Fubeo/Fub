// @vitest-environment happy-dom
// L'ispettore della lavagna (T58): la lettura delle schede dal testo, l'elenco
// in ordine di lettura, il filtro, il clic che porta la vista sulla scheda e
// la sceglie, l'elenco virtuale, e la superficie che lo offre e lo spegne.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorSurface, SurfacePanel } from "../../core/registry";
import type { CanvasNode } from "../model";
import { canvasCoreReady } from "../wasm/core";
import { mountCanvasSurface } from "../surface";
import {
  boardCards,
  cardName,
  CARDS_PANEL_ID,
  createCanvasInspector,
  filterEntries,
  VIRTUAL_AFTER,
} from "./inspector";
import { readingOrder } from "../reading-order";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const node = (id: string, x: number, y: number, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "text", x, y, width: 200, height: 80, text: id, ...extra });

/** La lavagna dell'impianto, in piccolo: un gruppo con due note e un testo, e due schede fuori. */
const BOARD: CanvasNode[] = [
  node("pendolo", 700, 20, { type: "file", file: "Fisica/Pendolo semplice.md", text: undefined }),
  node("statistica", 0, 0, { type: "group", label: "Statistica", width: 600, height: 400, text: undefined }),
  node("varianza", 20, 60, { type: "file", file: "Statistica/Varianza.md", text: undefined }),
  node("domande", 300, 60, { text: "# Domande per giovedì\nPerché n − 1?" }),
  node("bessel", 20, 250, { type: "file", file: "Statistica/Correzione di Bessel.pdf", text: undefined }),
  node("esercizi", 0, 500, { text: "Esercizi sulla varianza" }),
];
const source = (nodes: readonly CanvasNode[] = BOARD): string => JSON.stringify({ nodes, edges: [] }, null, 2);

const names = (host: HTMLElement): string[] => [...host.querySelectorAll<HTMLElement>(".canvas-inspector-row .canvas-inspector-name")].map((row) => row.textContent ?? "");

function mountPanel(panel: SurfacePanel): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  return { host, unmount: panel.mount(host) };
}

describe("boardCards", () => {
  it("trova ogni scheda e il byte dove comincia il suo oggetto, BOM e lettere accentate compresi", () => {
    const text = `﻿{"edges":[],"extra":{"nodes":[1]},"nodes":[{"id":"è","type":"text","x":0,"y":0,"width":10,"height":10,"text":"città \\"€\\" 😀"},\n {"id":"b","type":"group","x":5,"y":5,"width":1,"height":1}]}`;
    const read = boardCards(text)!;
    expect(read.nodes.map((each) => each.id)).toEqual(["è", "b"]);
    const bytes = new TextEncoder().encode(text);
    const decoder = new TextDecoder();
    for (const start of read.starts) expect(decoder.decode(bytes.slice(start, start + 6))).toMatch(/^\{"id":/);
    expect(read.starts[0]).toBe(new TextEncoder().encode(text.slice(0, text.indexOf("[{") + 1)).length);
  });

  it("salta ciò che non è una scheda e non legge ciò che non è una lavagna", () => {
    expect(boardCards(`{"nodes":[{"id":"a"},{"id":"b","type":"text","x":0,"y":0,"width":1,"height":1}]}`)!.nodes.map((each) => each.id)).toEqual(["b"]);
    expect(boardCards(`{"edges":[]}`)).toEqual({ nodes: [], starts: [] });
    expect(boardCards(`{"nodes":[`)).toBeNull();
    expect(boardCards(`[]`)).toBeNull();
    expect(boardCards(``)).toBeNull();
  });
});

describe("i nomi e il filtro", () => {
  it("chiama le schede come le legge chi guarda", () => {
    expect(BOARD.map(cardName)).toEqual(["Pendolo semplice", "Statistica", "Varianza", "Domande per giovedì", "Correzione di Bessel.pdf", "Esercizi sulla varianza"]);
    expect(cardName(node("w", 0, 0, { type: "link", url: "https://example.org/a" }))).toBe("example.org");
  });

  it("tiene ciò che il nome e la specie dicono, coi gruppi che lo contengono", () => {
    const entries = readingOrder(BOARD);
    expect(filterEntries(entries, "VARIANZA", "all").map((entry) => entry.node.id)).toEqual(["statistica", "varianza", "esercizi"]);
    expect(filterEntries(entries, "giovedi", "all").map((entry) => entry.node.id)).toEqual(["statistica", "domande"]);
    expect(filterEntries(entries, "", "note").map((entry) => entry.node.id)).toEqual(["statistica", "varianza", "pendolo"]);
    expect(filterEntries(entries, "", "pdf").map((entry) => entry.node.id)).toEqual(["statistica", "bessel"]);
    expect(filterEntries(entries, "", "group").map((entry) => entry.node.id)).toEqual(["statistica"]);
    expect(filterEntries(entries, "nessuna", "all")).toEqual([]);
  });
});

describe("la parte «Schede»", () => {
  function inspectorOn(text: string | null, reveal = vi.fn((_byte: number) => true)) {
    let current = text;
    const inspector = createCanvasInspector({ source: () => current, reveal });
    inspector.offer(true);
    return { inspector, reveal, set: (next: string) => (current = next) };
  }

  it("elenca le schede in ordine di lettura, coi gruppi come cartelle", () => {
    const { inspector } = inspectorOn(source());
    const [panel] = inspector.panels.list();
    expect(panel!.id).toBe(CARDS_PANEL_ID);
    const { host } = mountPanel(panel!);
    expect(names(host)).toEqual(["Statistica", "Varianza", "Domande per giovedì", "Correzione di Bessel.pdf", "Pendolo semplice", "Esercizi sulla varianza"]);
    const rows = [...host.querySelectorAll<HTMLElement>(".canvas-inspector-row")];
    expect(rows.map((row) => row.dataset.depth)).toEqual(["0", "1", "1", "1", "0", "0"]);
    expect(rows[0]!.hasAttribute("data-group")).toBe(true);
    expect(rows[1]!.querySelector(".canvas-inspector-kind")!.textContent).toBe("nota");
    expect(rows[0]!.querySelector(".canvas-inspector-kind")).toBeNull();
    expect(host.querySelector(".canvas-inspector-list")!.getAttribute("role")).toBe("listbox");
    expect(rows.every((row) => row.getAttribute("role") === "option")).toBe(true);
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  it("filtra per nome e per specie, e dice quando non resta niente", () => {
    const { inspector } = inspectorOn(source());
    const { host } = mountPanel(inspector.panels.list()[0]!);
    const search = host.querySelector<HTMLInputElement>(".canvas-inspector-filter > input")!;
    const kind = host.querySelector<HTMLSelectElement>(".canvas-inspector-filter > select")!;
    expect(search.getAttribute("aria-label")).toBe("Filtra per nome");
    expect([...kind.options].map((option) => option.textContent)).toEqual(["Tutte le specie", "Note", "Testi", "Gruppi", "PDF"]);
    search.value = "bessel";
    search.dispatchEvent(new Event("input"));
    expect(names(host)).toEqual(["Statistica", "Correzione di Bessel.pdf"]);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    kind.value = "text";
    kind.dispatchEvent(new Event("change"));
    expect(names(host)).toEqual(["Statistica", "Domande per giovedì", "Esercizi sulla varianza"]);
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    expect(names(host)).toEqual([]);
    const note = host.querySelector<HTMLElement>(".canvas-inspector-note")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("Nessuna scheda col filtro di adesso.");
  });

  it("un clic chiede il salto al byte della scheda e la segna scelta, finché la scelta non cambia altrove", () => {
    const text = source();
    const { inspector, reveal } = inspectorOn(text);
    const { host } = mountPanel(inspector.panels.list()[0]!);
    const row = [...host.querySelectorAll<HTMLElement>(".canvas-inspector-row")].find((each) => each.dataset.node === "varianza")!;
    row.click();
    expect(reveal).toHaveBeenCalledTimes(1);
    const start = reveal.mock.calls[0]![0];
    expect(text.slice(start)).toMatch(/^\{\s*"id": "varianza"/);
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.tabIndex).toBe(0);
    inspector.selectionChanged();
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("Invio e le frecce: il fuoco scende sulle righe, Invio salta", () => {
    const { inspector, reveal } = inspectorOn(source());
    const { host } = mountPanel(inspector.panels.list()[0]!);
    const rows = () => [...host.querySelectorAll<HTMLElement>(".canvas-inspector-row")];
    rows()[0]!.focus();
    rows()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);
    rows()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(rows()[5]);
    rows()[5]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(rows()[5]!.getAttribute("aria-selected")).toBe("true");
  });

  it("si rilegge quando la lavagna cambia, e smontato non lascia niente", () => {
    const { inspector, set } = inspectorOn(source());
    const { host, unmount } = mountPanel(inspector.panels.list()[0]!);
    set(source([...BOARD, node("nuova", 0, 900, { text: "Nuova" })]));
    expect(names(host)).toHaveLength(6);
    host.querySelector<HTMLElement>(".canvas-inspector-row[tabindex='0']")!.focus();
    inspector.changed();
    expect(names(host)).toHaveLength(7);
    // Il fuoco che stava nell'elenco resta sulla sua riga, rifatta.
    expect((document.activeElement as HTMLElement).dataset.node).toBe("statistica");
    unmount();
    expect(host.childElementCount).toBe(0);
    // Smontato, un avviso non tocca più niente.
    inspector.changed();
    expect(host.childElementCount).toBe(0);
  });

  it("dice che la lavagna è vuota", () => {
    const { inspector } = inspectorOn(source([]));
    const { host } = mountPanel(inspector.panels.list()[0]!);
    expect(names(host)).toEqual([]);
    expect(host.querySelector<HTMLElement>(".canvas-inspector-note")!.textContent).toBe("La lavagna non ha ancora schede.");
  });

  it("con 2000 schede disegna solo una finestra dell'elenco, e il filtro arriva alla fine", () => {
    const many = Array.from({ length: 2000 }, (_, i) => node(`c${i}`, (i % 20) * 220, Math.floor(i / 20) * 100, { text: `Scheda ${i}` }));
    const { inspector, reveal } = inspectorOn(source(many));
    const { host } = mountPanel(inspector.panels.list()[0]!);
    const list = host.querySelector<HTMLElement>(".canvas-inspector-list")!;
    expect(list.hasAttribute("data-virtual")).toBe(true);
    const drawn = host.querySelectorAll(".canvas-inspector-row");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(200);
    expect(drawn[0]!.getAttribute("aria-setsize")).toBe("2000");
    // Scorso a metà: si disegnano le righe che si vedono, e la fermata del
    // Tab (la prima riga) resta, se no da tastiera non ci si arriva più.
    host.style.overflowY = "auto";
    const box = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    host.getBoundingClientRect = () => box(0, 290);
    list.getBoundingClientRect = () => box(-29 * 1000, 29 * 2000);
    document.dispatchEvent(new Event("scroll"));
    const nodes = [...host.querySelectorAll<HTMLElement>(".canvas-inspector-row")].map((row) => row.dataset.node);
    expect(nodes).toContain("c1000");
    expect(nodes).not.toContain("c500");
    expect(host.querySelector<HTMLElement>(".canvas-inspector-row[tabindex='0']")!.dataset.node).toBe("c0");
    const search = host.querySelector<HTMLInputElement>(".canvas-inspector-filter > input")!;
    search.value = "Scheda 1999";
    search.dispatchEvent(new Event("input"));
    expect(names(host)).toEqual(["Scheda 1999"]);
    expect(list.hasAttribute("data-virtual")).toBe(false);
    host.querySelector<HTMLElement>(".canvas-inspector-row")!.click();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(VIRTUAL_AFTER).toBeLessThan(2000);
  });

  it("si offre solo quando la superficie lo dice, e chiuso non si offre più", () => {
    const inspector = createCanvasInspector({ source: () => source(), reveal: () => true });
    const changed = vi.fn();
    inspector.panels.subscribe(changed);
    expect(inspector.panels.list()).toEqual([]);
    inspector.offer(true);
    expect(inspector.panels.list()).toHaveLength(1);
    inspector.offer(true);
    expect(changed).toHaveBeenCalledTimes(1);
    inspector.dispose();
    expect(inspector.panels.list()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("la superficie della lavagna con l'ispettore", () => {
  function mountBoard(text: string): { surface: EditorSurface; parent: HTMLElement } {
    const parent = document.createElement("div");
    document.body.append(parent);
    const surface = mountCanvasSurface("canvas", { paneId: "p", documentId: "board.canvas", parent }, {
      onChange: () => {},
      onSelectionChange: () => {},
    });
    surface.buffer!.setDoc(text);
    return { surface, parent };
  }

  it("offre «Schede» con la tela, e un clic sceglie la scheda sulla lavagna", () => {
    const { surface, parent } = mountBoard(source());
    const panels = surface.panels!;
    expect(panels.list().map((panel) => panel.id)).toEqual([CARDS_PANEL_ID]);
    expect(panels.covers).toContain("outline");
    const { host } = mountPanel(panels.list()[0]!);
    const row = [...host.querySelectorAll<HTMLElement>(".canvas-inspector-row")].find((each) => each.dataset.node === "domande")!;
    row.click();
    expect(parent.querySelector('.canvas-node[data-node="domande"]')!.classList.contains("selected")).toBe(true);
    expect(parent.querySelectorAll(".canvas-node.selected")).toHaveLength(1);
    expect(row.getAttribute("aria-selected")).toBe("true");
    // Esc sulla lavagna toglie la scelta, e il segno dall'elenco.
    parent.querySelector<HTMLElement>(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(parent.querySelectorAll(".canvas-node.selected")).toHaveLength(0);
    expect(row.getAttribute("aria-selected")).toBe("false");
    surface.destroy();
    expect(panels.list()).toEqual([]);
  });

  it("nel sorgente non offre niente, e l'elenco segue il testo che arriva", () => {
    const { surface } = mountBoard(source());
    const panels = surface.panels!;
    const { host, unmount } = mountPanel(panels.list()[0]!);
    surface.buffer!.syncDoc(source(BOARD.slice(0, 2)));
    expect(names(host)).toEqual(["Statistica", "Pendolo semplice"]);
    surface.setMode("source");
    expect(panels.list()).toEqual([]);
    surface.setMode("canvas");
    expect(panels.list()).toHaveLength(1);
    // Aprire e chiudere l'elenco più volte non lascia righe né ascoltatori.
    unmount();
    for (let i = 0; i < 3; i++) mountPanel(panels.list()[0]!).unmount();
    expect(document.querySelectorAll(".canvas-inspector")).toHaveLength(0);
    surface.destroy();
  });
});
