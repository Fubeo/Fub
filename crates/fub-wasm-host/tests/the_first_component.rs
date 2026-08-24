//! **Il primo componente WASM che si monta, vive e si smonta.**
//!
//! È il gemello di `crates/fub-host/tests/il_primo_plugin.rs`: stesso vault,
//! stesso banco, stesso job, stesse asserzioni. Ciò che cambia è una riga sola
//! — là il bundle è una `struct` Rust, qui è un `.wasm` — e il fatto che tutto
//! il resto NON cambi è ciò che il test prova. Il §16.1 dice «un trait, due
//! backend»; questi due file, letti uno accanto all'altro, sono la frase in
//! forma eseguibile.
//!
//! # Il componente lo compila il test
//!
//! `esempi/ping-wasm` sta fuori dal workspace e si compila per
//! `wasm32-wasip2`. Il test invoca `cargo` da sé invece di cercare un artefatto
//! che qualcun altro dovrebbe aver prodotto: un test che si salta da solo
//! quando il file non c'è è un test che un giorno non gira più e nessuno se ne
//! accorge. Se il bersaglio manca, il fallimento dice come installarlo.

mod common;

use std::sync::Arc;
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::event::Event;
use fub_abi::options::permission;
use fub_abi::traits::JobSpec;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust};
use fub_wasm_host::WasmBundle;

const ID: &str = "demo.ping";

// --- il banco ---------------------------------------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        Vault { _dir: dir, root }
    }
}

/// Un host headless col vault aperto e il componente montato.
fn bench(v: &Vault, permissions: bool) -> (Host, Subscription) {
    bench_component(v, if permissions { "" } else { "senza-permessi" })
}

fn bench_component(v: &Vault, variant: &str) -> (Host, Subscription) {
    let wasm = common::ping(variant);
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(&bundle, &mut ws)
            .expect("il bundle si monta");
    })
    .expect("aperto");
    (host, events)
}

fn ask(host: &Host, job: &str) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

fn next_result(events: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
    let expiration = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < expiration {
        if let Ok(notice) = events.recv_timeout(Duration::from_millis(200)) {
            if let Event::JobDone { job, result, .. } = notice.event {
                return (job, result);
            }
        }
    }
    panic!("nessun job è mai tornato: la coda non la drena nessuno");
}

// --- le prove ---------------------------------------------------------------

/// Il giro intero, su un backend che il kernel non sa di avere: montare, vedere
/// il manifest nell'inventario, far girare un job che legge il vault, smontare.
#[test]
fn a_component_wasm_is_mounts_lives_and_is_unmounts() {
    let v = Vault::new();
    let (host, events) = bench(&v, true);

    // Montato: il plugin è nell'inventario del §7.6 con ciò che il **manifest
    // del componente** ha dichiarato, non ciò che un file accanto diceva di lui.
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let info = ws
            .plugins()
            .into_iter()
            .find(|p| p.id == ID)
            .expect("il componente è nell'inventario del §7.6");
        assert!(
            info.permissions.enabled(permission::READ_VAULT),
            "il manifest del `.wasm` dichiara `read-vault` e l'inventario lo mostra"
        );
        assert!(
            s.bundles().read().unwrap().ids().contains(&ID),
            "il registry possiede il bundle"
        );
    })
    .expect("aperto");

    // Il job gira sul pool vero, dentro l'istanza WASM, e torna con l'esito:
    // ha letto la nota **attraverso il confine**.
    ask(&host, "ping");
    let (job, result) = next_result(&events);
    assert_eq!(job, "ping");
    let value = result.expect("il job è riuscito");
    assert_eq!(value["nota"], "Nota.md");
    assert!(
        value["caratteri"].as_u64().unwrap() > 0,
        "il job ha letto davvero: {value}"
    );
    // `acceso` è la traccia che l'attivazione ha lasciato dentro il componente:
    // il diario del plugin nativo, nell'unica forma che attraversa un confine.
    assert!(
        value["acceso"].as_u64().unwrap() > 0,
        "`activate` è stato chiamato e l'orologio ha risposto: {value}"
    );

    // Un job che non esiste è `UnknownJob`, e il nome è quello chiesto: un
    // errore del contratto tradotto dal WIT, non un trap.
    ask(&host, "non-esiste");
    let (_, result) = next_result(&events);
    let error = result.expect_err("an unknown job does not succeed");
    assert!(
        matches!(&error, PluginError::UnknownJob(t)
            if t.as_literal() == Some("non-esiste")),
        "it is an unknown job, with its name: {error}"
    );

    // Smontato: `deactivate` è passato dal confine e il registry non lo ha più.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errors = s.bundles().write().unwrap().unmount(&mut ws, ID);
        assert!(errors.is_empty(), "niente è andato storto: {errors:?}");
        assert!(
            !s.bundles().read().unwrap().ids().contains(&ID),
            "il registry non possiede più il bundle"
        );
    })
    .expect("aperto");

    host.close();
}

