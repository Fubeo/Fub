// @vitest-environment happy-dom
//
// La scheda «Disegna»: i tratti di una sessione diventano un oggetto `ink`
// davanti al testo, in un passo di Annulla; la gomma e il lazo cambiano gli
// oggetti; OpenDocument riceve un disegno; in sola lettura non si disegna.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RichEngine } from "./engine";
import { INK_SESSION_PAUSE, RichInk } from "./ink";
import { boxOf, erase, lassoed, shapeSvg, tracesOf, type InkTrace } from "./ink-shape";
import { parseProjection, type AtomInline, type Block, type Para } from "./projection";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

let engines: RichEngine[] = [];
let inks: RichInk[] = [];
afterEach(() => {
  for (const ink of inks) ink.destroy();
  for (const engine of engines) engine.destroy();
  inks = [];
  engines = [];
  document.body.replaceChildren();
  vi.useRealTimers();
});

const para = (x: string, c: unknown[] = []): Block => ({ t: "para", role: { kind: "body" }, c: [...c, { t: "text", x }] }) as Block;

/// Un inchiostro tenuto: due tratti orizzontali, uno a y 2 e uno a y 10.
const KEPT = {
  t: "atom",
  k: "I",
  kind: "ink",
  label: "Firma",
  w: 40,
  h: 12,
  ink: {
    strokes: [
      { color: "#000000", width: 2, xy: [1, 2, 20, 2, 39, 2] },
      { color: "#0072b2", width: 2, xy: [1, 10, 20, 10, 39, 10] },
    ],
  },
  float: { wrap: "front", x: 0, y: 0 },
};

function setup(blocks: Block[] = [para("Testo")], options: { asDrawing?: boolean } = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  engine.setDoc(JSON.stringify({ format: "fub-rich", version: 4, opaque_schema: 3, blocks }));
  engines.push(engine);
  const ink = new RichInk(engine, { renderPng: () => PNG, ...options });
  inks.push(ink);
  return { engine, ink };
}

function atoms(engine: RichEngine): AtomInline[] {
  const projection = parseProjection(engine.getDoc());
  return projection.blocks.flatMap((block) => ((block as Para).c ?? []).filter((inline): inline is AtomInline => inline.t === "atom"));
}

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    isPrimary: true,
    pointerId: 7,
    pointerType: "pen",
    clientX: x,
    clientY: y,
    button: type === "pointermove" ? -1 : 0,
    buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : 0.5,
    ...init,
  });
}

/// Un tratto della penna sul velo, da un punto all'altro.
function stroke(points: ReadonlyArray<readonly [number, number]>, init: PointerEventInit = {}): void {
  const veil = document.querySelector<HTMLElement>(".rich-ink-veil")!;
  const [first, ...rest] = points;
  veil.dispatchEvent(pointer("pointerdown", first![0], first![1], init));
  for (const [x, y] of rest) veil.dispatchEvent(pointer("pointermove", x, y, init));
  const last = points[points.length - 1]!;
  veil.dispatchEvent(pointer("pointerup", last[0], last[1], init));
}

