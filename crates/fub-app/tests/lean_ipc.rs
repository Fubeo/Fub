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
//! Non è un test di comportamento: è un test sul **sorgente**. Legge
//! `src/lib.rs` con `include_str!` — che è anche ciò che lo fa ricompilare
//! quando quel file cambia — e ne estrae due insiemi che ricava per strade
//! indipendenti:
//!
//! 1. **i comandi definiti**, cioè i nomi di funzione che seguono un vero
//!    `#[tauri::command]`;
//! 2. **i comandi registrati**, cioè i nomi dentro `tauri::generate_handler!`.
//!
//! **Questo test giudica `lib.rs`, e la superficie IPC sta tutta lì** — e la
//! seconda metà di quella frase, che prima era una speranza, adesso è un
//! presidio. La zona cieca misurata dalla
//! [0106](../../../docs/decisions/0106-un-formato-si-presenta.md) era questa:
//! una seconda superficie IPC dichiarata in un altro file dello stesso crate e
//! montata con un `.plugin()` che porti il proprio `generate_handler!` passava
//! di qui **verde**, ed era raggiungibile dal webview come
//! `plugin:<nome>|<comando>`. La riparazione di allora fu un conto —
//! `files-with-ipc-surface` —, e un conto dice *quanti*, mai *quale*: chi lo
//! trova rosso ha davanti due riparazioni che si somigliano, togliere la
//! seconda superficie o **portare il numero a due**, e la seconda lascia il
//! difetto in piedi con la prosa aggiornata.
//!
//! Adesso il file che il test legge non è più una scelta del test: è
//! `walk_sources`, che apre la cartella `src/` e la guarda tutta
//! (`ipc_surface_lives_in_a_single_file`). **La superficie IPC di questo
//! crate è un file**, e un secondo file che ne dichiari una diventa rosso per
//! nome, con i comandi che ha dentro elencati. Il conto resta e non è un
//! doppione: guarda gli stessi file da fuori, con un `grep` che non condivide
//! niente con questo estrattore — se una forma sfugge a uno dei due, l'altra
//! metà del difetto la prende comunque. I file di `crates/fub-app/src` in cui
//! compare un `#[tauri::command]` o un `generate_handler!` sono
//! **uno** [conta: files-with-ipc-surface].
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

/// Il sorgente che questo test giudica. `include_str!` e non `std::fs`: così il
/// legame è una dipendenza di compilazione e non un path da tenere aggiornato a
/// mano — se il file si sposta, non compila.
const SOURCE: &str = include_str!("../src/lib.rs");

/// Il nome del file che porta la superficie, dentro `src/`.
const THE_FILE: &str = "lib.rs";

/// **Tutti** i sorgenti del crate, letti dal disco: `(nome, contenuto)`.
///
/// È l'unico posto di questo file che usa `std::fs` invece di `include_str!`, e
/// la ragione è precisamente il contrario di quella che vale per [`SOURCE`]:
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
    // cartella non sia quella. Le due righe qui sotto sono ciò che lo dice —
    // la seconda pretende che il file camminato sia **lo stesso byte per byte**
    // di quello che `include_str!` ha inglobato, cioè che questa camminata e il
    // resto del file stiano guardando lo stesso albero.
    let lib = out
        .iter()
        .find(|(name, _)| name == THE_FILE)
        .unwrap_or_else(|| {
            panic!(
                "walking `{}` does not find `{THE_FILE}`: this walk is looking\n\
                 at the wrong folder, and a guard that looks at the wrong folder\n\
                 always passes.",
                root.display()
            )
        });
    assert_eq!(
        lib.1, SOURCE,
        "the walked `{THE_FILE}` is not the one `include_str!` captured"
    );
    out
}

/// Il contratto, letto per una ragione sola: una riga dell'allowlist che dice
/// «questa è la capacità `X`» deve nominare una `X` che **esiste**.
///
/// È la sesta specie del §16.7 — la *garanzia dichiarata che non è mai esistita*
/// — presa dal verso in cui si può presidiare: una frase che rimanda a qualcosa
/// di meccanico deve rimandare a un nome che una macchina sa cercare.
const CONTRACT: &str = include_str!("../../fub-abi/src/traits.rs");

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
/// [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md): *un
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
    /// È la [decisione 0012](../../../docs/decisions/0012-origine-degli-eventi.md)
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
    /// ([0007](../../../docs/decisions/0007-contesto-di-sessione.md)), e `Intl` ce
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
    ("set_plugin_enabled", Why::AppSurface),
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
    // --- i tre ponti, in due metà ciascuno ----------------------------------
    ("list_views", Why::Bridge),
    ("render_view", Why::Bridge),
    ("view_action", Why::Bridge),
    ("list_commands", Why::Bridge),
    ("invoke_command", Why::Bridge),
    ("query_index", Why::Bridge),
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
    // --- vault organization (§11.3): writes without requester ---------------
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
    // [decisione 0163](../../../docs/decisions/0163-render-via-index-query.md)
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
/// e basta perché `src/lib.rs` non contiene nessun commento a blocco — cosa che
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
/// `ipc_surface_lives_in_a_single_file` cerca `generate_handler!` nudo negli
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

        let sig = t.strip_prefix("pub ").unwrap_or(t);
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
        "in `src/lib.rs` the `{OPENING}` blocks are {}, and exactly one is required:\n\
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
    let defined = defined_commands(SOURCE);
    let registered = registered_commands(SOURCE);

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
        "these names are in `generate_handler!` and are not defined in this file:\n  \
         {}\n\
         (It should not compile: if you are here, the extractor misread.)",
        list(&ghosts)
    );
}

