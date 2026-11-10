// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SurfaceMenuEntry, SurfaceMenuItem } from "../../core/editor-menu";
import { SHELL_KEYS } from "../../../ui/shell-keys.generated";
import { CanvasEngine, type CanvasChange, type CanvasEngineOptions } from "../engine";
import { canvasCoreReady, openCoreNow } from "../wasm/core";
import type { CanvasDocument } from "../model";
import {
  CANVAS_COMMANDS,
  CANVAS_DECLARED_SHELL_KEYS,
  commandForKey,
  displayCanvasKey,
  matchesCanvasKey,
  parseCanvasKey,
  type CanvasCommand,
  type CanvasKeyPress,
} from "./commands";
import { RecentCommands } from "./command-search";
import { colorCommandLabel, colorMenuLabel, type CanvasColorChoice } from "../colors";
import { t } from "../../../i18n/strings";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/// Gli id del catalogo, scritti a mano: un id è un dato stabile, e cambiarne
/// uno deve far fallire questa prova.
const STABLE_IDS = [
  "canvas.undo", "canvas.redo", "canvas.commands",
  "canvas.tool.select", "canvas.tool.hand", "canvas.tool.pen", "canvas.tool.highlighter",
  "canvas.tool.eraser", "canvas.tool.text", "canvas.tool.connect", "canvas.escape",
  "canvas.add.text", "canvas.add.file", "canvas.add.link", "canvas.add.group", "canvas.duplicate",
  "canvas.select_all", "canvas.enter", "canvas.edit", "canvas.open", "canvas.open_url",
  "canvas.open_beside", "canvas.open_viewer", "canvas.web_preview", "canvas.connect",
  "canvas.nudge.left", "canvas.nudge.right", "canvas.nudge.up", "canvas.nudge.down",
  "canvas.nudge.left.far", "canvas.nudge.right.far", "canvas.nudge.up.far", "canvas.nudge.down.far",
  "canvas.edge.reverse", "canvas.delete", "canvas.trash_file",
  "canvas.color.none", "canvas.color.1", "canvas.color.2", "canvas.color.3", "canvas.color.4", "canvas.color.5", "canvas.color.6",
  "canvas.color.gray", "canvas.color.brown", "canvas.color.orange", "canvas.color.yellow", "canvas.color.green",
  "canvas.color.blue", "canvas.color.purple", "canvas.color.pink", "canvas.color.red", "canvas.color.other",
  "canvas.bring_front", "canvas.send_back",
  "canvas.align.left", "canvas.align.center", "canvas.align.right", "canvas.align.top", "canvas.align.middle", "canvas.align.bottom",
  "canvas.distribute_x", "canvas.distribute_y",
  "canvas.fit", "canvas.fit_selection", "canvas.zoom_in", "canvas.zoom_out", "canvas.zoom_reset",
  "canvas.navigator.hide", "canvas.navigator.show",
  "canvas.pen_menu", "canvas.color_menu", "canvas.align_menu",
  "canvas.tips.none", "canvas.tips.start", "canvas.tips.end",
];

/// Un tasto in forma confrontabile: Ctrl è `mod`, e un segno che non è una
/// lettera né una cifra non guarda Maiusc (come `matchesCanvasKey`).
function canonical(binding: string): string {
  const key = parseCanvasKey(binding.replace(/^Ctrl-/, "Mod-"));
  if (key === null) throw new Error(`tasto illeggibile: ${binding}`);
  const symbol = key.key.length === 1 && !/[a-z0-9]/.test(key.key);
  return [key.mod ? "mod" : "", key.alt ? "alt" : "", key.shift && !symbol ? "shift" : "", key.key].filter(Boolean).join("-");
}

function press(key: string, extra: Partial<CanvasKeyPress> = {}): CanvasKeyPress {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra };
}

