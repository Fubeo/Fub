// @vitest-environment happy-dom
// La scheda di documento (T44): la resa in continuo del file intero (anche con
// la parte `#Titolo`, che il modello dei documenti non regge), il documento
// lungo troncato con «Apri», la scrittura chiesta solo dove l'ospite la vuole
// e, con la porta vera delle schede e la sessione vera sull'host finto, la
// scrittura che salva il documento e non la nota, e lo stesso documento in un
// riquadro: una sessione, le due superfici allo stesso stato.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SessionModule from "../../../../state/document-session";

import { t } from "../../../../i18n/strings";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import type { CardContext, CardEditor, CardEditorOptions, CardEditorPort, CardMode, CardView, CardWriting } from "../contract";
import type { CanvasNode } from "../../../canvas/model";
import { createCardRegistry } from "../contract";
import { DocumentSurfaceRegistry, type EditorSurface, type SurfaceMountContext } from "../../registry";
import { operationFromText, type EditorChange } from "../../text-operation";
import { createFakeHost, type FakeHost } from "../../../../host/fake";
import { createCardEditorPort, type CardEditorHub } from "../editor-port";
import { DocumentSessionCollection, type DocumentSurfaceUpdate } from "../../../../state/document-session";
import { noteCardRenderer } from "./note";
import { DOCUMENT_CARD_MAX_BLOCKS, documentCardRenderer, type DocumentCardPort } from "./document";

/// La collezione della prova, dietro la `documentSessions` della finestra
/// (la porta lascia le sessioni da lì, come in `editor-port.test.ts`).
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

interface ShowCall {
  readonly path: string;
  readonly heading: string | null;
  readonly host: HTMLElement;
  readonly life: Lifetime;
}

/// La porta della shell, finta: la resa la scrive subito, `html` per file.
class FakePort implements DocumentCardPort {
  readonly calls: ShowCall[] = [];
  readonly opened: { path: string; subpath: string | null }[] = [];
  readonly html = new Map<string, string>();
  constructor(readonly writes: boolean) {}
  open = (path: string, subpath: string | null): void => {
    this.opened.push({ path, subpath });
  };
  show(path: string, heading: string | null, host: HTMLElement, life: Lifetime): Promise<void> {
    this.calls.push({ path, heading, host, life });
    host.innerHTML = this.html.get(path) ?? "<h1>Lettera</h1><p>Gentile dottoressa,</p>";
    return Promise.resolve();
  }
  watch(): () => void {
    return () => {};
  }
}

function node(file: string): CanvasNode {
  return { id: `n-${file}`, type: "file", x: 0, y: 0, width: 640, height: 360, file };
}

function mount(
  port: FakePort,
  mode: CardMode,
  path = "Lettere/Lettera.docx",
  subpath: string | null = null,
  extra: Partial<CardContext> = {},
): { view: CardView; host: HTMLElement; context: CardContext; writings: (CardWriting | null)[] } {
  const host = document.createElement("div");
  document.body.append(host);
  const writings: (CardWriting | null)[] = [];
  const context: CardContext = {
    path,
    subpath,
    documentId: "Nota.md",
    lifetime: openLifetime(),
    snapshots: { get: () => undefined, put: () => undefined, forget: () => undefined },
    size: () => ({ width: 640, height: 360 }),
    zoom: () => 1,
    missing: () => {},
    writing: (writing) => writings.push(writing),
    ...extra,
  };
  const view = documentCardRenderer(port).mount(node(path), host, mode, context);
  return { view, host, context, writings };
}

function root(host: HTMLElement): HTMLElement {
  const element = host.querySelector<HTMLElement>(".canvas-card-document:not([data-card-state=\"editing\"])");
  if (!element) throw new Error("la scheda non c'è");
  return element;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
  live.sessions = null;
});

