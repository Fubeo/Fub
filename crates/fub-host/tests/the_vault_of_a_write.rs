//! **In quale vault arriva una scrittura** (FUB-001).
//!
//! Le porte del documento accettano il vault a cui rivolgersi, e chi non lo dice
//! parla con il corrente. La shell le usa nel secondo modo da sempre, e il
//! passaggio da un vault all'altro è l'istante in cui le due risposte divergono:
//! il corrente è già B, e una scrittura di una nota aperta in A raggiunge la
//! nota omonima di B. Il confine che la shell ha adesso per non farlo è dire il
//! vault di partenza a ogni porta, e qui si prova che l'host lo rispetta: A
//! resta aperto e scrivibile per nome, B non viene toccato, e un vault che non è
//! più aperto rifiuta invece di ripiegare sul corrente.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_host::Host;

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    /// Un vault con una nota `Nota.md` che ha lo stesso contenuto in ogni vault:
    /// con la stessa revisione, il confronto della scrittura non distingue l'uno
    /// dall'altro, ed è proprio il caso che il solo CAS non protegge.
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        Vault { _dir: dir, root }
    }

    fn on_disk(&self) -> String {
        std::fs::read_to_string(self.root.join("Nota.md")).unwrap()
    }
}

fn host_with(config: &Utf8Path) -> Host {
    Host::without_watcher().with_config_dir(config)
}

fn config() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, path)
}

#[test]
fn a_write_that_names_its_vault_reaches_it_even_when_another_is_current() {
    let (_config_dir, config) = config();
    let host = host_with(&config);
    let (a, b) = (Vault::new(), Vault::new());
    host.open(&a.root).expect("opens A");
    host.open(&b.root).expect("opens B: ora è il corrente");
    let note = DocId::new("Nota.md");

    // Chi parte da A e lo dice: la modifica è di A.
    host.write_document(
        Some(a.root.as_str()),
        &note,
        "# Scritto in A\n",
        WriteBase::Dictated,
    )
    .expect("A è ancora aperto");

    assert_eq!(a.on_disk(), "# Scritto in A\n");
    assert_eq!(b.on_disk(), "# Nota\n", "B non si tocca");
    assert_eq!(
        host.read_document(Some(a.root.as_str()), &note).unwrap().0,
        "# Scritto in A\n"
    );
    assert_eq!(
        host.read_document(Some(b.root.as_str()), &note).unwrap().0,
        "# Nota\n"
    );
}

/// Il difetto, nella sua forma più semplice: la stessa scrittura senza il vault.
#[test]
fn the_same_write_without_a_vault_lands_in_the_current_one() {
    let (_config_dir, config) = config();
    let host = host_with(&config);
    let (a, b) = (Vault::new(), Vault::new());
    host.open(&a.root).expect("opens A");
    host.open(&b.root).expect("opens B");
    let note = DocId::new("Nota.md");

    host.write_document(
        None,
        &note,
        "# Scritto senza dire dove\n",
        WriteBase::Dictated,
    )
    .expect("il corrente è B");

    assert_eq!(a.on_disk(), "# Nota\n");
    assert_eq!(b.on_disk(), "# Scritto senza dire dove\n");
}

/// Con la revisione uguale in due vault il confronto non protegge nessuno: una
/// scrittura `descends_from` della revisione di A riesce anche in B, perché B
/// ha lo stesso contenuto. Per questo il vault si dice, e non si deduce.
#[test]
fn an_equal_revision_does_not_tell_the_two_vaults_apart() {
    let (_config_dir, config) = config();
    let host = host_with(&config);
    let (a, b) = (Vault::new(), Vault::new());
    host.open(&a.root).expect("opens A");
    host.open(&b.root).expect("opens B");
    let note = DocId::new("Nota.md");
    let (_, seen_in_a) = host.read_document(Some(a.root.as_str()), &note).unwrap();

    host.write_document(
        None,
        &note,
        "# Da A, in B\n",
        WriteBase::DescendsFrom(seen_in_a),
    )
    .expect("la base coincide: nessun conflitto");

    assert_eq!(b.on_disk(), "# Da A, in B\n");
    assert_eq!(a.on_disk(), "# Nota\n");
}

/// Un vault chiuso non ripiega sul corrente: l'host risponde con un errore e
/// non scrive in nessun posto.
#[test]
fn a_write_to_a_vault_that_is_no_longer_open_is_refused_and_writes_nothing() {
    let (_config_dir, config) = config();
    let host = host_with(&config);
    let (a, b) = (Vault::new(), Vault::new());
    host.open(&a.root).expect("opens A");
    host.open(&b.root).expect("opens B");
    host.close_vault(&a.root).expect("closes A");
    let note = DocId::new("Nota.md");

    let refused = host.write_document(
        Some(a.root.as_str()),
        &note,
        "# Dopo la chiusura\n",
        WriteBase::Dictated,
    );

    assert!(
        matches!(refused, Err(PluginError::NotFound(_))),
        "un vault chiuso non esiste per nome: {refused:?}"
    );
    assert_eq!(a.on_disk(), "# Nota\n");
    assert_eq!(b.on_disk(), "# Nota\n", "e B, il corrente, non lo riceve");
}
