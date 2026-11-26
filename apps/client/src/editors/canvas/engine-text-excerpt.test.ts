// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: misura e allineamento del testo (T92), la scheda-estratto (T75), il lettore (T76).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { CanvasEngine, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import { TEXT_KEY as TEXT_FIELD } from "./text-style";
import { canvasCoreReady } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { createCardRegistry, type CardContext, type CardRenderer, type CardView } from "../core/cards/contract";
import { CardCache } from "./card-cache";
import { mounted, readCanvas } from "./engine-test-support";

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
