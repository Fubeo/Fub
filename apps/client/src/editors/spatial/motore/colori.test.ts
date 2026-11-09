// @vitest-environment happy-dom
//
// I colori e lo spessore sul motore (`colori.ts`), contro l'host finto: con
// il motore acceso un campo del pannello cambiato con una selezione manda il
// comando giusto e applica l'esito in un passo di annulla; i comandi che il
// motore dice spenti si mostrano disattivati; un rifiuto non cambia niente e
// si dice; con il motore spento il pannello scrive come prima.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAWING_COMMAND_FILL_COLOR,
  DRAWING_COMMAND_STROKE_COLOR,
  DRAWING_COMMAND_WIDTH,
  type DrawingCommandRequest,
  type DrawingOutcome,
} from "../../../host/contract";
import { createFakeHost, type DrawingFake, type FakeHost } from "../../../host/fake";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { t } from "../strings";
import { createDrawEditor, type DrawEditor } from "../tools/editor";
import { LAYER } from "../tools/test-support";
import { COMANDI_DEI_CAMPI, motivoDelRifiuto, valoreDelComando } from "./colori";
import { motoreDa, type MotoreAperto } from "./gesti";
import { apriSessione } from "./sessione";

const DOC = "disegni/colori.svg";
const A = "o1a2b3c4d";
const B = "ob2b2b2b2";
const TWO = doc(
  `${LAYER}<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/><rect id="${B}" x="10" y="20" width="10" height="10" fill="#000000"/></g>`,
);

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
  await motore?.chiudi();
  motore = null;
  sessions?.closeAll();
  sessions = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/// Lascia girare promesse e timer finti.
async function settle(ms = 16, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(ms);
}

/// L'editor su `input` col motore dell'host finto, che porta ogni scrittura
/// alla `DocumentSession`.
async function mount(input: string, fake: FakeHost): Promise<DrawEditor> {
  const api: DocumentSessionApi = {
    readDocument: async () => ({ text: input, revision: "rev-1", format_id: "svg", source_kind: "text", text_kind: "source" }),
    openDocument: async () => ({ text: input, revision: "rev-1", format_id: "svg", source_kind: "text", text_kind: "source" }),
    documentClosed: async () => {},
    writeDocument: async () => "rev-2",
    resourceWrite: async () => ({ revision: "rev-2" }) as never,
    saveDraft: async () => {},
    discardDraft: async () => {},
  };
  sessions = new DocumentSessionCollection(api, () => "/vault");
  await sessions.read(DOC);
  const session = sessions.get(DOC)!;
  motore = motoreDa(apriSessione(fake.module.api, DOC, input, session, { vault: "/vault" }));
  await settle(0, 2);
  return createDrawEditor(host, SceneEngine.open(input), owner, {
    motore,
    onChange: (change) => {
      expect(sessions!.acceptSurfaceChange(DOC, "editor", { text: change.text, operation: change.operation })).toEqual({ kind: "accepted" });
    },
  });
}

const surfaceOf = (): HTMLElement => host.querySelector<HTMLElement>(".draw-surface")!;
const spoken = (): string => (host.querySelector('.draw-editor > .sr-only[role="status"]')?.textContent ?? "").trim();
const property = (id: string): HTMLElement => host.querySelector<HTMLElement>(`.draw-properties .draw-properties-field[data-field="${id}"]`)!;
const propertyInput = (id: string): HTMLInputElement => property(id).querySelector<HTMLInputElement>(".draw-properties-input")!;

function key(name: string, target: HTMLElement = surfaceOf()): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

/// Scrive `text` nel campo e lo fa partire con Invio, come chi lo digita.
function enter(target: HTMLInputElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  key("Enter", target);
}

/// Sceglie `keys` e apre il pannello delle proprietà.
async function choose(editor: DrawEditor, keys: readonly string[]): Promise<void> {
  editor.select([...keys]);
  key("Enter");
  await settle();
}

const requests = (fake: FakeHost): DrawingCommandRequest[] => fake.atGate("drawingCommand").map((call) => call.args[1] as DrawingCommandRequest);

/// L'attributo di ogni comando, per il motore finto che li fa.
const ATTRS: Record<string, string> = {
  [DRAWING_COMMAND_STROKE_COLOR]: "stroke",
  [DRAWING_COMMAND_FILL_COLOR]: "fill",
  [DRAWING_COMMAND_WIDTH]: "stroke-width",
};

