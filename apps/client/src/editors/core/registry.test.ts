import { describe, expect, it, vi } from "vitest";
import type { EditorSurface, SurfaceFamily, SurfaceFactory } from "./registry";
import { DocumentSurfaceRegistry, SurfaceRegistrationConflict } from "./registry";

function factory(family: SurfaceFamily, destroyed: string[], mountedProfiles: string[]): SurfaceFactory {
  return {
    mount(profile, context): EditorSurface {
      mountedProfiles.push(profile);
      let text = "";
      return {
        family,
        profile,
        surfaceId: `${context.paneId}:${context.documentId}`,
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
});
