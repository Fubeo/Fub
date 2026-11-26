// L'esploratore: dove si rilascia, spostare in una cartella, importare da fuori.
import { saveExpanded, state } from "../state/store";
import { importIntoVault, refreshDocuments } from "../state/vault";
import { carriesFiles, pickedFiles, readDropped, type Dropped } from "../ui/vault-transfer";
import { childName, parentOf } from "../rules/organizer";
import { renameKeepingBuffer } from "../state/document-session";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import type { Lifetime } from "../ui/lifetime";
import {
  cancelHoverOpen,
  drag,
  entry,
  fileListEl,
  filesTitleEl,
  refreshFromKernel,
  scheduleHoverOpen,
  selection,
} from "./explorer";
import { ensureSaved, moveFolderInto } from "./explorer-entries";
import { folderRowOf } from "./explorer-rows";

/// Che gesto sarebbe lasciar cadere qui? `before`/`after` = riordino tra
/// fratelli dello stesso tipo; `into` = nota dentro una cartella (di un'altra
/// cartella); null = niente da fare.
export function dropGesture(
  row: HTMLElement,
  path: string,
  kind: "note" | "folder",
  e: DragEvent,
): "before" | "after" | "into" | null {
  if (!drag || drag.path === path) return null;
  const siblings = drag.kind === kind && drag.parent === parentOf(path);
  // Una cartella entra in un'altra, ma non in sé stessa né in una sua figlia.
  const ownSubtree = drag.group.some((each) => path === each || path.startsWith(`${each}/`));
  const inside = kind === "folder" && drag.parent !== path && !ownSubtree;
  // `offsetY` sarebbe relativo all'elemento più interno sotto il cursore (uno
  // span, magari): la frazione va calcolata sulla riga intera.
  const box = row.getBoundingClientRect();
  const y = (e.clientY - box.top) / box.height;
  if (inside && (!siblings || (y > 0.3 && y < 0.7))) return "into";
  if (siblings) return y < 0.5 ? "before" : "after";
  return null;
}

export function clearDropMarks(): void {
  document
    .querySelectorAll(".drop-before, .drop-after, .drop-into")
    .forEach((el) => el.classList.remove("drop-before", "drop-after", "drop-into"));
}

/// Sposta una nota dentro un'altra cartella (drag "into", voce di menu o
/// tastiera): stesso rename del kernel, quindi stesso flush preventivo — un
/// buffer sporco coprirebbe la riscrittura dei wikilink — e progresso sulla
/// riga (U11) con no-op sul secondo invio.
export const moving = new Set<string>();

async function moveIntoFolder(id: string, folderPath: string): Promise<void> {
  const to = folderPath ? `${folderPath}/${childName(id)}` : childName(id);
  if (to === id || moving.has(id)) return;
  if (await ensureSaved()) return;
  const refused = await moveNote(id, folderPath);
  if (refused !== null) {
    notify(t("explorer.move_failed", { doc: id, folder: folderPath || t("explorer.root"), reason: refused }), "guasto");
    return;
  }
  if (folderPath) state.expanded.add(folderPath);
  saveExpanded();
  await refreshDocuments();
}

/// Lo spostamento di una nota, senza avvisi: `null` se è al posto nuovo (o
/// c'era già), altrimenti il motivo per cui è rimasta dov'era. Chi chiama ha
/// già messo in salvo i buffer, e lo dice lui.
async function moveNote(id: string, folderPath: string): Promise<string | null> {
  const to = folderPath ? `${folderPath}/${childName(id)}` : childName(id);
  if (to === id) return null;
  if (moving.has(id)) return t("explorer.move_in_flight");
  moving.add(id);
  markMoving(id, true);
  try {
    const outcome = await renameKeepingBuffer(id, to);
    return outcome.kind === "collision" ? t("explorer.destination_open") : null;
  } catch (e) {
    return errorText(e);
  } finally {
    moving.delete(id);
    markMoving(id, false);
  }
}

/// Più note nella stessa cartella (la scelta dell'albero, il trascinamento di
/// una scelta, «In una cartella nuova»): una alla volta, perché ogni rinomina
/// riscrive i link delle altre, ma **un racconto solo** (IMP-3804). Mentre
/// vanno, un avviso dice a che punto sono; alla fine dice quante sono
/// arrivate, e ogni nota rimasta indietro ha il suo avviso col suo motivo.
/// Nessuna resta indietro in silenzio, e nessuna si perde: una nota che non
/// si sposta è ancora dov'era, col suo nome.
export async function moveNotesInto(ids: readonly string[], folderPath: string): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length === 1) {
    await moveIntoFolder(ids[0]!, folderPath);
    return;
  }
  if (await ensureSaved()) return;
  const folder = folderPath || t("explorer.root");
  const total = String(ids.length);
  const progress = notify(t("explorer.moving_many", { n: total, folder, done: "0" }));
  const refused: Array<{ id: string; reason: string }> = [];
  let done = 0;
  try {
    for (const id of ids) {
      const reason = await moveNote(id, folderPath);
      if (reason === null) done += 1;
      else refused.push({ id, reason });
      progress.rewrite(t("explorer.moving_many", { n: total, folder, done: String(done + refused.length) }));
    }
  } finally {
    progress.withdraw();
    if (folderPath) state.expanded.add(folderPath);
    saveExpanded();
    await refreshDocuments();
  }
  if (refused.length === 0) {
    notify(t("explorer.moved_many", { n: String(done), folder }));
    return;
  }
  notify(t("explorer.moved_some", { done: String(done), n: total, folder, left: String(refused.length) }), "guasto");
  for (const { id, reason } of refused) notify(t("explorer.move_failed", { doc: id, folder, reason }), "guasto");
}

