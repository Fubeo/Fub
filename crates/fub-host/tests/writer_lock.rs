//! Un vault ha uno scrittore alla volta, fra processi.
//!
//! Il lock lo prende l'apertura dell'host e lo lascia la chiusura: le shell non
//! ne tengono uno loro. Due `Host` nello stesso processo sono due scrittori come
//! due processi, perché il lock è un `flock` per descrizione di file aperto e
//! ciascun host apre la sua: è ciò che permette di provarlo qui senza lanciare
//! un binario.
//!
//! Prima il lock stava in `.fub/` e lo prendevano le shell: la demo si apriva
//! senza, e uno snapshot applicato o un azzeramento della demo cambiavano
//! l'inode del file, così un secondo scrittore otteneva un lock «nuovo» mentre
//! il primo credeva di tenere ancora il vecchio.

use std::collections::BTreeMap;
use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;
use fub_host::automation::{is_writer_busy, writer_lock_path};
use fub_host::{Host, SnapshotHostError};
use fub_kernel::snapshot::SnapshotBundle;

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8 root");
    fs::create_dir(&root).expect("vault root");
    fs::write(root.join("nota.md"), b"prima").expect("nota");
    let root = root.canonicalize_utf8().expect("canonical root");
    (dir, root)
}

fn busy(error: &PluginError) {
    assert!(
        is_writer_busy(error),
        "atteso «scrittore occupato», non {error:?}"
    );
}

/// L'apertura rifiutata, con il perché che il test si aspetta.
fn refused(result: Result<fub_host::VaultInfo, PluginError>, why: &str) -> PluginError {
    match result {
        Err(error) => error,
        Ok(_) => panic!("{why}: l'apertura è riuscita"),
    }
}

#[test]
fn a_second_writer_is_refused_until_the_first_closes() {
    let (_dir, root) = vault();
    let first = Host::without_watcher();
    first.open(&root).expect("il primo apre");

    let second = Host::without_watcher();
    busy(&refused(
        second.open(&root),
        "il vault ha già uno scrittore",
    ));
    // Riaprirlo nello stesso host non è un secondo scrittore.
    first.open(&root).expect("lo stesso host lo riapre");

    assert!(first.close().is_empty());
    second
        .open(&root)
        .expect("chiuso il primo, il vault è libero");
    assert!(second.close().is_empty());
}

/// Per chi lo porta alla shell il rifiuto è una frase, non una chiave: sul
/// filo JSON un `Text` non risolto sarebbe un oggetto, e la shell mostrerebbe
/// `[object Object]` invece del perché.
#[test]
fn the_refusal_reaches_the_shell_as_a_sentence() {
    let (_dir, root) = vault();
    let first = Host::without_watcher();
    first.open(&root).expect("il primo apre");

    let second = Host::without_watcher();
    let error = refused(second.open(&root), "il vault ha già uno scrittore");
    busy(&error);
    let shown = second.localized_error(None, error);
    let PluginError::Conflict(text) = &shown else {
        panic!("atteso un conflitto, non {shown:?}");
    };
    let sentence = text.as_literal().expect("una frase, non una chiave");
    assert!(sentence.contains(root.as_str()), "{sentence}");
    let wire = serde_json::to_value(&shown).expect("serializza");
    assert!(wire["message"].is_string(), "sul filo: {wire}");
    assert!(first.close().is_empty());
}

#[test]
fn closing_a_vault_releases_it_while_the_host_lives() {
    let (_dir, root) = vault();
    let first = Host::without_watcher();
    first.open(&root).expect("apre");
    assert!(first.close_vault(&root).expect("chiude").is_empty());

    let second = Host::without_watcher();
    second
        .open(&root)
        .expect("il vault chiuso non è più di nessuno");
    busy(&refused(first.open(&root), "adesso lo tiene il secondo"));
    assert!(second.close().is_empty());
}

