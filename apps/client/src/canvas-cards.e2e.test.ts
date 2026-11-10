// @vitest-environment happy-dom
//
// **Le schede della lavagna sulla shell vera** (N6 T12): i renderer delle
// schede arrivano alla tela con le porte della shell. Il cablaggio è quello
// di `drawing.e2e.test.ts` — `main.ts` sulla scocca vera, contro l'host finto
// — con il registro vero.
//
// Quali schede sono vive lo decide la tela (T13): inquadrate, le schede in
// vista si accendono da sole, e la prova non chiama `setMode`. Il registro è
// avvolto solo per tenere le viste montate, i renderer restano quelli veri.
//
// **Il cancello di N6, la prova del file (T21)**: un `.xlsx` trascinato dal
// sistema sulla lavagna va nella cartella che dice `canvas.drop_folder`, nasce
// una scheda di foglio, e una penna ci scrive sopra. Poi la shell si chiude e
// si riapre il vault com'è sul disco: il foglio, il tratto e il file con gli
// stessi byte sono al loro posto, e nel vault non si scrive altro. Un secondo
// rilascio dello stesso file, anche dopo averlo rinominato nel vault, non ne
// copia un altro («Già nel vault»). Tutto sul vault finto: nessuna cartella
// vera. Il foglio non si apre (il finto non ha le celle): la prova conta il
// file, non le celle.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardRegistry, CardRenderer, CardView } from "./editors/canvas/cards";
import type { SettingEntry } from "./host/contract";
import type { FakeHost, FakeResource } from "./host/fake";
import { t } from "./i18n/strings";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Le viste montate dal registro vero, nell'ordine.
  views: [] as { kind: string; view: CardView }[],
  /// Le note rese con `render_embed`.
  embeds: 0,
}));

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

// Il registro vero, avvolto per tenere le viste che monta.
vi.mock("./editors/canvas/cards", async (importOriginal) => {
  const real = await importOriginal<typeof import("./editors/canvas/cards")>();
  const createCardRegistry = (renderers: readonly CardRenderer[]): CardRegistry => {
    const registry = real.createCardRegistry(renderers);
    return {
      rendererFor: (kind) => {
        const renderer = registry.rendererFor(kind);
        if (!renderer) return null;
        return {
          kinds: renderer.kinds,
          mount: (node, host, mode, context) => {
            const view = renderer.mount(node, host, mode, context);
            box.views.push({ kind, view });
            return view;
          },
        };
      },
    };
  };
  return { ...real, createCardRegistry };
});

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const NOTE = "Nota.md";
const PICTURE = "logo.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#336699"/></svg>\n';
const BOARD = JSON.stringify({
  nodes: [
    { id: "nota", type: "file", file: NOTE, x: 0, y: 0, width: 320, height: 240 },
    { id: "logo", type: "file", file: PICTURE, x: 360, y: 0, width: 240, height: 160 },
  ],
  edges: [],
});
const VAULT = {
  [NOTE]: "# Titolo della nota\n\nUn paragrafo.\n",
  [PICTURE]: SVG,
  "lavagna.canvas": BOARD,
};

/// Il `.xlsx` che si trascina: l'intestazione di uno zip e poi byte che non sono
/// UTF-8, così il finto lo tiene binario, come il disco.
const SHEET = "Foglio.xlsx";
const XLSX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0x9a, 0x41, 0x42, 0x43, 0x7f]);
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/// Dove va la copia di un file del computer di serie: `canvas.drop_folder` vale
/// `notes`, cioè la cartella degli allegati delle note (`attachments`).
const COPIED = `attachments/${SHEET}`;

/// Il vault di una prova oltre a `VAULT`: i binari con i loro byte e le
/// impostazioni della macchina. Senza, la prova è quella di sempre.
interface Setup {
  file?: Record<string, string>;
  resources?: Record<string, FakeResource>;
  settings?: SettingEntry[];
}

/// Il renderer del finto non rende le note: `render_embed` risponde qui come
/// il kernel vero, col titolo della nota diventato un `<h1>`.
function renderNotes(host: FakeHost): void {
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => unknown>;
  const query = api.queryIndex.bind(api);
  api.queryIndex = (q: unknown, ...rest: unknown[]) => {
    const asked = q as { kind?: string; page?: string };
    if (asked.kind === "render_embed" && asked.page === NOTE) {
      box.embeds += 1;
      const title = /^# (.*)$/m.exec(host.files()[NOTE] ?? "")?.[1] ?? "";
      return Promise.resolve({ kind: "render_embed", value: { doc_id: NOTE, html: `<h1>${title}</h1>`, parts: [] } });
    }
    return query(q, ...rest);
  };
}

