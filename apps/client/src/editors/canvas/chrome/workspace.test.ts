// @vitest-environment happy-dom
// Lo spazio di lavoro della lavagna (T65): `auto` coi dispositivi finti (una
// tavoletta solo a tocco, un portatile col tocco e il mouse), `full` e
// `simple` che lo fissano, il cambio da un'altra finestra e del dispositivo,
// «Completo» in fondo alla colonna, e Ctrl+. che nasconde e riporta
// l'interfaccia in tutti e due gli spazi.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { openLifetime } from "../../../ui/lifetime";
import { CardCache } from "../card-cache";
import { createCardRegistry, type CardEditorPort, type CardTextEditor } from "../cards";
import { CanvasEngine, type CanvasEngineOptions } from "../engine";
import { DEFAULT_PREFERENCES, type CanvasPreferences, type WorkspaceMode } from "../preferences";
import { canvasCoreReady } from "../wasm/core";
import { canvasRailLayout } from "./rail";
import {
  CANVAS_SIMPLE_TOOLS,
  canvasWorkspaceOf,
  createCanvasWorkspace,
  isBareKey,
  mediaPointers,
  touchOnly,
  type PointerKinds,
  type PointerSource,
} from "./workspace";

// Le impostazioni della lavagna: la prova tiene le funzioni di
// `watchPreferences` per cambiare lo spazio a lavagna aperta, come farebbe un
// cambio da Impostazioni o da un'altra finestra.
const watched = vi.hoisted(() => ({ appliers: [] as Array<(preferences: CanvasPreferences) => void> }));

vi.mock("../preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../preferences")>()),
  watchPreferences: (apply: (preferences: CanvasPreferences) => void) => {
    watched.appliers.push(apply);
    return () => {
      watched.appliers = watched.appliers.filter((other) => other !== apply);
    };
  },
}));

// La scrittura di «Completo»: la prova la legge qui.
const saved = vi.hoisted(() => ({ settings: [] as Array<[string, unknown]> }));
vi.mock("../../../host/ipc", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../host/ipc")>();
  return {
    ...real,
    api: new Proxy(real.api, {
      get(target, name, receiver) {
        if (name === "setSetting") {
          return (key: string, value: unknown) => {
            saved.settings.push([key, value]);
            return Promise.resolve();
          };
        }
        return Reflect.get(target, name, receiver);
      },
    }),
  };
});

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  saved.settings.length = 0;
  document.body.replaceChildren();
});

const TABLET: PointerKinds = { fine: false, coarse: true };
const LAPTOP_TOUCH: PointerKinds = { fine: true, coarse: true };
const DESKTOP: PointerKinds = { fine: true, coarse: false };

