// @vitest-environment happy-dom
// La tela tiene le schede (N6 T11): la resa è a chiavi, e una vista montata
// sopravvive a una modifica che non riguarda la sua scheda.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { CARD_PAUSE_MS, CanvasEngine, type CanvasCards, type CanvasChange, type CanvasEngineOptions } from "./engine";
import {
  createCardRegistry,
  type CardContext,
  type CardKind,
  type CardMode,
  type CardRenderer,
  type CardSnapshot,
  type CardSnapshots,
  type CardView,
} from "./cards";
import type { CanvasNode } from "./model";
import { canvasCoreReady, openCoreNow } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Una vista montata dal renderer finto: per quale scheda, con che file, e se è stata distrutta. */
interface Mounted {
  readonly node: string;
  readonly file: string | undefined;
  readonly url: string | undefined;
  readonly host: HTMLElement;
  readonly mode: CardMode;
  readonly context: CardContext;
  destroyed: number;
}

/** Un renderer finto che conta `mount` e `destroy`, per tutte le specie di file. */
function fakeRenderer(kinds: readonly CardKind[] = ["note", "image", "pdf", "web"]) {
  const mounts: Mounted[] = [];
  const renderer: CardRenderer = {
    kinds,
    mount(node: CanvasNode, host: HTMLElement, mode: CardMode, context: CardContext): CardView {
      const record: Mounted = { node: node.id, file: node.file, url: node.url, host, mode, context, destroyed: 0 };
      mounts.push(record);
      const content = document.createElement("div");
      content.className = "fake-card";
      content.textContent = `${node.id}:${node.file ?? node.url ?? ""}`;
      host.append(content);
      return {
        setMode: () => {},
        destroy: () => {
          record.destroyed++;
        },
      };
    },
  };
  return { renderer, mounts };
}

function memorySnapshots(): CardSnapshots {
  const map = new Map<string, CardSnapshot>();
  return {
    get: (path, part) => map.get(`${path}\n${part}`),
    put: (path, part, snapshot) => map.set(`${path}\n${part}`, snapshot),
    forget: (path) => {
      for (const key of [...map.keys()]) if (key.startsWith(`${path}\n`)) map.delete(key);
    },
  };
}

function cardsOf(...renderers: CardRenderer[]): CanvasCards {
  return { registry: createCardRegistry(renderers), snapshots: memorySnapshots() };
}

function boardSource(nodes: readonly Record<string, unknown>[] = defaultNodes()): string {
  return JSON.stringify({ nodes, edges: [] });
}

function defaultNodes(): Record<string, unknown>[] {
  return [
    { id: "n", type: "file", x: 0, y: 0, width: 240, height: 160, file: "Note/idea.md" },
    { id: "i", type: "file", x: 320, y: 0, width: 240, height: 160, file: "img/foto.png" },
    { id: "t", type: "text", x: 0, y: 240, width: 240, height: 120, text: "testo" },
    { id: "w", type: "link", x: 320, y: 240, width: 240, height: 120, url: "https://example.com/" },
  ];
}

function readNodes(text: string): CanvasNode[] {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model().nodes;
  } finally {
    core.close();
  }
}

function mounted(source: string, overrides: Partial<CanvasEngineOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "test",
    formatId: "canvas",
    revision: "rev-1",
    documentId: "board.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    onPickFile: () => null,
    ...overrides,
  });
  engine.setDoc(source);
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
  return { engine, host, viewport, changes };
}

function card(host: HTMLElement, id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
}

function bodyOf(host: HTMLElement, id: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(":scope > .canvas-card-body")!;
}

/** Le viste ancora vive, per scheda. */
function alive(mounts: readonly Mounted[]): string[] {
  return mounts.filter((entry) => entry.destroyed === 0).map((entry) => entry.node).sort();
}

/** Una modifica che arriva da fuori (un'altra superficie): il testo nuovo con la scheda `id` cambiata. */
function syncNode(engine: CanvasEngine, id: string, change: Partial<CanvasNode>): void {
  const doc = JSON.parse(engine.getDoc()) as { nodes: Record<string, unknown>[] };
  doc.nodes = doc.nodes.map((node) => (node.id === id ? { ...node, ...change } : node));
  engine.syncDoc(JSON.stringify(doc));
}

