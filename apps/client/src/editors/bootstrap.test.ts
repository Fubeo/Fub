// @vitest-environment happy-dom
import {
  closeCompletion,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapSurfaceRegistry,
  surfaceRequestForDocument,
} from "./bootstrap";
import type {
  MarkdownEditorSurface,
  TextSurfaceMountContext,
} from "./text/factories";
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
    );

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

  it("consegna alla factory Markdown configurata i servizi della composizione", async () => {
    const openWikilink = vi.fn();
    const searchTag = vi.fn();
    const searchNotes = vi.fn(async () => ["Alpha.md"]);
    const listTags = vi.fn(async () => [{ name: "beta", count: 1 }]);
    const surfaces = bootstrapSurfaceRegistry({
      markdown: {
        callbacks: { openWikilink, searchTag },
        completions: { searchNotes, listTags },
      },
    });
    const parent = document.createElement("section");

    try {
      const markdown = surfaces.registry.mount(
        { formatKey: "md" },
        mountContext(parent),
      ) as MarkdownEditorSurface;
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("la superficie Markdown non è montata");

      markdown.setDoc("[[Al");
      view.dispatch({ selection: EditorSelection.cursor(markdown.currentText().length) });
      expect(startCompletion(view)).toBe(true);
      await vi.waitFor(() => {
        expect(searchNotes).toHaveBeenCalledWith("Al");
        expect(currentCompletions(view.state).map((option) => option.label)).toContain("Alpha");
      });
      closeCompletion(view);

      markdown.setDoc("nota #be");
      view.dispatch({ selection: EditorSelection.cursor(markdown.currentText().length) });
      expect(startCompletion(view)).toBe(true);
      await vi.waitFor(() => {
        expect(listTags).toHaveBeenCalled();
        expect(currentCompletions(view.state).map((option) => option.label)).toContain("#beta");
      });

      markdown.setDoc("[[Alpha]] #beta\ncursor");
      view.dispatch({ selection: EditorSelection.cursor(markdown.currentText().length) });
      const wikilink = parent.querySelector<HTMLElement>(".cm-fub-wikilink");
      const tag = parent.querySelector<HTMLElement>(".cm-fub-tag");
      expect(wikilink).not.toBeNull();
      expect(tag).not.toBeNull();
      wikilink?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, ctrlKey: true }),
      );
      tag?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      expect(openWikilink).toHaveBeenCalledWith("Alpha", null, null);
      expect(searchTag).toHaveBeenCalledWith("beta");
    } finally {
      surfaces.dispose();
    }
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
    expect(surfaces.registry.select(request).key).toBe("builtin:text-fallback");
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
    const markdownKey = surfaces.registry.select({ formatKey: "md" }).key;
    const plainTextKey = surfaces.registry.select({ formatKey: "txt" }).key;

    surfaces.dispose();

    expect(markdownContext.parent.querySelector(".cm-editor")).toBeNull();
    expect(plainContext.parent.querySelector(".cm-editor")).toBeNull();
    expect(surfaces.registry.select({ formatKey: "md" }).key).toBe("builtin:text-fallback");
    expect(surfaces.registry.select({ formatKey: "txt" }).key).toBe("builtin:text-fallback");
    expect(surfaces.registry.select({ formatKey: "md" }).key).not.toBe(markdownKey);
    expect(surfaces.registry.select({ formatKey: "txt" }).key).not.toBe(plainTextKey);
    surfaces.dispose();
  });
});