/// Un dispositivo finto: i suoi puntatori si cambiano con `set`.
function fakePointers(start: PointerKinds): PointerSource & { set(next: PointerKinds): void; listeners: number } {
  let now = start;
  const listeners = new Set<() => void>();
  return {
    read: () => now,
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      now = next;
      for (const listener of [...listeners]) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
}

/// `matchMedia` finta per il dispositivo `kinds`, come la legge `mediaPointers`.
function fakeMatchMedia(kinds: PointerKinds) {
  return (query: string) => ({
    matches: query === "(any-pointer: fine)" ? kinds.fine : query === "(any-pointer: coarse)" ? kinds.coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
}

function ctrl(target: EventTarget, key = "."): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("la regola dello spazio", () => {
  it("auto: Semplice solo sul dispositivo che ha soltanto il tocco; un portatile col tocco e il mouse resta Completo", () => {
    expect(touchOnly(TABLET)).toBe(true);
    expect(touchOnly(LAPTOP_TOUCH)).toBe(false);
    expect(canvasWorkspaceOf("auto", TABLET)).toBe("simple");
    expect(canvasWorkspaceOf("auto", LAPTOP_TOUCH)).toBe("full");
    expect(canvasWorkspaceOf("auto", DESKTOP)).toBe("full");
    // Nessun puntatore (un ambiente senza finestra): Completo.
    expect(canvasWorkspaceOf("auto", { fine: false, coarse: false })).toBe("full");
  });

  it("full e simple lo fissano, su ogni dispositivo", () => {
    for (const device of [TABLET, LAPTOP_TOUCH, DESKTOP]) {
      expect(canvasWorkspaceOf("full", device)).toBe("full");
      expect(canvasWorkspaceOf("simple", device)).toBe("simple");
    }
  });

  it("i puntatori si leggono dalle media query any-pointer; senza matchMedia vale il computer col mouse", () => {
    expect(mediaPointers(fakeMatchMedia(TABLET)).read()).toEqual(TABLET);
    expect(mediaPointers(fakeMatchMedia(LAPTOP_TOUCH)).read()).toEqual(LAPTOP_TOUCH);
    expect(mediaPointers(undefined).read()).toEqual(DESKTOP);
  });

  it("Ctrl+. (Cmd+. sul Mac) è il tasto dell'interfaccia; non con Alt, non senza Ctrl", () => {
    const press = (init: Partial<KeyboardEventInit>) => ({ key: ".", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;
    expect(isBareKey(press({ ctrlKey: true }))).toBe(true);
    expect(isBareKey(press({ metaKey: true }))).toBe(true);
    expect(isBareKey(press({}))).toBe(false);
    expect(isBareKey(press({ ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("la colonna Semplice: sei strumenti, ognuno nella sua casella, senza tendine", () => {
    expect(CANVAS_SIMPLE_TOOLS).toEqual(["select", "hand", "pen", "highlighter", "eraser", "text"]);
    expect(canvasRailLayout(["connect", "lasso"], "simple")).toEqual([
      [["select"], ["hand"]],
      [["pen"], ["highlighter"], ["eraser"]],
      [["text"]],
    ]);
  });
});

describe("lo spazio sulla superficie", () => {
  function mountedControl(mode: WorkspaceMode, device: PointerKinds) {
    const root = document.createElement("div");
    const board = document.createElement("div");
    board.tabIndex = 0;
    const rail = document.createElement("div");
    const button = document.createElement("button");
    rail.append(button);
    root.append(board, rail);
    document.body.append(root);
    const life = openLifetime();
    const pointers = fakePointers(device);
    const changes: string[] = [];
    const bares: boolean[] = [];
    const saves: WorkspaceMode[] = [];
    const control = createCanvasWorkspace({
      root,
      lifetime: life,
      mode,
      pointers,
      parts: () => [rail],
      focusBoard: () => board.focus(),
      onWorkspace: (workspace) => changes.push(workspace),
      onBare: (bare) => bares.push(bare),
      save: (next) => saves.push(next),
    });
    return { root, board, button, life, pointers, control, changes, bares, saves };
  }

  it("auto segue il dispositivo dal vivo: un mouse che si stacca porta al Semplice, che torna Completo quando si riattacca", () => {
    const { root, pointers, control, changes, life } = mountedControl("auto", LAPTOP_TOUCH);
    expect(root.dataset.workspace).toBe("full");
    pointers.set(TABLET);
    expect(control.workspace).toBe("simple");
    expect(root.dataset.workspace).toBe("simple");
    pointers.set(LAPTOP_TOUCH);
    expect(changes).toEqual(["simple", "full"]);
    // La vita chiusa smette di ascoltare il dispositivo.
    life.close();
    expect(pointers.listeners).toBe(0);
  });

  it("un cambio dell'impostazione (anche da un'altra finestra) vale subito; full e simple non seguono il dispositivo", () => {
    const { root, pointers, control, changes } = mountedControl("auto", TABLET);
    expect(root.dataset.workspace).toBe("simple");
    control.setMode("full");
    expect(root.dataset.workspace).toBe("full");
    pointers.set(DESKTOP);
    pointers.set(TABLET);
    expect(control.workspace).toBe("full");
    control.setMode("simple");
    pointers.set(DESKTOP);
    expect(control.workspace).toBe("simple");
    expect(changes).toEqual(["full", "simple"]);
  });

  it("«Completo» porta allo spazio Completo, lo dice e scrive full", () => {
    const { root, control, saves } = mountedControl("auto", TABLET);
    control.chooseFull();
    expect(control.workspace).toBe("full");
    expect(saves).toEqual(["full"]);
    expect(root.querySelector(".canvas-workspace-said")!.textContent).toBe(t("canvas.workspace.on", { name: t("canvas.workspace.full") }));
  });

  it("setBare nasconde e riporta: data-bare, il fuoco che sparisce torna alla lavagna, il lettore di schermo lo sente", () => {
    const { root, board, button, control, bares } = mountedControl("full", DESKTOP);
    button.focus();
    control.setBare(true);
    expect(root.hasAttribute("data-bare")).toBe(true);
    expect(document.activeElement).toBe(board);
    expect(root.querySelector(".canvas-workspace-said")!.textContent).toContain("Ctrl+.");
    control.setBare(true);
    control.setBare(false);
    expect(root.hasAttribute("data-bare")).toBe(false);
    expect(bares).toEqual([true, false]);
    expect(root.querySelector(".canvas-workspace-said")!.textContent).toBe(t("canvas.bare.off"));
  });
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

describe("lo spazio nella lavagna", () => {
  function mounted(device: PointerKinds, extra: Partial<CanvasEngineOptions> = {}) {
    vi.stubGlobal("matchMedia", fakeMatchMedia(device));
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new CanvasEngine(host, {
      surfaceId: "workspace",
      formatId: "canvas",
      documentId: "lavagna.canvas",
      onChange: () => {},
      onSelectionChange: () => {},
      penMemory: { read: () => new Promise(() => {}), save: () => {} },
      inkMouseMemory: { read: () => new Promise(() => {}), save: () => {} },
      ...extra,
    });
    engine.setDoc(BOARD);
    return { engine, host };
  }
  const surface = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-surface")!;
  const viewport = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-viewport")!;
  const slots = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".canvas-rail .kit-rail-slot")];
  const full = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".canvas-rail > .canvas-rail-full")!;
  const kitRail = (host: HTMLElement) => host.querySelector<HTMLElement>(".canvas-rail > .kit-rail")!;
  const optionItems = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>(".canvas-header .kit-options-row > .canvas-options-item")].map((item) => item.dataset.option);
  const navigatorCommands = (engine: CanvasEngine) => engine.commands().map((command) => command.id).filter((id) => id.startsWith("canvas.navigator."));
  const apply = (workspace: WorkspaceMode) => {
    for (const each of watched.appliers) each({ ...DEFAULT_PREFERENCES, workspace });
  };

  it("auto sulla tavoletta: lo spazio Semplice, sei caselle da 44 px senza tendine, «Completo» in fondo, il navigatore chiuso", () => {
    const { engine, host } = mounted(TABLET);
    expect(surface(host).dataset.workspace).toBe("simple");
    expect(slots(host).map((slot) => slot.dataset.slot)).toEqual([...CANVAS_SIMPLE_TOOLS]);
    expect(slots(host).some((slot) => slot.hasAttribute("aria-haspopup"))).toBe(false);
    expect(kitRail(host).dataset.size).toBe("large");
    expect(full(host).hidden).toBe(false);
    expect(full(host).textContent).toBe(t("canvas.workspace.full"));
    expect(navigatorCommands(engine)).toEqual(["canvas.navigator.show"]);
    // La riga ridotta: con la Penna solo il menu delle penne, senza la Vista.
    engine.commands().find((command) => command.id === "canvas.tool.pen")!.run();
    expect(optionItems(host)).not.toContain("view");
    engine.destroy();
  });

  it("auto sul portatile col tocco e il mouse: lo spazio Completo, con la colonna intera", () => {
    const { engine, host } = mounted(LAPTOP_TOUCH);
    expect(surface(host).dataset.workspace).toBe("full");
    expect(slots(host).map((slot) => slot.dataset.slot)).toEqual(["select", "hand", "pen", "eraser", "text", "connect"]);
    expect(kitRail(host).dataset.size).toBe("normal");
    expect(full(host).hidden).toBe(true);
    engine.commands().find((command) => command.id === "canvas.tool.pen")!.run();
    expect(optionItems(host)).toContain("view");
    engine.destroy();
  });

  it("full e simple dalle Impostazioni cambiano la lavagna aperta; «Completo» scrive canvas.workspace", async () => {
    const { engine, host } = mounted(DESKTOP);
    apply("simple");
    expect(surface(host).dataset.workspace).toBe("simple");
    expect(slots(host)).toHaveLength(6);
    expect(slots(host).map((slot) => slot.dataset.slot)).not.toContain("connect");
    apply("full");
    expect(surface(host).dataset.workspace).toBe("full");
    expect(slots(host).map((slot) => slot.dataset.slot)).toContain("connect");
    apply("simple");
    full(host).click();
    expect(surface(host).dataset.workspace).toBe("full");
    await Promise.resolve();
    await Promise.resolve();
    expect(saved.settings).toEqual([["canvas.workspace", "full"]]);
    engine.destroy();
  });

  it("nello Semplice il navigatore si mostra per questa apertura, e tornando al Completo vale la scelta di prima", () => {
    const { engine } = mounted(DESKTOP);
    expect(navigatorCommands(engine)).toEqual(["canvas.navigator.hide"]);
    apply("simple");
    expect(navigatorCommands(engine)).toEqual(["canvas.navigator.show"]);
    engine.commands().find((command) => command.id === "canvas.navigator.show")!.run();
    expect(navigatorCommands(engine)).toEqual(["canvas.navigator.hide"]);
    apply("full");
    expect(navigatorCommands(engine)).toEqual(["canvas.navigator.hide"]);
    // Rientrando nel Semplice è di nuovo chiuso.
    apply("simple");
    expect(navigatorCommands(engine)).toEqual(["canvas.navigator.show"]);
    engine.destroy();
  });

  it("Ctrl+. nasconde e riporta l'interfaccia in tutti e due gli spazi, dalla lavagna e dalla colonna", () => {
    const { engine, host } = mounted(DESKTOP);
    expect(ctrl(viewport(host)).defaultPrevented).toBe(true);
    expect(surface(host).hasAttribute("data-bare")).toBe(true);
    ctrl(viewport(host));
    expect(surface(host).hasAttribute("data-bare")).toBe(false);
    apply("simple");
    // Dalla colonna: il fuoco che sparisce torna alla lavagna.
    const slot = slots(host)[0]!;
    slot.focus();
    expect(ctrl(slot).defaultPrevented).toBe(true);
    expect(surface(host).hasAttribute("data-bare")).toBe(true);
    expect(document.activeElement).toBe(viewport(host));
    // F6 senza interfaccia: né la colonna né la riga.
    expect(engine.zone(1)).toBe(false);
    ctrl(viewport(host));
    expect(surface(host).hasAttribute("data-bare")).toBe(false);
    // È un comando del catalogo, col suo tasto.
    expect(engine.commands().find((command) => command.id === "canvas.bare")?.keys).toEqual(["Mod-."]);
    engine.destroy();
  });

  it("Ctrl+. nel campo di una scheda di testo va alla lavagna, e si resta a scrivere", () => {
    const { engine, host } = mounted(DESKTOP);
    host.querySelector<HTMLElement>('.canvas-node[data-node="a"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(field).not.toBeNull();
    expect(ctrl(field).defaultPrevented).toBe(true);
    expect(surface(host).hasAttribute("data-bare")).toBe(true);
    expect(host.querySelector(".canvas-text-editor")).toBe(field);
    ctrl(field);
    expect(surface(host).hasAttribute("data-bare")).toBe(false);
    engine.destroy();
  });

  /// La lavagna con l'editor delle note finto nelle schede di testo (T43): se
  /// `usesBare`, l'editor usa Ctrl+. per sé.
  async function writingLive(usesBare: boolean) {
    const port: CardEditorPort = {
      open: async () => null,
      openText: async (place, text, options) => {
        const area = document.createElement("div");
        area.contentEditable = "true";
        area.tabIndex = 0;
        area.className = "fake-live";
        if (usesBare) {
          area.addEventListener("keydown", (event) => {
            if (isBareKey(event)) event.preventDefault();
          });
        }
        place.append(area);
        const handle: CardTextEditor = { focus: () => area.focus(), text: () => text, destroy: () => place.replaceChildren() };
        options.lifetime.add(() => handle.destroy());
        return handle;
      },
    };
    const { engine, host } = mounted(DESKTOP, {
      cards: { registry: createCardRegistry([]), snapshots: new CardCache(), watch: () => () => {}, editors: port },
    });
    host.querySelector<HTMLElement>('.canvas-node[data-node="a"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const area = host.querySelector<HTMLElement>(".fake-live")!;
    expect(area).not.toBeNull();
    return { engine, host, area };
  }

  it("Ctrl+. nell'editor delle note che non lo usa va alla lavagna", async () => {
    const { engine, host, area } = await writingLive(false);
    expect(ctrl(area).defaultPrevented).toBe(true);
    expect(surface(host).hasAttribute("data-bare")).toBe(true);
    engine.destroy();
  });

  it("Ctrl+. nell'editor delle note che lo usa resta all'editor: la lavagna non cambia", async () => {
    const { engine, host, area } = await writingLive(true);
    ctrl(area);
    expect(surface(host).hasAttribute("data-bare")).toBe(false);
    engine.destroy();
  });
});
