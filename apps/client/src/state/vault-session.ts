// L'apertura di un vault, come servizio.
//
// È la sequenza che porta la finestra da un vault all'altro: ciò che resta del
// vault di prima viene scritto, l'host apre quello nuovo, le sessioni vecchie
// si smontano, lo stato di vista si ricarica, le bozze rientrano, e solo allora
// il vault si annuncia a chi lo ascolta. L'ordine è la regola — ogni passo
// presuppone il precedente — e per questo vive in un posto solo, che ogni
// shell compone.
//
// Non disegna. I pochi passi che toccano la resa — il nome del vault, la
// ricerca, le view dichiarate, la rail, gli avvisi — sono **porte**: la shell
// le dichiara quando crea la sessione, nella forma di `setSidePanelController`
// (`ui/side-panels.ts`).
import { api } from "../host/ipc";
import { errorText, isErrorKind } from "../host/errors";
import { vaultStatus } from "../host/query";
import { plural, t } from "../i18n/strings";
import { allCommands, conflictMessage, keybindingKey, loadKeyOverrides } from "../ui/commands";
import type { Tone } from "../ui/notify";
import { openDocument, recoverDrafts, resetDocumentsForVault, synchronize } from "./document-controller";
import { flushPendingSave } from "./document-session";
import { drainDocumentWindows } from "./document-windows";
import { activeDoc, loadLayout } from "./layout";
import { loadOrganization } from "./organization";
import { preferredPaneMode } from "./pane-mode";
import { emit, loadActiveSpace, loadExpanded, loadExplorerSort, state } from "./store";
import { beforeNote, loadCommandSpecs } from "./vault";

/// Ciò che l'apertura di un vault chiede alla shell che la compone.
///
/// Sono chiamate **dentro** la sequenza, nell'ordine in cui `open` le incontra:
/// nessuna può essere rimandata a dopo, e nessuna deve aprire un vault a sua
/// volta.
export interface VaultSessionPorts {
  /// La finestra che ha montato la shell è ancora viva? È il valore di
  /// `alive` per chi apre senza passarne uno; la sequenza lo richiede dopo
  /// ogni attesa e, se risponde no, si ferma senza toccare altro.
  alive(): boolean;
  /// Un avviso all'utente.
  notify(message: string, tone?: Tone): void;
  /// Accende o spegne il segnale «questo vault non è sorvegliato».
  setWatcherOff(off: boolean): void;
  /// Mostra il nome del vault appena aperto. Arriva **prima** che
  /// `state.vaultRoot` cambi.
  showVaultName(root: string): void;
  /// Svuota la ricerca: i risultati erano del vault di prima. Arriva fra il
  /// segnale `vault` e il segnale `documents`.
  clearSearch(): void;
  /// Scopre e monta le view che il vault dichiara. La sequenza l'attende
  /// insieme all'elenco dei comandi e agli accordi; se rifiuta, l'apertura
  /// rifiuta.
  mountDeclaredViews(): Promise<void>;
  /// Riallinea la rail alle view appena montate.
  syncRail(): void;
}

/// L'apertura di un vault, per chi la chiede.
export interface VaultSession {
  /// Apre `dir` con la procedura intera.
  ///
  /// `alive` dice se chi ha chiesto c'è ancora (per default la porta
  /// omonima); `alreadyDrained` salta lo svuotamento di finestre e coda di
  /// salvataggio, per chi l'ha già fatto da sé prima di chiamare; `keepLeft`
  /// lascia aperto nell'host il vault da cui si viene, per chi ci tornerà da
  /// sé (la demo, che alla chiusura rende corrente quello di prima).
  open(dir: string, alive?: () => boolean, alreadyDrained?: boolean, keepLeft?: boolean): Promise<void>;
}

