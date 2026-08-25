//! **Un lucchetto solo, e la politica sta dentro** (decisione 0120).
//!
//! Il difetto che questo banco presidia non era un panico: era che alla stessa
//! domanda — *cosa si fa quando questo lucchetto è avvelenato?* — l'host e la
//! colla Tauri rispondevano in due modi, e un terzo posto ne aveva un terzo.
//! Una riparazione che sostituisse N `unwrap` con N `expect` avrebbe lasciato
//! la domanda aperta per l'`unwrap` numero N+1. La riparazione è una porta:
//! [`fub_host::Custody`].
//!
//! Il banco è in **due parti**, e ne servono due perché guardano due cose che
//! si rompono separatamente.
//!
//! 1. Il **conto sul sorgente**: un `Mutex`/`RwLock` nudo fuori dalla porta è
//!    un lucchetto senza politica, e vuole una riga con la sua ragione.
//! 2. Il **comportamento**: un vault avvelenato risponde di no, lo fa *tutte*
//!    le volte, e lo dice **una** volta.
//!
//! # La zona cieca, misurata addosso
//!
//! `Custody::read` restituisce un `Result`, e su un `Result` si può scrivere
//! `.unwrap()`. Non è un'ipotesi: è successo **scrivendo questa decisione**. La
//! sostituzione automatica su `crates/fub-app/src/lib.rs` non aveva agganciato
//! (indentazione diversa da quella cercata), il crate ha continuato a compilare
//! **verde** con quattordici `.unwrap()` addosso alla porta nuova, e nessun
//! errore del compilatore lo ha detto — perché non c'era niente di sbagliato da
//! dire: `Result::unwrap` è legittimo.
//!
//! Quindi il conto ne guarda **due** cose e non una: il tipo nudo, e l'`unwrap`
//! sulla risposta della porta dentro il codice di produzione. Il secondo è ciò
//! che il compilatore non può vedere, ed è esattamente il caso che è sfuggito.
//!
//! Ciò che questo banco **non** vede, dichiarato: i lucchetti degli altri
//! crate. `fub-kernel`, `fub-features` e `fub-sdk` ne hanno di propri — sono
//! **nove** file [conta: lucchetti-fuori-dal-conto] —, e la politica di questa
//! decisione non li ha attraversati: il difetto misurato era il confine
//! host↔app, e allargare un conto oltre ciò che si è deciso vorrebbe dire
//! un'allowlist lunga come l'elenco che dovrebbe restringere. La
//! [0126](../../../docs/decisions/0184-eventi-accodati-e-job.md)
//! ha riguardato la domanda e ha risposto di nuovo di no, con la ragione più
//! forte: una politica del veleno si **riderivano** da cosa il lucchetto
//! protegge, quindi trapiantare qui la `Custody` importerebbe la risposta
//! dell'host in un posto dove nessuna delle sue giustificazioni vale.
//!
//! Il numero però c'è, ed è la sola cosa che è cambiata: prima questa frase
//! nominava tre crate e nessuna quantità. Una zona cieca senza numero è
//! indistinguibile da una che cresce — il file che ci entra domani non fa
//! rumore da nessuna parte, e non c'è niente da cui accorgersene. Contarla non

use std::collections::{BTreeMap, BTreeSet};

use camino::Utf8PathBuf;
use fub_host::{Custody, Host, NoWatcher};

// ---------------------------------------------------------------------------
// 1. Il conto sul sorgente
// ---------------------------------------------------------------------------

/// **Perché quel lucchetto sta fuori dalla porta.**
///
/// Due ragioni e non di più: se nessuna delle due si applica, la risposta non è
/// inventarne una terza — è che quel dato va in una [`Custody`].
#[derive(Debug, PartialEq, Eq)]
enum Why {
    /// **Una condizione ha bisogno del suo `Mutex`.** [`std::sync::Condvar`] è
    /// definita su `MutexGuard` e su niente altro: `wait` restituisce la stessa
    /// guardia che ha ricevuto, e una porta che consegnasse una guardia di un
    /// `RwLock` non potrebbe metterla in attesa.
    ///
    /// Il dato protetto è un `bool` che dice «ha finito», e ci si arriva **una
    /// volta** all'apertura: un panico che lo avvelenasse lascerebbe dietro di
    /// sé un `bool`, cioè niente da rendere incredibile. È il caso in cui la
    Condition,
    /// **Serializza dei test, e non protegge niente.** Le variabili d'ambiente
    /// sono globali al processo: il lucchetto mette in fila due test, e ciò che
    /// «protegge» è il processo stesso. Qui `into_inner` è la risposta giusta —
    /// ed è la terza risposta che il difetto (9) aveva trovato in giro, rimasta
    /// dov'era perché lì era vera.
    TestOnly,
}

