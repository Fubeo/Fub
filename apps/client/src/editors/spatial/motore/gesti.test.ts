// @vitest-environment happy-dom
//
// I gesti del disegno sul motore (`gesti.ts`), contro l'host finto: il
// `DrawingFake` rigioca i vettori dei gesti (`__fixtures__/disegno-gesti/`,
// gli oracoli registrati dagli strumenti TypeScript di oggi) rispondendo le
// loro `expect.ops`, e l'editor col motore deve arrivare al loro testo, in un
// passo di annulla. La penna, l'evidenziatore e la gomma non chiamano mai il
// motore; il motore che non si apre in tempo, un esito che non vale e un
// gesto annullato non scrivono niente.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAWING_COMMAND_TOOL_OPTION, DRAWING_COMMAND_TOOL_STATE, type DrawingFrame, type DrawingGesture, type DrawingOutcome, type DrawingOverlay, type DrawingPointer } from "../../../host/contract";
import { createFakeHost, type DrawingFake, type FakeHost } from "../../../host/fake";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { lineFeeds } from "../../core/text-operation";
import { SceneEngine } from "../scene/engine";
import { t } from "../strings";
import { toScreen } from "../view";
import { createDrawEditor, type DrawEditor } from "../tools/editor";
import { DEFAULT_GRID } from "../tools/grid";
import { aPezzi, ATTESA_APERTURA_MS, elemDi, motoreDa, opsDellEsito, type MotoreAperto, type MotoreDelDisegno } from "./gesti";
import { apriSessione, type GestoMotore, type MotoreAssente, type SessioneMotore } from "./sessione";

// --- I vettori ----------------------------------------------------------------

interface Vector {
  readonly name: string;
  readonly input: string;
  /// Il Testo porta la parola del testo nuovo; gli altri strumenti niente.
  readonly gesture: Omit<DrawingGesture, "revision" | "phase" | "text"> & { readonly text?: string };
  readonly expect: {
    readonly ops: readonly unknown[] | null;
    readonly selection: readonly string[];
    readonly refused: DrawingOutcome["refused"];
    readonly text: string;
  };
}

const FILES = import.meta.glob("../../../__fixtures__/disegno-gesti/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const VECTORS: readonly Vector[] = Object.values(FILES).map((text) => JSON.parse(text) as Vector);

const DOC = "disegni/prova.svg";

// --- Il banco ----------------------------------------------------------------

let host: HTMLElement;
let owner: Lifetime;
let sessions: DocumentSessionCollection | null = null;
let motore: MotoreAperto | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
});

afterEach(async () => {
  owner.close();
  host.remove();
  for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  await motore?.chiudi();
  motore = null;
  sessions?.closeAll();
  sessions = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/// Lascia girare promesse, fotogrammi e timer finti.
async function settle(ms = 16, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(ms);
}

/// Una `DocumentSession` vera su `text`, che salva nel vuoto.
async function documentOn(text: string) {
  const api: DocumentSessionApi = {
    readDocument: async () => ({ text, revision: "rev-1", format_id: "svg", source_kind: "text", text_kind: "source" }),
    openDocument: async () => ({ text, revision: "rev-1", format_id: "svg", source_kind: "text", text_kind: "source" }),
    documentClosed: async () => {},
    writeDocument: async () => "rev-2",
    resourceWrite: async () => ({ revision: "rev-2" }) as never,
    saveDraft: async () => {},
    discardDraft: async () => {},
  };
  sessions = new DocumentSessionCollection(api, () => "/vault");
  await sessions.read(DOC);
  return sessions.get(DOC)!;
}

/// L'editor su `input` col motore `porta` (o quello dell'host finto), che
/// porta ogni gesto alla `DocumentSession`.
async function mount(input: string, fake: FakeHost, grid: number | null = null, porta?: MotoreDelDisegno): Promise<DrawEditor> {
  const session = await documentOn(input);
  if (porta === undefined) {
    motore = motoreDa(() => apriSessione(fake.module.api, DOC, input, session, { vault: "/vault" }));
    await settle(0, 2);
  }
  return createDrawEditor(host, SceneEngine.open(input), owner, {
    motore: porta ?? motore!,
    grid: grid === null ? DEFAULT_GRID : { ...DEFAULT_GRID, snap: true, step: grid },
    onChange: (change) => {
      expect(sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation })).toEqual({ kind: "accepted" });
    },
  });
}

const surfaceOf = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();

/// Sceglie il livello `id` dal menu dei livelli, come chi disegna.
function chooseLayer(input: string, id: string): void {
  const name = new RegExp(`<g id="${id}"[^>]* fub:layer="([^"]*)"`).exec(input)![1]!;
  host.querySelector<HTMLButtonElement>(".draw-layer-button")!.click();
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  const entry = [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.querySelector(".menu-label")?.textContent === name);
  entry!.click();
  for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
}

let clock = 1000;

/// Il puntatore di `event`, dove la camera mostra il punto della scena.
function dispatch(editor: DrawEditor, event: Pick<DrawingPointer, "kind" | "x" | "y" | "pressure" | "shift" | "alt" | "cmd">, type?: string): void {
  const target = surfaceOf();
  const box = target.getBoundingClientRect();
  const [sx, sy] = toScreen(editor.stage.camera, [event.x, event.y]);
  const down = event.kind === "down" || event.kind === "drag";
  const pointer = new PointerEvent(type ?? (event.kind === "down" ? "pointerdown" : event.kind === "up" ? "pointerup" : "pointermove"), {
    bubbles: true,
    cancelable: true,
    composed: true,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    altitudeAngle: Math.PI / 2,
    button: event.kind === "down" || event.kind === "up" ? 0 : -1,
    buttons: down ? 1 : 0,
    pressure: event.pressure,
    clientX: box.left + sx,
    clientY: box.top + sy,
    shiftKey: event.shift,
    altKey: event.alt,
    ctrlKey: event.cmd,
  });
  Object.defineProperty(pointer, "timeStamp", { value: (clock += 8) });
  target.dispatchEvent(pointer);
}

const point = (kind: DrawingPointer["kind"], x: number, y: number): DrawingPointer => ({ kind, x, y, pressure: 0.5, shift: false, alt: false, cmd: false });

/// Un trascinamento da un punto all'altro, coi punti di mezzo.
async function drag(editor: DrawEditor, points: readonly (readonly [number, number])[]): Promise<void> {
  const [first, ...rest] = points;
  dispatch(editor, point("down", first![0], first![1]));
  await settle();
  for (const [x, y] of rest) {
    dispatch(editor, point("drag", x, y));
    await settle();
  }
  const last = points[points.length - 1]!;
  dispatch(editor, { ...point("up", last[0], last[1]), pressure: 0 });
  await settle();
}

const gestures = (fake: FakeHost): DrawingGesture[] => fake.atGate("drawingGesture").map((call) => call.args[1] as DrawingGesture);
const drawingCalls = (fake: FakeHost): string[] =>
  fake.calls.map((call) => call.gate).filter((gate) => gate.startsWith("drawing") || gate === "openDrawing" || gate === "closeDrawing");

/// Il motore finto che rigioca `vector`: alle anteprime risponde la
/// selezione com'è, al rilascio le `expect.ops` del vettore, con gli id
/// nuovi (`@1`, `@2`…) fatti id veri. `names` raccoglie quali.
function replaying(vector: Vector, names: Map<string, string>): DrawingFake {
  const real = (text: string): string =>
    text.replace(/@(\d+)/g, (_found, n: string) => {
      const key = `@${n}`;
      if (!names.has(key)) names.set(key, `oz${n.padStart(7, "0")}`);
      return names.get(key)!;
    });
  return {
    gesto: (gesture) => {
      const outcome: DrawingOutcome = { revision: gesture.revision, preview: null, ops: null, selection: gesture.selection, losses: [], refused: null, frame: null };
      if (gesture.phase !== "commit") return outcome;
      return {
        ...outcome,
        ops: vector.expect.ops === null ? null : real(JSON.stringify(vector.expect.ops)),
        selection: vector.expect.selection.map(real),
        refused: vector.expect.refused,
      };
    },
  };
}

/// `text` con gli id veri tornati `@1`, `@2`…
const canonical = (text: string, names: Map<string, string>): string => {
  let out = text;
  for (const [key, id] of names) out = out.split(id).join(key);
  return out;
};

// --- I vettori sul motore ------------------------------------------------------

