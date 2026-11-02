// @vitest-environment happy-dom
//
// La sessione del motore del disegno contro l'host finto: l'apertura senza
// motore, la copia che segue la `DocumentSession` a revisioni crescenti, il
// `stale` che rimanda il testo intero una volta, la fila, il tempo limite e
// la chiusura.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingGesture, DrawingOutcome, DrawingSync } from "../../../host/contract";
import { createFakeHost, type DrawingFake, type FakeHost } from "../../../host/fake";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../../state/document-session";
import { apriSessione, TEMPO_LIMITE_MS, type GestoMotore, type MotoreAssente, type SessioneMotore } from "./sessione";

const DOC = "disegni/mappa.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect id="r-1" width="10" height="10"/>\n</svg>\n';

const GESTO: GestoMotore = {
  phase: "commit",
  tool: "rect",
  layer: null,
  selection: [],
  zoom: 1,
  snap: { grid: null, free: false },
  style: { stroke: "#000", width: 1, fill: null },
  text: null,
  events: [{ kind: "down", x: 0, y: 0, pressure: 0.5, shift: false, alt: false, cmd: false }],
};

const esito = (revision: string, refused: DrawingOutcome["refused"] = null): DrawingOutcome => ({
  revision,
  preview: null,
  ops: refused === null ? "[]" : null,
  selection: [],
  losses: [],
  refused,
});

let sessions: DocumentSessionCollection | null = null;

afterEach(() => {
  sessions?.closeAll();
  sessions = null;
  vi.useRealTimers();
});

/// Una `DocumentSession` vera sul testo dato, che salva nel vuoto.
async function documento(text: string) {
  const api: DocumentSessionApi = {
    readDocument: async () => ({ text, revision: "rev-1", format_id: "svg", source_kind: "text", text_kind: "source" }),
    writeDocument: async () => "rev-2",
    resourceWrite: async () => ({ revision: "rev-2" }) as never,
    saveDraft: async () => {},
    discardDraft: async () => {},
  };
  sessions = new DocumentSessionCollection(api, () => "/vault");
  await sessions.read(DOC);
  return sessions.get(DOC)!;
}

/// Una modifica fatta da un'altra superficie: `cerca` diventa `con`.
function modifica(cerca: string, con: string): void {
  const session = sessions!.get(DOC)!;
  const before = session.text();
  const lf = before.replace(/\r\n?/g, "\n");
  const from = lf.indexOf(cerca);
  expect(from).toBeGreaterThanOrEqual(0);
  const after = before.replace(cerca, con);
  const result = sessions!.acceptSurfaceChange(DOC, "foglio", {
    text: after,
    operation: {
      beforeLength: lf.length,
      afterLength: lf.length - cerca.length + con.length,
      edits: [{ from, to: from + cerca.length, deleted: cerca, inserted: con }],
    },
  });
  expect(result).toEqual({ kind: "accepted" });
}

/// Aspetta che le promesse in coda girino.
const giro = () => new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => vi.waitFor(() => {}));

async function apri(host: FakeHost, text = SVG): Promise<SessioneMotore> {
  const doc = await documento(text);
  const opened = await apriSessione(host.module.api, DOC, text, doc, { vault: "/vault" });
  expect(opened.kind).toBe("sessione");
  return opened as SessioneMotore;
}

const syncs = (host: FakeHost): DrawingSync[] => host.atGate("drawingSync").map((call) => call.args[1] as DrawingSync);
const gesti = (host: FakeHost): DrawingGesture[] => host.atGate("drawingGesture").map((call) => call.args[1] as DrawingGesture);

