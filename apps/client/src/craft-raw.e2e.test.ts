// @vitest-environment happy-dom
//
// **Una scheda RAW segue l'elenco dei comandi** (N7, T28), sulla shell vera
// contro l'host finto. Il legame di un RAW coi byte (il profilo `media-raw`
// del viewer) esiste soltanto quando `craft.preview` è servito, e l'elenco
// dei comandi arriva dopo che il vault è aperto: una scheda RAW montata prima
// (la sessione riaperta all'avvio) o «File delle app Craft» acceso e spento
// con la scheda aperta cambiano il legame sotto un riquadro già montato. Quel
// riquadro si rimonta, senza gesto, e gli altri restano come sono.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import type { CommandSpec } from "./host/contract";
import type { CraftPreview } from "./host/craft";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  raw: null as ((name: string, args: unknown[]) => unknown) | null,
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

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

const RAW = "Foto/IMG_0412.CR3";
const BYTES = { bytes: new Uint8Array([0x7b, 0x7d, 0xff]), mime: "application/octet-stream" };

/// Un JPEG di 1200×800 che dice soltanto la sua misura, girato (6).
function jpeg(): CraftPreview["image"] {
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 800 >> 8, 800 & 255, 1200 >> 8, 1200 & 255, 1, 1, 0x11, 0, 0xff, 0xd9];
  return { media_type: "image/jpeg", data: btoa(String.fromCharCode(...bytes)), width: 1200, height: 800, orientation: 6 };
}

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

/// La shell vera su un vault con una nota e un RAW col JPEG dentro. L'host
/// finto non sa leggere un RAW: l'anteprima la dà `box.raw`, come il bundle.
async function start(): Promise<FakeHost> {
  vi.resetModules();
  const host: FakeHost = createFakeHost({
    file: { "Benvenuto.md": "# Benvenuto\n" },
    resources: { [RAW]: BYTES },
    craft: { docs: {} },
  });
  box.host = host;
  box.raw = (name, args) => {
    if (name !== "invokeCommand" || args[0] !== "craft.preview" || (args[1] as { doc?: string }).doc !== RAW) return undefined;
    const payload: CraftPreview = {
      version: 2, doc: RAW, revision: null, size: "large", origin: "file", queued: false, image: jpeg(),
      missing: null, limit_bytes: null, render: null,
      info: { app: "raw", editor: "LightCraft", format_version: null, bytes: 27_011_420, photo: null, edits: [], xmp: null },
    };
    return Promise.resolve({ notify: null, effect: { kind: "custom", ns: "fub.craft", payload }, undo: null, partial: null });
  };
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  activeStop = await main.startup;
  await settle();
  return host;
}

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc);
  await settle();
}

/// L'elenco dei comandi come lo darebbe il kernel, con o senza i comandi di
/// `fub.craft`.
async function setCommands(host: FakeHost, craft: boolean): Promise<void> {
  const store = await import("./state/store");
  const all: CommandSpec[] = await host.module.api.listCommands();
  store.setCommandSpecs(craft ? all : all.filter((spec) => !spec.id.startsWith("craft.")));
  await settle();
}

/// Divide dal registro, come `shell.e2e`.
async function splitRight(): Promise<void> {
  const registry = await import("./ui/commands");
  await registry.allCommands().find((entry) => entry.id === "shell.pane.split.right")?.run?.();
  await settle();
}

const rawTab = () => document.querySelector('[data-profile="raw"] .craft-card .zoom-content');

// L'ultima prova smonta la shell anche lei: un timer della shell che scattasse
// dopo la fine del file troverebbe l'ambiente già smontato.
afterAll(() => {
  activeStop?.();
  activeStop = null;
});

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  box.raw = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("una scheda RAW e l'elenco dei comandi", () => {
  it("montata prima dei comandi diventa la scheda RAW quando arriva craft.preview, senza chiamare l'app", async () => {
    const host = await start();
    await setCommands(host, false);
    // La nota nel primo riquadro, il RAW nel secondo.
    await open("Benvenuto.md");
    await splitRight();
    await waitFor("il secondo riquadro", () => document.querySelectorAll(".pane").length === 2);
    await open(RAW);
    await quiet();
    expect(rawTab()).toBeNull();
    const note = document.querySelectorAll(".pane")[0]!.querySelector(".cm-content");
    expect(note).not.toBeNull();
    await setCommands(host, true);
    await waitFor("la scheda RAW", () => rawTab() !== null);
    await quiet();
    expect(host.atGate("craftRender")).toHaveLength(0);
    // L'altro riquadro non si è rimontato: è lo stesso editor.
    expect(document.querySelectorAll(".pane")[0]!.querySelector(".cm-content")).toBe(note);
    expect(note!.isConnected).toBe(true);
  });

  it("col componente spento la scheda RAW torna senza vista", async () => {
    const host = await start();
    await open(RAW);
    await waitFor("la scheda RAW", () => rawTab() !== null);
    await setCommands(host, false);
    await waitFor("la scheda senza vista", () => rawTab() === null && document.querySelector('[data-profile="raw"]') === null);
    await quiet();
    expect(host.atGate("craftRender")).toHaveLength(0);
  });
});