describe("i vettori dei gesti, sul motore finto", () => {
  it("ci sono tutti", () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(30);
  });

  for (const vector of VECTORS) {
    it(`${vector.name}: il testo dopo il gesto è quello del vettore, in un passo`, { timeout: 60_000 }, async () => {
      const names = new Map<string, string>();
      const fake = createFakeHost({ drawing: replaying(vector, names) });
      const { gesture } = vector;
      const editor = await mount(vector.input, fake, gesture.snap.grid);
      editor.stage.setCamera({ scale: gesture.zoom, tx: 0, ty: 0 });
      editor.setTool(gesture.tool as "select" | "rect" | "ellipse" | "line" | "arrow" | "text");
      if (gesture.style !== null) {
        editor.setColor(gesture.style.stroke);
        editor.setWidth(gesture.style.width);
      }
      if (gesture.layer !== null) chooseLayer(vector.input, gesture.layer);
      editor.select(gesture.selection);
      const before = spoken();
      for (const event of gesture.events) {
        dispatch(editor, event);
        await settle();
      }
      await settle(16, 8);

      // Il motore ha avuto il gesto com'è nel vettore: le sue impostazioni a
      // ogni richiesta, gli eventi in ordine fra tutte, il rilascio per ultimo.
      const sent = gestures(fake);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent[sent.length - 1]!.phase).toBe("commit");
      expect(sent.slice(0, -1).every((each) => each.phase === "preview")).toBe(true);
      for (const each of sent) {
        expect({ tool: each.tool, selection: each.selection, zoom: each.zoom, snap: each.snap, style: each.style, text: each.text }).toEqual({
          tool: gesture.tool,
          selection: gesture.selection,
          zoom: gesture.zoom,
          snap: gesture.snap,
          style: gesture.style,
          text: gesture.text ?? null,
        });
        if (gesture.layer !== null) expect(each.layer).toBe(gesture.layer);
      }
      // Il puntatore che passa sopra prima di premere (`move`) cambia solo il
      // cursore: il gesto, per il motore, comincia quando si preme.
      const pressed = gesture.events.slice(gesture.events.findIndex((each) => each.kind === "down"));
      const events = sent.flatMap((each) => each.events);
      expect(events.map((each) => each.kind)).toEqual(pressed.map((each) => each.kind));
      events.forEach((each, at) => {
        const wanted = pressed[at]!;
        expect(each.x).toBeCloseTo(wanted.x, 2);
        expect(each.y).toBeCloseTo(wanted.y, 2);
        expect([each.shift, each.alt, each.cmd]).toEqual([wanted.shift, wanted.alt, wanted.cmd]);
      });

      // Il testo e la selezione del vettore.
      expect(canonical(editor.engine.text, names)).toBe(vector.expect.text);
      expect(editor.selection.map((key) => canonical(key, names))).toEqual(vector.expect.selection);
      expect(canonical(sessions!.get(DOC)!.text(), names)).toBe(vector.expect.text);

      // Un gesto che scrive è un passo di annulla; uno che non scrive non ne è
      // nessuno.
      if (vector.expect.ops === null) {
        expect(editor.canUndo).toBe(false);
      } else {
        expect(editor.canUndo).toBe(true);
        editor.undo();
        expect(editor.engine.text).toBe(vector.input);
        expect(editor.canUndo).toBe(false);
      }

      // Il livello bloccato o nascosto si dice come oggi.
      if (vector.expect.refused === "locked" || vector.expect.refused === "hidden") {
        const name = new RegExp(`<g id="${gesture.layer}"[^>]* fub:layer="([^"]*)"`).exec(vector.input)![1]!;
        expect(spoken()).toContain(t(vector.expect.refused === "locked" ? "draw.layer.locked_here" : "draw.layer.hidden_here", { name }));
      } else if (vector.expect.refused === "empty" && gesture.tool !== "select") {
        expect(spoken()).toBe(before);
      }
    });
  }
});

// --- La penna resta di Fub ----------------------------------------------------

const EMPTY = VECTORS.find((vector) => vector.name === "rettangolo")!.input;

describe("la penna, l'evidenziatore e la gomma", () => {
  it("non chiamano mai il motore: solo la copia segue ciò che scrivono", async () => {
    const fake = createFakeHost({ drawing: { gesto: () => { throw new Error("la penna non chiede gesti al motore"); } } });
    const editor = await mount(EMPTY, fake);
    expect(fake.atGate("openDrawing")).toHaveLength(1);
    for (const tool of ["pen", "highlighter"] as const) {
      editor.setTool(tool);
      const syncs = fake.atGate("drawingSync").length;
      const calls = drawingCalls(fake).length;
      dispatch(editor, point("down", 20, 200));
      for (let x = 30; x <= 120; x += 10) {
        dispatch(editor, point("drag", x, 200 + (x % 20)));
        await settle(16, 1);
      }
      // Durante il tratto, nessuna chiamata al motore.
      expect(drawingCalls(fake).length).toBe(calls);
      dispatch(editor, { ...point("up", 120, 200), pressure: 0 });
      await settle();
      // Dopo, la copia segue il tratto scritto: un sync, nessun gesto.
      expect(fake.atGate("drawingSync").length).toBe(syncs + 1);
    }
    editor.setTool("eraser");
    const before = editor.engine.text;
    const syncs = fake.atGate("drawingSync").length;
    await drag(editor, [[20, 200], [70, 205], [120, 200]]);
    expect(editor.engine.text).not.toBe(before);
    expect(fake.atGate("drawingSync").length).toBe(syncs + 1);
    expect(fake.atGate("drawingGesture")).toHaveLength(0);
    expect(fake.atGate("drawingCommand")).toHaveLength(0);
    expect(fake.atGate("drawingCommands")).toHaveLength(0);
    expect(drawingCalls(fake).filter((gate) => gate !== "drawingSync" && gate !== "openDrawing")).toEqual([]);
  });
});

// --- I casi limite --------------------------------------------------------------

