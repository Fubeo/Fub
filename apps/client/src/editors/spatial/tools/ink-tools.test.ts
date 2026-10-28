// @vitest-environment happy-dom
// FubDraw come consumatore degli strumenti dell'inchiostro: il registro della
// barra e quello dell'inchiostro dicono gli stessi strumenti, e penna,
// evidenziatore e gomma scrivono, si annullano, si ripetono e si rileggono
// passando dalle ricette di `src/ink/tools`, non da copie dell'editor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInkBrush } from "../../../ink/brush";
import { INK_TOOLS } from "../../../ink/tools/registry";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { doc } from "../scene/test-support";
import { LAYER } from "./test-support";
import { createDrawEditor, type DrawEditor, type DrawEditorOptions } from "./editor";
import type { SavedPen } from "../../../ink/pens";
import { strokeElem } from "./edit";
import { TOOLS, toolSpec } from "./registry";

const RECT = '<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>';
const PAGE = doc(`<title>Prova</title>${LAYER}${RECT}</g>`);

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;
let clock = 100;

function mount(source = PAGE, options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { level: "standard", ...options });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;

type Keys = { readonly shift?: boolean; readonly alt?: boolean };
type Device = { readonly pointerId: number; readonly pointerType: "mouse" | "pen" };
const MOUSE: Device = { pointerId: 1, pointerType: "mouse" };
const STYLUS: Device = { pointerId: 2, pointerType: "pen" };

function pointer(type: string, x: number, y: number, device: Device, pressure: number, keys: Keys = {}): PointerEvent {
  const up = type === "pointerup";
  const event = new PointerEvent(type, {
    ...device,
    bubbles: true,
    cancelable: true,
    composed: true,
    isPrimary: true,
    button: type === "pointermove" ? -1 : 0,
    buttons: up ? 0 : 1,
    pressure: up ? 0 : pressure,
    altitudeAngle: Math.PI / 2,
    clientX: x,
    clientY: y,
    shiftKey: keys.shift ?? false,
    altKey: keys.alt ?? false,
  });
  Object.defineProperty(event, "timeStamp", { value: (clock += 8) });
  return event;
}

/// Un trascinamento; `keys` dice i tasti tenuti a ogni evento, dal primo, e
/// l'ultimo vale per quelli dopo.
function drag(points: readonly (readonly [number, number])[], device: Device = MOUSE, pressure = 0.5, keys: readonly Keys[] = [{}]): void {
  const target = surface();
  const held = (i: number): Keys => keys[Math.min(i, keys.length - 1)]!;
  const [x0, y0] = points[0]!;
  target.dispatchEvent(pointer("pointerdown", x0, y0, device, pressure, held(0)));
  points.slice(1).forEach(([x, y], i) => target.dispatchEvent(pointer("pointermove", x, y, device, pressure, held(i + 1))));
  const [x1, y1] = points[points.length - 1]!;
  target.dispatchEvent(pointer("pointerup", x1, y1, device, pressure, held(points.length)));
}

/// I campioni dei tratti di `tool` nel file, in unità.
function samplesOf(text: string, tool: string): Array<Array<readonly [number, number]>> {
  return [...text.matchAll(new RegExp(`<path [^>]*fub:tool="${tool}"[^>]*/>`, "g"))].map(([tag]) => {
    const ink = inkToQuantized(decodeInk(/fub:ink="([^"]+)"/.exec(tag)![1]!));
    return ink.samples.map((sample) => [sample.x / ink.scale, sample.y / ink.scale] as const);
  });
}

/// Il tratto sta su una retta che va a un multiplo di 15°?
function straightAt15(points: readonly (readonly [number, number])[]): boolean {
  const [x0, y0] = points[0]!;
  const [x1, y1] = points[points.length - 1]!;
  const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  const onLine = points.every(([x, y]) => Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / Math.hypot(x1 - x0, y1 - y0) < 0.02);
  return onLine && Math.abs(angle / 15 - Math.round(angle / 15)) < 0.01;
}

const LINE: ReadonlyArray<readonly [number, number]> = [[10, 10], [14, 12], [20, 15], [28, 16], [36, 16]];

