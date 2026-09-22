// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAppMenu, type MenuHost } from "./app-menu";
import { closeContextMenu } from "./menu";
import type { ShellCommandId } from "./shell-keys.generated";

function key(target: EventTarget, value: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("menubar applicativa", () => {
  let teardown: (() => void) | undefined;
  let runCalls: ShellCommandId[];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    menubar.setAttribute("role", "menubar");
    document.body.append(menubar);
    runCalls = [];
    const host: MenuHost = { run: (id) => runCalls.push(id) };
    teardown = mountAppMenu(host);
  });

  afterEach(() => {
    teardown?.();
    closeContextMenu();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("lascia un solo top-level nel giro del Tab e sposta il fuoco con le frecce", () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#app-menu > button")];
    expect(buttons).toHaveLength(5);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1]);

    buttons[0]!.focus();
    key(buttons[0]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    key(buttons[1]!, "End");
    expect(document.activeElement).toBe(buttons[4]);
    key(buttons[4]!, "Home");
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(buttons[4]);
  });

  it("Down apre il menu e mette il fuoco sulla prima voce", () => {
    const button = document.querySelector<HTMLButtonElement>("#app-menu > button")!;
    button.focus();
    const event = key(button, "ArrowDown");
    const item = document.querySelector<HTMLButtonElement>("#context-menu [role=menuitem]");

    expect(event.defaultPrevented).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(item);
  });

  it("chiude e ripristina il trigger dopo click, Escape e chiusura esterna", () => {
    const button = document.querySelector<HTMLButtonElement>("#app-menu > button")!;
    button.click();
    const item = document.querySelector<HTMLButtonElement>("#context-menu [role=menuitem]")!;
    item.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(runCalls).toHaveLength(1);
    expect(document.activeElement).toBe(button);

    button.click();
    key(document.activeElement!, "Escape");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);

    button.click();
    closeContextMenu();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});
