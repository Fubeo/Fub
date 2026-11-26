// L'esploratore: copiare, incollare, creare, rinominare, spostare e cestinare note e cartelle.
import { revealSidePanel } from "../ui/side-panels";
import { settings } from "../host/query";
import { COMMANDS } from "../host/contract";
import { saveActiveSpace, saveExpanded, state } from "../state/store";
import {
  createFolder,
  duplicateNote,
  openVaultRoot,
  renameFolder,
  trashFolder,
  undoLastOperation,
  useAsFolderPage,
} from "../state/vault";
import { confirm } from "../platform/confirm";
import { childName, pageName, parentOf } from "../rules/organizer";
import { type MenuItem } from "../ui/menu";
import { showPanel } from "./sidebar";
import { writeClipboardText } from "../platform/clipboard";
import { searchFor } from "../state/search-port";
import { openDocument } from "../state/document-controller";
import { newNoteInActiveSpace } from "../state/new-note";
import { addBookmark, loadBookmarks, type BookmarkTarget } from "../state/bookmarks";
import {
  flushPendingSave,
  renameKeepingBuffer,
  type RenameResult,
} from "../state/document-session";
import { placedTitle, renamedPath as renamedPagePath } from "../state/page-rename";
import { errorText } from "../host/errors";
import { FOLDER_PAGE_STEM, isFolderPage, nameFault, normalizedName } from "../rules/mirrored";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { nameFaultText } from "../ui/name-fault";
import { composingKey } from "../kit/ime";
import {
  FILES_CONFIRM_TRASH,
  entry,
  fileListEl,
  levelWindows,
  newNoteEl,
  refreshFromKernel,
  reopenRename,
  selection,
  startRename,
} from "./explorer";
import { folderRowOf } from "./explorer-rows";
import { markMoving, moving } from "./explorer-drag";

/// I file copiati con Ctrl-C, ciascuno col vault da cui viene: un incolla in
/// un altro vault non troverebbe l'originale.
export let copied: { vault: string | undefined; id: string }[] = [];

/// Le voci scelte se `id` è fra loro, altrimenti `id` da solo.
export function pickedOr(id: string): string[] {
  const picked = selection?.paths() ?? [];
  return picked.includes(id) ? picked : [id];
}

export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/// Copia: niente si scrive finché non si incolla.
export function copyEntries(ids: string[]): void {
  if (ids.length === 0) return;
  const vault = openVaultRoot();
  copied = ids.map((id) => ({ vault, id }));
  notify(t("explorer.copied", { count: String(ids.length) }), "info");
}

/// Incolla nella cartella: ogni file è una copia dei suoi byte, col nome
/// dell'originale se lì è libero. Uno che non riesce non ferma gli altri.
export async function pasteEntries(folder: string): Promise<void> {
  const vault = openVaultRoot();
  const ids = copied.filter((entry) => entry.vault === vault).map((entry) => entry.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    try {
      await duplicateNote(id, folder);
    } catch (error) {
      notify(t("explorer.paste_failed", { name: childName(id), reason: errorText(error) }), "guasto");
    }
  }
}

/// Duplica il file e apre la copia: il nome libero lo sceglie il kernel.
export async function duplicateEntry(id: string): Promise<void> {
  try {
    const copy = await duplicateNote(id);
    if (copy) await openDocument(copy);
  } catch (error) {
    notify(t("explorer.duplicate_failed", { reason: errorText(error) }), "guasto");
  }
}

/// Il percorso della voce relativo al vault, negli appunti.
/// «Segnalibro» dal menu di una riga: carica prima lo stato salvato, così
/// l'aggiunta non parte da una memoria vuota.
export async function bookmarkEntry(target: BookmarkTarget, path: string): Promise<void> {
  await loadBookmarks();
  const title = path.split("/").filter(Boolean).pop() ?? path;
  if (addBookmark(title, target)) notify(t("bookmarks.saved"), "info");
  else notify(t("bookmarks.save_failed"), "guasto");
}

export async function copyPath(path: string): Promise<void> {
  try {
    await writeClipboardText(path);
  } catch {
    // Senza appunti non c'è niente da dire: il gesto è un comodo, non un dato.
  }
}