describe("il catalogo dei comandi della lavagna", () => {
  it("gli id cominciano con canvas., sono unici e stabili", () => {
    const ids = CANVAS_COMMANDS.map((spec) => spec.id);
    expect(ids).toEqual(STABLE_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("canvas."), id).toBe(true);
  });

  it("nessun tasto è doppio, e ognuno si legge", () => {
    const owner = new Map<string, string>();
    for (const spec of CANVAS_COMMANDS) {
      for (const binding of spec.keys) {
        const form = canonical(binding);
        expect(owner.get(form), `${binding} di ${spec.id}`).toBeUndefined();
        owner.set(form, spec.id);
      }
    }
    expect(owner.size).toBeGreaterThan(10);
  });

  it("i tasti dello Scrittoio restano suoi, tranne quelli dichiarati", () => {
    const taken = new Set(CANVAS_COMMANDS.flatMap((spec) => spec.keys.map(canonical)));
    const shell = Object.values(SHELL_KEYS).flatMap((chord): string[] => (chord === null || /\s/.test(chord) ? [] : [canonical(chord)]));
    const declared = new Set(CANVAS_DECLARED_SHELL_KEYS.map(canonical));
    expect(shell.filter((chord) => taken.has(chord) && !declared.has(chord))).toEqual([]);
    // Ogni tasto dichiarato è davvero dello Scrittoio, e la lavagna lo prende.
    for (const chord of declared) {
      expect(shell, chord).toContain(chord);
      expect(taken.has(chord), chord).toBe(true);
    }
  });

  it("un tasto di una lettera non vale mentre si scrive; con Ctrl sì", () => {
    const ran: string[] = [];
    const command = (id: string, keys: string[]): CanvasCommand => ({
      id, label: id, path: "Lavagna", keys, context: "always", boardKeys: false, danger: false,
      disabled: () => null, run: () => ran.push(id),
    });
    const catalog = [command("canvas.letter", ["t"]), command("canvas.held", ["Mod-k"])];
    expect(commandForKey(catalog, press("t"), { writing: true, onBoard: false })).toBeNull();
    expect(commandForKey(catalog, press("t"), { writing: false, onBoard: true })?.id).toBe("canvas.letter");
    expect(commandForKey(catalog, press("k", { ctrlKey: true }), { writing: true, onBoard: false })?.id).toBe("canvas.held");
    // Nel catalogo vero: Canc e le frecce sono del testo.
    const real = mountedCommands();
    for (const key of ["Delete", "Backspace", "ArrowLeft", "+", "-", "Enter"]) {
      expect(commandForKey(real, press(key), { writing: true, onBoard: false }), key).toBeNull();
    }
    expect(commandForKey(real, press("Delete"), { writing: false, onBoard: true })?.id).toBe("canvas.delete");
  });

  it("i tasti come si premono sulla tastiera italiana", () => {
    // Ctrl+/ è Ctrl+Maiusc+7.
    expect(matchesCanvasKey(press("/", { ctrlKey: true, shiftKey: true, code: "Digit7" }), "Mod-/")).toBe(true);
    // Maiusc+1 scrive «!».
    const real = mountedCommands();
    expect(commandForKey(real, press("!", { shiftKey: true, code: "Digit1" }), { writing: false, onBoard: true })?.id).toBe("canvas.fit");
    // Il «+» sta dove l'americana ha «]»: Ctrl++ resta lo zoom.
    expect(commandForKey(real, press("+", { ctrlKey: true, code: "BracketRight" }), { writing: false, onBoard: true })?.id).toBe("canvas.zoom_in");
    expect(commandForKey(real, press("]", { metaKey: true, code: "BracketRight" }), { writing: false, onBoard: true })?.id).toBe("canvas.bring_front");
    // Ctrl+Z e Ctrl+Maiusc+Z non si confondono.
    expect(commandForKey(real, press("z", { ctrlKey: true }), { writing: true, onBoard: false })?.id).toBe("canvas.undo");
    expect(commandForKey(real, press("Z", { ctrlKey: true, shiftKey: true }), { writing: true, onBoard: false })?.id).toBe("canvas.redo");
    expect(displayCanvasKey("Mod-Shift-z", "other")).toBe("Ctrl+Shift+Z");
    expect(displayCanvasKey("Delete", "other")).toBe("Del");
    expect(displayCanvasKey("Mod-z", "mac")).toBe("⌘Z");
  });
});

// --- la tela ---------------------------------------------------------------

function readCanvas(text: string): CanvasDocument {
  const core = openCoreNow(text);
  if (!core) throw new Error("il nucleo non è carico");
  try {
    return core.model();
  } finally {
    core.close();
  }
}

const SOURCE = JSON.stringify({
  nodes: [
    { id: "t", type: "text", x: 40, y: 40, width: 240, height: 140, text: "uno" },
    { id: "f", type: "file", x: 400, y: 40, width: 240, height: 140, file: "allegati/foto.png" },
    { id: "g", type: "group", x: 40, y: 240, width: 600, height: 300, label: "Idee" },
    { id: "w", type: "link", x: 400, y: 240, width: 240, height: 100, url: "https://example.com/x" },
  ],
  edges: [{ id: "e1", fromNode: "t", toNode: "f", toEnd: "arrow" }],
});

