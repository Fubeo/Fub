// @vitest-environment happy-dom
// L'esportazione chiesta da fuori (T79): la presenza si rinnova finché la
// shell è aperta, la richiesta del core salva la nota, la impagina fuori dallo
// schermo coi fogli dello spazio e manda l'elenco a `pdf.write_pages`; un
// errore diventa un avviso, e le richieste vanno una alla volta.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommandOutcome, RenderedDocument } from "../host/contract";
import { printBlocks } from "./paginate/measure";
import type { BlockSource, Scheduler } from "./paginate/slices";
import { LISTEN_COMMAND, loadPipeline, pageListOf, parseRequest, QUEUE_LIMIT, REQUEST_TOPIC, startHeadlessExport, WRITE_COMMAND, type HeadlessDeps } from "./headless";
import { defaultProfile } from "./profile";
import type { measureSheets } from "./probe";

const NOW: Scheduler = {
  now: () => 0,
  soon(task) {
    queueMicrotask(task);
    return () => {};
  },
  idle(task) {
    queueMicrotask(task);
    return () => {};
  },
};

/// Tre paragrafi alti 220 px per pagina A4, più o meno (come nello spazio).
function fakeMeasure(page: HTMLElement): BlockSource {
  const blocks = printBlocks(page);
  return {
    count: blocks.length,
    measure(index) {
      const top = index * 230;
      return { box: { kind: "paragraph", id: `blocco:${index}`, lines: Array.from({ length: 10 }, () => 22) }, top, bottom: top + 220, exact: true };
    },
  };
}

function note(paragraphs: number): RenderedDocument {
  return { html: Array.from({ length: paragraphs }, (_, i) => `<p data-md-from="${i * 10}">Paragrafo ${i + 1}</p>`).join(""), parts: [] } as unknown as RenderedDocument;
}

/// Ogni foglio diventa una pagina con un pezzo che dice quale foglio era.
const fakeSheets: typeof measureSheets = (sheets) => ({
  facce: [],
  pagine: sheets.map((_, index) => ({ pezzi: [{ tipo: "riquadro" as const, x: 0, y: index, w: 1, h: 1, colore: [0, 0, 0, 1] as [number, number, number, number] }] })),
});

const done = (effect: CommandOutcome["effect"] = { kind: "none" } as unknown as CommandOutcome["effect"]): CommandOutcome => ({ notify: null, effect, undo: null }) as unknown as CommandOutcome;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick();
}

function payload(extra: Record<string, unknown> = {}) {
  return { request: "1-1", note: "Relazione.md", target: "Relazione.pdf", replace: false, profile_id: "", profile: { ...defaultProfile(), versione: 1 }, ...extra };
}

interface Harness {
  readonly deps: HeadlessDeps;
  readonly calls: { command: string; args: Record<string, unknown> }[];
  readonly order: string[];
  readonly notices: { message: string; kind: string }[];
  emit(topic: string, value: unknown): void;
  listening(): boolean;
}

function harness(extra: Partial<HeadlessDeps> = {}): Harness {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const order: string[] = [];
  const notices: { message: string; kind: string }[] = [];
  let handler: ((topic: string, value: unknown) => void) | null = null;
  const deps: HeadlessDeps = {
    render: vi.fn(async () => {
      order.push("render");
      return note(8);
    }),
    save: vi.fn(async () => {
      order.push("save");
    }),
    title: (doc) => doc.replace(/\.md$/u, ""),
    invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === WRITE_COMMAND) {
        order.push("write");
        return done({ kind: "custom", ns: "fub.pdf.queued", payload: { job_id: "42", path: args["target"] } });
      }
      return done({ kind: "custom", ns: "fub.pdf.listening", payload: { ttl_ms: 120000, renew_ms: 30000 } });
    }),
    listen: (next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
    notify: (message, kind) => notices.push({ message, kind }),
    scheduler: NOW,
    measure: fakeMeasure,
    measureSheets: fakeSheets,
    waitMs: 10,
    ...extra,
  };
  return {
    deps,
    calls,
    order,
    notices,
    emit: (topic, value) => handler?.(topic, value),
    listening: () => handler !== null,
  };
}

