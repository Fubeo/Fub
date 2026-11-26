// Gli aiuti condivisi dalle prove di `CanvasEngine` (`engine*.test.ts`):
// montare la tela, leggere la lavagna, scrivere nei campi delle schede.
import { renderMarkdown } from "../text/profiles/markdown/render";
import { mountMarkdown } from "../text/profiles/markdown/mount";
import { CanvasEngine, type CanvasChange, type CanvasEngineOptions } from "./engine";
import type { CanvasDocument } from "./model";
import { openCoreNow } from "./wasm/core";
import { createCardRegistry, type CardEditorPort, type CardTextEditor, type CardTextOptions } from "../core/cards/contract";
import { CardCache } from "./card-cache";

/** La lavagna di un testo come la legge il nucleo. */
export function readCanvas(text: string): CanvasDocument {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model();
  } finally {
    core.close();
  }
}

export function canvasSource(): string {
  return JSON.stringify({
    nodes: [
      { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "vedi [[Altra]] e #tag" },
      { id: "f", type: "file", x: 400, y: 40, width: 240, height: 140, file: "allegati/foto.png" },
      { id: "g", type: "group", x: 40, y: 240, width: 600, height: 300, label: "Idee" },
      { id: "w", type: "link", x: 400, y: 240, width: 240, height: 100, url: "https://example.com/x" },
    ],
    edges: [{ id: "e1", fromNode: "t", toNode: "f", toEnd: "arrow", label: "usa" }],
  });
}

export function mounted(source = canvasSource(), overrides: Partial<CanvasEngineOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const opened: Array<{ page?: string; path?: string; url?: string }> = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "test",
    formatId: "canvas",
    revision: "rev-1",
    documentId: "board.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    onOpenWikilink: (page) => {
      opened.push({ page });
    },
    onOpenPath: (path) => {
      opened.push({ path });
    },
    media: {
      openExternal: (url) => {
        opened.push({ url });
      },
    },
    renderMarkdownForCard: (_nodeId, text, host) =>
      mountMarkdown(host, renderMarkdown(text).html, {
        documentId: "board.canvas",
        openWikilink: (page) => {
          opened.push({ page });
        },
      }),
    ...overrides,
  });
  engine.setDoc(source);
  return { engine, host, changes, opened };
}

export function openField(host: HTMLElement, id: string): HTMLInputElement | HTMLTextAreaElement {
  host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(".canvas-text-editor, .canvas-field-editor")!;
}

export function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function press(input: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
}

export function cardText(engine: CanvasEngine, id = "t"): string | undefined {
  return readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)?.text;
}

/** L'editor delle note finto che la porta monta sopra il testo di una scheda (T43). */
export interface FakeLiveText {
  readonly host: HTMLElement;
  readonly text: string;
  readonly options: CardTextOptions;
  /** Il contenitore che si scrive, come il `contenteditable` dell'editor vero. */
  readonly area: HTMLElement;
  readonly focusAt: Array<number | undefined>;
  /** I punti chiesti a `focusAtPoint`, se la porta lo offre. */
  readonly pointsAt: Array<{ readonly x: number; readonly y: number }>;
  destroyed: boolean;
  /** Una battuta: il testo nuovo va a `onText`, come fa la porta. */
  typed(next: string): void;
}

/**
 * La porta delle schede con `openText` finto: `answer` dice se l'editor si
 * monta; `gate`, se c'è, tiene la risposta finché non si apre.
 */
export function textPort(answer: "live" | "none" = "live", gate?: Promise<void>, onText?: (point: { x: number; y: number }) => boolean) {
  const opened: FakeLiveText[] = [];
  const calls: string[] = [];
  const port: CardEditorPort = {
    open: async () => null,
    openText: async (host, text, options) => {
      calls.push(text);
      if (gate) await gate;
      if (answer === "none") return null;
      const area = document.createElement("div");
      area.contentEditable = "true";
      area.tabIndex = 0;
      area.className = "fake-live";
      host.append(area);
      let current = text;
      const live: FakeLiveText = {
        host,
        text,
        options,
        area,
        focusAt: [],
        pointsAt: [],
        destroyed: false,
        typed: (next) => {
          current = next;
          options.onText(next);
        },
      };
      const handle: CardTextEditor = {
        focus: (at) => {
          live.focusAt.push(at);
          area.focus();
        },
        ...(onText ? {
          focusAtPoint: (point: { x: number; y: number }) => {
            live.pointsAt.push(point);
            if (!onText(point)) return false;
            area.focus();
            return true;
          },
        } : {}),
        text: () => current,
        destroy: () => {
          if (live.destroyed) return;
          live.destroyed = true;
          host.replaceChildren();
        },
      };
      options.lifetime.add(() => handle.destroy());
      opened.push(live);
      return handle;
    },
  };
  return { port, opened, calls };
}

export function withTextPort(port: CardEditorPort): Partial<CanvasEngineOptions> {
  return { cards: { registry: createCardRegistry([]), snapshots: new CardCache(), watch: () => () => {}, editors: port } };
}

/** Le attese della porta arrivate in fondo. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export async function openLive(host: HTMLElement, id = "t"): Promise<void> {
  host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
}
