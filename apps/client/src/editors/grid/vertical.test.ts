// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapSurfaceRegistry,
  surfaceRequestForDocument,
  type SurfaceRegistryBootstrap,
} from "../bootstrap";
import {
  DocumentSessionCollection,
  type DocumentSessionApi,
  type DocumentSurfaceUpdate,
} from "../../state/document-session";
import type { WriteBase } from "../../host/contract";
import { serializeWorkbook } from "./codec";
import type { GridDocumentChange } from "./engine";
import type { GridEditorSurface, GridSurfaceMountContext } from "./factory";
import { DEFAULT_CELL_STYLE, type GridWorkbook } from "./model";

function initialWorkbook(): GridWorkbook {
  return {
    id: "workbook-1",
    metadata: {},
    sheets: [
      {
        id: "sheet-1",
        name: "Foglio 1",
        metadata: {},
        rows: [{ id: "row-1" }, { id: "row-2" }],
        columns: [{ id: "column-1" }, { id: "column-2" }],
        cells: [
          {
            row: "row-1",
            column: "column-1",
            input: "1",
            style: DEFAULT_CELL_STYLE,
          },
          {
            row: "row-2",
            column: "column-1",
            input: "=A1+1",
            style: DEFAULT_CELL_STYLE,
          },
        ],
      },
    ],
  };
}

interface LocalSheetHost {
  readonly files: Map<string, string>;
  readonly writes: Array<{ id: string; text: string; base: WriteBase }>;
  readonly api: DocumentSessionApi;
}

function localSheetHost(id: string, initial: string): LocalSheetHost {
  const files = new Map([[id, initial]]);
  const writes: Array<{ id: string; text: string; base: WriteBase }> = [];
  let revision = 1;
  return {
    files,
    writes,
    api: {
      async readDocument(documentId) {
        const text = files.get(documentId);
        if (text === undefined) throw new Error(`documento assente: ${documentId}`);
        return { text, revision: `rev-${revision}` };
      },
      async writeDocument(documentId, text, base) {
        files.set(documentId, text);
        writes.push({ id: documentId, text, base });
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

describe("vertical slice fubsheet dal registry alla DocumentSession", () => {
  it("condivide un solo buffer, non usa host per battuta e salva il workbook serializzato", async () => {
    const documentId = "dati/bilancio.fubsheet";
    const initial = serializeWorkbook(initialWorkbook());
    const host = localSheetHost(documentId, initial);
    const sessions = new DocumentSessionCollection(host.api);
    let bootstrap: SurfaceRegistryBootstrap | undefined;

    try {
      const loaded = await sessions.read(documentId);
      const request = surfaceRequestForDocument(documentId);
      expect(request).toMatchObject({ family: "grid", profile: "sheet", formatKey: "fubsheet" });
      bootstrap = bootstrapSurfaceRegistry();

      const mount = (paneId: string): GridEditorSurface => {
        const parent = document.createElement("section");
        document.body.append(parent);
        let surface!: GridEditorSurface;
        const context: GridSurfaceMountContext = {
          paneId,
          documentId,
          parent,
          initialText: loaded,
          onChange(change: GridDocumentChange) {
            const outcome = sessions.acceptSurfaceChange(documentId, surface.surfaceId, change.edit);
            if (outcome.kind === "realigned") surface.syncDoc(outcome.text);
          },
        };
        surface = bootstrap!.registry.mount(request, context).surface as GridEditorSurface;
        return surface;
      };

      const surfaceA = mount("pane-a");
      const surfaceB = mount("pane-b");
      const detachA = sessions.attachSurface(documentId, {
        id: surfaceA.surfaceId,
        sync(update: DocumentSurfaceUpdate) {
          surfaceA.syncDoc(update.text);
        },
      });
      const detachB = sessions.attachSurface(documentId, {
        id: surfaceB.surfaceId,
        sync(update: DocumentSurfaceUpdate) {
          surfaceB.syncDoc(update.text);
        },
      });

      const gridA = document.querySelectorAll<HTMLElement>("[role='grid']")[0];
      gridA.dispatchEvent(new KeyboardEvent("keydown", { key: "7", bubbles: true }));
      const editorA = document.querySelectorAll<HTMLElement>(".grid-cell-editor .cm-content")[0];
      editorA.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(host.writes).toHaveLength(0);
      expect(surfaceA.currentText()).toBe(surfaceB.currentText());
      expect(sessions.text(documentId)).toBe(surfaceA.currentText());
      expect(sessions.inspect(documentId)).toMatchObject({ dirty: true });
      expect(surfaceB.undo()).toBe(false);
      expect(document.querySelectorAll("[role='gridcell']")[0].textContent).toBe("7");
      expect(document.querySelectorAll("[role='gridcell']")[4].textContent).toBe("7");

      await expect(sessions.flush(documentId)).resolves.toBe(false);
      expect(host.writes).toHaveLength(1);
      expect(host.files.get(documentId)).toBe(surfaceA.currentText());
      expect(sessions.inspect(documentId)).toMatchObject({ dirty: false });

      detachA();
      detachB();
      bootstrap.dispose();
      expect(document.querySelectorAll(".grid-surface")).toHaveLength(0);
    } finally {
      bootstrap?.dispose();
      sessions.close(documentId);
    }
  });
});