/// Il cancello del §7.3 davanti a un componente: **lo stesso** `.wasm`, con un
/// manifest che non chiede `read-vault`, si monta lo stesso — e la sua prima
/// lettura riceve `PermissionDenied`.
///
/// Che il rifiuto arrivi al componente come **valore** e non come trap è metà
/// del punto: l'istanza è ancora viva dopo, e il job torna con un errore che si
/// legge invece che con un'istanza abbattuta.
#[test]
fn a_component_without_the_permission_sees_close_the_gate() {
    let v = Vault::new();
    let (host, events) = bench(&v, false);

    ask(&host, "ping");
    let (job, result) = next_result(&events);
    assert_eq!(job, "ping");
    let error = result.expect_err("without `read-vault` the ping cannot read");
    assert!(
        matches!(&error, PluginError::PermissionDenied(t)
            if t.as_literal().is_some_and(|m| m.contains("non ha dichiarato il permesso"))),
        "it is the permission gate, and the message is the kernel's: {error}"
    );

    host.close();
}

/// **Un componente che chiede una famiglia non servita non si monta**, e il
/// messaggio la nomina.
///
/// È il prezzo dichiarato del linker per interfaccia (vedi il modulo `ospite`):
/// l'elenco delle famiglie servite è dichiarato (`FAMIGLIE_SERVITE`), e chi ne
/// importa una che non ci sta
/// lo scopre al caricamento invece che a metà lavoro. Il componente di prova è
/// lo stesso ping, compilato contro un mondo che importa anche
/// `fub:abi/host-network`.
#[test]
fn a_family_not_served_is_does_name() {
    let wasm = common::ping("con-rete");
    let error = WasmBundle::from_file(&wasm, Trust::Community)
        .expect_err("una famiglia non servita non si carica");
    let said = error.to_string();
    assert!(
        said.contains("host-network"),
        "il rifiuto nomina la famiglia che manca: {said}"
    );
}

/// Le due famiglie host-data fanno round-trip e tengono la cache separata.
#[test]
fn a_component_with_data_families_round_trips() {
    let v = Vault::new();
    let (host, events) = bench_component(&v, "con-dati");

    ask(&host, "dati");
    let (job, result) = next_result(&events);
    assert_eq!(job, "dati");
    assert_eq!(
        result.expect("il round-trip dei dati riesce"),
        serde_json::json!({
            "write_read": true,
            "list_ordered": true,
            "cache_round_trip": true,
            "cache_separate": true,
        })
    );

    host.close();
}

/// Il tipo del prestito deve poter attraversare i thread: un job gira sul pool.
/// Se un giorno smettesse, questo test non compilerebbe più.
#[test]
fn the_bundle_crosses_the_thread() {
    fn asserts_send_sync<T: Send + Sync>() {}
    asserts_send_sync::<WasmBundle>();
    asserts_send_sync::<Arc<dyn fub_abi::traits::Plugin>>();
}
