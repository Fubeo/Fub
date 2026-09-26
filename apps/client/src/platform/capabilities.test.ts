// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  activeShell,
  declareShell,
  DESKTOP_CAPABILITIES,
  MOBILE_CAPABILITIES,
  platformSupports,
  type PlatformCapabilities,
} from "./capabilities";

function keys(
  value: PlatformCapabilities,
): Array<keyof PlatformCapabilities> {
  return Object.keys(value).sort() as Array<keyof PlatformCapabilities>;
}

describe("capacità delle shell", () => {
  it("usano lo stesso vocabolario", () => {
    expect(keys(DESKTOP_CAPABILITIES)).toEqual(keys(MOBILE_CAPABILITIES));
  });

  it("descrivono capacità di piattaforma, non funzioni del prodotto", () => {
    expect(keys(DESKTOP_CAPABILITIES)).toEqual([
      "fileDrop",
      "finePointer",
      "hover",
      "multipleWindows",
      "nativeMenus",
      "nativeWindowControls",
      "physicalKeyboard",
      "systemTray",
      "touchFirst",
    ]);
  });

  it("la shell mobile è touch-first", () => {
    expect(MOBILE_CAPABILITIES.touchFirst).toBe(true);
    expect(DESKTOP_CAPABILITIES.touchFirst).toBe(false);
  });
});

describe("la shell attiva", () => {
  it("senza dichiarazione è il desktop", () => {
    expect(activeShell().id).toBe("desktop");
    expect(platformSupports("multipleWindows")).toBe(true);
  });

  it("la dichiarazione decide le capacità e marca il DOM", () => {
    const desktop = activeShell();
    declareShell({ id: "mobile", capabilities: MOBILE_CAPABILITIES });
    try {
      expect(document.documentElement.dataset.clientShell).toBe("mobile");
      expect(platformSupports("multipleWindows")).toBe(false);
      expect(platformSupports("nativeWindowControls")).toBe(false);
      expect(platformSupports("touchFirst")).toBe(true);
    } finally {
      declareShell(desktop);
    }
    expect(document.documentElement.dataset.clientShell).toBe("desktop");
  });
});
