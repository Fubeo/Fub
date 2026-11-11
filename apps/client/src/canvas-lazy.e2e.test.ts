// @vitest-environment happy-dom
//
// **Il pigro alla prova** (N6 T89, A-29): gli otto scenari principali della
// lavagna, tutti insieme, sulla shell vera. Il cablaggio è quello di
// `canvas-cards.e2e.test.ts` — `main.ts` sulla scocca vera, contro l'host
// finto, col registro delle schede vero — senza cartelle vere.
//
// Gli scenari:
//   1. il PDF da scriverci sopra;
//   2. collegare due idee;
//   3. l'idea senza posto;
//   4. non so dove sono;
//   5. la scheda sbagliata;
//   6. la scheda tolta con mezz'ora di testo;
//   7. il salvataggio dimenticato;
//   8. le 40 foto.
//
// happy-dom non dispone niente: le misure che contano (la pagina del PDF
// dentro la sua scheda, la mappa del navigatore) si danno qui, e il resto
// segue il modello della lavagna. pdf.js è finto, come in
// `annotations.e2e.test.ts`: dodici pagine che si rendono senza disegnare, e
// la prova conta la pagina che la scheda dice, non i pixel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost, FakeResource } from "./host/fake";
import { findTextEditorOrThrow } from "./editors/text/test-support";
import { t } from "./i18n/strings";

vi.setConfig({ testTimeout: 60_000 });

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

/// Le pagine del PDF finto: dodici, di 600 × 800 punti.
const PDF_PAGES = 12;

// pdf.js finto, della versione che la shell vuole (come in
// `annotations.e2e.test.ts`), con dodici pagine.
vi.mock("pdfjs-dist/build/pdf.min.mjs", () => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({ items: [] }),
  };
  return {
    version: "6.3.289",
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 12, getPage: async () => page, destroy: async () => {} }),
      destroy: async () => {},
    }),
  };
});

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const BOARD = "lavagna.canvas";
const NOTE = "Mezz'ora.md";
/// Mezz'ora di testo: una nota lunga, scritta prima.
const LONG_NOTE = `# Mezz'ora di testo\n\n${Array.from({ length: 60 }, (_, k) => `Il paragrafo ${k + 1}, scritto con calma e riletto due volte.`).join("\n\n")}\n`;

interface BoardNode {
  id: string;
  type: string;
  text?: string;
  file?: string;
  subpath?: string;
  label?: string;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  "fub:ink"?: { strokes?: Stroke[] };
}
interface BoardEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
}
interface Stroke {
  id: string;
  anchor?: { kind: string; page?: number };
}
interface Board {
  nodes: BoardNode[];
  edges: BoardEdge[];
  "fub:ink"?: { strokes?: Stroke[] };
}

/// Una lavagna con le schede `nodes` e i fili `edges`.
const boardText = (nodes: readonly Partial<BoardNode>[], edges: readonly Partial<BoardEdge>[] = []): string =>
  JSON.stringify({ nodes, edges });

/// Una scheda di testo nel punto dato.
const textCard = (id: string, x: number, y: number, text = id, width = 240, height = 120): Partial<BoardNode> =>
  ({ id, type: "text", text, x, y, width, height });

/// Il vault di una prova: i testi e i binari.
interface Setup {
  file: Record<string, string>;
  resources?: Record<string, FakeResource>;
}

/// Il finto non rende le note: `render_embed` risponde come il kernel vero,
/// col titolo della nota diventato un `<h1>`.
function renderNotes(host: FakeHost): void {
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => unknown>;
  const query = api.queryIndex.bind(api);
  api.queryIndex = (q: unknown, ...rest: unknown[]) => {
    const asked = q as { kind?: string; page?: string };
    if (asked.kind === "render_embed" && typeof asked.page === "string" && asked.page.endsWith(".md")) {
      const title = /^# (.*)$/m.exec(host.files()[asked.page] ?? "")?.[1] ?? "";
      return Promise.resolve({ kind: "render_embed", value: { doc_id: asked.page, html: `<h1>${title}</h1>`, parts: [] } });
    }
    return query(q, ...rest);
  };
}

async function start(setup: Setup): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({ file: setup.file, resources: setup.resources });
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

