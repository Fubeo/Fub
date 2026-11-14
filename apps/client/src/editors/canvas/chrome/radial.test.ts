// @vitest-environment happy-dom
// Il menu radiale della lavagna (T63): le otto voci nelle loro direzioni
// (Annulla in alto, Ripeti in basso, gli strumenti a destra, i colori a
// sinistra), i recenti della seduta e quelli di riserva, la sola lettura, e il
// menu del disegno che le mostra: una direzione per voce, le cifre del
// tastierino, il bordo della finestra.
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n/strings";
import { DIRECTIONS, closeRadial, radialCenter, sectorOf } from "../../spatial/tools/radial";
import { ensureCanvasIcons } from "./icons";
import { CANVAS_TOOL_IDS, toolCommandId, type CanvasCommand, type CanvasToolId } from "./commands";
import {
  RADIAL_FILL_COLORS,
  RADIAL_FILL_TOOLS,
  RADIAL_RECENT_MAX,
  canvasRadialItems,
  openCanvasRadial,
  radialColorLabel,
  rememberRecent,
  threeOf,
  type CanvasRadialSource,
} from "./radial";

afterEach(() => {
  closeRadial();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const BLUE = "#0072b2";
const VERMILION = "#d55e00";
const GREEN = "#009e73";
const BLACK = "#000000";
const PURPLE = "#cc79a7";

/** Un comando finto del catalogo: `off` dà il perché, se è spento. */
function command(id: string, label: string, keys: readonly string[], run = vi.fn(), off: string | null = null): CanvasCommand {
  return { id, label, path: "Lavagna", keys, context: "always", boardKeys: false, danger: false, disabled: () => off, run };
}

/** Una tela finta: Annulla e Ripeti, e gli strumenti del catalogo. */
function source(overrides: Partial<CanvasRadialSource> & { off?: readonly string[] } = {}) {
  const runs = { undo: vi.fn(), redo: vi.fn() };
  const commands = new Map<string, CanvasCommand>([
    ["canvas.undo", command("canvas.undo", "Annulla", ["Mod-z"], runs.undo)],
    ["canvas.redo", command("canvas.redo", "Ripeti", ["Mod-Shift-z"], runs.redo, "Non c'è niente da ripetere.")],
    ...CANVAS_TOOL_IDS.map((tool): [string, CanvasCommand] => [
      toolCommandId(tool),
      command(toolCommandId(tool), t(`canvas.tool.${tool}`), [tool === "select" ? "v" : tool === "text" ? "t" : "p"], vi.fn(), overrides.off?.includes(tool) ? "sola lettura" : null),
    ]),
  ]);
  const picked = { tools: [] as CanvasToolId[], colors: [] as string[] };
  const base: CanvasRadialSource = {
    command: (id) => commands.get(id) ?? null,
    tool: "pen",
    recentTools: [],
    color: BLUE,
    recentColors: [],
    readOnly: false,
    pickTool: (tool) => picked.tools.push(tool),
    pickColor: (color) => picked.colors.push(color),
  };
  return { source: { ...base, ...overrides }, runs, picked };
}

/** Le voci come si leggono: il nome, o `null` per un posto vuoto. */
const labels = (items: ReturnType<typeof canvasRadialItems>) => items.map((item) => item?.label ?? null);

describe("le voci del menu radiale della lavagna", () => {
  it("Annulla in alto, Ripeti in basso, gli strumenti a destra e i colori a sinistra, come nel prototipo", () => {
    const { source: from } = source();
    const items = canvasRadialItems(from);
    expect(items).toHaveLength(DIRECTIONS.length);
    // Senza recenti, con la Penna: Testo a est, Selezione a nord-est,
    // Evidenziatore a sud-est; i colori, senza il blu di adesso, Vermiglio a
    // ovest, Verde a nord-ovest e poi il Nero a sud-ovest.
    expect(labels(items)).toEqual([
      "Annulla",
      t("canvas.tool.select"),
      t("canvas.tool.text"),
      t("canvas.tool.highlighter"),
      "Ripeti",
      radialColorLabel(BLACK),
      radialColorLabel(VERMILION),
      radialColorLabel(GREEN),
    ]);
    expect(items[0]!.icon).toBe("draw-undo");
    expect(items[4]!.icon).toBe("draw-redo");
    expect(items[2]!.icon).toBe("canvas-text");
    expect(items[6]!.swatch).toEqual({ color: VERMILION });
    expect(radialColorLabel(VERMILION)).toBe(t("canvas.radial.color", { name: t("canvas.ink.color.vermilion") }));
    // Il tasto del comando accanto al nome; il comando spento è spento.
    expect(items[0]!.hint).toBe("Ctrl+Z");
    expect(items[0]!.disabled).toBe(false);
    expect(items[4]!.disabled).toBe(true);
  });

  it("i recenti della seduta vengono prima di quelli di riserva, senza quello di adesso", () => {
    const { source: from } = source({
      tool: "select",
      recentTools: ["select", "lasso", "eraser"],
      color: GREEN,
      recentColors: [GREEN, PURPLE, BLUE],
    });
    const items = canvasRadialItems(from);
    // Il più recente in orizzontale, il secondo sopra, il terzo sotto.
    expect(items[2]!.label).toBe(t("canvas.tool.lasso"));
    expect(items[1]!.label).toBe(t("canvas.tool.eraser"));
    expect(items[3]!.label).toBe(t("canvas.tool.text"));
    expect(items[6]!.swatch).toEqual({ color: PURPLE });
    expect(items[7]!.swatch).toEqual({ color: BLUE });
    expect(items[5]!.swatch).toEqual({ color: VERMILION });
  });

  it("uno strumento e un colore scelti dal menu arrivano alla tela; Annulla al suo comando", () => {
    const { source: from, runs, picked } = source();
    const items = canvasRadialItems(from);
    items[2]!.run();
    items[6]!.run();
    items[0]!.run();
    // Ripeti è spento: non parte nemmeno chiamato.
    items[4]!.run();
    expect(picked).toEqual({ tools: ["text"], colors: [VERMILION] });
    expect(runs.undo).toHaveBeenCalledOnce();
    expect(runs.redo).not.toHaveBeenCalled();
  });

  it("in sola lettura Annulla e Ripeti sono spenti, e gli strumenti che scrivono come dice il catalogo", () => {
    const { source: from } = source({ readOnly: true, off: ["text", "highlighter"] });
    const items = canvasRadialItems(from);
    expect(items[0]!.disabled).toBe(true);
    expect(items[4]!.disabled).toBe(true);
    expect(items[1]!.disabled).toBe(false);
    expect(items[2]!.disabled).toBe(true);
    expect(items[3]!.disabled).toBe(true);
  });

  it("uno strumento che la tela non ha non entra, e il posto si riempie col seguente", () => {
    const { source: from } = source();
    const without: CanvasRadialSource = { ...from, command: (id) => (id === toolCommandId("text") ? null : from.command(id)) };
    expect(labels(canvasRadialItems(without)).slice(1, 4)).toEqual([
      t("canvas.tool.highlighter"), t("canvas.tool.select"), t("canvas.tool.eraser"),
    ]);
    // Senza Annulla nel catalogo, il posto in alto resta vuoto.
    expect(canvasRadialItems({ ...from, command: (id) => (id === "canvas.undo" ? null : from.command(id)) })[0]).toBeNull();
  });

  it("i recenti: il nuovo in testa, quello di prima dietro, senza doppioni e al più quattro", () => {
    expect(rememberRecent([], "pen", "select")).toEqual(["pen", "select"]);
    expect(rememberRecent(["pen", "select"], "text", "pen")).toEqual(["text", "pen", "select"]);
    expect(rememberRecent(["text", "pen", "select", "hand"], "select", "text")).toEqual(["select", "text", "pen", "hand"]);
    expect(rememberRecent(["a", "b", "c", "d"], "e")).toHaveLength(RADIAL_RECENT_MAX);
    expect(threeOf(["x"], ["y"], "y", () => true)).toEqual(["x", undefined, undefined]);
    // Le riserve sono tutti gli strumenti e tutti i colori della tavolozza, una volta.
    expect([...RADIAL_FILL_TOOLS].sort()).toEqual([...CANVAS_TOOL_IDS].sort());
    expect(new Set(RADIAL_FILL_COLORS).size).toBe(RADIAL_FILL_COLORS.length);
    expect(RADIAL_FILL_COLORS.slice(0, 4)).toEqual([VERMILION, GREEN, BLUE, BLACK]);
  });
});

describe("il menu radiale della lavagna aperto", () => {
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".draw-radial-item")];

  it("ogni voce sta nella sua direzione, col nome e la cifra del tastierino; nel mezzo lo strumento e il colore", () => {
    ensureCanvasIcons();
    const { source: from } = source();
    openCanvasRadial(400, 300, from);
    const ring = document.querySelector<HTMLElement>(".draw-radial-ring")!;
    expect(ring.getAttribute("role")).toBe("menu");
    expect(ring.getAttribute("aria-label")).toBe(t("canvas.radial"));
    const shown = buttons();
    expect(shown.map((button) => button.dataset.direction)).toEqual([...DIRECTIONS]);
    expect(shown.map((button) => button.getAttribute("aria-label"))).toEqual(labels(canvasRadialItems(from)));
    expect(shown.map((button) => button.getAttribute("aria-keyshortcuts"))).toEqual(["8", "9", "6", "3", "2", "1", "4", "7"]);
    // La direzione che il puntatore prende verso una voce è la sua.
    shown.forEach((button, index) => {
      expect(sectorOf(parseFloat(button.style.left), parseFloat(button.style.top))).toBe(index);
    });
    expect(shown[4]!.getAttribute("aria-disabled")).toBe("true");
    const center = ring.querySelector<HTMLElement>(".draw-radial-center")!;
    expect(center.style.getPropertyValue("--radial-color")).toBe(BLUE);
    expect(center.querySelector("svg")).not.toBeNull();
  });

  it("l'8 annulla, il 6 prende lo strumento più recente, il 4 il colore; il menu si chiude", () => {
    const { source: from, runs, picked } = source();
    const keys = (key: string) => {
      openCanvasRadial(400, 300, from);
      document.querySelector(".draw-radial-ring")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    };
    keys("8");
    expect(runs.undo).toHaveBeenCalledOnce();
    keys("6");
    keys("4");
    expect(picked).toEqual({ tools: ["text"], colors: [VERMILION] });
  });

  it("a un bordo della finestra il menu si sposta dove si vede intero", () => {
    const { source: from } = source();
    const closed = vi.fn();
    const radial = openCanvasRadial(2, 2, from, { onClose: closed });
    const ring = radial.element.querySelector<HTMLElement>(".draw-radial-ring")!;
    const [x, y] = radialCenter(2, 2, window.innerWidth, window.innerHeight);
    expect([parseFloat(ring.style.left), parseFloat(ring.style.top)]).toEqual([x, y]);
    expect(x).toBeGreaterThan(2);
    expect(y).toBeGreaterThan(2);
    radial.close();
    expect(closed).toHaveBeenCalledOnce();
  });
});
