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
import { allaChiusura, api } from "./host/ipc";
import { statoDelVault, vociDelVault } from "./host/query";
import { inoltraNotifica, startKernelRouter } from "./state/kernel";
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
  frasedeiConflitti,
  keybindingKey,
  loadKeyOverrides,
  mountKeyOverrides,
  registerShellCommand,
} from "./ui/commands";
import { mountKeyboard } from "./ui/keyboard";
import { apriVita } from "./ui/vita";
import { mountSidebarCommands, showPanel } from "./panels/sidebar";
import { mountPanelHost, refreshAllPanels } from "./ui/panel-host";
import { mountDeclaredViews, mountViewInvalidation } from "./ui/views";
import { mountTitlebar } from "./ui/titlebar";
import { mountAppMenu } from "./ui/app-menu";
import { mountRail, syncRail } from "./panels/rail";
import { mountStrings, t } from "./i18n/strings";
import { mountActivity } from "./panels/activity";
import { mountSettings } from "./panels/settings";
import { mountTheme } from "./theme/theme";
import {
  flushPendingSave,
  mettiInSalvoPrimaDiChiudere,
  mountDocument,
  openDocument,
  openWikilink,
  recuperaBozze,
  setEditorTheme,
  sincronizza,
} from "./panels/document";
import { mountExplorer } from "./panels/explorer";
import { mountDocSearch } from "./panels/doc-search";
import { mountGraph } from "./panels/graph";
import { mountQuickSwitcher } from "./panels/quick-switcher";
import { configurePreview } from "./panels/preview";
import { clearSearch, mountSearch, searchFor } from "./panels/search";
import { errorText } from "./host/errors";

const vaultPathEl = $("#vault-path");

/// Ciò che la palette chiede alla shell.
const paletteHost = {
  onEffect: applyIntent,
  notify,
  flushPendingSave,
  // Dal canale dati (§14.4), **con una finestra** (§2.9). Questi path
  // riempiono un `<datalist>`, cioè dei suggerimenti sopra un campo che resta
  // libero: chiedere l'anagrafe intera per proporne una manciata mandava
  // attraverso il ponte tutto il vault e creava un `<option>` per documento a
  // ogni apertura del pannello. Un suggerimento troncato non toglie niente a
  // chi scrive il path per intero.
  //
  // La forma giusta a regime è un'altra, ed è già scritta altrove: chiedere per
  // prefisso mentre si scrive, cioè `noteDalNome` (0082, 0083 — «le superfici
  // che propongono dei nomi fanno *la stessa* domanda»). Cablarla qui vuol dire
  // dare alla palette un campo che ascolta, che è la casella residua.
  listDocuments: () =>
    vociDelVault({ offset: 0, limit: 200 }, "document")
      .then((page) => page.items.map((e) => e.id))
      .catch(() => []),
};

/// Quanto vivono gli ascolti globali della shell: **quanto la finestra**.
///
/// Nessuno la chiude, e la riga che lo dice è questa. Non è un `Vita` per
/// finta: è la risposta vera alla domanda che `ui/vita.ts` obbliga a farsi —
/// «di chi è questo ascoltatore?» — per i tre che il locale, il tema e la
/// tastiera mettono su `document` e su `window`. Il giorno in cui la shell
/// dovrà rimontarsi senza ricaricare la pagina, il manico c'è già ed è qui, in
/// un posto solo, invece di essere tre `removeEventListener` da inventare in
/// tre file.
const vitaFinestra = apriVita();