function drag(viewport: HTMLElement, from: HTMLElement, dx: number, dy: number, pointerId: number): void {
  from.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId, clientX: 10, clientY: 10 }));
  viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX: 10 + dx, clientY: 10 + dy }));
  viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, clientX: 10 + dx, clientY: 10 + dy }));
}

describe("la tela tiene le schede", () => {
  it("monta ogni scheda di file e di link una volta, ferma, con specie e modo sulla scheda", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    expect(mounts.map((entry) => entry.node)).toEqual(["n", "i", "w"]);
    expect(mounts.every((entry) => entry.mode === "snapshot")).toBe(true);
    expect(card(host, "n").dataset.cardKind).toBe("note");
    expect(card(host, "i").dataset.cardKind).toBe("image");
    expect(card(host, "w").dataset.cardKind).toBe("web");
    expect(card(host, "n").dataset.cardMode).toBe("snapshot");
    // Il testo si disegna come prima: nessuna specie, nessuna vista.
    expect(card(host, "t").dataset.cardKind).toBeUndefined();
    expect(mounts[0]!.host).toBe(bodyOf(host, "n"));
    expect(bodyOf(host, "n").querySelector(".fake-card")).not.toBeNull();
    // Il contesto: il file senza subpath, la lavagna, la misura e lo zoom.
    const context = mounts[0]!.context;
    expect(context.path).toBe("Note/idea.md");
    expect(context.subpath).toBeNull();
    expect(context.documentId).toBe("board.canvas");
    expect(context.size()).toEqual({ width: 240, height: 160 });
    expect(context.zoom()).toBeGreaterThan(0);
    expect(context.lifetime.closed).toBe(false);
    expect(mounts[2]!.context.path).toBe("");
    engine.destroy();
  });

  it("spostare, ridimensionare, colorare o scrivere in un'altra scheda non rimonta niente", () => {
    vi.useFakeTimers();
    try {
      const { renderer, mounts } = fakeRenderer();
      const { engine, host, viewport, changes } = mounted(boardSource(), { cards: cardsOf(renderer) });
      const noteBody = bodyOf(host, "n");
      const imageCard = card(host, "i");

      // Spostare l'immagine col mouse.
      drag(viewport, imageCard.querySelector<HTMLElement>(".canvas-node-handle")!, 40, 0, 3);
      expect(changes).toHaveLength(1);
      expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.x).toBe(360);
      // Ridimensionarla dalla maniglia.
      drag(viewport, imageCard.querySelector<HTMLElement>("[data-resize]")!, 40, 40, 4);
      expect(changes).toHaveLength(2);
      expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.width).toBe(280);
      // La misura nuova arriva alla vista dal contesto, senza rimontarla.
      expect(mounts[1]!.context.size()).toEqual({ width: 280, height: 200 });
      // Colorarla dal menu.
      vi.spyOn(document, "elementFromPoint").mockReturnValue(imageCard);
      const menu = engine.contextMenu({ x: 10, y: 10 })!;
      const color = (menu.context as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color")!;
      (color.items as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color.4")!.run!();
      expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.color).toBe("4");
      // Scrivere nella scheda di testo: la pausa registra, Esc chiude il campo.
      card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
      input.value = "testo nuovo";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(CARD_PAUSE_MS);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(readNodes(engine.getDoc()).find((node) => node.id === "t")!.text).toBe("testo nuovo");
      expect(host.querySelector(".canvas-text-editor")).toBeNull();
      expect(bodyOf(host, "t").textContent).toContain("testo nuovo");
      // Una modifica da fuori che sposta la nota e colora il link.
      syncNode(engine, "n", { x: 8, y: 8 });
      syncNode(engine, "w", { color: "2", width: 320 });
      expect(card(host, "n").style.transform).toBe("translate(8px, 8px)");

      expect(mounts.map((entry) => entry.node)).toEqual(["n", "i", "w"]);
      expect(mounts.every((entry) => entry.destroyed === 0)).toBe(true);
      expect(bodyOf(host, "n")).toBe(noteBody);
      expect(card(host, "i")).toBe(imageCard);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cambiare il file rimonta la sola scheda, col file nuovo", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    const article = card(host, "i");
    syncNode(engine, "i", { file: "img/altra.png" });
    expect(mounts.map((entry) => [entry.node, entry.file, entry.destroyed])).toEqual([
      ["n", "Note/idea.md", 0],
      ["i", "img/foto.png", 1],
      ["w", undefined, 0],
      ["i", "img/altra.png", 0],
    ]);
    // La vita della vista vecchia è chiusa; la scheda resta lo stesso elemento.
    expect(mounts[1]!.context.lifetime.closed).toBe(true);
    expect(card(host, "i")).toBe(article);
    expect(bodyOf(host, "i").textContent).toBe("i:img/altra.png");
    // Il subpath e l'indirizzo contano come il file.
    syncNode(engine, "n", { subpath: "#Titolo" });
    syncNode(engine, "w", { url: "https://example.org/" });
    expect(mounts.slice(4).map((entry) => [entry.node, entry.context.subpath])).toEqual([["n", "#Titolo"], ["w", null]]);
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    // Il file cambiato dal campo della scheda: il campo prende il posto della
    // vista, e alla chiusura nasce quella del file nuovo.
    card(host, "i").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLInputElement>(".canvas-field-editor")!;
    expect(mounts[3]!.destroyed).toBe(1);
    field.value = "img/terza.png";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(mounts[mounts.length - 1]!.file).toBe("img/terza.png");
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("togliere distrugge; l'annulla che la riporta monta una vista nuova", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, viewport } = mounted(boardSource(), { cards: cardsOf(renderer) });
    card(host, "i").focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(card(host, "i")).toBeNull();
    expect(mounts[1]!.destroyed).toBe(1);
    expect(alive(mounts)).toEqual(["n", "w"]);
    expect(engine.undo()).toBe(true);
    expect(card(host, "i")).not.toBeNull();
    expect(mounts).toHaveLength(4);
    expect(mounts[3]!.node).toBe("i");
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    // L'ordine sulla scena è quello del file anche dopo il ritorno.
    expect([...host.querySelectorAll<HTMLElement>(".canvas-node")].map((el) => el.dataset.node)).toEqual(["n", "i", "t", "w"]);
    engine.destroy();
  });

  it("setDoc con le stesse schede non rimonta; un id cambiato con lo stesso file sì", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.setDoc(boardSource());
    expect(mounts).toHaveLength(3);
    const nodes = defaultNodes();
    nodes[1] = { ...nodes[1], id: "i2" };
    engine.setDoc(boardSource(nodes));
    expect(mounts.map((entry) => [entry.node, entry.destroyed])).toEqual([["n", 0], ["i", 1], ["w", 0], ["i2", 0]]);
    expect(card(host, "i")).toBeNull();
    expect(card(host, "i2").dataset.cardKind).toBe("image");
    engine.destroy();
  });

  it("l'ordine cambia senza rimontare: la scheda portata davanti è l'ultima", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    const nodes = defaultNodes();
    engine.syncDoc(boardSource([nodes[1]!, nodes[3]!, nodes[2]!, nodes[0]!]));
    expect([...host.querySelectorAll<HTMLElement>(".canvas-node")].map((el) => el.dataset.node)).toEqual(["i", "w", "t", "n"]);
    expect(mounts).toHaveLength(3);
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("destroy della tela distrugge ogni vista una volta", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.destroy();
    engine.destroy();
    expect(mounts.map((entry) => entry.destroyed)).toEqual([1, 1, 1]);
    expect(mounts.every((entry) => entry.context.lifetime.closed)).toBe(true);
    // Dopo la tela, niente rinasce.
    engine.syncDoc(boardSource());
    expect(mounts).toHaveLength(3);
  });

  it("un renderer che lancia in mount lascia la scheda di file di sempre, e la tela va avanti", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { renderer, mounts } = fakeRenderer(["note", "web"]);
    const broken: CardRenderer = {
      kinds: ["image"],
      mount: () => {
        throw new Error("rotto");
      },
    };
    const { engine, host, viewport, changes } = mounted(boardSource(), { cards: cardsOf(renderer, broken) });
    expect(warn).toHaveBeenCalled();
    expect(card(host, "i").dataset.cardKind).toBeUndefined();
    expect(bodyOf(host, "i").querySelector(".canvas-file-link")?.textContent).toBe("img/foto.png");
    expect(alive(mounts)).toEqual(["n", "w"]);
    // La tela risponde ancora ai gesti.
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(alive(mounts)).toEqual(["n", "w"]);
    engine.destroy();
  });

  it("una vista che lancia nel distruggersi non ferma le altre", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const destroyed: string[] = [];
    const renderer: CardRenderer = {
      kinds: ["note", "image", "web"],
      mount: (node) => ({
        setMode: () => {},
        destroy: () => {
          destroyed.push(node.id);
          if (node.id === "n") throw new Error("rotto");
        },
      }),
    };
    const { engine } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.destroy();
    expect(destroyed).toEqual(["n", "i", "w"]);
  });

  it("missing() mostra il segnaposto di sempre, finché la vista è della scheda", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    mounts[1]!.context.missing();
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(bodyOf(host, "i").querySelector(".canvas-media-placeholder")?.textContent).toBe("IMAGE · img/foto.png");
    expect(bodyOf(host, "i").querySelector(".canvas-file-link")).not.toBeNull();
    // Una vista già distrutta non parla più.
    syncNode(engine, "n", { file: "Note/altra.md" });
    mounts[0]!.context.missing();
    expect(card(host, "n").dataset.cardMissing).toBeUndefined();
    expect(bodyOf(host, "n").textContent).toBe("n:Note/altra.md");
    engine.destroy();
  });

  it("in sola lettura le viste restano e le maniglie se ne vanno", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    engine.setReadOnly(true);
    expect(host.querySelector("[data-resize]")).toBeNull();
    expect(host.querySelector(".canvas-convert-note")).toBeNull();
    engine.setReadOnly(false);
    expect(host.querySelectorAll("[data-resize]")).toHaveLength(4);
    expect(mounts).toHaveLength(3);
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("oltre il limite delle schede nessuna vista; tornati sotto, rinascono", () => {
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsOf(renderer) });
    const many = Array.from({ length: 2001 }, (_, index) => ({
      id: `c${index}`, type: "file", x: index * 8, y: 0, width: 40, height: 40, file: `img/${index}.png`,
    }));
    engine.setDoc(boardSource(many));
    expect(host.querySelector(".canvas-large-fallback")).not.toBeNull();
    expect(host.querySelector(".canvas-node")).toBeNull();
    expect(mounts).toHaveLength(3);
    expect(alive(mounts)).toEqual([]);
    engine.setDoc(boardSource());
    expect(host.querySelector(".canvas-large-fallback")).toBeNull();
    expect(alive(mounts)).toEqual(["i", "n", "w"]);
    engine.destroy();
  });

  it("senza le schede la tela disegna i corpi di sempre, e li tiene", () => {
    const { engine, host, viewport } = mounted(boardSource());
    expect(card(host, "i").dataset.cardKind).toBeUndefined();
    expect(bodyOf(host, "i").querySelector(".canvas-file-link")?.textContent).toBe("img/foto.png");
    const textBody = bodyOf(host, "t");
    const fileBody = bodyOf(host, "i");
    const article = card(host, "n");
    drag(viewport, card(host, "w").querySelector<HTMLElement>(".canvas-node-handle")!, 16, 16, 5);
    expect(bodyOf(host, "t")).toBe(textBody);
    expect(bodyOf(host, "i")).toBe(fileBody);
    expect(card(host, "n")).toBe(article);
    // Le sintassi nuove rifanno i corpi di testo.
    engine.setSyntaxForms([]);
    expect(bodyOf(host, "t")).not.toBe(textBody);
    expect(bodyOf(host, "i")).toBe(fileBody);
    engine.destroy();
  });
});
