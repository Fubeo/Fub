// @vitest-environment happy-dom
//
// **La sessione live nella shell**, sulla shell vera contro l'host finto.
//
// Un tablet scrive sul disegno aperto: il PC avvia la sessione dalla palette,
// mostra il QR, riceve i commit e li applica sul documento come i propri
// gesti; i gesti del PC arrivano allo scrittore. In un browser, dove le porte
// `live_*` non ci sono, il comando non compare. Il cablaggio è quello di
// `drawing.e2e.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEvent, LiveShellMessage } from "./host/contract";
import type { FakeHost, LiveNetwork } from "./host/fake";
import { mountedTextEditors } from "./editors/text/test-support";

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

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300">';
const HOUSE =
  `${HEAD}\n  <title>Casa</title>\n  <g id="l1" fub:layer="Livello 1">\n    <rect id="o1a2b3c4d" x="60" y="60" width="80" height="60" fill="none" stroke="#000000" stroke-width="4"/>\n  </g>\n</svg>\n`;
const VAULT = { "Benvenuto.md": "# Benvenuto\n", "casa.svg": HOUSE };
const NETWORK: LiveNetwork = { addresses: [{ addr: "192.168.1.20", interface: "wlan0", defaultRoute: true }], hostName: "Studio" };
const SESSION = "live-000001";
const JOIN: LiveEvent = {
  t: "writerConnected",
  writer: "1",
  device: { name: "Tablet di Ada", kind: "tablet" },
  caps: { pressure: true, tilt: false, coalesced: true, predicted: false },
  resumed: false,
};
/// Un tratto del tablet: `fub:ink` coi suoi campioni, e niente `d`.
const { strokeElem } = await import("./editors/spatial/tools/edit");
const { quantizeInk } = await import("./editors/spatial/ink/sample");
const { PF1_DEFAULTS } = await import("./editors/spatial/ink/brush");
const STROKE = JSON.parse(JSON.stringify({
  op: "add",
  parent: "l1",
  pos: { last: true },
  elem: strokeElem("o5e6f7a8b", "#202020", PF1_DEFAULTS, quantizeInk([
    { x: 200, y: 150, p: 0.5, t: 0 },
    { x: 230, y: 170, p: 0.6, t: 8 },
    { x: 260, y: 175, p: 0.4, t: 16 },
  ]), null),
})) as { op: string } & Record<string, unknown>;

async function start(host: FakeHost = createFakeHost({ file: VAULT, draw: true, live: NETWORK })): Promise<FakeHost> {
  vi.resetModules();
  box.host = host;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const main = await import("./main");
  const stop = await main.startup;
  activeStop = stop;
  // Col moto ridotto un dialogo chiuso se ne va subito.
  const { setReducedMotionPreference } = await import("./theme/reduced-motion");
  setReducedMotionPreference(true);
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 2000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

async function open(doc: string): Promise<void> {
  const { openDocument } = await import("./panels/document");
  await openDocument(doc);
  await settle();
  await waitFor("il documento si carica", () => document.querySelector(".vector-pending") === null);
}

async function offered(id: string): Promise<boolean> {
  const { allCommands } = await import("./ui/commands");
  return allCommands().some((entry) => entry.id === id);
}

async function run(id: string): Promise<void> {
  const { allCommands } = await import("./ui/commands");
  const entry = allCommands().find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`il comando ${id} non è disponibile`);
  await entry.run?.();
  await settle();
}

const focusedPane = () => document.querySelector<HTMLElement>(".pane.focus")!;
const painted = (pane: HTMLElement = focusedPane()): string[] =>
  [...pane.querySelectorAll<SVGElement>(".draw-surface [data-scene-id]")]
    .map((el) => el.getAttribute("data-scene-id")!)
    .filter((id) => id !== "l1");
const sent = (host: FakeHost): LiveShellMessage[] => host.atGate("liveSend").map((call) => call.args[1] as LiveShellMessage);
const written = (host: FakeHost): string[] =>
  host.atGate("writeDocument").concat(host.atGate("resourceWrite"))
    .filter((call) => call.args[0] === "casa.svg")
    .map((call) => (call.args[1] instanceof Uint8Array ? new TextDecoder().decode(call.args[1]) : String(call.args[1])));

let clock = 100;

