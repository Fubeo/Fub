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
    const messages: Record<string, Record<string, string>> = {
      it: {
        "viewer.unavailable": "Anteprima binaria non disponibile",
        "surface.unavailable": "Nessuna superficie disponibile",
      },
      en: {
        "viewer.unavailable": "Binary preview unavailable",
        "surface.unavailable": "No surface available",
      },
    };
    return messages[i18n.language]?.[key] ?? key;
  },
}));
// Static import cannot be used here: the module mock must be installed before bootstrap loads.

const { createDocumentSurfaceRegistry } = await import("./bootstrap");

function options() {
  return {
    onChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onOpenWikilink: vi.fn(),
    onOpenPath: vi.fn(),
    onOpenDocument: vi.fn(),
    onSearchTag: vi.fn(),
    completions: {
      searchNotes: async () => [],
      listTags: async () => [],
    },
    evaluateSheet: async () => ({ cells: [], dependencies: [] }),
  };
}

describe("static editor surfaces and language changes", () => {
  it("updates the binary fallback while mounted and stops after destroy", () => {
    i18n.language = "it";
    i18n.listeners.length = 0;
    const parent = document.createElement("div");
    const surface = createDocumentSurfaceRegistry(options()).mount(
      { formatId: null, sourceKind: "bytes" },
      { paneId: "pane", documentId: "asset.bin", parent },
    );
    const element = parent.firstElementChild!;

    expect(element.textContent).toBe("Anteprima binaria non disponibile");
    expect(element.getAttribute("role")).toBe("document");

    i18n.language = "en";
    for (const listener of [...i18n.listeners]) listener();
    expect(element.textContent).toBe("Binary preview unavailable");

    const queued = [...i18n.listeners];
    surface.destroy();
    i18n.language = "it";
    for (const listener of queued) listener();
    expect(element.textContent).toBe("Binary preview unavailable");
  });

  it("localizes the no-surface error fallback", () => {
    i18n.language = "it";
    i18n.listeners.length = 0;
    const parent = document.createElement("div");
    const surface = createDocumentSurfaceRegistry(options()).mount(
      { formatId: null, sourceKind: "bytes", override: { family: "error" } },
      { paneId: "pane", documentId: "asset.bin", parent },
    );
    const element = parent.firstElementChild!;

    expect(element.textContent).toBe("Nessuna superficie disponibile");
    expect(element.getAttribute("role")).toBe("alert");

    i18n.language = "en";
    for (const listener of [...i18n.listeners]) listener();
    expect(element.textContent).toBe("No surface available");
    surface.destroy();
  });
});
