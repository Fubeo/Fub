//! **La superficie IPC è un elenco chiuso** (§16.6).
//!
//! I comandi `#[tauri::command]` sono la sola porta che la shell ha e un plugin
//! no. Ogni volta che ne nasce uno, il progetto perde un pezzo della proprietà
//! che dichiara di avere — *«una feature ufficiale è ciò che scriverà un
//! plugin»* — e lo perde in silenzio, perché aggiungere una riga a
//! `generate_handler!` non rompe niente e non chiede il permesso a nessuno.
//! Questo test è il permesso: aggiungerne uno costa una riga qui sotto, e quella
//! riga porta **la ragione per cui non poteva essere un comando del registro,
//! una view o una query**.
//!
//! Non è un test di comportamento: è un test sul **sorgente**. Legge i file di
//! `src/ipc/` con `include_str!` — che è anche ciò che lo fa ricompilare
//! quando uno di quei file cambia — e ne estrae due insiemi che ricava per
//! strade indipendenti:
//!
//! 1. **i comandi definiti**, cioè i nomi di funzione che seguono un vero
//!    `#[tauri::command]`;
//! 2. **i comandi registrati**, cioè i nomi dentro `tauri::generate_handler!`.
//!
//! **Questo test giudica `src/ipc/`, e la superficie IPC sta tutta lì** — e la
//! seconda metà di quella frase, che prima era una speranza, adesso è un
//! presidio. La zona cieca misurata dalla
//! [0106](../../../docs/decisions/0191-ui-dichiarativa-e-renderer.md) era questa:
//! una seconda superficie IPC dichiarata in un altro file dello stesso crate e
//! montata con un `.plugin()` che porti il proprio `generate_handler!` passava
//! di qui **verde**, ed era raggiungibile dal webview come
//! `plugin:<nome>|<comando>`. La riparazione di allora fu un conto —
//! `files-with-ipc-surface` —, e un conto dice *quanti*, mai *quale*: chi lo
//! trova rosso ha davanti due riparazioni che si somigliano, togliere la
//! seconda superficie o **portare il numero a due**, e la seconda lascia il
//! difetto in piedi con la prosa aggiornata.
//!
//! Adesso i file che il test legge non sono più una scelta del test: è
//! `walk_sources`, che apre la cartella `src/` e la guarda tutta
//! (`ipc_surface_lives_in_one_folder`). **La superficie IPC di questo crate è
//! una cartella**, `src/ipc/`, e due cose diventano rosse per nome: un file
//! fuori dalla cartella che dichiari un comando o un `generate_handler!`, con i
//! comandi che ha dentro elencati, e un file nella cartella che [`SURFACE`] non
//! elenca. Fino al 2026-11-26 la superficie era un file solo, `src/lib.rs`, di
//! oltre quattromila righe: leggerlo per intero costava più di quanto la regola
//! proteggesse. La regola è rimasta la stessa — da qui si entra da un posto
//! solo, ed è un elenco chiuso — e il posto è diventato una cartella con un
//! file per tema; l'elenco dei file è chiuso come quello dei comandi.
//!
//! Poi li confronta fra loro e con l'allowlist, **in tutte e due le direzioni**
//! ogni volta. La direzione che si vede subito è «ne è comparso uno»; quella che
//! conta quasi altrettanto è «ne è sparito uno», perché un elenco che resta
//! lungo mentre il codice si accorcia smette di essere una fotografia e diventa
//! un ricordo — la stessa disciplina di `ALLOWED_TRANSITIVE_ABI` in
//! `crates/fub-abi/tests/dependency_invariant.rs`.
//!
//! **L'estrattore salta la prosa, ed è la trappola per cui esiste il test del
//! test qui in fondo.** Un `grep` ingenuo di `#[tauri::command]` su `src/lib.rs`
//! ne conta **trentanove**: due sono dentro il doc-comment di modulo, che quel
//! confine lo *descrive*. Un'allowlist che nascesse contando anche quelle
//! nascerebbe già rotta, e — peggio — nascerebbe rotta di due righe che nessuno
//! andrebbe a cercare, perché un elenco di trentanove nomi lo si legge una volta
//! sola. Le righe di commento non sono codice, e qui è letteralmente vero: sono
//! il posto in cui il file spiega perché quel confine è fatto così.

use std::collections::{BTreeMap, BTreeSet};

/// I file che questo test giudica, `(nome dentro src/, contenuto)`.
/// `include_str!` e non `std::fs`: così il legame è una dipendenza di
/// compilazione e non un path da tenere aggiornato a mano — se un file si
/// sposta, non compila. L'elenco è **chiuso**: [`walk_sources`] pretende che i
/// file camminati dentro [`THE_FOLDER`] siano esattamente questi, byte per byte,
/// e un file nuovo della cartella che non sta qui è rosso per nome.
const SURFACE: &[(&str, &str)] = &[
    ("ipc/artifacts.rs", include_str!("../src/ipc/artifacts.rs")),
    ("ipc/commands.rs", include_str!("../src/ipc/commands.rs")),
    (
        "ipc/components.rs",
        include_str!("../src/ipc/components.rs"),
    ),
    ("ipc/context.rs", include_str!("../src/ipc/context.rs")),
    ("ipc/craft.rs", include_str!("../src/ipc/craft.rs")),
    ("ipc/data.rs", include_str!("../src/ipc/data.rs")),
    (
        "ipc/diagnostics.rs",
        include_str!("../src/ipc/diagnostics.rs"),
    ),
    ("ipc/documents.rs", include_str!("../src/ipc/documents.rs")),
    ("ipc/drawing.rs", include_str!("../src/ipc/drawing.rs")),
    ("ipc/events.rs", include_str!("../src/ipc/events.rs")),
    ("ipc/grid.rs", include_str!("../src/ipc/grid.rs")),
    (
        "ipc/keybindings.rs",
        include_str!("../src/ipc/keybindings.rs"),
    ),
    ("ipc/lanes.rs", include_str!("../src/ipc/lanes.rs")),
    (
        "ipc/live_commands.rs",
        include_str!("../src/ipc/live_commands.rs"),
    ),
    (
        "ipc/mobile_commands.rs",
        include_str!("../src/ipc/mobile_commands.rs"),
    ),
    ("ipc/mod.rs", include_str!("../src/ipc/mod.rs")),
    ("ipc/opened.rs", include_str!("../src/ipc/opened.rs")),
    ("ipc/plugins.rs", include_str!("../src/ipc/plugins.rs")),
    (
        "ipc/resource_stream.rs",
        include_str!("../src/ipc/resource_stream.rs"),
    ),
    ("ipc/settings.rs", include_str!("../src/ipc/settings.rs")),
    ("ipc/themes.rs", include_str!("../src/ipc/themes.rs")),
    ("ipc/vaults.rs", include_str!("../src/ipc/vaults.rs")),
    ("ipc/viewer.rs", include_str!("../src/ipc/viewer.rs")),
    ("ipc/views.rs", include_str!("../src/ipc/views.rs")),
    ("ipc/windows.rs", include_str!("../src/ipc/windows.rs")),
];

/// La cartella che porta la superficie, dentro `src/`.
const THE_FOLDER: &str = "ipc/";

/// Il sorgente della superficie: i file di [`SURFACE`] uno dopo l'altro. Ogni
/// file finisce con un a capo, quindi una funzione resta chiusa da `\n}\n`
/// anche quando è l'ultima del suo file.
fn source() -> String {
    SURFACE
        .iter()
        .map(|(_, text)| *text)
        .collect::<Vec<_>>()
        .join("\n")
}

/// **Tutti** i sorgenti del crate, letti dal disco: `(nome, contenuto)`.
///
/// È l'unico posto di questo file che usa `std::fs` invece di `include_str!`, e
/// la ragione è precisamente il contrario di quella che vale per [`SURFACE`]:
/// `include_str!` lega il test a un file **che qualcuno ha nominato**, e ciò che
/// serve qui è vedere i file che nessuno ha nominato. Un elenco di
/// `include_str!` sarebbe l'elenco a mano di cui questa zona cieca è fatta.
///
/// La cartella si cammina in profondità: un modulo può stare in
/// `src/qualcosa/mod.rs`.
fn walk_sources() -> Vec<(String, String)> {
    fn collect(dir: &std::path::Path, prefix: &str, out: &mut Vec<(String, String)>) {
        let entries = std::fs::read_dir(dir)
            .unwrap_or_else(|and| panic!("cannot read `{}`: {and}", dir.display()));
        for entry in entries {
            let entry = entry.expect("an entry in the sources folder");
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if path.is_dir() {
                collect(&path, &relative, out);
            } else if name.ends_with(".rs") {
                let text = std::fs::read_to_string(&path)
                    .unwrap_or_else(|and| panic!("cannot read `{relative}`: {and}"));
                out.push((relative, text));
            }
        }
    }

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    collect(&root, "", &mut out);
    out.sort();

    // **Una suite che si svuota in silenzio è indistinguibile da una suite
    // verde**, e una camminata è il modo più facile di svuotarsi: basta che la
    // cartella non sia quella. Le righe qui sotto sono ciò che lo dice: i file
    // camminati dentro `src/ipc/` devono essere **gli stessi, byte per byte**,
    // che `include_str!` ha inglobato in [`SURFACE`], cioè questa camminata e il
    // resto del file stanno guardando lo stesso albero — e un file della
    // cartella che l'elenco non conosce è superficie che nessun banco legge.
    let walked: BTreeMap<&str, &str> = out
        .iter()
        .filter(|(name, _)| name.starts_with(THE_FOLDER))
        .map(|(name, text)| (name.as_str(), text.as_str()))
        .collect();
    assert!(
        !walked.is_empty(),
        "walking `{}` does not find `{THE_FOLDER}`: this walk is looking\n\
         at the wrong folder, and a guard that looks at the wrong folder\n\
         always passes.",
        root.display()
    );
    let listed: BTreeMap<&str, &str> = SURFACE.iter().copied().collect();
    let unlisted: Vec<&str> = walked
        .keys()
        .filter(|name| !listed.contains_key(*name))
        .copied()
        .collect();
    assert!(
        unlisted.is_empty(),
        "`src/{THE_FOLDER}` has files that `SURFACE` does not list: {unlisted:?}.\n\
         Every file of the IPC surface is read by the benches of this test: add it\n\
         to `SURFACE` with its `include_str!`."
    );
    for (name, text) in &listed {
        assert_eq!(
            walked.get(name),
            Some(text),
            "the walked `{name}` is not the one `include_str!` captured"
        );
    }
    out
}

