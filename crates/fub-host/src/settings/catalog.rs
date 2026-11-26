//! Il catalogo dei testi delle impostazioni, in ogni lingua del programma.

use super::*;

/// L'etichetta italiana di un gradino del log. È prosa e non il nome tecnico:
/// «info» dice poco a chi non sviluppa, «Info, avvisi ed errori» dice cosa
/// finisce nel file.
pub(super) fn level_label_it(level: fub_kernel::log::Level) -> &'static str {
    match level {
        fub_kernel::log::Level::Off => "Spento",
        fub_kernel::log::Level::Error => "Solo gli errori",
        fub_kernel::log::Level::Warn => "Errori e avvisi",
        fub_kernel::log::Level::Info => "Info, avvisi ed errori",
        fub_kernel::log::Level::Debug => "Debug",
        fub_kernel::log::Level::Trace => "Tutto (trace)",
    }
}

/// Come [`level_label_it`], in inglese.
pub(super) fn level_label_en(level: fub_kernel::log::Level) -> &'static str {
    match level {
        fub_kernel::log::Level::Off => "Off",
        fub_kernel::log::Level::Error => "Errors only",
        fub_kernel::log::Level::Warn => "Errors and warnings",
        fub_kernel::log::Level::Info => "Info, warnings and errors",
        fub_kernel::log::Level::Debug => "Debug",
        fub_kernel::log::Level::Trace => "Everything (trace)",
    }
}

/// Le stringhe del bundle di core: le sue, non quelle del locale.
/// **Il catalogo che il bundle di core monta davvero**: quello di `fub-host`
/// più quelli delle famiglie del kernel, sommati.
///
/// Esiste perché di questa somma esistevano **due** scritture — la riga
/// `.speaking(…)` di [`crate::mount`] e il banco `tests/i_cataloghi.rs`, che la
/// ricostruiva a mano per giudicarla — e un banco che riscrive ciò che
/// giudica giudica sé stesso. La seconda scrittura elencava le famiglie una a
/// una, quindi vedeva benissimo una **chiave** che mancava e mai un
/// **catalogo** che mancava: `maintenance` è rimasta fuori dal montaggio a
/// lungo, con la suite verde.
///
/// Adesso la somma è una funzione, la chiamano tutti e due, e la metà del
/// kernel viene da [`Famiglia::TUTTE`](fub_kernel::famiglie::Famiglia::TUTTE).
pub fn core_catalog_assembled() -> Vec<StringCatalog> {
    // **Due** cataloghi per lingua, e si sommano: le chiavi del core stanno in
    // `fub-host` accanto al loro schema, quelle delle famiglie in `fub-kernel`
    // accanto al proprio. Chi somma è `Strings::template`, e il perché sta nel
    // suo doc.
    [core_catalog(), fub_kernel::families::Family::all_catalogs()].concat()
}

/// **La lingua in cui il catalogo di core è scritto**: il gradino su cui la
/// scala di ripiego atterra quando la lingua di chi guarda non ha una riga.
///
/// Stava scritta `"it"` dentro la riga `.speaking(…)` di [`crate::mount`], e
/// finché il montaggio era l'unico a risolvere andava bene. Da quando risolve
/// anche il livello macchina — che i bundle non li vede, perché risponde
/// **prima** che un vault esista — i posti sono due, e due stringhe che devono
/// restare uguali sono due stringhe che divergono: il giorno che il catalogo
/// nascesse in inglese, chi apre il pannello senza vault leggerebbe le chiavi
/// nude e nessun test lo direbbe.
///
/// I bundle che l'host compone da sé (le feature ufficiali, la pubblicazione,
/// la sincronizzazione) scrivono i cataloghi nella stessa lingua e dichiarano
/// questa costante, non una propria copia della stringa.
pub const CORE_DEFAULT_LOCALE: &str = "it";