describe("i gesti sul motore", () => {
  it("senza il motore (`unserved`) gli strumenti fanno da sé, come oggi", async () => {
    const fake = createFakeHost();
    const editor = await mount(EMPTY, fake);
    expect(motore!.adesso()).toBeNull();
    editor.setTool("rect");
    await drag(editor, [[220, 40], [300, 90]]);
    expect(editor.engine.text).toContain('x="220" y="40" width="80" height="50"');
    expect(editor.canUndo).toBe(true);
    expect(fake.atGate("drawingGesture")).toHaveLength(0);
  });

  it("un motore che non si apre in 2 s: il gesto non fa niente", async () => {
    const fake = createFakeHost();
    const editor = await mount(EMPTY, fake, null, motoreDa(() => new Promise(() => {})));
    editor.setTool("rect");
    await drag(editor, [[220, 40], [300, 90]]);
    await vi.advanceTimersByTimeAsync(ATTESA_APERTURA_MS + 100);
    await settle();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
    expect(fake.atGate("drawingGesture")).toHaveLength(0);
  });

  it("con l'aggancio al pixel (K6 T11) il gesto manda il passo di un pixel; con la griglia accesa vince lei, col suo passo", async () => {
    const fake = createFakeHost({ drawing: replaying(VECTORS.find((vector) => vector.name === "rettangolo")!, new Map()) });
    const editor = await mount(EMPTY, fake, null);
    editor.setGrid({ ...DEFAULT_GRID, snapPixel: true });
    editor.setTool("rect");
    await drag(editor, [[10.4, 3.2], [60.7, 40.4]]);
    await settle(16, 8);
    const pixel = gestures(fake);
    expect(pixel.length).toBeGreaterThan(0);
    expect(pixel.map((gesto) => gesto.snap)).toEqual(pixel.map(() => ({ grid: 1, free: false })));

    editor.setGrid({ ...DEFAULT_GRID, snap: true, step: 20, snapPixel: true });
    await drag(editor, [[200, 40], [260, 70]]);
    await settle(16, 8);
    const griglia = gestures(fake).slice(pixel.length);
    expect(griglia.length).toBeGreaterThan(0);
    expect(griglia.map((gesto) => gesto.snap.grid)).toEqual(griglia.map(() => 20));
  });

  it("guide sensibili e agganci di Visualizza (K6) vanno nel gesto solo se diversi da VectorCraft", async () => {
    const fake = createFakeHost({ drawing: replaying(VECTORS.find((vector) => vector.name === "rettangolo")!, new Map()) });
    const editor = await mount(EMPTY, fake, null);
    editor.setGrid({ ...DEFAULT_GRID, smartGuidesOff: true, snapPointOff: true, snapGlyph: true });
    editor.setTool("rect");
    await drag(editor, [[10, 3], [60, 40]]);
    await settle(16, 8);
    const spenti = gestures(fake);
    expect(spenti.length).toBeGreaterThan(0);
    expect(spenti.map((gesto) => gesto.snap)).toEqual(spenti.map(() => ({ grid: null, free: false, guides: false, points: false, glyphs: true })));

    editor.setGrid(DEFAULT_GRID);
    await drag(editor, [[200, 40], [260, 70]]);
    await settle(16, 8);
    const diSerie = gestures(fake).slice(spenti.length);
    expect(diSerie.length).toBeGreaterThan(0);
    expect(diSerie.map((gesto) => gesto.snap)).toEqual(diSerie.map(() => ({ grid: null, free: false })));
  });

  it("aspetta il motore che si apre, poi manda il gesto", async () => {
    const fake = createFakeHost({ drawing: replaying(VECTORS.find((vector) => vector.name === "rettangolo")!, new Map()) });
    const session = await documentOn(EMPTY);
    let open!: () => void;
    const late = new Promise<void>((resolve) => {
      open = resolve;
    }).then(() => apriSessione(fake.module.api, DOC, EMPTY, session));
    motore = motoreDa(() => late);
    const editor = createDrawEditor(host, SceneEngine.open(EMPTY), owner, {
      motore,
      onChange: (change) => void sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation }),
    });
    editor.setTool("rect");
    await drag(editor, [[220, 40], [260, 70], [300, 90]]);
    expect(fake.atGate("drawingGesture")).toHaveLength(0);
    open();
    await settle(16, 8);
    expect(gestures(fake).slice(-1)[0]!.phase).toBe("commit");
    expect(editor.engine.text).toContain('width="80" height="50"');
  });

  it("un'operazione che `parseWireOp` rifiuta: niente passo, lo si dice e lo si scrive in console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeHost({
      drawing: {
        gesto: (gesture) => ({ revision: gesture.revision, preview: null, ops: gesture.phase === "commit" ? '[{"op":"inventata"}]' : null, selection: [], losses: [], refused: null, frame: null }),
      },
    });
    const editor = await mount(EMPTY, fake);
    editor.setTool("rect");
    await drag(editor, [[220, 40], [300, 90]]);
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
    expect(spoken()).toContain(t("draw.rejected", { reason: t("draw.reason.invalid") }));
    expect(error).toHaveBeenCalled();
  });

  it("i rifiuti del motore coi loro motivi: la parte che resta com'è, il disegno che si sta aprendo", async () => {
    const refusals: [DrawingOutcome["refused"], string][] = [
      ["unmapped", t("draw.reason.unmapped")],
      ["not_ready", t("draw.reason.not_ready")],
      ["unsupported", t("draw.reason.foreign")],
      ["closed", t("draw.reason.invalid")],
    ];
    let refused: DrawingOutcome["refused"] = null;
    const fake = createFakeHost({
      drawing: {
        gesto: (gesture) => ({ revision: gesture.revision, preview: null, ops: null, selection: [], losses: [], refused: gesture.phase === "commit" ? refused : null, frame: null }),
      },
    });
    const editor = await mount(EMPTY, fake);
    editor.setTool("rect");
    expect(t("draw.rejected", { reason: t("draw.reason.unmapped") })).toBe("Modifica non applicata: Questa parte resta com’è: il disegno non la sa ancora modificare.");
    for (const [reason, said] of refusals) {
      refused = reason;
      await drag(editor, [[220, 40], [300, 90]]);
      expect(spoken(), reason!).toContain(t("draw.rejected", { reason: said }));
    }
    expect(editor.engine.text).toBe(EMPTY);
  });

  it("le parti che un esito trova si aggiungono a quelle del motore, e chi ascolta lo sa", async () => {
    const found = { element: "oa1a1a1a1", kind: "approximated" as const, detail: "il filtro «ombra» resta com’è" };
    const fake = createFakeHost({
      drawing: {
        gesto: (gesture) => ({ revision: gesture.revision, preview: null, ops: null, selection: [], losses: gesture.phase === "commit" ? [found] : [], refused: null, frame: null }),
      },
    });
    const editor = await mount(EMPTY, fake);
    expect(motore!.perdite()).toEqual([]);
    let changes = 0;
    motore!.quandoCambia(() => changes++);
    editor.setTool("rect");
    await drag(editor, [[220, 40], [300, 90]]);
    expect(motore!.perdite()).toEqual([found]);
    expect(changes).toBe(1);
  });

  it("l'anteprima del motore si disegna con i segni di oggi, e il rilascio la toglie", async () => {
    const shape = { tag: "rect", attrs: { x: "220", y: "40", width: "40", height: "30", fill: "none", stroke: "#000000" } };
    const fake = createFakeHost({
      drawing: {
        gesto: (gesture) => ({
          revision: gesture.revision,
          preview: gesture.phase === "preview" ? { shape, matrix: null, marquee: null } : null,
          ops: null,
          selection: [],
          losses: [],
          refused: gesture.phase === "commit" ? "empty" : null,
          frame: null,
        }),
      },
    });
    const editor = await mount(EMPTY, fake);
    editor.setTool("rect");
    dispatch(editor, point("down", 220, 40));
    await settle();
    dispatch(editor, point("drag", 260, 70));
    await settle();
    expect(host.querySelector('.draw-surface rect[width="40"][height="30"]')).not.toBeNull();
    dispatch(editor, { ...point("up", 260, 70), pressure: 0 });
    await settle();
    expect(host.querySelector('.draw-surface rect[width="40"][height="30"]')).toBeNull();
    expect(editor.engine.text).toBe(EMPTY);
  });

  it("un gesto annullato a metà (un pizzico) manda `cancel`, non scrive e rimette la selezione", async () => {
    const vector = VECTORS.find((each) => each.name === "sposta")!;
    const fake = createFakeHost({ drawing: replaying(vector, new Map()) });
    const editor = await mount(vector.input, fake);
    editor.setTool("select");
    dispatch(editor, point("down", 150, 125));
    await settle();
    dispatch(editor, point("drag", 170, 130));
    await settle();
    dispatch(editor, point("drag", 170, 130), "pointercancel");
    await settle();
    expect(gestures(fake).map((each) => each.phase)).toContain("cancel");
    expect(gestures(fake).some((each) => each.phase === "commit")).toBe(false);
    expect(editor.engine.text).toBe(vector.input);
    expect(editor.selection).toEqual([]);
  });

  it("più oggetti girati: la cornice dell'esito si tiene e va al gesto dopo, finché un esito non la lascia", async () => {
    // I due rettangoli di `sposta-due-forme`, girati di 30° attorno al
    // centro del riquadro comune (210, 160), come in `gesti_selezione.rs`.
    const vector = VECTORS.find((each) => each.name === "sposta-due-forme")!;
    const [a, b] = vector.gesture.selection as [string, string];
    const s = Math.sin(Math.PI / 6);
    const c = Math.cos(Math.PI / 6);
    const girata: DrawingFrame = {
      matrix: [c, s, -s, c, 210 - c * 210 + s * 160, 160 - s * 210 - c * 160],
      bounds: [100, 100, 320, 220],
      geometry: [100, 100, 320, 220],
    };
    const scritte = ["matrix(0.866 0.5 -0.5 0.866 108.1347 -83.5641)", "matrix(1.0235 0.5909 -0.5 0.866 92.3891 -92.6548)"];
    let commit = 0;
    const fake = createFakeHost({
      drawing: {
        gesto: (gesture) => {
          const outcome: DrawingOutcome = { revision: gesture.revision, preview: null, ops: null, selection: gesture.selection, losses: [], refused: null, frame: null };
          if (gesture.phase !== "commit") return outcome;
          const transform = scritte[commit++];
          if (transform === undefined) return { ...outcome, refused: "empty" };
          const ops = [{ op: "batch", ops: [a, b].map((id) => ({ op: "set", id, attrs: { transform } })) }];
          return { ...outcome, ops: JSON.stringify(ops), frame: commit === 1 ? girata : null };
        },
      },
    });
    const editor = await mount(vector.input, fake);
    editor.setTool("select");
    editor.select([a, b]);
    await drag(editor, [[210, 72], [254, 83.79]]);
    await settle(16, 8);
    expect(gestures(fake).every((each) => each.frame === null)).toBe(true);
    expect(editor.engine.text).toContain(scritte[0]);

    // Il secondo gesto porta la cornice girata, in ogni sua richiesta.
    const prima = gestures(fake).length;
    await drag(editor, [[308.727, 217], [343.368, 237]]);
    await settle(16, 8);
    const seconde = gestures(fake).slice(prima);
    expect(seconde.length).toBeGreaterThan(0);
    for (const each of seconde) expect(each.frame).toEqual(girata);
    expect(editor.engine.text).toContain(scritte[1]);

    // L'esito del secondo non ne rimanda: il terzo parte senza.
    const dopo = gestures(fake).length;
    await drag(editor, [[150, 125], [160, 130]]);
    await settle(16, 8);
    expect(gestures(fake).slice(dopo).every((each) => each.frame === null)).toBe(true);
  });
});

// --- Il motore che manca, e che torna -------------------------------------------

/// Un gesto qualunque, per chiamare la sessione da sé.
const GESTO: GestoMotore = {
  phase: "commit",
  tool: "rect",
  layer: null,
  selection: [],
  zoom: 1,
  snap: { grid: null, free: false },
  style: { stroke: "#000", width: 1, fill: null },
  text: null,
  frame: null,
  events: [point("down", 0, 0)],
};

/// Il motore di `fake` sul documento di `input`, che legge il testo della
/// `DocumentSession` a ogni apertura (come `surface.ts`).
async function motoreSu(input: string, fake: FakeHost): Promise<MotoreAperto> {
  const session = await documentOn(input);
  motore = motoreDa(() => apriSessione(fake.module.api, DOC, session.text(), session, { vault: "/vault" }));
  await settle(0, 2);
  return motore;
}

const aperte = (fake: FakeHost): string[] => fake.atGate("openDrawing").map((call) => call.args[1] as string);
const chiuse = (fake: FakeHost): string[] => fake.atGate("closeDrawing").map((call) => call.args[0] as string);

