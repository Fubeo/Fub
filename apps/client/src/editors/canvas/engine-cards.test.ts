// @vitest-environment happy-dom
// La tela tiene le schede (N6 T11): la resa è a chiavi, e una vista montata
// sopravvive a una modifica che non riguarda la sua scheda. Vivono solo le
// schede utili (N6 T13): quelle in vista, a gesto finito, con la penna su.
// Il file che manca (N6 T16): il segnaposto con «Ritrova…» e «Togli», e la
// vista che si rimonta quando il file torna.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { CARD_PAUSE_MS, CanvasEngine, WHEEL_SETTLE_MS, type CanvasCards, type CanvasChange, type CanvasEngineOptions } from "./engine";
import {
  createCardRegistry,
  LIVE_ZOOM_MIN,
  MAX_LIVE_CARDS,
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
import { canvasViewKey, createCanvasViewMemory } from "./view-state";

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
        // Un PDF mostra la pagina con cui è partito (T36).
        ...(node.file?.endsWith(".pdf") ? { page: () => context.initialPage ?? 1 } : {}),
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

/** I file del vault che il test fa cambiare: chi li ascolta con `watch`, e `fire` che avvisa. */
function fakeFiles() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    watch(path: string, changed: () => void): () => void {
      const set = listeners.get(path) ?? new Set<() => void>();
      set.add(changed);
      listeners.set(path, set);
      return () => {
        set.delete(changed);
      };
    },
    fire(path: string): void {
      for (const changed of [...(listeners.get(path) ?? [])]) changed();
    },
    /** Quanti ascolti ha ancora `path`. */
    count(path: string): number {
      return listeners.get(path)?.size ?? 0;
    },
  };
}

function cardsWith(files: ReturnType<typeof fakeFiles>, ...renderers: CardRenderer[]): CanvasCards {
  return { registry: createCardRegistry(renderers), snapshots: memorySnapshots(), watch: (path, changed) => files.watch(path, changed) };
}

function cardsOf(...renderers: CardRenderer[]): CanvasCards {
  return cardsWith(fakeFiles(), ...renderers);
}

