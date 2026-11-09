import { describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ language: "it" }));
vi.mock("../../i18n/strings", () => ({ resolvedLanguage: () => world.language }));

import { formatBytes } from "./media-types";

describe("formatBytes", () => {
  it("in italiano la virgola, in inglese il punto", () => {
    world.language = "it";
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2,4 MiB");
    expect(formatBytes(1536)).toBe("1,5 KiB");
    world.language = "en";
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
  });

  it("sotto il KiB i byte interi, senza decimali", () => {
    world.language = "it";
    expect(formatBytes(512)).toBe("512 B");
  });

  it("un valore tondo tiene la sua cifra decimale, come prima", () => {
    world.language = "it";
    expect(formatBytes(12 * 1024)).toBe("12,0 KiB");
  });
});
