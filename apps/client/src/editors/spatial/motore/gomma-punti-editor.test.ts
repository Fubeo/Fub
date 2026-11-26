// La Gomma dei punti (`anchorEraserBrush`, K6 T12 giro 2) dentro l'editor, con
// l'host finto: un trascinamento è un comando al rilascio, Esc o uno strumento
// diverso non chiamano niente, un clic senza movimento non chiama, senza
// selezione o col motore spento lo si dice, un rifiuto non scrive, e due
// trascinamenti di fila sono due comandi. Il comportamento è in
// `docs/product/drawing-pen.md` (Gomma dei punti).

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome, DrawingPointer } from "../../../host/contract";
import { createFakeHost, type DrawingFake, type FakeHost } from "../../../host/fake";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { t } from "../strings";
import { toScreen } from "../view";
import { createDrawEditor, type DrawEditor } from "../tools/editor";
import { DEFAULT_GRID } from "../tools/grid";
import { ATTESA_APERTURA_MS, motoreDa, type MotoreAperto } from "./gesti";
import { COMANDO_GOMMA_PUNTI } from "./gomma-punti";
import { apriSessione } from "./sessione";

const DOC = "disegni/gomma.svg";
const PERCORSO = "oc1c1c1c1";
const INPUT = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300"><rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/><g id="l1a2b3c4d" fub:layer="Livello 1"><path id="${PERCORSO}" d="M40 60 L160 60" fill="none" stroke="#000000" stroke-width="2"/></g></svg>`;

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

async function settle(ms = 16, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(ms);
}

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

async function mount(fake: FakeHost): Promise<DrawEditor> {
  const session = await documentOn(INPUT);
  motore = motoreDa(() => apriSessione(fake.module.api, DOC, INPUT, session, { vault: "/vault" }));
  await settle(0, 2);
  return createDrawEditor(host, SceneEngine.open(INPUT), owner, {
    motore: motore!,
    grid: DEFAULT_GRID,
    onChange: (change) => {
      expect(sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation })).toEqual({ kind: "accepted" });
    },
  });
}

const surfaceOf = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();

let clock = 1000;

function dispatch(editor: DrawEditor, event: Pick<DrawingPointer, "kind" | "x" | "y">, type?: string): void {
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
    pressure: 0.5,
    clientX: box.left + sx,
    clientY: box.top + sy,
  });
  Object.defineProperty(pointer, "timeStamp", { value: (clock += 8) });
  target.dispatchEvent(pointer);
}

const point = (kind: DrawingPointer["kind"], x: number, y: number): Pick<DrawingPointer, "kind" | "x" | "y"> => ({ kind, x, y });

/// Un trascinamento da un punto all'altro, coi punti di mezzo, rilasciato.
async function drag(editor: DrawEditor, points: readonly (readonly [number, number])[]): Promise<void> {
  const [first, ...rest] = points;
  dispatch(editor, point("down", first![0], first![1]));
  await settle();
  for (const [x, y] of rest) {
    dispatch(editor, point("drag", x, y));
    await settle();
  }
  const last = points[points.length - 1]!;
  dispatch(editor, point("up", last[0], last[1]));
  await settle();
}

/// Solo i comandi della gomma: il motore riceve anche la lettura dello stato dello
/// strumento (`disegno.strumento.stato`) quando lo si sceglie.
const comandi = (fake: FakeHost) =>
  fake
    .atGate("drawingCommand")
    .map((call) => call.args[1] as { id: string; selection: string[]; value: unknown; preview: boolean })
    .filter((request) => request.id === COMANDO_GOMMA_PUNTI);
const gesti = (fake: FakeHost) => fake.atGate("drawingGesture");

/// Il motore finto della gomma: la risposta del comando, e i gesti che non ci sono.
function motoreFinto(comando: (selection: string[]) => DrawingOutcome, extra: Partial<DrawingFake> = {}): DrawingFake {
  return {
    gesto: () => {
      throw new Error("la gomma dei punti non manda gesti al motore");
    },
    comando: (request) => comando(request.selection),
    ...extra,
  };
}

