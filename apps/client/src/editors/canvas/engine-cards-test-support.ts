// Gli aiuti condivisi dalle prove delle schede vive della tela (`engine-cards*.test.ts`).
import { CanvasEngine, type CanvasCards, type CanvasChange, type CanvasEngineOptions } from "./engine";
import { createCardRegistry, type CardContext, type CardKind, type CardMode, type CardRenderer, type CardSnapshot, type CardSnapshots, type CardView } from "../core/cards/contract";
import type { CanvasNode } from "./model";
import { openCoreNow } from "./wasm/core";

/** Una vista montata dal renderer finto: per quale scheda, con che file, e se è stata distrutta. */
export interface Mounted {
  readonly node: string;
  readonly file: string | undefined;
  readonly url: string | undefined;
  readonly host: HTMLElement;
  readonly mode: CardMode;
  readonly context: CardContext;
  destroyed: number;
}

/** Un renderer finto che conta `mount` e `destroy`, per tutte le specie di file. */
export function fakeRenderer(kinds: readonly CardKind[] = ["note", "image", "pdf", "web"]) {
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

export function memorySnapshots(): CardSnapshots {
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
export function fakeFiles() {
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

export function cardsWith(files: ReturnType<typeof fakeFiles>, ...renderers: CardRenderer[]): CanvasCards {
  return { registry: createCardRegistry(renderers), snapshots: memorySnapshots(), watch: (path, changed) => files.watch(path, changed) };
}

export function cardsOf(...renderers: CardRenderer[]): CanvasCards {
  return cardsWith(fakeFiles(), ...renderers);
}

/** Lascia correre le promesse in attesa (il selettore, il commit). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Il gesto «Ritrova…» o «Togli» del segnaposto di una scheda mancante, se c'è. */
export function actionOf(host: HTMLElement, id: string, action: "relink" | "remove"): HTMLButtonElement | null {
  return bodyOf(host, id).querySelector<HTMLButtonElement>(`[data-card-action="${action}"]`);
}

export function boardSource(nodes: readonly Record<string, unknown>[] = defaultNodes()): string {
  return JSON.stringify({ nodes, edges: [] });
}

export function defaultNodes(): Record<string, unknown>[] {
  return [
    { id: "n", type: "file", x: 0, y: 0, width: 240, height: 160, file: "Note/idea.md" },
    { id: "i", type: "file", x: 320, y: 0, width: 240, height: 160, file: "img/foto.png" },
    { id: "t", type: "text", x: 0, y: 240, width: 240, height: 120, text: "testo" },
    { id: "w", type: "link", x: 320, y: 240, width: 240, height: 120, url: "https://example.com/" },
  ];
}

export function readNodes(text: string): CanvasNode[] {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model().nodes;
  } finally {
    core.close();
  }
}

export function mounted(source: string, overrides: Partial<CanvasEngineOptions> = {}) {
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

export function card(host: HTMLElement, id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
}

export function bodyOf(host: HTMLElement, id: string): HTMLElement {
  return card(host, id).querySelector<HTMLElement>(":scope > .canvas-card-body")!;
}

/** Una modifica che arriva da fuori (un'altra superficie): il testo nuovo con la scheda `id` cambiata. */
export function syncNode(engine: CanvasEngine, id: string, change: Partial<CanvasNode>): void {
  const doc = JSON.parse(engine.getDoc()) as { nodes: Record<string, unknown>[] };
  doc.nodes = doc.nodes.map((node) => (node.id === id ? { ...node, ...change } : node));
  engine.syncDoc(JSON.stringify(doc));
}

// --- Vive solo le schede utili (N6 T13) -----------------------------------------

/** Un renderer che scrive ogni `setMode` e ogni `resize` delle sue viste. */
export function modeRenderer() {
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
export function liveOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>('.canvas-node[data-card-mode="live"]')]
    .map((el) => el.dataset.node!).sort();
}

export function image(id: string, x: number, y: number, width = 200, height = 100): Record<string, unknown> {
  return { id, type: "file", x, y, width, height, file: `img/${id}.png` };
}

/**
 * Due immagini che la tela inquadra a zoom 1 in una vista di 800 × 600 (la
 * misura di riserva della tela, perché happy-dom non ha layout): la vista,
 * in coordinate della lavagna, va da (-100, -250) a (700, 350).
 */
export const TWO = [image("a", 0, 0), image("b", 400, 0)];

export function zoomOf(host: HTMLElement): number {
  const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  return Number(/scale\(([\d.e+-]+)\)/.exec(transform)![1]);
}

/** Il tasto centrale giù sul viewport, una mossa: la vista si sposta di `dx`, `dy`. Dà il rilascio. */
export function panStart(viewport: HTMLElement, dx: number, dy: number, pointerId = 9): () => void {
  viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 1, pointerId, clientX: 400, clientY: 300 }));
  viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId, clientX: 400 + dx, clientY: 300 + dy }));
  return () => {
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId, clientX: 400 + dx, clientY: 300 + dy }));
  };
}