/// Gli attributi `fub:brush` e `fill-opacity` dei tratti di `tool` nel file.
function strokesOf(text: string, tool: string): Array<{ brush: string; opacity: string | null }> {
  return [...text.matchAll(new RegExp(`<path [^>]*fub:tool="${tool}"[^>]*/>`, "g"))].map(([tag]) => ({
    brush: /fub:brush="([^"]+)"/.exec(tag)![1]!,
    opacity: /fill-opacity="([^"]+)"/.exec(tag)?.[1] ?? null,
  }));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  clock += 1000;
});

afterEach(() => {
  owner.close();
  host.remove();
});

describe("il registro della barra e quello dell'inchiostro", () => {
  it("ogni strumento dell'inchiostro è nella barra, nel gruppo dell'inchiostro", () => {
    for (const tool of INK_TOOLS.list()) {
      const spec = toolSpec(tool.id as never);
      expect(spec.id, tool.id).toBe(tool.id);
      expect(spec.group, tool.id).toBe("ink");
    }
  });

  it("penna, evidenziatore e gomma sono nell'uno e nell'altro, e nient'altro è dell'inchiostro", () => {
    expect(INK_TOOLS.list().map((tool) => tool.id).sort()).toEqual(["eraser", "highlighter", "pen"]);
    // Il gruppo dell'inchiostro della barra ha in più soltanto la nota, che
    // scrive testo e non campioni.
    const bar = TOOLS.filter((spec) => spec.group === "ink").map((spec) => spec.id).sort();
    expect(bar).toEqual(["eraser", "highlighter", "note", "pen"]);
  });

  it("gli strumenti che il file chiama per nome hanno una ricetta", () => {
    for (const name of ["pen", "highlighter"] as const) expect(INK_TOOLS.stroke(name), name).toBeDefined();
  });
});

describe("l'elemento di un tratto", () => {
  const brush = INK_TOOLS.stroke("pen")!.brush(4, { pressure: true, continued: false });
  const ink = { scale: 100 as const, samples: [{ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 8 }] };

  it("la penna copre del tutto e non scrive l'opacità; l'evidenziatore scrive la sua e moltiplica", () => {
    const marker = INK_TOOLS.stroke("highlighter")!.brush(16, { pressure: true, continued: false });
    expect(strokeElem("a", "#000000", brush, ink, null, "pen").attrs["fill-opacity"]).toBeUndefined();
    expect(strokeElem("a", "#000000", brush, ink, null, "pen").attrs.style).toBeUndefined();
    const highlight = strokeElem("a", "#000000", marker, ink, null, "highlighter").attrs;
    expect(highlight["fill-opacity"]).toBe("0.5");
    expect(highlight["fill-opacity"]).toBe(String(INK_TOOLS.stroke("highlighter")!.opacity));
    expect(highlight.style).toBe("mix-blend-mode: multiply");
  });
});

describe("la penna dell'editor", () => {
  it("col mouse scrive il pennello della penna di sistema con la pressione simulata", () => {
    mount();
    editor.setTool("pen");
    drag(LINE);
    const [stroke] = strokesOf(editor.engine.text, "pen");
    expect(stroke!.brush).toBe(formatInkBrush(INK_TOOLS.stroke("pen")!.brush(editor.width, { pressure: false, continued: false })));
    expect(stroke!.brush).toContain("sim=1");
    expect(stroke!.opacity).toBeNull();
  });

  it("con la penna vera scrive la pressione com'è, e sim=0", () => {
    mount();
    editor.setTool("pen");
    drag(LINE, STYLUS, 0.7);
    const [stroke] = strokesOf(editor.engine.text, "pen");
    expect(stroke!.brush).toBe(formatInkBrush(INK_TOOLS.stroke("pen")!.brush(editor.width, { pressure: true, continued: false })));
    expect(stroke!.brush).toContain("sim=0");
  });

  it("il tratto si annulla, si ripete e si rilegge uguale dal file", () => {
    mount();
    editor.setTool("pen");
    drag(LINE);
    const written = editor.engine.text;
    expect(strokesOf(written, "pen")).toHaveLength(1);
    editor.undo();
    expect(editor.engine.text).toBe(PAGE);
    editor.redo();
    expect(editor.engine.text).toBe(written);
    // Salvato e riaperto, il file è lo stesso e il tratto si ridisegna.
    const reopened = SceneEngine.open(written);
    expect(reopened.text).toBe(written);
    expect(strokesOf(reopened.text, "pen")).toEqual(strokesOf(written, "pen"));
  });
});

