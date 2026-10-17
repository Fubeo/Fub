// @vitest-environment happy-dom
// FubDraw come consumatore degli strumenti dell'inchiostro: il registro della
// barra e quello dell'inchiostro dicono gli stessi strumenti, e penna,
// evidenziatore e gomma scrivono, si annullano, si ripetono e si rileggono
// passando dalle ricette di `src/ink/tools`, non da copie dell'editor.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatBrush } from "../../../ink/brush";
import { INK_TOOLS } from "../../../ink/tools/registry";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { LAYER } from "./test-support";
import { createDrawEditor, type DrawEditor } from "./editor";
import { strokeElem } from "./edit";
import { TOOLS, toolSpec } from "./registry";

const RECT = '<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>';
const PAGE = doc(`<title>Prova</title>${LAYER}${RECT}</g>`);

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;
let clock = 100;

function mount(source = PAGE): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(source), owner, { level: "standard" });
  return editor;
}

const surface = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;

type Device = { readonly pointerId: number; readonly pointerType: "mouse" | "pen" };
const MOUSE: Device = { pointerId: 1, pointerType: "mouse" };
const STYLUS: Device = { pointerId: 2, pointerType: "pen" };

function pointer(type: string, x: number, y: number, device: Device, pressure: number): PointerEvent {
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
  });
  Object.defineProperty(event, "timeStamp", { value: (clock += 8) });
  return event;
}

function drag(points: readonly (readonly [number, number])[], device: Device = MOUSE, pressure = 0.5): void {
  const target = surface();
  const [x0, y0] = points[0]!;
  target.dispatchEvent(pointer("pointerdown", x0, y0, device, pressure));
  for (const [x, y] of points.slice(1)) target.dispatchEvent(pointer("pointermove", x, y, device, pressure));
  const [x1, y1] = points[points.length - 1]!;
  target.dispatchEvent(pointer("pointerup", x1, y1, device, pressure));
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

  it("la penna copre del tutto e non scrive l'opacità; l'evidenziatore scrive quella dello strumento", () => {
    expect(strokeElem("a", "#000000", brush, ink, null, "pen").attrs["fill-opacity"]).toBeUndefined();
    expect(strokeElem("a", "#000000", brush, ink, null, "highlighter").attrs["fill-opacity"]).toBe("0.4");
    expect(strokeElem("a", "#000000", brush, ink, null, "highlighter").attrs["fill-opacity"]).toBe(
      String(INK_TOOLS.stroke("highlighter")!.opacity),
    );
  });
});

describe("la penna dell'editor", () => {
  it("col mouse scrive il pennello della penna di sistema con la pressione simulata", () => {
    mount();
    editor.setTool("pen");
    drag(LINE);
    const [stroke] = strokesOf(editor.engine.text, "pen");
    expect(stroke!.brush).toBe(formatBrush(INK_TOOLS.stroke("pen")!.brush(editor.width, { pressure: false, continued: false })));
    expect(stroke!.brush).toContain("sim=1");
    expect(stroke!.opacity).toBeNull();
  });

  it("con la penna vera scrive la pressione com'è, e sim=0", () => {
    mount();
    editor.setTool("pen");
    drag(LINE, STYLUS, 0.7);
    const [stroke] = strokesOf(editor.engine.text, "pen");
    expect(stroke!.brush).toBe(formatBrush(INK_TOOLS.stroke("pen")!.brush(editor.width, { pressure: true, continued: false })));
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
    const expected = formatBrush(INK_TOOLS.stroke("highlighter")!.brush(editor.width, { pressure: true, continued: false }));
    for (const stroke of strokes) {
      expect(stroke.brush).toBe(expected);
      expect(stroke.opacity).toBe("0.4");
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
    expect(strokesOf(SceneEngine.open(written).text, "highlighter")[0]!.opacity).toBe("0.4");
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