describe("apriSessione", () => {
  it("senza il motore (`unserved`) dà il motore spento e non si registra", async () => {
    const host = createFakeHost();
    const doc = await documento(SVG);
    const opened = await apriSessione(host.module.api, DOC, SVG, doc);
    expect(opened).toEqual({ kind: "assente", perche: "spento" } satisfies MotoreAssente);
    expect(host.atGate("openDrawing")).toHaveLength(1);
    modifica('width="10"', 'width="20"');
    await giro();
    expect(host.atGate("drawingSync")).toHaveLength(0);
  });

  it("un errore all'apertura dà il motore in errore", async () => {
    const host = createFakeHost({ drawing: {} });
    host.fault("openDrawing", "il motore è caduto");
    const doc = await documento(SVG);
    expect(await apriSessione(host.module.api, DOC, SVG, doc)).toEqual({ kind: "assente", perche: "errore" });
  });

  it("apre con il vault in coda e tiene ciò che il motore ha detto", async () => {
    const drawing: DrawingFake = {
      open: () => ({
        instance: "d-7",
        revision: "0",
        mapped: 3,
        unmapped: 1,
        losses: [{ element: "g-1", kind: "unmapped", detail: "filter" }],
      }),
    };
    const host = createFakeHost({ drawing });
    const session = await apri(host);
    expect(host.atGate("openDrawing")[0]!.args).toEqual([DOC, SVG, "/vault"]);
    expect(session.instance).toBe("d-7");
    expect([session.mapped, session.unmapped, session.losses]).toEqual([3, 1, [{ element: "g-1", kind: "unmapped", detail: "filter" }]]);
    expect(session.revision()).toBe("0");
    expect(session.stato()).toBe("aperta");
  });

  it("un testo CRLF arriva alla copia LF, e le differenze dopo ci si applicano", async () => {
    const host = createFakeHost({ drawing: {} });
    const crlf = SVG.replace(/\n/g, "\r\n");
    const session = await apri(host, crlf);
    expect(host.drawingCopy(session.instance)!.text).toBe(SVG);
    modifica('height="10"', 'height="30"');
    await vi.waitFor(() => expect(host.drawingCopy(session.instance)!.revision).toBe("1"));
    expect(syncs(host)[0]!.change.kind).toBe("edits");
    expect(host.drawingCopy(session.instance)!.text).toBe(SVG.replace('height="10"', 'height="30"'));
  });

  it("se il documento cambia mentre il motore apre, la copia riceve il testo intero", async () => {
    const host = createFakeHost({ drawing: {} });
    const doc = await documento(SVG);
    const release = host.throttle("openDrawing");
    const pending = apriSessione(host.module.api, DOC, SVG, doc);
    modifica('width="10"', 'width="40"');
    release();
    const session = (await pending) as SessioneMotore;
    await vi.waitFor(() => expect(syncs(host)).toHaveLength(1));
    expect(syncs(host)[0]).toEqual({ revision: "1", change: { kind: "text", value: { text: SVG.replace('width="10"', 'width="40"') } } });
    await vi.waitFor(() => expect(host.drawingCopy(session.instance)!.text).toBe(doc.text()));
  });
});

describe("la copia segue la sessione", () => {
  it("ogni modifica arriva come `edits` con le revisioni 1, 2, 3", async () => {
    const host = createFakeHost({ drawing: {} });
    const session = await apri(host);
    modifica('width="10"', 'width="11"');
    modifica('height="10"', 'height="12"');
    modifica('id="r-1"', 'id="r-2"');
    await vi.waitFor(() => expect(syncs(host)).toHaveLength(3));
    expect(syncs(host).map((sync) => sync.revision)).toEqual(["1", "2", "3"]);
    expect(syncs(host).map((sync) => sync.change.kind)).toEqual(["edits", "edits", "edits"]);
    expect(syncs(host)[0]!.change).toEqual({
      kind: "edits",
      value: {
        edits: [{ from: SVG.indexOf('width="10"'), to: SVG.indexOf('width="10"') + 10, deleted: 'width="10"', inserted: 'width="11"' }],
        length_before: SVG.length,
        length_after: SVG.length,
      },
    });
    await vi.waitFor(() => expect(session.revision()).toBe("3"));
    expect(host.drawingCopy(session.instance)!.text).toBe(sessions!.get(DOC)!.text());
    expect(host.atGate("drawingSync").every((call) => call.args[2] === "/vault")).toBe(true);
  });

  it("due sync di fila mentre il primo è in volo partono uno alla volta, nell'ordine", async () => {
    const host = createFakeHost({ drawing: {} });
    const session = await apri(host);
    const release = host.throttle("drawingSync");
    modifica('width="10"', 'width="11"');
    modifica('width="11"', 'width="12"');
    await giro();
    // Il secondo aspetta che il primo abbia risposto.
    expect(syncs(host)).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(syncs(host)).toHaveLength(2));
    expect(syncs(host).map((sync) => sync.revision)).toEqual(["1", "2"]);
    await vi.waitFor(() => expect(host.drawingCopy(session.instance)!.text).toBe(SVG.replace('width="10"', 'width="12"')));
  });

  it("una sostituzione del testo intero arriva come `text`, ridotto a LF", async () => {
    const host = createFakeHost({ drawing: {} });
    const session = await apri(host);
    const nuovo = SVG.replace("10", "99").replace(/\n/g, "\r\n");
    sessions!.restore(DOC, nuovo, { kind: "descends_from", value: "rev-1" });
    await vi.waitFor(() => expect(syncs(host)).toHaveLength(1));
    expect(syncs(host)[0]).toEqual({ revision: "1", change: { kind: "text", value: { text: nuovo.replace(/\r\n/g, "\n") } } });
    void session;
  });

  it("un gesto parte dopo i sync chiesti prima e porta la loro revisione", async () => {
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision) } });
    const session = await apri(host);
    modifica('width="10"', 'width="11"');
    modifica('width="11"', 'width="12"');
    const outcome = await session.gesto(GESTO);
    expect(outcome).toEqual(esito("2"));
    expect(host.calls.filter((call) => call.gate.startsWith("drawing")).map((call) => call.gate))
      .toEqual(["drawingSync", "drawingSync", "drawingGesture"]);
    expect(gesti(host)[0]).toEqual({ ...GESTO, revision: "2" });
  });
});