async function init(): Promise<void> {
  // Il tema **per primo**, e prima di qualunque cosa disegni (§12.4): applica
  // subito l'ultima scelta nota, così il primo fotogramma è già nella luce
  // giusta invece di correggersi mezzo secondo dopo. Va prima di
  // `mountDocument` anche per una ragione meno cosmetica: l'editor nasce col
  // tema che trova sulla radice, e nascere col tema sbagliato vorrebbe dire
  // riconfigurarlo subito dopo.
  mountTheme(vitaFinestra, setEditorTheme);

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

  // La titlebar custom (§Fase 2): i controlli finestra e il doppio click.
  // Va dopo `mountStrings` perché i suoi aria-label seguono la lingua, e
  // prima dei pannelli perché è il chrome — la cornice che c'è prima del
  // contenuto.
  mountTitlebar(vitaFinestra);

  // I tre collegamenti iniettati, e la ragione per cui lo sono: il pannello del
  // documento mostra l'anteprima (in Lettura) e l'anteprima apre i documenti;
  // il pannello del documento manda a cercare un tag e la ricerca apre i
  // documenti; il grafo apre la nota di un nodo. In tutti i casi importarsi a
  // vicenda sarebbe un ciclo, e in un bundle ESM un ciclo è un `undefined`
  // all'avvio che non dice da dove viene. È la stessa forma con cui i tre
  // moduli dell'editor ricevono il mondo.
  mountDocument({ searchTag: (tag) => searchFor(`tags:${tag}`) });
  configurePreview({ openPage: openWikilink });

  // Subito dopo il pannello del documento, perché è il suo testo che protegge, e
  // **prima** del vault: il ritardo del salvataggio comincia a correre alla
  // prima battuta, e un ascoltatore montato in fondo all'avvio sarebbe iscritto
  // dopo l'unico momento in cui non serve. Non si attende — la promessa è
  // l'iscrizione, non la chiusura — ma non è nemmeno buttata: un `catch` che
  // dice cosa non c'è, perché una finestra che chiudendo perde l'ultima battuta
  // non lo racconta a nessuno.
  void allaChiusura(mettiInSalvoPrimaDiChiudere).catch(() => {
    notify(t("document.close_unhooked"), "guasto");
  });

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
  // La ricerca **dentro** la nota aperta (§21.4): stesso motore della casella
  // del vault, raggio ristretto al documento col fuoco. È un comando e non un
  // pannello, quindi qui basta dichiararlo.
  mountDocSearch();
  mountQuickSwitcher();
  // La rail (§Fase 2): le icone shell a sinistra — Note, Cerca, Grafo —
  // sempre visibili. Le view dichiarate `left_sidebar` si aggiungono dopo,
  // a ogni apertura di vault, con `syncRail()`. Va prima di `mountGraph`
  // perché crea `#show-graph`, che `mountGraph` ascolta.
  mountRail();
  mountGraph();
  // Le due superfici della barra di stato (§10.3): cosa sta girando, e cosa è
  // stato detto. Il centro attività si iscrive agli eventi del kernel, quindi
  // va montato prima che il router parta.
  mountNotifications();
  mountActivity();
  // La tastiera rilegge gli accordi quando una scorciatoia cambia (§18.2): anche
  // lei si iscrive a `setting_changed`, quindi anche lei prima del router.
  mountKeyOverrides();
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
      // Le stesse due domande dell'apertura, e per la stessa ragione insieme:
      // non si leggono a vicenda, e chi accende un componente le aspetta
      // entrambe.
      await Promise.all([mountDeclaredViews(), loadCommandSpecs()]);
      syncRail();
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
    run: () => void pickVault(),
  });
  registerShellCommand({
    id: "shell.palette",
    title: "commands.palette",
    description: "commands.palette.desc",
    run: () => void openCommandPalette(paletteHost),
  });
  mountSidebarCommands();

  // La menubar applicativa (§Fase 2): cinque voci che invocano i comandi
  // di shell già registrati. Il menu non registra niente: legge il
  // registro, e `main.ts` gli inietta `run(id)` che risolve l'entry e la
  // esegue come farebbe la tastiera.
  mountAppMenu({
    run: (id) => {
      const entry = allCommands().find((e) => e.id === id);
      if (entry) startCommand(entry, paletteHost);
    },
  });

  // Il trigger di ricerca nella titlebar: fa focus su `#search-input`, che è
  // la ricerca onesta — già lì, già cablata — e non una palette travestita.
  // Il title dice che la palette è Mod-Shift-P, per chi cerca un comando.
  $("#command-search").addEventListener("click", () => {
    showPanel("search");
    $("#search-input").focus();
  });
  // Il bottone palette nella titlebar: apre la palette dei comandi.
  $("#open-palette").addEventListener("click", () =>
    void openCommandPalette(paletteHost),
  );

  // La tastiera, in un punto solo, e su **un registro solo**: i comandi del
  // kernel e quelli della shell, con l'accordo efficace di ognuno — quello che
  // l'utente ha scelto, o quello dichiarato. La shell non cabla nessuna
  // combinazione: se un domani un plugin dichiara `Mod-Shift-t`, o `Mod-k d`,
  // funziona senza toccare questo file. Cos'è un accordo e quando è finito lo
  // sa `ui/keyboard.ts`, che è il posto in cui una sequenza a metà ha un tempo
  // e una via d'uscita (§18.2).
  mountKeyboard(vitaFinestra, (entry) => startCommand(entry, paletteHost));

  // Chi ascolta i guasti si iscrive **prima** che il router parta (§20.2): un
  // vault che va storto mentre si apre è esattamente il caso in cui l'utente
  // deve saperlo, e un ascoltatore iscritto dopo si perde proprio quello.
  ascoltaIGuasti();

  await startKernelRouter();

  // L'avviso di sessione (§25.5): la diagnosi «la cartella di configurazione
  // non si può scrivere» nasce all'avvio del backend, quando nessun ascoltatore
  // esiste ancora — una spinta sarebbe emessa nel vuoto. Si tira adesso, col
  // router in piedi, e si consegna come un evento qualunque: l'ordine dell'IPC
  // garantisce che `ascoltaIGuasti` — iscritta prima del router — sia già
  // lì a riceverlo.
  const avviso = await api.avvisoDiSessione();
  if (avviso) inoltraNotifica(avviso);

  // Il locale del sistema (§12.3), **prima** di aprire il vault: da qui in poi
  // ogni `render_view` lo trova già pubblicato, invece di disegnare il primo
  // giro con la lingua indeterminata e correggersi dopo. Chi lo cambia da fuori
  // — impostazioni del sistema, ora legale — se ne accorge al ritorno del
  // focus, e allora si ridisegna ciò che è appeso al contesto.
  mountLocale(vitaFinestra, () => void mountDeclaredViews());

  // Gli accordi riconfigurati, **prima** di sapere se un vault c'è (§16.3).
  // Quelli dei comandi di shell vivono nella macchina e non nel vault, quindi
  // esistono anche adesso: senza questa riga la finestra vuota risponderebbe
  // solo agli accordi dichiarati, cioè chi ha rimappato «Apri un vault»
  // troverebbe la sua combinazione muta esattamente nella schermata in cui
  // serve. Con un vault aperto la riga dopo la rifà, e costa una domanda.
  await loadKeyOverrides();

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
  // «Questo vault si è aperto a metà» (§15.7): la riga che il contratto teneva
  // in serbo per una superficie che non c'era. Ogni voce esce anche come evento
  // `trouble` — e da lì il centro notifiche la mostra già — ma la si legge
  // **anche** dall'esito, che è la ragione per cui il campo esiste: aprire un
  // vault è il carico sotto cui la coda eventi tronca (§20.5), e una nota che
  // la ricerca non trova e che il grafo non collega è precisamente ciò che non
  // si scopre finché non la si cerca.
  if (info.unread.length > 0) {
    notify(t("vault.partial", { count: info.unread.length }), "guasto");
  }
  state.vaultRoot = info.root;
  state.handledExtensions =
    info.extensions.length > 0 ? info.extensions : state.handledExtensions;
  // Lo stato di vista di **questo** vault (§11.2): come lo si stava guardando.
  // Dopo l'apertura, perché è il backend a tenerlo e la chiave è il vault
  // aperto; e prima del segnale, perché chi si iscrive disegna con questi.
  //
  // Il layout è il pezzo che il §11.2 aspettava: quanti riquadri, con che tab
  // dentro, in che modalità ciascuno. Non c'è più un `closeDocument()` qui —
  // chiudeva il documento del vault precedente perché non c'era niente da
  // ripristinare al posto suo, e adesso c'è: la finestra riparte com'era.
  //
  // **Insieme, e non in fila**: sono quattro domande che non si leggono a
  // vicenda — l'organizzazione, il layout, le cartelle aperte, lo spazio
  // attivo — e ciascuna è un giro sull'IPC. In fila costavano cinque andate e
  // ritorno (`caricaLayout` ne fa due di suo), e chi apre un vault le paga
  // tutte una dopo l'altra prima di vedere qualcosa. L'ordine che i commenti
  // qui sopra dichiarano è **rispetto a `openVault` e al segnale**, non fra
  // loro: `Promise.all` lo tiene fermo. Nessuna delle quattro può rifiutare —
  // tutte e quattro hanno il proprio `catch` dentro — quindi qui non c'è la
  // domanda «cosa resta a metà se una va storta».
  await Promise.all([loadOrganization(), caricaLayout(), loadExpanded(), loadActiveSpace()]);
  await sincronizza();
  // **Ciò che era rimasto non salvato** (§15.2), e sta qui accanto a
  // `vault.partial` perché è la stessa specie di riga: due cose che l'apertura
  // deve dire e che nessun'altra superficie direbbe. La differenza è il verso —
  // là il vault ha perso qualcosa da leggere, qui l'utente ritrova qualcosa che
  // aveva scritto — ed è dopo il layout di proposito: il testo recuperato è un
  // buffer, e i buffer vanno messi quando i riquadri ci sono già.
  const recuperate = await recuperaBozze();
  if (recuperate > 0) {
    notify(t("draft.found", { count: recuperate }), "info");
  }
  // Da qui in poi lo stato del vault è coerente: chi ne dipende può ripartire.
  emit("vault", info.root);

  clearSearch();
  emit("documents");

  // Le view dichiarative si scoprono dal backend, non da id cablati. E come le
  // view, i comandi: l'elenco serve alle scorciatoie dichiarate — la palette lo
  // richiede da sé a ogni apertura, perché è il momento in cui costa nulla ed è
  // l'unico in cui deve essere fresco.
  //
  // Gli accordi riconfigurati vivono nelle impostazioni di **questo** vault
  // (0076), quindi si rileggono quando il vault cambia — insieme ai comandi che
  // ne sono i proprietari. «Insieme» qui è letterale: i tre elenchi non si
  // leggono a vicenda, e chi li aspetta è la riga dopo, che li vuole tutti e
  // tre. In fila erano tre andate e ritorno, adesso una.
  //
  // L'unica differenza che resta: se `list_views` rifiuta, i due elenchi che
  // prima non venivano nemmeno chiesti adesso arrivano lo stesso. È il verso
  // buono — un vault che si apre male tiene comunque i comandi e gli accordi —
  // e `Promise.all` rifiuta come rifiutava `mountDeclaredViews` da solo.
  await Promise.all([mountDeclaredViews(), loadCommandSpecs(), loadKeyOverrides()]);
  // Le view dichiarate `left_sidebar` sono state montate in `#views-left`:
  // la rail le scopre e aggiunge i bottoni dopo le icone shell.
  syncRail();
  await avvisaSeDueComandiSiContendonoUnTasto();
  // **Dopo** i conflitti, e non è indifferente: una scorciatoia sospesa non è in
  // vigore, quindi non partecipa a nessun conflitto — e dire prima «questo vault
  // ne propone tre» farebbe leggere l'avviso dei conflitti come se le riguardasse.
  await avvisaSeIlVaultPortaTasti();

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

