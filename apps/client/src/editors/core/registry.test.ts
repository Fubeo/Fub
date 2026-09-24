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
      defaultProfile: "plain-text",
      profiles: ["markdown"],
      factory: factory("text", [], []),
      formats: { markdown: "markdown" },
      sources: { text: "plain-text" },
    });
    registry.register({
      owner: "plugin.grid",
      family: "grid",
      defaultProfile: "sheet",
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
  });

  it("rejects bindings to profiles the family did not register", () => {
    const registry = new DocumentSurfaceRegistry();
    expect(() =>
      registry.register({
        owner: "core.text",
        family: "text",
        defaultProfile: "plain-text",
        factory: factory("text", [], []),
        formats: { markdown: "markdown" },
      }),
    ).toThrow("selects unregistered profile markdown");
  });

  it("ignores an override profile the family did not register and uses the registered binding", () => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "core.text",
      family: "text",
      defaultProfile: "plain-text",
      profiles: ["markdown"],
      factory: factory("text", [], []),
      formats: { markdown: "markdown" },
      sources: { text: "plain-text" },
    });

    expect(
      registry.resolve({
        formatId: "markdown",
        sourceKind: "text",
        override: { family: "text", profile: "invented" },
      }),
    ).toMatchObject({ family: "text", profile: "markdown" });
  });

  it("routes the fubsheet format to the grid sheet surface", () => {
    const registry = createDocumentSurfaceRegistry({
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
    });

    expect(registry.resolve({ formatId: "fubsheet", sourceKind: "text" })).toMatchObject({
      owner: "fub.shell.grid",
      family: "grid",
      profile: "sheet",
    });
  });

  it("selects canvas and local media profiles without a network fallback", () => {
    const registry = createDocumentSurfaceRegistry({
      onChange: vi.fn(), onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(),
      onOpenPath: vi.fn(), onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
    expect(registry.resolve({ formatId: "canvas", sourceKind: "text", documentId: "board.canvas" }))
      .toMatchObject({ owner: "fub.shell.canvas", family: "canvas", profile: "canvas" });
    for (const [id, profile] of [
      ["photo.PNG", "media-image"], ["recording.m4a", "media-audio"],
      ["movie.webm", "media-video"], ["report.pdf", "media-pdf"], ["report.pdf#page=3", "media-pdf"],
      ["unknown.bin", "bytes-read-only"],
    ]) {
      expect(registry.resolve({ formatId: null, sourceKind: "bytes", documentId: id }))
        .toMatchObject({ family: "viewer", profile });
    }
    const parent = document.createElement("div");
    const viewer = registry.mount(
      { formatId: null, sourceKind: "bytes", documentId: "photo.PNG" },
      { paneId: "photo", documentId: "photo.PNG", parent },
    );
    expect(parent.querySelector(".document-surface-viewer")?.textContent)
      .toBeTruthy();
    expect(parent.querySelector("img, audio, video, iframe")).toBeNull();
    viewer.destroy();
    const board = registry.mount(
      { formatId: "canvas", sourceKind: "text", documentId: "board.canvas" },
      { paneId: "board", documentId: "board.canvas", parent },
    );
    board.setDoc(JSON.stringify({
      nodes: [{ id: "remote", type: "link", x: 0, y: 0, width: 100, height: 100, url: "https://example.com" }],
      edges: [],
    }));
    expect(parent.querySelector<HTMLButtonElement>(".canvas-open-url")?.disabled).toBe(true);
    expect(parent.querySelector("iframe, video, audio")).toBeNull();
    board.destroy();
  });

  it("keeps unknown canvas fields when an edit flows through the source surface", () => {
    const changes: Array<{ text: string }> = [];
    const registry = createDocumentSurfaceRegistry({
      onChange: (_pane, change) => changes.push(change),
      onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(), onOpenPath: vi.fn(),
      onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
    const parent = document.createElement("div");
    const surface = registry.mount(
      { formatId: "canvas", sourceKind: "text", documentId: "board.canvas" },
      { paneId: "board", documentId: "board.canvas", parent, formatId: "canvas" },
    );
    const original = JSON.stringify({
      nodes: [{ id: "n", type: "text", x: 40, y: 40, width: 100, height: 100, text: "hello", vendorNode: { kept: 1 } }],
      edges: [], vendorRoot: ["preserved"],
    });
    surface.setDoc(original);
    expect(surface.getDoc()).toBe(original);
    const viewport = parent.querySelector<HTMLElement>(".canvas-viewport")!;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(JSON.parse(changes[0]!.text)).toMatchObject({
      vendorRoot: ["preserved"], nodes: [{ x: 48, vendorNode: { kept: 1 } }],
    });
    surface.destroy();
  });

  it("rejects corrupt canvas without changing its source and selects the existing error surface", () => {
    const registry = createDocumentSurfaceRegistry({
      onChange: vi.fn(), onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(),
      onOpenPath: vi.fn(), onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
      completions: { searchNotes: async () => [], listTags: async () => [] },
    });
    const parent = document.createElement("div");
    const board = registry.mount(
      { formatId: "canvas", sourceKind: "text", documentId: "bad.canvas" },
      { paneId: "bad", documentId: "bad.canvas", parent },
    );
    expect(() => board.setDoc("{")).toThrow("canvas JSON");
    expect(board.getDoc()).toBe("");
    board.destroy();
    const failure = registry.mount(
      { formatId: null, sourceKind: "text", override: { family: "error" } },
      { paneId: "bad", documentId: "bad.canvas", parent, errorReason: "canvas JSON non valido" },
    );
    expect(failure.family).toBe("error");
    expect(parent.querySelector('[role="alert"]')?.textContent).toContain("canvas JSON non valido");
    failure.destroy();
  });

  it("closes a media handle when its surface closes during a pending read", async () => {
    let finishRead!: (bytes: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; });
    const close = vi.fn(async () => {});
    const readChunk = vi.fn(() => read);
    const registry = createDocumentSurfaceRegistry({
      onChange: vi.fn(), onSelectionChange: vi.fn(), onOpenWikilink: vi.fn(),
      onOpenPath: vi.fn(), onOpenDocument: vi.fn(), onSearchTag: vi.fn(),
      completions: { searchNotes: async () => [], listTags: async () => [] },
      media: {
        transport: {
          open: async () => ({
            handle: "7", id: "recording.mp3", len: 8,
            mime: "audio/mpeg", kind: "audio", revision: null,
          }),
          read_chunk: readChunk,
          close,
        },
      },
    });
    const parent = document.createElement("div");
    const audio = registry.mount(
      { formatId: null, sourceKind: "bytes", documentId: "recording.mp3" },
      { paneId: "audio", documentId: "recording.mp3", parent },
    );
    await vi.waitFor(() => expect(parent.querySelector(".media-surface")).not.toBeNull());
    await vi.waitFor(() => expect(readChunk).toHaveBeenCalledTimes(1));
    audio.destroy();
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith("7"));
    finishRead(new Uint8Array(8).buffer);
    await Promise.resolve();
    expect(parent.querySelector("audio, video, img")).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores an unavailable override instead of leaving the pane empty", () => {
    const registry = new DocumentSurfaceRegistry();
    registry.register({
      owner: "core.text",
      family: "text",
      defaultProfile: "plain-text",
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
      defaultProfile: "plain-text",
      profiles: ["markdown"],
      factory: factory("text", [], []),
      formats: { markdown: "markdown" },
      sources: { text: "plain-text" },
    });

    expect(() =>
      registry.register({
        owner: "second.owner",
        defaultProfile: "other",
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
      defaultProfile: "markdown",
      factory: factory("structured", destroyed, profiles),
      formats: { markdown: "markdown" },
    });
    registry.register({
      owner: "core.text",
      family: "text",
      defaultProfile: "plain-text",
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
      defaultProfile: "unsupported",
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
      defaultProfile: "plain-text",
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
      onOpenPath: vi.fn(),
      onOpenDocument: vi.fn(),
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
