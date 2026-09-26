//! **Più ganci prima della scrittura, uno per owner.**
//!
//! Il gancio era uno solo: registrarne un secondo rendeva `RegistrationPhase`,
//! e la seconda feature che voleva guardare il contenuto prima del disco doveva
//! togliere il posto alla prima. Qui si prova la forma nuova: ogni owner ne
//! tiene al più uno, girano nell'ordine di registrazione con l'host intestato a
//! chi li ha registrati, il primo rifiuto ferma la scrittura e i ganci dopo di
//! lui, e chi smette porta via soltanto il proprio.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::traits::{PluginManifest, PluginPermissions};
use fub_kernel::workspace::BeforeWriteHook;
use fub_kernel::{FormatRegistry, RegistryError, Trust, Workspace};
use fub_testkit::SampleText;

// --- il banco ---------------------------------------------------------------

/// Cosa un gancio ha visto: il suo owner e se l'host gli ha lasciato leggere il
/// documento che sta per cambiare.
type Seen = Arc<Mutex<Vec<(&'static str, bool)>>>;

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("a.txt"), "prima").unwrap();
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("txt").boxed())
        .expect("format");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    // `test.one` legge il vault, `test.two` no: il gancio di ognuno deve
    // ricevere le capacità del proprio owner, non quelle di chi gira prima.
    declare(&mut ws, "test.one", PluginPermissions::core());
    declare(&mut ws, "test.two", PluginPermissions::of(&[]));
    ws.reindex().expect("scan");
    (dir, ws)
}

fn declare(ws: &mut Workspace, id: &str, permissions: PluginPermissions) {
    ws.register_plugin(
        PluginManifest::new(id, id).granting(permissions),
        Trust::Community,
    )
    .expect("declared");
}

/// Un gancio che annota il proprio owner e poi risponde `outcome`.
fn hook(
    owner: &'static str,
    seen: &Seen,
    outcome: Result<(), PluginError>,
) -> Option<BeforeWriteHook> {
    let seen = Arc::clone(seen);
    Some(Arc::new(move |host, id: &DocId| {
        let readable = host.read_document(id).is_ok();
        seen.lock().unwrap().push((owner, readable));
        outcome.clone()
    }))
}

fn register(ws: &mut Workspace, owner: &str, mut hook: Option<BeforeWriteHook>) {
    let permit = ws.registration_permit(owner).expect("declared");
    ws.commit_before_write_hook(&permit, &mut hook)
        .expect("the hook is published");
}

fn seen(log: &Seen) -> Vec<(&'static str, bool)> {
    log.lock().unwrap().clone()
}

fn doc() -> DocId {
    DocId::new("a.txt")
}

// --- le prove ---------------------------------------------------------------

/// Due owner, due ganci: girano entrambi, nell'ordine in cui si sono
/// registrati, e ognuno con l'host intestato a sé.
#[test]
fn the_hooks_run_in_registration_order_each_with_its_owner() {
    let (_dir, mut ws) = vault();
    let log = Seen::default();
    register(&mut ws, "test.one", hook("test.one", &log, Ok(())));
    register(&mut ws, "test.two", hook("test.two", &log, Ok(())));

    ws.write_document(&doc(), "dopo", WriteBase::Dictated)
        .expect("both hooks accept");

    assert_eq!(
        seen(&log),
        vec![("test.one", true), ("test.two", false)],
        "registration order, and each hook reads with its own owner's permissions"
    );
    assert_eq!(ws.read_source(&doc()).expect("read"), "dopo");
}

/// Il primo rifiuto ferma la scrittura: il disco non cambia e il gancio dopo
/// di lui non viene chiamato.
#[test]
fn the_first_refusal_stops_the_write_and_the_hooks_after_it() {
    let (_dir, mut ws) = vault();
    let log = Seen::default();
    register(
        &mut ws,
        "test.one",
        hook(
            "test.one",
            &log,
            Err(PluginError::Internal("no snapshot".into())),
        ),
    );
    register(&mut ws, "test.two", hook("test.two", &log, Ok(())));

    ws.write_document(&doc(), "dopo", WriteBase::Dictated)
        .expect_err("a refused hook refuses the write");

    assert_eq!(
        seen(&log),
        vec![("test.one", true)],
        "the hook after the refusal is not called"
    );
    assert_eq!(
        ws.read_source(&doc()).expect("read"),
        "prima",
        "the source on disk is untouched"
    );
}

/// Un owner tiene un gancio solo: il secondo è rifiutato, resta a chi l'ha
/// portato e non prende il posto del primo.
#[test]
fn an_owner_holds_one_hook() {
    let (_dir, mut ws) = vault();
    let log = Seen::default();
    register(&mut ws, "test.one", hook("test.one", &log, Ok(())));

    let permit = ws.registration_permit("test.one").expect("declared");
    let mut second = hook("test.one", &log, Err(PluginError::Internal("x".into())));
    let error = ws
        .commit_before_write_hook(&permit, &mut second)
        .expect_err("one hook per owner");
    assert!(matches!(error, RegistryError::RegistrationPhase(owner) if owner == "test.one"));
    assert!(second.is_some(), "the refused hook stays with its caller");

    ws.write_document(&doc(), "dopo", WriteBase::Dictated)
        .expect("the first hook is still the one that runs");
    assert_eq!(seen(&log), vec![("test.one", true)]);
}

/// Chi smette porta via il proprio gancio e lascia quello degli altri.
#[test]
fn retiring_an_owner_keeps_the_other_hooks() {
    let (_dir, mut ws) = vault();
    let log = Seen::default();
    register(&mut ws, "test.one", hook("test.one", &log, Ok(())));
    register(&mut ws, "test.two", hook("test.two", &log, Ok(())));

    ws.deactivate_plugin("test.one").expect("deactivated");
    ws.write_document(&doc(), "dopo", WriteBase::Dictated)
        .expect("the remaining hook accepts");

    assert_eq!(seen(&log), vec![("test.two", false)]);
}