/// Se questo vault propone dei tasti che nessuno ha guardato, **dirlo** (§23.13).
///
/// Un vault viaggia — un repo clonato, una cartella condivisa, un vault di
/// esempio — e le sue scorciatoie viaggiano con lui. Finché nessuno le ha
/// guardate non premono niente, che è la metà silenziosa di questa voce; questa
/// è l'altra metà, perché una scorciatoia sospesa e taciuta sarebbe una
/// configurazione che non fa effetto e nessuno che sappia dire perché.
///
/// L'avviso **nomina i comandi** e non li conta soltanto, per la stessa ragione
/// dei conflitti: «hai tre scorciatoie in sospeso» manda a cercare quali. E la
/// risposta non sta qui — sta nel pannello delle impostazioni, dove quelle righe
/// vivono e si vedono una per una. Un avviso con due bottoni chiederebbe di
/// decidere senza guardare, che è il gesto che questa voce esiste per non
/// insegnare.
async function avvisaSeIlVaultPortaTasti(): Promise<void> {
  try {
    const proposti = await api.pendingKeybindings();
    const chiavi = Object.keys(proposti);
    if (chiavi.length === 0) return;
    const perChiave = new Map(allCommands().map((c) => [keybindingKey(c.id), c.title]));
    const nomi = chiavi.map((k) => perChiave.get(k) ?? k).join(", ");
    notify(t("app.vault_keys_pending", { count: chiavi.length, commands: nomi }));
  } catch {
    // Un vault che non sa dire cosa propone non è un motivo per non aprirlo, e
    // il silenzio qui è dalla parte giusta: le chiavi restano sospese finché
    // qualcuno non risponde, quindi ciò che si perde è la domanda, non il
    // presidio.
  }
}

