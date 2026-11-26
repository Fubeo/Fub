// Il Pennello tondo (`blobBrush`, K6 T12 giro 2) dentro l'editor, con l'host finto: un colpo è un comando
// al rilascio, col colore di adesso e i punti; un clic è un tondo; Esc a metà o un cambio di strumento non
// chiamano niente; il motore spento e il rifiuto (livello bloccato) si dicono senza passi; annulla e ripeti
// tornano al byte. Il comportamento è in `docs/product/drawing-pen.md` (Pennello tondo).

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
import { motivoDelRifiuto } from "./rifiuto";
import { ATTESA_APERTURA_MS, motoreDa, type MotoreAperto } from "./gesti";
import { COMANDO_PENNELLO } from "./pennello-tondo";
import { apriSessione } from "./sessione";

const DOC = "disegni/pennello.svg";
const INPUT = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300" width="400" height="300"><rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="300" fill="#ffffff"/><g id="l1a2b3c4d" fub:layer="Livello 1"></g></svg>`;

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

/// Solo i comandi del pennello: il motore riceve anche le letture di stato dello strumento.
const comandi = (fake: FakeHost) =>
  fake
    .atGate("drawingCommand")
    .map((call) => call.args[1] as { id: string; selection: string[]; value: unknown; preview: boolean })
    .filter((request) => request.id === COMANDO_PENNELLO);
const gesti = (fake: FakeHost) => fake.atGate("drawingGesture");

/// Il motore finto: il comando del pennello ha la risposta data; i gesti non ci sono.
function motoreFinto(risposta: (punti: unknown) => DrawingOutcome, extra: Partial<DrawingFake> = {}): DrawingFake {
  return {
    gesto: () => {
      throw new Error("il pennello non manda gesti al motore");
    },
    comando: (request) => (request.id === COMANDO_PENNELLO ? risposta(request.value) : esito([])),
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

/// Un'operazione vera del motore per un colpo: un tracciato pieno nuovo nel livello.
const OPS_COLPO = JSON.stringify([
  {
    op: "add",
    parent: "l1a2b3c4d",
    pos: { last: true },
    elem: { tag: "path", attrs: { d: "M50 45 L120 55 L120 65 L50 55 Z", fill: "#ff0000", id: "oblob0001" } },
  },
]);

const TRATTO: Array<[number, number]> = [
  [40, 60],
  [80, 64],
  [120, 60],
];

describe("il Pennello tondo nell'editor", () => {
  it("un colpo è un solo comando al rilascio, con i punti e il colore di adesso, senza il diametro", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    dispatch(editor, point("down", 40, 60));
    await settle();
    dispatch(editor, point("drag", 80, 64));
    await settle();
    expect(comandi(fake)).toHaveLength(0);
    dispatch(editor, point("drag", 120, 60));
    await settle();
    dispatch(editor, point("up", 120, 60));
    await settle();
    const chiamate = comandi(fake);
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0]!.selection).toEqual([]);
    expect(chiamate[0]!.preview).toBe(false);
    expect(chiamate[0]!.value).toEqual({ points: [[40, 60], [80, 64], [120, 60]], color: "#ff0000" });
    expect(chiamate[0]!.value).not.toHaveProperty("size");
    expect(gesti(fake)).toHaveLength(0);
  });

  it("l'esito con operazioni entra in un solo passo, e annulla e ripeti tornano al byte", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    const prima = editor.engine.text;
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    await drag(editor, TRATTO);
    const dopo = editor.engine.text;
    expect(dopo).toContain("oblob0001");
    expect(editor.canUndo).toBe(true);
    editor.undo();
    await settle();
    expect(editor.engine.text).toBe(prima);
    editor.redo();
    await settle();
    expect(editor.engine.text).toBe(dopo);
  });

  it("un clic fermo è un tondo: un punto solo, un comando", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    await drag(editor, [[40, 60]]);
    const chiamate = comandi(fake);
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0]!.value).toEqual({ points: [[40, 60]], color: "#ff0000" });
  });

  it("due colpi di fila sono due comandi, nell'ordine, col colore di ciascuno", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: "[]" })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    await drag(editor, TRATTO);
    editor.setColor("#0000ff");
    await drag(editor, [[60, 90], [100, 95]]);
    expect(comandi(fake).map((c) => (c.value as { color: string }).color)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("Esc a metà trascinamento non chiama niente", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
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

  it("cambiare strumento a metà colpo non chiama niente", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    dispatch(editor, point("down", 40, 60));
    await settle();
    dispatch(editor, point("drag", 80, 64));
    await settle();
    editor.setTool("rect");
    dispatch(editor, point("up", 120, 60));
    await settle();
    expect(comandi(fake)).toHaveLength(0);
  });

  it("un livello bloccato dice la frase del motore e non fa nessun passo", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { refused: "locked", ops: null })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    const prima = editor.engine.text;
    await drag(editor, TRATTO);
    expect(spoken()).toBe(t("draw.rejected", { reason: t(motivoDelRifiuto("locked")!) }));
    expect(editor.engine.text).toBe(prima);
    expect(editor.canUndo).toBe(false);
  });

  it("col motore spento dice che non risponde e non scrive", async () => {
    let spentoOra = false;
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO }), { spento: () => spentoOra }) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    spentoOra = true;
    await drag(editor, TRATTO);
    await settle(ATTESA_APERTURA_MS, 2);
    expect(spoken()).toBe(t("draw.pennello.assente"));
    expect(editor.canUndo).toBe(false);
  });

  it("un colpo sopra un testo o un gruppo parte come gli altri: il motore decide cosa dipingere", async () => {
    // Il client non guarda che cosa c'è sotto: manda il colpo, e il motore dà il suo esito (Rust, caso
    // «pennello» di `tracciati.json`, per il tondo; il testo e il gruppo sono del motore).
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    await drag(editor, TRATTO);
    expect(comandi(fake)).toHaveLength(1);
  });

  it("su una tela vuota e senza nessuna scelta il colpo parte (il pennello non ha selezione)", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    expect(editor.selection).toEqual([]);
    await drag(editor, TRATTO);
    expect(comandi(fake)[0]!.selection).toEqual([]);
    expect(spoken()).not.toBe(t("draw.gomma_punti.scegli"));
  });

  it("Esc dopo aver scelto lo strumento torna alla selezione: un trascinamento dopo non dipinge", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    surfaceOf().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    await settle();
    await drag(editor, TRATTO);
    expect(comandi(fake)).toHaveLength(0);
  });

  it("cambiare strumento dopo aver scelto il pennello: un trascinamento dopo non dipinge", async () => {
    const fake = createFakeHost({ drawing: motoreFinto(() => esito([], { ops: OPS_COLPO })) });
    const editor = await mount(fake);
    editor.setEngineTool("blobBrush");
    editor.setColor("#ff0000");
    // Il tasto del selettore (`v`), come lo sceglie chi disegna: toglie lo strumento del motore.
    surfaceOf().dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", bubbles: true, cancelable: true }));
    await settle();
    await drag(editor, TRATTO);
    expect(comandi(fake)).toHaveLength(0);
  });
});