describe("l'evidenziatore dell'editor", () => {
  it("scrive il pennello a spessore costante e la sua opacità, con qualunque dispositivo", () => {
    mount();
    editor.setTool("highlighter");
    drag(LINE, MOUSE);
    drag(LINE, STYLUS, 0.9);
    const strokes = strokesOf(editor.engine.text, "highlighter");
    expect(strokes).toHaveLength(2);
    const expected = formatInkBrush(INK_TOOLS.stroke("highlighter")!.brush(editor.width, { pressure: true, continued: false }));
    for (const stroke of strokes) {
      expect(stroke.brush).toBe(expected);
      expect(stroke.opacity).toBe("0.5");
    }
  });

  it("annulla e ripete, e il file riaperto tiene l'opacità", () => {
    mount();
    editor.setTool("highlighter");
    drag(LINE);
    const written = editor.engine.text;
    editor.undo();
    expect(editor.engine.text).toBe(PAGE);
    editor.redo();
    expect(editor.engine.text).toBe(written);
    expect(strokesOf(SceneEngine.open(written).text, "highlighter")[0]!.opacity).toBe("0.5");
  });
});

describe("la gomma dell'editor", () => {
  it("toglie ciò che attraversa con il raggio della gomma di sistema, e si annulla", () => {
    mount();
    editor.setTool("eraser");
    // Il rettangolo sta a 60…80: a 6 unità dal bordo la gomma da mouse (8) lo prende.
    drag([[40, 70], [54, 70]]);
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
    editor.undo();
    expect(editor.engine.text).toBe(PAGE);
  });

  it("a più di un raggio dal bordo non prende niente", () => {
    mount();
    editor.setTool("eraser");
    drag([[20, 70], [40, 70]]);
    expect(editor.engine.text).toBe(PAGE);
  });

  it("col dito il raggio è doppio", () => {
    mount();
    editor.setTool("eraser");
    const touch = { pointerId: 3, pointerType: "touch" } as unknown as Device;
    // Da 12 unità dal bordo: fuori per il mouse (8), dentro per il dito (16).
    drag([[30, 70], [48, 70]], touch);
    expect(editor.engine.text).not.toContain("o1a2b3c4d");
  });
});