async function waitFor(thing: string, cond: () => boolean, within = 10_000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

// --- La lavagna sullo schermo -----------------------------------------------

const card = (id: string) => document.querySelector<HTMLElement>(`.canvas-node[data-node="${CSS.escape(id)}"]`);
const viewport = () => document.querySelector<HTMLElement>(".canvas-viewport")!;
const action = (name: string) => document.querySelector<HTMLButtonElement>(`[data-canvas-action="${name}"]`);
const notice = () => document.querySelector<HTMLElement>(".canvas-removal")?.textContent ?? null;

/// Apre la lavagna e la inquadra tutta, come il pulsante «Adatta».
async function openBoard(ready: string[] = []): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(BOARD);
  await waitFor("la lavagna si monta", () => document.querySelector(".canvas-stage") !== null, 15_000);
  await waitFor("le schede ci sono", () => ready.every((id) => card(id) !== null), 15_000);
  await fit();
}

async function fit(): Promise<void> {
  document.querySelector<HTMLButtonElement>('[data-canvas-action="fit"]')!.click();
  await settle();
}

/// La camera della lavagna, letta dalla trasformazione dello stage.
function camera(): { x: number; y: number; zoom: number } {
  const transform = document.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/// Aspetta che la vista smetta di volare, e dà la sua camera ferma.
async function still(): Promise<{ x: number; y: number; zoom: number }> {
  let last = camera();
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setTimeout(r, 25));
    const now = camera();
    if (now.x === last.x && now.y === last.y && now.zoom === last.zoom) return now;
    last = now;
  }
  throw new Error("la vista non si ferma mai");
}

/// Il punto dello schermo di un punto del mondo della lavagna, con la camera di adesso.
function at([x, y]: readonly [number, number]): { clientX: number; clientY: number } {
  const cam = camera();
  return { clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y };
}

let clock = 100;

type Init = PointerEventInit & { readonly timeStamp?: number };

function pointerEvent(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, isPrimary: true, ...rest });
  Object.defineProperty(event, "timeStamp", { value: timeStamp ?? (clock += 8) });
  return event;
}

const PEN = { pointerId: 7, pointerType: "pen" } as const;
const MOUSE = { pointerId: 1, pointerType: "mouse" } as const;

/// Un tratto della penna finta sopra `target`, coi punti nel mondo della
/// lavagna: giù e i movimenti su `target`, su sul documento.
function penOver(target: Element, world: readonly (readonly [number, number])[]): void {
  target.dispatchEvent(pointerEvent("pointerdown", { ...PEN, ...at(world[0]!), button: 0, buttons: 1, pressure: 0.5 }));
  for (const point of world.slice(1)) {
    target.dispatchEvent(pointerEvent("pointermove", { ...PEN, ...at(point), button: -1, buttons: 1, pressure: 0.5 }));
  }
  document.dispatchEvent(pointerEvent("pointerup", { ...PEN, ...at(world[world.length - 1]!), button: 0, buttons: 0, pressure: 0 }));
}

/// Il mouse da `from` (giù), sui punti `world` della lavagna, su sulla vista.
/// `under` è ciò che `elementFromPoint` trova sotto il puntatore.
function mouseDrag(
  from: Element,
  world: readonly (readonly [number, number])[],
  init: PointerEventInit = {},
  under: Element | null = null,
): void {
  const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(under);
  try {
    from.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, ...init, ...at(world[0]!), button: 0, buttons: 1 }));
    for (const point of world.slice(1)) {
      viewport().dispatchEvent(pointerEvent("pointermove", { ...MOUSE, ...init, ...at(point), button: -1, buttons: 1 }));
    }
    viewport().dispatchEvent(pointerEvent("pointerup", { ...MOUSE, ...init, ...at(world[world.length - 1]!), button: 0, buttons: 0 }));
  } finally {
    pointing.mockRestore();
  }
}

/// Un clic del mouse su `target`, nel punto `world` della lavagna.
function click(target: Element, world: readonly [number, number], under: Element | null = target): void {
  mouseDrag(target, [world], {}, under);
}

