// @vitest-environment happy-dom
//
// **Scrivere in una scheda di nota sulla shell vera** (N6 T41): la stessa nota
// aperta in un riquadro e su una scheda della lavagna, accanto. Il doppio clic
// sulla scheda monta l'editor Live vero sulla stessa `DocumentSession` del
// riquadro: quello che si scrive da una parte si vede dall'altra senza
// rileggere il disco, e Ctrl+Z nella scheda toglie solo quello che si è
// scritto nella scheda. **E in una scheda di foglio** (T42): lo stesso
// `.xlsx` in un riquadro e su una scheda; il doppio clic su una cella monta
// il foglio vero in modo compatto, e il valore scritto arriva al riquadro e
// al file. Il cablaggio è quello di `canvas-cards.e2e.test.ts` — `main.ts`
// sulla scocca vera, contro l'host finto — senza cartelle vere.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeHost, GridBytesFake } from "./host/fake";
import { findTextEditorOrThrow, mountedTextEditors, undoDepth } from "./editors/text/test-support";
import XLSX from "./__fixtures__/xlsx-grid.json";

vi.setConfig({ testTimeout: 30_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("./host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const NOTE = "Nota.md";
const TEXT = "# Titolo della nota\n\nUn paragrafo.\n";
const BOARD = JSON.stringify({
  nodes: [{ id: "nota", type: "file", file: NOTE, x: 0, y: 0, width: 320, height: 240 }],
  edges: [],
});
const VAULT = { [NOTE]: TEXT, "lavagna.canvas": BOARD };

/// Il finto non rende le note: `render_embed` risponde come il kernel vero,
/// col titolo della nota diventato un `<h1>`.
function renderNotes(host: FakeHost): void {
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => unknown>;
  const query = api.queryIndex.bind(api);
  api.queryIndex = (q: unknown, ...rest: unknown[]) => {
    const asked = q as { kind?: string; page?: string };
    if (asked.kind === "render_embed" && asked.page === NOTE) {
      const title = /^# (.*)$/m.exec(host.files()[NOTE] ?? "")?.[1] ?? "";
      return Promise.resolve({ kind: "render_embed", value: { doc_id: NOTE, html: `<h1>${title}</h1>`, parts: [] } });
    }
    return query(q, ...rest);
  };
}

async function start(options: Parameters<typeof createFakeHost>[0] = { file: VAULT }): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost(options);
  renderNotes(host);
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 5000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

afterEach(() => {
  activeStop?.();
  activeStop = null;
});

const card = () => document.querySelector<HTMLElement>('.canvas-node[data-node="nota"]');
const reads = (host: FakeHost) => host.atGate("openDocument").filter((call) => call.args[0] === NOTE).length;

/// La nota in un riquadro, e accanto la lavagna con la sua scheda accesa.
async function noteBesideBoard(): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(NOTE);
  await waitFor("la nota si apre nel riquadro", () => mountedTextEditors().length === 1, 15_000);
  const { allCommands } = await import("./ui/commands");
  await allCommands().find((entry) => entry.id === "shell.pane.split.right")!.run!();
  await settle();
  await openDocument("lavagna.canvas");
  await waitFor("la scheda della nota monta il suo renderer", () => card()?.dataset.cardKind === "note", 15_000);
  document.querySelector<HTMLButtonElement>('[data-canvas-action="fit"]')!.click();
  await waitFor("la tela accende la scheda", () => card()?.dataset.cardMode === "live");
  await waitFor("la scheda ha la sua resa", () => card()?.querySelector("h1")?.textContent === "Titolo della nota");
  expect(mountedTextEditors(), "a destra la lavagna, a sinistra la nota").toHaveLength(1);
}

/// Il doppio clic sulla scheda: l'editor vero della nota, montato nella scheda.
async function writeInCard() {
  card()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  await waitFor("la scheda scrive", () => card()?.hasAttribute("data-card-editing") === true);
  const views = mountedTextEditors();
  const inCard = views.find((view) => card()!.contains(view.dom));
  const inPane = views.find((view) => !card()!.contains(view.dom));
  expect(inCard, "l'editor della scheda").toBeDefined();
  expect(inPane, "l'editor del riquadro").toBeDefined();
  return { inCard: inCard!, inPane: inPane! };
}

const ctrlZ = () => new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true });