/** Lascia correre le promesse in attesa (il selettore, il commit). */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Il gesto «Ritrova…» o «Togli» del segnaposto di una scheda mancante, se c'è. */
function actionOf(host: HTMLElement, id: string, action: "relink" | "remove"): HTMLButtonElement | null {
  return bodyOf(host, id).querySelector<HTMLButtonElement>(`[data-card-action="${action}"]`);
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
    // Montata ferma, poi accesa dalla tela perché è in vista (T13).
    expect(card(host, "n").dataset.cardMode).toBe("live");
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
    // vista, e alla chiusura nasce quella del file nuovo. Il doppio clic su
    // un'immagine è del visore (T14): il campo lo apre Invio, perché
    // nell'immagine non si entra.
    card(host, "i").focus();
    card(host, "i").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
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

  it("missing() dice che il file manca, smonta la vista e ascolta il file; una vista già distrutta non parla più", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(card(host, "i").dataset.cardKind).toBeUndefined();
    expect(mounts[1]!.destroyed).toBe(1);
    expect(bodyOf(host, "i").querySelector(".canvas-media-placeholder")?.textContent).toBe("File mancante: img/foto.png");
    expect(actionOf(host, "i", "relink")).not.toBeNull();
    expect(actionOf(host, "i", "remove")).not.toBeNull();
    expect(files.count("img/foto.png")).toBe(1);
    // Una vista già distrutta non parla più: né per la sua scheda, né dopo.
    mounts[1]!.context.missing();
    expect(mounts).toHaveLength(3);
    syncNode(engine, "n", { file: "Note/altra.md" });
    mounts[0]!.context.missing();
    expect(card(host, "n").dataset.cardMissing).toBeUndefined();
    expect(bodyOf(host, "n").textContent).toBe("n:Note/altra.md");
    engine.destroy();
    expect(files.count("img/foto.png")).toBe(0);
  });

  it("il file che torna rimonta la vista da sé; se manca ancora, la scheda torna mancante", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    files.fire("img/foto.png");
    expect(mounts).toHaveLength(4);
    expect(mounts[3]!.node).toBe("i");
    expect(card(host, "i").dataset.cardMissing).toBeUndefined();
    expect(card(host, "i").dataset.cardKind).toBe("image");
    expect(bodyOf(host, "i").textContent).toBe("i:img/foto.png");
    expect(files.count("img/foto.png")).toBe(0);
    // Il file c'è ancora nella lista ma non si apre: il renderer dice di nuovo «manca».
    mounts[3]!.context.missing();
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(files.count("img/foto.png")).toBe(1);
    engine.destroy();
  });

  it("«Ritrova…» chiede il file col nome di quello che manca, lo mette al posto del percorso in un commit solo, e un annulla lo riporta", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const asked: (string | undefined)[] = [];
    const { engine, host, changes } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: (name) => {
        asked.push(name);
        return "Archivio/foto.png";
      },
    });
    mounts[1]!.context.missing();
    actionOf(host, "i", "relink")!.click();
    await settle();
    expect(asked).toEqual(["foto.png"]);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("Archivio/foto.png");
    expect(changes).toHaveLength(1);
    // La scheda ha la vista del file nuovo, e non è più mancante.
    const last = mounts[mounts.length - 1]!;
    expect(last.node).toBe("i");
    expect(last.file).toBe("Archivio/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBeUndefined();
    expect(files.count("img/foto.png")).toBe(0);
    // Un annulla riporta il file di prima.
    expect(engine.undo()).toBe(true);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    engine.destroy();
  });

  it("«Ritrova…» annullato, o senza un file scelto, non cambia niente", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, changes } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    actionOf(host, "i", "relink")!.click();
    await settle();
    expect(changes).toHaveLength(0);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    engine.destroy();
  });

  it("il file torna mentre il selettore è aperto: la scelta vecchia non tocca la scheda", async () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    let answer: (path: string | null) => void = () => {};
    const { engine, host, changes } = mounted(boardSource(), {
      cards: cardsWith(files, renderer),
      onPickFile: () => new Promise<string | null>((resolve) => {
        answer = resolve;
      }),
    });
    mounts[1]!.context.missing();
    actionOf(host, "i", "relink")!.click();
    files.fire("img/foto.png");
    expect(card(host, "i").dataset.cardMissing).toBeUndefined();
    expect(card(host, "i").dataset.cardKind).toBe("image");
    answer("Archivio/altra.png");
    await settle();
    expect(changes).toHaveLength(0);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "i")!.file).toBe("img/foto.png");
    engine.destroy();
  });

  it("«Togli dalla lavagna» toglie la scheda come Canc, e un annulla la riporta", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host, changes } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    actionOf(host, "i", "remove")!.click();
    expect(readNodes(engine.getDoc()).map((node) => node.id)).toEqual(["n", "t", "w"]);
    expect(changes).toHaveLength(1);
    expect(host.querySelector('.canvas-node[data-node="i"]')).toBeNull();
    expect(mounts[1]!.destroyed).toBe(1);
    expect(files.count("img/foto.png")).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(readNodes(engine.getDoc()).map((node) => node.id).sort()).toEqual(["i", "n", "t", "w"]);
    engine.destroy();
  });

  it("in sola lettura il segnaposto dice che il file manca e non ha gesti; tornando scrivibile li riprende", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    engine.setReadOnly(true);
    expect(bodyOf(host, "i").querySelector(".canvas-media-placeholder")?.textContent).toBe("File mancante: img/foto.png");
    expect(host.querySelector("[data-card-action]")).toBeNull();
    engine.setReadOnly(false);
    expect(actionOf(host, "i", "relink")).not.toBeNull();
    expect(actionOf(host, "i", "remove")).not.toBeNull();
    engine.destroy();
  });

  it("senza un selettore di file «Ritrova…» non c'è, e «Togli» sì", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: undefined });
    mounts[1]!.context.missing();
    expect(actionOf(host, "i", "relink")).toBeNull();
    expect(actionOf(host, "i", "remove")).not.toBeNull();
    engine.destroy();
  });

  it("una scheda di link non manca mai: il suo missing() non fa niente", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    const link = mounts.find((entry) => entry.node === "w")!;
    link.context.missing();
    expect(card(host, "w").dataset.cardMissing).toBeUndefined();
    expect(link.destroyed).toBe(0);
    engine.destroy();
  });

  it("un renderer che dice «manca» mentre monta: la scheda è mancante quando la vista c'è, e la vista si smonta una volta", () => {
    const files = fakeFiles();
    let destroyed = 0;
    const renderer: CardRenderer = {
      kinds: ["image"],
      mount: (_node, _host, _mode, context) => {
        context.missing();
        return {
          setMode: () => {},
          destroy: () => {
            destroyed++;
          },
        };
      },
    };
    const { engine, host } = mounted(boardSource([defaultNodes()[1]!]), { cards: cardsWith(files, renderer), onPickFile: () => null });
    expect(card(host, "i").dataset.cardMissing).toBe("true");
    expect(destroyed).toBe(1);
    expect(files.count("img/foto.png")).toBe(1);
    engine.destroy();
    expect(destroyed).toBe(1);
  });

  it("molte schede mancanti insieme: ognuna ha il suo file, e ritorna solo quella il cui file torna", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer(["image"]);
    const many = Array.from({ length: 5 }, (_, index) => ({
      id: `f${index}`, type: "file", x: index * 300, y: 0, width: 240, height: 160, file: `Cartella/f${index}.png`,
    }));
    const { engine, host } = mounted(boardSource(many), { cards: cardsWith(files, renderer), onPickFile: () => null });
    for (const entry of mounts) entry.context.missing();
    for (let index = 0; index < 5; index++) {
      expect(card(host, `f${index}`).dataset.cardMissing).toBe("true");
      expect(files.count(`Cartella/f${index}.png`)).toBe(1);
    }
    files.fire("Cartella/f2.png");
    expect(mounts).toHaveLength(6);
    expect(mounts[5]!.node).toBe("f2");
    expect(card(host, "f2").dataset.cardMissing).toBeUndefined();
    for (const index of [0, 1, 3, 4]) expect(card(host, `f${index}`).dataset.cardMissing).toBe("true");
    engine.destroy();
  });

  it("un file mancante non si rifà a ogni resa: spostare un'altra scheda lascia il suo segnaposto com'è", () => {
    const files = fakeFiles();
    const { renderer, mounts } = fakeRenderer();
    const { engine, host } = mounted(boardSource(), { cards: cardsWith(files, renderer), onPickFile: () => null });
    mounts[1]!.context.missing();
    const placeholder = bodyOf(host, "i");
    syncNode(engine, "n", { x: 40 });
    expect(bodyOf(host, "i")).toBe(placeholder);
    expect(mounts).toHaveLength(3);
    expect(card(host, "i").dataset.cardMissing).toBe("true");
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

// --- Vive solo le schede utili (N6 T13) -----------------------------------------

/** Un renderer che scrive ogni `setMode` e ogni `resize` delle sue viste. */
function modeRenderer() {
  const log: [string, CardMode][] = [];
  const resized: string[] = [];
  const renderer: CardRenderer = {
    kinds: ["image"],
    mount: (node) => ({
      setMode: (mode) => {
        log.push([node.id, mode]);
      },
      resize: () => {
        resized.push(node.id);
      },
      destroy: () => {},
    }),
  };
  return { renderer, log, resized };
}

/** Le schede che la tela dice vive (`data-card-mode`), in ordine. */
function liveOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>('.canvas-node[data-card-mode="live"]')]
    .map((el) => el.dataset.node!).sort();
}

