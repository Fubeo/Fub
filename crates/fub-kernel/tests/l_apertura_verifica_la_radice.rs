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
use fub_kernel::storage::{FsStorage, MemStorage, VaultStorage};
use fub_kernel::{FormatRegistry, KernelError, Vault, Workspace};

/// Il `kind` dell'errore che l'apertura ha rifiutato, e la radice che diceva.
fn specie(e: &KernelError) -> (std::io::ErrorKind, &str) {
    match e {
        KernelError::RadiceInvalida { path, source } => (source.kind(), path.as_str()),
        altro => panic!("non è un rifiuto della radice: {altro:?}"),
    }
}

/// **Una radice che non esiste è un errore all'ingresso, non alla prima
/// operazione.**
#[test]
fn una_radice_che_non_esiste_viene_rifiutata_subito() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let mancante =
        Utf8PathBuf::from_path_buf(tmp.path().join("non-esiste").to_path_buf()).expect("utf8");

    let e = Vault::open(&mancante)
        .err()
        .expect("una radice inesistente non si apre");
    let (kind, path) = specie(&e);
    assert_eq!(kind, std::io::ErrorKind::NotFound, "{e:?}");
    assert_eq!(path, mancante.as_str(), "l'errore nomina la radice scelta");
}

/// **Una radice che è un file non è una cartella: rifiuto subito.**
#[test]
fn una_radice_che_e_un_file_viene_rifiutata_subito() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let file = tmp.path().join("non-sono-una-cartella.md");
    std::fs::write(&file, "sono un file").expect("semina");
    let file = Utf8PathBuf::from_path_buf(file).expect("utf8");

    let e = Vault::open(&file).err().expect("un file non è una radice");
    let (kind, path) = specie(&e);
    assert_eq!(kind, std::io::ErrorKind::NotADirectory, "{e:?}");
    assert_eq!(path, file.as_str(), "l'errore nomina la radice scelta");
}

/// **Una radice su cui non si ha permesso di scrittura è un errore subito.**
///
/// Il test non legge i bit di permesso: li toglie davvero (0o500), e pretende
/// che l'apertura provi a scrivere e ci si scontri. Chi gira da root scrive
/// comunque su una cartella 0500 — è la definizione di root — e il caso
/// «permesso negato» non è dimostrabile: lo dice la stessa prova, non un
/// elenco di utenti.
#[test]
fn una_radice_senza_permesso_di_scrittura_viene_rifiutata() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).expect("utf8");
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o500))
        .expect("permesso tolto");

    // Da root la scrittura su 0500 riesce lo stesso: se riesce, il banco non
    // può dimostrare il rifiuto e si salta, ripristinando il permesso.
    let sonda = root.join(".fub-prova-root");
    if std::fs::write(&sonda, b"").is_ok() {
        let _ = std::fs::remove_file(&sonda);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .expect("permesso restituito");
        eprintln!("si salta: questo utente scrive anche su una cartella 0500");
        return;
    }

    let e = Vault::open(&root)
        .err()
        .expect("una radice non scrivibile non si apre");
    let (kind, path) = specie(&e);
    assert_eq!(kind, std::io::ErrorKind::PermissionDenied, "{e:?}");
    assert_eq!(path, root.as_str(), "l'errore nomina la radice scelta");

    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
        .expect("permesso restituito per la pulizia");
}

/// **La via del workspace eredita il rifiuto**: chi monta un workspace su una
/// radice impossibile fallisce al montaggio, non alla prima scrittura.
#[test]
fn la_via_del_workspace_rifiuta_anche_lei() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let mancante = Utf8PathBuf::from_path_buf(tmp.path().join("via-del-workspace").to_path_buf())
        .expect("utf8");

    let e = Workspace::new(&mancante, FormatRegistry::new())
        .err()
        .expect("il montaggio non si apre su una radice inesistente");
    let (kind, _) = specie(&e);
    assert_eq!(kind, std::io::ErrorKind::NotFound, "{e:?}");
}

/// **Una radice vera si apre, e l'apertura non lascia tracce della prova.**
#[test]
fn una_radice_vera_si_apre_senza_lasciare_la_prova() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).expect("utf8");

    Vault::open(&root).expect("una radice vera si apre");
    let residui: Vec<_> = std::fs::read_dir(&root)
        .expect("elenco")
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".fub-prova"))
        .collect();
    assert!(
        residui.is_empty(),
        "la prova di scrittura ha lasciato un file: {residui:?}"
    );
}

/// **Il mondo in memoria ha il suo default, dichiarato**: una radice che sta
/// per nascere è legittima (le cartelle nascono alla prima scrittura), una
/// radice che è un file no.
#[test]
fn il_mondo_in_memoria_accetta_una_radice_che_sta_per_nascere_e_rifiuta_un_file() {
    let storage = Arc::new(MemStorage::new());
    let nascente = Utf8PathBuf::from("/vault-nascente");

    let vault = Vault::on(&nascente, Arc::clone(&storage) as Arc<dyn VaultStorage>)
        .expect("un vault in memoria su una radice nascente si apre");
    assert_eq!(vault.root(), nascente.as_str());

    // Una radice che è un file è impossibile anche in memoria.
    let occupato = Utf8PathBuf::from("/occupato-da-un-file");
    VaultStorage::write(&*storage, &occupato, b"sono un file").expect("semina del file");
    let e = Vault::on(&occupato, Arc::clone(&storage) as Arc<dyn VaultStorage>)
        .err()
        .expect("un file non è una radice nemmeno in memoria");
    let (kind, _) = specie(&e);
    assert_eq!(kind, std::io::ErrorKind::NotADirectory, "{e:?}");
}