describe("scrivere in una scheda di nota (T41)", () => {
  it("la scheda e il riquadro scrivono la stessa nota, e Ctrl+Z nella scheda è solo della scheda", async () => {
    const host = await start();
    await noteBesideBoard();
    const before = reads(host);
    const { inCard, inPane } = await writeInCard();
    expect(inCard.state.doc.toString()).toBe(TEXT);
    expect(document.querySelector('.canvas-options [data-option="format"] .format-bar'), "la barra nella riga delle opzioni")
      .not.toBeNull();

    // Scritto nella scheda, si vede nel riquadro.
    inCard.dispatch({ changes: { from: inCard.state.doc.length, insert: "Dalla scheda." } });
    await settle();
    expect(inPane.state.doc.toString()).toBe(`${TEXT}Dalla scheda.`);
    // Scritto nel riquadro, si vede nella scheda.
    inPane.dispatch({ changes: { from: 0, insert: "Dal riquadro. " } });
    await settle();
    expect(inCard.state.doc.toString()).toBe(`Dal riquadro. ${TEXT}Dalla scheda.`);
    expect(reads(host), "nessuna rilettura dal disco").toBe(before);

    // Ctrl+Z nella scheda toglie quello della scheda, non quello del riquadro.
    const paneDepth = undoDepth(inPane.state);
    inCard.focus();
    inCard.contentDOM.dispatchEvent(ctrlZ());
    await settle();
    expect(inCard.state.doc.toString()).toBe(`Dal riquadro. ${TEXT}`);
    expect(inPane.state.doc.toString()).toBe(`Dal riquadro. ${TEXT}`);
    expect(undoDepth(inPane.state), "la cronologia del riquadro resta").toBe(paneDepth);
    // E la lavagna non ha annullato niente di suo: la scheda c'è ancora.
    expect(card()).not.toBeNull();

    // Esc esce dalla scrittura e il testo arriva al disco.
    inCard.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    await waitFor("la scheda smette di scrivere", () => card()?.hasAttribute("data-card-editing") === false);
    await waitFor("la scheda torna alla resa", () => card()?.querySelector(".cm-editor") === null);
    await waitFor("il testo arriva al disco", () => host.files()[NOTE] === `Dal riquadro. ${TEXT}`, 10_000);
    expect(mountedTextEditors(), "resta l'editor del riquadro").toEqual([inPane]);
  });
});

// --- Il foglio (T42) ---------------------------------------------------------

const SHEET = "Conti.xlsx";
const SHEET_BOARD = JSON.stringify({
  nodes: [{ id: "foglio", type: "file", file: SHEET, x: 0, y: 0, width: 520, height: 260 }],
  edges: [],
});
/// Il giornale che la cartella delle prove scrive per B2 da 800 a 900: quello
/// del commit registrato dal provider vero (`xlsx-grid.json`).
const JOURNAL_900 = XLSX.edit.commit.edit.inserted;

/// L'host finto con la cartella delle prove e il commit registrato di B2.
async function startWithSheet(): Promise<FakeHost> {
  const host = await start({
    file: { [SHEET]: "", "lavagna.canvas": SHEET_BOARD },
    gridBytes: {
      surface: XLSX.surface,
      session: XLSX.session,
      windows: [...XLSX.windows, XLSX.edit.window],
      commits: [XLSX.edit.commit],
    } as unknown as GridBytesFake,
  });
  return host;
}

/// Il finto è più semplice di un provider vero in due punti, che qui contano:
/// - ogni sessione ha la stessa istanza della fixture, e chiuderne una (la
///   resa della scheda, che si ferma mentre si scrive) chiuderebbe le altre:
///   qui ogni sessione ha un'istanza sua, e il finto chiude quella condivisa
///   soltanto quando le ha chiuse tutte;
/// - apre ogni sessione sulla revisione della fixture, qualunque giornale
///   riceva: sul giornale di B2 = 900 il provider vero darebbe la revisione
///   del suo commit, e con lei la finestra dove B2 vale 900.
function likeAProvider(host: FakeHost): void {
  type Call = (...args: unknown[]) => Promise<unknown>;
  const api = host.module.api as unknown as Record<string, Call>;
  const real = (name: string): Call => api[name]!.bind(api);
  const [open, window, apply, commands, command, close] =
    ["openGridBytes", "gridBytesWindow", "applyGridBytes", "gridBytesCommands", "gridBytesCommand", "closeGridBytes"].map(real);
  const aliases = new Map<string, string>();
  let next = 0;
  const fixtureOf = (instance: unknown): string => aliases.get(String(instance)) ?? String(instance);
  api.openGridBytes = async (surface, doc, journal, base) => {
    const session = await open!(surface, doc, journal, base) as { instance: string; revision: string };
    const instance = `${session.instance}#${++next}`;
    aliases.set(instance, session.instance);
    return { ...session, instance, ...(journal === JOURNAL_900 ? { revision: XLSX.edit.commit.revision } : {}) };
  };
  api.gridBytesWindow = (surface, instance, request) => window!(surface, fixtureOf(instance), request);
  api.applyGridBytes = (surface, instance, request) => apply!(surface, fixtureOf(instance), request);
  api.gridBytesCommands = (surface, instance, selection) => commands!(surface, fixtureOf(instance), selection);
  api.gridBytesCommand = (surface, instance, request) => command!(surface, fixtureOf(instance), request);
  api.closeGridBytes = async (surface, instance) => {
    const shared = fixtureOf(instance);
    if (!aliases.delete(String(instance))) throw { kind: "not_found", message: "la sessione della griglia è chiusa" };
    if (![...aliases.values()].includes(shared)) await close!(surface, shared);
  };
}