async function start(setup: Setup = {}): Promise<FakeHost> {
  vi.resetModules();
  box.views.length = 0;
  box.embeds = 0;
  const host = createFakeHost({ file: setup.file ?? VAULT, resources: setup.resources, settings: setup.settings });
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

const card = (id: string) => document.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`);

/// Apre la lavagna e la inquadra: la tela accende da sé le schede in vista
/// (T13).
async function openBoard(): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument("lavagna.canvas");
  await settle();
  await waitFor(
    "le schede montano i loro renderer",
    () => card("nota")?.dataset.cardKind === "note" && card("logo")?.dataset.cardKind === "image",
    15_000,
  );
  await fit();
  await waitFor(
    "la tela accende le schede in vista",
    () => card("nota")?.dataset.cardMode === "live" && card("logo")?.dataset.cardMode === "live",
  );
}

/// Inquadra tutta la lavagna, come il pulsante «Adatta».
async function fit(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('[data-canvas-action="fit"]');
  expect(button).not.toBeNull();
  button!.click();
  await settle();
}

afterEach(() => {
  activeStop?.();
  activeStop = null;
});

/// Il `.canvas` come l'app lo legge: le schede, con il loro tratto.
interface BoardNode {
  id: string;
  type: string;
  file?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  "fub:ink"?: { strokes?: unknown[] };
}

const boardOf = (host: FakeHost): { nodes: BoardNode[] } =>
  JSON.parse(host.files()["lavagna.canvas"]!) as { nodes: BoardNode[] };
const sheetsOf = (host: FakeHost): BoardNode[] =>
  boardOf(host).nodes.filter((node) => node.file?.endsWith(".xlsx") === true);
const inkOf = (host: FakeHost, id: string): number =>
  boardOf(host).nodes.find((node) => node.id === id)?.["fub:ink"]?.strokes?.length ?? 0;
const xlsxFiles = (host: FakeHost): string[] => Object.keys(host.files()).filter((id) => id.endsWith(".xlsx"));

/// Le scritture che toccano i file dell'utente, per gate e percorso, senza
/// doppioni e in ordine: una scrittura in più si vede nel confronto. Le bozze no:
/// sono il buffer di crash in `.fub/drafts`, che la shell scrive prima del
/// salvataggio e butta dopo (`draftsSettled`).
const VAULT_WRITES: ReadonlySet<string> = new Set(["writeDocument", "resourceWrite", "invokeCommand"]);
function vaultWrites(host: FakeHost): string[] {
  const seen = host.calls
    .filter((call) => VAULT_WRITES.has(call.gate))
    .map((call) => `${call.gate}:${String(call.args[0])}`);
  return [...new Set(seen)].sort();
}

/// Il buffer di crash è pulito: dopo l'ultimo salvataggio la bozza è stata
/// buttata, e non ne resta una. Vero anche senza alcun salvataggio.
function draftsSettled(host: FakeHost): boolean {
  const last = (gate: string): number => host.calls.map((call) => call.gate).lastIndexOf(gate);
  const saved = last("saveDraft");
  return saved === -1 || last("discardDraft") > saved;
}

/// I byte di un file del vault come li legge l'app: un lease, a fette.
async function bytesOf(host: FakeHost, id: string): Promise<Uint8Array> {
  const api = host.module.api;
  const lease = await api.resourceOpen(id);
  try {
    return new Uint8Array(await api.resourceReadChunk(lease.handle, 0, lease.len));
  } finally {
    await api.resourceClose(lease.handle);
  }
}

const toasts = (): string[] => [...document.querySelectorAll(".toast")].map((each) => each.textContent ?? "");
const reusedNotice = (path: string): string => t("canvas.intake.reused.path", { path });

/// Il `File` del `.xlsx`: ogni rilascio ne ha uno suo, con gli stessi byte.
const sheetFile = (): File => new File([XLSX], SHEET, { type: XLSX_TYPE });

/// La camera della lavagna, letta dalla trasformazione dello stage (come in
/// `engine-ink.test.ts`).
function camera(): { x: number; y: number; zoom: number } {
  const transform = document.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)/.exec(transform);
  if (!match) throw new Error(`trasformazione inattesa: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/// Il punto dello schermo di un punto del mondo della lavagna, con la camera di
/// adesso.
function at([x, y]: readonly [number, number]): { clientX: number; clientY: number } {
  const cam = camera();
  return { clientX: x * cam.zoom + cam.x, clientY: y * cam.zoom + cam.y };
}

/// Un rilascio di file dal sistema sulla vista della lavagna, nel punto `world`.
/// Il `DataTransfer` porta solo i `File`, come in `engine.test.ts`: nessuna voce
/// dell'albero, nessun testo.
function drop(files: File[], world: readonly [number, number]): void {
  const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;
  const { clientX, clientY } = at(world);
  const event = new DragEvent("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { files, items: [], types: ["Files"], getData: () => "" } },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  viewport.dispatchEvent(event);
}

type Init = PointerEventInit & { readonly timeStamp?: number };
const PEN = { pointerId: 7, pointerType: "pen", isPrimary: true } as const;
let clock = 100;

/// Un evento della penna finta, come in `engine-ink.test.ts`: il tempo avanza a
/// ogni evento.
function penEvent(type: string, init: Init): PointerEvent {
  const { timeStamp, ...rest } = init;
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...PEN, ...rest });
  Object.defineProperty(event, "timeStamp", { value: timeStamp ?? (clock += 8) });
  return event;
}

