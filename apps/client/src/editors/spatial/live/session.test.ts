// @vitest-environment happy-dom
//
// La sessione live dal lato del PC, contro l'host finto: i commit del tablet
// entrano nel documento come i gesti locali, lo scrittore riceve `ack`, `nack`
// ed eco canonica, e le modifiche fatte sul PC gli arrivano come `ops` o come
// `snapshot`.

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LiveEvent, LiveOp, LiveShellMessage } from "../../../host/contract";
import type { FakeHost, LiveNetwork } from "../../../host/fake";
import { formatBrush, PF1_DEFAULTS } from "../ink/brush";
import { quantizeInk } from "../ink/sample";
import { SceneEngine } from "../scene/engine";
import type { AddOp, Op } from "../scene/ops";
import { strokeElem } from "../tools/edit";
import { fakeStage } from "./test-support";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  confirm: null as unknown as Mock,
  notify: null as unknown as Mock,
}));

vi.mock("../../../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) =>
        (box.host!.module.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args),
    },
  ),
}));
vi.mock("../../../host/dialog", () => ({ confirm: (...args: unknown[]) => box.confirm(...args) }));
vi.mock("../../../ui/notify", () => ({ notify: (...args: unknown[]) => box.notify(...args) }));

const { createFakeHost } = await import("../../../host/fake");
const { setReducedMotionPreference } = await import("../../../theme/reduced-motion");
const { documentSessions } = await import("../../../state/document-session");
const { startLive } = await import("./session");
const registry = await import("./registry");

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 300">';
const HOUSE =
  `${HEAD}\n  <title>Casa</title>\n  <g id="l1" fub:layer="Livello 1">\n    <rect id="o1a2b3c4d" x="60" y="60" width="80" height="60" fill="none" stroke="#000000" stroke-width="4"/>\n  </g>\n</svg>\n`;
const FOREIGN = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>\n';
const NETWORK: LiveNetwork = {
  addresses: [
    { addr: "192.168.1.20", interface: "wlan0", defaultRoute: true },
    { addr: "10.0.0.5", interface: "eth0", defaultRoute: false },
  ],
  hostName: "Studio",
};
const DOC = "casa.svg";
const SESSION = "live-000001";
const JOIN: LiveEvent = {
  t: "writerConnected",
  writer: "1",
  device: { name: "Tablet di Ada", kind: "tablet" },
  caps: { pressure: true, tilt: false, coalesced: true, predicted: false },
  resumed: false,
};
const BRUSH = formatBrush({ ...PF1_DEFAULTS, size: 6 });
const SAMPLES: [number, number, number, number][] = [[200, 150, 0.5, 1000], [230, 170, 0.6, 1008], [260, 175, 0.4, 1016]];

/// L'`add` di un tratto come lo scrive il tablet: senza `d`.
function stroke(id: string): AddOp {
  const ink = quantizeInk(SAMPLES.map(([x, y, p, t]) => ({ x, y, p, t: t - SAMPLES[0]![3] })));
  return { op: "add", parent: "l1", pos: { last: true }, elem: strokeElem(id, "#202020", PF1_DEFAULTS, ink, null) };
}

const wire = (ops: readonly Op[]): LiveOp[] => JSON.parse(JSON.stringify(ops)) as LiveOp[];

let host: FakeHost;
let frames: FrameRequestCallback[] = [];

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const sent = (): LiveShellMessage[] => host.atGate("liveSend").map((call) => call.args[1] as LiveShellMessage);
const text = (): string => documentSessions.text(DOC)!;
const emit = (...events: LiveEvent[]): void => host.liveEmit(SESSION, events);

async function begin(file: Record<string, string> = { [DOC]: HOUSE }): Promise<void> {
  host = createFakeHost({ file, draw: true, live: NETWORK });
  box.host = host;
  await documentSessions.read(DOC);
  await startLive(DOC);
  await settle();
}

function commit(c: string, ops: readonly Op[] | LiveOp[]): void {
  emit({ t: "commit", writer: "1", c, ops: wire(ops as Op[]) });
}

