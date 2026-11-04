// @vitest-environment happy-dom
//
// **L'albero e i file Craft** (N7, T26), sulla shell vera contro l'host finto:
// le miniature delle righe in vista (`craft.tree-thumbnails`, spenta di
// serie) e gli XMP nascosti (`craft.tree-show-xmp`, acceso di serie).
//
// Le miniature chiedono soltanto `craft.preview`, al più due domande in
// volo, e mai `craft_render`. L'host finto non sa leggere un RAW, un PDF o un
// Word: l'anteprima la dà `box.raw`, come il bundle, e una domanda può
// restare sospesa finché il test la libera. `IntersectionObserver` è un
// finto che dice in vista le righe che `box.visible` sceglie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../host/fake";
import type { SettingEntry } from "../host/contract";
import type { CraftPreview, CraftPreviewImage } from "../host/craft";

vi.setConfig({ testTimeout: 20_000 });

interface Asked {
  readonly doc: string;
  readonly release: () => void;
}

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  raw: null as ((name: string, args: unknown[]) => unknown) | null,
  /// Le righe che il finto `IntersectionObserver` dice in vista.
  visible: (_row: HTMLElement): boolean => true,
  observers: new Set<{ fire: () => void }>(),
}));

let activeStop: (() => void) | null = null;

vi.mock("../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          box.raw?.(name, args) ?? (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
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

vi.mock("../host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

/// Il finto: all'`observe` dice subito se la riga è in vista, e `scroll()`
/// lo ridice per tutte, come uno scorrimento.
class FakeObserver {
  private readonly targets = new Set<HTMLElement>();
  private readonly entry = { fire: () => this.report([...this.targets]) };
  constructor(private readonly callback: IntersectionObserverCallback) {
    box.observers.add(this.entry);
  }
  observe(target: Element): void {
    this.targets.add(target as HTMLElement);
    queueMicrotask(() => {
      if (this.targets.has(target as HTMLElement)) this.report([target as HTMLElement]);
    });
  }
  unobserve(target: Element): void {
    this.targets.delete(target as HTMLElement);
  }
  disconnect(): void {
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  private report(targets: HTMLElement[]): void {
    if (targets.length === 0) return;
    const records = targets.map((target) => ({ target, isIntersecting: target.isConnected && box.visible(target) }));
    this.callback(records as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const { createFakeHost } = await import("../host/fake");
const rawHtml = (await import("../../index.html?raw")).default;

const VECTOR = "Progetti/logo-studio.vectorcraft";
const PCRAFT = "Progetti/copertina.pcraft";
const FIG = "Progetti/nuova-sede-con-un-nome-lunghissimo-che-non-ci-sta-nella-colonna.figcraft";
const DOCX = "Progetti/relazione.docx";
const PDF = "Progetti/contratto-affitto.pdf";
const XLSX = "Progetti/bilancio.xlsx";
const RAW = "Foto/IMG_0412.CR3";
const RAW_PLAIN = "Foto/IMG_0413.CR3";
const XMP = "Foto/IMG_0412.xmp";
const ONLY_XMP = "Solo XMP/IMG_0001.xmp";
const MANY = "Molti";

/// Un PNG di 1×1 che dice soltanto la sua misura.
function png(): CraftPreviewImage {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return { media_type: "image/png", data: btoa(String.fromCharCode(...bytes)), width: 1, height: 1, orientation: 1 };
}

/// Il JPEG di un RAW girato (6).
function jpeg(): CraftPreviewImage {
  const bytes = [0xff, 0xd8, 0xff, 0xd9];
  return { media_type: "image/jpeg", data: btoa(String.fromCharCode(...bytes)), width: 600, height: 400, orientation: 6 };
}

function preview(doc: string, image: CraftPreviewImage | null): CraftPreview {
  return {
    version: 2, doc, revision: null, size: "small", origin: image ? "file" : "none", queued: false, image,
    missing: image ? null : "absent", limit_bytes: null, render: null,
    info: { app: "raw", editor: "LightCraft", format_version: null, bytes: 1024, photo: null, edits: [], xmp: null },
  };
}

function toggle(key: string, value: boolean, fallback: boolean): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "App esterne", scope: "machine", kind: { kind: "toggle", default: fallback }, program_writable: false },
    value,
    source: value === fallback ? "default" : "machine",
  };
}

const BYTES = { bytes: new Uint8Array([0x7b, 0x7d]), mime: "application/octet-stream" };

interface Start {
  thumbs?: boolean;
  showXmp?: boolean;
  /// Le domande restano sospese finché il test non le libera.
  hold?: boolean;
  many?: number;
  component?: boolean;
}

/// Le domande a `craft.preview` arrivate, nell'ordine.
let asked: Asked[] = [];
let inFlight = 0;
let peak = 0;

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function quiet(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await settle();
}

async function waitFor(thing: string, cond: () => boolean, within = 3000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

/// Le immagini delle anteprime: il RAW girato, un disegno, un PDF, un Word.
/// Il RAW senza JPEG e il FigCraft non ne hanno.
function imageOf(doc: string): CraftPreviewImage | null {
  if (doc === RAW) return jpeg();
  if (doc === RAW_PLAIN || doc === FIG) return null;
  return png();
}

async function start(options: Start = {}): Promise<FakeHost> {
  vi.resetModules();
  const many = Object.fromEntries(
    Array.from({ length: options.many ?? 0 }, (_, i) => [`${MANY}/disegno-${String(i).padStart(3, "0")}.vectorcraft`, BYTES]),
  );
  const host: FakeHost = createFakeHost({
    file: { "Affitto di via Roma.md": "# Affitto\n" },
    resources: {
      [VECTOR]: BYTES, [PCRAFT]: BYTES, [FIG]: BYTES, [DOCX]: BYTES, [PDF]: BYTES, [XLSX]: BYTES,
      [RAW]: BYTES, [RAW_PLAIN]: BYTES, [XMP]: BYTES, [ONLY_XMP]: BYTES,
      ...many,
    },
    craft: { docs: {}, ...(options.component === false ? { component: false } : {}) },
    settings: [
      toggle("craft.tree-thumbnails", options.thumbs ?? false, false),
      toggle("craft.tree-show-xmp", options.showXmp ?? true, true),
    ],
  });
  box.host = host;
  box.raw = (name, args) => {
    if (name !== "invokeCommand" || args[0] !== "craft.preview") return undefined;
    const doc = (args[1] as { doc: string }).doc;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    const answer = () => ({ notify: null, effect: { kind: "custom", ns: "fub.craft", payload: preview(doc, imageOf(doc)) }, undo: null, partial: null });
    return new Promise((resolve) => {
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        inFlight -= 1;
        resolve(answer());
      };
      asked.push({ doc, release });
      if (!options.hold) queueMicrotask(release);
    });
  };
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("../main");
  activeStop = await main.startup;
  await quiet();
  return host;
}

const row = (path: string) => document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(path)}"] > .tree-row`);
const thumb = (path: string) => row(path)?.querySelector<HTMLImageElement>(":scope > .row-icon > img.tree-thumb") ?? null;
const askedDocs = () => asked.map((entry) => entry.doc);

async function openFolder(path: string): Promise<void> {
  const folder = row(path);
  if (!folder) throw new Error(`la cartella ${path} non è nell'albero`);
  folder.click();
  await waitFor(`la cartella ${path} aperta`, () => document.querySelector(`#file-list li[data-path="${CSS.escape(path)}"] > ul`) !== null);
  await quiet();
}

/// Libera ogni domanda sospesa finché non ne arrivano più.
async function drain(): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const before = asked.length;
    for (const entry of asked) entry.release();
    await quiet();
    if (asked.length === before) return;
  }
}

