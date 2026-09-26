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

  it("chiude il menu e stacca i bottoni quando la finestra si smonta", () => {
    const button = document.querySelector<HTMLButtonElement>("#app-menu > button")!;
    expect(button.textContent).toBe("File");
    button.click();
    expect(document.getElementById("context-menu")).not.toBeNull();

    teardown!();
    vi.runAllTimers();

    expect(document.getElementById("context-menu")).toBeNull();
    expect(document.querySelectorAll("#app-menu > button")).toHaveLength(0);
    button.click();
    expect(document.getElementById("context-menu")).toBeNull();
  });
});

describe("il menu Vista e le view principali", () => {
  afterEach(() => {
    closeContextMenu();
    document.body.replaceChildren();
  });

  function mountWith(views: MenuHost["views"]): () => void {
    document.body.replaceChildren();
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.append(menubar);
    return mountAppMenu({ run: () => {}, views });
  }

  function viewMenuLabels(): string[] {
    document.querySelector<HTMLButtonElement>("#app-menu-2")!.click();
    return [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitem]")].map(
      (item) => item.textContent ?? "",
    );
  }

  it("elenca le view dichiarate, lette a ogni apertura, e le apre", () => {
    const opened: string[] = [];
    let declared = [{ label: "Apri la vista Grafo", run: () => opened.push("graph") }];
    const teardown = mountWith(() => declared);
    expect(viewMenuLabels()).toContain("Apri la vista Grafo");
    const item = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((entry) => entry.textContent === "Apri la vista Grafo")!;
    item.click();
    expect(opened).toEqual(["graph"]);

    // Il componente si spegne: la voce se ne va con la view, non resta a
    // aprire qualcosa che non c'è.
    declared = [];
    expect(viewMenuLabels().some((label) => label.includes("Grafo"))).toBe(false);
    teardown();
  });
});
