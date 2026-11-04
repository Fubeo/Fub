// @vitest-environment happy-dom
//
// **Il gesto passa soltanto alla scheda che nasce** (N7, T23), sulla shell
// vera contro l'host finto. `openDocument(doc, { gesture: true })` porta il
// gesto al montaggio che crea; un'apertura senza gesto (`fub://open`, una
// vista, la scheda riaperta all'avvio), una scheda già aperta che torna in
// primo piano e un rimontaggio non lo portano. Il segno è `craft_render`:
// un file Craft con il consenso acceso la chiama soltanto col gesto.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import type { CraftPreview, CraftPreviewSize } from "./host/craft";

vi.setConfig({ testTimeout: 20_000 });

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

const LOGO = "Disegni/logo.vectorcraft";
const BYTES = { bytes: new Uint8Array([0x7b, 0x7d, 0xff]), mime: "application/octet-stream" };

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 3000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

async function quiet(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await settle();
}

/// La shell vera su un vault con una nota e un file Craft che VectorCraft,
/// col consenso acceso, saprebbe fare.
async function start(layout: unknown = null, file: Record<string, string> = {}): Promise<FakeHost> {
  vi.resetModules();
  const host: FakeHost = createFakeHost({
    file: { "Benvenuto.md": "# Benvenuto\n", ...file },
    resources: { [LOGO]: BYTES },
    craft: { docs: { [LOGO]: { render: { app: "VectorCraft", consent: "on" } } } },
    craftRender: async (doc: string, size: CraftPreviewSize): Promise<CraftPreview> => {
      const outcome = await host.module.api.invokeCommand("craft.preview", { doc, size });
      return { ...(outcome.effect as { payload: CraftPreview }).payload, queued: true };
    },
  });
  box.host = host;
  // Il layout salvato dalla shell di prima: `loadLayout` lo riapre.
  if (layout !== null) await host.module.api.setViewState("layout", layout);
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function open(doc: string, options?: { gesture?: boolean }): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc, options);
  await settle();
}

const renders = (host: FakeHost) => host.atGate("craftRender").length;
const craftTabs = () => document.querySelectorAll(".craft-empty").length;

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("il gesto nella shell", () => {
  it("aperta col gesto: una chiamata; tornarci o riaprirla non chiede di nuovo", async () => {
    const host = await start();
    await open(LOGO, { gesture: true });
    await waitFor("la scheda dice che prepara", () => document.querySelector(".craft-empty-state")?.textContent === "Preparo l'anteprima…");
    await quiet();
    expect(renders(host)).toBe(1);
    // Un'altra scheda e poi di nuovo il file: la scheda si rimonta senza gesto.
    await open("Benvenuto.md", { gesture: true });
    await open(LOGO);
    await waitFor("la scheda torna", () => craftTabs() === 1);
    // La scheda già aperta, di nuovo col gesto: non nasce, e non chiede.
    await open("Benvenuto.md");
    await open(LOGO, { gesture: true });
    await waitFor("la scheda torna", () => craftTabs() === 1);
    await quiet();
    expect(renders(host)).toBe(1);
  });

  it("aperta senza gesto (fub://open, una vista): zero chiamate, e il pulsante", async () => {
    const host = await start();
    await open(LOGO);
    await waitFor("il pulsante", () => document.querySelector(".craft-render") !== null);
    await quiet();
    expect(renders(host)).toBe(0);
  });

  it("la scheda riaperta all'avvio non chiede", async () => {
    const first = await start();
    await open(LOGO, { gesture: true });
    await waitFor("la prima scheda chiede", () => renders(first) === 1);
    await quiet();
    // Il layout salvato resta: la shell rimontata riapre la scheda da sola.
    const saved = await first.module.api.viewState<unknown>("layout");
    expect(JSON.stringify(saved)).toContain(LOGO);
    activeStop?.();
    activeStop = null;
    document.body.innerHTML = "";
    const again = await start(saved);
    await waitFor("la scheda riaperta", () => craftTabs() === 1 || document.querySelector(".craft-render") !== null);
    await quiet();
    expect(document.querySelector(".craft-render")).not.toBeNull();
    expect(renders(again)).toBe(0);
  });
});

/// La nota che mostra il file Craft come figura. Il renderer del fake non
/// conosce i segnaposto del provider Craft: `render_embed` risponde qui come
/// il kernel vero, col segnaposto che la nota trasforma nella figura.
const NOTA = "Nota.md";
const FIGURE = `<figure class="fub-craft" data-embed-kind="craft" data-embed-doc="${LOGO}" data-craft-app="vectorcraft">`
  + "<figcaption>logo.vectorcraft</figcaption></figure>";

async function withFigure(): Promise<FakeHost> {
  const host = await start(null, { [NOTA]: "# Nota\n\n![[logo.vectorcraft]]\n" });
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => unknown>;
  const query = api.queryIndex.bind(api);
  api.queryIndex = (q: unknown, ...rest: unknown[]) => {
    const asked = q as { kind?: string; page?: string };
    if (asked.kind === "render_embed" && asked.page === "logo.vectorcraft") {
      return Promise.resolve({ kind: "render_embed", value: { doc_id: LOGO, html: FIGURE, parts: [] } });
    }
    return query(q, ...rest);
  };
  await open(NOTA);
  await waitFor("la figura si può aprire", () => figure() !== null);
  return host;
}

const figure = () => document.querySelector<HTMLElement>('.markdown-rendered [data-craft-doc] [role="link"]');
const created = (host: FakeHost) =>
  host.calls.filter((call) => /^create/i.test(call.gate) || (call.gate === "invokeCommand" && /create/.test(String(call.args[0]))));

describe("la figura nella nota", () => {
  it("una figura che punta a un file che c'è apre la sua scheda col gesto", async () => {
    const host = await withFigure();
    figure()!.click();
    await waitFor("la scheda del file Craft", () => craftTabs() === 1 || document.querySelector(".craft-empty-state") !== null);
    await quiet();
    expect(renders(host)).toBe(1);
    expect(created(host)).toEqual([]);
  });

  it("il file rinominato fuori da Fub: clic e Invio non creano niente e lo dicono", async () => {
    const host = await withFigure();
    const { clearHistory, recentNotices } = await import("./ui/notify");
    clearHistory();
    const before = Object.keys(host.files()).sort();
    // La figura è già disegnata: il file cambia nome dietro la nota.
    host.renameFromOutside(LOGO, "Disegni/marchio.vectorcraft");
    // La nota ridisegna la figura col nome di prima: è ancora lì da cliccare.
    await quiet();
    await waitFor("la figura ridisegnata", () => figure() !== null);
    const link = figure()!;
    link.click();
    link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await quiet();
    expect(created(host)).toEqual([]);
    await waitFor("l'avviso", () => recentNotices().some((notice) => notice.text.startsWith("Non riesco ad aprire «Disegni/logo.vectorcraft»")));
    expect(Object.keys(host.files()).sort()).toEqual(before.map((id) => (id === LOGO ? "Disegni/marchio.vectorcraft" : id)).sort());
    expect(renders(host)).toBe(0);
  });
});
