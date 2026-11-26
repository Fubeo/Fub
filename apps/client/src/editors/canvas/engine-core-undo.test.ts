// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: il nucleo che arriva, l'annulla, la lavagna aperta ma non riscritta (R3).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { CanvasEngine, MAX_CANVAS_HISTORY, type CanvasChange, type CanvasCorePort } from "./engine";
import { applyOperation, lineFeeds, operationFromText } from "../core/text-operation";
import { t } from "../../i18n/strings";
import blankBomCrlf from "../../__fixtures__/canvas-patches/02-blank-bom-crlf.json";
import rootWithoutNodes from "../../__fixtures__/canvas-patches/12-root-without-nodes.json";
import prettyNode from "../../__fixtures__/canvas-patches/14-remove-pretty-node-undo-compacts.json";
import nodesNull from "../../__fixtures__/canvas-patches/19-nodes-null.json";
import knownNumberForms from "../../__fixtures__/canvas-patches/22-known-number-forms.json";
import duplicateUnknownKey from "../../__fixtures__/canvas-patches/32-rejected-duplicate-unknown-key.json";
import nestedDuplicate from "../../__fixtures__/canvas-patches/33-rejected-nested-duplicate.json";
import { canvasCoreReady, openCoreNow } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { canvasSource, mounted, openField, press, readCanvas, type } from "./engine-test-support";

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

afterEach(() => {
  document.body.replaceChildren();
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
    // «Aggiungi testo» apre la scheda in scrittura, e lasciata vuota se ne va
    // (IMP-042, IMP-043, le prove in `engine-collaudo.test.ts`): qui l'indirizzo.
    ["aggiungere", (_engine, host) => action(host, "add-link")],
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
