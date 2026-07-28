// Il cestino: elencare, ripristinare, svuotare — e la conferma prima di
// cestinare, che è l'altra faccia della stessa cosa.
//
// Il cestino è **piatto** (`.trash/`, come Obsidian) e la cartella di
// provenienza sopravvive in un sidecar: qui non se ne sa nulla, è il kernel a
// riportare la nota dov'era. Quello che la shell deve sapere è cosa fare quando
// il path originale è di nuovo occupato — il kernel non inventa nomi al posto
// dell'utente.
import { confirm } from "../host/dialog";
import { api } from "../host/ipc";
import {
  emptyTrash as svuota,
  proposeFreeName,
  refreshDocuments,
  restoreFromTrash,
  trashNote,
} from "../state/vault";
import { pageName } from "../rules/organizer";
import { $ } from "../ui/dom";
import { notify } from "../ui/notify";
import { refreshOn, registerPanel } from "../ui/panel-host";
import {
  closeDocument,
  isOpen,
  openDocument,
  resumeSave,
  suspendSave,
} from "./document";
import { isPanelVisible, showPanel } from "./sidebar";

const trashListEl = $("#trash-list");

export function mountTrash(): void {
  $("#show-trash").addEventListener("click", () => void openTrash());
  $("#close-trash").addEventListener("click", () => showPanel("files"));
  $("#empty-trash").addEventListener("click", () => void emptyTrashPanel());
  // Il cestino può essere riempito o svuotato da un'altra app (o da un'altra
  // finestra): se è aperto, si rilegge.
  registerPanel({
    id: "shell:trash",
    title: "Cestino",
    placement: "left_sidebar",
    refresh: refreshOn("index_updated", "batch_ended"),
    visible: () => isPanelVisible("trash"),
    render: refreshTrash,
  });
}

export async function openTrash(): Promise<void> {
  showPanel("trash");
  await refreshTrash();
}

async function refreshTrash(): Promise<void> {
  const entries = await api.listTrash();
  trashListEl.innerHTML = "";
  if (entries.length === 0) {
    const vuoto = document.createElement("li");
    vuoto.className = "empty-note";
    vuoto.textContent = "Il cestino è vuoto.";
    trashListEl.appendChild(vuoto);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.title = entry.id;

    const name = document.createElement("span");
    name.className = "trash-name";
    name.textContent = pageName(entry.original);

    const when = document.createElement("span");
    when.className = "trash-when";
    when.textContent = new Date(entry.deleted_at * 1000).toLocaleString();

    const restore = document.createElement("button");
    restore.className = "link-button";
    restore.textContent = "Ripristina";
    restore.addEventListener("click", () => void ripristina(entry.id, entry.original));

    li.append(name, when, restore);
    trashListEl.appendChild(li);
  }
}

async function ripristina(trashId: string, original: string): Promise<void> {
  let restored: string;
  try {
    restored = await restoreFromTrash(trashId);
  } catch {
    // Il path originale è di nuovo occupato: il kernel non inventa nomi al
    // posto dell'utente, quindi l'app ne propone uno e chiede. La convenzione
    // «Nota», «Nota 1», … è del kernel: chiedergliela evita di averne una
    // seconda implementazione qui, destinata a divergere.
    const proposta = await proposeFreeName(original);
    const ok = await confirm(
      `«${pageName(original)}» esiste di nuovo. Ripristinare come «${pageName(proposta)}»?`,
      { title: "Ripristina nota", okLabel: "Ripristina" },
    );
    if (!ok) return;
    restored = await restoreFromTrash(trashId, proposta);
  }
  await refreshTrash();
  showPanel("files");
  await refreshDocuments();
  await openDocument(restored);
}

async function emptyTrashPanel(): Promise<void> {
  const entries = await api.listTrash();
  if (entries.length === 0) return;
  const ok = await confirm(
    `Cancellare per sempre ${entries.length} element${entries.length === 1 ? "o" : "i"}?`,
    { title: "Svuota cestino", danger: true, okLabel: "Svuota" },
  );
  if (!ok) return;
  notify(await svuota());
  await refreshTrash();
}

/// Cestina una nota, chiedendo prima conferma.
///
/// Un salvataggio in attesa su quel documento lo farebbe risorgere subito dopo
/// la cancellazione: si disinnesca **prima ancora di chiedere**, e lo si rimette
/// in coda se l'utente ci ripensa.
export async function trashWithConfirm(id: string): Promise<void> {
  const salvataggioInAttesa = suspendSave(id);

  const ok = await confirm(`Spostare «${pageName(id)}» nel cestino?`, {
    title: "Elimina nota",
    danger: true,
    okLabel: "Elimina",
  });
  if (!ok) {
    if (salvataggioInAttesa) resumeSave();
    return;
  }

  await trashNote(id);
  if (isOpen(id)) {
    // Il buffer sporco di un documento cancellato muore col documento: non è
    // una perdita silenziosa, è l'azione che l'utente ha appena confermato.
    closeDocument();
    const docs = await refreshDocuments();
    if (docs.length > 0) await openDocument(docs[0]);
  } else {
    await refreshDocuments();
  }
}
