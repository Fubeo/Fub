// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isModefulSurface, surfaceModeId } from "../core/registry";
import { findTextEditor } from "./test-support";
import {
  markdownSurfaceFactory,
  plainTextSurfaceFactory,
  type TextEditorSurface,
  type TextSurfaceFactory,
} from "./factories";

function declaredMode<Id>(
  surface: { readonly modes: readonly { readonly id: Id }[] },
  id: string,
): Id {
  const mode = surface.modes.find((candidate) => candidate.id === (id as Id));
  if (!mode) throw new Error(`modalità non dichiarata: ${id}`);
  return mode.id;
}

function mountContext(parent: HTMLElement = document.createElement("section")) {
  return { paneId: "pane-1", documentId: "document-1", parent };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("factory testuali del registro", () => {
  it("monta Markdown con catalogo e API Markdown", () => {
    const context = mountContext();
    const surface = markdownSurfaceFactory.mount({ formatKey: "md" }, context);
    const setLivePreview = vi.spyOn(surface, "setLivePreview");

    expect(findTextEditor(context.parent)).not.toBeNull();
    expect(isModefulSurface(surface)).toBe(true);
    expect(markdownSurfaceFactory).not.toHaveProperty("modes");
    expect(markdownSurfaceFactory).not.toHaveProperty("defaultMode");
    expect(surface.modes).toEqual([
      { id: "source", labelKey: "mode.source", hintKey: "mode.source.hint" },
      { id: "live_preview", labelKey: "mode.live", hintKey: "mode.live.hint" },
      { id: "reading", labelKey: "mode.reading", hintKey: "mode.reading.hint" },
    ]);
    expect(surface.defaultMode).toBe("live_preview");
    expect(surface.mode()).toBe("live_preview");
    expect(surface).not.toHaveProperty("live_preview");
    expect(surface).toHaveProperty("setSyntaxForms");
    expect(surface).toHaveProperty("setLivePreview");

    surface.setMode(declaredMode(surface, "source"));
    expect(surface.mode()).toBe("source");
    expect(setLivePreview).toHaveBeenLastCalledWith(false);
    expect(findTextEditor(context.parent)).not.toBeNull();

    surface.setMode(declaredMode(surface, "reading"));
    expect(surface.mode()).toBe("reading");
    expect(setLivePreview).toHaveBeenLastCalledWith(false);
    expect(findTextEditor(context.parent)).not.toBeNull();

    const callsBeforeUnknown = setLivePreview.mock.calls.length;
    // Una chiamata JavaScript può ancora portare un ID fuori catalogo.
    surface.setMode(surfaceModeId("unknown"));
    expect(surface.mode()).toBe("reading");
    expect(setLivePreview.mock.calls).toHaveLength(callsBeforeUnknown);

    surface.setMode(declaredMode(surface, "live_preview"));
    expect(surface.mode()).toBe("live_preview");
    expect(setLivePreview).toHaveBeenLastCalledWith(true);

    surface.setSyntaxForms([]);
    surface.setDoc("# Titolo");
    expect(surface.currentText()).toBe("# Titolo");

    surface.destroy();
  });

  it("monta plain text con il solo catalogo source e senza API Markdown", () => {
    const context = mountContext();
    const surface = plainTextSurfaceFactory.mount({ formatKey: "txt" }, context);

    expect(findTextEditor(context.parent)).not.toBeNull();
    expect(isModefulSurface(surface)).toBe(true);
    expect(plainTextSurfaceFactory).not.toHaveProperty("modes");
    expect(plainTextSurfaceFactory).not.toHaveProperty("defaultMode");
    expect(surface.modes).toEqual([
      { id: "source", labelKey: "mode.source", hintKey: "mode.source.hint" },
    ]);
    expect(surface.defaultMode).toBe("source");
    expect(surface.mode()).toBe("source");
    expect(surface).toMatchObject({ family: "text", profile: "plain-text" });
    expect(surface).not.toHaveProperty("live_preview");
    expect(surface).not.toHaveProperty("setSyntaxForms");
    expect(surface).not.toHaveProperty("setLivePreview");
    surface.setMode(surfaceModeId("live_preview"));
    expect(surface.mode()).toBe("source");
    surface.setMode(surfaceModeId("reading"));
    expect(surface.mode()).toBe("source");
    surface.setDoc("testo senza semantica");
    expect(surface.currentText()).toBe("testo senza semantica");

    surface.destroy();
  });

  it("accetta una factory testuale futura senza API Markdown", () => {
    const formulaSurface: TextEditorSurface = {
      family: "text",
      profile: "formula",
      surfaceId: "formula-surface",
      setDoc: () => {},
      syncDoc: () => {},
      currentText: () => "",
      undo: () => false,
      redo: () => false,
      selections: () => ({
        primary: { start: 0, end: 0, text: "" },
        secondary: [],
      }),
      revealByteOffset: () => {},
      reconfigure: () => {},
      focus: () => {},
      setReadOnly: () => {},
      setTheme: () => {},
      captureViewState: () => ({ version: 1, value: null }),
      restoreViewState: () => {},
      suspend: () => {},
      resume: () => {},
      destroy: () => {},
    };
    const formulaFactory: TextSurfaceFactory = {
      family: "text",
      profile: "formula",
      supportedVersions: [1],
      mount: () => formulaSurface,
    };

    expect(formulaFactory.profile).toBe("formula");
    expect(formulaSurface).not.toHaveProperty("setSyntaxForms");
    expect(formulaSurface).not.toHaveProperty("setLivePreview");
    expect(formulaSurface).not.toHaveProperty("modes");
    expect(formulaSurface).not.toHaveProperty("defaultMode");
    expect(formulaSurface).not.toHaveProperty("mode");
    expect(formulaSurface).not.toHaveProperty("setMode");
    expect(formulaSurface).not.toHaveProperty("live_preview");
});
});