function scroll(): void {
  for (const observer of box.observers) observer.fire();
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  box.raw = null;
  box.visible = () => true;
  box.observers.clear();
  asked = [];
  inFlight = 0;
  peak = 0;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("le miniature nell'albero", () => {
  it("spente, l'albero non chiede niente", async () => {
    const host = await start();
    await openFolder("Progetti");
    await openFolder("Foto");
    expect(row(VECTOR)).not.toBeNull();
    expect(asked).toHaveLength(0);
    expect(document.querySelector("#file-list img.tree-thumb")).toBeNull();
    expect(host.atGate("craftRender")).toHaveLength(0);
  });

  it("accese, chiede soltanto le righe in vista, al più due alla volta, e non avvia mai un'app", async () => {
    box.visible = (target) => target.dataset.path !== PCRAFT && target.dataset.path !== XLSX;
    const host = await start({ thumbs: true, hold: true });
    await openFolder("Progetti");
    await waitFor("le prime domande", () => asked.length === 2);
    await quiet();
    expect(asked).toHaveLength(2);
    // Libera le domande in volo a ondate: le altre partono, mai più di due.
    await drain();
    expect(peak).toBeLessThanOrEqual(2);
    expect(new Set(askedDocs())).toEqual(new Set([VECTOR, FIG, DOCX, PDF]));
    // Una riga fuori vista e un foglio di Excel non chiedono niente.
    expect(askedDocs()).not.toContain(PCRAFT);
    expect(askedDocs()).not.toContain(XLSX);
    expect(host.atGate("craftRender")).toHaveLength(0);
    // L'immagine prende il posto dell'icona, senza testo per chi legge.
    const img = thumb(VECTOR);
    expect(img).not.toBeNull();
    expect(img!.alt).toBe("");
    expect(img!.src.startsWith("blob:")).toBe(true);
    expect(row(VECTOR)!.querySelector(":scope > .row-icon > svg")).toBeNull();
    // Il PDF e il Word hanno la loro miniatura.
    expect(thumb(PDF)).not.toBeNull();
    expect(thumb(DOCX)).not.toBeNull();
    // Un file senza anteprima tiene l'icona, senza una casella vuota.
    expect(thumb(FIG)).toBeNull();
    expect(row(FIG)!.querySelector(":scope > .row-icon > svg")).not.toBeNull();
    // Il nome lunghissimo resta dov'era, accanto alla colonna dell'icona.
    expect(row(FIG)!.querySelector(":scope > .row-name")!.textContent).toContain("nome-lunghissimo");
  });

  it("uno scorrimento porta in vista le righe che mancavano, e quelle già dipinte non si richiedono", async () => {
    let shown = new Set([VECTOR]);
    box.visible = (target) => shown.has(target.dataset.path ?? "");
    await start({ thumbs: true });
    await openFolder("Progetti");
    await waitFor("la miniatura in vista", () => thumb(VECTOR) !== null);
    expect(askedDocs()).toEqual([VECTOR]);
    shown = new Set([VECTOR, PCRAFT]);
    scroll();
    await waitFor("la miniatura dopo lo scorrimento", () => thumb(PCRAFT) !== null);
    // Scorrimenti rapidi avanti e indietro: niente domande in più.
    for (let i = 0; i < 5; i += 1) {
      shown = i % 2 ? new Set([VECTOR, PCRAFT]) : new Set();
      scroll();
    }
    await quiet();
    expect(askedDocs()).toEqual([VECTOR, PCRAFT]);
  });

  it("con 500 file in una cartella chiede soltanto quelli in vista", async () => {
    box.visible = (target) => /disegno-00[0-9]\.vectorcraft$/.test(target.dataset.path ?? "");
    const host = await start({ thumbs: true, many: 500 });
    await openFolder(MANY);
    await waitFor("le miniature in vista", () => asked.length === 10);
    await quiet();
    expect(asked).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(2);
    expect(thumb(`${MANY}/disegno-009.vectorcraft`)).not.toBeNull();
    expect(thumb(`${MANY}/disegno-010.vectorcraft`)).toBeNull();
    expect(host.atGate("craftRender")).toHaveLength(0);
  });

  it("una cartella chiusa a metà manda via le domande in coda, e la risposta tardiva non entra", async () => {
    box.visible = (target) => (target.dataset.path ?? "").startsWith(`${MANY}/`);
    await start({ thumbs: true, hold: true, many: 30 });
    await openFolder(MANY);
    await waitFor("le prime due domande", () => asked.length === 2);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const create = vi.spyOn(URL, "createObjectURL");
    // Chiude la cartella con le due domande ancora in volo.
    row(MANY)!.click();
    await waitFor("la cartella chiusa", () => document.querySelector(`#file-list li[data-path="${MANY}"] > ul`) === null);
    await drain();
    // Le altre ventotto non sono mai partite, e le due tardive non hanno
    // fatto un'immagine.
    expect(asked).toHaveLength(2);
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("la miniatura che arriva dopo una rinomina non entra; una riga che lascia l'albero rilascia la sua immagine", async () => {
    const host = await start({ thumbs: true, hold: true });
    await openFolder("Progetti");
    await waitFor("le prime domande", () => asked.length === 2);
    const late = asked.find((entry) => entry.doc === VECTOR) ?? asked[0]!;
    const other = asked.find((entry) => entry !== late)!;
    other.release();
    await waitFor("la prima miniatura", () => thumb(other.doc) !== null);
    const url = thumb(other.doc)!.src;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const create = vi.spyOn(URL, "createObjectURL");
    // Il documento della domanda in volo e quello già dipinto cambiano nome
    // da fuori.
    host.renameFromOutside(late.doc, late.doc.replace("Progetti/", "Progetti/rinominato-"));
    host.renameFromOutside(other.doc, other.doc.replace("Progetti/", "Progetti/rinominato-"));
    await waitFor("le righe sparite", () => row(late.doc) === null && row(other.doc) === null);
    late.release();
    await quiet();
    for (const entry of asked) entry.release();
    await quiet();
    expect(create.mock.calls.length).toBeLessThanOrEqual(asked.length - 2);
    expect(revoke).toHaveBeenCalledWith(url);
    expect(document.querySelector(`#file-list img[src="${url}"]`)).toBeNull();
  });

  it("il RAW girato porta la rotazione sull'immagine, e il browser non la rifà", async () => {
    await start({ thumbs: true });
    await openFolder("Foto");
    await waitFor("la miniatura del RAW", () => thumb(RAW) !== null);
    const img = thumb(RAW)!;
    expect(img.style.transform).toBe("rotate(90deg)");
    expect(img.style.imageOrientation).toBe("none");
    // Il RAW senza JPEG tiene l'icona delle foto.
    await quiet();
    expect(thumb(RAW_PLAIN)).toBeNull();
    expect(row(RAW_PLAIN)!.querySelector(":scope > .row-icon > svg")).not.toBeNull();
  });

  it("spegnerle con l'albero aperto rimette le icone e rilascia le immagini; riaccenderle le ridipinge", async () => {
    const host = await start({ thumbs: true });
    await openFolder("Progetti");
    await waitFor("la miniatura", () => thumb(VECTOR) !== null);
    const url = thumb(VECTOR)!.src;
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await host.module.api.setSetting("craft.tree-thumbnails", false);
    await waitFor("le icone", () => thumb(VECTOR) === null);
    expect(row(VECTOR)!.querySelector(":scope > .row-icon > svg")).not.toBeNull();
    expect(revoke).toHaveBeenCalledWith(url);
    // L'albero resta aperto: niente si è richiuso.
    expect(row(PDF)).not.toBeNull();
    await host.module.api.setSetting("craft.tree-thumbnails", true);
    await waitFor("le miniature di nuovo", () => thumb(VECTOR) !== null);
  });

  it("la chiusura dell'albero rilascia ogni immagine", async () => {
    await start({ thumbs: true });
    await openFolder("Progetti");
    await waitFor("la miniatura", () => thumb(VECTOR) !== null && thumb(PDF) !== null);
    const urls = [...document.querySelectorAll<HTMLImageElement>("#file-list img.tree-thumb")].map((img) => img.src);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    activeStop?.();
    activeStop = null;
    for (const url of urls) expect(revoke).toHaveBeenCalledWith(url);
  });

  it("col componente fub.craft spento non ci sono miniature", async () => {
    const host = await start({ thumbs: true, component: false });
    await openFolder("Progetti");
    await quiet();
    expect(asked).toHaveLength(0);
    expect(document.querySelector("#file-list img.tree-thumb")).toBeNull();
    expect(host.atGate("craftRender")).toHaveLength(0);
  });

  it("il fuoco da tastiera resta sulla riga quando arriva la miniatura", async () => {
    await start({ thumbs: true, hold: true });
    await openFolder("Progetti");
    await waitFor("le prime domande", () => asked.length === 2);
    const target = asked[0]!;
    const li = document.querySelector<HTMLElement>(`#file-list li[data-path="${CSS.escape(target.doc)}"]`)!;
    li.focus();
    target.release();
    await waitFor("la miniatura", () => thumb(target.doc) !== null);
    expect(document.activeElement).toBe(li);
  });
});

describe("l'icona di un RAW", () => {
  it("senza miniature un RAW ha l'icona delle foto, non la graffetta", async () => {
    await start();
    await openFolder("Foto");
    const icon = row(RAW)!.querySelector(":scope > .row-icon")!;
    expect(icon.textContent).not.toContain("📎");
    expect(icon.querySelector("svg")).not.toBeNull();
  });
});

describe("gli XMP nell'albero", () => {
  it("di serie si vedono", async () => {
    await start();
    await openFolder("Foto");
    expect(row(XMP)).not.toBeNull();
  });

  it("nascosti non si disegnano, la cartella che ha solo XMP resta, e la ricerca li trova", async () => {
    await start({ showXmp: false });
    await openFolder("Foto");
    expect(row(XMP)).toBeNull();
    expect(row(RAW)).not.toBeNull();
    expect(row("Solo XMP")).not.toBeNull();
    // Il selettore rapido e il filtro dell'albero cercano fra le voci del
    // vault: l'XMP nascosto c'è ancora.
    const { vaultEntries } = await import("../host/query");
    const entries = await vaultEntries({ offset: 0, limit: 100 });
    expect(entries.items.map((entry) => entry.id)).toContain(XMP);
  });

  it("l'impostazione cambiata con l'albero aperto lo ridisegna senza richiuderlo", async () => {
    const host = await start();
    await openFolder("Foto");
    expect(row(XMP)).not.toBeNull();
    await host.module.api.setSetting("craft.tree-show-xmp", false);
    await waitFor("l'XMP sparito", () => row(XMP) === null);
    expect(row(RAW)).not.toBeNull();
    await host.module.api.setSetting("craft.tree-show-xmp", true);
    await waitFor("l'XMP di nuovo", () => row(XMP) !== null);
  });

  it("col componente fub.craft spento seguono ancora l'impostazione", async () => {
    await start({ showXmp: false, component: false });
    await openFolder("Foto");
    expect(row(XMP)).toBeNull();
    expect(row(RAW)).not.toBeNull();
  });
});
