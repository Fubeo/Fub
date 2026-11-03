// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuItem } from "../core/editor-menu";
import { renderMarkdown } from "../text/profiles/markdown/render";
import { mountMarkdown } from "../text/profiles/markdown/mount";
import { CARD_PAUSE_MS, CanvasEngine, type CanvasChange, type CanvasCorePort, type CanvasEngineOptions } from "./engine";
import type { CanvasDocument } from "./model";
import { applyOperation, lineFeeds, operationFromText } from "../core/text-operation";
import { t } from "../../i18n/strings";
import agentBoard from "../../__fixtures__/canvas-ops/agent-board.json";
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
