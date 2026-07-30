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
import { hasPlugin } from "./host/contract";
import { pickFolder } from "./host/dialog";
import { api } from "./host/ipc";
import { statoDelVault, vociDelVault } from "./host/query";
import { startKernelRouter } from "./state/kernel";
import { mountLocale } from "./state/locale";
import { loadOrganization } from "./state/organization";
import { emit, loadActiveSpace, loadExpanded, loadMode, state } from "./state/store";
import { loadCommandSpecs, primaNota } from "./state/vault";
import { $ } from "./ui/dom";
import { applyIntent } from "./ui/intents";
import { ascoltaIGuasti, mountNotifications, notify } from "./ui/notify";
import { findByBinding, openCommandPalette, startCommand } from "./ui/palette";
import { mountPanelHost, refreshAllPanels } from "./ui/panel-host";
import { mountDeclaredViews, mountViewInvalidation } from "./ui/views";
import { mountStrings, t } from "./i18n/strings";
import { mountActivity } from "./panels/activity";
import { mountSettings } from "./panels/settings";
import { mountTheme } from "./theme/theme";
import {
  closeDocument,
  mountDocument,
  openDocument,
  openWikilink,
  setEditorTheme,
  setMode,
} from "./panels/document";
import { mountExplorer } from "./panels/explorer";
import { mountGraph } from "./panels/graph";
import { mountHistory } from "./panels/history";
import { configurePreview } from "./panels/preview";
import { clearSearch, mountSearch, searchFor } from "./panels/search";
import { mountTrash } from "./panels/trash";
import { errorText } from "./host/errors";

const vaultPathEl = $("#vault-path");

/// Ciò che la palette chiede alla shell.
const paletteHost = {
  onEffect: applyIntent,
  notify,
  // Dal canale dati (§14.4): la palette cerca fra tutte le note, quindi la
  // lista resta intera — è la porta che cambia, non la domanda.
  listDocuments: () =>
    vociDelVault("document")
      .then((page) => page.items.map((e) => e.id))
      .catch(() => []),
};

