// @vitest-environment happy-dom
//
// Le due strade del disegno (K5 T23, A16): con il motore spento si disegna
// con gli strumenti semplici, quelli TypeScript del client; con il motore
// acceso i gesti passano dal motore. Per ogni vettore dei gesti
// (`__fixtures__/disegno-gesti/`, Testo compreso) le due strade devono dare lo
// stesso file, lo stesso passo di annulla e la stessa selezione: il motore
// spento non è un disegno diverso. Il motore acceso è il `DrawingFake` che
// risponde le `expect.ops` del vettore; quello spento è l'host finto senza
// motore, che risponde `unserved`.
//
// E un gesto cominciato col motore acceso, col motore che si spegne a metà,
// si annulla senza scrivere niente: la strada non cambia a metà gesto.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingGesture, DrawingOutcome, DrawingPointer } from "../../../host/contract";
import { createFakeHost, type DrawingFake, type FakeHost } from "../../../host/fake";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { toScreen } from "../view";
import { createDrawEditor, type DrawEditor } from "../tools/editor";
import { DEFAULT_GRID } from "../tools/grid";
import type { ToolId } from "../tools/registry";
import { motoreDa, type MotoreAperto } from "./gesti";
import { apriSessione } from "./sessione";

// --- I vettori ----------------------------------------------------------------