function image(id: string, x: number, y: number, width = 200, height = 100): Record<string, unknown> {
  return { id, type: "file", x, y, width, height, file: `img/${id}.png` };
}

/**
 * Due immagini che la tela inquadra a zoom 1 in una vista di 800 × 600 (la
 * misura di riserva della tela, perché happy-dom non ha layout): la vista,
 * in coordinate della lavagna, va da (-100, -250) a (700, 350).
 */
const TWO = [image("a", 0, 0), image("b", 400, 0)];

function zoomOf(host: HTMLElement): number {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  return Number(/scale\(([\d.e+-]+)\)/.exec(transform)![1]);
}

/** Il tasto centrale giù sul viewport, una mossa: la vista si sposta di `dx`, `dy`. Dà il rilascio. */
function panStart(viewport: HTMLElement, dx: number, dy: number, pointerId = 9): () => void {
  viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 1, pointerId, clientX: 400, clientY: 300 }));
  viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX: 400 + dx, clientY: 300 + dy }));
  return () => {
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, clientX: 400 + dx, clientY: 300 + dy }));
  };
}

/** Uno scatto di Ctrl+rotella sul centro della vista. */
function wheelTick(viewport: HTMLElement, zoomIn: boolean): void {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: zoomIn ? -100 : 100 });
  // Il `WheelEvent` di happy-dom non prende i tasti né il punto dall'init.
  Object.defineProperties(event, { ctrlKey: { value: true }, clientX: { value: 400 }, clientY: { value: 300 } });
  viewport.dispatchEvent(event);
}

/** Un evento della penna (o, con `pointerType`, del dito). */
function penEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, altitudeAngle: Math.PI / 2, azimuthAngle: 0,
    pointerId: 7, pointerType: "pen", isPrimary: true, ...init,
  });
}