const esito = (selection: string[], patch: Partial<DrawingOutcome> = {}): DrawingOutcome => ({
  revision: "1",
  preview: null,
  ops: "[]",
  selection,
  losses: [],
  refused: null,
  frame: null,
  ...patch,
});

const TRATTO: Array<[number, number]> = [
  [40, 60],
  [80, 64],
  [120, 60],
];

describe("la Gomma dei punti nell'editor", () => {
  it("un trascinamento su un tracciato scelto è un solo comando, con i punti e la selezione", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    await drag(editor, TRATTO);
    const chiamate = comandi(fake);
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0]!.id).toBe(COMANDO_GOMMA_PUNTI);
    expect(chiamate[0]!.selection).toEqual([PERCORSO]);
    expect(chiamate[0]!.value).toEqual({ points: TRATTO });
    expect(chiamate[0]!.preview).toBe(false);
    expect(gesti(fake)).toHaveLength(0);
  });

  it("l'esito con operazioni entra in un solo passo di annulla", async () => {
    const ops = JSON.stringify([{ op: "set", id: PERCORSO, attrs: { d: "M40 60 L80 60" } }]);
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection, { ops })) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    await drag(editor, TRATTO);
    expect(editor.engine.text).toContain('d="M40 60 L80 60"');
    expect(editor.canUndo).toBe(true);
    expect(spoken()).toContain(t("draw.engine.done"));
  });

  it("Esc a metà trascinamento non chiama niente", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    dispatch(editor, point("down", 40, 60));
    await settle();
    dispatch(editor, point("drag", 80, 64));
    await settle();
    dispatch(editor, point("drag", 120, 60), "pointercancel");
    await settle();
    dispatch(editor, point("up", 120, 60));
    await settle();
    expect(comandi(fake)).toHaveLength(0);
    expect(editor.canUndo).toBe(false);
  });

  it("un clic senza movimento non chiama il motore", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    await drag(editor, [[40, 60]]);
    expect(comandi(fake)).toHaveLength(0);
  });

  it("senza nulla di scelto dice «Scegli un tracciato.» e non chiama", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.setEngineTool("anchorEraserBrush");
    await drag(editor, TRATTO);
    expect(comandi(fake)).toHaveLength(0);
    expect(spoken()).toBe(t("draw.gomma_punti.scegli"));
  });

  it("col motore spento dice che non risponde e non scrive", async () => {
    let spentoOra = false;
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection), { spento: () => spentoOra }) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    spentoOra = true;
    await drag(editor, TRATTO);
    await settle(ATTESA_APERTURA_MS, 2);
    expect(spoken()).toBe(t("draw.gomma_punti.assente"));
    expect(editor.canUndo).toBe(false);
  });

  it("un rifiuto del motore (vuoto) arriva come frase, senza passi", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection, { refused: "empty" })) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    const prima = editor.engine.text;
    await drag(editor, TRATTO);
    expect(spoken()).toBe(t("draw.gomma_punti.vuota"));
    expect(editor.engine.text).toBe(prima);
    expect(editor.canUndo).toBe(false);
  });

  it("due trascinamenti di fila sono due comandi, nell'ordine", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    await drag(editor, TRATTO);
    await drag(editor, [[60, 50], [100, 70]]);
    const chiamate = comandi(fake);
    expect(chiamate.map((c) => c.value)).toEqual([{ points: TRATTO }, { points: [[60, 50], [100, 70]] }]);
  });

  it("cambiare strumento a metà trascinamento non chiama niente", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    dispatch(editor, point("down", 40, 60));
    await settle();
    dispatch(editor, point("drag", 80, 64));
    await settle();
    editor.setTool("rect");
    dispatch(editor, point("up", 120, 60));
    await settle();
    expect(comandi(fake)).toHaveLength(0);
  });

  it("dopo aver cambiato strumento, il tratto non ascolta più la gomma", async () => {
    const fake = createFakeHost({ drawing: motoreFinto((selection) => esito(selection)) });
    const editor = await mount(fake);
    editor.select([PERCORSO]);
    editor.setEngineTool("anchorEraserBrush");
    editor.setEngineTool(null);
    editor.setTool("rect");
    await drag(editor, TRATTO);
    expect(comandi(fake)).toHaveLength(0);
  });
});