// I pezzi dell'impaginazione si caricano una volta prima delle prove: il
// primo `import()` dinamico, su una macchina carica, non conta nei tempi.
beforeAll(async () => {
  await loadPipeline();
}, 60_000);

afterEach(() => {
  document.querySelectorAll(".print-host, .export-measure, .export-headless").forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("la richiesta del core", () => {
  it("si legge solo se ha nota, destinazione e id", () => {
    expect(parseRequest(payload())?.note).toBe("Relazione.md");
    expect(parseRequest(payload({ replace: true, profile_id: "rivista" }))).toMatchObject({ replace: true, profileId: "rivista" });
    expect(parseRequest(payload({ note: 3 }))).toBeNull();
    expect(parseRequest(payload({ target: "" }))).toBeNull();
    expect(parseRequest(null)).toBeNull();
    expect(parseRequest("testo")).toBeNull();
  });
});

describe("la presenza della shell", () => {
  it("si annuncia subito, si rinnova al ritmo del core e smette allo smontaggio", async () => {
    vi.useFakeTimers();
    const h = harness();
    const stop = startHeadlessExport(h.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls.filter((c) => c.command === LISTEN_COMMAND)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.calls.filter((c) => c.command === LISTEN_COMMAND)).toHaveLength(2);
    stop();
    expect(h.listening()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls.filter((c) => c.command === LISTEN_COMMAND)).toHaveLength(2);
  });

  it("senza il comando nell'elenco del core non si chiama, e si annuncia appena arriva", async () => {
    vi.useFakeTimers();
    let has = false;
    let changed: () => void = () => {};
    const h = harness({ available: () => has, onAvailability: (next) => ((changed = next), () => {}) });
    const stop = startHeadlessExport(h.deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.calls).toEqual([]);
    has = true;
    changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls.filter((c) => c.command === LISTEN_COMMAND)).toHaveLength(1);
    stop();
  });

  it("un core che non ha il comando non disturba: si riprova al giro dopo", async () => {
    vi.useFakeTimers();
    const h = harness({ invoke: vi.fn(async () => Promise.reject(new Error("unknown command"))) });
    const stop = startHeadlessExport(h.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.deps.invoke).toHaveBeenCalledTimes(2);
    expect(h.notices).toEqual([]);
    stop();
  });
});

describe("l'esportazione fuori dallo schermo", () => {
  it("salva la nota, la impagina coi fogli dello spazio e manda l'elenco al core", async () => {
    const queued = vi.fn();
    const h = harness({ queued });
    const stop = startHeadlessExport(h.deps);
    h.emit(REQUEST_TOPIC, payload({ replace: true }));
    await vi.waitFor(() => expect(h.order).toContain("write"), { timeout: 4_000 });
    await settle(5);
    // Prima il salvataggio (le modifiche non salvate entrano), poi la resa.
    expect(h.order.slice(0, 3)).toEqual(["save", "render", "write"]);
    const write = h.calls.find((c) => c.command === WRITE_COMMAND);
    expect(write?.args).toMatchObject({ target: "Relazione.pdf", replace: true, note: "Relazione.md", images: "full", accessible: true, pdfa: false });
    const list = JSON.parse(String(write?.args["pages"]));
    expect(list.versione).toBe(1);
    // Otto paragrafi da tre per pagina: tre pagine, ognuna un foglio intero.
    expect(list.pagine).toHaveLength(3);
    expect(list.larghezza).toBeGreaterThan(700);
    expect(list.titolo).toBe("Relazione");
    expect(queued).toHaveBeenCalledWith("42", expect.objectContaining({ note: "Relazione.md" }));
    // Niente resta nella pagina: né il palco né la resa misurata.
    expect(document.querySelector(".export-headless")).toBeNull();
    expect(document.querySelector(".export-measure")).toBeNull();
    expect(h.notices.map((n) => n.kind)).toEqual(["info"]);
    stop();
  });

  it("il profilo della richiesta decide i fogli: col frontespizio una pagina in più", async () => {
    const h = harness();
    const stop = startHeadlessExport(h.deps);
    const profile = { ...defaultProfile(), frontespizio: { ...defaultProfile().frontespizio, frontespizio: true }, uscita: { ...defaultProfile().uscita, immagini: "alleggerite" } };
    h.emit(REQUEST_TOPIC, payload({ profile }));
    await vi.waitFor(() => expect(h.calls.some((c) => c.command === WRITE_COMMAND)).toBe(true), { timeout: 4_000 });
    const write = h.calls.find((c) => c.command === WRITE_COMMAND);
    expect(write?.args["images"]).toBe("light");
    expect(JSON.parse(String(write?.args["pages"])).pagine.length).toBeGreaterThanOrEqual(3);
    stop();
  });

  it("una nota che non si salva non si esporta, e l'avviso dice quale", async () => {
    const h = harness({ save: vi.fn(async () => Promise.reject(new Error("disco pieno"))) });
    const stop = startHeadlessExport(h.deps);
    h.emit(REQUEST_TOPIC, payload());
    await vi.waitFor(() => expect(h.notices.some((n) => n.kind === "guasto")).toBe(true), { timeout: 4_000 });
    expect(h.calls.some((c) => c.command === WRITE_COMMAND)).toBe(false);
    const failed = h.notices.find((n) => n.kind === "guasto");
    expect(failed?.message).toContain("Relazione");
    expect(failed?.message).toContain("disco pieno");
    stop();
  });

  it("un evento d'altro o una richiesta storta non fanno niente", async () => {
    const h = harness();
    const stop = startHeadlessExport(h.deps);
    h.emit("fub.altro:evento", payload());
    h.emit(REQUEST_TOPIC, { note: "Relazione.md" });
    await settle(10);
    expect(h.deps.save).not.toHaveBeenCalled();
    stop();
  });

  it("le richieste vanno una alla volta, e oltre il limite si rifiutano con un avviso", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saving = 0;
    let most = 0;
    const h = harness({
      save: vi.fn(async () => {
        saving++;
        most = Math.max(most, saving);
        await gate;
        saving--;
      }),
    });
    const stop = startHeadlessExport(h.deps);
    for (let i = 0; i < QUEUE_LIMIT + 2; i++) h.emit(REQUEST_TOPIC, payload({ request: `r${i}` }));
    await settle(5);
    expect(h.notices.filter((n) => n.kind === "guasto")).toHaveLength(2);
    release();
    await vi.waitFor(() => expect(h.calls.filter((c) => c.command === WRITE_COMMAND)).toHaveLength(QUEUE_LIMIT), { timeout: 4_000 });
    expect(most).toBe(1);
    expect(h.calls.filter((c) => c.command === WRITE_COMMAND)).toHaveLength(QUEUE_LIMIT);
    stop();
  });
});

describe("l'elenco delle pagine", () => {
  it("un foglio è una pagina, e i segnalibri oltre l'ultima restano fuori", () => {
    const sheets = [document.createElement("div"), document.createElement("div")];
    const list = pageListOf(sheets, { width: 794, height: 1123, margin: { top: 72, right: 72, bottom: 72, left: 72 } }, {
      title: "Relazione",
      bookmarks: [
        { titolo: "Uno", livello: 1, pagina: 0, y: 100 },
        { titolo: "Fuori", livello: 1, pagina: 5, y: 0 },
      ],
    }, {}, fakeSheets);
    expect(list.pagine).toHaveLength(2);
    expect(list.segnalibri.map((b) => b.titolo)).toEqual(["Uno"]);
    expect(list).toMatchObject({ versione: 1, larghezza: 794, altezza: 1123, titolo: "Relazione", autore: "", lingua: "" });
  });
});
