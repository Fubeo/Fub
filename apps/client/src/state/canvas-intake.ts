// Le porte con cui la lavagna porta dentro note e file (G1 e G2 di
// `riferimenti/lavagna.md`, T10 di N6).
//
// Dall'albero arrivano id del vault, e la lavagna ne fa schede di file: ma un
// trascinamento è un dato che chiunque può scrivere, e una voce dell'albero può
// essere stata cancellata mentre la si trascinava. Si tengono solo gli id che
// l'host conferma, e mai il `text/plain`, che è il testo di un'altra app.
//
// Dal computer arrivano byte, e passano tutti dal deposito degli allegati
// (`depositOrReuse`): un file che il vault ha già, con gli stessi byte e
// qualsiasi nome, si riusa invece di copiarlo due volte. La decisione è
// dell'host (`reuse`): qui il vault non si legge mai per confrontare. Le
// notifiche lo dicono — il percorso se è un file solo, il numero se sono di
// più, e la prima volta che la lavagna copia file dove sono andati, con il
// gesto per cambiare cartella.
//
// Le dipendenze arrivano da fuori (`document-controller.ts` in produzione,
// porte finte nei test): questo modulo non parla all'host da sé.
import { draggedEntries, ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE, type DraggedEntry } from "../ui/drag-types";
import { depositOrReuse, type AttachmentDeposit } from "../editors/media/attachment-target";
import type { NoticeAction } from "../ui/notify";
import { t } from "../i18n/strings";

/// La chiave dello stato di vista che ricorda che la notifica «Copiati in…»
/// è già stata mostrata in questo vault.
export const ATTACHMENTS_NOTICED_KEY = "canvas.attachments-noticed";

/// Il tetto di un file del sistema, lo stesso del deposito e dell'host.
const MAX_DROPPED_BYTES = 64 * 1024 * 1024;

export interface CanvasPathDeps {
  /// Quali di questi documenti esistono, in una domanda sola
  /// (`existingDocuments` di `host/query.ts`).
  existingDocuments(ids: string[]): Promise<Set<string>>;
  /// Le voci (di ogni specie) dei soli figli diretti di `folder`, `""` per la
  /// radice (`vaultEntries` con `within`): serve per i file che non sono
  /// documenti, che l'indice dei documenti non conosce.
  folderEntries(folder: string): Promise<Set<string>>;
}

/// Gli id del vault che un trascinamento interno porta, confermati dall'host,
/// nell'ordine del trascinamento e senza doppioni. Legge `ENTRIES_DRAG_TYPE`
/// o, se manca, `NOTE_DRAG_TYPE`; mai il `text/plain`.
///
/// La conferma costa una domanda per tutte le voci (`existingDocuments`); i
/// file che l'indice dei documenti non conosce (un'immagine, un PDF) si
/// confermano con una domanda per cartella, sulle sole cartelle che restano.
/// Ciò che l'host non conferma, o che non riesce a confermare, si scarta.
export async function resolveCanvasPaths(data: DataTransfer, deps: CanvasPathDeps): Promise<string[]> {
  const entries = draggedFrom(data);
  if (entries.length === 0) return [];
  const ids = [...new Set(entries.map((entry) => entry.id))];
  const confirmed = await deps.existingDocuments(ids).catch(() => new Set<string>());
  const files = new Set(entries.filter((entry) => !entry.note).map((entry) => entry.id));
  const pending = ids.filter((id) => !confirmed.has(id) && files.has(id));
  const byFolder = new Map<string, string[]>();
  for (const id of pending) {
    const folder = folderOf(id);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), id]);
  }
  for (const [folder, inside] of byFolder) {
    const present = await deps.folderEntries(folder).catch(() => new Set<string>());
    for (const id of inside) if (present.has(id)) confirmed.add(id);
  }
  return ids.filter((id) => confirmed.has(id));
}

function draggedFrom(data: DataTransfer): DraggedEntry[] {
  const raw = data.getData(ENTRIES_DRAG_TYPE);
  if (raw) return draggedEntries(raw).filter((entry) => entry.id !== "");
  const note = data.getData(NOTE_DRAG_TYPE);
  return note ? [{ id: note, note: true }] : [];
}

function folderOf(id: string): string {
  const cut = id.lastIndexOf("/");
  return cut < 0 ? "" : id.slice(0, cut);
}

export interface CanvasDepositDeps {
  /// Il deposito degli allegati per la lavagna `documentId` (la cartella di
  /// `files.attachment-folder` e la scrittura atomica dell'host, che sa
  /// `reuse`).
  deposit(documentId: string): Promise<AttachmentDeposit>;
  notify(message: string, tone?: "info", action?: NoticeAction): void;
  readState(key: string): Promise<unknown>;
  writeState(key: string, value: unknown): void;
  /// Apre le Impostazioni sulla cartella dei file trascinati.
  changeFolder(): void | Promise<void>;
}

/// Deposita i file del sistema nel vault per la lavagna `documentId` e torna
/// i loro id, nell'ordine dei file. Un file che il vault ha già con gli stessi
/// byte si riusa, e l'host lo dice senza scrivere. Alla fine una notifica dice
/// quali sono stati riusati (il percorso, se è uno solo; il numero, se sono
/// di più), e la prima volta che la lavagna copia file un'altra dice dove sono
/// andati, con «Cambia cartella». Le notifiche dicono anche ciò che è stato
/// fatto prima di un errore, che poi risale.
export async function depositCanvasFiles(
  files: readonly File[],
  documentId: string,
  deps: CanvasDepositDeps,
): Promise<string[]> {
  const deposit = await deps.deposit(documentId);
  const paths: string[] = [];
  const copied: string[] = [];
  const reused: string[] = [];
  try {
    for (const file of files) {
      if (file.size > MAX_DROPPED_BYTES) throw new Error(t("errors.attachment.too_large", { name: file.name }));
      const saved = await depositOrReuse(deposit, file.name, new Uint8Array(await file.arrayBuffer()));
      paths.push(saved.receipt.id);
      if (saved.reused) reused.push(saved.receipt.id);
      else copied.push(saved.receipt.id);
    }
  } finally {
    if (reused.length === 1) deps.notify(t("canvas.intake.reused.path", { path: reused[0]! }));
    else if (reused.length > 1) deps.notify(t("canvas.intake.reused", { count: String(reused.length) }));
    if (copied.length > 0) await noticeFirstCopy(deps, copied[0]!);
  }
  return paths;
}

/// La notifica «Copiati in attachments/», una volta per vault. Uno stato che
/// non si legge vale come «mai vista»: rivederla è meglio che non saperlo.
async function noticeFirstCopy(deps: CanvasDepositDeps, first: string): Promise<void> {
  const noticed = await deps.readState(ATTACHMENTS_NOTICED_KEY).catch(() => null);
  if (noticed === true) return;
  const folder = folderOf(first);
  deps.notify(t("canvas.intake.copied", { folder: folder === "" ? "/" : `${folder}/` }), "info", {
    label: t("canvas.intake.change_folder"),
    run: () => deps.changeFolder(),
  });
  deps.writeState(ATTACHMENTS_NOTICED_KEY, true);
}
