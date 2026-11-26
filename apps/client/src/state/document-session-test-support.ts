// Gli aiuti condivisi dalle prove di `DocumentSession` (`document-session*.test.ts`).
import { expect, vi } from "vitest";
import { DocumentSessionCollection, type DocumentSessionApi } from "./document-session";
import { operationFromText } from "../editors/core/text-operation";
import type { DocumentSource } from "../host/contract";

export function fakeApi(): DocumentSessionApi {
  const api: DocumentSessionApi = {
    readDocument: vi.fn(async (id): Promise<DocumentSource> => ({ text: `${id}: disco`, revision: "rev-1", format_id: "markdown", source_kind: "text", text_kind: "source" })),
    // L'apertura con chiave legge come la lettura semplice del test corrente,
    // anche quando il test sostituisce `readDocument`.
    openDocument: vi.fn((id: string, _open: string, ...vault: [string?]) => api.readDocument(id, ...vault)),
    writeDocument: vi.fn(async () => "rev-2"),
    resourceWrite: vi.fn(async () => ({ revision: "rev-byte" })),
    saveDraft: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    documentClosed: vi.fn(async () => {}),
  };
  return api;
}

export function acceptText(
  sessions: DocumentSessionCollection,
  id: string,
  text: string,
  surface = "test-surface",
): void {
  const before = sessions.text(id);
  if (before === undefined) throw new Error(`sessione assente: ${id}`);
  expect(
    sessions.acceptSurfaceChange(id, surface, {
      text,
      operation: operationFromText(before, text),
    }),
  ).toEqual({ kind: "accepted" });
}
