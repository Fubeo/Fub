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
// più, con «Fanne una copia» che copia lo stesso e ripunta le schede del gesto
// (T32b) — e la prima volta che la lavagna copia file dove sono andati, con il
// gesto per cambiare cartella (la voce `canvas.drop_folder`); in una cartella
// esclusa dall'indice, a ogni gesto.
//
// La cartella dove finisce una copia la sceglie `canvas.drop_folder`
// (`dropFolderFor`): quella degli allegati delle note, una accanto alla
// lavagna, o una del vault. Le note non cambiano.
//
// Le dipendenze arrivano da fuori (`document-controller.ts` in produzione,
// porte finte nei test): questo modulo non parla all'host da sé.
import { draggedEntries, ENTRIES_DRAG_TYPE, NOTE_DRAG_TYPE, type DraggedEntry } from "../ui/drag-types";
import { depositAttachment, depositOrReuse, sanitizeFileName, type AttachmentDeposit } from "../editors/media/attachment-target";
import type { CanvasDepositCards, CanvasRepoint } from "../editors/canvas/engine";
import { DROP_FOLDER_KEY, type CanvasPreferences } from "../editors/canvas/preferences";
import { folderContains, nameFault, normalizedName } from "../rules/mirrored";
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

/// Le due impostazioni che scelgono la cartella dei file trascinati, già
/// giudicate da `preferencesOf` (un valore rotto vale quello di serie).
export type DropFolderChoice = Pick<CanvasPreferences, "dropFolder" | "dropFolderPath">;

export interface CanvasDepositDeps {
  /// Il deposito degli allegati per la lavagna `documentId`, con la cartella
  /// di `files.attachment-folder` e la scrittura atomica dell'host, che sa
  /// `reuse`. La lavagna ne cambia la cartella con `dropFolder`.
  deposit(documentId: string): Promise<AttachmentDeposit>;
  /// La scelta di `canvas.drop_folder`, letta a ogni trascinamento.
  dropFolder(): Promise<DropFolderChoice>;
  /// Le cartelle che `files.excluded-folders` tiene fuori dal vault.
  excludedFolders(): Promise<readonly string[]>;
  notify(message: string, tone?: "info", action?: NoticeAction): void;
  readState(key: string): Promise<unknown>;
  writeState(key: string, value: unknown): void;
  /// Apre le Impostazioni sulla voce `key`: quella dei file trascinati.
  revealSetting(key: string): void | Promise<void>;
}

/// La cartella dove finiscono le copie dal computer sulla lavagna `documentId`.
/// `notesFolder` è `files.attachment-folder` così com'è, anche `./…`: `notes` la
/// torna intatta, e la segue `folderForNote` come oggi per le note. `board` è la
/// cartella accanto alla lavagna (alla radice, il percorso da sé); `folder` è
/// il percorso dalla radice del vault. Un percorso che la pulizia degli
/// allegati non accetta vale `notesFolder`.
export function dropFolderFor(choice: DropFolderChoice, documentId: string, notesFolder: string): string {
  if (choice.dropFolder === "notes") return notesFolder;
  const typed = cleanFolderPath(choice.dropFolderPath);
  if (typed === null) return notesFolder;
  if (choice.dropFolder === "folder") return typed;
  const own = folderOf(documentId);
  return own === "" ? typed : `${own}/${typed}`;
}

/// Il percorso scritto nelle Impostazioni, con la pulizia degli allegati: i
/// nomi nuovi di `nameFault` (niente `..`, `.fub`, nomi nascosti, caratteri che
/// il sistema si riserva) e ogni pezzo che `sanitizeFileName` torna com'è. Una
/// barra in coda si toglie. `null` se non resta niente.
function cleanFolderPath(typed: string): string | null {
  const path = normalizedName(typed.trim()).replace(/\/+$/, "");
  if (nameFault(path, "new") !== null) return null;
  try {
    return path.split("/").every((part) => sanitizeFileName(part) === part) ? path : null;
  } catch {
    return null;
  }
}

/// Un file del sistema che il vault aveva già: `path` è il file del vault che
/// la scheda mostra, `file` il file trascinato, che «Fanne una copia» rilegge.
interface ReusedFile {
  readonly path: string;
  readonly file: File;
}

