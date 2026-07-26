// La cronologia delle versioni del documento aperto.
//
// Il versioning è **spegnibile**, e spento significa assente (D7): il pannello
// non esiste e non si interroga nulla. È la regola di spegnibilità totale
// applicata alla lettera — non un pannello vuoto con scritto "disattivato".
//
// # Perché non è ancora un `ViewProvider`
//
// Il §1.2 chiede di migrarla al protocollo dichiarativo, ed è il caso di
// collaudo giusto: view con stato per-documento, input, e azioni che scrivono.
// Ma proprio per questo dipende dai nodi di input del §2.1 (`UiNode` oggi non
// esprime né un campo né una scelta) e da un modo di dire "sto caricando"
// (§2.5): oggi la migrazione produrrebbe una view che sa mostrare la lista e
// non sa offrire il bottone «Ripristina» se non come `list_item` cliccabile.
// Resta aperta con la sua ragione, invece di essere fatta a metà.
//
// Ciò che nel frattempo è cambiato: non è un provider, ma è un `Panel` come le
// view dichiarate — dichiara cosa lo fa invecchiare e l'host lo chiama. Il
// giorno della migrazione resta da spostare il *disegno*, non l'innesco.
import { api } from "../host/ipc";
import { on, state } from "../state/store";
import { $ } from "../ui/dom";
import { registerPanel } from "../ui/panel-host";
import { flushPendingSave, isOpen, reloadCurrent } from "./document";

const historyPanelEl = $("#history-panel");
const historyListEl = $("#history-list");
const historySummaryEl = $("#history-summary");
const historyPreviewEl = $<HTMLElement>("#history-preview");

export function mountHistory(): void {
  // Il pannello compare (o sparisce) con l'interruttore del vault appena
  // aperto: `versioning` arriva da `VaultInfo`, non da una costante di questa
  // shell.
  on("vault", () => {
    historyPanelEl.hidden = !state.versioningOn;
  });
  // La cronologia segue il documento aperto (`followsDoc`) e ogni scrittura,
  // che è ciò che produce una versione nuova.
  registerPanel({
    id: "shell:history",
    title: "Cronologia",
    placement: "right_sidebar",
    refresh: ["document_changed"],
    followsDoc: true,
    // Versioning spento significa pannello assente (D7), non pannello vuoto:
    // nascosto non si interroga nulla.
    visible: () => !historyPanelEl.hidden,
    render: (n) => {
      // Una scrittura su un ALTRO documento non invecchia questa cronologia:
      // è il solo pezzo per cui sapere quale evento è arrivato serve davvero.
      const event = n?.event;
      if (event?.type === "document_changed" && !isOpen(event.id)) return;
      if (!state.currentDoc) {
        svuota();
        return;
      }
      return updateHistory(state.currentDoc);
    },
  });
}

function svuota(): void {
  historySummaryEl.textContent = "";
  historyListEl.innerHTML = "";
  historyPreviewEl.hidden = true;
}

async function updateHistory(id: string): Promise<void> {
  if (!state.versioningOn) return;
  const versions = await api.listVersions(id);
  historySummaryEl.textContent =
    versions.length === 0
      ? "nessuna versione"
      : `${versions.length} version${versions.length === 1 ? "e" : "i"}`;
  historyListEl.innerHTML = "";
  historyPreviewEl.hidden = true;

  for (const [i, version] of versions.entries()) {
    const li = document.createElement("li");

    const when = document.createElement("span");
    when.className = "version-when";
    when.textContent = new Date(version.ts).toLocaleString();

    const size = document.createElement("span");
    size.className = "version-size";
    // La più recente è lo stato attuale della nota: dirlo evita di ripristinare
    // ciò che è già sullo schermo.
    size.textContent = i === 0 ? "attuale" : `${version.size} B`;

    const restore = document.createElement("button");
    restore.className = "link-button";
    restore.textContent = "Ripristina";
    restore.addEventListener("click", (e) => {
      e.stopPropagation();
      void restoreVersion(id, version.ts);
    });

    li.append(when, size, restore);
    // L'anteprima si carica solo quando serve: elencare le versioni non deve
    // costare la lettura di tutte.
    li.addEventListener("click", () => void showVersionPreview(id, version.ts));
    historyListEl.appendChild(li);
  }
}

async function showVersionPreview(id: string, ts: number): Promise<void> {
  historyPreviewEl.hidden = false;
  historyPreviewEl.textContent = await api.readVersion(id, ts);
}

async function restoreVersion(id: string, ts: number): Promise<void> {
  // Il ripristino riscrive il file: il buffer va messo in salvo prima, o le
  // modifiche non ancora scritte se ne andrebbero senza che nessuno lo dica.
  await flushPendingSave();
  await api.restoreVersion(id, ts);
  // Il ripristino è a sua volta una versione (D8): si può annullare.
  if (isOpen(id)) await reloadCurrent();
  await updateHistory(id);
}
