// @vitest-environment happy-dom
// La scheda di disegno (T46): a riposo il disegno fermo; da attiva, con la
// porta vera delle schede e la sessione vera sull'host finto, l'editor dei
// disegni compatto che salva il `.svg` e non la nota; «A tutta pagina» che
// offre il resto; un SVG estraneo, un file troppo grande e il componente
// spento che restano un'immagine ferma.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SessionModule from "../../../../state/document-session";

import { openLifetime } from "../../../../ui/lifetime";
import type { CardContext, CardEditor, CardEditorPort, CardMode, CardView, CardWriting } from "../contract";
import { createCardRegistry, noteCardKindOf, cardKindOf } from "../contract";
import type { CanvasNode } from "../../../canvas/model";
import type { ResourceDescriptor } from "../../../media/media-types";
import { DocumentSurfaceRegistry, type EditorSurface, type SurfaceMountContext } from "../../registry";
import { operationFromText, type EditorChange } from "../../text-operation";
import { createFakeHost, type FakeHost } from "../../../../host/fake";
import { createCardEditorPort, type CardEditorHub } from "../editor-port";
import { DocumentSessionCollection } from "../../../../state/document-session";
import { IMAGE_CARD_MAX_BYTES, imageCardRenderer, type ImageCardPort, type ImageCardRead } from "./image";
import { drawingCardRenderer, isFubDrawing } from "./drawing";

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

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300">';
const DRAWING = `<?xml version="1.0" encoding="UTF-8"?>\n${HEAD}\n  <g id="layer-1" fub:role="layer"/>\n</svg>\n`;
const FOREIGN = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="10" height="10"/></svg>';
const NOTE = "# Idee\n\n![[Schizzo.svg]]\n";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function descriptor(id: string, len = 0): ResourceDescriptor {
  return { id, mime: "image/svg+xml", len, handle: "1", kind: "image", revision: "1" } as unknown as ResourceDescriptor;
}

/// La porta delle immagini, finta: legge da `files`, o da `host` se c'è.
function imagePort(files: () => Record<string, string | ImageCardRead>): ImageCardPort & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    read: (path) => {
      const file = files()[path];
      if (file === undefined) return Promise.resolve(null);
      return Promise.resolve(typeof file === "string" ? { bytes: encode(file), descriptor: descriptor(path) } : file);
    },
    open: (path) => void opened.push(path),
    watch: () => () => {},
  };
}

function node(file: string): CanvasNode {
  return { id: `n-${file}`, type: "file", x: 0, y: 0, width: 640, height: 360, file };
}

interface Mounted {
  readonly view: CardView;
  readonly host: HTMLElement;
  readonly writings: (CardWriting | null)[];
  full: boolean;
}