/// Il contratto, letto per una ragione sola: una riga dell'allowlist che dice
/// «questa è la capacità `X`» deve nominare una `X` che **esiste**.
///
/// È la sesta specie del §16.7 — la *garanzia dichiarata che non è mai esistita*
/// — presa dal verso in cui si può presidiare: una frase che rimanda a qualcosa
/// di meccanico deve rimandare a un nome che una macchina sa cercare.
///
/// `traits.rs` è diviso in moduli (`traits/*.rs`): si leggono tutti, la radice
/// e ogni file della cartella, così un trait spostato da un file all'altro resta
/// trovato e uno nuovo entra senza che nessuno lo aggiunga a un elenco.
fn contract() -> String {
    let abi = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fub-abi/src");
    let mut files = vec![abi.join("traits.rs")];
    let mut inside: Vec<_> = std::fs::read_dir(abi.join("traits"))
        .expect("fub-abi/src/traits/ is readable")
        .map(|and| and.expect("directory entry").path())
        .filter(|p| p.extension().is_some_and(|e| e == "rs"))
        .collect();
    inside.sort();
    assert!(
        inside.len() > 1,
        "fub-abi/src/traits/ holds {} files: this walk is looking at the wrong folder",
        inside.len()
    );
    files.extend(inside);
    files
        .iter()
        .map(|f| std::fs::read_to_string(f).unwrap_or_else(|and| panic!("{}: {and}", f.display())))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Le ragioni
// ---------------------------------------------------------------------------

/// **Perché quel comando non poteva essere altro.**
///
/// L'allowlist non è un elenco di nomi: un elenco di nomi si allunga di una riga
/// senza pensare, ed è esattamente il gesto da rendere costoso. Ogni riga porta
/// una di queste sei ragioni, e sceglierla è il lavoro — se nessuna si applica,
/// la risposta non è inventarne una settima: è che quel comando doveva essere un
/// comando del registro, una view o una query.
///
/// La riga che divide, e che va usata per prima, è della
/// [decisione 0013](../../../docs/decisions/0185-capability-un-solo-guard.md): *un
/// comando fa accadere qualcosa e risponde con un messaggio e un effetto; ciò
/// che risponde con **dati** non può essere un comando — un `CommandOutcome` non
/// li porta — e resta sul canale di lettura.*
#[derive(Debug, PartialEq, Eq)]
enum Why {
    /// **La superficie dell'app**: finestre, dialoghi, ciclo di vita di un
    /// vault, la memoria che questa macchina ha dei vault, e ciò che *compone*
    /// il kernel invece di viverci dentro.
    ///
    /// Non esiste un registro a cui chiederlo, perché è il registro stesso a
    /// vivere dentro un vault aperto: queste righe stanno o **prima** (aprire),
    /// o **sopra** (sceglierne uno fra due, ricordarseli fra un avvio e
    /// l'altro), o **attorno** (accendere un componente, fermare un lavoro che
    /// gira di fianco). Un `plugins.set-enabled` nel registro sarebbe la porta
    /// con cui il registro modifica sé stesso, e potrebbe spegnere il provider
    /// che lo sta eseguendo; un `job.cancel` nel registro chiederebbe al kernel
    /// di fermare qualcosa che il kernel non fa girare — è sincrono e non
    /// possiede thread, e chi ha i thread è l'app (0013, 0032).
    AppSurface,
    /// **Il ponte generico**: è il comando con cui la shell raggiunge il
    /// registro, il canale dati o le view. Uno solo per canale, e non cresce con
    /// le feature — è precisamente ciò che l'allowlist esiste per preservare.
    ///
    /// Sono sei e non tre perché ogni canale ha la sua metà *discovery* accanto
    /// alla sua metà *invoke*: la shell non cabla nessun id, disegna ciò che
    /// legge. Il canale dati la discovery non ce l'ha, ed è la ragione per cui
    /// `query_index` è uno solo: la domanda è un dato anche lei.
    Bridge,
    /// Le operazioni Grid attraversano una porta tipata distinta: la shell
    /// negozia la superficie e mantiene l'istanza, senza un comando generico
    /// che possa invocare provider arbitrari.
    Grid,
    /// Il disegno sul motore (K5) attraversa una porta tipata distinta, come
    /// la griglia: la shell apre un'istanza del motore e la tiene in
    /// sincronia con il testo, e i gesti arrivano a ogni movimento della
    /// penna con forme e tetti propri (`fub_abi::drawing`), validati prima del
    /// motore. Un comando generico del registro passerebbe JSON non tipato e
    /// non saprebbe di un'istanza che vive fuori dal vault.
    Drawing,
    /// **La capacità e la sua porta.** L'atto è già nell'elenco chiuso
    /// dell'`HostApi` (0013), e la shell **non è un plugin**: non ha un manifest
    /// a cui concederlo, quindi lo raggiunge da una porta col suo nome invece
    /// che dal trait.
    ///
    /// È la categoria che si può tenere senza paura, perché non cresce da sola:
    /// cresce solo se cresce l'elenco delle capacità, che dal freeze in poi è una
    /// minor da discutere una per una. Il payload dice **quale** capacità c'è
    /// dall'altra parte, così la simmetria è controllabile a occhio: se un nome
    /// qui non corrisponde a niente nel contratto, la riga è una bugia.
    ContractCapability(&'static str),
    /// **La porta è la credenziale.** Ciò che rende legittimo l'atto è *chi
    /// bussa*, e una porta generica lascerebbe che a dirlo fosse chiunque.
    ///
    /// È la [decisione 0012](../../../docs/decisions/0184-eventi-accodati-e-job.md)
    /// applicata alla configurazione e allo stato di vista: da qui passa **la
    /// persona davanti allo schermo** — che ha cliccato su un interruttore — e da
    /// `settings.set` del registro passa un *programma*, che tocca solo le chiavi
    /// dichiarate scrivibili da un programma. Se fossero la stessa strada, o
    /// l'utente non potrebbe cambiare le proprie impostazioni di privacy, o un
    /// plugin potrebbe. Per lo stato di vista è la stessa riga un piano più in
    /// giù: proprietario ed esemplare li timbra **questa porta**, e se
    /// arrivassero da JS una pagina qualunque potrebbe rileggere lo stato di
    /// vista di un provider (0035, 0037). E il contesto attivo e il locale di
    /// sistema sono fatti che **solo la shell sa**: quale nota si sta guardando è
    /// una decisione dell'app e non una capacità
    /// ([0007](../../../docs/decisions/README.md)), e `Intl` ce
    /// l'ha il webview.
    GateIsCredential,
    /// **Aspetta un cliente.** Passerebbe la riga che divide come comando — fa
    /// accadere qualcosa e non risponde con dati — ma il registro non lo può
    /// servire: un `CommandProvider` ha in mano l'`HostApi` e nient'altro, e per
    /// queste scritture una capacità **non c'è**.
    ///
    /// E non c'è per decisione, non per dimenticanza: *una capacità concessa a
    /// nessuno è superficie da mantenere e sandboxare per sempre* (0013), e
    /// nessun plugin ha ancora chiesto di appuntare una nota o di dare un'icona a
    /// una cartella. Il prezzo è dichiarato e va guardato in faccia: oggi
    /// `IndexQuery::Organization` lascia **leggere** l'organizzazione a chiunque
    /// e queste quattro porte lasciano **scrivere** solo alla shell, che è
    /// l'asimmetria che il canale dati esiste per non avere. Il giorno che
    /// qualcuno la chiede, la capacità entra (additiva) e queste diventano
    /// comandi del registro come le cinque strutturali.
    AwaitingClient,
    /// **Debito dichiarato**: risponde con DATI, quindi per la riga che divide
    /// (0013) non può essere un comando e va sul canale di lettura; oppure è un
    /// comando vero ma bespoke, e va nel registro.
    ///
    /// `verso` è la destinazione, e il conto di questi è presidiato da un test a
    /// parte: migrarne uno costringe a toccare un numero, e chiudere l'ultimo
    /// costringe ad accorgersene.
    ///
    /// **E l'ultimo è chiuso**: da `d3a59a5` nessuna riga dell'allowlist la
    /// costruisce più, ed è precisamente il modo in cui il conto doveva farsi
    /// notare. Il `dead_code` che ne segue è il segnale, non il difetto — ma un
    /// segnale che ferma la CI a ogni corsa non lo legge nessuno, lo mette a
    /// tacere il primo che passa.
    ///
    /// La variante **resta**, e non è nostalgia. Questo enum è il vocabolario
    /// delle ragioni per cui un comando IPC può esistere, e senza questa il
    /// prossimo che ne scrive uno che *dovrebbe* stare sul canale dati non
    /// avrebbe come dirlo: sceglierebbe una delle cinque ragioni legittime, il
    /// debito nascerebbe già dichiarato in regola, e il conto qui sotto
    /// resterebbe zero mentendo. Il presidio che conta a zero è ancora
    /// `il_debito_dichiarato_e_un_numero_presidiato`, ed è lui a tenere la
    /// promessa: qui si tace un lint, non un'asserzione.
    #[allow(dead_code)]
    ToMigrate { to: &'static str },
}

// ---------------------------------------------------------------------------
// L'allowlist
// ---------------------------------------------------------------------------

/// **I comandi Tauri di Fub, tutti e soli, con la loro ragione.**
///
/// Fotografia, non ricordo: un nome che compare qui senza un comando vero è
/// rosso quanto un comando vero che non compare qui.
const ALLOWLIST: &[(&str, Why)] = &[
    // --- prima, sopra e attorno al kernel -----------------------------------
    //
    // Aprire un vault è *montare* il kernel: finché non è montato non c'è un
    // registro a cui chiedere, e la domanda «quali vault ci sono» non appartiene
    // a nessuno dei vault che nomina.
    ("open_vault", Why::AppSurface),
    ("close_vault", Why::AppSurface),
    ("list_vaults", Why::AppSurface),
    ("set_current_vault", Why::AppSurface),
    ("initial_vault", Why::AppSurface),
    // L'avviso di sessione (§25.5): la porta della diagnosi «la cartella di
    // configurazione non si può scrivere». Risponde con un **dato**, e la riga
    // che divide (0013) direbbe `query_index` — la stessa obiezione di
    // `pending_keybindings` qui sotto, e la stessa risposta: la risposta non
    // si ricava dal vault, nasce dal bootstrap dell'installazione prima di
    // ogni vault, ed è il caso della finestra vuota quello che conta.
    ("session_notice", Why::AppSurface),
    // L'anagrafe della macchina (§11.1): esiste prima di ogni vault, e sopravvive
    // a tutti. Un vault dimenticato non ha un indice che se ne ricordi.
    ("known_vaults", Why::AppSurface),
    ("set_vault_favorite", Why::AppSurface),
    ("set_vault_look", Why::AppSurface),
    ("forget_vault", Why::AppSurface),
    // Chi questo host sa montare, e chi è acceso: «spento» e «non c'è» sono due
    // stati diversi, e il secondo è l'unico che il kernel sappia dire (0031).
    ("list_bundles", Why::AppSurface),
    ("list_themes", Why::AppSurface),
    ("read_theme", Why::AppSurface),
    // Installare un tema da una cartella scelta dalla persona nella finestra
    // nativa (la webview non passa path): prima la si legge senza scrivere (i
    // cancelli CSS sono della shell), poi si scrive nella configurazione della
    // macchina coi byte controllati (un permesso che vale una volta, e che
    // `discard_theme_folder` scarta dopo un «no»); solo dalla shell
    // principale, e le prime due con `developer.mode` acceso (la regola è
    // dell'host).
    ("check_theme_folder", Why::AppSurface),
    ("install_theme_from_folder", Why::AppSurface),
    ("discard_theme_folder", Why::AppSurface),
    // Collegare la cartella di un tema in sviluppo, scelta nella finestra
    // nativa come sopra: l'host la legge al suo posto e la guarda, e a ogni
    // salvataggio la shell riceve `fub://theme-changed`. Scollegare, e lo stato
    // del collegamento per Aspetto; solo dalla shell principale, collegare
    // con `developer.mode` acceso.
    ("link_theme_folder", Why::AppSurface),
    ("unlink_theme_folder", Why::AppSurface),
    ("theme_link", Why::AppSurface),
    ("set_plugin_enabled", Why::AppSurface),
    // Il ciclo di vita dei motori, che sono del processo e non di un vault:
    // scaldare quello di un'estensione prima della prima apertura, e lasciare
    // andare le cache dei documenti quando la shell chiude l'ultimo. Nessun
    // registro di un vault li possiede, come per i job (K3, T8).
    ("warm_engine", Why::AppSurface),
    ("document_closed", Why::AppSurface),
    // La pagina «Componenti» (A7): lo stato dei componenti non è
    // `program_writable`, come `plugins.disabled` — un componente non deve
    // poter spegnere gli altri — quindi non passa dalle porte generiche, e la
    // scelta la applica solo la shell, come `set_plugin_enabled`.
    ("components_map", Why::AppSurface),
    ("components_apply", Why::AppSurface),
    // Inventario macchina e decisioni persistenti non appartengono al registro
    // di un vault. Queste porte restano sottili e delegano al manager installato.
    ("list_installed_plugins", Why::AppSurface),
    ("install_plugin", Why::AppSurface),
    ("set_installed_plugin_enabled", Why::AppSurface),
    ("set_installed_plugin_consent", Why::AppSurface),
    ("remove_installed_plugin", Why::AppSurface),
    // Fermare un lavoro lungo (§10.3): *elencarli* è una query (`IndexQuery::Jobs`,
    // sono dati), fermarne uno no — e il runner è dell'app, non del kernel (0032).
    ("cancel_job", Why::AppSurface),
    // I tasti che un vault propone e che nessuno ha guardato (§23.13). È la
    // stessa riga di `known_vaults`, e il primo dei tre è quello che vale la
    // pena difendere perché **risponde con dei dati**: la regola direbbe
    // `query_index`, e non regge qui, perché la risposta non si ricava dal
    // vault. Si ricava mettendo il file del vault accanto a ciò che **questa
    // macchina** ha già visto, che è nel registro dei vault — cioè fuori da ogni
    // vault, per la ragione della 0029: un elenco di vault non sta in nessun
    // vault. Un `IndexQuery` che rispondesse sarebbe il canale dati di un vault
    // che legge l'installazione. Gli altri due sono la risposta della persona
    // davanti allo schermo, e scrivono nello stesso registro.
    ("pending_keybindings", Why::AppSurface),
    ("adopt_keybindings", Why::AppSurface),
    ("discard_keybindings", Why::AppSurface),
    // --- demo, supporto e finestre: la macchina attorno ai vault --------------
    //
    // La demo vive nella cartella di configurazione, la diagnostica nasce dal
    // bootstrap prima di ogni vault e il recovery tocca i file di macchina con
    // backup obbligatorio: niente di tutto questo appartiene a un vault, quindi
    // niente appartiene al registro di un vault. Le finestre documento sono
    // finestre native aperte dalla shell sopra la sessione autorevole.
    ("demo_root", Why::AppSurface),
    ("open_demo", Why::AppSurface),
    ("close_demo", Why::AppSurface),
    ("reset_demo", Why::AppSurface),
    ("startup_diagnostics", Why::AppSurface),
    ("support_preview", Why::AppSurface),
    ("support_export", Why::AppSurface),
    ("config_health", Why::AppSurface),
    ("recover_config", Why::AppSurface),
    ("open_document_window", Why::AppSurface),
    ("close_document_window", Why::AppSurface),
    ("finish_main_close", Why::AppSurface),
    // --- mobile (P14/F37): il confine OS sopra lo stesso `Host` ---------------
    //
    // Share sheet, storage privato-vs-condiviso, permessi, grant e report
    // JIT/WASM: la via d'ingresso del sistema operativo, che compone il kernel
    // invece di viverci dentro — capture validate e poi applicate dall'unico
    // `Host`, mai un secondo writer.
    ("mobile_validate_capture", Why::AppSurface),
    ("mobile_submit_capture", Why::AppSurface),
    ("mobile_storage_roots", Why::AppSurface),
    ("mobile_storage_preference", Why::AppSurface),
    ("mobile_set_storage_preference", Why::AppSurface),
    ("mobile_wasm_report", Why::AppSurface),
    ("mobile_classify_opened_url", Why::AppSurface),
    ("mobile_register_tree_grant", Why::AppSurface),
    ("mobile_shared_mount_mode", Why::AppSurface),
    ("mobile_pick_tree", Why::AppSurface),
    ("mobile_verify_tree", Why::AppSurface),
    ("mobile_open_shared", Why::AppSurface),
    ("mobile_close_shared", Why::AppSurface),
    ("mobile_copy_tree", Why::AppSurface),
    // --- byte e finestre fidate: la porta è la credenziale --------------------
    //
    // Risorse, viewer e artefatti toccano byte o finestre native: ogni handler
    // apre il gate `guard_trusted_local` su label+origin letti lato nativo,
    // mai su argomenti JS — la legittimità sta in *chi bussa*, non in cosa
    // chiede. Il deposito resta CAS esplicito via `ResourceWrite`, mai
    // overwrite silenziosa.
    ("resource_open", Why::AppSurface),
    ("resource_read_chunk", Why::AppSurface),
    ("resource_close", Why::AppSurface),
    ("resource_write", Why::AppSurface),
    ("viewer_open", Why::AppSurface),
    ("viewer_control", Why::AppSurface),
    ("viewer_save", Why::AppSurface),
    // Le tessere della vista Mappa: byte di un'immagine, non dati del vault
    // (`query_index` non porta byte) né un comando del registro, perché a
    // chi chiedere lo decide un'impostazione di macchina che nessun vault
    // può dare (`Host::map_tile`).
    ("map_tile", Why::AppSurface),
    ("save_artifact", Why::AppSurface),
    ("print_artifact", Why::AppSurface),
    ("reveal_in_system", Why::AppSurface),
    // «Apri con» un'app Craft: avviano o interrogano programmi della
    // macchina, quindi solo la shell principale (`guard_main_shell`).
    ("external_editors", Why::AppSurface),
    ("open_with", Why::AppSurface),
    // Non è un comando del bundle `fub.craft` (A13): `invoke_command` lo
    // raggiungerebbero anche un plugin e l'MCP, e avviare la CLI di un'app
    // vuole il gesto di chi guarda la shell. `craft.preview` resta il comando
    // del bundle, in sola lettura, e non avvia mai niente.
    ("craft_render", Why::AppSurface),
    // --- macchina e catalogo: sopra ogni vault --------------------------------
    //
    // Profili d'impostazione, capacità del frame, inventario installato e
    // catalogo firmato vivono nel livello macchina: esistono prima di ogni
    // vault e sopravvivono a tutti, quindi non appartengono al registro di
    // nessun vault.
    ("settings_profiles", Why::AppSurface),
    ("export_settings_profile", Why::AppSurface),
    ("import_settings_profile", Why::AppSurface),
    ("duplicate_settings_profile", Why::AppSurface),
    ("switch_settings_profile", Why::AppSurface),
    ("reset_settings_profile", Why::AppSurface),
    ("frame_capabilities", Why::AppSurface),
    ("setting_requires_reopen", Why::AppSurface),
    ("plugin_budget_snapshot", Why::AppSurface),
    ("plugin_limited_mode", Why::AppSurface),
    ("catalog_search", Why::AppSurface),
    ("catalog_install", Why::AppSurface),
    ("catalog_update", Why::AppSurface),
    ("catalog_rollback", Why::AppSurface),
    ("catalog_revoke", Why::AppSurface),
    ("catalog_install_theme", Why::AppSurface),
    ("catalog_update_theme", Why::AppSurface),
    ("catalog_rollback_theme", Why::AppSurface),
    ("catalog_revoke_theme", Why::AppSurface),
    // --- i tre ponti, in due metà ciascuno ----------------------------------
    ("list_views", Why::Bridge),
    ("render_view", Why::Bridge),
    ("view_action", Why::Bridge),
    ("list_commands", Why::Bridge),
    ("invoke_command", Why::Bridge),
    ("query_index", Why::Bridge),
    // --- Grid v2: discovery, sessioni sui byte e finestre tipate ------------
    ("list_grid_surfaces", Why::Grid),
    ("open_grid_bytes", Why::Grid),
    ("grid_bytes_window", Why::Grid),
    ("apply_grid_bytes", Why::Grid),
    ("grid_bytes_commands", Why::Grid),
    ("grid_bytes_command", Why::Grid),
    ("close_grid_bytes", Why::Grid),
    // --- il disegno sul motore (K5): istanze del motore e gesti tipati ------
    ("open_drawing", Why::Drawing),
    ("drawing_sync", Why::Drawing),
    ("drawing_gesture", Why::Drawing),
    ("drawing_commands", Why::Drawing),
    ("drawing_command", Why::Drawing),
    ("close_drawing", Why::Drawing),
    // --- la sessione live (0205): un servizio dell'app, con il suo canale ---
    //
    // Listener, TLS e scrittore vivono nel processo dell'app, sul runtime di
    // Tauri, e la sessione appartiene alla finestra che l'ha aperta: nessun
    // registro di vault la conosce, e un comando del registro non potrebbe
    // passarle il canale degli eventi, che è il settimo ponte. Le risposte ai
    // commit sono della shell, che è l'autorità sul disegno.
    ("live_start", Why::AppSurface),
    ("live_pairing", Why::AppSurface),
    ("live_send", Why::AppSurface),
    ("live_status", Why::AppSurface),
    ("live_stop", Why::AppSurface),
    // --- le capacità dell'elenco chiuso, affacciate sull'IPC ----------------
    (
        "read_document",
        Why::ContractCapability("VaultRead::read_document"),
    ),
    (
        "write_document",
        Why::ContractCapability("VaultWrite::write_document"),
    ),
    // Qui stavano `list_trash` e `propose_free_name`, ed erano due righe
    // legittime: due capacità del contratto affacciate alla shell. Se ne sono
    // andate col pannello cestino, che dal §1.2 è un `ViewProvider` e le chiede
    // dall'altro lato del confine. Non è una migrazione — non hanno cambiato
    // canale, hanno perso il chiamante — ed è il modo in cui questo elenco
    // accorcia più spesso: non spostando una porta, ma smettendo di averne
    // bisogno.
    // --- ciò che vale perché lo dice questa porta ---------------------------
    ("set_active_context", Why::GateIsCredential),
    ("set_system_locale", Why::GateIsCredential),
    ("set_setting", Why::GateIsCredential),
    ("reset_setting", Why::GateIsCredential),
    ("view_state", Why::GateIsCredential),
    ("set_view_state", Why::GateIsCredential),
    // --- l'organizzazione del vault (§11.3): scritture senza richiedente ----
    ("set_icon", Why::AwaitingClient),
    ("set_pinned", Why::AwaitingClient),
    ("set_space", Why::AwaitingClient),
    ("set_order", Why::AwaitingClient),
    // --- il buffer di crash (§15.2): la stessa forma, e una ragione in più ---
    //
    // Passerebbero la riga che divide — fanno accadere qualcosa, rispondono con
    // niente — e il registro non le può servire perché una capacità non c'è. Qui
    // però l'assenza non è «nessuno l'ha ancora chiesta»: è **deliberata e
    // definitiva**. Il testo che l'utente non ha ancora salvato è il dato più
    // privato che un vault contenga, e una capacità `draft_write` lo
    // consegnerebbe a ogni plugin montato — compresi quelli che a M5 non
    // scriviamo noi. Chi ha bisogno di scriverci è la shell, che non è un
    // plugin: qui la porta **non** aspetta un cliente, aspetta di non averne mai.
    // La lettura invece è già sul canale di tutti (`IndexQuery::Drafts`), perché
    // leggere ciò che si stava scrivendo è ciò che un pannello di recupero fa.
    ("save_draft", Why::AwaitingClient),
    ("discard_draft", Why::AwaitingClient),
    // --- il debito, che il §16.6 nomina e che qui si conta ------------------
    //
    // Il versioning **non è più qui**, e le sue tre righe sono la lezione più
    // utile che questo elenco abbia dato finora. Erano classificate «due letture
    // → `IndexQuery`» e «un comando → il registro», e la classificazione era
    // giusta a metà: il comando è diventato davvero un comando del registro
    // (`version.restore`), ma le due letture non sono migrate da nessuna parte —
    // sono **sparite**, perché chi le faceva era il pannello cronologia di
    // questa shell, e dal §1.2 la cronologia è un `ViewProvider` della feature
    // versioning, che legge dal proprio spazio dati.
    //
    // Cioè: la domanda giusta davanti a un bespoke non è sempre *su che canale
    // lo sposto*, è prima *chi lo chiama, e da che parte del confine dovrebbe
    // stare*. Un `IndexQuery::Versions` scritto a suo tempo sarebbe oggi una
    // rotta del contratto che nessuno percorre.
    // `render_preview` e `render_embed` (0163) non sono più qui: sono passati
    // al canale dati (`IndexQuery::RenderPreview` / `IndexQuery::RenderEmbed`),
    // come l'outline e ogni altra lettura. Un fatto sul vault che solo la
    // shell sapeva chiedere è adesso una domanda del canale di tutti — e un
    // `ViewProvider` che volesse mostrare un documento reso ce l'ha. La
    // [decisione 0163](../../../docs/decisions/0191-ui-dichiarativa-e-renderer.md)
    // ha chiuso l'asimmetria.
];

/// L'allowlist per nome, con il rifiuto dei doppioni: due righe con lo stesso
/// comando vorrebbero dire due ragioni per la stessa cosa, e la seconda
/// resterebbe non letta per sempre.
fn allowlist() -> BTreeMap<&'static str, &'static Why> {
    let mut out = BTreeMap::new();
    for (name, why) in ALLOWLIST {
        assert!(
            out.insert(*name, why).is_none(),
            "`{name}` appears twice in the allowlist: the second reason will never\n\
             be read."
        );
    }
    out
}

// ---------------------------------------------------------------------------
// I due estrattori
// ---------------------------------------------------------------------------

/// `true` se la riga è **prosa**: un commento di riga, di documentazione o di
/// modulo.
///
/// È la sola regola che separa il codice dal discorso sul codice in questo file,
/// e basta perché i file di `src/ipc/` non contengono nessun commento a blocco — cosa che
/// [`nessun_commento_a_blocco`] verifica, invece di darla per buona. Se un
/// giorno ne comparisse uno, quel test diventa rosso **prima** che questo si
/// metta a contare male: è l'ordine giusto dei due, perché un estrattore che
/// conta male non fallisce, dice un numero.
fn is_prose(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// **I comandi registrati**: i nomi dentro `tauri::generate_handler![ … ]`.
///
/// Il blocco dev'essere uno solo. Con due, uno dei due sarebbe la superficie
/// vera e l'altro un elenco che questo test non guarda — che è il modo più
/// comodo di aggiungere un comando senza che nessuno lo veda. Il conto **non**
/// legge il primo blocco che trova: li conta tutti e pretende che siano uno,
/// che è la sola forma che sa dire di no a un secondo (la stessa di
/// `bridges_stay_six` e di `files-with-ipc-surface`).
///
/// L'apertura si riconosce **senza il prefisso** `tauri::`, e non è pedanteria:
/// `ipc_surface_lives_in_one_folder` cerca `generate_handler!` nudo negli
/// altri file del crate, e cercare qui la forma lunga voleva dire che le due
/// domande — *uno solo in questo file* e *nessuno negli altri* — leggevano due
/// stringhe diverse. Un `use tauri::generate_handler;` più un secondo
/// `generate_handler![…]` in questo stesso file passava la pretesa, e i suoi
/// nomi non arrivavano né all'allowlist né a nessun altro banco.
fn defined_commands(src: &str) -> BTreeSet<&str> {
    let mut out = BTreeSet::new();
    let mut expected: Option<usize> = None;

    for (n, line) in src.lines().enumerate() {
        if is_prose(line) {
            continue;
        }
        let t = line.trim();

        if t.starts_with("#[tauri::command") {
            assert!(
                expected.is_none(),
                "line {}: two `#[tauri::command]` in a row without a `fn` between them",
                n + 1
            );
            expected = Some(n + 1);
            continue;
        }
        assert!(
            !t.contains("#[tauri::command"),
            "line {}: `#[tauri::command]` is not at the start of the line, and this\n\
             extractor cannot read it:\n  {t}",
            n + 1
        );

        let Some(line_attribute) = expected else {
            continue;
        };
        // Altri attributi fra l'`#[tauri::command]` e la firma.
        if t.starts_with("#[") {
            continue;
        }

        let sig = without_visibility(t);
        let sig = sig.strip_prefix("async ").unwrap_or(sig);
        let rest = sig.strip_prefix("fn ").unwrap_or_else(|| {
            panic!(
                "line {line_attribute}: after `#[tauri::command]` there is no `fn`, but:\n  {t}\n\
                 If the form is legitimate, widen the extractor — do not let a command\n\
                 vanish from a list that serves to see what appears."
            )
        });
        let name = rest
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| panic!("line {}: `fn` without a name:\n  {t}", n + 1));

        assert!(
            out.insert(name),
            "the command `{name}` is defined twice (line {})",
            n + 1
        );
        expected = None;
    }

    assert!(
        expected.is_none(),
        "the file ends with a `#[tauri::command]` (line {}) that has no signature below",
        expected.unwrap_or(0)
    );
    out
}

/// **I comandi definiti**: i nomi di funzione che seguono un vero
/// `#[tauri::command]`.
///
/// Fra l'attributo e la firma può starcene un altro (`view_action` porta un
/// `#[allow(clippy::too_many_arguments)]`), e quelli si saltano. Tutto il resto è
/// un errore e non un'omissione: se dopo l'attributo non arriva una `fn`, questo
/// test si ferma invece di indovinare. Un estrattore che ignora ciò che non
/// capisce trasforma un comando in un comando *assente*, e l'assenza è proprio
/// ciò che qui si deve saper vedere.
fn registered_commands(src: &str) -> BTreeSet<&str> {
    const OPENING: &str = "generate_handler![";

    let lines: Vec<(usize, &str)> = src
        .lines()
        .enumerate()
        .filter(|(_, r)| !is_prose(r) && r.contains(OPENING))
        .collect();
    assert_eq!(
        lines.len(),
        1,
        "in `src/ipc/` the `{OPENING}` blocks are {}, and exactly one is required:\n\
         it is the surface this test guards.",
        lines.len()
    );
    let first = lines[0].0;

    let mut out = BTreeSet::new();
    let mut inside = false;
    for (n, line) in src.lines().enumerate().skip(first) {
        if is_prose(line) {
            continue;
        }
        let mut t = line.trim();
        if !inside {
            let Some((_, tail)) = t.split_once(OPENING) else {
                continue;
            };
            inside = true;
            t = tail;
        }
        let closing = t.contains(']');
        for piece in t.trim_end_matches([']', ')']).split(',') {
            let name = piece.trim();
            if name.is_empty() {
                continue;
            }
            assert!(
                name.chars().all(|c| c.is_alphanumeric() || c == '_'),
                "line {}: inside `generate_handler!` there is `{name}`, which is not a\n\
                 function name. This extractor reads a list of identifiers separated by\n\
                 commas, and stops on everything else.",
                n + 1
            );
            assert!(
                out.insert(name),
                "line {}: `{name}` is registered twice",
                n + 1
            );
        }
        if closing {
            return out;
        }
    }
    panic!("`{OPENING}` never closes: the `]` is missing");
}

/// La firma senza la visibilità: i comandi della cartella sono `pub(crate)`,
/// perché `handler` in `ipc/mod.rs` e il resto del crate li raggiungano.
fn without_visibility(t: &str) -> &str {
    t.strip_prefix("pub(crate) ")
        .or_else(|| t.strip_prefix("pub "))
        .unwrap_or(t)
}

/// Come si scrive un insieme in un messaggio d'errore: in ordine, sulla stessa
/// riga, senza le virgolette del `Debug` — sono nomi di funzione, e chi legge li
/// deve poter cercare.
fn list(names: &BTreeSet<&str>) -> String {
    names.iter().copied().collect::<Vec<_>>().join(", ")
}

// ---------------------------------------------------------------------------
// Le reti
// ---------------------------------------------------------------------------

/// La rete che non costa niente e che va tesa lo stesso.
///
/// Un comando **registrato e non definito** non compilerebbe, quindi questa metà
/// è gratis e non prende mai niente. L'altra invece prende: un comando
/// **definito e mai registrato** compila benissimo, non lo chiama nessuno, e
/// resta lì a somigliare a codice vivo — di solito perché qualcuno l'ha tolto da
/// `generate_handler!` senza toglierlo dal file. Nessun altro presidio lo vede,
/// perché `cargo` una `fn` privata inutilizzata dentro un `lib` che la esporta ai
/// suoi test non la nomina.
#[test]
fn defined_and_registered_are_the_same_set() {
    let source = source();
    let defined = defined_commands(&source);
    let registered = registered_commands(&source);

    let orphans: BTreeSet<&str> = defined.difference(&registered).copied().collect();
    assert!(
        orphans.is_empty(),
        "these commands have a `#[tauri::command]` and are not in `generate_handler!`:\n  \
         {}\n\
         Nobody can reach them from the webview: either register them or remove them.\n\
         A command nobody can invoke is dead code dressed as surface.",
        list(&orphans)
    );

    let ghosts: BTreeSet<&str> = registered.difference(&defined).copied().collect();
    assert!(
        ghosts.is_empty(),
        "these names are in `generate_handler!` and are not defined in `src/ipc/`:\n  \
         {}\n\
         (It should not compile: if you are here, the extractor misread.)",
        list(&ghosts)
    );
}

/// **La superficie IPC di questo crate è una cartella, e questo lo prova.**
///
/// È la riparazione della zona cieca che la 0106 ha dichiarato leggendo questo
/// presidio: tutti gli altri banchi di questo file giudicano `src/ipc/`, e un
/// `#[tauri::command]` scritto in un altro file del crate — montato con un
/// `.plugin()` che porti il proprio `generate_handler!` — passava di là verde
/// ed era raggiungibile dal webview.
///
/// La forma non è «leggi anche il secondo file»: quella sarebbe l'elenco a mano
/// una riga più lunga, e il terzo file resterebbe fuori. È **la cartella**, e
/// quello che dice è una regola: da qui si entra da un posto solo. Un file
/// fuori da `src/ipc/` con dei comandi non si dichiara, si sposta nella
/// cartella — dove l'elenco chiuso di [`SURFACE`] e l'allowlist lo vedono — o
/// si toglie. Fino al 2026-11-26 il posto era un file, `src/lib.rs`; è
/// diventato una cartella sapendo di cambiare la regola, perché un file di
/// quattromila righe costava a chiunque dovesse leggerlo per intero.
#[test]
fn ipc_surface_lives_in_one_folder() {
    let mut culprits: Vec<String> = Vec::new();
    for (name, text) in walk_sources() {
        if name.starts_with(THE_FOLDER) {
            continue;
        }
        let lines: Vec<String> = text
            .lines()
            .enumerate()
            .filter(|(_, r)| !is_prose(r))
            .filter(|(_, r)| r.contains("#[tauri::command") || r.contains("generate_handler!"))
            .map(|(n, r)| format!("{name}:{} {}", n + 1, r.trim()))
            .collect();
        if !lines.is_empty() {
            culprits.extend(lines);
        }
    }
    assert!(
        culprits.is_empty(),
        "in `crates/fub-app/src` there is an IPC surface outside `{THE_FOLDER}`:\n  {}\n\
         None of the other benches of this file sees it — they read `{THE_FOLDER}` —\n\
         and from the webview a command mounted with a `.plugin()` is called anyway,\n\
         as `plugin:<name>|<command>`. The surface of this crate is **one** folder:\n\
         either that command moves to `{THE_FOLDER}` and passes through the\n\
         allowlist, or it is not an IPC command.",
        culprits.join("\n  ")
    );
}

/// **Il cuore**: la superficie registrata è l'allowlist, nei due versi.
#[test]
fn ipc_surface_is_a_closed_list() {
    let source = source();
    let registered = registered_commands(&source);
    let declared: BTreeSet<&str> = allowlist().keys().copied().collect();

    let new: BTreeSet<&str> = registered.difference(&declared).copied().collect();
    assert!(
        new.is_empty(),
        "the IPC surface has grown by: {}\
         \n\
         \nIt must be **declared**, and declaring it means writing in `ALLOWLIST`\
         \n(crates/fub-app/tests/lean_ipc.rs) because that command could not be:\
         \n\
         \n  - a **registry command** — declare it in a `CommandProvider` and it\
         \n    arrives at the palette, the keyboard, macros, and CLI on its own,\
         \n    with its parameters and its radius;\
         \n  - a **view** — if it draws something, it is a `ViewProvider` and\
         \n    passes through `render_view`/`view_action`, like the backlink panel;\
         \n  - a **query** — if it responds with DATA it cannot be a command:\
         \n    a `CommandOutcome` carries a message and an effect, not data, and\
         \n    data has a single channel (`query_index`, decision 0013).\
         \n\
         \nIf it truly could not be any of the three, the reason is a line in the\
         \n`Why` enum — and if none of the six that exist applies, the answer\
         \nalmost always is that it could.",
        list(&new)
    );

    let gone: BTreeSet<&str> = declared.difference(&registered).copied().collect();
    assert!(
        gone.is_empty(),
        "the allowlist declares {} that is no longer in `generate_handler!`.\n\
         Remove it from `ALLOWLIST`: the list is a photograph, not a memory. If it\n\
         was migrated, the right place to celebrate it is the count of `ToMigrate`.",
        list(&gone)
    );
}

/// **Il debito residuo del §16.6 è un numero, non una riga di prosa.**
///
/// La voce di roadmap che ha generato questo test si accusa da sola di avere un
/// conto scritto a mano che è diventato falso senza che nessuno se ne accorgesse
/// — «38 oggi», mentre i comandi sono trentasette. Un numero in un documento non
/// diventa mai rosso. Questo sì: migrarne uno obbliga a toccarlo, e chiudere
/// l'ultimo obbliga ad accorgersene, che è il momento in cui questa voce si può
/// barrare.
#[test]
fn declared_debt_is_a_guarded_number() {
    let to_migrate: Vec<String> = ALLOWLIST
        .iter()
        .filter_map(|(name, why)| match why {
            Why::ToMigrate { to } => Some(format!("{name} → {to}")),
            _ => None,
        })
        .collect();

    assert_eq!(
        to_migrate.len(),
        0,
        "commands still to migrate are {} and not 0:\n  {}\n\
         §16.6 has finished its debt and this assertion is the line that tells you.",
        to_migrate.len(),
        to_migrate.join("\n  ")
    );
}

/// **Le capacità nominate esistono davvero.**
///
/// Una riga che dice «questo comando è la porta di `VaultRead::list_trash`» è
/// una garanzia, e una garanzia che nomina un metodo scomparso è peggio di
/// nessuna garanzia: chi la legge smette di controllare. Il §16.7 ha una specie
/// apposta per questo difetto, ed è quella che le batte tutte perché *il motivo
/// per cui si scrive una garanzia è smettere di doverci pensare*.
///
/// Il presidio è quello che la voce stessa indica: il nome deve essere una cosa
/// che si cerca meccanicamente. Qui si cerca il metodo **dentro** il suo trait,
/// non in tutto il file — o spostare `list_trash` da `VaultRead` a
/// `VaultStructure` resterebbe verde, e la riga direbbe la cosa sbagliata con
/// l'aria di dirla giusta.
#[test]
fn every_named_capability_exists_in_the_contract() {
    let contract = contract();
    for (command, why) in ALLOWLIST {
        let Why::ContractCapability(capability) = why else {
            continue;
        };
        let (trt, method) = capability.split_once("::").unwrap_or_else(|| {
            panic!("`{command}`: `{capability}` is not in the form `Trait::method`")
        });

        let opening = format!("pub trait {trt}");
        let start = contract
            .lines()
            .position(|r| r.starts_with(&opening))
            .unwrap_or_else(|| {
                panic!(
                    "`{command}` declares the capability `{capability}`, but the contract\n\
                     has no `{opening}`. The trait was renamed or split:\n\
                     update the line, or remove the capability and change the reason.",
                    opening = opening
                )
            });
        let sig = format!("fn {method}(");
        let found = contract
            .lines()
            .skip(start + 1)
            .take_while(|r| !r.starts_with('}'))
            .any(|r| r.trim_start().starts_with(&sig));
        assert!(
            found,
            "`{command}` declares the capability `{capability}`, and `{trt}` has no\n\
             `{sig}`. Either the method was renamed or it migrated to another trait —\n\
             in both cases this line is guaranteeing a symmetry that does not exist."
        );
    }
}

// ---------------------------------------------------------------------------
// I test dei test
// ---------------------------------------------------------------------------

/// La regola «la prosa non conta» vale finché i commenti sono di riga. Un
/// `/* … */` la aggirerebbe in silenzio — e in silenzio è la parola importante:
/// l'estrattore non fallirebbe, direbbe un numero.
#[test]
fn no_block_comment() {
    for (name, text) in SURFACE {
        for (n, line) in text.lines().enumerate() {
            assert!(
                !line.contains("/*"),
                "{name}:{}: a block comment, and `is_prose` can only skip line\n\
                 comments. Either the comment becomes `//`, or the extractor learns\n\
                 blocks.",
                n + 1
            );
        }
    }
}

/// **La trappola, messa in un banco.** Il doc-comment di modulo di `src/lib.rs`
/// nomina `#[tauri::command]` due volte parlando del confine, e altri quattro
/// file del workspace fanno lo stesso: un estrattore che conta la prosa conta
/// trentanove dove ce ne sono trentasette, e l'allowlist nasce sbagliata di due
/// righe che nessuno andrà a cercare.
#[test]
fn extractor_does_not_count_prose() {
    let fake = "\
//! Un modulo che parla di `#[tauri::command]` e ne descrive uno:\n\
//! #[tauri::command]\n\
//! fn non_esisto() {}\n\
\n\
/// Il doc di una funzione, che cita `#[tauri::command]` per spiegarsi.\n\
#[tauri::command]\n\
async fn real(host: State<Host>) -> bool { true }\n\
\n\
fn not_a_command() {}\n\
\n\
    // #[tauri::command]\n\
    // fn commented_out() {}\n\
\n\
#[tauri::command]\n\
#[allow(clippy::too_many_arguments)]\n\
pub fn with_an_attribute_in_between() {}\n\
\n\
#[tauri::command]\n\
pub(crate) async fn reachable_by_the_crate() {}\n\
\n\
        .invoke_handler(tauri::generate_handler![\n\
            real,\n\
            // i_do_not_exist,\n\
            with_an_attribute_in_between,\n\
            reachable_by_the_crate,\n\
        ])\n";

    let expected = BTreeSet::from([
        "real",
        "with_an_attribute_in_between",
        "reachable_by_the_crate",
    ]);
    assert_eq!(defined_commands(fake), expected);
    assert_eq!(registered_commands(fake), expected);
}

/// **E deve accorgersi del secondo blocco, comunque sia scritto.**
///
/// La pretesa «i blocchi sono uno» c'è da sempre, ed è la forma giusta: un
/// parser che *fondesse* due elenchi renderebbe normale averne due, mentre la
/// superficie IPC di questo crate è **una**. Ma la pretesa cercava
/// `tauri::generate_handler![`, e il macro si può chiamare anche senza il
/// percorso — `use tauri::generate_handler;` e poi `generate_handler![…]`. Con
/// la forma corta il secondo blocco non veniva contato, l'`assert` vedeva un
/// blocco solo e passava, e i comandi di quel secondo elenco non arrivavano
/// all'allowlist: registrati e invocabili dal webview, e dichiarati da nessuno.
///
/// Era anche l'unico punto in cui questo file leggeva la domanda con una
/// stringa diversa da `ipc_surface_lives_in_one_folder`, che negli altri
/// file cerca `generate_handler!` nudo. Adesso è la stessa.
#[test]
#[should_panic(expected = "are 2, and exactly one is required")]
fn extractor_catches_second_block_written_without_prefix() {
    registered_commands(
        "        .invoke_handler(tauri::generate_handler![real])\n\
         use tauri::generate_handler;\n\
                 .invoke_handler(generate_handler![hidden])\n",
    );
}

/// E deve fermarsi su token diversi dall'`async` opzionale che sa leggere,
/// invece di far sparire un comando.
#[test]
#[should_panic(expected = "after `#[tauri::command]` there is no `fn`")]
fn extractor_rejects_what_it_cannot_read() {
    defined_commands("#[tauri::command]\nunsafe fn something_new() {}\n");
}

/// Il ponte è il ponte: se un giorno ne comparisse un secondo per lo stesso
/// canale, questo test non se ne accorgerebbe da solo — ma l'allowlist sì,
/// perché il nome nuovo sarebbe da dichiarare. Qui si presidia la sola cosa che
/// il ponte promette e che si può contare: **uno per metà di canale**, sei in
/// tutto, e non cresce con le feature.
#[test]
fn bridges_stay_six() {
    let bridges: Vec<&str> = ALLOWLIST
        .iter()
        .filter(|(_, p)| *p == Why::Bridge)
        .map(|(n, _)| *n)
        .collect();
    assert_eq!(
        bridges.len(),
        6,
        "the bridge commands are {}: {bridges:?}.\n\
         There are three channels per two halves (list / use): views, commands,\n\
         and — the data channel, whose discovery half does not exist because the\n\
         question is data too. A seventh bridge means a new channel, and a new\n\
         channel is a decision to write into a record, not one more line here.",
        bridges.len()
    );
}

#[test]
fn grid_surface_uses_only_named_typed_ports() {
    const GRID: &[&str] = &[
        "list_grid_surfaces",
        "open_grid_bytes",
        "grid_bytes_window",
        "apply_grid_bytes",
        "grid_bytes_commands",
        "grid_bytes_command",
        "close_grid_bytes",
    ];
    let app = source();
    let ipc = include_str!("../../../apps/client/src/host/ipc.ts");
    for command in GRID {
        assert!(
            app.contains(&format!("fn {command}(")),
            "missing typed Tauri command `{command}`"
        );
        assert!(
            ipc.contains(&format!("\"{command}\"")),
            "client must invoke the typed Grid command `{command}`"
        );
    }
    assert!(
        !ipc.lines()
            .any(|line| line.contains("grid") && line.contains("invoke_command")),
        "Grid must not tunnel through the generic invoke_command bridge"
    );
    // A synchronous Tauri command runs on the main thread, the one that
    // presents the frames: the byte ports run in the grid lane instead, in
    // arrival order (`grid_port`, `domande::CORSIA_GRIGLIA`). The list of
    // surfaces too: it reads the workspace, and on the main thread it would
    // wait for whoever is writing it.
    for command in GRID {
        let start = app
            .find(&format!("async fn {command}("))
            .unwrap_or_else(|| panic!("`{command}` must be async, off the main thread"));
        let body = &app[start..];
        let body = &body[..body.find("\n}\n").expect("command body")];
        assert!(
            body.contains("grid_port("),
            "`{command}` must run in the grid lane through `grid_port`"
        );
    }
}

/// The ports that call a provider, write a file or wait for a workspace
/// borrow are not synchronous: Tauri runs a synchronous command on the main
/// thread, the one that presents the frames. Each runs in a lane that keeps
/// the arrival order the main thread gave (`host_lane`, `domande`): two
/// published contexts, two view-state writes or two commands sent back to
/// back must land in that order, and a view action stays in line with the
/// renders of the views.
#[test]
fn ports_that_can_work_run_off_the_main_thread_in_their_lane() {
    const LANES: &[(&str, &str)] = &[
        ("set_active_context", "CORSIA_CONTESTO"),
        ("view_action", "CORSIA_VISTE"),
        ("invoke_command", "CORSIA_COMANDI"),
        ("view_state", "CORSIA_STATO"),
        ("set_view_state", "CORSIA_STATO"),
    ];
    let app = source();
    let body_of = |signature: &str| -> &str {
        let start = app
            .find(signature)
            .unwrap_or_else(|| panic!("`{signature}` not found in src/ipc/"));
        let body = &app[start..];
        &body[..body.find("\n}\n").expect("function body")]
    };
    for (command, lane) in LANES {
        let command_body = body_of(&format!("async fn {command}("));
        assert!(
            command_body.contains(&format!("{command}_in_lane(")),
            "`{command}` must be async and run through `{command}_in_lane`"
        );
        let lane_body = body_of(&format!("async fn {command}_in_lane("));
        assert!(
            lane_body.contains("host_lane(") && lane_body.contains(&format!("domande::{lane}")),
            "`{command}` must run in the lane `{lane}` through `host_lane`"
        );
    }
    // A read with no order to keep goes off the main thread without a lane.
    for command in ["list_views", "list_commands", "components_map"] {
        assert!(
            body_of(&format!("async fn {command}(")).contains("host_read("),
            "`{command}` must run off the main thread through `host_read`"
        );
    }
}

/// The other ports that touch the disk or the vault run off the main thread
/// too, each through the helper that names its lane: `data_port` and
/// `vault_port` (the index lane, where the data they write is read back, and
/// where the support screen reads and rewrites the same data and files),
/// `resource_port` (the resource lane, so a chunk asked before the lease
/// closes is read before it closes), or `host_read` for a read, or a cancel,
/// with no order to keep.
#[test]
fn disk_and_vault_ports_run_off_the_main_thread_through_their_lane() {
    const PORTS: &[(&str, &str)] = &[
        ("open_vault", "open_vault_in_lane("),
        ("set_current_vault", "host_lane("),
        ("close_vault", "vault_port("),
        ("open_demo", "vault_port("),
        ("close_demo", "vault_port("),
        ("reset_demo", "vault_port("),
        ("set_icon", "data_port("),
        ("set_pinned", "data_port("),
        ("set_space", "data_port("),
        ("set_order", "data_port("),
        ("set_setting", "data_port("),
        ("reset_setting", "data_port("),
        ("settings_profiles", "data_port("),
        ("export_settings_profile", "data_port("),
        ("import_settings_profile", "data_port("),
        ("duplicate_settings_profile", "data_port("),
        ("switch_settings_profile", "data_port("),
        ("reset_settings_profile", "data_port("),
        ("known_vaults", "data_port("),
        ("set_vault_favorite", "data_port("),
        ("set_vault_look", "data_port("),
        ("forget_vault", "data_port("),
        ("pending_keybindings", "data_port("),
        ("adopt_keybindings", "data_port("),
        ("discard_keybindings", "data_port("),
        ("support_preview", "data_port("),
        ("support_export", "data_port("),
        ("config_health", "data_port("),
        ("recover_config", "host_lane("),
        ("resource_open", "resource_port("),
        ("resource_read_chunk", "resource_port("),
        ("resource_close", "resource_port("),
        ("resource_write", "resource_port("),
        ("cancel_job", "host_read("),
        ("list_bundles", "host_read("),
        ("list_themes", "host_read("),
        ("read_theme", "host_read("),
    ];
    let app = source();
    let body_of = |signature: &str| -> Option<&str> {
        let start = app.find(signature)?;
        let body = &app[start..];
        Some(&body[..body.find("\n}\n").expect("function body")])
    };
    for (command, helper) in PORTS {
        let command_body = body_of(&format!("async fn {command}("))
            .unwrap_or_else(|| panic!("`{command}` must be async, off the main thread"));
        let through_lane = body_of(&format!("async fn {command}_in_lane("))
            .filter(|_| command_body.contains(&format!("{command}_in_lane(")));
        assert!(
            command_body.contains(helper) || through_lane.is_some_and(|body| body.contains(helper)),
            "`{command}` must run off the main thread through `{helper}`"
        );
    }
    // `open_vault` reaches the lane through its own function.
    assert!(body_of("async fn open_vault_in_lane(")
        .is_some_and(|body| body.contains("domande::CORSIA_INDICE")));
    assert!(body_of("async fn set_current_vault_in_lane(")
        .is_some_and(|body| body.contains("domande::CORSIA_INDICE")));
    // A configuration file is recovered in the lane where it is written
    // (`support::recover_lane`: the view state with `set_view_state`, the
    // rest with the index).
    assert!(body_of("async fn recover_config_in_lane(")
        .is_some_and(|body| body.contains("support::recover_lane(")));
    for (helper, lane) in [
        ("data_port", "domande::CORSIA_INDICE"),
        ("vault_port", "domande::CORSIA_INDICE"),
        ("resource_port", "domande::CORSIA_RISORSE"),
    ] {
        let body = body_of(&format!("async fn {helper}<"))
            .unwrap_or_else(|| panic!("`{helper}` not found in src/ipc/"));
        assert!(body.contains(lane), "`{helper}` must use the lane `{lane}`");
    }
}

/// **A synchronous command runs on the main thread**, the one that presents
/// the frames of the window: Tauri calls a `fn` command there, and an `async
/// fn` on its runtime. A command that reads the disk, waits for a workspace
/// borrow or calls a provider freezes the window for as long as it lasts.
/// So a synchronous command is allowed only in this list, with the reason it
/// can stay: it reads memory, or it works on a native window (and Tauri
/// would bring that work back to the main thread anyway), or it is a mobile
/// boundary the desktop never calls. Both directions are checked: a new
/// synchronous command fails here by name, and so does a name that is no
/// longer synchronous.
#[test]
fn every_synchronous_command_says_why_it_stays_on_the_main_thread() {
    const SYNCHRONOUS: &[(&str, &str)] = &[
        ("list_vaults", "reads the open sessions in memory"),
        (
            "initial_vault",
            "an env var and the remembered vaults, once at startup before any frame matters",
        ),
        ("session_notice", "takes a notice kept in memory"),
        ("set_system_locale", "publishes the locale in memory"),
        ("frame_capabilities", "reads the machine settings in memory"),
        (
            "setting_requires_reopen",
            "looks the key up in the schema in memory",
        ),
        (
            "discard_theme_folder",
            "forgets a permission kept in memory",
        ),
        (
            "viewer_control",
            "only native window work (history, close, focus) that Tauri runs on the main thread",
        ),
        ("plugin_budget_snapshot", "reads atomic counters"),
        ("plugin_limited_mode", "clones a value read at startup"),
        (
            "demo_root",
            "builds a path, no disk access beyond canonicalize",
        ),
        (
            "startup_diagnostics",
            "support screen: reads the diagnostics kept in memory by the open session",
        ),
        (
            "close_document_window",
            "native window lifecycle: destroys a window",
        ),
        (
            "finish_main_close",
            "native window lifecycle: destroys the main window",
        ),
        (
            "live_send",
            "hands a message to the live session channel in memory",
        ),
        ("live_status", "reads the live session state in memory"),
        (
            "mobile_validate_capture",
            "mobile boundary: validates a payload in memory",
        ),
        (
            "mobile_submit_capture",
            "mobile boundary, never invoked on the desktop",
        ),
        (
            "mobile_storage_roots",
            "mobile boundary, never invoked on the desktop",
        ),
        (
            "mobile_storage_preference",
            "mobile boundary, never invoked on the desktop",
        ),
        (
            "mobile_set_storage_preference",
            "mobile boundary, never invoked on the desktop",
        ),
        ("mobile_wasm_report", "mobile boundary: a static report"),
        (
            "mobile_classify_opened_url",
            "mobile boundary: parses a string",
        ),
        (
            "mobile_register_tree_grant",
            "mobile boundary: validates a grant in memory",
        ),
    ];
    let allowed: BTreeMap<&str, &str> = SYNCHRONOUS.iter().copied().collect();
    assert_eq!(allowed.len(), SYNCHRONOUS.len(), "a name is listed twice");
    let source = source();
    let found = synchronous_commands(&source);
    let new: Vec<_> = found
        .iter()
        .filter(|name| !allowed.contains_key(*name))
        .collect();
    assert!(
        new.is_empty(),
        "synchronous commands not in the list: {new:?}.\n\
         A synchronous Tauri command runs on the main thread, the one that presents\n\
         the frames. Make it `async` and run its work in a lane (`host_lane`, `domande`)\n\
         or through `host_read`; list it here only if it reads memory or works on a\n\
         native window, with that reason."
    );
    let gone: Vec<_> = allowed
        .keys()
        .filter(|name| !found.contains(*name))
        .collect();
    assert!(
        gone.is_empty(),
        "listed as synchronous but no longer synchronous commands: {gone:?}: remove them"
    );
}

/// The synchronous commands: the names after a real `#[tauri::command]`
/// whose signature is a `fn` and not an `async fn`.
fn synchronous_commands(src: &str) -> BTreeSet<&str> {
    let mut out = BTreeSet::new();
    let mut after_attribute = false;
    for line in src.lines() {
        if is_prose(line) {
            continue;
        }
        let t = line.trim();
        if t.starts_with("#[tauri::command") {
            after_attribute = true;
            continue;
        }
        if !after_attribute || t.starts_with("#[") {
            continue;
        }
        after_attribute = false;
        let sig = without_visibility(t);
        if let Some(rest) = sig.strip_prefix("fn ") {
            let name = rest
                .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                .next()
                .expect("a name after `fn`");
            out.insert(name);
        }
    }
    out
}

#[test]
fn the_synchronous_extractor_skips_async_commands_and_prose() {
    let src = "\
// #[tauri::command]
// fn in_prose() {}
#[tauri::command]
async fn off_main(app: AppHandle) {}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn on_main(host: State<Host>) {}
#[tauri::command]
pub fn also_on_main() {}
#[tauri::command]
pub(crate) fn crate_on_main() {}
fn not_a_command() {}
";
    assert_eq!(
        synchronous_commands(src),
        BTreeSet::from(["on_main", "also_on_main", "crate_on_main"])
    );
}

#[test]
fn drawing_uses_only_named_typed_ports() {
    const DRAWING: &[&str] = &[
        "open_drawing",
        "drawing_sync",
        "drawing_gesture",
        "drawing_commands",
        "drawing_command",
        "close_drawing",
    ];
    let app = source();
    let ipc = include_str!("../../../apps/client/src/host/ipc.ts");
    for command in DRAWING {
        assert!(
            app.contains(&format!("fn {command}(")),
            "missing typed Tauri command `{command}`"
        );
        assert!(
            ipc.contains(&format!(">(\"{command}\"")),
            "client must invoke the typed drawing command `{command}`"
        );
    }
    assert!(
        !ipc.lines().any(|line| {
            let line = line.to_lowercase();
            line.contains("drawing") && line.contains("invoke_command")
        }),
        "the drawing must not tunnel through the generic invoke_command bridge"
    );
}

// ---------------------------------------------------------------------------
// Chi li chiama
// ---------------------------------------------------------------------------

/// **I comandi registrati che nella shell non invoca nessuno**, e la ragione per
/// cui restano.
///
/// L'allowlist qui sopra chiede *perché quel comando non poteva essere una view,
/// una query o un comando del registro*, e a quella domanda risponde una volta
/// sola, alla nascita. Non chiede la seconda, che invecchia da sé: **chi lo
/// chiama**. Un `Why::SuperficieDellApp` sta bene addosso a `open_vault`, che
/// la shell invoca a ogni avvio, e sta uguale addosso a un comando che nessuno
/// invoca più da quando il pannello che lo usava è diventato una view — o che
/// nessuno ha mai invocato. Superficie che nessuno attraversa resta superficie:
/// va mantenuta, documentata e sandboxata come le altre, e a M5 sarà
/// raggiungibile dal webview come tutte.
///
/// Questi due non sono una dimenticanza, e per questo stanno in un elenco invece
/// che in un `assert!(vuoto)`. La
/// [0029](../../../docs/decisions/0183-composizione-host-kernel.md)
/// li ha scritti così apposta e lo dice: *«i tre comandi ci sono (`list_vaults`,
/// `set_current_vault`, `close_vault`) e `main.ts` non ne chiama nessuno: la
/// finestra resta una, e apre un vault alla volta. È voluto — questa voce è la
/// metà backend, ed è quella che scadeva, perché è quella che ogni cliente
/// futuro avrebbe dovuto riscrivere. La metà shell è il §1.2 col modello di
/// layout e il `PaneId`»*. Sono la metà backend di una voce la cui metà shell è
/// in roadmap, non codice morto: toglierli sarebbe disfare una decisione presa.
/// Il terzo, `close_vault`, ha trovato il suo chiamante: al cambio di vault la
/// shell chiude nell'host quello che lascia.
///
/// Ciò che questa riga compra è che quella frase resti **vera**: il giorno che il
/// §1.2 arriva e la shell li chiama, questo test è rosso e l'elenco si accorcia;
/// il giorno che un altro comando perde il suo chiamante, questo test è rosso e
/// chi lo ha perso deve scrivere qui perché resta — o toglierlo.
const WITHOUT_CALLER: &[&str] = &["list_vaults", "set_current_vault"];

/// I nomi di comando che la shell invoca, letti da `apps/client/src`.
///
/// **Zona cieca dichiarata**: si riconosce `invoke("nome")` col nome
/// *letterale*, che è la sola forma che questa shell usa — chi costruisse il
/// nome (`invoke(`get_${x}`)`) non verrebbe visto, e il verso in cui il conto
/// sbaglia è quello che richiede di volerlo aggirare. Il presidio contro la
/// forma costruita esiste già e sta di là: l'allowlist è un elenco chiuso, e un
/// comando che la shell raggiunge senza nominarlo è comunque dichiarato lì.
///
/// Non distingue il codice dai test della shell, ed è voluto: `finto.ts` e
/// `shell.e2e.test.ts` sono la shell che si prova da sola, e un comando invocato
/// solo dal proprio doppio è comunque un comando che qualcuno in `apps/client/`
/// nomina. La domanda a cui questo elenco risponde è più grossolana e più
/// robusta di «lo usa la UI»: è «esiste una riga di shell che lo conosce».
fn invoked_by_shell() -> BTreeSet<String> {
    fn collect(dir: &std::path::Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir)
            .unwrap_or_else(|and| panic!("cannot read `{}`: {and}", dir.display()))
        {
            let entry = entry.expect("an entry in the shell folder");
            let path = entry.path();
            if path.is_dir() {
                collect(&path, out);
            } else if path.extension().is_some_and(|and| and == "ts") {
                out.push(
                    std::fs::read_to_string(&path)
                        .unwrap_or_else(|and| panic!("cannot read `{}`: {and}", path.display())),
                );
            }
        }
    }

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src");
    let mut sources = Vec::new();
    collect(&root, &mut sources);

    let mut names = BTreeSet::new();
    for text in &sources {
        // `invoke` seguito da un eventuale parametro di tipo, dalla parentesi e
        // dal nome fra virgolette. Il parametro di tipo può contenere di tutto
        // (`invoke<string | null>`), quindi si salta fino alla prima `(`.
        for (the, _) in text.match_indices("invoke") {
            let rest = &text[the + "invoke".len()..];
            let Some(open) = rest.find('(') else {
                continue;
            };
            // Fra `invoke` e la `(` ci può stare solo un parametro di tipo o
            // dello spazio: qualunque altra cosa e non è questa chiamata.
            let mid = &rest[..open];
            if !mid.trim().is_empty() && !(mid.trim().starts_with('<')) {
                continue;
            }
            let after = rest[open + 1..].trim_start();
            let Some(after) = after.strip_prefix('"') else {
                continue;
            };
            let Some(end) = after.find('"') else { continue };
            names.insert(after[..end].to_string());
        }
    }
    names
}

/// **Ogni comando IPC ha un chiamante nella shell, o è in un elenco che dice
/// perché no.**
///
/// È la metà che all'allowlist mancava, e la specie è quella di ogni presidio
/// che «assolve per nome»: una riga che dà il permesso senza mai richiedere la
/// ragione che quel permesso presupponeva. `Why::SuperficieDellApp` dice
/// perché il comando non è una view; non dice, e non può dire, che qualcuno lo
/// usi ancora.
///
/// Va rosso nei **due versi**, e il secondo conta quanto il primo: un elenco di
/// eccezioni che resta lungo mentre la shell cresce smette di essere una
/// fotografia e diventa un ricordo — la stessa disciplina di
/// [`ipc_surface_is_a_closed_list`].
#[test]
fn every_registered_command_has_a_caller_or_says_why_not() {
    let source = source();
    let registered = registered_commands(&source);
    let invoked = invoked_by_shell();

    // Il test del test: una camminata che non trova niente renderebbe la prima
    // asserzione vera per vacuità e la seconda rossa per la ragione sbagliata.
    // La shell invoca decine di comandi, e `open_vault` è quello che non può non
    // esserci — è la riga con cui un vault comincia a esistere.
    assert!(
        invoked.len() >= 20 && invoked.contains("open_vault"),
        "walking `apps/client/src` found {} invoked commands: this walk is not\n\
         looking at the shell, and what it says below means nothing",
        invoked.len()
    );

    let expected: BTreeSet<&str> = WITHOUT_CALLER.iter().copied().collect();
    let orphans: BTreeSet<&str> = registered
        .iter()
        .copied()
        .filter(|c| !invoked.contains(*c))
        .collect();

    let new: BTreeSet<&str> = orphans.difference(&expected).copied().collect();
    assert!(
        new.is_empty(),
        "no line of `apps/client/src` invokes anymore: {}\n\
         \nAn IPC command without a caller does not stop costing: it remains surface\n\
         to maintain, document, and sandbox, and at M5 it remains reachable from\n\
         the webview. The two answers are to remove the command from\n\
         `generate_handler!` — and then also from `ALLOWLIST`, which is a\n\
         photograph — or to write it in `WITHOUT_CALLER` with the decision that\n\
         says why it awaits a caller that has not yet arrived. The second wants a\n\
         decision to cite: if there is none, it is the first.",
        list(&new)
    );

    let arrived: BTreeSet<&str> = expected.difference(&orphans).copied().collect();
    assert!(
        arrived.is_empty(),
        "{} is in `WITHOUT_CALLER`, but the shell now invokes it.\n\
         Remove it from that list: it is a photograph, not a memory — and if it was\n\
         there for 0029, §1.2 has arrived and that is good news to write.",
        list(&arrived)
    );
}