/// Il motore finto che fa i comandi con un `set` per ogni oggetto scelto;
/// `enabled` dice quali sono attivi.
function painting(enabled: readonly string[] = Object.values(COMANDI_DEI_CAMPI)): DrawingFake {
  return {
    comandi: () => Object.values(COMANDI_DEI_CAMPI).map((id) => ({ id, enabled: enabled.includes(id) })),
    comando: (request) => {
      const attr = ATTRS[request.id]!;
      const value = request.value === null ? "none" : String(request.value);
      const ops = request.selection.map((id) => ({ op: "set", id, attrs: { [attr]: value } }));
      return { revision: request.revision, preview: null, ops: JSON.stringify(ops), selection: request.selection, losses: [], refused: null } satisfies DrawingOutcome;
    },
  };
}

describe("i colori e lo spessore, col motore acceso", () => {
  it("il colore del tratto manda la richiesta giusta e applica un `set` in un passo", async () => {
    const fake = createFakeHost({ drawing: painting() });
    const editor = await mount(TWO, fake);
    await choose(editor, [A]);
    enter(propertyInput("stroke"), "#E69F00");
    // La scrittura aspetta il motore: niente cambia prima del suo esito.
    expect(editor.engine.text).toBe(TWO);
    await settle();
    expect(requests(fake)).toHaveLength(1);
    expect(requests(fake)[0]).toMatchObject({ id: DRAWING_COMMAND_STROKE_COLOR, selection: [A], value: "#e69f00" });
    expect(editor.engine.text).toContain(`<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#e69f00" stroke-width="2"/>`);
    expect(sessions!.get(DOC)!.text()).toBe(editor.engine.text);
    expect(editor.selection).toEqual([A]);
    expect(propertyInput("stroke").value).toBe("#e69f00");
    // Un passo solo, col nome di oggi.
    expect(editor.canUndo).toBe(true);
    editor.undo();
    expect(editor.engine.text).toBe(TWO);
    expect(editor.canUndo).toBe(false);
    expect(spoken()).toBe(`Annullato: ${t("draw.action.outline_color")}.`);
  });

  it("il riempimento «nessuno» è `null`, lo spessore è in unità della scena", async () => {
    const fake = createFakeHost({ drawing: painting() });
    const editor = await mount(TWO, fake);
    await choose(editor, [B]);
    enter(propertyInput("fill"), "none");
    await settle();
    await choose(editor, [A]);
    enter(propertyInput("strokeWidth"), "4");
    await settle();
    expect(requests(fake).map(({ id, selection, value }) => ({ id, selection, value }))).toEqual([
      { id: DRAWING_COMMAND_FILL_COLOR, selection: [B], value: null },
      { id: DRAWING_COMMAND_WIDTH, selection: [A], value: 4 },
    ]);
    expect(editor.engine.text).toContain(`<rect id="${B}" x="10" y="20" width="10" height="10" fill="none"/>`);
    expect(editor.engine.text).toContain(`<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="4"/>`);
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(TWO);
  });

  it("i comandi che il motore dice spenti: i loro campi sono disattivati", async () => {
    const fake = createFakeHost({ drawing: painting([DRAWING_COMMAND_FILL_COLOR]) });
    const editor = await mount(TWO, fake);
    await choose(editor, [A]);
    expect(fake.atGate("drawingCommands").map((call) => call.args[1])).toEqual([[A]]);
    expect(propertyInput("stroke").readOnly).toBe(true);
    expect(propertyInput("strokeWidth").readOnly).toBe(true);
    expect(propertyInput("fill").readOnly).toBe(false);
    expect(propertyInput("opacity").readOnly).toBe(false);
  });

  it("un oggetto che il motore non sa modificare: niente cambia, e lo si dice", async () => {
    const fake = createFakeHost({
      drawing: {
        ...painting(),
        comando: (request) => ({ revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: "unmapped" }),
      },
    });
    const editor = await mount(TWO, fake);
    await choose(editor, [A]);
    enter(propertyInput("stroke"), "#e69f00");
    await settle();
    expect(requests(fake)).toHaveLength(1);
    expect(editor.engine.text).toBe(TWO);
    expect(editor.canUndo).toBe(false);
    expect(spoken()).toBe(t("draw.rejected", { reason: t("draw.reason.foreign") }));
    expect(propertyInput("stroke").value).toBe("#000000");
  });

  it("la selezione cambiata mentre la richiesta è in volo: l'esito si applica, la selezione resta la nuova", async () => {
    const fake = createFakeHost({ drawing: painting() });
    const editor = await mount(TWO, fake);
    await choose(editor, [A]);
    enter(propertyInput("stroke"), "#e69f00");
    editor.select([B]);
    await settle();
    expect(editor.engine.text).toContain(`<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#e69f00" stroke-width="2"/>`);
    expect(editor.selection).toEqual([B]);
  });

  it("un valore che non è un colore per il motore (il contorno «nessuno») non parte: scrive il pannello", async () => {
    const fake = createFakeHost({ drawing: painting() });
    const editor = await mount(TWO, fake);
    await choose(editor, [A]);
    enter(propertyInput("stroke"), "none");
    await settle();
    expect(requests(fake)).toHaveLength(0);
    expect(editor.canUndo).toBe(true);
  });

  it("un motore che smette di rispondere: il pannello scrive come oggi", async () => {
    const fake = createFakeHost({ drawing: { ...painting(), comando: () => { throw new Error("guasto"); } } });
    const editor = await mount(TWO, fake);
    await choose(editor, [A]);
    enter(propertyInput("fill"), "#e69f00");
    await settle();
    expect(requests(fake)).toHaveLength(1);
    expect(editor.engine.text).toContain(`<rect id="${A}" x="60" y="60" width="20" height="20" fill="#e69f00" stroke="#000000" stroke-width="2"/>`);
    expect(editor.canUndo).toBe(true);
  });
});

