// @vitest-environment happy-dom
//
// I disegni nei documenti: Inserisci › Disegno, la disposizione, la modifica
// sul posto in un passo di Annulla, e niente perso quando l'oggetto cambia
// sotto l'editor o la barra si smonta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeSelection } from "prosemirror-state";
import { openLifetime } from "../../ui/lifetime";
import { blankDrawingSvg, drawingSize, placeObject, RichDrawing, selectedWrap, type RichDrawingEditor } from "./drawing";
import { openDrawingEditor } from "./drawing-editor";
import { RichEngine } from "./engine";
import { setTracking } from "./track";
import { parseProjection, type AtomInline, type Block, type Para } from "./projection";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

let engines: RichEngine[] = [];
let drawings: RichDrawing[] = [];
afterEach(() => {
  for (const drawing of drawings) drawing.destroy();
  for (const engine of engines) engine.destroy();
  drawings = [];
  engines = [];
  document.body.replaceChildren();
});

const para = (x: string, c: unknown[] = []): Block => ({ t: "para", role: { kind: "body" }, c: [{ t: "text", x }, ...c] }) as Block;

/// Un editor finto: il testo lo cambia il test.
function fakeEditor() {
  const made = { text: "", opened: 0 };
  const open = async (host: HTMLElement, svg: string): Promise<RichDrawingEditor> => {
    made.text = svg;
    made.opened += 1;
    host.append(Object.assign(document.createElement("div"), { className: "fake-draw" }));
    return { text: () => made.text, focus: () => {}, fit: () => {} };
  };
  return { made, open };
}

function setup(blocks: Block[] = [para("Testo")], pick?: () => Promise<Blob | "unreadable" | null>) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const engine = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  engine.setDoc(JSON.stringify({ format: "fub-rich", version: 4, opaque_schema: 3, blocks }));
  engines.push(engine);
  const fake = fakeEditor();
  const notify = vi.fn();
  const drawing = new RichDrawing(engine, { rasterize: async () => PNG, openEditor: fake.open, notify, ...(pick ? { pick } : {}) });
  drawings.push(drawing);
  return { engine, drawing, fake: fake.made, notify };
}

function atoms(engine: RichEngine): AtomInline[] {
  return parseProjection(engine.getDoc()).blocks.flatMap((block) => ((block as Para).c ?? []).filter((inline): inline is AtomInline => inline.t === "atom"));
}

/// Sceglie l'oggetto in `pos`, come un clic.
function pickAt(engine: RichEngine, pos: number): void {
  engine.browse((state, dispatch) => {
    dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
    return true;
  });
}