/// I lucchetti nudi che restano, e perché.
///
/// La chiave è `file:symbol`. Si controlla in **tutte e due le direzioni**: uno
/// che compare e non è qui è rosso, e una riga che non corrisponde più a niente
/// è rossa anche lei — un'allowlist che resta lunga mentre il codice si
/// accorcia smette di essere una fotografia e diventa un ricordo.
fn allowed_locks() -> BTreeMap<&'static str, Why> {
    BTreeMap::from([
        ("src/runner.rs:Mutex", Why::Condition),
        ("src/session.rs:Mutex", Why::Condition),
        ("src/config.rs:Mutex", Why::TestOnly),
    ])
}

/// I sorgenti che il conto giudica. `include_str!` e non `std::fs`: così il
/// legame è una dipendenza di compilazione e non un path da tenere aggiornato a
/// mano — se un file si sposta, questo banco non compila.
///
/// `src/net.rs` è qui e si legge **sempre**, anche in un montaggio che spegne
/// `http-client`: `include_str!` non ha `#[cfg]`, e il verso in cui questo
/// sbaglia è quello giusto — il conto guarda di più, non di meno. Un `#[cfg]`
/// sull'elenco avrebbe fatto l'opposto, cioè un file che sparisce dal presidio
/// esattamente nella build in cui nessuno lo compila.
const SOURCES: &[(&str, &str)] = &[
    ("src/lib.rs", include_str!("../src/lib.rs")),
    ("src/session.rs", include_str!("../src/session.rs")),
    ("src/runner.rs", include_str!("../src/runner.rs")),
    ("src/watcher.rs", include_str!("../src/watcher.rs")),
    ("src/jobs.rs", include_str!("../src/jobs.rs")),
    ("src/mount.rs", include_str!("../src/mount.rs")),
    ("src/vaults.rs", include_str!("../src/vaults.rs")),
    ("src/config.rs", include_str!("../src/config.rs")),
    ("src/registry.rs", include_str!("../src/registry.rs")),
    ("src/bridge.rs", include_str!("../src/bridge.rs")),
    ("src/settings.rs", include_str!("../src/settings.rs")),
    ("src/theme.rs", include_str!("../src/theme.rs")),
    ("src/records.rs", include_str!("../src/records.rs")),
    ("src/shell.rs", include_str!("../src/shell.rs")),
    ("src/wall.rs", include_str!("../src/wall.rs")),
    ("src/net.rs", include_str!("../src/net.rs")),
    ("app/src/lib.rs", include_str!("../../fub-app/src/lib.rs")),
    ("app/src/main.rs", include_str!("../../fub-app/src/main.rs")),
];

/// **La porta**, e l'unico file che il conto non legge.
///
/// La ragione è che il lucchetto della [`Custody`] è *il* lucchetto con la
/// politica: leggerlo qui vorrebbe dire pretendere una riga di `allowed_locks()` per
/// la risposta stessa, cioè chiedere alla porta di giustificarsi davanti al
/// conto che esiste per mandarci la gente.
///
/// Fin qui questa costante si chiamava `FUORI_FEATURE` e assolveva **due** file
/// dicendo che stavano «dietro una cargo feature spenta di default», e non era
/// vero per nessuno dei due. `pub mod custody;` in `lib.rs` è incondizionato:
/// nessuna feature lo ha mai spento, e la ragione per cui sta fuori è
/// **strutturale**, non di packaging. `net.rs` sta dietro `http-client`, che è
/// nel `default` del `Cargo.toml` — cioè acceso in ogni build che nessuno abbia
/// spento a mano —, quindi è codice di produzione compilato di norma, ed è
/// passato in fondo a `SORGENTI`. Era la forma peggiore delle due: non un
/// numero invecchiato ma una **ragione che non è mai stata vera**, e che
/// leggendola faceva sembrare guardato un file che nessuno guardava.
const THE_CARRIES: &[&str] = &["custody.rs"];

/// Le righe di **codice** di un sorgente: la prosa si salta sempre, i banchi
/// solo quando la domanda li riguarda.
///
/// Che un commento non sia codice è la trappola misurata da `lean_ipc.rs` — in
/// un repo in cui i file spiegano sé stessi, un `grep` ingenuo conta le
/// spiegazioni.
///
/// Che i banchi si saltino o no dipende dalla domanda, e le due qui sono
/// diverse. *«Esiste un lucchetto senza politica?»* vale anche in un banco: un
/// `Mutex` costruito a mano in un `#[cfg(test)]` è comunque un secondo posto in
/// cui la politica non c'è, e va dichiarato. *«Qualcuno srotola la risposta
/// della porta?»* no: un test che scrive `.unwrap()` su un `Result` sta dicendo
/// «qui non deve fallire», che è ciò che un test fa di mestiere.
///
/// Il taglio presuppone che il modulo di test stia **in fondo**, che è come
/// sono scritti i file di questo crate; se un giorno non lo fosse, il conto
fn source_code(file_path: &str, skips_the_benches: bool) -> Vec<(usize, &str)> {
    let end = match skips_the_benches {
        true => file_path
            .find("\n#[cfg(test)]\n")
            .unwrap_or(file_path.len()),
        false => file_path.len(),
    };
    file_path[..end]
        .lines()
        .enumerate()
        .map(|(n, line)| (n + 1, line.trim()))
        .filter(|(_, line)| !line.starts_with("//"))
        .collect()
}