describe("vivono solo le schede utili", () => {
  it("dopo lo spostamento le schede in vista sono vive e le altre ferme; durante, nessuna cambia", () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    // Inquadrate, tutte e due in vista: vive, e chiamate una volta.
    expect(liveOf(host)).toEqual(["a", "b"]);
    expect(log).toEqual([["a", "live"], ["b", "live"]]);
    log.length = 0;
    // A sinistra di 800 px: la vista va da 700 a 1500, allargata da 300 a
    // 1900. «a» (0–200) ne esce, «b» (400–600) resta.
    const up = panStart(viewport, -800, 0);
    expect(log).toEqual([]);
    expect(liveOf(host)).toEqual(["a", "b"]);
    up();
    expect(log).toEqual([["a", "snapshot"]]);
    expect(liveOf(host)).toEqual(["b"]);
    expect(card(host, "a").dataset.cardMode).toBe("snapshot");
    // Si torna: «a» si riaccende, «b» non riceve niente.
    panStart(viewport, 800, 0)();
    expect(log).toEqual([["a", "snapshot"], ["a", "live"]]);
    engine.destroy();
  });

  it("una scheda trascinata da fuori a dentro la vista si accende a fine gesto", () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    // Una scheda arrivata da fuori, lontana: nasce ferma e resta ferma.
    engine.syncDoc(boardSource([...TWO, image("c", 5000, 0)]));
    expect(liveOf(host)).toEqual(["a", "b"]);
    log.length = 0;
    const handle = card(host, "c").querySelector<HTMLElement>(".canvas-node-handle")!;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 10, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 3, clientX: 10 - 4800, clientY: 10 + 200 }));
    expect(log).toEqual([]);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 10 - 4800, clientY: 10 + 200 }));
    expect(readNodes(engine.getDoc()).find((node) => node.id === "c")!.x).toBe(200);
    expect(log).toEqual([["c", "live"]]);
    expect(liveOf(host)).toEqual(["a", "b", "c"]);
    engine.destroy();
  });

  it("sotto 0,35 nessuna è viva; lo zoom che attraversa 0,35 in un gesto solo non cambia niente", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = modeRenderer();
      const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
      // La misura vera del viewport: i tasti ingrandiscono attorno al suo centro.
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
      log.length = 0;
      // Dodici scatti indietro e dodici avanti, senza fermarsi: lo zoom passa
      // sotto 0,35 e torna, e nessuna scheda cambia modo.
      for (const zoomIn of [...Array<boolean>(12).fill(false), ...Array<boolean>(12).fill(true)]) {
        wheelTick(viewport, zoomIn);
        vi.advanceTimersByTime(WHEEL_SETTLE_MS - 50);
      }
      expect(zoomOf(host)).toBeCloseTo(1);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(log).toEqual([]);
      // Dodici scatti indietro e poi fermi: sotto 0,35, ma solo a gesto finito.
      for (let tick = 0; tick < 12; tick++) {
        wheelTick(viewport, false);
        vi.advanceTimersByTime(WHEEL_SETTLE_MS - 50);
      }
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      expect(log).toEqual([]);
      expect(liveOf(host)).toEqual(["a", "b"]);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(liveOf(host)).toEqual([]);
      expect(log).toEqual([["a", "snapshot"], ["b", "snapshot"]]);
      // Dai tasti lo zoom è un gesto finito: risale e si riaccendono subito.
      log.length = 0;
      for (let step = 0; step < 6; step++) {
        viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true }));
      }
      expect(zoomOf(host)).toBeGreaterThan(LIVE_ZOOM_MIN);
      expect(liveOf(host)).toEqual(["a", "b"]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("300 schede in vista a zoom 0,4: ne vivono 40, e mai più di MAX_LIVE_CARDS", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = modeRenderer();
      // 20 × 15 schede di 40 × 40 ogni 50: la tela le inquadra a zoom 0,66.
      const many = Array.from({ length: 300 }, (_, index) => image(`c${index}`, (index % 20) * 50, Math.floor(index / 20) * 50, 40, 40));
      const { engine, host, viewport } = mounted(boardSource(many), { cards: cardsOf(renderer) });
      let most = 0;
      const live = new Set<string>();
      const replay = () => {
        for (const [id, mode] of log.splice(0)) {
          if (mode === "live") live.add(id);
          else live.delete(id);
          most = Math.max(most, live.size);
        }
      };
      replay();
      expect(live.size).toBe(MAX_LIVE_CARDS);
      for (let tick = 0; tick < 5; tick++) wheelTick(viewport, false);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeGreaterThanOrEqual(LIVE_ZOOM_MIN);
      expect(zoomOf(host)).toBeLessThan(0.42);
      replay();
      expect(liveOf(host)).toHaveLength(MAX_LIVE_CARDS);
      expect(live.size).toBe(MAX_LIVE_CARDS);
      expect(most).toBe(MAX_LIVE_CARDS);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("con la penna giù nessuna scheda cambia modo fino a quando si alza", async () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    log.length = 0;
    viewport.dispatchEvent(penEvent("pointerdown", { clientX: 300, clientY: 500, button: 0, buttons: 1, pressure: 0.5 }));
    panStart(viewport, -800, 0)();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual([]);
    expect(liveOf(host)).toEqual(["a", "b"]);
    document.dispatchEvent(penEvent("pointerup", { clientX: 300, clientY: 500, button: 0, buttons: 0, pressure: 0 }));
    await vi.waitFor(() => expect(log).toEqual([["a", "snapshot"]]));
    expect(liveOf(host)).toEqual(["b"]);
    engine.destroy();
  });

  it("la penna che si posa durante uno spostamento col dito: il cambio aspetta che si alzi", async () => {
    const { renderer, log } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    log.length = 0;
    const touch = { pointerId: 1, pointerType: "touch", isPrimary: false, width: 10, height: 10 } as const;
    viewport.dispatchEvent(penEvent("pointerdown", { ...touch, clientX: 400, clientY: 300, button: 0, buttons: 1, pressure: 0.5 }));
    viewport.dispatchEvent(penEvent("pointermove", { ...touch, clientX: -400, clientY: 300, button: -1, buttons: 1, pressure: 0.5 }));
    // La penna si posa lontano dal dito: il dito si ferma dov'è arrivato.
    viewport.dispatchEvent(penEvent("pointerdown", { clientX: 100, clientY: 550, button: 0, buttons: 1, pressure: 0.5 }));
    viewport.dispatchEvent(penEvent("pointermove", { ...touch, clientX: -380, clientY: 300, button: -1, buttons: 1, pressure: 0.5 }));
    viewport.dispatchEvent(penEvent("pointerup", { ...touch, clientX: -380, clientY: 300, button: 0, buttons: 0, pressure: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(log).toEqual([]);
    document.dispatchEvent(penEvent("pointerup", { clientX: 100, clientY: 550, button: 0, buttons: 0, pressure: 0 }));
    await vi.waitFor(() => expect(log).toEqual([["a", "snapshot"]]));
    expect(liveOf(host)).toEqual(["b"]);
    engine.destroy();
  });

  it("la lavagna nascosta non cambia niente finché non torna in vista", () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class {
      readonly #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
      }
      observe(): void {
        observers.push(this.#callback);
      }
      disconnect(): void {
        observers.splice(observers.indexOf(this.#callback), 1);
      }
    });
    try {
      const { renderer, log } = modeRenderer();
      const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
      expect(observers).toHaveLength(1);
      log.length = 0;
      // Un'altra linguetta: il riquadro della lavagna è nascosto.
      host.hidden = true;
      panStart(viewport, -800, 0)();
      engine.syncDoc(boardSource([...TWO, image("c", 600, 100)]));
      for (const notify of [...observers]) notify();
      expect(log).toEqual([]);
      expect(liveOf(host)).toEqual(["a", "b"]);
      // Torna in vista: la vista cambia misura e la scelta si rifà.
      host.hidden = false;
      for (const notify of [...observers]) notify();
      expect(log).toEqual([["a", "snapshot"], ["c", "live"]]);
      expect(liveOf(host)).toEqual(["b", "c"]);
      engine.destroy();
      expect(observers).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resize() arriva alla scheda ridimensionata a fine gesto, una volta", () => {
    const { renderer, resized } = modeRenderer();
    const { engine, host, viewport } = mounted(boardSource(TWO), { cards: cardsOf(renderer) });
    const grip = card(host, "a").querySelector<HTMLElement>("[data-resize]")!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 10, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 30, clientY: 30 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 50, clientY: 50 }));
    expect(resized).toEqual([]);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 4, clientX: 50, clientY: 50 }));
    expect(readNodes(engine.getDoc()).find((node) => node.id === "a")!.width).toBe(240);
    expect(resized).toEqual(["a"]);
    // Spostare non è ridimensionare; una misura arrivata da fuori sì.
    drag(viewport, card(host, "b").querySelector<HTMLElement>(".canvas-node-handle")!, 40, 0, 5);
    syncNode(engine, "b", { height: 200 });
    expect(resized).toEqual(["a", "b"]);
    engine.destroy();
  });
});