describe("il motore che manca, e che torna", () => {
  it("`riapri()` dopo un errore apre un'istanza nuova, col testo di quel momento", async () => {
    const fake = createFakeHost({ drawing: { gesto: (gesture) => ({ revision: gesture.revision, preview: null, ops: null, selection: [], losses: [], refused: null, frame: null }) } });
    const porta = await motoreSu(EMPTY, fake);
    const prima = porta.adesso() as SessioneMotore;
    expect(prima.kind).toBe("sessione");
    const cambi: string[] = [];
    porta.quandoCambia(() => cambi.push(JSON.stringify(porta.assente())));
    const guarisci = fake.fault("drawingGesture", { kind: "internal", message: "il motore si è fermato" });
    expect(await prima.gesto(GESTO)).toEqual({ kind: "assente", perche: "errore" });
    guarisci();
    expect(porta.adesso()).toBeNull();
    expect(porta.assente()).toEqual({ kind: "assente", perche: "errore" } satisfies MotoreAssente);
    // Il testo cambia mentre il motore è fermo.
    const nuovo = EMPTY.replace("</svg>", '<rect id="nuovo" width="5" height="5"/></svg>');
    sessions!.restore(DOC, nuovo, { kind: "descends_from", value: "rev-1" });
    porta.riapri();
    expect(porta.adesso()).toBe("apertura");
    porta.riapri();
    await settle(0, 2);
    const seconda = porta.adesso() as SessioneMotore;
    expect(seconda.kind).toBe("sessione");
    expect(seconda.instance).not.toBe(prima.instance);
    expect(aperte(fake)).toEqual([EMPTY, nuovo]);
    expect(fake.drawingCopy(seconda.instance)!.text).toBe(nuovo);
    expect(porta.assente()).toBeNull();
    // Riaperto, `riapri()` non fa niente.
    porta.riapri();
    await settle(0, 2);
    expect(aperte(fake)).toHaveLength(2);
    expect(cambi).toEqual([JSON.stringify({ kind: "assente", perche: "errore" }), "null", "null"]);
  });

  it("`spento()` chiude la sessione e dice «spento» subito; riacceso, `riapri()` torna al motore", async () => {
    const fake = createFakeHost({ drawing: {} });
    const porta = await motoreSu(EMPTY, fake);
    const prima = porta.adesso() as SessioneMotore;
    let cambi = 0;
    porta.quandoCambia(() => cambi++);
    porta.spento();
    expect(porta.adesso()).toBeNull();
    expect(porta.assente()).toEqual({ kind: "assente", perche: "spento" });
    expect(cambi).toBe(1);
    await settle(0, 2);
    expect(chiuse(fake)).toEqual([prima.instance]);
    porta.spento();
    expect(cambi).toBe(1);
    porta.riapri();
    await settle(0, 2);
    expect((porta.adesso() as SessioneMotore).instance).not.toBe(prima.instance);
    expect(aperte(fake)).toHaveLength(2);
  });

  it("tanti spento e riacceso di fila: un'apertura alla volta, e vince l'ultimo stato", async () => {
    const fake = createFakeHost({ drawing: {} });
    const porta = await motoreSu(EMPTY, fake);
    porta.spento();
    const release = fake.throttle("openDrawing");
    porta.riapri();
    porta.riapri();
    porta.spento();
    porta.riapri();
    porta.spento();
    porta.riapri();
    await settle(0, 2);
    // Una sola apertura in volo, e lo stato dice ancora «spento» finché non
    // torna.
    expect(aperte(fake)).toHaveLength(2);
    expect(porta.assente()).toEqual({ kind: "assente", perche: "spento" });
    release();
    await settle(0, 4);
    // L'apertura vecchia si chiude appena arriva, poi parte quella buona.
    expect(aperte(fake)).toHaveLength(3);
    const ultima = porta.adesso() as SessioneMotore;
    expect(ultima.kind).toBe("sessione");
    expect(fake.drawingCopy(ultima.instance)).toBeDefined();
    expect(chiuse(fake)).toHaveLength(2);
    expect(chiuse(fake)).not.toContain(ultima.instance);

    // Spento mentre si apre, e non riacceso: l'apertura si chiude e resta spento.
    porta.spento();
    const ancora = fake.throttle("openDrawing");
    porta.riapri();
    porta.spento();
    ancora();
    await settle(0, 4);
    expect(porta.adesso()).toBeNull();
    expect(porta.assente()).toEqual({ kind: "assente", perche: "spento" });
    expect(aperte(fake)).toHaveLength(4);
    expect(chiuse(fake)).toHaveLength(4);
  });

  it("dopo `chiudi()` niente riapre, e l'apertura in volo si chiude appena arriva", async () => {
    const fake = createFakeHost({ drawing: {} });
    const session = await documentOn(EMPTY);
    const release = fake.throttle("openDrawing");
    motore = motoreDa(() => apriSessione(fake.module.api, DOC, session.text(), session, { vault: "/vault" }));
    const porta = motore;
    expect(porta.adesso()).toBe("apertura");
    await porta.chiudi();
    release();
    await settle(0, 4);
    expect(chiuse(fake)).toHaveLength(1);
    porta.riapri();
    porta.spento();
    await settle(0, 2);
    expect(aperte(fake)).toHaveLength(1);
    expect(porta.adesso()).toBeNull();
    expect(porta.assente()).toBeNull();
  });

  it("la `DocumentSession` che finisce chiude il motore per sempre: niente riapre", async () => {
    const fake = createFakeHost({ drawing: {} });
    const porta = await motoreSu(EMPTY, fake);
    let cambi = 0;
    porta.quandoCambia(() => cambi++);
    sessions!.close(DOC);
    expect(cambi).toBe(1);
    expect(porta.adesso()).toBeNull();
    expect(porta.assente()).toBeNull();
    porta.riapri();
    await settle(0, 2);
    expect(aperte(fake)).toHaveLength(1);
  });

  /// Il motore finto: alle anteprime la forma, al rilascio il rettangolo.
  const conAnteprima = (spento: () => boolean): DrawingFake => {
    const shape = { tag: "rect", attrs: { x: "220", y: "40", width: "40", height: "30", fill: "none", stroke: "#000000" } };
    const vector = VECTORS.find((each) => each.name === "rettangolo")!;
    const commit = replaying(vector, new Map()).gesto!;
    return {
      spento,
      gesto: (gesture, copia) =>
        gesture.phase === "preview"
          ? { revision: gesture.revision, preview: { shape, matrix: null, marquee: null }, ops: null, selection: [], losses: [], refused: null, frame: null }
          : commit(gesture, copia),
    };
  };
  const anteprima = (): Element | null => host.querySelector('.draw-surface rect[width="40"][height="30"]');

  it("il motore che si spegne a metà gesto: il gesto si annulla, non scrive niente, e il gesto dopo fa da sé", async () => {
    let spento = false;
    const fake = createFakeHost({ drawing: conAnteprima(() => spento) });
    const editor = await mount(EMPTY, fake);
    editor.setTool("rect");
    dispatch(editor, point("down", 220, 40));
    await settle();
    dispatch(editor, point("drag", 260, 70));
    await settle();
    expect(anteprima()).not.toBeNull();
    spento = true;
    dispatch(editor, point("drag", 280, 80));
    await settle();
    expect(anteprima()).toBeNull();
    expect(spoken()).toContain(t("draw.rejected", { reason: t("draw.reason.engine_off") }));
    dispatch(editor, point("drag", 290, 85));
    await settle();
    dispatch(editor, { ...point("up", 290, 85), pressure: 0 });
    await settle();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
    expect(gestures(fake).some((each) => each.phase === "commit")).toBe(false);
    expect(motore!.assente()).toEqual({ kind: "assente", perche: "spento" });
    // Il gesto dopo prende la strada semplice.
    const prima = fake.atGate("drawingGesture").length;
    await drag(editor, [[220, 40], [300, 90]]);
    expect(editor.engine.text).toContain('x="220" y="40" width="80" height="50"');
    expect(fake.atGate("drawingGesture")).toHaveLength(prima);
  });

  it("spento dalla pagina Componenti (`spento()`) mentre un'anteprima è in volo: il gesto si annulla col motivo", async () => {
    const fake = createFakeHost({ drawing: conAnteprima(() => false) });
    const editor = await mount(EMPTY, fake);
    editor.setTool("rect");
    dispatch(editor, point("down", 220, 40));
    await settle();
    const release = fake.throttle("drawingGesture");
    dispatch(editor, point("drag", 260, 70));
    await settle();
    motore!.spento();
    release();
    await settle();
    dispatch(editor, { ...point("up", 260, 70), pressure: 0 });
    await settle();
    expect(anteprima()).toBeNull();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
    expect(spoken()).toContain(t("draw.rejected", { reason: t("draw.reason.engine_off") }));
  });

  it("il motore che si ferma al rilascio: niente si scrive, e lo si dice «fermo»", async () => {
    const fake = createFakeHost({ drawing: conAnteprima(() => false) });
    const editor = await mount(EMPTY, fake);
    editor.setTool("rect");
    dispatch(editor, point("down", 220, 40));
    await settle();
    dispatch(editor, point("drag", 260, 70));
    await settle();
    fake.fault("drawingGesture", { kind: "internal", message: "il motore si è fermato" });
    dispatch(editor, { ...point("up", 260, 70), pressure: 0 });
    await settle();
    expect(anteprima()).toBeNull();
    expect(editor.engine.text).toBe(EMPTY);
    expect(spoken()).toContain(t("draw.rejected", { reason: t("draw.reason.engine_stopped") }));
    expect(motore!.assente()).toEqual({ kind: "assente", perche: "errore" });
  });
});

// --- Il Testo -------------------------------------------------------------------

