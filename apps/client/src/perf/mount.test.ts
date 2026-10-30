// @vitest-environment happy-dom
//
// La sonda nella shell: c'è solo con `perf.probe` acceso, e se ne va quando si
// spegne o la shell si smonta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../ui/lifetime";

let value = false;
const handlers: Array<(payload: { key: string }) => void> = [];
vi.mock("../host/query", () => ({
  settings: async () => [{ spec: { key: "perf.probe" }, value }],
}));
vi.mock("../state/kernel", () => ({
  onEvent: (_type: string, handler: (payload: { key: string }) => void) => {
    handlers.push(handler);
    return () => handlers.splice(handlers.indexOf(handler), 1);
  },
}));

const { mountPerfProbe } = await import("./mount");
const changed = (): void => handlers.forEach((handler) => handler({ key: "perf.probe" }));

describe("la sonda nella shell", () => {
  afterEach(() => {
    value = false;
    delete window.__fubProbe;
  });

  it("spenta non c'è; accesa c'è e misura; spenta di nuovo sparisce", async () => {
    const lifetime = openLifetime();
    mountPerfProbe(lifetime);
    await vi.waitFor(() => expect(handlers).toHaveLength(1));
    expect(window.__fubProbe).toBeUndefined();
    value = true;
    changed();
    await vi.waitFor(() => expect(window.__fubProbe).toBeDefined());
    window.__fubProbe!.start();
    expect(window.__fubProbe!.stop().input.key.count).toBe(0);
    value = false;
    changed();
    await vi.waitFor(() => expect(window.__fubProbe).toBeUndefined());
    lifetime.close();
    expect(handlers).toHaveLength(0);
  });

  it("la shell che si smonta la porta via", async () => {
    value = true;
    const lifetime = openLifetime();
    mountPerfProbe(lifetime);
    await vi.waitFor(() => expect(window.__fubProbe).toBeDefined());
    lifetime.close();
    expect(window.__fubProbe).toBeUndefined();
  });
});
