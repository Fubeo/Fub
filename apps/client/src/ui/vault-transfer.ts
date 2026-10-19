// Trascinare fra l'explorer e gli altri programmi.
//
// Verso dentro: file e cartelle del sistema lasciati cadere su una cartella
// dell'albero entrano nel vault con la loro struttura, con la scrittura
// «solo creazione» delle risorse (`resource_write`): un nome preso non si
// sovrascrive mai, si sceglie il primo libero (`foto 1.png`, `Viaggio 1/`).
// Ciò che non entra — troppo grande, nome inservibile, scrittura rifiutata —
// torna nell'esito col suo perché: niente si perde in silenzio.
//
// Verso fuori: una voce trascinata porta i suoi file veri come `text/uri-list`
// (`file://` del path sul disco), il path in `text/plain` e, per un file solo,
// `DownloadURL`, che le webview Chromium usano per depositare il file in una
// cartella del sistema. Chi riceve legge il file dal disco: Fub non lo copia.
//
// Qui non si sa niente dell'albero né dell'host: chi chiama passa le porte.
import { attachmentCandidate, sanitizeFileName, splitFileName } from "../editors/media/attachment-target";
import { t } from "../i18n/strings";

/// Il limite di un deposito in linea, lo stesso degli allegati.
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/// Un file arrivato da fuori, col path relativo alla cartella che lo riceve
/// (`Viaggio/foto.png` per una cartella trascinata intera).
export interface DroppedFile {
  readonly path: string;
  readonly file: File;
}

export interface Dropped {
  readonly files: readonly DroppedFile[];
  /// Le cartelle trascinate, anche vuote, coi path relativi.
  readonly folders: readonly string[];
}

