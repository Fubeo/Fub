// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapSurfaceRegistry,
  surfaceRequestForDocument,
} from "./bootstrap";
import {
  markdownSurfaceFactory,
  plainTextSurfaceFactory,
} from "./text/factories";
import { textualFallbackFactory } from "./core/registry";

function mountContext(parent: HTMLElement = document.createElement("section")) {
  return { paneId: "pane-1", documentId: "document-1", parent };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("bootstrap del registro delle superfici", () => {
  it("registra Markdown sui binding formatKey e species", () => {
    const surfaces = bootstrapSurfaceRegistry();

    expect(surfaces.registry.resolve({ formatKey: "md" })).toBe(markdownSurfaceFactory);
    expect(surfaces.registry.resolve({ species: "text/markdown" })).toBe(
      markdownSurfaceFactory,
    );
    const context = mountContext();
    const surface = surfaces.registry.mount(
      { formatKey: "md", species: "text/markdown" },
      context,
    );

    expect(surface.family).toBe("text");
    expect(context.parent.querySelector(".cm-editor")).not.toBeNull();
    surfaces.dispose();
  });

  it("registra plain text senza selezionare il profilo Markdown", () => {
    const surfaces = bootstrapSurfaceRegistry();

    expect(surfaces.registry.resolve({ formatKey: "txt" })).toBe(plainTextSurfaceFactory);
    expect(surfaces.registry.resolve({ species: "text/plain" })).toBe(
      plainTextSurfaceFactory,
    );
    const context = mountContext();
    const surface = surfaces.registry.mount(
      { formatKey: "txt", species: "text/plain" },
      context,
    );

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

  it("non interpreta fubsheet gestita da un provider come Markdown", () => {
    // `handledExtensions` appartiene al registro dei provider, non alla
    // richiesta derivata dal path: anche con `fubsheet` dichiarata resta
    // sconosciuta e il registry sceglie il proprio fallback testuale.
    const handledExtensions = ["fubsheet"];
    expect(handledExtensions).toContain("fubsheet");
    const request = surfaceRequestForDocument("notes/sheet.fubsheet");

    expect(request).toEqual({ family: "text", profile: "unknown" });
    expect(request).not.toEqual({
      family: "text",
      profile: "markdown",
      formatKey: "md",
      species: "text/markdown",
    });
    const surfaces = bootstrapSurfaceRegistry();
    expect(surfaces.registry.resolve(request)).toBe(textualFallbackFactory);
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

  it("dispose rimuove entrambi i binding e distrugge le istanze possedute", () => {
    const surfaces = bootstrapSurfaceRegistry();
    const markdownContext = mountContext();
    const plainContext = mountContext();
    surfaces.registry.mount({ formatKey: "md" }, markdownContext);
    surfaces.registry.mount({ formatKey: "txt" }, plainContext);

    surfaces.dispose();

    expect(markdownContext.parent.querySelector(".cm-editor")).toBeNull();
    expect(plainContext.parent.querySelector(".cm-editor")).toBeNull();
    expect(surfaces.registry.resolve({ formatKey: "md" })).not.toBe(markdownSurfaceFactory);
    expect(surfaces.registry.resolve({ formatKey: "txt" })).not.toBe(plainTextSurfaceFactory);
    surfaces.dispose();
  });
});
