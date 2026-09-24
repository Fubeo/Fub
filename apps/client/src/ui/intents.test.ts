// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const notified = vi.hoisted(() => [] as Array<[string, string | undefined]>);
vi.mock("./notify", () => ({
  notify: (message: string, tone?: string) => notified.push([message, tone]),
}));
vi.mock("../panels/document", () => ({
  isOpen: () => false,
  openDocument: vi.fn(),
  revealByteOffset: vi.fn(),
}));
vi.mock("../panels/search", () => ({ searchFor: vi.fn() }));

import {
  applyIntent,
  CLIPBOARD_TEXT_NS,
  setReloaderForTests,
  takeNoticeAfterReload,
  VAULT_RESTORED_NS,
} from "./intents";

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => {
  notified.length = 0;
});

describe("l'intento degli appunti", () => {
  it("mette il testo negli appunti e lo dice", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    await applyIntent({ kind: "custom", ns: CLIPBOARD_TEXT_NS, payload: { text: "com'era\n" } });
    expect(writeText).toHaveBeenCalledWith("com'era\n");
    expect(notified).toHaveLength(1);
    expect(notified[0]![1]).toBeUndefined();
  });

  it("un rifiuto del sistema è un guasto detto, non una copia creduta", async () => {
    clipboard(async () => {
      throw new Error("negato");
    });
    await applyIntent({ kind: "custom", ns: CLIPBOARD_TEXT_NS, payload: { text: "x" } });
    expect(notified).toEqual([[expect.any(String), "guasto"]]);
  });

  it("un payload senza testo non scrive niente", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    await applyIntent({ kind: "custom", ns: CLIPBOARD_TEXT_NS, payload: { text: 3 } });
    expect(writeText).not.toHaveBeenCalled();
    expect(notified).toHaveLength(0);
  });
});

describe("il vault ripristinato", () => {
  it("ricarica la finestra e lascia un avviso che si legge una volta sola", async () => {
    const reload = vi.fn();
    setReloaderForTests(reload);
    await applyIntent({ kind: "custom", ns: VAULT_RESTORED_NS, payload: { entries: 3 } });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeNoticeAfterReload()).toContain("snapshot");
    expect(takeNoticeAfterReload()).toBeNull();
  });
});