/// Un tasto premuto su `target`.
function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Un rilascio di file dal sistema sulla vista, nel punto `world`.
function drop(files: File[], world: readonly [number, number]): void {
  const { clientX, clientY } = at(world);
  const event = new DragEvent("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { files, items: [], types: ["Files"], getData: () => "" } },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  viewport().dispatchEvent(event);
}

// --- Il vault --------------------------------------------------------------

const boardOf = (host: FakeHost): Board => JSON.parse(host.files()[BOARD]!) as Board;
const nodeOf = (host: FakeHost, id: string): BoardNode | undefined => boardOf(host).nodes.find((node) => node.id === id);
const strokesOn = (host: FakeHost, id: string | null): Stroke[] =>
  (id === null ? boardOf(host)["fub:ink"] : nodeOf(host, id)?.["fub:ink"])?.strokes ?? [];

/// Il buffer di crash è pulito: dopo l'ultimo salvataggio la bozza è stata
/// buttata, e non ne resta una (come in `canvas-cards.e2e.test.ts`).
function draftsSettled(host: FakeHost): boolean {
  const last = (gate: string): number => host.calls.map((call) => call.gate).lastIndexOf(gate);
  const saved = last("saveDraft");
  return saved === -1 || last("discardDraft") > saved;
}

/// Le scritture della lavagna sul disco, in ordine.
const boardWrites = (host: FakeHost): number =>
  host.atGate("writeDocument").filter((call) => call.args[0] === BOARD).length;

/// Ciò che la banda di stato della shell dice del salvataggio.
const savingBand = (): string => document.getElementById("status-saving")?.textContent ?? "";

/// Il gesto è sul disco: la lavagna è stata scritta, la bozza buttata e la
/// banda dice «Tutto salvato».
async function saved(host: FakeHost, writesBefore: number, what: string): Promise<void> {
  await waitFor(`${what}: la lavagna è scritta`, () => boardWrites(host) > writesBefore);
  await waitFor(`${what}: la bozza è buttata`, () => draftsSettled(host));
  await waitFor(`${what}: la banda dice «Tutto salvato»`, () => savingBand() === t("frame.status.saved"));
}

/// Ciò che la banda dice del salvataggio da adesso, una voce per cambio:
/// `stop` smette di ascoltare e dà le voci.
function bandLog(): () => string[] {
  const band = document.getElementById("status-saving")!;
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const now = band.hidden ? "" : savingBand();
    if (seen[seen.length - 1] !== now) seen.push(now);
  });
  observer.observe(band, { childList: true, characterData: true, subtree: true, attributes: true });
  return () => {
    observer.disconnect();
    return seen;
  };
}

afterEach(() => {
  activeStop?.();
  activeStop = null;
  vi.restoreAllMocks();
});

// --- 1. Il PDF da scriverci sopra -------------------------------------------

/// La pagina del PDF occupa tutta la sua scheda: happy-dom non dispone niente,
/// e la scheda misura la pagina sullo schermo (T19). Le altre misure restano
/// quelle di happy-dom.
function pdfPagesFillTheirCards(host: FakeHost): void {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const article = this.matches(".canvas-card-pdf-page")
      ? this.closest<HTMLElement>(".canvas-node")
      : this.matches(".canvas-node") && this.querySelector(".canvas-card-pdf") ? this as HTMLElement : null;
    const node = article ? nodeOf(host, article.dataset.node!) : undefined;
    if (!node) return original.call(this);
    const { clientX, clientY } = at([node.x, node.y]);
    const zoom = camera().zoom;
    return new DOMRect(clientX, clientY, node.width * zoom, node.height * zoom);
  });
  // La pagina, disegnata fuori dal DOM e poi copiata in vista, ha un
  // contesto, che pdf.js finto non usa; gli altri canvas restano quelli di
  // happy-dom.
  const context = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, ...args: unknown[]) {
    if (this.className === "canvas-card-pdf-page" || (!this.isConnected && this.className === "")) {
      return { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
    }
    return (context as (...a: unknown[]) => RenderingContext | null).apply(this, args);
  } as typeof context);
}

const pdfStatus = (id: string) => card(id)?.querySelector(".canvas-card-pdf-status")?.textContent ?? "";
const inkOnCard = (id: string) => card(id)?.querySelectorAll(".canvas-ink-card path").length ?? 0;