describe("`stale`", () => {
  it("porta al testo intero e a un solo nuovo tentativo", async () => {
    let volte = 0;
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision, volte++ === 0 ? "stale" : null) } });
    const session = await apri(host);
    modifica('width="10"', 'width="11"');
    const outcome = await session.gesto(GESTO);
    expect(outcome).toEqual(esito("2"));
    expect(gesti(host).map((gesture) => gesture.revision)).toEqual(["1", "2"]);
    expect(syncs(host)[1]).toEqual({ revision: "2", change: { kind: "text", value: { text: SVG.replace('width="10"', 'width="11"') } } });
  });

  it("due volte di fila: si arrende, e `refused` resta", async () => {
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision, "stale") } });
    const session = await apri(host);
    const outcome = await session.gesto(GESTO);
    expect((outcome as DrawingOutcome).refused).toBe("stale");
    expect(gesti(host)).toHaveLength(2);
    expect(syncs(host)).toEqual([{ revision: "1", change: { kind: "text", value: { text: SVG } } }]);
    expect(session.stato()).toBe("aperta");
  });

  it("vale anche per un comando", async () => {
    let volte = 0;
    const host = createFakeHost({ drawing: { comando: (request) => esito(request.revision, volte++ === 0 ? "stale" : null) } });
    const session = await apri(host);
    const outcome = await session.comando({ id: "disegno.spessore", selection: ["r-1"], value: 3 });
    expect(outcome).toEqual(esito("1"));
    expect(host.atGate("drawingCommand")).toHaveLength(2);
  });
});

describe("la chiusura", () => {
  it("chiusa, la sessione non manda più niente", async () => {
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision) } });
    const session = await apri(host);
    await session.chiudi();
    expect(host.atGate("closeDrawing").map((call) => call.args)).toEqual([[session.instance, "/vault"]]);
    expect(host.drawingCopy(session.instance)).toBeUndefined();
    const before = host.calls.length;
    modifica('width="10"', 'width="11"');
    expect(await session.gesto(GESTO)).toBeNull();
    expect(await session.comandi([])).toBeNull();
    await session.chiudi();
    await giro();
    expect(host.calls.length).toBe(before);
    expect(session.stato()).toBe("chiusa");
  });

  it("chiusa mentre un gesto è in volo: l'esito si scarta e ciò che era in fila non parte", async () => {
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision) } });
    const session = await apri(host);
    const release = host.throttle("drawingGesture");
    const inVolo = session.gesto(GESTO);
    const inFila = session.gesto(GESTO);
    await giro();
    const chiusa = session.chiudi();
    release();
    expect(await inVolo).toBeNull();
    expect(await inFila).toBeNull();
    await chiusa;
    expect(gesti(host)).toHaveLength(1);
    expect(host.atGate("closeDrawing")).toHaveLength(1);
  });

  it("la chiusura della `DocumentSession` chiude anche la sessione del motore", async () => {
    const host = createFakeHost({ drawing: {} });
    const session = await apri(host);
    sessions!.close(DOC);
    await vi.waitFor(() => expect(host.atGate("closeDrawing")).toHaveLength(1));
    expect(session.stato()).toBe("chiusa");
  });
});

describe("il motore che non risponde", () => {
  it("dopo 10 s la richiesta dà il motore in errore, la fila riparte e l'istanza si chiude", async () => {
    vi.useFakeTimers();
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision) } });
    const session = await apri(host);
    host.throttle("drawingGesture");
    const avvisi: MotoreAssente[] = [];
    session.quandoAssente((assente) => avvisi.push(assente));
    const inVolo = session.gesto(GESTO);
    const dopo = session.gesto(GESTO);
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_MS - 1);
    expect(avvisi).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await inVolo).toEqual({ kind: "assente", perche: "errore" });
    expect(await dopo).toEqual({ kind: "assente", perche: "errore" });
    expect(avvisi).toEqual([{ kind: "assente", perche: "errore" }]);
    expect(session.stato()).toEqual({ kind: "assente", perche: "errore" });
    await vi.waitFor(() => expect(host.atGate("closeDrawing")).toHaveLength(1));
    // Fermata, non segue più il documento.
    modifica('width="10"', 'width="11"');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.atGate("drawingSync")).toHaveLength(0);
    expect(gesti(host)).toHaveLength(1);
  });

  it("un'apertura che non risponde dà il motore in errore, e l'istanza arrivata tardi si chiude", async () => {
    vi.useFakeTimers();
    const host = createFakeHost({ drawing: {} });
    const doc = await documento(SVG);
    const release = host.throttle("openDrawing");
    const pending = apriSessione(host.module.api, DOC, SVG, doc);
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_MS);
    expect(await pending).toEqual({ kind: "assente", perche: "errore" });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.atGate("closeDrawing")).toHaveLength(1);
  });

  it("un errore di un sync ferma la sessione", async () => {
    const host = createFakeHost({ drawing: { gesto: (gesture) => esito(gesture.revision) } });
    const session = await apri(host);
    host.fault("drawingSync");
    modifica('width="10"', 'width="11"');
    await vi.waitFor(() => expect(session.stato()).toEqual({ kind: "assente", perche: "errore" }));
    expect(await session.gesto(GESTO)).toEqual({ kind: "assente", perche: "errore" });
    expect(gesti(host)).toHaveLength(0);
  });
});
