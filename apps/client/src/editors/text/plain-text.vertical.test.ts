// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { undoDepth } from "@codemirror/commands";
import {
  bootstrapSurfaceRegistry,
  surfaceRequestForDocument,
} from "../bootstrap";
import type { SurfaceRegistryBootstrap } from "../bootstrap";
import {
  plainTextSurfaceFactory,
  type PlainTextSurface,
  type TextSurfaceMountContext,
} from "./factories";
import { findTextEditorOrThrow } from "./test-support";
import {
  DocumentSessionCollection,
  type DocumentSessionApi,
  type DocumentSurfaceUpdate,
} from "../../state/document-session";
import type { EditorChange } from "./engine";
import type { WriteBase } from "../../host/contract";

interface LocalTextHost {
  readonly files: Map<string, string>;
  readonly writes: Array<{ id: string; text: string; base: WriteBase }>;
  readonly api: DocumentSessionApi;
}

function localTextHost(initial: string): LocalTextHost {
  const files = new Map([["notes/readme.txt", initial]]);
  const writes: Array<{ id: string; text: string; base: WriteBase }> = [];
  let revision = 1;

  return {
    files,
    writes,
    api: {
      async readDocument(id) {
        const text = files.get(id);
        if (text === undefined) throw new Error(`documento assente: ${id}`);
        return { text, revision: `rev-${revision}` };
      },
      async writeDocument(id, text, base) {
        writes.push({ id, text, base });
        files.set(id, text);
        revision += 1;
        return `rev-${revision}`;
      },
      async saveDraft() {},
      async discardDraft() {},
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("vertical slice plain text dal registro alla sessione", () => {
  it("monta .txt senza Markdown, condivide il buffer e salva sul test double locale", async () => {
    const documentId = "notes/readme.txt";
    const initialText = "# Titolo letterale\n[[wiki-link]] #tag\n";
    const expectedText = `${initialText}aggiunta`;
    const host = localTextHost(initialText);
    const sessions = new DocumentSessionCollection(host.api);
    let bootstrap: SurfaceRegistryBootstrap | undefined;

    try {
      const loaded = await sessions.read(documentId);
      expect(loaded).toBe(initialText);
      const owner = sessions.get(documentId);
      if (!owner) throw new Error("sessione plain text non costruita");

      const request = surfaceRequestForDocument(documentId);
      expect(request).toEqual({
        family: "text",
        profile: "plain-text",
        formatKey: "txt",
        species: "text/plain",
      });

      bootstrap = bootstrapSurfaceRegistry();
      expect(bootstrap.registry.resolve(request)).toBe(plainTextSurfaceFactory);

      const parentA = document.createElement("section");
      const parentB = document.createElement("section");
      document.body.append(parentA, parentB);
      const changes: Array<{ surfaceId: string; result: string }> = [];
      let surfaceA!: PlainTextSurface;
      let surfaceB!: PlainTextSurface;

      const mount = (paneId: string, parent: HTMLElement): PlainTextSurface => {
        let surface!: PlainTextSurface;
        const context: TextSurfaceMountContext = {
          paneId,
          documentId,
          parent,
          initialText: loaded,
          onChange: (change: EditorChange) => {
            const outcome = sessions.acceptSurfaceChange(documentId, surface.surfaceId, change);
            changes.push({ surfaceId: surface.surfaceId, result: outcome.kind });
            if (outcome.kind === "realigned") surface.syncDoc(outcome.text);
          },
        };
        surface = bootstrap!.registry.mount(request, context) as PlainTextSurface;
        return surface;
      };

      surfaceA = mount("pane-a", parentA);
      surfaceB = mount("pane-b", parentB);

      const detachA = sessions.attachSurface(documentId, {
        id: surfaceA.surfaceId,
        sync: (update: DocumentSurfaceUpdate) => {
          surfaceA.syncDoc(update.kind === "operation" ? update : update.text);
        },
      });
      const detachB = sessions.attachSurface(documentId, {
        id: surfaceB.surfaceId,
        sync: (update: DocumentSurfaceUpdate) => {
          surfaceB.syncDoc(update.kind === "operation" ? update : update.text);
        },
      });

      const viewA = findTextEditorOrThrow(parentA);
      const viewB = findTextEditorOrThrow(parentB);
      expect(viewA).toBeInstanceOf(EditorView);
      expect(viewB).toBeInstanceOf(EditorView);
      expect(viewA.state.doc.toString()).toBe(initialText);
      expect(viewB.state.doc.toString()).toBe(initialText);
      expect(surfaceA).toMatchObject({ family: "text", profile: "plain-text" });
      expect(surfaceB).toMatchObject({ family: "text", profile: "plain-text" });
      expect(surfaceA).not.toHaveProperty("setSyntaxForms");
      expect(surfaceA).not.toHaveProperty("setLivePreview");
      expect(surfaceB).not.toHaveProperty("setSyntaxForms");
      expect(surfaceB).not.toHaveProperty("setLivePreview");
      expect(parentA.querySelector(".cm-content")).not.toBeNull();
      expect(parentA.querySelector("[class*='cm-fub-']")).toBeNull();

      viewA.dispatch({
        changes: { from: viewA.state.doc.length, insert: "aggiunta" },
      });

      expect(changes).toEqual([{ surfaceId: surfaceA.surfaceId, result: "accepted" }]);
      expect(owner).toBe(sessions.get(documentId));
      expect(sessions.inspect(documentId)).toMatchObject({
        text: expectedText,
        dirty: true,
      });
      expect(surfaceA.currentText()).toBe(expectedText);
      expect(surfaceB.currentText()).toBe(expectedText);
      expect(undoDepth(viewA.state)).toBe(1);
      expect(undoDepth(viewB.state)).toBe(0);

      await expect(sessions.flush(documentId)).resolves.toBe(false);
      expect(host.files.get(documentId)).toBe(expectedText);
      expect(host.writes).toHaveLength(1);
      expect(host.writes[0]).toMatchObject({ id: documentId, text: expectedText });
      expect(sessions.inspect(documentId)).toMatchObject({
        text: expectedText,
        dirty: false,
      });

      detachA();
      detachB();
      bootstrap.dispose();
      expect(() => findTextEditorOrThrow(parentA)).toThrow();
      expect(() => findTextEditorOrThrow(parentB)).toThrow();
      expect(document.querySelectorAll(".cm-editor")).toHaveLength(0);
    } finally {
      bootstrap?.dispose();
      sessions.close(documentId);
    }
  });
});
