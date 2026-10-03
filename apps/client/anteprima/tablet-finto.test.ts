// @vitest-environment happy-dom
//
// Il tablet finto dell'anteprima contro l'host finto e la sessione vera: ogni
// evento che manda è uno che l'host accetta, e i suoi tre tratti entrano nel
// disegno con un `ack` ciascuno.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveShellMessage, LiveStart } from "../src/host/contract";
import type { FakeHost } from "../src/host/fake";
import { DISEGNI } from "./disegni";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../src/host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) =>
        (box.host!.module.api as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args),
    },
  ),
}));
vi.mock("../src/host/dialog", () => ({ confirm: async () => true }));
vi.mock("../src/ui/notify", () => ({ notify: () => {} }));

const { createFakeHost } = await import("../src/host/fake");
const { setReducedMotionPreference } = await import("../src/theme/reduced-motion");
const { documentSessions } = await import("../src/state/document-session");
const { startLive } = await import("../src/editors/spatial/live/session");
const registry = await import("../src/editors/spatial/live/registry");
const { tabletFinto } = await import("./tablet-finto");

const DOC = "Disegni/Casa.svg";

afterEach(async () => {
  await registry.liveFor(DOC)?.stop();
  documentSessions.close(DOC);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("il tablet finto dell'anteprima", () => {
  it("si collega, disegna tre tratti e ognuno entra nel disegno", async () => {
    setReducedMotionPreference(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
    const warn = vi.spyOn(console, "warn");
    const host = createFakeHost({
      file: { [DOC]: DISEGNI[DOC]! },
      draw: true,
      live: { addresses: [{ addr: "192.168.1.20", interface: "wlan0", defaultRoute: true }] },
    });
    box.host = host;
    await documentSessions.read(DOC);
    const before = documentSessions.text(DOC)!;
    await startLive(DOC);
    const [start] = host.atGate("liveStart").map((call) => call.args[0]);
    // Il primo id che l'host finto dà a una sessione.
    const session = "live-000001";
    const tablet = tabletFinto(host.liveEmit, session, start as LiveStart);

    await vi.advanceTimersByTimeAsync(20_000);
    tablet.stop();

    expect(warn).not.toHaveBeenCalled();
    const replies = host.atGate("liveSend").map((call) => call.args[1] as LiveShellMessage);
    expect(replies.filter((m) => m.t === "nack")).toEqual([]);
    expect(replies.filter((m) => m.t === "ack").map((m) => (m as { c: string }).c)).toEqual(["1", "2", "3"]);
    const after = documentSessions.text(DOC)!;
    expect(after.match(/fub:ink="/g)).toHaveLength(3);
    expect(after.startsWith(before.slice(0, before.indexOf("</g>")))).toBe(true);
    const status = await host.module.api.liveStatus(session);
    expect(status.pending).toEqual([]);
    expect(status.writer?.device.name).toBe("Tablet finto dell'anteprima");
  }, 30_000);
});