/// Un tratto della penna finta sopra la scheda `id`, con i punti nel mondo della
/// lavagna: giù e i movimenti sulla scheda, su sul documento.
function penOver(id: string, world: readonly (readonly [number, number])[]): void {
  const target = card(id)!;
  target.dispatchEvent(penEvent("pointerdown", { ...at(world[0]!), button: 0, buttons: 1, pressure: 0.5 }));
  for (const point of world.slice(1)) {
    target.dispatchEvent(penEvent("pointermove", { ...at(point), button: -1, buttons: 1, pressure: 0.5 }));
  }
  document.dispatchEvent(penEvent("pointerup", { ...at(world[world.length - 1]!), button: 0, buttons: 0, pressure: 0 }));
}

/// Un'impostazione della lavagna come la dà la macchina.
function canvasSetting(key: string, value: string, kind: SettingEntry["spec"]["kind"]): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "Lavagna", scope: "machine", kind, program_writable: false },
    value,
    source: "machine",
  } as SettingEntry;
}

/// «Dove vanno i file trascinati»: la cartella scelta, `Materiali`.
const DROP_FOLDER = canvasSetting("canvas.drop_folder", "folder", {
  kind: "choice",
  default: "notes",
  options: [
    { value: "notes", label: "Cartella degli allegati" },
    { value: "board", label: "Accanto alla lavagna" },
    { value: "folder", label: "Una cartella del vault" },
  ],
});
const DROP_FOLDER_PATH = canvasSetting("canvas.drop_folder_path", "Materiali", { kind: "text", default: "Allegati" });

describe("le schede della lavagna nella shell", () => {
  it("la nota mostra il suo titolo reso e l'immagine il suo disegno", async () => {
    await start();
    await openBoard();

    await waitFor("la nota è resa", () => card("nota")?.querySelector("h1")?.textContent === "Titolo della nota");
    expect(card("nota")?.querySelector('[data-card-state="content"]')).not.toBeNull();
    await waitFor("l'immagine c'è", () => card("logo")?.querySelector("img, canvas") !== null);
    expect(box.views.map((entry) => entry.kind).sort()).toEqual(["image", "note"]);
    // Le schede leggono e basta: la lavagna e i file restano com'erano.
    expect(box.host!.files()["lavagna.canvas"]).toBe(BOARD);
    expect(box.host!.files()[NOTE]).toBe(VAULT[NOTE]);
  });

  it("la nota cambiata da fuori si rifà; un file che nessuna scheda mostra non tocca niente", async () => {
    const host = await start();
    await openBoard();
    await waitFor("la nota è resa", () => card("nota")?.querySelector("h1")?.textContent === "Titolo della nota");

    const before = box.embeds;
    host.writeFromOutside("Altro.md", "# Altro\n");
    await settle(12);
    expect(box.embeds).toBe(before);

    host.writeFromOutside(NOTE, "# Titolo cambiato\n");
    await waitFor("la nota si rifà", () => card("nota")?.querySelector("h1")?.textContent === "Titolo cambiato");
  });
});