/// Se questo vault non ha il rilevamento delle modifiche esterne, dirlo (§9.7).
///
/// È la promessa che Fub non manteneva in silenzio: senza watcher nessuno
/// vede le scritture altrui — network share, cloud drive, vault sincronizzati
/// con strumenti esterni — e il salvataggio successivo copre ciò che non è
/// stato visto. Un avviso all'apertura non è l'indicatore permanente che il
/// §20.4 chiedeva insieme allo stato del salvataggio — quello, per il watcher,
/// resta da fare — ma passa dalla stessa porta di tutto il resto, e non da una
/// console.
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
// dove si vedeva era la console della webview, che in un'app impacchettata non
// si apre. Questo era l'unico fallimento della shell che arrivasse all'utente, e
// ci arrivava perché la barra del vault è il posto più visibile che c'era; col
// §20.4 la superficie vera c'è, e questo punto smette di essere l'eccezione per
// diventare la regola. **La barra resta**, e non è un doppione: l'avviso dice
// cosa è successo mentre succede, la barra dice perché quella finestra è a metà
// anche a chi la guarda un minuto dopo — che è la stessa coppia «una volta /
// finché non è riparato» dello stato di salvataggio.
//
// **L'avvio si esporta** (§17.2): non perché qualcuno lo attenda in produzione
// — in produzione questo è l'ultimo file che viene eseguito, e non c'è nessuno
// dopo — ma perché senza questa riga l'avvio non è *osservabile*. Un E2E che
// non può aspettare la fine del montaggio deve dormire un tempo a caso e
// sperare, cioè diventa un presidio che ogni tanto passa; e questa è l'unica
// promessa che la shell fa sul proprio boot. Chi la esporta la dichiara.
export const avvio: Promise<void> = init().catch((e) => {
  const reason = errorText(e);
  notify(t("app.start_failed", { reason }), "guasto");
  vaultPathEl.textContent = t("app.start_failed", { reason });
});