describe("il Testo sul motore", () => {
  const CLIC = VECTORS.find((vector) => vector.name === "testo-clic")!;

  /// L'editor sul motore finto con il pannello delle proprietà chiuso.
  async function mountClosed(input: string, fake: FakeHost): Promise<DrawEditor> {
    const session = await documentOn(input);
    motore = motoreDa(() => apriSessione(fake.module.api, DOC, input, session, { vault: "/vault" }));
    await settle(0, 2);
    return createDrawEditor(host, SceneEngine.open(input), owner, {
      motore,
      grid: { ...DEFAULT_GRID, panel: false },
      onChange: (change) => {
        expect(sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation })).toEqual({ kind: "accepted" });
      },
    });
  }

  const panelOf = (): HTMLElement => host.querySelector<HTMLElement>(".draw-properties")!;
  const wordsField = (): HTMLTextAreaElement | null => host.querySelector<HTMLTextAreaElement>('.draw-properties-field[data-field="content"] textarea');

  async function click(editor: DrawEditor, x: number, y: number): Promise<void> {
    dispatch(editor, { kind: "down", x, y, pressure: 0.5, shift: false, alt: false, cmd: false });
    await settle();
    dispatch(editor, { kind: "up", x, y, pressure: 0, shift: false, alt: false, cmd: false });
    await settle(16, 8);
  }

  it("un clic dà un <text> con la parola del testo nuovo, scelto, e il campo «Testo» dell'ispettore a fuoco", async () => {
    const names = new Map<string, string>();
    const fake = createFakeHost({ drawing: replaying(CLIC, names) });
    const editor = await mountClosed(CLIC.input, fake);
    expect(panelOf().hidden).toBe(true);
    editor.setTool("text");
    await click(editor, 100, 80);
    // Il motore ha avuto la parola del testo nuovo.
    const sent = gestures(fake);
    expect(sent.map((each) => [each.tool, each.text])).toEqual(sent.map(() => ["text", t("draw.text.new")]));
    const id = names.get("@1")!;
    expect(editor.engine.text).toContain(`<text id="${id}" x="100" y="80"`);
    expect(editor.engine.text).toContain(`<tspan x="100" dy="0">${t("draw.text.new")}</tspan>`);
    expect(editor.selection).toEqual([id]);
    // L'ispettore chiuso si apre, col fuoco nel campo e la parola scelta.
    expect(panelOf().hidden).toBe(false);
    const field = wordsField()!;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe(t("draw.text.new"));
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    expect(spoken()).toContain(t("draw.added.text"));
  });

  it("il motore che si spegne fra il clic e l'esito: l'esito si scarta, niente si crea, e il clic dopo crea un testo solo", async () => {
    const names = new Map<string, string>();
    const fake = createFakeHost({ drawing: replaying(CLIC, names) });
    const editor = await mountClosed(CLIC.input, fake);
    editor.setTool("text");
    const release = fake.throttle("drawingGesture");
    dispatch(editor, { kind: "down", x: 100, y: 80, pressure: 0.5, shift: false, alt: false, cmd: false });
    await settle();
    dispatch(editor, { kind: "up", x: 100, y: 80, pressure: 0, shift: false, alt: false, cmd: false });
    await settle();
    motore!.spento();
    release();
    await settle(16, 8);
    expect(editor.engine.text).toBe(CLIC.input);
    expect(editor.canUndo).toBe(false);
    expect(spoken()).toContain(t("draw.rejected", { reason: t("draw.reason.engine_off") }));
    // Il clic dopo prende la strada semplice, e crea un testo solo.
    const prima = fake.atGate("drawingGesture").length;
    await click(editor, 100, 80);
    expect(fake.atGate("drawingGesture")).toHaveLength(prima);
    expect(editor.engine.text.match(/<text /g)).toHaveLength(1);
    expect(document.activeElement).toBe(wordsField());
  });

  it("il doppio clic della selezione su un testo ci entra: il campo «Testo» a fuoco, niente cambia nel file", async () => {
    const input = CLIC.input.replace(
      "</g>",
      '  <text id="ot1t1t1t1" x="100" y="80" fill="#000000" font-family="Inter, sans-serif" font-size="32"><tspan x="100" dy="0">Pioggia</tspan></text>\n  </g>',
    );
    expect(input).toContain('id="ot1t1t1t1"');
    // Il motore sceglie il testo a ogni clic, senza operazioni.
    const fake = createFakeHost({
      drawing: {
        gesto: (gesture) => ({ revision: gesture.revision, preview: null, ops: null, selection: gesture.phase === "commit" ? ["ot1t1t1t1"] : gesture.selection, losses: [], refused: null, frame: null }),
      },
    });
    const editor = await mountClosed(input, fake);
    editor.setTool("select");
    await click(editor, 110, 70);
    expect(editor.selection).toEqual(["ot1t1t1t1"]);
    expect(document.activeElement).not.toBe(wordsField());
    await click(editor, 110, 70);
    expect(panelOf().hidden).toBe(false);
    const field = wordsField()!;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Pioggia");
    expect(editor.engine.text).toBe(input);
    expect(editor.canUndo).toBe(false);
  });
});

// --- I pezzi ------------------------------------------------------------------

describe("i pezzi dei gesti", () => {
  it("un gesto di 100 001 eventi parte in due richieste, nell'ordine", () => {
    const events = Array.from({ length: 100_001 }, (_, at) => at);
    const pezzi = aPezzi(events);
    expect(pezzi.map((pezzo) => pezzo.length)).toEqual([100_000, 1]);
    expect(pezzi.flat()).toEqual(events);
    expect(aPezzi([])).toEqual([]);
  });

  it("le operazioni dell'esito: JSON, un array, ognuna da `parseWireOp`", () => {
    expect(opsDellEsito(null)).toEqual({ ops: [] });
    expect(opsDellEsito('[{"op":"set","id":"a","attrs":{"x":"1"}}]')).toEqual({ ops: [{ op: "set", id: "a", attrs: { x: "1" } }] });
    expect(opsDellEsito("non json")).toMatchObject({ reason: "invalid-elem" });
    expect(opsDellEsito("{}")).toMatchObject({ reason: "invalid-elem" });
    expect(opsDellEsito('[{"op":"inventata"}]')).toMatchObject({ reason: "invalid-elem" });
  });

  it("la forma dell'anteprima si accetta solo con la forma di un elemento", () => {
    expect(elemDi({ tag: "rect", attrs: { x: "1" } })).toEqual({ tag: "rect", attrs: { x: "1" } });
    expect(elemDi({ tag: "g", attrs: {}, children: [{ tag: "rect", attrs: {} }] })).toEqual({ tag: "g", attrs: {}, children: [{ tag: "rect", attrs: {} }] });
    expect(elemDi(null)).toBeNull();
    expect(elemDi({ tag: "rect", attrs: { x: 1 } })).toBeNull();
    expect(elemDi({ tag: "g", attrs: {}, children: [{ attrs: {} }] })).toBeNull();
  });
});

// --- Lo strumento del motore (K6 T8) ------------------------------------------

/// L'editor col motore dell'host finto, con la preparazione della famiglia
/// `prepara` (K6 T8). Come `mount`, ma con `preparaMotore` nelle opzioni.
async function montaConPreparazione(input: string, fake: FakeHost, prepara?: (id: string) => Promise<boolean>): Promise<DrawEditor> {
  const session = await documentOn(input);
  motore = motoreDa(() => apriSessione(fake.module.api, DOC, input, session, { vault: "/vault" }));
  await settle(0, 2);
  return createDrawEditor(host, SceneEngine.open(input), owner, {
    motore: motore!,
    preparaMotore: prepara,
    onChange: (change) => {
      expect(sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation })).toEqual({ kind: "accepted" });
    },
  });
}

/// Un esito del motore finto con lo stato dello strumento: il cursore e le
/// opzioni che il motore dice dopo un'opzione cambiata.
const esitoConStato = (cursor: string, options: unknown): DrawingOutcome => ({
  revision: "rev-1",
  preview: null,
  ops: null,
  selection: [],
  losses: [],
  refused: null,
  frame: null,
  state: { busy: false, transforming: false, wants_text: false, composing: false, cursor, options },
  reading: null,
});

/// Il motore finto che, a famiglia pronta, dice lo stato di serie di uno
/// strumento (`disegno.strumento.stato`), come quello vero.
const statoDiSerie = (): DrawingOutcome => esitoConStato("arrow", null);

