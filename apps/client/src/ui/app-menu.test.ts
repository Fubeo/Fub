// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAppMenu } from "./app-menu";
import { closeContextMenu } from "./menu";

describe("menubar applicativa", () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.append(menubar);
    teardown = mountAppMenu({ run: vi.fn() });
  });

  afterEach(() => {
    teardown?.();
    closeContextMenu();
    vi.runAllTimers();
    vi.useRealTimers();
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