describe("il pigro alla prova (T89)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("1 · il PDF da scriverci sopra: rilasciato, PgGiù fino alla 7, un tratto che c'è solo lì; «Spargi le pagine» 5–9", async () => {
    const host = await start({ file: { [BOARD]: boardText([textCard("appunti", 0, 0, "Appunti")]) } });
    pdfPagesFillTheirCards(host);
    await openBoard(["appunti"]);

    drop([new File([new TextEncoder().encode("%PDF-1.7 finto")], "Bando.pdf", { type: "application/pdf" })], [400, 0]);
    await waitFor("il PDF è copiato nel vault", () => host.atGate("resourceWrite").length === 1);
    await waitFor("nasce la scheda del PDF", () => boardOf(host).nodes.some((node) => node.file?.endsWith(".pdf")));
    const pdf = boardOf(host).nodes.find((node) => node.file?.endsWith(".pdf"))!;
    await fit();
    await waitFor("la scheda del PDF mostra la prima pagina", () => pdfStatus(pdf.id) === t("canvas.card.page", { page: 1, pages: PDF_PAGES }));

    // Scelta, PgGiù sei volte: la pagina 7.
    click(card(pdf.id)!, [pdf.x + 20, pdf.y + 20]);
    for (let page = 2; page <= 7; page += 1) {
      press(viewport(), { key: "PageDown" });
      await waitFor(`la scheda va alla pagina ${page}`, () => pdfStatus(pdf.id) === t("canvas.card.page", { page, pages: PDF_PAGES }));
    }

    // La pagina si disegna dopo che il numero è cambiato: pdf.js finto
    // risponde subito, e un giro basta.
    await settle(12);

    // Un tratto della penna sulla pagina 7: è della pagina 7.
    const writes = boardWrites(host);
    penOver(card(pdf.id)!, [[pdf.x + 60, pdf.y + 80], [pdf.x + 120, pdf.y + 100], [pdf.x + 180, pdf.y + 110]]);
    await saved(host, writes, "il tratto");
    expect(strokesOn(host, pdf.id).map((stroke) => stroke.anchor?.page)).toEqual([7]);
    await waitFor("il tratto si vede sulla pagina 7", () => inkOnCard(pdf.id) === 1);

    // La 8 non ce l'ha; di nuovo la 7 sì.
    press(viewport(), { key: "PageDown" });
    await waitFor("la scheda va alla pagina 8", () => pdfStatus(pdf.id) === t("canvas.card.page", { page: 8, pages: PDF_PAGES }));
    await waitFor("sulla pagina 8 il tratto non c'è", () => inkOnCard(pdf.id) === 0);
    press(viewport(), { key: "PageUp" });
    await waitFor("di nuovo la pagina 7", () => pdfStatus(pdf.id) === t("canvas.card.page", { page: 7, pages: PDF_PAGES }));
    await waitFor("il tratto è di nuovo lì", () => inkOnCard(pdf.id) === 1);

    // «Spargi le pagine…» dal menu della scheda, le pagine 5–9: cinque schede, una per pagina.
    const before = boardWrites(host);
    const menuAt = at([pdf.x + 20, pdf.y + 20]);
    const pointing = vi.spyOn(document, "elementFromPoint").mockReturnValue(card(pdf.id));
    card(pdf.id)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...menuAt }));
    pointing.mockRestore();
    await waitFor("il menu della scheda si apre", () => menuButton(t("canvas_menu.spread_pages")) !== null);
    menuButton(t("canvas_menu.spread_pages"))!.click();
    await waitFor("il dialogo chiede le pagine", () => document.querySelector(".kit-dialog .kit-field-input") !== null);
    const field = document.querySelector<HTMLInputElement>(".kit-dialog .kit-field-input")!;
    field.value = "5-9";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.kit-dialog [data-action="spread"]')!.click();
    await saved(host, before, "le pagine sparse");
    const pages = boardOf(host).nodes.filter((node) => node.file === pdf.file && node.id !== pdf.id);
    expect(pages.map((node) => node.subpath)).toEqual(["#page=5", "#page=6", "#page=7", "#page=8", "#page=9"]);
    // Il PDF di partenza è com'era, col suo tratto; nessun gruppo sotto le cinque.
    expect(strokesOn(host, pdf.id)).toHaveLength(1);
    expect(boardOf(host).nodes.filter((node) => node.type === "group")).toEqual([]);
  });

  it("2 · collegare due idee: Alt+trascina dalla scheda intera; «Collega» e un clic sull'altra", async () => {
    const host = await start({
      file: { [BOARD]: boardText([textCard("prima", 0, 0, "Prima idea"), textCard("seconda", 400, 0, "Seconda idea"), textCard("terza", 0, 300, "Terza idea")]) },
    });
    await openBoard(["prima", "seconda", "terza"]);

    // Alt e si trascina dal corpo della scheda, non da una presa: il filo
    // arriva sull'altra, dove si lascia.
    let writes = boardWrites(host);
    const body = card("prima")!.querySelector(".canvas-card-body") ?? card("prima")!;
    mouseDrag(body, [[120, 60], [300, 60], [520, 60]], { altKey: true }, card("seconda"));
    await saved(host, writes, "il filo tirato con Alt");
    expect(boardOf(host).edges).toEqual([expect.objectContaining({ fromNode: "prima", toNode: "seconda" })]);

    // Scelta «Prima idea», «Collega» nella barra della selezione, poi un clic
    // su «Terza idea»: il filo nasce fra le due.
    click(card("prima")!, [120, 60]);
    const connect = await barButton("canvas.connect");
    expect(connect.getAttribute("aria-disabled")).toBeNull();
    connect.click();
    writes = boardWrites(host);
    click(card("terza")!, [120, 360]);
    await saved(host, writes, "il filo di «Collega»");
    expect(boardOf(host).edges).toEqual([
      expect.objectContaining({ fromNode: "prima", toNode: "seconda" }),
      expect.objectContaining({ fromNode: "prima", toNode: "terza" }),
    ]);
  });

  it("3 · l'idea senza posto: doppio clic nel vuoto, si scrive; Ctrl+Invio sotto, Ctrl+Maiusc+Invio a destra, collegata", async () => {
    const host = await start({ file: { [BOARD]: boardText([textCard("lontana", 0, 0, "Lontana")]) } });
    await openBoard(["lontana"]);

    // Il doppio clic nel vuoto fa nascere una scheda di testo, scelta. Non
    // si apre da sé in scrittura (il caso `it.fails` qui sotto): Invio la apre.
    let writes = boardWrites(host);
    viewport().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, ...at([600, 400]) }));
    await saved(host, writes, "la scheda del doppio clic");
    const born = boardOf(host).nodes.filter((node) => node.id !== "lontana");
    expect(born).toEqual([expect.objectContaining({ type: "text", text: "" })]);
    const idea = born[0]!.id;
    // Invio con la scheda scelta: si scrive, nell'editor delle note in Live.
    press(viewport(), { key: "Enter" });
    const first = await writing(idea);
    first.dispatch({ changes: { from: 0, insert: "Un'idea senza posto" }, userEvent: "input.type" });

    // Ctrl+Invio: registra, e sotto nasce la prossima, già in scrittura.
    writes = boardWrites(host);
    press(first.contentDOM, { key: "Enter", ctrlKey: true });
    await saved(host, writes, "Ctrl+Invio");
    const below = boardOf(host).nodes.find((node) => !["lontana", idea].includes(node.id))!;
    const above = nodeOf(host, idea)!;
    expect(above.text).toBe("Un'idea senza posto");
    expect(below).toMatchObject({ type: "text", x: above.x, width: above.width });
    expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);
    const second = await writing(below.id);
    second.dispatch({ changes: { from: 0, insert: "Quella sotto" }, userEvent: "input.type" });

    // Ctrl+Maiusc+Invio: a destra, collegata con un filo.
    writes = boardWrites(host);
    press(second.contentDOM, { key: "Enter", ctrlKey: true, shiftKey: true });
    await saved(host, writes, "Ctrl+Maiusc+Invio");
    const right = boardOf(host).nodes.find((node) => !["lontana", idea, below.id].includes(node.id))!;
    expect(nodeOf(host, below.id)!.text).toBe("Quella sotto");
    expect(right.type).toBe("text");
    expect(right.x).toBeGreaterThanOrEqual(below.x + below.width);
    expect(boardOf(host).edges).toEqual([
      expect.objectContaining({ fromNode: below.id, toNode: right.id, fromSide: "right", toSide: "left" }),
    ]);
    await writing(right.id);
  });

  // Difetto: il doppio clic del mouse nel vuoto mette la scheda di testo al
  // centro della vista e la lascia solo scelta (`#dblclick` in
  // `editors/canvas/engine.ts` chiama `#addNode("text")` senza il punto e
  // senza `#beginCardEdit`), mentre il doppio tocco del dito (T63), lo
  // strumento Testo e «Scrivi una scheda» la mettono dove si indica, già in
  // scrittura. Quando il doppio clic farà lo stesso, questo caso passa e
  // `it.fails` va tolto.
  it.fails("3 · l'idea senza posto: il doppio clic nel vuoto apre subito la scheda in scrittura", async () => {
    await start({ file: { [BOARD]: boardText([textCard("lontana", 0, 0, "Lontana")]) } });
    await openBoard(["lontana"]);
    viewport().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, ...at([600, 400]) }));
    await waitFor("la scheda nuova scrive", () => document.querySelector(".canvas-node .canvas-text-live .cm-editor, .canvas-node .canvas-text-editor") !== null, 2_000);
  });

  it("4 · non so dove sono: Maiusc+1 mostra tutto, il navigatore porta lì, «Indietro» torna da prima del salto", async () => {
    await start({
      file: { [BOARD]: boardText([textCard("qui", 0, 0, "Qui"), textCard("laggiù", 4000, 3000, "Laggiù")]) },
    });
    await openBoard(["qui", "laggiù"]);
    const all = await still();
    const navigator = document.querySelector<HTMLElement>(".canvas-navigator")!;
    // Tutta la lavagna in vista: il navigatore non serve.
    expect(navigator.hidden).toBe(true);

    // Al 100% la lavagna esce dalla vista, e il navigatore c'è.
    press(viewport(), { key: "0" });
    const near = await still();
    expect(near.zoom).toBeCloseTo(1, 6);
    await waitFor("il navigatore si mostra", () => !navigator.hidden);
    // Maiusc+1: di nuovo tutta la lavagna.
    press(viewport(), { key: "!", code: "Digit1", shiftKey: true });
    expect((await still()).zoom).toBeCloseTo(all.zoom, 6);
    press(viewport(), { key: "0" });
    const before = await still();

    // Un clic sul navigatore porta la vista lì con un salto. La mappa misura
    // 168 × 120 da (0, 0): happy-dom non dispone niente.
    vi.spyOn(navigator, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 168, 120));
    navigator.dispatchEvent(pointerEvent("pointerdown", { ...MOUSE, clientX: 160, clientY: 112, button: 0, buttons: 1 }));
    navigator.dispatchEvent(pointerEvent("pointerup", { ...MOUSE, clientX: 160, clientY: 112, button: 0, buttons: 0 }));
    const there = await still();
    expect(there.zoom).toBeCloseTo(1, 6);
    expect(Math.hypot(there.x - before.x, there.y - before.y)).toBeGreaterThan(1000);

    // «Indietro» (Alt+←, il tasto del riquadro) torna dov'era prima del salto.
    press(viewport(), { key: "ArrowLeft", code: "ArrowLeft", altKey: true });
    const back = await still();
    expect(back.x).toBeCloseTo(before.x, 3);
    expect(back.y).toBeCloseTo(before.y, 3);
    expect(back.zoom).toBeCloseTo(before.zoom, 6);
  });

  it("5 · la scheda sbagliata: il lazo prende il tratto, lo porta sull'altra, «Ora fa parte di…», «Rendilo libero»", async () => {
    const host = await start({
      file: { [BOARD]: boardText([textCard("sbagliata", 0, 0, "Sbagliata", 240, 160), textCard("giusta", 400, 0, "Giusta", 240, 160)]) },
    });
    await openBoard(["sbagliata", "giusta"]);

    // Il tratto finisce sulla scheda sbagliata.
    let writes = boardWrites(host);
    penOver(card("sbagliata")!, [[60, 80], [100, 90], [140, 100]]);
    await saved(host, writes, "il tratto");
    expect(strokesOn(host, "sbagliata")).toHaveLength(1);
    const stroke = strokesOn(host, "sbagliata")[0]!.id;

    // Q, il lazo: un giro attorno al tratto lo sceglie.
    press(viewport(), { key: "q" });
    mouseDrag(viewport(), [[40, 60], [160, 60], [160, 120], [40, 120], [40, 62]]);
    await waitFor("il tratto è scelto", () => document.querySelectorAll(".canvas-lasso-chosen path").length === 1);

    // Trascinato sulla scheda giusta: è suo, e l'avviso lo dice.
    writes = boardWrites(host);
    mouseDrag(viewport(), [[100, 90], [300, 90], [500, 90]]);
    await saved(host, writes, "il tratto portato");
    expect(strokesOn(host, "sbagliata")).toEqual([]);
    expect(strokesOn(host, "giusta").map((one) => one.id)).toEqual([stroke]);
    expect(notice()).toBe(t("canvas.ink.moved_to", { name: "Giusta" }));
    expect(action("free-ink")?.textContent).toBe(t("canvas.ink.make_free"));

    // «Rendilo libero»: il tratto torna della lavagna, dove si vede.
    writes = boardWrites(host);
    action("free-ink")!.click();
    await saved(host, writes, "il tratto liberato");
    expect(strokesOn(host, "giusta")).toEqual([]);
    expect(strokesOn(host, null).map((one) => one.id)).toEqual([stroke]);
    expect(notice()).toBeNull();
  });

  it("6 · la scheda tolta con mezz'ora di testo: Canc, Ctrl+Z, di nuovo Canc e «Annulla»; la nota tolta non riceve scritture", async () => {
    const host = await start({
      file: { [NOTE]: LONG_NOTE, [BOARD]: boardText([{ id: "nota", type: "file", file: NOTE, x: 0, y: 0, width: 400, height: 300 }, textCard("altro", 500, 0)]) },
    });
    await openBoard(["nota", "altro"]);
    await waitFor("la nota è resa", () => card("nota")?.querySelector("h1")?.textContent === "Mezz'ora di testo");
    const noteWrites = (): number => host.atGate("writeDocument").filter((call) => call.args[0] === NOTE).length;

    // Canc con la scheda scelta: via dalla lavagna, il file resta.
    click(card("nota")!.querySelector(".canvas-node-handle")!, [20, 10]);
    let writes = boardWrites(host);
    press(viewport(), { key: "Delete" });
    await saved(host, writes, "la scheda tolta");
    expect(nodeOf(host, "nota")).toBeUndefined();
    expect(notice()).toBe(t("canvas.card.removed"));
    expect(action("undo-removal")?.textContent).toBe(t("app.undo"));

    // Ctrl+Z: torna, al suo posto.
    writes = boardWrites(host);
    press(viewport(), { key: "z", ctrlKey: true });
    await saved(host, writes, "Ctrl+Z");
    expect(nodeOf(host, "nota")).toMatchObject({ file: NOTE, x: 0, y: 0, width: 400, height: 300 });
    await waitFor("la scheda torna sulla lavagna", () => card("nota") !== null);

    // Di nuovo Canc, poi «Annulla» nell'avviso.
    click(card("nota")!.querySelector(".canvas-node-handle")!, [20, 10]);
    writes = boardWrites(host);
    press(viewport(), { key: "Delete" });
    await saved(host, writes, "la scheda tolta di nuovo");
    expect(nodeOf(host, "nota")).toBeUndefined();
    writes = boardWrites(host);
    action("undo-removal")!.click();
    await saved(host, writes, "«Annulla»");
    expect(nodeOf(host, "nota")).toMatchObject({ file: NOTE });
    expect(notice()).toBeNull();

    // La nota non è mai stata scritta, né buttata: ha la sua mezz'ora di testo.
    await settle(12);
    expect(noteWrites()).toBe(0);
    expect(host.files()[NOTE]).toBe(LONG_NOTE);
    expect(host.trash()).toEqual([]);
  });

  it("7 · il salvataggio dimenticato: dopo ogni gesto il .canvas è scritto, e la banda lo dice", async () => {
    const host = await start({
      file: { [BOARD]: boardText([textCard("uno", 0, 0, "Uno"), textCard("due", 400, 0, "Due")]) },
    });
    await openBoard(["uno", "due"]);
    expect(boardWrites(host)).toBe(0);
    await waitFor("la banda dice «Tutto salvato» all'apertura", () => savingBand() === t("frame.status.saved"));

    /// Un gesto, senza salvare niente a mano: la lavagna va sul disco da sé,
    /// e la banda passa da «Da salvare: 1» a «Tutto salvato».
    const gesture = async (what: string, act: () => void): Promise<void> => {
      const writes = boardWrites(host);
      const band = bandLog();
      act();
      await saved(host, writes, what);
      expect(band(), `${what}: la banda`).toEqual([t("frame.status.unsaved", { count: 1 }), t("frame.status.saved")]);
    };

    await gesture("la scheda spostata dalla testata", () =>
      mouseDrag(card("uno")!.querySelector(".canvas-node-handle")!, [[20, 10], [60, 120], [100, 210]]));
    expect(nodeOf(host, "uno")!.y).toBeGreaterThan(100);

    await gesture("un tratto libero nel vuoto", () => penOver(viewport(), [[200, 500], [260, 520], [320, 530]]));
    expect(strokesOn(host, null)).toHaveLength(1);

    await gesture("un filo con Alt", () =>
      mouseDrag(card("due")!.querySelector(".canvas-card-body") ?? card("due")!, [[520, 60], [300, 250]], { altKey: true }, card("uno")));
    expect(boardOf(host).edges).toHaveLength(1);

    click(card("due")!.querySelector(".canvas-node-handle")!, [420, 10]);
    (await barButton("canvas.color_menu")).click();
    await waitFor("il menu dei colori si apre", () => menuButton(t("canvas_menu.color.green")) !== null);
    await gesture("il colore dalla barra della selezione", () => menuButton(t("canvas_menu.color.green"))!.click());
    expect(nodeOf(host, "due")!.color).toBeDefined();

    await gesture("una scheda nuova col doppio clic", () =>
      viewport().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, ...at([900, 600]) })));
    expect(boardOf(host).nodes).toHaveLength(3);
  });

  it("8 · le 40 foto: rilasciate insieme, nel gruppo «40 file»; scelto il gruppo, un trascinamento le sposta tutte", async () => {
    const host = await start({ file: { [BOARD]: boardText([textCard("viaggio", 0, 0, "Il viaggio")]) } });
    await openBoard(["viaggio"]);

    const photos = Array.from({ length: 40 }, (_, k) =>
      new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, k, 0x00, 0x10])], `foto-${String(k + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }));
    let writes = boardWrites(host);
    drop(photos, [400, 0]);
    await waitFor("le 40 foto sono copiate nel vault", () => host.atGate("resourceWrite").length === 40, 30_000);
    await saved(host, writes, "le 40 schede");
    const groups = boardOf(host).nodes.filter((node) => node.type === "group");
    expect(groups.map((group) => group.label)).toEqual([t("canvas.intake.group", { count: "40" })]);
    const group = groups[0]!;
    const cards = (): BoardNode[] => boardOf(host).nodes.filter((node) => node.file?.endsWith(".jpg"));
    expect(cards()).toHaveLength(40);
    const before = new Map(cards().map((node) => [node.id, [node.x, node.y]]));

    // Il gruppo scelto dalla sua testata, e trascinato: le 40 vanno con lui.
    await fit();
    await waitFor("il gruppo c'è", () => card(group.id) !== null);
    const handle = card(group.id)!.querySelector(".canvas-node-handle")!;
    click(handle, [group.x + 10, group.y + 5]);
    writes = boardWrites(host);
    mouseDrag(handle, [[group.x + 10, group.y + 5], [group.x + 210, group.y + 105], [group.x + 410, group.y + 205]]);
    await saved(host, writes, "il gruppo spostato");
    const moved = nodeOf(host, group.id)!;
    const dx = moved.x - group.x;
    const dy = moved.y - group.y;
    expect(dx).toBeGreaterThan(300);
    expect(dy).toBeGreaterThan(100);
    for (const node of cards()) expect([node.x, node.y]).toEqual([before.get(node.id)![0]! + dx, before.get(node.id)![1]! + dy]);
    // La scheda fuori dal gruppo resta dov'era.
    expect(nodeOf(host, "viaggio")).toMatchObject({ x: 0, y: 0 });
  });
});

/// Il pulsante del comando `command` nella barra della selezione, quando c'è.
async function barButton(command: string): Promise<HTMLButtonElement> {
  const find = () => document.querySelector<HTMLButtonElement>(`.canvas-selection-bar:not([hidden]) button[data-command="${command}"]:not([hidden])`);
  await waitFor(`la barra della selezione mostra ${command}`, () => find() !== null);
  return find()!;
}

/// La scheda `id` in scrittura, nell'editor delle note in Live: la sua vista.
async function writing(id: string) {
  await waitFor(`la scheda ${id} scrive`, () => card(id)?.querySelector(".canvas-text-live .cm-editor") != null);
  return findTextEditorOrThrow(card(id)!.querySelector<HTMLElement>(".canvas-text-live")!);
}

/// Il pulsante del menu contestuale col testo `label`.
function menuButton(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")]
    .find((button) => button.textContent?.includes(label)) ?? null;
}