// --- Entrare e uscire (N6 T14) --------------------------------------------------

/**
 * Un renderer che scrive ogni chiamata della tela. Il contenuto ha un link
 * che, come la montatura delle note (`mount.ts`), si segue al clic se nessuno
 * lo ha fermato prima; con `data-cells` il contenuto usa Esc da sé (un
 * rettangolo di celle che si sta scegliendo). Si entra solo nelle note.
 */
function probeRenderer() {
  const log: string[] = [];
  const followed: string[] = [];
  const renderer: CardRenderer = {
    kinds: ["note", "pdf", "image"],
    mount(node: CanvasNode, host: HTMLElement): CardView {
      const content = document.createElement("div");
      content.className = "probe";
      const link = document.createElement("a");
      link.className = "probe-link";
      link.setAttribute("href", "Altra.md");
      link.textContent = "Altra";
      const text = document.createElement("p");
      text.className = "probe-text";
      text.textContent = "testo";
      content.append(link, text);
      content.addEventListener("click", (event) => {
        if (event.defaultPrevented) return;
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        if (!anchor) return;
        event.preventDefault();
        followed.push(`${node.id}:${anchor.getAttribute("href")}`);
      });
      content.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || content.dataset.cells === undefined) return;
        event.preventDefault();
        delete content.dataset.cells;
        log.push(`${node.id}:cells`);
      });
      host.append(content);
      const enterable = (node.file ?? "").endsWith(".md");
      return {
        setMode: (mode) => {
          log.push(`${node.id}:${mode}`);
        },
        enter: () => {
          log.push(`${node.id}:enter`);
          return enterable;
        },
        leave: () => {
          log.push(`${node.id}:leave`);
        },
        key: (event) => {
          if (!["PageUp", "PageDown", "Home", "End"].includes(event.key)) return false;
          log.push(`${node.id}:key ${event.key}`);
          return true;
        },
        destroy: () => {
          log.push(`${node.id}:destroy`);
        },
      };
    },
  };
  return { renderer, log, followed };
}

/** Una nota, un PDF, un'immagine e un testo, tutti in vista a zoom 1. */
const BOARD = [
  { id: "n", type: "file", x: 0, y: 0, width: 200, height: 100, file: "Note/idea.md" },
  { id: "p", type: "file", x: 400, y: 0, width: 200, height: 100, file: "doc/libro.pdf" },
  { id: "i", type: "file", x: 200, y: 0, width: 100, height: 100, file: "img/foto.png" },
  { id: "t", type: "text", x: 0, y: -50, width: 100, height: 40, text: "testo" },
];

function linkOf(host: HTMLElement, id: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(".probe-link")!;
}

function textOf(host: HTMLElement, id: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(".probe-text")!;
}

/** Un clic col mouse su `target`: giù, su e il `click`. Dà il `click`. */
function clickOn(viewport: HTMLElement, target: HTMLElement, init: MouseEventInit = {}): MouseEvent {
  const at = { bubbles: true, cancelable: true, button: 0, pointerId: 5, clientX: 50, clientY: 50, ...init };
  target.dispatchEvent(new PointerEvent("pointerdown", at));
  viewport.dispatchEvent(new PointerEvent("pointerup", at));
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(click);
  return click;
}

/** Uno scatto di rotella su `target`, con Ctrl o senza. */
function wheelOn(target: HTMLElement, ctrl = false, deltaY = 100): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
  // Il `WheelEvent` di happy-dom non prende i tasti né il punto dall'init.
  Object.defineProperties(event, { ctrlKey: { value: ctrl }, clientX: { value: 400 }, clientY: { value: 300 } });
  target.dispatchEvent(event);
  return event;
}

function press(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function focused(): HTMLElement {
  return document.activeElement as HTMLElement;
}

function cameraOf(host: HTMLElement): string {
  return host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
}

function selectedOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((el) => el.dataset.node!).sort();
}

function activeOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>(".canvas-node[data-card-active]")].map((el) => el.dataset.node!);
}

/** Tab sulla scheda e Invio. */
function enterWithKeys(host: HTMLElement, id: string): void {
  card(host, id).focus();
  press(card(host, id), "Enter");
}