describe("lo strumento del motore nei gesti (K6 T8)", () => {
  it("uno strumento del motore manda `DrawingTool::Engine` col suo id, e il cursore del foglio segue il suo stato", async () => {
    const fake = createFakeHost({ drawing: { comando: statoDiSerie } as DrawingFake });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("pencil");
    await drag(editor, [[220, 40], [260, 70], [300, 90]]);
    expect(gestures(fake).length).toBeGreaterThan(0);
    expect(gestures(fake).every((each) => JSON.stringify(each.tool) === JSON.stringify({ engine: { id: "pencil" } }))).toBe(true);
    expect(gestures(fake).slice(-1)[0]!.phase).toBe("commit");
    // Lo stato dell'ultimo esito (fermo) dà il cursore di serie del motore.
    expect(surfaceOf().style.cursor).toBe("default");
    expect(editor.statoStrumento("pencil")).toEqual(expect.objectContaining({ cursor: "arrow" }));
  });

  it("il mouse preme in pieno (pressione 1), come in VectorCraft: il rilascio porta 0", async () => {
    const fake = createFakeHost({ drawing: { comando: statoDiSerie } as DrawingFake });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("paintbrush");
    await drag(editor, [[220, 40], [260, 70], [300, 90]]);
    const eventi = gestures(fake).flatMap((each) => each.events);
    expect(eventi.filter((e) => e.kind === "down" || e.kind === "drag").map((e) => e.pressure)).toEqual([1, 1, 1]);
    expect(eventi.filter((e) => e.kind === "up").map((e) => e.pressure)).toEqual([0]);
  });

  it("un'opzione cambiata va al motore, e lo stato che torna si registra", async () => {
    const fake = createFakeHost({
      drawing: {
        comando: (request) => ({ ...esitoConStato("arrow", request.value), revision: "rev-2" }),
      } as DrawingFake,
    });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("pencil");
    editor.setEngineOption("pen", "spessore", 3);
    await settle();
    const comandi = fake.atGate("drawingCommand").map((call) => call.args[1] as { id: string; selection: string[]; value: unknown });
    expect(comandi.filter((c) => c.id === DRAWING_COMMAND_TOOL_OPTION)).toEqual([expect.objectContaining({ selection: [], value: { strumento: "pen", chiave: "spessore", valore: 3 } })]);
    expect(editor.statoStrumento("pencil")).toEqual(expect.objectContaining({ cursor: "arrow" }));
  });

  it("a famiglia pronta lo stato dello strumento si legge senza un gesto, e una volta sola", async () => {
    let pronta!: (ok: boolean) => void;
    const fake = createFakeHost({
      drawing: {
        comando: (request) => (request.id === DRAWING_COMMAND_TOOL_STATE ? esitoConStato("crosshair", { meshPoints: [] }) : esitoConStato("arrow", null)),
      } as DrawingFake,
    });
    const editor = await montaConPreparazione(EMPTY, fake, () => new Promise<boolean>((resolve) => (pronta = resolve)));
    editor.setEngineTool("directSelection");
    await settle();
    // Mentre si prepara, niente: la famiglia non c'è ancora.
    expect(fake.atGate("drawingCommand")).toHaveLength(0);
    expect(editor.statoStrumento("directSelection")).toBeNull();
    pronta(true);
    await settle(0, 4);
    const comandi = fake.atGate("drawingCommand").map((call) => call.args[1] as { id: string; selection: string[]; value: unknown });
    expect(comandi).toEqual([expect.objectContaining({ id: DRAWING_COMMAND_TOOL_STATE, selection: [], value: { strumento: "directSelection" } })]);
    expect(editor.statoStrumento("directSelection")).toEqual(expect.objectContaining({ cursor: "crosshair", options: { meshPoints: [] } }));
    // Nessun gesto è partito, e il documento non è cambiato.
    expect(gestures(fake)).toHaveLength(0);
    // Tornare allo strumento, con lo stato già noto, non lo rilegge.
    editor.setEngineTool(null);
    editor.setEngineTool("directSelection");
    await settle(0, 4);
    expect(fake.atGate("drawingCommand")).toHaveLength(1);
  });

  it("la famiglia che non arriva non legge lo stato", async () => {
    const fake = createFakeHost({ drawing: { comando: () => esitoConStato("arrow", null) } as DrawingFake });
    const editor = await montaConPreparazione(EMPTY, fake, async () => false);
    editor.setEngineTool("selection");
    await settle(0, 4);
    expect(fake.atGate("drawingCommand")).toHaveLength(0);
    expect(editor.statoStrumento("selection")).toBeNull();
  });

  it("la famiglia che non arriva: lo strumento di prima resta, e lo si dice con «Riprova»", async () => {
    const fake = createFakeHost({ drawing: {} });
    const editor = await montaConPreparazione(EMPTY, fake, async () => false);
    editor.setTool("rect");
    editor.setEngineTool("pencil");
    await settle();
    // Lo si dice subito, prima che il gesto dopo scriva la sua riga.
    expect(spoken()).toContain(t("draw.engine.prepare.failed"));
    await drag(editor, [[220, 40], [300, 90]]);
    expect(gestures(fake).length).toBeGreaterThan(0);
    expect(gestures(fake).every((each) => each.tool === "rect")).toBe(true);
  });

  it("uno strumento scelto mentre la famiglia si prepara: il gesto aspetta, poi parte", async () => {
    const fake = createFakeHost({ drawing: {} });
    let pronta!: (ok: boolean) => void;
    const editor = await montaConPreparazione(EMPTY, fake, () => new Promise<boolean>((resolve) => (pronta = resolve)));
    editor.setEngineTool("pencil");
    await drag(editor, [[220, 40], [300, 90]]);
    expect(gestures(fake)).toHaveLength(0);
    pronta(true);
    await settle(16, 8);
    expect(gestures(fake).slice(-1)[0]!.phase).toBe("commit");
    expect(gestures(fake)[0]!.tool).toEqual({ engine: { id: "pencil" } });
  });

  it("i punti scelti al gesto di prima vanno col gesto dopo, e solo per lo strumento che li ha", async () => {
    const punto = { element: "t", subpath: 0, anchor: 1, at: [100, 60] as [number, number], end: false };
    const fake = createFakeHost({
      drawing: {
        comando: statoDiSerie,
        gesto: (gesture) => {
          const id = typeof gesture.tool === "object" ? gesture.tool.engine.id : "";
          const esito = esitoConStato("arrow", null);
          return id === "directSelection" ? { ...esito, state: { ...esito.state!, anchors: [punto] } } : esito;
        },
      } as DrawingFake,
    });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("directSelection");
    await drag(editor, [[220, 40], [222, 41]]);
    // Il primo gesto non ha punti da portare.
    expect(gestures(fake).every((g) => g.anchors === undefined)).toBe(true);
    const primi = gestures(fake).length;
    await drag(editor, [[220, 40], [260, 70]]);
    const dopo = gestures(fake).slice(primi);
    expect(dopo.length).toBeGreaterThan(0);
    expect(dopo.every((g) => JSON.stringify(g.anchors) === JSON.stringify([punto]))).toBe(true);
    // Un altro strumento non porta i punti della Selezione diretta.
    editor.setEngineTool("pencil");
    const prima = gestures(fake).length;
    await drag(editor, [[220, 40], [260, 70]]);
    expect(gestures(fake).slice(prima).every((g) => g.anchors === undefined)).toBe(true);
  });

  it("il mouse che passa senza premere va al motore, al più una volta per fotogramma, e ne mostra cursore e segni", async () => {
    const fake = createFakeHost({
      drawing: {
        comando: statoDiSerie,
        gesto: (gesture) => {
          if (gesture.phase !== "preview" || gesture.events[0]?.kind !== "move") return esitoConStato("arrow", null);
          const sopraIlPunto = Math.hypot(gesture.events[0].x - 220, gesture.events[0].y - 40) < 5;
          const esito = esitoConStato(sopraIlPunto ? "crosshair" : "arrow", null);
          const overlays: DrawingOverlay[] = sopraIlPunto ? [{ kind: "anchor", at: [220, 40], role: "selection", filled: false, size: 7 }] : [];
          return { ...esito, preview: { shape: null, overlays, marquee: null, matrix: null } };
        },
      } as DrawingFake,
    });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("directSelection");
    const prima = gestures(fake).length;
    // Tre movimenti nello stesso fotogramma: parte solo l'ultimo.
    dispatch(editor, point("move", 100, 100));
    dispatch(editor, point("move", 150, 100));
    dispatch(editor, point("move", 220, 40));
    await settle();
    const passaggi = gestures(fake).slice(prima);
    expect(passaggi).toHaveLength(1);
    expect(passaggi[0]).toEqual(expect.objectContaining({ phase: "preview", tool: { engine: { id: "directSelection" } }, selection: [] }));
    expect(passaggi[0]!.events).toEqual([expect.objectContaining({ kind: "move", x: 220, y: 40 })]);
    expect(surfaceOf().style.cursor).toBe("crosshair");
    // Il punto sotto il mouse è sullo strato dell'anteprima.
    const anteprima = (): number => host.querySelector(".draw-preview g g")?.childElementCount ?? 0;
    expect(anteprima()).toBeGreaterThan(0);
    // Lontano dal punto il cursore torna quello di serie; fuori dal foglio
    // non parte niente.
    dispatch(editor, point("move", 400, 300));
    await settle();
    expect(surfaceOf().style.cursor).toBe("default");
    expect(anteprima()).toBe(0);
    const dopo = gestures(fake).length;
    surfaceOf().dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, pointerType: "mouse" }));
    await settle();
    expect(gestures(fake).length).toBe(dopo);
    // Nessun passaggio scrive.
    expect(gestures(fake).slice(prima).every((g) => g.phase === "preview")).toBe(true);
  });

  it("Esc annulla il gesto e lo strumento del motore resta", async () => {
    const fake = createFakeHost({ drawing: { comando: statoDiSerie } as DrawingFake });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("pen");
    dispatch(editor, point("down", 220, 40));
    await settle();
    dispatch(editor, point("drag", 260, 70));
    await settle();
    dispatch(editor, point("drag", 260, 70), "pointercancel");
    await settle();
    expect(gestures(fake).map((each) => each.phase)).toContain("cancel");
    await drag(editor, [[220, 40], [300, 90]]);
    expect(gestures(fake).slice(-1)[0]!.tool).toEqual({ engine: { id: "pen" } });
  });
});

// --- La penna del motore: il tracciato aperto (K6 T12) -------------------------