describe("la penna con Maiusc e Alt", () => {
  const WAVY: ReadonlyArray<readonly [number, number]> = [[10, 10], [20, 18], [30, 12], [45, 22], [60, 15], [70, 20]];

  it("Maiusc durante il tratto lo raddrizza a passi di 15°", () => {
    mount();
    editor.setTool("pen");
    drag(WAVY, MOUSE, 0.5, [{ shift: true }]);
    const [points] = samplesOf(editor.engine.text, "pen");
    expect(straightAt15(points!)).toBe(true);
  });

  it("lasciato Maiusc, il tratto resta dritto fino al rilascio", () => {
    mount();
    editor.setTool("pen");
    drag(WAVY, MOUSE, 0.5, [{}, { shift: true }, {}]);
    expect(straightAt15(samplesOf(editor.engine.text, "pen")[0]!)).toBe(true);
    // Senza Maiusc, il tratto è quello della mano.
    drag(WAVY.map(([x, y]) => [x, y + 40] as const));
    expect(straightAt15(samplesOf(editor.engine.text, "pen")[1]!)).toBe(false);
  });

  it("Maiusc+clic tira una linea dalla fine dell'ultimo tratto, in un passo di Annulla", () => {
    mount();
    editor.setTool("pen");
    drag(LINE);
    const first = samplesOf(editor.engine.text, "pen")[0]!;
    const before = editor.engine.text;
    drag([[60, 60], [60, 60]], MOUSE, 0.5, [{ shift: true }]);
    const line = samplesOf(editor.engine.text, "pen")[1]!;
    const [ex, ey] = first[first.length - 1]!;
    expect(line[0]![0]).toBeCloseTo(ex, 1);
    expect(line[0]![1]).toBeCloseTo(ey, 1);
    expect(line.length).toBeGreaterThan(2);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("Alt tenuto con la penna prende il colore di un tratto, e non scrive", () => {
    mount();
    editor.setTool("highlighter");
    drag([[10, 30], [80, 30]]);
    editor.setTool("pen");
    expect(editor.color).toBe("#000000");
    const before = editor.engine.text;
    drag([[40, 30], [40, 30]], MOUSE, 0.5, [{ alt: true }]);
    expect(editor.engine.text).toBe(before);
    expect(editor.color).toBe("#f0e442");
  });
});

describe("la gomma precisa", () => {
  it("taglia il tratto dove passa, in due tratti veri, e Annulla lo rimette", () => {
    mount();
    editor.setTool("pen");
    drag([[10, 30], [30, 30], [50, 30], [70, 30], [90, 30]]);
    const before = editor.engine.text;
    editor.setGrid({ ...editor.grid, eraser: "precise" });
    editor.setTool("eraser");
    drag([[50, 10], [50, 50]]);
    const pieces = samplesOf(editor.engine.text, "pen");
    expect(pieces).toHaveLength(2);
    // Il taglio cade intorno a x = 50, e i capi veri restano.
    expect(pieces[0]![0]![0]).toBeCloseTo(10, 1);
    expect(pieces[0]![pieces[0]!.length - 1]![0]).toBeLessThan(50);
    expect(pieces[1]![0]![0]).toBeGreaterThan(50);
    expect(pieces[1]![pieces[1]!.length - 1]![0]).toBeCloseTo(90, 1);
    // Il primo pezzo tiene l'id del tratto, il secondo ne ha uno suo; ognuno
    // ha il suo d.
    const ids = [...editor.engine.text.matchAll(/<path id="([^"]+)"[^>]*fub:tool="pen"[^>]*\/>/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    expect(before).toContain(`id="${ids[0]}"`);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("col tratto intero, di serie, il tratto se ne va tutto", () => {
    mount();
    editor.setTool("pen");
    drag([[10, 30], [50, 30], [90, 30]]);
    editor.setTool("eraser");
    drag([[50, 10], [50, 50]]);
    expect(samplesOf(editor.engine.text, "pen")).toHaveLength(0);
  });

  it("un cammino che sfiora il tratto senza tagliarlo lo lascia com'è", () => {
    mount();
    editor.setTool("pen");
    drag([[10, 30], [50, 30], [90, 30]]);
    const before = editor.engine.text;
    editor.setGrid({ ...editor.grid, eraser: "precise" });
    editor.setTool("eraser");
    drag([[95, 10], [95, 20]]);
    expect(editor.engine.text).toBe(before);
  });
});

describe("la penna scelta", () => {
  it("scrive col suo pennello, e la griglia la ricorda", () => {
    mount();
    editor.setGrid({ ...editor.grid, penId: "fountain" });
    editor.setTool("pen");
    drag(LINE);
    expect(editor.engine.text).toMatch(/fub:brush="pf1 [^"]* pen=fountain"/);
    expect(editor.grid.penId).toBe("fountain");
  });

  it("la Calligrafia scrive la punta piatta", () => {
    mount();
    editor.setGrid({ ...editor.grid, penId: "calligraphy" });
    editor.setTool("pen");
    drag(LINE);
    expect(editor.engine.text).toMatch(/fub:brush="nib1 [^"]* pen=calligraphy"/);
  });
});

describe("la galleria delle penne e le mie penne", () => {
  const penChoice = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-pen-choice")!;
  const gallery = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-pen-gallery");
  const items = (): string[] => [...gallery()!.querySelectorAll(".draw-pen-gallery-item")].map((item) => `${item.textContent}${item.getAttribute("aria-pressed") === "true" ? "*" : ""}`);
  const item = (name: string): HTMLButtonElement => [...gallery()!.querySelectorAll<HTMLButtonElement>(".draw-pen-gallery-item")].find((each) => each.textContent === name)!;

  it("mostra le sei penne con l'anteprima, e sceglierne una la ricorda", () => {
    mount();
    editor.setTool("pen");
    expect(penChoice().hidden).toBe(false);
    penChoice().click();
    expect(penChoice().getAttribute("aria-expanded")).toBe("true");
    expect(items()).toEqual(["Sfera*", "Stilografica", "Pennello", "Pennarello", "Matita", "Calligrafia"]);
    expect(gallery()!.querySelectorAll(".draw-pen-preview path[d^='M']")).toHaveLength(6);
    item("Matita").click();
    expect(gallery()).toBeNull();
    expect(editor.grid.penId).toBe("pencil");
    expect(penChoice().getAttribute("aria-label")).toBe("Penna: Matita");
  });

  it("salva la penna di adesso col suo nome, la riprende e la toglie", async () => {
    const saved: Array<readonly SavedPen[]> = [];
    mount(PAGE, { onPensChange: (pens) => saved.push(pens) });
    editor.setTool("pen");
    editor.setWidth(12.5);
    editor.setColor("#0072b2");
    penChoice().click();
    item("Pennello").click();
    penChoice().click();
    gallery()!.querySelector<HTMLButtonElement>(".draw-pen-gallery-save")!.click();
    const input = document.querySelector<HTMLInputElement>(".palette-form input")!;
    expect(input.value).toBe("Pennello");
    input.value = "  Blu largo  ";
    input.closest("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();
    expect(saved[saved.length - 1]).toEqual([{ name: "Blu largo", pen: "brush", size: 12.5, color: "#0072b2", opacity: 1 }]);
    // Cambiata la penna, la mia la riporta com'era.
    editor.setWidth(2);
    editor.setColor("#000000");
    penChoice().click();
    item("Sfera").click();
    penChoice().click();
    item("Blu largo").click();
    expect([editor.grid.penId, editor.width, editor.color]).toEqual(["brush", 12.5, "#0072b2"]);
    penChoice().click();
    gallery()!.querySelector<HTMLButtonElement>(".draw-pen-saved-remove")!.click();
    expect(saved[saved.length - 1]).toEqual([]);
    expect(gallery()!.querySelector(".draw-pen-gallery-empty")).not.toBeNull();
  });

  it("la misura va da 0,25 a 200 col cursore logaritmico, e l'opacità entra nel tratto", () => {
    mount();
    editor.setTool("pen");
    const slider = host.querySelector<HTMLInputElement>(".draw-pen-size-slider")!;
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(editor.width).toBe(0.25);
    slider.value = "1000";
    slider.dispatchEvent(new Event("input"));
    expect(editor.width).toBe(200);
    editor.setWidth(4);
    expect(slider.getAttribute("aria-valuetext")).toBe("4 unità");
    const opacity = host.querySelector<HTMLInputElement>(".draw-pen-opacity input")!;
    opacity.value = "40";
    opacity.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    drag(LINE);
    expect(editor.engine.text).toMatch(/fill-opacity="0.4"/);
  });

  it("in «Semplice» le opzioni della penna non ci sono", () => {
    mount(PAGE, { level: "essential" });
    editor.setTool("pen");
    expect(host.querySelector<HTMLElement>(".draw-pen-choice")!.closest<HTMLElement>(".draw-group")!.hidden).toBe(true);
  });
});

describe("la punta che si vede", () => {
  const hover = (x: number, y: number, pointerType: "mouse" | "pen" | "touch" = "pen"): void => {
    surface().dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, pointerType, bubbles: true, button: -1, buttons: 0, clientX: x, clientY: y }));
  };
  const press = (key: string): void => {
    surface().focus();
    surface().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };

  it("segue la penna sospesa, non il dito, e si spegne con uno strumento senza punta", () => {
    mount();
    editor.setTool("pen");
    hover(30, 30);
    expect(surface().hasAttribute("data-nib")).toBe(true);
    // Durante il tratto si vede l'inchiostro, non la punta.
    surface().dispatchEvent(pointer("pointerdown", 30, 30, STYLUS, 0.5));
    surface().dispatchEvent(pointer("pointermove", 40, 32, STYLUS, 0.5));
    expect(surface().hasAttribute("data-nib")).toBe(false);
    surface().dispatchEvent(pointer("pointerup", 40, 32, STYLUS, 0));
    hover(30, 30, "touch");
    expect(surface().hasAttribute("data-nib")).toBe(false);
    hover(30, 30, "mouse");
    editor.setTool("eraser");
    expect(surface().hasAttribute("data-nib")).toBe(true);
    editor.setTool("select");
    expect(surface().hasAttribute("data-nib")).toBe(false);
  });

  it("[ e ] stringono e allargano la punta della Penna, fra 0,25 e 200, senza toccare il disegno", () => {
    mount();
    editor.setTool("pen");
    editor.setWidth(4);
    press("]");
    expect(editor.width).toBe(5);
    press("[");
    press("[");
    expect(editor.width).toBe(3.2);
    editor.setWidth(200);
    press("]");
    expect(editor.width).toBe(200);
    expect(editor.engine.text).toBe(PAGE);
  });
});

