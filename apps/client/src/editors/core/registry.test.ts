// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createDocumentSurfaceRegistry } from "./bootstrap";
import type { EditorSurface, SurfaceFamily, SurfaceFactory } from "./registry";
import { DocumentSurfaceRegistry, SurfaceRegistrationConflict } from "./registry";
import { forwardNotice } from "../../state/kernel";
import { mountStrings } from "../../i18n/strings";

const localeState = vi.hoisted(() => ({ value: "it" }));
vi.mock("../../host/query", () => ({
  settings: async () => [{ spec: { key: "locale.language" }, value: localeState.value }],
}));

function factory(family: SurfaceFamily, destroyed: string[], mountedProfiles: string[]): SurfaceFactory {
  return {
    mount(profile, context): EditorSurface {
      mountedProfiles.push(profile);
      let text = "";
      return {
        family,
        profile,
        surfaceId: `${context.paneId}:${context.documentId}`,
        modes: [
          {
            id: "edit",
            label: () => "Edit",
            presentation: "surface",
            contextMode: "source",
          },
        ],
        setMode: vi.fn(),
        setDoc(value) {
          text = value;
        },
        syncDoc(update) {
          text = typeof update === "string" ? update : update.text;
        },
        getDoc() {
          return text;
        },
        focus: vi.fn(),
        revealByteOffset: vi.fn(),
        selections: vi.fn(),
        setReadOnly: vi.fn(),
        setTheme: vi.fn(),
        destroy() {
          destroyed.push(context.documentId);
        },
      };
    },
  };
}

const mountContext = {
  paneId: "pane-a",
  documentId: "note.md",
  parent: {} as HTMLElement,
};

