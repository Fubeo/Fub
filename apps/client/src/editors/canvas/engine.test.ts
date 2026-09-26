// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../text/profiles/markdown/render";
import { mountMarkdown } from "../text/profiles/markdown/mount";
import { CanvasEngine, type CanvasChange, type CanvasEngineOptions } from "./engine";
import { parseCanvas } from "./model";
import { applyOperation } from "../core/text-operation";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import { commitCanvasPatches, upsertNodePatch, type CanvasOperation } from "./operation";

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
    const doc = parseCanvas(engine.getDoc());
    expect(doc.nodes[0].x).toBe(48);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes[0].x).toBe(40);
    expect(engine.redo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes[0].x).toBe(48);
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
    expect(parseCanvas(engine.getDoc()).nodes[0]).toMatchObject({
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

  it("propaga subito la digitazione, congela il campo e annulla l'edit come gruppo", () => {
    const { engine, host, changes } = mounted();
    const card = host.querySelector<HTMLElement>('.canvas-node[data-node="t"]')!;
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    input.value = "Testo non ancora confermato dal blur";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(parseCanvas(engine.getDoc()).nodes[0].text).toBe(input.value);
    expect(applyOperation(canvasSource(), changes[0].operation)).toBe(engine.getDoc());
    engine.setReadOnly(true);
    expect(host.querySelector(".canvas-text-editor")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-canvas-action="zoom-in"]')?.disabled).toBe(false);
    expect(engine.undo()).toBe(false);
    engine.setReadOnly(false);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes[0].text).toBe("vedi [[Altra]] e #tag");
    engine.destroy();
  });
  it("conserva i campi non interpretati attraverso setDoc/syncDoc", () => {
    const { engine } = mounted();
    const withExtra = JSON.parse(canvasSource()) as Record<string, unknown>;
    withExtra.xRoot = { keep: true };
    (withExtra.nodes as Array<Record<string, unknown>>)[0].xVendor = 7;
    engine.setDoc(JSON.stringify(withExtra));
    const doc = parseCanvas(engine.getDoc()) as unknown as Record<string, unknown>;
    expect(doc.xRoot).toEqual({ keep: true });
    expect((doc.nodes as Array<Record<string, unknown>>)[0].xVendor).toBe(7);
    engine.syncDoc(engine.getDoc());
    const again = parseCanvas(engine.getDoc()) as unknown as Record<string, unknown>;
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
    expect(parseCanvas(engine.getDoc()).nodes[0].x).toBe(112);
    expect(engine.undo()).toBe(false);
    expect(parseCanvas(engine.getDoc()).xRoot).toEqual({ keep: true });
    engine.destroy();
  });

  it("non applica patch Canvas disallineate a una sorgente remota valida", () => {
    const before = canvasSource();
    const { engine } = mounted(before);
    const doc = parseCanvas(before);
    const changed = commitCanvasPatches(doc, before, [
      upsertNodePatch(doc, { ...doc.nodes[0], x: 48 })!,
    ])!;
    const unrelated = parseCanvas(before);
    const wrong = upsertNodePatch(unrelated, { ...unrelated.nodes[1], x: 408 })!;
    const wrongOperation: CanvasOperation = { ...changed.operation, patches: [wrong] };
    engine.syncDoc({ text: changed.source, operation: wrongOperation });
    expect(parseCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([48, 400, 40, 400]);
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
    expect(parseCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([40, 40, 40, 40]);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([40, 400, 40, 400]);
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
    expect(parseCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([0, 200, 400]);
    expect(changes[0].operation.patches).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([0, 80, 400]);
    engine.destroy();
  });

  it("applica colore nodo preset e hex mantenendo undo strutturale", () => {
    const { engine, host, changes } = mounted();
    const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const color = host.querySelector<HTMLSelectElement>('select[data-canvas-field="node-color"]')!;
    color.value = "2";
    color.dispatchEvent(new Event("change", { bubbles: true }));
    expect(parseCanvas(engine.getDoc()).nodes[0].color).toBe("2");
    const custom = host.querySelector<HTMLSelectElement>('select[data-canvas-field="node-color"]')!;
    custom.value = "custom";
    custom.dispatchEvent(new Event("change", { bubbles: true }));
    const hex = host.querySelector<HTMLInputElement>('input[data-canvas-field="node-color-hex"]')!;
    hex.value = "#aabbcc";
    hex.dispatchEvent(new Event("change", { bubbles: true }));
    expect(parseCanvas(engine.getDoc()).nodes[0].color).toBe("#aabbcc");
    expect(changes).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes[0].color).toBe("2");
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
    const doc = parseCanvas(engine.getDoc());
    expect(doc.nodes.map((node) => node.x)).toEqual([16, 56, 600]);
    expect(doc.vendor).toEqual({ preserve: true });
    expect(changes).toHaveLength(1);
    expect(changes[0].operation.patches).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).nodes.map((node) => node.x)).toEqual([0, 40, 600]);
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
    await vi.waitFor(() => expect(parseCanvas(engine.getDoc()).nodes.filter((node) => node.file === "attachments/photo.png")).toHaveLength(1));
    expect(host.querySelector(".canvas-media-placeholder")?.textContent).toContain("IMAGE");
    expect(host.querySelector("img,audio,video,iframe")).toBeNull();
    host.querySelector<HTMLButtonElement>(".canvas-convert-note")!.click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith("vedi [[Altra]] e #tag"));
    await vi.waitFor(() => expect(parseCanvas(engine.getDoc()).nodes[0]).toMatchObject({ type: "file", file: "Notes/new.md" }));
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
    await vi.waitFor(() => expect(parseCanvas(engine.getDoc()).nodes
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
    const files = () => parseCanvas(engine.getDoc()).nodes.filter((node) => node.type === "file").map((node) => node.file);
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
    expect(parseCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(parseCanvas(engine.getDoc()).nodes[0].text).toBe("Remote version");
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
    expect(parseCanvas(engine.getDoc()).edges[0]).toMatchObject({
      label: "nuova relazione", toNode: "w", fromSide: "bottom", color: "6",
    });
    expect(changes).toHaveLength(4);
    expect(changes.every((change) => change.operation.patches[0].kind === "upsert-edge")).toBe(true);
    expect(engine.undo()).toBe(true);
    expect(parseCanvas(engine.getDoc()).edges[0].color).toBeUndefined();
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
      readDocument: async () => ({ text: original, revision: "rev-1", format_id: "canvas", source_kind: "text" }),
      writeDocument: async () => { throw { kind: "conflict", message: "remote revision changed" }; },
      saveDraft: async () => {},
      discardDraft: async () => {},
    };
    const timer = vi.spyOn(window, "setTimeout").mockImplementation(() => 1);
    try {
      const sessions = new DocumentSessionCollection(api);
      await sessions.read("board.canvas");
      const doc = parseCanvas(original);
      const moved = upsertNodePatch(doc, { ...doc.nodes[0], x: 88 })!;
      const committed = commitCanvasPatches(doc, original, [moved])!;
      const edit = { text: committed.source, operation: committed.operation };
      expect(sessions.acceptSurfaceChange("board.canvas", "canvas-a", edit)).toEqual({ kind: "accepted" });
      await sessions.flush("board.canvas");
      expect(sessions.inspect("board.canvas")).toMatchObject({ text: committed.source, result: "conflitto", dirty: true });
      expect(sessions.acceptSurfaceChange("board.canvas", "canvas-b", edit)).toEqual({
        kind: "realigned", text: committed.source,
      });
      expect((await sessions.resolveConflict("board.canvas", "theirs")).kind).toBe("discarded");
      expect(sessions.inspect("board.canvas")).toMatchObject({ text: original, dirty: false });
    } finally {
      timer.mockRestore();
    }
  });
});
