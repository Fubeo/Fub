// Share sheet / capture mobile: validazione locale, approvazione, invio.
// Stessi limiti del backend (titolo<=512, md<=1MiB, url<=2048, recinto).
// Destinazione: nuova nota, giornaliera, nota esistente, template. Nome, corpo
// e proprietà li decide il comando dell'host `capture.apply`, via bridge.

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
