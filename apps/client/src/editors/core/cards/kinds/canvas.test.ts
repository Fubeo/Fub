// @vitest-environment happy-dom
// La zona lavagna (T47): a riposo la lavagna in sola lettura, intera e
// inerte; da attiva, con la porta vera delle schede e la sessione vera
// sull'host finto, la lavagna compatta che salva il `.canvas` e non la nota;
// la lavagna a riposo che segue la sessione; «A tutta pagina»; il componente
// spento, la porta assente, la lavagna annidata oltre tre livelli.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SessionModule from "../../../../state/document-session";

import { openLifetime } from "../../../../ui/lifetime";
import type { CardContext, CardEditor, CardEditorPort, CardMode, CardView, CardWriting } from "../contract";
import { cardKindOf, createCardRegistry, noteCardKindOf } from "../contract";
import type { CanvasNode } from "../../../canvas/model";
import { DocumentSurfaceRegistry, type EditorSurface, type SurfaceMountContext } from "../../registry";
import { operationFromText, type EditorChange } from "../../text-operation";
import { createFakeHost, type FakeHost } from "../../../../host/fake";
import { createCardEditorPort, type CardEditorHub } from "../editor-port";
import { DocumentSessionCollection } from "../../../../state/document-session";
import { boardCardCount, canvasCardRenderer, CANVAS_CARD_MAX_DEPTH, type CanvasCardPort } from "./canvas";

const live = vi.hoisted(() => ({ sessions: null as object | null }));

vi.mock("../../../../state/document-session", async (importOriginal) => {
  const real = await importOriginal<typeof SessionModule>();
  const documentSessions = new Proxy({}, {
    get: (_target, key) => {
      const sessions = live.sessions;
      if (!sessions) throw new Error("nessuna collezione nella prova");
      const value: unknown = Reflect.get(sessions, key, sessions);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(sessions) : value;
    },
  });
  return { ...real, documentSessions };
});

vi.mock("../../../../state/document-controller", () => ({
  synchronize: async () => {},
  publishContext: async () => {},
}));

const board = (x: number): string =>
  `${JSON.stringify({
    nodes: [
      { id: "a", type: "text", text: "Ingresso", x, y: 0, width: 160, height: 60 },
      { id: "b", type: "text", text: "Sala grande", x: 240, y: 0, width: 160, height: 60 },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b" }],
  }, null, 2)}\n`;
const BOARD = board(0);
const NOTE = "# Visita\n\n![[Percorso.canvas|640x300]]\n";

function node(file: string): CanvasNode {
  return { id: `n-${file}`, type: "file", x: 0, y: 0, width: 640, height: 300, file };
}

interface Mounted {
  readonly view: CardView;
  readonly host: HTMLElement;
  readonly writings: (CardWriting | null)[];
  readonly summaries: (string | null)[];
  full: boolean;
}

function mount(port: CanvasCardPort, mode: CardMode, path: string, extra: Partial<CardContext> = {}, parent: HTMLElement = document.body): Mounted {
  const host = document.createElement("div");
  parent.append(host);
  const mounted: Mounted = { view: null as unknown as CardView, host, writings: [], summaries: [], full: false };
  const context: CardContext = {
    path,
    subpath: null,
    documentId: "Nota.md",
    lifetime: openLifetime(),
    snapshots: { get: () => undefined, put: () => undefined, forget: () => undefined },
    size: () => ({ width: 640, height: 300 }),
    zoom: () => 1,
    fullPage: () => mounted.full,
    missing: () => {},
    writing: (writing) => mounted.writings.push(writing),
    summary: (text) => mounted.summaries.push(text),
    ...extra,
  };
  (mounted as { view: CardView }).view = canvasCardRenderer(port).mount(node(path), host, mode, context);
  return mounted;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function card(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(".canvas-card-board");
  if (!element) throw new Error("la scheda non c'è");
  return element;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  live.sessions = null;
});

describe("boardCardCount", () => {
  it("conta le schede di una lavagna; un testo che non lo è non si conta", () => {
    expect(boardCardCount(BOARD)).toBe(2);
    expect(boardCardCount("")).toBe(0);
    expect(boardCardCount("{}")).toBe(0);
    expect(boardCardCount('{"nodes":[],"edges":[]}')).toBe(0);
    expect(boardCardCount("non è JSON")).toBeNull();
    expect(boardCardCount('{"nodes":3}')).toBeNull();
    expect(boardCardCount("[]")).toBeNull();
  });
});

