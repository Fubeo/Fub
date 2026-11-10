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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import type { CardRegistry, CardRenderer, CardView } from "./editors/canvas/cards";

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

async function start(): Promise<FakeHost> {
  vi.resetModules();
  box.views.length = 0;
  box.embeds = 0;
  const host = createFakeHost({ file: VAULT });
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
  const fit = document.querySelector<HTMLButtonElement>('[data-canvas-action="fit"]');
  expect(fit).not.toBeNull();
  fit!.click();
  await settle();
  await waitFor(
    "la tela accende le schede in vista",
    () => card("nota")?.dataset.cardMode === "live" && card("logo")?.dataset.cardMode === "live",
  );
}

afterEach(() => {
  activeStop?.();
  activeStop = null;
});

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