/// Il motore finto della penna: a ogni clic il tracciato resta aperto
/// (`busy`, coi punti come segni); il rilascio vero, con Invio, Esc o lo
/// strumento cambiato, scrive le ops del rettangolo in un passo.
function pennaFinta(): DrawingFake {
  const rettangolo = VECTORS.find((vector) => vector.name === "rettangolo")!;
  const stato = (busy: boolean) => ({ busy, transforming: false, wants_text: false, composing: false, cursor: "crosshair", options: null });
  return {
    comando: statoDiSerie,
    gesto: (gesture) => {
      const base: DrawingOutcome = { revision: gesture.revision, preview: null, ops: null, selection: gesture.selection, losses: [], refused: null, frame: null, reading: null };
      if (gesture.phase === "preview") {
        const ultimo = gesture.events[gesture.events.length - 1];
        const overlays = ultimo === undefined ? [] : [{ kind: "anchor" as const, at: [ultimo.x, ultimo.y] as [number, number], role: "selection", filled: true, size: 7 }];
        return { ...base, preview: { shape: null, matrix: null, marquee: null, overlays }, state: stato(true) };
      }
      if (gesture.phase === "commit") return { ...base, ops: JSON.stringify(rettangolo.expect.ops).replace(/@1/g, "oz0000001"), selection: [], state: stato(false) };
      return { ...base, state: stato(false) };
    },
  } as DrawingFake;
}

/// Un clic sul foglio: premi e rilascia nello stesso punto.
async function clic(editor: DrawEditor, x: number, y: number): Promise<void> {
  dispatch(editor, point("down", x, y));
  await settle();
  dispatch(editor, { ...point("up", x, y), pressure: 0 });
  await settle();
}

/// Un tasto premuto sul foglio.
async function tasto(key: string): Promise<void> {
  surfaceOf().dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
  await settle(16, 8);
}

describe("la penna del motore: il tracciato aperto (K6 T12)", () => {
  it("i clic lasciano il tracciato aperto, coi suoi punti sul foglio; Invio lo chiude come il motore, in un passo", async () => {
    const fake = createFakeHost({ drawing: pennaFinta() });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("pen");
    await clic(editor, 220, 40);
    await clic(editor, 300, 90);
    await settle(16, 8);
    expect(gestures(fake).map((each) => each.phase)).not.toContain("commit");
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
    // I segni del motore (il punto dell'ultimo clic) si vedono.
    expect(host.querySelector(".draw-engine-marks")).not.toBeNull();
    await tasto("Enter");
    const ultimo = gestures(fake).slice(-1)[0]!;
    expect(ultimo.phase).toBe("commit");
    expect(ultimo.inputs).toEqual([expect.objectContaining({ kind: "key", key: "Enter", pressed: true })]);
    expect(gestures(fake).filter((each) => each.phase === "commit")).toHaveLength(1);
    expect(editor.engine.text).not.toBe(EMPTY);
    expect(spoken()).toContain(t("draw.engine.done"));
    expect(host.querySelector(".draw-engine-marks")).toBeNull();
    editor.undo();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
  });

  it("cambiato lo strumento, il tracciato aperto resta com'è, aperto, in un passo", async () => {
    const fake = createFakeHost({ drawing: pennaFinta() });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("pen");
    await clic(editor, 220, 40);
    await clic(editor, 300, 90);
    editor.setEngineTool("pencil");
    await settle(16, 8);
    const commit = gestures(fake).filter((each) => each.phase === "commit");
    expect(commit).toHaveLength(1);
    // Nessun tasto: il motore lo lascia aperto, come quando si lascia la penna.
    expect(commit[0]!.inputs ?? []).toEqual([]);
    expect(gestures(fake).map((each) => each.phase)).not.toContain("cancel");
    expect(editor.engine.text).not.toBe(EMPTY);
    editor.undo();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
  });

  it("Esc chiude il tracciato come il motore; un secondo Esc torna alla Selezione", async () => {
    const fake = createFakeHost({ drawing: pennaFinta() });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool("pen");
    await clic(editor, 220, 40);
    await clic(editor, 300, 90);
    await tasto("Escape");
    const ultimo = gestures(fake).slice(-1)[0]!;
    expect(ultimo.phase).toBe("commit");
    expect(ultimo.inputs).toEqual([expect.objectContaining({ kind: "key", key: "Escape" })]);
    expect(editor.engine.text).not.toBe(EMPTY);
    const prima = gestures(fake).length;
    await tasto("Escape");
    expect(editor.tool).toBe("select");
    // Il secondo Esc non manda niente al motore.
    expect(gestures(fake)).toHaveLength(prima);
  });

  it("un testo che cambia sotto non perde il tracciato aperto: il commit parte prima del sync, alla revisione vecchia, in un passo", async () => {
    const fake = createFakeHost({ drawing: pennaFinta() });
    const session = await documentOn(EMPTY);
    motore = motoreDa(() => apriSessione(fake.module.api, DOC, EMPTY, session, { vault: "/vault" }));
    await settle(0, 2);
    // Il foglio qui non segue l'altra superficie: le sue modifiche vanno alla
    // sessione senza pretendere che combacino.
    const editor = createDrawEditor(host, SceneEngine.open(EMPTY), owner, {
      motore: motore!,
      onChange: (change) => void sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation }),
    });
    editor.setEngineTool("pen");
    await clic(editor, 220, 40);
    await clic(editor, 300, 90);
    await settle(16, 8);
    const revisione = gestures(fake).slice(-1)[0]!.revision;
    const prima = drawingCalls(fake).length;
    // Un'altra superficie cambia il testo mentre il tracciato è aperto.
    const before = lineFeeds(session.text());
    const from = before.lastIndexOf("</svg>");
    expect(sessions!.acceptSurfaceChange(DOC, "altro", {
      text: `${before.slice(0, from)}\n${before.slice(from)}`,
      operation: { beforeLength: before.length, afterLength: before.length + 1, edits: [{ from, to: from, deleted: "", inserted: "\n" }] },
    })).toEqual({ kind: "accepted" });
    await settle(16, 8);
    expect(drawingCalls(fake).slice(prima, prima + 2)).toEqual(["drawingGesture", "drawingSync"]);
    const commit = gestures(fake).filter((each) => each.phase === "commit");
    expect(commit).toHaveLength(1);
    expect(commit[0]!.revision).toBe(revisione);
    expect(commit[0]!.inputs ?? []).toEqual([]);
    // I punti sono nel foglio, in un passo; i segni del motore se ne vanno.
    expect(editor.engine.text).not.toBe(EMPTY);
    expect(host.querySelector(".draw-engine-marks")).toBeNull();
    editor.undo();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
    // Chiuso, il tracciato non c'è più: un altro sync non manda un secondo
    // commit.
    const gesti = gestures(fake).length;
    const adesso = lineFeeds(session.text());
    const dove = adesso.lastIndexOf("\n</svg>");
    expect(sessions!.acceptSurfaceChange(DOC, "altro", {
      text: `${adesso.slice(0, dove)}${adesso.slice(dove + 1)}`,
      operation: { beforeLength: adesso.length, afterLength: adesso.length - 1, edits: [{ from: dove, to: dove + 1, deleted: "\n", inserted: "" }] },
    }).kind).toBe("accepted");
    await settle(16, 8);
    expect(gestures(fake)).toHaveLength(gesti);
  });

  it("con uno strumento del motore le opzioni dell'Inchiostro lasciano la riga; tornano con l'Inchiostro", async () => {
    const fake = createFakeHost({ drawing: { comando: statoDiSerie } as DrawingFake });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setTool("pen");
    const opzioniInchiostro = (): HTMLElement => host.querySelector<HTMLElement>('.kit-options-row [role="group"][aria-label="Penna"]')!;
    expect(opzioniInchiostro().hidden).toBe(false);
    editor.setEngineTool("directSelection");
    await settle(16, 8);
    expect(opzioniInchiostro().hidden).toBe(true);
    editor.setEngineTool(null);
    await settle(16, 8);
    expect(opzioniInchiostro().hidden).toBe(false);
  });
});

// --- Il Testo del motore: si scrive con la tastiera (K6 T16) -----------------

/// Il motore finto del Testo di punto: il clic apre la casella (`busy`,
/// `wants_text`); ogni anteprima aggiunge ciò che arriva (il testo, l'IME, i
/// tasti) alle righe, e rimanda il `<text>` col cursore; il commit scrive le
/// ops del rettangolo (il loro contenuto qui non conta) in un passo.
function testoFinto(): DrawingFake {
  const rettangolo = VECTORS.find((vector) => vector.name === "rettangolo")!;
  const stato = (busy: boolean) => ({ busy, transforming: false, wants_text: busy, composing: false, cursor: "text", options: null });
  let righe = [""];
  return {
    comando: statoDiSerie,
    gesto: (gesture) => {
      const base: DrawingOutcome = { revision: gesture.revision, preview: null, ops: null, selection: gesture.selection, losses: [], refused: null, frame: null, reading: null };
      for (const ingresso of gesture.inputs ?? []) {
        if (ingresso.kind === "text") righe[righe.length - 1] += ingresso.text;
        else if (ingresso.kind === "key" && ingresso.key === "Enter") righe.push("");
        else if (ingresso.kind === "key" && ingresso.key === "Backspace") righe[righe.length - 1] = [...righe[righe.length - 1]!].slice(0, -1).join("");
      }
      if (gesture.phase === "preview") {
        const shape = { tag: "text", attrs: { x: "40", y: "60" }, children: righe.map((riga) => ({ tag: "tspan", attrs: { x: "40" }, text: riga })) };
        const caret = { kind: "line" as const, a: [80, 48] as [number, number], b: [80, 62] as [number, number], role: "preview" as const, dashed: false };
        return { ...base, preview: { shape, matrix: null, marquee: null, overlays: [caret] }, state: stato(true) };
      }
      if (gesture.phase === "commit") {
        righe = [""];
        return { ...base, ops: JSON.stringify(rettangolo.expect.ops).replace(/@1/g, "oz0000001"), selection: [], state: stato(false) };
      }
      return { ...base, state: stato(false) };
    },
  } as DrawingFake;
}