/// **Un lucchetto nudo fuori dalla porta vuole una ragione.**
#[test]
fn no_lock_without_policy() {
    let allowed = allowed_locks();
    let mut found: BTreeSet<String> = BTreeSet::new();
    for (file, file_path) in SOURCES {
        for (n, line) in source_code(file_path, false) {
            for symbol in ["Mutex", "RwLock"] {
                if line.contains(&format!("{symbol}<")) || line.contains(&format!("{symbol}::")) {
                    let key = format!("{file}:{symbol}");
                    assert!(
                        allowed.contains_key(key.as_str()),
                        "{file}:{n} takes a `{symbol}` by hand:\n    {line}\n\
                         Poison policy lives in `Custody` (decision 0120), and a lock outside
                         it is the second answer to the same question. If it truly cannot be a
                         `Custody`, the line goes in `allowed_locks()` with its reason."
                    );
                    found.insert(key);
                }
            }
        }
    }
    let expired: Vec<_> = allowed.keys().filter(|k| !found.contains(**k)).collect();
    assert!(
        expired.is_empty(),
        "these `allowed_locks()` lines no longer match anything: {expired:?} — an allowlist
         that stays long while the code shrinks is a memory, not a photograph"
    );
}

/// **Nessuno srotola la risposta della porta.**
///
/// È la zona cieca misurata addosso: `Custody::read` rende un `Result`, e un
/// `.unwrap()` su quel `Result` rimette in piedi esattamente il panico a ogni
/// IPC che la decisione toglie — col compilatore d'accordo, perché non c'è
/// niente di illegale da segnalare.
#[test]
fn no_one_unroll_the_response_of_the_carries() {
    for (file, file_path) in SOURCES {
        for (n, line) in source_code(file_path, true) {
            let unroll = ["read().unwrap()", "write().unwrap()"]
                .iter()
                .any(|p| line.contains(p))
                || (line.contains(".read().expect(") || line.contains(".write().expect("));
            assert!(
                !unroll,
                "{file}:{n} unwraps the door's response:\n    {line}\n\
                 An `unwrap` here is the panic on every call that decision 0120 removes:
                 the caller's signature already carries `PluginError`, and the answer is `?`."
            );
        }
    }
}

/// Le cartelle che `SORGENTI` dice di coprire, come prefisso e come path.
///
/// Sono **due** perché `SORGENTI` nomina due crate, e questa costante esiste
/// perché il conto le derivi invece di ricordarsene una sola: prima la
/// passeggiata guardava `crates/fub-host/src` e basta, mentre l'elenco
/// dichiarava anche `app/src/lib.rs`. La metà taciuta era vacua per il difetto
/// che il primo conto cerca — `fub-app` non ha lucchetti nudi — e **non** per il
/// difetto che questa passeggiata cerca: `crates/fub-app/src/main.rs` c'era già,
/// non era in `SORGENTI`, e nessuno lo diceva. Sei righe di `main`, quindi
/// niente di rotto; ma la cosa che qui si presidia non è il contenuto di quel
/// file, è che il **prossimo** entri in rumore e non in silenzio.
const FOLDERS: &[(&str, &str)] = &[("src", "src"), ("app/src", "../fub-app/src")];

/// **Il conto guarda tutte le cartelle che dice di guardare**, o dice quale file
/// gli è sfuggito.
///
/// È la lezione di `lean_ipc.rs`: un presidio che legge un elenco di file sa
/// quell'elenco, e un file nuovo entra in silenzio. Qui l'elenco lo si
/// confronta con le cartelle vere.
///
/// Che sia rosso davvero si prova **togliendo** una riga da `SORGENTI`, non
/// aggiungendo un file: un elenco che dice «questi sono tutti» sbaglia per
/// difetto, e un caso in più non tocca il verso in cui sbaglia.
#[test]
fn every_file_and_watched() {
    let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut missing = Vec::new();
    for (prefix, folder) in FOLDERS {
        let dir = root.join(folder);
        for entry in std::fs::read_dir(&dir).expect("la cartella dei sorgenti") {
            let entry = entry.expect("una voce");
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".rs") || THE_CARRIES.contains(&name.as_str()) {
                continue;
            }
            let expected = format!("{prefix}/{name}");
            if !SOURCES.iter().any(|(f, _)| *f == expected) {
                missing.push(expected);
            }
        }
    }
    assert!(
        missing.is_empty(),
        "these sources were born after the count and nobody watches them: {missing:?}"
    );
}

