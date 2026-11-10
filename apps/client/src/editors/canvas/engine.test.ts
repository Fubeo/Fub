// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { renderMarkdown } from "../text/profiles/markdown/render";
import { mountMarkdown } from "../text/profiles/markdown/mount";
import { CARD_PAUSE_MS, CanvasEngine, MAX_CANVAS_HISTORY, MEASURE_IMAGE_TIMEOUT_MS, type CanvasChange, type CanvasCorePort, type CanvasEngineOptions } from "./engine";
import type { CanvasDocument } from "./model";
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
import { upsertNodePatch, type CanvasOperation, type CanvasPatch } from "./operation";
import { CanvasCoreError, canvasCoreReady, openCore, openCoreNow, type CanvasCore, type CanvasIntentOp } from "./wasm/core";

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

function mounted(source = canvasSource(), overrides: Partial<CanvasEngineOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const opened: Array<{ page?: string; path?: string; url?: string; note?: string }> = [];
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
    onCreateNote: (initialText) => {
      opened.push({ note: initialText });
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
    expect(menu.target).toEqual({ kind: "node", ref: "f" });
    expect(host.querySelector('.canvas-node[data-node="f"]')!.classList.contains("selected")).toBe(true);
    const items = menu.context as readonly SurfaceMenuItem[];
    expect(items.map((item) => item.id)).toEqual(["canvas.open", "canvas.color", "canvas.duplicate", "canvas.order", "canvas.fit_selection", "canvas.delete"]);
    items[0]!.run!();
    expect(opened).toContainEqual({ path: "/allegati/foto.png" });
    (items[1]!.items as readonly SurfaceMenuItem[]).find((item) => item.id === "canvas.color.4")!.run!();
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
    host.querySelector<HTMLButtonElement>('[data-canvas-action="left"]')!.click();
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
    host.querySelector<HTMLButtonElement>('[data-canvas-action="distribute-x"]')!.click();
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
    const color = host.querySelector<HTMLSelectElement>('select[data-canvas-field="node-color"]')!;
    color.value = "2";
    color.dispatchEvent(new Event("change", { bubbles: true }));
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("2");
    const custom = host.querySelector<HTMLSelectElement>('select[data-canvas-field="node-color"]')!;
    custom.value = "custom";
    custom.dispatchEvent(new Event("change", { bubbles: true }));
    const hex = host.querySelector<HTMLInputElement>('input[data-canvas-field="node-color-hex"]')!;
    hex.value = "#aabbcc";
    hex.dispatchEvent(new Event("change", { bubbles: true }));
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("#aabbcc");
    expect(changes).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes[0].color).toBe("2");
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
      attachments: { deposit }, onCreateNote: create,
    });
    const clipboard = new Event("paste", { bubbles: true, cancelable: true });
    const file = new File(["image"], "photo.png", { type: "image/png" });
    Object.defineProperty(clipboard, "clipboardData", { value: {
      files: [file], getData: () => "",
    } });
    host.querySelector(".canvas-viewport")!.dispatchEvent(clipboard);
    await vi.waitFor(() => expect(deposit).toHaveBeenCalledWith([file], "board.canvas"));
    await vi.waitFor(() => expect(readCanvas(engine.getDoc()).nodes.filter((node) => node.file === "attachments/photo.png")).toHaveLength(1));
    expect(host.querySelector(".canvas-media-placeholder")?.textContent).toContain("IMAGE");
    expect(host.querySelector("img,audio,video,iframe")).toBeNull();
    host.querySelector<HTMLButtonElement>(".canvas-convert-note")!.click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith("vedi [[Altra]] e #tag"));
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
    const color = host.querySelector<HTMLSelectElement>('select[data-canvas-field="edge-color"]')!;
    color.value = "6";
    color.dispatchEvent(new Event("change", { bubbles: true }));
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

  it("Invio in una scheda di testo va a capo e registra; Ctrl+Invio e Cmd+Invio registrano e chiudono (A15)", () => {
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
    expect(changes).toHaveLength(2);
    expect(cardText(engine)).toBe("Riga\ndue");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    input = openField(host, "t");
    type(input, "Riga\ndue\ntre");
    press(input, "Enter", { metaKey: true });
    expect(changes).toHaveLength(3);
    expect(cardText(engine)).toBe("Riga\ndue\ntre");
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
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
    for (const name of ["add-text", "add-link", "add-group", "duplicate", "delete", "bring-front", "send-back"]) {
      expect(button(host, name).disabled, name).toBe(true);
    }
    // Guardare resta: la camera non cambia il testo.
    expect(button(host, "zoom-in").disabled).toBe(false);
    expect(button(host, "fit").disabled).toBe(false);
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