const casella = (): HTMLTextAreaElement | null => host.querySelector<HTMLTextAreaElement>("textarea.draw-scrittura");

/// Scrive `testo` nella casella, come la tastiera: il valore e l'`input`.
async function scrivi(testo: string): Promise<void> {
  const c = casella()!;
  c.value = testo;
  c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: testo }));
  await settle(16, 8);
}

/// Un tasto premuto nella casella.
async function tastoNellaCasella(key: string, opzioni: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...opzioni });
  casella()!.dispatchEvent(event);
  await settle(16, 8);
  return event;
}

/// Un evento dell'IME con la sua parola (happy-dom non legge `data`).
function composizione(tipo: string, data: string): CompositionEvent {
  const event = new CompositionEvent(tipo, { data });
  Object.defineProperty(event, "data", { value: data });
  return event;
}

const ingressiDi = (fake: FakeHost) => gestures(fake).flatMap((each) => each.inputs ?? []);

/// Il Testo del motore scelto e un clic sul foglio: la casella è aperta.
async function apriIlTesto(fake: FakeHost): Promise<DrawEditor> {
  const editor = await montaConPreparazione(EMPTY, fake);
  editor.setEngineTool("type");
  await clic(editor, 40, 60);
  await settle(16, 8);
  return editor;
}

describe("il Testo del motore: si scrive con la tastiera (K6 T16)", () => {
  it.each(["areaType", "typeOnPath"])("anche %s scrive: il clic apre la casella e le parole vanno al motore", async (strumento) => {
    const fake = createFakeHost({ drawing: testoFinto() });
    const editor = await montaConPreparazione(EMPTY, fake);
    editor.setEngineTool(strumento);
    await clic(editor, 40, 60);
    await settle(16, 8);
    expect(casella()).not.toBeNull();
    expect(document.activeElement).toBe(casella());
    await scrivi("Ciao");
    expect(gestures(fake).map((each) => each.phase)).not.toContain("commit");
    expect(ingressiDi(fake)).toEqual([{ kind: "text", text: "Ciao" }]);
  });

  it("un clic apre la casella a fuoco; le parole e i tasti vanno al motore, il testo si vede, e Esc lo chiude in un passo e torna alla Selezione", async () => {
    const fake = createFakeHost({ drawing: testoFinto() });
    const editor = await apriIlTesto(fake);
    expect(casella()).not.toBeNull();
    expect(document.activeElement).toBe(casella());
    expect(casella()!.getAttribute("aria-label")).toBe(t("draw.engine.type.box"));
    await scrivi("Città 🌧");
    await tastoNellaCasella("Backspace");
    await tastoNellaCasella("Enter");
    await scrivi("é");
    // Niente è scritto nel disegno finché il testo è aperto.
    expect(gestures(fake).map((each) => each.phase)).not.toContain("commit");
    expect(editor.engine.text).toBe(EMPTY);
    expect(ingressiDi(fake)).toEqual([
      { kind: "text", text: "Città 🌧" },
      expect.objectContaining({ kind: "key", key: "Backspace", pressed: true }),
      expect.objectContaining({ kind: "key", key: "Enter", pressed: true }),
      { kind: "text", text: "é" },
    ]);
    // L'anteprima: il testo del motore, con le sue righe (l'emoji è tolta
    // intera dal Backspace del motore finto), e il cursore.
    const righe = [...host.querySelectorAll("text tspan")].map((each) => each.textContent);
    expect(righe).toEqual(["Città ", "é"]);
    expect(host.querySelector(".draw-engine-line")).not.toBeNull();
    // La casella sta sul cursore del motore.
    expect(casella()!.style.transform).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/u);
    // Una lettera nella casella non è una scorciatoia del foglio.
    const prima = editor.tool;
    const lettera = await tastoNellaCasella("v");
    expect(lettera.defaultPrevented).toBe(false);
    expect(editor.tool).toBe(prima);
    expect(casella()).not.toBeNull();
    await tastoNellaCasella("Escape");
    const commit = gestures(fake).filter((each) => each.phase === "commit");
    expect(commit).toHaveLength(1);
    expect(commit[0]!.inputs).toEqual([expect.objectContaining({ kind: "key", key: "Escape" })]);
    expect(casella()).toBeNull();
    expect(host.querySelector("text tspan")).toBeNull();
    expect(editor.tool).toBe("select");
    expect(editor.engine.text).not.toBe(EMPTY);
    editor.undo();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canUndo).toBe(false);
  });

  it("ciò che si scrive e non è ancora partito va col commit, prima di Esc", async () => {
    const fake = createFakeHost({ drawing: testoFinto() });
    await apriIlTesto(fake);
    const c = casella()!;
    c.value = "ciao";
    c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "ciao" }));
    c.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    await settle(16, 8);
    const commit = gestures(fake).filter((each) => each.phase === "commit");
    expect(commit).toHaveLength(1);
    expect(commit[0]!.inputs).toEqual([{ kind: "text", text: "ciao" }, expect.objectContaining({ kind: "key", key: "Escape" })]);
  });

  it("l'IME manda la parola segnata e poi quella scelta; un incolla da Windows arriva con gli a capo di Fub", async () => {
    const fake = createFakeHost({ drawing: testoFinto() });
    await apriIlTesto(fake);
    const c = casella()!;
    c.dispatchEvent(composizione("compositionstart", ""));
    c.value = "か";
    c.dispatchEvent(composizione("compositionupdate", "か"));
    // Mentre l'IME compone i tasti sono suoi: il motore non li vede.
    await tastoNellaCasella("Enter", { isComposing: true });
    c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "か", isComposing: true }));
    c.dispatchEvent(composizione("compositionend", "書"));
    c.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "書" }));
    await settle(16, 8);
    await scrivi("uno\r\ndue");
    expect(ingressiDi(fake)).toEqual([
      { kind: "ime", preedit: "", active: null },
      { kind: "ime", preedit: "か", active: null },
      { kind: "text", text: "書" },
      { kind: "text", text: "uno\ndue" },
    ]);
  });

  it("Ctrl+Z chiude il testo e lo annulla: il disegno torna com'era", async () => {
    const fake = createFakeHost({ drawing: testoFinto() });
    const editor = await apriIlTesto(fake);
    await scrivi("parola");
    const z = await tastoNellaCasella("z", { code: "KeyZ", ctrlKey: true });
    expect(z.defaultPrevented).toBe(true);
    await settle(16, 8);
    expect(gestures(fake).filter((each) => each.phase === "commit")).toHaveLength(1);
    expect(casella()).toBeNull();
    expect(editor.engine.text).toBe(EMPTY);
    expect(editor.canRedo).toBe(true);
  });

  it("il fuoco altrove chiude il testo com'è, in un passo; un clic sul foglio ne apre uno nuovo", async () => {
    const fake = createFakeHost({ drawing: testoFinto() });
    const editor = await apriIlTesto(fake);
    await scrivi("uno");
    casella()!.blur();
    await settle(16, 8);
    const commit = gestures(fake).filter((each) => each.phase === "commit");
    expect(commit).toHaveLength(1);
    expect(commit[0]!.inputs ?? []).toEqual([]);
    expect(casella()).toBeNull();
    expect(editor.engine.text).not.toBe(EMPTY);
    // Lo strumento resta il Testo: un clic dopo apre un'altra casella.
    await clic(editor, 200, 200);
    await settle(16, 8);
    expect(casella()).not.toBeNull();
  });

  it("un comando che cambia il disegno chiude prima il testo aperto, che il motore altrimenti scarterebbe", async () => {
    const fake = createFakeHost({ drawing: testoFinto() });
    const editor = await apriIlTesto(fake);
    await scrivi("uno");
    const prima = drawingCalls(fake).length;
    const sessione = motore!.adesso() as SessioneMotore;
    // Lo stato di uno strumento non tocca il disegno: il testo resta aperto.
    await sessione.comando({ id: DRAWING_COMMAND_TOOL_STATE, selection: [], value: { strumento: "type" } });
    await settle(16, 8);
    expect(drawingCalls(fake).slice(prima)).toEqual(["drawingCommand"]);
    expect(casella()).not.toBeNull();
    void sessione.comando({ id: "disegno.text.setStyle", selection: [], value: { justify: "center" } }).catch(() => undefined);
    await settle(16, 8);
    expect(drawingCalls(fake).slice(prima + 1, prima + 3)).toEqual(["drawingGesture", "drawingCommand"]);
    expect(gestures(fake).filter((each) => each.phase === "commit")).toHaveLength(1);
    expect(casella()).toBeNull();
    expect(editor.engine.text).not.toBe(EMPTY);
  });
});
