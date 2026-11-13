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
import type { DrawingFrame, DrawingGesture, DrawingOutcome, DrawingPointer } from "../../../host/contract";
import { createFakeHost, type DrawingFake, type FakeHost } from "../../../host/fake";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
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
