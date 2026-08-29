// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { findTextEditor } from "./test-support";
import { markdownSurfaceFactory, plainTextSurfaceFactory } from "./factories";

function mountContext(parent: HTMLElement = document.createElement("section")) {
  return { paneId: "pane-1", documentId: "document-1", parent };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("factory testuali del registro", () => {
  it("monta Markdown con un TextEngine reale", () => {
    const context = mountContext();
    const surface = markdownSurfaceFactory.mount({ formatKey: "md" }, context);

    expect(findTextEditor(context.parent)).not.toBeNull();
    surface.setSyntaxForms([]);
    surface.setLivePreview(false);
    surface.setDoc("# Titolo");
    expect(surface.currentText()).toBe("# Titolo");

    surface.destroy();
  });

  it("monta plain text con lo stesso TextEngine e profilo vuoto", () => {
    const context = mountContext();
    const surface = plainTextSurfaceFactory.mount({ formatKey: "txt" }, context);

    expect(findTextEditor(context.parent)).not.toBeNull();
    expect(surface).toMatchObject({ family: "text", profile: "plain-text" });
    surface.setSyntaxForms([]);
    surface.setLivePreview(false);
    surface.setDoc("testo senza semantica");
    expect(surface.currentText()).toBe("testo senza semantica");

    surface.destroy();
  });
});