describe("entrare e uscire da una scheda", () => {
  it("un clic sceglie la scheda, anche sul link, e non lo segue; il clic dopo entra senza seguirlo", () => {
    const { renderer, log, followed } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    const first = clickOn(viewport, linkOf(host, "n"));
    expect(first.defaultPrevented).toBe(true);
    expect(followed).toEqual([]);
    expect(selectedOf(host)).toEqual(["n"]);
    expect(activeOf(host)).toEqual([]);
    expect(log).toEqual([]);
    // Il mouse giù sul link: il fuoco va alla scheda, non al link.
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 6 });
    linkOf(host, "n").dispatchEvent(down);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 6 }));
    expect(down.defaultPrevented).toBe(true);
    expect(focused()).toBe(card(host, "n"));
    clickOn(viewport, linkOf(host, "n"));
    expect(followed).toEqual([]);
    expect(log).toEqual(["n:enter"]);
    expect(activeOf(host)).toEqual(["n"]);
    expect(card(host, "n").querySelector(".canvas-exit-hint")?.textContent).toBe("Esc per uscire");
    // Dentro, un clic sul link lo segue.
    clickOn(viewport, linkOf(host, "n"));
    expect(followed).toEqual(["n:Altra.md"]);
    engine.destroy();
  });

  it("Ctrl+clic e Meta+clic su un link lo seguono subito, attiva o no; fuori da un link aggiungono alla scelta", () => {
    const { renderer, followed } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    const before = cameraOf(host);
    clickOn(viewport, linkOf(host, "n"), { ctrlKey: true });
    expect(followed).toEqual(["n:Altra.md"]);
    clickOn(viewport, linkOf(host, "p"), { metaKey: true });
    expect(followed).toEqual(["n:Altra.md", "p:Altra.md"]);
    expect(selectedOf(host)).toEqual([]);
    expect(activeOf(host)).toEqual([]);
    // Fuori da un link: la scelta cresce, la lavagna non si sposta.
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "p"), { ctrlKey: true });
    expect(selectedOf(host)).toEqual(["n", "p"]);
    clickOn(viewport, card(host, "i"), { metaKey: true });
    expect(selectedOf(host)).toEqual(["i", "n", "p"]);
    expect(cameraOf(host)).toBe(before);
    expect(activeOf(host)).toEqual([]);
    // Dentro una scheda attiva, anche.
    clickOn(viewport, viewport);
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, linkOf(host, "n"), { ctrlKey: true });
    expect(followed).toEqual(["n:Altra.md", "p:Altra.md", "n:Altra.md"]);
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("Invio con la scheda scelta entra; Esc esce e il fuoco torna alla scheda", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    const article = card(host, "n");
    article.focus();
    expect(press(article, "Enter").defaultPrevented).toBe(true);
    expect(log).toEqual(["n:enter"]);
    expect(activeOf(host)).toEqual(["n"]);
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    // Il fuoco va dentro: i tasti sono del contenuto, non della tela.
    expect(article.contains(focused())).toBe(true);
    expect(focused()).not.toBe(article);
    expect(press(focused(), "Delete").defaultPrevented).toBe(false);
    expect(readNodes(engine.getDoc()).map((node) => node.id)).toContain("n");
    expect(press(focused(), "Escape").defaultPrevented).toBe(true);
    expect(log).toEqual(["n:enter", "n:leave"]);
    expect(activeOf(host)).toEqual([]);
    expect(article.querySelector(".canvas-exit-hint")).toBeNull();
    expect(focused()).toBe(article);
    // Una scheda di testo: Invio scrive, come prima.
    enterWithKeys(host, "t");
    expect(host.querySelector(".canvas-text-editor")).not.toBeNull();
    expect(activeOf(host)).toEqual([]);
    engine.destroy();
  });

  it("Esc che il contenuto usa (un rettangolo di celle) non esce", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    enterWithKeys(host, "n");
    const probe = card(host, "n").querySelector<HTMLElement>(".probe")!;
    probe.dataset.cells = "";
    press(probe, "Escape");
    expect(log).toEqual(["n:enter", "n:cells"]);
    expect(activeOf(host)).toEqual(["n"]);
    press(probe, "Escape");
    expect(log).toEqual(["n:enter", "n:cells", "n:leave"]);
    expect(activeOf(host)).toEqual([]);
    engine.destroy();
  });

  it("un clic fuori esce; un clic sulla testata della scheda attiva no", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    log.length = 0;
    clickOn(viewport, card(host, "n").querySelector<HTMLElement>(".canvas-node-handle")!);
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, viewport);
    expect(log).toEqual(["n:leave"]);
    expect(activeOf(host)).toEqual([]);
    expect(selectedOf(host)).toEqual([]);
    // Un clic su un'altra scheda, anche: esce e sceglie quella.
    clickOn(viewport, textOf(host, "n"));
    clickOn(viewport, textOf(host, "n"));
    expect(activeOf(host)).toEqual(["n"]);
    clickOn(viewport, textOf(host, "p"));
    expect(activeOf(host)).toEqual([]);
    expect(selectedOf(host)).toEqual(["p"]);
    engine.destroy();
  });

  it("la rotella fuori sposta la lavagna; sopra la scheda attiva va a lei, con Ctrl ingrandisce", () => {
    const { renderer } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    let camera = cameraOf(host);
    expect(wheelOn(textOf(host, "n"), false, 10).defaultPrevented).toBe(true);
    expect(cameraOf(host)).not.toBe(camera);
    enterWithKeys(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    camera = cameraOf(host);
    expect(wheelOn(textOf(host, "n"), false, 10).defaultPrevented).toBe(false);
    expect(cameraOf(host)).toBe(camera);
    // Fuori dalla scheda attiva, ancora la lavagna.
    expect(wheelOn(textOf(host, "p"), false, 10).defaultPrevented).toBe(true);
    expect(cameraOf(host)).not.toBe(camera);
    expect(wheelOn(textOf(host, "n"), true).defaultPrevented).toBe(true);
    expect(zoomOf(host)).toBeLessThan(1);
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("PgGiù, PgSu, Home e Fine vanno alla scheda scelta e non attiva", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    const article = card(host, "p");
    article.focus();
    expect(press(article, "PageDown").defaultPrevented).toBe(true);
    press(article, "PageUp");
    press(article, "Home");
    press(article, "End");
    expect(log).toEqual(["p:key PageDown", "p:key PageUp", "p:key Home", "p:key End"]);
    // Le frecce restano della tela: spostano la scheda.
    press(article, "ArrowRight");
    expect(log).toHaveLength(4);
    expect(readNodes(engine.getDoc()).find((node) => node.id === "p")!.x).toBeGreaterThan(400);
    // Dentro una scheda attiva i tasti sono del contenuto: `key` non c'entra.
    enterWithKeys(host, "n");
    log.length = 0;
    press(focused(), "PageDown");
    expect(log).toEqual([]);
    engine.destroy();
  });

  it("la scheda attiva resta viva sotto lo zoom delle schede vive, ed esce quando lascia la vista", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = probeRenderer();
      const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
      enterWithKeys(host, "n");
      log.length = 0;
      for (let tick = 0; tick < 12; tick++) wheelOn(viewport, true);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(zoomOf(host)).toBeLessThan(LIVE_ZOOM_MIN);
      expect([...log].sort()).toEqual(["i:snapshot", "p:snapshot"]);
      expect(liveOf(host)).toEqual(["n"]);
      expect(activeOf(host)).toEqual(["n"]);
      log.length = 0;
      // Lontano: la scheda esce dalla vista, e allora esce e si spegne.
      panStart(viewport, -20_000, 0)();
      expect(log).toEqual(["n:leave", "n:snapshot"]);
      expect(activeOf(host)).toEqual([]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("entrare in una scheda ferma la accende, poi entra; uscendo torna ferma", () => {
    vi.useFakeTimers();
    try {
      const { renderer, log } = probeRenderer();
      const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
      for (let tick = 0; tick < 12; tick++) wheelOn(viewport, true);
      vi.advanceTimersByTime(WHEEL_SETTLE_MS);
      expect(liveOf(host)).toEqual([]);
      log.length = 0;
      enterWithKeys(host, "n");
      expect(log).toEqual(["n:live", "n:enter"]);
      expect(activeOf(host)).toEqual(["n"]);
      press(focused(), "Escape");
      expect(log).toEqual(["n:live", "n:enter", "n:leave", "n:snapshot"]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("senza niente in cui entrare, Invio fa ciò che faceva; il doppio clic sull'immagine non apre il campo", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    log.length = 0;
    card(host, "i").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    expect(activeOf(host)).toEqual([]);
    expect(log).toEqual([]);
    // Il doppio clic sulla nota è come Invio.
    card(host, "n").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(log).toEqual(["n:enter"]);
    expect(activeOf(host)).toEqual(["n"]);
    press(focused(), "Escape");
    // Il PDF non ha dove entrare: Invio apre il campo del file, come prima.
    log.length = 0;
    enterWithKeys(host, "p");
    expect(log[0]).toBe("p:enter");
    expect(activeOf(host)).toEqual([]);
    expect(host.querySelector(".canvas-field-editor")).not.toBeNull();
    engine.destroy();
  });

  it("in sola lettura si entra; una scheda attiva tolta da fuori esce, e si rientra", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    engine.setReadOnly(true);
    log.length = 0;
    enterWithKeys(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    engine.setReadOnly(false);
    engine.syncDoc(boardSource(BOARD.filter((node) => node.id !== "n")));
    expect(log).toEqual(["n:enter", "n:leave", "n:destroy"]);
    expect(activeOf(host)).toEqual([]);
    engine.syncDoc(boardSource(BOARD));
    enterWithKeys(host, "n");
    expect(activeOf(host)).toEqual(["n"]);
    engine.destroy();
  });

  it("la scheda attiva tolta da un annulla esce", () => {
    const { renderer, log } = probeRenderer();
    const { engine, host, viewport } = mounted(boardSource(BOARD), { cards: cardsOf(renderer) });
    // Una copia della nota, scelta: Invio ci entra, l'annulla la toglie.
    card(host, "n").focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
    const copy = readNodes(engine.getDoc()).map((node) => node.id).find((id) => !BOARD.some((node) => node.id === id))!;
    expect(copy).toBeDefined();
    log.length = 0;
    press(viewport, "Enter");
    expect(activeOf(host)).toEqual([copy]);
    engine.undo();
    expect(log).toEqual([`${copy}:enter`, `${copy}:leave`, `${copy}:destroy`]);
    expect(activeOf(host)).toEqual([]);
    expect(host.querySelector(".canvas-exit-hint")).toBeNull();
    engine.destroy();
  });
});

describe("riaprire dove eri (T36)", () => {
  const PDF_BOARD = [
    { id: "p", type: "file", x: 0, y: 0, width: 200, height: 260, file: "Corsi/manuale.pdf", subpath: "#page=2" },
    image("a", 400, 0),
    image("z", 1600, 1200),
  ];

  function viewStore(initial: Record<string, unknown> = {}) {
    const states = new Map<string, unknown>(Object.entries(initial));
    const writes: unknown[] = [];
    const memory = createCanvasViewMemory({
      get: async (key) => states.get(key) ?? null,
      set: async (key, value) => {
        writes.push(value);
        states.set(key, value);
      },
    });
    return { states, writes, memory };
  }

  /** Le viste montate della scheda `id`, dall'ultima. */
  function mountsOf(mounts: readonly Mounted[], id: string): Mounted[] {
    return mounts.filter((entry) => entry.node === id).reverse();
  }

  it("riaprendo tornano la camera, la scelta e la pagina del PDF; il .canvas non cambia", async () => {
    const source = boardSource(PDF_BOARD);
    const store = viewStore();
    const first = fakeRenderer();
    const a = mounted(source, { cards: cardsOf(first.renderer), viewMemory: store.memory });
    await settle();
    // Nessuno stato: si inquadra tutto, come prima.
    const fitted = cameraOf(a.host);
    panStart(a.viewport, -150, -40)();
    clickOn(a.viewport, bodyOf(a.host, "a"));
    expect(selectedOf(a.host)).toEqual(["a"]);
    const camera = cameraOf(a.host);
    expect(camera).not.toBe(fitted);
    mountsOf(first.mounts, "p")[0]!.context.pageChanged!(5);
    a.engine.destroy();
    await settle();
    expect(store.writes.length).toBe(1);
    expect(store.states.get(canvasViewKey("board.canvas"))).toMatchObject({ version: 1, selection: ["a"], pages: { p: 5 } });
    expect(a.changes).toEqual([]);
    expect(a.engine.getDoc()).toBe(source);

    const second = fakeRenderer();
    const b = mounted(source, { cards: cardsOf(second.renderer), viewMemory: store.memory });
    await settle();
    expect(cameraOf(b.host)).toBe(camera);
    expect(selectedOf(b.host)).toEqual(["a"]);
    // La scheda montata prima che la vista arrivasse si rimonta sulla sua pagina.
    const pdf = mountsOf(second.mounts, "p");
    expect(pdf[0]!.context.initialPage).toBe(5);
    expect(pdf[0]!.destroyed).toBe(0);
    expect(pdf.slice(1).every((entry) => entry.destroyed === 1)).toBe(true);
    // Le altre schede non si rimontano.
    expect(mountsOf(second.mounts, "a").length).toBe(1);
    // Il file resta identico byte per byte.
    expect(b.engine.getDoc()).toBe(source);
    expect(b.changes).toEqual([]);
    b.engine.destroy();
    await settle();
    // Riaperta e richiusa senza cambiare niente: niente da riscrivere.
    expect(store.writes.length).toBe(1);
  });

  it("una vista ricordata vuota inquadra tutto", async () => {
    const source = boardSource(PDF_BOARD);
    const plain = mounted(source, { cards: cardsOf(fakeRenderer().renderer) });
    const fitted = cameraOf(plain.host);
    plain.engine.destroy();
    const store = viewStore({
      [canvasViewKey("board.canvas")]: { version: 1, camera: { x: 90000, y: 90000, zoom: 1 }, selection: ["via"], pages: {} },
    });
    const b = mounted(source, { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory });
    await settle();
    expect(cameraOf(b.host)).toBe(fitted);
    // Una scheda scelta che non c'è più non si sceglie.
    expect(selectedOf(b.host)).toEqual([]);
    b.engine.destroy();
  });

  it("la scelta torna con le sole schede che ci sono ancora, e la camera da sola", async () => {
    const store = viewStore({
      [canvasViewKey("board.canvas")]: { version: 1, camera: { x: 10, y: 20, zoom: 0.5 }, selection: ["via", "z", "a"], pages: {} },
    });
    const b = mounted(boardSource(PDF_BOARD), { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory });
    await settle();
    expect(cameraOf(b.host)).toBe("translate(10px, 20px) scale(0.5)");
    expect(selectedOf(b.host)).toEqual(["a", "z"]);
    b.engine.destroy();
  });

  it("uno stato di un'altra versione o rotto: si parte come oggi, e quello di un'altra versione non si riscrive", async () => {
    const source = boardSource(PDF_BOARD);
    const plain = mounted(source, { cards: cardsOf(fakeRenderer().renderer) });
    const fitted = cameraOf(plain.host);
    plain.engine.destroy();
    const foreign = { version: 2, camera: { x: 10, y: 20, zoom: 0.5 }, selection: ["a"] };
    for (const stored of [foreign, "rotto", { camera: { x: 10, y: 20, zoom: 0.5 } }]) {
      const store = viewStore({ [canvasViewKey("board.canvas")]: stored });
      const b = mounted(source, { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory });
      await settle();
      expect(cameraOf(b.host)).toBe(fitted);
      expect(selectedOf(b.host)).toEqual([]);
      panStart(b.viewport, -150, 0)();
      b.engine.destroy();
      await settle();
      if (stored === foreign) expect(store.writes).toEqual([]);
      else expect(store.writes.length).toBe(1);
    }
  });

  it("una vista mossa prima che quella ricordata arrivi resta com'è", async () => {
    const store = viewStore({
      [canvasViewKey("board.canvas")]: { version: 1, camera: { x: 10, y: 20, zoom: 0.5 }, selection: [], pages: {} },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const viewMemory = {
      read: async (doc: string) => {
        await gate;
        return store.memory.read(doc);
      },
      write: store.memory.write,
    };
    const b = mounted(boardSource(PDF_BOARD), { cards: cardsOf(fakeRenderer().renderer), viewMemory });
    panStart(b.viewport, -150, 0)();
    const moved = cameraOf(b.host);
    release();
    await settle();
    expect(cameraOf(b.host)).toBe(moved);
    b.engine.destroy();
  });

  it("senza lavagna non si legge e non si scrive niente", async () => {
    const store = viewStore();
    const read = vi.spyOn(store.memory, "read");
    const b = mounted(boardSource(PDF_BOARD), { cards: cardsOf(fakeRenderer().renderer), viewMemory: store.memory, documentId: undefined });
    await settle();
    panStart(b.viewport, -150, 0)();
    b.engine.destroy();
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });
});