function mounted(overrides: Partial<CanvasEngineOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: CanvasChange[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "test",
    formatId: "canvas",
    revision: "rev-1",
    documentId: "board.canvas",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onCreateNote: () => {},
    media: { openExternal: () => {} },
    recentCommands: new RecentCommands(null),
    ...overrides,
  });
  engine.setDoc(SOURCE);
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
  return { engine, host, viewport, changes };
}

function mountedCommands(): CanvasCommand[] {
  const { engine } = mounted();
  return engine.commands();
}

function key(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Le voci di un menu, coi sottomenu, come id annidati.
function shape(entries: readonly SurfaceMenuEntry[]): unknown[] {
  return entries.map((entry) => {
    if (typeof entry === "string") return entry;
    return Array.isArray(entry.items) ? { [entry.id]: shape(entry.items) } : entry.id;
  });
}

/// Ogni voce che si esegue, coi sottomenu aperti (senza le righe fra i gruppi).
function leaves(entries: readonly SurfaceMenuEntry[]): SurfaceMenuItem[] {
  return entries.flatMap((entry) => {
    if (typeof entry === "string") return [];
    return Array.isArray(entry.items) ? leaves(entry.items) : [entry];
  });
}

describe("la tela legge il catalogo", () => {
  it("ogni voce dei menu è un comando, con gli stessi nomi e lo stesso ordine", () => {
    const { engine, host, viewport } = mounted();
    const catalog = new Map(engine.commands().map((command) => [command.id, command]));
    const pointing = vi.spyOn(document, "elementFromPoint");
    const menuOn = (element: Element | null, at: { x: number; y: number } | null = { x: 10, y: 10 }) => {
      pointing.mockReturnValue(element);
      return engine.contextMenu(at)!.context ?? [];
    };
    const card = (id: string) => host.querySelector(`.canvas-node[data-node="${id}"]`);
    const order = { "canvas.order": ["canvas.bring_front", "canvas.send_back"] };
    // I colori (T47): Nessuno e i sei, «Colori delle note ›» coi nove, «Altro…».
    const colors = { "canvas.color": ["canvas.color.none", "canvas.color.1", "canvas.color.2", "canvas.color.3", "canvas.color.4", "canvas.color.5", "canvas.color.6", "—",
      { "canvas.color.notes": ["canvas.color.gray", "canvas.color.brown", "canvas.color.orange", "canvas.color.yellow", "canvas.color.green", "canvas.color.blue", "canvas.color.purple", "canvas.color.pink", "canvas.color.red"] },
      "canvas.color.other"] };
    // Il menu della scheda (T17): Disponi › con Allinea › e Distribuisci ›.
    const arrange = { "canvas.arrange": ["canvas.bring_front", "canvas.send_back", "—",
      { "canvas.align": ["canvas.align.left", "canvas.align.center", "canvas.align.right", "canvas.align.top", "canvas.align.middle", "canvas.align.bottom"] },
      { "canvas.distribute": ["canvas.distribute_x", "canvas.distribute_y"] }] };
    const tail = ["—", colors, arrange, "canvas.duplicate", "—", "canvas.delete"];
    const menus: Array<[readonly SurfaceMenuEntry[], unknown[]]> = [
      [menuOn(card("t")), ["canvas.edit", "canvas.connect", ...tail]],
      // Una scheda d'immagine si apre nel visore.
      [menuOn(card("f")), ["canvas.open_viewer", "canvas.connect", ...tail]],
      [menuOn(card("w")), ["canvas.open_url", "canvas.connect", ...tail]],
      // Un gruppo ha il menu di prima.
      [menuOn(card("g")), [colors, "canvas.duplicate", order, "canvas.fit_selection", "canvas.delete"]],
      [menuOn(host.querySelector('.canvas-edge-hit[data-edge="e1"]')), [colors, "canvas.edge.reverse", "canvas.delete"]],
      [menuOn(viewport, { x: 300, y: 300 }), [{ "canvas.add": ["canvas.add.text", "canvas.add.link", "canvas.add.group"] }, "canvas.fit", "canvas.zoom_in", "canvas.zoom_out", "canvas.navigator.hide"]],
    ];
    // Tutte le schede scelte: niente Apri né Collega….
    pointing.mockRestore();
    key(viewport, { key: "a", ctrlKey: true });
    menus.push([engine.contextMenu(null)!.context ?? [], tail.slice(1)]);
    for (const [menu, expected] of menus) {
      expect(shape(menu)).toEqual(expected);
      for (const item of leaves(menu)) {
        const command = catalog.get(item.id);
        expect(command, item.id).toBeDefined();
        // Un colore ha nel menu il nome corto del suo sottomenu («Blu»,
        // «Nessuno»), nella ricerca quello che dice di che cosa («Blu delle
        // note», «Nessun colore»): è lo stesso comando (T47).
        const color = item.id.startsWith("canvas.color.") ? (item.id.slice("canvas.color.".length) as CanvasColorChoice) : null;
        expect(item.label).toBe(color ? colorMenuLabel(color) : command!.label);
        if (color) expect(command!.label).toBe(t(colorCommandLabel(color)));
      }
    }
    engine.destroy();
  });

  it("i tasti di oggi passano dal catalogo: Ctrl+A, Ctrl+D, Canc, Ctrl+Z", () => {
    const { engine, viewport, changes } = mounted();
    key(viewport, { key: "a", ctrlKey: true });
    expect(key(viewport, { key: "d", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(8);
    key(viewport, { key: "Delete" });
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    key(viewport, { key: "z", ctrlKey: true });
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(8);
    expect(changes.length).toBe(3);
    engine.destroy();
  });

  it("mentre si scrive in una scheda Canc è del testo, e Ctrl+/ si apre ed Esc torna nel campo", () => {
    const { engine, host } = mounted();
    host.querySelector('.canvas-node[data-node="t"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = host.querySelector<HTMLTextAreaElement>(".canvas-text-editor")!;
    expect(input).not.toBeNull();
    expect(key(input, { key: "Delete" }).defaultPrevented).toBe(false);
    expect(readCanvas(engine.getDoc()).nodes).toHaveLength(4);
    expect(key(input, { key: "/", ctrlKey: true }).defaultPrevented).toBe(true);
    const search = document.querySelector<HTMLElement>(".draw-commands-dialog")!;
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search.querySelector("input"));
    // Il campo è ancora lì, col suo testo.
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    key(search.querySelector("input")!, { key: "Escape" });
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
    expect(host.querySelector(".canvas-text-editor")).toBe(input);
    expect(document.activeElement).toBe(input);
    engine.destroy();
  });

  it("Ctrl+/ sceglie un comando, lo esegue e lo mette in cima per quella lavagna sola", () => {
    const recents = new RecentCommands(null);
    const one = mounted({ recentCommands: recents });
    one.viewport.focus();
    key(one.viewport, { key: "/", ctrlKey: true });
    const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>(".draw-commands-dialog .draw-commands-field input")!;
    const labels = (): string[] => [...document.querySelectorAll(".draw-commands-dialog .draw-commands-label")].map((row) => row.textContent!);
    // La ricerca non elenca sé stessa.
    expect(labels()).not.toContain("Cerca fra i comandi");
    input().value = "scegli tutte";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
    expect(one.engine.selectedText()).not.toBeNull();
    expect(recents.list("board.canvas")).toEqual(["canvas.select_all"]);
    key(one.viewport, { key: "/", ctrlKey: true });
    expect(labels()[0]).toBe("Scegli tutte le schede");
    key(input(), { key: "Escape" });
    one.engine.destroy();
    const two = mounted({ recentCommands: recents, documentId: "altra.canvas" });
    key(two.viewport, { key: "/", ctrlKey: true });
    expect(labels()[0]).toBe("Annulla");
    key(input(), { key: "Escape" });
    two.engine.destroy();
  });

  it("un comando spento si vede col perché; in sola lettura il menu lo dice", () => {
    const { engine, host } = mounted();
    engine.setReadOnly(true);
    const commands = new Map(engine.commands().map((command) => [command.id, command]));
    expect(commands.get("canvas.align.left")!.disabled()).not.toBeNull();
    expect(commands.get("canvas.fit")!.disabled()).toBeNull();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(host.querySelector('.canvas-node[data-node="t"]'));
    const items = engine.contextMenu({ x: 10, y: 10 })!.context as readonly SurfaceMenuItem[];
    const duplicate = items.find((item) => item.id === "canvas.duplicate")!;
    expect(duplicate.enabled).toBe(false);
    expect(duplicate.description).toBe("La lavagna è in sola lettura.");
    expect(duplicate.chord).toBe("Mod-d");
    engine.destroy();
  });
});
