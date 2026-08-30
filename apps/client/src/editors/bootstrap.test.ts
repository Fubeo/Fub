// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapSurfaceRegistry,
  surfaceRequestForDocument,
} from "./bootstrap";
import type { TextSurfaceMountContext } from "./text/factories";
import factoriesSource from "./text/factories.ts?raw";

function mountContext(parent: HTMLElement = document.createElement("section")) {
  return { paneId: "pane-1", documentId: "document-1", parent };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("bootstrap del registro delle superfici", () => {
  it("registra Markdown sui binding formatKey e species", () => {
    const surfaces = bootstrapSurfaceRegistry();

    const markdownByFormat = surfaces.registry.select({ formatKey: "md" });
    const markdownBySpecies = surfaces.registry.select({ species: "text/markdown" });
    expect(markdownByFormat.key).toMatch(/^registration:/);
    expect(markdownBySpecies.key).toBe(markdownByFormat.key);
    const context = mountContext();
    const surface = surfaces.registry.mount(
      { formatKey: "md", species: "text/markdown" },
      context,
    ).surface;

    expect(surface.family).toBe("text");
    expect(context.parent.querySelector(".cm-editor")).not.toBeNull();
    surfaces.dispose();
  });

  it("conserva il contesto di mount testuale privo di servizi Markdown", () => {
    const start = factoriesSource.indexOf("export interface TextSurfaceMountContext");
    const end = factoriesSource.indexOf("export interface TextSurfaceFactoryOptions");
    const mountContextSource = factoriesSource.slice(start, end);
    expect(mountContextSource).not.toContain("markdownCallbacks");
    expect(mountContextSource).not.toContain("completions");

    void ({
      ...mountContext(),
      // @ts-expect-error I callback Markdown appartengono alla factory, non al mount generico.
      markdownCallbacks: { openWikilink: () => {}, searchTag: () => {} },
    } satisfies TextSurfaceMountContext);
    void ({
      ...mountContext(),
      // @ts-expect-error Le sorgenti Markdown appartengono alla factory, non al mount generico.
      completions: { searchNotes: async () => [], listTags: async () => [] },
    } satisfies TextSurfaceMountContext);
  });


  it("registra plain text senza selezionare il profilo Markdown", () => {
    const surfaces = bootstrapSurfaceRegistry();

    const plainTextByFormat = surfaces.registry.select({ formatKey: "txt" });
    const plainTextBySpecies = surfaces.registry.select({ species: "text/plain" });
    expect(plainTextByFormat.key).toMatch(/^registration:/);
    expect(plainTextBySpecies.key).toBe(plainTextByFormat.key);
    const context = mountContext();
    const surface = surfaces.registry.mount(
      { formatKey: "txt", species: "text/plain" },
      context,
    ).surface;

    expect(surface.family).toBe("text");
    expect(surface).toMatchObject({ profile: "plain-text" });
    surfaces.dispose();
  });

  it("mappa solo le estensioni Markdown esplicite", () => {
    expect(surfaceRequestForDocument("notes/README.md")).toEqual({
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
    });
    expect(surfaceRequestForDocument("notes/README.markdown")).toEqual({
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
    });
    expect(surfaceRequestForDocument("notes/custom.note")).toEqual({
      family: "text",
      profile: "unknown",
    });
  });

  it("seleziona GridEngine per il formato fubsheet senza passare da Markdown", () => {
    const request = surfaceRequestForDocument("notes/sheet.fubsheet");
    expect(request).toEqual({
      family: "grid",
      profile: "sheet",
      formatKey: "fubsheet",
      species: "text/fubsheet",
      version: 1,
    });
    const surfaces = bootstrapSurfaceRegistry();
    const selected = surfaces.registry.select(request);
    expect(selected.key).toMatch(/^registration:/);
    expect(selected.key).not.toBe(surfaces.registry.select({ formatKey: "md" }).key);
    surfaces.dispose();
  });

  it("mappa txt e text/plain al profilo plain text", () => {
    expect(surfaceRequestForDocument("notes/readme.txt")).toEqual({
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
    });
    expect(surfaceRequestForDocument("notes/readme.text")).toEqual({
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
    });
    expect(surfaceRequestForDocument("notes/readme.plain")).toEqual({
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
    });
    expect(surfaceRequestForDocument("text/plain")).toEqual({
      family: "text",
      profile: "plain-text",
      formatKey: "txt",
      species: "text/plain",
    });
    expect(surfaceRequestForDocument("archive.bin")).toEqual({ species: "bytes" });
  });

  it("dispose rimuove tutti i binding e distrugge le istanze possedute", () => {
    const surfaces = bootstrapSurfaceRegistry();
    const markdownContext = mountContext();
    const plainContext = mountContext();
    const gridContext = mountContext();
    surfaces.registry.mount({ formatKey: "md" }, markdownContext).surface;
    surfaces.registry.mount({ formatKey: "txt" }, plainContext).surface;
    surfaces.registry.mount({ formatKey: "fubsheet" }, gridContext).surface;
    const markdownKey = surfaces.registry.select({ formatKey: "md" }).key;
    const plainTextKey = surfaces.registry.select({ formatKey: "txt" }).key;
    const gridKey = surfaces.registry.select({ formatKey: "fubsheet" }).key;

    surfaces.dispose();

    expect(markdownContext.parent.querySelector(".cm-editor")).toBeNull();
    expect(plainContext.parent.querySelector(".cm-editor")).toBeNull();
    expect(gridContext.parent.querySelector(".grid-surface")).toBeNull();
    expect(surfaces.registry.select({ formatKey: "md" }).key).toBe("builtin:text-fallback");
    expect(surfaces.registry.select({ formatKey: "txt" }).key).toBe("builtin:text-fallback");
    expect(surfaces.registry.select({ formatKey: "fubsheet" }).key).toBe("builtin:text-fallback");
    expect(surfaces.registry.select({ formatKey: "md" }).key).not.toBe(markdownKey);
    expect(surfaces.registry.select({ formatKey: "txt" }).key).not.toBe(plainTextKey);
    expect(surfaces.registry.select({ formatKey: "fubsheet" }).key).not.toBe(gridKey);
    surfaces.dispose();
  });
});