/** Uno scatto di Ctrl+rotella sul centro della vista. */
export function wheelTick(viewport: HTMLElement, zoomIn: boolean): void {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: zoomIn ? -100 : 100 });
  // Il `WheelEvent` di happy-dom non prende i tasti né il punto dall'init.
  Object.defineProperties(event, { ctrlKey: { value: true }, clientX: { value: 400 }, clientY: { value: 300 } });
  viewport.dispatchEvent(event);
}

// --- Entrare e uscire (N6 T14) --------------------------------------------------

/**
 * Un renderer che scrive ogni chiamata della tela. Il contenuto ha un link
 * che, come la montatura delle note (`mount.ts`), si segue al clic se nessuno
 * lo ha fermato prima; con `data-cells` il contenuto usa Esc da sé (un
 * rettangolo di celle che si sta scegliendo). Si entra solo nelle note.
 */
export function probeRenderer() {
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
export const BOARD = [
  { id: "n", type: "file", x: 0, y: 0, width: 200, height: 100, file: "Note/idea.md" },
  { id: "p", type: "file", x: 400, y: 0, width: 200, height: 100, file: "doc/libro.pdf" },
  { id: "i", type: "file", x: 200, y: 0, width: 100, height: 100, file: "img/foto.png" },
  { id: "t", type: "text", x: 0, y: -50, width: 100, height: 40, text: "testo" },
];

/** Uno scatto di rotella su `target`, con Ctrl o senza. */
export function wheelOn(target: HTMLElement, ctrl = false, deltaY = 100): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
  // Il `WheelEvent` di happy-dom non prende i tasti né il punto dall'init.
  Object.defineProperties(event, { ctrlKey: { value: ctrl }, clientX: { value: 400 }, clientY: { value: 300 } });
  target.dispatchEvent(event);
  return event;
}

export function press(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

export function focused(): HTMLElement {
  return document.activeElement as HTMLElement;
}

export function cameraOf(host: HTMLElement): string {
  return host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
}

export function activeOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>(".canvas-node[data-card-active]")].map((el) => el.dataset.node!);
}

/** Tab sulla scheda e Invio. */
export function enterWithKeys(host: HTMLElement, id: string): void {
  card(host, id).focus();
  press(card(host, id), "Enter");
}

export function editingOf(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>(".canvas-node[data-card-editing]")].map((el) => el.dataset.node!);
}

export function optionsBar(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.canvas-options [data-option="format"] .format-bar');
}

/** La camera che la lavagna ha scritto sulla scena: `translate(x, y) scale(zoom)`. */
export function cameraValues(host: HTMLElement): { x: number; y: number; zoom: number } {
  const match = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(cameraOf(host));
  if (!match) throw new Error(`camera non letta: ${cameraOf(host)}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}
