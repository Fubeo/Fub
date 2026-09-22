// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

const i18n = vi.hoisted(() => ({
  language: "it",
  listeners: [] as Array<() => void>,
}));

vi.mock("../../i18n/strings", () => ({
  onLanguage(listener: () => void) {
    i18n.listeners.push(listener);
    return () => {
      const index = i18n.listeners.indexOf(listener);
      if (index >= 0) i18n.listeners.splice(index, 1);
    };
  },
  t(key: string) {
    const messages = {
      it: { "grid.surface": "Foglio di calcolo" },
      en: { "grid.surface": "Spreadsheet" },
    } as const;
    return messages[i18n.language as keyof typeof messages]?.[key as "grid.surface"] ?? key;
  },
}));

// Static import cannot be used here: the module mock must be installed before GridEngine loads.
const { GridEngine } = await import("./engine");


describe("GridEngine language changes", () => {
  it("updates the grid ARIA label while mounted and unsubscribes on destroy", () => {
    i18n.language = "it";
    i18n.listeners.length = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const engine = new GridEngine(host, {
      surfaceId: "test",
      onChange: () => {},
      onSelectionChange: () => {},
    });
    const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;

    expect(viewport.getAttribute("aria-label")).toBe("Foglio di calcolo");
    i18n.language = "en";
    for (const listener of [...i18n.listeners]) listener();
    expect(viewport.getAttribute("aria-label")).toBe("Spreadsheet");

    engine.destroy();
    i18n.language = "it";
    for (const listener of [...i18n.listeners]) listener();
    expect(viewport.getAttribute("aria-label")).toBe("Spreadsheet");
  });
});
