// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MENU_RULE, type SurfaceMenuItem } from "../core/editor-menu";
import { renderMarkdown } from "../text/profiles/markdown/render";
import { mountMarkdown } from "../text/profiles/markdown/mount";
import { CANVAS_ZOOM_STEP, CARD_PAUSE_MS, CanvasEngine, EDGE_SCROLL_MAX, EDGE_SCROLL_ZONE, MAX_CANVAS_HISTORY, NEXT_CARD_GAP, edgeScrollSpeed, MEASURE_IMAGE_TIMEOUT_MS, proposedNoteName, type CanvasChange, type CanvasCorePort, type CanvasDepositCards, type CanvasEngineOptions } from "./engine";
import type { CanvasDocument } from "./model";
import { readCanvasClipboard } from "./clipboard";
import { dropLayout } from "./drop-layout";
import { ENTRIES_DRAG_TYPE } from "../../ui/drag-types";
import { applyOperation, lineFeeds, operationFromText } from "../core/text-operation";
import { t } from "../../i18n/strings";
import agentBoard from "../../__fixtures__/canvas-ops/agent-board.json";
import blankBomCrlf from "../../__fixtures__/canvas-patches/02-blank-bom-crlf.json";
import rootWithoutNodes from "../../__fixtures__/canvas-patches/12-root-without-nodes.json";
import prettyNode from "../../__fixtures__/canvas-patches/14-remove-pretty-node-undo-compacts.json";
import nodesNull from "../../__fixtures__/canvas-patches/19-nodes-null.json";
import knownNumberForms from "../../__fixtures__/canvas-patches/22-known-number-forms.json";
import duplicateUnknownKey from "../../__fixtures__/canvas-patches/32-rejected-duplicate-unknown-key.json";
import nestedDuplicate from "../../__fixtures__/canvas-patches/33-rejected-nested-duplicate.json";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import { CanvasDepositError } from "../../state/canvas-intake";
import { upsertNodePatch, type CanvasOperation, type CanvasPatch } from "./operation";
import { TEXT_KEY as TEXT_FIELD } from "./text-style";
import { CanvasCoreError, canvasCoreReady, openCore, openCoreNow, type CanvasCore, type CanvasIntentOp } from "./wasm/core";
import { DEFAULT_PREFERENCES, type CanvasPreferences, type WheelAction } from "./preferences";
import { CANVAS_TOOL_IDS, toolCommandId } from "./chrome/commands";
import { CARD_PANEL_ID, createCanvasInspector } from "./chrome/inspector";
import { selectionBarPlaceBelow } from "./chrome/selection-bar";
import { INERTIA_MS } from "../../spatial/camera";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import {
  createCardRegistry,
  type CardContext,
  type CardEditorPort,
  type CardRenderer,
  type CardTextEditor,
  type CardTextOptions,
  type CardView,
} from "./cards";
import { CardCache } from "./card-cache";

// Le impostazioni della lavagna (T35): il motore monta `watchPreferences`, e la
// prova tiene le sue funzioni per cambiare «La rotella del mouse» a lavagna
// aperta, come farebbe un cambio da Impostazioni. Il resto del modulo è quello vero.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("./preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./preferences")>()),
  watchPreferences: (apply: (preferences: CanvasPreferences) => void) => {
    watched.appliers.push(apply);
    return () => {
      watched.appliers = watched.appliers.filter((other) => other !== apply);
    };
  },
}));

// Le notifiche della shell (T70, «Estrai in una nota»): la prova legge che
// cosa dicono e quale gesto offrono. Il resto del modulo è quello vero.
const notices = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("../../ui/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/notify")>()),
  notify: notices.notify,
}));

// Il nucleo si carica una volta: dopo, la tela si apre subito.
beforeAll(async () => {
  await canvasCoreReady();
});

/** La lavagna di un testo come la legge il nucleo. */
function readCanvas(text: string): CanvasDocument {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model();
  } finally {
    core.close();
  }
}

/** Il commit del nucleo come lo manda una superficie: il testo di dopo e l'operazione sul testo a `\n`. */
function commitOnCore(before: string, patches: readonly CanvasPatch[]): { text: string; operation: CanvasOperation } {
  const core = openCoreNow(before);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    const text = core.preview(patches);
    return { text, operation: { kind: "canvas", patches, ...operationFromText(lineFeeds(before), lineFeeds(text)) } };
  } finally {
    core.close();
  }
}

function canvasSource(): string {
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

/**
 * «Allinea e distribuisci» dalla riga delle opzioni (T50; prima erano
 * pulsanti della barra di N4): apre il menu e sceglie la voce `label`.
 */
function alignFromOptions(host: HTMLElement, label: string): void {
  host.querySelector<HTMLButtonElement>('.canvas-options [data-canvas-action="align-menu"]')!.click();
  const entry = [...document.querySelectorAll<HTMLElement>(".context-menu [role=menuitem]")]
    .find((item) => item.querySelector(".menu-label")?.textContent === label);
  if (!entry) throw new Error(`nessuna voce «${label}» nel menu`);
  entry.click();
}

/** Tre archi come li scrive Obsidian: uno senza punte, uno con `toEnd` none, uno con `fromEnd` scritta. */
function tipsSource(): string {
  return JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 100, height: 100, text: "a" },
      { id: "b", type: "text", x: 300, y: 0, width: 100, height: 100, text: "b" },
      { id: "c", type: "text", x: 0, y: 300, width: 100, height: 100, text: "c" },
      { id: "d", type: "text", x: 300, y: 300, width: 100, height: 100, text: "d" },
    ],
    edges: [
      { id: "senza", fromNode: "a", toNode: "b" },
      { id: "nessuna", fromNode: "a", toNode: "c", toEnd: "none" },
      { id: "due", fromNode: "c", toNode: "d", fromEnd: "arrow" },
    ],
  });
}

/**
 * Un arco come lo disegna la tela, dalla sua geometria: i due estremi della
 * linea e il punto da cui parte ciascuna punta (prima quella dell'inizio).
 */
function drawnEdge(host: HTMLElement, edge: string): { start: number[]; end: number[]; tips: number[][] } {
  const group = host.querySelector(`.canvas-edge-line[data-edge="${edge}"]`)!.closest("g")!;
  const points = (d: string | null): number[] => (d ?? "").match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)!.map(Number);
  const line = points(group.querySelector(".canvas-edge-line")!.getAttribute("d"));
  return {
    start: line.slice(0, 2),
    end: line.slice(-2),
    tips: Array.from(group.querySelectorAll(".canvas-edge-arrow"), (arrow) => points(arrow.getAttribute("d")).slice(0, 2)),
  };
}

function mounted(source = canvasSource(), overrides: Partial<CanvasEngineOptions> = {}) {
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

afterEach(() => {
  document.body.replaceChildren();
});

describe("CanvasEngine", () => {
  it("il tasto destro: su una scheda la sceglie e offre i suoi gesti, sul vuoto aggiunge lì", () => {
    const { engine, host, changes, opened } = mounted();
    const pointing = vi.spyOn(document, "elementFromPoint");
    pointing.mockReturnValue(host.querySelector('.canvas-node[data-node="f"]'));
    const menu = engine.contextMenu({ x: 10, y: 10 })!;
    expect(menu.target).toEqual({ kind: "node", ref: "f", label: "Scheda di immagine", name: "foto.png" });
    expect(host.querySelector('.canvas-node[data-node="f"]')!.classList.contains("selected")).toBe(true);
    const items = (menu.context ?? []).filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    expect(items.map((item) => item.id)).toEqual(["canvas.open_viewer", "canvas.connect", "canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.delete"]);
    items[0]!.run!();
    expect(opened).toContainEqual({ path: "/allegati/foto.png" });
    (items[2]!.items as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color.4")!.run!();
    expect(readCanvas(changes[changes.length - 1]!.text).nodes.find((node) => node.id === "f")!.color).toBe("4");

    pointing.mockReturnValue(host.querySelector(".canvas-viewport"));
    const empty = engine.contextMenu({ x: 300, y: 300 })!;
    pointing.mockRestore();
    expect(empty.target.kind).toBe("empty");
    const add = (empty.context as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.add")!;
    const before = readCanvas(engine.getDoc()).nodes.length;
    (add.items as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.add.text")!.run!();
    expect(readCanvas(engine.getDoc()).nodes.length).toBe(before + 1);
    engine.destroy();
  });

  it("monta card testo/file/gruppi/web, archi e seleziona", () => {
    const { engine, host } = mounted();
    expect(host.querySelectorAll(".canvas-node").length).toBe(4);
    expect(host.querySelector(".canvas-node-text .canvas-markdown .wikilink")).not.toBeNull();
    expect(host.querySelector(".canvas-file-link")).not.toBeNull();
    expect(host.querySelector(".canvas-group-label")?.textContent).toBe("Idee");
    // Web card inerte: niente iframe nel DOM trusted.
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".canvas-url-text")?.textContent).toBe("https://example.com/x");
    expect(host.querySelectorAll(".canvas-edge").length).toBe(1);
    engine.destroy();
  });

  // Le punte di serie di JSON Canvas: senza `toEnd` la freccia è alla fine, senza `fromEnd` nessuna
  // all'inizio, e il file non cambia finché nessuno lo tocca.
  it("disegna le punte di serie: senza toEnd la freccia è alla fine, toEnd none la toglie, fromEnd la mette all'inizio", () => {
    const source = tipsSource();
    const { engine, host } = mounted(source);
    expect(engine.getDoc()).toBe(source);
    const senza = drawnEdge(host, "senza");
    expect(senza.tips).toEqual([senza.end]);
    expect(drawnEdge(host, "nessuna").tips).toEqual([]);
    const due = drawnEdge(host, "due");
    expect(due.tips).toEqual([due.start, due.end]);
    engine.destroy();
  });

  // Invertire il verso non sposta la freccia: quella di serie resta sulla scheda, ora all'inizio.
  it("invertendo un arco senza punte scritte la freccia resta sulla sua scheda", () => {
    const { engine, host } = mounted(tipsSource());
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector('.canvas-edge-hit[data-edge="senza"]'));
    const menu = engine.contextMenu({ x: 10, y: 10 });
    pointing.mockRestore();
    expect(menu?.target).toEqual({ kind: "edge", ref: "senza" });
    (menu!.context as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.edge.reverse")!.run!();
    expect(readCanvas(engine.getDoc()).edges[0]).toMatchObject({ fromNode: "b", toNode: "a", fromEnd: "arrow", toEnd: "none" });
    const drawn = drawnEdge(host, "senza");
    expect(drawn.tips).toEqual([drawn.start]);
    engine.destroy();
  });

  // I78: le card di testo sono Markdown del vault, con le sue sintassi.
  it("rende le card con le sintassi che il vault dà al Markdown", () => {
    const source = JSON.stringify({
      nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 240, height: 140, text: "==segnato==" }],
      edges: [],
    });
    const seen: unknown[] = [];
    const { engine, host } = mounted(source, {
      renderMarkdownForCard: (_nodeId, text, host, forms) => {
        seen.push(forms);
        host.innerHTML = renderMarkdown(text, forms).html;
      },
    });
    expect(seen).toEqual([undefined]);
    engine.setSyntaxForms([]);
    expect(seen).toEqual([undefined, []]);
    expect(host.querySelector(".canvas-markdown mark")).toBeNull();
    engine.setSyntaxForms([{ name: "fub:highlight", trigger: { inline: { open: "==", close: "==" } } }]);
    expect(host.querySelector(".canvas-markdown mark")?.textContent).toBe("segnato");
    engine.destroy();
  });

  it("muove via tastiera con snap su JSON persistito con preimmagini", () => {
    const { engine, host, changes } = mounted();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.focus();
    // Il fuoco è sul viewport: nessun nodo selezionato → seleziona il primo.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // Secondo ArrowRight: muove il primo nodo di +8px con snap.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(changes.length).toBe(1);
    expect(applyOperation(canvasSource(), changes[0].operation)).toBe(engine.getDoc());
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes[0].x).toBe(48);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes[0].x).toBe(40);
    expect(engine.redo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes[0].x).toBe(48);
    engine.destroy();
  });

  it("apre wikilink/file/web via porte esistenti, mai iframe; codice non linkato", async () => {
    const { engine, host, opened } = mounted(
      JSON.stringify({
        nodes: [
          { id: "t", type: "text", x: 0, y: 0, width: 240, height: 140, text: "`[[NonLink]]` ma [[Altra]]" },
          { id: "f", type: "file", x: 400, y: 40, width: 240, height: 140, file: "allegati/foto.png" },
          { id: "w", type: "link", x: 400, y: 240, width: 240, height: 100, url: "https://example.com/x" },
        ],
        edges: [],
      }),
    );
    expect(host.querySelectorAll(".canvas-markdown .wikilink").length).toBe(1);
    host.querySelector<HTMLElement>(".canvas-markdown .wikilink")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await vi.waitFor(() => expect(opened.some((o) => o.page === "Altra")).toBe(true));
    host.querySelector<HTMLElement>(".canvas-file-link")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await vi.waitFor(() => expect(opened.some((o) => o.path === "/allegati/foto.png")).toBe(true));
    host.querySelector<HTMLElement>(".canvas-open-url")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await vi.waitFor(() => expect(opened.some((o) => o.url === "https://example.com/x")).toBe(true));
    expect(host.querySelector("iframe")).toBeNull();
    engine.destroy();
  });

  it("apre file card dal vault root anche da canvas annidato, preservando il subpath", () => {
    const source = JSON.stringify({
      nodes: [{ id: "f", type: "file", x: 0, y: 0, width: 240, height: 120,
        file: "Notes/nota.md", subpath: "#Sezione" }],
      edges: [],
    });
    const open = vi.fn();
    const { engine, host } = mounted(source, {
      documentId: "Boards/board.canvas",
      onOpenPath: open,
    });
    host.querySelector<HTMLButtonElement>(".canvas-file-link")!.click();
    expect(open).toHaveBeenCalledWith("/Notes/nota.md#Sezione", "Boards/board.canvas");
    expect(readCanvas(engine.getDoc()).nodes[0]).toMatchObject({
      file: "Notes/nota.md", subpath: "#Sezione",
    });
    engine.destroy();
  });

  it("non apre link Canvas con schemi eseguibili", () => {
    const { engine, host, opened } = mounted(JSON.stringify({
      nodes: [{ id: "unsafe", type: "link", x: 0, y: 0, width: 200, height: 120, url: "javascript:alert(1)" }],
      edges: [],
    }));
    const button = host.querySelector<HTMLButtonElement>(".canvas-open-url")!;
    expect(button.disabled).toBe(true);
    button.click();
    expect(opened).toEqual([]);
    engine.destroy();
  });

  it("registra la digitazione alla pausa, chiude il campo in sola lettura e annulla il passo", () => {
    vi.useFakeTimers();
    try {
      const { engine, host, changes } = mounted();
      const input = openField(host, "t");
      type(input, "Testo non ancora confermato dal blur");
      expect(changes).toHaveLength(0);
      vi.advanceTimersByTime(CARD_PAUSE_MS);
      expect(changes).toHaveLength(1);
      expect(readCanvas(engine.getDoc()).nodes[0].text).toBe(input.value);
      expect(applyOperation(canvasSource(), changes[0].operation)).toBe(engine.getDoc());
      engine.setReadOnly(true);
      expect(host.querySelector(".canvas-text-editor")).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('[data-canvas-action="zoom-in"]')?.disabled).toBe(false);
      expect(engine.undo()).toBe(false);
      engine.setReadOnly(false);
      expect(engine.undo()).toBe(true);
      expect(readCanvas(engine.getDoc()).nodes[0].text).toBe("vedi [[Altra]] e #tag");
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("conserva i campi non interpretati attraverso setDoc/syncDoc", () => {
    const { engine } = mounted();
    const withExtra = JSON.parse(canvasSource()) as Record<string, unknown>;
    withExtra.xRoot = { keep: true };
    (withExtra.nodes as Array<Record<string, unknown>>)[0].xVendor = 7;
    engine.setDoc(JSON.stringify(withExtra));
    const doc = readCanvas(engine.getDoc()) as unknown as Record<string, unknown>;
    expect(doc.xRoot).toEqual({ keep: true });
    expect((doc.nodes as Array<Record<string, unknown>>)[0].xVendor).toBe(7);
    engine.syncDoc(engine.getDoc());
    const again = readCanvas(engine.getDoc()) as unknown as Record<string, unknown>;
    expect(again.xRoot).toEqual({ keep: true });
    engine.destroy();
  });

  it("pan/zoom da tastiera e mouse senza perdere campi non interpretati", () => {
    const { engine, host } = mounted();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true, ctrlKey: true }));
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }));
    expect(engine.getDoc()).toContain('"t"');
    engine.destroy();
    void vi;
  });
  it("mantiene la revisione remota dopo un conflitto di preimmagine Canvas", () => {
    const { engine, host, changes } = mounted();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(changes[0].operation.patches[0]).toMatchObject({ kind: "upsert-node" });
    const remote = JSON.parse(canvasSource());
    remote.nodes[0].x = 112;
    remote.xRoot = { keep: true };
    engine.syncDoc({ text: JSON.stringify(remote), operation: changes[0].operation });
    expect(readCanvas(engine.getDoc()).nodes[0].x).toBe(112);
    expect(engine.undo()).toBe(false);
    expect(readCanvas(engine.getDoc()).xRoot).toEqual({ keep: true });
    engine.destroy();
  });

  it("non applica patch Canvas disallineate a una sorgente remota valida", () => {
    const before = canvasSource();
    const { engine } = mounted(before);
    const doc = readCanvas(before);
    const changed = commitOnCore(before, [upsertNodePatch(doc, { ...doc.nodes[0], x: 48 })!]);
    const unrelated = readCanvas(before);
    const wrong = upsertNodePatch(unrelated, { ...unrelated.nodes[1], x: 408 })!;
    const wrongOperation: CanvasOperation = { ...changed.operation, patches: [wrong] };
    engine.syncDoc({ text: changed.text, operation: wrongOperation });
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([48, 400, 40, 400]);
    engine.destroy();
  });

  it("dice le carte scelte col loro testo, l'ultima come primaria", () => {
    const { engine, host } = mounted();
    expect(engine.selectedText()).toBeNull();
    const byte = (needle: string) => new TextEncoder().encode(engine.getDoc().slice(0, engine.getDoc().indexOf(needle))).length;
    engine.revealSource(byte("allegati"));
    expect(engine.selectedText()).toEqual({ primary: "allegati/foto.png", secondary: [] });
    host.querySelector(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    const all = engine.selectedText()!;
    expect([all.primary, ...all.secondary].sort()).toEqual(
      ["Idee", "allegati/foto.png", "https://example.com/x", "vedi [[Altra]] e #tag"],
    );
    engine.destroy();
    expect(engine.selectedText()).toBeNull();
  });

  it("allinea più card in una patch batch annullabile, preservando i dati ignoti", () => {
    const { engine, host, changes } = mounted();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    alignFromOptions(host, "Allinea a sinistra");
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.patches.length).toBeGreaterThan(1);
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([40, 40, 40, 40]);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([40, 400, 40, 400]);
    engine.destroy();
  });

  it("fit selection cambia solo la camera, non la sorgente", () => {
    const before = canvasSource();
    const { engine, host, changes } = mounted(before);
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    const all = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    host.querySelector<HTMLButtonElement>('[data-canvas-action="fit-selection"]')!.click();
    expect(host.querySelector<HTMLElement>(".canvas-stage")!.style.transform).not.toBe(all);
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("porta a schermo la card che contiene un punto della sorgente, senza toccarla", () => {
    // Una carta con testo non ASCII prima del bersaglio: l'offset è in byte
    // UTF-8, come ogni span del modello, e non in unità UTF-16.
    const source = JSON.stringify({
      nodes: [
        { id: "prima", type: "text", x: 0, y: 0, width: 100, height: 60, text: "città — perché" },
        { id: "bersaglio", type: "text", x: 900, y: 700, width: 100, height: 60, text: "qui" },
      ],
      edges: [],
    });
    const selections: string[] = [];
    const { engine, host, changes } = mounted(source, { onSelectionChange: () => selections.push("changed") });
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const before = stage.style.transform;
    const byte = new TextEncoder().encode(source.slice(0, source.indexOf('"qui"'))).length;

    expect(engine.revealSource(byte)).toBe(true);
    expect([...host.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((el) => el.dataset.node))
      .toEqual(["bersaglio"]);
    expect(stage.style.transform).not.toBe(before);
    expect(selections).toEqual(["changed"]);
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);

    // Un punto fuori dalle carte (la radice, gli archi) non ha dove andare.
    expect(engine.revealSource(new TextEncoder().encode(source).length - 1)).toBe(false);
    engine.destroy();
    expect(engine.revealSource(byte)).toBe(false);
  });

  it("distribuisce i centri sull'asse x senza spostare gli estremi", () => {
    const source = JSON.stringify({
      nodes: [0, 80, 400].map((x, index) => ({
        id: `n${index}`, type: "text", x, y: 0, width: 100, height: 80, text: `card ${index}`,
      })),
      edges: [],
    });
    const { engine, host, changes } = mounted(source);
    host.querySelector(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "a", ctrlKey: true, bubbles: true,
    }));
    alignFromOptions(host, "Distribuisci orizzontalmente");
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([0, 200, 400]);
    expect(changes[0].operation.patches).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([0, 80, 400]);
    engine.destroy();
  });

  it("applica colore nodo preset e hex mantenendo undo strutturale", () => {
    const { engine, host, changes } = mounted();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // Il colore passa dai comandi del menu (T47): la barra di N4 non ha più
    // il suo `select`.
    expect(host.querySelector('[data-canvas-field="node-color"]')).toBeNull();
    const run = (id: string) => engine.commands().find((command) => command.id === id)!.run();
    run("canvas.color.2");
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("2");
    run("canvas.color.other");
    const input = document.querySelector<HTMLInputElement>(".kit-color-popover .kit-color-input")!;
    input.value = "#AABBCC";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Si scrive minuscolo.
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("#aabbcc");
    expect(changes).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("2");
    engine.destroy();
    // Il selettore si chiude con la lavagna.
    expect(document.querySelector(".kit-color-popover")).toBeNull();
  });

  it("i colori sul nodo e sul filo vanno alla pelle: la chiave e il colore libero (T47)", () => {
    // Un colore che Fub non conosce («7», «rosso») non sta qui: lo prova il
    // blocco T47b in fondo al file, e `colors.test.ts` che la tela non lo disegna.
    const source = JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 80, text: "a", color: "3" },
        { id: "b", type: "text", x: 200, y: 0, width: 100, height: 80, text: "b", color: "#0064B0" },
        { id: "c", type: "text", x: 400, y: 0, width: 100, height: 80, text: "c", color: "#ABC" },
        { id: "e", type: "text", x: 800, y: 0, width: 100, height: 80, text: "e" },
      ],
      edges: [
        { id: "e1", fromNode: "a", toNode: "b", color: "5" },
        { id: "e2", fromNode: "b", toNode: "c", color: "#7b3fa0" },
      ],
    });
    const { engine, host, changes } = mounted(source);
    const node = (id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
    expect(node("a").dataset.canvasColor).toBe("3");
    expect(node("b").dataset.canvasColor).toBe("blue");
    expect(node("c").dataset.canvasColor).toBe("custom");
    expect(node("c").style.getPropertyValue("--canvas-color")).toBe("#ABC");
    expect(node("e").dataset.canvasColor).toBeUndefined();
    // Nessun fondo in linea: la carta la dà la pelle.
    for (const id of ["a", "b", "c", "e"]) expect(node(id).style.background).toBe("");
    // Il nome del colore arriva a chi ascolta, in coda al nome della scheda
    // (T61), che la scheda col fuoco ha subito.
    const label = (id: string): string => {
      node(id).focus();
      return node(id).getAttribute("aria-label") ?? "";
    };
    const color = (name: string): string => ` ${t("canvas.options.color_value", { name })}.`;
    expect(label("e")).toBe(`${t("canvas_menu.header", { kind: t("canvas_menu.kind.text") })} e.`);
    expect(label("b").endsWith(color("Blu delle note"))).toBe(true);
    expect(label("c").endsWith(color("#abc"))).toBe(true);
    // «a» per ultima: col fuoco è la scheda scelta, a cui si toglie il colore.
    expect(label("a").endsWith(color("Giallo"))).toBe(true);
    const edge = (id: string) => host.querySelector<SVGPathElement>(`.canvas-edge-line[data-edge="${id}"]`)!.parentElement!;
    expect(edge("e1").dataset.canvasColor).toBe("5");
    expect(edge("e2").dataset.canvasColor).toBe("custom");
    expect((edge("e2") as unknown as SVGElement).style.getPropertyValue("--canvas-color")).toBe("#7b3fa0");
    expect(host.querySelector(".canvas-edge-line")!.hasAttribute("stroke")).toBe(false);
    // Aprire e guardare non scrive niente.
    expect(changes).toHaveLength(0);
    // Togliere il colore toglie la chiave.
    host.querySelector(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    engine.commands().find((command) => command.id === "canvas.color.none")!.run();
    expect(node("a").dataset.canvasColor).toBeUndefined();
    engine.destroy();
  });

  it("una lavagna coi sei colori di oggi resta identica byte per byte; un colore letto non si riscrive (T47)", () => {
    const source = '{\n  "nodes": [\n'
      + ["1", "2", "3", "4", "5", "6"].map((color, index) =>
        `    {"id":"n${index}","type":"text","x":${index * 200},"y":0,"width":100,"height":80,"color":"${color}","text":"${color}"}`).join(",\n")
      + ',\n    {"id":"x","type":"text","x":0,"y":200,"width":100,"height":80,"color":"#ABC","text":"x"}'
      + ',\n    {"id":"y","type":"text","x":200,"y":200,"width":100,"height":80,"color":"#aabbccdd","text":"y"}'
      + ',\n    {"id":"z","type":"text","x":400,"y":200,"width":100,"height":80,"color":"#0064B0","text":"z"}'
      + '\n  ],\n  "edges": [\n    {"id":"e","fromNode":"n0","toNode":"n1","color":"4"}\n  ]\n}\n';
    const { engine, host, changes } = mounted(source);
    // Aperta, resa e rifatta: nessuna scrittura.
    engine.setTheme("dark");
    engine.setTheme("light");
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    // Un gesto su un'altra cosa: cambia soltanto quella.
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(engine.getDoc()).toBe(source.replace('"id":"n0","type":"text","x":0,"y":0', '"id":"n0","type":"text","x":0,"y":8'));
    // Lo stesso colore scelto di nuovo non scrive.
    const before = changes.length;
    engine.commands().find((command) => command.id === "canvas.color.1")!.run();
    expect(changes).toHaveLength(before);
    engine.destroy();
  });

  it("muove una card gruppo con le card geometricamente contenute come batch annullabile", () => {
    const source = JSON.stringify({
      nodes: [
        { id: "g", type: "group", x: 0, y: 0, width: 480, height: 320, label: "Inside" },
        { id: "a", type: "text", x: 40, y: 40, width: 100, height: 80, text: "inside" },
        { id: "b", type: "text", x: 600, y: 0, width: 100, height: 80, text: "outside" },
      ],
      edges: [], vendor: { preserve: true },
    });
    const { engine, host, changes } = mounted(source);
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    host.querySelector<HTMLElement>('.canvas-node-group .canvas-node-handle')!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: 10, clientY: 10 }),
    );
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 26, clientY: 10 }));
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, clientX: 26, clientY: 10 }));
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes.map((node) => node.x)).toEqual([16, 56, 600]);
    expect(doc.vendor).toEqual({ preserve: true });
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.patches).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([0, 40, 600]);
    engine.destroy();
  });

  it("deposita allegati prima delle card, elimina duplicati e converte testo in note via porta", async () => {
    const deposit = vi.fn(async () => ["attachments/photo.png", "attachments/photo.png"]);
    const create = vi.fn(async () => "Notes/new.md");
    const { engine, host, changes } = mounted(canvasSource(), {
      attachments: { deposit },
      notes: { freeName: async (_folder, name) => name, create, read: async () => "" },
    });
    const clipboard = new Event("paste", { bubbles: true, cancelable: true });
    const file = new File(["image"], "photo.png", { type: "image/png" });
    Object.defineProperty(clipboard, "clipboardData", { value: {
      files: [file], getData: () => "",
    } });
    host.querySelector(".canvas-viewport")!.dispatchEvent(clipboard);
    await vi.waitFor(() => expect(deposit).toHaveBeenCalledWith([file], "board.canvas", expect.objectContaining({ repoint: expect.any(Function) })));
    await vi.waitFor(() => expect(readCanvas(engine.getDoc()).nodes.filter((node) => node.file === "attachments/photo.png")).toHaveLength(1));
    expect(host.querySelector(".canvas-media-placeholder")?.textContent).toContain("IMAGE");
    expect(host.querySelector("img,audio,video,iframe")).toBeNull();
    // Il pulsante della scheda di testo è «Estrai in una nota» (T70): chiede il nome.
    host.querySelector<HTMLButtonElement>(".canvas-convert-note")!.click();
    await vi.waitFor(() => expect(document.querySelector('.kit-dialog [data-action="extract"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="extract"]')!.click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith("", "vedi [[Altra]] e #tag", "vedi [[Altra]] e #tag"));
    await vi.waitFor(() => expect(readCanvas(engine.getDoc()).nodes[0]).toMatchObject({ type: "file", file: "Notes/new.md" }));
    expect(changes[changes.length - 1]?.operation.patches[0]).toMatchObject({ kind: "upsert-node" });
    engine.destroy();
  });
  it("espande una cartella del vault tramite porta e non duplica le file card", async () => {
    const deposit = vi.fn(async () => [] as string[]);
    const resolvePaths = vi.fn(async () => ["Notes/one.md", "Notes/one.md", "Notes/two.md"]);
    const { engine, host } = mounted(canvasSource(), { attachments: { deposit, resolvePaths } });
    const drop = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
    Object.defineProperties(drop, {
      dataTransfer: { value: { files: [], getData: () => "" } },
      clientX: { value: 0 },
      clientY: { value: 0 },
    });
    host.querySelector(".canvas-viewport")!.dispatchEvent(drop);
    await vi.waitFor(() => expect(resolvePaths).toHaveBeenCalledWith(drop.dataTransfer, "board.canvas"));
    await vi.waitFor(() => expect(readCanvas(engine.getDoc()).nodes
      .filter((node) => node.file?.startsWith("Notes/")).map((node) => node.file)).toEqual(["Notes/one.md", "Notes/two.md"]));
    expect(deposit).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("una card file nuova punta al file scelto, mai a un segnaposto", async () => {
    const without = mounted();
    expect(without.host.querySelector('[data-canvas-action="add-file"]')).toBeNull();
    without.engine.destroy();

    const answers: Array<string | null> = [null, "../fuori.md", "Cartella/scelta.pdf"];
    const pick = vi.fn(async () => answers.shift() ?? null);
    const { engine, host } = mounted(canvasSource(), { onPickFile: pick });
    const files = () => readCanvas(engine.getDoc()).nodes.filter((node) => node.type === "file").map((node) => node.file);
    for (let attempt = 1; attempt <= 3; attempt++) {
      host.querySelector<HTMLButtonElement>('[data-canvas-action="add-file"]')!.click();
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(attempt));
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(files()).toEqual(["allegati/foto.png", "Cartella/scelta.pdf"]));
    engine.destroy();
  });

  it("una ricevuta di deposito tardiva non inserisce allegati nel canvas cambiato", async () => {
    let release!: (paths: readonly string[]) => void;
    const deposit = vi.fn(() => new Promise<readonly string[]>((resolve) => { release = resolve; }));
    const { engine, host } = mounted(canvasSource(), { attachments: { deposit } });
    const clipboard = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(clipboard, "clipboardData", { value: {
      files: [new File(["bytes"], "late.png")], getData: () => "",
    } });
    host.querySelector(".canvas-viewport")!.dispatchEvent(clipboard);
    expect(deposit).toHaveBeenCalledTimes(1);
    const remote = JSON.parse(canvasSource());
    remote.nodes[0].text = "Remote version";
    engine.syncDoc(JSON.stringify(remote));
    release(["attachments/late.png"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(readCanvas(engine.getDoc()).nodes[0].text).toBe("Remote version");
    engine.destroy();
  });

  describe("le schede di un deposito si ripuntano per id (T32b, «Fanne una copia»)", () => {
    /// Incolla `names` sulla lavagna: il deposito torna `paths` e la porta
    /// delle schede del gesto resta al test.
    async function pasted(paths: readonly string[], source = canvasSource()) {
      let cards: CanvasDepositCards | null = null;
      const deposit = vi.fn(async (_files: readonly File[], _id: string, given: CanvasDepositCards) => {
        cards = given;
        return paths;
      });
      const view = mounted(source, { attachments: { deposit } });
      const clipboard = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(clipboard, "clipboardData", { value: {
        files: paths.map((path) => new File(["x"], path.split("/").pop()!)), getData: () => "",
      } });
      view.host.querySelector(".canvas-viewport")!.dispatchEvent(clipboard);
      await vi.waitFor(() => expect(readCanvas(view.engine.getDoc()).nodes.filter((node) => paths.includes(node.file ?? ""))).toHaveLength(new Set(paths).size));
      return { ...view, cards: cards! };
    }
    const files = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes.filter((node) => node.type === "file").map((node) => node.file);

    it("più schede in un commit solo, e un annulla torna ai file riusati", async () => {
      const { engine, changes, cards } = await pasted(["Foto/a.png", "Foto/b.png"]);
      const before = changes.length;
      expect(cards.live()).toBe(true);
      expect(cards.repoint([{ from: "Foto/a.png", to: "attachments/a.png" }, { from: "Foto/b.png", to: "attachments/b.png" }])).toBe(2);
      expect(changes).toHaveLength(before + 1);
      expect(files(engine)).toEqual(["allegati/foto.png", "attachments/a.png", "attachments/b.png"]);
      expect(engine.undo()).toBe(true);
      expect(files(engine)).toEqual(["allegati/foto.png", "Foto/a.png", "Foto/b.png"]);
      engine.destroy();
    });

    it("una scheda sola: la sua, non quella che mostrava già lo stesso file", async () => {
      const { engine, cards } = await pasted(["allegati/foto.png"]);
      expect(files(engine)).toEqual(["allegati/foto.png", "allegati/foto.png"]);
      expect(cards.repoint([{ from: "allegati/foto.png", to: "attachments/foto 1.png" }])).toBe(1);
      const nodes = readCanvas(engine.getDoc()).nodes.filter((node) => node.type === "file");
      expect(nodes.find((node) => node.id === "f")?.file).toBe("allegati/foto.png");
      expect(nodes.filter((node) => node.id !== "f").map((node) => node.file)).toEqual(["attachments/foto 1.png"]);
      engine.destroy();
    });

    it("la scheda tolta prima non si tocca; quella già puntata altrove nemmeno", async () => {
      const { engine, cards } = await pasted(["Foto/a.png", "Foto/b.png"]);
      const doc = JSON.parse(engine.getDoc()) as CanvasDocument;
      doc.nodes = doc.nodes.filter((node) => node.file !== "Foto/a.png")
        .map((node) => (node.file === "Foto/b.png" ? { ...node, file: "Altro/b.png" } : node));
      engine.syncDoc(JSON.stringify(doc));
      expect(cards.repoint([{ from: "Foto/a.png", to: "attachments/a.png" }, { from: "Foto/b.png", to: "attachments/b.png" }])).toBe(0);
      expect(files(engine)).toEqual(["allegati/foto.png", "Altro/b.png"]);
      engine.destroy();
    });

    it("chiusa la lavagna, la porta non fa più niente", async () => {
      const { engine, cards } = await pasted(["Foto/a.png"]);
      engine.destroy();
      expect(cards.live()).toBe(false);
      expect(cards.repoint([{ from: "Foto/a.png", to: "attachments/a.png" }])).toBe(0);
    });
  });

  it("rende scene grandi con fallback deterministico invece di migliaia di DOM card", () => {
    const source = JSON.stringify({
      nodes: Array.from({ length: 2_001 }, (_, index) => ({
        id: `n${index}`, type: "text", x: index * 8, y: 0,
        width: 100, height: 60, text: "card",
      })),
      edges: [],
    });
    const { engine, host } = mounted(source);
    expect(host.querySelector(".canvas-viewport")?.getAttribute("data-canvas-protocol")).toBe("source-fallback");
    expect(host.querySelectorAll(".canvas-node")).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });
  it("riconnette e modifica arco da inspector tastiera con preimmagini e undo", () => {
    const { engine, host, changes } = mounted();
    const picker = host.querySelector<HTMLSelectElement>('select[data-canvas-field="select-edge"]')!;
    picker.value = "e1";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    const label = host.querySelector<HTMLInputElement>('input[data-canvas-field="edge-label"]')!;
    label.value = "nuova relazione";
    label.dispatchEvent(new Event("change", { bubbles: true }));
    const endpoint = host.querySelector<HTMLSelectElement>('select[data-canvas-field="edge-toNode"]')!;
    endpoint.value = "w";
    endpoint.dispatchEvent(new Event("change", { bubbles: true }));
    const side = host.querySelector<HTMLSelectElement>('select[data-canvas-field="edge-fromSide"]')!;
    side.value = "bottom";
    side.dispatchEvent(new Event("change", { bubbles: true }));
    // Il colore del filo sta nel menu dei colori (T47), come quello delle schede.
    expect(host.querySelector('[data-canvas-field="edge-color"]')).toBeNull();
    engine.commands().find((command) => command.id === "canvas.color.6")!.run({ edge: "e1" });
    expect(readCanvas(engine.getDoc()).edges[0]).toMatchObject({
      label: "nuova relazione", toNode: "w", fromSide: "bottom", color: "6",
    });
    expect(changes).toHaveLength(4);
    expect(changes.every((change) => change.operation.patches[0].kind === "upsert-edge")).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).edges[0].color).toBeUndefined();
    engine.destroy();
  });

  it("manda la card web solo al viewer isolato esplicito, senza caricare HTML inline", () => {
    const openViewer = vi.fn();
    const openExternal = vi.fn();
    const { engine, host } = mounted(canvasSource(), { media: { openViewer, openExternal } });
    expect(host.querySelector("iframe,object,embed,video,audio")).toBeNull();
    host.querySelector<HTMLButtonElement>(".canvas-open-url")!.click();
    expect(openViewer).toHaveBeenCalledWith("https://example.com/x");
    expect(openExternal).not.toHaveBeenCalled();
    engine.destroy();
  });

  it("il buffer Canvas attraversa il conflitto della sessione generica senza perdere la preimmagine", async () => {
    const original = canvasSource();
    const api: DocumentSessionApi = {
      readDocument: async () => ({ text: original, revision: "rev-1", format_id: "canvas", source_kind: "text", text_kind: "source" }),
      openDocument: async () => ({ text: original, revision: "rev-1", format_id: "canvas", source_kind: "text", text_kind: "source" }),
      documentClosed: async () => {},
      writeDocument: async () => { throw { kind: "conflict", message: "remote revision changed" }; },
      resourceWrite: async () => { throw new Error("una tela ha un formato: non si salva a byte"); },
      saveDraft: async () => {},
      discardDraft: async () => {},
    };
    const timer = vi.spyOn(window, "setTimeout").mockImplementation(() => 1);
    try {
      const sessions = new DocumentSessionCollection(api);
      await sessions.read("board.canvas");
      const doc = readCanvas(original);
      const moved = upsertNodePatch(doc, { ...doc.nodes[0], x: 88 })!;
      const committed = commitOnCore(original, [moved]);
      const edit = { text: committed.text, operation: committed.operation };
      expect(sessions.acceptSurfaceChange("board.canvas", "canvas-a", edit)).toEqual({ kind: "accepted" });
      await sessions.flush("board.canvas");
      expect(sessions.inspect("board.canvas")).toMatchObject({ text: committed.text, result: "conflitto", dirty: true });
      expect(sessions.acceptSurfaceChange("board.canvas", "canvas-b", edit)).toEqual({
        kind: "realigned", text: committed.text,
      });
      expect((await sessions.resolveConflict("board.canvas", "theirs")).kind).toBe("discarded");
      expect(sessions.inspect("board.canvas")).toMatchObject({ text: original, dirty: false });
    } finally {
      timer.mockRestore();
    }
  });
});

/** Il nucleo vero, con il conto delle chiamate che gli arrivano. */
function countingCore(): { port: CanvasCorePort; calls: string[] } {
  const calls: string[] = [];
  const wrap = (core: CanvasCore): CanvasCore => new Proxy(core, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(key));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return {
    calls,
    port: {
      openNow: (text) => {
        calls.push("open");
        const core = openCoreNow(text);
        return core ? wrap(core) : null;
      },
      ready: canvasCoreReady,
    },
  };
}

function openField(host: HTMLElement, id: string): HTMLInputElement | HTMLTextAreaElement {
  host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(".canvas-text-editor, .canvas-field-editor")!;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(input: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
}

function cardText(engine: CanvasEngine, id = "t"): string | undefined {
  return readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)?.text;
}

describe("CanvasEngine: il testo di una scheda", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dieci tasti a 100 ms l'uno dall'altro: un solo commit, e nessuna chiamata al nucleo per tasto", () => {
    vi.useFakeTimers();
    const { port, calls } = countingCore();
    const { engine, host, changes } = mounted(canvasSource(), { core: port });
    const input = openField(host, "t");
    const before = calls.length;
    for (let key = 1; key <= 10; key++) {
      type(input, `${input.value}${key % 10}`);
      vi.advanceTimersByTime(100);
      expect(calls.length).toBe(before);
    }
    expect(changes).toHaveLength(0);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(calls.slice(before).filter((call) => call === "commit")).toHaveLength(1);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag1234567890");
    engine.destroy();
  });

  it("due frasi con una pausa in mezzo sono due passi d'annulla", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Prima");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    type(input, "Prima. Seconda");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(2);
    input.blur();
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("Prima");
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    expect(engine.redo()).toBe(true);
    expect(cardText(engine)).toBe("Prima");
    engine.destroy();
  });

  it("Esc registra e chiude (A14)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Con Esc");
    press(input, "Escape");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Con Esc");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("Invio in una scheda di testo va a capo e registra; Ctrl+Invio e Cmd+Invio registrano, chiudono e aprono la scheda dopo (A15, T44)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    let input = openField(host, "t");
    type(input, "Riga");
    const enter = press(input, "Enter");
    expect(enter.defaultPrevented).toBe(false);
    type(input, "Riga\n");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Riga\n");
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    type(input, "Riga\ndue");
    expect(press(input, "Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    // Il testo, poi la scheda nuova: due commit.
    expect(changes).toHaveLength(3);
    expect(cardText(engine)).toBe("Riga\ndue");
    let next = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(next).not.toBe(input);
    expect(next.closest<HTMLElement>(".canvas-node")!.dataset.node).not.toBe("t");
    next.blur();
    input = openField(host, "t");
    type(input, "Riga\ndue\ntre");
    press(input, "Enter", { metaKey: true });
    expect(cardText(engine)).toBe("Riga\ndue\ntre");
    next = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(next.closest<HTMLElement>(".canvas-node")!.dataset.node).not.toBe("t");
    engine.destroy();
  });

  it("Invio in un altro campo registra e chiude; l'uscita dal campo registra (A15)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    let input = openField(host, "g");
    type(input, "Idee nuove");
    expect(press(input, "Enter").defaultPrevented).toBe(true);
    expect(changes).toHaveLength(1);
    expect(readCanvas(engine.getDoc()).nodes.find((node) => node.id === "g")?.label).toBe("Idee nuove");
    expect(host.querySelector(".canvas-field-editor")).toBeNull();
    input = openField(host, "t");
    type(input, "Uscendo");
    input.dispatchEvent(new FocusEvent("blur"));
    expect(changes).toHaveLength(2);
    expect(cardText(engine)).toBe("Uscendo");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    engine.destroy();
  });

  it("col campo aperto Ctrl+Z è del campo, non della tela (A16)", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Scritto");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    const undo = press(input, "z", { ctrlKey: true });
    expect(undo.defaultPrevented).toBe(false);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Scritto");
    engine.destroy();
  });

  it("un gesto sulla tela registra prima il testo in sospeso", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Prima del gesto");
    host.querySelector<HTMLButtonElement>('[data-canvas-action="add-text"]')!.click();
    expect(changes).toHaveLength(2);
    expect(cardText(engine)).toBe("Prima del gesto");
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(5);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(cardText(engine)).toBe("Prima del gesto");
    engine.destroy();
  });

  it("chiudere il riquadro durante la pausa registra prima", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Prima di chiudere");
    engine.destroy();
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0].text).nodes[0].text).toBe("Prima di chiudere");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
  });

  it("aprire un altro documento durante la pausa registra il testo in quello di prima", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Nel primo");
    engine.setDoc(JSON.stringify({ nodes: [], edges: [] }));
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0].text).nodes[0].text).toBe("Nel primo");
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(0);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("un cambio da fuori mentre si scrive: il testo si registra subito dopo, sul testo nuovo", async () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Mentre scrivo");
    const remote = JSON.parse(canvasSource()) as { nodes: Array<Record<string, unknown>> };
    remote.nodes[0].x = 112;
    remote.nodes[1].x = 500;
    engine.syncDoc({ text: JSON.stringify(remote), operation: null });
    expect(changes).toHaveLength(0);
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    await Promise.resolve();
    expect(changes).toHaveLength(1);
    const after = readCanvas(engine.getDoc());
    expect(after.nodes[0]).toMatchObject({ x: 112, text: "Mentre scrivo" });
    expect(after.nodes[1].x).toBe(500);
    expect(applyOperation(JSON.stringify(remote), changes[0].operation)).toBe(engine.getDoc());
    engine.destroy();
  });

  it("se la scheda sparisce mentre si scrive torna col testo del campo, e un annulla la toglie", async () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    type(input, "Non lo perdo");
    const remote = JSON.parse(canvasSource()) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    remote.nodes.shift();
    remote.edges = [];
    engine.syncDoc(JSON.stringify(remote));
    await Promise.resolve();
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Non lo perdo");
    input.dispatchEvent(new FocusEvent("blur"));
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBeUndefined();
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(3);
    engine.destroy();
  });

  it("un testo oltre 1 MiB: il campo resta aperto col suo testo e l'avviso lo dice; chiudere il riquadro lo perde", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    const huge = "x".repeat(2 * 1_048_576);
    type(input, huge);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(0);
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    expect(input.value).toBe(huge);
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.card_too_long"));
    press(input, "Escape");
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    expect(engine.undo()).toBe(false);
    // Il caso fissato: un incolla di 2 MiB e poi il riquadro chiuso, quel testo si perde.
    engine.destroy();
    expect(changes).toHaveLength(0);
  });

  it("durante la composizione la pausa non corre: conta dalla fine", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = openField(host, "t");
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    type(input, "にほ");
    vi.advanceTimersByTime(1000);
    type(input, "日本");
    vi.advanceTimersByTime(1000);
    expect(changes).toHaveLength(0);
    input.dispatchEvent(new CompositionEvent("compositionend"));
    vi.advanceTimersByTime(CARD_PAUSE_MS - 1);
    expect(changes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("日本");
    engine.destroy();
  });

  it("con i CRLF la TextOperation conta sui \\n", () => {
    vi.useFakeTimers();
    const source = JSON.stringify(JSON.parse(canvasSource()), null, "\t").replace(/\n/g, "\r\n");
    const { engine, host, changes } = mounted(source);
    const input = openField(host, "t");
    type(input, "Con i CR");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(engine.getDoc()).toContain("\r\n");
    expect(applyOperation(lineFeeds(source), changes[0].operation)).toBe(lineFeeds(engine.getDoc()));
    engine.destroy();
  });

  it("due superfici sulla stessa tela: il testo dell'una arriva all'altra e il campo aperto resta", async () => {
    vi.useFakeTimers();
    const a = mounted();
    const b = mounted();
    const input = openField(a.host, "t");
    type(input, "Da A");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(a.changes).toHaveLength(1);
    const inputB = openField(b.host, "g");
    type(inputB, "Da B");
    b.engine.syncDoc({ text: a.changes[0].text, operation: a.changes[0].operation });
    await Promise.resolve();
    expect(b.changes).toHaveLength(1);
    const both = readCanvas(b.engine.getDoc());
    expect(both.nodes.find((node) => node.id === "t")?.text).toBe("Da A");
    expect(both.nodes.find((node) => node.id === "g")?.label).toBe("Da B");
    expect(b.host.querySelector(".canvas-field-editor")).toBe(inputB);
    a.engine.destroy();
    b.engine.destroy();
  });

  it("una trappola nel nucleo: la tela si riapre su un'istanza nuova dal testo, e il testo in sospeso si registra", async () => {
    const real = countingCore();
    let trap = true;
    const port: CanvasCorePort = {
      openNow: (text) => {
        const core = real.port.openNow(text);
        if (!core) return null;
        return new Proxy(core, {
          get(target, key, receiver) {
            if (key === "commit" && trap) {
              return () => {
                trap = false;
                throw new CanvasCoreError("trap", "unreachable");
              };
            }
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      },
      ready: canvasCoreReady,
    };
    const { engine, host, changes } = mounted(canvasSource(), { core: port });
    const input = openField(host, "t");
    type(input, "Dopo la trappola");
    press(input, "Escape");
    expect(changes).toHaveLength(0);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(real.calls.filter((call) => call === "open")).toHaveLength(2);
    expect(cardText(engine)).toBe("Dopo la trappola");
    engine.destroy();
  });

  it("il cancello: la tela dell'agente si apre con le stesse schede negli stessi posti", async () => {
    const vector = agentBoard as unknown as { before: unknown; seed: number; ops: CanvasIntentOp[]; expect: { after: { nodes: Array<{ id: string; x: number; y: number; width: number; height: number }> } } };
    const before = JSON.stringify(vector.before);
    const core = await openCore(before);
    const compiled = core.compile(vector.ops, vector.seed);
    const { edit } = core.commit(compiled.patches);
    core.close();
    const text = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const { engine, host } = mounted(text);
    const cards = [...host.querySelectorAll<HTMLElement>(".canvas-node")];
    expect(cards.map((card) => card.dataset.node)).toEqual(vector.expect.after.nodes.map((node) => node.id));
    for (const node of vector.expect.after.nodes) {
      const card = host.querySelector<HTMLElement>(`.canvas-node[data-node="${node.id}"]`)!;
      expect(card.style.transform).toBe(`translate(${node.x}px, ${node.y}px)`);
      expect(card.style.width).toBe(`${node.width}px`);
      expect(card.style.height).toBe(`${node.height}px`);
    }
    expect(host.querySelector<HTMLElement>(".canvas-viewport")!.dataset.canvasEdges).toBe("2");
    engine.destroy();
  });

  it("il testo tenuto: un avviso per tasto senza nucleo, il testo intero solo a richiesta, il commit adesso", () => {
    vi.useFakeTimers();
    const { port, calls } = countingCore();
    const seen: boolean[] = [];
    const { engine, host, changes } = mounted(canvasSource(), { core: port, onPendingChange: (pending) => seen.push(pending) });
    const input = openField(host, "t");
    expect(engine.pendingText()).toBeNull();
    const before = calls.length;
    type(input, "Ciao");
    type(input, "Ciao mondo");
    expect(seen).toEqual([true, true]);
    expect(calls.length).toBe(before);
    const whole = engine.pendingText()!;
    expect(calls.slice(before)).toEqual(["preview"]);
    expect(readCanvas(whole).nodes.find((node) => node.id === "t")!.text).toBe("Ciao mondo");
    // Il testo intero non tocca la lavagna.
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    expect(changes).toHaveLength(0);
    engine.commitPending();
    expect(seen).toEqual([true, true, false]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.text).toBe(whole);
    expect(engine.hasPending).toBe(false);
    expect(engine.pendingText()).toBeNull();
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("il testo tenuto che il nucleo non prende: niente testo intero, e il registro lo dice", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { engine, host } = mounted();
      const input = openField(host, "t");
      type(input, "x".repeat(1_048_577));
      expect(engine.pendingText()).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid"));
      expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
      engine.destroy();
    } finally {
      warn.mockRestore();
    }
  });
});

/** L'editor delle note finto che la porta monta sopra il testo di una scheda (T43). */
interface FakeLiveText {
  readonly host: HTMLElement;
  readonly text: string;
  readonly options: CardTextOptions;
  /** Il contenitore che si scrive, come il `contenteditable` dell'editor vero. */
  readonly area: HTMLElement;
  readonly focusAt: Array<number | undefined>;
  destroyed: boolean;
  /** Una battuta: il testo nuovo va a `onText`, come fa la porta. */
  typed(next: string): void;
}

/**
 * La porta delle schede con `openText` finto: `answer` dice se l'editor si
 * monta; `gate`, se c'è, tiene la risposta finché non si apre.
 */
function textPort(answer: "live" | "none" = "live", gate?: Promise<void>) {
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

function withTextPort(port: CardEditorPort): Partial<CanvasEngineOptions> {
  return { cards: { registry: createCardRegistry([]), snapshots: new CardCache(), watch: () => () => {}, editors: port } };
}

/** Le attese della porta arrivate in fondo. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function openLive(host: HTMLElement, id = "t"): Promise<void> {
  host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
}

describe("CanvasEngine: la scheda di testo in Live (T43)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("il doppio clic monta l'editor delle note al posto del campo, col cursore in fondo", async () => {
    const { port, opened } = textPort();
    const { engine, host } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    expect(opened).toHaveLength(1);
    const live = opened[0]!;
    expect(live.text).toBe("vedi [[Altra]] e #tag");
    expect(live.options.documentId).toBe("board.canvas");
    expect(live.options.readOnly).toBe(false);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    const place = host.querySelector<HTMLElement>('.canvas-node[data-node="t"] .canvas-text-live')!;
    expect(place).not.toBeNull();
    expect(place.hidden).toBe(false);
    expect(place.contains(live.area)).toBe(true);
    expect(document.activeElement).toBe(live.area);
    expect(live.focusAt).toEqual(["vedi [[Altra]] e #tag".length]);
    // L'editor che porta il cursore in vista non sposta la lavagna: la vista
    // si muove solo con la camera.
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.scrollTop = 280;
    viewport.dispatchEvent(new Event("scroll"));
    expect(viewport.scrollTop).toBe(0);
    // Né sposta il contenitore della scheda: scorre l'editor, e ciò che
    // l'editor tiene sotto di sé resta fuori dalla vista.
    expect(place.style.overflow).toBe("hidden");
    place.scrollTop = 72;
    place.dispatchEvent(new Event("scroll"));
    expect(place.scrollTop).toBe(0);
    engine.destroy();
    expect(live.destroyed).toBe(true);
  });

  it("il testo arriva al .canvas dopo la pausa, con un commit solo; prima è nella bozza", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("vedi [[Altra]] e #tag, poi");
    vi.advanceTimersByTime(100);
    live.typed("vedi [[Altra]] e #tag, poi altro");
    expect(changes).toHaveLength(0);
    expect(engine.hasPending).toBe(true);
    expect(readCanvas(engine.pendingText()!).nodes[0]!.text).toBe("vedi [[Altra]] e #tag, poi altro");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag, poi altro");
    expect(live.destroyed).toBe(false);
    // La stessa lavagna in un altro riquadro: il testo le arriva col commit.
    const other = mounted();
    other.engine.syncDoc({ text: changes[0]!.text, operation: changes[0]!.operation });
    expect(cardText(other.engine)).toBe("vedi [[Altra]] e #tag, poi altro");
    other.engine.destroy();
    engine.destroy();
  });

  it("Esc e Ctrl+Invio registrano e chiudono (A14, A15); un Esc che chiude i suggerimenti resta dell'editor", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    let live = opened[0]!;
    // L'editor delle note segna Esc come usato anche senza suggerimenti: esce lo stesso.
    live.area.addEventListener("keydown", (event) => event.preventDefault());
    live.typed("Con Esc");
    press(live.area, "Escape");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Con Esc");
    expect(live.destroyed).toBe(true);
    expect(host.querySelector(".canvas-text-live")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".canvas-viewport"));
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);

    vi.useRealTimers();
    await openLive(host);
    vi.useFakeTimers();
    live = opened[1]!;
    const seen: string[] = [];
    // L'elenco dei suggerimenti aperto: Esc lo chiude, e la scrittura resta.
    const suggestions = document.createElement("ul");
    suggestions.setAttribute("role", "listbox");
    live.area.append(suggestions);
    live.area.addEventListener("keydown", (event) => {
      seen.push(event.key);
      if (event.key === "Escape") suggestions.remove();
    });
    live.typed("Con Ctrl+Invio");
    press(live.area, "Escape");
    expect(live.destroyed).toBe(false);
    expect(changes).toHaveLength(1);
    const enter = press(live.area, "Enter", { ctrlKey: true });
    expect(enter.defaultPrevented).toBe(true);
    // Il Ctrl+Invio non arriva all'editor: non diventa un a capo.
    expect(seen).toEqual(["Escape"]);
    // Il testo, poi la scheda nuova sotto, già in scrittura (T44).
    expect(changes).toHaveLength(3);
    expect(cardText(engine)).toBe("Con Ctrl+Invio");
    expect(live.destroyed).toBe(true);
    expect(opened).toHaveLength(3);
    expect(opened[2]!.text).toBe("");

    vi.useRealTimers();
    await openLive(host);
    live = opened[opened.length - 1]!;
    live.typed("Con Cmd+Invio");
    press(live.area, "Enter", { metaKey: true });
    expect(cardText(engine)).toBe("Con Cmd+Invio");
    expect(opened[opened.length - 1]!.text).toBe("");
    engine.destroy();
  });

  it("Invio va a capo nell'editor e registra subito", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Riga");
    expect(press(live.area, "Enter").defaultPrevented).toBe(false);
    live.typed("Riga\n");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Riga\n");
    expect(live.destroyed).toBe(false);
    engine.destroy();
  });

  it("il fuoco che esce dall'editor registra e chiude; dentro l'editor no", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    const inner = document.createElement("span");
    live.area.append(inner);
    live.typed("Uscendo");
    live.area.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: inner }));
    expect(live.destroyed).toBe(false);
    live.area.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Uscendo");
    expect(live.destroyed).toBe(true);
    engine.destroy();
  });

  it("un testo non toccato non cambia un byte, anche se non è Markdown valido e va a capo con CRLF", async () => {
    const odd = "**non chiuso\r\n<div>\r\n[[\r\n `";
    const source = `{\r\n  "nodes": [\r\n    {"id":"t","type":"text","x":0,"y":0,"width":240,"height":140,"text":${JSON.stringify(odd)}}\r\n  ],\r\n  "edges": []\r\n}\r\n`;
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(source, withTextPort(port));
    await openLive(host);
    expect(opened[0]!.text).toBe(odd);
    press(opened[0]!.area, "Escape");
    await openLive(host);
    opened[1]!.area.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source);
    // Toccato, il testo resta col suo CRLF.
    await openLive(host);
    opened[2]!.typed(`${odd}\r\naltro`);
    press(opened[2]!.area, "Escape");
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe(`${odd}\r\naltro`);
    expect(engine.getDoc()).toContain("\r\n  \"edges\"");
    engine.destroy();
  });

  it("una scheda di 2000 righe si apre intera e si registra", async () => {
    const long = Array.from({ length: 2000 }, (_, line) => `riga ${line + 1}`).join("\n");
    const source = JSON.stringify({ nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 240, height: 140, text: long }], edges: [] });
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(source, withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    expect(opened[0]!.text).toBe(long);
    // La rotella sopra il testo lo scorre: la lavagna non la prende.
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    opened[0]!.area.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    opened[0]!.typed(`${long}\nriga 2001`);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)!.split("\n")).toHaveLength(2001);
    engine.destroy();
  });

  it("Ctrl+Z nell'editor è suo: la tela non lo vede", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Scritto");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    const reached: string[] = [];
    host.addEventListener("keydown", (event) => reached.push(event.key));
    const undo = press(live.area, "z", { ctrlKey: true });
    expect(undo.defaultPrevented).toBe(false);
    expect(reached).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Scritto");
    expect(live.destroyed).toBe(false);
    engine.destroy();
  });

  it("un annulla della lavagna mentre si scrive prima esce dalla scrittura", async () => {
    const { port, opened } = textPort();
    const { engine, host } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Da annullare");
    expect(engine.undo()).toBe(true);
    expect(live.destroyed).toBe(true);
    expect(host.querySelector(".canvas-text-live")).toBeNull();
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    engine.destroy();
  });

  it("la lavagna chiusa a metà pausa registra il testo e smonta l'editor", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    live.typed("Prima di chiudere");
    engine.destroy();
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0]!.text).nodes[0]!.text).toBe("Prima di chiudere");
    expect(live.destroyed).toBe(true);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
  });

  it("in sola lettura non si entra", async () => {
    const { port, calls } = textPort();
    const { engine, host } = mounted(canvasSource(), withTextPort(port));
    engine.setReadOnly(true);
    await openLive(host);
    expect(calls).toEqual([]);
    expect(host.querySelector(".canvas-text-editor, .canvas-text-live")).toBeNull();
    engine.destroy();
  });

  it("se l'editor non si monta resta il campo di oggi, e si scrive lì", async () => {
    const { port, calls } = textPort("none");
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    expect(calls).toHaveLength(1);
    expect(host.querySelector(".canvas-text-live")).toBeNull();
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    type(input, "Nel campo");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(cardText(engine)).toBe("Nel campo");
    engine.destroy();
  });

  it("ciò che si scrive nel campo mentre l'editor arriva non si perde: l'editor si riapre su quel testo", async () => {
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { port, opened, calls } = textPort("live", gate);
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    type(input, "Veloce");
    input.setSelectionRange(3, 3);
    open();
    await settle();
    expect(calls).toEqual(["vedi [[Altra]] e #tag", "Veloce"]);
    expect(opened).toHaveLength(2);
    expect(opened[0]!.destroyed).toBe(true);
    expect(opened[1]!.destroyed).toBe(false);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    expect(opened[1]!.focusAt).toEqual([3]);
    // Il testo del campo è già in attesa: nessuna battuta si perde.
    expect(engine.hasPending).toBe(true);
    engine.destroy();
    expect(changes).toHaveLength(1);
    expect(readCanvas(changes[0]!.text).nodes[0]!.text).toBe("Veloce");
  });
});

describe("CanvasEngine: la scheda di testo cresce, e i suoi tasti (T44)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Un'impaginazione finta: ogni carattere è largo 10 px, ogni riga alta 20; il
  // testo ha 8 px di margine per lato e la testata della scheda è alta 28.
  const CHAR = 10;
  const LINE = 20;
  const PAD = 16;
  const HEAD = 28;

  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id);
  const boxOf = (engine: CanvasEngine, id: string): number[] => {
    const node = nodeOf(engine, id)!;
    return [node.x, node.y, node.width, node.height];
  };
  const shown = (article: HTMLElement): number[] => [parseFloat(article.style.width), parseFloat(article.style.height)];
  /** La scheda in cui si scrive: quella del campo o dell'editor aperto. */
  const writingCard = (host: HTMLElement): string | undefined =>
    host.querySelector<HTMLElement>(".canvas-text-editor, .canvas-text-live")?.closest<HTMLElement>(".canvas-node")?.dataset.node;

  /** La larghezza del testo su una riga sola, e l'altezza che vuole in una scheda larga `width`. */
  function layout(text: string, width: number): { natural: number; height: number } {
    const rows = text.split("\n");
    const inner = width - PAD;
    return {
      natural: Math.max(...rows.map((row) => row.length * CHAR)),
      height: rows.reduce((sum, row) => sum + Math.max(1, Math.ceil((row.length * CHAR) / inner)), 0) * LINE,
    };
  }

  /** La scheda prende la misura dal suo stile, come una scheda vera; `max-content` è il suo testo su una riga. */
  function fakeArticle(article: HTMLElement, text: () => string): void {
    Object.defineProperty(article, "offsetWidth", {
      configurable: true,
      get: () => (article.style.width === "max-content" ? layout(text(), 10_000).natural + PAD : parseFloat(article.style.width) || 0),
    });
    Object.defineProperty(article, "offsetHeight", { configurable: true, get: () => parseFloat(article.style.height) || 0 });
  }

  /** Il campo semplice aperto: va a capo alla larghezza della scheda, e scorre se il testo esce. */
  function fakeField(host: HTMLElement): HTMLTextAreaElement {
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    const article = input.closest<HTMLElement>(".canvas-node")!;
    fakeArticle(article, () => input.value);
    const width = (): number => (parseFloat(article.style.width) || 0) - PAD;
    const height = (): number => (parseFloat(article.style.height) || 0) - HEAD;
    Object.defineProperty(input, "clientWidth", { configurable: true, get: width });
    Object.defineProperty(input, "scrollWidth", {
      configurable: true,
      get: () => (input.style.whiteSpace === "pre" ? Math.max(width(), layout(input.value, 10_000).natural) : width()),
    });
    Object.defineProperty(input, "clientHeight", { configurable: true, get: height });
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => Math.max(height(), layout(input.value, parseFloat(article.style.width) || 0).height),
    });
    return input;
  }

  function field(host: HTMLElement, id: string): HTMLTextAreaElement {
    card(host, id).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return fakeField(host);
  }

  it("mentre si scrive la scheda si allarga col testo fino a 480 px, poi va a capo e cresce in altezza; da sola non si restringe", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = field(host, "t");
    const article = card(host, "t");
    // Il testo sta nei 240 px: niente cambia.
    type(input, "a".repeat(20));
    expect(shown(article)).toEqual([240, 140]);
    // 30 caratteri vogliono 300 px: la scheda si allarga subito, agganciata a 8.
    type(input, "a".repeat(30));
    expect(shown(article)).toEqual([320, 140]);
    expect(changes).toHaveLength(0);
    expect(readCanvas(engine.pendingText()!).nodes[0]!.width).toBe(320);
    // La misura va nel .canvas col testo, nello stesso commit.
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(boxOf(engine, "t")).toEqual([40, 40, 320, 140]);
    expect(cardText(engine)).toBe("a".repeat(30));
    // Una parola di 600 px senza spazi: la scheda si ferma a 480 e va a capo.
    type(input, "x".repeat(60));
    expect(shown(article)).toEqual([480, 140]);
    // Dieci righe così sono venti righe a capo, 400 px: la scheda cresce in altezza.
    const long = Array.from({ length: 10 }, () => "x".repeat(60)).join("\n");
    type(input, long);
    expect(shown(article)).toEqual([480, 432]);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(2);
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 432]);
    // Un testo corto non la restringe.
    type(input, "ab");
    press(input, "Escape");
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 432]);
    expect(cardText(engine)).toBe("ab");
    expect(shown(article)).toEqual([480, 432]);
    engine.destroy();
  });

  it("una scheda ridimensionata a mano non si allarga più scrivendo, ma cresce in altezza", () => {
    vi.useFakeTimers();
    const { engine, host } = mounted();
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const zoom = Number(/scale\(([\d.e+-]+)\)/.exec(stage.style.transform)![1]);
    const grip = card(host, "t").querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!;
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", clientX: 100, clientY: 100 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, pointerId: 7, pointerType: "mouse", clientX: 100 - 40 * zoom, clientY: 100 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "mouse", clientX: 100 - 40 * zoom, clientY: 100 }));
    expect(boxOf(engine, "t")).toEqual([40, 40, 200, 140]);
    const input = field(host, "t");
    // 12 righe di 30 caratteri: a 200 px vanno a capo, 24 righe, 480 px di testo.
    type(input, Array.from({ length: 12 }, () => "a".repeat(30)).join("\n"));
    press(input, "Escape");
    expect(boxOf(engine, "t")).toEqual([40, 40, 200, 512]);
    engine.destroy();
  });

  it("anche nell'editor delle note la scheda cresce col testo che mostra", async () => {
    const { port, opened } = textPort();
    const { engine, host, changes } = mounted(canvasSource(), withTextPort(port));
    await openLive(host);
    vi.useFakeTimers();
    const live = opened[0]!;
    const article = card(host, "t");
    let text = live.text;
    fakeArticle(article, () => text);
    const height = (): number => (parseFloat(article.style.height) || 0) - HEAD;
    Object.defineProperty(live.area, "clientHeight", { configurable: true, get: height });
    Object.defineProperty(live.area, "scrollHeight", {
      configurable: true,
      get: () => Math.max(height(), layout(text, parseFloat(article.style.width) || 0).height),
    });
    text = "b".repeat(33);
    live.typed(text);
    // 330 px di testo e 16 di margine: 346, agganciati a 352.
    expect(shown(article)).toEqual([352, 140]);
    text = Array.from({ length: 8 }, () => "b".repeat(50)).join("\n");
    live.typed(text);
    // 500 px non stanno in 480: ogni riga va a capo, 16 righe, 320 px di testo.
    expect(shown(article)).toEqual([480, 352]);
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(changes).toHaveLength(1);
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 352]);
    expect(live.destroyed).toBe(false);
    engine.destroy();
  });

  it("Esc esce dalla scrittura e lascia la scheda scelta; il secondo Esc toglie la scelta", async () => {
    vi.useFakeTimers();
    const { engine, host } = mounted();
    const input = field(host, "t");
    type(input, "Scelta");
    press(input, "Escape");
    expect(writingCard(host)).toBeUndefined();
    expect(engine.selectedText()).toEqual({ primary: "Scelta", secondary: [] });
    expect(card(host, "t").classList.contains("selected")).toBe(true);
    const viewport = viewportOf(host);
    expect(document.activeElement).toBe(viewport);
    expect(press(viewport, "Escape").defaultPrevented).toBe(true);
    expect(engine.selectedText()).toBeNull();
    engine.destroy();

    // Lo stesso nell'editor delle note.
    vi.useRealTimers();
    const { port, opened } = textPort();
    const other = mounted(canvasSource(), withTextPort(port));
    await openLive(other.host);
    press(opened[0]!.area, "Escape");
    expect(opened[0]!.destroyed).toBe(true);
    expect(other.engine.selectedText()?.primary).toBe("vedi [[Altra]] e #tag");
    press(viewportOf(other.host), "Escape");
    expect(other.engine.selectedText()).toBeNull();
    other.engine.destroy();
  });

  it("Ctrl+Invio registra, chiude e apre sotto una scheda nuova larga uguale, già in scrittura", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    const input = field(host, "t");
    type(input, "a".repeat(30));
    expect(press(input, "Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(cardText(engine)).toBe("a".repeat(30));
    // Il testo e la misura nuova in un commit, la scheda nuova in un altro.
    expect(changes).toHaveLength(2);
    expect(boxOf(engine, "t")).toEqual([40, 40, 320, 140]);
    const nodes = readCanvas(engine.getDoc()).nodes;
    expect(nodes).toHaveLength(5);
    const fresh = nodes[nodes.length - 1]!;
    expect(fresh.type).toBe("text");
    expect(fresh.text).toBe("");
    // 24 px sotto, larga come lei; il gruppo sotto non la sposta.
    expect([fresh.x, fresh.y, fresh.width, fresh.height]).toEqual([40, 204, 320, 160]);
    expect(writingCard(host)).toBe(fresh.id);
    expect(document.activeElement).toBe(host.querySelector(".canvas-text-editor"));
    expect(engine.selectedText()).toEqual({ primary: "", secondary: [] });
    // Scritta, resta; il primo annulla toglie il suo testo, il secondo lei, il terzo il testo di «t».
    const next = fakeField(host);
    type(next, "Dopo");
    press(next, "Escape");
    expect(cardText(engine, fresh.id)).toBe("Dopo");
    expect(engine.undo()).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(nodeOf(engine, fresh.id)).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    engine.destroy();
  });

  it("Ctrl+Maiusc+Invio apre la scheda nuova a destra, collegata con un filo; se cadrebbe su un'altra scende", () => {
    vi.useFakeTimers();
    const { engine, host } = mounted();
    const input = field(host, "t");
    type(input, "Prima");
    expect(press(input, "Enter", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    const doc = readCanvas(engine.getDoc());
    const fresh = doc.nodes[doc.nodes.length - 1]!;
    // A destra di «t» c'è il file (400, 40): scende sotto di lui, poi sotto il
    // link (400, 240), fino al primo posto libero.
    expect([fresh.x, fresh.y, fresh.width, fresh.height]).toEqual([304, 364, 240, 160]);
    const wire = doc.edges.find((edge) => edge.toNode === fresh.id)!;
    expect([wire.fromNode, wire.fromSide, wire.toSide]).toEqual(["t", "right", "left"]);
    expect(writingCard(host)).toBe(fresh.id);
    engine.destroy();
  });

  it("la scheda nuova scende al primo posto libero, cercato al più 20 volte; poi cade sopra l'altra", () => {
    vi.useFakeTimers();
    // Sotto «t» una colonna di schede a 24 px l'una dall'altra; con `hole`, un
    // buco dopo la seconda.
    const column = (count: number, hole: boolean): string => JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 0, y: 0, width: 240, height: 100, text: "su" },
        ...Array.from({ length: count }, (_, k) => ({
          id: `c${k}`, type: "text", x: 0, y: 124 + k * 124 + (hole && k >= 2 ? 200 : 0), width: 240, height: 100, text: String(k),
        })),
      ],
      edges: [],
    });
    let { engine, host } = mounted(column(5, true));
    press(field(host, "t"), "Enter", { ctrlKey: true });
    let nodes = readCanvas(engine.getDoc()).nodes;
    expect(nodes[nodes.length - 1]!.y).toBe(372);
    engine.destroy();

    ({ engine, host } = mounted(column(25, false)));
    press(field(host, "t"), "Enter", { ctrlKey: true });
    nodes = readCanvas(engine.getDoc()).nodes;
    expect(nodes[nodes.length - 1]!.y).toBe(124);
    engine.destroy();
  });

  it("in sola lettura Ctrl+Invio non fa niente", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    engine.setReadOnly(true);
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    const viewport = viewportOf(host);
    viewport.focus();
    press(viewport, "Enter", { ctrlKey: true });
    press(viewport, "Enter", { ctrlKey: true, shiftKey: true });
    expect(changes).toHaveLength(0);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    engine.destroy();
  });

  it("una scheda nuova lasciata vuota sparisce uscendo, senza un passo d'annulla, anche dopo un testo cancellato", () => {
    vi.useFakeTimers();
    const { engine, host, changes } = mounted();
    type(field(host, "t"), "Uno");
    press(host.querySelector(".canvas-text-editor")!, "Enter", { ctrlKey: true });
    const before = changes[0]!.text;
    let fresh = writingCard(host)!;
    // Ctrl+Invio nella scheda nuova ancora vuota non ne apre un'altra.
    press(host.querySelector(".canvas-text-editor")!, "Enter", { ctrlKey: true });
    expect(writingCard(host)).toBe(fresh);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(5);
    press(host.querySelector(".canvas-text-editor")!, "Escape");
    expect(nodeOf(engine, fresh)).toBeUndefined();
    // Il testo torna ai byte di prima della scheda nuova.
    expect(engine.getDoc()).toBe(before);
    // L'annulla dopo è quello del testo di «t»: della scheda nuova non resta niente.
    expect(engine.undo()).toBe(true);
    expect(cardText(engine)).toBe("vedi [[Altra]] e #tag");
    expect(engine.redo()).toBe(true);
    expect(engine.redo()).toBe(false);
    expect(cardText(engine)).toBe("Uno");

    // Scritto e registrato, poi cancellato tutto: uscendo se ne va lo stesso.
    const prior = engine.getDoc();
    press(field(host, "t"), "Enter", { ctrlKey: true });
    fresh = writingCard(host)!;
    const next = fakeField(host);
    type(next, "per sbaglio");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    type(next, "");
    vi.advanceTimersByTime(CARD_PAUSE_MS);
    expect(cardText(engine, fresh)).toBe("");
    next.blur();
    expect(nodeOf(engine, fresh)).toBeUndefined();
    expect(engine.getDoc()).toBe(prior);

    // L'annulla della tela mentre si scrive nella scheda nuova vuota: è lei che si annulla.
    press(field(host, "t"), "Enter", { ctrlKey: true });
    fresh = writingCard(host)!;
    expect(engine.undo()).toBe(true);
    expect(nodeOf(engine, fresh)).toBeUndefined();
    expect(cardText(engine)).toBe("Uno");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    engine.destroy();
  });

  it("una scheda vuota che c'era già non sparisce, né una vecchia a cui si cancella tutto il testo", () => {
    vi.useFakeTimers();
    const source = JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "vecchia" },
        { id: "e", type: "text", x: 400, y: 40, width: 240, height: 140, text: "" },
      ],
      edges: [],
    });
    const { engine, host, changes } = mounted(source);
    press(field(host, "e"), "Escape");
    expect(nodeOf(engine, "e")).toBeDefined();
    expect(changes).toHaveLength(0);
    const input = field(host, "t");
    type(input, "");
    press(input, "Escape");
    expect(cardText(engine)).toBe("");
    expect(changes).toHaveLength(1);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(2);
    engine.destroy();
  });
});

describe("la superficie della tela: il nucleo arriva quando serve", () => {
  type SurfaceModule = typeof import("./surface");
  let release: { resolve: () => void; reject: (error: unknown) => void };

  async function lazySurface(): Promise<SurfaceModule> {
    vi.resetModules();
    const waiting = new Promise<void>((resolve, reject) => {
      release = { resolve, reject };
    });
    vi.doMock("./wasm/core", async (importOriginal) => {
      const real = await importOriginal<typeof import("./wasm/core")>();
      // Il caricamento vero, ma soltanto quando il test lo lascia andare.
      return { ...real, canvasCoreLoaded: () => false, canvasCoreReady: () => waiting.then(real.canvasCoreReady) };
    });
    return import("./surface");
  }

  afterEach(() => {
    vi.doUnmock("./wasm/core");
    vi.resetModules();
  });

  function mount(module: SurfaceModule, onFail?: (paneId: string, error: unknown) => void) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const changes: unknown[] = [];
    const surface = module.mountCanvasSurface("canvas", { paneId: "p", documentId: "board.canvas", parent }, {
      onChange: (_pane, change) => changes.push(change),
      onSelectionChange: () => {},
      onFail,
    });
    return { parent, surface, changes };
  }

  it("tiene il testo finché il nucleo non c'è, poi monta la tela con quel testo", async () => {
    const module = await lazySurface();
    const { parent, surface } = mount(module);
    surface.buffer!.setDoc(canvasSource());
    expect(parent.querySelector(".canvas-viewport")).toBeNull();
    expect(surface.buffer!.getDoc()).toBe(canvasSource());
    release.resolve();
    await vi.waitFor(() => expect(parent.querySelectorAll(".canvas-node")).toHaveLength(4));
    surface.destroy();
  });

  it("un testo che non è una lavagna, tenuto mentre il nucleo si carica, lo dice alla shell con onFail", async () => {
    const module = await lazySurface();
    const onFail = vi.fn();
    const { parent, surface } = mount(module, onFail);
    surface.buffer!.setDoc(canvasSource());
    // Anche un testo arrivato da un altro riquadro durante il caricamento.
    surface.buffer!.syncDoc("{rotto");
    expect(onFail).not.toHaveBeenCalled();
    release.resolve();
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(onFail.mock.calls[0]![0]).toBe("p");
    expect(onFail.mock.calls[0]![1]).toBeInstanceOf(Error);
    // Il motore fatto a metà non resta: niente tela, niente schede.
    expect(parent.querySelector(".canvas-viewport")).toBeNull();
    expect(parent.querySelector(".canvas-node")).toBeNull();
    surface.destroy();
  });

  it("chiusa durante il caricamento, non monta niente", async () => {
    const module = await lazySurface();
    const { parent, surface } = mount(module);
    surface.buffer!.setDoc(canvasSource());
    surface.destroy();
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(parent.querySelector(".canvas-viewport")).toBeNull();
  });

  it("se il nucleo non si carica lo dice, e il testo resta in vista", async () => {
    const module = await lazySurface();
    const { parent, surface } = mount(module);
    surface.buffer!.setDoc(canvasSource());
    release.reject(new Error("niente"));
    await vi.waitFor(() => expect(parent.querySelector(".vector-notice-text")?.textContent).toBe(t("canvas.core_unavailable")));
    const pre = parent.querySelector<HTMLElement>(".canvas-source")!;
    expect(pre.hidden).toBe(false);
    expect(pre.textContent).toBe(canvasSource());
    surface.setMode("canvas");
    expect(pre.hidden).toBe(false);
    surface.destroy();
  });
});

describe("CanvasEngine: l'annulla torna ai byte di prima", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Una lavagna scritta come la scrive Obsidian: tabulazioni, `text` prima di `x`, i lati degli archi. */
  function obsidianBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "8a1f0c2d9e3b4a5f", type: "text", text: "# Idea\n\nUna nota *breve*.", x: -340, y: -120, width: 250, height: 160, color: "4" },
        { id: "b7c2e91f04d6a3e8", type: "file", file: "Note/Progetto.md", x: 20, y: -100, width: 400, height: 400 },
        { id: "c3d4e5f6a7b8c9d0", type: "group", x: -380, y: 120, width: 300, height: 200, label: "Gruppo" },
      ],
      edges: [
        { id: "e0f1a2b3c4d5e6f7", fromNode: "8a1f0c2d9e3b4a5f", fromSide: "right", toNode: "b7c2e91f04d6a3e8", toSide: "left" },
      ],
    }, null, "\t");
  }

  const starts: ReadonlyArray<readonly [string, string]> = [
    ["vettore 02 (BOM e CRLF, vuota)", blankBomCrlf.before],
    ["vettore 12 (senza nodes)", rootWithoutNodes.before],
    ["vettore 14 (una scheda rientrata)", prettyNode.before],
    ["vettore 19 (nodes ed edges null)", nodesNull.before],
    ["vettore 22 (1.0, 1e2, -0, 1E1)", knownNumberForms.before],
    ["Obsidian", obsidianBoard()],
    ["Obsidian con BOM e CRLF", `﻿${obsidianBoard().replace(/\n/g, "\r\n")}`],
  ];

  function viewportOf(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function nodeEl(host: HTMLElement, id: string): HTMLElement {
    return host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  }

  function select(host: HTMLElement, id: string): void {
    nodeEl(host, id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function action(host: HTMLElement, name: string): void {
    host.querySelector<HTMLButtonElement>(`[data-canvas-action="${name}"]`)!.click();
  }

  function ids(engine: CanvasEngine): string[] {
    return readCanvas(engine.getDoc()).nodes.map((node) => node.id);
  }

  type Gesture = readonly [string, (engine: CanvasEngine, host: HTMLElement) => void];

  /** I gesti della tela, sulle schede di adesso: le prime due, che nei testi pieni sono quelle di partenza. */
  const gestures: readonly Gesture[] = [
    ["aggiungere", (_engine, host) => action(host, "add-text")],
    ["aggiungere", (_engine, host) => action(host, "add-group")],
    ["spostare", (engine, host) => {
      select(host, ids(engine)[0]!);
      viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    }],
    ["ridimensionare", (engine, host) => {
      const id = ids(engine)[0]!;
      host.querySelector<HTMLElement>(`[data-resize="${id}"]`)!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 5, clientX: 0, clientY: 0 }),
      );
      viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 5, clientX: 48, clientY: 32 }));
      viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 5, clientX: 48, clientY: 32 }));
    }],
    ["scrivere in una scheda", (engine, host) => {
      const doc = readCanvas(engine.getDoc());
      const card = doc.nodes.find((node) => node.type === "text") ?? doc.nodes[0]!;
      const input = openField(host, card.id);
      type(input, `${input.value} e poi «altro»`);
      press(input, "Escape");
    }],
    ["cambiare colore", (engine, host) => {
      const id = ids(engine)[1]!;
      vi.spyOn(document, "elementFromPoint").mockReturnValue(nodeEl(host, id));
      const menu = engine.contextMenu({ x: 10, y: 10 })!;
      const color = (menu.context as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color")!;
      (color.items as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color.2")!.run!();
      vi.restoreAllMocks();
    }],
    ["collegare", (engine, host) => {
      const [from, to] = ids(engine);
      vi.spyOn(document, "elementFromPoint").mockReturnValue(nodeEl(host, to!));
      host.querySelector<HTMLElement>(`[data-connect="${from}"]`)!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 9, clientX: 0, clientY: 0 }),
      );
      viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, clientX: 50, clientY: 50 }));
      vi.restoreAllMocks();
    }],
    ["riordinare", (engine, host) => {
      select(host, ids(engine)[0]!);
      action(host, "bring-front");
    }],
    ["togliere", (engine, host) => {
      select(host, ids(engine)[0]!);
      action(host, "delete");
    }],
  ];

  /** Ogni modifica mandata alla sessione porta dal testo di prima a quello di dopo (sui `\n`). */
  function expectConsistent(changes: readonly CanvasChange[], from: string): void {
    let text = from;
    for (const change of changes) {
      expect(applyOperation(lineFeeds(text), change.operation)).toBe(lineFeeds(change.text));
      text = change.text;
    }
  }

  for (const [name, start] of starts) {
    it(`${name}: ogni gesto, annullato, ridà il testo di prima byte per byte, e ripetuto quello di dopo`, () => {
      const { engine, host, changes } = mounted(start);
      const texts = [start];
      for (const [gesture, run] of gestures) {
        const before = engine.getDoc();
        const count = changes.length;
        run(engine, host);
        expect(changes.length, gesture).toBe(count + 1);
        const after = engine.getDoc();
        expect(after, gesture).not.toBe(before);
        expect(engine.undo(), gesture).toBe(true);
        expect(engine.getDoc(), gesture).toBe(before);
        expect(changes[changes.length - 1]!.origin).toBe("undo");
        expect(engine.redo(), gesture).toBe(true);
        expect(engine.getDoc(), gesture).toBe(after);
        expect(changes[changes.length - 1]!.origin).toBe("redo");
        texts.push(after);
      }
      // E tutta la storia, all'indietro e poi in avanti.
      for (let index = texts.length - 2; index >= 0; index--) {
        expect(engine.undo()).toBe(true);
        expect(engine.getDoc()).toBe(texts[index]);
      }
      expect(engine.undo()).toBe(false);
      for (let index = 1; index < texts.length; index++) {
        expect(engine.redo()).toBe(true);
        expect(engine.getDoc()).toBe(texts[index]);
      }
      expectConsistent(changes, start);
      engine.destroy();
    });
  }

  it("annulla, ripeti, annulla: di nuovo il testo di prima", () => {
    const { engine, host } = mounted(prettyNode.before);
    select(host, "a");
    action(host, "delete");
    const after = engine.getDoc();
    expect(engine.undo()).toBe(true);
    expect(engine.redo()).toBe(true);
    expect(engine.getDoc()).toBe(after);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(prettyNode.before);
    engine.destroy();
  });

  it("un testo da un'altra superficie in mezzo: l'annulla passa dalle toppe e tiene l'altra modifica", () => {
    const start = obsidianBoard();
    const { engine, host, changes } = mounted(start);
    select(host, "8a1f0c2d9e3b4a5f");
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(readCanvas(engine.getDoc()).nodes[0]!.x).toBe(-332);
    // La vista Sorgente di un altro riquadro cambia l'etichetta del gruppo.
    const moved = engine.getDoc();
    const edited = moved.replace('"label": "Gruppo"', '"label": "Altro"');
    expect(edited).not.toBe(moved);
    engine.syncDoc({ text: edited, operation: { ...operationFromText(moved, edited) } });
    const synced = changes.length;
    expect(engine.undo()).toBe(true);
    expect(changes).toHaveLength(synced + 1);
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes[0]!.x).toBe(-340);
    expect(doc.nodes.find((node) => node.id === "c3d4e5f6a7b8c9d0")!.label).toBe("Altro");
    expect(engine.getDoc()).not.toBe(start);
    expect(applyOperation(edited, changes[changes.length - 1]!.operation)).toBe(engine.getDoc());
    // Il ripeti rifà lo spostamento; l'annulla dopo torna ai byte che il primo annulla ha lasciato.
    const undone = engine.getDoc();
    expect(engine.redo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes[0]!.x).toBe(-332);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(undone);
    engine.destroy();
  });

  it("una syncDoc che non cambia il testo lascia l'annulla ai byte di prima", () => {
    const { engine, host, changes } = mounted(prettyNode.before);
    select(host, "a");
    action(host, "delete");
    // L'eco della propria modifica, com'è quando la sessione la riconsegna.
    engine.syncDoc({ text: changes[0]!.text, operation: changes[0]!.operation });
    expect(engine.undo()).toBe(true);
    // Le toppe inverse la rimetterebbero compatta (vettore 14): qui torna rientrata.
    expect(engine.getDoc()).toBe(prettyNode.before);
    expect(engine.getDoc()).not.toBe(prettyNode.expect.undo);
    engine.destroy();
  });

  it(`il limite di ${MAX_CANVAS_HISTORY} passi: i più vecchi escono, gli altri tornano ai byte`, () => {
    const { engine, host } = mounted(knownNumberForms.before);
    select(host, "a");
    const texts = [engine.getDoc()];
    for (let step = 0; step < MAX_CANVAS_HISTORY + 1; step++) {
      viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      texts.push(engine.getDoc());
    }
    for (let step = 0; step < MAX_CANVAS_HISTORY; step++) {
      expect(engine.undo()).toBe(true);
      expect(engine.getDoc()).toBe(texts[texts.length - 2 - step]);
    }
    expect(engine.undo()).toBe(false);
    expect(engine.getDoc()).toBe(texts[1]);
    engine.destroy();
  });

  it("un passo grande: togliere 1000 schede e annullare ridà il testo intero", () => {
    const nodes = Array.from({ length: 1000 }, (_, index) => ({
      id: `n${index}`, type: "text", text: `scheda ${index}`, x: (index % 40) * 300, y: Math.floor(index / 40) * 200, width: 250, height: 1.6e2,
    }));
    const start = JSON.stringify({ nodes, edges: [{ id: "e", fromNode: "n0", toNode: "n1" }] }, null, "\t");
    // Senza la resa Markdown delle schede: qui conta il testo, non il disegno di 1000 schede.
    const { engine, host, changes } = mounted(start, { renderMarkdownForCard: undefined });
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    action(host, "delete");
    expect(changes).toHaveLength(1);
    const after = engine.getDoc();
    expect(readCanvas(after).nodes).toHaveLength(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(start);
    expect(engine.redo()).toBe(true);
    expect(engine.getDoc()).toBe(after);
    expectConsistent(changes, start);
    engine.destroy();
  }, 30_000);

  it("due superfici: l'annulla dell'una arriva all'altra come ogni modifica, e non entra nella sua storia", () => {
    const a = mounted(prettyNode.before);
    const b = mounted(prettyNode.before);
    select(a.host, "a");
    action(a.host, "delete");
    b.engine.syncDoc({ text: a.changes[0]!.text, operation: a.changes[0]!.operation });
    expect(a.engine.undo()).toBe(true);
    const undo = a.changes[1]!;
    expect(undo.operation.kind).toBe("canvas");
    expect(applyOperation(a.changes[0]!.text, undo.operation)).toBe(prettyNode.before);
    b.engine.syncDoc({ text: undo.text, operation: undo.operation });
    expect(b.engine.getDoc()).toBe(prettyNode.before);
    expect(b.engine.undo()).toBe(false);
    a.engine.destroy();
    b.engine.destroy();
  });
});

describe("CanvasEngine: una lavagna che il nucleo apre ma non riscrive (R3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Il testo del vettore senza la chiave doppia: la stessa lavagna, riscrivibile. */
  const fixed: Readonly<Record<string, string>> = {
    [duplicateUnknownKey.before]: duplicateUnknownKey.before.replace(',"fub:k":1', ""),
    [nestedDuplicate.before]: nestedDuplicate.before.replace('"s":1,', ""),
  };

  const starts: ReadonlyArray<readonly [string, string]> = [
    ["vettore 32 (una chiave sconosciuta doppia sulla radice)", duplicateUnknownKey.before],
    ["vettore 33 (una chiave doppia dentro un campo sconosciuto di una scheda)", nestedDuplicate.before],
  ];

  function viewportOf(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function nodeEl(host: HTMLElement, id: string): HTMLElement {
    return host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  }

  function select(host: HTMLElement, id: string): void {
    nodeEl(host, id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function button(host: HTMLElement, name: string): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>(`[data-canvas-action="${name}"]`)!;
  }

  function notices(host: HTMLElement): Element[] {
    return [...host.querySelectorAll(".canvas-intake-error")];
  }

  function expectUnwritable(host: HTMLElement): void {
    const shown = notices(host);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.getAttribute("role")).toBe("alert");
    expect(shown[0]!.textContent).toBe(t("canvas.unwritable"));
    // All'inizio della barra, dove si legge senza scorrere.
    expect(shown[0]!.parentElement?.firstElementChild).toBe(shown[0]);
    for (const name of ["add-text", "add-link", "add-group", "duplicate", "delete"]) {
      expect(button(host, name).disabled, name).toBe(true);
    }
    // Davanti e dietro stanno nella riga delle opzioni (T50) con delle
    // schede scelte: spenti, col perché.
    for (const name of ["bring-front", "send-back"]) {
      const shown = button(host, name);
      if (shown?.isConnected) expect(shown.getAttribute("aria-disabled"), name).toBe("true");
    }
    // Guardare resta: la camera non cambia il testo.
    expect(button(host, "zoom-in").getAttribute("aria-disabled")).toBeNull();
    expect(button(host, "fit").getAttribute("aria-disabled")).toBeNull();
  }

  /** Ogni gesto che cambierebbe la lavagna, provato sulla scheda `a`. */
  function tryEveryGesture(engine: CanvasEngine, host: HTMLElement): void {
    const viewport = viewportOf(host);
    for (const name of ["add-text", "add-link", "add-group"]) button(host, name).click();
    select(host, "a");
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    for (const name of ["duplicate", "delete", "bring-front", "send-back"]) button(host, name).click();
    // Trascinare la scheda.
    nodeEl(host, "a").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 0, clientY: 0 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 80, clientY: 40 }));
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 4, clientX: 80, clientY: 40 }));
    // Ridimensionare: in sola lettura la maniglia non c'è.
    expect(host.querySelector('[data-resize="a"]')).toBeNull();
    // Collegare, verso il vuoto.
    host.querySelector<HTMLElement>('[data-connect="a"]')?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 9, clientX: 0, clientY: 0 }),
    );
    vi.spyOn(document, "elementFromPoint").mockReturnValue(viewport);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, clientX: 400, clientY: 300 }));
    vi.restoreAllMocks();
    // Scrivere: il doppio clic non apre il campo.
    nodeEl(host, "a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".canvas-text-editor, .canvas-field-editor")).toBeNull();
    // Il menu: i gesti che cambiano sono spenti, e anche chiamati non cambiano niente.
    vi.spyOn(document, "elementFromPoint").mockReturnValue(nodeEl(host, "a"));
    const menu = engine.contextMenu({ x: 10, y: 10 })!;
    vi.restoreAllMocks();
    const items = menu.context as readonly SurfaceMenuItem[];
    for (const id of ["canvas.duplicate", "canvas.delete"]) {
      const item = items.find((entry) => entry.id === id)!;
      expect(item.enabled, id).toBe(false);
      item.run?.();
    }
    const color = items.find((item) => item.id === "canvas.color");
    (color?.items as readonly SurfaceMenuItem[] | undefined)?.find((item) => item.id === "canvas.color.2")?.run?.();
    expect(engine.undo()).toBe(false);
    expect(engine.redo()).toBe(false);
  }

  for (const [name, start] of starts) {
    it(`${name}: si apre e disegna le schede, nessun gesto la cambia, l'avviso dice perché; senza la chiave doppia torna a cambiare`, () => {
      const { engine, host, changes } = mounted(start);
      expect(host.querySelectorAll(".canvas-node")).toHaveLength(1);
      expect(nodeEl(host, "a").textContent).toContain("uno");
      expectUnwritable(host);
      tryEveryGesture(engine, host);
      expect(changes).toHaveLength(0);
      expect(engine.getDoc()).toBe(start);
      expectUnwritable(host);

      // La chiave doppia tolta da un'altra superficie (la vista Sorgente).
      const writable = fixed[start]!;
      expect(writable).not.toBe(start);
      engine.syncDoc({ text: writable, operation: operationFromText(start, writable) });
      expect(notices(host)).toHaveLength(0);
      expect(button(host, "add-text").disabled).toBe(false);
      select(host, "a");
      viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(changes).toHaveLength(1);
      expect(readCanvas(engine.getDoc()).nodes[0]!.x).toBe(8);
      expect(applyOperation(writable, changes[0]!.operation)).toBe(engine.getDoc());

      // E rimessa: di nuovo da guardare, e l'annulla non passa.
      engine.syncDoc(start);
      expectUnwritable(host);
      expect(engine.undo()).toBe(false);
      expect(engine.getDoc()).toBe(start);
      engine.destroy();
    });
  }

  it("aprire con setDoc un testo riscrivibile toglie la sola lettura del testo di prima", () => {
    const { engine, host, changes } = mounted(duplicateUnknownKey.before);
    expectUnwritable(host);
    engine.setDoc(fixed[duplicateUnknownKey.before]!);
    expect(notices(host)).toHaveLength(0);
    button(host, "add-text").click();
    expect(changes).toHaveLength(1);
    engine.setDoc(nestedDuplicate.before);
    expectUnwritable(host);
    engine.destroy();
  });

  it("la sola lettura del pannello arriva e se ne va: quella della tela resta finché c'è la chiave doppia", () => {
    const { engine, host, changes } = mounted(nestedDuplicate.before);
    engine.setReadOnly(true);
    expectUnwritable(host);
    engine.setReadOnly(false);
    expectUnwritable(host);
    tryEveryGesture(engine, host);
    expect(changes).toHaveLength(0);
    // La chiave doppia se ne va col pannello ancora in sola lettura: l'avviso
    // della tela sparisce, ma i gesti restano spenti per il pannello.
    engine.setReadOnly(true);
    const writable = fixed[nestedDuplicate.before]!;
    engine.syncDoc(writable);
    expect(notices(host)).toHaveLength(0);
    expect(button(host, "add-text").disabled).toBe(true);
    engine.setReadOnly(false);
    expect(button(host, "add-text").disabled).toBe(false);
    button(host, "add-text").click();
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("il campo aperto quando arriva da fuori un testo con la chiave doppia si chiude, come per il pannello", () => {
    const writable = fixed[duplicateUnknownKey.before]!;
    const { engine, host, changes } = mounted(writable);
    nodeEl(host, "a").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    input.value = "non registrato";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    engine.syncDoc(duplicateUnknownKey.before);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    expect(engine.hasPending).toBe(false);
    expectUnwritable(host);
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(duplicateUnknownKey.before);
    engine.destroy();
  });

  it("oltre il limite interattivo vince l'avviso del limite: uno solo per volta", () => {
    const board = JSON.stringify({
      nodes: Array.from({ length: 2_001 }, (_, index) => ({
        id: `n${index}`, type: "text", x: index * 8, y: 0, width: 100, height: 60, text: "card",
      })),
      edges: [],
    });
    const source = `${board.slice(0, -1)},"fub:k":1,"fub:k":2}`;
    const { engine, host, changes } = mounted(source);
    expect(host.querySelector(".canvas-viewport")?.getAttribute("data-canvas-protocol")).toBe("source-fallback");
    expect(host.querySelector(".canvas-large-fallback")?.textContent).toBe(t("canvas.too_large"));
    expect(notices(host)).toHaveLength(0);
    button(host, "add-text").click();
    expect(changes).toHaveLength(0);
    // Sotto il limite, la stessa chiave doppia: torna l'avviso della tela.
    const small = `${JSON.stringify({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "uno" }], edges: [] }).slice(0, -1)},"fub:k":1,"fub:k":2}`;
    engine.syncDoc(small);
    expect(host.querySelector(".canvas-large-fallback")).toBeNull();
    expectUnwritable(host);
    engine.destroy();
  });

  it("col nucleo che arriva dopo, la tela si apre già in sola lettura", async () => {
    let loaded = false;
    const port: CanvasCorePort = {
      openNow: (text) => (loaded ? openCoreNow(text) : null),
      ready: async () => {
        await canvasCoreReady();
        loaded = true;
      },
    };
    const { engine, host, changes } = mounted(nestedDuplicate.before, { core: port });
    expect(host.querySelectorAll(".canvas-node")).toHaveLength(0);
    await vi.waitFor(() => expect(host.querySelectorAll(".canvas-node")).toHaveLength(1));
    expectUnwritable(host);
    tryEveryGesture(engine, host);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });
});

describe("CanvasEngine: trascinare e incollare (T15)", () => {
  const BASE_IDS = ["t", "f", "g", "w"];

  function viewport(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function transfer(values: Record<string, string> = {}, extra: Record<string, unknown> = {}): DataTransfer {
    return { files: [], items: [], types: Object.keys(values), getData: (type: string) => values[type] ?? "", ...extra } as unknown as DataTransfer;
  }

  function drop(host: HTMLElement, data: DataTransfer, x = 200, y = 120): void {
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
    viewport(host).dispatchEvent(event);
  }

  function paste(host: HTMLElement, data: DataTransfer): void {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    viewport(host).dispatchEvent(event);
  }

  function dragover(host: HTMLElement, data: DataTransfer, x = 200, y = 120): void {
    const event = new DragEvent("dragover", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
    viewport(host).dispatchEvent(event);
  }

  /** Le schede nate, nell'ordine del documento. */
  function born(engine: CanvasEngine): CanvasDocument["nodes"] {
    return readCanvas(engine.getDoc()).nodes.filter((node) => !BASE_IDS.includes(node.id));
  }

  it("più file nascono in griglia, in ordine di nome, con la misura della specie, e un annulla li toglie", async () => {
    const resolvePaths = vi.fn(async () => ["b/z.md", "a/foto 10.png", "x/libro.xlsx", "a/foto 2.png"]);
    const measureImage = vi.fn(async (path: string) => (path === "a/foto 2.png" ? { width: 1000, height: 500 } : null));
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit: vi.fn(), resolvePaths }, measureImage });
    drop(host, transfer());
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const nodes = born(engine);
    expect(nodes.map((node) => node.file)).toEqual(["a/foto 2.png", "a/foto 10.png", "x/libro.xlsx", "b/z.md"]);
    // La misura: l'immagine misurata col lato lungo di 480, quella senza
    // misura 480×360, il foglio 480×300, la nota 320×240.
    expect(nodes.map((node) => [node.width, node.height])).toEqual([[480, 240], [480, 360], [480, 300], [320, 240]]);
    // La griglia di `dropLayout` a partire dal punto del rilascio.
    const first = nodes[0]!;
    const expected = dropLayout(nodes.map((node) => ({ path: node.file!, kind: "file", size: { width: node.width, height: node.height } })), first);
    expect(nodes.map((node) => ({ path: node.file, x: node.x, y: node.y }))).toEqual(expected.cards.map((card) => ({ path: card.path, x: card.x, y: card.y })));
    expect(nodes[1]!.x).toBe(first.x + 504);
    expect(nodes[2]!.y).toBe(first.y + 384);
    expect(measureImage).toHaveBeenCalledTimes(2);
    expect(engine.undo()).toBe(true);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("oltre 12 file nasce anche un gruppo «{count} file», sotto le schede, nello stesso annulla", async () => {
    const paths = Array.from({ length: 13 }, (_, index) => `note/n${index + 1}.md`);
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit: vi.fn(), resolvePaths: async () => paths } });
    drop(host, transfer());
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const nodes = born(engine);
    expect(nodes).toHaveLength(14);
    expect(nodes[0]).toMatchObject({ type: "group", label: t("canvas.intake.group", { count: 13 }) });
    const group = nodes[0]!;
    for (const card of nodes.slice(1)) {
      expect(card.type).toBe("file");
      expect(card.x).toBeGreaterThanOrEqual(group.x + 24);
      expect(card.y).toBeGreaterThanOrEqual(group.y + 24);
      expect(card.x + card.width).toBeLessThanOrEqual(group.x + group.width - 24);
      expect(card.y + card.height).toBeLessThanOrEqual(group.y + group.height - 24);
    }
    expect(engine.undo()).toBe(true);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("su una scheda di file il primo file ne prende il posto, gli altri nascono accanto (A-8)", async () => {
    const { engine, host, changes } = mounted(canvasSource(), {
      attachments: { deposit: vi.fn(), resolvePaths: async () => ["nuovo/uno.pdf", "nuovo/due.md"] },
    });
    vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector('.canvas-node[data-node="f"]'));
    drop(host, transfer());
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(readCanvas(engine.getDoc()).nodes.find((node) => node.id === "f")!.file).toBe("nuovo/uno.pdf");
    expect(born(engine).map((node) => [node.file, node.width, node.height])).toEqual([["nuovo/due.md", 320, 240]]);
    vi.restoreAllMocks();
    engine.destroy();
  });

  it("una misura che fallisce o non arriva lascia quella di serie", async () => {
    vi.useFakeTimers();
    try {
      const measureImage = vi.fn((path: string) => (path.endsWith("a.png")
        ? Promise.reject(new Error("non si legge"))
        : new Promise<null>(() => {})));
      const { engine, host, changes } = mounted(canvasSource(), {
        attachments: { deposit: vi.fn(), resolvePaths: async () => ["a.png", "b.png"] }, measureImage,
      });
      drop(host, transfer());
      await vi.advanceTimersByTimeAsync(MEASURE_IMAGE_TIMEOUT_MS - 1);
      expect(changes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(changes).toHaveLength(1);
      expect(born(engine).map((node) => [node.file, node.width, node.height])).toEqual([["a.png", 480, 360], ["b.png", 480, 360]]);
      engine.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("un deposito che l'host rifiuta lo dice nella barra, come prima", async () => {
    const deposit = vi.fn(async (): Promise<readonly string[]> => {
      throw new Error("troppo grande");
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "x.png")] }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("troppo grande"));
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("un deposito fermato a metà: le schede dei file già fatti nascono in un annulla solo, poi l'errore", async () => {
    const deposit = vi.fn(async (_files: readonly File[], _id: string, _cards: CanvasDepositCards): Promise<readonly string[]> => {
      throw new CanvasDepositError({ kind: "io", message: "disco pieno" }, ["Foto/a.png", "Foto/b.png"]);
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "a.png"), new File(["y"], "b.png"), new File(["z"], "c.png")] }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(born(engine).map((node) => node.file)).toEqual(["Foto/a.png", "Foto/b.png"]);
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno");
    // Le schede si ricordano per id: la porta le ripunta in un commit solo.
    const cards = deposit.mock.calls[0]![2];
    expect(cards.repoint([{ from: "Foto/a.png", to: "attachments/a.png" }, { from: "Foto/b.png", to: "attachments/b.png" }])).toBe(2);
    expect(born(engine).map((node) => node.file)).toEqual(["attachments/a.png", "attachments/b.png"]);
    expect(engine.undo()).toBe(true);
    expect(born(engine).map((node) => node.file)).toEqual(["Foto/a.png", "Foto/b.png"]);
    expect(engine.undo()).toBe(true);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("il primo file rifiutato: solo l'errore, nessuna scheda, e gli appunti non diventano testo", async () => {
    const deposit = vi.fn(async (): Promise<readonly string[]> => {
      throw new CanvasDepositError({ kind: "io", message: "disco pieno" }, []);
    });
    const { engine, host, changes } = mounted(canvasSource(), { attachments: { deposit } });
    paste(host, transfer({ "text/plain": "testo degli appunti" }, { files: [new File(["x"], "x.png")] }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno"));
    expect(changes).toHaveLength(0);
    expect(born(engine)).toEqual([]);
    engine.destroy();
  });

  it("la lavagna cambiata mentre il deposito si ferma: niente schede, ma l'errore si vede", async () => {
    let fail!: (error: unknown) => void;
    const deposit = vi.fn(() => new Promise<readonly string[]>((_resolve, reject) => { fail = reject; }));
    const { engine, host } = mounted(canvasSource(), { attachments: { deposit } });
    drop(host, transfer({}, { files: [new File(["x"], "tardi.png")] }));
    expect(deposit).toHaveBeenCalledTimes(1);
    const remote = JSON.parse(canvasSource());
    remote.nodes[0].text = "Versione remota";
    engine.syncDoc(JSON.stringify(remote));
    fail(new CanvasDepositError({ kind: "io", message: "disco pieno" }, ["attachments/tardi.png"]));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("disco pieno"));
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(readCanvas(engine.getDoc()).nodes[0]!.text).toBe("Versione remota");
    engine.destroy();
  });

  it("incollare mette la scheda sotto il puntatore visto sulla vista, sennò al centro", async () => {
    const { engine, host, changes } = mounted();
    drop(host, transfer({ "text/plain": "lasciato" }), 300, 200);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const dropped = born(engine)[0]!;

    viewport(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    paste(host, transfer({ "text/plain": "sotto il puntatore" }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    const pointed = born(engine)[1]!;
    expect([pointed.text, pointed.x, pointed.y]).toEqual(["sotto il puntatore", dropped.x, dropped.y]);

    viewport(host).dispatchEvent(new PointerEvent("pointerleave", { clientX: 900, clientY: 900 }));
    paste(host, transfer({ "text/plain": "al centro" }));
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    const centered = born(engine)[2]!;
    expect(centered.text).toBe("al centro");
    expect([centered.x, centered.y]).not.toEqual([dropped.x, dropped.y]);
    engine.destroy();
  });

  it("le celle copiate diventano una scheda di testo con la tabella Markdown", async () => {
    const clipboardMarkdown = vi.fn(async () => "| x | y |\n| --- | --- |\n| 1 | 2 |");
    const { engine, host, changes } = mounted(canvasSource(), { clipboardMarkdown });
    paste(host, transfer({ "text/plain": "Nome\tVoto\nAda\t10|lode\n" }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(born(engine)[0]).toMatchObject({ type: "text", text: "| Nome | Voto |\n| --- | --- |\n| Ada | 10\\|lode |" });
    expect(clipboardMarkdown).not.toHaveBeenCalled();

    const html = transfer({ "text/plain": "x\ty\n1\t2", "text/html": "<meta charset=utf-8><table><tr><td>x</td></tr></table>" });
    paste(host, html);
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(clipboardMarkdown).toHaveBeenCalledWith(html);
    expect(born(engine)[1]).toMatchObject({ type: "text", text: "| x | y |\n| --- | --- |\n| 1 | 2 |" });

    // Una riga sola con una tabulazione resta testo.
    paste(host, transfer({ "text/plain": "solo\tuna" }));
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    expect(born(engine)[2]).toMatchObject({ type: "text", text: "solo\tuna" });
    engine.destroy();
  });

  it("incollare mentre si scrive in una scheda di testo va nel testo", async () => {
    const { engine, host, changes } = mounted();
    const field = document.createElement("textarea");
    viewport(host).append(field);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer({ "text/plain": "a\tb\nc\td" }) });
    field.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(false);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("trascinando file o voci dell'albero, rettangoli tratteggiati dove nasceranno; spariscono all'uscita e al rilascio", async () => {
    const { engine, host } = mounted(canvasSource(), { attachments: { deposit: vi.fn(async () => []), resolvePaths: async () => [] } });
    const ghosts = () => [...host.querySelectorAll<HTMLElement>(".canvas-drop-ghost")];
    const files = transfer({}, { types: ["Files"], items: [{ kind: "file" }, { kind: "file" }, { kind: "file" }] });
    dragover(host, files);
    expect(ghosts()).toHaveLength(3);
    expect(ghosts().map((ghost) => [ghost.style.width, ghost.style.height])).toEqual([["320px", "160px"], ["320px", "160px"], ["320px", "160px"]]);
    viewport(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    expect(ghosts()).toHaveLength(0);

    // Le voci dell'albero non si contano prima del rilascio: una.
    dragover(host, transfer({ [ENTRIES_DRAG_TYPE]: "", "text/plain": "" }));
    expect(ghosts()).toHaveLength(1);
    drop(host, transfer());
    expect(ghosts()).toHaveLength(0);

    // WebKit: nessun tipo leggibile, uno.
    dragover(host, transfer({}, { types: [], items: [] }));
    expect(ghosts()).toHaveLength(1);
    viewport(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));

    // Del testo da un'altra app non nasce come file: niente fantasmi.
    dragover(host, transfer({ "text/plain": "ciao" }));
    expect(ghosts()).toHaveLength(0);
    engine.destroy();
  });
});

/** Lo scatto della rotella come lo prova la tela: il delta, la unità e i tasti. */
type WheelInit = {
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly deltaMode?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly clientX?: number;
  readonly clientY?: number;
};

describe("CanvasEngine: la rotella (T35)", () => {
  /** La camera come la mostra la tela: la trasformazione dello stage. */
  function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
    if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;

  /**
   * Uno scatto della rotella sul bersaglio, con il puntatore a (300, 200) se non si dice.
   * Il `WheelEvent` di happy-dom non prende tasti né punto dall'init: si mettono a mano.
   */
  function scroll(target: EventTarget, init: WheelInit = {}): WheelEvent {
    const { ctrlKey = false, metaKey = false, shiftKey = false, clientX = 300, clientY = 200, ...wheel } = init;
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...wheel });
    Object.defineProperties(event, {
      ctrlKey: { value: ctrlKey },
      metaKey: { value: metaKey },
      shiftKey: { value: shiftKey },
      clientX: { value: clientX },
      clientY: { value: clientY },
    });
    target.dispatchEvent(event);
    return event;
  }

  /** «La rotella del mouse» cambiata a lavagna aperta, come la manda un cambio da Impostazioni. */
  function setWheel(wheel: WheelAction): void {
    for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, wheel });
  }

  /** Il punto della lavagna sotto lo schermo (x, y), con la camera data. */
  function boardPoint(camera: { x: number; y: number; zoom: number }, x: number, y: number): { x: number; y: number } {
    return { x: (x - camera.x) / camera.zoom, y: (y - camera.y) / camera.zoom };
  }

  it("di serie la rotella sposta come prima, e Maiusc sposta di lato anche con il solo deltaY", () => {
    const { engine, host } = mounted();
    const start = cameraOf(host);
    scroll(viewportOf(host), { deltaY: 100 });
    expect(cameraOf(host)).toEqual({ ...start, y: start.y - 100 });
    scroll(viewportOf(host), { deltaX: 40 });
    expect(cameraOf(host)).toEqual({ ...start, x: start.x - 40, y: start.y - 100 });
    const mid = cameraOf(host);
    scroll(viewportOf(host), { deltaY: 100, shiftKey: true });
    expect(cameraOf(host)).toEqual({ ...mid, x: mid.x - 100 });
    engine.destroy();
  });

  it("«zoom»: la rotella ingrandisce intorno al puntatore; Maiusc e un gesto orizzontale spostano", () => {
    const { engine, host } = mounted();
    setWheel("zoom");
    const start = cameraOf(host);
    const under = boardPoint(start, 300, 200);
    scroll(viewportOf(host), { deltaY: -100 });
    const zoomed = cameraOf(host);
    expect(zoomed.zoom).toBeCloseTo(start.zoom * 1.1, 9);
    // Il punto della lavagna sotto il puntatore resta sotto il puntatore.
    const kept = boardPoint(zoomed, 300, 200);
    expect(kept.x).toBeCloseTo(under.x, 6);
    expect(kept.y).toBeCloseTo(under.y, 6);
    // Maiusc con la rotella sposta di lato, senza ingrandire.
    scroll(viewportOf(host), { deltaY: 100, shiftKey: true });
    expect(cameraOf(host)).toEqual({ ...zoomed, x: zoomed.x - 100 });
    // Le due dita sul touchpad: una parte orizzontale sposta anche in «zoom».
    const panned = cameraOf(host);
    scroll(viewportOf(host), { deltaX: 30, deltaY: 10 });
    expect(cameraOf(host)).toEqual({ ...panned, x: panned.x - 30, y: panned.y - 10 });
    // Ctrl+rotella ingrandisce ancora.
    const beforeCtrl = cameraOf(host);
    scroll(viewportOf(host), { deltaY: -100, ctrlKey: true });
    expect(cameraOf(host).zoom).toBeCloseTo(beforeCtrl.zoom * 1.1, 9);
    engine.destroy();
  });

  it("sopra una scheda non attiva la rotella è della lavagna, e lo zoom la segue", () => {
    const { engine, host } = mounted();
    setWheel("zoom");
    const before = cameraOf(host).zoom;
    const card = host.querySelector<HTMLElement>('.canvas-node[data-node="t"]')!;
    const event = scroll(card, { deltaY: -100 });
    expect(event.defaultPrevented).toBe(true);
    expect(cameraOf(host).zoom).toBeCloseTo(before * 1.1, 9);
    engine.destroy();
  });

  it("il pizzico (Ctrl o Cmd con la rotella) ingrandisce in tutte e due le scelte", () => {
    for (const wheel of ["pan", "zoom"] as const) {
      const { engine, host } = mounted();
      setWheel(wheel);
      const start = cameraOf(host);
      // Uno scatto piccolo, come lo manda il pizzico, e il browser non ingrandisce la pagina.
      const pinch = scroll(viewportOf(host), { deltaY: -0.5, ctrlKey: true });
      expect(pinch.defaultPrevented, wheel).toBe(true);
      expect(cameraOf(host).zoom, wheel).toBeCloseTo(start.zoom * 1.1, 9);
      // Ctrl senza parte verticale non ingrandisce e non sposta.
      const after = cameraOf(host);
      scroll(viewportOf(host), { deltaX: 5, ctrlKey: true });
      expect(cameraOf(host), wheel).toEqual(after);
      scroll(viewportOf(host), { deltaY: -0.5, metaKey: true });
      expect(cameraOf(host).zoom, wheel).toBeCloseTo(after.zoom * 1.1, 9);
      engine.destroy();
    }
  });

  it("«La rotella del mouse» cambiata a lavagna aperta vale dallo scatto dopo, e smette con la lavagna", () => {
    const watchers = watched.appliers.length;
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    setWheel("pan");
    scroll(viewport, { deltaY: 50 });
    expect(cameraOf(host)).toEqual({ ...start, y: start.y - 50 });
    setWheel("zoom");
    scroll(viewport, { deltaY: -50 });
    const zoomed = cameraOf(host);
    expect(zoomed.zoom).toBeCloseTo(start.zoom * 1.1, 9);
    setWheel("pan");
    scroll(viewport, { deltaY: 50 });
    expect(cameraOf(host)).toEqual({ ...zoomed, y: zoomed.y - 50 });
    engine.destroy();
    expect(watched.appliers).toHaveLength(watchers);
  });

  it("una riga vale 16 px e una pagina l'altezza della vista, qualunque sia la rotella", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    scroll(viewport, { deltaY: 3, deltaMode: 1 });
    expect(cameraOf(host)).toEqual({ ...start, y: start.y - 48 });
    const page = vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const lines = cameraOf(host);
    scroll(viewport, { deltaY: 1, deltaMode: 2 });
    expect(cameraOf(host)).toEqual({ ...lines, y: lines.y - 500 });
    const pages = cameraOf(host);
    scroll(viewport, { deltaX: 0.5, deltaMode: 2 });
    expect(cameraOf(host)).toEqual({ ...pages, x: pages.x - 400 });
    page.mockRestore();
    engine.destroy();
  });

  it("lo zoom ai limiti resta fermo, senza salto", () => {
    const { engine, host } = mounted();
    setWheel("zoom");
    const viewport = viewportOf(host);
    for (let i = 0; i < 40; i++) scroll(viewport, { deltaY: -100 });
    expect(cameraOf(host).zoom).toBe(4);
    const top = cameraOf(host);
    scroll(viewport, { deltaY: -100 });
    expect(cameraOf(host).zoom).toBe(4);
    expect(cameraOf(host).x).toBeCloseTo(top.x, 6);
    expect(cameraOf(host).y).toBeCloseTo(top.y, 6);
    for (let i = 0; i < 80; i++) scroll(viewport, { deltaY: 100 });
    expect(cameraOf(host).zoom).toBe(0.05);
    const bottom = cameraOf(host);
    scroll(viewport, { deltaY: 100 });
    expect(cameraOf(host).zoom).toBe(0.05);
    expect(cameraOf(host).x).toBeCloseTo(bottom.x, 6);
    expect(cameraOf(host).y).toBeCloseTo(bottom.y, 6);
    engine.destroy();
  });
});

// --- il menu della scheda (T17) ------------------------------------------------

describe("il menu della scheda (T17)", () => {
  /** Due schede della stessa nota, una di testo e un'immagine. */
  function board(): string {
    return JSON.stringify({
      nodes: [
        { id: "n1", type: "file", x: 0, y: 0, width: 240, height: 140, file: "Note/Idee.md", color: "2" },
        { id: "n2", type: "file", x: 300, y: 0, width: 240, height: 140, file: "Note/Idee.md" },
        { id: "t", type: "text", x: 0, y: 200, width: 240, height: 140, text: "\n  Prima riga\nseconda" },
        { id: "f", type: "file", x: 300, y: 200, width: 240, height: 140, file: "allegati/foto.png" },
      ],
      edges: [],
    });
  }

  function open(overrides: Partial<CanvasEngineOptions> = {}) {
    const trashed: string[] = [];
    const beside: string[] = [];
    const made = mounted(board(), {
      onOpenPathBeside: (path) => {
        beside.push(path);
      },
      onTrashPath: async (path) => {
        trashed.push(path);
        return true;
      },
      ...overrides,
    });
    const viewport = made.host.querySelector<HTMLElement>(".canvas-viewport")!;
    return { ...made, viewport, trashed, beside };
  }

  type Entry = string | SurfaceMenuItem;
  const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;

  /** Il tasto destro sulla scheda `element`: la sceglie e torna il menu. */
  function menuOn(engine: CanvasEngine, element: Element) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  }

  function shape(entries: readonly Entry[]): unknown[] {
    return entries.map((entry) => (typeof entry === "string"
      ? entry
      : Array.isArray(entry.items) ? { [entry.id]: shape(entry.items as readonly Entry[]) } : entry.id));
  }

  /** La voce `id`, anche dentro i sottomenu. */
  function item(entries: readonly Entry[] | undefined, id: string): SurfaceMenuItem {
    const find = (list: readonly Entry[]): SurfaceMenuItem | null => {
      for (const entry of list) {
        if (typeof entry === "string") continue;
        if (entry.id === id) return entry;
        const inner = Array.isArray(entry.items) ? find(entry.items as readonly Entry[]) : null;
        if (inner) return inner;
      }
      return null;
    };
    const found = find(entries ?? []);
    if (!found) throw new Error(`nessuna voce ${id}`);
    return found;
  }

  function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  const nodes = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes;
  const removal = (host: HTMLElement) => host.querySelector(".canvas-removal")?.textContent ?? null;
  const undoButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-canvas-action="undo-removal"]');

  it("l'ordine delle voci, la testata, il pericoloso in fondo e i colori come scelte esclusive", () => {
    const { engine, host, beside } = open();
    const menu = menuOn(engine, card(host, "n1"));
    expect(menu.target).toEqual({ kind: "node", ref: "n1", label: "Scheda di nota", name: "Idee.md" });
    const context = menu.context as readonly Entry[];
    expect(shape(context)).toEqual([
      "canvas.open", "canvas.open_beside", "canvas.connect", "—",
      {
        "canvas.color": ["canvas.color.none", "canvas.color.1", "canvas.color.2", "canvas.color.3", "canvas.color.4", "canvas.color.5", "canvas.color.6", "—",
          { "canvas.color.notes": ["canvas.color.gray", "canvas.color.brown", "canvas.color.orange", "canvas.color.yellow", "canvas.color.green", "canvas.color.blue", "canvas.color.purple", "canvas.color.pink", "canvas.color.red"] },
          "canvas.color.other"],
      },
      {
        "canvas.arrange": ["canvas.bring_front", "canvas.send_back", "—",
          { "canvas.align": ["canvas.align.left", "canvas.align.center", "canvas.align.right", "canvas.align.top", "canvas.align.middle", "canvas.align.bottom"] },
          { "canvas.distribute": ["canvas.distribute_x", "canvas.distribute_y"] }],
      },
      "canvas.duplicate", "—", "canvas.delete", "canvas.trash_file",
    ]);
    // I nomi e i tasti del catalogo.
    expect(item(context, "canvas.connect")).toMatchObject({ label: "Collega…", chord: "C" });
    expect(item(context, "canvas.delete")).toMatchObject({ label: "Togli dalla lavagna", danger: true });
    expect(item(context, "canvas.trash_file")).toMatchObject({ label: "Sposta anche il file nel cestino", danger: true });
    expect(item(context, "canvas.trash_file").chord).toBeUndefined();
    expect(item(context, "canvas.duplicate").chord).toBe("Mod-d");
    expect(item(context, "canvas.bring_front").chord).toBe("Mod-]");
    expect(item(context, "canvas.send_back").chord).toBe("Mod-[");
    // Rosso solo in fondo.
    const flat = context.filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    expect(flat.map((entry) => entry.danger === true)).toEqual([false, false, false, false, false, false, true, true]);
    // I colori: scelte esclusive, segnata quella della scheda.
    const colors = (item(context, "canvas.color").items as readonly Entry[])
      .flatMap((entry) => (typeof entry === "string" ? [] : Array.isArray(entry.items) ? (entry.items as readonly SurfaceMenuItem[]) : [entry]));
    expect(colors).toHaveLength(17);
    expect(colors.every((entry) => entry.radio === true)).toBe(true);
    expect(colors.filter((entry) => entry.checked).map((entry) => entry.id)).toEqual(["canvas.color.2"]);
    // Una scheda sola: allinea e distribuisci spenti, col perché.
    expect(item(context, "canvas.align")).toMatchObject({ enabled: false, description: t("canvas.commands.why.two") });
    // Apri a lato passa dalla porta nuova.
    item(context, "canvas.open_beside").run!();
    expect(beside).toEqual(["/Note/Idee.md"]);
    engine.destroy();
  });

  it("il menu dei colori (T47): i nomi, «Colori delle note», «Altro…» e la scelta segnata", () => {
    const { engine, host, changes } = open();
    let menu = menuOn(engine, card(host, "n2")).context as readonly Entry[];
    const color = item(menu, "canvas.color");
    // I nomi del menu: corti, il sottomenu dice di che cosa.
    expect(item(menu, "canvas.color.none")).toMatchObject({ label: "Nessuno", radio: true, checked: true, swatches: ["transparent"] });
    expect(item(menu, "canvas.color.5").label).toBe("Azzurro");
    expect(item(menu, "canvas.color.notes").label).toBe("Colori delle note");
    expect(item(menu, "canvas.color.blue")).toMatchObject({ label: "Blu", radio: true, checked: false });
    expect(item(menu, "canvas.color.other")).toMatchObject({ label: "Altro…", radio: true, checked: false });
    expect(color.items).toContain(MENU_RULE);
    // Uno dei nove si scrive col suo esadecimale chiaro, e torna segnato.
    item(menu, "canvas.color.blue").run!();
    expect(nodes(engine).find((node) => node.id === "n2")!.color).toBe("#0064b0");
    expect(card(host, "n2").dataset.canvasColor).toBe("blue");
    menu = menuOn(engine, card(host, "n2")).context as readonly Entry[];
    expect(item(menu, "canvas.color.blue").checked).toBe(true);
    expect(item(menu, "canvas.color.none").checked).toBe(false);
    // «Altro…» apre il selettore del kit sotto la scheda, coi nove fra i consigliati.
    item(menu, "canvas.color.other").run!();
    const popover = document.querySelector<HTMLElement>(".kit-color-popover")!;
    expect(popover).not.toBeNull();
    expect(popover.getAttribute("aria-label")).toBe("Altro colore…");
    expect([...popover.querySelectorAll<HTMLElement>(".kit-color-swatch")].map((swatch) => swatch.dataset.color))
      .toEqual(["#5e626b", "#84573e", "#984b00", "#795f00", "#007231", "#0064b0", "#7847a6", "#9e366f", "#b7191c"]);
    const input = popover.querySelector<HTMLInputElement>(".kit-color-input")!;
    input.value = "#7B3FA0";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(nodes(engine).find((node) => node.id === "n2")!.color).toBe("#7b3fa0");
    expect(card(host, "n2").style.getPropertyValue("--canvas-color")).toBe("#7b3fa0");
    menu = menuOn(engine, card(host, "n2")).context as readonly Entry[];
    expect(item(menu, "canvas.color.other").checked).toBe(true);
    expect(changes).toHaveLength(2);
    engine.destroy();
  });

  it("più schede con colori diversi: nessuna scelta segnata (T47)", () => {
    const { engine, host, viewport } = open();
    key(viewport, { key: "a", ctrlKey: true });
    const menu = engine.contextMenu(null)!.context as readonly Entry[];
    const leaves = (entries: readonly Entry[]): SurfaceMenuItem[] => entries.flatMap((entry) =>
      typeof entry === "string" ? [] : Array.isArray(entry.items) ? leaves(entry.items as readonly Entry[]) : [entry]);
    expect(leaves(item(menu, "canvas.color").items as readonly Entry[]).filter((entry) => entry.checked)).toEqual([]);
    expect(host.querySelectorAll(".canvas-node.selected")).toHaveLength(4);
    engine.destroy();
  });

  it("la scheda di testo: la prima riga nella testata e niente cestino", () => {
    const { engine, host } = open();
    const menu = menuOn(engine, card(host, "t"));
    expect(menu.target).toEqual({ kind: "node", ref: "t", label: "Scheda di testo", name: "Prima riga" });
    const ids = (menu.context ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry.id]));
    expect(ids).toEqual(["canvas.edit", "canvas.connect", "canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.delete"]);
    engine.destroy();
  });

  it("la testata di una scheda di testo dice il nome senza i segni del Markdown: «# **Idee**» è «Idee»", () => {
    const { engine, host } = mounted(JSON.stringify({
      nodes: [{ id: "h", type: "text", x: 0, y: 0, width: 240, height: 140, text: "# **Idee**\nil resto" }],
      edges: [],
    }));
    const menu = menuOn(engine, card(host, "h"));
    expect(menu.target).toEqual({ kind: "node", ref: "h", label: "Scheda di testo", name: "Idee" });
    engine.destroy();
  });

  it("più schede: la testata dice quante, niente Apri; in sola lettura le voci che cambiano sono spente, non nascoste", () => {
    const { engine, host, viewport } = open();
    viewport.focus();
    key(viewport, { key: "a", ctrlKey: true });
    const many = engine.contextMenu(null)!;
    expect(many.target.label).toBe("4 schede");
    const ids = (many.context ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry.id]));
    expect(ids).toEqual(["canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.delete", "canvas.trash_file"]);
    // Le schede hanno colori diversi: nessuno segnato.
    expect((item(many.context, "canvas.color").items as readonly SurfaceMenuItem[]).some((entry) => entry.checked)).toBe(false);
    expect(item(many.context, "canvas.distribute").enabled).toBe(true);

    key(viewport, { key: "Escape" });
    engine.setReadOnly(true);
    const locked = menuOn(engine, card(host, "n1")).context;
    const why = t("canvas.commands.why.read_only");
    for (const id of ["canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.delete", "canvas.trash_file", "canvas.connect"]) {
      expect(item(locked, id), id).toMatchObject({ enabled: false, description: why });
    }
    // Apri e Apri a lato non cambiano la lavagna: restano accesi.
    expect(item(locked, "canvas.open").enabled).toBe(true);
    expect(item(locked, "canvas.open_beside").enabled).toBe(true);
    engine.destroy();
  });

  it("C con una scheda scelta comincia il collegamento; mentre si scrive va nel testo", () => {
    const { engine, host, viewport } = open();
    menuOn(engine, card(host, "n1"));
    viewport.focus();
    expect(key(viewport, { key: "c" }).defaultPrevented).toBe(true);
    expect(viewport.dataset.tool).toBe("connect");
    // Il clic sull'altra scheda chiude il filo, e la colonna torna alla Selezione.
    const target = card(host, "f");
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 2, clientX: 400, clientY: 300 }));
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 2, clientX: 400, clientY: 300 }));
    pointing.mockRestore();
    expect(readCanvas(engine.getDoc()).edges.map((edge) => [edge.fromNode, edge.toNode])).toEqual([["n1", "f"]]);
    expect(viewport.dataset.tool).toBe("select");

    // Senza scheda scelta C sceglie lo strumento; Esc torna alla Selezione.
    key(viewport, { key: "Escape" });
    key(viewport, { key: "c" });
    expect(viewport.dataset.tool).toBe("connect");
    key(viewport, { key: "Escape" });
    expect(viewport.dataset.tool).toBe("select");

    // Dentro una scheda di testo C è una lettera.
    card(host, "t").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    expect(key(input, { key: "c" }).defaultPrevented).toBe(false);
    expect(viewport.dataset.tool).toBe("select");
    engine.destroy();
  });

  it("Ctrl+] e Ctrl+[ portano davanti e dietro", () => {
    const { engine, host, viewport } = open();
    menuOn(engine, card(host, "n1"));
    viewport.focus();
    expect(key(viewport, { key: "]", ctrlKey: true, code: "BracketRight" }).defaultPrevented).toBe(true);
    expect(nodes(engine).map((node) => node.id)).toEqual(["n2", "t", "f", "n1"]);
    key(viewport, { key: "[", ctrlKey: true, code: "BracketLeft" });
    expect(nodes(engine).map((node) => node.id)).toEqual(["n1", "n2", "t", "f"]);
    engine.destroy();
  });

  it("Togli dalla lavagna lo dice con Annulla, che fa ciò che fa Ctrl+Z; la modifica dopo spegne l'avviso", () => {
    const { engine, host, viewport, trashed } = open();
    menuOn(engine, card(host, "n1"));
    viewport.focus();
    key(viewport, { key: "Delete" });
    expect(nodes(engine).map((node) => node.id)).toEqual(["n2", "t", "f"]);
    expect(removal(host)).toBe("Tolta dalla lavagna. Il file resta.");
    undoButton(host)!.click();
    expect(nodes(engine).map((node) => node.id)).toEqual(["n1", "n2", "t", "f"]);
    expect(removal(host)).toBeNull();

    // Una scheda di testo: niente file.
    item(menuOn(engine, card(host, "t")).context, "canvas.delete").run!();
    expect(removal(host)).toBe("Scheda tolta.");
    // Una modifica dopo il togliere: l'avviso se ne va, col suo Annulla.
    menuOn(engine, card(host, "f"));
    viewport.focus();
    key(viewport, { key: "d", ctrlKey: true });
    expect(nodes(engine)).toHaveLength(4);
    expect(removal(host)).toBeNull();
    expect(undoButton(host)).toBeNull();

    // Più schede, una di file: «I file restano». Backspace come Canc.
    key(viewport, { key: "a", ctrlKey: true });
    key(viewport, { key: "Backspace" });
    expect(nodes(engine)).toHaveLength(0);
    expect(removal(host)).toBe("4 schede tolte dalla lavagna. I file restano.");
    undoButton(host)!.click();
    expect(nodes(engine)).toHaveLength(4);
    // Mai il file.
    expect(trashed).toEqual([]);
    engine.destroy();
  });

  it("Sposta anche il file nel cestino chiama la porta una volta per file, toglie ogni sua scheda, e mai da tastiera", async () => {
    const { engine, host, viewport, trashed } = open();
    // Nessun tasto lo fa.
    expect(engine.commands().find((one) => one.id === "canvas.trash_file")!.keys).toEqual([]);
    viewport.focus();
    key(viewport, { key: "a", ctrlKey: true });
    for (const press of [{ key: "Delete" }, { key: "Delete", shiftKey: true }, { key: "Delete", ctrlKey: true }, { key: "Backspace", ctrlKey: true }]) {
      key(viewport, { ...press });
      engine.undo();
      key(viewport, { key: "a", ctrlKey: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trashed).toEqual([]);
    expect(nodes(engine)).toHaveLength(4);
    key(viewport, { key: "Escape" });

    // La nota in due schede: un file solo, tutte e due tolte.
    item(menuOn(engine, card(host, "n1")).context, "canvas.trash_file").run!();
    await vi.waitFor(() => expect(nodes(engine).map((node) => node.id)).toEqual(["t", "f"]));
    expect(trashed).toEqual(["Note/Idee.md"]);
    expect(removal(host)).toBe("2 schede tolte dalla lavagna. «Idee.md» è nel cestino.");
    expect(undoButton(host)).toBeNull();

    // Due file scelti: la porta una volta ciascuno.
    key(viewport, { key: "a", ctrlKey: true });
    item(engine.contextMenu(null)!.context, "canvas.trash_file").run!();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(0));
    expect(trashed).toEqual(["Note/Idee.md", "allegati/foto.png"]);
    engine.destroy();
  });

  it("il cestino che rifiuta lascia la scheda e dice l'errore dell'host; un no alla domanda la lascia in silenzio", async () => {
    let answer: "refuse" | "no" = "refuse";
    const { engine, host } = open({
      onTrashPath: async () => {
        if (answer === "refuse") throw new Error("Il cestino è pieno");
        return false;
      },
    });
    item(menuOn(engine, card(host, "f")).context, "canvas.trash_file").run!();
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe("Il cestino è pieno"));
    expect(nodes(engine)).toHaveLength(4);
    answer = "no";
    item(menuOn(engine, card(host, "f")).context, "canvas.trash_file").run!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(nodes(engine)).toHaveLength(4);
    expect(removal(host)).toBeNull();
    engine.destroy();
  });
});

describe("CanvasEngine: copia e incolla le schede (T68)", () => {
  const TYPE = "application/x-fub-canvas+json";
  const STROKE = {
    id: "s-1", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 }, ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  function source(): string {
    return JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "Prima" },
        { id: "b", type: "text", x: 400, y: 104, width: 240, height: 140, text: "Seconda", "fub:ink": { v: 1, strokes: [STROKE] }, vendor: { keep: true } },
        { id: "f", type: "file", x: 40, y: 320, width: 240, height: 140, file: "Corsi/voti.xlsx" },
      ],
      edges: [{ id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow", label: "poi" }],
    });
  }

  /** Gli appunti di una prova: ciò che si scrive si rilegge. */
  function store(values: Record<string, string> = {}): DataTransfer & { values: Record<string, string> } {
    return {
      values, files: [], items: [],
      get types() { return Object.keys(values); },
      getData: (type: string) => values[type] ?? "",
      setData: (type: string, value: string) => { values[type] = value; },
    } as unknown as DataTransfer & { values: Record<string, string> };
  }

  function viewportOf(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function clipboardEvent(type: "copy" | "cut" | "paste", target: HTMLElement, data: DataTransfer): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    target.dispatchEvent(event);
    return event;
  }

  /** Ctrl+A col fuoco sulla vista: tutte le schede scelte. */
  function selectAll(host: HTMLElement): void {
    const viewport = viewportOf(host);
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
  }

  function nodesOf(engine: CanvasEngine): CanvasDocument["nodes"] {
    return readCanvas(engine.getDoc()).nodes;
  }

  it("copia schede, filo e inchiostro e li incolla in un'altra lavagna sotto il puntatore: un commit, un annulla", async () => {
    const from = mounted(source());
    selectAll(from.host);
    expect(document.activeElement).toBe(viewportOf(from.host));
    const data = store();
    const copied = clipboardEvent("copy", viewportOf(from.host), data);
    expect(copied.defaultPrevented).toBe(true);
    expect(from.changes).toHaveLength(0);
    expect(JSON.parse(data.values[TYPE]!)).toEqual({ version: 1, ...readCanvas(source()) });
    expect(data.values["text/plain"]).toBe("Prima\n\nSeconda\n\n[[Corsi/voti.xlsx]]");
    from.engine.destroy();

    // Un'altra lavagna, di un altro vault: il file che lì non c'è resta un
    // percorso, e la scheda mostra «File mancante» (T16).
    const other = JSON.stringify({ nodes: [{ id: "q", type: "text", x: 0, y: 0, width: 200, height: 100, text: "qui" }], edges: [] });
    const to = mounted(other, { documentId: "altro/board.canvas" });
    viewportOf(to.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    clipboardEvent("paste", viewportOf(to.host), data);
    await vi.waitFor(() => expect(to.changes).toHaveLength(1));
    const doc = readCanvas(to.engine.getDoc());
    const [a, b, f] = doc.nodes.slice(1);
    expect(doc.nodes).toHaveLength(4);
    expect(new Set([a!.id, b!.id, f!.id, "q"]).size).toBe(4);
    expect([a!.id, b!.id, f!.id]).not.toContain("a");
    // Le stesse distanze, l'angolo agganciato alla griglia.
    expect([b!.x - a!.x, b!.y - a!.y, f!.x - a!.x, f!.y - a!.y]).toEqual([360, 64, 0, 280]);
    expect([a!.x % 8 === 0, a!.y % 8 === 0]).toEqual([true, true]);
    expect(b).toMatchObject({ text: "Seconda", "fub:ink": { v: 1, strokes: [STROKE] }, vendor: { keep: true } });
    expect(f).toMatchObject({ type: "file", file: "Corsi/voti.xlsx" });
    expect(doc.edges).toEqual([{ id: doc.edges[0]!.id, fromNode: a!.id, toNode: b!.id, toEnd: "arrow", label: "poi" }]);
    expect(doc.edges[0]!.id).not.toBe("e1");
    // Le schede incollate sono le scelte.
    expect(to.engine.selectedText()).toEqual({ primary: "Corsi/voti.xlsx", secondary: ["Prima", "Seconda"] });
    expect(to.engine.undo()).toBe(true);
    expect(to.engine.getDoc()).toBe(other);
    to.engine.destroy();
  });

  it("incollare due volte fa due copie, la seconda sfalsata; copiare di nuovo riparte dal puntatore", async () => {
    const from = mounted(source());
    selectAll(from.host);
    const data = store();
    clipboardEvent("copy", viewportOf(from.host), data);
    viewportOf(from.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
    clipboardEvent("paste", viewportOf(from.host), data);
    clipboardEvent("paste", viewportOf(from.host), data);
    await vi.waitFor(() => expect(from.changes).toHaveLength(2));
    const pasted = nodesOf(from.engine).slice(3);
    expect(pasted).toHaveLength(6);
    expect([pasted[3]!.x - pasted[0]!.x, pasted[3]!.y - pasted[0]!.y]).toEqual([32, 32]);
    expect(readCanvas(from.engine.getDoc()).edges).toHaveLength(3);
    // Copiare le incollate fa appunti nuovi: il prossimo incolla torna al punto.
    const again = store();
    clipboardEvent("copy", viewportOf(from.host), again);
    clipboardEvent("paste", viewportOf(from.host), again);
    await vi.waitFor(() => expect(from.changes).toHaveLength(3));
    expect([nodesOf(from.engine)[9]!.x, nodesOf(from.engine)[9]!.y]).toEqual([pasted[0]!.x, pasted[0]!.y]);
    from.engine.destroy();
  });

  it("taglia: copia e toglie in un annulla, le schede di file restano file e l'avviso lo dice", async () => {
    const { engine, host, changes } = mounted(source());
    selectAll(host);
    const data = store();
    clipboardEvent("cut", viewportOf(host), data);
    expect(changes).toHaveLength(1);
    expect(nodesOf(engine)).toHaveLength(0);
    expect(readCanvas(engine.getDoc()).edges).toHaveLength(0);
    expect(JSON.parse(data.values[TYPE]!).nodes).toHaveLength(3);
    expect(host.querySelector(".canvas-removal")?.textContent).toBe(t("canvas.card.removed_many", { n: "3" }));
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source());
    // Incollate di nuovo, tornano con filo e inchiostro.
    clipboardEvent("paste", viewportOf(host), data);
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    expect(nodesOf(engine)).toHaveLength(6);
    expect(readCanvas(engine.getDoc()).edges).toHaveLength(2);
    engine.destroy();
  });

  it("una versione futura si rifiuta con l'avviso, mai a metà; un JSON rotto si incolla come testo", async () => {
    const { engine, host, changes } = mounted(source());
    viewportOf(host).focus();
    const future = JSON.stringify({ version: 2, nodes: readCanvas(source()).nodes, edges: [] });
    const event = clipboardEvent("paste", viewportOf(host), store({ [TYPE]: future, "text/plain": "Prima" }));
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.future")));
    expect(changes).toHaveLength(0);

    clipboardEvent("paste", viewportOf(host), store({ [TYPE]: "{\"version\": 1, \"nodes\": [", "text/plain": "come testo" }));
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(nodesOf(engine).slice(3)).toEqual([expect.objectContaining({ type: "text", text: "come testo" })]);
    // Senza testo accanto, è il JSON rotto a diventare il testo.
    clipboardEvent("paste", viewportOf(host), store({ [TYPE]: "{rotto" }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(nodesOf(engine)[4]).toMatchObject({ type: "text", text: "{rotto" });
    engine.destroy();
  });

  it("schede che il nucleo rifiuta non entrano, nemmeno una: l'avviso lo dice", async () => {
    const { engine, host, changes } = mounted(source());
    const bad = JSON.stringify({ version: 1, nodes: [
      { id: "x", type: "text", x: 0, y: 0, width: 10, height: 10, text: "buona" },
      { id: "y", type: "text", x: 0, y: 0, width: 10, height: 10, text: "colore", color: "rosso" },
    ], edges: [] });
    clipboardEvent("paste", viewportOf(host), store({ [TYPE]: bad, "text/plain": "buona" }));
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.refused")));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source());
    engine.destroy();
  });

  it("in sola lettura copiare si può, tagliare e incollare no", async () => {
    const { engine, host, changes } = mounted(source());
    engine.setReadOnly(true);
    selectAll(host);
    const data = store();
    clipboardEvent("copy", viewportOf(host), data);
    expect(JSON.parse(data.values[TYPE]!).nodes).toHaveLength(3);
    const cut = clipboardEvent("cut", viewportOf(host), store());
    expect(cut.defaultPrevented).toBe(false);
    clipboardEvent("paste", viewportOf(host), data);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(source());
    engine.destroy();
  });

  it("gli appunti restano del campo in cui si scrive, e di chi ha il fuoco fuori dalla lavagna", () => {
    const { engine, host } = mounted(source());
    selectAll(host);
    const field = document.createElement("textarea");
    viewportOf(host).append(field);
    field.focus();
    expect(clipboardEvent("copy", field, store()).defaultPrevented).toBe(false);
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(clipboardEvent("copy", outside, store()).defaultPrevented).toBe(false);
    engine.destroy();
  });

  it("il menu della scheda offre Taglia, Copia e Incolla; quello del vuoto Incolla", () => {
    const { engine, host } = mounted(source());
    selectAll(host);
    const card = host.querySelector<HTMLElement>('.canvas-node[data-node="a"]')!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(card);
    expect(engine.contextMenu({ x: 10, y: 10 })!.clipboard!.offers).toEqual({ cut: true, copy: true, paste: true });
    pointing.mockReturnValue(viewportOf(host));
    expect(engine.contextMenu({ x: 900, y: 900 })!.clipboard!.offers).toEqual({ paste: true });
    engine.setReadOnly(true);
    pointing.mockReturnValue(card);
    expect(engine.contextMenu({ x: 10, y: 10 })!.clipboard!.offers).toEqual({ cut: false, copy: true, paste: false });
    pointing.mockRestore();
    engine.destroy();
  });

  it("Ctrl+D dopo aver spostato la copia ripete lo stesso spostamento", () => {
    const { engine, host } = mounted(JSON.stringify({
      nodes: [{ id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "uno" }], edges: [],
    }));
    const viewport = viewportOf(host);
    selectAll(host);
    const press = (init: KeyboardEventInit): void => {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    };
    press({ key: "d", ctrlKey: true });
    expect(nodesOf(engine).map((node) => [node.x, node.y])).toEqual([[40, 40], [72, 72]]);
    // La copia si sposta di due passi a destra: 48, 32 dalla prima.
    press({ key: "ArrowRight" });
    press({ key: "ArrowRight" });
    expect(nodesOf(engine)[1]).toMatchObject({ x: 88, y: 72 });
    press({ key: "d", ctrlKey: true });
    press({ key: "d", ctrlKey: true });
    expect(nodesOf(engine).map((node) => [node.x, node.y])).toEqual([[40, 40], [88, 72], [136, 104], [184, 136]]);
    // Un'altra scelta riparte dallo sfalsamento di sempre.
    selectAll(host);
    press({ key: "d", ctrlKey: true });
    expect(nodesOf(engine).slice(4).map((node) => [node.x, node.y])).toEqual([[72, 72], [120, 104], [168, 136], [216, 168]]);
    engine.destroy();
  });

  describe("i tratti liberi negli appunti (T94)", () => {
    const BRUSH = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";
    const free = (id: string, ink: string) => ({ id, tool: "pen", brush: BRUSH, color: "#0072b2", anchor: { kind: "free" }, ink });
    /** Da (400, 300), sotto la scheda: il Lazo lo prende con lei. */
    const F1 = free("f1", "1 s100 cxy 40000,30000 1200,400 950,-100");
    /** Da (800, 300), lontano: resta fuori dal giro delle schede. */
    const F2 = free("f2", "1 s100 cxy 80000,30000 1000,0");

    function inked(): string {
      return JSON.stringify({
        nodes: [{ id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "Prima" }],
        edges: [],
        "fub:ink": { v: 1, strokes: [F1, F2] },
      });
    }

    /** Un'altra lavagna, col suo tratto libero che ha già l'id `f1`. */
    function elsewhere(): string {
      return JSON.stringify({
        nodes: [{ id: "q", type: "text", x: 0, y: 0, width: 200, height: 100, text: "qui" }],
        edges: [],
        "fub:ink": { v: 1, strokes: [{ ...F2, id: "f1" }] },
      });
    }

    type Stroke = Record<string, unknown> & { id: string; ink: string };
    const freeOf = (engine: CanvasEngine): Stroke[] =>
      ((JSON.parse(engine.getDoc()) as { "fub:ink"?: { strokes: Stroke[] } })["fub:ink"]?.strokes ?? []);

    function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
      const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
      const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
      if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
      return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
    }

    /** Il Lazo, poi un giro col mouse attorno al riquadro dato della lavagna; il fuoco resta sulla vista. */
    function lassoAround(engine: CanvasEngine, host: HTMLElement, x0: number, y0: number, x1: number, y1: number): void {
      engine.commands().find((command) => command.id === "canvas.tool.lasso")!.run();
      const cam = cameraOf(host);
      const viewport = viewportOf(host);
      const points: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]];
      const send = (type: string, [x, y]: [number, number], buttons: number): void => {
        viewport.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, pointerType: "mouse",
          button: type === "pointermove" ? -1 : 0, buttons, clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y,
        }));
      };
      send("pointerdown", points[0]!, 1);
      for (const point of points.slice(1)) send("pointermove", point, 1);
      send("pointerup", points[points.length - 1]!, 0);
      viewport.focus();
    }

    /** Il primo campione di un `ink`, in unità quantizzate. */
    const head = (ink: string): [number, number] => ink.split(" ")[3]!.split(",").map(Number) as [number, number];

    it("copia schede e tratti liberi e li incolla in un'altra lavagna sotto il puntatore: ids nuovi, un commit, un annulla", async () => {
      const from = mounted(inked());
      lassoAround(from.engine, from.host, 20, 20, 460, 360);
      const data = store();
      expect(clipboardEvent("copy", viewportOf(from.host), data).defaultPrevented).toBe(true);
      expect(from.changes).toHaveLength(0);
      const json = JSON.parse(data.values[TYPE]!);
      expect(json).toEqual({ version: 1, nodes: [readCanvas(inked()).nodes[0]], edges: [], "fub:ink": { v: 1, strokes: [F1] } });
      // `text/plain` è quello delle schede: i tratti non hanno Markdown.
      expect(data.values["text/plain"]).toBe("Prima");
      from.engine.destroy();

      const to = mounted(elsewhere(), { documentId: "altro/board.canvas" });
      viewportOf(to.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
      clipboardEvent("paste", viewportOf(to.host), data);
      await vi.waitFor(() => expect(to.changes).toHaveLength(1));
      expect(to.changes[0]!.operation.patches.map((patch) => patch.kind)).toEqual(["upsert-node", "ink"]);
      const card = nodesOf(to.engine)[1]!;
      expect(card).toMatchObject({ type: "text", text: "Prima" });
      const strokes = freeOf(to.engine);
      expect(strokes).toHaveLength(2);
      // Il tratto di prima non cambia; quello incollato ha un id nuovo, anche se `f1` era libero da prendere qui.
      expect(strokes[0]).toEqual({ ...F2, id: "f1" });
      expect(strokes[1]!.id).not.toBe("f1");
      expect(strokes[1]!.id).toMatch(/^s-/);
      // Spostato quanto la scheda: stessa distanza fra loro, la forma uguale.
      const [x, y] = head(strokes[1]!.ink);
      expect([x / 100 - card.x, y / 100 - card.y]).toEqual([360, 260]);
      expect(strokes[1]!.ink.split(" ").slice(4)).toEqual(["1200,400", "950,-100"]);
      expect({ ...strokes[1], id: "f1", ink: F1.ink }).toEqual(F1);
      expect(to.engine.undo()).toBe(true);
      expect(to.engine.getDoc()).toBe(elsewhere());
      to.engine.destroy();
    });

    it("solo tratti: si incollano senza schede, e una seconda volta sfalsati con ids nuovi", async () => {
      const from = mounted(inked());
      lassoAround(from.engine, from.host, 780, 280, 830, 320);
      const data = store();
      clipboardEvent("copy", viewportOf(from.host), data);
      expect(JSON.parse(data.values[TYPE]!)).toEqual({ version: 1, nodes: [], edges: [], "fub:ink": { v: 1, strokes: [F2] } });
      expect(data.values["text/plain"]).toBe("");
      from.engine.destroy();

      const to = mounted(elsewhere());
      viewportOf(to.host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 200 }));
      clipboardEvent("paste", viewportOf(to.host), data);
      clipboardEvent("paste", viewportOf(to.host), data);
      await vi.waitFor(() => expect(to.changes).toHaveLength(2));
      expect(nodesOf(to.engine).map((node) => node.id)).toEqual(["q"]);
      const [, first, second] = freeOf(to.engine);
      expect(new Set(["f1", first!.id, second!.id]).size).toBe(3);
      const [x1, y1] = head(first!.ink);
      const [x2, y2] = head(second!.ink);
      expect([x2 - x1, y2 - y1]).toEqual([3200, 3200]);
      // Ognuno è un passo d'annulla suo.
      expect(to.engine.undo()).toBe(true);
      expect(freeOf(to.engine)).toHaveLength(2);
      expect(to.engine.undo()).toBe(true);
      expect(to.engine.getDoc()).toBe(elsewhere());
      to.engine.destroy();
    });

    it("taglia: toglie schede e tratti liberi scelti in un commit, e un annulla li rimette", () => {
      const { engine, host, changes } = mounted(inked());
      lassoAround(engine, host, 20, 20, 460, 360);
      const data = store();
      clipboardEvent("cut", viewportOf(host), data);
      expect(changes).toHaveLength(1);
      expect(nodesOf(engine)).toHaveLength(0);
      expect(freeOf(engine)).toEqual([F2]);
      expect(JSON.parse(data.values[TYPE]!)["fub:ink"]).toEqual({ v: 1, strokes: [F1] });
      expect(engine.undo()).toBe(true);
      expect(engine.getDoc()).toBe(inked());
      engine.destroy();
    });

    it("un fub:ink rotto, o un tratto che spostato esce dai numeri dell'inchiostro: l'avviso, e non entra niente", async () => {
      const { engine, host, changes } = mounted(elsewhere());
      viewportOf(host).focus();
      const card = { id: "c", type: "text", x: 0, y: 0, width: 100, height: 60, text: "accanto" };
      const broken = JSON.stringify({ version: 1, nodes: [card], edges: [], "fub:ink": { v: 2, strokes: [F1] } });
      const event = clipboardEvent("paste", viewportOf(host), store({ [TYPE]: broken, "text/plain": "accanto" }));
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.refused")));
      // Il primo tratto è all'estremo negativo: spostare il riquadro nel punto porta il secondo oltre il limite.
      const far = JSON.stringify({ version: 1, nodes: [card], edges: [], "fub:ink": { v: 1, strokes: [
        free("lo", "1 s100 cxy -9007199254740000,0 100,0"),
        free("hi", "1 s100 cxy 9007199254740000,0 100,0"),
      ] } });
      // La forma è buona: il rifiuto viene dal nucleo, che sposta i tratti.
      expect(readCanvasClipboard(far).kind).toBe("cards");
      expect(changes).toHaveLength(0);
      engine.destroy();

      const other = mounted(elsewhere());
      viewportOf(other.host).focus();
      clipboardEvent("paste", viewportOf(other.host), store({ [TYPE]: far, "text/plain": "accanto" }));
      await vi.waitFor(() => expect(other.host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.clipboard.refused")));
      expect(other.changes).toHaveLength(0);
      expect(other.engine.getDoc()).toBe(elsewhere());
      other.engine.destroy();
    });

    it("in sola lettura il Lazo copia i tratti; tagliare e incollare no", async () => {
      const { engine, host, changes } = mounted(inked());
      engine.setReadOnly(true);
      lassoAround(engine, host, 780, 280, 830, 320);
      const data = store();
      clipboardEvent("copy", viewportOf(host), data);
      expect(JSON.parse(data.values[TYPE]!)["fub:ink"]).toEqual({ v: 1, strokes: [F2] });
      expect(clipboardEvent("cut", viewportOf(host), store()).defaultPrevented).toBe(false);
      clipboardEvent("paste", viewportOf(host), data);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(changes).toHaveLength(0);
      expect(engine.getDoc()).toBe(inked());
      engine.destroy();
    });
  });
});

describe("CanvasEngine: un colore che Fub non conosce non ferma la lavagna (T47b)", () => {
  // «rosso», «7» e il vuoto non sono colori di Fub: il nucleo li tiene come
  // sono, la tela non li disegna e non li segna nel menu.
  const source = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 100, height: 80, color: "rosso", text: "a" },
      { id: "b", type: "text", x: 200, y: 0, width: 100, height: 80, color: "7", text: "b" },
      { id: "c", type: "text", x: 400, y: 0, width: 100, height: 80, color: "", text: "c" },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b", color: "rosso" }],
  });

  it("si apre; la scheda e il filo non hanno colore, e aprire non scrive", () => {
    const { engine, host, changes } = mounted(source);
    expect(engine.getDoc()).toBe(source);
    for (const id of ["a", "b", "c"]) {
      const card = host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
      expect(card).not.toBeNull();
      expect(card.dataset.canvasColor).toBeUndefined();
      expect(card.style.getPropertyValue("--canvas-color")).toBe("");
    }
    const edge = host.querySelector<SVGPathElement>('.canvas-edge-line[data-edge="e1"]')!.parentElement!;
    expect(edge.dataset.canvasColor).toBeUndefined();
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("scegliere un colore lo sostituisce, e l'annulla riporta il testo di prima", () => {
    const { engine, host, changes } = mounted(source);
    host.querySelector<HTMLElement>(".canvas-viewport")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    engine.commands().find((command) => command.id === "canvas.color.1")!.run();
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("1");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("spostare la scheda riscrive soltanto la sua posizione: il colore che Fub non conosce resta com'era", () => {
    const { engine, host } = mounted(source);
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(engine.getDoc()).toBe(source.replace('"x":0,"y":0,', '"x":0,"y":8,'));
    engine.destroy();
  });
});

describe("i fili: collegare senza mirare, prendere un filo (T67)", () => {
  /**
   * `a` e `b` affiancate col filo `e1` dritto fra loro (da 200,50 a 400,50);
   * `c` sotto `a`; `s` sotto il filo, col bordo alto a 5 dal filo; `d` ed
   * `e` sovrapposte, `e` sopra.
   */
  function board(): string {
    return JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "a" },
        { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "b" },
        { id: "c", type: "text", x: 0, y: 300, width: 200, height: 100, text: "c" },
        { id: "s", type: "text", x: 250, y: 55, width: 100, height: 60, text: "s" },
        { id: "d", type: "text", x: 400, y: 300, width: 200, height: 100, text: "d" },
        { id: "e", type: "text", x: 450, y: 320, width: 200, height: 100, text: "e" },
      ],
      edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", toEnd: "arrow" }],
    });
  }

  function open() {
    const made = mounted(board());
    const viewport = made.host.querySelector<HTMLElement>(".canvas-viewport")!;
    return { ...made, viewport };
  }

  const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const body = (host: HTMLElement, id: string) => card(host, id).querySelector<HTMLElement>(".canvas-card-body")!;
  const port = (host: HTMLElement, id: string, side: string) =>
    card(host, id).querySelector<HTMLElement>(`:scope > .canvas-port[data-side="${side}"]`)!;
  const doc = (engine: CanvasEngine) => readCanvas(engine.getDoc());

  /** Il punto dello schermo di un punto della lavagna, dalla camera di adesso. */
  function screen(host: HTMLElement, x: number, y: number): { clientX: number; clientY: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const [, tx, ty, zoom] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(transform) ?? [];
    return { clientX: x * Number(zoom ?? 1) + Number(tx ?? 0), clientY: y * Number(zoom ?? 1) + Number(ty ?? 0) };
  }

  function pointer(target: EventTarget, type: string, at: { clientX: number; clientY: number }, init: PointerEventInit = {}): PointerEvent {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse", ...at, ...init });
    target.dispatchEvent(event);
    return event;
  }

  /** Un clic sul punto `at` di `target`. */
  function click(host: HTMLElement, target: EventTarget, at: { clientX: number; clientY: number }, init: PointerEventInit = {}): void {
    pointer(target, "pointerdown", at, init);
    pointer(host.querySelector(".canvas-viewport")!, "pointerup", at, init);
  }

  /** Tira un filo da `from` (un punto, una presa, o Alt sul corpo) fino a `to`, dove sotto il puntatore c'è `under`. */
  function pull(
    host: HTMLElement,
    from: EventTarget,
    start: { clientX: number; clientY: number },
    to: { clientX: number; clientY: number },
    under: Element | null,
    init: PointerEventInit = {},
  ): void {
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(under);
    try {
      pointer(from, "pointerdown", start, init);
      pointer(viewport, "pointermove", to, init);
      pointer(viewport, "pointerup", to, init);
    } finally {
      pointing.mockRestore();
    }
  }

  const patchesOf = (change: CanvasChange): readonly CanvasPatch[] => (change.operation as CanvasOperation).patches ?? [];
  const last = <T,>(list: readonly T[]): T => list[list.length - 1]!;

  it("quattro punti sui lati; si tira da un punto e si rilascia su qualsiasi parte di un'altra scheda, il lato lo sceglie Fub", () => {
    const { engine, host, viewport, changes } = open();
    expect([...card(host, "a").querySelectorAll<HTMLElement>(":scope > .canvas-port")].map((one) => one.dataset.side))
      .toEqual(["top", "right", "bottom", "left"]);
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(body(host, "c"));
    pointer(port(host, "a", "bottom"), "pointerdown", screen(host, 100, 100));
    pointer(viewport, "pointermove", screen(host, 150, 380));
    // Durante il tiro: il tratto fino al lato che Fub sceglierà, la scheda
    // bersaglio segnata, niente ancora nel file.
    expect(host.querySelector(".canvas-edge-draft")?.getAttribute("d")).toBe("M 100 100 C 100 100, 100 300, 100 300");
    expect(card(host, "c").hasAttribute("data-connect-target")).toBe(true);
    expect(changes).toHaveLength(0);
    pointer(viewport, "pointerup", screen(host, 150, 380));
    pointing.mockRestore();
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "a", fromSide: "bottom", toNode: "c", toSide: "top", toEnd: "arrow" });
    expect(changes).toHaveLength(1);
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    expect(card(host, "c").hasAttribute("data-connect-target")).toBe(false);

    // Due schede sovrapposte: il bersaglio è quella sopra (lo dà `elementFromPoint`).
    pull(host, port(host, "b", "bottom"), screen(host, 500, 100), screen(host, 520, 340), card(host, "e"));
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "b", toNode: "e", fromSide: "bottom", toSide: "top" });
    expect(changes).toHaveLength(2);

    // Sulla scheda da cui parte non nasce niente.
    pull(host, port(host, "a", "right"), screen(host, 200, 50), screen(host, 120, 60), card(host, "a"));
    expect(changes).toHaveLength(2);
    engine.destroy();
  });

  it("rilasciato nel vuoto nasce una scheda di testo collegata, già in scrittura, e un solo annulla toglie scheda e filo", () => {
    const { engine, host, viewport, changes } = open();
    const before = engine.getDoc();
    pull(host, port(host, "b", "right"), screen(host, 600, 50), screen(host, 900, 60), viewport);
    expect(changes).toHaveLength(1);
    expect(patchesOf(changes[0]!).map((patch) => patch.kind)).toEqual(["upsert-node", "upsert-edge"]);
    const after = doc(engine);
    const made = after.nodes.find((node) => !["a", "b", "c", "s", "d", "e"].includes(node.id))!;
    expect(made).toMatchObject({ type: "text", width: 320, height: 160 });
    // Il lato sinistro, verso `b`, cade sotto il puntatore (alla griglia).
    expect(Math.abs(made.x - 900)).toBeLessThanOrEqual(8);
    expect(Math.abs(made.y + made.height / 2 - 60)).toBeLessThanOrEqual(8);
    expect(after.edges.find((edge) => edge.toNode === made.id)).toMatchObject({ fromNode: "b", fromSide: "right", toSide: "left" });
    expect(host.querySelector(".canvas-text-editor")).not.toBeNull();
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);

    // Un clic fermo su un punto non fa una scheda.
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(viewport);
    click(host, port(host, "a", "top"), screen(host, 100, 0));
    pointing.mockRestore();
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("Esc durante il tiro annulla tutto: niente tratto, niente filo, niente scheda", () => {
    const { engine, host, viewport, changes } = open();
    const before = engine.getDoc();
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(viewport);
    pointer(port(host, "a", "bottom"), "pointerdown", screen(host, 100, 100));
    pointer(viewport, "pointermove", screen(host, 100, 600));
    expect(host.querySelector(".canvas-edge-draft")).not.toBeNull();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    viewport.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    pointer(viewport, "pointerup", screen(host, 100, 600));
    pointing.mockRestore();
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("Alt+trascina dal corpo di una scheda tira un filo; nel vuoto Alt sposta ancora la vista", () => {
    const { engine, host, viewport } = open();
    pull(host, body(host, "a"), screen(host, 100, 60), screen(host, 100, 350), card(host, "c"), { altKey: true });
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "a", fromSide: "bottom", toNode: "c", toSide: "top" });
    const edges = doc(engine).edges.length;
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const camera = stage.style.transform;
    pointer(viewport, "pointerdown", { clientX: 900, clientY: 900 }, { altKey: true, pointerId: 8 });
    pointer(viewport, "pointermove", { clientX: 940, clientY: 920 }, { altKey: true, pointerId: 8 });
    pointer(viewport, "pointerup", { clientX: 940, clientY: 920 }, { altKey: true, pointerId: 8 });
    expect(stage.style.transform).not.toBe(camera);
    expect(doc(engine).edges).toHaveLength(edges);
    engine.destroy();
  });

  it("C con due schede scelte le collega; con una comincia il collegamento", () => {
    const { engine, host, viewport } = open();
    click(host, body(host, "a"), screen(host, 100, 30));
    click(host, body(host, "c"), screen(host, 100, 350), { shiftKey: true });
    viewport.focus();
    const c = new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true });
    viewport.dispatchEvent(c);
    expect(c.defaultPrevented).toBe(true);
    expect(last(doc(engine).edges)).toMatchObject({ fromNode: "a", fromSide: "bottom", toNode: "c", toSide: "top", toEnd: "arrow" });
    expect(viewport.dataset.tool).toBe("select");

    click(host, body(host, "b"), screen(host, 500, 30));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));
    expect(viewport.dataset.tool).toBe("connect");
    engine.destroy();
  });

  it("riattaccare: su un'altra scheda l'estremità cambia scheda e lato; nel vuoto torna dov'era, niente cancellato", () => {
    const { engine, host, viewport, changes } = open();
    const handle = () => host.querySelector<SVGElement>('[data-reconnect="e1"][data-endpoint="to"]');
    click(host, viewport, screen(host, 300, 45));
    expect(handle()).not.toBeNull();
    const before = engine.getDoc();
    pull(host, handle()!, screen(host, 400, 50), screen(host, 800, 700), viewport);
    expect(engine.getDoc()).toBe(before);
    expect(changes).toHaveLength(0);
    click(host, viewport, screen(host, 300, 45));
    pull(host, handle()!, screen(host, 400, 50), screen(host, 100, 380), card(host, "c"));
    expect(doc(engine).edges).toHaveLength(1);
    expect(doc(engine).edges[0]).toMatchObject({ id: "e1", fromNode: "a", fromSide: "right", toNode: "c", toSide: "top" });
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("le prese del filo scelto stanno sopra le schede: un livello dopo lo stage, e il riattacco non nasce da un punto (T91)", async () => {
    const { engine, host, viewport, changes } = open();
    click(host, viewport, screen(host, 300, 45));
    const handle = host.querySelector<SVGElement>('[data-reconnect="e1"][data-endpoint="to"]')!;
    // Le prese non stanno nello stage (dove i punti delle schede le coprono): sono un livello dopo di lui.
    const layer = handle.closest(".canvas-edge-handles");
    const stage = host.querySelector(".canvas-stage")!;
    expect(layer).not.toBeNull();
    expect(stage.contains(handle)).toBe(false);
    expect(stage.compareDocumentPosition(layer!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const structure = (await import("../../theme/scrittoio/structure.css?raw")).default;
    expect(structure).toMatch(/\.canvas-edge-reconnect\s*\{\s*pointer-events:\s*auto;/);
    // Trascinata su «c», la presa riattacca il filo: un commit, nessun filo nuovo, e l'annulla lo riporta.
    const before = engine.getDoc();
    pull(host, handle, screen(host, 400, 50), screen(host, 100, 380), card(host, "c"));
    expect(doc(engine).edges).toHaveLength(1);
    expect(doc(engine).edges[0]).toMatchObject({ id: "e1", fromNode: "a", toNode: "c" });
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("i fili stanno nello stage, prima di ogni scheda: un gruppo sta sotto il filo, le schede sopra (T91)", async () => {
    const grouped = JSON.stringify({
      nodes: [
        { id: "g", type: "group", x: 150, y: -20, width: 300, height: 140, label: "Gruppo" },
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "a" },
        { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "b" },
      ],
      edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", toEnd: "arrow" }],
    });
    const { engine, host } = mounted(grouped);
    const stage = host.querySelector(".canvas-stage")!;
    const edges = host.querySelector(".canvas-edges")!;
    // Il livello dei fili è il primo figlio dello stage: ogni scheda gli sta sopra nell'ordine del DOM.
    expect(stage.firstElementChild).toBe(edges);
    expect(host.querySelector('.canvas-node[data-node="g"]')!.classList.contains("canvas-node-group")).toBe(true);
    // Scegliere una scheda ricompone lo stage: il filo resta il primo.
    click(host, body(host, "b"), screen(host, 500, 30));
    expect(card(host, "b").classList.contains("selected")).toBe(true);
    expect(stage.firstElementChild).toBe(edges);
    // Il gruppo va sotto i fili (z-index negativo), le schede no: lo dice la pelle della struttura.
    const structure = (await import("../../theme/scrittoio/structure.css?raw")).default;
    expect(structure).toMatch(/\.canvas-node-group\s*\{\s*z-index:\s*-1;/);
    engine.destroy();
  });

  it("un filo si prende entro 8 px e si scurisce al passaggio; sopra una scheda vince dove si vede; Canc lo toglie con la patch `at`", () => {
    const { engine, host, viewport, changes } = open();
    const line = () => host.querySelector<SVGElement>('.canvas-edge-line[data-edge="e1"]')!;
    const group = () => line().parentElement!;
    // Il passaggio: entro 8 px il filo si scurisce, fuori no.
    pointer(viewport, "pointermove", screen(host, 300, 43));
    expect(group().hasAttribute("data-hover")).toBe(true);
    pointer(viewport, "pointermove", screen(host, 300, 30));
    expect(group().hasAttribute("data-hover")).toBe(false);
    // A 10 px non si prende.
    click(host, viewport, screen(host, 300, 40));
    expect(line().classList.contains("selected")).toBe(false);
    // Sopra `s`, a 7 px dal filo che lì si vede (fuori da `s`): il filo.
    click(host, body(host, "s"), screen(host, 300, 57));
    expect(line().classList.contains("selected")).toBe(true);
    expect(card(host, "s").classList.contains("selected")).toBe(false);
    // Più giù su `s`, fuori dagli 8 px: la scheda.
    click(host, body(host, "s"), screen(host, 300, 80));
    expect(card(host, "s").classList.contains("selected")).toBe(true);
    expect(line().classList.contains("selected")).toBe(false);
    // Entro 8 px nel vuoto: il filo; Canc lo toglie con `at`, Ctrl+Z lo rimette lì.
    click(host, viewport, screen(host, 220, 44));
    expect(line().classList.contains("selected")).toBe(true);
    const before = engine.getDoc();
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(patchesOf(last(changes))).toEqual([expect.objectContaining({ kind: "remove-edge", at: 0, after: null })]);
    expect(doc(engine).edges).toHaveLength(0);
    expect(doc(engine).nodes).toHaveLength(6);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("in sola lettura niente punti né prese, Alt non collega, ma i fili si scelgono per leggerli", () => {
    const { engine, host, viewport, changes } = open();
    engine.setReadOnly(true);
    expect(host.querySelector(".canvas-port")).toBeNull();
    click(host, viewport, screen(host, 300, 45));
    expect(host.querySelector('.canvas-edge-line[data-edge="e1"]')!.classList.contains("selected")).toBe(true);
    expect(host.querySelector("[data-reconnect]")).toBeNull();
    pull(host, body(host, "a"), screen(host, 100, 60), screen(host, 100, 350), card(host, "c"), { altKey: true });
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    expect(changes).toHaveLength(0);
    engine.setReadOnly(false);
    expect(card(host, "a").querySelectorAll(":scope > .canvas-port")).toHaveLength(4);
    engine.destroy();
  });

  it("la penna scrive, non collega: da un punto non tira un filo", () => {
    const { engine, host, changes } = open();
    pull(host, port(host, "a", "bottom"), screen(host, 100, 100), screen(host, 100, 350), card(host, "c"), { pointerType: "pen" });
    expect(host.querySelector(".canvas-edge-draft")).toBeNull();
    expect(doc(engine).edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(changes.filter((change) => patchesOf(change).some((patch) => patch.kind === "upsert-edge"))).toHaveLength(0);
    engine.destroy();
  });
});

// Le maniglie per ridimensionare (T66): quattro angoli, Maiusc e Alt, la
// presa a ogni zoom e del dito, il doppio clic che adatta al contenuto, la
// cornice di più schede scelte; ogni gesto è un commit e un annulla.
describe("le maniglie delle schede (T66)", () => {
  const INK_STROKE = {
    id: "s-1", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 },
    ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  function board(): string {
    return JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "una nota", "fub:ink": { v: 1, strokes: [INK_STROKE] } },
        { id: "f", type: "file", x: 400, y: 40, width: 240, height: 140, file: "allegati/foto.png" },
        { id: "w", type: "link", x: 400, y: 240, width: 240, height: 100, url: "https://example.com/x" },
        { id: "p", type: "text", x: 40, y: 400, width: 40, height: 40, text: "." },
      ],
      edges: [],
    });
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const stageOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-stage")!;
  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const handle = (host: HTMLElement, id: string, corner: string): HTMLElement =>
    card(host, id).querySelector<HTMLElement>(`.canvas-resize[data-corner="${corner}"]`)!;

  function zoomOf(host: HTMLElement): number {
    const match = /scale\(([\d.e+-]+)\)/.exec(stageOf(host).style.transform);
    if (!match) throw new Error("niente zoom");
    return Number(match[1]);
  }

  function nodeOf(engine: CanvasEngine, id: string): CanvasDocument["nodes"][number] {
    return readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;
  }

  function boxOf(engine: CanvasEngine, id: string): [number, number, number, number] {
    const node = nodeOf(engine, id);
    return [node.x, node.y, node.width, node.height];
  }

  /** Tira `grip` di `(dx, dy)` unità della lavagna, coi tasti `keys` tenuti giù. */
  function pull(host: HTMLElement, grip: HTMLElement, dx: number, dy: number, keys: { shiftKey?: boolean; altKey?: boolean } = {}): void {
    const zoom = zoomOf(host);
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", clientX: 100, clientY: 100, ...keys }));
    const at = { clientX: 100 + dx * zoom, clientY: 100 + dy * zoom };
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, pointerId: 7, pointerType: "mouse", ...at, ...keys }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "mouse", ...at, ...keys }));
  }

  function choose(host: HTMLElement, id: string): void {
    card(host, id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function chooseAll(host: HTMLElement): void {
    const viewport = viewportOf(host);
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
  }

  function zoomKey(host: HTMLElement, key: "+" | "-"): void {
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }));
  }

  it("ogni scheda ha quattro maniglie agli angoli, in sola lettura nessuna", () => {
    const { engine, host } = mounted(board());
    for (const id of ["t", "f", "w", "p"]) {
      const grips = [...card(host, id).querySelectorAll<HTMLElement>(".canvas-resize")];
      expect(grips.map((grip) => grip.dataset.corner)).toEqual(["se", "sw", "ne", "nw"]);
      for (const grip of grips) expect(grip.dataset.resize).toBe(id);
    }
    engine.setReadOnly(true);
    expect(host.querySelector(".canvas-resize")).toBeNull();
    engine.setReadOnly(false);
    expect(host.querySelectorAll(".canvas-resize")).toHaveLength(16);
    engine.destroy();
  });

  it.each([
    ["se", 48, 36, [40, 40, 288, 176]],
    ["sw", -48, 36, [-8, 40, 288, 176]],
    ["ne", 48, -36, [40, 4, 288, 176]],
    ["nw", -48, -36, [-8, 4, 288, 176]],
  ] as const)("la maniglia %s tira il suo angolo e l'opposto resta fermo, un commit e un annulla", (corner, dx, dy, expected) => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    choose(host, "t");
    pull(host, handle(host, "t", corner), dx, dy);
    expect(boxOf(engine, "t")).toEqual(expected);
    expect(changes).toHaveLength(1);
    // L'inchiostro attaccato resta nella scheda, e la segue.
    expect(nodeOf(engine, "t")["fub:ink"]).toEqual({ v: 1, strokes: [INK_STROKE] });
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("Maiusc tiene le proporzioni, Alt ridimensiona dal centro, e tutti e due insieme", () => {
    const { engine, host } = mounted(board());
    choose(host, "t");
    pull(host, handle(host, "t", "se"), 120, 0, { shiftKey: true });
    expect(boxOf(engine, "t")).toEqual([40, 40, 360, 210]);
    engine.undo();
    pull(host, handle(host, "t", "se"), 24, 20, { altKey: true });
    // 240 + 2·24 = 288; 140 + 2·20 = 180. Alt spegne l'aggancio (T71), quindi
    // niente griglia sull'altezza; il centro resta.
    expect(boxOf(engine, "t")).toEqual([16, 20, 288, 180]);
    engine.undo();
    pull(host, handle(host, "t", "se"), 60, 0, { shiftKey: true, altKey: true });
    expect(boxOf(engine, "t")).toEqual([-20, 5, 360, 210]);
    engine.destroy();
  });

  it("non scende sotto il minimo di una scheda", () => {
    const { engine, host } = mounted(board());
    choose(host, "t");
    pull(host, handle(host, "t", "nw"), 1000, 1000);
    expect(boxOf(engine, "t")).toEqual([240, 140, 40, 40]);
    engine.destroy();
  });

  it("l'area di presa è di 20 px sullo schermo a ogni zoom: la lavagna dice lo zoom alla pelle", async () => {
    const { engine, host } = mounted(board());
    const stage = stageOf(host);
    expect(stage.style.getPropertyValue("--canvas-zoom")).toBe(String(zoomOf(host)));
    const first = zoomOf(host);
    zoomKey(host, "-");
    expect(zoomOf(host)).not.toBe(first);
    expect(stage.style.getPropertyValue("--canvas-zoom")).toBe(String(zoomOf(host)));
    const structure = (await import("../../theme/scrittoio/structure.css?raw")).default;
    expect(structure).toContain("width: calc(20px / var(--canvas-zoom, 1));");
    expect(structure).toContain("height: calc(20px / var(--canvas-zoom, 1));");
    engine.destroy();
  });

  it("una scheda piccolissima sullo schermo tiene solo la maniglia in basso a destra", () => {
    const { engine, host } = mounted(board());
    for (let i = 0; i < 20 && zoomOf(host) * 40 >= 24; i++) zoomKey(host, "-");
    expect(zoomOf(host) * 40).toBeLessThan(24);
    expect(card(host, "p").dataset.handles).toBe("one");
    expect(card(host, "t").dataset.handles).toBeUndefined();
    for (let i = 0; i < 40 && zoomOf(host) * 40 < 24; i++) zoomKey(host, "+");
    expect(card(host, "p").dataset.handles).toBeUndefined();
    engine.destroy();
  });

  it("col dito l'angolo della scheda scelta si prende entro 22 px, più in là no", () => {
    const { engine, host, changes } = mounted(board());
    choose(host, "t");
    const zoom = zoomOf(host);
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(stageOf(host).style.transform)!;
    const corner = { x: Number(match[1]) + (40 + 240) * zoom, y: Number(match[2]) + (40 + 140) * zoom };
    const touch = (type: string, x: number, y: number, pointerId: number) =>
      viewportOf(host).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId, pointerType: "touch", clientX: x, clientY: y }));
    // A 30 px dall'angolo il dito sposta la lavagna, la scheda resta.
    touch("pointerdown", corner.x + 30, corner.y + 30, 11);
    touch("pointermove", corner.x + 30 + 40 * zoom, corner.y + 30, 11);
    touch("pointerup", corner.x + 30 + 40 * zoom, corner.y + 30, 11);
    expect(boxOf(engine, "t")).toEqual([40, 40, 240, 140]);
    expect(changes).toHaveLength(0);
    // A 20 px la prende: la camera si è mossa, l'angolo con lei.
    const moved = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(stageOf(host).style.transform)!;
    const grip = { x: Number(moved[1]) + (40 + 240) * zoom + 20, y: Number(moved[2]) + (40 + 140) * zoom + 20 };
    touch("pointerdown", grip.x, grip.y, 12);
    touch("pointermove", grip.x + 48 * zoom, grip.y + 36 * zoom, 12);
    touch("pointerup", grip.x + 48 * zoom, grip.y + 36 * zoom, 12);
    expect(boxOf(engine, "t")).toEqual([40, 40, 288, 176]);
    expect(changes).toHaveLength(1);
    engine.destroy();
  });

  it("più schede scelte: la cornice della scelta scala tutto, l'inchiostro attaccato segue, un annulla", () => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    chooseAll(host);
    expect(stageOf(host).dataset.selection).toBe("many");
    const frame = host.querySelector<HTMLElement>(".canvas-selection-frame")!;
    expect(frame.parentElement).toBe(stageOf(host));
    expect(frame.querySelectorAll(".canvas-resize[data-resize-frame]")).toHaveLength(4);
    // La scelta va da (40, 40) a (640, 440): 600 × 400.
    expect([frame.style.transform, frame.style.width, frame.style.height]).toEqual(["translate(40px, 40px)", "600px", "400px"]);
    pull(host, frame.querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!, 600, 400);
    // Tutto raddoppia dall'angolo in alto a sinistra della scelta.
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 280]);
    expect(boxOf(engine, "f")).toEqual([760, 40, 480, 280]);
    expect(boxOf(engine, "w")).toEqual([760, 440, 480, 200]);
    expect(boxOf(engine, "p")).toEqual([40, 760, 80, 80]);
    expect(nodeOf(engine, "t")["fub:ink"]).toEqual({ v: 1, strokes: [INK_STROKE] });
    expect(changes).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".canvas-selection-frame")!.style.width).toBe("1200px");
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    // Una scheda sola: niente cornice.
    choose(host, "t");
    expect(stageOf(host).dataset.selection).toBe("many");
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    choose(host, "t");
    expect(stageOf(host).dataset.selection).toBeUndefined();
    expect(host.querySelector(".canvas-selection-frame")).toBeNull();
    engine.destroy();
  });

  it("la cornice non lascia una scheda sotto il minimo", () => {
    const { engine, host } = mounted(board());
    chooseAll(host);
    pull(host, host.querySelector<HTMLElement>('.canvas-selection-frame .canvas-resize[data-corner="se"]')!, -2000, -2000);
    for (const id of ["t", "f", "w", "p"]) {
      const node = nodeOf(engine, id);
      expect(node.width, id).toBeGreaterThanOrEqual(40);
      expect(node.height, id).toBeGreaterThanOrEqual(40);
    }
    expect(boxOf(engine, "p").slice(2)).toEqual([40, 40]);
    engine.destroy();
  });

  it("doppio clic su una maniglia: la scheda di testo prende la misura del testo, fino a 480 px", () => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    const article = card(host, "t");
    const body = article.querySelector<HTMLElement>(".canvas-card-body")!;
    // Un'impaginazione finta: il testo vuole 620 px su una riga, a 480 va su
    // più righe e chiede 150 px; la testata è di 28.
    let natural = 620;
    let lines = 150;
    Object.defineProperty(article, "offsetWidth", { configurable: true, get: () => article.style.width === "max-content" ? natural : parseFloat(article.style.width) });
    Object.defineProperty(article, "offsetHeight", { configurable: true, get: () => parseFloat(article.style.height) || 0 });
    Object.defineProperty(body, "offsetHeight", { configurable: true, get: () => Math.max(0, (parseFloat(article.style.height) || 0) - 28) });
    Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => lines });
    handle(host, "t", "ne").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "t")).toEqual([40, 40, 480, 184]);
    expect(changes).toHaveLength(1);
    // Lo stile della scheda è quello della misura nuova, non della misura.
    expect([article.style.width, article.style.height]).toEqual(["480px", "184px"]);
    // Il doppio clic sulla maniglia non apre il campo.
    expect(host.querySelector(".canvas-text-editor, .canvas-field-editor")).toBeNull();
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    // Un testo corto: la sua larghezza, agganciata per eccesso.
    natural = 130;
    lines = 60;
    handle(host, "t", "se").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "t")).toEqual([40, 40, 136, 88]);
    engine.destroy();
  });

  it("doppio clic su una maniglia: un'immagine prende le proporzioni del contenuto alla larghezza di adesso; le altre non cambiano", () => {
    const { engine, host, changes } = mounted(board());
    const before = engine.getDoc();
    const picture = document.createElement("img");
    Object.defineProperty(picture, "naturalWidth", { value: 400 });
    Object.defineProperty(picture, "naturalHeight", { value: 300 });
    card(host, "f").querySelector(".canvas-card-body")!.append(picture);
    handle(host, "f", "sw").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "f")).toEqual([400, 40, 240, 180]);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    // Come in Chromium: la maniglia presa e lasciata cattura il puntatore, e
    // il doppio clic arriva alla vista. Adatta lo stesso, senza nuove schede.
    for (let i = 0; i < 2; i++) pull(host, handle(host, "f", "se"), 0, 0);
    viewportOf(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(boxOf(engine, "f")).toEqual([400, 40, 240, 180]);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(engine.undo()).toBe(true);
    // Una pagina web non ha una misura sua: niente cambia.
    const count = changes.length;
    handle(host, "w", "se").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(changes).toHaveLength(count);
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });
});

// --- muoversi (T53) --------------------------------------------------------------

describe("CanvasEngine: spostare e ingrandire (T53)", () => {
  /** I fotogrammi in attesa, che la prova fa girare a mano con un orologio suo. */
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let now = 0;

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    setReducedMotionPreference(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Fa girare `count` fotogrammi da `dt` ms (o finché ce ne sono). */
  function runFrames(count = 1, dt = 16): void {
    for (let i = 0; i < count && frames.size > 0; i++) {
      now += dt;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(now);
    }
  }

  /** Fa girare i fotogrammi finché la vista non si ferma (al più `limit`); dà quanti ne sono girati. */
  function settle(limit = 600): number {
    let count = 0;
    while (frames.size > 0 && count < limit) {
      runFrames(1);
      count++;
    }
    return count;
  }

  function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
    if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;

  /** La vista misura 800 × 600 a partire da (0, 0): happy-dom non dispone niente. */
  function sized(host: HTMLElement): void {
    vi.spyOn(viewportOf(host), "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
  }

  function key(target: EventTarget, init: KeyboardEventInit, type: "keydown" | "keyup" = "keydown"): KeyboardEvent {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  function pointer(target: EventTarget, type: string, init: PointerEventInit & { timeStamp?: number }): PointerEvent {
    const { timeStamp, ...rest } = init;
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 5, pointerType: "mouse", ...rest });
    if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
    target.dispatchEvent(event);
    return event;
  }

  /** Un trascinamento da `from` (premuto su `target`) a `to`, lasciato lì se `release`. */
  function drag(
    host: HTMLElement,
    target: EventTarget,
    from: { x: number; y: number },
    to: { x: number; y: number },
    init: PointerEventInit = {},
    release = true,
  ): void {
    pointer(target, "pointerdown", { clientX: from.x, clientY: from.y, ...init });
    pointer(viewportOf(host), "pointermove", { clientX: to.x, clientY: to.y, ...init });
    if (release) pointer(viewportOf(host), "pointerup", { clientX: to.x, clientY: to.y, ...init });
  }

  it("lo zoom va dal 5% al 400%; + e − a passi di 1,25, come nel disegno", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    viewport.focus();
    const start = cameraOf(host).zoom;
    key(viewport, { key: "+" });
    expect(cameraOf(host).zoom).toBeCloseTo(start * CANVAS_ZOOM_STEP, 9);
    key(viewport, { key: "-" });
    expect(cameraOf(host).zoom).toBeCloseTo(start, 9);
    for (let i = 0; i < 40; i++) key(viewport, { key: "+" });
    expect(cameraOf(host).zoom).toBe(4);
    for (let i = 0; i < 60; i++) key(viewport, { key: "-" });
    expect(cameraOf(host).zoom).toBe(0.05);
    // Il passo non vola: nessun fotogramma.
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("0 porta al 100% sul centro della vista, in volo; col movimento ridotto subito", () => {
    const { engine, host } = mounted();
    sized(host);
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    const center = { x: (400 - start.x) / start.zoom, y: (300 - start.y) / start.zoom };
    key(viewport, { key: "0", code: "Digit0" });
    // Il primo fotogramma non è ancora arrivato: la vista vola.
    expect(cameraOf(host)).toEqual(start);
    expect(frames.size).toBe(1);
    runFrames(1);
    const between = cameraOf(host).zoom;
    expect(between).toBeGreaterThan(start.zoom);
    expect(between).toBeLessThan(1);
    settle();
    const end = cameraOf(host);
    expect(end.zoom).toBeCloseTo(1, 6);
    expect((400 - end.x) / end.zoom).toBeCloseTo(center.x, 3);
    expect((300 - end.y) / end.zoom).toBeCloseTo(center.y, 3);
    expect(frames.size).toBe(0);
    // Col movimento ridotto: dopo + il salto arriva subito, senza fotogrammi.
    key(viewport, { key: "+" });
    setReducedMotionPreference(true);
    key(viewport, { key: "0", code: "Digit0" });
    expect(cameraOf(host).zoom).toBe(1);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("Maiusc+1 mostra tutto e Maiusc+2 la selezione, in volo; Maiusc+2 senza selezione non fa niente", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const all = cameraOf(host);
    key(viewport, { key: "+" });
    key(viewport, { key: "+" });
    const zoomed = cameraOf(host);
    key(viewport, { key: "@", code: "Digit2", shiftKey: true });
    expect(cameraOf(host)).toEqual(zoomed);
    expect(frames.size).toBe(0);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(cameraOf(host)).toEqual(zoomed);
    settle();
    const back = cameraOf(host);
    expect(back.zoom).toBeCloseTo(all.zoom, 6);
    expect(back.x).toBeCloseTo(all.x, 3);
    expect(back.y).toBeCloseTo(all.y, 3);
    // Una sola scheda scelta: Maiusc+2 la inquadra, al più al 100%.
    pointer(card(host, "t"), "pointerdown", { clientX: 10, clientY: 10 });
    pointer(viewport, "pointerup", { clientX: 10, clientY: 10 });
    key(viewport, { key: "@", code: "Digit2", shiftKey: true });
    expect(frames.size).toBe(1);
    settle();
    const one = cameraOf(host);
    expect(one.zoom).toBe(1);
    // La scheda `t` (40, 40, 240 × 140) sta al centro della vista di riserva, 800 × 600.
    expect(one.x + 160 * one.zoom).toBeCloseTo(400, 3);
    expect(one.y + 110 * one.zoom).toBeCloseTo(300, 3);
    // Col movimento ridotto il salto non vola.
    setReducedMotionPreference(true);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(frames.size).toBe(0);
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    engine.destroy();
  });

  it("Spazio tenuto e trascina sposta la vista con ogni strumento, anche sopra una scheda", () => {
    const { engine, host, changes } = mounted();
    const viewport = viewportOf(host);
    for (const tool of CANVAS_TOOL_IDS) {
      engine.commands().find((command) => command.id === toolCommandId(tool))!.run();
      viewport.focus();
      const down = key(viewport, { key: " " });
      expect(down.defaultPrevented, tool).toBe(true);
      expect(viewport.hasAttribute("data-space-pan"), tool).toBe(true);
      // La ripetizione del tasto tiene la mano, e la pagina non scorre.
      expect(key(viewport, { key: " ", repeat: true }).defaultPrevented).toBe(true);
      const before = cameraOf(host);
      const handle = card(host, "t").querySelector(".canvas-node-handle")!;
      drag(host, handle, { x: 100, y: 100 }, { x: 160, y: 130 });
      const after = cameraOf(host);
      expect(after.x - before.x, tool).toBeCloseTo(60, 6);
      expect(after.y - before.y, tool).toBeCloseTo(30, 6);
      key(window, { key: " " }, "keyup");
      expect(viewport.hasAttribute("data-space-pan")).toBe(false);
    }
    // Niente si è mosso nel file: si spostava la vista.
    expect(changes).toHaveLength(0);
    expect(nodeOf(engine, "t").x).toBe(40);
    // Spazio lasciato, la testata torna a spostare la scheda.
    engine.commands().find((command) => command.id === "canvas.tool.select")!.run();
    const handle = card(host, "t").querySelector(".canvas-node-handle")!;
    drag(host, handle, { x: 100, y: 100 }, { x: 160, y: 100 });
    expect(nodeOf(engine, "t").x).toBeGreaterThan(40);
    engine.destroy();
  });

  it("mentre si scrive in una scheda Spazio è uno spazio", () => {
    const { engine, host } = mounted();
    const input = openField(host, "t");
    const event = press(input, " ");
    expect(event.defaultPrevented).toBe(false);
    expect(viewportOf(host).hasAttribute("data-space-pan")).toBe(false);
    engine.destroy();
  });

  it("Spazio con la penna giù non prende la vista: la penna ha la precedenza", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const target = card(host, "t");
    const cam = cameraOf(host);
    const at = (x: number, y: number) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
    const pen = { pointerId: 9, pointerType: "pen", buttons: 1, pressure: 0.5 } as const;
    pointer(target, "pointerdown", { ...pen, ...at(80, 80), timeStamp: 1 });
    pointer(target, "pointermove", { ...pen, ...at(100, 90), timeStamp: 9 });
    viewport.focus();
    const down = key(viewport, { key: " " });
    expect(down.defaultPrevented).toBe(true);
    expect(viewport.hasAttribute("data-space-pan")).toBe(false);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, pointerType: "pen", ...at(100, 90) }));
    engine.destroy();
  });

  it("il tasto centrale trascina e sposta, anche sopra una scheda, senza sceglierla", () => {
    const { engine, host } = mounted();
    const before = cameraOf(host);
    drag(host, card(host, "f"), { x: 300, y: 100 }, { x: 250, y: 140 }, { button: 1, buttons: 4 });
    const after = cameraOf(host);
    expect(after.x - before.x).toBeCloseTo(-50, 6);
    expect(after.y - before.y).toBeCloseTo(40, 6);
    expect(card(host, "f").classList.contains("selected")).toBe(false);
    expect(engine.getDoc()).toBe(canvasSource());
    engine.destroy();
  });

  it("la velocità al bordo: zero fuori dalla fascia, più veloce più si è vicini, la massima sul bordo e fuori", () => {
    expect(edgeScrollSpeed(EDGE_SCROLL_ZONE, 500)).toBe(0);
    expect(edgeScrollSpeed(300, 300)).toBe(0);
    expect(edgeScrollSpeed(500, 30)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(500, 5)).toBeGreaterThan(edgeScrollSpeed(500, 30));
    expect(edgeScrollSpeed(500, 0)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollSpeed(500, -200)).toBe(EDGE_SCROLL_MAX);
    expect(edgeScrollSpeed(10, 500)).toBeLessThan(0);
  });

  it("trascinando una scheda vicino al bordo la vista scorre e la scheda resta sotto il puntatore; il rilascio ferma tutto", () => {
    const { engine, host, changes } = mounted();
    sized(host);
    const start = cameraOf(host);
    const handle = card(host, "t").querySelector(".canvas-node-handle")!;
    // Lontano dal bordo niente scorre.
    drag(host, handle, { x: 100, y: 100 }, { x: 300, y: 300 }, {}, false);
    expect(frames.size).toBe(0);
    // A 5 px dal bordo destro: scorre.
    pointer(viewportOf(host), "pointermove", { clientX: 795, clientY: 300 });
    expect(frames.size).toBe(1);
    runFrames(1);
    const near = start.x - cameraOf(host).x;
    expect(near).toBeCloseTo(edgeScrollSpeed(795, 5) * 16, 6);
    expect(cameraOf(host).y).toBe(start.y);
    // Fuori dalla finestra: la velocità più alta.
    pointer(viewportOf(host), "pointermove", { clientX: 900, clientY: 300 });
    runFrames(1);
    expect(start.x - cameraOf(host).x - near).toBeCloseTo(EDGE_SCROLL_MAX * 16, 6);
    runFrames(10);
    const scrolled = start.x - cameraOf(host).x;
    pointer(viewportOf(host), "pointerup", { clientX: 900, clientY: 300 });
    expect(frames.size).toBe(0);
    runFrames(5);
    expect(start.x - cameraOf(host).x).toBe(scrolled);
    // La scheda è andata dove sta il puntatore sulla lavagna scorsa, in un passo.
    expect(changes).toHaveLength(1);
    const expected = 40 + (900 - 100 + scrolled) / start.zoom;
    expect(Math.abs(nodeOf(engine, "t").x - expected)).toBeLessThanOrEqual(4);
    engine.destroy();
  });

  it("lo scorrimento al bordo vale mentre si tira una maniglia o un filo, e si ferma con Esc e quando la finestra perde il fuoco", () => {
    const { engine, host } = mounted();
    sized(host);
    // La maniglia in basso a destra della scheda `t`, tirata verso il bordo in basso.
    pointer(card(host, "t"), "pointerdown", { clientX: 10, clientY: 10 });
    pointer(viewportOf(host), "pointerup", { clientX: 10, clientY: 10 });
    const grip = card(host, "t").querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!;
    const start = cameraOf(host);
    drag(host, grip, { x: 200, y: 200 }, { x: 400, y: 590 }, {}, false);
    expect(frames.size).toBe(1);
    runFrames(3);
    expect(cameraOf(host).y).toBeLessThan(start.y);
    // La finestra perde il fuoco: lo scorrimento si ferma.
    window.dispatchEvent(new Event("blur"));
    expect(frames.size).toBe(0);
    pointer(viewportOf(host), "pointerup", { clientX: 400, clientY: 590 });
    // Un filo con Alt dal corpo della scheda `f`, tirato verso il bordo sinistro.
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    const body = card(host, "f").querySelector<HTMLElement>(".canvas-card-body")!;
    const before = cameraOf(host);
    drag(host, body, { x: 500, y: 100 }, { x: 3, y: 300 }, { altKey: true, pointerId: 6 }, false);
    expect(frames.size).toBe(1);
    runFrames(2);
    expect(cameraOf(host).x).toBeGreaterThan(before.x);
    key(viewportOf(host), { key: "Escape" });
    runFrames(1);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("l'inerzia dopo uno spostamento col dito, con stepCamera; col movimento ridotto niente, anche cambiato a lavagna aperta", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    /** Un dito che scorre di 20 px ogni 10 ms verso destra, e si alza. */
    function swipe(pointerId: number, from: number): void {
      const finger = { pointerId, pointerType: "touch" };
      pointer(viewport, "pointerdown", { ...finger, clientX: from, clientY: 300, timeStamp: 0 });
      for (let i = 1; i <= 5; i++) pointer(viewport, "pointermove", { ...finger, clientX: from + 20 * i, clientY: 300, timeStamp: 10 * i });
      pointer(viewport, "pointerup", { ...finger, clientX: from + 100, clientY: 300, timeStamp: 50 });
    }
    const start = cameraOf(host);
    swipe(1, 100);
    const released = cameraOf(host);
    expect(released.x - start.x).toBeCloseTo(100, 6);
    expect(frames.size).toBe(1);
    const steps = settle();
    expect(steps).toBeGreaterThan(3);
    expect(frames.size).toBe(0);
    // Due px al ms per `INERTIA_MS`: la vista va avanti di circa 600 px.
    const glide = cameraOf(host).x - released.x;
    expect(glide).toBeGreaterThan(2 * INERTIA_MS * 0.9);
    expect(glide).toBeLessThan(2 * INERTIA_MS * 1.05);
    expect(cameraOf(host).y).toBeCloseTo(start.y, 6);
    // Un dito che si posa ferma l'inerzia.
    swipe(2, 100);
    runFrames(2);
    const caught = cameraOf(host);
    pointer(viewport, "pointerdown", { pointerId: 3, pointerType: "touch", clientX: 400, clientY: 300, timeStamp: 100 });
    expect(frames.size).toBe(0);
    expect(cameraOf(host)).toEqual(caught);
    pointer(viewport, "pointerup", { pointerId: 3, pointerType: "touch", clientX: 400, clientY: 300, timeStamp: 110 });
    // Il movimento ridotto cambiato a inerzia in corso la ferma subito.
    swipe(4, 100);
    expect(frames.size).toBe(1);
    setReducedMotionPreference(true);
    expect(frames.size).toBe(0);
    // E dopo, niente inerzia.
    swipe(5, 100);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("chiudere la lavagna ferma il volo", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    key(viewport, { key: "+" });
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(frames.size).toBe(1);
    engine.destroy();
    expect(frames.size).toBe(0);
  });

  // --- indietro e avanti (T56) ---

  it("Indietro e Avanti rifanno i salti (Maiusc+1), non lo zoom a passi", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const all = cameraOf(host);
    key(viewport, { key: "+" });
    const zoomed = cameraOf(host);
    // Lo zoom a passi non è un salto: la storia è ancora vuota.
    expect(engine.jumpBack()).toBe(false);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(engine.jumpBack()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(zoomed.zoom, 6);
    expect(cameraOf(host).x).toBeCloseTo(zoomed.x, 3);
    expect(cameraOf(host).y).toBeCloseTo(zoomed.y, 3);
    // Niente prima del salto: Indietro ora dice di no, e la cronologia del riquadro entra.
    expect(engine.jumpBack()).toBe(false);
    expect(engine.jumpForward()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(engine.jumpForward()).toBe(false);
    engine.destroy();
  });

  it("un clic nel navigatore è un salto, uno spostamento a mano no: Indietro torna prima del salto", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const navigator = host.querySelector<HTMLElement>(".canvas-navigator")!;
    // La mappa misura 168 × 120 da (0, 0): happy-dom non dispone niente.
    vi.spyOn(navigator, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 168, bottom: 120, width: 168, height: 120, toJSON: () => ({}),
    } as DOMRect);
    for (let i = 0; i < 4; i++) key(viewport, { key: "+" });
    settle();
    const zoomed = cameraOf(host);
    // Il clic sulla mappa vola: è un salto.
    const tap = (type: string): void => {
      navigator.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse", isPrimary: true, clientX: 150, clientY: 100,
      }));
    };
    tap("pointerdown");
    tap("pointerup");
    expect(frames.size).toBe(1);
    settle();
    const jumped = cameraOf(host);
    expect(jumped).not.toEqual(zoomed);
    // Lo spostamento a mano (il tasto centrale) non entra nella storia.
    drag(host, viewport, { x: 300, y: 300 }, { x: 350, y: 330 }, { button: 1, buttons: 4 });
    expect(cameraOf(host)).not.toEqual(jumped);
    // Indietro torna prima del salto, non al punto dove la mano ha lasciato la vista.
    expect(engine.jumpBack()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(zoomed.zoom, 6);
    expect(cameraOf(host).x).toBeCloseTo(zoomed.x, 3);
    expect(cameraOf(host).y).toBeCloseTo(zoomed.y, 3);
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("il salto dell'ispettore (`revealSource` «jump») entra in Indietro; quello della shell no; lo spostamento a mano non conta", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const doc = engine.getDoc();
    const byteOf = (id: string) => new TextEncoder().encode(doc.slice(0, doc.indexOf(`{"id":"${id}"`))).length;
    // Dalla shell (o all'apertura) la vista si mette sulla scheda, senza storia.
    expect(engine.revealSource(byteOf("t"))).toBe(true);
    expect(frames.size).toBe(0);
    expect(engine.jumpBack()).toBe(false);
    const framed = cameraOf(host);
    // Dall'ispettore è un salto: vola, e Indietro torna da dove si era.
    expect(engine.revealSource(byteOf("w"), "jump")).toBe(true);
    expect(frames.size).toBe(1);
    settle();
    expect(engine.selection().nodes).toEqual(["w"]);
    const jumped = cameraOf(host);
    expect(jumped).not.toEqual(framed);
    // Uno spostamento a mano dopo il salto non entra nella storia.
    drag(host, viewport, { x: 300, y: 300 }, { x: 350, y: 330 }, { button: 1, buttons: 4 });
    expect(cameraOf(host)).not.toEqual(jumped);
    expect(engine.jumpBack()).toBe(true);
    settle();
    expect(cameraOf(host).zoom).toBeCloseTo(framed.zoom, 6);
    expect(cameraOf(host).x).toBeCloseTo(framed.x, 3);
    expect(cameraOf(host).y).toBeCloseTo(framed.y, 3);
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("col movimento ridotto Indietro e Avanti arrivano subito, senza volo", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    const all = cameraOf(host);
    key(viewport, { key: "+" });
    const zoomed = cameraOf(host);
    setReducedMotionPreference(true);
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(engine.jumpBack()).toBe(true);
    expect(cameraOf(host)).toEqual(zoomed);
    expect(engine.jumpForward()).toBe(true);
    expect(cameraOf(host).zoom).toBeCloseTo(all.zoom, 6);
    expect(frames.size).toBe(0);
    engine.destroy();
  });

  it("una lavagna aperta ricomincia senza salti, e due lavagne hanno ciascuna la sua storia", () => {
    const first = mounted();
    const viewportFirst = viewportOf(first.host);
    key(viewportFirst, { key: "+" });
    key(viewportFirst, { key: "!", code: "Digit1", shiftKey: true });
    settle();
    const second = mounted();
    expect(second.engine.jumpBack()).toBe(false);
    expect(first.engine.jumpBack()).toBe(true);
    first.engine.destroy();
    second.engine.destroy();
  });

  it("a fine volo la banda di stato è avvisata, perché lo zoom è cambiato", () => {
    let statusChanges = 0;
    const { engine, host } = mounted(canvasSource(), {
      onStatusChange: () => {
        statusChanges++;
      },
    });
    const viewport = viewportOf(host);
    key(viewport, { key: "+" });
    const before = statusChanges;
    key(viewport, { key: "!", code: "Digit1", shiftKey: true });
    // Durante il volo la banda aspetta, come in ogni gesto.
    expect(statusChanges).toBe(before);
    settle();
    expect(statusChanges).toBeGreaterThan(before);
    engine.destroy();
  });
});

describe("CanvasEngine: spargi le pagine di un PDF (T72)", () => {
  /** Un PDF a sinistra (`p`), una nota più in basso (`t`). */
  const pdfBoard = () => JSON.stringify({
    nodes: [
      { id: "p", type: "file", x: 0, y: 0, width: 360, height: 480, file: "docs/manuale.pdf" },
      { id: "t", type: "text", x: 0, y: 600, width: 240, height: 140, text: "nota" },
    ],
    edges: [],
  });

  /** Il lettore delle pagine finto: `count` pagine (`null`: il PDF non si apre), misura 612×792. */
  function pdfPages(count: number | null) {
    return {
      count: vi.fn(async (_path: string) => count),
      sizes: vi.fn(async (_path: string, wanted: readonly number[]) => wanted.map(() => ({ width: 612, height: 792 }))),
    };
  }

  function open(count: number | null = 24, overrides: Partial<CanvasEngineOptions> = {}) {
    const pages = pdfPages(count);
    const watches: Array<{ path: string; changed: () => void; stop: ReturnType<typeof vi.fn> }> = [];
    const made = mounted(pdfBoard(), {
      cards: {
        registry: createCardRegistry([]),
        snapshots: new CardCache(),
        watch: (path, changed) => {
          const stop = vi.fn();
          watches.push({ path, changed, stop });
          return stop;
        },
        pdfPages: pages,
      },
      ...overrides,
    });
    return { ...made, pages, watches };
  }

  /** Sceglie la scheda `id` col tasto destro, come il gesto. */
  function choose(engine: CanvasEngine, host: HTMLElement, id = "p") {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`));
    try {
      return engine.contextMenu({ x: 10, y: 10 });
    } finally {
      pointing.mockRestore();
    }
  }

  function spreadCommand(engine: CanvasEngine) {
    return engine.commands().find((command) => command.id === "canvas.spread_pages")!;
  }

  function spread(engine: CanvasEngine): void {
    spreadCommand(engine).run();
  }

  /** Il dialogo aperto per ultimo. */
  function dialog(): HTMLElement {
    const all = document.querySelectorAll<HTMLElement>(".kit-dialog");
    return all[all.length - 1]!;
  }

  function dialogField(): HTMLInputElement {
    return dialog().querySelector<HTMLInputElement>(".kit-field-input")!;
  }

  function dialogNote(): string {
    return dialog().querySelector(".kit-dialog-body p")?.textContent ?? "";
  }

  function answer(action: "spread" | "cancel"): void {
    dialog().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  }

  /** Le schede nate dalle pagine (quelle con `subpath`, senza il gruppo). */
  function placed(engine: CanvasEngine) {
    return readCanvas(engine.getDoc()).nodes.filter((node) => node.subpath !== undefined);
  }

  it("chiede le pagine (di serie tutte) e mette una scheda per pagina accanto al PDF, con un gruppo oltre 12", async () => {
    const { engine, host, pages } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(24));
    expect(pages.count).toHaveBeenCalledWith("docs/manuale.pdf");
    expect(pages.sizes).toHaveBeenCalledWith("docs/manuale.pdf", Array.from({ length: 24 }, (_, index) => index + 1));
    const cards = placed(engine);
    expect(cards.map((node) => node.subpath)).toEqual(Array.from({ length: 24 }, (_, index) => `#page=${index + 1}`));
    expect(cards.every((node) => node.type === "file" && node.file === "docs/manuale.pdf")).toBe(true);
    // Le misure di nascita del PDF (T29): 360 di larghezza, l'altezza segue la pagina; in riga dopo il PDF.
    expect(cards[0]).toMatchObject({ x: 384, y: 0, width: 360, height: 466 });
    expect(cards[10]).toMatchObject({ x: 384, y: 496 });
    const group = readCanvas(engine.getDoc()).nodes.find((node) => node.type === "group");
    expect(group?.label).toBe(t("canvas.spread.group", { count: "24" }));
    engine.destroy();
  });

  it("un intervallo fa nascere solo le sue pagine, e sotto le 13 niente gruppo", async () => {
    const { engine, host } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    type(dialogField(), "3-7, 9");
    expect(dialogNote()).toBe(t("canvas.spread.count", { n: "6" }));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(6));
    expect(placed(engine).map((node) => node.subpath)).toEqual(["#page=3", "#page=4", "#page=5", "#page=6", "#page=7", "#page=9"]);
    expect(readCanvas(engine.getDoc()).nodes.some((node) => node.type === "group")).toBe(false);
    engine.destroy();
  });

  it("un intervallo oltre l'ultima pagina si taglia e si dice", async () => {
    const { engine, host } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    type(dialogField(), "20-40");
    expect(dialogNote()).toBe(t("canvas.spread.cut", { pages: "24", n: "5" }));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(5));
    expect(placed(engine).map((node) => node.subpath)).toEqual(["#page=20", "#page=21", "#page=22", "#page=23", "#page=24"]);
    engine.destroy();
  });

  it("un testo che non si legge non chiude il dialogo, e Annulla non tocca la lavagna", async () => {
    const { engine, host, changes } = open(24);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    type(dialogField(), "3-x");
    expect(dialogNote()).toBe(t("canvas.spread.bad", { text: "3-x" }));
    answer("spread");
    expect(document.querySelectorAll(".kit-dialog")).toHaveLength(1);
    expect(placed(engine)).toHaveLength(0);
    answer("cancel");
    expect(placed(engine)).toHaveLength(0);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("più di 200 schede chiede conferma: Annulla non fa nulla, Spargi le fa nascere", async () => {
    const { engine, host } = open(201);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-201"));
    answer("spread");
    await vi.waitFor(() => expect(dialog().querySelector(".kit-dialog-title")?.textContent).toBe(t("canvas.spread.confirm.title", { n: "201" })));
    answer("cancel");
    expect(placed(engine)).toHaveLength(0);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-201"));
    answer("spread");
    await vi.waitFor(() => expect(dialog().querySelector(".kit-dialog-title")?.textContent).toBe(t("canvas.spread.confirm.title", { n: "201" })));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(201));
    engine.destroy();
  }, 20_000);

  it("tutte le schede nate da «Spargi» tornano con un solo annulla", async () => {
    const { engine, host } = open(24);
    const before = readCanvas(engine.getDoc()).nodes.map((node) => node.id);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(dialogField().value).toBe("1-24"));
    answer("spread");
    await vi.waitFor(() => expect(placed(engine)).toHaveLength(24));
    engine.undo();
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.id)).toEqual(before);
    engine.destroy();
  });

  it("un PDF che non si apre lo dice, e la voce resta spenta finché il file non cambia", async () => {
    const { engine, host, watches } = open(null);
    choose(engine, host);
    spread(engine);
    await vi.waitFor(() => expect(host.querySelector(".canvas-intake-error")?.textContent).toContain(t("canvas.card.unreadable", { name: "manuale.pdf" })));
    expect(document.querySelector(".kit-dialog")).toBeNull();
    expect(spreadCommand(engine).disabled()).toBe(t("canvas.commands.why.pdf_unreadable"));
    expect(watches.map((watch) => watch.path)).toEqual(["docs/manuale.pdf"]);
    // Il file cambia: il comando torna acceso, e il suo ascolto si scioglie.
    watches[0]!.changed();
    expect(spreadCommand(engine).disabled()).toBeNull();
    expect(watches[0]!.stop).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("in sola lettura la voce è spenta col perché, e non apre niente", () => {
    const { engine, host, pages } = open(24);
    choose(engine, host);
    engine.setReadOnly(true);
    expect(spreadCommand(engine).disabled()).toBe(t("canvas.commands.why.read_only"));
    spread(engine);
    expect(pages.count).not.toHaveBeenCalled();
    expect(document.querySelector(".kit-dialog")).toBeNull();
    engine.destroy();
  });

  it("il menu del PDF ha «Spargi le pagine…» dopo «Apri a lato»; una nota non ce l'ha, e senza lettore è spenta", () => {
    const { engine, host } = open(24, { onOpenPathBeside: () => {} });
    const idsOf = (menu: ReturnType<CanvasEngine["contextMenu"]>) => (menu?.context ?? [])
      .filter((entry): entry is SurfaceMenuItem => typeof entry !== "string")
      .map((item) => item.id);
    expect(idsOf(choose(engine, host)).slice(0, 4)).toEqual(["canvas.open", "canvas.open_beside", "canvas.spread_pages", "canvas.connect"]);
    expect(idsOf(choose(engine, host, "t"))).not.toContain("canvas.spread_pages");
    expect(spreadCommand(engine).disabled()).toBe(t("canvas.commands.why.no_pdf"));
    engine.destroy();
    const bare = mounted(pdfBoard());
    choose(bare.engine, bare.host);
    expect(spreadCommand(bare.engine).disabled()).toBe(t("canvas.commands.why.no_pdf_reader"));
    bare.engine.destroy();
  });
});

describe("l'ispettore sul motore (T59)", () => {
  it("una modifica da «Avanzate» si annulla con gli stessi byte di prima", () => {
    const { engine } = mounted();
    const before = engine.getDoc();
    const byteOf = (needle: string) => new TextEncoder().encode(before.slice(0, before.indexOf(needle))).length;
    // Scegliere una scheda dal sorgente la sceglie anche per l'ispettore.
    expect(engine.revealSource(byteOf('{"id":"t"'))).toBe(true);
    expect(engine.selection()).toEqual({ nodes: ["t"], edges: [] });
    const inspector = createCanvasInspector({
      source: () => engine.getDoc(),
      reveal: () => false,
      edit: {
        selection: () => engine.selection(),
        doc: () => engine.doc(),
        commit: (patches) => engine.commitPatches(patches),
        readOnly: () => false,
      },
    });
    inspector.offer(true);
    const panel = inspector.panels.list().find((each) => each.id === CARD_PANEL_ID)!;
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = panel.mount(host);
    host.querySelector<HTMLButtonElement>(".canvas-inspector-disclosure")!.click();
    const x = [...host.querySelectorAll<HTMLTableRowElement>(".canvas-inspector-raw tr")]
      .find((row) => row.querySelector("th")?.textContent === "x")!
      .querySelector<HTMLInputElement>("input")!;
    x.value = "300";
    x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(engine.doc()!.nodes.find((node) => node.id === "t")!.x).toBe(300);
    expect(engine.getDoc()).not.toBe(before);
    // Un commit solo: un annulla riporta il testo di prima, byte per byte, e poi non ce n'è un altro.
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    expect(engine.undo()).toBe(false);
    unmount();
  });
});

describe("il selettore delle sezioni (T74)", () => {
  const NOTE = "Note/Relazione.md";
  const HEADINGS = [
    { level: 1, text: "Relazione" },
    { level: 2, text: "Scopo" },
    { level: 2, text: "Misure" },
    { level: 2, text: "Calcoli" },
  ];

  function setup(overrides: Partial<CanvasEngineOptions> = {}, headings = HEADINGS, paths = [NOTE]) {
    const outline = vi.fn(async (_path: string) => headings);
    const show = vi.fn(async (_path: string, heading: string | null, host: HTMLElement) => {
      host.textContent = heading ?? "";
    });
    const made = mounted(canvasSource(), {
      attachments: { deposit: vi.fn(), resolvePaths: async () => paths },
      parts: { outline, show },
      ...overrides,
    });
    return { ...made, outline, show };
  }

  function drop(host: HTMLElement, alt = false): void {
    const data = { files: [], items: [], types: [], getData: () => "" } as unknown as DataTransfer;
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: 200 }, clientY: { value: 120 }, altKey: { value: alt } });
    host.querySelector<HTMLElement>(".canvas-viewport")!.dispatchEvent(event);
  }

  const picker = (): HTMLElement | null => document.querySelector<HTMLElement>(".canvas-parts-picker");
  const field = (): HTMLInputElement => picker()!.querySelector<HTMLInputElement>(".canvas-parts-field > input")!;
  const row = (name: string): HTMLElement =>
    [...picker()!.querySelectorAll<HTMLElement>(".canvas-parts-row")].find((one) => one.textContent === name)!;
  const born = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes.find((node) => node.file === NOTE);
  const enter = (): void => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };
  /** Il tasto destro sulla scheda `id`: la sceglie e torna il menu. */
  const menuOn = (engine: CanvasEngine, host: HTMLElement, id: string) => {
    const element = host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  };

  async function dropped(made: ReturnType<typeof setup>): Promise<void> {
    drop(made.host);
    await vi.waitFor(() => expect(picker()).not.toBeNull());
  }

  it("rilasciando una nota con più titoli la scheda nasce intera e accanto si apre il selettore, col campo pronto", async () => {
    const made = setup();
    await dropped(made);
    expect(made.changes).toHaveLength(1);
    expect(born(made.engine)?.subpath).toBeUndefined();
    expect(made.outline).toHaveBeenCalledWith(NOTE);
    expect(picker()!.querySelector(".canvas-parts-title")!.textContent).toBe(t("canvas.parts.title", { name: "Relazione" }));
    expect([...picker()!.querySelectorAll(".canvas-parts-row")].map((one) => one.textContent)).toEqual(["Relazione", "Scopo", "Misure", "Calcoli"]);
    expect(document.activeElement).toBe(field());
    made.engine.destroy();
    expect(picker()).toBeNull();
  });

  it("Esc, la crocetta o un clic fuori tengono tutta la nota: niente cambia", async () => {
    const made = setup();
    await dropped(made);
    const before = made.engine.getDoc();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(picker()).toBeNull();
    expect(made.engine.getDoc()).toBe(before);
    // «Parti…» lo riapre; la crocetta e un clic fuori lo chiudono allo stesso modo.
    menuOn(made.engine, made.host, born(made.engine)!.id);
    const command = made.engine.commands().find((one) => one.id === "canvas.parts")!;
    expect(command.disabled()).toBeNull();
    command.run();
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    picker()!.querySelector<HTMLButtonElement>(".canvas-parts-close")!.click();
    expect(picker()).toBeNull();
    command.run();
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(picker()).toBeNull();
    expect(made.engine.getDoc()).toBe(before);
    expect(made.changes).toHaveLength(1);
    made.engine.destroy();
  });

  it("Alt tenuto al rilascio salta il selettore", async () => {
    const made = setup();
    drop(made.host, true);
    await vi.waitFor(() => expect(made.changes).toHaveLength(1));
    await Promise.resolve();
    expect(made.outline).not.toHaveBeenCalled();
    expect(picker()).toBeNull();
    made.engine.destroy();
  });

  it("«Selettore delle parti» spento nelle Impostazioni: la scheda nasce intera e basta", async () => {
    const made = setup();
    for (const apply of watched.appliers) apply({ ...DEFAULT_PREFERENCES, partsPicker: false });
    drop(made.host);
    await vi.waitFor(() => expect(made.changes).toHaveLength(1));
    await Promise.resolve();
    expect(made.outline).not.toHaveBeenCalled();
    expect(picker()).toBeNull();
    made.engine.destroy();
  });

  it("niente selettore per una nota con un titolo solo, per più file insieme e senza la porta del sommario", async () => {
    const one = setup({}, [{ level: 1, text: "Solo" }]);
    drop(one.host);
    await vi.waitFor(() => expect(one.outline).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picker()).toBeNull();
    // Il sommario letto spegne «Parti…», col perché.
    menuOn(one.engine, one.host, born(one.engine)!.id);
    expect(one.engine.commands().find((command) => command.id === "canvas.parts")!.disabled()).toBe(t("canvas.commands.why.no_sections"));
    one.engine.destroy();
    const many = setup({}, HEADINGS, [NOTE, "Note/Altra.md"]);
    drop(many.host);
    await vi.waitFor(() => expect(many.changes).toHaveLength(1));
    await Promise.resolve();
    expect(many.outline).not.toHaveBeenCalled();
    many.engine.destroy();
    const bare = mounted(canvasSource(), { attachments: { deposit: vi.fn(), resolvePaths: async () => [NOTE] } });
    expect(bare.engine.commands().some((command) => command.id === "canvas.parts")).toBe(false);
    bare.engine.destroy();
  });

  it("una sezione scrive il solo `subpath`, due anche `fub:parts` come dice canvas-parts.md; «Parti…» riapre con le sezioni di adesso; ogni scelta è un annulla", async () => {
    const made = setup();
    await dropped(made);
    row("Misure").click();
    expect(picker()!.querySelector(".kit-button")!.textContent).toBe(t("canvas.parts.put_section"));
    enter();
    expect(picker()).toBeNull();
    expect(made.changes).toHaveLength(2);
    const one = born(made.engine)!;
    expect(one.subpath).toBe("#Misure");
    expect(Object.prototype.hasOwnProperty.call(one, "fub:parts")).toBe(false);

    // «Parti…» dal menu della scheda, per prima: le sezioni di adesso già spuntate.
    const menu = menuOn(made.engine, made.host, one.id);
    const entry = (menu.context ?? [])[0] as SurfaceMenuItem;
    expect(entry.id).toBe("canvas.parts");
    expect(entry.label).toBe(t("canvas.parts"));
    entry.run!();
    await vi.waitFor(() => expect(picker()).not.toBeNull());
    expect(row("Misure").getAttribute("aria-selected")).toBe("true");
    expect(row("Scopo").getAttribute("aria-selected")).toBe("false");
    row("Scopo").click();
    expect(picker()!.querySelector(".kit-button")!.textContent).toBe(t("canvas.parts.put_sections", { n: 2 }));
    enter();
    const two = born(made.engine)!;
    // Nell'ordine della nota; il `subpath` è la prima.
    expect(two.subpath).toBe("#Scopo");
    expect(two["fub:parts"]).toEqual({ kind: "sections", sections: ["Scopo", "Misure"] });
    expect(made.engine.getDoc()).toContain('"subpath":"#Scopo"');
    expect(made.engine.getDoc()).toContain('"fub:parts":{"kind":"sections","sections":["Scopo","Misure"]}');
    expect(made.changes).toHaveLength(3);

    // Ogni scelta è un passo: la sezione sola, la nota intera, il vuoto.
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)!.subpath).toBe("#Misure");
    expect(made.engine.undo()).toBe(true);
    const whole = born(made.engine)!;
    expect(whole.subpath).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(whole, "fub:parts")).toBe(false);
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)).toBeUndefined();
    made.engine.destroy();
  });

  it("Invio subito dopo il rilascio scrive le sezioni in un solo commit: un annulla riporta la nota intera, un altro toglie la scheda", async () => {
    const made = setup();
    await dropped(made);
    row("Scopo").click();
    row("Calcoli").click();
    enter();
    expect(made.changes).toHaveLength(2);
    expect(born(made.engine)!["fub:parts"]).toEqual({ kind: "sections", sections: ["Scopo", "Calcoli"] });
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)!.subpath).toBeUndefined();
    expect(made.engine.undo()).toBe(true);
    expect(born(made.engine)).toBeUndefined();
    made.engine.destroy();
  });

  it("la scheda annullata col selettore aperto lo chiude, e in sola lettura «Parti…» è spento", async () => {
    const made = setup();
    await dropped(made);
    expect(made.engine.undo()).toBe(true);
    expect(picker()).toBeNull();
    expect(made.engine.redo()).toBe(true);
    menuOn(made.engine, made.host, born(made.engine)!.id);
    made.engine.setReadOnly(true);
    expect(made.engine.commands().find((command) => command.id === "canvas.parts")!.disabled()).toBe(t("canvas.commands.why.read_only"));
    made.engine.destroy();
  });
});

describe("CanvasEngine: la griglia e le guide (T71)", () => {
  afterEach(() => {
    setReducedMotionPreference(false);
    vi.restoreAllMocks();
    applyPreferences({});
  });

  /** `t` ferma in alto a sinistra (40, 40, 240 × 160), `m` da spostare più in basso. */
  function guideBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 160, text: "ferma" },
        { id: "m", type: "text", x: 100, y: 300, width: 100, height: 60, text: "mossa" },
      ],
      edges: [],
    });
  }

  /** Tre schede in fila (`p`, `q` con uno spazio di 160), e `m` sotto, da portare nel posto dopo `q`. */
  function rowBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "p", type: "text", x: 40, y: 300, width: 100, height: 60, text: "uno" },
        { id: "q", type: "text", x: 300, y: 300, width: 100, height: 60, text: "due" },
        { id: "m", type: "text", x: 100, y: 440, width: 60, height: 60, text: "tre" },
      ],
      edges: [],
    });
  }

  /** `t` (40, 40, 240 × 160) e `f` a destra (404, 300): il lato destro di `t` s'aggancia a `f`. */
  function edgeBoard(): string {
    return JSON.stringify({
      nodes: [
        { id: "t", type: "text", x: 40, y: 40, width: 240, height: 160, text: "ferma" },
        { id: "f", type: "text", x: 404, y: 300, width: 240, height: 140, text: "vicina" },
      ],
      edges: [],
    });
  }

  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const gridOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-grid")!;
  const guidesOf = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".canvas-guide")];
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;
  const zoomOf = (host: HTMLElement): number => Number(/scale\(([\d.e+-]+)\)/.exec(host.querySelector<HTMLElement>(".canvas-stage")!.style.transform)![1]);

  /** La vista misura 800 × 600 a partire da (0, 0): happy-dom non dispone niente. */
  function sized(host: HTMLElement): void {
    vi.spyOn(viewportOf(host), "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
  }

  /** La lavagna al 100% subito (movimento ridotto): l'unità della lavagna è un pixel. */
  function atHundred(host: HTMLElement): void {
    setReducedMotionPreference(true);
    const viewport = viewportOf(host);
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }));
    expect(zoomOf(host)).toBe(1);
  }

  function pointer(target: EventTarget, type: string, init: PointerEventInit): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 5, pointerType: "mouse", ...init }));
  }

  /** Le impostazioni cambiate a lavagna aperta, come da «Impostazioni» (T35). */
  function applyPreferences(patch: Partial<CanvasPreferences>): void {
    for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, ...patch });
  }

  /**
   * Trascina la scheda `id` di (dx, dy) unità (a zoom 1) dalla sua maniglia; lasciata lì se
   * `release` è falso. Alt sul premere è il trascinamento della vista (T53): i tasti del gesto
   * stanno sul movimento e sul rilascio.
   */
  function moveCard(host: HTMLElement, id: string, dx: number, dy: number, keys: PointerEventInit = {}, release = true): void {
    const handle = card(host, id).querySelector<HTMLElement>(".canvas-node-handle")!;
    pointer(handle, "pointerdown", { clientX: 500, clientY: 500 });
    pointer(viewportOf(host), "pointermove", { clientX: 500 + dx, clientY: 500 + dy, ...keys });
    if (release) releaseAt(host, dx, dy, keys);
  }

  function releaseAt(host: HTMLElement, dx: number, dy: number, init: PointerEventInit = {}): void {
    pointer(viewportOf(host), "pointerup", { clientX: 500 + dx, clientY: 500 + dy, ...init });
  }

  /** Tira l'angolo `corner` di `id` di (dx, dy) unità (a zoom 1), senza rilasciarlo: il rilascio lo fa il chiamante. */
  function pullCorner(host: HTMLElement, id: string, corner: string, dx: number, dy: number): void {
    const grip = card(host, id).querySelector<HTMLElement>(`.canvas-resize[data-corner="${corner}"]`)!;
    pointer(grip, "pointerdown", { clientX: 100, clientY: 100, buttons: 1, pointerId: 7 });
    pointer(viewportOf(host), "pointermove", { clientX: 100 + dx, clientY: 100 + dy, buttons: 1, pointerId: 7 });
  }

  it("una scheda che si sposta s'aggancia al bordo di un'altra, non alla griglia, e la guida si vede mentre tira", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    // Il bordo sinistro di `m` va a 45: la griglia darebbe 48, il bordo di `t` è 40.
    moveCard(host, "m", -55, 0, {}, false);
    expect(guidesOf(host).some((line) => line.dataset.kind === "edge" && line.dataset.axis === "v")).toBe(true);
    releaseAt(host, -55, 0);
    expect(nodeOf(engine, "m").x).toBe(40);
    expect(guidesOf(host)).toHaveLength(0);
    expect(engine.undo()).toBe(true);
    expect(nodeOf(engine, "m").x).toBe(100);
    engine.destroy();
  });

  it("il centro della scheda s'allinea al centro di un'altra, e la guida è di centro", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    // Il centro di `m` va a 162, a 2 unità dal centro di `t` (160): la griglia darebbe 112.
    moveCard(host, "m", 12, 0, {}, false);
    expect(guidesOf(host).some((line) => line.dataset.kind === "center")).toBe(true);
    releaseAt(host, 12, 0);
    expect(nodeOf(engine, "m").x).toBe(110);
    engine.destroy();
  });

  it("uno spazio uguale fra tre schede in fila si mostra con due segni, e porta la scheda al suo posto", () => {
    const { engine, host } = mounted(rowBoard());
    sized(host);
    atHundred(host);
    // Lo spazio fra `p` e `q` è 160: dopo `q` la scheda va a 560. Il bordo va a 565.
    moveCard(host, "m", 465, -140, {}, false);
    expect(guidesOf(host).filter((line) => line.dataset.kind === "gap")).toHaveLength(2);
    releaseAt(host, 465, -140);
    expect(nodeOf(engine, "m")).toMatchObject({ x: 560, y: 300 });
    engine.destroy();
  });

  it("tirando l'angolo di una scheda, il lato che tira s'aggancia a una scheda vicina", () => {
    const { engine, host } = mounted(edgeBoard());
    sized(host);
    atHundred(host);
    // Il lato destro di `t` va a 402, a 2 unità dal bordo di `f` (404).
    pullCorner(host, "t", "se", 122, 0);
    expect(guidesOf(host).some((line) => line.dataset.axis === "v")).toBe(true);
    pointer(viewportOf(host), "pointerup", { clientX: 222, clientY: 100, pointerId: 7 });
    expect(nodeOf(engine, "t")).toMatchObject({ x: 40, y: 40, width: 364, height: 160 });
    expect(guidesOf(host)).toHaveLength(0);
    engine.destroy();
  });

  it("Alt tenuto spegne l'aggancio per quel gesto: niente guide e niente griglia, la scheda va dove la porta il puntatore", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    moveCard(host, "m", -55, 0, { altKey: true }, false);
    expect(guidesOf(host)).toHaveLength(0);
    releaseAt(host, -55, 0, { altKey: true });
    expect(nodeOf(engine, "m")).toMatchObject({ x: 45, y: 300 });
    engine.destroy();
  });

  it("con canvas.snap spento non c'è aggancio né guide: la scheda va in unità intere", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    applyPreferences({ snap: false });
    moveCard(host, "m", -55, 0, {}, false);
    expect(guidesOf(host)).toHaveLength(0);
    releaseAt(host, -55, 0);
    expect(nodeOf(engine, "m")).toMatchObject({ x: 45, y: 300 });
    engine.destroy();
  });

  it("Ctrl+' mostra e nasconde la griglia, e i punti si vedono ogni 32 unità (T95)", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    const viewport = viewportOf(host);
    expect(gridOf(host).hidden).toBe(false);
    expect(gridOf(host).style.backgroundSize).toBe("32px 32px");
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "'", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(gridOf(host).hidden).toBe(true);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "'", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(gridOf(host).hidden).toBe(false);
    engine.destroy();
  });

  it("canvas.grid spento nasconde la griglia, acceso la mostra", () => {
    const { engine, host } = mounted(guideBoard());
    expect(gridOf(host).hidden).toBe(false);
    applyPreferences({ grid: false });
    expect(gridOf(host).hidden).toBe(true);
    applyPreferences({ grid: true });
    expect(gridOf(host).hidden).toBe(false);
    engine.destroy();
  });

  it("sotto il 50% la griglia non si disegna, perché i punti sarebbero più fitti di 16 px", () => {
    const { engine, host } = mounted(guideBoard());
    const viewport = viewportOf(host);
    for (let i = 0; i < 30; i++) viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true, cancelable: true }));
    expect(zoomOf(host)).toBe(0.05);
    expect(gridOf(host).hidden).toBe(true);
    for (let i = 0; i < 12; i++) viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }));
    expect(zoomOf(host)).toBeGreaterThanOrEqual(0.5);
    expect(gridOf(host).hidden).toBe(false);
    engine.destroy();
  });

  it("una guida lasciata in volo non sopravvive alla lavagna chiusa", () => {
    const { engine, host } = mounted(guideBoard());
    sized(host);
    atHundred(host);
    moveCard(host, "m", -55, 0, {}, false);
    const layer = host.querySelector(".canvas-guides");
    expect(layer).not.toBeNull();
    engine.destroy();
    expect(layer!.isConnected).toBe(false);
  });
});

describe("CanvasEngine: il menu radiale e i gesti (T63)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  type Init = PointerEventInit & { readonly timeStamp?: number };
  function pointer(type: string, init: Init): PointerEvent {
    const { timeStamp, ...rest } = init;
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, altitudeAngle: Math.PI / 2, azimuthAngle: 0, ...rest });
    if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
    return event;
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const cardOf = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const radial = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-radial");
  const radialLabels = (): (string | null)[] => [...document.querySelectorAll(".draw-radial-item")].map((item) => item.getAttribute("aria-label"));
  const nodeIds = (engine: CanvasEngine): string[] => readCanvas(engine.getDoc()).nodes.map((node) => node.id);
  const said = (host: HTMLElement): string => host.querySelector(".canvas-gesture-said")?.textContent?.trim() ?? "";
  const run = (engine: CanvasEngine, id: string): void => engine.commands().find((command) => command.id === id)!.run();
  const writingCard = (host: HTMLElement): string | undefined =>
    host.querySelector<HTMLElement>(".canvas-text-editor, .canvas-text-live")?.closest<HTMLElement>(".canvas-node")?.dataset.node;

  function cameraOf(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
    if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  /** «Il tasto della penna» cambiato a lavagna aperta, come la manda un cambio da Impostazioni. */
  function setPenButton(penButton: CanvasPreferences["penButton"]): void {
    for (const apply of [...watched.appliers]) apply({ ...DEFAULT_PREFERENCES, penButton });
  }

  let clock = 1000;
  const PEN = { pointerId: 21, pointerType: "pen" } as const;

  /** La penna col tasto laterale premuto sui punti `world`, sulla vista che la cattura. */
  function barrel(host: HTMLElement, world: readonly (readonly [number, number])[], lift = true): () => void {
    const cam = cameraOf(host);
    const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
    const viewport = viewportOf(host);
    viewport.dispatchEvent(pointer("pointerdown", { ...PEN, ...at(world[0]!), button: 2, buttons: 2, pressure: 0.5, timeStamp: clock }));
    for (const point of world.slice(1)) {
      clock += 8;
      viewport.dispatchEvent(pointer("pointermove", { ...PEN, ...at(point), button: -1, buttons: 2, pressure: 0.5, timeStamp: clock }));
    }
    const last = world[world.length - 1]!;
    const up = () => {
      clock += 4;
      viewport.dispatchEvent(pointer("pointerup", { ...PEN, ...at(last), button: 2, buttons: 0, pressure: 0, timeStamp: clock }));
      clock += 100;
    };
    if (lift) up();
    return up;
  }

  /** Un tratto della punta della penna sui punti `world`. */
  function tip(host: HTMLElement, world: readonly (readonly [number, number])[]): void {
    const cam = cameraOf(host);
    const at = ([x, y]: readonly [number, number]) => ({ clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y });
    const viewport = viewportOf(host);
    viewport.dispatchEvent(pointer("pointerdown", { ...PEN, ...at(world[0]!), button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
    for (const point of world.slice(1)) {
      clock += 8;
      viewport.dispatchEvent(pointer("pointermove", { ...PEN, ...at(point), button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
    }
    clock += 4;
    viewport.dispatchEvent(pointer("pointerup", { ...PEN, ...at(world[world.length - 1]!), button: 0, buttons: 0, pressure: 0, timeStamp: clock }));
    clock += 100;
  }

  /** I tratti liberi della lavagna. */
  const boardStrokes = (engine: CanvasEngine): unknown[] =>
    ((JSON.parse(engine.getDoc()) as { "fub:ink"?: { strokes?: unknown[] } })["fub:ink"]?.strokes ?? []);

  /** Un dito finto: giù su `target` nel punto del client, poi si muove e si alza sulla vista. */
  function finger(host: HTMLElement, pointerId: number, target: Element, x: number, y: number) {
    const viewport = viewportOf(host);
    const base = { pointerId, pointerType: "touch", isPrimary: false, width: 10, height: 10 } as const;
    target.dispatchEvent(pointer("pointerdown", { ...base, clientX: x, clientY: y, button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
    return {
      move(nx: number, ny: number) {
        clock += 16;
        viewport.dispatchEvent(pointer("pointermove", { ...base, clientX: nx, clientY: ny, button: -1, buttons: 1, pressure: 0.5, timeStamp: clock }));
      },
      up(nx = x, ny = y) {
        clock += 16;
        viewport.dispatchEvent(pointer("pointerup", { ...base, clientX: nx, clientY: ny, button: 0, buttons: 0, pressure: 0, timeStamp: clock }));
      },
    };
  }

  /** Un tocco breve di `count` dita vicine nel punto (x, y), giù e su entro pochi ms. */
  function tapWith(host: HTMLElement, count: number, x: number, y: number): void {
    const viewport = viewportOf(host);
    const fingers = Array.from({ length: count }, (_, index) => finger(host, 50 + index, viewport, x + index * 40, y));
    clock += 30;
    fingers.forEach((one, index) => one.up(x + index * 40, y));
    clock += 400;
  }

  describe("il tasto laterale della penna, con le quattro scelte di «Il tasto della penna»", () => {
    it("«radial» (di serie): apre il menu radiale dove è la penna, che lo segue; il menu del sistema dietro non apre quello della lavagna", () => {
      const { engine, host } = mounted();
      const cam = cameraOf(host);
      const lift = barrel(host, [[300, 300]], false);
      expect(radial()).not.toBeNull();
      expect(radialLabels()).toEqual([
        t("canvas.commands.undo"), t("canvas.tool.highlighter"), t("canvas.tool.text"), t("canvas.tool.pen"), t("canvas.commands.redo"),
        t("canvas.radial.color", { name: t("canvas.ink.color.black") }),
        t("canvas.radial.color", { name: t("canvas.ink.color.vermilion") }),
        t("canvas.radial.color", { name: t("canvas.ink.color.green") }),
      ]);
      // Niente si scrive né si cancella, la vista non si muove.
      expect(cameraOf(host)).toEqual(cam);
      lift();
      // Alzata nel mezzo: il menu resta aperto.
      expect(radial()).not.toBeNull();
      const echo = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 300 });
      viewportOf(host).dispatchEvent(echo);
      expect(echo.defaultPrevented).toBe(true);
      expect(boardStrokes(engine)).toEqual([]);
      engine.destroy();
      expect(radial()).toBeNull();
    });

    it("«radial»: la penna che lascia il tasto sopra una voce la sceglie, e lo strumento di prima va fra i recenti", () => {
      const { engine, host } = mounted();
      const viewport = viewportOf(host);
      viewport.dispatchEvent(pointer("pointerdown", { ...PEN, clientX: 400, clientY: 300, button: 2, buttons: 2, pressure: 0, timeStamp: clock }));
      const ring = document.querySelector<HTMLElement>(".draw-radial-ring")!;
      const [cx, cy] = [parseFloat(ring.style.left), parseFloat(ring.style.top)];
      // A est il Testo, il primo strumento di riserva con la Selezione di adesso.
      viewport.dispatchEvent(pointer("pointerup", { ...PEN, clientX: cx + 80, clientY: cy, button: 2, buttons: 0, pressure: 0, timeStamp: clock + 10 }));
      expect(radial()).toBeNull();
      expect(engine.tool).toBe("text");
      // Riaperto: la Selezione è fra i recenti, a est.
      barrel(host, [[100, 100]]);
      expect(radialLabels()[2]).toBe(t("canvas.tool.select"));
      engine.destroy();
    });

    it("«eraser»: il tasto cancella come il retro della penna, e il menu non si apre", () => {
      const { engine, host } = mounted();
      tip(host, [[100, 700], [140, 715], [180, 730]]);
      expect(boardStrokes(engine)).toHaveLength(1);
      setPenButton("eraser");
      barrel(host, [[140, 680], [140, 700], [140, 715], [140, 730], [140, 760]]);
      expect(radial()).toBeNull();
      expect(boardStrokes(engine)).toHaveLength(0);
      engine.destroy();
    });

    it("«pan»: il tasto sposta la lavagna con la penna, e niente si cancella", () => {
      const { engine, host } = mounted();
      tip(host, [[100, 700], [140, 715], [180, 730]]);
      setPenButton("pan");
      const start = cameraOf(host);
      barrel(host, [[140, 680], [150, 700], [190, 730]]);
      const end = cameraOf(host);
      expect(end.x - start.x).toBeCloseTo(50 * start.zoom, 5);
      expect(end.y - start.y).toBeCloseTo(50 * start.zoom, 5);
      expect(radial()).toBeNull();
      expect(boardStrokes(engine)).toHaveLength(1);
      engine.destroy();
    });

    it("«lasso»: un giro col tasto sceglie come il Lazo, e lo strumento di prima resta", () => {
      const { engine, host } = mounted();
      run(engine, "canvas.tool.pen");
      setPenButton("lasso");
      // Attorno alla scheda «t» (40, 40, 240 × 140).
      barrel(host, [[20, 20], [300, 20], [300, 200], [20, 200], [20, 22]]);
      expect(engine.selection().nodes).toEqual(["t"]);
      expect(engine.tool).toBe("pen");
      expect(radial()).toBeNull();
      expect(boardStrokes(engine)).toEqual([]);
      engine.destroy();
    });

    it("in sola lettura il tasto apre il menu lo stesso, con Annulla e Ripeti spenti", () => {
      const { engine, host } = mounted();
      run(engine, "canvas.select_all");
      run(engine, "canvas.delete");
      engine.setReadOnly(true);
      const lift = barrel(host, [[300, 300]], false);
      const items = [...document.querySelectorAll<HTMLElement>(".draw-radial-item")];
      expect(items[0]!.getAttribute("aria-disabled")).toBe("true");
      expect(items[4]!.getAttribute("aria-disabled")).toBe("true");
      lift();
      engine.destroy();
    });
  });

  describe("il tocco lungo", () => {
    it("fermo per 500 ms nel vuoto apre il menu radiale, che segue il dito; prima no", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { engine, host } = mounted();
      const touch = finger(host, 31, viewportOf(host), 700, 500);
      vi.advanceTimersByTime(499);
      expect(radial()).toBeNull();
      touch.move(704, 503);
      vi.advanceTimersByTime(1);
      expect(radial()).not.toBeNull();
      expect(radialLabels()[0]).toBe(t("canvas.commands.undo"));
      // Il dito si alza nel mezzo: il menu resta, e il dito non ha scelto niente.
      touch.up(704, 503);
      expect(radial()).not.toBeNull();
      expect(engine.selection().nodes).toEqual([]);
      engine.destroy();
      expect(radial()).toBeNull();
    });

    it("un dito che si muove oltre 8 px non è un tocco lungo", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { engine, host } = mounted();
      const touch = finger(host, 31, viewportOf(host), 700, 500);
      touch.move(712, 500);
      vi.advanceTimersByTime(600);
      expect(radial()).toBeNull();
      touch.up(712, 500);
      engine.destroy();
    });

    it("sopra una scheda apre il menu della scheda, nel punto del dito, non il radiale", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { engine, host } = mounted();
      const menus: MouseEvent[] = [];
      host.addEventListener("contextmenu", (event) => menus.push(event));
      const touch = finger(host, 31, cardOf(host, "t"), 120, 90);
      vi.advanceTimersByTime(500);
      expect(radial()).toBeNull();
      expect(menus).toHaveLength(1);
      expect([menus[0]!.clientX, menus[0]!.clientY, menus[0]!.button, menus[0]!.defaultPrevented]).toEqual([120, 90, 2, false]);
      expect(menus[0]!.target).toBe(cardOf(host, "t"));
      // Il menu del sistema che il tocco lungo manda dietro non ne apre un altro.
      const echo = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 90 });
      cardOf(host, "t").dispatchEvent(echo);
      expect(echo.defaultPrevented).toBe(true);
      expect(menus).toHaveLength(1);
      touch.up();
      engine.destroy();
    });

    it("la penna giù mentre il dito aspetta vince: niente menu", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { engine, host } = mounted();
      const touch = finger(host, 31, viewportOf(host), 700, 500);
      const viewport = viewportOf(host);
      viewport.dispatchEvent(pointer("pointerdown", { ...PEN, clientX: 100, clientY: 100, button: 0, buttons: 1, pressure: 0.5, timeStamp: clock }));
      touch.move(701, 500);
      vi.advanceTimersByTime(600);
      expect(radial()).toBeNull();
      viewport.dispatchEvent(pointer("pointerup", { ...PEN, clientX: 100, clientY: 100, button: 0, buttons: 0, pressure: 0, timeStamp: clock + 10 }));
      touch.up(701, 500);
      engine.destroy();
    });
  });

  describe("le dita che toccano", () => {
    it("due dita annullano, tre ripetono; con niente da annullare lo si dice", () => {
      const { engine, host } = mounted();
      tapWith(host, 2, 700, 500);
      expect(said(host)).toBe(t("canvas.gesture.no_undo"));
      tapWith(host, 3, 700, 500);
      expect(said(host)).toBe(t("canvas.gesture.no_redo"));
      run(engine, "canvas.select_all");
      run(engine, "canvas.delete");
      expect(nodeIds(engine)).toEqual([]);
      tapWith(host, 2, 700, 500);
      expect(nodeIds(engine)).toEqual(["t", "f", "g", "w"]);
      tapWith(host, 3, 700, 500);
      expect(nodeIds(engine)).toEqual([]);
      // La stessa frase si ridice.
      tapWith(host, 3, 700, 500);
      const first = host.querySelector(".canvas-gesture-said")!.textContent;
      tapWith(host, 3, 700, 500);
      expect(host.querySelector(".canvas-gesture-said")!.textContent).not.toBe(first);
      expect(said(host)).toBe(t("canvas.gesture.no_redo"));
      engine.destroy();
    });

    it("due dita che si muovono sono un pizzico, non un annulla; due dita lente nemmeno", () => {
      const { engine, host } = mounted();
      run(engine, "canvas.select_all");
      run(engine, "canvas.delete");
      // Il commit lo dice la regione viva (T61); le dita dopo non dicono niente.
      const told = said(host);
      const viewport = viewportOf(host);
      const a = finger(host, 61, viewport, 600, 400);
      const b = finger(host, 62, viewport, 700, 400);
      a.move(560, 400);
      b.move(760, 400);
      a.up(560, 400);
      b.up(760, 400);
      expect(nodeIds(engine)).toEqual([]);
      clock += 400;
      const c = finger(host, 63, viewport, 600, 400);
      const d = finger(host, 64, viewport, 700, 400);
      clock += 300;
      c.up();
      d.up();
      expect(nodeIds(engine)).toEqual([]);
      expect(said(host)).toBe(told);
      engine.destroy();
    });

    it("il doppio tocco nel vuoto mette lì una scheda di testo, già in scrittura; sopra una scheda no", () => {
      const { engine, host } = mounted();
      const cam = cameraOf(host);
      const viewport = viewportOf(host);
      const tap = (target: Element, x: number, y: number, where = host) => {
        const one = finger(where, 71, target, x, y);
        clock += 40;
        one.up(x, y);
        clock += 120;
      };
      tap(viewport, 900, 700);
      expect(nodeIds(engine)).toHaveLength(4);
      tap(viewport, 904, 702);
      const nodes = readCanvas(engine.getDoc()).nodes;
      expect(nodes).toHaveLength(5);
      const fresh = nodes[4]!;
      expect(fresh.type).toBe("text");
      // L'angolo in alto a sinistra sotto il dito, sulla griglia.
      expect(Math.abs(fresh.x - (900 - cam.x) / cam.zoom)).toBeLessThan(24);
      expect(Math.abs(fresh.y - (700 - cam.y) / cam.zoom)).toBeLessThan(24);
      expect(writingCard(host)).toBe(fresh.id);
      // Lo strumento resta com'era.
      expect(engine.tool).toBe("select");
      engine.destroy();

      const other = mounted();
      const card = cardOf(other.host, "t");
      tap(card, 120, 90, other.host);
      tap(card, 121, 91, other.host);
      expect(nodeIds(other.engine)).toHaveLength(4);
      other.engine.destroy();
    });

    it("il doppio clic nel vuoto fa come il doppio tocco: la scheda nasce lì, già in scrittura (T100)", () => {
      const { engine, host } = mounted();
      const cam = cameraOf(host);
      viewportOf(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 900, clientY: 700 }));
      const nodes = readCanvas(engine.getDoc()).nodes;
      expect(nodes).toHaveLength(5);
      const fresh = nodes[4]!;
      expect(fresh.type).toBe("text");
      expect(Math.abs(fresh.x - (900 - cam.x) / cam.zoom)).toBeLessThan(24);
      expect(Math.abs(fresh.y - (700 - cam.y) / cam.zoom)).toBeLessThan(24);
      expect(writingCard(host)).toBe(fresh.id);
      expect(engine.tool).toBe("select");
      engine.destroy();
    });
  });

  it("Maiusc+F10 › «Menu radiale» lo apre dalla tastiera, al centro della vista, col fuoco sulla prima voce", () => {
    const { engine } = mounted();
    const menu = engine.contextMenu(null)!;
    const entry = (menu.context ?? []).find((item): item is SurfaceMenuItem => typeof item !== "string" && item.id === "canvas.radial")!;
    expect(entry.label).toBe(t("canvas.radial"));
    entry.run!();
    expect(radial()).not.toBeNull();
    expect(document.activeElement?.classList.contains("draw-radial-item")).toBe(true);
    // Un documento nuovo chiude il menu dell'altro.
    engine.setDoc(canvasSource());
    expect(radial()).toBeNull();
    engine.destroy();
  });
});

describe("CanvasEngine: tutto da tastiera e col lettore di schermo (T61)", () => {
  // L'ordine di lettura di `canvasSource`: il gruppo «Idee» (g), la pagina web
  // che contiene (w), poi la riga di sopra: il testo (t) e la foto (f).
  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const cardOf = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const focusedCard = (): string | null => (document.activeElement as HTMLElement | null)?.dataset.node ?? null;
  const said = (host: HTMLElement): string => host.querySelector(".canvas-gesture-said")?.textContent?.trim() ?? "";
  const textTitle = (name: string): string => `${t("canvas_menu.header", { kind: t("canvas_menu.kind.text") })} ${name}`;
  const webTitle = `${t("canvas_menu.header", { kind: t("canvas_menu.kind.web") })} example.com`;
  const run = (engine: CanvasEngine, id: string): void => engine.commands().find((command) => command.id === id)!.run();

  beforeEach(() => setReducedMotionPreference(true));
  afterEach(() => setReducedMotionPreference(false));

  it("Tab e Maiusc+Tab percorrono le schede in ordine di lettura; il fuoco e la scelta seguono", () => {
    const { engine, host } = mounted();
    const viewport = viewportOf(host);
    viewport.focus();
    const visited: Array<string | null> = [];
    for (let i = 0; i < 4; i++) {
      expect(press(document.activeElement as HTMLElement, "Tab").defaultPrevented).toBe(true);
      visited.push(focusedCard());
      expect(engine.selection().nodes).toEqual([focusedCard()]);
    }
    expect(visited).toEqual(["g", "w", "t", "f"]);
    expect(press(cardOf(host, "f"), "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(focusedCard()).toBe("t");
    // Prima della prima scheda si torna alla lavagna; da lì Maiusc+Tab esce come sempre.
    cardOf(host, "g").focus();
    expect(press(cardOf(host, "g"), "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(viewport);
    expect(press(viewport, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    // Dalla lavagna Tab torna alla scheda scelta.
    expect(engine.selection().nodes).toEqual(["g"]);
    press(viewport, "Tab");
    expect(focusedCard()).toBe("g");
    engine.destroy();
  });

  it("Tab dopo l'ultima scheda esce dalla vista; la lavagna vuota e un campo aperto non lo prendono", () => {
    const { engine, host } = mounted();
    const after = document.createElement("button");
    document.body.append(after);
    cardOf(host, "f").focus();
    expect(press(cardOf(host, "f"), "Tab").defaultPrevented).toBe(true);
    expect(viewportOf(host).contains(document.activeElement)).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    // Una scheda in scrittura: il Tab è del campo (Esc prima).
    const field = openField(host, "t");
    expect(press(field, "Tab").defaultPrevented).toBe(false);
    engine.destroy();
    const empty = mounted(JSON.stringify({ nodes: [], edges: [] }));
    viewportOf(empty.host).focus();
    expect(press(viewportOf(empty.host), "Tab").defaultPrevented).toBe(false);
    empty.engine.destroy();
  });

  it("Tab porta in vista una scheda lontana, senza volo col movimento ridotto e senza un salto di Indietro", () => {
    const source = JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "Qui" },
        { id: "b", type: "text", x: 6000, y: 0, width: 200, height: 100, text: "Lontano" },
      ],
      edges: [],
    });
    const { engine, host } = mounted(source);
    const stage = host.querySelector<HTMLElement>(".canvas-stage")!;
    const camera = (): { x: number; zoom: number } => {
      const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(stage.style.transform)!;
      return { x: Number(match[1]), zoom: Number(match[3]) };
    };
    // Da vicino, così la scheda lontana è fuori dalla vista.
    run(engine, "canvas.zoom_reset");
    cardOf(host, "a").focus();
    const before = stage.style.transform;
    press(cardOf(host, "a"), "Tab");
    expect(focusedCard()).toBe("b");
    expect(stage.style.transform).not.toBe(before);
    // Il centro della scheda al centro della vista (800 di riserva in happy-dom).
    expect(camera().x + (6000 + 100) * camera().zoom).toBeCloseTo(400);
    // Un passo della tastiera non è un salto da cui Indietro torna (T56).
    expect(engine.jumpBack()).toBe(true);
    expect(engine.jumpBack()).toBe(false);
    engine.destroy();
  });

  it("Alt+↑ e Alt+↓ vanno alla scheda più vicina, anche dalla lavagna senza una scheda a fuoco", () => {
    const { engine, host } = mounted();
    cardOf(host, "t").focus();
    expect(press(cardOf(host, "t"), "ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
    expect(focusedCard()).toBe("g");
    // Sopra il gruppo il testo e la foto sono alla stessa distanza: vince il
    // testo, prima nell'ordine di lettura.
    press(cardOf(host, "g"), "ArrowUp", { altKey: true });
    expect(focusedCard()).toBe("t");
    // Sopra il testo non c'è niente: lo dice la regione viva.
    press(cardOf(host, "t"), "ArrowUp", { altKey: true });
    expect(focusedCard()).toBe("t");
    expect(said(host)).toBe(t("canvas.a11y.none_that_way"));
    // Senza fuoco su una scheda né scelta, Alt+↓ prende la prima.
    run(engine, "canvas.escape");
    viewportOf(host).focus();
    press(viewportOf(host), "ArrowDown", { altKey: true });
    expect(focusedCard()).toBe("g");
    engine.destroy();
  });

  it("Alt+← e Alt+→ vanno alla scheda vicina col fuoco su una scheda; altrove restano Indietro e Avanti (T56)", () => {
    const { engine, host } = mounted();
    // Il registro della shell come `mountKeyboard` (`ui/keyboard.ts`): un solo
    // ascoltatore sul documento, dopo le keymap locali, che non parte se
    // l'evento gli arriva già preso.
    const shell: string[] = [];
    const registry = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !event.altKey) return;
      if (event.key === "ArrowLeft") shell.push("shell.pane.back");
      if (event.key === "ArrowRight") shell.push("shell.pane.forward");
    };
    document.addEventListener("keydown", registry);
    try {
      // Col fuoco sul testo, Alt+→ porta alla foto, che gli sta a destra, e
      // Indietro/Avanti non partono.
      cardOf(host, "t").focus();
      expect(press(cardOf(host, "t"), "ArrowRight", { altKey: true }).defaultPrevented).toBe(true);
      expect(focusedCard()).toBe("f");
      expect(press(cardOf(host, "f"), "ArrowLeft", { altKey: true }).defaultPrevented).toBe(true);
      expect(focusedCard()).toBe("t");
      // A sinistra del testo non c'è niente: lo dice la regione viva, e il
      // tasto resta della lavagna (non diventa un Indietro a sorpresa).
      press(cardOf(host, "t"), "ArrowLeft", { altKey: true });
      expect(focusedCard()).toBe("t");
      expect(said(host)).toBe(t("canvas.a11y.none_that_way"));
      expect(shell).toEqual([]);
      // Col fuoco sulla lavagna, senza una scheda a fuoco, Alt+← e Alt+→
      // arrivano ancora a Indietro e Avanti.
      viewportOf(host).focus();
      expect(press(viewportOf(host), "ArrowLeft", { altKey: true }).defaultPrevented).toBe(false);
      expect(press(viewportOf(host), "ArrowRight", { altKey: true }).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(viewportOf(host));
      expect(shell).toEqual(["shell.pane.back", "shell.pane.forward"]);
    } finally {
      document.removeEventListener("keydown", registry);
      engine.destroy();
    }
  });

  it("le frecce spostano di 8 e Alt+Maiusc+frecce di 1 (A-23); spostare e togliere si annunciano", () => {
    const { engine, host } = mounted();
    const x = (): number => engine.doc()!.nodes.find((node) => node.id === "t")!.x;
    cardOf(host, "t").focus();
    press(cardOf(host, "t"), "ArrowRight");
    expect(x()).toBe(48);
    expect(press(cardOf(host, "t"), "ArrowRight", { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(x()).toBe(49);
    press(cardOf(host, "t"), "ArrowLeft", { altKey: true, shiftKey: true });
    expect(x()).toBe(48);
    expect(said(host)).toBe(t("canvas.a11y.moved_one", { name: textTitle("vedi Altra e #tag") }));
    run(engine, "canvas.delete");
    expect(said(host)).toBe(t("canvas.a11y.removed_one", { name: textTitle("vedi Altra e #tag") }));
    engine.destroy();
  });

  it("F6 passa dalla lavagna alla colonna e alla riga, poi lascia la strada alla shell", () => {
    const { engine, host } = mounted();
    const rail = host.querySelector<HTMLElement>(".canvas-rail")!;
    const options = host.querySelector<HTMLElement>(".canvas-options")!;
    const navigator = host.querySelector<HTMLElement>(".canvas-navigator");
    cardOf(host, "t").focus();
    const steps: string[] = [];
    while (steps.length < 6 && engine.zone(1)) {
      const active = document.activeElement;
      steps.push(rail.contains(active) ? "colonna" : options.contains(active) ? "riga" : navigator?.contains(active) ? "navigatore" : "altro");
    }
    expect(steps.filter((step) => step !== "navigatore")).toEqual(["colonna", "riga"]);
    // Maiusc+F6 torna indietro fino alla lavagna, e da lì esce.
    let back = 0;
    while (back < 6 && document.activeElement !== viewportOf(host) && engine.zone(-1)) back++;
    expect(document.activeElement).toBe(viewportOf(host));
    expect(engine.zone(-1)).toBe(false);
    engine.destroy();
  });

  it("Maiusc+F10 sulla scheda raggiunta col Tab apre il suo menu", () => {
    const { engine, host } = mounted();
    viewportOf(host).focus();
    for (let i = 0; i < 3; i++) press(document.activeElement as HTMLElement, "Tab");
    expect(focusedCard()).toBe("t");
    // Maiusc+F10 non ha un punto: il menu è quello della scelta.
    const menu = engine.contextMenu(null)!;
    expect(menu.target).toMatchObject({ kind: "node", ref: "t", label: t("canvas_menu.header", { kind: t("canvas_menu.kind.text") }) });
    engine.destroy();
  });

  it("il nome della scheda col fuoco dice gruppo e fili; gli altri arrivano a thread libero, solo quando cambiano", async () => {
    const { engine, host } = mounted();
    cardOf(host, "w").focus();
    expect(cardOf(host, "w").getAttribute("aria-label")).toBe(`${webTitle}, ${t("canvas.a11y.in_group", { name: "Idee" })}.`);
    await vi.waitFor(() => expect(cardOf(host, "t").getAttribute("aria-label")).toBe(
      `${textTitle("vedi Altra e #tag")}, ${t("canvas.a11y.linked_one", { name: "foto.png, usa" })}.`,
    ));
    // Una resa senza un documento nuovo (la scelta che cambia) non riscrive i nomi.
    const writes: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const card = record.target as HTMLElement;
        if (card.classList.contains("canvas-node")) writes.push(card.dataset.node ?? "");
      }
    });
    observer.observe(host, { attributes: true, attributeFilter: ["aria-label"], subtree: true });
    run(engine, "canvas.select_all");
    run(engine, "canvas.escape");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes).toEqual([]);
    // Un filo nuovo cambia il nome delle due schede che tocca, e solo quello.
    engine.commitPatches([{ kind: "upsert-edge", before: null, after: { id: "e2", fromNode: "w", toNode: "t" } }]);
    expect(said(host)).toBe(t("canvas.a11y.linked_now", { from: webTitle, to: textTitle("vedi Altra e #tag") }));
    await vi.waitFor(() => expect(new Set(writes)).toEqual(new Set(["w", "t"])));
    observer.disconnect();
    engine.destroy();
  });

  it("con più schede di un passo il giro dei nomi riprende fino all'ultima", async () => {
    const nodes = Array.from({ length: 600 }, (_, i) => ({
      id: `n${i}`, type: "text", x: (i % 30) * 120, y: Math.floor(i / 30) * 80, width: 100, height: 60, text: `Scheda ${i}`,
    }));
    const { engine, host } = mounted(JSON.stringify({ nodes, edges: [] }));
    await vi.waitFor(() => expect(cardOf(host, "n599").getAttribute("aria-label")).toBe(`${textTitle("Scheda 599")}.`));
    expect(host.querySelectorAll(".canvas-node:not([aria-label])")).toHaveLength(0);
    engine.destroy();
  });
});

// --- «Apri a lato per questo» (T45) --------------------------------------------

describe("«Apri a lato per questo» (T45)", () => {
  const BOARD = [
    { id: "s", type: "file", x: 0, y: 0, width: 400, height: 200, file: "Conti/voti.xlsx" },
    { id: "n", type: "file", x: 0, y: 260, width: 400, height: 200, file: "Note/Fisica.md", subpath: "#Scopo" },
    { id: "p", type: "file", x: 460, y: 0, width: 300, height: 400, file: "Libri/manuale.pdf" },
    { id: "w", type: "file", x: 460, y: 460, width: 300, height: 200, file: "Note/Tutta.md" },
  ];

  /**
   * Le schede vive per le prove: il foglio e le note scrivono (`edit`), il
   * PDF dice la pagina che mostra; i contesti restano per rispondere come
   * risponderebbe la porta (`writing`).
   */
  function board(overrides: Partial<CanvasEngineOptions> = {}) {
    const contexts = new Map<string, CardContext>();
    let page = 3;
    const renderer: CardRenderer = {
      kinds: ["sheet", "note", "pdf"],
      mount(node, host, _mode, context): CardView {
        contexts.set(node.id, context);
        const cell = document.createElement("div");
        cell.className = "probe-cell";
        cell.tabIndex = -1;
        host.append(cell);
        const pdf = (node.file ?? "").endsWith(".pdf");
        return {
          setMode: () => {},
          enter: () => true,
          leave: () => {},
          ...(pdf ? { page: () => page } : { edit: () => true }),
          destroy: () => {},
        };
      },
    };
    const beside: string[] = [];
    const made = mounted(JSON.stringify({ nodes: BOARD, edges: [] }), {
      cards: { registry: createCardRegistry([renderer]), snapshots: new CardCache(), watch: () => () => {} },
      onOpenPathBeside: (path) => {
        beside.push(path);
      },
      ...overrides,
    });
    return { ...made, contexts, beside, turnTo: (n: number) => (page = n) };
  }

  const cardEl = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;

  /** Tab sulla scheda e Invio: si entra, e dove si scrive si scrive. */
  function enter(host: HTMLElement, id: string): void {
    const article = cardEl(host, id);
    article.focus();
    article.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }

  /** Il menu del tasto destro su `element`. */
  function menuOn(engine: CanvasEngine, element: Element) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  }

  const command = (engine: CanvasEngine) => engine.commands().find((one) => one.id === "canvas.open_beside_here")!;
  const rowButton = (host: HTMLElement) =>
    host.querySelector<HTMLButtonElement>('.canvas-options [data-option="beside"] [data-command="canvas.open_beside_here"]');

  it("da una cella che si scrive apre il foglio accanto su quella cella; il nome e il pulsante dicono la cella", () => {
    const { engine, host, contexts, beside } = board();
    expect(command(engine).disabled()).toBe(t("canvas.commands.why.no_active_card"));
    expect(rowButton(host)).toBeNull();
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "B3", formula: "=B1+B2" } });
    expect(command(engine).label).toBe("Apri a lato su B3");
    expect(command(engine).disabled()).toBeNull();
    // Nella riga delle opzioni, dopo la formula: il pulsante col nome scritto.
    const button = rowButton(host)!;
    expect(button.textContent).toBe("Apri a lato su B3");
    expect(button.hasAttribute("data-label")).toBe(true);
    const items = [...host.querySelectorAll<HTMLElement>(".canvas-options .canvas-options-item")]
      .filter((item) => item.parentElement?.closest(".canvas-options-item") === null)
      .map((item) => item.dataset.option);
    expect(items).toEqual(["formula", "beside"]);
    button.click();
    expect(beside).toEqual(["/Conti/voti.xlsx#B3"]);
    // Un'altra cella: il nome la segue.
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "C4", formula: "" } });
    expect(rowButton(host)!.textContent).toBe("Apri a lato su C4");
    engine.destroy();
  });

  it("col riquadro accanto già aperto porta lì il punto nuovo, ogni volta", () => {
    const { engine, host, contexts, beside } = board();
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "B3", formula: "" } });
    command(engine).run();
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "D7", formula: "" } });
    command(engine).run();
    // Lo stesso file col punto di adesso: chi apre a lato (la shell,
    // `onOpenPathBeside`) riceve ogni volta la cella nuova.
    expect(beside).toEqual(["/Conti/voti.xlsx#B3", "/Conti/voti.xlsx#D7"]);
    engine.destroy();
  });

  it("da una scheda di nota apre la sezione che mostra", () => {
    const { engine, host, contexts, beside } = board();
    enter(host, "n");
    contexts.get("n")!.writing?.({ toolbar: null });
    expect(command(engine).label).toBe("Apri a lato su «Scopo»");
    command(engine).run();
    expect(beside).toEqual(["/Note/Fisica.md#Scopo"]);
    engine.destroy();
  });

  it("da un PDF apre la pagina mostrata, e il nome segue la pagina", () => {
    const { engine, host, contexts, beside, turnTo } = board();
    enter(host, "p");
    expect(command(engine).label).toBe("Apri a lato alla pagina 3");
    expect(rowButton(host)!.textContent).toBe("Apri a lato alla pagina 3");
    turnTo(5);
    contexts.get("p")!.pageChanged?.(5);
    expect(rowButton(host)!.textContent).toBe("Apri a lato alla pagina 5");
    command(engine).run();
    expect(beside).toEqual(["/Libri/manuale.pdf#page=5"]);
    engine.destroy();
  });

  it("senza un punto apre il file com'è, col nome di sempre; uscendo il pulsante se ne va", () => {
    const { engine, host, beside } = board();
    enter(host, "w");
    expect(command(engine).label).toBe("Apri a lato per questo");
    command(engine).run();
    expect(beside).toEqual(["/Note/Tutta.md"]);
    expect(rowButton(host)).not.toBeNull();
    const body = cardEl(host, "w").querySelector<HTMLElement>(".canvas-card-body")!;
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.querySelector(".canvas-node[data-card-active]")).toBeNull();
    expect(rowButton(host)).toBeNull();
    expect(command(engine).disabled()).toBe(t("canvas.commands.why.no_active_card"));
    engine.destroy();
  });

  it("il tasto destro su una cella della scheda in scrittura ha in testa «Apri a lato» su quella cella", () => {
    const { engine, host, contexts, beside } = board();
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "B3", formula: "" } });
    const menu = menuOn(engine, cardEl(host, "s").querySelector(".probe-cell")!);
    const first = menu.context![0] as SurfaceMenuItem;
    expect(first.id).toBe("canvas.open_beside_here");
    expect(first.label).toBe("Apri a lato su B3");
    expect(first.enabled).toBe(true);
    expect(menu.context![1]).toBe(MENU_RULE);
    first.run!();
    expect(beside).toEqual(["/Conti/voti.xlsx#B3"]);
    // Sulla testata, fuori dal contenuto, resta il menu della scheda.
    const plain = menuOn(engine, cardEl(host, "s").querySelector(".canvas-node-handle")!);
    expect((plain.context ?? []).some((entry) => typeof entry !== "string" && entry.id === "canvas.open_beside_here")).toBe(false);
    engine.destroy();
  });

  it("nella finestra stretta apre nello stesso riquadro, come «Apri»; in sola lettura si apre lo stesso", () => {
    const opened: string[] = [];
    const { engine, host, contexts, beside } = board({
      onOpenPath: (path) => {
        opened.push(path);
      },
    });
    engine.setReadOnly(true);
    enter(host, "s");
    contexts.get("s")!.writing?.({ toolbar: null, context: { cell: "A1", formula: "" } });
    expect(command(engine).disabled()).toBeNull();
    expect(command(engine).label).toBe("Apri a lato su A1");
    host.querySelector(".canvas-surface")!.setAttribute("data-narrow", "");
    // Il nome dice che si apre qui, non a lato.
    expect(command(engine).label).toBe("Apri qui su A1");
    command(engine).run();
    expect(opened).toEqual(["/Conti/voti.xlsx#A1"]);
    expect(beside).toEqual([]);
    engine.destroy();
  });

  it("senza chi apre a lato la voce è spenta col perché", () => {
    const { engine, host } = board({ onOpenPathBeside: undefined });
    enter(host, "p");
    expect(command(engine).label).toBe("Apri a lato alla pagina 3");
    expect(command(engine).disabled()).toBe(t("canvas.commands.why.no_beside"));
    engine.destroy();
  });
});

describe("convertire (T70)", () => {
  /** Un tratto attaccato a una scheda, come lo scrive la penna. */
  const cardInk = (id: string) => ({ v: 1, strokes: [{ id, tool: "pen", brush: "pf1 size=3", color: "#0072b2", anchor: { kind: "card", width: 240, height: 140 }, ink: "1 s100 cxy 100,100 5,5" }] });

  /** Un testo con un titolo e l'inchiostro (`t`), una nota (`n`), un PDF alla pagina 2 con l'inchiostro (`p`), due fili. */
  const board = (noteHeight = 140) => JSON.stringify({
    nodes: [
      { id: "t", type: "text", x: 0, y: 0, width: 240, height: 140, color: "4", text: "# Idee per la gita\nportare il pranzo", "fub:ink": cardInk("s-t") },
      { id: "n", type: "file", x: 0, y: 400, width: 240, height: noteHeight, file: "Note/gita.md" },
      { id: "p", type: "file", x: 600, y: 0, width: 360, height: 480, file: "docs/manuale.pdf", subpath: "#page=2", "fub:ink": cardInk("s-p") },
    ],
    edges: [
      { id: "e1", fromNode: "t", toNode: "n" },
      { id: "e2", fromNode: "p", toNode: "t" },
    ],
  });

  /** La porta delle note finta: `taken` sono i nomi già presi nella cartella. */
  function notesPort(taken: readonly string[] = [], text = "testo della nota") {
    return {
      freeName: vi.fn(async (_folder: string, name: string) => {
        let free = name;
        for (let n = 1; taken.includes(free); n += 1) free = `${name} ${n}`;
        return free;
      }),
      create: vi.fn(async (folder: string, name: string, _text: string) => (folder ? `${folder}/${name}.md` : `${name}.md`)),
      read: vi.fn(async (_path: string) => text),
    };
  }

  function open(overrides: Partial<CanvasEngineOptions> = {}, source = board()) {
    const notes = notesPort();
    const made = mounted(source, { documentId: "Lavagne/gita.canvas", notes, ...overrides });
    return { ...made, notes: (overrides.notes ?? notes) as ReturnType<typeof notesPort> };
  }

  function choose(engine: CanvasEngine, host: HTMLElement, id: string) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`));
    try {
      return engine.contextMenu({ x: 10, y: 10 });
    } finally {
      pointing.mockRestore();
    }
  }

  function command(engine: CanvasEngine, id: string) {
    return engine.commands().find((one) => one.id === id)!;
  }

  function dialog(): HTMLElement {
    const all = document.querySelectorAll<HTMLElement>(".kit-dialog");
    return all[all.length - 1]!;
  }

  const nodes = (engine: CanvasEngine) => readCanvas(engine.getDoc()).nodes;
  const node = (engine: CanvasEngine, id: string) => nodes(engine).find((one) => one.id === id);
  const edges = (engine: CanvasEngine) => readCanvas(engine.getDoc()).edges.map((edge) => `${edge.fromNode}>${edge.toNode}`);

  beforeEach(() => {
    notices.notify.mockClear();
  });

  it("il nome proposto: la prima riga senza #, pulita come una nota nuova; vuota o di soli divieti, il nome di serie; al più 80", () => {
    expect(proposedNoteName("# Idee per la gita\naltro")).toBe("Idee per la gita");
    expect(proposedNoteName("### Titolo: a/b?")).toBe("Titolo a b");
    expect(proposedNoteName("#tag resta\n")).toBe("#tag resta");
    expect(proposedNoteName("")).toBe(t("canvas.extract.untitled"));
    expect(proposedNoteName("\nla seconda riga non conta")).toBe(t("canvas.extract.untitled"));
    expect(proposedNoteName("# ///")).toBe(t("canvas.extract.untitled"));
    expect(proposedNoteName("x".repeat(200))).toBe("x".repeat(80));
  });

  it("«Estrai in una nota»: chiede il nome (quello che c'è già diventa «nome 1»), la nota nasce col testo nella cartella della lavagna, la scheda la mostra allo stesso posto coi fili e l'inchiostro", async () => {
    const notes = notesPort(["Idee per la gita"]);
    const { engine, host, changes, opened } = open({ notes });
    choose(engine, host, "t");
    const before = node(engine, "t")!;
    command(engine, "canvas.extract_note").run();
    await vi.waitFor(() => expect(dialog().querySelector<HTMLInputElement>(".kit-field-input")?.value).toBe("Idee per la gita 1"));
    expect(notes.freeName).toHaveBeenCalledWith("Lavagne", "Idee per la gita");
    dialog().querySelector<HTMLButtonElement>('[data-action="extract"]')!.click();
    await vi.waitFor(() => expect(node(engine, "t")?.type).toBe("file"));
    expect(notes.create).toHaveBeenCalledWith("Lavagne", "Idee per la gita 1", "# Idee per la gita\nportare il pranzo");
    const after = node(engine, "t")!;
    expect(after).toMatchObject({ id: "t", type: "file", file: "Lavagne/Idee per la gita 1.md", x: before.x, y: before.y, width: before.width, height: before.height, color: "4" });
    expect(after.text).toBeUndefined();
    expect(after["fub:ink"]).toEqual(before["fub:ink"]);
    expect(edges(engine)).toEqual(["t>n", "p>t"]);
    expect(changes).toHaveLength(1);
    // La notifica dice che la nota resta, con «Apri».
    expect(notices.notify).toHaveBeenCalledTimes(1);
    const [message, , action] = notices.notify.mock.calls[0]!;
    expect(message).toBe(t("canvas.extract.done", { name: "Idee per la gita 1" }));
    expect((action as { label: string }).label).toBe(t("canvas.extract.open"));
    await (action as { run: () => Promise<void> | void }).run();
    expect(opened).toContainEqual({ path: "/Lavagne/Idee per la gita 1.md" });
    // Un annulla solo riporta la scheda di testo; la nota non si tocca.
    expect(engine.undo()).toBe(true);
    expect(node(engine, "t")).toEqual(before);
    expect(edges(engine)).toEqual(["t>n", "p>t"]);
    expect(notes.create).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("alla radice del vault la nota nasce alla radice; il nome si può cambiare, e si pulisce", async () => {
    const { engine, host, notes } = open({ documentId: "gita.canvas" });
    choose(engine, host, "t");
    command(engine, "canvas.extract_note").run();
    await vi.waitFor(() => expect(dialog().querySelector(".kit-field-input")).not.toBeNull());
    type(dialog().querySelector<HTMLInputElement>(".kit-field-input")!, "  Gita: il pranzo  ");
    dialog().querySelector<HTMLButtonElement>('[data-action="extract"]')!.click();
    await vi.waitFor(() => expect(notes.create).toHaveBeenCalledWith("", "Gita il pranzo", expect.any(String)));
    await vi.waitFor(() => expect(node(engine, "t")?.file).toBe("Gita il pranzo.md"));
    engine.destroy();
  });

  it("rinunciare al nome non crea niente e non cambia la lavagna", async () => {
    const { engine, host, notes, changes } = open();
    choose(engine, host, "t");
    command(engine, "canvas.extract_note").run();
    await vi.waitFor(() => expect(dialog().querySelector('[data-action="cancel"]')).not.toBeNull());
    dialog().querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notes.create).not.toHaveBeenCalled();
    expect(changes).toHaveLength(0);
    expect(node(engine, "t")?.type).toBe("text");
    engine.destroy();
  });

  it("«Copia il testo qui»: una scheda di testo col testo della nota accanto, scelta; la nota non cambia; un annulla", async () => {
    const { engine, host, notes, changes } = open();
    choose(engine, host, "n");
    command(engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(4));
    expect(notes.read).toHaveBeenCalledWith("Note/gita.md");
    expect(notes.create).not.toHaveBeenCalled();
    const copy = nodes(engine)[3]!;
    expect(copy).toMatchObject({ type: "text", text: "testo della nota", x: 240 + NEXT_CARD_GAP, y: 400, width: 240, height: 160 });
    expect(node(engine, "n")).toMatchObject({ type: "file", file: "Note/gita.md" });
    expect(engine.selectedText()?.primary).toBe("testo della nota");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(nodes(engine).map((one) => one.id)).toEqual(["t", "n", "p"]);
    engine.destroy();
  });

  it("«Copia il testo qui» su una scheda-estratto copia solo le sezioni mostrate; una sezione sparita non si copia e non è un errore (T99)", async () => {
    const text = "# Gita\nintro\n## Pranzo\npanini\n## Treno\nore 8\n## Ritorno\nsera\n";
    const excerptBoard = (sections: readonly string[]) => JSON.stringify({
      // Il `subpath` è la prima sezione, come la scrive la tela (T73).
      nodes: [{ id: "n", type: "file", x: 0, y: 400, width: 240, height: 140, file: "Note/gita.md", subpath: `#${sections[0]}`, "fub:parts": { kind: "sections", sections } }],
      edges: [],
    });
    // Il sommario del provider: i titoli col byte dove comincia la loro riga.
    const titles: [number, string][] = [[1, "Gita"], [2, "Pranzo"], [2, "Treno"], [2, "Ritorno"]];
    const headings = titles.map(([level, title]) => ({ level, text: title, start: text.indexOf(`${"#".repeat(level)} ${title}\n`) }));
    const outline = vi.fn(async (_path: string) => headings);
    const { engine, host } = open({ notes: notesPort([], text), parts: { outline } }, excerptBoard(["Ritorno", "Sparita", "Pranzo"]));
    choose(engine, host, "n");
    command(engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(2));
    expect(outline).toHaveBeenCalledWith("Note/gita.md");
    // Nell'ordine della scheda, senza la sezione che la nota non ha più.
    expect(nodes(engine)[1]).toMatchObject({ type: "text", text: "## Ritorno\nsera\n\n## Pranzo\npanini" });
    expect(host.querySelector(".canvas-intake-error")).toBeNull();
    engine.destroy();
    // Senza sommario (la porta manca, o la domanda fallisce) si copia la nota intera, come prima.
    for (const parts of [undefined, { outline: async () => Promise.reject(new Error("indice fermo")) }]) {
      const whole = open({ notes: notesPort([], text), ...(parts ? { parts } : {}) }, excerptBoard(["Ritorno"]));
      choose(whole.engine, whole.host, "n");
      command(whole.engine, "canvas.copy_note_text").run();
      await vi.waitFor(() => expect(nodes(whole.engine)).toHaveLength(2));
      expect(nodes(whole.engine)[1]).toMatchObject({ type: "text", text });
      whole.engine.destroy();
    }
    // Con tutte le sezioni sparite non nasce niente, e la lavagna dice quali mancano.
    const gone = open({ notes: notesPort([], text), parts: { outline } }, excerptBoard(["Sparita"]));
    choose(gone.engine, gone.host, "n");
    command(gone.engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(gone.host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.excerpt.section_missing", { name: "Sparita" })));
    expect(nodes(gone.engine)).toHaveLength(1);
    gone.engine.destroy();
  });

  it("una nota lunga nasce alta al più come la vista", async () => {
    const { engine, host } = open({}, board(5000));
    // Al 100%, subito: la vista (600 px di riserva in happy-dom) è alta 600 sulla lavagna.
    setReducedMotionPreference(true);
    command(engine, "canvas.zoom_reset").run();
    setReducedMotionPreference(false);
    choose(engine, host, "n");
    command(engine, "canvas.copy_note_text").run();
    await vi.waitFor(() => expect(nodes(engine)).toHaveLength(4));
    const copy = nodes(engine)[3]!;
    expect(copy.height).toBe(600);
    engine.destroy();
  });

  it("«Sostituisci il file…»: il selettore di sempre; la scheda tiene posto, misura, fili e inchiostro, e cambia specie; un annulla", async () => {
    const onPickFile = vi.fn(async () => "foto/gita.png");
    const { engine, host, changes } = open({ onPickFile });
    choose(engine, host, "p");
    const before = node(engine, "p")!;
    command(engine, "canvas.replace_file").run();
    await vi.waitFor(() => expect(node(engine, "p")?.file).toBe("foto/gita.png"));
    expect(onPickFile).toHaveBeenCalledWith();
    const after = node(engine, "p")!;
    expect(after).toMatchObject({ id: "p", type: "file", x: 600, y: 0, width: 360, height: 480 });
    // La pagina era del PDF; l'inchiostro attaccato resta nel file.
    expect(after.subpath).toBeUndefined();
    expect(after["fub:ink"]).toEqual(before["fub:ink"]);
    expect(edges(engine)).toEqual(["t>n", "p>t"]);
    expect(host.querySelector<HTMLElement>('.canvas-node[data-node="p"] .canvas-card-body')?.dataset.mediaKind).toBe("image");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(node(engine, "p")).toEqual(before);
    engine.destroy();
  });

  it("le voci stanno nel menu della scheda giusta, e in sola lettura sono spente col perché", () => {
    const { engine, host } = open({ onPickFile: async () => null });
    const ids = (id: string) => (choose(engine, host, id)!.context ?? []).flatMap((entry) => (typeof entry === "string" ? [] : [entry.id]));
    expect(ids("t")).toContain("canvas.extract_note");
    expect(ids("t")).not.toContain("canvas.copy_note_text");
    expect(ids("n")).toEqual(expect.arrayContaining(["canvas.copy_note_text", "canvas.replace_file"]));
    expect(ids("p")).toContain("canvas.replace_file");
    expect(ids("p")).not.toContain("canvas.copy_note_text");
    engine.setReadOnly(true);
    choose(engine, host, "t");
    for (const id of ["canvas.extract_note", "canvas.copy_note_text", "canvas.replace_file"]) {
      expect(command(engine, id).disabled()).toBe(t("canvas.commands.why.read_only"));
    }
    engine.destroy();
  });

  it("senza la porta delle note i due comandi non ci sono", () => {
    const { engine } = mounted(board());
    expect(engine.commands().some((one) => one.id === "canvas.extract_note" || one.id === "canvas.copy_note_text")).toBe(false);
    engine.destroy();
  });
});

// «Ritaglia e ruota» (T78): la zona di un'immagine è `fub:parts` `image` sulla
// scheda, scritto in un commit; Esc lascia com'era; il file dell'immagine non
// riceve mai una scrittura (la tela non ha una porta per scrivere nel file di
// una scheda d'immagine: le porte che toccano file restano ferme, e cambia
// solo il testo della lavagna).
describe("il ritaglio di un'immagine (T78)", () => {
  const lastMount = (board: { mounts: Array<{ id: string; parts: CardContext["parts"] }> }) => board.mounts[board.mounts.length - 1]!;
  const CROP_INK = {
    id: "s-1", tool: "pen",
    brush: "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
    color: "#0072b2", anchor: { kind: "card", width: 400, height: 300 },
    ink: "1 s100 cxy 4000,2500 120,40 95,-10",
  };

  function cropBoard(extra: Record<string, unknown> = {}, overrides: Partial<CanvasEngineOptions> = {}) {
    const mounts: Array<{ id: string; parts: CardContext["parts"] }> = [];
    const renderer: CardRenderer = {
      kinds: ["image"],
      mount(node, host, _mode, context): CardView {
        mounts.push({ id: node.id, parts: context.parts ?? null });
        const root = document.createElement("div");
        root.className = "canvas-card-image";
        root.dataset.cardState = "picture";
        // L'immagine intera è 400 × 300; una zona la scheda la dipinge tagliata.
        const canvas = document.createElement("canvas");
        canvas.className = "canvas-card-picture";
        canvas.width = context.parts ? 120 : 400;
        canvas.height = context.parts ? 90 : 300;
        root.append(canvas);
        host.append(root);
        return { setMode: () => {}, destroy: () => root.remove() };
      },
    };
    const writes = { trash: vi.fn(), replace: vi.fn(async () => null), attach: vi.fn() };
    const made = mounted(JSON.stringify({
      nodes: [
        { id: "f", type: "file", file: "allegati/foto.png", x: 0, y: 0, width: 400, height: 300, ...extra },
        { id: "t", type: "text", x: 600, y: 0, width: 200, height: 100, text: "accanto" },
      ],
      edges: [],
    }), {
      cards: { registry: createCardRegistry([renderer]), snapshots: new CardCache(), watch: () => () => {} },
      onTrashPath: writes.trash,
      onPickFile: writes.replace,
      ...overrides,
    });
    const pick = (id = "f") => {
      const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(made.host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`));
      try {
        return made.engine.contextMenu({ x: 10, y: 10 })!;
      } finally {
        pointing.mockRestore();
      }
    };
    const crop = () => made.engine.commands().find((one) => one.id === "canvas.crop")!;
    const card = () => made.host.querySelector<HTMLElement>('.canvas-node[data-node="f"]')!;
    const image = () => readCanvas(made.engine.getDoc()).nodes.find((one) => one.id === "f")!;
    const key = (target: Element, key: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    const box = () => card().querySelector<HTMLElement>(".canvas-crop-box")!;
    const barButton = (name: string) => made.host.querySelector<HTMLButtonElement>(`.canvas-crop-foot .canvas-crop-bar [data-crop="${name}"]`)!;
    return { ...made, mounts, writes, pick, crop, card, image, key, box, barButton };
  }

  it("la voce sta nel menu della scheda d'immagine dopo «Apri nel visore», in Ctrl+/ e nella barra della selezione", () => {
    const board = cropBoard();
    const items = (board.pick().context ?? []).filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    const ids = items.map((item) => item.id);
    expect(ids.indexOf("canvas.crop")).toBe(ids.indexOf("canvas.open_viewer") + 1);
    const entry = items.find((item) => item.id === "canvas.crop")!;
    expect(entry.label).toBe(t("canvas.crop"));
    expect(entry.icon).toBe("draw-image");
    expect(board.crop().disabled()).toBeNull();
    expect(board.crop().label).toBe(t("canvas.crop"));
    expect(board.host.querySelector('.canvas-selection-bar [data-command="canvas.crop"]')).not.toBeNull();
    // Su una scheda di testo la voce non c'è e il comando è spento col perché.
    const other = board.pick("t");
    expect((other.context ?? []).some((item) => typeof item !== "string" && item.id === "canvas.crop")).toBe(false);
    expect(board.crop().disabled()).toBe(t("canvas.commands.why.one_image"));
    board.engine.destroy();
  });

  it("in sola lettura la voce non c'è e il comando è spento; senza chi mostra le immagini il comando non c'è", () => {
    const board = cropBoard();
    board.engine.setReadOnly(true);
    const items = (board.pick().context ?? []).filter((entry): entry is SurfaceMenuItem => typeof entry !== "string");
    expect(items.some((item) => item.id === "canvas.crop")).toBe(false);
    expect(board.crop().disabled()).toBe(t("canvas.commands.why.read_only"));
    board.crop().run();
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    board.engine.destroy();

    const bare = mounted();
    expect(bare.engine.commands().some((one) => one.id === "canvas.crop")).toBe(false);
    bare.engine.destroy();
  });

  it("apre il ritaglio sopra la scheda: l'immagine intera, la zona, la barra; niente si scrive", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0.25, 0, 0.5, 1] } });
    board.pick();
    expect(lastMount(board).parts).toEqual({ kind: "image", rect: [0.25, 0, 0.5, 1], rotate: null, extra: {} });
    board.crop().run();
    // La vista si rimonta sull'immagine intera.
    expect(lastMount(board).parts).toBeNull();
    expect(board.card().hasAttribute("data-card-cropping")).toBe(true);
    expect(board.card().querySelector(".canvas-card-body > .canvas-crop .canvas-crop-box")).not.toBeNull();
    // La barra sta nella zona della vista che non scala, come quella della selezione.
    expect(board.host.querySelector(".canvas-area > .canvas-crop-foot > .canvas-crop-bar")).not.toBeNull();
    expect(board.card().querySelector(".canvas-crop-bar")).toBeNull();
    expect(document.activeElement).toBe(board.box());
    expect(board.changes).toHaveLength(0);
    board.engine.destroy();
  });

  it("«Fatto» scrive la zona e le proporzioni in un commit solo, che un annulla toglie; il file non si tocca", () => {
    const board = cropBoard();
    const before = board.image();
    board.pick();
    board.crop().run();
    // La zona di serie è tutta l'immagine: la si stringe dall'angolo in basso a destra, poi si ruota.
    for (let i = 0; i < 5; i += 1) board.key(board.box(), "ArrowLeft", { altKey: true, shiftKey: true });
    board.barButton("rotate-right").click();
    board.barButton("done").click();
    expect(board.changes).toHaveLength(1);
    const after = board.image();
    expect(after["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 0.5, 1], rotate: 90 });
    expect(after.subpath).toBeUndefined();
    expect(after.file).toBe("allegati/foto.png");
    // La zona è 200 × 300 px; ruotata 300 × 200: la scheda tiene i 400 di
    // larghezza e prende 400 × 200 / 300.
    expect(after).toMatchObject({ x: 0, y: 0, width: 400, height: 267 });
    expect(board.card().hasAttribute("data-card-cropping")).toBe(false);
    expect(board.host.querySelector(".canvas-crop, .canvas-crop-foot")).toBeNull();
    // La scheda mostra la zona.
    expect(lastMount(board).parts).toEqual({ kind: "image", rect: [0, 0, 0.5, 1], rotate: 90, extra: {} });
    expect(board.engine.undo()).toBe(true);
    expect(board.image()).toEqual(before);
    // Ciò che cambia è solo la lavagna: nessuna porta che tocca file si è mossa.
    expect(board.writes.trash).not.toHaveBeenCalled();
    expect(board.writes.replace).not.toHaveBeenCalled();
    expect(board.changes.every((change) => readCanvas(change.text).nodes.some((one) => one.id === "f"))).toBe(true);
    board.engine.destroy();
  });

  it("Invio scrive come «Fatto»; un clic fuori dal ritaglio lo applica", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    board.key(board.box(), "ArrowUp", { altKey: true, shiftKey: true });
    board.key(board.box(), "Enter");
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 1, 0.9] });
    expect(board.changes).toHaveLength(1);

    board.pick();
    board.crop().run();
    // Riaperto, la zona è quella scritta.
    board.key(board.box(), "ArrowUp", { altKey: true, shiftKey: true });
    board.host.querySelector(".canvas-viewport")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 900, clientY: 900 }));
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 1, 0.8] });
    expect(board.changes).toHaveLength(2);
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    board.engine.destroy();
  });

  it("Esc lascia com'era: niente commit, la scheda torna alla sua zona e alla sua altezza", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0.25, 0, 0.5, 1] }, height: 600 });
    const before = board.image();
    board.pick();
    board.crop().run();
    // Intanto la scheda mostra l'immagine intera (400 × 300) alla sua larghezza.
    expect(board.card().style.height).toBe("300px");
    board.barButton("rotate-left").click();
    expect(board.card().style.height).toBe("533px");
    board.key(board.box(), "ArrowRight");
    board.key(board.box(), "Escape");
    expect(board.changes).toHaveLength(0);
    expect(board.image()).toEqual(before);
    expect(board.card().style.height).toBe("600px");
    expect(board.card().querySelector(".canvas-crop")).toBeNull();
    expect(lastMount(board).parts).toEqual({ kind: "image", rect: [0.25, 0, 0.5, 1], rotate: null, extra: {} });
    // Esc sulla lavagna, col fuoco fuori dal ritaglio, fa lo stesso.
    board.crop().run();
    board.key(board.host.querySelector(".canvas-viewport")!, "Escape");
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    expect(board.changes).toHaveLength(0);
    board.engine.destroy();
  });

  it("«Togli il ritaglio» torna all'immagine intera in un commit, e la scheda tiene il resto", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0.25, 0, 0.5, 1], rotate: 90, "x-mio": 1 }, height: 600, color: "4" });
    board.pick();
    board.crop().run();
    board.barButton("remove").click();
    expect(board.changes).toHaveLength(1);
    const after = board.image();
    expect(after["fub:parts"]).toBeUndefined();
    expect(after).toMatchObject({ width: 400, height: 300, color: "4" });
    expect(lastMount(board).parts).toBeNull();
    expect(board.engine.undo()).toBe(true);
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0.25, 0, 0.5, 1], rotate: 90, "x-mio": 1 });
    board.engine.destroy();
  });

  it("i campi sconosciuti di una zona valida restano quando la si cambia", () => {
    const board = cropBoard({ "fub:parts": { kind: "image", rect: [0, 0, 0.5, 1], "x-mio": { a: 1 } } });
    board.pick();
    board.crop().run();
    board.key(board.box(), "ArrowRight", { shiftKey: true });
    board.key(board.box(), "Enter");
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0.1, 0, 0.5, 1], "x-mio": { a: 1 } });
    board.engine.destroy();
  });

  it("con l'inchiostro sulla scheda il piede dice che il tratto resta attaccato, e il tratto non si tocca", () => {
    const board = cropBoard({ "fub:ink": { v: 1, strokes: [CROP_INK] } });
    board.pick();
    board.crop().run();
    expect(board.host.querySelector(".canvas-crop-foot > .canvas-crop-note")?.textContent).toBe(t("canvas.crop.ink"));
    board.key(board.box(), "ArrowLeft", { altKey: true, shiftKey: true });
    board.barButton("done").click();
    expect(board.image()["fub:ink"]).toEqual({ v: 1, strokes: [CROP_INK] });
    board.engine.destroy();
  });

  it("si chiude da sé, senza scrivere, se la lavagna diventa di sola lettura o la scheda sparisce", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    board.engine.setReadOnly(true);
    expect(board.host.querySelector(".canvas-crop")).toBeNull();
    expect(board.changes).toHaveLength(0);
    board.engine.setReadOnly(false);
    board.pick();
    board.crop().run();
    expect(board.host.querySelector(".canvas-crop")).not.toBeNull();
    board.engine.setDoc(JSON.stringify({ nodes: [{ id: "t", type: "text", x: 600, y: 0, width: 200, height: 100, text: "accanto" }], edges: [] }));
    expect(board.host.querySelector(".canvas-crop, .canvas-crop-foot")).toBeNull();
    board.engine.destroy();
  });

  it("un'immagine che non si legge non si ritaglia", () => {
    const board = cropBoard();
    board.card().querySelector<HTMLElement>(".canvas-card-image")!.dataset.cardState = "unreadable";
    board.pick();
    expect(board.crop().disabled()).toBe(t("canvas.crop.why.unreadable"));
    board.engine.destroy();
  });

  /** La camera dello stage: `translate(x, y) scale(zoom)`. */
  function cropCamera(host: HTMLElement): { x: number; y: number; zoom: number } {
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform)!;
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }
  /** Uno scatto della rotella (di serie sposta la lavagna). */
  function cropScroll(host: HTMLElement, deltaY: number): void {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
    Object.defineProperties(event, { clientX: { value: 300 }, clientY: { value: 200 } });
    host.querySelector(".canvas-viewport")!.dispatchEvent(event);
  }
  /** Dove la barra del ritaglio deve stare, con la camera di adesso (happy-dom: il piede misura 0, la vista 800 × 600). */
  function cropFootAt(host: HTMLElement, height: number): { left: number; top: number } {
    const camera = cropCamera(host);
    return selectionBarPlaceBelow(
      { left: camera.x, top: camera.y, right: camera.x + 400 * camera.zoom, bottom: camera.y + height * camera.zoom },
      { width: 0, height: 0 },
      { width: 800, height: 600 },
    )!;
  }

  it("a zoom basso la barra non scala: sta nella zona della vista, posata sotto la scheda come la barra della selezione", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    const viewport = board.host.querySelector<HTMLElement>(".canvas-viewport")!;
    for (let i = 0; i < 40 && cropCamera(board.host).zoom > 0.35; i += 1) {
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true, bubbles: true, cancelable: true }));
    }
    expect(cropCamera(board.host).zoom).toBeLessThanOrEqual(0.35);
    const foot = board.host.querySelector<HTMLElement>(".canvas-crop-foot")!;
    // Fuori dallo stage che scala: la sua misura sullo schermo è la stessa a ogni zoom.
    expect(foot.closest(".canvas-stage")).toBeNull();
    expect(foot.parentElement!.classList.contains("canvas-area")).toBe(true);
    const at = cropFootAt(board.host, 300);
    expect([parseFloat(foot.style.left), parseFloat(foot.style.top)]).toEqual([at.left, at.top]);
    // Sotto la scheda, che sullo schermo è alta 300 × zoom.
    const camera = cropCamera(board.host);
    expect(parseFloat(foot.style.top)).toBeGreaterThan(camera.y + 300 * camera.zoom);
    board.engine.destroy();
  });

  it("con la scheda che esce dal fondo della vista la barra va sopra; ruotata in verticale resta nella vista", () => {
    const board = cropBoard();
    board.pick();
    board.crop().run();
    // La scheda scende finché la sua testa sta a 400 px: il fondo esce dalla vista di 600.
    cropScroll(board.host, cropCamera(board.host).y - 400);
    const camera = cropCamera(board.host);
    expect(camera.y).toBe(400);
    expect(camera.y + 300 * camera.zoom).toBeGreaterThan(600);
    const foot = board.host.querySelector<HTMLElement>(".canvas-crop-foot")!;
    expect(parseFloat(foot.style.top)).toBeLessThan(400);
    expect(parseFloat(foot.style.top)).toBe(cropFootAt(board.host, 300).top);
    // Un quarto di giro: la scheda si allunga (400 × 533), la barra resta sopra, dentro la vista.
    board.barButton("rotate-right").click();
    expect(board.card().style.height).toBe("533px");
    expect(parseFloat(foot.style.top)).toBe(cropFootAt(board.host, 533).top);
    expect(parseFloat(foot.style.top)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(foot.style.top)).toBeLessThan(400);
    // Tutta fuori, sotto: la barra resta al fondo della vista, e «Fatto» si preme.
    cropScroll(board.host, -400);
    expect(cropCamera(board.host).y).toBe(800);
    expect(parseFloat(foot.style.top)).toBe(592);
    board.barButton("done").click();
    expect(board.image()["fub:parts"]).toEqual({ kind: "image", rect: [0, 0, 1, 1], rotate: 90 });
    board.engine.destroy();
  });
});

describe("CanvasEngine: la misura e l'allineamento del testo (T92)", () => {
  /// Due schede di testo (la seconda al centro), una di file, un gruppo.
  const SOURCE = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
      { id: "b", type: "text", x: 300, y: 0, width: 200, height: 100, text: "due", "fub:text": { v: 1, align: "center" } },
      { id: "f", type: "file", x: 600, y: 0, width: 200, height: 100, file: "Nota.md" },
      { id: "g", type: "group", x: 0, y: 300, width: 400, height: 200, label: "Idee" },
    ],
    edges: [],
  });
  const command = (engine: CanvasEngine, id: string) => engine.commands().find((one) => one.id === id)!;
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;
  const field = (engine: CanvasEngine, id: string): unknown => nodeOf(engine, id)[TEXT_FIELD];
  const has = (engine: CanvasEngine, id: string): boolean => Object.prototype.hasOwnProperty.call(nodeOf(engine, id), TEXT_FIELD);
  const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  function select(host: HTMLElement, id: string): void {
    card(host, id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0 }));
    host.querySelector(".canvas-viewport")!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  it("la scheda si mostra col suo campo; senza campo, o di serie, non si segna", () => {
    const { engine, host } = mounted(SOURCE);
    expect(card(host, "a").dataset.textSize).toBeUndefined();
    expect(card(host, "a").dataset.textAlign).toBeUndefined();
    expect(card(host, "b").dataset.textAlign).toBe("center");
    expect(card(host, "b").dataset.textSize).toBeUndefined();
    expect(card(host, "f").dataset.textAlign).toBeUndefined();
    engine.destroy();
  });

  it("su più schede scelte: un commit e un annulla; ognuna tiene l'altro valore suo, il testo e le altre schede non cambiano", () => {
    const { engine, host, changes } = mounted(SOURCE);
    const before = engine.getDoc();
    command(engine, "canvas.select_all").run();
    expect(command(engine, "canvas.text_size.l").disabled()).toBeNull();
    command(engine, "canvas.text_size.l").run();
    expect(changes).toHaveLength(1);
    expect(field(engine, "a")).toEqual({ v: 1, size: "l" });
    expect(field(engine, "b")).toEqual({ v: 1, size: "l", align: "center" });
    expect(has(engine, "f")).toBe(false);
    expect(has(engine, "g")).toBe(false);
    expect(readCanvas(engine.getDoc()).nodes.map((node) => node.text)).toEqual(["uno", "due", undefined, undefined]);
    expect(card(host, "a").dataset.textSize).toBe("l");
    expect(card(host, "b").dataset.textSize).toBe("l");
    command(engine, "canvas.text_align.end").run();
    expect(changes).toHaveLength(2);
    expect(field(engine, "a")).toEqual({ v: 1, size: "l", align: "end" });
    expect(field(engine, "b")).toEqual({ v: 1, size: "l", align: "end" });
    // Un annulla per cambio, su tutte le schede insieme.
    expect(engine.undo()).toBe(true);
    expect(field(engine, "a")).toEqual({ v: 1, size: "l" });
    expect(field(engine, "b")).toEqual({ v: 1, size: "l", align: "center" });
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(before);
    expect(card(host, "a").dataset.textSize).toBeUndefined();
    engine.destroy();
  });

  it("tornati ai valori di serie il campo sparisce dal file; lo stesso valore non scrive niente", () => {
    const { engine, host, changes } = mounted(SOURCE);
    select(host, "b");
    command(engine, "canvas.text_align.center").run();
    expect(changes).toHaveLength(0);
    command(engine, "canvas.text_align.start").run();
    expect(changes).toHaveLength(1);
    expect(has(engine, "b")).toBe(false);
    expect(engine.getDoc()).not.toContain(TEXT_FIELD);
    expect(card(host, "b").dataset.textAlign).toBeUndefined();
    engine.destroy();
  });

  it("un campo di una versione futura si mostra di serie e resta finché non si cambia; allora si riscrive alla versione 1", () => {
    const future = JSON.stringify({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno", "fub:text": { v: 2, size: "huge", ink: true } }],
      edges: [],
    });
    const { engine, host, changes } = mounted(future);
    expect(card(host, "a").dataset.textSize).toBeUndefined();
    select(host, "a");
    command(engine, "canvas.text_size.m").run();
    command(engine, "canvas.text_align.start").run();
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(future);
    command(engine, "canvas.text_size.s").run();
    expect(field(engine, "a")).toEqual({ v: 1, size: "s" });
    engine.destroy();
  });

  it("una scheda di file o un gruppo: i controlli sono spenti col perché; e in sola lettura", () => {
    const { engine, host } = mounted(SOURCE);
    for (const id of ["f", "g"]) {
      select(host, id);
      expect(command(engine, "canvas.text_size.l").disabled(), id).toBe(t("canvas.commands.why.no_text_card"));
      expect(command(engine, "canvas.text_align.center").disabled(), id).toBe(t("canvas.commands.why.no_text_card"));
    }
    select(host, "a");
    engine.setReadOnly(true);
    expect(command(engine, "canvas.text_size.l").disabled()).toBe(t("canvas.commands.why.read_only"));
    const before = engine.getDoc();
    command(engine, "canvas.text_size.l").run();
    expect(engine.getDoc()).toBe(before);
    engine.destroy();
  });

  it("lo strumento Testo: la misura e l'allineamento scelti vanno sulle schede che nascono", () => {
    const { engine, host, changes } = mounted(SOURCE);
    command(engine, "canvas.tool.text").run();
    expect(command(engine, "canvas.text_size.xl").disabled()).toBeNull();
    command(engine, "canvas.text_size.xl").run();
    command(engine, "canvas.text_align.center").run();
    // Senza schede scelte la scelta non scrive niente.
    expect(changes).toHaveLength(0);
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 4, clientX: 900, clientY: 600 }));
    expect(changes).toHaveLength(1);
    const born = readCanvas(engine.getDoc()).nodes.find((node) => !["a", "b", "f", "g"].includes(node.id))!;
    expect(born.type).toBe("text");
    expect(born[TEXT_FIELD]).toEqual({ v: 1, size: "xl", align: "center" });
    engine.destroy();
  });
});

describe("la scheda-estratto (T75)", () => {
  const BOARD = [
    { id: "x", type: "file", x: 0, y: 0, width: 280, height: 220, file: "Note/Relazione.md", subpath: "#Scopo", "fub:parts": { kind: "sections", sections: ["Scopo", "Capitolo#Misure"] } },
    { id: "w", type: "file", x: 400, y: 0, width: 280, height: 220, file: "Note/Tutta.md" },
  ];

  /** La lavagna con una scheda-estratto e una nota intera; i contesti delle viste restano. */
  function board(overrides: Partial<CanvasEngineOptions> = {}) {
    const contexts = new Map<string, CardContext>();
    const renderer: CardRenderer = {
      kinds: ["note"],
      mount(node, _host, _mode, context): CardView {
        contexts.set(node.id, context);
        return { setMode: () => {}, destroy: () => {} };
      },
    };
    const beside: string[] = [];
    const made = mounted(JSON.stringify({ nodes: BOARD, edges: [] }), {
      cards: { registry: createCardRegistry([renderer]), snapshots: new CardCache(), watch: () => () => {} },
      onOpenPathBeside: (path) => {
        beside.push(path);
      },
      ...overrides,
    });
    return { ...made, contexts, beside };
  }

  const cardEl = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const head = (host: HTMLElement, id: string) => cardEl(host, id).querySelector<HTMLElement>(":scope > .canvas-node-handle")!;
  const node = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((one) => one.id === id)!;
  function menuOn(engine: CanvasEngine, element: Element) {
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    try {
      return engine.contextMenu({ x: 10, y: 10 })!;
    } finally {
      pointing.mockRestore();
    }
  }
  const ids = (entries: readonly unknown[]): string[] =>
    entries.flatMap((one) => (one && typeof one === "object" && "id" in one ? [(one as SurfaceMenuItem).id] : []));

  it("la testata sopra la scheda dice le parti in colore d'accento e porta ↗; la nota intera no", () => {
    const { engine, host } = board();
    const parts = head(host, "x").querySelector(".canvas-excerpt-parts")!;
    expect(parts.textContent).toBe("§ Scopo · § Misure");
    expect(head(host, "x").querySelector(".canvas-excerpt-open")!.getAttribute("aria-label")).toBe(t("canvas.excerpt.open", { name: "Relazione" }));
    expect(cardEl(host, "x").dataset.cardExcerpt).toBe("sections");
    expect(head(host, "w").querySelector(".canvas-excerpt-parts, .canvas-excerpt-open")).toBeNull();
    expect(cardEl(host, "w").hasAttribute("data-card-excerpt")).toBe(false);
    engine.destroy();
  });

  it("↗ apre la fonte accanto alla prima sezione; Ctrl+clic (Cmd+clic) nel riquadro; la scheda non cambia", () => {
    const { engine, host, beside, opened, changes } = board();
    const open = head(host, "x").querySelector<HTMLButtonElement>(".canvas-excerpt-open")!;
    // Il tasto giù su ↗ non trascina né apre un giro della lavagna.
    open.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, ctrlKey: true }));
    open.click();
    expect(beside).toEqual(["/Note/Relazione.md#Scopo"]);
    open.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    open.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(opened).toEqual([{ path: "/Note/Relazione.md#Scopo" }, { path: "/Note/Relazione.md#Scopo" }]);
    expect(beside).toHaveLength(1);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("il doppio clic sulla testata apre la fonte accanto; quello sul corpo no", () => {
    const { engine, host, beside, changes } = board();
    head(host, "x").querySelector(".canvas-node-title")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(beside).toEqual(["/Note/Relazione.md#Scopo"]);
    // Il doppio clic su ↗ è già il suo clic: niente seconda apertura.
    head(host, "x").querySelector(".canvas-excerpt-open")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    cardEl(host, "x").querySelector(".canvas-card-body")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    // La testata di una nota intera non apre niente.
    head(host, "w").querySelector(".canvas-node-title")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(beside).toEqual(["/Note/Relazione.md#Scopo"]);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("«Mostra tutto il file», sotto «Parti…» e in Ctrl+/, toglie `fub:parts` e il `subpath` in un solo annulla", () => {
    const { engine, host, changes } = board({ parts: { outline: async () => [] } });
    const menu = menuOn(engine, cardEl(host, "x"));
    const context = ids(menu.context ?? []);
    expect(context.indexOf("canvas.whole_file")).toBe(context.indexOf("canvas.parts") + 1);
    const command = engine.commands().find((one) => one.id === "canvas.whole_file")!;
    expect(command.label).toBe(t("canvas.excerpt.whole"));
    expect(command.disabled()).toBeNull();
    command.run();
    expect(changes).toHaveLength(1);
    const whole = node(engine, "x");
    expect(whole.subpath).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(whole, "fub:parts")).toBe(false);
    expect(head(host, "x").querySelector(".canvas-excerpt-parts")).toBeNull();
    // Ora è la nota intera: il comando è spento, col perché.
    expect(command.disabled()).toBe(t("canvas.commands.why.one_excerpt"));
    expect(engine.undo()).toBe(true);
    const back = node(engine, "x");
    expect(back.subpath).toBe("#Scopo");
    expect(back["fub:parts"]).toEqual({ kind: "sections", sections: ["Scopo", "Capitolo#Misure"] });
    expect(head(host, "x").querySelector(".canvas-excerpt-parts")!.textContent).toBe("§ Scopo · § Misure");
    // Su una nota intera la voce non c'è.
    expect(ids(menuOn(engine, cardEl(host, "w")).context ?? [])).not.toContain("canvas.whole_file");
    engine.destroy();
  });

  it("l'avviso della sezione persa ha i gesti della tela: «Scegli di nuovo…» riapre il selettore, «Mostra tutta la nota» è un commit", async () => {
    const outline = vi.fn(async () => [{ level: 1, text: "Scopo" }, { level: 1, text: "Calcoli" }]);
    const { engine, contexts, changes } = board({ parts: { outline } });
    const actions = contexts.get("x")!.excerpt!;
    expect(contexts.get("w")!.excerpt).toBeUndefined();
    actions.chooseAgain!();
    await vi.waitFor(() => expect(document.querySelector(".canvas-parts-picker")).not.toBeNull());
    expect(outline).toHaveBeenCalledWith("Note/Relazione.md");
    actions.showWhole();
    expect(changes).toHaveLength(1);
    expect(node(engine, "x").subpath).toBeUndefined();
    engine.destroy();
  });

  it("in sola lettura si legge: niente «Mostra tutto il file» nel menu, il comando spento, l'avviso senza gesti", () => {
    const { engine, host, contexts, changes } = board({ parts: { outline: async () => [] } });
    engine.setReadOnly(true);
    expect(ids(menuOn(engine, cardEl(host, "x")).context ?? [])).not.toContain("canvas.whole_file");
    const command = engine.commands().find((one) => one.id === "canvas.whole_file")!;
    expect(command.disabled()).toBe(t("canvas.commands.why.read_only"));
    command.run();
    // La vista si rimonta senza i gesti dell'avviso; ↗ resta, per leggere la fonte.
    expect(contexts.get("x")!.excerpt).toBeUndefined();
    expect(head(host, "x").querySelector(".canvas-excerpt-open")).not.toBeNull();
    expect(changes).toHaveLength(0);
    engine.destroy();
  });
});

describe("il lettore: Spazio toccato su una nota (T76)", () => {
  const BOARD = [
    { id: "x", type: "file", x: 0, y: 0, width: 280, height: 220, file: "Note/Relazione.md", subpath: "#Misure" },
    { id: "w", type: "file", x: 400, y: 0, width: 280, height: 220, file: "Note/Tutta.md" },
    { id: "t", type: "text", x: 0, y: 400, width: 200, height: 80, text: "Un testo" },
  ];
  const HEADINGS = [
    { level: 1, text: "Relazione" },
    { level: 2, text: "Scopo" },
    { level: 2, text: "Misure" },
    { level: 2, text: "Errori" },
  ];

  function board(overrides: Partial<CanvasEngineOptions> = {}) {
    const renderer: CardRenderer = {
      kinds: ["note"],
      mount: (): CardView => ({ setMode: () => {}, destroy: () => {} }),
    };
    const watchers = new Map<string, () => void>();
    const outline = vi.fn(async (_path: string) => HEADINGS);
    const show = vi.fn(async (_path: string, _heading: string | null, host: HTMLElement) => {
      for (const heading of HEADINGS) {
        const h = document.createElement(`h${heading.level}`);
        h.textContent = heading.text;
        const p = document.createElement("p");
        p.textContent = `Testo di ${heading.text}.`;
        host.append(h, p);
      }
    });
    const made = mounted(JSON.stringify({ nodes: BOARD, edges: [] }), {
      cards: {
        registry: createCardRegistry([renderer]),
        snapshots: new CardCache(),
        watch: (path, changed) => {
          watchers.set(path, changed);
          return () => watchers.delete(path);
        },
      },
      parts: { outline, show },
      ...overrides,
    });
    return { ...made, outline, show, watchers };
  }

  const viewportOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const card = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const reader = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-area > .canvas-reader");
  const cameraOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const node = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((one) => one.id === id)!;

  function select(host: HTMLElement, ...ids: string[]): void {
    ids.forEach((id, at) => {
      card(host, id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 0, clientY: 0, shiftKey: at > 0 }));
      viewportOf(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0, shiftKey: at > 0 }));
    });
  }

  function space(target: EventTarget, type: "keydown" | "keyup", timeStamp: number, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    target.dispatchEvent(event);
    return event;
  }

  /** Spazio giù e su sulla scheda `id`, a `ms` di distanza. */
  function tap(host: HTMLElement, id: string, ms: number): void {
    space(card(host, id), "keydown", 1000);
    space(card(host, id), "keyup", 1000 + ms);
  }

  it("Spazio toccato entro 0,3 s con una nota scelta apre il lettore sopra l'area; oltre 0,3 s no", async () => {
    const { engine, host, show } = board();
    select(host, "x");
    tap(host, "x", 400);
    expect(reader(host)).toBeNull();
    tap(host, "x", 299);
    const open = reader(host)!;
    expect(open).not.toBeNull();
    expect(open.getAttribute("role")).toBe("dialog");
    expect(open.contains(document.activeElement)).toBe(true);
    await vi.waitFor(() => expect(open.querySelector(".canvas-reader-section[data-in-excerpt]")?.getAttribute("data-section")).toBe("Misure"));
    expect(show).toHaveBeenCalledWith("Note/Relazione.md", null, expect.any(HTMLElement), expect.anything());
    // Una ripetizione del sistema non è un tocco nuovo: il lettore aperto resta uno.
    expect(host.querySelectorAll(".canvas-reader")).toHaveLength(1);
    engine.destroy();
    expect(reader(host)).toBeNull();
  });

  it("niente lettore senza una sola nota scelta, col puntatore che si muove, o da un tasto ripetuto", () => {
    const { engine, host } = board();
    // Niente scelto.
    space(viewportOf(host), "keydown", 1000);
    space(viewportOf(host), "keyup", 1100);
    expect(reader(host)).toBeNull();
    // Due schede.
    select(host, "x", "w");
    expect(engine.selection().nodes).toEqual(["x", "w"]);
    tap(host, "x", 100);
    expect(reader(host)).toBeNull();
    // Una scheda di testo.
    select(host, "t");
    tap(host, "t", 100);
    expect(reader(host)).toBeNull();
    // Il puntatore si muove mentre Spazio è giù.
    select(host, "x");
    space(card(host, "x"), "keydown", 1000);
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 120, clientY: 100 }));
    space(card(host, "x"), "keyup", 1100);
    expect(reader(host)).toBeNull();
    // Il primo tasto giù è un'eco del sistema (`repeat`): niente tocco.
    space(card(host, "x"), "keydown", 1000, { repeat: true });
    space(card(host, "x"), "keyup", 1100);
    expect(reader(host)).toBeNull();
    // Il puntatore che trema di un pixel è ancora fermo.
    space(card(host, "x"), "keydown", 1000);
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 121, clientY: 101 }));
    viewportOf(host).dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 122, clientY: 100 }));
    space(card(host, "x"), "keyup", 1100);
    expect(reader(host)).not.toBeNull();
    engine.destroy();
  });

  it("Spazio tenuto sposta la vista subito, come prima: niente lettore anche se lasciato presto", () => {
    const { engine, host } = board();
    select(host, "x");
    const viewport = viewportOf(host);
    const start = cameraOf(host);
    space(card(host, "x"), "keydown", 1000);
    expect(viewport.hasAttribute("data-space-pan")).toBe(true);
    viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: 100, clientY: 100 }));
    viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: 160, clientY: 130 }));
    // La vista si è già mossa, prima che Spazio torni su.
    expect(cameraOf(host)).not.toBe(start);
    viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: 160, clientY: 130 }));
    space(card(host, "x"), "keyup", 1200);
    expect(viewport.hasAttribute("data-space-pan")).toBe(false);
    expect(reader(host)).toBeNull();
    expect(engine.selection().nodes).toEqual(["x"]);
    engine.destroy();
  });

  it("Esc o Spazio chiudono il lettore: la vista, la scelta e il fuoco sulla scheda sono quelli di prima", async () => {
    const { engine, host, changes } = board();
    select(host, "x");
    card(host, "x").focus();
    const camera = cameraOf(host);
    tap(host, "x", 100);
    const open = reader(host)!;
    await vi.waitFor(() => expect(open.querySelector(".canvas-reader-section")).not.toBeNull());
    expect(document.activeElement).not.toBe(card(host, "x"));
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(reader(host)).toBeNull();
    expect(cameraOf(host)).toBe(camera);
    expect(engine.selection().nodes).toEqual(["x"]);
    expect(document.activeElement).toBe(card(host, "x"));
    // Di nuovo, e Spazio lo chiude.
    tap(host, "x", 100);
    const again = reader(host)!;
    const doc = again.querySelector<HTMLElement>(".canvas-reader-doc")!;
    space(doc, "keydown", 5000);
    space(doc, "keyup", 5050);
    expect(reader(host)).toBeNull();
    expect(cameraOf(host)).toBe(camera);
    expect(engine.selection().nodes).toEqual(["x"]);
    expect(document.activeElement).toBe(card(host, "x"));
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("«+ Aggiungi all'estratto» scrive le sezioni su `fub:parts` in un commit; il lettore si aggiorna", async () => {
    const { engine, host, changes } = board();
    select(host, "x");
    tap(host, "x", 100);
    const open = reader(host)!;
    await vi.waitFor(() => expect(open.querySelector('.canvas-reader-section[data-section="Errori"]')).not.toBeNull());
    open.querySelector<HTMLElement>('.canvas-reader-outline-row[data-index="3"]')!.click();
    const add = open.querySelector<HTMLButtonElement>('.canvas-reader-section[data-section="Errori"] > .canvas-reader-add')!;
    add.click();
    expect(changes).toHaveLength(1);
    expect(node(engine, "x").subpath).toBe("#Misure");
    expect(node(engine, "x")["fub:parts"]).toEqual({ kind: "sections", sections: ["Misure", "Errori"] });
    expect(open.querySelector('.canvas-reader-section[data-section="Errori"]')!.hasAttribute("data-in-excerpt")).toBe(true);
    expect(open.querySelector(".canvas-reader-add")).toBeNull();
    // Un annulla riporta la sezione sola, e il lettore lo segue.
    engine.undo();
    expect(node(engine, "x")["fub:parts"]).toBeUndefined();
    expect(open.querySelector('.canvas-reader-section[data-section="Errori"]')!.hasAttribute("data-in-excerpt")).toBe(false);
    engine.destroy();
  });

  it("su una nota intera e in sola lettura si legge e basta; la scheda tolta chiude il lettore", async () => {
    const { engine, host, changes } = board();
    select(host, "w");
    tap(host, "w", 100);
    const whole = reader(host)!;
    await vi.waitFor(() => expect(whole.querySelector(".canvas-reader-section")).not.toBeNull());
    whole.querySelector<HTMLElement>('.canvas-reader-outline-row[data-index="3"]')!.click();
    expect(whole.querySelector(".canvas-reader-add")).toBeNull();
    whole.querySelector<HTMLElement>(".canvas-parts-close")!.click();
    select(host, "x");
    engine.setReadOnly(true);
    tap(host, "x", 100);
    const readOnly = reader(host)!;
    await vi.waitFor(() => expect(readOnly.querySelector(".canvas-reader-section")).not.toBeNull());
    readOnly.querySelector<HTMLElement>('.canvas-reader-outline-row[data-index="3"]')!.click();
    expect(readOnly.querySelector(".canvas-reader-add")).toBeNull();
    // La scheda che se ne va (un riquadro, un annulla) chiude il lettore.
    engine.setReadOnly(false);
    engine.setDoc(JSON.stringify({ nodes: BOARD.filter((one) => one.id !== "x"), edges: [] }));
    expect(reader(host)).toBeNull();
    expect(changes).toHaveLength(0);
    engine.destroy();
  });
});
