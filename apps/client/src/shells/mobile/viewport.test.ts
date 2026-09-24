// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { openLifetime } from "../../ui/lifetime";
import { mountMobileViewport } from "./viewport";

describe("mobile viewport", () => {
  it("tracks tablet rotation and lifts the active editor above a visual keyboard, then disposes", () => {
    const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const height = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const oldViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
    viewport.height = 900;
    viewport.offsetTop = 0;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    const input = document.createElement("input");
    document.body.append(input);
    const lifetime = openLifetime();
    try {
      mountMobileViewport(lifetime);
      expect(document.documentElement.dataset.mobileFormFactor).toBe("tablet");
      expect(document.documentElement.dataset.mobileOrientation).toBe("landscape");
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
      viewport.height = 500;
      input.focus();
      viewport.dispatchEvent(new Event("resize"));
      expect(document.documentElement.dataset.mobileFormFactor).toBe("phone");
      expect(document.documentElement.dataset.mobileOrientation).toBe("portrait");
      expect(document.documentElement.dataset.mobileKeyboard).toBe("visible");
      expect(document.documentElement.style.getPropertyValue("--mobile-keyboard-inset")).toBe("400px");
    } finally {
      lifetime.close();
      input.remove();
      if (width) Object.defineProperty(window, "innerWidth", width);
      if (height) Object.defineProperty(window, "innerHeight", height);
      if (oldViewport) Object.defineProperty(window, "visualViewport", oldViewport);
      else Reflect.deleteProperty(window, "visualViewport");
    }
    expect(document.documentElement.style.getPropertyValue("--mobile-keyboard-inset")).toBe("");
  });
});
