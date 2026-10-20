// @vitest-environment happy-dom
// La dimensione del testo: un passo dentro i limiti di `appearance.body`, e il
// gesto Ctrl/Cmd+rotella che la cambia solo sopra il testo di una nota.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ settings: vi.fn(), setSetting: vi.fn(), notify: vi.fn() }));
vi.mock("../host/ipc", () => ({ api: { setSetting: fake.setSetting } }));
vi.mock("../host/query", () => ({ settings: fake.settings }));
vi.mock("../ui/notify", () => ({ notify: fake.notify }));
vi.mock("../i18n/strings", () => ({ t: (key: string) => key }));

import { openLifetime } from "../ui/lifetime";
import { mountWheelTextSize, textSizeBy } from "./zoom";

const body = (value: unknown) => [{ spec: { key: "appearance.body" }, value }];

// happy-dom non legge i modificatori dall'init di un WheelEvent: li si mette
// sull'evento, come li porta quello di un browser.
function wheel(target: Element, deltaY: number, mods: { ctrlKey?: boolean; metaKey?: boolean } = { ctrlKey: true }): WheelEvent {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  Object.defineProperty(event, "ctrlKey", { value: mods.ctrlKey ?? false });
  Object.defineProperty(event, "metaKey", { value: mods.metaKey ?? false });
  target.dispatchEvent(event);
  return event;
}

describe("la dimensione del testo", () => {
  beforeEach(() => {
    fake.settings.mockReset();
    fake.setSetting.mockReset().mockResolvedValue(undefined);
    fake.notify.mockReset();
  });

  it("sale e scende di un punto, e si ferma ai limiti", async () => {
    fake.settings.mockResolvedValueOnce(body(17));
    await textSizeBy(1);
    fake.settings.mockResolvedValueOnce(body(12));
    await textSizeBy(-1);
    fake.settings.mockResolvedValueOnce(body(28));
    await textSizeBy(1);
    expect(fake.setSetting.mock.calls).toEqual([["appearance.body", 18]]);
    expect(fake.notify).toHaveBeenCalledWith("shell.text_size_now", "info");
  });

  it("un errore della porta si dice", async () => {
    fake.settings.mockResolvedValueOnce(body(17));
    fake.setSetting.mockRejectedValueOnce(new Error("no"));
    await textSizeBy(-1);
    expect(fake.notify).toHaveBeenCalledWith("shell.text_size_failed", "guasto");
  });
});

describe("Ctrl o Cmd con la rotella", () => {
  let life = openLifetime();
  afterEach(() => {
    life.close();
    document.body.replaceChildren();
  });

  it("sopra il testo cambia la dimensione; altrove, senza tasto o già consumato no", async () => {
    life = openLifetime();
    const change = vi.fn<(step: -1 | 1) => Promise<void>>().mockResolvedValue(undefined);
    mountWheelTextSize(life, change);
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const line = document.createElement("div");
    editor.append(line);
    const elsewhere = document.createElement("div");
    document.body.append(editor, elsewhere);

    expect(wheel(line, -100).defaultPrevented).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    wheel(line, 100, { metaKey: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(change.mock.calls).toEqual([[1], [-1]]);

    expect(wheel(elsewhere, -100).defaultPrevented).toBe(false);
    expect(wheel(line, -100, {}).defaultPrevented).toBe(false);
    editor.addEventListener("wheel", (event) => event.preventDefault(), { once: true });
    wheel(line, -100);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("un pizzico accumula, e un passo aspetta il precedente", async () => {
    life = openLifetime();
    let finish = () => {};
    const change = vi.fn<(step: -1 | 1) => Promise<void>>(() => new Promise<void>((done) => { finish = done; }));
    mountWheelTextSize(life, change);
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    document.body.append(editor);
    wheel(editor, -20);
    wheel(editor, -20);
    expect(change).not.toHaveBeenCalled();
    wheel(editor, -20);
    expect(change).toHaveBeenCalledTimes(1);
    wheel(editor, -100);
    expect(change).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    wheel(editor, -100);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("chiusa la vita, il gesto non c'è più", () => {
    life = openLifetime();
    const change = vi.fn<(step: -1 | 1) => Promise<void>>().mockResolvedValue(undefined);
    mountWheelTextSize(life, change);
    life.close();
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    document.body.append(editor);
    expect(wheel(editor, -100).defaultPrevented).toBe(false);
    expect(change).not.toHaveBeenCalled();
  });
});
