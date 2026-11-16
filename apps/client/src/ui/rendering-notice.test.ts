import { beforeEach, describe, expect, it, vi } from "vitest";

const written = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, fail: false }));
vi.mock("../host/ipc", () => ({
  api: {
    setSetting: async (key: string, value: unknown) => {
      if (written.fail) throw new Error("disco pieno");
      written.calls.push([key, value]);
    },
  },
}));
const notified = vi.hoisted(() => [] as Array<{ text: string; tone?: string; actions: number }>);
vi.mock("./notify", () => ({
  notify: (text: string, tone?: string, action?: unknown) =>
    notified.push({ text, tone, actions: Array.isArray(action) ? action.length : action ? 1 : 0 }),
}));

import { renderingMessage, renderingNoticeOf } from "./rendering-notice";

const custom = (topic: string, payload: unknown) => ({ type: "custom" as const, topic, payload });

beforeEach(() => {
  written.calls = [];
  written.fail = false;
  notified.length = 0;
});

describe("gli avvisi del percorso di disegno", () => {
  it("legge solo il topic `rendering` e solo le forme che conosce", () => {
    expect(renderingNoticeOf(custom("rendering", { kind: "driver_mismatch", kernel: "550.163.01", library: "595.112.07" }))).toEqual({
      kind: "driver_mismatch",
      kernel: "550.163.01",
      library: "595.112.07",
    });
    expect(renderingNoticeOf(custom("rendering", { kind: "nvidia_flicker", driver: "550.163.01", offer_motion: true }))).toEqual({
      kind: "nvidia_flicker",
      driver: "550.163.01",
      offer_motion: true,
    });
    expect(renderingNoticeOf(custom("com.acme:rendering", { kind: "driver_mismatch", kernel: "1", library: "2" }))).toBeNull();
    expect(renderingNoticeOf(custom("rendering", { kind: "driver_mismatch", kernel: 550 }))).toBeNull();
    expect(renderingNoticeOf(custom("rendering", { kind: "futuro" }))).toBeNull();
    expect(renderingNoticeOf(custom("rendering", null))).toBeNull();
  });

  it("il driver disallineato chiede di riavviare, senza gesti", () => {
    const message = renderingMessage({ kind: "driver_mismatch", kernel: "550.163.01", library: "595.112.07" });
    expect(message.text).toContain("riavvia il computer");
    expect(message.text).toContain("550.163.01");
    expect(message.text).toContain("595.112.07");
    expect(message.tone).toBe("guasto");
    expect(message.actions).toEqual([]);
  });

  it("lo sfarfallio propone e scrive solo la scelta fatta", async () => {
    const message = renderingMessage({ kind: "nvidia_flicker", driver: "550.163.01", offer_motion: true });
    expect(message.text).toContain("550.163.01");
    expect(message.tone).toBe("info");
    expect(message.actions).toHaveLength(3);
    expect(written.calls).toEqual([]);

    const [cpu, motion, keep] = message.actions;
    await cpu!.run();
    await motion!.run();
    await keep!.run();
    expect(written.calls).toEqual([
      ["appearance.rendering", "cpu"],
      ["appearance.motion", "calm"],
      ["appearance.rendering", "gpu"],
    ]);
    expect(notified.map((n) => n.tone ?? "info")).toEqual(["info", "info", "info"]);
  });

  it("col movimento già calmo non lo propone, e un rifiuto si dice", async () => {
    const message = renderingMessage({ kind: "nvidia_flicker", driver: "550.163.01", offer_motion: false });
    expect(message.actions).toHaveLength(2);
    written.fail = true;
    await message.actions[0]!.run();
    expect(written.calls).toEqual([]);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.tone).toBe("guasto");
    expect(notified[0]!.text).toContain("disco pieno");
  });
});
