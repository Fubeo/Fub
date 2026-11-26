// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { renderMarkdown } from "../text/profiles/markdown/render";
import { CARD_PAUSE_MS, CanvasEngine, type CanvasDepositCards } from "./engine";
import type { CanvasDocument } from "./model";
import { applyOperation, lineFeeds, operationFromText } from "../core/text-operation";
import { t } from "../../i18n/strings";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import { upsertNodePatch, type CanvasOperation, type CanvasPatch } from "./operation";
import { canvasCoreReady, openCoreNow } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { canvasSource, mounted, openField, readCanvas, type } from "./engine-test-support";

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
    expect(items.map((item) => item.id)).toEqual(["canvas.open_viewer", "canvas.connect", "canvas.color", "canvas.arrange", "canvas.duplicate", "canvas.copy_code", "canvas.paste_code", "canvas.delete"]);
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