const sheetCard = () => document.querySelector<HTMLElement>('.canvas-node[data-node="foglio"]');
const paneGrid = () => [...document.querySelectorAll<HTMLElement>(".grid-surface")].find((grid) => !sheetCard()?.contains(grid)) ?? null;
const cellIn = (root: Element | null | undefined, row: number, column: number) =>
  root?.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`) ?? null;
const cardWriter = () => sheetCard()?.querySelector<HTMLElement>('[data-card-editor="compact"]') ?? null;

describe("scrivere nelle celle di una scheda di foglio (T42)", () => {
  it("un valore scritto nella scheda arriva al riquadro dello stesso foglio e al file salvato", async () => {
    const host = await startWithSheet();
    likeAProvider(host);
    const { openDocument } = await import("./panels/document");
    await openDocument(SHEET);
    await waitFor("il foglio si apre nel riquadro", () => cellIn(paneGrid(), 1, 1)?.textContent === "800", 15_000);
    const { allCommands } = await import("./ui/commands");
    await allCommands().find((entry) => entry.id === "shell.pane.split.right")!.run!();
    await settle();
    await openDocument("lavagna.canvas");
    await waitFor("la scheda del foglio monta il suo renderer", () => sheetCard()?.dataset.cardKind === "sheet", 15_000);
    document.querySelector<HTMLButtonElement>('[data-canvas-action="fit"]')!.click();
    await waitFor("la tela accende la scheda", () => sheetCard()?.dataset.cardMode === "live");
    await waitFor("la scheda mostra le celle", () => cellIn(sheetCard(), 1, 1) !== null, 15_000);

    // Il doppio clic sulla cella B2 della scheda: il foglio vero, compatto, con B2 aperta.
    cellIn(sheetCard(), 1, 1)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await waitFor("la scheda scrive", () => sheetCard()?.hasAttribute("data-card-editing") === true, 15_000);
    await waitFor("B2 si apre", () => cardWriter()?.querySelector<HTMLElement>(".grid-cell-editor")?.hidden === false, 15_000);
    expect(cardWriter()!.querySelector(".grid-ribbon-host")!.childElementCount, "niente nastro nella scheda").toBe(0);
    const formula = document.querySelector<HTMLElement>('.canvas-options [data-option="formula"]');
    expect(formula?.querySelector(".grid-cell-name")?.textContent).toBe("B2");
    expect(formula?.querySelector(".canvas-formula-text")?.textContent).toBe("800");

    const before = host.atGate("openGridBytes").length;
    const editor = findTextEditorOrThrow(cardWriter()!.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "900" }, userEvent: "input" });
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    await waitFor("la scrittura arriva al provider", () => host.atGate("applyGridBytes").length === 1);
    expect((host.atGate("applyGridBytes")[0]!.args[1] as { patches: unknown[] }).patches)
      .toEqual([{ cell: { sheet: "s1", row: "r1", column: "c1" }, before: "800", after: "900" }]);
    await waitFor("la formula segue la cella scesa", () =>
      document.querySelector('.canvas-options [data-option="formula"] .grid-cell-name')?.textContent === "B3");

    // Il riquadro riceve il giornale dalla sessione e riapre la sua griglia
    // su B2 = 900, senza rileggere il disco. (Che cosa mostra dopo dipende
    // dal finto, che al salvataggio non innesta il giornale nei byte.)
    await waitFor("il riquadro riapre col giornale nuovo", () =>
      host.atGate("openGridBytes").slice(before).some((call) => call.args[2] === JOURNAL_900));
    expect(host.atGate("openDocument").filter((call) => call.args[0] === SHEET), "nessuna rilettura dal disco").toHaveLength(1);
    await waitFor("il riquadro mostra 900", () => cellIn(paneGrid(), 1, 1)?.textContent === "900");

    // Il secondo Esc (non c'è una cella aperta) esce dalla scrittura, e il giornale va al file.
    cardWriter()!.querySelector<HTMLElement>(".grid-viewport")!
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
    await waitFor("la scheda smette di scrivere", () => sheetCard()?.hasAttribute("data-card-editing") === false);
    await waitFor("la griglia della scheda si smonta", () => cardWriter() === null);
    await waitFor("il giornale arriva al file", () =>
      host.atGate("writeDocument").some((call) => call.args[0] === SHEET && call.args[1] === JOURNAL_900), 10_000);
  });
});