describe("documentCardRenderer", () => {
  it("mostra i documenti, e sta nel registro accanto alla nota", () => {
    const renderer = documentCardRenderer(new FakePort(true));
    expect(renderer.kinds).toEqual(["document"]);
    const registry = createCardRegistry([noteCardRenderer(new FakePort(false)), renderer]);
    expect(registry.rendererFor("document")).toBe(renderer);
  });

  it("viva, rende il documento intero in continuo; da ferma lo tiene, inerte", async () => {
    const port = new FakePort(true);
    const { view, host } = mount(port, "live");
    await settle();
    const card = root(host);
    expect(card.dataset.cardKind).toBe("document");
    expect(card.classList.contains("canvas-card-note")).toBe(true);
    expect(card.dataset.cardState).toBe("content");
    expect(card.querySelector(".canvas-card-note-content.canvas-card-document-content h1")?.textContent).toBe("Lettera");
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]!.heading).toBeNull();
    expect(view.enter?.()).toBe(true);

    view.setMode("snapshot");
    expect(card.inert).toBe(true);
    expect(card.querySelector("h1")?.textContent).toBe("Lettera");
    expect(port.calls[0]!.life.closed).toBe(true);
  });

  it("la parte `#Titolo` resta scritta, ma la scheda mostra tutto il documento", async () => {
    const port = new FakePort(true);
    mount(port, "live", "Lettere/Lettera.docx", "#Saluti", { parts: { kind: "sections", sections: ["Saluti"], extra: {} } });
    await settle();
    expect(port.calls.map((call) => call.heading)).toEqual([null]);
  });

  it("un documento lungo si ferma con «Apri», che apre il file alla sua parte", async () => {
    const port = new FakePort(true);
    port.html.set("Lettere/Lungo.docx", "<p>riga</p>".repeat(DOCUMENT_CARD_MAX_BLOCKS + 1));
    const { host } = mount(port, "live", "Lettere/Lungo.docx", "#Indice");
    await settle();
    const card = root(host);
    expect(card.querySelector<HTMLElement>(".canvas-card-note-content")!.dataset.cardTruncated).toBe("true");
    const more = card.querySelector(".canvas-card-document-more");
    expect(more?.textContent).toContain(t("canvas.card.document_more"));
    more!.querySelector("button")!.click();
    expect(port.opened).toEqual([{ path: "Lettere/Lungo.docx", subpath: "#Indice" }]);

    // Uno che ci sta non ha la riga.
    const short = new FakePort(true);
    short.html.set("Lettere/Corto.docx", "<p>riga</p>".repeat(DOCUMENT_CARD_MAX_BLOCKS));
    const other = mount(short, "live", "Lettere/Corto.docx");
    await settle();
    expect(root(other.host).querySelector(".canvas-card-document-more")).toBeNull();
    expect(root(other.host).querySelector<HTMLElement>(".canvas-card-note-content")!.dataset.cardTruncated).toBeUndefined();
  });

  it("scrive solo dove l'ospite lo chiede, con l'editor compatto vestito dal tema", async () => {
    const asked: { path: string; host: HTMLElement; options: CardEditorOptions }[] = [];
    const bar = document.createElement("div");
    const editor: CardEditor = {
      focus: () => {},
      leave: async () => {},
      state: () => "salvato",
      onState: () => () => {},
      toolbar: () => bar,
      destroy: () => {},
    };
    const editors: CardEditorPort = {
      open: (path, host, options) => {
        asked.push({ path, host, options });
        return Promise.resolve(editor);
      },
    };

    // Sulla lavagna (D-14 (a)) il documento si legge e basta.
    const canvas = mount(new FakePort(false), "live", "Lettere/Lettera.docx", null, { editors });
    await settle();
    expect(canvas.view.edit?.()).toBe(false);
    expect(asked).toEqual([]);

    // Nella nota si scrive.
    const note = mount(new FakePort(true), "live", "Lettere/Lettera.docx", null, { editors });
    await settle();
    expect(note.view.edit?.()).toBe(true);
    await settle();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.path).toBe("Lettere/Lettera.docx");
    expect(asked[0]!.options.compact).toBe(true);
    expect(asked[0]!.options.heading).toBeNull();
    expect(asked[0]!.host.classList.contains("look-tema")).toBe(true);
    expect(asked[0]!.host.dataset.cardKind).toBe("document");
    expect(asked[0]!.host.hidden).toBe(false);
    expect(note.writings[note.writings.length - 1]).toEqual({ toolbar: bar });
  });
});

/// Una superficie dei documenti finta: tiene il testo (la proiezione) e il suo
/// annulla, come `editor-port.test.ts`; le battute vanno alla porta.
class FakeRich {
  text = "";
  readonly syncs: string[] = [];
  constructor(
    readonly context: SurfaceMountContext,
    readonly onChange: (paneId: string, change: EditorChange) => void,
  ) {}
  type(next: string): void {
    const before = this.text;
    this.text = next;
    this.onChange(this.context.paneId, { text: next, operation: operationFromText(before, next), origin: "input" });
  }
  surface(): EditorSurface {
    return {
      family: "rich",
      profile: "rich",
      surfaceId: this.context.paneId,
      modes: [{ id: "writing", label: () => "Scrittura", presentation: "surface", contextMode: "live_preview", looks: ["tema"] }],
      defaultMode: "writing",
      setMode: () => {},
      buffer: {
        setDoc: (text) => {
          this.text = text;
        },
        syncDoc: (update) => {
          this.text = typeof update === "string" ? update : update.text;
          this.syncs.push(this.text);
        },
        getDoc: () => this.text,
      },
      focus: () => {},
      setReadOnly: () => {},
      destroy: () => {},
    };
  }
}