describe("DocumentSurfaceRegistry", () => {
  it("prefers a valid override, then an exact format, then the source fallback", () => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "core.text",
      family: "text",
      profiles: ["plain-text", "markdown"],
      defaultProfile: "plain-text",
      fallbackProfile: "plain-text",
      factory: factory("text", [], []),
      formats: { markdown: "markdown" },
      sources: { text: "plain-text" },
    });
    registry.register({
      owner: "plugin.grid",
      family: "grid",
      profiles: ["sheet"],
      defaultProfile: "sheet",
      fallbackProfile: "sheet",
      factory: factory("grid", [], []),
    });

    expect(
      registry.resolve({ formatId: "markdown", sourceKind: "text", override: { family: "grid" } }),
    ).toMatchObject({ owner: "plugin.grid", family: "grid", profile: "sheet" });
    expect(registry.resolve({ formatId: "markdown", sourceKind: "text" })).toMatchObject({
      owner: "core.text",
      family: "text",
      profile: "markdown",
    });
    expect(registry.resolve({ formatId: "unknown", sourceKind: "text" })).toMatchObject({
      owner: "core.text",
      family: "text",
      profile: "plain-text",
    });
    expect(
      registry.resolve({
        formatId: "markdown",
        sourceKind: "text",
        override: { family: "text", profile: "not-registered" },
      }),
    ).toMatchObject({
      owner: "core.text",
      family: "text",
      profile: "plain-text",
    });
  });

  it("rejects bindings and fallbacks that name profiles the family did not register", () => {
    const registry = new DocumentSurfaceRegistry();
    const base = {
      owner: "core.text",
      family: "text" as const,
      profiles: ["plain-text"],
      defaultProfile: "plain-text",
      fallbackProfile: "plain-text",
      factory: factory("text", [], []),
    };

    expect(() =>
      registry.register({ ...base, formats: { markdown: "markdown" } }),
    ).toThrow("format binding markdown uses unregistered profile markdown");
    expect(() =>
      registry.register({ ...base, fallbackProfile: "markdown" }),
    ).toThrow("fallback profile markdown is not registered");
  });

  it("routes the fubsheet format to the grid sheet surface", () => {
    const registry = createDocumentSurfaceRegistry({
      onChange: vi.fn(),
      onSelectionChange: vi.fn(),
      onOpenWikilink: vi.fn(),
      onSearchTag: vi.fn(),
      completions: {
        searchNotes: async () => [],
        listTags: async () => [],
      },
    });

    expect(registry.resolve({ formatId: "fubsheet", sourceKind: "text" })).toMatchObject({
      owner: "fub.shell.grid",
      family: "grid",
      profile: "sheet",
    });
  });

  it("ignores an unavailable override instead of leaving the pane empty", () => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "core.text",
      family: "text",
      profiles: ["plain-text", "markdown"],
      defaultProfile: "plain-text",
      fallbackProfile: "plain-text",
      factory: factory("text", [], []),
      sources: { text: "plain-text" },
    });

    expect(
      registry.resolve({
        formatId: "unclaimed",
        sourceKind: "text",
        override: { family: "grid", profile: "sheet" },
      }),
    ).toMatchObject({ family: "text", profile: "plain-text" });
  });

  it.each([
    ["family:text", { family: "text" as const }],
    ["format:markdown", { family: "viewer" as const, formats: { markdown: "other" } }],
    ["source:text", { family: "viewer" as const, sources: { text: "other" } }],
  ])("rejects a %s collision and names both owners", (key, incoming) => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "first.owner",
      family: "text",
      profiles: ["plain-text", "markdown"],
      defaultProfile: "plain-text",
      fallbackProfile: "plain-text",
      factory: factory("text", [], []),
      formats: { markdown: "markdown" },
      sources: { text: "plain-text" },
    });

    expect(() =>
      registry.register({
        owner: "second.owner",
        profiles: ["other"],
        defaultProfile: "other",
        fallbackProfile: "other",
        factory: factory(incoming.family, [], []),
        ...incoming,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SurfaceRegistrationConflict>>({
        key,
        existingOwner: "first.owner",
        incomingOwner: "second.owner",
      }),
    );
  });

  it("unregisters bindings, destroys every owned instance, and falls back", () => {
    const registry = new DocumentSurfaceRegistry();
    const destroyed: string[] = [];
    const profiles: string[] = [];
    const unregisterMarkdown = registry.register({
      owner: "plugin.markdown",
      family: "structured",
      profiles: ["markdown"],
      defaultProfile: "markdown",
      fallbackProfile: "markdown",
      factory: factory("structured", destroyed, profiles),
      formats: { markdown: "markdown" },
    });
    registry.register({
      owner: "core.text",
      family: "text",
      profiles: ["plain-text", "markdown"],
      defaultProfile: "plain-text",
      fallbackProfile: "plain-text",
      factory: factory("text", destroyed, profiles),
      sources: { text: "plain-text" },
    });

    const first = registry.mount({ formatId: "markdown", sourceKind: "text" }, mountContext);
    const second = registry.mount(
      { formatId: "markdown", sourceKind: "text" },
      { ...mountContext, paneId: "pane-b", documentId: "other.md" },
    );
    unregisterMarkdown();

    expect(destroyed).toEqual(["note.md", "other.md"]);
    first.destroy();
    second.destroy();
    expect(destroyed, "destroy after owner unload must be idempotent").toEqual([
      "note.md",
      "other.md",
    ]);
    expect(registry.resolve({ formatId: "markdown", sourceKind: "text" })).toMatchObject({
      owner: "core.text",
      family: "text",
      profile: "plain-text",
    });
    expect(registry.mount({ formatId: "markdown", sourceKind: "text" }, mountContext)).toMatchObject({
      family: "text",
      profile: "plain-text",
    });
  });

  it("uses the explicit error surface only after format and source fallbacks", () => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "core.error",
      family: "error",
      profiles: ["unsupported"],
      defaultProfile: "unsupported",
      fallbackProfile: "unsupported",
      factory: factory("error", [], []),
    });

    expect(registry.resolve({ formatId: null, sourceKind: "bytes" })).toMatchObject({
      owner: "core.error",
      family: "error",
      profile: "unsupported",
    });
  });

  it("rejects and destroys a mounted surface with no declared mode", () => {
    const registry = new DocumentSurfaceRegistry();
    const destroyed: string[] = [];
    const base = factory("text", destroyed, []);
    registry.register({
      owner: "core.text",
      family: "text",
      profiles: ["plain-text", "markdown"],
      defaultProfile: "plain-text",
      fallbackProfile: "plain-text",
      sources: { text: "plain-text" },
      factory: {
        mount(profile, context) {
          return { ...base.mount(profile, context), modes: [] };
        },
      },
    });

    expect(() =>
      registry.mount({ formatId: null, sourceKind: "text" }, mountContext),
    ).toThrow("declares no modes");
    expect(destroyed).toEqual(["note.md"]);
  });
  it("localizes static fallback text and aria labels, then updates live", async () => {
    document.body.replaceChildren();
    localStorage.clear();
    localStorage.setItem("fub.locale.language", "en");
    const stopStrings = mountStrings(() => {});
    const viewerParent = document.createElement("div");
    const errorParent = document.createElement("div");
    document.body.append(viewerParent, errorParent);
    const registry = createDocumentSurfaceRegistry({
      onChange: vi.fn(),
      onSelectionChange: vi.fn(),
      onOpenWikilink: vi.fn(),
      onSearchTag: vi.fn(),
      completions: {
        searchNotes: async () => [],
        listTags: async () => [],
      },
    });
    let viewer: EditorSurface | undefined;
    let error: EditorSurface | undefined;
    try {
      viewer = registry.mount(
        { formatId: null, sourceKind: "bytes" },
        { paneId: "pane-bytes", documentId: "image.bin", parent: viewerParent },
      );
      error = registry.mount(
        { formatId: null, sourceKind: "text", override: { family: "error" } },
        { paneId: "pane-error", documentId: "unknown", parent: errorParent },
      );
      const viewerElement = viewerParent.firstElementChild as HTMLElement;
      const errorElement = errorParent.firstElementChild as HTMLElement;
      expect(viewerElement.textContent).toBe("Binary preview unavailable");
      expect(viewerElement.getAttribute("aria-label")).toBe("Binary preview unavailable");
      expect(errorElement.textContent).toBe("No surface available");
      expect(errorElement.getAttribute("aria-label")).toBe("No surface available");

      const changeLanguage = async (value: string) => {
        localeState.value = value;
        forwardNotice({
          event: { type: "setting_changed", key: "locale.language", scope: "machine" },
          origin: { actor: { kind: "kernel" }, batch: null },
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };

      await changeLanguage("it");
      expect(viewerElement.textContent).toBe("Anteprima binaria non disponibile");
      expect(viewerElement.getAttribute("aria-label")).toBe("Anteprima binaria non disponibile");
      expect(errorElement.textContent).toBe("Nessuna superficie disponibile");
      expect(errorElement.getAttribute("aria-label")).toBe("Nessuna superficie disponibile");

      await changeLanguage("en");
      expect(viewerElement.textContent).toBe("Binary preview unavailable");
      expect(viewerElement.getAttribute("aria-label")).toBe("Binary preview unavailable");

      viewer.destroy();
      viewer = undefined;
      await changeLanguage("it");
      expect(viewerElement.textContent).toBe("Binary preview unavailable");
    } finally {
      viewer?.destroy();
      error?.destroy();
      stopStrings();
      localStorage.clear();
      document.body.replaceChildren();
    }
  });

});
