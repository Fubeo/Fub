// Dove finisce un allegato e come lo si nomina (P07/F23).
//
// La cartella e' la chiave `files.attachment-folder` esistente (default
// `attachments`): nessuna nuova impostazione. Con `./` davanti segue la nota
// (`folderForNote`). Le collisioni le risolve il
// kernel (`Workspace::free_name`, forma `foto.png`, `foto 1.png`, …); qui si
// calcola solo il candidato da proporre, mai lo stato del disco. I link sono
// relativi al documento che li ospita (`../allegati/foto.png`), con percent-
// encoding, e conservano il nome originale (`C:\foto\a.png` -> `a.png`).
// Gemello Rust: `sanitize_file_name`, `attachment_candidate`,
// `split_file_name`, `relative_url` in `crates/fub-host/src/resources.rs`.
import type { Lifetime } from "../../ui/lifetime";
import type { ResourceWriteOptions } from "../../host/contract";
import { t } from "../../i18n/strings";
import { folderForNote } from "../../rules/mirrored";

export const DEFAULT_ATTACHMENT_FOLDER = "attachments";

export const MAX_FILE_NAME_BYTES = 255;

/** Riduce un nome a un singolo segmento sicuro, o rifiuta con un errore. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base || base === "." || base === ".." || /[\u0000-\u001f\u007f]/.test(base)) {
    throw new Error(t("errors.attachment.bad_name", { name }));
  }
  if (new TextEncoder().encode(base).byteLength > MAX_FILE_NAME_BYTES) {
    throw new Error(t("errors.attachment.long_name", { name, limit: String(MAX_FILE_NAME_BYTES) }));
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
    throw new Error(t("errors.attachment.bad_folder", { folder }));
  }
  return `${clean}/${sanitizeFileName(fileName)}`;
}

export interface AttachmentReceipt {
  readonly id: string;
  readonly revision: string;
}

/** La ricevuta di una scrittura. `reused` vero vuol dire che l'host non ha
 *  scritto: il vault aveva già questi byte (`options.reuse`), e `id` e
 *  `revision` sono quelli del file che c'era. */
export interface AttachmentWrite extends AttachmentReceipt {
  readonly reused?: boolean;
}

export interface AttachmentDeposit {
  /** Must create atomically; an existing path must reject with kind already_exists.
   *  Con `options.reuse` l'host può rispondere col file che ha già questi byte. */
  write(id: string, bytes: Uint8Array, options?: ResourceWriteOptions): Promise<AttachmentWrite>;
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
    throw new Error(t("errors.attachment.too_large", { name }));
  }
  // Una cartella con `./` segue la nota, e per una nota nella radice è la
  // radice stessa.
  const folder = folderForNote(deposit.folder, deposit.fromDocument);
  const atRoot = folder === "" && deposit.folder.trim().startsWith(".");
  for (let n = 0; n <= 10_000; n++) {
    const file = attachmentCandidate("", stem, ext, n);
    const candidate = atRoot ? sanitizeFileName(file) : attachmentTarget(folder, file);
    try {
      const receipt = await deposit.write(candidate, bytes);
      return { receipt, link: relativeUrl(deposit.fromDocument, receipt.id) };
    } catch (error) {
      if (!error || typeof error !== "object" || !("kind" in error) || error.kind !== "already_exists") {
        throw error;
      }
    }
  }
  throw new Error(t("errors.attachment.no_name", { name }));
}

/// Il deposito della lavagna (D-3, G2 di `lavagna.md`). Chiede all'host di
/// depositare con `reuse: "same-content"`: se il vault ha già questi byte, con
/// qualsiasi nome, l'host risponde col file che c'è (`reused`) e non scrive;
/// altrimenti scrive al candidato, come `depositAttachment`. Il client non
/// legge i file del vault per confrontarli: il confronto è dell'host, che lo
/// fa prima di rispondere e, nel dubbio, scrive. I candidati sono quelli di
/// `depositAttachment` («foto.png», «foto 1.png», …): un `already_exists`
/// passa al successivo, ogni altro errore dell'host (un nome che il vault
/// rifiuta, l'I/O) risale. Le note e il registratore restano su
/// `depositAttachment`.
export async function depositOrReuse(
  deposit: AttachmentDeposit,
  originalName: string,
  bytes: Uint8Array,
): Promise<{ receipt: AttachmentReceipt; reused: boolean }> {
  const name = sanitizeFileName(originalName);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(t("errors.attachment.too_large", { name }));
  }
  for (const candidate of attachmentCandidates(deposit, name)) {
    try {
      const written = await deposit.write(candidate, bytes, { reuse: "same-content" });
      return { receipt: { id: written.id, revision: written.revision }, reused: written.reused === true };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  throw new Error(t("errors.attachment.no_name", { name }));
}

/// Il tetto di un allegato, lo stesso di `depositAttachment` e dell'host.
const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

/// I path da proporre per `name`, nell'ordine di `depositAttachment`.
function* attachmentCandidates(deposit: AttachmentDeposit, name: string): Generator<string> {
  const { stem, ext } = splitFileName(name);
  const folder = folderForNote(deposit.folder, deposit.fromDocument);
  const atRoot = folder === "" && deposit.folder.trim().startsWith(".");
  for (let n = 0; n <= 10_000; n++) {
    const file = attachmentCandidate("", stem, ext, n);
    yield atRoot ? sanitizeFileName(file) : attachmentTarget(folder, file);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "kind" in error && error.kind === "already_exists";
}

/** Paste/drop files are deposited only after the user's actual gesture. */
export async function depositFiles(
  files: FileList | readonly File[],
  deposit: AttachmentDeposit,
  onInsert: (links: readonly string[]) => void,
): Promise<void> {
  for (const file of Array.from(files)) {
    if (file.size > 64 * 1024 * 1024) {
      throw new Error(t("errors.attachment.too_large", { name: file.name }));
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
  if (!consent) throw new Error(t("errors.attachment.needs_gesture"));
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password ||
      !allowedHosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())) {
    throw new Error(t("errors.attachment.origin"));
  }
  const receipt = await save(parsed.href);
  return relativeUrl(fromDocument, receipt.id);
}