describe("la scheda di documento sulla sessione del file", () => {
  const NOTE = "# Prestito\n\n![[Lettera.docx]]\n";
  const DOC = "{\"format\":\"fub-rich\",\"blocks\":[]}";
  let host: FakeHost;
  let sessions: DocumentSessionCollection;
  let hub: CardEditorHub;
  let surfaces: FakeRich[];
  /// I documenti che un riquadro mostra: la loro sessione resta.
  let panes: Set<string>;

  beforeEach(() => {
    panes = new Set();
    host = createFakeHost({ root: "/vault", file: { "Nota.md": NOTE, "Lettera.docx": DOC } });
    sessions = new DocumentSessionCollection({ ...host.module.api }, () => "/vault");
    live.sessions = sessions;
    surfaces = [];
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "test.rich",
      family: "rich",
      defaultProfile: "rich",
      formats: { docx: "rich" },
      factory: {
        mount: (_profile, context) => {
          const rich = new FakeRich(context, (paneId, change) => {
            if (!hub.written(paneId, change)) throw new Error(`modifica di un riquadro: ${paneId}`);
          });
          surfaces.push(rich);
          return rich.surface();
        },
      },
    });
    hub = createCardEditorPort({
      sessions,
      surfaces: () => registry,
      held: () => false,
      shownInPane: (path) => panes.has(path),
    });
  });

  async function writing(): Promise<{ view: CardView; rich: FakeRich }> {
    const { view } = mount(new FakePort(true), "live", "Lettera.docx", null, { editors: hub });
    await settle();
    expect(view.edit?.()).toBe(true);
    await settle();
    const rich = surfaces[surfaces.length - 1];
    if (!rich) throw new Error("l'editor dei documenti non si è montato");
    expect(rich.context.compact).toBe(true);
    return { view, rich };
  }

  it("col componente dei documenti spento la scheda resta a leggere: nessun editor, niente scritto", async () => {
    const off = createCardEditorPort({
      sessions,
      surfaces: () => new DocumentSurfaceRegistry(),
      held: () => false,
      shownInPane: (path) => panes.has(path),
    });
    const { view, host: box, writings } = mount(new FakePort(true), "live", "Lettera.docx", null, { editors: off });
    await settle();
    view.edit?.();
    await settle();
    expect(surfaces).toEqual([]);
    expect(writings[writings.length - 1] ?? null).toBeNull();
    expect(root(box).hidden).toBe(false);
    expect(root(box).querySelector("h1")?.textContent).toBe("Lettera");
    expect(host.files()["Lettera.docx"]).toBe(DOC);
    view.destroy();
    await settle();
  });

  it("scrivere nella scheda salva il documento, e la nota resta com'era", async () => {
    const { view, rich } = await writing();
    expect(rich.text).toBe(DOC);
    const written = "{\"format\":\"fub-rich\",\"blocks\":[\"Gentile dottoressa\"]}";
    rich.type(written);
    view.leave?.();
    await settle();
    expect(host.files()["Lettera.docx"]).toBe(written);
    expect(host.files()["Nota.md"]).toBe(NOTE);
    view.destroy();
    await settle();
  });

  it("lo stesso documento in una linguetta: una sessione, le due superfici allo stesso stato", async () => {
    await sessions.read("Lettera.docx");
    panes.add("Lettera.docx");
    let paneText = sessions.text("Lettera.docx") ?? "";
    const paneSyncs: DocumentSurfaceUpdate[] = [];
    const detach = sessions.attachSurface("Lettera.docx", {
      id: "pane-1",
      sync: (update) => {
        paneText = update.text;
        paneSyncs.push(update);
      },
    });
    const { view, rich } = await writing();

    // Dalla scheda al riquadro.
    const fromCard = "{\"format\":\"fub-rich\",\"blocks\":[\"dalla scheda\"]}";
    rich.type(fromCard);
    expect(sessions.text("Lettera.docx")).toBe(fromCard);
    expect(paneText).toBe(fromCard);

    // Dal riquadro alla scheda: la stessa sessione, nessuna seconda copia.
    const fromPane = "{\"format\":\"fub-rich\",\"blocks\":[\"dalla scheda\",\"dal riquadro\"]}";
    expect(sessions.acceptSurfaceChange("Lettera.docx", "pane-1", { text: fromPane, operation: operationFromText(fromCard, fromPane) }).kind).toBe("accepted");
    expect(rich.text).toBe(fromPane);
    expect(rich.syncs).toEqual([fromPane]);
    expect(paneSyncs.length).toBeGreaterThan(0);

    view.destroy();
    await settle();
    // La scheda se ne va: la sessione resta del riquadro, col testo di tutti e due.
    expect(sessions.get("Lettera.docx")).toBeDefined();
    expect(sessions.text("Lettera.docx")).toBe(fromPane);
    detach();
  });
});
