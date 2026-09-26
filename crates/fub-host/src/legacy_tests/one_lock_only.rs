//! **Un lucchetto solo, e la politica sta dentro** (decisione 0120).
//!
//! Il difetto osservabile era che un vault con la custodia avvelenata poteva
//! produrre risposte diverse fra host e colla Tauri. Questi test esercitano la
//! porta pubblica: ogni accesso rifiuta il vault, il messaggio resta stabile e
//! la diagnostica viene emessa una volta sola.
//!
//! Non si censiscono file, simboli o forme sintattiche. Un elenco del sorgente
//! diventa incompleto appena nasce un modulo e verifica il cablaggio del test,
//! non il comportamento che `Custody` promette ai chiamanti.

use camino::Utf8PathBuf;
use fub_host::{Custody, Host, NoWatcher};

// ---------------------------------------------------------------------------
// Il comportamento
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
    let ws = host.debug_workspace(None).expect("the current vault");
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
    let ws = host.debug_workspace(None).expect("the current vault");
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
    // ciò che dice di provare.
    let ws_a = host
        .debug_workspace(Some(root_a.as_str()))
        .expect("il primo");
    let ws_b = host
        .debug_workspace(Some(root_b.as_str()))
        .expect("il secondo");
    poison(&ws_a);

    assert!(ws_a.read().is_err(), "the first is dead");
    assert!(ws_b.read().is_ok(), "the second has nothing in it");
    assert_eq!(ws_b.reports(), 0);
}
