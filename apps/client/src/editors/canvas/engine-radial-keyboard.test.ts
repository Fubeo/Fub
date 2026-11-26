// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: il menu radiale e i gesti (T63), tastiera e lettore di schermo (T61).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type SurfaceMenuItem } from "../core/editor-menu";
import { CanvasEngine } from "./engine";
import { t } from "../../i18n/strings";
import { canvasCoreReady } from "./wasm/core";
import { DEFAULT_PREFERENCES, type CanvasPreferences } from "./preferences";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { canvasSource, mounted, openField, press, readCanvas } from "./engine-test-support";

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
