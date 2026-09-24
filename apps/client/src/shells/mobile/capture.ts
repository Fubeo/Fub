// Share sheet / capture mobile: validazione locale, approvazione, invio.
// Stessi limiti del backend (titolo<=512, md<=1MiB, url<=2048, recinto).
// Destinazione: nuova nota, giornaliera, nota esistente, segnalibro, template.

import { api } from "../../host/ipc";
import { notesByName } from "../../host/query";
import { COMMANDS } from "../../host/contract";
import type { MobileBridge, MobileCapturePayload } from "./bridge";

export type CaptureMode = "create" | "append" | "prepend" | "daily";

export interface CaptureDraft {
  title: string;
  markdown: string;
  sourceUrl?: string;
  folder?: string;
  note?: string;
  mode: CaptureMode;
  template?: string;
  bookmark?: boolean;
}

export interface CaptureValidation {
  ok: boolean;
  reason?: string;
}

const TITLE_MAX = 512;
const MARKDOWN_MAX = 1024 * 1024;

export function validateCaptureLocal(draft: CaptureDraft): CaptureValidation {
  if (draft.title.trim().length === 0) return { ok: false, reason: "capture.title" };
  if (draft.title.length > TITLE_MAX) return { ok: false, reason: "capture.title_long" };
  if (draft.title.includes("\n") || draft.title.includes("\r")) {
    return { ok: false, reason: "capture.title" };
  }
  const bytes = new TextEncoder().encode(draft.markdown).length;
  if (draft.markdown.trim().length === 0) return { ok: false, reason: "capture.empty" };
  if (bytes > MARKDOWN_MAX) return { ok: false, reason: "capture.too_large" };
  if ((draft.mode === "append" || draft.mode === "prepend") && !draft.note?.trim()) {
    return { ok: false, reason: "capture.note_required" };
  }
  if (draft.sourceUrl) {
    const lower = draft.sourceUrl.toLowerCase();
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      return { ok: false, reason: "capture.url" };
    }
  }
  return { ok: true };
}

export function capturePayload(draft: CaptureDraft): MobileCapturePayload {
  return {
    v: 1,
    title: draft.title.trim(),
    markdown: draft.markdown,
    ...(draft.sourceUrl ? { source_url: draft.sourceUrl } : {}),
    target: {
      ...(draft.folder?.trim() ? { folder: draft.folder.trim() } : {}),
      ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
      mode: draft.mode,
    },
  };
}

export function captureBody(draft: CaptureDraft): string {
  const head = `# ${draft.title.trim()}\n\n${draft.markdown}`;
  const source = draft.sourceUrl?.trim() ? `\n\nFonte: ${draft.sourceUrl.trim()}` : "";
  const bookmark = draft.bookmark === true ? "\n\n#segnalibro" : "";
  const body = `${head}${source}${bookmark}`;
  return body.endsWith("\n") ? body : `${body}\n`;
}

export async function suggestNotes(query: string): Promise<string[]> {
  const text = query.trim();
  if (text.length === 0) return [];
  try {
    return await notesByName(text, 8);
  } catch {
    return [];
  }
}

export async function submitCaptureViaCommands(
  draft: CaptureDraft,
): Promise<string> {
  const local = validateCaptureLocal(draft);
  if (!local.ok) throw new Error(local.reason ?? "capture.invalid");
  const body = captureBody(draft);
  switch (draft.mode) {
    case "create": {
      const name = draft.note?.trim() ? draft.note.trim() : "Untitled.md";
      const full =
        draft.folder?.trim() && !draft.note?.trim()?.includes("/")
          ? `${draft.folder.trim().replace(/\/+$/g, "")}/${name}`
          : (draft.note?.trim() ?? name);
      if (draft.template?.trim()) {
        const created = await api.invokeCommand("note.from_template", {
          template: draft.template.trim(),
          name: full,
        });
        if (created.effect.kind !== "navigate") throw new Error("capture.no_navigate");
        const doc = created.effect.doc;
        const source = await api.readDocument(doc);
        await api.writeDocument(doc, `${source.text}\n\n${body}`, {
          kind: "descends_from",
          value: source.revision,
        });
        return doc;
      }
      const created = await api.invokeCommand(COMMANDS.create, { name: full });
      if (created.effect.kind !== "navigate") throw new Error("capture.no_navigate");
      const doc = created.effect.doc;
      const source = await api.readDocument(doc);
      await api.writeDocument(doc, body, {
        kind: "descends_from",
        value: source.revision,
      });
      return doc;
    }
    case "daily": {
      const opened = await api.invokeCommand("note.daily", {});
      if (opened.effect.kind !== "navigate") throw new Error("capture.no_navigate");
      const doc = opened.effect.doc;
      const source = await api.readDocument(doc);
      const next = source.text.endsWith("\n") ? `${source.text}\n${body}` : `${source.text}\n\n${body}`;
      await api.writeDocument(doc, next, {
        kind: "descends_from",
        value: source.revision,
      });
      return doc;
    }
    case "append":
    case "prepend": {
      const doc = draft.note?.trim() ?? "";
      const source = await api.readDocument(doc);
      const next =
        draft.mode === "append"
          ? source.text.endsWith("\n")
            ? `${source.text}\n${body}`
            : `${source.text}\n\n${body}`
          : `${body}${source.text}`;
      await api.writeDocument(doc, next, {
        kind: "descends_from",
        value: source.revision,
      });
      return doc;
    }
  }
}

export async function submitCaptureViaBridge(
  bridge: MobileBridge,
  draft: CaptureDraft,
  vault?: string,
): Promise<string> {
  const local = validateCaptureLocal(draft);
  if (!local.ok) throw new Error(local.reason ?? "capture.invalid");
  const payload = capturePayload(draft);
  await bridge.validateCapture(payload);
  return bridge.submitCapture(payload, vault, draft.template?.trim() || undefined);
}