/// Deposita i file del sistema nel vault per la lavagna `documentId` e torna
/// i loro id, nell'ordine dei file. Un file che il vault ha già con gli stessi
/// byte si riusa, e l'host lo dice senza scrivere. Alla fine una notifica dice
/// quali sono stati riusati (il percorso, se è uno solo; il numero, se sono
/// di più), con «Fanne una copia» se la lavagna ha dato le sue schede
/// (`cards`); un'altra dice dove sono andati i file copiati, con «Cambia
/// cartella». Le notifiche dicono anche ciò che è stato fatto prima di un
/// errore, che poi risale; dopo un errore le schede non nascono, e la copia
/// non si offre.
export async function depositCanvasFiles(
  files: readonly File[],
  documentId: string,
  deps: CanvasDepositDeps,
  cards?: CanvasDepositCards,
): Promise<string[]> {
  const notes = await deps.deposit(documentId);
  const deposit: AttachmentDeposit = {
    ...notes,
    folder: dropFolderFor(await deps.dropFolder(), documentId, notes.folder),
  };
  const paths: string[] = [];
  const copied: string[] = [];
  const reused: ReusedFile[] = [];
  let done = false;
  try {
    for (const file of files) {
      if (file.size > MAX_DROPPED_BYTES) throw new Error(t("errors.attachment.too_large", { name: file.name }));
      const saved = await depositOrReuse(deposit, file.name, new Uint8Array(await file.arrayBuffer()));
      paths.push(saved.receipt.id);
      if (saved.reused) reused.push({ path: saved.receipt.id, file });
      else copied.push(saved.receipt.id);
    }
    done = true;
  } finally {
    noticeReused(deps, deposit, reused, done ? cards : undefined);
    await noticeCopies(deps, copied);
  }
  return paths;
}

/// La notifica del riuso, e il suo gesto. L'azione vive quanto il toast che la
/// porta (`notify`): il clic la consuma, e chiusa la lavagna non fa niente.
function noticeReused(
  deps: CanvasDepositDeps,
  deposit: AttachmentDeposit,
  reused: readonly ReusedFile[],
  cards: CanvasDepositCards | undefined,
): void {
  if (reused.length === 0) return;
  const one = reused.length === 1;
  const message = one
    ? t("canvas.intake.reused.path", { path: reused[0]!.path })
    : t("canvas.intake.reused", { count: String(reused.length) });
  if (!cards) {
    deps.notify(message);
    return;
  }
  deps.notify(message, "info", {
    label: t(one ? "canvas.intake.copy" : "canvas.intake.copies"),
    run: () => copyReused(deps, deposit, reused, cards),
  });
}

/// «Fanne una copia»: i byte trascinati si depositano senza `reuse`, come una
/// scrittura nuova, con i nomi di `depositAttachment` («foto 1.png» se «foto.png»
/// c'è), e le schede del gesto passano ai file nuovi in un commit solo. Due
/// file trascinati uguali allo stesso file del vault sono una scheda: si copia
/// una volta. Se una copia fallisce, quelle fatte prima si ripuntano e l'errore
/// risale alla notifica. La lavagna chiusa nel frattempo: niente copie, o le
/// copie fatte restano nel vault senza schede che le mostrino.
async function copyReused(
  deps: CanvasDepositDeps,
  deposit: AttachmentDeposit,
  reused: readonly ReusedFile[],
  cards: CanvasDepositCards,
): Promise<void> {
  // Il primo file trascinato per ogni file del vault, nel loro ordine.
  const distinct = reused.filter((item, index) => reused.findIndex((other) => other.path === item.path) === index);
  const changes: CanvasRepoint[] = [];
  try {
    for (const { path, file } of distinct) {
      if (!cards.live()) return;
      const { receipt } = await depositAttachment(deposit, file.name, new Uint8Array(await file.arrayBuffer()));
      changes.push({ from: path, to: receipt.id });
    }
  } finally {
    if (changes.length > 0) {
      cards.repoint(changes);
      await noticeCopies(deps, changes.map((change) => change.to));
    }
  }
}

/// La notifica «Copiati in attachments/», una volta per vault. Uno stato che
/// non si legge vale come «mai vista»: rivederla è meglio che non saperlo. Se la
/// cartella è esclusa dall'indice la notifica lo dice a ogni gesto che ci
/// copia, non solo la prima volta: lì i file non si troveranno con la ricerca.
async function noticeCopies(deps: CanvasDepositDeps, copied: readonly string[]): Promise<void> {
  if (copied.length === 0) return;
  const folder = folderOf(copied[0]!);
  const excluded = await isExcluded(deps, folder);
  if (!excluded) {
    const noticed = await deps.readState(ATTACHMENTS_NOTICED_KEY).catch(() => null);
    if (noticed === true) return;
  }
  const shown = folder === "" ? "/" : `${folder}/`;
  const message = excluded
    ? t("canvas.intake.copied_excluded", { folder: shown })
    : t("canvas.intake.copied", { folder: shown });
  deps.notify(message, "info", {
    label: t("canvas.intake.change_folder"),
    run: () => deps.revealSetting(DROP_FOLDER_KEY),
  });
  deps.writeState(ATTACHMENTS_NOTICED_KEY, true);
}

/// Una cartella è esclusa se sta dentro una cartella che `files.excluded-folders`
/// esclude: si chiede come si chiederebbe di un documento che ci sta dentro.
async function isExcluded(deps: CanvasDepositDeps, folder: string): Promise<boolean> {
  const excluded = await deps.excludedFolders().catch((): readonly string[] => []);
  return excluded.some((item) => folderContains(item, `${folder}/`));
}