#[test]
fn the_lock_lives_beside_the_vault_not_inside_it() {
    let (_dir, root) = vault();
    let host = Host::without_watcher();
    host.open(&root).expect("apre");
    let lock = writer_lock_path(root.as_std_path()).expect("path del lock");
    assert_eq!(lock.parent(), root.as_std_path().parent());
    assert!(lock.is_file(), "il lock c'è: {}", lock.display());
    assert!(!root.join(".fub/automation-writer.lock").exists());
    assert!(host.close().is_empty());
}

fn retarget(base: &SnapshotBundle, desired: &SnapshotBundle) -> SnapshotBundle {
    let files = desired
        .manifest()
        .entries
        .iter()
        .map(|entry| {
            (
                entry.path.clone(),
                desired.bytes(&entry.path).expect("byte").to_vec(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    SnapshotBundle::new(
        desired.manifest().clone(),
        base.base_revision().clone(),
        files,
    )
    .expect("snapshot")
}

/// Lo snapshot che nel frattempo dice «dopo» al posto di «prima».
fn snapshot_to_after(root: &Utf8Path) -> SnapshotBundle {
    let base = SnapshotBundle::capture(root).expect("base");
    fs::write(root.join("nota.md"), b"dopo").expect("nota");
    let desired = SnapshotBundle::capture(root).expect("desiderato");
    fs::write(root.join("nota.md"), b"prima").expect("nota");
    retarget(&base, &desired)
}

#[test]
fn an_applied_snapshot_keeps_the_writer() {
    let (_dir, root) = vault();
    let target = snapshot_to_after(&root);
    let host = Host::without_watcher();
    host.apply_snapshot(&root, &target)
        .expect("applica e riapre");
    host.wait_indexed(None).expect("indicizza");
    assert_eq!(fs::read(root.join("nota.md")).expect("nota"), b"dopo");

    // La radice è stata sostituita con una rename: il lock no.
    let other = Host::without_watcher();
    busy(&refused(
        other.open(&root),
        "il vault riaperto ha ancora lo scrittore",
    ));
    assert!(host.close().is_empty());
}

#[test]
fn a_snapshot_is_not_applied_under_another_writer() {
    let (_dir, root) = vault();
    let target = snapshot_to_after(&root);
    let other = Host::without_watcher();
    other.open(&root).expect("un altro scrittore");

    let host = Host::without_watcher();
    match host.apply_snapshot(&root, &target) {
        Err(SnapshotHostError::Lifecycle(error)) => busy(&error),
        other => panic!("atteso un rifiuto prima di toccare il disco, non {other:?}"),
    }
    assert_eq!(fs::read(root.join("nota.md")).expect("nota"), b"prima");
    assert!(other.close().is_empty());
}

#[test]
fn the_demo_is_a_vault_like_the_others() {
    let config = tempfile::tempdir().expect("config");
    let config = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).expect("utf8");
    let app = Host::without_watcher();
    let opened = fub_host::support::open_demo(&app, Some(&config)).expect("la demo si apre");
    let demo = Utf8PathBuf::from(opened.root);

    // Aperta, ha il suo scrittore come ogni vault.
    let cli = Host::without_watcher();
    busy(&refused(cli.open(&demo), "la demo aperta ha uno scrittore"));
    // E chi non la tiene non la azzera sotto a chi la tiene.
    busy(&fub_host::support::reset_demo(&cli, &config).expect_err("azzerarla è scriverci"));
    assert!(
        demo.join(".fub-demo.json").is_file(),
        "il rifiuto non ha cancellato niente"
    );

    // Chi la tiene la azzera e la riapre: lo scrittore resta uno.
    fub_host::support::reset_demo(&app, &config).expect("azzera");
    fub_host::support::open_demo(&app, Some(&config)).expect("riapre");
    busy(&refused(
        cli.open(&demo),
        "la demo riaperta ha ancora uno scrittore",
    ));
    assert!(app.close().is_empty());
}