describe("la mano della Penna", () => {
  it("apre la levigatura e la curva di «Penna e dita», e scrive la griglia a scelta fatta", () => {
    mount();
    editor.setTool("pen");
    const hand = [...host.querySelectorAll<HTMLButtonElement>(".draw-pen-choice")].find((each) => each.textContent === "Mano")!;
    expect(hand.hidden).toBe(false);
    hand.click();
    const panel = document.querySelector<HTMLElement>(".draw-hand-panel")!;
    expect([...panel.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual(["Stabilizzatore", "Pressione della penna"]);
    const [amount] = [...panel.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    amount!.value = "60";
    amount!.dispatchEvent(new Event("input"));
    amount!.dispatchEvent(new Event("change"));
    expect(editor.grid.steady).toEqual({ amount: 0.6, string: false });
    panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(editor.grid.steady).toEqual({ amount: 0.6, string: true });
  });
});

describe("ripennare i tratti scelti", () => {
  const INK = "1 s100 cxypt 4000,4000,128,0 1000,500,2,8 1000,-300,0,8 900,700,0,8";
  const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
  const STROKE = `<path id="s1" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="${INK}" d="M40 40 L69 50"/>`;
  const penChoice = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-pen-choice")!;
  const item = (name: string): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>(".draw-pen-gallery .draw-pen-gallery-item")].find((each) => each.textContent === name)!;

  it("con un tratto scelto, un'altra penna lo ridisegna dai campioni in un passo di Annulla", () => {
    mount(doc(`${LAYER}${STROKE}${RECT}</g>`));
    const before = editor.engine.text;
    editor.select(["s1"]);
    editor.setTool("pen");
    penChoice().click();
    item("Pennarello").click();
    const [stroke] = strokesOf(editor.engine.text, "pen");
    expect(stroke!.brush).toContain("pen=marker");
    expect(editor.engine.text).toContain(`fub:ink="${INK}"`);
    expect(editor.selection).toEqual(["s1"]);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });

  it("senza tratti scelti la penna cambia soltanto la Penna", () => {
    mount(doc(`${LAYER}${STROKE}${RECT}</g>`));
    const before = editor.engine.text;
    editor.select(["o1a2b3c4d"]);
    editor.setTool("pen");
    penChoice().click();
    item("Pennarello").click();
    expect(editor.engine.text).toBe(before);
    expect(editor.grid.penId).toBe("marker");
  });
});

describe("l'uscita della Penna", () => {
  const outputButton = (): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>(".draw-pen-choice")].find((each) => each.getAttribute("aria-label")?.startsWith("Uscita"))!;
  const choice = (name: string): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>(".draw-pen-gallery .draw-pen-gallery-item")].find((each) => each.textContent === name)!;

  it("con «Tracciato» il tratto entra come tracciato, senza campioni, e la scelta si ricorda", () => {
    const grids: unknown[] = [];
    mount(PAGE, { onGridChange: (grid) => grids.push(grid) });
    editor.setTool("pen");
    expect(outputButton().getAttribute("aria-label")).toBe("Uscita: Inchiostro");
    outputButton().click();
    expect(document.querySelector(".draw-pen-gallery")!.textContent).toContain("non tiene i campioni");
    choice("Tracciato leggero").click();
    expect(editor.grid).toMatchObject({ output: "path", fidelity: "low" });
    expect(grids[grids.length - 1]).toMatchObject({ output: "path", fidelity: "low" });
    const before = editor.engine.text;
    drag(LINE);
    const text = editor.engine.text;
    expect(text).not.toContain("fub:ink=");
    expect(text).toMatch(/<path id="[^"]+" [^>]*stroke-width="/);
    editor.undo();
    expect(editor.engine.text).toBe(before);
  });
});

