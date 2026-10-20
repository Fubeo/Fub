// @vitest-environment happy-dom
// La tela su file CRLF e con BOM (#97): le modifiche non spariscono e il file
// tiene i suoi terminatori e il suo BOM.
import { describe, expect, it, vi } from "vitest";
import { DocumentSessionCollection, type DocumentSessionApi } from "../../state/document-session";
import { parseCanvas } from "./model";
import {
  commitCanvasPatches,
  invertCanvasOperation,
  removeEdgePatch,
  removeNodePatch,
  upsertEdgePatch,
  upsertNodePatch,
  type CanvasPatch,
} from "./operation";
import { CanvasEngine } from "./engine";
import { sameCanvasModel } from "./source-edit";

const LF = '{\n  "nodes": [\n    {"id":"a","type":"text","x":0,"y":0,"width":200,"height":100,"text":"uno"},\n    {"id":"b","type":"text","x":300,"y":0,"width":200,"height":100,"text":"due"}\n  ],\n  "edges": [\n    {"id":"e","fromNode":"a","toNode":"b"}\n  ]\n}\n';
const VARIANTS: Record<string, string> = {
  LF,
  CRLF: LF.replace(/\n/g, "\r\n"),
  BOM: `﻿${LF}`,
  "BOM+CRLF": `﻿${LF.replace(/\n/g, "\r\n")}`,
};

type Change = (doc: ReturnType<typeof parseCanvas>) => CanvasPatch[];
const CHANGES: Record<string, Change> = {
  "sposta una card": (doc) => [upsertNodePatch(doc, { ...doc.nodes[1]!, x: 888 })!],
  "aggiunge una card": (doc) => [upsertNodePatch(doc, { id: "c", type: "text", x: 0, y: 300, width: 100, height: 50, text: "tre" })!],
  "toglie un arco e una card": (doc) => [removeEdgePatch(doc, "e")!, removeNodePatch({ ...doc, edges: [] }, "b")!],
  "aggiunge un arco": (doc) => [upsertEdgePatch(doc, { id: "f", fromNode: "b", toNode: "a" })!],
};

async function session(original: string): Promise<DocumentSessionCollection> {
  const api: DocumentSessionApi = {
    readDocument: async () => ({ text: original, revision: "rev-1", format_id: "canvas", source_kind: "text" }),
    writeDocument: async () => ({ revision: "rev-2" }) as never,
    resourceWrite: async () => { throw new Error("non a byte"); },
    saveDraft: async () => {},
    discardDraft: async () => {},
  };
  const sessions = new DocumentSessionCollection(api);
  await sessions.read("board.canvas");
  return sessions;
}

describe("la tela su CRLF e BOM", () => {
  for (const [variant, original] of Object.entries(VARIANTS)) {
    it(`${variant}: si apre`, () => {
      expect(parseCanvas(original).nodes.map((node) => node.id)).toEqual(["a", "b"]);
    });

    for (const [name, change] of Object.entries(CHANGES)) {
      it(`${variant}: ${name}, la sessione accetta e il file tiene terminatori e BOM; l'annulla torna al modello di prima`, async () => {
        const timer = vi.spyOn(window, "setTimeout").mockImplementation(() => 1);
        try {
          const sessions = await session(original);
          const doc = parseCanvas(original);
          const committed = commitCanvasPatches(doc, original, change(doc))!;
          expect(committed).not.toBeNull();
          const result = sessions.acceptSurfaceChange("board.canvas", "canvas-a", { text: committed.source, operation: committed.operation });
          expect(result).toEqual({ kind: "accepted" });
          expect(sessions.inspect("board.canvas")).toMatchObject({ text: committed.source, dirty: true });
          expect(committed.source.startsWith("﻿")).toBe(original.startsWith("﻿"));
          if (original.includes("\r\n")) expect(committed.source.replace(/\r\n/g, "")).not.toContain("\n");
          else expect(committed.source).not.toContain("\r");
          // L'annulla: l'operazione inversa torna al testo di prima, accettata.
          const undo = parseCanvas(committed.source);
          const back = commitCanvasPatches(undo, committed.source, invertCanvasOperation(committed.operation).patches)!;
          // Una card tolta torna come oggetto, non con gli spazi che aveva:
          // il modello è quello di prima, e il file non mescola terminatori.
          expect(sameCanvasModel(parseCanvas(back.source), parseCanvas(original))).toBe(true);
          expect(back.source.startsWith("\ufeff")).toBe(original.startsWith("\ufeff"));
          if (original.includes("\r\n")) expect(back.source.replace(/\r\n/g, "")).not.toContain("\n");
          expect(sessions.acceptSurfaceChange("board.canvas", "canvas-a", { text: back.source, operation: back.operation })).toEqual({ kind: "accepted" });
        } finally {
          timer.mockRestore();
        }
      });
    }

    it(`${variant}: una superficie pari riceve l'operazione e il testo`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const peer = new CanvasEngine(host, {
        surfaceId: "peer",
        formatId: "canvas",
        revision: "rev-1",
        documentId: "board.canvas",
        onChange: () => {},
        onSelectionChange: () => {},
        onOpenWikilink: () => {},
        onOpenPath: () => {},
        onCreateNote: () => {},
        media: { openExternal: () => {} },
        renderMarkdownForCard: () => () => {},
      } as never);
      peer.setDoc(original);
      const doc = parseCanvas(original);
      const committed = commitCanvasPatches(doc, original, CHANGES["sposta una card"]!(doc))!;
      peer.syncDoc({ text: committed.source, operation: committed.operation });
      expect(peer.getDoc()).toBe(committed.source);
      peer.destroy();
      host.remove();
    });
  }
});