pub fn core_catalog() -> Vec<StringCatalog> {
    // Le etichette dei gradini si piegano sopra il catalogo invece che scritte
    // una a una: sono sei, nascono da [`Level::ALL`], e tenerle generate è ciò
    // che le fa coincidere con lo schema senza che nessuno le riconfronti.
    let mut it = StringCatalog::new("it")
        .with(C_GROUP_COMPONENTS, "Componenti")
        .with("host.mount.add.title", "Collega una cartella esterna")
        .with("host.mount.add.desc", "Registra una cartella assoluta già scelta dall'utente, col suo percorso reale; la cartella non può essere un symlink.")
        .with("host.mount.remove.title", "Scollega una cartella esterna")
        .with("host.mount.remove.desc", "Rimuove soltanto la rotta; lascia intatti i file esterni.")
        .with("host.mount.list.title", "Elenca cartelle esterne")
        .with("host.mount.list.desc", "Mostra la tabella delle rotte esterne attive.")
        .with("host.mount.plan.add", "Collega «{name}» ({target}) nel namespace «{namespace}»")
        .with("host.mount.plan.remove", "Scollega «{name}»; i file esterni restano dove sono")
        .with("host.mount.absent", "Nessuna cartella esterna si chiama «{name}».")
        .with("host.param.name", "Nome")
        .with("host.param.absolute_folder", "Cartella assoluta")
        .with("host.param.namespace", "Namespace")
        .with("host.param.folder", "Cartella")
        .with("host.param.doc", "Documento")
        .with("host.trash_os.title", "Sposta nel cestino di sistema")
        .with("host.trash_os.desc", "Prova il cestino del sistema; se non c'è usa il cestino interno senza perdere dati.")
        .with("host.trash_os.fallback", "Il sistema non ha un cestino disponibile: {doc} è nel cestino del vault.")
        .with("host.mount.added", "Cartella esterna «{name}» collegata ({target}).")
        .with("host.mount.removed", "Cartella esterna «{name}» scollegata; i file esterni restano dove sono.")
        .with("host.mount.listed.none", "Nessuna cartella esterna collegata.")
        .with("host.mount.listed", "Cartelle esterne collegate: {routes}.")
        .with("host.mount.listed.only_faulty", "Nessuna cartella esterna raggiungibile. Con problemi: {faulty}.")
        .with("host.mount.listed.faulty", "Cartelle esterne collegate: {routes}. Con problemi: {faulty}.")
        .with("host.folder.title", "Nuova cartella")
        .with("host.folder.desc", "Crea una cartella vuota nel vault; un nome occupato è un conflitto.")
        .with("host.folder.plan", "Crea la cartella «{folder}»")
        .with("host.folder.done", "Cartella «{folder}» creata")
        .with("host.capture.title", "Cattura in una nota")
        .with("host.capture.desc", "Scrive una cattura (clipper, condivisione, CLI) in una nota del vault: nuova, del giorno, o in coda o in testa a una esistente.")
        .with("host.param.capture_payload", "Cattura (JSON v1)")
        .with("host.param.template", "Template")
        .with("host.capture.payload", "La cattura non è un payload v1 leggibile: {why}")
        .with("host.capture.plan", "Cattura «{title}» in «{doc}»")
        .with("host.capture.done", "Cattura salvata in «{doc}»")
        .with("host.capture.not_prose", "«{doc}» non è una nota di testo: la cattura non ci scrive.")
        .with("host.capture.no_properties", "Il formato di «{doc}» non ha proprietà: la cattura con proprietà non ci scrive.")
        .with("host.capture.template_mode", "Un template vale solo per una cattura che crea una nota.")
        .with("host.capture.moved", "«{doc}» è cambiata durante la cattura: riprova.")
        .with("host.vault.moved", "«{doc}» è cambiata dopo aver letto la sua revisione: riprova.")
        .with("host.open_key.malformed", "La chiave di apertura del documento non è valida: da 1 a 64 lettere, cifre, «-» o «_».")
        .with("host.rich.encrypted", "«{doc}» è protetto da una password: Fub non lo apre.")
        .with("host.rich.unreadable", "«{doc}» non si apre: il file è vuoto, rovinato o non è un documento di questo tipo.")
        .with("host.rich.readonly.revisions", "«{doc}» ha revisioni tracciate: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.track_changes", "«{doc}» registra le modifiche: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.protected", "«{doc}» è protetto contro le modifiche: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.projection", "«{doc}» ha parti che l'editor non sa ricomporre senza perderle: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.codec", "«{doc}» non si rileggerebbe identico dopo un salvataggio: si legge, ma non si scrive da qui.")
        .with("host.rich.readonly.import", "«{doc}» è stato letto da un importatore che non ne riporta tutto il contenuto: si legge, ma non si scrive da qui.")
        .with("host.rich.no_writer", "Fub legge i file come «{doc}», ma non li scrive.")
        .with("host.rich.too_large", "«{doc}» pesa {bytes} byte, più di quanto Fub apra.")
        .with("host.rich.projection", "Il contenuto da salvare in «{doc}» non è leggibile: {why}")
        .with("host.rich.version", "Il contenuto da salvare in «{doc}» è di una versione ({version}) che questo Fub non legge.")
        .with("host.rich.opaque_schema", "La formattazione da salvare in «{doc}» è stata scritta da un Fub più nuovo (schema {schema}): questo Fub non la legge, e la bozza resta com'è.")
        .with("host.rich.missing", "Il contenuto da salvare in «{doc}» nomina {what}, che il documento non ha.")
        .with("host.rich.duplicate", "Il contenuto da salvare in «{doc}» mostra due volte la stessa nota o casella di testo.")
        .with("host.rich.fidelity", "«{doc}» non è stato salvato: il file nuovo non si rileggeva uguale a ciò che si voleva scrivere.")
        .with("host.rich.locked.block", "il paragrafo o la tabella {block} di «{doc}» è una parte chiusa: Fub non sa riscriverla senza perderne qualcosa, e da qui non si cambia.")
        .with("host.rich.locked.outside", "la modifica tocca parti di «{doc}» fuori dal testo che Fub non sa riscrivere senza perderle: si salvano soltanto i paragrafi e le tabelle del testo.")
        .with("host.rich.codec", "«{doc}» non si legge o non si scrive nel suo formato: {why}")
        .with("host.resource.reuse_with_expected", "«{doc}» non si deposita: riusare un file con gli stessi byte vale solo per un file nuovo, non per ricoprirne uno.")
        .with("host.xlsx.readonly", "«{doc}» è una cartella .xlsx: Fub ne cambia soltanto i valori delle celle, e non la copre con altri byte.")
        .with("host.xlsx.missing", "«{doc}» non c'è più: Fub non crea una cartella .xlsx dalle celle cambiate.")
        .with("host.xlsx.journal", "Le celle cambiate da salvare in «{doc}» non sono leggibili: {why}")
        .with("host.xlsx.encrypted", "«{doc}» è protetta da una password: Fub non la apre.")
        .with("host.xlsx.too_large", "«{doc}» pesa {bytes} byte, più di quanto Fub apra.")
        .with("host.xlsx.not_xlsx", "«{doc}» non è una cartella .xlsx, anche se ne ha il nome ({found}).")
        .with("host.xlsx.codec", "«{doc}» non si legge come cartella .xlsx: {why}")
        .with("xlsx.rewrite.loses", "La cartella non si salva: riscriverla perderebbe parti del file che Fub non sa scrivere, e il file resta com'era ({why}).")
        .with("host.grid.protocol", "La superficie della griglia parla un'altra versione del protocollo: questa porta non la serve.")
        .with("host.grid.no_surface", "Un provider della griglia deve dichiarare almeno una superficie.")
        .with("host.drawing.unserved", "Il Motore del disegno non c'è in questa versione di Fub: il disegno usa gli strumenti semplici.")
        .with("host.drawing.engine_off", "Il Motore del disegno è spento in questo vault: il disegno usa gli strumenti semplici.")
        .with("host.drawing.complete_off", "Il Disegno completo è spento in questo vault: il disegno usa gli strumenti di Fub. Si riaccende in Componenti.")
        .with("host.drawing.complete_missing", "Il Disegno completo non c'è in questa versione di Fub: il disegno usa gli strumenti di Fub.")
        .with("host.drawing.not_done", "Questo comando del disegno non è ancora pronto in Fub.")
        .with("host.drawing.instance", "Il disegno aperto «{instance}» non c'è più: va riaperto.")
        .with("host.drawing.stopped", "Il Motore del disegno si è fermato sul disegno «{instance}»: si può riprovare.")
        .with("host.drawing.poisoned", "Il Motore del disegno si è fermato: si può riprovare.")
        .with("host.drawing.prefs_newer", "Le preferenze del Motore del disegno vengono da una versione più nuova di Fub: questa le usa ma non le cambia.")
        .with("host.drawing.prefs_broken", "Le preferenze del Motore del disegno non si leggono: per cambiarle ancora, azzerale in Impostazioni › Disegni.")
        .with("host.grid.not_bytes", "La superficie della griglia «{surface}» non è della versione a byte.")
        .with("host.grid.surface_format", "La superficie della griglia «{surface}» non apre «{doc}»: è di un altro formato.")
        .with("host.grid.source_too_large", "La sorgente della griglia pesa {bytes} byte, più del limite.")
        .with("host.wasm.reentrant", "Il componente è stato richiamato mentre era già al lavoro.")
        .with("host.wasm.missing_export", "Il componente non esporta «{interface}».")
        .with("host.wasm.memory_budget", "I componenti hanno finito la memoria: ne tengono già {used} MiB su {ceiling}. Chiudi o disattiva un plugin e riprova.")
        .with("host.turn.cycle", "Il vault sta salvando una nota che aspetta questo componente, e questo componente aspetta il vault: il lavoro si ferma per lasciar finire il salvataggio. Riprova.")
        .with("host.instance.cycle", "Questo componente aspetta un altro componente che a sua volta aspetta questo: il lavoro si ferma per non bloccarli entrambi. Riprova.")
        .with("host.capture.source", "Fonte: {url}")
        .with("host.live.offline", "Il PC non è su una rete locale: nessuna interfaccia attiva ha un indirizzo IPv4 privato.")
        .with("host.live.interfaces", "Le interfacce di rete non si leggono: {why}")
        .with("host.live.address", "{address} non è l'indirizzo privato di un'interfaccia attiva.")
        .with("host.live.bind", "Il PC non riesce ad aspettare il tablet su {address}: {why}")
        .with("host.live.busy", "«{document}» ha già una sessione live.")
        .with("host.live.unknown", "Questa finestra non ha la sessione live {session}.")
        .with("host.live.document", "Il percorso o il titolo del disegno sono troppo lunghi per la sessione live.")
        .with("host.live.too_large", "Il disegno è troppo grande per la sessione live: il tablet non lo può modificare.")
        .with("host.live.ended", "La sessione live è finita.")
        .with("host.live.writer_connected", "Il tablet è collegato: un QR nuovo si chiede quando esce.")
        .with("host.live.refused", "La sessione live ha rifiutato il messaggio: {why}")
        .with("host.live.internal", "La sessione live non si è potuta preparare: {why}")
        .with("host.export.title", "Esporta in una cartella")
        .with("host.export.desc", "Esporta il vault, o una sua cartella, in una cartella nuova fuori dal vault, nel formato scelto.")
        .with("host.param.export_format", "Formato")
        .with("host.param.export_folder", "Cartella del vault da esportare (vuoto: tutto il vault)")
        .with("host.param.export_target", "Cartella di destinazione (path assoluto)")
        .with("host.param.export_options", "Opzioni del formato (JSON)")
        .with("host.export.options", "Le opzioni non sono JSON valido: {why}")
        .with("host.export.plan.vault", "Esporta tutto il vault in «{target}».")
        .with("host.export.plan.folder", "Esporta la cartella «{folder}» in «{target}».")
        .with("host.export.create", "Non si può creare «{target}»: {why}")
        .with("host.export.empty.vault", "Nel vault non c'è niente che questo formato sappia esportare.")
        .with("host.export.empty.folder", "La cartella «{folder}» non c'è, o non contiene niente che questo formato sappia esportare.")
        .with("host.obsidian_import.title", "Importa le impostazioni di Obsidian")
        .with("host.obsidian_import.desc", "Legge .obsidian/ nella radice del vault (impostazioni, aspetto, giornaliera, scorciatoie, segnalibri, frammenti CSS, spazi di lavoro) e scrive le scelte che Fub sa esprimere: allegati, note nuove, link, editor, cestino, cartelle escluse, luce, giornaliera, scorciatoie, segnalibri, frammenti CSS, spazi di lavoro. I file di Obsidian non cambiano; ciò che non si importa si dice per nome.")
        .with("host.obsidian_import.none", "In questo vault non c'è una cartella .obsidian con impostazioni da importare.")
        .with("host.obsidian_import.unreadable", "«{file}» non si legge: {why}")
        .with("host.obsidian_import.plan", "Cambia {count} impostazioni: {list}. Porta {bookmarks} segnalibri, {snippets} frammenti CSS e {workspaces} spazi di lavoro. Non si importano: {lost}.")
        .with("host.obsidian_import.done", "Impostazioni di Obsidian importate: {written} cambiate, {same} erano già così.")
        .with("host.obsidian_import.done_lost", "Impostazioni di Obsidian importate: {written} cambiate, {same} erano già così. Non importate: {lost}.")
        .with("host.connector.notion", "Notion")
        .with("host.connector.airtable", "Airtable")
        .with("host.param.connector", "Connettore")
        .with("host.param.connector_token", "Token (vuoto per toglierlo)")
        .with("host.connector.token.title", "Connettori: salva il token")
        .with("host.connector.token.desc", "Salva su questa macchina, leggibile solo da te, il token con cui Fub importa da Notion o da Airtable. Un token vuoto toglie quello salvato.")
        .with("host.connector.tokens.title", "Connettori: token salvati")
        .with("host.connector.tokens.desc", "Dice quali connettori hanno un token salvato su questa macchina, senza mostrarlo.")
        .with("host.connector.no_config", "Questa installazione non ha una cartella di configurazione: il token non ha dove stare.")
        .with("host.connector.plan.save", "Salverebbe il token di {connector} su questa macchina.")
        .with("host.connector.plan.forget", "Toglierebbe il token di {connector} da questa macchina.")
        .with("host.connector.saved", "Token di {connector} salvato su questa macchina.")
        .with("host.connector.forgotten", "Token di {connector} tolto da questa macchina.")
        .with("host.connector.bad_token", "Un token è una riga sola, di al più 4000 caratteri.")
        .with("host.connector.write", "Il token di {connector} non si è potuto salvare: {why}")
        .with("host.uri.pending.title", "Collegamenti fub:// in arrivo")
        .with("host.uri.pending.desc", "Prende i collegamenti fub:// che il sistema ha aperto, con che cosa chiedono e in quale vault.")
        .with("host.uri.apply.title", "Esegui un collegamento fub://")
        .with("host.uri.apply.desc", "Crea la nota o la cattura che un collegamento fub:// chiede; in prova dice soltanto quale.")
        .with("host.param.uri", "Collegamento")
        .with("host.uri.invalid", "Il collegamento non è valido: {why}")
        .with("host.uri.unknown_vault", "Il vault «{vault}» non è fra quelli che questa macchina conosce.")
        .with("host.uri.no_vault", "Nessun vault aperto: il collegamento non ha dove scrivere.")
        .with("host.uri.reads", "«{action}» non scrive: lo esegue la finestra.")
        .with("host.uri.capture_missing", "La cattura chiede anche «{what}».")
        .with("host.uri.capture_replayed", "Questa cattura è già stata scritta: un nuovo invio con lo stesso nonce non la scrive di nuovo.")
        .with("host.web.clip.title", "Salva la pagina web come nota")
        .with("host.web.clip.desc", "Scarica di nuovo una pagina di un sito approvato e la scrive come nota Markdown, con la fonte; in prova dice soltanto dove.")
        .with("host.param.url", "Indirizzo")
        .with("host.web.clip.not_https", "«{url}» non è un indirizzo https che il visore possa aprire.")
        .with("host.web.clip.not_approved", "Il sito {site} non è fra quelli approvati per il visore: aprilo e approvalo prima di salvarlo.")
        .with("host.web.clip.plan", "Salverebbe {url} come nuova nota nella cartella «{folder}».")
        .with("host.web.clip.plan_root", "Salverebbe {url} come nuova nota nella radice del vault.")
        .with("host.web.clip.no_network", "Questa finestra non ha accesso alla rete: la pagina non si può scaricare.")
        .with("host.net.relay_unavailable", "Fub non è riuscito ad avviare la richiesta di rete: chiudi qualche finestra o programma e riprova.")
        .with("host.map.tile.not_https", "«{url}» non è un indirizzo https di tessere: servono https, nessuna porta diversa da 443, niente credenziali, query o frammento.")
        .with("host.map.tile.not_allowed", "Le tessere di {site} non sono ammesse su questo computer: aggiungi il sito in Impostazioni › Privacy › Tessere delle mappe.")
        .with("host.map.tile.no_network", "Questa finestra non ha accesso alla rete: le tessere non si possono scaricare.")
        .with("host.map.tile.busy", "Troppe tessere in attesa: riprova fra poco.")
        .with("host.map.tile.timeout", "{site} non ha mandato la tessera in tempo.")
        .with("host.map.tile.network", "{site} non risponde: controlla la connessione.")
        .with("host.map.tile.redirect", "{site} ha mandato altrove la richiesta della tessera: i redirect non si seguono.")
        .with("host.map.tile.status", "{site} ha risposto {status} alla richiesta della tessera.")
        .with("host.map.tile.too_large", "Una tessera di {site} supera 1 MiB e non si mostra.")
        .with("host.map.tile.bad_type", "Una tessera di {site} non è un'immagine che la mappa accetti ({kind}).")
        .with("host.control.not_base64", "I byte non sono in base64.")
        .with("host.wasm.render_parts", "Una resa con parti UI non si consegna ancora a un componente.")
        .with("host.control.no_answer", "L'app non risponde sul canale di controllo: {reason}")
        .with("host.control.closed", "L'app ha chiuso il canale di controllo senza rispondere.")
        .with("host.control.bad_reply", "La risposta del canale di controllo non si legge: {reason}")
        .with("host.control.busy", "L'app sta già servendo troppe domande: riprova.")
        .with("host.sync.kdf_unsupported", "Il server della sincronizzazione è di un'altra versione e non accetta la protezione di questa chiave del vault: aggiorna Fub o il server, poi riprova.")
        .with("host.sync.key_epoch_changed", "La chiave del vault è cambiata su un altro dispositivo: chiedi un invito nuovo e accettalo qui prima di sincronizzare.")
        .with("host.sync.rekey_epoch_changed", "La chiave del vault è cambiata mentre preparavi il cambio: sincronizza di nuovo, poi riprova.")
        .with("host.sync.read_only_no_key", "Questo vault non ha ancora una chiave sul server, e la sincronizzazione in sola lettura non può crearla: sincronizza prima da un dispositivo che invia.")
        .with("host.sync.outbox_unserved_key", "Le modifiche in attesa di sincronizzazione sono cifrate con una chiave del vault che il server non ha più. Restano su questo dispositivo, intatte; la sincronizzazione si ferma finché non vengono recuperate.")
        .with("host.control.too_large", "Domanda troppo grande o interrotta.")
        .with("host.control.unreadable", "Domanda illeggibile.")
        .with("host.control.bad_token", "Il token del canale di controllo non è valido.")
        .with("host.viewer.url_unavailable", "L'indirizzo della finestra non si legge: {reason}")
        .with("host.viewer.not_navigated", "Il visore web non ha cambiato pagina: {reason}")
        .with("host.viewer.not_opened", "La finestra del visore web non si è aperta: {reason}")
        .with("host.viewer.bad_action", "«{action}» non è un gesto del visore web.")
        .with("host.viewer.not_open", "Il visore web non è aperto.")
        .with("host.reveal.outside", "{path} è fuori dal vault.")
        .with("host.reveal.root", "La cartella del vault non si legge: {reason}")
        .with(
            "host.open_with.off",
            "Le app Craft sono spente in questo vault: accendi il componente Craft.",
        )
        .with("host.open_with.unknown_editor", "«{editor}» non è un'app che Fub conosce.")
        .with("host.open_with.wrong_kind", "{app} non apre {path}.")
        .with(
            "host.open_with.not_installed",
            "{app} non è installata su questo computer.",
        )
        .with("host.open_with.missing", "{path} non c'è più nel vault.")
        .with("host.open_with.launch_failed", "{app} non si è avviata.")
        .with("host.craft_render.off", "Le anteprime dei file Craft sono spente in questo vault.")
        .with(
            "host.craft_render.no_consent",
            "Fub non usa le app Craft per le anteprime: si permette nelle impostazioni.",
        )
        .with("host.craft_render.no_cli", "Fub non trova il programma a riga di comando dell'app.")
        .with("host.craft_render.ticket", "Fub non è riuscito a preparare l'anteprima: riprova.")
        .with(
            "host.theme_folder.developer_off",
            "Per installare un tema da una cartella accendi la modalità sviluppatore.",
        )
        .with("host.theme_folder.unavailable", "Fub non ha una cartella per i temi su questo computer.")
        .with(
            "host.theme_folder.desktop_only",
            "Su questo dispositivo non si sceglie una cartella: i temi da cartella si installano da Fub sul computer.",
        )
        .with("host.theme_folder.pick_title", "Scegli la cartella del tema")
        .with("host.theme_folder.link_title", "Scegli la cartella del tema da collegare")
        .with(
            "host.theme_folder.link_only",
            "La cartella collegata si sceglie con «Collega una cartella…» in Aspetto.",
        )
        .with(
            "host.theme_folder.pick_failed",
            "La finestra per scegliere la cartella non ha risposto: riprova.",
        )
        .with(
            "host.theme_folder.unreadable_path",
            "Fub non sa leggere il percorso di questa cartella: spostala in una con un nome semplice.",
        )
        .with(
            "host.craft_render.over_limit",
            "Il file supera il peso massimo per un'anteprima fatta dall'app.",
        )
        .with(
            "host.mobile.shared_path",
            "La cartella condivisa non ha un percorso utilizzabile.",
        )
        .with(
            "host.mobile.native_failed",
            "Il sistema non ha risposto sulla cartella condivisa: {reason}",
        )
        .with(
            "host.mobile.copy_only",
            "Su questo dispositivo la cartella condivisa si apre come copia nel vault privato.",
        )
        .with(
            "host.mobile.no_native",
            "La cartella condivisa richiede l'app mobile.",
        )
        .with("host.viewer.action_failed", "Il gesto del visore web non è riuscito: {reason}")
        .with("host.web.clip.status", "Il sito ha risposto {status} per {url}: la pagina non è stata salvata.")
        .with("host.web.clip.not_html", "La risposta è {kind}, non una pagina web: non è stata salvata.")
        .with("host.web.clip.too_large", "La pagina {url} supera i 2 MiB: non è stata salvata.")
        .with("host.web.clip.refused", "La pagina non si può salvare come nota: {why}")
        .with("host.web.clip.done", "Pagina salvata in {doc}.")
        .with("host.web.clip.done_with_notes", "Pagina salvata in {doc}. Rimasto fuori: {notes}")
        .with("host.uri.plan", "Scriverebbe {doc}.")
        .with("host.uri.done", "Scritta {doc}.")
        .with("host.export.done", "Export scritto in «{target}»: {count} file.")
        .with("host.export.done_with_notes", "Export scritto in «{target}»: {count} file, {notes} avvisi su ciò che non è passato.")
        .with("host.snapshot.create.title", "Snapshot completo del vault")
        .with("host.snapshot.create.desc", "Chiude il vault, ne copia ogni voce autorevole in una cartella esterna nuova e lo riapre.")
        .with("host.snapshot.apply.title", "Ripristina uno snapshot completo")
        .with("host.snapshot.apply.desc", "Salva lo stato attuale in una cartella esterna nuova, poi sostituisce il contenuto del vault con lo snapshot e lo riapre.")
        .with("host.param.snapshot_target", "Cartella di destinazione (path assoluto)")
        .with("host.param.snapshot_source", "Snapshot da ripristinare (path assoluto)")
        .with("host.param.snapshot_backup", "Dove salvare lo stato attuale (path assoluto)")
        .with("host.snapshot.plan.create", "Copia ogni voce autorevole di «{root}» in «{target}». Il vault si chiude e si riapre.")
        .with("host.snapshot.plan.apply", "Sostituisce il contenuto di «{root}» con le {count} voci di «{source}». Lo stato attuale viene salvato prima in «{backup}».")
        .with("host.snapshot.done.create", "Snapshot completo scritto in «{target}»: {count} voci.")
        .with("host.snapshot.done.apply", "Vault ripristinato da «{source}»: {count} voci. Lo stato precedente è in «{backup}».")
        .with("host.snapshot.distinct", "Lo snapshot e il backup devono essere cartelle distinte.")
        .with("host.vault.writer_busy", "Un altro processo di Fub sta già scrivendo in «{root}». Chiudilo lì, o usa quell'istanza.")
        .with("host.snapshot.unreadable", "Non è uno snapshot leggibile: {path}")
        .with("host.path.not_absolute", "Serve un path assoluto: {path}")
        .with("host.path.invalid", "Non è una destinazione valida: {path}")
        .with("host.path.missing_parent", "La cartella {path} non esiste.")
        .with("host.path.exists", "{path} esiste già: non si sovrascrive.")
        .with("host.path.inside_vault", "{path} è dentro il vault.")
        .with(C_GROUP_FILES, "File")
        .with(C_ATTACHMENT_FOLDER, "Cartella degli allegati")
        .with(
            C_ATTACHMENT_FOLDER_DESC,
            "La cartella del vault in cui cercare e depositare gli allegati. Con `./` davanti segue la nota: `./` è la sua cartella, `./allegati` una sua sottocartella.",
        )
        .with(C_NEW_NOTE_FOLDER, "Cartella delle nuove note")
        .with(
            C_NEW_NOTE_FOLDER_DESC,
            "La cartella del vault per le note create senza un path esplicito; vuota indica la radice. Con `./` davanti segue la nota aperta: `./` è la sua cartella, `./Bozze` una sua sottocartella.",
        )
        .with(C_NEW_NOTE_EXTENSION, "Estensione delle nuove note")
        .with(
            C_NEW_NOTE_EXTENSION_DESC,
            "L'estensione data a una nota creata senza estensione. Deve appartenere a un formato installato.",
        )
        .with(C_FILES_TRASH, "Note cancellate")
        .with(
            C_FILES_TRASH_DESC,
            "Dove finisce una nota cancellata: il cestino del vault o quello del sistema. Se il sistema non ne ha uno, si usa il cestino del vault.",
        )
        .with(C_FILES_AUTO_REVEAL, "Mostra la nota aperta nell'esplora")
        .with(
            C_FILES_AUTO_REVEAL_DESC,
            "Cambiando nota, l'esplora apre le cartelle che la contengono e la porta in vista.",
        )
        .with(C_FILES_TRASH_VAULT, "Cestino del vault")
        .with(C_FILES_TRASH_SYSTEM, "Cestino del sistema")
        .with(C_FILES_CONFIRM_TRASH, "Conferma prima di cestinare una cartella")
        .with(
            C_FILES_CONFIRM_TRASH_DESC,
            "Spenta, la cartella va subito nel cestino del vault; «Annulla» nell'avviso la riporta. Svuotare il cestino chiede sempre.",
        )
        .with(
            C_FILES_LEGACY_FOLDER_PAGES,
            "Riconosci i vecchi nomi della pagina della cartella",
        )
        .with(
            C_FILES_LEGACY_FOLDER_PAGES_DESC,
            "Oltre a Cartella/_index.md, apre come pagina della cartella anche Cartella/Cartella.md e Cartella/index.md, come Obsidian. Nessun file cambia nome.",
        )
        .with(C_GROUP_EXTERNAL_APPS, "App esterne")
        .with(C_CRAFT_EDITOR_PATHS, "Dove sono le app Craft")
        .with(
            C_CRAFT_EDITOR_PATHS_DESC,
            "Una riga per programma, come vectorcraft=/opt/vc/vectorcraft, o vectorcraft-cli=… per la riga di comando. Il percorso intero vince su quello che Fub trova da solo.",
        )
        .with(C_CRAFT_CLI_PREVIEWS, "Anteprime fatte dalle app")
        .with(
            C_CRAFT_CLI_PREVIEWS_DESC,
            "Fub fa fare l'anteprima di un file che non ne ha una all'app che lo apre, su una copia, solo quando apri il file tu.",
        )
        .with(C_CRAFT_CLI_PREVIEWS_ASK, "Chiedi la prima volta")
        .with(C_CRAFT_CLI_PREVIEWS_ON, "Accese")
        .with(C_CRAFT_CLI_PREVIEWS_OFF, "Spente")
        .with(
            C_CRAFT_PREVIEW_MAX_MIB,
            "Peso massimo da leggere per un'anteprima (MiB)",
        )
        .with(
            C_CRAFT_PREVIEW_MAX_MIB_DESC,
            "Un file che va letto intero per l'anteprima e pesa di più resta senza: i file che si leggono a pezzi non hanno limite.",
        )
        .with(C_CRAFT_TREE_THUMBNAILS, "Miniature nell'albero")
        .with(
            C_CRAFT_TREE_THUMBNAILS_DESC,
            "Accanto al nome di un file Craft, di un RAW, di un PDF o di un documento, la piccola anteprima che il file ha già. L'albero non avvia mai un'app.",
        )
        .with(C_CRAFT_TREE_SHOW_XMP, "Mostra i file XMP nell'albero")
        .with(
            C_CRAFT_TREE_SHOW_XMP_DESC,
            "Spento, gli XMP spariscono dall'albero: la ricerca li trova e la foto mostra i loro dati.",
        )
        .with(C_URI_ALLOWED, "Collegamenti fub:// che scrivono senza chiedere")
        .with(
            C_URI_ALLOWED_DESC,
            "Le azioni scelte (nota nuova, giornaliera, nota unica) scrivono appena il collegamento arriva, senza conferma. Una cattura e l'apertura di un altro vault chiedono sempre. Vale su questo computer.",
        )
        .with(C_FILES_LINK_STYLE, "Nuovi link")
        .with(
            C_FILES_LINK_STYLE_DESC,
            "Come si scrive il link a una nota trascinata nel testo o copiata. I link Markdown li leggono anche gli altri programmi.",
        )
        .with(C_FILES_LINK_WIKI, "Wikilink")
        .with(C_FILES_LINK_MARKDOWN, "Link Markdown")
        .with(C_FILES_LINK_FORMAT, "Percorso dei nuovi link")
        .with(
            C_FILES_LINK_FORMAT_DESC,
            "Un link Markdown è sempre un percorso: «più corto» lo scrive relativo. Un wikilink non ha forma relativa: «relativo» lo scrive dalla radice del vault.",
        )
        .with(C_FILES_LINK_SHORTEST, "Il più corto possibile")
        .with(C_FILES_LINK_RELATIVE, "Relativo alla nota")
        .with(C_FILES_LINK_ABSOLUTE, "Dalla radice del vault")
        .with(C_FILES_STARTUP, "All'avvio apri")
        .with(
            C_FILES_STARTUP_DESC,
            "Che cosa si apre all'avvio, sopra le schede della volta precedente.",
        )
        .with(C_FILES_STARTUP_SESSION, "Le schede della volta precedente")
        .with(C_FILES_STARTUP_DAILY, "La nota del giorno")
        .with(C_FILES_STARTUP_NEW, "Una nota nuova")
        .with(C_FILES_STARTUP_FIXED, "Una nota precisa")
        .with(C_FILES_STARTUP_NOTE, "Nota da aprire all'avvio")
        .with(
            C_FILES_STARTUP_NOTE_DESC,
            "Il percorso nel vault della nota che «Una nota precisa» apre; senza estensione vale .md.",
        )
        .with(C_FILES_PEOPLE_FOLDER, "Cartella delle persone")
        .with(
            C_FILES_PEOPLE_FOLDER_DESC,
            "@ in una nota propone le note di questa cartella e scrive il link alla persona; una persona nuova nasce qui. Vuota, @ non propone persone.",
        )
        .with(C_FILES_TYPES_FOLDER, "Cartella dei tipi di nota")
        .with(
            C_FILES_TYPES_FOLDER_DESC,
            "Ogni nota di questa cartella è un tipo: il suo frontmatter dice icona, proprietà e cartella delle note nuove, il suo testo è il modello. Vuota, i tipi sono spenti.",
        )
        .with(C_GROUP_APPEARANCE, "Aspetto")
        .with(C_GROUP_CHROME, "Interfaccia")
        .with(C_CHROME_SCHEMA, "Versione configurazione dell'interfaccia")
        .with(C_CHROME_SCHEMA_DESC, "Versione del formato locale; per cambiare versione è necessaria una riapertura.")
        .with(C_CHROME_RAIL, "Mostra barra laterale")
        .with(C_CHROME_RAIL_DESC, "Mostra la colonna di icone che apre i pannelli.")
        .with(C_CHROME_ORDER, "Ordine della barra laterale")
        .with(C_CHROME_ORDER_DESC, "ID dei pannelli nell'ordine desiderato; quelli non elencati restano visibili.")
        .with(C_CHROME_HIDDEN, "Pannelli nascosti dalla barra laterale")
        .with(C_CHROME_HIDDEN_DESC, "ID dei pannelli che la barra laterale non mostra.")
        .with(C_CHROME_SIDEBAR, "Mostra il pannello a sinistra")
        .with(C_CHROME_SIDEBAR_DESC, "Lo affianca ai riquadri quando la finestra è larga abbastanza; altrimenti si apre a richiesta.")
        .with(C_CHROME_INSPECTOR, "Mostra il pannello a destra")
        .with(C_CHROME_INSPECTOR_DESC, "Lo affianca ai riquadri quando la finestra è larga abbastanza; altrimenti si apre a richiesta.")
        .with(C_CHROME_STATUS, "Mostra lo stato del documento")
        .with(C_CHROME_STATUS_DESC, "Mostra salvataggio e statistiche nella barra del riquadro.")
        .with(C_CHROME_TOOLBAR, "Mostra strumenti del pannello")
        .with(C_CHROME_TOOLBAR_DESC, "Mostra i comandi contestuali del pannello.")
        .with(C_CHROME_FORMATBAR, "Mostra la barra di formattazione")
        .with(
            C_CHROME_FORMATBAR_DESC,
            "Spenta, i comandi di formattazione compaiono sulla selezione.",
        )
        .with(C_CHROME_FRAME, "Cornice finestra")
        .with(C_CHROME_FRAME_DESC, "Il cambio di cornice richiede la riapertura e dipende dalle capacità del sistema.")
        .with(C_FRAME_SYSTEM, "Del sistema")
        .with(C_FRAME_CUSTOM, "Personalizzata")
        .with(C_GROUP_PROFILE, "Profilo")
        .with(C_PROFILE_NAME, "Il tuo nome")
        .with(
            C_PROFILE_NAME_DESC,
            "Firma i commenti che scrivi nelle note. Il nome finisce nel file della nota: chi lo apre, anche con un altro programma, lo legge. Cambiarlo vale per i commenti nuovi.",
        )
        .with(C_COMMENTS_AUTHOR, "Firma dei commenti in questo vault")
        .with(
            C_COMMENTS_AUTHOR_DESC,
            "Che cosa scrive Fub accanto a ogni commento nuovo di questo vault. Senza firma il commento si legge «Senza nome».",
        )
        .with(C_COMMENTS_AUTHOR_NAME, "Il nome")
        .with(C_COMMENTS_AUTHOR_INITIALS, "Le iniziali")
        .with(C_COMMENTS_AUTHOR_NONE, "Nessuna firma")
        .with(C_GROUP_EDITOR, "Editor")
        .with(C_EDITOR_SPELLCHECK, "Controllo ortografico")
        .with(C_EDITOR_SPELLCHECK_DESC, "Usa il controllo ortografico del sistema mentre scrivi.")
        .with(C_EDITOR_VIM, "Modalità Vim")
        .with(C_EDITOR_VIM_DESC, "Usa i comandi Vim nel motore testuale; spenta per impostazione predefinita.")
        .with(C_EDITOR_LINE_NUMBERS, "Numeri di riga")
        .with(C_EDITOR_LINE_NUMBERS_DESC, "Mostra i numeri di riga in modalità Sorgente.")
        .with(C_EDITOR_CLOSE_BRACKETS, "Chiusura automatica di parentesi")
        .with(C_EDITOR_CLOSE_BRACKETS_DESC, "Scrivendo una parentesi, una virgoletta o un simbolo di apertura, chiude da sé la coppia.")
        .with(C_EDITOR_FOLD_GUTTER, "Margine di piegatura")
        .with(C_EDITOR_FOLD_GUTTER_DESC, "Mostra nel margine le frecce per piegare titoli e blocchi.")
        .with(C_EDITOR_SMART_LISTS, "Elenchi intelligenti")
        .with(C_EDITOR_SMART_LISTS_DESC, "Invio continua la voce dell'elenco e su una voce vuota chiude l'elenco. Spenti, Invio va a capo e basta.")
        .with(C_EDITOR_STRICT_LINE_BREAKS, "Interruzioni di riga rigorose")
        .with(C_EDITOR_STRICT_LINE_BREAKS_DESC, "Acceso, una riga a capo singola in Lettura si unisce alla riga prima, come in CommonMark. Spento, resta un'interruzione.")
        .with(C_EDITOR_RTL, "Testo da destra a sinistra")
        .with(C_EDITOR_RTL_DESC, "Per l'arabo, l'ebraico e le altre scritture da destra a sinistra: l'editor e la Lettura partono dal margine destro.")
        .with(C_EDITOR_INDENT_GUIDES, "Guide di rientro")
        .with(C_EDITOR_INDENT_GUIDES_DESC, "Disegna una riga verticale per ogni livello di rientro. Funziona in modalità Sorgente.")
        .with(C_EDITOR_CURSOR_BLINK, "Cursore che lampeggia")
        .with(C_EDITOR_CURSOR_BLINK_DESC, "Il cursore dell'editor si accende e si spegne. Di serie sta fermo, per non distrarre mentre si legge.")
        .with(C_EDITOR_SOFT_CURSOR, "Cursore morbido")
        .with(C_EDITOR_SOFT_CURSOR_DESC, "Nei Blocchi il cursore scivola fino al punto nuovo invece di saltarci. Mai mentre scrivi, e mai col movimento ridotto.")
        .with(C_EDITOR_TYPEWRITER, "Macchina da scrivere")
        .with(C_EDITOR_TYPEWRITER_DESC, "La riga del cursore resta a metà altezza del foglio e il testo le scorre sotto, come il foglio in una macchina da scrivere. In cima a una nota corta il testo non scende oltre l'inizio.")
        .with(C_EDITOR_PREVIEW_MODIFIER, "Anteprima dei link solo con Ctrl")
        .with(C_EDITOR_PREVIEW_MODIFIER_DESC, "Passando sopra un link, l'anteprima della nota si apre solo tenendo premuto Ctrl (Cmd sul Mac), anche in Lettura. Mentre si scrive serve sempre.")
        .with(C_EDITOR_PASTE_HTML, "Converti l'HTML incollato")
        .with(C_EDITOR_PASTE_HTML_DESC, "Incollando testo formattato da un'altra app, lo trasforma in Markdown. Spento, incolla il testo semplice.")
        .with(C_EDITOR_LINE_WRAP, "A capo automatico")
        .with(C_EDITOR_LINE_WRAP_DESC, "Manda a capo le righe lunghe invece di farle scorrere in orizzontale.")
        .with(C_EDITOR_INDENT, "Rientro")
        .with(C_EDITOR_INDENT_DESC, "Cosa inserisce Tab e come si rientrano gli elenchi.")
        .with(C_EDITOR_INDENT_TAB, "Tabulazione")
        .with(C_EDITOR_INDENT_2, "2 spazi")
        .with(C_EDITOR_INDENT_4, "4 spazi")
        .with(C_EDITOR_PROPERTIES, "Proprietà nel testo")
        .with(C_EDITOR_PROPERTIES_DESC, "Come Scrittura mostra il frontmatter in cima alla nota. Un click sulle proprietà riapre lo YAML da scrivere; in Sorgente resta sempre YAML.")
        .with(C_EDITOR_PROPERTIES_VISIBLE, "Visibili")
        .with(C_EDITOR_PROPERTIES_HIDDEN, "Nascoste")
        .with(C_EDITOR_PROPERTIES_SOURCE, "YAML")
        .with(C_EDITOR_MINIBAR, "Mini-barra di formattazione")
        .with(C_EDITOR_MINIBAR_DESC, "I gesti di formattazione accanto al puntatore: sopra il menu del tasto destro e, se si vuole, sul testo scelto.")
        .with(C_EDITOR_MINIBAR_AUTO, "Col tasto destro, e sul testo scelto se la barra non è completa")
        .with(C_EDITOR_MINIBAR_ALWAYS, "Col tasto destro e su ogni testo scelto")
        .with(C_EDITOR_MINIBAR_MENU, "Soltanto col tasto destro")
        .with(C_EDITOR_MINIBAR_OFF, "Mai")
        .with(C_EDITOR_TOOLBAR, "Barra di formato")
        .with(C_EDITOR_TOOLBAR_DESC, "Sopra il foglio. Compatta: poche cose fisse, lo stile e gli strumenti del blocco in cui sta il cursore. Completa: tutti i pulsanti. Nascosta: resta la mini-barra sul testo scelto.")
        .with(C_EDITOR_TOOLBAR_COMPACT, "Compatta")
        .with(C_EDITOR_TOOLBAR_FULL, "Completa")
        .with(C_EDITOR_TOOLBAR_HIDDEN, "Nascosta")
        .with(C_EDITOR_LINK_CLICK, "Clic su un link a una nota")
        .with(C_EDITOR_LINK_CLICK_DESC, "Che cosa fa il clic che apre un link: portare la nota nel riquadro, o aprirla nella sbirciata, sopra la destra del foglio, dove si scrive senza lasciare la nota di prima. Alt col clic, o Alt Invio, sbircia sempre.")
        .with(C_EDITOR_LINK_CLICK_OPEN, "Apre la nota")
        .with(C_EDITOR_LINK_CLICK_PEEK, "Sbircia la nota")
        .with(C_EDITOR_GRID_COPY_MARK, "Segno della copia nei fogli di calcolo")
        .with(C_EDITOR_GRID_COPY_MARK_DESC, "Che cosa resta sulle celle che copi: un tratteggio largo finché non incolli, un battito che si accende e svanisce, o tutti e due. Il taglio resta sempre un tratteggio fitto.")
        .with(C_EDITOR_GRID_COPY_MARK_BOTH, "Tratteggio e battito")
        .with(C_EDITOR_GRID_COPY_MARK_DASH, "Solo il tratteggio")
        .with(C_EDITOR_GRID_COPY_MARK_PULSE, "Solo il battito")
        .with(C_EDITOR_GRID_SELECTION_SPEED, "Velocità della selezione nei fogli di calcolo")
        .with(C_EDITOR_GRID_SELECTION_SPEED_DESC, "Come la selezione va alla cella nuova, coi tasti e col puntatore: scivola più svelta, come di norma o più morbida, oppure salta di cella in cella. Col movimento ridotto si ferma subito, qualunque sia la scelta.")
        .with(C_EDITOR_GRID_SELECTION_SPEED_QUICK, "Svelta")
        .with(C_EDITOR_GRID_SELECTION_SPEED_NORMAL, "Come di norma")
        .with(C_EDITOR_GRID_SELECTION_SPEED_SOFT, "Morbida")
        .with(C_EDITOR_GRID_SELECTION_SPEED_NONE, "A scatti")
        .with(C_EDITOR_SLASH, "Menu «/» nel testo")
        .with(C_EDITOR_SLASH_DESC, "Un «/» a inizio riga o dopo uno spazio apre i blocchi e i comandi, filtrati da ciò che si scrive dopo. Esc lo lascia come testo.")
        .with(C_EDITOR_HINTS, "Riga dei suggerimenti")
        .with(C_EDITOR_HINTS_DESC, "Al centro della banda in basso, i tasti utili per ciò che stai facendo, con le tue scorciatoie. Non c'è al telefono né in una finestra più stretta di 620 px.")
        .with(C_EDITOR_TYPOGRAPHY, "Tipografia italiana")
        .with(C_EDITOR_TYPOGRAPHY_DESC, "Mentre scrivi, le virgolette diventano « », due trattini —, tre punti … e l'apostrofo ’. Vale nelle note in italiano, fuori da codice, formule e link; Backspace subito dopo rimette ciò che avevi scritto.")
        .with(C_EDITOR_SLASH_HIDDEN, "Voci nascoste dal menu «/»")
        .with(C_EDITOR_SLASH_HIDDEN_DESC, "Gli id dei comandi che il menu «/» non mostra. Restano nella palette e da tastiera.")
        .with(C_EDITOR_SLASH_SECTIONS, "Ordine delle sezioni del menu «/»")
        .with(C_EDITOR_SLASH_SECTIONS_DESC, "Le sezioni dopo Suggeriti, Preferiti e Recenti. Quelle non elencate seguono nel loro ordine.")
        .with(C_EDITOR_DEFAULT_MODE, "Modalità iniziale")
        .with(C_EDITOR_DEFAULT_MODE_DESC, "La modalità di una finestra nuova o di un vault aperto per la prima volta. Un riquadro diviso eredita quella del riquadro da cui nasce, e ognuno ricorda la sua.")
        .with(C_EDITOR_LIVE_REVEAL, "Segni del Markdown in Scrittura")
        .with(C_EDITOR_LIVE_REVEAL_DESC, "I segni del Markdown si vedono in Sorgente; qui si sceglie se mostrarli anche in Scrittura.")
        .with(C_EDITOR_LIVE_REVEAL_NEVER, "Mai")
        .with(C_EDITOR_LIVE_REVEAL_ELEMENT, "Dell'elemento del cursore")
        .with(C_EDITOR_LIVE_REVEAL_LINE, "Della riga del cursore")
        .with(C_EDITOR_LIVE_GUIDE, "Guida mentre scrivi")
        .with(C_EDITOR_LIVE_GUIDE_DESC, "In Scrittura un segno aperto dà subito lo stile al testo e mostra in grigio la chiusura che manca; lo spazio chiude apice e pedice.")
        .with(C_EDITOR_MATH_SOURCE, "Mostra il LaTeX delle formule")
        .with(C_EDITOR_MATH_SOURCE_DESC, "Accesa, sotto la formula toccata c'è il campo del suo LaTeX e si scrive lì; il clic sulla formula porta solo agli spazi vuoti. Spenta, la formula resta disegnata e si modifica toccandola: si clicca dove si vuole scrivere.")
        .with(C_EDITOR_MATH_HELP, "Aiuti nel LaTeX delle formule")
        .with(C_EDITOR_MATH_HELP_DESC, "Con «Mostra il LaTeX delle formule» accesa. Pieni: parentesi che si chiudono, completamento dopo \\, scrittura veloce (a/b, alpha, ->) e tavolozza. Discreti: solo parentesi e completamento, la tavolozza a richiesta. Spenti: il LaTeX che scrivi e la sua anteprima, nient'altro.")
        .with(C_EDITOR_MATH_HELP_FULL, "Pieni")
        .with(C_EDITOR_MATH_HELP_DISCREET, "Discreti")
        .with(C_EDITOR_MATH_HELP_OFF, "Spenti")
        .with(C_EDITOR_BLOCKS, "Blocchi: maniglie e selezione")
        .with(C_EDITOR_BLOCKS_DESC, "Accesi, ogni blocco ha la maniglia e il «+», Esc seleziona il blocco e Ctrl A prende il blocco, poi tutti. Spenti, Scrittura è un editor di testo: Ctrl A seleziona tutto il testo e Ctrl D la prossima occorrenza.")
        .with(C_MODE_SOURCE, "Sorgente")
        .with(C_MODE_WRITING, "Scrittura")
        .with(C_MODE_READING, "Lettura")
        .with(C_GROUP_PRIVACY, "Privacy")
        .with(C_HISTORY, "Ricerche e note recenti")
        .with(
            C_HISTORY_DESC,
            "Ricorda cosa hai cercato e quali note hai aperto, per riproporteli \
             quando torni. Resta su questo computer e non entra nel vault. \
             Spegnendolo, ciò che era già stato ricordato viene cancellato.",
        )
        .with(C_PLUGINS_DISABLED, "Componenti spenti")
        .with(
            C_PLUGINS_DISABLED_DESC,
            "Gli id dei componenti che non vengono montati all'apertura di questo \
             vault. Si cambiano accendendo e spegnendo un componente, non scrivendo \
             qui dentro.",
        )
        .with(C_COMPONENTS_OFF, "Altri componenti spenti")
        .with(
            C_COMPONENTS_OFF_DESC,
            "I componenti spenti che non sono fra quelli montati, come la lavagna \
             e il PDF. Si cambiano accendendo e spegnendo un componente.",
        )
        .with(C_COMPONENTS_KEPT, "Componenti tenuti")
        .with(
            C_COMPONENTS_KEPT_DESC,
            "I componenti tenuti accesi con «Tienili» anche se non servono più a \
             nessun altro.",
        )
        .with(C_COMPONENTS_WAITING, "Componenti in attesa")
        .with(
            C_COMPONENTS_WAITING_DESC,
            "I componenti che non servono più a nessuno e sono ancora accesi, in \
             attesa che tu scelga «Togli» o «Tienili».",
        )
        .with(C_COMPONENTS_PROFILE, "Profilo")
        .with(
            C_COMPONENTS_PROFILE_DESC,
            "Il profilo dei componenti scelto per questo vault. Vuoto vuol dire \
             personalizzato: lo diventa appena accendi o spegni un componente.",
        )
        .with(C_THEME, "Tema")
        .with(
            C_THEME_DESC,
            "In che luce disegnare l'interfaccia. «Come il sistema» segue le \
             preferenze del sistema operativo, anche quando cambiano mentre \
             Fub è aperto.",
        )
        .with(C_THEME_LIGHT, "Chiaro")
        .with(C_THEME_DARK, "Scuro")
        .with(C_CONTRAST, "Contrasto")
        .with(
            C_CONTRAST_DESC,
            "Segue il sistema oppure usa sempre il contrasto normale o alto.",
        )
        .with(C_CONTRAST_NORMAL, "Normale")
        .with(C_CONTRAST_HIGH, "Alto")
        .with(C_DENSITY, "Densità")
        .with(
            C_DENSITY_DESC,
            "Compatta o allarga la spaziatura dei controlli senza cambiare la disposizione dei pannelli.",
        )
        .with(C_DENSITY_COMPACT, "Compatta")
        .with(C_DENSITY_COMFORTABLE, "Comoda")
        .with(C_DENSITY_RELAXED, "Rilassata")
        .with(C_BARS, "Le barre")
        .with(
            C_BARS_DESC,
            "Il vassoio sotto le schede, le barre dei comandi e la colonna degli strumenti: chiaro, vicino alla carta, o marcato, che si stacca di più.",
        )
        .with(C_BARS_LIGHT, "Chiare")
        .with(C_BARS_MARKED, "Marcate")
        .with(C_BODY, "Corpo del testo (px)")
        .with(
            C_BODY_DESC,
            "Dimensione del testo nelle superfici di lettura.",
        )
        .with(C_LINE_HEIGHT, "Interlinea")
        .with(C_LINE_HEIGHT_DESC, "Passo verticale della prosa lunga.")
        .with(C_MEASURE, "Misura della riga (caratteri)")
        .with(
            C_MEASURE_DESC,
            "Larghezza massima della colonna di lettura.",
        )
        .with(C_FONT, "Carattere di lettura")
        .with(C_FONT_DESC, "Famiglia usata per la prosa lunga.")
        .with(C_FONT_NEWSREADER, "Newsreader")
        .with(C_FONT_HANKEN, "Hanken Grotesk")
        .with(C_FONT_LITERATA, "Literata")
        .with(C_FONT_INTER, "Inter")
        .with(C_FONT_SYSTEM, "Del sistema")
        .with(C_FONT_UI, "Carattere dell'interfaccia")
        .with(C_FONT_UI_DESC, "Famiglia di barre, cassetti, menu e finestre.")
        .with(C_FONT_MONO, "Carattere del codice")
        .with(C_FONT_MONO_DESC, "Famiglia a spaziatura fissa del codice e del sorgente.")
        .with(C_FONT_PLEX, "IBM Plex Mono")
        .with(C_FONT_JETBRAINS, "JetBrains Mono")
        .with(C_ACCENT, "Tinta dell'accento")
        .with(
            C_ACCENT_DESC,
            "Il colore di collegamenti, fuoco e selezione. Chiarezza e intensità si adattano da sole per restare leggibili.",
        )
        .with(C_COMPACTNESS, "Spazio dell'interfaccia")
        .with(C_COMPACTNESS_DESC, "Quanto posto prendono barre, binario e cassetti: da 0, ampia, a 4, minima. Il foglio e le sue linguette non cambiano.")
        .with(C_ZOOM, "Zoom interfaccia")
        .with(C_ZOOM_DESC, "Quanto è grande tutta l'interfaccia, dal 50% al 200%.")
        .with(C_THEME_ID, "Tema installato")
        .with(C_THEME_ID_DESC, "L'id del tema montato; si sceglie dal catalogo dei temi.")
        .with(C_MOTION, "Animazioni")
        .with(C_MOTION_DESC, "Segue la preferenza del sistema, oppure toglie rimbalzi e scene, oppure riduce sempre le animazioni dell'interfaccia.")
        .with(C_MOTION_CALM, "Calme")
        .with(C_MOTION_REDUCED, "Ridotte")
        .with(C_FRAME_RATE, "Fotogrammi al secondo")
        .with(C_FRAME_RATE_DESC, "Tetto delle animazioni disegnate dall'interfaccia. Il massimo segue il refresh dello schermo, qualunque sia.")
        .with(C_FRAME_RATE_DISPLAY, "Massimo dello schermo")
        .with(C_FRAME_RATE_CAP, "{fps} fps")
        .with(C_RENDERING, "Disegno delle pagine")
        .with(
            C_RENDERING_DESC,
            "Chi disegna le finestre di Fub. Automatico lascia la scelta a WebKit e ti avvisa dei problemi noti; Processore aiuta con alcuni driver che sfarfallano. Vale dal prossimo avvio.",
        )
        .with(C_RENDERING_AUTO, "Automatico")
        .with(C_RENDERING_GPU, "Scheda grafica")
        .with(C_RENDERING_CPU, "Processore")
        .with(C_DIAGRAM_STYLE, "Stile dei diagrammi")
        .with(
            C_DIAGRAM_STYLE_DESC,
            "Colori e tratto dei diagrammi Mermaid; «%% stile: nome» lo cambia per uno solo.",
        )
        .with(C_DIAGRAM_STYLE_ARMONIA, "Armonia — segue il tema")
        .with(C_DIAGRAM_STYLE_ACQUERELLO, "Acquerello — tinte pastello")
        .with(C_DIAGRAM_STYLE_AURORA, "Aurora — colori vivi e profondi")
        .with(C_DIAGRAM_STYLE_BLUEPRINT, "Blueprint — tavola tecnica")
        .with(C_DIAGRAM_STYLE_INCHIOSTRO, "Inchiostro — editoriale")
        .with(C_CONTENT_LOOK, "Aspetto dei documenti")
        .with(
            C_CONTENT_LOOK_DESC,
            "Come si mostra un file che ha un aspetto suo, come un documento: la sua pagina, o la pagina adattata alla luce del tema. Automatico sceglie la pagina, e quella adattata con il contrasto alto.",
        )
        .with(C_CONTENT_LOOK_AUTO, "Automatico")
        .with(C_CONTENT_LOOK_FILE, "Pagina")
        .with(C_CONTENT_LOOK_ADAPTED, "Pagina adattata")
        .with(C_CSS_SNIPPETS, "Frammenti CSS locali")
        .with(C_CSS_SNIPPETS_DESC, "Frammenti attivabili, locali e limitati agli hook visivi; nessuna rete o importazione CSS.")
        .with(C_GROUP_SYNC, "Sincronizzazione")
        .with(C_SYNC_SERVER_URL, "Server di sincronizzazione")
        .with(
            C_SYNC_SERVER_URL_DESC,
            "URL HTTPS del servizio; HTTP è ammesso solo in loopback. Vuoto significa nessun server configurato.",
        )
        .with(C_SYNC_PAUSED, "Sospendi sincronizzazione")
        .with(
            C_SYNC_PAUSED_DESC,
            "Ferma le nuove operazioni di replica senza cancellare i dati o la coda locale.",
        )
        .with(C_SYNC_EXCLUDE, "Esclusioni aggiuntive")
        .with(
            C_SYNC_EXCLUDE_DESC,
            "Elementi da non replicare. Le esclusioni di sicurezza restano sempre attive.",
        )
        .with(C_GROUP_PUBLISH, "Pubblicazione")
        .with(C_PUBLISH_SERVER_URL, "Server di pubblicazione")
        .with(
            C_PUBLISH_SERVER_URL_DESC,
            "URL HTTPS del servizio; HTTP è ammesso solo in loopback. Vuoto significa nessun server configurato.",
        )
        .with(
            C_REJECTED_TIMEZONE,
            "«{name}» non è un fuso orario conosciuto. Scrivi un nome IANA come Europe/Rome, \
             oppure lascia vuoto per usare quello del sistema.",
        )
        .with(
            C_REJECTED_SERVER_URL,
            "«{value}» non è un indirizzo di server valido. Scrivi un indirizzo https://, \
             oppure http:// solo verso 127.0.0.1, ::1 o localhost; vuoto vuol dire nessun server.",
        )
        .with(
            C_REJECTED_TILE_HOST,
            "«{value}» non è un nome di host. Scrivi soltanto il nome, per esempio tile.openstreetmap.org: senza https://, porta o percorso.",
        )
        .with(C_MAP_TILE_HOSTS, "Tessere delle mappe")
        .with(
            C_MAP_TILE_HOSTS_DESC,
            "I siti da cui la vista Mappa di una Base può scaricare le tessere, quando premi «Attiva». Vuota, le mappe restano offline e nessuna richiesta esce dal computer.",
        )
        .with(C_GROUP_VIEWER, "Visore web")
        .with(C_VIEWER_HOSTS, "Siti approvati")
        .with(
            C_VIEWER_HOSTS_DESC,
            "I siti che il visore apre senza chiedere, uno per riga (per esempio it.wikipedia.org). Solo https; un sottodominio va scritto a parte.",
        )
        .with(C_VIEWER_LINKS, "Apri i link web nel visore")
        .with(
            C_VIEWER_LINKS_DESC,
            "Un link https di una nota si apre nel visore isolato invece che nel browser di sistema. Alt+clic lo apre nel visore in ogni caso.",
        )
        .with(C_GROUP_LIVE, "Sessione live")
        .with(C_LIVE_PORT, "Porta della sessione live")
        .with(
            C_LIVE_PORT_DESC,
            "La porta su cui il PC aspetta il tablet. 0 sceglie una porta libera a ogni sessione; un numero fisso serve alle reti con regole del firewall.",
        )
        .with(C_GROUP_DIAGNOSTICS, "Diagnostica")
        .with(C_LOG_LEVEL, "Livello del log")
        .with(
            C_LOG_LEVEL_DESC,
            "Quanto dettaglio va nel file di log. Il predefinito tiene ciò che \
             serve a capire cosa è successo dopo, senza rumore; alzatelo solo \
             per cercare un difetto.",
        )
        .with(C_LOG_VERBOSE, "Componenti verbosi")
        .with(
            C_LOG_VERBOSE_DESC,
            "Gli id dei componenti di cui vedere tutto, fino al debug, qualunque \
             sia il livello. È il modo di seguire un solo componente senza \
             alzare il rumore di tutti gli altri.",
        )
        .with(C_PERF_PROBE, "Sonda delle prestazioni")
        .with(
            C_PERF_PROBE_DESC,
            "Misura quanto passa da un tasto, un clic o un tratto di penna al \
             fotogramma che lo mostra, e conta i fotogrammi lunghi. I numeri \
             restano su questo computer: servono ai banchi di misura.",
        )
        .with(C_GROUP_DEVELOPMENT, "Sviluppo")
        .with(C_DEVELOPER_MODE, "Modalità sviluppatore")
        .with(
            C_DEVELOPER_MODE_DESC,
            "Per chi scrive un tema: in «Temi installati» compaiono «Installa da \
             cartella…», che lo controlla e lo installa dalla sua cartella, \
             «Collega una cartella…», che lo rimonta a ogni salvataggio, e \
             «Tutti i componenti», che mostra ogni componente in ogni stato.",
        )
        .with(C_DEVELOPER_THEME_FOLDER, "Cartella collegata")
        .with(
            C_DEVELOPER_THEME_FOLDER_DESC,
            "La cartella del tema in sviluppo: Fub la guarda e rimonta il tema a \
             ogni salvataggio. Si sceglie e si scollega da «Temi installati».",
        );
    for level in fub_kernel::log::Level::ALL {
        it = it.with(
            format!("{C_LOG_LEVEL}{}", level.as_str()),
            level_label_it(level),
        );
    }

    let mut en = StringCatalog::new("en")
        .with(C_GROUP_COMPONENTS, "Components")
        .with("host.mount.add.title", "Link an external folder")
        .with("host.mount.add.desc", "Registers an absolute folder already chosen by the user, under its real path; the folder itself cannot be a symlink.")
        .with("host.mount.remove.title", "Unlink an external folder")
        .with("host.mount.remove.desc", "Removes only the route; external files stay untouched.")
        .with("host.mount.list.title", "List external folders")
        .with("host.mount.list.desc", "Shows the table of active external routes.")
        .with("host.mount.plan.add", "Link “{name}” ({target}) in namespace “{namespace}”")
        .with("host.mount.plan.remove", "Unlink “{name}”; external files stay where they are")
        .with("host.mount.absent", "No external folder is called “{name}”.")
        .with("host.param.name", "Name")
        .with("host.param.absolute_folder", "Absolute folder")
        .with("host.param.namespace", "Namespace")
        .with("host.param.folder", "Folder")
        .with("host.param.doc", "Document")
        .with("host.trash_os.title", "Move to the system trash")
        .with("host.trash_os.desc", "Tries the system trash; if there is none, uses the internal trash without losing data.")
        .with("host.trash_os.fallback", "The system trash is not available: {doc} is in the vault trash.")
        .with("host.mount.added", "External folder “{name}” linked ({target}).")
        .with("host.mount.removed", "External folder “{name}” unlinked; the external files stay where they are.")
        .with("host.mount.listed.none", "No external folder is linked.")
        .with("host.mount.listed", "Linked external folders: {routes}.")
        .with("host.mount.listed.only_faulty", "No external folder can be reached. With problems: {faulty}.")
        .with("host.mount.listed.faulty", "Linked external folders: {routes}. With problems: {faulty}.")
        .with("host.folder.title", "New folder")
        .with("host.folder.desc", "Creates an empty folder in the vault; a taken name is a conflict.")
        .with("host.folder.plan", "Create folder “{folder}”")
        .with("host.folder.done", "Folder “{folder}” created")
        .with("host.capture.title", "Capture into a note")
        .with("host.capture.desc", "Writes a capture (clipper, share sheet, CLI) into a vault note: a new one, today's, or at the end or the start of an existing one.")
        .with("host.param.capture_payload", "Capture (JSON v1)")
        .with("host.param.template", "Template")
        .with("host.capture.payload", "The capture is not a readable v1 payload: {why}")
        .with("host.capture.plan", "Capture “{title}” into “{doc}”")
        .with("host.capture.done", "Capture saved to “{doc}”")
        .with("host.capture.not_prose", "“{doc}” is not a text note: the capture does not write into it.")
        .with("host.capture.no_properties", "The format of “{doc}” has no properties: a capture with properties does not write into it.")
        .with("host.capture.template_mode", "A template only applies to a capture that creates a note.")
        .with("host.capture.moved", "“{doc}” changed during the capture: try again.")
        .with("host.vault.moved", "“{doc}” changed after its revision was read: try again.")
        .with("host.open_key.malformed", "The document's open key is not valid: 1 to 64 letters, digits, “-” or “_”.")
        .with("host.rich.encrypted", "“{doc}” is protected by a password: Fub does not open it.")
        .with("host.rich.unreadable", "“{doc}” does not open: the file is empty, damaged, or not a document of this kind.")
        .with("host.rich.readonly.revisions", "“{doc}” has tracked changes: it can be read, but not written from here.")
        .with("host.rich.readonly.track_changes", "“{doc}” tracks changes: it can be read, but not written from here.")
        .with("host.rich.readonly.protected", "“{doc}” is protected against editing: it can be read, but not written from here.")
        .with("host.rich.readonly.projection", "“{doc}” has parts the editor cannot put back without losing them: it can be read, but not written from here.")
        .with("host.rich.readonly.codec", "“{doc}” would not read back the same after a save: it can be read, but not written from here.")
        .with("host.rich.readonly.import", "“{doc}” was read by an importer that does not carry all of its content: it can be read, but not written from here.")
        .with("host.rich.no_writer", "Fub reads files like “{doc}”, but does not write them.")
        .with("host.rich.too_large", "“{doc}” is {bytes} bytes, more than Fub opens.")
        .with("host.rich.projection", "The content to save into “{doc}” cannot be read: {why}")
        .with("host.rich.version", "The content to save into “{doc}” is of a version ({version}) this Fub does not read.")
        .with("host.rich.opaque_schema", "The formatting to save into “{doc}” was written by a newer Fub (schema {schema}): this Fub does not read it, and the draft stays as it is.")
        .with("host.rich.missing", "The content to save into “{doc}” names {what}, which the document does not have.")
        .with("host.rich.duplicate", "The content to save into “{doc}” shows the same note or text box twice.")
        .with("host.rich.fidelity", "“{doc}” was not saved: the new file did not read back the same as what was to be written.")
        .with("host.rich.locked.block", "paragraph or table {block} of “{doc}” is a closed part: Fub cannot rewrite it without losing something, and it cannot be changed from here.")
        .with("host.rich.locked.outside", "the change touches parts of “{doc}” outside the text that Fub cannot rewrite without losing them: only the paragraphs and tables of the text are saved.")
        .with("host.rich.codec", "“{doc}” cannot be read or written in its format: {why}")
        .with("host.resource.reuse_with_expected", "“{doc}” was not deposited: reusing a file with the same bytes only applies to a new file, not to overwriting one.")
        .with("host.xlsx.readonly", "“{doc}” is an .xlsx workbook: Fub only changes the values of its cells and does not overwrite it with other bytes.")
        .with("host.xlsx.missing", "“{doc}” no longer exists: Fub does not create an .xlsx workbook from changed cells.")
        .with("host.xlsx.journal", "The changed cells to save in “{doc}” cannot be read: {why}")
        .with("host.xlsx.encrypted", "“{doc}” is protected by a password: Fub does not open it.")
        .with("host.xlsx.too_large", "“{doc}” is {bytes} bytes, more than Fub opens.")
        .with("host.xlsx.not_xlsx", "“{doc}” is not an .xlsx workbook, even though it has the name of one ({found}).")
        .with("host.xlsx.codec", "“{doc}” cannot be read as an .xlsx workbook: {why}")
        .with("xlsx.rewrite.loses", "The workbook was not saved: rewriting it would lose parts of the file that Fub cannot write, so the file stays as it was ({why}).")
        .with("host.grid.protocol", "The grid surface speaks another protocol version: this port does not serve it.")
        .with("host.grid.no_surface", "A grid provider must declare at least one surface.")
        .with("host.drawing.unserved", "The drawing engine is not in this build of Fub: the drawing uses the simple tools.")
        .with("host.drawing.engine_off", "The drawing engine is off in this vault: the drawing uses the simple tools.")
        .with("host.drawing.complete_off", "Complete drawing is off in this vault: the drawing uses Fub's own tools. Turn it back on in Components.")
        .with("host.drawing.complete_missing", "Complete drawing is not in this build of Fub: the drawing uses Fub's own tools.")
        .with("host.drawing.not_done", "This drawing command is not ready in Fub yet.")
        .with("host.drawing.instance", "The open drawing “{instance}” is gone: open it again.")
        .with("host.drawing.stopped", "The drawing engine stopped on the drawing “{instance}”: you can try again.")
        .with("host.drawing.poisoned", "The drawing engine stopped: you can try again.")
        .with("host.drawing.prefs_newer", "The drawing engine preferences come from a newer version of Fub: this one uses them but does not change them.")
        .with("host.drawing.prefs_broken", "The drawing engine preferences cannot be read: to change them again, reset them in Settings › Drawings.")
        .with("host.grid.not_bytes", "The grid surface “{surface}” is not a byte surface.")
        .with("host.grid.surface_format", "The grid surface “{surface}” does not open “{doc}”: it belongs to another format.")
        .with("host.grid.source_too_large", "The grid source is {bytes} bytes, more than the limit.")
        .with("host.wasm.reentrant", "The component was called again while it was already working.")
        .with("host.wasm.missing_export", "The component does not export “{interface}”.")
        .with("host.wasm.memory_budget", "Components have run out of memory: they already hold {used} MiB of {ceiling}. Close or turn off a plugin and try again.")
        .with("host.turn.cycle", "The vault is saving a note that waits for this component, and this component waits for the vault: the work stops so the save can finish. Try again.")
        .with("host.instance.cycle", "This component waits for another one that in turn waits for this one: the work stops so neither blocks. Try again.")
        .with("host.capture.source", "Source: {url}")
        .with("host.live.offline", "The PC is not on a local network: no active interface has a private IPv4 address.")
        .with("host.live.interfaces", "The network interfaces cannot be read: {why}")
        .with("host.live.address", "{address} is not the private address of an active interface.")
        .with("host.live.bind", "The PC cannot wait for the tablet on {address}: {why}")
        .with("host.live.busy", "“{document}” already has a live session.")
        .with("host.live.unknown", "This window has no live session {session}.")
        .with("host.live.document", "The drawing's path or title is too long for the live session.")
        .with("host.live.too_large", "The drawing is too large for the live session: the tablet cannot edit it.")
        .with("host.live.ended", "The live session has ended.")
        .with("host.live.writer_connected", "The tablet is connected: ask for a new QR code once it leaves.")
        .with("host.live.refused", "The live session refused the message: {why}")
        .with("host.live.internal", "The live session could not be prepared: {why}")
        .with("host.export.title", "Export to a folder")
        .with("host.export.desc", "Exports the vault, or one of its folders, into a new folder outside the vault, in the chosen format.")
        .with("host.param.export_format", "Format")
        .with("host.param.export_folder", "Vault folder to export (empty: the whole vault)")
        .with("host.param.export_target", "Destination folder (absolute path)")
        .with("host.param.export_options", "Format options (JSON)")
        .with("host.export.options", "The options are not valid JSON: {why}")
        .with("host.export.plan.vault", "Exports the whole vault into “{target}”.")
        .with("host.export.plan.folder", "Exports the folder “{folder}” into “{target}”.")
        .with("host.export.create", "Cannot create “{target}”: {why}")
        .with("host.export.empty.vault", "The vault holds nothing this format can export.")
        .with("host.export.empty.folder", "The folder “{folder}” does not exist, or holds nothing this format can export.")
        .with("host.obsidian_import.title", "Import Obsidian settings")
        .with("host.obsidian_import.desc", "Reads .obsidian/ at the vault root (settings, appearance, daily note, hotkeys, bookmarks, CSS snippets, workspaces) and writes the choices Fub can express: attachments, new notes, links, editor, trash, excluded folders, light, daily note, hotkeys, bookmarks, CSS snippets, workspaces. Obsidian's files do not change; whatever is not imported is named.")
        .with("host.obsidian_import.none", "This vault has no .obsidian folder with settings to import.")
        .with("host.obsidian_import.unreadable", "“{file}” cannot be read: {why}")
        .with("host.obsidian_import.plan", "Changes {count} settings: {list}. Brings {bookmarks} bookmarks, {snippets} CSS snippets and {workspaces} workspaces. Not imported: {lost}.")
        .with("host.obsidian_import.done", "Obsidian settings imported: {written} changed, {same} were already so.")
        .with("host.obsidian_import.done_lost", "Obsidian settings imported: {written} changed, {same} were already so. Not imported: {lost}.")
        .with("host.connector.notion", "Notion")
        .with("host.connector.airtable", "Airtable")
        .with("host.param.connector", "Connector")
        .with("host.param.connector_token", "Token (empty to remove it)")
        .with("host.connector.token.title", "Connectors: save token")
        .with("host.connector.token.desc", "Save on this machine, readable only by you, the token Fub uses to import from Notion or Airtable. An empty token removes the saved one.")
        .with("host.connector.tokens.title", "Connectors: saved tokens")
        .with("host.connector.tokens.desc", "Tells which connectors have a token saved on this machine, without showing it.")
        .with("host.connector.no_config", "This installation has no configuration folder: the token has nowhere to live.")
        .with("host.connector.plan.save", "Would save the {connector} token on this machine.")
        .with("host.connector.plan.forget", "Would remove the {connector} token from this machine.")
        .with("host.connector.saved", "{connector} token saved on this machine.")
        .with("host.connector.forgotten", "{connector} token removed from this machine.")
        .with("host.connector.bad_token", "A token is a single line of at most 4000 characters.")
        .with("host.connector.write", "The {connector} token could not be saved: {why}")
        .with("host.uri.pending.title", "Incoming fub:// links")
        .with("host.uri.pending.desc", "Takes the fub:// links the system has opened, with what they ask for and in which vault.")
        .with("host.uri.apply.title", "Run a fub:// link")
        .with("host.uri.apply.desc", "Creates the note or capture a fub:// link asks for; as a dry run it only says which.")
        .with("host.param.uri", "Link")
        .with("host.uri.invalid", "The link is not valid: {why}")
        .with("host.uri.unknown_vault", "The vault “{vault}” is not one this machine knows.")
        .with("host.uri.no_vault", "No vault is open: the link has nowhere to write.")
        .with("host.uri.reads", "“{action}” does not write: the window runs it.")
        .with("host.uri.capture_missing", "The capture also needs “{what}”.")
        .with("host.uri.capture_replayed", "This capture has already been written: sending it again with the same nonce does not write it twice.")
        .with("host.web.clip.title", "Save the web page as a note")
        .with("host.web.clip.desc", "Downloads a page of an approved site again and writes it as a Markdown note, with its source; a dry run only says where.")
        .with("host.param.url", "Address")
        .with("host.web.clip.not_https", "“{url}” is not an https address the viewer can open.")
        .with("host.web.clip.not_approved", "The site {site} is not one approved for the viewer: open it and approve it before saving it.")
        .with("host.web.clip.plan", "Would save {url} as a new note in the folder “{folder}”.")
        .with("host.web.clip.plan_root", "Would save {url} as a new note at the root of the vault.")
        .with("host.web.clip.no_network", "This window has no network access: the page cannot be downloaded.")
        .with("host.net.relay_unavailable", "Fub could not start the network request: close a few windows or programs and try again.")
        .with("host.map.tile.not_https", "“{url}” is not an https tile address: it needs https, no port other than 443, and no credentials, query or fragment.")
        .with("host.map.tile.not_allowed", "Tiles from {site} are not allowed on this computer: add the site in Settings › Privacy › Map tiles.")
        .with("host.map.tile.no_network", "This window has no network access: tiles cannot be downloaded.")
        .with("host.map.tile.busy", "Too many tiles waiting: try again shortly.")
        .with("host.map.tile.timeout", "{site} did not send the tile in time.")
        .with("host.map.tile.network", "{site} does not answer: check the connection.")
        .with("host.map.tile.redirect", "{site} sent the tile request elsewhere: redirects are not followed.")
        .with("host.map.tile.status", "{site} answered {status} to the tile request.")
        .with("host.map.tile.too_large", "A tile from {site} is larger than 1 MiB and is not shown.")
        .with("host.map.tile.bad_type", "A tile from {site} is not an image the map accepts ({kind}).")
        .with("host.control.not_base64", "The bytes are not base64.")
        .with("host.wasm.render_parts", "A render with UI parts cannot be handed to a component yet.")
        .with("host.control.no_answer", "The app does not answer on the control channel: {reason}")
        .with("host.control.closed", "The app closed the control channel without answering.")
        .with("host.control.bad_reply", "The control channel answer cannot be read: {reason}")
        .with("host.control.busy", "The app is already serving too many requests: try again.")
        .with("host.sync.kdf_unsupported", "The sync server is a different version and does not accept the protection of this vault key: update Fub or the server, then try again.")
        .with("host.sync.key_epoch_changed", "The vault key changed on another device: ask for a new invite and accept it here before syncing.")
        .with("host.sync.rekey_epoch_changed", "The vault key changed while you were preparing the change: sync again, then retry.")
        .with("host.sync.read_only_no_key", "This vault has no key on the server yet, and read-only sync cannot create one: sync first from a device that sends.")
        .with("host.sync.outbox_unserved_key", "The changes waiting to sync are encrypted with a vault key the server no longer has. They stay on this device, intact; sync stops until they are recovered.")
        .with("host.control.too_large", "Request too large or interrupted.")
        .with("host.control.unreadable", "Unreadable request.")
        .with("host.control.bad_token", "The control channel token is not valid.")
        .with("host.viewer.url_unavailable", "The window address cannot be read: {reason}")
        .with("host.viewer.not_navigated", "The web viewer did not change page: {reason}")
        .with("host.viewer.not_opened", "The web viewer window did not open: {reason}")
        .with("host.viewer.bad_action", "“{action}” is not a web viewer gesture.")
        .with("host.viewer.not_open", "The web viewer is not open.")
        .with("host.reveal.outside", "{path} is outside the vault.")
        .with("host.reveal.root", "The vault folder cannot be read: {reason}")
        .with(
            "host.open_with.off",
            "The Craft apps are off in this vault: turn on the Craft component.",
        )
        .with("host.open_with.unknown_editor", "“{editor}” is not an app Fub knows.")
        .with("host.open_with.wrong_kind", "{app} does not open {path}.")
        .with(
            "host.open_with.not_installed",
            "{app} is not installed on this computer.",
        )
        .with("host.open_with.missing", "{path} is no longer in the vault.")
        .with("host.open_with.launch_failed", "{app} did not start.")
        .with("host.craft_render.off", "Craft file previews are off in this vault.")
        .with(
            "host.craft_render.no_consent",
            "Fub does not use the Craft apps for previews: allow it in the settings.",
        )
        .with("host.craft_render.no_cli", "Fub cannot find the app's command-line program.")
        .with("host.craft_render.ticket", "Fub could not prepare the preview: try again.")
        .with(
            "host.theme_folder.developer_off",
            "To install a theme from a folder, turn on developer mode.",
        )
        .with("host.theme_folder.unavailable", "Fub has no theme folder on this computer.")
        .with(
            "host.theme_folder.desktop_only",
            "A folder cannot be chosen on this device: themes from a folder are installed from Fub on a computer.",
        )
        .with("host.theme_folder.pick_title", "Choose the theme folder")
        .with("host.theme_folder.link_title", "Choose the theme folder to link")
        .with(
            "host.theme_folder.link_only",
            "The linked folder is chosen with «Link a folder…» in Appearance.",
        )
        .with(
            "host.theme_folder.pick_failed",
            "The window to choose the folder did not answer: try again.",
        )
        .with(
            "host.theme_folder.unreadable_path",
            "Fub cannot read the path of this folder: move it to one with a plain name.",
        )
        .with(
            "host.craft_render.over_limit",
            "The file is over the maximum size for a preview made by the app.",
        )
        .with(
            "host.mobile.shared_path",
            "The shared folder has no usable path.",
        )
        .with(
            "host.mobile.native_failed",
            "The system did not answer about the shared folder: {reason}",
        )
        .with(
            "host.mobile.copy_only",
            "On this device the shared folder opens as a copy in the private vault.",
        )
        .with("host.mobile.no_native", "The shared folder needs the mobile app.")
        .with("host.viewer.action_failed", "The web viewer gesture failed: {reason}")
        .with("host.web.clip.status", "The site answered {status} for {url}: the page was not saved.")
        .with("host.web.clip.not_html", "The answer is {kind}, not a web page: it was not saved.")
        .with("host.web.clip.too_large", "The page {url} is over 2 MiB: it was not saved.")
        .with("host.web.clip.refused", "The page cannot be saved as a note: {why}")
        .with("host.web.clip.done", "Page saved in {doc}.")
        .with("host.web.clip.done_with_notes", "Page saved in {doc}. Left out: {notes}")
        .with("host.uri.plan", "Would write {doc}.")
        .with("host.uri.done", "Wrote {doc}.")
        .with("host.export.done", "Export written to “{target}”: {count} files.")
        .with("host.export.done_with_notes", "Export written to “{target}”: {count} files, {notes} warnings about what did not make it.")
        .with("host.snapshot.create.title", "Full vault snapshot")
        .with("host.snapshot.create.desc", "Closes the vault, copies every authoritative entry into a new external folder and reopens it.")
        .with("host.snapshot.apply.title", "Restore a full snapshot")
        .with("host.snapshot.apply.desc", "Saves the current state into a new external folder, then replaces the vault content with the snapshot and reopens it.")
        .with("host.param.snapshot_target", "Destination folder (absolute path)")
        .with("host.param.snapshot_source", "Snapshot to restore (absolute path)")
        .with("host.param.snapshot_backup", "Where to save the current state (absolute path)")
        .with("host.snapshot.plan.create", "Copies every authoritative entry of “{root}” into “{target}”. The vault closes and reopens.")
        .with("host.snapshot.plan.apply", "Replaces the content of “{root}” with the {count} entries of “{source}”. The current state is saved first in “{backup}”.")
        .with("host.snapshot.done.create", "Full snapshot written to “{target}”: {count} entries.")
        .with("host.snapshot.done.apply", "Vault restored from “{source}”: {count} entries. The previous state is in “{backup}”.")
        .with("host.snapshot.distinct", "The snapshot and the backup must be different folders.")
        .with("host.vault.writer_busy", "Another Fub process is already writing to \"{root}\". Close it there, or use that instance.")
        .with("host.snapshot.unreadable", "Not a readable snapshot: {path}")
        .with("host.path.not_absolute", "An absolute path is required: {path}")
        .with("host.path.invalid", "Not a valid destination: {path}")
        .with("host.path.missing_parent", "The folder {path} does not exist.")
        .with("host.path.exists", "{path} already exists: nothing is overwritten.")
        .with("host.path.inside_vault", "{path} is inside the vault.")
        .with(C_GROUP_FILES, "Files")
        .with(C_GROUP_CHROME, "Interface")
        .with(C_CHROME_SCHEMA, "Interface configuration version")
        .with(C_CHROME_SCHEMA_DESC, "Local format version; a version change requires reopening.")
        .with(C_CHROME_RAIL, "Show side rail")
        .with(C_CHROME_RAIL_DESC, "Show the column of icons that opens panels.")
        .with(C_CHROME_ORDER, "Side rail order")
        .with(C_CHROME_ORDER_DESC, "Panel IDs in preferred order; unlisted panels remain visible.")
        .with(C_CHROME_HIDDEN, "Panels hidden from the side rail")
        .with(C_CHROME_HIDDEN_DESC, "Panel IDs the side rail does not show.")
        .with(C_CHROME_SIDEBAR, "Show the left panel")
        .with(C_CHROME_SIDEBAR_DESC, "Shown beside the panes when the window is wide enough; otherwise it opens on request.")
        .with(C_CHROME_INSPECTOR, "Show the right panel")
        .with(C_CHROME_INSPECTOR_DESC, "Shown beside the panes when the window is wide enough; otherwise it opens on request.")
        .with(C_CHROME_STATUS, "Show document status")
        .with(C_CHROME_STATUS_DESC, "Show save state and statistics in the pane bar.")
        .with(C_CHROME_TOOLBAR, "Show pane tools")
        .with(C_CHROME_TOOLBAR_DESC, "Show contextual pane commands.")
        .with(C_CHROME_FORMATBAR, "Show the formatting bar")
        .with(
            C_CHROME_FORMATBAR_DESC,
            "When off, formatting commands appear on the selection.",
        )
        .with(C_CHROME_FRAME, "Window frame")
        .with(C_CHROME_FRAME_DESC, "Frame changes require reopening and depend on platform capabilities.")
        .with(C_FRAME_SYSTEM, "System")
        .with(C_FRAME_CUSTOM, "Custom")
        .with(C_ATTACHMENT_FOLDER, "Attachment folder")
        .with(
            C_ATTACHMENT_FOLDER_DESC,
            "The vault folder where attachments are found and deposited. A leading `./` follows the note: `./` is its folder, `./attachments` a subfolder of it.",
        )
        .with(C_NEW_NOTE_FOLDER, "New note folder")
        .with(
            C_NEW_NOTE_FOLDER_DESC,
            "The vault folder for notes created without an explicit path; empty means the vault root. A leading `./` follows the open note: `./` is its folder, `./Drafts` a subfolder of it.",
        )
        .with(C_NEW_NOTE_EXTENSION, "New note extension")
        .with(
            C_NEW_NOTE_EXTENSION_DESC,
            "The extension given to a note created without one. It must belong to an installed format.",
        )
        .with(C_FILES_TRASH, "Deleted notes")
        .with(
            C_FILES_TRASH_DESC,
            "Where a deleted note goes: the vault trash or the system trash. If the system has none, the vault trash is used.",
        )
        .with(C_FILES_AUTO_REVEAL, "Reveal the open note in the explorer")
        .with(
            C_FILES_AUTO_REVEAL_DESC,
            "When you switch notes, the explorer opens the folders that contain it and scrolls it into view.",
        )
        .with(C_FILES_TRASH_VAULT, "Vault trash")
        .with(C_FILES_TRASH_SYSTEM, "System trash")
        .with(C_FILES_CONFIRM_TRASH, "Confirm before trashing a folder")
        .with(
            C_FILES_CONFIRM_TRASH_DESC,
            "When off, the folder goes straight to the vault trash; Undo in the notice brings it back. Deleting from the trash always asks.",
        )
        .with(
            C_FILES_LEGACY_FOLDER_PAGES,
            "Recognise the old folder page names",
        )
        .with(
            C_FILES_LEGACY_FOLDER_PAGES_DESC,
            "Besides Folder/_index.md, opens Folder/Folder.md and Folder/index.md as the folder page too, like Obsidian. No file is renamed.",
        )
        .with(C_GROUP_EXTERNAL_APPS, "External apps")
        .with(C_CRAFT_EDITOR_PATHS, "Where the Craft apps are")
        .with(
            C_CRAFT_EDITOR_PATHS_DESC,
            "One line per program, like vectorcraft=/opt/vc/vectorcraft, or vectorcraft-cli=… for the command line. The full path wins over what Fub finds on its own.",
        )
        .with(C_CRAFT_CLI_PREVIEWS, "Previews made by the apps")
        .with(
            C_CRAFT_CLI_PREVIEWS_DESC,
            "Fub has the app that opens a file make the preview the file lacks, on a copy, only when you open the file yourself.",
        )
        .with(C_CRAFT_CLI_PREVIEWS_ASK, "Ask the first time")
        .with(C_CRAFT_CLI_PREVIEWS_ON, "On")
        .with(C_CRAFT_CLI_PREVIEWS_OFF, "Off")
        .with(
            C_CRAFT_PREVIEW_MAX_MIB,
            "Largest file to read for a preview (MiB)",
        )
        .with(
            C_CRAFT_PREVIEW_MAX_MIB_DESC,
            "A file that has to be read whole for its preview and weighs more stays without one: files read in pieces have no limit.",
        )
        .with(C_CRAFT_TREE_THUMBNAILS, "Thumbnails in the tree")
        .with(
            C_CRAFT_TREE_THUMBNAILS_DESC,
            "Next to the name of a Craft file, a RAW, a PDF or a document, the small preview the file already has. The tree never starts an app.",
        )
        .with(C_CRAFT_TREE_SHOW_XMP, "Show XMP files in the tree")
        .with(
            C_CRAFT_TREE_SHOW_XMP_DESC,
            "Off, XMP files disappear from the tree: search finds them and the photo shows their data.",
        )
        .with(C_URI_ALLOWED, "fub:// links that write without asking")
        .with(
            C_URI_ALLOWED_DESC,
            "The chosen actions (new note, daily note, unique note) write as soon as the link arrives, without a confirmation. A capture and opening another vault always ask. Applies on this computer.",
        )
        .with(C_FILES_LINK_STYLE, "New links")
        .with(
            C_FILES_LINK_STYLE_DESC,
            "How the link to a note dropped into the text or copied is written. Other programs read Markdown links too.",
        )
        .with(C_FILES_LINK_WIKI, "Wikilinks")
        .with(C_FILES_LINK_MARKDOWN, "Markdown links")
        .with(C_FILES_LINK_FORMAT, "Path of new links")
        .with(
            C_FILES_LINK_FORMAT_DESC,
            "A Markdown link is always a path: \"shortest\" writes it relative. A wikilink has no relative form: \"relative\" writes it from the vault root.",
        )
        .with(C_FILES_LINK_SHORTEST, "Shortest possible")
        .with(C_FILES_LINK_RELATIVE, "Relative to the note")
        .with(C_FILES_LINK_ABSOLUTE, "From the vault root")
        .with(C_FILES_STARTUP, "On startup open")
        .with(
            C_FILES_STARTUP_DESC,
            "What opens on startup, on top of the tabs from last time.",
        )
        .with(C_FILES_STARTUP_SESSION, "The tabs from last time")
        .with(C_FILES_STARTUP_DAILY, "Today's note")
        .with(C_FILES_STARTUP_NEW, "A new note")
        .with(C_FILES_STARTUP_FIXED, "A specific note")
        .with(C_FILES_STARTUP_NOTE, "Note to open on startup")
        .with(
            C_FILES_STARTUP_NOTE_DESC,
            "The vault path of the note that «A specific note» opens; without an extension it means .md.",
        )
        .with(C_FILES_PEOPLE_FOLDER, "People folder")
        .with(
            C_FILES_PEOPLE_FOLDER_DESC,
            "@ in a note offers the notes in this folder and writes the link to the person; a new person is created here. Empty, @ offers no people.",
        )
        .with(C_FILES_TYPES_FOLDER, "Note types folder")
        .with(
            C_FILES_TYPES_FOLDER_DESC,
            "Every note in this folder is a type: its frontmatter gives the icon, the properties and the folder for new notes, its text is the template. Empty, note types are off.",
        )
        .with(C_GROUP_APPEARANCE, "Appearance")
        .with(C_GROUP_PROFILE, "Profile")
        .with(C_PROFILE_NAME, "Your name")
        .with(
            C_PROFILE_NAME_DESC,
            "Signs the comments you write in notes. The name ends up in the note's file: anyone who opens it, even with another program, reads it. Changing it applies to new comments.",
        )
        .with(C_COMMENTS_AUTHOR, "Comment signature in this vault")
        .with(
            C_COMMENTS_AUTHOR_DESC,
            "What Fub writes next to every new comment in this vault. Without a signature the comment reads “No name”.",
        )
        .with(C_COMMENTS_AUTHOR_NAME, "The name")
        .with(C_COMMENTS_AUTHOR_INITIALS, "The initials")
        .with(C_COMMENTS_AUTHOR_NONE, "No signature")
        .with(C_GROUP_EDITOR, "Editor")
        .with(C_EDITOR_SPELLCHECK, "Spellcheck")
        .with(C_EDITOR_SPELLCHECK_DESC, "Use the system spellchecker while editing.")
        .with(C_EDITOR_VIM, "Vim mode")
        .with(C_EDITOR_VIM_DESC, "Use Vim commands in text editors; off by default.")
        .with(C_EDITOR_LINE_NUMBERS, "Line numbers")
        .with(C_EDITOR_LINE_NUMBERS_DESC, "Show line numbers in Source mode.")
        .with(C_EDITOR_CLOSE_BRACKETS, "Auto-close brackets")
        .with(C_EDITOR_CLOSE_BRACKETS_DESC, "Typing an opening bracket, quote or symbol closes the pair for you.")
        .with(C_EDITOR_FOLD_GUTTER, "Fold gutter")
        .with(C_EDITOR_FOLD_GUTTER_DESC, "Shows the arrows in the margin to fold headings and blocks.")
        .with(C_EDITOR_SMART_LISTS, "Smart lists")
        .with(C_EDITOR_SMART_LISTS_DESC, "Enter continues the list item and ends the list on an empty item. Off, Enter just starts a new line.")
        .with(C_EDITOR_STRICT_LINE_BREAKS, "Strict line breaks")
        .with(C_EDITOR_STRICT_LINE_BREAKS_DESC, "On, a single newline in Reading joins the previous line, as in CommonMark. Off, it stays a line break.")
        .with(C_EDITOR_RTL, "Right-to-left text")
        .with(C_EDITOR_RTL_DESC, "For Arabic, Hebrew and other right-to-left scripts: the editor and Reading start from the right margin.")
        .with(C_EDITOR_INDENT_GUIDES, "Indentation guides")
        .with(C_EDITOR_INDENT_GUIDES_DESC, "Draws a vertical line for each indentation level. Works in Source mode.")
        .with(C_EDITOR_CURSOR_BLINK, "Blinking cursor")
        .with(C_EDITOR_CURSOR_BLINK_DESC, "The editor cursor turns on and off. By default it stays still, so it does not distract while reading.")
        .with(C_EDITOR_SOFT_CURSOR, "Soft cursor")
        .with(C_EDITOR_SOFT_CURSOR_DESC, "In Blocks the cursor glides to its new place instead of jumping there. Never while you type, and never with reduced motion.")
        .with(C_EDITOR_TYPEWRITER, "Typewriter")
        .with(C_EDITOR_TYPEWRITER_DESC, "The cursor line stays at half the height of the sheet and the text scrolls under it, like paper in a typewriter. At the top of a short note the text does not move past the start.")
        .with(C_EDITOR_PREVIEW_MODIFIER, "Link preview only with Ctrl")
        .with(C_EDITOR_PREVIEW_MODIFIER_DESC, "Hovering a link opens the note preview only while Ctrl (Cmd on Mac) is held, in Reading too. While writing it is always needed.")
        .with(C_EDITOR_PASTE_HTML, "Convert pasted HTML")
        .with(C_EDITOR_PASTE_HTML_DESC, "Pasting formatted text from another app turns it into Markdown. Off, it pastes plain text.")
        .with(C_EDITOR_LINE_WRAP, "Wrap lines")
        .with(C_EDITOR_LINE_WRAP_DESC, "Wrap long lines instead of scrolling horizontally.")
        .with(C_EDITOR_INDENT, "Indentation")
        .with(C_EDITOR_INDENT_DESC, "What Tab inserts and how lists are indented.")
        .with(C_EDITOR_INDENT_TAB, "Tab")
        .with(C_EDITOR_INDENT_2, "2 spaces")
        .with(C_EDITOR_INDENT_4, "4 spaces")
        .with(C_EDITOR_PROPERTIES, "Properties in the text")
        .with(C_EDITOR_PROPERTIES_DESC, "How Writing shows the frontmatter at the top of the note. A click on the properties reopens the YAML for writing; Source always shows YAML.")
        .with(C_EDITOR_PROPERTIES_VISIBLE, "Visible")
        .with(C_EDITOR_PROPERTIES_HIDDEN, "Hidden")
        .with(C_EDITOR_PROPERTIES_SOURCE, "YAML")
        .with(C_EDITOR_MINIBAR, "Formatting mini toolbar")
        .with(C_EDITOR_MINIBAR_DESC, "Formatting gestures next to the pointer: above the right-click menu and, if you like, on selected text.")
        .with(C_EDITOR_MINIBAR_AUTO, "On right-click, and on selected text unless the bar is full")
        .with(C_EDITOR_MINIBAR_ALWAYS, "On right-click and on any selected text")
        .with(C_EDITOR_MINIBAR_MENU, "Only on right-click")
        .with(C_EDITOR_MINIBAR_OFF, "Never")
        .with(C_EDITOR_TOOLBAR, "Formatting toolbar")
        .with(C_EDITOR_TOOLBAR_DESC, "Above the sheet. Compact: a few fixed buttons, the style and the tools of the block the cursor is in. Full: every button. Hidden: the mini toolbar on selected text remains.")
        .with(C_EDITOR_TOOLBAR_COMPACT, "Compact")
        .with(C_EDITOR_TOOLBAR_FULL, "Full")
        .with(C_EDITOR_TOOLBAR_HIDDEN, "Hidden")
        .with(C_EDITOR_LINK_CLICK, "Clicking a link to a note")
        .with(C_EDITOR_LINK_CLICK_DESC, "What the click that opens a link does: bring the note into the pane, or open it in the peek, over the right of the sheet, where you write without leaving the note you were in. Alt with the click, or Alt Enter, always peeks.")
        .with(C_EDITOR_LINK_CLICK_OPEN, "Opens the note")
        .with(C_EDITOR_LINK_CLICK_PEEK, "Peeks at the note")
        .with(C_EDITOR_GRID_COPY_MARK, "Copy mark in spreadsheets")
        .with(C_EDITOR_GRID_COPY_MARK_DESC, "What stays on the cells you copy: a wide dashed outline until you paste, a pulse that lights up and fades, or both. Cut always keeps a dense dashed outline.")
        .with(C_EDITOR_GRID_COPY_MARK_BOTH, "Dashes and pulse")
        .with(C_EDITOR_GRID_COPY_MARK_DASH, "Dashes only")
        .with(C_EDITOR_GRID_COPY_MARK_PULSE, "Pulse only")
        .with(C_EDITOR_GRID_SELECTION_SPEED, "Selection speed in spreadsheets")
        .with(C_EDITOR_GRID_SELECTION_SPEED_DESC, "How the selection moves to the new cell, with the keys and the pointer: it glides faster, as usual or softer, or it jumps from cell to cell. With reduced motion it stops at once, whatever you choose.")
        .with(C_EDITOR_GRID_SELECTION_SPEED_QUICK, "Quick")
        .with(C_EDITOR_GRID_SELECTION_SPEED_NORMAL, "As usual")
        .with(C_EDITOR_GRID_SELECTION_SPEED_SOFT, "Soft")
        .with(C_EDITOR_GRID_SELECTION_SPEED_NONE, "In steps")
        .with(C_EDITOR_SLASH, "«/» menu in the text")
        .with(C_EDITOR_SLASH_DESC, "A «/» at the start of a line or after a space opens blocks and commands, filtered by what you type next. Esc leaves it as text.")
        .with(C_EDITOR_HINTS, "Hints row")
        .with(C_EDITOR_HINTS_DESC, "In the middle of the bottom band, the keys useful for what you are doing, with your shortcuts. Not on the phone nor in a window narrower than 620 px.")
        .with(C_EDITOR_TYPOGRAPHY, "Italian typography")
        .with(C_EDITOR_TYPOGRAPHY_DESC, "As you type, quotes become « », two hyphens —, three dots … and the apostrophe ’. It applies to notes in Italian, outside code, formulas and links; Backspace right after puts back what you typed.")
        .with(C_EDITOR_SLASH_HIDDEN, "Items hidden from the «/» menu")
        .with(C_EDITOR_SLASH_HIDDEN_DESC, "The ids of the commands the «/» menu leaves out. They stay in the palette and on the keyboard.")
        .with(C_EDITOR_SLASH_SECTIONS, "Order of the «/» menu sections")
        .with(C_EDITOR_SLASH_SECTIONS_DESC, "The sections after Suggested, Favorites and Recent. Those not listed follow in their own order.")
        .with(C_EDITOR_DEFAULT_MODE, "Initial mode")
        .with(C_EDITOR_DEFAULT_MODE_DESC, "The mode of a new window or of a vault opened for the first time. A split pane inherits the mode of the pane it comes from, and each pane remembers its own.")
        .with(C_EDITOR_LIVE_REVEAL, "Markdown marks in Writing")
        .with(C_EDITOR_LIVE_REVEAL_DESC, "Markdown marks are visible in Source; here you choose whether Writing shows them too.")
        .with(C_EDITOR_LIVE_REVEAL_NEVER, "Never")
        .with(C_EDITOR_LIVE_REVEAL_ELEMENT, "Of the element at the cursor")
        .with(C_EDITOR_LIVE_REVEAL_LINE, "Of the line at the cursor")
        .with(C_EDITOR_LIVE_GUIDE, "Guide while typing")
        .with(C_EDITOR_LIVE_GUIDE_DESC, "In Writing an opened mark styles the text at once and shows the missing close in grey; a space closes superscript and subscript.")
        .with(C_EDITOR_MATH_SOURCE, "Show the LaTeX of formulas")
        .with(C_EDITOR_MATH_SOURCE_DESC, "On, under the touched formula there is the field with its LaTeX, and you write there; clicking the formula only reaches the empty slots. Off, the formula stays drawn and you edit it by touching it: click where you want to write.")
        .with(C_EDITOR_MATH_HELP, "Help in the LaTeX of formulas")
        .with(C_EDITOR_MATH_HELP_DESC, "With “Show the LaTeX of formulas” on. Full: brackets that close themselves, completion after \\, quick writing (a/b, alpha, ->) and the palette. Light: only brackets and completion, the palette on request. Off: the LaTeX you write and its preview, nothing else.")
        .with(C_EDITOR_MATH_HELP_FULL, "Full")
        .with(C_EDITOR_MATH_HELP_DISCREET, "Light")
        .with(C_EDITOR_MATH_HELP_OFF, "Off")
        .with(C_EDITOR_BLOCKS, "Blocks: handles and selection")
        .with(C_EDITOR_BLOCKS_DESC, "On, every block has its handle and «+», Esc selects the block and Ctrl A takes the block, then all of them. Off, Writing is a text editor: Ctrl A selects all the text and Ctrl D the next occurrence.")
        .with(C_MODE_SOURCE, "Source")
        .with(C_MODE_WRITING, "Writing")
        .with(C_MODE_READING, "Reading")
        .with(C_PLUGINS_DISABLED, "Disabled components")
        .with(
            C_PLUGINS_DISABLED_DESC,
            "The ids of the components that are not mounted when this vault is \
             opened. You change them by turning a component on and off, not by \
             writing in here.",
        )
        .with(C_COMPONENTS_OFF, "Other disabled components")
        .with(
            C_COMPONENTS_OFF_DESC,
            "The disabled components that are not among the mounted ones, such as \
             the whiteboard and PDF. You change them by turning a component on and off.",
        )
        .with(C_COMPONENTS_KEPT, "Kept components")
        .with(
            C_COMPONENTS_KEPT_DESC,
            "The components kept on with «Keep them» even though nothing else \
             needs them any more.",
        )
        .with(C_COMPONENTS_WAITING, "Waiting components")
        .with(
            C_COMPONENTS_WAITING_DESC,
            "The components nothing needs any more that are still on, waiting for \
             you to choose «Remove» or «Keep them».",
        )
        .with(C_COMPONENTS_PROFILE, "Profile")
        .with(
            C_COMPONENTS_PROFILE_DESC,
            "The component profile chosen for this vault. Empty means custom: it \
             becomes so as soon as you turn a component on or off.",
        )
        .with(C_GROUP_PRIVACY, "Privacy")
        .with(C_HISTORY, "Recent searches and notes")
        .with(
            C_HISTORY_DESC,
            "Remembers what you searched for and which notes you opened, to offer \
             them back when you return. It stays on this computer and never enters \
             the vault. Turning it off deletes what was already remembered.",
        )
        .with(C_THEME, "Theme")
        .with(
            C_THEME_DESC,
            "Which light to draw the interface in. «Same as system» follows the \
             operating system preferences, even when they change while Fub is \
             open.",
        )
        .with(C_THEME_LIGHT, "Light")
        .with(C_THEME_DARK, "Dark")
        .with(C_CONTRAST, "Contrast")
        .with(
            C_CONTRAST_DESC,
            "Follow the system, or always use normal or high contrast.",
        )
        .with(C_CONTRAST_NORMAL, "Normal")
        .with(C_CONTRAST_HIGH, "High")
        .with(C_DENSITY, "Density")
        .with(
            C_DENSITY_DESC,
            "Tighten or loosen control spacing without changing the panel layout.",
        )
        .with(C_DENSITY_COMPACT, "Compact")
        .with(C_DENSITY_COMFORTABLE, "Comfortable")
        .with(C_DENSITY_RELAXED, "Relaxed")
        .with(C_BARS, "Bars")
        .with(
            C_BARS_DESC,
            "The tray under the tabs, the command bars and the tools column: light, close to the paper, or marked, standing out more.",
        )
        .with(C_BARS_LIGHT, "Light")
        .with(C_BARS_MARKED, "Marked")
        .with(C_BODY, "Text size (px)")
        .with(C_BODY_DESC, "Text size on reading surfaces.")
        .with(C_LINE_HEIGHT, "Line height")
        .with(C_LINE_HEIGHT_DESC, "Vertical rhythm for long-form prose.")
        .with(C_MEASURE, "Line measure (characters)")
        .with(C_MEASURE_DESC, "Maximum width of the reading column.")
        .with(C_FONT, "Reading font")
        .with(C_FONT_DESC, "Font family used for long-form prose.")
        .with(C_FONT_NEWSREADER, "Newsreader")
        .with(C_FONT_HANKEN, "Hanken Grotesk")
        .with(C_FONT_LITERATA, "Literata")
        .with(C_FONT_INTER, "Inter")
        .with(C_FONT_SYSTEM, "System")
        .with(C_FONT_UI, "Interface font")
        .with(C_FONT_UI_DESC, "Font family of bars, drawers, menus and dialogs.")
        .with(C_FONT_MONO, "Code font")
        .with(C_FONT_MONO_DESC, "Monospaced font family for code and source.")
        .with(C_FONT_PLEX, "IBM Plex Mono")
        .with(C_FONT_JETBRAINS, "JetBrains Mono")
        .with(C_ACCENT, "Accent hue")
        .with(
            C_ACCENT_DESC,
            "The colour of links, focus and selection. Lightness and intensity adapt by themselves to stay readable.",
        )
        .with(C_COMPACTNESS, "Interface space")
        .with(C_COMPACTNESS_DESC, "How much room bars, rail and drawers take: from 0, roomy, to 4, minimal. The sheet and its tabs do not change.")
        .with(C_ZOOM, "Interface zoom")
        .with(C_ZOOM_DESC, "How large the whole interface is, from 50% to 200%.")
        .with(C_THEME_ID, "Installed theme")
        .with(C_THEME_ID_DESC, "The id of the mounted theme; chosen from the theme catalog.")
        .with(C_MOTION, "Animations")
        .with(C_MOTION_DESC, "Follow the system preference, or drop bounces and scenes, or always reduce interface animations.")
        .with(C_MOTION_CALM, "Calm")
        .with(C_MOTION_REDUCED, "Reduced")
        .with(C_FRAME_RATE, "Frame rate")
        .with(C_FRAME_RATE_DESC, "Cap for animations drawn by the interface. The maximum follows the display refresh rate, whatever it is.")
        .with(C_FRAME_RATE_DISPLAY, "Display maximum")
        .with(C_FRAME_RATE_CAP, "{fps} fps")
        .with(C_RENDERING, "Page rendering")
        .with(
            C_RENDERING_DESC,
            "What draws Fub's windows. Automatic leaves the choice to WebKit and warns you about known problems; Processor helps with some drivers that flicker. Applies from the next start.",
        )
        .with(C_RENDERING_AUTO, "Automatic")
        .with(C_RENDERING_GPU, "Graphics card")
        .with(C_RENDERING_CPU, "Processor")
        .with(C_DIAGRAM_STYLE, "Diagram style")
        .with(
            C_DIAGRAM_STYLE_DESC,
            "Colors and stroke of Mermaid diagrams; “%% style: name” changes a single one.",
        )
        .with(C_DIAGRAM_STYLE_ARMONIA, "Harmony — follows the theme")
        .with(C_DIAGRAM_STYLE_ACQUERELLO, "Watercolor — pastels on paper")
        .with(C_DIAGRAM_STYLE_AURORA, "Aurora — vivid and deep")
        .with(C_DIAGRAM_STYLE_BLUEPRINT, "Blueprint — technical drawing")
        .with(C_DIAGRAM_STYLE_INCHIOSTRO, "Ink — editorial")
        .with(C_CONTENT_LOOK, "Document appearance")
        .with(
            C_CONTENT_LOOK_DESC,
            "How a file with a look of its own, such as a document, is shown: its own page, or the page adapted to the theme's light. Automatic picks the page, and the adapted one with high contrast.",
        )
        .with(C_CONTENT_LOOK_AUTO, "Automatic")
        .with(C_CONTENT_LOOK_FILE, "Page")
        .with(C_CONTENT_LOOK_ADAPTED, "Adapted page")
        .with(C_CSS_SNIPPETS, "Local CSS snippets")
        .with(C_CSS_SNIPPETS_DESC, "Toggleable, local, paint-only snippets scoped to visual hooks; no network or CSS imports.")
        .with(C_GROUP_SYNC, "Synchronization")
        .with(C_SYNC_SERVER_URL, "Synchronization server")
        .with(
            C_SYNC_SERVER_URL_DESC,
            "Service HTTPS URL; HTTP is allowed only on loopback. Empty means no server configured.",
        )
        .with(C_SYNC_PAUSED, "Pause synchronization")
        .with(
            C_SYNC_PAUSED_DESC,
            "Stop new replication operations without deleting data or the local queue.",
        )
        .with(C_SYNC_EXCLUDE, "Additional exclusions")
        .with(
            C_SYNC_EXCLUDE_DESC,
            "Items not to replicate. Security exclusions always remain active.",
        )
        .with(C_GROUP_PUBLISH, "Publishing")
        .with(C_PUBLISH_SERVER_URL, "Publishing server")
        .with(
            C_PUBLISH_SERVER_URL_DESC,
            "Service HTTPS URL; HTTP is allowed only on loopback. Empty means no server configured.",
        )
        .with(
            C_REJECTED_TIMEZONE,
            "“{name}” is not a known time zone. Write an IANA name such as Europe/Rome, \
             or leave it empty to use the system one.",
        )
        .with(
            C_REJECTED_SERVER_URL,
            "“{value}” is not a valid server address. Write an https:// address, \
             or http:// only towards 127.0.0.1, ::1 or localhost; empty means no server.",
        )
        .with(
            C_REJECTED_TILE_HOST,
            "“{value}” is not a host name. Write only the name, for example tile.openstreetmap.org: no https://, port or path.",
        )
        .with(C_MAP_TILE_HOSTS, "Map tiles")
        .with(
            C_MAP_TILE_HOSTS_DESC,
            "The sites from which a Base's Map view may download tiles, when you press “Enable”. Empty, maps stay offline and no request leaves the computer.",
        )
        .with(C_GROUP_VIEWER, "Web viewer")
        .with(C_VIEWER_HOSTS, "Approved sites")
        .with(
            C_VIEWER_HOSTS_DESC,
            "The sites the viewer opens without asking, one per line (for example en.wikipedia.org). https only; a subdomain is listed on its own.",
        )
        .with(C_VIEWER_LINKS, "Open web links in the viewer")
        .with(
            C_VIEWER_LINKS_DESC,
            "An https link in a note opens in the isolated viewer instead of the system browser. Alt+click opens it in the viewer either way.",
        )
        .with(C_GROUP_LIVE, "Live session")
        .with(C_LIVE_PORT, "Live session port")
        .with(
            C_LIVE_PORT_DESC,
            "The port on which the PC waits for the tablet. 0 picks a free port for each session; a fixed number suits networks with firewall rules.",
        )
        .with(C_GROUP_DIAGNOSTICS, "Diagnostics")
        .with(C_LOG_LEVEL, "Log level")
        .with(
            C_LOG_LEVEL_DESC,
            "How much detail goes into the log file. The default keeps what you \
             need to understand what happened later, without noise; raise it only \
             to chase a defect.",
        )
        .with(C_LOG_VERBOSE, "Verbose components")
        .with(
            C_LOG_VERBOSE_DESC,
            "The ids of the components to see in full, down to debug, whatever the \
             global level. It is how you follow a single component without raising \
             the noise of all the others.",
        )
        .with(C_PERF_PROBE, "Performance probe")
        .with(
            C_PERF_PROBE_DESC,
            "Measures the time from a key, a click or a pen stroke to the frame \
             that shows it, and counts the long frames. The numbers stay on this \
             computer: they feed the measurement benches.",
        )
        .with(C_GROUP_DEVELOPMENT, "Development")
        .with(C_DEVELOPER_MODE, "Developer mode")
        .with(
            C_DEVELOPER_MODE_DESC,
            "For theme authors: «Install from folder…» appears under \
             «Installed themes», and checks and installs a theme from its folder, \
             with «Link a folder…», which remounts it at every save, and with \
             «All components», which shows every component in every state.",
        )
        .with(C_DEVELOPER_THEME_FOLDER, "Linked folder")
        .with(
            C_DEVELOPER_THEME_FOLDER_DESC,
            "The folder of the theme in development: Fub watches it and remounts \
             the theme at every save. It is chosen and unlinked under «Installed themes».",
        );
    for level in fub_kernel::log::Level::ALL {
        en = en.with(
            format!("{C_LOG_LEVEL}{}", level.as_str()),
            level_label_en(level),
        );
    }

    // `trash.os` legge il campo «Documento» anche scritto per nome.
    let (it, en) = crate::doc_names::speaking(crate::doc_names::CORE_KEYS, it, en);
    vec![it, en]
}