const KEPT = { t: "atom", k: "D", kind: "drawing", label: "Schema", w: 150, h: 75, data: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>' };

describe("la misura di un disegno", () => {
  it("legge larghezza e altezza in ogni unità, o la viewBox", () => {
    expect(drawingSize(blankDrawingSvg())).toEqual({ w: 340.5, h: 226.5 });
    expect(drawingSize('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm"/>')).toEqual({ w: 340.16, h: 226.77 });
    expect(drawingSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"/>')).toEqual({ w: 300, h: 150 });
    expect(drawingSize('<svg xmlns="http://www.w3.org/2000/svg" width="50%" height="10"/>')).toBeNull();
    expect(drawingSize("<html/>")).toBeNull();
    expect(drawingSize("non è xml")).toBeNull();
  });
});

describe("Inserisci › Disegno", () => {
  it("un disegno nuovo è una tavola bianca in linea, e si apre subito", async () => {
    const { engine, drawing, fake } = setup();
    engine.select(6);
    expect(await drawing.insertNew()).toBe(true);
    const [atom] = atoms(engine);
    expect(atom).toMatchObject({ kind: "drawing", data: PNG, w: 340.5, h: 226.5 });
    expect(atom!.svg).toBe(blankDrawingSvg());
    expect(atom!.float).toBeUndefined();
    expect(drawing.editing).toBe(true);
    expect(fake.opened).toBe(1);
    expect(document.querySelector(".rich-drawing-editor .fake-draw")).not.toBeNull();
  });

  it("«Fine» scrive SVG e PNG nuovi in un passo di Annulla", async () => {
    const { engine, drawing, fake } = setup();
    engine.select(6);
    await drawing.insertNew();
    fake.text = blankDrawingSvg().replace("<title></title>", "<title>Gatto</title>");
    await drawing.finish();
    expect(drawing.editing).toBe(false);
    expect(document.querySelector(".rich-drawing-editor")).toBeNull();
    expect(atoms(engine)[0]!.svg).toContain("Gatto");
    engine.run("text.undo");
    expect(atoms(engine)[0]!.svg).toBe(blankDrawingSvg());
    engine.run("text.undo");
    expect(atoms(engine)).toEqual([]);
  });

  it("senza cambiamenti l'editor si chiude e il documento resta", async () => {
    const { engine, drawing } = setup([para("Testo", [KEPT])]);
    const before = engine.getDoc();
    pickAt(engine, 6);
    expect(await drawing.edit(6)).toBe(true);
    await drawing.finish();
    expect(engine.getDoc()).toBe(before);
  });

  it("un disegno del file cambiato si riscrive, col suo nome e la sua misura nuova", async () => {
    const { engine, drawing, fake } = setup([para("Testo", [KEPT])]);
    await drawing.edit(6);
    fake.text = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="4" height="4"/></svg>';
    await drawing.finish();
    const [atom] = atoms(engine);
    expect(atom!.k).toBeUndefined();
    expect(atom).toMatchObject({ label: "Schema", w: 300, h: 75, data: PNG });
  });

  it("si apre con Invio o col doppio clic sul disegno scelto", async () => {
    const { engine, drawing, fake } = setup([para("Testo", [KEPT])]);
    pickAt(engine, 6);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    engine.contentElement().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fake.opened).toBe(1));
    // Esc chiude.
    document.querySelector(".rich-drawing-editor")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(drawing.editing).toBe(false));
    pickAt(engine, 6);
    document.querySelector(".rich-atom-drawing")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fake.opened).toBe(2));
  });

  it("«Apri grande» lo allarga alla finestra, e torna", async () => {
    const { drawing } = setup([para("Testo", [KEPT])]);
    await drawing.edit(6);
    const grow = document.querySelector<HTMLButtonElement>(".rich-drawing-grow")!;
    grow.click();
    expect(drawing.large).toBe(true);
    expect(document.querySelector(".rich-drawing-large")).not.toBeNull();
    grow.click();
    expect(drawing.large).toBe(false);
  });

  it("se il disegno è sparito nel frattempo, la versione modificata entra nuova e si dice", async () => {
    const { engine, drawing, fake, notify } = setup([para("Testo", [KEPT])]);
    await drawing.edit(6);
    fake.text = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>';
    // Un altro gesto toglie l'oggetto.
    engine.apply((state, dispatch) => {
      dispatch?.(state.tr.delete(6, 7));
      return true;
    });
    expect(atoms(engine)).toEqual([]);
    await drawing.finish();
    expect(atoms(engine)).toHaveLength(1);
    expect(atoms(engine)[0]).toMatchObject({ kind: "drawing", w: 30, h: 30 });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("nel frattempo"), "info");
  });

  it("mentre si registrano le modifiche il disegno cambiato entra, registrato", async () => {
    const { engine, drawing, fake } = setup([para("Testo", [KEPT])]);
    expect(engine.apply(setTracking(true))).toBe(true);
    await drawing.edit(6);
    fake.text = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle r="2"/></svg>';
    await drawing.finish();
    expect(drawing.editing).toBe(false);
    const changed = atoms(engine).find((atom) => atom.svg?.includes("circle"));
    expect(changed).toBeDefined();
    expect(changed!.ins).toBeDefined();
  });

  it("smontata la barra, un disegno aperto e cambiato non si perde", async () => {
    const { engine, drawing, fake } = setup([para("Testo", [KEPT])]);
    await drawing.edit(6);
    fake.text = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle r="3"/></svg>';
    drawing.destroy();
    expect(atoms(engine)[0]!.svg).toContain("circle");
    expect(document.querySelector(".rich-drawing-editor")).toBeNull();
  });

  it("in sola lettura non si inserisce e non si apre", async () => {
    const { engine, drawing } = setup([para("Testo", [KEPT])]);
    engine.setReadOnly(true);
    expect(await drawing.insertNew()).toBe(false);
    expect(await drawing.edit(6)).toBe(false);
  });

  it("dal vault copia un SVG alla misura della colonna, e rifiuta il resto col perché", async () => {
    let next: Blob | "unreadable" = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1248" height="624"/>'], { type: "image/svg+xml" });
    const { engine, drawing, notify } = setup([para("Testo")], async () => next);
    engine.select(6);
    expect(await drawing.insertFromVault()).toBe(true);
    expect(atoms(engine)[0]).toMatchObject({ kind: "drawing", w: 468, h: 234 });
    next = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    expect(await drawing.insertFromVault()).toBe(false);
    next = "unreadable";
    expect(await drawing.insertFromVault()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("SVG"), "guasto");
  });
});

describe("la disposizione", () => {
  it("porta un oggetto fuori dal testo e lo riporta in linea", () => {
    const { engine } = setup([para("Testo", [KEPT])]);
    pickAt(engine, 6);
    expect(engine.read(selectedWrap)).toBe("inline");
    expect(engine.apply(placeObject("front"))).toBe(true);
    expect(atoms(engine)[0]!.float).toEqual({ wrap: "front", x: 0, y: 0 });
    expect(atoms(engine)[0]!.k).toBe("D");
    expect(engine.read(selectedWrap)).toBe("front");
    expect(engine.apply(placeObject("front"))).toBe(false);
    expect(engine.apply(placeObject("inline"))).toBe(true);
    expect(atoms(engine)[0]!.float).toBeUndefined();
    engine.select(2);
    expect(engine.read(selectedWrap)).toBeNull();
  });
});

describe("l'editor dei disegni nel documento", () => {
  it("si monta su una tavola nuova e si smonta senza residui, più volte", () => {
    for (let i = 0; i < 3; i++) {
      const host = document.createElement("div");
      document.body.append(host);
      const life = openLifetime();
      const editor = openDrawingEditor(host, blankDrawingSvg(), life);
      expect(editor.text()).toBe(blankDrawingSvg());
      expect(host.childElementCount).toBeGreaterThan(0);
      life.close();
      expect(host.childElementCount).toBe(0);
      host.remove();
    }
  });
});