describe("il cancello di N6: un file dal sistema sulla lavagna", () => {
  it("un .xlsx va nella cartella degli allegati, nasce un foglio, la penna ci scrive; riaperta la shell è tutto com'era, con gli stessi byte", async () => {
    const host = await start();
    await openBoard();

    drop([sheetFile()], [700, 0]);
    await waitFor("il file è copiato nel vault", () => host.atGate("resourceWrite").length === 1);
    // Un file nuovo: nessuna revisione attesa, e i byte del `File` trascinato.
    expect(host.atGate("resourceWrite")[0]!.args.slice(0, 3)).toEqual([COPIED, XLSX, null]);

    await waitFor("nasce la scheda di foglio", () => sheetsOf(host).length === 1);
    const [sheet] = sheetsOf(host);
    expect(sheet!.file).toBe(COPIED);
    await fit();
    await waitFor("la scheda di foglio si monta", () => card(sheet!.id)?.dataset.cardKind === "sheet");

    // Una penna sulla scheda: il tratto è suo, e va nel `.canvas`.
    const { x, y } = sheet!;
    penOver(sheet!.id, [[x + 40, y + 40], [x + 90, y + 50], [x + 150, y + 60]]);
    await waitFor("il tratto è nel `.canvas`", () => inkOf(host, sheet!.id) === 1);
    await waitFor("il tratto si vede sulla scheda", () => card(sheet!.id)?.querySelector(".canvas-ink-card path") !== null);
    await waitFor("la bozza è buttata dopo il salvataggio", () => draftsSettled(host));
    expect(vaultWrites(host)).toEqual(["resourceWrite:attachments/Foglio.xlsx", "writeDocument:lavagna.canvas"]);

    // Si chiude la shell e si riapre un vault nuovo, copia di quello che c'è sul
    // disco: i testi com'erano, e il `.xlsx` con i byte che il finto ha scritto.
    const before = host.files()["lavagna.canvas"]!;
    const disk: Record<string, string> = { ...host.files() };
    delete disk[COPIED];
    const bytes = await bytesOf(host, COPIED);
    activeStop?.();
    activeStop = null;
    const again = await start({ file: disk, resources: { [COPIED]: { bytes } } });
    await openBoard();
    await waitFor("la scheda di foglio torna", () => card(sheet!.id)?.dataset.cardKind === "sheet");
    await waitFor("il tratto torna sulla scheda", () => card(sheet!.id)?.querySelector(".canvas-ink-card path") !== null);
    expect(again.files()["lavagna.canvas"]).toBe(before);
    expect(sheetsOf(again).map((node) => node.file)).toEqual([COPIED]);
    expect(await bytesOf(again, COPIED)).toEqual(XLSX);
    // Aprire non scrive: nel vault riaperto non parte nessuna scrittura.
    expect(vaultWrites(again)).toEqual([]);
  });

  it("lo stesso file, rilasciato ancora o rinominato nel vault, non si copia: «Già nel vault»", async () => {
    const host = await start();
    await openBoard();

    drop([sheetFile()], [700, 0]);
    await waitFor("la prima copia è nel vault", () => host.atGate("resourceWrite").length === 1);
    await waitFor("la prima scheda c'è", () => sheetsOf(host).length === 1);

    drop([sheetFile()], [1300, 0]);
    await waitFor("il secondo rilascio chiede il riuso", () => host.atGate("resourceWrite").length === 2);
    expect(host.atGate("resourceWrite")[1]!.args[4]).toEqual({ reuse: "same-content" });
    await waitFor("la notifica dice dov'è il file", () => toasts().some((text) => text.includes(reusedNotice(COPIED))));
    await waitFor("la seconda scheda c'è", () => sheetsOf(host).length === 2);
    expect(xlsxFiles(host)).toEqual([COPIED]);
    expect(sheetsOf(host).map((node) => node.file)).toEqual([COPIED, COPIED]);

    // Rinominato nel vault da un altro programma: lo stesso file, con un altro nome.
    host.renameFromOutside(COPIED, "Materiali/Bilancio.xlsx");
    await settle(12);
    drop([sheetFile()], [1900, 0]);
    await waitFor("il terzo rilascio chiede il riuso", () => host.atGate("resourceWrite").length === 3);
    await waitFor("la notifica trova il nome nuovo", () => toasts().some((text) => text.includes(reusedNotice("Materiali/Bilancio.xlsx"))));
    await waitFor("la terza scheda c'è", () => sheetsOf(host).length === 3);
    expect(xlsxFiles(host)).toEqual(["Materiali/Bilancio.xlsx"]);
    expect(sheetsOf(host).map((node) => node.file)).toEqual([COPIED, COPIED, "Materiali/Bilancio.xlsx"]);
    // Nessuna copia in più: l'unica scrittura nel vault è il primo deposito.
    await waitFor("la bozza è buttata dopo il salvataggio", () => draftsSettled(host));
    expect(vaultWrites(host)).toEqual(["resourceWrite:attachments/Foglio.xlsx", "writeDocument:lavagna.canvas"]);
  });

  it("il file va dove dice canvas.drop_folder, non negli allegati delle note", async () => {
    const host = await start({ settings: [DROP_FOLDER, DROP_FOLDER_PATH] });
    await openBoard();

    drop([sheetFile()], [700, 0]);
    await waitFor("la copia è nel vault", () => host.atGate("resourceWrite").length === 1);
    expect(host.atGate("resourceWrite")[0]!.args[0]).toBe("Materiali/Foglio.xlsx");
    await waitFor("la scheda c'è", () => sheetsOf(host).length === 1);
    expect(sheetsOf(host)[0]!.file).toBe("Materiali/Foglio.xlsx");
    expect(xlsxFiles(host)).toEqual(["Materiali/Foglio.xlsx"]);
  });
});