/// Porta nel pannello Cerca una domanda ristretta alla cartella.
export function searchInFolder(path: string): void {
  revealSidePanel("sidebar");
  showPanel("search");
  searchFor(`folder:"${path.replace(/"/g, "")}" `);
}

export async function newNote(folder: string | null = state.activeSpace): Promise<void> {
  // Il gesto è quello di ogni shell (`state/new-note.ts`): coi tipi nel vault
  // chiede prima il tipo, nel menu sotto «Nuova nota» (E5).
  await newNoteInActiveSpace({
    anchor: newNoteEl,
    folder,
    beforeOpen: () => {
      if (folder && !state.expanded.has(folder)) {
        state.expanded.add(folder);
        saveExpanded();
      }
    },
  });
}

/// Una cartella nuova dentro `parent` ("" è la radice): un campo in cima al
/// livello, lo stesso gesto della rinomina in posto.
///
/// Il nome passa dal kernel (`folder.create`) e non da una regola della shell:
/// recinto, nomi riservati e collisioni hanno un giudice solo, e il rifiuto
/// arriva come errore tipizzato da mostrare. Il campo resta finché il comando
/// non risponde, così un secondo Invio non parte due volte.
export function startNewFolder(parent: string): void {
  // Il campo vive nell'albero: con il pannello chiuso, o su Cerca, finirebbe
  // in una lista nascosta e resterebbe appeso (il menu File lo apre da ovunque).
  revealSidePanel("sidebar");
  showPanel("files");
  const field = document.createElement("input");
  field.className = "new-folder";
  field.setAttribute("aria-label", t("explorer.new_folder"));
  field.placeholder = t("explorer.new_folder");
  const holder = parent ? entry(parent)?.querySelector(":scope > .tree-row") : null;
  if (holder) {
    holder.after(field);
  } else {
    fileListEl.prepend(field);
  }
  field.focus();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    field.remove();
  };
  const confirm = async () => {
    if (closed || field.disabled) return;
    const name = field.value.trim();
    if (!name) return close();
    field.disabled = true;
    const wanted = parent ? `${parent}/${name}` : name;
    try {
      await createFolder(wanted);
      if (parent && !state.expanded.has(parent)) {
        state.expanded.add(parent);
        saveExpanded();
      }
      close();
      await refreshFromKernel(true);
    } catch (e) {
      close();
      notify(t("explorer.new_folder_failed", { folder: wanted, reason: errorText(e) }), "guasto");
    }
  };
  field.addEventListener("keydown", (e) => {
    // Invio ed Esc della composizione scelgono il candidato, non il nome.
    if (composingKey(e)) return;
    if (e.key === "Enter") void confirm();
    else if (e.key === "Escape") close();
  });
  field.addEventListener("blur", () => {
    if (!field.disabled) close();
  });
}

/// Una collisione riapre il campo col nome digitato e la frase accanto: il nome
/// è la cosa da correggere, e chiuderlo la farebbe ridigitare.
export function reportRenameCollision(outcome: RenameResult, typed: string): boolean {
  if (outcome.kind !== "collision") return false;
  reopenRename(
    outcome.from,
    typed,
    t("explorer.rename_failed", {
      doc: outcome.from,
      to: outcome.to,
      reason: t("explorer.destination_open"),
    }),
  );
  return true;
}

/// Il path che una rinomina in posto dà alla voce, con la regola del titolo
/// (`placedTitle`, IMP-2800): un nome semplice resta nella cartella, uno «/»
/// in testa o la cartella stessa in testa partono dalla radice. Una nota
/// tiene la sua estensione.
export function renamedPath(from: string, newName: string, folder = false): string {
  if (folder) return normalizedName(placedTitle(parentOf(from), newName));
  return renamedPagePath(from, newName);
}

/// Il campo del nome sulla riga di una cartella (F2, contestuale): `false` se la
/// riga non c'è.
export function renameFolderRow(path: string): boolean {
  const row = folderRowOf(path);
  if (!row) return false;
  startRename(row, path, undefined, undefined, true);
  return true;
}