describe("Riproduci", () => {
  const INK = "1 s100 cxyt 4000,4000,0 1000,500,100 1000,-300,100";
  const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
  const STROKE = `<path id="s1" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="${INK}" d="M40 40 L60 42"/>`;

  it("dal menu Vista riscrive il disegno sul foglio, senza cambiare il file, e un tasto la ferma", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    try {
      mount(doc(`${LAYER}${STROKE}${RECT}</g>`));
      const before = editor.engine.text;
      const tool = editor.tool;
      editor.replay(2);
      expect(surface().hasAttribute("data-replaying")).toBe(true);
      vi.advanceTimersByTime(48);
      expect(editor.engine.text).toBe(before);
      surface().dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
      expect(surface().hasAttribute("data-replaying")).toBe(false);
      // La A sceglierebbe i Nodi: ferma la riproduzione e basta.
      expect(editor.tool).toBe(tool);
      editor.replay(4);
      vi.advanceTimersByTime(1000);
      expect(surface().hasAttribute("data-replaying")).toBe(false);
      expect(editor.engine.text).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("il righello", () => {
  const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();
  /// Il righello dalla palette: la camera parte dall'identità e la vista non
  /// ha misura, quindi sta orizzontale sull'origine, largo 72 pixel.
  const showRuler = async (): Promise<void> => {
    surface().focus();
    surface().dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }));
    const input = document.querySelector<HTMLInputElement>(".draw-commands-field input")!;
    input.value = "righello";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  };

  it("un tratto che comincia vicino al bordo lo segue, uno lontano no", async () => {
    mount();
    editor.setTool("pen");
    await showRuler();
    expect(spoken()).toContain("Righello sul foglio, a 0°");
    drag([[10, 40], [30, 46], [60, 33], [90, 44]]);
    drag([[10, 120], [30, 126], [60, 113], [90, 124]]);
    const [near, far] = samplesOf(editor.engine.text, "pen");
    const ys = new Set(near!.map(([, y]) => y));
    expect(ys.size).toBe(1);
    expect([...ys][0]!).toBeGreaterThan(36);
    expect(new Set(far!.map(([, y]) => y)).size).toBeGreaterThan(1);
  });

  it("si prende in mezzo e si sposta, e la rotella lo gira, con Maiusc a passi di 15°", async () => {
    mount();
    editor.setTool("pen");
    await showRuler();
    const before = editor.engine.text;
    drag([[50, 0], [50, 40], [50, 100]]);
    // Spostarlo non scrive niente: il tratto è del righello.
    expect(editor.engine.text).toBe(before);
    expect(spoken()).toBe("Righello spostato.");
    const wheel = (y: number, deltaY: number, shiftKey = false): void => {
      const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
      // happy-dom non legge `clientX`, `clientY` e i tasti di una rotella.
      Object.defineProperties(event, { clientX: { value: 50 }, clientY: { value: y }, shiftKey: { value: shiftKey } });
      surface().dispatchEvent(event);
    };
    wheel(100, 100);
    expect(spoken()).toBe("Righello a 5°.");
    wheel(100, 60, true);
    expect(spoken()).toBe("Righello a 15°.");
    // Lontano dal righello la rotella muove la vista, come sempre.
    wheel(300, 100);
    expect(spoken()).toBe("Righello a 15°.");
  });
});