function drawRect(pane: HTMLElement = focusedPane()): void {
  pane.querySelector<HTMLButtonElement>('.draw-tool[data-tool="rect"]')!.click();
  const sheet = pane.querySelector<HTMLElement>(".draw-surface")!;
  const event = (type: string, x: number, y: number, buttons: number): PointerEvent => {
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, isPrimary: true, pointerId: 1, pointerType: "mouse",
      button: type === "pointermove" ? -1 : 0, buttons, pressure: buttons ? 0.5 : 0, clientX: x, clientY: y,
    });
    Object.defineProperty(e, "timeStamp", { value: (clock += 8) });
    return e;
  };
  sheet.dispatchEvent(event("pointerdown", 200, 150, 1));
  sheet.dispatchEvent(event("pointermove", 260, 200, 1));
  sheet.dispatchEvent(event("pointerup", 260, 200, 0));
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("la sessione live nella shell", () => {
  it("si avvia solo su un disegno, e in un browser non c'è", async () => {
    await start();
    await open("Benvenuto.md");
    expect(await offered("shell.live.start")).toBe(false);
    await open("casa.svg");
    expect(await offered("shell.live.start")).toBe(true);
    expect(await offered("shell.live.stop")).toBe(false);

    await start(createFakeHost({ file: VAULT, draw: true }));
    await open("casa.svg");
    expect(await offered("shell.live.start")).toBe(false);
  });

  it("il tablet scrive sul disegno: il foglio lo mostra, il disco lo salva, lo scrittore riceve l'eco", async () => {
    const host = await start();
    await open("casa.svg");
    await run("shell.live.start");
    const dialog = document.querySelector<HTMLElement>(".modale")!;
    expect(dialog.querySelector(".live-qr img")).not.toBeNull();
    expect(await offered("shell.live.start")).toBe(false);
    expect(await offered("shell.live.stop")).toBe(true);

    host.liveEmit(SESSION, [JOIN]);
    expect(document.querySelector(".modale")).toBeNull();
    const bar = focusedPane().querySelector<HTMLElement>(".vector-surface > .live-bar")!;
    expect(bar.dataset.phase).toBe("connected");
    expect(bar.querySelector(".live-state")!.textContent).toBe("Tablet: Tablet di Ada");

    host.liveEmit(SESSION, [{ t: "commit", writer: "1", c: "1", ops: [STROKE] }]);
    // Il foglio lo disegna nello stesso giro, prima di ogni attesa.
    expect(painted()).toEqual(["o1a2b3c4d", "o5e6f7a8b"]);
    await settle();
    const [ack] = sent(host);
    expect(ack).toMatchObject({ t: "ack", c: "1", seq: "1", duplicate: false });
    const d = (ack as unknown as { echo: { elem: { attrs: Record<string, string> } }[] }).echo[0]!.elem.attrs.d!;
    expect(d).toMatch(/^M/);
    await waitFor("il tratto arriva al disco", () => written(host).some((saved) => saved.includes(`d="${d}"`)));

    await run("shell.live.stop");
    expect(focusedPane().querySelector(".live-bar")).toBeNull();
    expect(host.atGate("liveStop").map((call) => call.args[1])).toEqual(["terminated"]);
  });

  it("i gesti del PC arrivano allo scrittore come operazioni", async () => {
    const host = await start();
    await open("casa.svg");
    await run("shell.live.start");
    host.liveEmit(SESSION, [JOIN]);
    drawRect();
    await settle();
    const [ops] = sent(host);
    expect(ops).toMatchObject({ t: "ops", seq: "1" });
    expect(JSON.stringify(ops)).toContain('"tag":"rect"');
  });

  it("senza un foglio montato i commit entrano lo stesso, e il sorgente li mostra", async () => {
    const host = await start();
    await open("casa.svg");
    await run("shell.live.start");
    host.liveEmit(SESSION, [JOIN]);
    await run("shell.doc.source.open");
    expect(focusedPane().querySelector(".draw-surface")).toBeNull();
    host.liveEmit(SESSION, [{ t: "commit", writer: "1", c: "1", ops: [STROKE] }]);
    const [editor] = mountedTextEditors();
    expect(editor!.state.doc.toString()).toContain('id="o5e6f7a8b"');
    await settle();
    expect(sent(host)).toMatchObject([{ t: "ack", c: "1", seq: "1" }]);
    // Una modifica nel sorgente arriva allo scrittore come testo intero.
    const at = editor!.state.doc.toString().indexOf("Casa");
    editor!.dispatch({ changes: { from: at, to: at + 4, insert: "Villa" } });
    await waitFor("lo snapshot parte", () => sent(host).some((message) => message.t === "snapshot"));
    expect(sent(host)[1]).toMatchObject({ t: "snapshot", seq: "2" });
    expect((sent(host)[1] as { text: string }).text).toContain("<title>Villa</title>");
  });
});
