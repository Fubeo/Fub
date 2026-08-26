import { describe, expect, it } from "vitest";

import {
  DESKTOP_CAPABILITIES,
  MOBILE_CAPABILITIES,
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