/// Ciò che il rilascio porta, cartelle comprese. Le voci si leggono **prima**
/// di ogni attesa: dopo, il `DataTransfer` del rilascio non vale più.
export async function readDropped(data: DataTransfer): Promise<Dropped> {
  const entries = Array.from(data.items ?? [], (item) => item.kind === "file" ? item.webkitGetAsEntry?.() ?? null : null)
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (!entries.length) {
    return { files: Array.from(data.files ?? [], (file) => ({ path: file.name, file })), folders: [] };
  }
  const files: DroppedFile[] = [];
  const folders: string[] = [];
  async function visit(entry: FileSystemEntry, at: string): Promise<void> {
    const path = at ? `${at}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files.push({ path, file });
      return;
    }
    folders.push(path);
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await visit(child, path);
    }
  }
  for (const entry of entries) await visit(entry, "");
  return { files, folders };
}

/// I file scelti col selettore del sistema (`<input type=file>`, anche con
/// `webkitdirectory`): `webkitRelativePath` porta la cartella, se c'è.
export function pickedFiles(files: FileList | readonly File[]): Dropped {
  const list = Array.from(files, (file) => ({ path: file.webkitRelativePath || file.name, file }));
  const folders = new Set<string>();
  for (const { path } of list) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  return { files: list, folders: [...folders] };
}

export interface ImportPorts {
  /// I nomi già presi direttamente sotto una cartella del vault ("" = radice).
  taken(folder: string): Promise<ReadonlySet<string>>;
  /// Crea un file: rifiuta con `already_exists` se il path è preso.
  write(id: string, bytes: Uint8Array): Promise<{ id: string }>;
  /// Crea una cartella vuota (e le madri mancanti).
  createFolder(path: string): Promise<unknown>;
}

export interface ImportOutcome {
  /// I path del vault scritti, nell'ordine.
  readonly imported: readonly string[];
  /// Ciò che non è entrato, col perché.
  readonly skipped: readonly { name: string; reason: string }[];
}

/// Porta nel vault, sotto `folder`, ciò che è stato lasciato cadere. Le voci
/// in cima prendono un nome libero fra quelli della cartella; dentro una
/// cartella appena nata i nomi sono quelli del sistema.
export async function importDropped(
  dropped: Dropped,
  folder: string,
  ports: ImportPorts,
  describe: (error: unknown) => string,
): Promise<ImportOutcome> {
  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const taken = new Set([...(await ports.taken(folder))].map(foldKey));
  // Il nome scelto per ogni voce in cima: un file o una cartella intera.
  const tops = new Map<string, string | null>();
  const topOf = (relative: string): string | null => {
    const top = relative.split("/")[0]!;
    if (tops.has(top)) return tops.get(top)!;
    let chosen: string | null;
    try {
      const name = sanitizeFileName(top);
      const isFolder = relative.includes("/") || dropped.folders.includes(top);
      const { stem, ext } = isFolder ? { stem: name, ext: "" } : splitFileName(name);
      chosen = null;
      for (let n = 0; n <= 10_000 && chosen === null; n++) {
        const candidate = attachmentCandidate("", stem, ext, n);
        if (!taken.has(foldKey(candidate))) chosen = candidate;
      }
      if (chosen === null) throw new Error(t("errors.transfer.no_name", { name }));
      taken.add(foldKey(chosen));
    } catch (error) {
      skipped.push({ name: top, reason: describe(error) });
      chosen = null;
    }
    tops.set(top, chosen);
    return chosen;
  };
  const target = (relative: string): string | null => {
    const parts = relative.split("/");
    const top = topOf(relative);
    if (top === null) return null;
    const rest = parts.slice(1).map((part) => sanitizeFileName(part));
    const path = [top, ...rest].join("/");
    return folder ? `${folder}/${path}` : path;
  };
  for (const { path, file } of dropped.files) {
    let id: string | null;
    try {
      id = target(path);
    } catch (error) {
      skipped.push({ name: path, reason: describe(error) });
      continue;
    }
    if (id === null) continue;
    if (file.size > MAX_IMPORT_BYTES) {
      skipped.push({ name: path, reason: describe(new Error(`${file.size} > ${MAX_IMPORT_BYTES} byte`)) });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      imported.push((await writeFree(ports, id, bytes)).id);
    } catch (error) {
      skipped.push({ name: path, reason: describe(error) });
    }
  }
  // Le cartelle che nessun file ha fatto nascere: vuote nel sistema, vuote qui.
  const made = new Set(imported.flatMap((id) => ancestors(id)));
  for (const relative of dropped.folders) {
    let path: string | null;
    try {
      path = target(relative);
    } catch {
      continue;
    }
    if (path === null || made.has(path)) continue;
    try {
      await ports.createFolder(path);
      made.add(path);
    } catch (error) {
      skipped.push({ name: relative, reason: describe(error) });
    }
  }
  return { imported, skipped };
}

/// Una scrittura che ha trovato il nome preso nel frattempo riprova col
/// successivo libero; ogni altro errore risale.
async function writeFree(ports: ImportPorts, id: string, bytes: Uint8Array): Promise<{ id: string }> {
  const cut = id.lastIndexOf("/");
  const dir = cut === -1 ? "" : id.slice(0, cut);
  const { stem, ext } = splitFileName(id.slice(cut + 1));
  for (let n = 0; n <= 10_000; n++) {
    try {
      return await ports.write(attachmentCandidate(dir, stem, ext, n), bytes);
    } catch (error) {
      if (!error || typeof error !== "object" || !("kind" in error) || error.kind !== "already_exists") throw error;
    }
  }
  throw new Error(t("errors.transfer.no_name", { name: id }));
}

function ancestors(id: string): string[] {
  const parts = id.split("/");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/// Due nomi che un disco senza maiuscole confonderebbe sono lo stesso nome:
/// meglio un `foto 1.png` in più che una scrittura che cade su un altro file.
function foldKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/// L'URL `file://` di una voce del vault, dal path assoluto della radice. Una
/// radice Windows (`C:\…`) diventa `file:///C:/…`; ogni segmento è codificato.
export function fileUrl(root: string, id: string): string {
  const absolute = `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${id}`;
  const drive = /^[A-Za-z]:\//.test(absolute);
  const encoded = absolute.split("/").map((part, i) => (drive && i === 0 ? part : encodeURIComponent(part))).join("/");
  return drive ? `file:///${encoded}` : `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/// Il path di sistema di una voce, con i separatori della radice.
export function systemPath(root: string, id: string): string {
  const windows = /^[A-Za-z]:\\/.test(root) || (root.includes("\\") && !root.includes("/"));
  const base = root.replace(/[\\/]+$/, "");
  return windows ? `${base}\\${id.replace(/\//g, "\\")}` : `${base}/${id}`;
}

const MIME: Record<string, string> = {
  md: "text/markdown", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
};

/// Scrive sul trascinamento ciò che serve a un altro programma per ricevere
/// i file veri. Senza radice (un vault non aperto dal disco) non c'è niente
/// da offrire fuori.
export function offerOutside(data: DataTransfer, root: string | undefined, ids: readonly string[]): void {
  if (!root || !ids.length) return;
  data.setData("text/uri-list", ids.map((id) => fileUrl(root, id)).join("\r\n"));
  data.setData("text/plain", ids.map((id) => systemPath(root, id)).join("\n"));
  if (ids.length === 1) {
    const id = ids[0]!;
    const name = id.slice(id.lastIndexOf("/") + 1);
    const ext = splitFileName(name).ext.toLowerCase();
    data.setData("DownloadURL", `${MIME[ext] ?? "application/octet-stream"}:${name}:${fileUrl(root, id)}`);
  }
}

/// Il rilascio porta file del sistema (e non una voce dell'albero)?
export function carriesFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types ?? []).includes("Files");
}
