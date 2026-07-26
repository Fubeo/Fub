// Il punto di montaggio della shell — e nient'altro.
//
// Qui si compone: si accendono i moduli di dominio, si iniettano i pochi
// collegamenti che due moduli non devono prendersi da sé (o sarebbero un ciclo
// di import), si apre il vault. Non c'è logica di dominio, e la regola per
// tenerlo così è semplice: se una funzione nuova risponde alla domanda «cosa fa
// questo pannello», non va qui — va nel pannello. È il file che, cresciuto per
// somma di eccezioni a quella regola, era arrivato a 1622 righe con 81 funzioni
// e 18 variabili globali (§1.1, §1.2).
import "./style.css";
import { pickFolder } from "./host/dialog";
import { api } from "./host/ipc";
import { startKernelRouter } from "./state/kernel";
import { loadOrganization } from "./state/organization";
import { emit, loadActiveSpace, loadExpanded, loadMode, state } from "./state/store";
import { loadCommandSpecs } from "./state/vault";
import { $ } from "./ui/dom";
import { applyIntent } from "./ui/intents";
import { notify } from "./ui/notify";
import { findByBinding, openCommandPalette, startCommand } from "./ui/palette";
import { mountPanelHost } from "./ui/panel-host";
import { mountDeclaredViews, mountViewInvalidation } from "./ui/views";
import {
  closeDocument,
  mountDocument,
  openDocument,
  openWikilink,
  setMode,
} from "./panels/document";
import { mountExplorer } from "./panels/explorer";
import { mountGraph } from "./panels/graph";
import { mountHistory } from "./panels/history";
import { configurePreview } from "./panels/preview";
import { clearSearch, mountSearch, searchFor } from "./panels/search";
import { mountTrash } from "./panels/trash";

const vaultPathEl = $("#vault-path");

/// Ciò che la palette chiede alla shell.
const paletteHost = {
  onEffect: applyIntent,
  notify,
  listDocuments: () => api.listDocuments().catch(() => []),
};

async function init(): Promise<void> {
  state.mode = loadMode();
  document.body.dataset.mode = state.mode;

  // I tre collegamenti iniettati, e la ragione per cui lo sono: il pannello del
  // documento mostra l'anteprima (in Lettura) e l'anteprima apre i documenti;
  // il pannello del documento manda a cercare un tag e la ricerca apre i
  // documenti; il grafo apre la nota di un nodo. In tutti i casi importarsi a
  // vicenda sarebbe un ciclo, e in un bundle ESM un ciclo è un `undefined`
  // all'avvio che non dice da dove viene. È la stessa forma con cui i tre
  // moduli dell'editor ricevono il mondo.
  mountDocument({ searchTag: (tag) => searchFor(`tags:${tag}`) });
  configurePreview({ openPage: openWikilink });

  // L'host dei pannelli per primo: da qui in poi ogni pannello — nativo o
  // dichiarato dal backend — si presenta al registro invece di iscriversi da
  // sé agli eventi, ed è l'host a decidere quando ridisegnarlo (§1.2).
  mountPanelHost();
  // L'invito a ridisegnare che arriva da un provider (§2.5): sta accanto
  // all'host dei pannelli perché è l'altra metà della stessa domanda — quando
  // una view è invecchiata. Una la dichiara la view (`refresh`/`follows`),
  // l'altra la dice il provider quando ha finito qualcosa che il vault non
  // vede.
  mountViewInvalidation();
  mountExplorer();
  mountSearch();
  mountTrash();
  mountHistory();
  mountGraph({ openNote: (id) => void openDocument(id) });

  $("#open-vault").addEventListener("click", () => void pickVault());

  // La tastiera dei comandi, in un punto solo: la palette, e le scorciatoie
  // che i comandi **dichiarano**. La shell non ne cabla nessuna — se un domani
  // un plugin dichiara `Mod-Shift-t`, funziona senza toccare questo file.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      void openCommandPalette(paletteHost);
      return;
    }
    const spec = findByBinding(state.commandSpecs, e);
    if (spec) {
      e.preventDefault();
      startCommand(spec, paletteHost);
    }
  });

  await startKernelRouter();

  const initial = await api.initialVault();
  if (initial) await openVaultPath(initial);
  // La modalità iniziale passa dalla stessa porta di un click sul commutatore
  // — il cablaggio (classe attiva, resa inline, superficie di lettura,
  // contesto pubblicato) sta in un punto solo invece che in due che devono
  // restare d'accordo. Dopo l'apertura del vault, non prima: il contesto si
  // pubblica quando c'è un workspace a cui pubblicarlo.
  await setMode(state.mode);
}

async function pickVault(): Promise<void> {
  const dir = await pickFolder();
  if (dir) await openVaultPath(dir);
}

async function openVaultPath(dir: string): Promise<void> {
  const info = await api.openVault(dir);
  vaultPathEl.textContent = info.root;
  state.vaultRoot = info.root;
  state.handledExtensions =
    info.extensions.length > 0 ? info.extensions : state.handledExtensions;
  state.versioningOn = info.versioning;

  await loadOrganization();
  loadExpanded();
  loadActiveSpace();
  // Da qui in poi lo stato del vault è coerente: chi ne dipende può ripartire.
  emit("vault", info.root);

  closeDocument();
  clearSearch();
  emit("documents", info.documents);

  // Le view dichiarative si scoprono dal backend, non da id cablati. E come le
  // view, i comandi: l'elenco serve alle scorciatoie dichiarate — la palette lo
  // richiede da sé a ogni apertura, perché è il momento in cui costa nulla ed è
  // l'unico in cui deve essere fresco.
  await mountDeclaredViews();
  await loadCommandSpecs();

  if (info.documents.length > 0) await openDocument(info.documents[0]);
}

// Un avvio che fallisce non deve morire in silenzio: senza questo, un errore
// dell'IPC lascia la finestra a metà (lista file sì, vault no) e l'unico posto
// dove si vede è la console della webview, che in un'app impacchettata non si
// apre. La barra del vault è il posto più visibile che la shell ha — e il §20.4
// chiede una superficie vera, che oggi non c'è.
init().catch((e) => {
  console.error("FubMD: avvio fallito", e);
  vaultPathEl.textContent = `avvio fallito: ${e}`;
});