/// Progresso dello spostamento sulla riga (U11): `aria-busy` finché il rename
/// è in volo, tolto alla fine anche su errore.
export function markMoving(id: string, busy: boolean): void {
  const li = entry(id);
  const row = li?.querySelector<HTMLElement>(":scope > .tree-row");
  if (busy) row?.setAttribute("aria-busy", "true");
  else {
    for (const stale of fileListEl.querySelectorAll<HTMLElement>('[aria-busy="true"]')) {
      const owner = stale.closest("li");
      if (owner instanceof HTMLElement && owner.dataset.path === id) stale.removeAttribute("aria-busy");
    }
  }
}

/// Sposta ciò che si trascina dentro una cartella: la voce presa o, se era
/// nella scelta, tutte le scelte, una alla volta e con lo stesso comando del
/// menu. Una cartella non entra in sé stessa né in una figlia: la si salta.
export async function moveGroupInto(dragged: NonNullable<typeof drag>, folder: string): Promise<void> {
  // Come i gesti della barra: le note trascinate escono dalla scelta quando
  // partono, non quando arrivano, o la fine di uno spostamento lungo
  // cancellerebbe la scelta fatta nel frattempo (IMP-1803).
  if (dragged.group.length > 1) selection?.clear();
  const notes: string[] = [];
  for (const path of dragged.group) {
    if (path === folder || folder.startsWith(`${path}/`) || parentOf(path) === folder) continue;
    if (folderRowOf(path) || (path === dragged.path && dragged.kind === "folder")) await moveFolderInto(path, folder);
    else notes.push(path);
  }
  await moveNotesInto(notes, folder);
}

/// La cartella che riceve un rilascio da fuori sotto `target`: la cartella
/// stessa se è la sua riga, la madre se è una nota o un file, la radice
/// visibile (vault o spazio attivo) altrimenti.
function outsideTarget(target: EventTarget | null): string {
  const row = target instanceof Element ? target.closest<HTMLElement>(".tree-row") : null;
  const path = row?.closest<HTMLElement>("li[data-path]")?.dataset.path ?? row?.dataset.path;
  if (!row || path === undefined) return state.activeSpace ?? "";
  return row.classList.contains("folder") ? path : parentOf(path);
}

/// File e cartelle del sistema lasciati cadere sull'albero o sul titolo del
/// pannello. Una cartella chiusa sotto il cursore si apre dopo una sosta, come
/// per un trascinamento interno.
export function wireOutsideDrops(lifetime: Lifetime): void {
  const over = (e: DragEvent) => {
    if (drag || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    const folder = e.currentTarget === filesTitleEl ? state.activeSpace ?? "" : outsideTarget(e.target);
    clearDropMarks();
    const row = folder ? folderRowOf(folder) : null;
    (row ?? filesTitleEl).classList.add("drop-into");
    if (row && !state.expanded.has(folder)) scheduleHoverOpen(folder);
  };
  const drop = async (e: DragEvent) => {
    if (drag || !carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    cancelHoverOpen();
    clearDropMarks();
    filesTitleEl.classList.remove("drop-into");
    const folder = e.currentTarget === filesTitleEl ? state.activeSpace ?? "" : outsideTarget(e.target);
    let dropped: Dropped;
    try {
      dropped = await readDropped(e.dataTransfer!);
    } catch (error) {
      notify(t("explorer.import_failed", { reason: errorText(error) }), "guasto");
      return;
    }
    await importHere(dropped, folder);
  };
  const leave = (e: DragEvent) => {
    const into = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (into && (fileListEl.contains(into) || filesTitleEl.contains(into))) return;
    clearDropMarks();
    filesTitleEl.classList.remove("drop-into");
    cancelHoverOpen();
  };
  for (const target of [fileListEl, filesTitleEl]) {
    lifetime.listen(target, "dragover", over);
    lifetime.listen(target, "dragleave", leave);
    lifetime.listen(target, "drop", (e) => void drop(e));
  }
}

/// Il selettore dei file del sistema, per chi non trascina: «Importa file…»
/// sceglie dei file, «Importa una cartella…» una cartella intera.
export function pickImport(folder: string, wholeFolder: boolean): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (wholeFolder) input.webkitdirectory = true;
  input.addEventListener("change", () => {
    if (input.files?.length) void importHere(pickedFiles(input.files), folder);
  }, { once: true });
  input.click();
}

/// Importa e racconta: quante voci sono entrate e, una per una, quelle che
/// non sono entrate col loro perché.
async function importHere(dropped: Dropped, folder: string): Promise<void> {
  if (!dropped.files.length && !dropped.folders.length) return;
  let outcome;
  try {
    outcome = await importIntoVault(dropped, folder);
  } catch (error) {
    notify(t("explorer.import_failed", { reason: errorText(error) }), "guasto");
    return;
  }
  if (folder) state.expanded.add(folder);
  saveExpanded();
  const where = folder || t("explorer.root");
  if (outcome.imported.length) {
    notify(t("explorer.imported", { count: String(outcome.imported.length), folder: where }), "info");
  }
  if (outcome.skipped.length) {
    const list = outcome.skipped.map((each) => `${each.name}: ${each.reason}`).join("; ");
    notify(t("explorer.import_skipped", { count: String(outcome.skipped.length), list }), "guasto");
  }
  await refreshFromKernel(true);
}