export function createVaultSession(ports: VaultSessionPorts): VaultSession {
  /// Chiude nell'host il vault che la finestra ha lasciato. Non ferma
  /// l'apertura: il vault nuovo è già aperto, e un guasto chiudendo il vecchio
  /// non deve lasciare la shell a metà. Si dice, voce per voce.
  async function closeLeftVault(root: string): Promise<void> {
    try {
      const troubles = await api.closeVault(root);
      for (const trouble of troubles) ports.notify(t("vault.close.trouble", { error: errorText(trouble) }), "guasto");
    } catch (error) {
      // Già chiuso da chi l'ha lasciato (la demo si chiude da sé): niente da dire.
      if (isErrorKind(error, "not_found")) return;
      ports.notify(t("vault.close.trouble", { error: errorText(error) }), "guasto");
    }
  }

  async function openVaultPath(
    dir: string,
    alive: () => boolean = ports.alive,
    alreadyDrained = false,
    keepLeft = false,
  ): Promise<void> {
    if (!alive()) return;
    if (state.vaultRoot && !alreadyDrained) {
      // Il testo in coda va scritto nel vault a cui appartiene, prima di
      // lasciarlo: dopo, lo stesso path indicherebbe un file dell'altro vault.
      if (!await drainDocumentWindows()) return;
      const pending = await flushPendingSave();
      if (!alive()) return;
      if (pending.length > 0) {
        ports.notify(t("demo.unsaved", { files: pending.join(", ") }), "guasto");
        return;
      }
    }
    if (!alive()) return;
    const left = state.vaultRoot;
    const info = await api.openVault(dir);
    if (!alive()) return;
    // **Ciò che è stato battuto mentre l'host apriva il vault nuovo** (FUB-001).
    // Il vault di prima resta aperto nell'host finché non lo si chiude, e ogni
    // sessione scrive nel vault in cui è nata (`document-session.ts`): questo
    // flush lo raggiunge per nome anche se il corrente, adesso, è l'altro. Senza,
    // quel testo si perdeva con la chiusura delle sessioni qui sotto — e un
    // autosave o una bozza armati prima potevano finire nel vault nuovo.
    // Ciò che nemmeno questo salva torna da `resetDocumentsForVault` e si dice.
    await flushPendingSave();
    if (!alive()) return;
    const unsaved = await resetDocumentsForVault();
    if (unsaved.length > 0) ports.notify(t("demo.unsaved", { files: unsaved.join(", ") }), "guasto");
    if (!alive()) return;
    // **Il vault lasciato si chiude** (#216), dopo il flush e dopo le sue
    // sessioni: altrimenti resterebbero vivi il suo watcher, i suoi job e il
    // lock di scrittura, e i suoi eventi — che non nominano il vault —
    // arriverebbero alla shell come fatti di questo. Tornarci è una
    // riapertura completa. Ciò che non è diventato durevole chiudendo si dice.
    if (left && left !== info.root && !keepLeft) await closeLeftVault(left);
    if (!alive()) return;
    // Il segnale watcher è del vault che si sta aprendo: azzerarlo subito, poi
    // `warnIfUnwatched` lo rialza col suo stato (I04, mai verità del vault prima).
    ports.setWatcherOff(false);
    ports.showVaultName(info.root);
    // «Questo vault si è aperto a metà» (§15.7): la riga che il contratto teneva
    // in serbo per una superficie che non c'era. Ogni voce esce anche come evento
    // `trouble` — e da lì il centro notifiche la mostra già — ma la si legge
    // **anche** dall'esito, che è la ragione per cui il campo esiste: aprire un
    // vault è il carico sotto cui la coda eventi tronca (§20.5), e una nota che
    // la ricerca non trova e che il grafo non collega è precisamente ciò che non
    // si scopre finché non la si cerca.
    if (info.unread.length > 0) {
      ports.notify(plural(info.unread.length, "vault.partial.one", "vault.partial"), "guasto");
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
    // ritorno (`loadLayout` ne fa due di suo), e chi apre un vault le paga
    // tutte una dopo l'altra prima di vedere qualcosa. L'ordine che i commenti
    // qui sopra dichiarano è **rispetto a `openVault` e al segnale**, non fra
    // loro: `Promise.all` lo tiene fermo. Nessuna delle quattro può rifiutare —
    // tutte e quattro hanno il proprio `catch` dentro — quindi qui non c'è la
    // domanda «cosa resta a metà se una va storta».
    await Promise.all([loadOrganization(), loadLayout(preferredPaneMode()), loadExpanded(), loadExplorerSort(), loadActiveSpace()]);
    if (!alive()) return;
    await synchronize();
    if (!alive()) return;
    // **Ciò che era rimasto non salvato** (§15.2), e sta qui accanto a
    // `vault.partial` perché è la stessa specie di riga: due cose che l'apertura
    // deve dire e che nessun'altra superficie direbbe. La differenza è il verso —
    // là il vault ha perso qualcosa da leggere, qui l'utente ritrova qualcosa che
    // aveva scritto — ed è dopo il layout di proposito: il testo recuperato è un
    // buffer, e i buffer vanno messi quando i riquadri ci sono già.
    const recovered = await recoverDrafts();
    if (!alive()) return;
    if (recovered > 0) {
      ports.notify(plural(recovered, "draft.found.one", "draft.found"), "info");
    }
    // Da qui in poi lo stato del vault è coerente: chi ne dipende può ripartire.
    emit("vault", info.root);

    ports.clearSearch();
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
    await Promise.all([ports.mountDeclaredViews(), loadCommandSpecs(), loadKeyOverrides()]);
    if (!alive()) return;
    // S5-1: `mountDeclaredViews` svuota i contenitori delle view dichiarate
    // (views.ts) prima di rimontarle, e il grafo — view dichiarata anche lui —
    // resta senza superficie. `synchronize()` rifà il giro di `show` per ogni
    // riquadro e rimonta le view dichiarate (`montaVistaInRiquadro` in
    // document.ts è idempotente): è il passaggio che rimette a posto la tab del
    // grafo dopo l'azzeramento di `mountDeclaredViews`.
    await synchronize();
    if (!alive()) return;
    // Le view dichiarate `left_sidebar` sono state montate in `#views-left`:
    // la rail le scopre e aggiunge i bottoni dopo che `mountDeclaredViews` ha
    // riempito l'host.
    ports.syncRail();
    if (!alive()) return;
    await warnIfCommandsContendKey();
    if (!alive()) return;
    // **Dopo** i conflitti, e non è indifferente: una scorciatoia sospesa non è in
    // vigore, quindi non partecipa a nessun conflitto — e dire prima «questo vault
    // ne propone tre» farebbe leggere l'avviso dei conflitti come se le riguardasse.
    await warnIfVaultProvidesKeys();
    if (!alive()) return;

    await warnIfUnwatched();
    if (!alive()) return;

    // La prima nota, chiesta con una finestra da uno (§14.4): l'apertura del
    // vault non porta più l'elenco intero, e per aprirne una non serve.
    //
    // **Solo se non c'era niente da ripristinare.** Aprire la prima nota era la
    // cosa giusta quando la finestra ripartiva sempre vuota; adesso che si
    // ricorda com'era, farlo comunque vorrebbe dire scavalcare con una nota
    // qualunque le tab che l'utente aveva lasciato aperte.
    if (!activeDoc()) {
      const before = await beforeNote();
      if (!alive()) return;
      if (before) {
        await openDocument(before);
        if (!alive()) return;
      }
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
  async function warnIfCommandsContendKey(): Promise<void> {
    const phrase = conflictMessage(allCommands());
    if (phrase) ports.notify(phrase, "guasto");
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
  async function warnIfVaultProvidesKeys(): Promise<void> {
    try {
      const suggested = await api.pendingKeybindings();
      const keys = Object.keys(suggested);
      if (keys.length === 0) return;
      const forKey = new Map(allCommands().map((c) => [keybindingKey(c.id), c.title]));
      const names = keys.map((k) => forKey.get(k) ?? k).join(", ");
      ports.notify(plural(keys.length, "app.vault_keys_pending.one", "app.vault_keys_pending", { commands: names }));
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
  async function warnIfUnwatched(): Promise<void> {
    try {
      const state = await vaultStatus();
      ports.setWatcherOff(!state.watching);
      if (!state.watching) {
        ports.notify(t("app.external_changes"));
      }
    } catch {
      // Un vault che non sa dire come sta non è un motivo per non aprirlo: il
      // canale dati ha già risposto a tutto il resto.
    }
  }

  return { open: openVaultPath };
}