/// Rinomina in posto di una cartella: cambia l'ultimo segmento, la madre resta.
/// Il nome passa dalla stessa regola di un nome che nasce, prima del giro IPC.
export async function renameFolderTo(from: string, newName: string, typed: string): Promise<void> {
  const to = renamedPath(from, newName, true);
  const failure = nameFault(to, "new");
  if (failure !== null) {
    reopenRename(from, typed, t("explorer.bad_name", { name: newName, reason: nameFaultText(failure) }), true);
    return;
  }
  const problem = await moveFolder(from, to);
  if (problem !== null) reopenRename(from, typed, problem, true);
}

/// Sposta una cartella dentro un'altra (drag, «Sposta in…»): stesso comando
/// della rinomina, col path intero nuovo.
export async function moveFolderInto(path: string, folderPath: string): Promise<void> {
  if (folderPath === path || folderPath.startsWith(`${path}/`)) return;
  const to = folderPath ? `${folderPath}/${childName(path)}` : childName(path);
  const problem = await moveFolder(path, to);
  if (problem !== null) notify(problem, "guasto");
}

/// `folder.rename`, con ciò che gli serve intorno: i buffer in salvo prima — il
/// kernel riscrive i link entranti di ogni voce che sposta —, il progresso sulla
/// riga, e le cartelle aperte e lo spazio attivo che seguono il path nuovo.
/// Torna il perché di un rifiuto, `null` se è andata.
async function moveFolder(from: string, to: string): Promise<string | null> {
  if (to === from || moving.has(from)) return null;
  if (await ensureSaved()) return t("explorer.folder_move_failed", { folder: from, to, reason: t("explorer.folder_unsaved") });
  moving.add(from);
  markMoving(from, true);
  try {
    const outcome = await renameFolder(from, to);
    followFolder(from, to);
    notify(outcome.notify ?? t("explorer.folder_moved", { folder: from, to }), "info", undoGesture(outcome.undo !== null));
  } catch (e) {
    return t("explorer.folder_move_failed", { folder: from, to, reason: errorText(e) });
  } finally {
    moving.delete(from);
    markMoving(from, false);
  }
  const parent = parentOf(to);
  if (parent) state.expanded.add(parent);
  saveExpanded();
  await refreshFromKernel(true);
  return null;
}

/// Le cartelle aperte, le finestre dei livelli e lo spazio attivo sono stato
/// della shell scritto per path: una cartella che cambia path se li porta
/// dietro, o l'albero si richiuderebbe sotto le mani di chi l'ha spostata.
function followFolder(from: string, to: string): void {
  const moved = (path: string): string | null =>
    path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
  for (const path of [...state.expanded]) {
    const next = moved(path);
    if (next === null) continue;
    state.expanded.delete(path);
    state.expanded.add(next);
  }
  for (const [path, size] of [...levelWindows]) {
    const next = moved(path);
    if (next === null) continue;
    levelWindows.delete(path);
    levelWindows.set(next, size);
  }
  saveExpanded();
  const space = state.activeSpace === null ? null : moved(state.activeSpace);
  if (space !== null) {
    state.activeSpace = space;
    saveActiveSpace();
  }
}

/// Il gesto «Annulla» accanto all'esito di un'operazione sulle cartelle.
function undoGesture(undoable: boolean): { label: string; run: () => void } | undefined {
  if (!undoable) return undefined;
  return {
    label: t("app.undo"),
    run: () => void undoLastOperation().catch((error: unknown) =>
      notify(t("trash.undo_failed", { reason: errorText(error) }), "guasto")),
  };
}

/// Una cartella nel cestino del vault, con tutto ciò che contiene: si chiede,
/// perché sono molte voci con un gesto solo, finché `files.confirm-trash` non
/// è spenta; un'impostazione che non si legge chiede. Il cestino è quello del
/// vault anche quando `files.trash` sceglie il sistema: è da lì che
/// l'annullamento le riporta tutte insieme.
export async function trashFolderWithConfirm(path: string): Promise<void> {
  const ask = await settings()
    .then((entries) => entries.find((entry) => entry.spec.key === FILES_CONFIRM_TRASH)?.value !== false)
    .catch(() => true);
  const ok = !ask || await confirm(t("explorer.folder_trash_confirm", { folder: childName(path) }), {
    title: t("explorer.folder_trash_title"),
    okLabel: t("trash.move"),
  }).catch(() => false);
  if (!ok) return;
  if (await ensureSaved()) return;
  try {
    const outcome = await trashFolder(path);
    notify(outcome.notify ?? t("explorer.folder_trashed", { folder: path }), "info", undoGesture(outcome.undo !== null));
  } catch (e) {
    notify(t("explorer.folder_trash_failed", { folder: path, reason: errorText(e) }), "guasto");
    return;
  }
  await refreshFromKernel(true);
}