async function init(): Promise<void> {
  // La modalità **non si carica qui**: è per vault (§11.2), e un vault non c'è
  // ancora. La carica `openVaultPath`, e chi apre applica; senza vault iniziale
  // resta questo default, che è ciò che la shell mostrava prima che qualcuno
  // guardasse qualcosa.
  document.body.dataset.mode = state.mode;

  // Il tema **per primo**, e prima di qualunque cosa disegni (§12.4): applica
  // subito l'ultima scelta nota, così il primo fotogramma è già nella luce
  // giusta invece di correggersi mezzo secondo dopo. Va prima di
  // `mountDocument` anche per una ragione meno cosmetica: l'editor nasce col
  // tema che trova sulla radice, e nascere col tema sbagliato vorrebbe dire
  // riconfigurarlo subito dopo.
  mountTheme(setEditorTheme);

  // Le stringhe accanto al tema, e per la stessa ragione (§12.4): sono le due
  // cose che vanno applicate **prima** che qualcosa disegni, o il primo
  // fotogramma è nella luce sbagliata e nella lingua sbagliata, e si corregge
  // sotto gli occhi di chi guarda. Qui si riempie anche il testo fermo di
  // `index.html`, che fino a questa riga è la lingua di ripiego scritta nel
  // file.
  //
  // Ciò che passa di qui è **ciò che nessun altro sa rifare**: i pannelli, che
  // hanno tutti un `render` e un registro che sa chiamarli. Chi disegna testo
  // fuori dai pannelli — i due pulsanti della barra di stato, il titolo dello
  // spazio — si iscrive da sé con `onLingua`, invece di allungare un elenco qui
  // che si scopre incompleto solo cambiando lingua.
  mountStrings(() => void refreshAllPanels());

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
  // Le due superfici della barra di stato (§10.3): cosa sta girando, e cosa è
  // stato detto. Il centro attività si iscrive agli eventi del kernel, quindi
  // va montato prima che il router parta.
  mountNotifications();
  mountActivity();
  // Il pannello delle impostazioni (§11.1): il form lo genera lui dallo schema
  // che i componenti dichiarano, e da lì passano anche i componenti da
  // accendere e i vault conosciuti. Va montato prima del router, come il centro
  // attività: si iscrive a `setting_changed`.
  // Le due cose che il pannello di impostazioni fa fare al resto della shell e
  // non sa fare da sé: aprire un vault (che è una dozzina di passi in ordine, e
  // stanno scritti in un punto solo) e riscoprire i provider dopo che un
  // componente si è acceso o spento.
  mountSettings({
    apriVault: openVaultPath,
    ricaricaProvider: async () => {
      await mountDeclaredViews();
      await loadCommandSpecs();
    },
  });

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

  // Chi ascolta i guasti si iscrive **prima** che il router parta (§20.2): un
  // vault che va storto mentre si apre è esattamente il caso in cui l'utente
  // deve saperlo, e un ascoltatore iscritto dopo si perde proprio quello.
  ascoltaIGuasti();

  await startKernelRouter();

  // Il locale del sistema (§12.3), **prima** di aprire il vault: da qui in poi
  // ogni `render_view` lo trova già pubblicato, invece di disegnare il primo
  // giro con la lingua indeterminata e correggersi dopo. Chi lo cambia da fuori
  // — impostazioni del sistema, ora legale — se ne accorge al ritorno del
  // focus, e allora si ridisegna ciò che è appeso al contesto.
  mountLocale(() => void mountDeclaredViews());

  const initial = await api.initialVault();
  // Chi apre un vault applica anche la sua modalità (§11.2): è là dentro che si
  // sa quale sia. Senza vault iniziale la applica qui, perché la stessa porta
  // fa anche il cablaggio — classe attiva, resa inline, superficie di lettura —
  // e la finestra vuota deve comunque essere in uno stato coerente.
  if (initial) await openVaultPath(initial);
  else await setMode(state.mode);
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
  // §7.6: non un booleano che il backend calcola per noi, ma una domanda
  // all'inventario di ciò che è attivo.
  state.versioningOn = hasPlugin(info, "fub.versioning");

  await loadOrganization();
  // Lo stato di vista di **questo** vault (§11.2): come lo si stava guardando.
  // Dopo l'apertura, perché è il backend a tenerlo e la chiave è il vault
  // aperto; e prima del segnale, perché chi si iscrive disegna con questi.
  state.mode = await loadMode();
  await loadExpanded();
  await loadActiveSpace();
  // La modalità passa dalla stessa porta di un click sul commutatore: il
  // cablaggio (classe attiva, resa inline, superficie di lettura, contesto
  // pubblicato) sta in un punto solo invece che in due che devono restare
  // d'accordo.
  await setMode(state.mode);
  // Da qui in poi lo stato del vault è coerente: chi ne dipende può ripartire.
  emit("vault", info.root);

  closeDocument();
  clearSearch();
  emit("documents");

  // Le view dichiarative si scoprono dal backend, non da id cablati. E come le
  // view, i comandi: l'elenco serve alle scorciatoie dichiarate — la palette lo
  // richiede da sé a ogni apertura, perché è il momento in cui costa nulla ed è
  // l'unico in cui deve essere fresco.
  await mountDeclaredViews();
  await loadCommandSpecs();

  await avvisaSeNessunoGuarda();

  // La prima nota, chiesta con una finestra da uno (§14.4): l'apertura del
  // vault non porta più l'elenco intero, e per aprirne una non serve.
  const prima = await primaNota();
  if (prima) await openDocument(prima);
}

/// Se questo vault non ha il rilevamento delle modifiche esterne, dirlo (§9.7).
///
/// È la promessa che Fub non manteneva in silenzio: senza watcher nessuno
/// vede le scritture altrui — network share, cloud drive, vault sincronizzati
/// con strumenti esterni — e il salvataggio successivo copre ciò che non è
/// stato visto. Un avviso all'apertura non è l'indicatore permanente che il
/// §20.4 chiede insieme alla barra di stato: è ciò che questa shell può
/// mostrare oggi senza inventarsi una superficie.
async function avvisaSeNessunoGuarda(): Promise<void> {
  try {
    const stato = await statoDelVault();
    if (!stato.watching) {
      notify(t("app.external_changes"));
    }
  } catch {
    // Un vault che non sa dire come sta non è un motivo per non aprirlo: il
    // canale dati ha già risposto a tutto il resto.
  }
}

// Un avvio che fallisce non deve morire in silenzio: senza questo, un errore
// dell'IPC lascia la finestra a metà (lista file sì, vault no) e l'unico posto
// dove si vede è la console della webview, che in un'app impacchettata non si
// apre. La barra del vault è il posto più visibile che la shell ha — e il §20.4
// chiede una superficie vera, che oggi non c'è.
init().catch((e) => {
  console.error("Fub: avvio fallito", e);
  vaultPathEl.textContent = t("app.start_failed", { reason: errorText(e) });
});
