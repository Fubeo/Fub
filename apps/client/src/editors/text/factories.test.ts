// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { findTextEditor } from "./test-support";
import {
  markdownSurfaceFactory,
  plainTextSurfaceFactory,
  type TextEditorSurface,
  type TextSurfaceFactory,
} from "./factories";

function mountContext(parent: HTMLElement = document.createElement("section")) {
  return { paneId: "pane-1", documentId: "document-1", parent };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("factory testuali del registro", () => {
  it("monta Markdown con un TextEngine reale e le API Markdown", () => {
    const context = mountContext();
    const surface = markdownSurfaceFactory.mount({ formatKey: "md" }, context);

    expect(findTextEditor(context.parent)).not.toBeNull();
    expect(surface).toHaveProperty("setSyntaxForms");
    expect(surface).toHaveProperty("setLivePreview");
    surface.setSyntaxForms([]);
    surface.setLivePreview(false);
    surface.setDoc("# Titolo");
    expect(surface.currentText()).toBe("# Titolo");

    surface.destroy();
  });

  it("monta plain text senza esporre API Markdown", () => {
    const context = mountContext();
    const surface = plainTextSurfaceFactory.mount({ formatKey: "txt" }, context);

    expect(findTextEditor(context.parent)).not.toBeNull();
    expect(surface).toMatchObject({ family: "text", profile: "plain-text" });
    expect(surface).not.toHaveProperty("setSyntaxForms");
    expect(surface).not.toHaveProperty("setLivePreview");
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
      version: 1,
      mount: () => formulaSurface,
    };

    expect(formulaFactory.profile).toBe("formula");
    expect(formulaSurface).not.toHaveProperty("setSyntaxForms");
    expect(formulaSurface).not.toHaveProperty("setLivePreview");
  });
});
