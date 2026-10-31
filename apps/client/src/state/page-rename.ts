// Rinominare una pagina dal suo titolo: la testata del foglio e quella dei
// Blocchi (H12). Il titolo è il nome della pagina, e la pagina di una cartella
// (`X/_index.md`, decisione 0229) si chiama come la cartella: cambiarne il
// titolo rinomina la cartella, non il file, che resta `_index`.
//
// La strada è quella dell'esplora: il nome si giudica prima del giro IPC con la
// regola specchiata (`nameFault`), il testo non salvato si mette in salvo, poi
// la rinomina passa dalla sessione (`renameKeepingBuffer`) per un file e da
// `folder.rename` per una cartella, che si porta dietro ogni voce e i link.
import { errorText } from "../host/errors";
import { t, type Key } from "../i18n/strings";
import { isFolderPage, nameFault, normalizedName, pageName, type NameFault } from "../rules/mirrored";
import { parentOf } from "../rules/organizer";
import { flushPendingSave, renameKeepingBuffer } from "./document-session";
import { notify } from "../ui/notify";
import { createSubpage, renameFolder, undoLastOperation } from "./vault";

/// Perché un nome non si può usare: le stesse frasi dell'esplora.
export const NAME_FAULT: Record<NameFault, Key> = {
  empty: "name_fault.empty",
  traversal: "name_fault.traversal",
  machine: "name_fault.machine",
  control: "name_fault.control",
  reserved: "name_fault.reserved",
  device: "name_fault.device",
  "trailing-dot": "name_fault.trailing_dot",
  hidden: "name_fault.hidden",
  "too-long": "name_fault.too_long",
};

/// `p/Nome.md` con un altro nome di pagina: stessa cartella, stessa estensione.
export function renamedPath(from: string, name: string): string {
  const slash = from.lastIndexOf("/");
  const dir = slash === -1 ? "" : from.slice(0, slash + 1);
  const dot = from.lastIndexOf(".");
  const ext = dot > slash ? from.slice(dot) : "";
  return normalizedName(`${dir}${name}${ext}`);
}

/// Che cosa cambia nome quando il titolo di `doc` diventa `name`: il file, o la
/// cartella di cui `doc` è la pagina.
export type PageRename =
  | { readonly kind: "file"; readonly from: string; readonly to: string }
  | { readonly kind: "folder"; readonly from: string; readonly to: string };

export function pageRenameTarget(doc: string, name: string): PageRename {
  if (isFolderPage(doc)) {
    const folder = parentOf(doc);
    const up = parentOf(folder);
    return { kind: "folder", from: folder, to: normalizedName(up ? `${up}/${name}` : name) };
  }
  return { kind: "file", from: doc, to: renamedPath(doc, name) };
}

/// Rinomina la pagina `doc` col titolo `name`. Torna `null` se è andata (o se
/// non c'era niente da fare), altrimenti la frase che dice perché no.
export async function renamePage(doc: string, name: string): Promise<string | null> {
  const typed = name.trim();
  if (typed === "" || typed === pageName(doc)) return null;
  const target = pageRenameTarget(doc, typed);
  if (target.to === target.from) return null;
  const fault = nameFault(target.to, "new");
  if (fault !== null) return t("explorer.bad_name", { name: typed, reason: t(NAME_FAULT[fault]) });
  // La rinomina riscrive i collegamenti entranti, cioè altri file: il testo
  // non salvato va messo in salvo prima.
  const pending = await flushPendingSave();
  if (pending.length > 0) return t("document.unsaved_blocks", { doc: pending.join(", ") });
  if (target.kind === "folder") {
    try {
      await renameFolder(target.from, target.to);
    } catch (error) {
      return t("explorer.folder_move_failed", { folder: target.from, to: target.to, reason: errorText(error) });
    }
    return null;
  }
  try {
    const outcome = await renameKeepingBuffer(target.from, target.to);
    if (outcome.kind === "collision") {
      return t("explorer.rename_failed", { doc: target.from, to: target.to, reason: t("explorer.destination_open") });
    }
  } catch (error) {
    return t("explorer.rename_failed", { doc: target.from, to: target.to, reason: errorText(error) });
  }
  return null;
}

/// «Nuova sottopagina» dalla testata dei Blocchi (K7): mette in salvo il testo,
/// poi il comando del vault sposta la pagina in `X/_index` se serve e crea la
/// nota. Torna `null` se è andata — l'esito lo dice un avviso con «Annulla» —
/// altrimenti la frase che dice perché no.
export async function newSubpage(doc: string, name: string): Promise<string | null> {
  const typed = name.trim();
  const fault = nameFault(typed, "new");
  if (typed === "" || typed.includes("/") || fault !== null) {
    return t("explorer.bad_name", { name: typed, reason: t(NAME_FAULT[fault ?? "empty"]) });
  }
  const pending = await flushPendingSave();
  if (pending.length > 0) return t("document.unsaved_blocks", { doc: pending.join(", ") });
  try {
    const outcome = await createSubpage(doc, typed);
    if (outcome.notify) {
      notify(outcome.notify, "info", outcome.undo === null ? undefined : {
        label: t("app.undo"),
        run: () => void undoLastOperation().catch((error: unknown) =>
          notify(t("trash.undo_failed", { reason: errorText(error) }), "guasto")),
      });
    }
  } catch (error) {
    return errorText(error);
  }
  return null;
}
