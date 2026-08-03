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
import { statoDelVault, vociDelVault } from "./host/query";
import { startKernelRouter } from "./state/kernel";
import { mountLocale } from "./state/locale";
import { loadOrganization } from "./state/organization";
import { emit, loadActiveSpace, loadExpanded, state } from "./state/store";
import { caricaLayout, docAttivo } from "./state/layout";
import { loadCommandSpecs, primaNota } from "./state/vault";
import { $ } from "./ui/dom";
import { applyIntent } from "./ui/intents";
import { ascoltaIGuasti, mountNotifications, notify } from "./ui/notify";
import { openCommandPalette, startCommand } from "./ui/palette";
import {
  allCommands,
  findByChord,
  frasedeiConflitti,
  loadKeyOverrides,
  registerShellCommand,
} from "./ui/commands";
import { mountSidebarCommands } from "./panels/sidebar";
import { mountPanelHost, refreshAllPanels } from "./ui/panel-host";
import { mountDeclaredViews, mountViewInvalidation } from "./ui/views";
import { mountStrings, t } from "./i18n/strings";
import { mountActivity } from "./panels/activity";
import { mountSettings } from "./panels/settings";
import { mountTheme } from "./theme/theme";
import {
  mountDocument,
  openDocument,
  openWikilink,
  setEditorTheme,
  sincronizza,
} from "./panels/document";
import { mountExplorer } from "./panels/explorer";
import { mountGraph } from "./panels/graph";
import { configurePreview } from "./panels/preview";
import { clearSearch, mountSearch, searchFor } from "./panels/search";
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
  mountGraph();
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

  // I due comandi che sono **di qui e di nessun pannello**: aprire un vault e
  // aprire la palette. Come ogni altro pannello, questo file dichiara i propri
  // (§18.2) invece di tenere l'elenco di tutti.
  //
  // Che la palette sia un comando come gli altri non è una civetteria: fino a
  // ieri il suo `Mod-Shift-p` era l'unica combinazione cablata dentro il
  // `keydown`, cioè l'unica che non compariva da nessuna parte e che nessuno
  // poteva scoprire senza leggere questo file.
  registerShellCommand({
    id: "shell.vault.open",
    title: "commands.vault.open",
    description: "commands.vault.open.desc",
    keybinding: "Mod-Shift-o",
    run: () => void pickVault(),
  });
  registerShellCommand({
    id: "shell.palette",
    title: "commands.palette",
    description: "commands.palette.desc",
    keybinding: "Mod-Shift-p",
    run: () => void openCommandPalette(paletteHost),
  });
  mountSidebarCommands();

  // La tastiera, in un punto solo, e adesso su **un registro solo**: i comandi
  // del kernel e quelli della shell, con l'accordo efficace di ognuno — quello
  // che l'utente ha scelto, o quello dichiarato. La shell non cabla nessuna
  // combinazione: se un domani un plugin dichiara `Mod-Shift-t`, funziona senza
  // toccare questo file.
  document.addEventListener("keydown", (e) => {
    const entry = findByChord(allCommands(), e);
    if (entry) {
      e.preventDefault();
      startCommand(entry, paletteHost);
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
  // Chi apre un vault ripristina anche la sua disposizione (§1.2): è là dentro
  // che si sa quale fosse. Senza vault iniziale si disegna comunque il layout di
  // default, perché la finestra vuota deve essere in uno stato coerente — un
  // riquadro, vuoto, col fuoco — e non in nessuno stato.
  if (initial) await openVaultPath(initial);
  else await sincronizza();
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
  await loadOrganization();
  // Lo stato di vista di **questo** vault (§11.2): come lo si stava guardando.
  // Dopo l'apertura, perché è il backend a tenerlo e la chiave è il vault
  // aperto; e prima del segnale, perché chi si iscrive disegna con questi.
  //
  // Il layout è il pezzo che il §11.2 aspettava: quanti riquadri, con che tab
  // dentro, in che modalità ciascuno. Non c'è più un `closeDocument()` qui —
  // chiudeva il documento del vault precedente perché non c'era niente da
  // ripristinare al posto suo, e adesso c'è: la finestra riparte com'era.
  await caricaLayout();
  await loadExpanded();
  await loadActiveSpace();
  await sincronizza();
  // Da qui in poi lo stato del vault è coerente: chi ne dipende può ripartire.
  emit("vault", info.root);

  clearSearch();
  emit("documents");

  // Le view dichiarative si scoprono dal backend, non da id cablati. E come le
  // view, i comandi: l'elenco serve alle scorciatoie dichiarate — la palette lo
  // richiede da sé a ogni apertura, perché è il momento in cui costa nulla ed è
  // l'unico in cui deve essere fresco.
  await mountDeclaredViews();
  await loadCommandSpecs();
  // Gli accordi riconfigurati vivono nelle impostazioni di **questo** vault
  // (0076), quindi si rileggono quando il vault cambia — insieme ai comandi che
  // ne sono i proprietari.
  await loadKeyOverrides();
  await avvisaSeDueComandiSiContendonoUnTasto();

  await avvisaSeNessunoGuarda();

  // La prima nota, chiesta con una finestra da uno (§14.4): l'apertura del
  // vault non porta più l'elenco intero, e per aprirne una non serve.
  //
  // **Solo se non c'era niente da ripristinare.** Aprire la prima nota era la
  // cosa giusta quando la finestra ripartiva sempre vuota; adesso che si
  // ricorda com'era, farlo comunque vorrebbe dire scavalcare con una nota
  // qualunque le tab che l'utente aveva lasciato aperte.
  if (!docAttivo()) {
    const prima = await primaNota();
    if (prima) await openDocument(prima);
  }
}

/// Se due comandi si contendono la stessa combinazione, **dirlo** (§18.2).
///
/// È l'unica cosa di questa voce che non veniva gratis. Un conflitto non è un
/// errore da rifiutare — chi ha rimappato ha il diritto di sbagliare, e
/// rifiutare la scrittura vorrebbe dire non poter scambiare due scorciatoie fra
/// loro senza passare per uno stato illegale — ma è qualcosa che nessuno
/// scoprirebbe da sé: si preme, parte l'altro comando, e non c'è niente da
/// guardare. L'avviso nomina i comandi, perché è da lì che si va a cambiarne
/// uno.
async function avvisaSeDueComandiSiContendonoUnTasto(): Promise<void> {
  const frase = frasedeiConflitti(allCommands());
  if (frase) notify(frase, "guasto");
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