function mount(port: ImageCardPort, mode: CardMode, path: string, extra: Partial<CardContext> = {}): Mounted {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted: Mounted = { view: null as unknown as CardView, host, writings: [], full: false };
  const context: CardContext = {
    path,
    subpath: null,
    documentId: "Nota.md",
    lifetime: openLifetime(),
    snapshots: { get: () => undefined, put: () => undefined, forget: () => undefined },
    size: () => ({ width: 640, height: 360 }),
    zoom: () => 1,
    fullPage: () => mounted.full,
    missing: () => {},
    writing: (writing) => mounted.writings.push(writing),
    ...extra,
  };
  (mounted as { view: CardView }).view = drawingCardRenderer(port).mount(node(path), host, mode, context);
  return mounted;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function card(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(".canvas-card-drawing");
  if (!element) throw new Error("la scheda non c'è");
  return element;
}

beforeEach(() => {
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:disegno-${++next}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  live.sessions = null;
});

describe("isFubDrawing", () => {
  it("riconosce la radice di un disegno di Fub, con qualunque prefisso, e nient'altro", () => {
    expect(isFubDrawing(encode(DRAWING))).toBe(true);
    expect(isFubDrawing(encode(HEAD.replaceAll("fub:", "d:").replace("xmlns:fub", "xmlns:d")))).toBe(true);
    expect(isFubDrawing(encode(`<!-- <svg xmlns:fub="x"> -->\n${HEAD}</svg>`))).toBe(true);
    expect(isFubDrawing(encode(FOREIGN))).toBe(false);
    // Il prefisso legato a un altro spazio dei nomi non basta.
    expect(isFubDrawing(encode('<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://example.com/altro" fub:version="1"/>'))).toBe(false);
    // `version` senza il suo spazio dei nomi neppure.
    expect(isFubDrawing(encode('<svg xmlns="http://www.w3.org/2000/svg" version="1.1"/>'))).toBe(false);
    expect(isFubDrawing(new Uint8Array(0))).toBe(false);
  });
});

describe("drawingCardRenderer", () => {
  it("nella nota un `.svg` è un disegno; sulla lavagna resta un'immagine", () => {
    expect(noteCardKindOf("Schizzi/Schizzo.svg")).toBe("drawing");
    expect(noteCardKindOf("Schizzo.SVG")).toBe("drawing");
    expect(noteCardKindOf("Foto.png")).toBe("image");
    expect(noteCardKindOf("Contratto.pdf")).toBe("pdf");
    expect(cardKindOf(node("Schizzo.svg"))).toBe("image");
    const renderer = drawingCardRenderer(imagePort(() => ({})));
    expect(renderer.kinds).toEqual(["drawing"]);
    const registry = createCardRegistry([imageCardRenderer(imagePort(() => ({}))), renderer]);
    expect(registry.rendererFor("drawing")).toBe(renderer);
  });

  it("a riposo il disegno fermo: un <img>, mai l'SVG nel DOM", async () => {
    const { host } = mount(imagePort(() => ({ "Schizzo.svg": DRAWING })), "live", "Schizzo.svg");
    await settle();
    const root = card(host);
    expect(root.dataset.cardKind).toBe("drawing");
    expect(root.dataset.cardDrawing).toBe("fub");
    expect(root.querySelector("img.canvas-card-picture")).not.toBeNull();
    expect(root.querySelector("svg")).toBeNull();
  });

  it("un SVG estraneo e uno troppo grande restano un'immagine ferma: la porta non si chiede", async () => {
    const asked: string[] = [];
    const editors: CardEditorPort = {
      open: (path) => {
        asked.push(path);
        return Promise.resolve(null);
      },
    };
    const foreign = mount(imagePort(() => ({ "Logo.svg": FOREIGN })), "live", "Logo.svg", { editors });
    await settle();
    expect(card(foreign.host).dataset.cardDrawing).toBe("foreign");
    expect(foreign.view.edit?.()).toBe(false);

    const big: ImageCardRead = { bytes: new Uint8Array(0), descriptor: descriptor("big", IMAGE_CARD_MAX_BYTES + 1) };
    const large = mount(imagePort(() => ({ "Grande.svg": big })), "live", "Grande.svg", { editors });
    await settle();
    expect(large.view.edit?.()).toBe(false);
    expect(asked).toEqual([]);

    // Un `edit()` che arriva prima della lettura aspetta di sapere.
    const early = mount(imagePort(() => ({ "Logo.svg": FOREIGN })), "live", "Logo.svg", { editors });
    expect(early.view.edit?.()).toBe(true);
    await settle();
    expect(asked).toEqual([]);
    expect(early.writings[early.writings.length - 1] ?? null).toBeNull();
    expect(card(early.host).querySelector(".canvas-card-drawing-editor")).toBeNull();
  });

  it("senza la porta (la nota in sola lettura) o ferma, non si disegna", async () => {
    const editor: CardEditor = { focus: () => {}, leave: async () => {}, state: () => "salvato", onState: () => () => {}, destroy: () => {} };
    const editors: CardEditorPort = { open: () => Promise.resolve(editor) };
    const reading = mount(imagePort(() => ({ "Schizzo.svg": DRAWING })), "live", "Schizzo.svg");
    await settle();
    expect(reading.view.edit?.()).toBe(false);
    const still = mount(imagePort(() => ({ "Schizzo.svg": DRAWING })), "snapshot", "Schizzo.svg", { editors });
    expect(still.view.edit?.()).toBe(false);
  });
});

/// Una superficie dei disegni finta: tiene il testo del `.svg`; i tratti
/// vanno alla porta come modifiche. Dice di essere l'editor dei disegni
/// (famiglia della tela, modalità `draw`, `setFullPage`).
class FakeVector {
  text = "";
  readonly full: boolean[] = [];
  constructor(
    readonly context: SurfaceMountContext,
    readonly onChange: (paneId: string, change: EditorChange) => void,
    readonly kind: "vector" | "source",
  ) {}
  draw(next: string): void {
    const before = this.text;
    this.text = next;
    this.onChange(this.context.paneId, { text: next, operation: operationFromText(before, next), origin: "input" });
  }
  surface(): EditorSurface {
    const vector = this.kind === "vector";
    return {
      family: vector ? "canvas" : "text",
      profile: vector ? "vector" : "source",
      surfaceId: this.context.paneId,
      modes: vector
        ? [
            { id: "draw", label: () => "Disegno", presentation: "surface", contextMode: "live_preview", looks: ["tema"] },
            { id: "read", label: () => "Lettura", presentation: "rendered", contextMode: "reading", looks: ["tema"] },
          ]
        : [{ id: "source", label: () => "Sorgente", presentation: "surface", contextMode: "source", looks: ["tema"] }],
      defaultMode: vector ? "draw" : "source",
      setMode: () => {},
      buffer: {
        setDoc: (text) => {
          this.text = text;
        },
        syncDoc: (update) => {
          this.text = typeof update === "string" ? update : update.text;
        },
        getDoc: () => this.text,
      },
      focus: () => {},
      setReadOnly: () => {},
      ...(vector ? { setFullPage: (full: boolean) => void this.full.push(full) } : {}),
      destroy: () => {},
    };
  }
}

describe("la scheda di disegno sulla sessione del file", () => {
  let host: FakeHost;
  let sessions: DocumentSessionCollection;
  let surfaces: FakeVector[];

  function port(kind: "vector" | "source" | "none"): CardEditorHub {
    const registry = new DocumentSurfaceRegistry();
    let hub: CardEditorHub | null = null;
    if (kind !== "none") {
      registry.register({
        owner: `test.${kind}`,
        family: kind === "vector" ? "canvas" : "text",
        defaultProfile: kind,
        formats: { svg: kind },
        factory: {
          mount: (_profile, context) => {
            const surface = new FakeVector(context, (paneId, change) => {
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

  /// La porta delle immagini legge i file dell'host finto.
  const files = (): Record<string, string> => host.files() as Record<string, string>;

  beforeEach(() => {
    host = createFakeHost({ root: "/vault", draw: true, file: { "Nota.md": NOTE, "Schizzo.svg": DRAWING } });
    sessions = new DocumentSessionCollection({ ...host.module.api }, () => "/vault");
    live.sessions = sessions;
    surfaces = [];
  });

  it("disegnare nella scheda salva il disegno, e la nota resta com'era", async () => {
    const mounted = mount(imagePort(files), "live", "Schizzo.svg", { editors: port("vector") });
    await settle();
    expect(mounted.view.edit?.()).toBe(true);
    await settle();
    const vector = surfaces[surfaces.length - 1];
    if (!vector) throw new Error("l'editor dei disegni non si è montato");
    expect(vector.context.compact).toBe(true);
    expect(vector.text).toBe(DRAWING);
    const root = card(mounted.host);
    const writer = root.querySelector<HTMLElement>(".canvas-card-drawing-editor")!;
    expect(writer.hidden).toBe(false);
    expect(writer.dataset.cardEditor).toBe("compact");
    expect(root.dataset.cardState).toBe("editing");
    // Gli strumenti sono nella fila dell'editor: la riga della scheda è vuota.
    expect(mounted.writings[mounted.writings.length - 1]).toEqual({ toolbar: null });
    // A misura della scheda: gli strumenti della scheda.
    expect(vector.full).toEqual([false]);

    const drawn = DRAWING.replace('<g id="layer-1" fub:role="layer"/>', '<g id="layer-1" fub:role="layer"><path id="p1" d="M0 0L10 10"/></g>');
    vector.draw(drawn);
    mounted.view.leave?.();
    await settle();
    expect(host.files()["Schizzo.svg"]).toBe(drawn);
    expect(host.files()["Nota.md"]).toBe(NOTE);
    expect(root.querySelector(".canvas-card-drawing-editor")).toBeNull();
    expect(root.dataset.cardState).toBeUndefined();
    mounted.view.destroy();
    await settle();
  });

  it("«A tutta pagina» offre il resto degli strumenti, e tornando quelli della scheda", async () => {
    const mounted = mount(imagePort(files), "live", "Schizzo.svg", { editors: port("vector") });
    await settle();
    mounted.view.edit?.();
    await settle();
    const vector = surfaces[surfaces.length - 1]!;
    mounted.full = true;
    mounted.view.resize?.();
    mounted.full = false;
    mounted.view.resize?.();
    expect(vector.full).toEqual([false, true, false]);
    mounted.view.destroy();
    await settle();
  });

  it("col componente dei disegni spento resta il disegno fermo: nessun editor, niente scritto", async () => {
    for (const kind of ["none", "source"] as const) {
      surfaces = [];
      const mounted = mount(imagePort(files), "live", "Schizzo.svg", { editors: port(kind) });
      await settle();
      mounted.view.edit?.();
      await settle();
      const root = card(mounted.host);
      expect(root.querySelector(".canvas-card-drawing-editor"), kind).toBeNull();
      expect(root.dataset.cardState, kind).toBeUndefined();
      expect(root.querySelector("img.canvas-card-picture"), kind).not.toBeNull();
      expect(mounted.writings[mounted.writings.length - 1] ?? null, kind).toBeNull();
      expect(host.files()["Schizzo.svg"]).toBe(DRAWING);
      mounted.view.destroy();
      await settle();
    }
  });
});