beforeEach(() => {
  // Col moto ridotto i dialoghi se ne vanno subito e la camera salta.
  setReducedMotionPreference(true);
  box.confirm = vi.fn(async () => true);
  box.notify = vi.fn();
  frames = [];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(async () => {
  await registry.liveFor(DOC)?.stop();
  documentSessions.close(DOC);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("i commit del tablet", () => {
  it("entrano nel documento come lo stesso tratto disegnato sul PC, anche senza un foglio montato", async () => {
    await begin();
    expect(registry.stagesOf(DOC)).toEqual([]);
    const ops: Op[] = [stroke("o5e6f7a8b"), { op: "page", viewBox: "0 0 800 600" }];
    emit(JOIN);
    commit("1", ops);

    const local = SceneEngine.open(HOUSE);
    const outcome = local.apply({ op: "batch", ops });
    if (outcome.outcome !== "applied") throw new Error(outcome.detail);
    expect(text()).toBe(local.text);
    expect(documentSessions.isDirty(DOC)).toBe(true);

    await settle();
    const [ack] = sent();
    expect(ack).toMatchObject({ t: "ack", writer: "1", c: "1", seq: "1", duplicate: false });
    const echo = (ack as unknown as { echo: AddOp[] }).echo;
    expect(echo[0]!.elem.attrs.d).toMatch(/^M/);
    expect(local.text).toContain(`d="${echo[0]!.elem.attrs.d}"`);
    expect(echo[1]).toEqual({ op: "page", viewBox: "0 0 800 600" });
    expect((await host.module.api.liveStatus(SESSION)).pending).toEqual([]);
  });

  it("un rifiuto non tocca il documento e dice quale operazione", async () => {
    await begin();
    emit(JOIN);
    commit("1", [stroke("o5e6f7a8b"), { op: "set", id: "manca", attrs: { fill: "#000000" } }]);
    commit("2", [{ op: "add", slot: 1, elem: { tag: "rect", attrs: {} } } as unknown as Op]);
    commit("3", [{ ...stroke("o9"), parent: "nessuno" }]);
    expect(text()).toBe(HOUSE);
    await settle();
    expect(sent()).toMatchObject([
      { t: "nack", c: "1", reason: "missing-target", index: 1 },
      { t: "nack", c: "2", reason: "invalid-elem", index: 0 },
      { t: "nack", c: "3", reason: "missing-parent", index: 0 },
    ]);
  });

  it("un duplicato o un commit vuoto rispondono al seq di adesso", async () => {
    await begin();
    emit(JOIN);
    commit("1", [stroke("o5e6f7a8b")]);
    const after = text();
    commit("2", [stroke("o5e6f7a8b")]);
    commit("3", []);
    expect(text()).toBe(after);
    await settle();
    expect(sent().map((message) => [message.t, (message as { seq?: string }).seq, (message as { duplicate?: boolean }).duplicate]))
      .toEqual([["ack", "1", false], ["ack", "1", true], ["ack", "1", true]]);
    expect((sent()[1] as unknown as { echo: AddOp[] }).echo[0]!.elem.attrs.d).toMatch(/^M/);
  });

  it("l'inchiostro lascia il posto all'elemento nello stesso giro", async () => {
    await begin();
    const stage = fakeStage();
    const withdraw = registry.offerStage(DOC, stage);
    emit(JOIN);
    emit(
      { t: "inkBegin", s: "o5e6f7a8b", layer: "l1", tool: "pen", fill: "#202020", fillOpacity: 1, brush: BRUSH },
      { t: "inkPoints", s: "o5e6f7a8b", pts: SAMPLES },
      { t: "inkEnd", s: "o5e6f7a8b" },
    );
    for (const callback of frames.splice(0)) callback(16);
    expect(stage.inks.has("live:o5e6f7a8b")).toBe(true);
    stage.log.length = 0;
    commit("1", [stroke("o5e6f7a8b")]);
    expect(stage.log).toEqual(["clear live:o5e6f7a8b", "flush"]);
    expect(text()).toContain('id="o5e6f7a8b"');
    withdraw();
  });

  it("al termine risponde ai commit che aspettano ancora", async () => {
    await begin();
    emit(JOIN);
    const api = host.module.api;
    const status = api.liveStatus;
    api.liveStatus = async (session) => ({
      ...(await status(session)),
      pending: [{ writer: "1", c: "7", ops: wire([stroke("o5e6f7a8b")]) }],
    });
    await registry.liveFor(DOC)!.stop();
    expect(text()).toContain('id="o5e6f7a8b"');
    expect(sent()).toMatchObject([{ t: "ack", c: "7", seq: "1" }]);
    expect(host.atGate("liveStop").map((call) => call.args[1])).toEqual(["terminated"]);
    expect(registry.liveFor(DOC)).toBeNull();
    expect(box.notify).not.toHaveBeenCalled();
  });
});

describe("le modifiche fatte sul PC", () => {
  it("un gesto arriva allo scrittore come operazione, con l'eco canonica", async () => {
    await begin();
    const local = SceneEngine.open(text());
    const outcome = local.apply(stroke("o5e6f7a8b"));
    if (outcome.outcome !== "applied") throw new Error(outcome.detail);
    registry.noteSceneChange(outcome.text, outcome.undo.forward);
    expect(documentSessions.acceptSurfaceChange(DOC, "editor", { text: outcome.text, operation: outcome.operation }).kind).toBe("accepted");
    await settle();
    const [ops] = sent();
    expect(ops).toMatchObject({ t: "ops", seq: "1" });
    expect((ops as unknown as { ops: AddOp[] }).ops[0]!.elem.attrs.d).toMatch(/^M/);
  });

  it("un cambio senza operazione arriva come snapshot, e un commit lo aspetta", async () => {
    await begin();
    emit(JOIN);
    const edited = HOUSE.replace("Casa", "Villa");
    const from = HOUSE.indexOf("Casa");
    expect(documentSessions.acceptSurfaceChange(DOC, "source", {
      text: edited,
      operation: { beforeLength: HOUSE.length, afterLength: edited.length, edits: [{ from, to: from + 4, deleted: "Casa", inserted: "Villa" }] },
    }).kind).toBe("accepted");
    commit("1", [stroke("o5e6f7a8b")]);
    expect(text()).toContain("Villa");
    expect(text()).toContain('id="o5e6f7a8b"');
    await settle();
    expect(sent()).toMatchObject([
      { t: "snapshot", seq: "1", text: edited },
      { t: "ack", c: "1", seq: "2", duplicate: false },
    ]);
  });

  it("uno snapshot chiesto dall'host porta il testo del seq di adesso", async () => {
    await begin();
    emit({ t: "snapshotWanted" });
    await settle();
    expect(sent()).toEqual([{ t: "snapshot", seq: "0", text: HOUSE }]);
  });
});

describe("la vita della sessione", () => {
  it("parte solo su un disegno di FubDraw che si modifica", async () => {
    await begin({ [DOC]: FOREIGN });
    expect(host.atGate("liveStart")).toEqual([]);
    expect(box.notify).toHaveBeenCalledWith(expect.stringContaining("disegno di FubDraw"), "guasto");
  });

  it("finisce quando il documento si chiude, o quando l'host chiude", async () => {
    await begin();
    documentSessions.close(DOC);
    await settle();
    expect(host.atGate("liveStop").map((call) => call.args[1])).toEqual(["documentClosed"]);
    expect(registry.liveFor(DOC)).toBeNull();

    await begin();
    emit(JOIN, { t: "writerDisconnected", writer: "1", reason: "writerBye", resumable: false }, { t: "ended", reason: "hostClosing" });
    await settle();
    expect(host.atGate("liveStop").map((call) => call.args[1])).toEqual(["hostClosing"]);
    expect(registry.liveFor(DOC)).toBeNull();
    expect(box.notify).toHaveBeenCalledWith("Sessione live terminata");
  });

  it("su Windows spiega il firewall una volta sola", async () => {
    const platform = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    try {
      host = createFakeHost({ file: { [DOC]: HOUSE }, draw: true, live: NETWORK });
      box.host = host;
      await documentSessions.read(DOC);
      box.confirm = vi.fn(async () => false);
      await startLive(DOC);
      expect(box.confirm).toHaveBeenCalledTimes(1);
      expect(host.atGate("liveStart")).toEqual([]);
      box.confirm = vi.fn(async () => true);
      await startLive(DOC);
      expect(host.atGate("liveStart")).toHaveLength(1);
      await registry.liveFor(DOC)!.stop();
      await startLive(DOC);
      expect(box.confirm).toHaveBeenCalledTimes(1);
      expect(host.atGate("liveStart")).toHaveLength(2);
    } finally {
      if (platform) Object.defineProperty(navigator, "platform", platform);
      else delete (navigator as { platform?: string }).platform;
    }
  });
});

describe("il pannello e l'indicatore", () => {
  it("il pannello mostra il QR a pixel interi e si chiude quando il tablet entra", async () => {
    await begin();
    const dialog = document.querySelector<HTMLElement>(".modale")!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    const image = dialog.querySelector<HTMLImageElement>(".live-qr img")!;
    expect(image.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(image.width).toBe(232);
    expect(image.alt).toBe("Il codice QR della sessione live");
    expect(dialog.textContent).toContain("Il codice vale ancora 5:00.");
    expect(dialog.querySelector("select")!.options).toHaveLength(2);
    emit(JOIN);
    await settle();
    expect(document.querySelector(".modale")).toBeNull();
    registry.liveFor(DOC)!.show();
    expect(document.querySelector(".modale")!.textContent).toContain("Tablet di Ada");
  });

  it("l'indicatore sta su ogni foglio, apre il pannello e accende «Segui il tablet»", async () => {
    await begin();
    document.querySelector<HTMLButtonElement>(".modale .palette-actions button:last-child")!.click();
    expect(document.querySelector(".modale")).toBeNull();
    const stage = fakeStage();
    const withdraw = registry.offerStage(DOC, stage);
    const bar = stage.root.querySelector<HTMLElement>(".live-bar")!;
    expect(stage.root.firstElementChild).toBe(bar);
    expect(bar.dataset.phase).toBe("waiting");
    emit(JOIN);
    expect(bar.dataset.phase).toBe("connected");
    expect(bar.querySelector(".live-state")!.textContent).toBe("Tablet: Tablet di Ada");
    const follow = bar.querySelector<HTMLButtonElement>(".live-follow")!;
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    follow.click();
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    expect(host.atGate("setViewState").map((call) => call.args)).toContainEqual(["live.follow", true]);
    emit({ t: "view", x: 0, y: 0, scale: 1, w: 400, h: 300 });
    expect(stage.stage.camera).toEqual({ scale: 2, tx: 0, ty: 0 });
    bar.querySelector<HTMLButtonElement>(".live-state")!.click();
    expect(document.querySelector(".modale")).not.toBeNull();
    withdraw();
    expect(stage.root.querySelector(".live-bar")).toBeNull();
  });

  it("lo scrittore caduto ha un tempo per tornare; poi serve un codice nuovo", async () => {
    await begin();
    emit(JOIN, { t: "writerDisconnected", writer: "1", reason: "lost", resumable: true });
    await settle();
    // Il tablet entrato ha chiuso il pannello: lo si riapre.
    registry.liveFor(DOC)!.show();
    const status = document.querySelector(".modale .palette-label")!;
    expect(status.textContent).toMatch(/^Tablet scollegato: può tornare per [12]:\d\d$/);
    emit({ t: "writerReleased", writer: "1", reason: "resumeExpired" });
    expect(status.textContent).toBe("In attesa del tablet");
    const renew = [...document.querySelectorAll<HTMLButtonElement>(".modale .palette-actions button")].find((button) => button.textContent === "Nuovo codice")!;
    expect(renew.className).toBe("primary");
    renew.click();
    await settle();
    expect(host.atGate("livePairing").map((call) => call.args)).toEqual([[SESSION, true]]);
    expect(document.querySelector<HTMLElement>(".modale .live-qr")!.hidden).toBe(false);
  });

  it("scegliere un'altra rete riapre la sessione su quell'indirizzo", async () => {
    await begin();
    const select = document.querySelector<HTMLSelectElement>(".modale select")!;
    select.value = "10.0.0.5";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(host.atGate("liveStop").map((call) => call.args)).toEqual([[SESSION, "terminated"]]);
    expect((host.atGate("liveStart")[1]!.args[0] as { address?: string }).address).toBe("10.0.0.5");
    expect(select.value).toBe("10.0.0.5");
    host.liveEmit("live-000002", [JOIN]);
    commit2();
    expect(text()).toContain('id="o5e6f7a8b"');
  });
});

function commit2(): void {
  host.liveEmit("live-000002", [{ t: "commit", writer: "1", c: "1", ops: wire([stroke("o5e6f7a8b")]) }]);
}