describe("i colori e lo spessore, col motore spento", () => {
  it("`styling.ts` scrive come prima, senza chiedere niente al motore", async () => {
    const fake = createFakeHost();
    const editor = await mount(TWO, fake);
    expect(motore!.adesso()).toBeNull();
    await choose(editor, [A]);
    enter(propertyInput("stroke"), "#e69f00");
    // Subito, come oggi: nessuna attesa.
    expect(editor.engine.text).toContain(`<rect id="${A}" x="60" y="60" width="20" height="20" fill="none" stroke="#e69f00" stroke-width="2"/>`);
    enter(propertyInput("strokeWidth"), "4");
    expect(editor.engine.text).toContain('stroke-width="4"');
    expect(propertyInput("stroke").readOnly).toBe(false);
    expect(fake.atGate("drawingCommand")).toHaveLength(0);
    expect(fake.atGate("drawingCommands")).toHaveLength(0);
    editor.undo();
    editor.undo();
    expect(editor.engine.text).toBe(TWO);
  });
});

describe("i pezzi dei colori", () => {
  it("il valore del comando: il colore scritto, `null` per nessun riempimento, lo spessore in unità della scena", () => {
    expect(valoreDelComando("stroke", "#E69F00", "px")).toBe("#e69f00");
    expect(valoreDelComando("fill", "none", "px")).toBeNull();
    expect(valoreDelComando("fill", "#000", "px")).toBe("#000000");
    expect(valoreDelComando("strokeWidth", 4, "px")).toBe(4);
    expect(valoreDelComando("strokeWidth", 3, "mm")).toBe(4);
    // Ciò che non è un colore, o uno spessore, non parte.
    expect(valoreDelComando("stroke", "none", "px")).toBeUndefined();
    expect(valoreDelComando("stroke", "rosso?", "px")).toBeUndefined();
    expect(valoreDelComando("fill", "url(#sw1) #ff0000", "px")).toBeUndefined();
    expect(valoreDelComando("strokeWidth", -1, "px")).toBeUndefined();
    expect(valoreDelComando("strokeWidth", Number.NaN, "px")).toBeUndefined();
  });

  it("i rifiuti a parole: «non cambiava niente» non si dice", () => {
    expect(motivoDelRifiuto("empty")).toBeNull();
    expect(motivoDelRifiuto("unmapped")).toBe("draw.reason.foreign");
    expect(motivoDelRifiuto("too_large")).toBe("draw.reason.limit");
  });
});
