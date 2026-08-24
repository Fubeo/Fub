//! **Aprire un vault verifica la radice, subito** (difetto 0160).
//!
//! Prima, l'apertura non chiedeva niente: [`Vault::open`] e [`Vault::on`]
//! accettavano una radice che non esiste, che è un file invece di una cartella
//! o su cui non si ha permesso di scrittura, e l'errore arrivava solo alla
//! prima operazione che toccava il disco — a giro avanzato, con eventi già
//! emessi e un'interfaccia che aveva già mostrato un vault aperto.
//!
//! Qui si prova che il rifiuto è **all'ingresso**: il costruttore fallisce, e
//! fallisce dicendo perché. La specie del guasto è nel `kind` dell'errore —
//! `NotFound` per un posto che non c'è, `NotADirectory` per un posto che non è
//! una cartella, `PermissionDenied` per un posto su cui non si può scrivere —
//! ed è su quella specie che la traduzione verso il contratto decide la faccia
//! da mostrare.
//!
//! Il banco è sul disco vero ([`FsStorage`]) per i tre rifiuti: è il mondo in
//! cui chi apre può sbagliare radice. Il mondo in memoria ([`MemStorage`]) ha
//! un default diverso e dichiarato — una radice mancante è un vault che sta
//! per nascere, una radice che è un file è un vault che non può stare — e
//! l'ultimo banco lo fissa, così la deroga non può regredire in silenzio.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_kernel::storage::{MemStorage, VaultStorage};
use fub_kernel::{FormatRegistry, KernelError, Vault, Workspace};

fn fixture_root(name: &str) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(std::env::current_dir().expect("current dir"))
        .expect("current dir is UTF-8")
        .join(name)
}

/// Il `kind` dell'errore che l'apertura ha rifiutato, e la radice che diceva.
fn kind(and: &KernelError) -> (std::io::ErrorKind, &str) {
    match and {
        KernelError::InvalidRoot { path, source } => (source.kind(), path.as_str()),
        other => panic!("non è un rifiuto della radice: {other:?}"),
    }
}

/// **Una radice che non esiste è un errore all'ingresso, non alla prima
/// operazione.**
#[test]
fn a_root_that_not_exists_becomes_rejected_immediately() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let missing =
        Utf8PathBuf::from_path_buf(tmp.path().join("non-esiste").to_path_buf()).expect("utf8");

    let and = Vault::open(&missing)
        .err()
        .expect("una radice inesistente non si apre");
    let (kind, path) = kind(&and);
    assert_eq!(kind, std::io::ErrorKind::NotFound, "{and:?}");
    assert_eq!(path, missing.as_str(), "l'errore nomina la radice scelta");
}

/// **Una radice che è un file non è una cartella: rifiuto subito.**
#[test]
fn a_root_that_and_a_file_becomes_rejected_immediately() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let file = tmp.path().join("non-sono-una-cartella.md");
    std::fs::write(&file, "sono un file").expect("semina");
    let file = Utf8PathBuf::from_path_buf(file).expect("utf8");

    let and = Vault::open(&file).err().expect("un file non è una radice");
    let (kind, path) = kind(&and);
    assert_eq!(kind, std::io::ErrorKind::NotADirectory, "{and:?}");
    assert_eq!(path, file.as_str(), "l'errore nomina la radice scelta");
}

/// **Una radice su cui non si ha permesso di scrittura è un errore subito.**
///
/// Il test non legge i bit di permesso: li toglie davvero (0o500), e pretende
/// che l'apertura provi a scrivere e ci si scontri. Chi gira da root scrive
/// comunque su una cartella 0500 — è la definizione di root — e il caso
/// «permesso negato» non è dimostrabile: lo dice la stessa prova, non un
/// elenco di utenti.
#[cfg(unix)]
#[test]
fn a_root_without_permission_of_write_becomes_rejected() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).expect("utf8");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o500))
        .expect("permesso tolto");

    // Da root la scrittura su 0500 riesce lo stesso: se riesce, il banco non
    // può dimostrare il rifiuto e si salta, ripristinando il permesso.
    let probe = root.join(".fub-prova-root");
    if std::fs::write(&probe, b"").is_ok() {
        let _ = std::fs::remove_file(&probe);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .expect("permesso restituito");
        eprintln!("si salta: questo utente scrive anche su una cartella 0500");
        return;
    }

    let and = Vault::open(&root)
        .err()
        .expect("una radice non scrivibile non si apre");
    let (kind, path) = kind(&and);
    assert_eq!(kind, std::io::ErrorKind::PermissionDenied, "{and:?}");
    assert_eq!(path, root.as_str(), "l'errore nomina la radice scelta");

    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
        .expect("permesso restituito per la pulizia");
}

/// **La via del workspace eredita il rifiuto**: chi monta un workspace su una
/// radice impossibile fallisce al montaggio, non alla prima scrittura.
#[test]
fn the_path_of_the_workspace_rejects_too() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let missing = Utf8PathBuf::from_path_buf(tmp.path().join("via-del-workspace").to_path_buf())
        .expect("utf8");

    let and = Workspace::new(&missing, FormatRegistry::new())
        .err()
        .expect("il montaggio non si apre su una radice inesistente");
    let (kind, _) = kind(&and);
    assert_eq!(kind, std::io::ErrorKind::NotFound, "{and:?}");
}

/// **Una radice vera si apre, e l'apertura non lascia tracce della prova.**
#[test]
fn a_root_real_is_opens_without_leave_the_proof() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).expect("utf8");

    Vault::open(&root).expect("una radice vera si apre");
    let leftovers: Vec<_> = std::fs::read_dir(&root)
        .expect("elenco")
        .filter_map(|and| and.ok())
        .filter(|and| and.file_name().to_string_lossy().contains(".fub-prova"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "la prova di scrittura ha lasciato un file: {leftovers:?}"
    );
}

/// **Il mondo in memoria ha il suo default, dichiarato**: una radice che sta
/// per nascere è legittima (le cartelle nascono alla prima scrittura), una
/// radice che è un file no.
#[test]
fn the_in_memory_world_accepts_a_root_that_is_for_birth_and_rejects_a_file() {
    let storage = Arc::new(MemStorage::new());
    let nascent = fixture_root("vault-nascente");

    let vault = Vault::on(&nascent, Arc::clone(&storage) as Arc<dyn VaultStorage>)
        .expect("un vault in memoria su una radice nascente si apre");
    assert_eq!(vault.root(), nascent.as_str());

    // Una radice che è un file è impossibile anche in memoria.
    let occupied = fixture_root("occupato-da-un-file");
    VaultStorage::write(&*storage, &occupied, b"sono un file").expect("semina del file");
    let and = Vault::on(&occupied, Arc::clone(&storage) as Arc<dyn VaultStorage>)
        .err()
        .expect("un file non è una radice nemmeno in memoria");
    let (kind, _) = kind(&and);
    assert_eq!(kind, std::io::ErrorKind::NotADirectory, "{and:?}");
}
