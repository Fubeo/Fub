// Dove finisce un allegato e come lo si nomina (P07/F23).
//
// La cartella e' la chiave `files.attachment-folder` esistente (default
// `attachments`): nessuna nuova impostazione. Le collisioni le risolve il
// kernel (`Workspace::free_name`, forma `foto.png`, `foto 1.png`, …); qui si
// calcola solo il candidato da proporre, mai lo stato del disco. I link sono
// relativi al documento che li ospita (`../allegati/foto.png`), con percent-
// encoding, e conservano il nome originale (`C:\foto\a.png` -> `a.png`).
// Gemello Rust: `sanitize_file_name`, `attachment_candidate`,
// `split_file_name`, `relative_url` in `crates/fub-host/src/resources.rs`.
import type { Lifetime } from "../../ui/lifetime";

export const DEFAULT_ATTACHMENT_FOLDER = "attachments";

export const MAX_FILE_NAME_BYTES = 255;

/** Riduce un nome a un singolo segmento sicuro, o rifiuta con un errore. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base || base === "." || base === ".." || /[\u0000-\u001f\u007f]/.test(base)) {
    throw new Error(`\`${name}\` is not a usable file name`);
  }
  if (new TextEncoder().encode(base).byteLength > MAX_FILE_NAME_BYTES) {
    throw new Error(`\`${name}\` exceeds the ${MAX_FILE_NAME_BYTES}-byte file name limit`);
  }
  return base;
}

/** Divide `foto.png` in nome ed estensione; senza estensione, nome intero. */
export function splitFileName(name: string): { stem: string; ext: string } {
  const cut = name.lastIndexOf(".");
  if (cut > 0 && cut < name.length - 1) {
    const ext = name.slice(cut + 1);
    if (!ext.includes("/")) return { stem: name.slice(0, cut), ext };
  }
  return { stem: name, ext: "" };
}

/** Collision candidate bounded to a single 255-byte filename segment. */
export function attachmentCandidate(dir: string, stem: string, ext: string, n: number): string {
  const suffix = n === 0 ? "" : ` ${n}`;
  const extension = ext ? `.${ext}` : "";
  const encoder = new TextEncoder();
  const available = Math.max(0, MAX_FILE_NAME_BYTES - encoder.encode(suffix + extension).byteLength);
  if (encoder.encode(stem).byteLength <= available) {
    const file = `${stem}${suffix}${extension}`;
    return dir ? `${dir}/${file}` : file;
  }
  let cropped = "";
  let used = 0;
  for (const char of stem) {
    const width = encoder.encode(char).byteLength;
    if (used + width > available) break;
    used += width;
    cropped += char;
  }
  const file = `${cropped}${suffix}${extension}`;
  return dir ? `${dir}/${file}` : file;
}

/** Il link relativo da scrivere in `from` verso `to`, con encoding. */
export function relativeUrl(from: string, to: string): string {
  const fromDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromDir.length &&
    common < toParts.length - 1 &&
    fromDir[common] === toParts[common]
  ) {
    common += 1;
  }
  const ups = fromDir.length - common;
  const rest = toParts.slice(common).map(encodeSegment).join("/");
  return `${"../".repeat(ups)}${rest}`;
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** Il path di deposito per un allegato: cartella fenced + nome sanificato. */
export function attachmentTarget(folder: string, fileName: string): string {
  const trimmed = folder.trim();
  const clean = trimmed.replace(/\/+$/g, "");
  if (trimmed.startsWith("/") || !clean || clean.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\") || /[\u0000-\u001f\u007f]/.test(part))) {
    throw new Error(`\`${folder}\` is not a usable attachment folder`);
  }
  return `${clean}/${sanitizeFileName(fileName)}`;
}

export interface AttachmentReceipt {
  readonly id: string;
  readonly revision: string;
}

export interface AttachmentDeposit {
  /** Must create atomically; an existing path must reject with kind already_exists. */
  write(id: string, bytes: Uint8Array): Promise<AttachmentReceipt>;
  folder: string;
  fromDocument: string;
}

/** Reproposes only on a real atomic collision, never after an ambiguous I/O failure. */
export async function depositAttachment(
  deposit: AttachmentDeposit,
  originalName: string,
  bytes: Uint8Array,
): Promise<{ receipt: AttachmentReceipt; link: string }> {
  const name = sanitizeFileName(originalName);
  const { stem, ext } = splitFileName(name);
  if (bytes.byteLength > 64 * 1024 * 1024) {
    throw new Error(`attachment ${name} exceeds the 67108864-byte inline deposit limit`);
  }
  for (let n = 0; n <= 10_000; n++) {
    const candidate = attachmentTarget(deposit.folder, attachmentCandidate("", stem, ext, n));
    try {
      const receipt = await deposit.write(candidate, bytes);
      return { receipt, link: relativeUrl(deposit.fromDocument, receipt.id) };
    } catch (error) {
      if (!error || typeof error !== "object" || !("kind" in error) || error.kind !== "already_exists") {
        throw error;
      }
    }
  }
  throw new Error(`no free attachment name remains for ${name}`);
}

/** Paste/drop files are deposited only after the user's actual gesture. */
export async function depositFiles(
  files: FileList | readonly File[],
  deposit: AttachmentDeposit,
  onInsert: (links: readonly string[]) => void,
): Promise<void> {
  for (const file of Array.from(files)) {
    if (file.size > 64 * 1024 * 1024) {
      throw new Error(`attachment ${file.name} exceeds the 67108864-byte inline deposit limit`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { link } = await depositAttachment(deposit, file.name, bytes);
    onInsert([link]);
  }
}

/** Scoped paste/drop gestures; the owner must close `life` with the editor. */
export function mountAttachmentDropPaste(
  target: HTMLElement,
  life: Lifetime,
  deposit: AttachmentDeposit,
  onInsert: (links: readonly string[]) => void,
  onError: (error: unknown) => void,
): void {
  const insert = (links: readonly string[]) => { if (!life.closed) onInsert(links); };
  const fail = (error: unknown) => { if (!life.closed) onError(error); };
  life.listen(target, "dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  life.listen(target, "drop", (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    void depositFiles(event.dataTransfer.files, deposit, insert).catch(fail);
  });
  life.listen(target, "paste", (event) => {
    if (!event.clipboardData?.files.length) return;
    event.preventDefault();
    void depositFiles(event.clipboardData.files, deposit, insert).catch(fail);
  });
}

/**
 * Native save performs its own network allowlist check; this gesture check
 * prevents a document or remote page from silently initiating a download.
 */
export async function saveRemoteAttachment(
  url: string,
  allowedHosts: readonly string[],
  consent: boolean,
  save: (url: string) => Promise<AttachmentReceipt>,
  fromDocument: string,
): Promise<string> {
  if (!consent) throw new Error("saving remote content requires an explicit user gesture");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password ||
      !allowedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())) {
    throw new Error("remote attachment origin is not allowlisted");
  }
  const receipt = await save(parsed.href);
  return relativeUrl(fromDocument, receipt.id);
}