// ---------------------------------------------------------------------------
// 2. Il comportamento
// ---------------------------------------------------------------------------

/// Un vault vero, aperto come lo apre l'app meno il rilevatore.
fn vault() -> (tempfile::TempDir, Host, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("nota.md"), "hello\n").expect("semina");
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("apertura");
    let root = host.current().expect("just opened is current");
    (dir, host, root)
}

/// Avvelena il workspace del vault corrente come lo avvelena la vita: un thread
/// che pania **tenendo il prestito esclusivo**.
///
/// L'hook dei panici si mette a tacere per la durata del misfatto: un panico di
/// proposito che stampa la sua traccia fa sembrare rotto un banco verde, e chi
/// legge l'output smette di fidarsi di tutti gli altri.
fn poison(ws: &Custody<fub_kernel::Workspace>) {
    let copy = ws.clone();
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let _ = std::thread::spawn(move || {
        let _g = copy.write().expect("alive before the misdeed");
        panic!("a provider halfway through a write");
    })
    .join();
    std::panic::set_hook(hook);
}

/// **Ciò che l'utente vede la prima volta, e ciò che vede le volte dopo.**
///
/// Prima della 0120 questo test non sarebbe fallito: avrebbe **abortito il
/// thread del banco**, che è la stessa cosa che l'app faceva a ogni `invoke`.
#[test]
fn a_vault_poisoned_responds_of_no_a_every_call() {
    let (_dir, host, _root) = vault();
    let ws = host.workspace(None).expect("the current vault");
    poison(&ws);

    // Dieci chiamate, come dieci IPC di fila: nessuna pania, tutte rispondono.
    for pass in 0..10 {
        let outcome = host.in_session(None, |s| Ok(s.workspace().read()?.documents().len()));
        let err = outcome.expect_err("pass {pass}: a dead vault does not respond with data");
        let phrase = err.to_string();
        assert!(
            phrase.contains("irrecuperabile"),
            "pass {pass}: the message does not say what happened: {phrase}"
        );
        assert!(
            phrase.contains("riavvia"),
            "pass {pass}: the message does not say what to do: {phrase}"
        );
        assert!(
            phrase.contains("disco"),
            "pass {pass}: the message does not say what was NOT lost: {phrase}"
        );
    }

    // E la riga di diagnosi è **una**: la metà del difetto (9) era che nessuno
    // dicesse perché; l'altra metà sarebbe stata dirlo venti volte.
    assert_eq!(
        ws.reports(),
        1,
        "twenty refused borrows and only one line written"
    );
}

/// **Chiudere un vault avvelenato non pania: dice cosa non ha potuto chiudere.**
///
/// È il caso in cui l'irrecuperabilità incontra una firma che un canale ce l'ha
/// già — `close_vault` rende ciò che è andato storto chiudendo — e la risposta
/// è metterci dentro anche questo, invece di inventare un secondo canale.
#[test]
fn close_a_vault_poisoned_the_says_instead_of_panic() {
    let (_dir, host, root) = vault();
    let ws = host.workspace(None).expect("the current vault");
    poison(&ws);

    let issues = host.close_vault(&root).expect("the session still exists");
    assert!(
        issues
            .iter()
            .any(|g| g.to_string().contains("irrecuperabile")),
        "the closer did not know the vault was dead: {issues:?}"
    );
    assert!(
        host.vaults().is_empty(),
        "and the vault left the map anyway: staying would be a vault
         unreachable and never closed"
    );
}

/// **Due vault sono due stati.** Il veleno è del dato, non del processo: un
/// secondo vault aperto continua a rispondere.
#[test]
fn the_poison_of_a_vault_not_touches_the_other() {
    let (_dir_a, host, root_a) = vault();
    let dir_b = tempfile::tempdir().expect("tempdir");
    let root_b = Utf8PathBuf::from_path_buf(dir_b.path().to_path_buf()).expect("utf8");
    std::fs::write(root_b.join("altra.md"), "hello\n").expect("semina");
    host.open(&root_b).expect("secondo vault");

    // Nominati, e non presi per posizione: `vaults()` ordina per path, e un
    // banco che si fidasse dell'ordine proverebbe una volta su due l'opposto di
    let ws_a = host.workspace(Some(root_a.as_str())).expect("il primo");
    let ws_b = host.workspace(Some(root_b.as_str())).expect("il secondo");
    poison(&ws_a);

    assert!(ws_a.read().is_err(), "the first is dead");
    assert!(ws_b.read().is_ok(), "the second has nothing in it");
    assert_eq!(ws_b.reports(), 0);
}