describe("canvasCardRenderer", () => {
  it("nella nota un `.canvas` è una zona lavagna; sulla lavagna resta una scheda di file", () => {
    expect(noteCardKindOf("Percorso della visita.canvas")).toBe("canvas");
    expect(noteCardKindOf("Lavagne/Mappa.CANVAS")).toBe("canvas");
    expect(noteCardKindOf("Contratto.pdf")).toBe("pdf");
    expect(cardKindOf(node("Percorso.canvas"))).toBe("file");
    const renderer = canvasCardRenderer({});
    expect(renderer.kinds).toEqual(["canvas"]);
    expect(createCardRegistry([renderer]).rendererFor("canvas")).toBe(renderer);
  });

  it("senza la porta degli editor dice che si apre con «Apri», e non si attiva", async () => {
    const editors: CardEditorPort = { open: () => Promise.resolve(null) };
    const mounted = mount({}, "live", "Percorso.canvas", { editors });
    await settle();
    const root = card(mounted.host);
    expect(root.dataset.cardBoard).toBe("unavailable");
    expect(root.querySelector(".canvas-card-board-message")?.textContent).not.toBe("");
    expect(mounted.view.edit?.()).toBe(false);
  });

  it("oltre tre livelli una lavagna dentro sé stessa è un link, che apre il file", async () => {
    let parent: HTMLElement = document.body;
    for (let i = 0; i < CANVAS_CARD_MAX_DEPTH; i++) {
      const outer = document.createElement("div");
      outer.className = "canvas-card-board";
      parent.append(outer);
      parent = outer;
    }
    const asked: string[] = [];
    const opened: string[] = [];
    const port: CanvasCardPort = {
      editors: { open: (path) => (asked.push(path), Promise.resolve(null)) },
      open: (path) => void opened.push(path),
    };
    const mounted = mount(port, "live", "Percorso.canvas", {}, parent);
    await settle();
    const root = card(mounted.host);
    expect(root.dataset.cardBoard).toBe("link");
    expect(asked).toEqual([]);
    expect(mounted.view.edit?.()).toBe(false);
    root.querySelector<HTMLButtonElement>("button")!.click();
    expect(opened).toEqual(["Percorso.canvas"]);
  });

  it("ferma, o senza la porta per scrivere (la nota in sola lettura), non si attiva", async () => {
    const editor: CardEditor = { focus: () => {}, leave: async () => {}, state: () => "salvato", onState: () => () => {}, destroy: () => {} };
    const editors: CardEditorPort = { open: () => Promise.resolve(editor) };
    const reading = mount({ editors }, "live", "Percorso.canvas");
    await settle();
    expect(reading.view.edit?.()).toBe(false);
    const still = mount({ editors }, "snapshot", "Percorso.canvas", { editors });
    expect(still.view.edit?.()).toBe(false);
  });
});

/// Una lavagna finta: tiene il testo del `.canvas`; spostare una scheda va
/// alla porta come modifica. Dice di essere la lavagna (famiglia della tela,
/// profilo `canvas`, `setFullPage`, la banda).
class FakeBoard {
  text = "";
  readOnly = false;
  readonly full: boolean[] = [];
  readonly watchers = new Set<() => void>();
  constructor(
    readonly context: SurfaceMountContext,
    readonly onChange: (paneId: string, change: EditorChange) => void,
    readonly kind: "canvas" | "source",
  ) {}
  move(next: string): void {
    if (this.readOnly) throw new Error("una lavagna in sola lettura non si sposta");
    const before = this.text;
    this.text = next;
    this.onChange(this.context.paneId, { text: next, operation: operationFromText(before, next), origin: "input" });
  }
  surface(): EditorSurface {
    const canvas = this.kind === "canvas";
    const settled = (): void => this.watchers.forEach((watch) => watch());
    return {
      family: canvas ? "canvas" : "text",
      profile: canvas ? "canvas" : "source",
      surfaceId: this.context.paneId,
      modes: [{ id: "canvas", label: () => "Lavagna", presentation: "surface", contextMode: "live_preview", looks: ["tema"] }],
      defaultMode: "canvas",
      setMode: () => {},
      buffer: {
        setDoc: (text) => {
          this.text = text;
          settled();
        },
        syncDoc: (update) => {
          this.text = typeof update === "string" ? update : update.text;
          settled();
        },
        getDoc: () => this.text,
      },
      status: {
        counts: true,
        items: () => [],
        subscribe: (listener) => {
          this.watchers.add(listener);
          return () => this.watchers.delete(listener);
        },
      },
      focus: () => {},
      setReadOnly: (readOnly) => {
        this.readOnly = readOnly;
      },
      ...(canvas ? { setFullPage: (full: boolean) => void this.full.push(full) } : {}),
      destroy: () => {},
    };
  }
}

