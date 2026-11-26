// @vitest-environment happy-dom
// Le prove di `CanvasEngine`: menu, barra, campi, tasti e gesti scrivono con le operazioni (T23, T24).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasEngine, eraseAlongSegments, erasePathPieces, type CanvasCorePort, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import { CanvasCoreError, canvasCoreReady, openCoreNow, type CanvasIntentOp } from "./wasm/core";
import { type CanvasPreferences } from "./preferences";
import { toolCommandId } from "./chrome/commands";
import { setReducedMotionPreference } from "../../theme/reduced-motion";
import { quantizeInk, type InkSample } from "../../ink/sample";
import { encodeInk, inkFromQuantized } from "../spatial/ink/codec";
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

describe("menu, barra, campi e tasti scrivono con le operazioni (T23)", () => {
  /** Due schede di testo collegate, e una terza a parte. */
  function linked(): string {
    return JSON.stringify({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 240, height: 160, text: "uno" },
        { id: "b", type: "text", x: 400, y: 0, width: 240, height: 160, text: "due" },
        { id: "c", type: "text", x: 0, y: 400, width: 240, height: 160, text: "tre" },
      ],
      edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", label: "segue" }],
    });
  }

  function viewport(host: HTMLElement): HTMLElement {
    return host.querySelector<HTMLElement>(".canvas-viewport")!;
  }

  function pick(host: HTMLElement, id: string, additive = false): void {
    host.querySelector(`.canvas-node[data-node="${id}"]`)!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, shiftKey: additive, clientX: 0, clientY: 0 }),
    );
    viewport(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function chooseEdge(host: HTMLElement, id: string): void {
    const picker = host.querySelector<HTMLSelectElement>('select[data-canvas-field="select-edge"]')!;
    picker.value = id;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function press(host: HTMLElement, init: KeyboardEventInit): void {
    viewport(host).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  }

  function command(engine: CanvasEngine, id: string) {
    return engine.commands().find((one) => one.id === id)!;
  }

  it("Ctrl+D copia anche i fili fra le schede copiate (D1), e un annulla toglie tutto", () => {
    const source = linked();
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    pick(host, "a");
    pick(host, "b", true);
    pick(host, "c", true);
    press(host, { key: "d", ctrlKey: true });
    const after = readCanvas(engine.getDoc());
    expect(after.nodes).toHaveLength(6);
    expect(after.edges).toHaveLength(2);
    const copies = after.nodes.slice(3).map((node) => node.id);
    const copied = after.edges[1]!;
    // Il filo nuovo va fra le copie di a e b, con l'etichetta e i lati di e1.
    expect([copied.fromNode, copied.toNode]).toEqual([copies[0], copies[1]]);
    expect(copied).toMatchObject({ fromSide: "right", toSide: "left", label: "segue" });
    // Le copie restano scelte, e sono le schede (non il filo).
    expect(host.querySelectorAll(".canvas-node.selected")).toHaveLength(3);
    expect(changes).toHaveLength(1);
    engine.undo();
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("col seme dato, una scheda del menu ha l'id che il nucleo dà con quel seme", () => {
    const source = linked();
    const { engine } = mounted(source, { seed: () => 7n });
    const add = command(engine, "canvas.add.text");
    const ops = add.op!();
    expect(ops).toEqual([expect.objectContaining({ op: "add_card", text: "", width: 320, height: 160 })]);
    add.run();
    const core = openCoreNow(source)!;
    const expected = core.preview(core.compile(ops!, 7n).patches);
    core.close();
    expect(engine.getDoc()).toBe(expected);
    // L'id viene dal seme: sedici cifre esadecimali, non più `n-…`.
    expect(readCanvas(engine.getDoc()).nodes[3]!.id).toMatch(/^[0-9a-f]{16}$/);
    engine.destroy();
  });

  it("senza scelta i comandi delle schede sono spenti e non hanno operazioni", () => {
    const source = linked();
    const { engine, host } = mounted(source);
    for (const id of ["canvas.duplicate", "canvas.delete", "canvas.bring_front", "canvas.color.1", "canvas.align.left"]) {
      expect(command(engine, id).disabled(), id).not.toBeNull();
      expect(command(engine, id).op!(), id).toBeNull();
    }
    press(host, { key: "d", ctrlKey: true });
    press(host, { key: "Delete" });
    press(host, { key: "ArrowRight" });
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("due azioni sono due passi d'annulla", () => {
    const source = linked();
    const { engine, host, changes } = mounted(source);
    pick(host, "a");
    command(engine, "canvas.color.2").run();
    press(host, { key: "ArrowRight" });
    expect(changes).toHaveLength(2);
    expect(readCanvas(engine.getDoc()).nodes[0]).toMatchObject({ x: 8, color: "2" });
    engine.undo();
    expect(readCanvas(engine.getDoc()).nodes[0]).toMatchObject({ x: 0, color: "2" });
    engine.undo();
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("un campo che il nucleo rifiuta non scrive niente: torna al valore del modello, e la barra lo dice", () => {
    const source = linked();
    const { engine, host, changes } = mounted(source);
    chooseEdge(host, "e1");
    const to = host.querySelector<HTMLSelectElement>('[data-canvas-field="edge-toNode"]')!;
    // Una scheda che non c'è: la `set` che la nomina è rifiutata.
    const ghost = document.createElement("option");
    ghost.value = "fantasma";
    to.append(ghost);
    to.value = "fantasma";
    to.dispatchEvent(new Event("change", { bubbles: true }));
    expect(engine.getDoc()).toBe(source);
    expect(changes).toHaveLength(0);
    expect(host.querySelector<HTMLSelectElement>('[data-canvas-field="edge-toNode"]')!.value).toBe("b");
    expect(host.querySelector(".canvas-intake-error")?.textContent).toBe(t("canvas.change_refused"));
    engine.destroy();
  });

  it("l'operazione d'un comando è quella che scrive: il colore «Altro…», le frecce, il gruppo", () => {
    const { engine, host } = mounted(linked());
    pick(host, "a");
    pick(host, "c", true);
    expect(command(engine, "canvas.color.other").op!({ value: "#0064b0" })).toEqual([
      { op: "color", ids: ["a", "c"], color: "#0064b0" },
    ]);
    expect(command(engine, "canvas.color.other").op!()).toBeNull();
    expect(command(engine, "canvas.nudge.right").op!()).toEqual([{ op: "move", ids: ["a", "c"], dx: 8, dy: 0 }]);
    expect(command(engine, "canvas.group").op!()).toEqual([{ op: "group", ids: ["a", "c"] }]);
    engine.destroy();
  });
});

describe("le correzioni di T23: la GUI scrive come prima", () => {
  /** Tre schede, una col colore e una con un campo sconosciuto, e due fili. */
  const SOURCE = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 40, y: 40, width: 240, height: 140, text: "Prima", color: "2" },
      { id: "b", type: "text", x: 400, y: 104, width: 240, height: 140, text: "Seconda", vendor: { keep: true } },
      { id: "f", type: "file", x: 40, y: 320, width: 240, height: 140, file: "Corsi/voti.xlsx" },
    ],
    edges: [{ id: "e1", fromNode: "a", toNode: "b", toEnd: "arrow", label: "poi" }, { id: "e2", fromNode: "b", toNode: "f" }],
  });
  /** L'id che il nucleo dà alla prima scheda nata con il seme 1. */
  const BORN = "910a2dec89025cc1";
  /** I nodi e i fili di `SOURCE` come li scrive la tela, per i testi attesi. */
  const NODE_A = '{"id":"a","type":"text","x":40,"y":40,"width":240,"height":140,"text":"Prima","color":"2"}';
  const NODE_B = '{"id":"b","type":"text","x":400,"y":104,"width":240,"height":140,"text":"Seconda","vendor":{"keep":true}}';
  const NODE_F = '{"id":"f","type":"file","x":40,"y":320,"width":240,"height":140,"file":"Corsi/voti.xlsx"}';
  const EDGES = '[{"id":"e1","fromNode":"a","toNode":"b","toEnd":"arrow","label":"poi"},{"id":"e2","fromNode":"b","toNode":"f"}]';
  const bornText = (x: number, y: number, text: string) =>
    `{"nodes":[${NODE_A},${NODE_B},${NODE_F},{"id":"${BORN}","type":"text","x":${x},"y":${y},"width":320,"height":160,"text":"${text}"}],"edges":${EDGES}}`;

  const viewport = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;

  function pick(host: HTMLElement, id: string, additive = false): void {
    host.querySelector(`.canvas-node[data-node="${id}"]`)!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, shiftKey: additive, clientX: 0, clientY: 0 }),
    );
    viewport(host).dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
  }

  function press(host: HTMLElement, init: KeyboardEventInit): void {
    viewport(host).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  }

  function chooseEdge(host: HTMLElement, id: string): void {
    const picker = host.querySelector<HTMLSelectElement>('select[data-canvas-field="select-edge"]')!;
    picker.value = id;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function cut(host: HTMLElement): void {
    const values: Record<string, string> = {};
    const data = {
      values, files: [], items: [],
      get types() { return Object.keys(values); },
      getData: (type: string) => values[type] ?? "",
      setData: (type: string, value: string) => { values[type] = value; },
    } as unknown as DataTransfer;
    const event = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    viewport(host).focus();
    viewport(host).dispatchEvent(event);
  }

  const command = (engine: CanvasEngine, id: string) => engine.commands().find((one) => one.id === id)!;

  /** Il nucleo vero, che rifiuta i commit, o le compilazioni che `compile` sceglie. */
  function refusingCore(refuse: { commit?: boolean; compile?: (ops: readonly CanvasIntentOp[]) => boolean }): CanvasCorePort {
    return {
      ready: canvasCoreReady,
      openNow: (text) => {
        const core = openCoreNow(text);
        if (!core) return null;
        return new Proxy(core, {
          get(target, key, receiver) {
            if (key === "commit" && refuse.commit) {
              return () => {
                throw new CanvasCoreError("limit", "troppo grande");
              };
            }
            const chosen = refuse.compile;
            if (key === "compile" && chosen) {
              return (ops: readonly CanvasIntentOp[], seed?: bigint) => {
                if (chosen(ops)) throw new CanvasCoreError("rejected", "rifiutata");
                return target.compile(ops, seed);
              };
            }
            const value = Reflect.get(target, key, receiver) as unknown;
            // I metodi del nucleo leggono i suoi campi privati: si chiamano su di lui.
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
      },
    };
  }

  it("Ctrl+G su una scheda fuori dalla griglia: i bordi del gruppo si agganciano uno per uno, come prima (304×104)", () => {
    const source = JSON.stringify({ nodes: [{ id: "a", type: "text", text: "x", x: -125, y: -60, width: 250, height: 60 }], edges: [] });
    const { engine, host } = mounted(source, { seed: () => 1n });
    pick(host, "a");
    press(host, { key: "g", ctrlKey: true });
    const group = readCanvas(engine.getDoc()).nodes.find((node) => node.type === "group")!;
    expect([group.x, group.y, group.width, group.height]).toEqual([-152, -80, 304, 104]);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("Ctrl+D ripetuto: la prima copia si aggancia, le altre ripetono lo spostamento senza aggancio, come prima (T68)", () => {
    const source = JSON.stringify({ nodes: [{ id: "a", type: "text", text: "x", x: 13, y: 5, width: 200, height: 100 }], edges: [] });
    const { engine, host, changes } = mounted(source, { seed: () => 1n });
    pick(host, "a");
    for (let i = 0; i < 3; i++) press(host, { key: "d", ctrlKey: true });
    expect(readCanvas(engine.getDoc()).nodes.map((node) => [node.x, node.y])).toEqual([[13, 5], [48, 40], [83, 75], [118, 110]]);
    expect(changes).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  });

  it("«Inverti il filo» tiene le punte sulla loro scheda (#353) e scrive con `reverse`", () => {
    const { engine, host } = mounted(SOURCE, { seed: () => 1n });
    chooseEdge(host, "e1");
    expect(command(engine, "canvas.edge.reverse").op!()).toEqual([{ op: "reverse", ids: ["e1"] }]);
    command(engine, "canvas.edge.reverse").run();
    expect(readCanvas(engine.getDoc()).edges[0]).toEqual({ id: "e1", fromNode: "b", fromEnd: "arrow", toNode: "a", toEnd: "none", label: "poi" });
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  it("«Collega…» sceglie i lati coi punti di mezzo più vicini, non coi centri", () => {
    const source = JSON.stringify({
      nodes: [
        { id: "t2", type: "text", text: "Ripasso", x: 400, y: 0, width: 320, height: 160 },
        { id: "f1", type: "text", text: "Voti", x: 0, y: 400, width: 480, height: 304 },
      ],
      edges: [],
    });
    const { engine, host } = mounted(source, { seed: () => 1n });
    pick(host, "t2");
    pick(host, "f1", true);
    command(engine, "canvas.connect").run();
    expect(readCanvas(engine.getDoc()).edges[0]).toMatchObject({ fromNode: "t2", toNode: "f1", fromSide: "left", toSide: "top", toEnd: "arrow" });
    engine.destroy();
  });

  it("un campo della barra che il commit rifiuta (un limite) torna al valore del modello", () => {
    const { engine, host, changes } = mounted(SOURCE, { core: refusingCore({ commit: true }) });
    chooseEdge(host, "e1");
    const label = host.querySelector<HTMLInputElement>('[data-canvas-field="edge-label"]')!;
    label.value = "dopo";
    label.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(host.querySelector<HTMLInputElement>('[data-canvas-field="edge-label"]')!.value).toBe("poi");
    engine.destroy();
  });

  it("«Estrai in una nota» che il nucleo rifiuta dà un avviso solo, quello che dice che la nota c'è", async () => {
    notices.notify.mockClear();
    const notes = {
      freeName: vi.fn(async (_folder: string, name: string) => name),
      create: vi.fn(async (_folder: string, name: string) => `${name}.md`),
      read: vi.fn(async () => ""),
    };
    const core = refusingCore({ compile: (ops) => ops.some((op) => op.op === "convert") });
    const { engine, host, changes } = mounted(SOURCE, { notes, core });
    pick(host, "a");
    command(engine, "canvas.extract_note").run();
    const dialog = () => [...document.querySelectorAll<HTMLElement>(".kit-dialog")].pop()!;
    await vi.waitFor(() => expect(dialog().querySelector('[data-action="extract"]')).not.toBeNull());
    dialog().querySelector<HTMLButtonElement>('[data-action="extract"]')!.click();
    await vi.waitFor(() => expect(notices.notify).toHaveBeenCalledTimes(1));
    expect(notices.notify.mock.calls[0]![0]).toBe(t("canvas.extract.stale", { name: "Prima" }));
    expect(host.querySelector(".canvas-intake-error")?.textContent ?? "").toBe("");
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  // I gesti di T24 che T23 ha fatto passare dalle operazioni: i testi attesi
  // sono quelli che la tela scriveva prima di T23 (origin/piano/lavagna-in-codice),
  // con l'id della scheda nata che ora viene dal seme.
  it("Taglia (Ctrl+X) toglie con `remove` come prima: le schede e i loro fili, un passo d'annulla", () => {
    let { engine, host, changes } = mounted(SOURCE, { seed: () => 1n });
    pick(host, "b");
    cut(host);
    expect(engine.getDoc()).toBe(`{"nodes":[${NODE_A},${NODE_F}],"edges":[]}`);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();

    ({ engine, host, changes } = mounted(SOURCE, { seed: () => 1n }));
    pick(host, "a");
    pick(host, "f", true);
    cut(host);
    expect(engine.getDoc()).toBe(`{"nodes":[${NODE_B}],"edges":[]}`);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("il doppio clic nel vuoto fa nascere la scheda con `add_card` come prima, e il testo è un passo suo", () => {
    const { engine, host, changes } = mounted(SOURCE, { seed: () => 1n });
    viewport(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 700, clientY: 500 }));
    expect(engine.getDoc()).toBe(bornText(640, 448, ""));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    input.value = "Nuova";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    engine.commitPending();
    expect(engine.getDoc()).toBe(bornText(640, 448, "Nuova"));
    expect(changes).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(bornText(640, 448, ""));
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("la scheda nata col doppio clic e lasciata vuota se ne va con `remove`, senza passi d'annulla, come prima", () => {
    const { engine, host, changes } = mounted(SOURCE, { seed: () => 1n });
    viewport(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 700, clientY: 500 }));
    host.querySelector(".canvas-text-editor")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(engine.getDoc()).toBe(SOURCE);
    expect(changes.map((change) => change.text === SOURCE)).toEqual([false, true]);
    expect(engine.undo()).toBe(false);
    expect(engine.redo()).toBe(false);
    engine.destroy();
  });

  it("lo strumento Testo fa nascere la scheda con `add_card` come prima, in un passo d'annulla", () => {
    const { engine, host, changes } = mounted(SOURCE, { seed: () => 1n });
    command(engine, "canvas.tool.text").run();
    viewport(host).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 4, clientX: 900, clientY: 600 }));
    expect(engine.getDoc()).toBe(bornText(840, 552, ""));
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });
});

// T24: i gesti scrivono con le operazioni del nucleo, non con toppe fatte a
// mano. Ogni prova legge le operazioni che la tela dà a `compile` e il file
// che ne esce, con un passo d'annulla.
describe("i gesti scrivono con le operazioni (T24)", () => {
  const SOURCE = JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 200, height: 96, text: "a" },
      { id: "b", type: "text", x: 3, y: 205, width: 200, height: 96, text: "b" },
      { id: "g", type: "group", x: 600, y: 0, width: 480, height: 320, label: "Gruppo" },
      { id: "c", type: "text", x: 640, y: 40, width: 104, height: 80, text: "dentro" },
      { id: "f", type: "file", x: 0, y: 600, width: 320, height: 240, file: "doc/x.md" },
    ],
    edges: [],
  });
  const FRAGMENT_TYPE = "application/x-fub-canvas+json";

  /** Il nucleo vero, con le liste di operazioni che la tela gli fa compilare. */
  function recordingCore(): { port: CanvasCorePort; compiled: CanvasIntentOp[][] } {
    const compiled: CanvasIntentOp[][] = [];
    return {
      compiled,
      port: {
        ready: canvasCoreReady,
        openNow: (text) => {
          const core = openCoreNow(text);
          if (!core) return null;
          return new Proxy(core, {
            get(target, key, receiver) {
              const value = Reflect.get(target, key, receiver) as unknown;
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                if (key === "compile") compiled.push(JSON.parse(JSON.stringify(args[0])) as CanvasIntentOp[]);
                return (value as (...a: unknown[]) => unknown).apply(target, args);
              };
            },
          });
        },
      },
    };
  }

  function open(overrides: Partial<CanvasEngineOptions> = {}, source = SOURCE) {
    const recorded = recordingCore();
    const made = mounted(source, { core: recorded.port, ...overrides });
    return { ...made, compiled: recorded.compiled };
  }

  const viewportOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const card = (host: HTMLElement, id: string): HTMLElement => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  const nodeOf = (engine: CanvasEngine, id: string) => readCanvas(engine.getDoc()).nodes.find((node) => node.id === id)!;
  const lastOps = (compiled: readonly CanvasIntentOp[][]): CanvasIntentOp[] => compiled[compiled.length - 1] ?? [];

  function zoomOf(host: HTMLElement): number {
    const match = /scale\(([\d.e+-]+)\)/.exec(host.querySelector<HTMLElement>(".canvas-stage")!.style.transform);
    if (!match) throw new Error("niente zoom");
    return Number(match[1]);
  }

  function pointer(target: EventTarget, type: string, clientX: number, clientY: number, init: PointerEventInit = {}): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, pointerType: "mouse", clientX, clientY, ...init }));
  }

  /** Sceglie la scheda `id` con un clic (Maiusc la aggiunge). */
  function choose(host: HTMLElement, id: string, shiftKey = false): void {
    pointer(card(host, id), "pointerdown", 0, 0, { pointerId: 3, shiftKey });
    pointer(viewportOf(host), "pointerup", 0, 0, { pointerId: 3, shiftKey, buttons: 0 });
  }

  /**
   * Trascina la testata della scheda `id` di `(sx, sy)` px sullo schermo;
   * senza `release` resta giù. Con `free` tiene Alt mentre si muove (giù
   * sulla scheda Alt tira un filo): niente griglia né guide.
   */
  function dragHead(host: HTMLElement, id: string, sx: number, sy: number, release = true, free = false): void {
    const head = card(host, id).querySelector<HTMLElement>(".canvas-node-handle")!;
    pointer(head, "pointerdown", 100, 100);
    pointer(viewportOf(host), "pointermove", 100 + sx, 100 + sy, { altKey: free });
    if (release) pointer(viewportOf(host), "pointerup", 100 + sx, 100 + sy, { buttons: 0, altKey: free });
  }

  function zoomKey(host: HTMLElement, key: "+" | "-", times: number): void {
    for (let i = 0; i < times; i++) {
      viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }));
    }
  }

  function clipboardPaste(host: HTMLElement, values: Record<string, string>): void {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    const data = { files: [], items: [], types: Object.keys(values), getData: (type: string) => values[type] ?? "" };
    Object.defineProperty(event, "clipboardData", { value: data });
    viewportOf(host).dispatchEvent(event);
  }

  function filesDrop(host: HTMLElement, x = 200, y = 120): void {
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    const data = { files: [], items: [], types: ["Files"], getData: () => "" };
    Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
    viewportOf(host).dispatchEvent(event);
  }

  it("trascinare una scheda è una `move` del suo spostamento, un annulla", () => {
    const { engine, host, changes, compiled } = open();
    const zoom = zoomOf(host);
    dragHead(host, "a", 96 * zoom, 48 * zoom, true, true);
    expect(lastOps(compiled)).toEqual([{ op: "move", ids: ["a"], dx: 96, dy: 48 }]);
    expect([nodeOf(engine, "a").x, nodeOf(engine, "a").y]).toEqual([96, 48]);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("più schede trascinate: uno spostamento solo, agganciato sul loro riquadro; le distanze restano", () => {
    const { engine, host, compiled } = open();
    choose(host, "a");
    choose(host, "b", true);
    const zoom = zoomOf(host);
    dragHead(host, "a", 37 * zoom, 21 * zoom);
    // Lo spostamento lo agganciano la griglia o le guide sul riquadro delle
    // due: b, fuori griglia di 3, resta a 3 da a.
    const a = nodeOf(engine, "a");
    expect(lastOps(compiled)).toEqual([{ op: "move", ids: ["a", "b"], dx: a.x, dy: a.y }]);
    expect(a.x).not.toBe(0);
    expect(nodeOf(engine, "b").x - nodeOf(engine, "a").x).toBe(3);
    expect(nodeOf(engine, "b").y - nodeOf(engine, "a").y).toBe(205);
    engine.destroy();
  });

  it("un gruppo trascinato porta le schede dentro con `contents`", () => {
    const { engine, host, compiled } = open();
    const zoom = zoomOf(host);
    dragHead(host, "g", 48 * zoom, 0);
    expect(lastOps(compiled)).toEqual([{ op: "move", ids: ["g"], dx: 48, dy: 0, contents: true }]);
    expect([nodeOf(engine, "g").x, nodeOf(engine, "c").x]).toEqual([648, 688]);
    expect(nodeOf(engine, "a").x).toBe(0);
    engine.destroy();
  });

  it("Esc durante il trascinamento lo ferma: le schede tornano e il file non cambia", () => {
    const { engine, host, changes, compiled } = open();
    const zoom = zoomOf(host);
    dragHead(host, "a", 96 * zoom, 48 * zoom, false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    viewportOf(host).dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    pointer(viewportOf(host), "pointerup", 100 + 96 * zoom, 100 + 48 * zoom, { buttons: 0 });
    expect(changes).toHaveLength(0);
    expect(compiled.some((ops) => ops.some((op) => op.op === "move"))).toBe(false);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("Esc durante il ridimensionamento lo ferma: la scheda torna e il file non cambia", () => {
    const { engine, host, changes } = open();
    choose(host, "a");
    const grip = card(host, "a").querySelector<HTMLElement>('.canvas-resize[data-corner="se"]')!;
    pointer(grip, "pointerdown", 100, 100);
    pointer(viewportOf(host), "pointermove", 160, 140);
    viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    pointer(viewportOf(host), "pointerup", 160, 140, { buttons: 0 });
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  it.each([
    ["al 400%", "+", 40],
    ["vicino al 25%", "-", 6],
  ] as const)("%s il gesto misura in unità della lavagna", (_label, key, times) => {
    const { engine, host, compiled } = open();
    if (key === "-") {
      // Dal 100%: sei passi di 1,25 in giù sono il 26%.
      setReducedMotionPreference(true);
      viewportOf(host).dispatchEvent(new KeyboardEvent("keydown", { key: "0", code: "Digit0", bubbles: true, cancelable: true }));
      setReducedMotionPreference(false);
      expect(zoomOf(host)).toBe(1);
    }
    zoomKey(host, key, times);
    const zoom = zoomOf(host);
    if (key === "+") expect(zoom).toBe(4);
    else expect(zoom).toBeCloseTo(0.262, 3);
    dragHead(host, "a", 96 * zoom, 0, true, true);
    expect(lastOps(compiled)).toEqual([{ op: "move", ids: ["a"], dx: 96, dy: 0 }]);
    engine.destroy();
  });

  it("la maniglia in alto a sinistra è una `move` e una `resize`, un annulla", () => {
    const { engine, host, changes, compiled } = open();
    choose(host, "a");
    const zoom = zoomOf(host);
    const grip = card(host, "a").querySelector<HTMLElement>('.canvas-resize[data-corner="nw"]')!;
    pointer(grip, "pointerdown", 100, 100);
    pointer(viewportOf(host), "pointermove", 100 - 48 * zoom, 100 - 32 * zoom);
    pointer(viewportOf(host), "pointerup", 100 - 48 * zoom, 100 - 32 * zoom, { buttons: 0 });
    expect(lastOps(compiled)).toEqual([
      { op: "move", ids: ["a"], dx: -48, dy: -32 },
      { op: "resize", id: "a", width: 248, height: 128 },
    ]);
    const a = nodeOf(engine, "a");
    expect([a.x, a.y, a.width, a.height]).toEqual([-48, -32, 248, 128]);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  it("il filo lasciato sul corpo di una scheda è `connect` con `sides: auto`; da un lato, coi lati", () => {
    const { engine, host, compiled } = open();
    const zoom = zoomOf(host);
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(card(host, "f").querySelector(".canvas-card-body"));
    try {
      engine.commands().find((command) => command.id === toolCommandId("connect"))!.run();
      pointer(card(host, "a"), "pointerdown", 100, 100);
      pointer(viewportOf(host), "pointermove", 100, 100 + 600 * zoom);
      pointer(viewportOf(host), "pointerup", 100, 100 + 600 * zoom, { buttons: 0 });
      expect(lastOps(compiled)).toEqual([{ op: "connect", from: "a", to: "f", sides: "auto" }]);
      expect(engine.undo()).toBe(true);
      engine.commands().find((command) => command.id === toolCommandId("select"))!.run();
      const port = card(host, "a").querySelector<HTMLElement>(':scope > .canvas-port[data-side="right"]')!;
      pointer(port, "pointerdown", 100, 100);
      pointer(viewportOf(host), "pointermove", 100, 100 + 600 * zoom);
      pointer(viewportOf(host), "pointerup", 100, 100 + 600 * zoom, { buttons: 0 });
      const ops = lastOps(compiled);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ op: "connect", from: "a", to: "f", sides: { from: "right" } });
      expect(readCanvas(engine.getDoc()).edges).toEqual([expect.objectContaining({ fromNode: "a", fromSide: "right", toNode: "f" })]);
    } finally {
      pointing.mockRestore();
    }
    engine.destroy();
  });

  it("200 file: una lista sola (un `add_card` ciascuno, `layout`, `group`), un commit, un annulla", async () => {
    const paths = Array.from({ length: 200 }, (_, index) => `foto/img ${index + 1}.md`);
    let next = 0;
    const { engine, host, changes, compiled } = open({
      attachments: { deposit: vi.fn(), resolvePaths: vi.fn(async () => [...paths].reverse()) },
      newId: () => `d${++next}`,
    });
    filesDrop(host);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const ops = lastOps(compiled);
    const ids = paths.map((_, index) => `d${index + 1}`);
    expect(ops.map((op) => op.op)).toEqual([...paths.map(() => "add_card"), "layout", "group"]);
    // In ordine di nome coi numeri per valore: «img 2» prima di «img 10».
    expect(ops.slice(0, 3).map((op) => op.file)).toEqual(["foto/img 1.md", "foto/img 2.md", "foto/img 3.md"]);
    expect(ops[200]).toMatchObject({ op: "layout", kind: "grid", ids });
    expect(ops[201]).toMatchObject({ op: "group", ids });
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes).toHaveLength(5 + 200 + 1);
    expect(doc.nodes.filter((node) => node.type === "group")).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("un file che è già in una scheda ne fa un'altra, nel punto del rilascio", async () => {
    const { engine, host, changes, compiled } = open({
      attachments: { deposit: vi.fn(), resolvePaths: vi.fn(async () => ["doc/x.md"]) },
      newId: () => "nuova",
    });
    filesDrop(host);
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const ops = lastOps(compiled);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "add_card", id: "nuova", file: "doc/x.md" });
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes.filter((node) => node.file === "doc/x.md").map((node) => node.id)).toEqual(["f", "nuova"]);
    engine.destroy();
  });

  it("se il nucleo rifiuta i riquadri del trascinamento, non li ricompila a ogni movimento", () => {
    let calls = 0;
    const port: CanvasCorePort = {
      ready: canvasCoreReady,
      openNow: (text) => {
        const core = openCoreNow(text);
        if (!core) return null;
        return new Proxy(core, {
          get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver) as unknown;
            if (key !== "compile") return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            return () => {
              calls += 1;
              throw new CanvasCoreError("limit", "troppe schede");
            };
          },
        });
      },
    };
    const { engine, host, changes } = mounted(SOURCE, { core: port, attachments: { deposit: vi.fn(), resolvePaths: vi.fn(async () => []) } });
    const over = (x: number, files: number) => {
      const event = new DragEvent("dragover", { bubbles: true, cancelable: true });
      const data = { files: [], items: Array.from({ length: files }, () => ({ kind: "file" })), types: ["Files"], getData: () => "" };
      Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: 120 } });
      viewportOf(host).dispatchEvent(event);
    };
    for (let step = 0; step < 20; step++) over(200 + step * 40, 2);
    expect(calls).toBe(1);
    expect(host.querySelectorAll(".canvas-drop-ghost")).toHaveLength(0);
    // Un altro numero di file è un'altra prova.
    over(200, 3);
    expect(calls).toBe(2);
    viewportOf(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    over(200, 3);
    expect(calls).toBe(3);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("i riquadri del trascinamento si compilano una volta all'entrata; uscire dalla lavagna non scrive niente", () => {
    const { engine, host, changes, compiled } = open({ attachments: { deposit: vi.fn(), resolvePaths: vi.fn(async () => []) } });
    const ghosts = () => [...host.querySelectorAll<HTMLElement>(".canvas-drop-ghost")];
    const over = (x: number, y: number) => {
      const event = new DragEvent("dragover", { bubbles: true, cancelable: true });
      const data = { files: [], items: [{ kind: "file" }, { kind: "file" }], types: ["Files"], getData: () => "" };
      Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } });
      viewportOf(host).dispatchEvent(event);
    };
    const before = compiled.length;
    over(200, 120);
    const first = ghosts().map((ghost) => ghost.style.transform);
    expect(first).toHaveLength(2);
    for (let step = 1; step <= 20; step++) over(200 + step * 40, 120);
    // Una sola compilazione, che non scrive; i riquadri seguono il puntatore.
    expect(compiled.length - before).toBe(1);
    expect(ghosts().map((ghost) => ghost.style.transform)).not.toEqual(first);
    viewportOf(host).dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    expect(ghosts()).toHaveLength(0);
    expect(changes).toHaveLength(0);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  it("il testo incollato è un `add_card` nella forma corta, nel punto agganciato", async () => {
    const { engine, host, changes, compiled } = open({ newId: () => "incollata" });
    clipboardPaste(host, { "text/plain": "ciao" });
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    const ops = lastOps(compiled);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "add_card", text: "ciao" });
    expect(ops[0]).not.toHaveProperty("width");
    expect(Math.abs(Number(ops[0]!.x) % 8)).toBe(0);
    expect(Math.abs(Number(ops[0]!.y) % 8)).toBe(0);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  it("le schede incollate entrano con `insert` del frammento, coi fili", async () => {
    const { engine, host, changes, compiled } = open();
    const fragment = JSON.stringify({ version: 1, nodes: [
      { id: "p", type: "text", x: 10, y: 10, width: 120, height: 80, text: "uno" },
      { id: "q", type: "text", x: 210, y: 10, width: 120, height: 80, text: "due" },
    ], edges: [{ id: "e", fromNode: "p", toNode: "q" }] });
    clipboardPaste(host, { [FRAGMENT_TYPE]: fragment, "text/plain": "uno due" });
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    expect(lastOps(compiled).map((op) => op.op)).toEqual(["insert"]);
    const doc = readCanvas(engine.getDoc());
    expect(doc.nodes.slice(5).map((node) => node.text)).toEqual(["uno", "due"]);
    expect(doc.edges).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(SOURCE);
    engine.destroy();
  });

  /** Il punto dello schermo di un punto della lavagna, dalla trasformazione della scena. */
  function screen(host: HTMLElement, x: number, y: number): { clientX: number; clientY: number } {
    const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(host.querySelector<HTMLElement>(".canvas-stage")!.style.transform);
    if (!match) throw new Error("la scena non dice la sua trasformazione");
    return { clientX: x * Number(match[3]) + Number(match[1]), clientY: y * Number(match[3]) + Number(match[2]) };
  }

  it("un gruppo con più di 1000 schede si trascina: una `move` con tutte le schede, senza `contents`, un passo", () => {
    const inside = Array.from({ length: 1500 }, (_, i) => ({
      id: `k${i}`, type: "text", x: 8 + (i % 50) * 16, y: 48 + Math.floor(i / 50) * 16, width: 8, height: 8, text: "",
    }));
    const source = JSON.stringify({ nodes: [{ id: "big", type: "group", x: 0, y: 0, width: 816, height: 560, label: "Tanti" }, ...inside], edges: [] });
    const { engine, host, changes, compiled } = open({}, source);
    choose(host, "big");
    const zoom = zoomOf(host);
    const head = card(host, "big").querySelector(".canvas-node-handle") ?? card(host, "big");
    const from = screen(host, 400, 20);
    pointer(head, "pointerdown", from.clientX, from.clientY);
    pointer(viewportOf(host), "pointermove", from.clientX + 96 * zoom, from.clientY + 48 * zoom, { altKey: true });
    pointer(viewportOf(host), "pointerup", from.clientX + 96 * zoom, from.clientY + 48 * zoom, { altKey: true, buttons: 0 });
    const move = lastOps(compiled);
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ op: "move", dx: 96, dy: 48 });
    expect(move[0]).not.toHaveProperty("contents");
    expect((move[0]!.ids as string[]).sort()).toEqual(["big", ...inside.map((node) => node.id)].sort());
    // Con `contents` il nucleo la rifiuta: oltre `MAX_MOVED`.
    const core = openCoreNow(source)!;
    try {
      expect(() => core.compile([{ op: "move", ids: ["big"], dx: 96, dy: 48, contents: true }], 1n)).toThrow(CanvasCoreError);
    } finally {
      core.close();
    }
    expect(changes).toHaveLength(1);
    expect(nodeOf(engine, "big")).toMatchObject({ x: 96, y: 48 });
    expect(nodeOf(engine, "k1499")).toMatchObject({ x: 8 + 49 * 16 + 96, y: 48 + 29 * 16 + 48 });
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe(source);
    engine.destroy();
  }, 60_000);

  /** Un tratto libero della lavagna da `(x, y)` verso destra: `count` campioni a `step` unità l'uno dall'altro. */
  function longStroke(x: number, y: number, count: number, step: number): { source: string; points: number[] } {
    const samples: InkSample[] = Array.from({ length: count }, (_, i) => ({ x: x + i * step, y, t: i * 10, p: 0.5 }));
    const stroke = {
      id: "lungo",
      tool: "pen",
      brush: "pf1 size=2 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
      color: "#0072b2",
      anchor: { kind: "free" },
      ink: encodeInk(inkFromQuantized(quantizeInk(samples, 100))),
    };
    return {
      source: JSON.stringify({ nodes: [], edges: [], "fub:ink": { v: 1, strokes: [stroke] } }),
      points: samples.flatMap((sample) => [sample.x, sample.y]),
    };
  }

  /**
   * Il cammino della gomma come lo scrive la tela, a pezzi: il nucleo accetta
   * la lista in un passo, e rifiuta il cammino intero in un'operazione.
   */
  function erasesInPieces(source: string, units: { points: number[] }[], path: [number, number][], radius: number): CanvasIntentOp[] {
    const pieces = erasePathPieces(path, eraseAlongSegments(units, radius));
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(10_000);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]![0]).toEqual(pieces[i - 1]![pieces[i - 1]!.length - 1]);
    expect(pieces.flatMap((piece, i) => piece.slice(i === 0 ? 0 : 1))).toEqual(path);
    const ops = pieces.map((piece) => ({ op: "erase_along", points: piece, size: radius * 2, on: "board" }));
    const core = openCoreNow(source)!;
    try {
      expect(() => core.compile([{ op: "erase_along", points: path, size: radius * 2, on: "board" }], 1n)).toThrow(CanvasCoreError);
      const compiled = core.compile(ops, 1n);
      expect(compiled.patches.length).toBeGreaterThan(0);
    } finally {
      core.close();
    }
    return ops;
  }

  it("una passata di più di 10 000 punti va in pezzi di fila che il nucleo accetta in una lista", () => {
    const { source, points } = longStroke(100, 300, 160, 1);
    // Avanti e indietro sul tratto in x = 150: 10 050 punti.
    const path = Array.from({ length: 10_050 }, (_, i): [number, number] => [150, i % 2 === 0 ? 290 : 310]);
    erasesInPieces(source, [{ points }], path, 8);
  });

  it("una passata che supera il lavoro del nucleo va in pezzi di fila che il nucleo accetta in una lista", () => {
    // Un tratto lungo 300 000 unità a campioni distanti 300: il nucleo fa un
    // passo ogni metà della portata della gomma, per ogni segmento vicino.
    const { source, points } = longStroke(0, 300, 1000, 300);
    const path = Array.from({ length: 1000 }, (_, i): [number, number] => [150, i % 2 === 0 ? 290 : 310]);
    erasesInPieces(source, [{ points }], path, 8);
  }, 60_000);
});