/// **Il testo non salvato esce prima**, e se non ce la fa l'operazione non parte.
///
/// Vale per i gesti che **spostano un file**: il kernel, muovendo, riscrive
/// anche i wikilink entranti di file di terzi, e un buffer rimasto sporco li
/// ricoprirebbe col testo di prima al salvataggio successivo. Guarda ogni
/// documento appeso e non solo quello mosso, perché quelli riscritti dal kernel
/// sono gli **altri**: chi ha una battuta non salvata in una nota che cita
/// questa è precisamente chi ci rimette.
///
/// Chi legge un documento — aprirne un altro, un'azione di view — continua a
/// chiamare `flushPendingSave` e a proseguire: lì il testo non salvato resta nel
/// suo buffer, che è sporco, e il tentativo dopo riparte da lì.
export async function ensureSaved(): Promise<boolean> {
  const pending = await flushPendingSave();
  if (pending.length === 0) return false;
  notify(t("document.unsaved_blocks", { doc: pending.join(", ") }), "guasto");
  return true;
}

/// `p/X.md` → `p/X/X.md`: la nota diventa la folder note di una cartella nuova
/// col suo nome. I wikilink entranti li riscrive il rename del kernel; icona e
/// pin migrano sull'evento `document_renamed`, come per ogni rename.
///
/// L'estensione non si sceglie: è quella che la nota ha già (`childName`). Prima
/// era `.md` cablata, che avrebbe cambiato formato a una nota per il solo fatto
/// di spostarla in una cartella.
/// «Usa come pagina della cartella», col titolo del comando registrato: c'è se
/// il comando c'è, e soltanto per una nota dentro una cartella che non ne è
/// già la pagina (decisione 0229).
export function folderPageAction(id: string): MenuItem[] {
  const spec = state.commandSpecs.find((c) => c.id === COMMANDS.folderPage);
  if (!spec || !parentOf(id) || isFolderPage(id)) return [];
  return [{ label: spec.title, run: () => void makeFolderPage(id, spec.title) }];
}

async function makeFolderPage(id: string, title: string): Promise<void> {
  if (await ensureSaved()) return;
  try {
    const outcome = await useAsFolderPage(id);
    if (outcome.notify) notify(outcome.notify, "info", undoGesture(outcome.undo !== null));
  } catch (e) {
    notify(`${title}: ${errorText(e)}`, "guasto");
    return;
  }
  void refreshFromKernel(true);
}

export async function convertToFolder(id: string): Promise<void> {
  // Sposta un file esattamente come la rinomina — è una rinomina — e prima non
  // metteva in salvo niente affatto (difetto 0206).
  if (await ensureSaved()) return;
  const stem = pageName(id);
  const dir = parentOf(id);
  const folderPath = dir ? `${dir}/${stem}` : stem;
  // La nota diventa la **pagina** della cartella nuova, `_index` con la sua
  // estensione (decisione 0229): così la cartella si chiama come lei e i link
  // `[[Nome]]` la trovano ancora.
  const name = childName(id);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  try {
    const outcome = await renameKeepingBuffer(id, `${folderPath}/${FOLDER_PAGE_STEM}${ext}`);
    if (outcome.kind === "collision") {
      notify(t("explorer.to_folder_failed", { doc: id, reason: t("explorer.destination_open") }), "guasto");
      return;
    }
  } catch (e) {
    notify(t("explorer.to_folder_failed", { doc: id, reason: errorText(e) }), "guasto");
    return;
  }
  state.expanded.add(folderPath);
  saveExpanded();
  void refreshFromKernel(true);
}