interface Vector {
  readonly name: string;
  readonly input: string;
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
  await tearDown();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/// Chiude l'editor, il motore e la `DocumentSession` di adesso: un vettore
/// fa due giri, uno per strada.
async function tearDown(): Promise<void> {
  owner.close();
  host.replaceChildren();
  for (const menu of document.querySelectorAll(".context-menu")) menu.remove();
  await motore?.chiudi();
  motore = null;
  sessions?.closeAll();
  sessions = null;
}

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

/// L'editor su `input` col motore dell'host `fake`, che porta ogni gesto
/// alla `DocumentSession`.
async function mount(input: string, fake: FakeHost, grid: number | null): Promise<DrawEditor> {
  owner = openLifetime();
  const session = await documentOn(input);
  motore = motoreDa(() => apriSessione(fake.module.api, DOC, input, session, { vault: "/vault" }));
  await settle(0, 2);
  return createDrawEditor(host, SceneEngine.open(input), owner, {
    motore,
    grid: grid === null ? DEFAULT_GRID : { ...DEFAULT_GRID, snap: true, step: grid },
    onChange: (change) => {
      expect(sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation })).toEqual({ kind: "accepted" });
    },
  });
}

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
function dispatch(editor: DrawEditor, event: Pick<DrawingPointer, "kind" | "x" | "y" | "pressure" | "shift" | "alt" | "cmd">): void {
  const target = host.querySelector<HTMLElement>(".draw-surface")!;
  const box = target.getBoundingClientRect();
  const [sx, sy] = toScreen(editor.stage.camera, [event.x, event.y]);
  const down = event.kind === "down" || event.kind === "drag";
  const pointer = new PointerEvent(event.kind === "down" ? "pointerdown" : event.kind === "up" ? "pointerup" : "pointermove", {
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

/// Prepara l'editor come il vettore: camera, strumento, stile, livello e
/// selezione.
function prepare(editor: DrawEditor, vector: Vector): void {
  const { gesture } = vector;
  editor.stage.setCamera({ scale: gesture.zoom, tx: 0, ty: 0 });
  editor.setTool(gesture.tool as ToolId);
  if (gesture.style !== null) {
    editor.setColor(gesture.style.stroke);
    editor.setWidth(gesture.style.width);
  }
  if (gesture.layer !== null) chooseLayer(vector.input, gesture.layer);
  editor.select(gesture.selection);
}

/// Il motore finto che rigioca `vector`: alle anteprime risponde la
/// selezione com'è, al rilascio le `expect.ops` del vettore, con gli id
/// nuovi (`@1`, `@2`…) fatti id veri. `spento` lo spegne a metà.
function replaying(vector: Vector, spento: () => boolean = () => false): DrawingFake {
  const names = new Map<string, string>();
  const real = (text: string): string =>
    text.replace(/@(\d+)/g, (_found, n: string) => {
      const key = `@${n}`;
      if (!names.has(key)) names.set(key, `oz${n.padStart(7, "0")}`);
      return names.get(key)!;
    });
  return {
    spento,
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

// --- Il confronto -------------------------------------------------------------

const idsIn = (text: string): string[] => [...text.matchAll(/ id="([^"]+)"/g)].map((found) => found[1]!);

/// Il testo e la selezione con gli id nuovi, quelli che `input` non ha,
/// scritti `#1`, `#2`… nell'ordine in cui compaiono nel testo, poi nella
/// selezione: i nomi casuali degli strumenti semplici, quelli del motore
/// finto e gli `@n` del vettore diventano gli stessi.
function canonical(input: string, text: string, selection: readonly string[]): { readonly text: string; readonly selection: readonly string[] } {
  const known = new Set(idsIn(input));
  const order: string[] = [];
  for (const id of [...idsIn(text), ...selection]) if (!known.has(id) && !order.includes(id)) order.push(id);
  if (order.length === 0) return { text, selection: [...selection] };
  const names = new Map(order.map((id, at) => [id, `#${at + 1}`]));
  const pattern = new RegExp(`(?<![A-Za-z0-9_@-])(${order.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9_-])`, "g");
  const rename = (each: string): string => each.replace(pattern, (id) => names.get(id)!);
  return { text: rename(text), selection: selection.map(rename) };
}

/// Ciò che una strada ha fatto del gesto.
interface Outcome {
  readonly text: string;
  readonly selection: readonly string[];
  /// Quanti passi di annulla il gesto ha lasciato: annullarli tutti torna al
  /// testo di partenza.
  readonly steps: number;
  /// Il testo della `DocumentSession`, che deve essere quello dell'editor.
  readonly saved: string;
  readonly gestures: number;
}

/// Fa il gesto del vettore su un editor col motore di `fake`.
async function walk(vector: Vector, fake: FakeHost): Promise<Outcome> {
  const editor = await mount(vector.input, fake, vector.gesture.snap.grid);
  prepare(editor, vector);
  for (const event of vector.gesture.events) {
    dispatch(editor, event);
    await settle();
  }
  await settle(16, 8);
  const done = canonical(vector.input, editor.engine.text, editor.selection);
  const saved = sessions!.get(DOC)!.text();
  let steps = 0;
  while (editor.canUndo && steps < 10) {
    editor.undo();
    steps++;
  }
  expect(editor.engine.text).toBe(vector.input);
  const outcome: Outcome = { ...done, steps, saved: canonical(vector.input, saved, []).text, gestures: fake.atGate("drawingGesture").length };
  await tearDown();
  return outcome;
}

// --- Le due strade --------------------------------------------------------------

describe("le due strade danno lo stesso disegno", () => {
  it("ci sono tutti i vettori, Testo compreso", () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(30);
    expect(VECTORS.some((vector) => vector.gesture.tool === "text")).toBe(true);
  });

  for (const vector of VECTORS) {
    it(`${vector.name}: spento e acceso, lo stesso testo, un passo di annulla e la stessa selezione`, { timeout: 60_000 }, async () => {
      // Spento: l'host senza il motore risponde `unserved`.
      const off = createFakeHost();
      const simple = await walk(vector, off);
      expect(off.atGate("openDrawing")).toHaveLength(1);
      expect(simple.gestures).toBe(0);

      // Acceso: il motore finto risponde le operazioni del vettore.
      const engine = await walk(vector, createFakeHost({ drawing: replaying(vector) }));
      expect(engine.gestures).toBeGreaterThan(0);

      const wanted = canonical(vector.input, vector.expect.text, vector.expect.selection);
      for (const road of [simple, engine]) {
        expect(road.text).toBe(wanted.text);
        expect(road.saved).toBe(wanted.text);
        expect(road.selection).toEqual(wanted.selection);
        // Un gesto che scrive è un passo di annulla; uno che non scrive
        // nessuno.
        expect(road.steps).toBe(vector.expect.ops === null ? 0 : 1);
      }
      expect({ text: engine.text, selection: engine.selection, steps: engine.steps }).toEqual({ text: simple.text, selection: simple.selection, steps: simple.steps });
    });
  }
});

describe("il motore che si spegne a metà gesto", () => {
  for (const vector of VECTORS) {
    it(`${vector.name}: il gesto cominciato sul motore si annulla, e non scrive niente`, { timeout: 60_000 }, async () => {
      let spento = false;
      const fake = createFakeHost({ drawing: replaying(vector, () => spento) });
      const editor = await mount(vector.input, fake, vector.gesture.snap.grid);
      prepare(editor, vector);
      const before = [...editor.selection];
      const pressed = vector.gesture.events.findIndex((event) => event.kind === "down");
      vector.gesture.events.forEach((event, at) => {
        if (at === pressed + 1) spento = true;
        dispatch(editor, event);
      });
      // Gli eventi sono partiti tutti insieme: il motore si è spento dopo che
      // il gesto era cominciato, prima di ogni risposta.
      spento = true;
      await settle(16, 8);
      expect(editor.engine.text).toBe(vector.input);
      expect(sessions!.get(DOC)!.text()).toBe(vector.input);
      expect(editor.canUndo).toBe(false);
      expect(editor.selection).toEqual(before);
      // Il gesto è andato al motore, non agli strumenti semplici.
      expect(fake.atGate("drawingGesture").length).toBeGreaterThan(0);
      expect(motore!.assente()).toEqual({ kind: "assente", perche: "spento" });
    });
  }
});