describe("la zona lavagna sulla sessione del file", () => {
  let host: FakeHost;
  let sessions: DocumentSessionCollection;
  let surfaces: FakeBoard[];

  function port(kind: "canvas" | "source" | "none"): CardEditorHub {
    const registry = new DocumentSurfaceRegistry();
    let hub: CardEditorHub | null = null;
    if (kind !== "none") {
      registry.register({
        owner: `test.${kind}`,
        family: kind === "canvas" ? "canvas" : "text",
        defaultProfile: kind,
        formats: { canvas: kind },
        factory: {
          mount: (_profile, context) => {
            const surface = new FakeBoard(context, (paneId, change) => {
              if (!hub!.written(paneId, change)) throw new Error(`modifica di un riquadro: ${paneId}`);
            }, kind);
            surfaces.push(surface);
            return surface.surface();
          },
        },
      });
    }
    hub = createCardEditorPort({ sessions, surfaces: () => registry, held: () => false, shownInPane: () => false });
    return hub;
  }

  beforeEach(() => {
    host = createFakeHost({ root: "/vault", file: { "Nota.md": NOTE, "Percorso.canvas": BOARD } });
    sessions = new DocumentSessionCollection({ ...host.module.api }, () => "/vault");
    live.sessions = sessions;
    surfaces = [];
  });

  it("a riposo la lavagna intera, in sola lettura, inerte: la rotella resta alla nota", async () => {
    const editors = port("canvas");
    const mounted = mount({ editors }, "live", "Percorso.canvas");
    await settle();
    const root = card(mounted.host);
    expect(root.dataset.cardBoard).toBe("board");
    const rest = surfaces[0];
    if (!rest) throw new Error("la lavagna a riposo non si è montata");
    expect(rest.context.compact).toBe(true);
    expect(rest.readOnly).toBe(true);
    expect(rest.text).toBe(BOARD);
    const container = root.querySelector<HTMLElement>(".canvas-card-board-rest")!;
    expect(container.inert).toBe(true);
    expect(container.dataset.cardEditor).toBe("compact");
    expect(mounted.summaries[mounted.summaries.length - 1]).toBe("2 schede");
    mounted.view.destroy();
    await settle();
  });

  it("spostare una scheda nella zona scrive il `.canvas`, la nota resta com'era e la lavagna a riposo segue", async () => {
    const editors = port("canvas");
    const mounted = mount({ editors }, "live", "Percorso.canvas", { editors });
    await settle();
    expect(mounted.view.edit?.()).toBe(true);
    await settle();
    const [rest, active] = surfaces;
    if (!rest || !active) throw new Error("le due lavagne non si sono montate");
    expect(active.context.compact).toBe(true);
    expect(active.readOnly).toBe(false);
    const root = card(mounted.host);
    const writer = root.querySelector<HTMLElement>(".canvas-card-board-editor")!;
    expect(writer.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".canvas-card-board-rest")!.hidden).toBe(true);
    expect(root.dataset.cardState).toBe("editing");
    // Gli strumenti sono della lavagna: la riga della scheda è vuota.
    expect(mounted.writings[mounted.writings.length - 1]).toEqual({ toolbar: null });
    expect(active.full[active.full.length - 1]).toBe(false);

    const moved = board(80);
    active.move(moved);
    mounted.view.leave?.();
    await settle();
    expect(host.files()["Percorso.canvas"]).toBe(moved);
    expect(host.files()["Nota.md"]).toBe(NOTE);
    expect(rest.text).toBe(moved);
    expect(root.querySelector(".canvas-card-board-editor")).toBeNull();
    expect(root.querySelector<HTMLElement>(".canvas-card-board-rest")!.hidden).toBe(false);
    expect(root.dataset.cardState).toBeUndefined();
    mounted.view.destroy();
    await settle();
  });

  it("«A tutta pagina» e ritorno arrivano alle due lavagne", async () => {
    const editors = port("canvas");
    const mounted = mount({ editors }, "live", "Percorso.canvas", { editors });
    await settle();
    mounted.view.edit?.();
    await settle();
    const [rest, active] = surfaces;
    mounted.full = true;
    mounted.view.resize?.();
    mounted.full = false;
    mounted.view.resize?.();
    expect(active!.full.slice(-2)).toEqual([true, false]);
    expect(rest!.full.slice(-2)).toEqual([true, false]);
    mounted.view.destroy();
    await settle();
  });

  it("col componente della lavagna spento la scheda lo dice: nessun editor, niente scritto", async () => {
    for (const kind of ["none", "source"] as const) {
      surfaces = [];
      const editors = port(kind);
      const mounted = mount({ editors }, "live", "Percorso.canvas", { editors });
      await settle();
      const root = card(mounted.host);
      expect(root.dataset.cardBoard, kind).toBe("unavailable");
      expect(mounted.view.edit?.(), kind).toBe(false);
      expect(root.querySelector(".canvas-card-board-editor"), kind).toBeNull();
      expect(host.files()["Percorso.canvas"]).toBe(BOARD);
      mounted.view.destroy();
      await settle();
    }
  });
});