/// **La superficie IPC di questo crate è un file, e questo lo prova.**
///
/// È la riparazione della zona cieca che la 0106 ha dichiarato leggendo questo
/// presidio: tutti gli altri banchi di questo file giudicano `lib.rs`, e un
/// `#[tauri::command]` scritto in un altro file del crate — montato con un
/// `.plugin()` che porti il proprio `generate_handler!` — passava di là verde
/// ed era raggiungibile dal webview.
///
/// La forma non è «leggi anche il secondo file»: quella sarebbe l'elenco a mano
/// una riga più lunga, e il terzo file resterebbe fuori. È **la cartella**, e
/// quello che dice è una regola: da qui si entra da un posto solo. Un secondo
/// file con dei comandi non si dichiara, si toglie — o, se davvero non si può,
/// si toglie questa regola sapendo di toglierla, che è il costo giusto.
#[test]
fn ipc_surface_lives_in_a_single_file() {
    let mut culprits: Vec<String> = Vec::new();
    for (name, text) in walk_sources() {
        if name == THE_FILE {
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
        "in `crates/fub-app/src` there is an IPC surface outside `{THE_FILE}`:\n  {}\n\
         None of the other benches of this file sees it — they read `{THE_FILE}` —\n\
         and from the webview a command mounted with a `.plugin()` is called anyway,\n\
         as `plugin:<name>|<command>`. The surface of this crate is **one** file:\n\
         either that command returns to `{THE_FILE}` and passes through the\n\
         allowlist, or it is not an IPC command.",
        culprits.join("\n  ")
    );
}

/// **Il cuore**: la superficie registrata è l'allowlist, nei due versi.
#[test]
fn ipc_surface_is_a_closed_list() {
    let registered = registered_commands(SOURCE);
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
    for (command, why) in ALLOWLIST {
        let Why::ContractCapability(capability) = why else {
            continue;
        };
        let (trt, method) = capability.split_once("::").unwrap_or_else(|| {
            panic!("`{command}`: `{capability}` is not in the form `Trait::method`")
        });

        let opening = format!("pub trait {trt}");
        let start = CONTRACT
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
        let found = CONTRACT
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
    for (n, line) in SOURCE.lines().enumerate() {
        assert!(
            !line.contains("/*"),
            "line {}: `src/lib.rs` has a block comment, and `is_prose` can only skip\n\
             line comments. Either the comment becomes `//`, or the extractor learns\n\
             blocks.",
            n + 1
        );
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
fn real(host: State<Host>) -> bool { true }\n\
\n\
    // #[tauri::command]\n\
    // fn commented_out() {}\n\
\n\
#[tauri::command]\n\
#[allow(clippy::too_many_arguments)]\n\
pub fn with_an_attribute_in_between() {}\n\
\n\
        .invoke_handler(tauri::generate_handler![\n\
            real,\n\
            // i_do_not_exist,\n\
            with_an_attribute_in_between,\n\
        ])\n";

    let expected = BTreeSet::from(["real", "with_an_attribute_in_between"]);
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
/// stringa diversa da `ipc_surface_lives_in_a_single_file`, che negli altri
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

/// E deve fermarsi su ciò che non capisce, invece di far sparire un comando.
#[test]
#[should_panic(expected = "after `#[tauri::command]` there is no `fn`")]
fn extractor_rejects_what_it_cannot_read() {
    defined_commands("#[tauri::command]\nstruct SomethingNew;\n");
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
/// Questi tre non sono una dimenticanza, e per questo stanno in un elenco invece
/// che in un `assert!(vuoto)`. La
/// [0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)
/// li ha scritti così apposta e lo dice: *«i tre comandi ci sono (`list_vaults`,
/// `set_current_vault`, `close_vault`) e `main.ts` non ne chiama nessuno: la
/// finestra resta una, e apre un vault alla volta. È voluto — questa voce è la
/// metà backend, ed è quella che scadeva, perché è quella che ogni cliente
/// futuro avrebbe dovuto riscrivere. La metà shell è il §1.2 col modello di
/// layout e il `PaneId`»*. Sono la metà backend di una voce la cui metà shell è
/// in roadmap, non codice morto: toglierli sarebbe disfare una decisione presa.
///
/// Ciò che questa riga compra è che quella frase resti **vera**: il giorno che il
/// §1.2 arriva e la shell li chiama, questo test è rosso e l'elenco si accorcia;
/// il giorno che un quarto comando perde il suo chiamante, questo test è rosso e
/// chi lo ha perso deve scrivere qui perché resta — o toglierlo.
const WITHOUT_CALLER: &[&str] = &["close_vault", "list_vaults", "set_current_vault"];

/// I nomi di comando che la shell invoca, letti da `frontend/src`.
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
/// solo dal proprio doppio è comunque un comando che qualcuno in `frontend/`
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

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src");
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
    let registered = registered_commands(SOURCE);
    let invoked = invoked_by_shell();

    // Il test del test: una camminata che non trova niente renderebbe la prima
    // asserzione vera per vacuità e la seconda rossa per la ragione sbagliata.
    // La shell invoca decine di comandi, e `open_vault` è quello che non può non
    // esserci — è la riga con cui un vault comincia a esistere.
    assert!(
        invoked.len() >= 20 && invoked.contains("open_vault"),
        "walking `frontend/src` found {} invoked commands: this walk is not\n\
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
        "no line of `frontend/src` invokes anymore: {}\n\
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