describe("la geometria dell'inchiostro", () => {
  const trace: InkTrace = { color: "#000000", width: 4, hl: false, points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 50, y: 10 }] };

  it("chiude i tratti nel loro riquadro, spessore compreso", () => {
    const box = boxOf([trace])!;
    expect([box.x, box.y, box.w, box.h]).toEqual([7.5, 7.5, 45, 5]);
    expect(box.shape.strokes[0]!.xy).toEqual([2.5, 2.5, 22.5, 2.5, 42.5, 2.5]);
    expect(tracesOf(box.shape, box.x, box.y)[0]!.points).toEqual(trace.points);
    expect(boxOf([])).toBeNull();
  });

  it("la gomma toglie il tratto intero o soltanto i punti che tocca", () => {
    expect(erase([trace], { x: 100, y: 100 }, 2, true)).toBeNull();
    expect(erase([trace], { x: 50, y: 10 }, 2, true)).toEqual([]);
    const long: InkTrace = { ...trace, points: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0, p: 0.5 })) };
    const pieces = erase([long], { x: 50, y: 0 }, 1, false)!;
    expect(pieces.map((piece) => piece.points.map((point) => point.x))).toEqual([[0, 10, 20, 30, 40], [60, 70, 80, 90, 100]]);
    expect(pieces[0]!.points[0]!.p).toBe(0.5);
  });

  it("il lazo prende i tratti con più di metà dei punti dentro", () => {
    const ring = [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: 35, y: 20 }, { x: 0, y: 20 }];
    expect(lassoed(trace, ring)).toBe(true);
    expect(lassoed({ ...trace, points: trace.points.map((point) => ({ ...point, x: point.x + 20 })) }, ring)).toBe(false);
  });

  it("dà un SVG intero, l'evidenziatore trasparente", () => {
    const box = boxOf([trace, { ...trace, hl: true, color: "#f0e442" }])!;
    const svg = shapeSvg(box.shape, box.w, box.h);
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="45pt" height="5pt"`)).toBe(true);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain(`fill="#f0e442" fill-opacity="0.4"`);
  });
});

describe("la scheda «Disegna»", () => {
  it("una sessione della penna è un inchiostro davanti al testo, in un passo di Annulla", () => {
    const { engine, ink } = setup();
    ink.setTool("pen");
    expect(document.querySelector(".rich-ink-veil")).not.toBeNull();
    stroke([[40, 40], [60, 44], [80, 48]]);
    stroke([[40, 60], [80, 60]]);
    expect(ink.pending).toHaveLength(2);
    expect(document.querySelectorAll(".rich-ink-pending")).toHaveLength(2);
    // Finché la sessione è aperta il documento non cambia.
    expect(atoms(engine)).toEqual([]);
    ink.commit();
    const [atom] = atoms(engine);
    expect(atom).toMatchObject({ kind: "ink", data: PNG, float: { wrap: "front" } });
    expect(atom!.k).toBeUndefined();
    expect(atom!.ink!.strokes).toHaveLength(2);
    expect(atom!.ink!.strokes[0]!.p?.length).toBe(atom!.ink!.strokes[0]!.xy.length / 2);
    expect(document.querySelector(".rich-atom-ink svg.rich-ink path")).not.toBeNull();
    expect(ink.pending).toEqual([]);
    expect(engine.run("text.undo")).toBe(true);
    expect(atoms(engine)).toEqual([]);
  });

  it("la sessione si chiude da sola dopo la pausa, e cambiando strumento", () => {
    vi.useFakeTimers();
    const { engine, ink } = setup();
    ink.setTool("pen");
    stroke([[10, 10], [30, 30]]);
    vi.advanceTimersByTime(INK_SESSION_PAUSE - 1);
    expect(atoms(engine)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(atoms(engine)).toHaveLength(1);
    stroke([[10, 50], [30, 50]]);
    ink.setTool("highlighter");
    expect(atoms(engine)).toHaveLength(2);
    stroke([[10, 70], [60, 70]]);
    ink.setTool("select");
    expect(document.querySelector(".rich-ink-veil")).toBeNull();
    const marker = atoms(engine)[0]!;
    expect(marker.ink!.strokes[0]!.hl).toBe(true);
    expect(marker.ink!.strokes[0]!.color).toBe("#f0e442");
  });

  it("il colore e lo spessore valgono per lo strumento scelto", () => {
    const { engine, ink } = setup();
    ink.setTool("pen");
    ink.setColor("#d55e00");
    ink.setWidth(2);
    expect([ink.color, ink.width, ink.widthIndex]).toEqual(["#d55e00", 8, 2]);
    ink.setTool("highlighter");
    expect([ink.color, ink.width]).toEqual(["#f0e442", 16]);
    ink.setTool("pen");
    stroke([[10, 10], [40, 10]]);
    ink.commit();
    expect(atoms(engine)[0]!.ink!.strokes[0]).toMatchObject({ color: "#d55e00", width: 8 });
  });

  it("in OpenDocument la sessione entra come disegno, in linea", () => {
    const { engine, ink } = setup([para("Testo")], { asDrawing: true });
    ink.setTool("pen");
    stroke([[10, 10], [40, 20]]);
    ink.commit();
    const [atom] = atoms(engine);
    expect(atom).toMatchObject({ kind: "drawing", data: PNG });
    expect(atom!.svg).toContain("<svg");
    expect(atom!.float).toBeUndefined();
    expect(atom!.ink).toBeUndefined();
  });

  it("in sola lettura non si disegna", () => {
    const { engine, ink } = setup();
    engine.setReadOnly(true);
    ink.setTool("pen");
    expect(ink.tool).toBe("select");
    expect(document.querySelector(".rich-ink-veil")).toBeNull();
  });

  it("smontata, la sessione aperta entra nel documento e il velo se ne va", () => {
    const { engine, ink } = setup();
    ink.setTool("pen");
    stroke([[10, 10], [40, 10]]);
    ink.destroy();
    expect(atoms(engine)).toHaveLength(1);
    expect(document.querySelector(".rich-ink-veil")).toBeNull();
  });

  it("la gomma toglie un tratto e l'inchiostro tenuto diventa nuovo", () => {
    const { engine, ink } = setup([para("Testo", [KEPT])]);
    ink.setTool("eraser");
    // Nel DOM finto ogni rettangolo sta in 0, 0: il tratto in alto è a y 2 pt.
    const veil = document.querySelector<HTMLElement>(".rich-ink-veil")!;
    veil.dispatchEvent(pointer("pointerdown", 20 / 0.75, 2 / 0.75, { pointerType: "mouse", pointerId: 1 }));
    veil.dispatchEvent(pointer("pointerup", 20 / 0.75, 2 / 0.75, { pointerType: "mouse", pointerId: 1 }));
    const [atom] = atoms(engine);
    expect(atom!.k).toBeUndefined();
    expect(atom!.label).toBe("Firma");
    expect(atom!.ink!.strokes.map((line) => line.color)).toEqual(["#0072b2"]);
    // Il riquadro nuovo stringe il tratto che resta, spessore compreso.
    expect(atom!.float).toEqual({ wrap: "front", x: -0.5, y: 8.5 });
    // Un passo di Annulla riporta l'inchiostro tenuto.
    engine.run("text.undo");
    expect(atoms(engine)[0]!.k).toBe("I");
  });

  it("la gomma parziale spezza il tratto", () => {
    const long = { ...KEPT, ink: { strokes: [{ color: "#000000", width: 2, xy: [1, 2, 10, 2, 20, 2, 30, 2, 39, 2] }, KEPT.ink.strokes[1]] } };
    const { engine, ink } = setup([para("Testo", [long])]);
    ink.setWholeStrokes(false);
    ink.setTool("eraser");
    const veil = document.querySelector<HTMLElement>(".rich-ink-veil")!;
    veil.dispatchEvent(pointer("pointerdown", 20 / 0.75, 2 / 0.75, { pointerType: "mouse", pointerId: 1 }));
    veil.dispatchEvent(pointer("pointerup", 20 / 0.75, 2 / 0.75, { pointerType: "mouse", pointerId: 1 }));
    expect(atoms(engine)[0]!.ink!.strokes.map((line) => line.xy.length)).toEqual([4, 4, 6]);
  });

  it("il lazo sceglie i tratti, Canc li toglie, Esc torna al testo", () => {
    const { engine, ink } = setup([para("Testo", [KEPT])]);
    ink.setTool("lasso");
    const veil = document.querySelector<HTMLElement>(".rich-ink-veil")!;
    const at = (x: number, y: number) => [x / 0.75, y / 0.75] as const;
    const ring = [at(-5, -2), at(45, -2), at(45, 6), at(-5, 6)];
    veil.dispatchEvent(pointer("pointerdown", ...ring[0]!, { pointerType: "mouse", pointerId: 1 }));
    for (const point of ring.slice(1)) veil.dispatchEvent(pointer("pointermove", ...point, { pointerType: "mouse", pointerId: 1 }));
    veil.dispatchEvent(pointer("pointerup", ...ring[3]!, { pointerType: "mouse", pointerId: 1 }));
    expect(ink.picked).toBe(1);
    expect(document.querySelector(".rich-ink-picked")).not.toBeNull();
    veil.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(atoms(engine)[0]!.ink!.strokes).toHaveLength(1);
    veil.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(ink.tool).toBe("select");
  });

  it("copiato e incollato, un inchiostro nuovo porta i suoi tratti e il suo posto", () => {
    const { engine, ink } = setup();
    ink.setTool("pen");
    stroke([[10, 10], [40, 10]]);
    ink.setTool("select");
    const node = engine.state.doc.firstChild!.firstChild!;
    expect(node.type.name).toBe("atom");
    const dom = document.querySelector<HTMLElement>(".rich-atom-ink")!;
    const parsed = JSON.parse(dom.getAttribute("data-ink")!);
    expect(parsed).toEqual(node.attrs.ink);
    expect(JSON.parse(dom.getAttribute("data-float")!)).toEqual(node.attrs.float);
  });
});
