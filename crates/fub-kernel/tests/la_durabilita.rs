//! Cosa promette una scrittura del supporto (§15.2), e i due casi in cui la
//! promessa si rifiuta di pagare il suo prezzo.
//!
//! Sta in un file suo e **solo su `FsStorage`**, e non è una preferenza di
//! organizzazione: temp+rename+fsync è una proprietà che esiste solo su un
//! filesystem vero, e il compagno di questo file — `il_supporto.rs` — gira lo
//! stesso giro sui due supporti. Presidiare la durabilità là vorrebbe dire
//! chiedere a un supporto in memoria di modellare un crash, cioè renderla verde
//! dove non c'è niente a cui sopravvivere.
//!
//! Cosa questi test **non** possono presidiare, e va detto perché non si venga a
//! cercarlo: che dopo un crash vero il file sia intero. Servirebbe un crash
//! vero. Quello che si può presidiare è ogni passo osservabile che compone la
//! proprietà — il temporaneo che non resta indietro, l'inode che cambia solo
//! quando è lecito, i permessi che sopravvivono — e la parte non osservabile
//! (`sync_all`) resta una riga letta in review.

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::storage::{FsStorage, VaultStorage};

fn banco() -> (tempfile::TempDir, Utf8PathBuf) {
    let tmp = tempfile::tempdir().expect("cartella temporanea");
    let root = Utf8Path::from_path(tmp.path())
        .expect("path UTF-8")
        .to_owned();
    (tmp, root)
}

/// Il temporaneo non sopravvive alla scrittura, né quando va bene né quando la
/// destinazione c'era già.
///
/// Un temporaneo dimenticato dentro un vault non è sporcizia: è un file che
/// nessuno ha scritto e che al prossimo riavvio qualcuno potrebbe leggere.
#[test]
fn una_scrittura_non_lascia_niente_dietro_di_se() {
    let (_tmp, root) = banco();
    let storage = FsStorage;
    let nota = root.join("note/Idea.md");

    storage.write(&nota, b"prima").unwrap();
    storage.write(&nota, b"seconda").unwrap();

    let rimasti: Vec<String> = storage
        .list(&root.join("note"))
        .unwrap()
        .iter()
        .map(|v| v.path.file_name().unwrap_or_default().to_string())
        .collect();
    assert_eq!(rimasti, vec!["Idea.md"], "il temporaneo se n'è andato");
    assert_eq!(storage.read(&nota).unwrap(), b"seconda");
}

/// Il prezzo dichiarato, e il presidio che dice che lo stiamo pagando davvero:
/// riscrivere una nota **sostituisce il file**, non il suo contenuto.
///
/// Vale la pena presidiare ciò che si è scelto di pagare quanto ciò che si è
/// scelto di risparmiare: se un giorno questo diventasse rosso vorrebbe dire che
/// la scrittura è tornata sul posto — e con lei il file troncato.
#[cfg(unix)]
#[test]
fn riscrivere_una_nota_ne_sostituisce_il_file() {
    use std::os::unix::fs::MetadataExt;

    let (_tmp, root) = banco();
    let nota = root.join("Idea.md");
    FsStorage.write(&nota, b"prima").unwrap();
    let prima = std::fs::metadata(&nota).unwrap().ino();

    FsStorage.write(&nota, b"seconda").unwrap();
    assert_ne!(
        std::fs::metadata(&nota).unwrap().ino(),
        prima,
        "l'atomicità si compra con una rename, e una rename cambia inode"
    );
}

/// Un collegamento **non** si sostituisce: la nota vera sta dall'altra parte, e
/// una rename la scollegherebbe in silenzio a ogni salvataggio.
#[cfg(unix)]
#[test]
fn un_collegamento_riceve_i_byte_invece_di_essere_rimpiazzato() {
    let (_tmp, root) = banco();
    let vera = root.join("altrove/Vera.md");
    FsStorage.write(&vera, b"prima").unwrap();
    let collegata = root.join("Collegata.md");
    std::os::unix::fs::symlink(&vera, &collegata).unwrap();

    FsStorage.write(&collegata, b"seconda").unwrap();

    assert!(
        std::fs::symlink_metadata(&collegata)
            .unwrap()
            .file_type()
            .is_symlink(),
        "il collegamento è ancora un collegamento"
    );
    assert_eq!(
        std::fs::read(&vera).unwrap(),
        b"seconda",
        "e i byte sono arrivati al file vero"
    );
}

/// Un file con due nomi resta **un** file: una rename ne staccherebbe uno solo,
/// e l'altro resterebbe fermo al contenuto di prima senza che nessuno lo sappia.
#[cfg(unix)]
#[test]
fn un_file_con_due_nomi_non_si_sdoppia() {
    use std::os::unix::fs::MetadataExt;

    let (_tmp, root) = banco();
    let uno = root.join("Uno.md");
    let due = root.join("Due.md");
    FsStorage.write(&uno, b"prima").unwrap();
    std::fs::hard_link(&uno, &due).unwrap();

    FsStorage.write(&uno, b"seconda").unwrap();

    assert_eq!(
        std::fs::read(&due).unwrap(),
        b"seconda",
        "l'altro nome vede la scrittura"
    );
    assert_eq!(
        std::fs::metadata(&uno).unwrap().nlink(),
        2,
        "e i nomi sono ancora due"
    );
}

/// I permessi sono del file, non della umask di chi salva.
///
/// Senza questa riga, un salvataggio trasformerebbe un `600` in un `644`: una
/// nota che l'utente aveva chiuso, riaperta a tutta la macchina da un'operazione
/// che nessuno ha chiesto.
#[cfg(unix)]
#[test]
fn i_permessi_di_una_nota_sopravvivono_al_salvataggio() {
    use std::os::unix::fs::PermissionsExt;

    let (_tmp, root) = banco();
    let nota = root.join("Riservata.md");
    FsStorage.write(&nota, b"prima").unwrap();
    std::fs::set_permissions(&nota, std::fs::Permissions::from_mode(0o600)).unwrap();

    FsStorage.write(&nota, b"seconda").unwrap();

    assert_eq!(
        std::fs::metadata(&nota).unwrap().permissions().mode() & 0o777,
        0o600,
        "il file nuovo eredita i permessi di quello che sostituisce"
    );
}

/// I file di `.fub/` passano dal supporto, e ci passano **davvero**.
///
/// È la casella residua della [0064]: `workspace.json`, `settings.json` del
/// vault e `entries.json` scrivevano con `write_atomic`, cioè avevano già la
/// proprietà che il supporto non prometteva. Adesso il supporto la promette, e
/// loro ci sono salite. Il presidio è lo stesso di
/// `un_vault_intero_su_un_supporto_che_non_e_il_disco`: un `std::fs` rimasto
/// dentro uno dei tre non fa fallire nessun test di conformità del trait, fa
/// fallire questo — perché lì sotto il disco non c'è. Il terzo, l'anagrafe, è
/// `pub(crate)` e ha lo stesso presidio dentro il suo modulo.
#[test]
fn i_file_di_fub_passano_dal_supporto() {
    use fub_kernel::storage::MemStorage;
    use std::sync::Arc;

    let storage = Arc::new(MemStorage::new());
    let root = Utf8Path::new("/vault");

    // L'organizzazione (§11.3).
    let (org, avviso) =
        fub_kernel::OrganizationStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
    assert!(avviso.is_none(), "{avviso:?}");
    org.set_icon("a.md", Some("📌".into())).unwrap();
    assert!(
        storage.exists(&root.join(".fub/workspace.json")),
        "il sidecar dell'organizzazione è finito sul supporto"
    );

    // La configurazione del vault (§11.1).
    let mut settings = fub_kernel::SettingsStore::open(
        root,
        Arc::clone(&storage) as Arc<dyn VaultStorage>,
        fub_kernel::MachineSettings::in_memory(),
    );
    settings
        .declare(
            "prova",
            &[fub_abi::settings::SettingSpec::toggle(
                "prova.acceso",
                "Acceso",
                false,
            )],
        )
        .unwrap();
    settings
        .set(
            "prova.acceso",
            fub_abi::settings::SettingValue::Toggle(true),
        )
        .unwrap();
    assert!(
        storage.exists(&root.join(".fub/settings.json")),
        "la configurazione del vault è finita sul supporto"
    );

    // Nessuno dei due ha toccato il disco: le radici in memoria sono assolute,
    // e se un `std::fs` fosse rimasto avrebbe scritto in `/vault`.
    assert!(
        !std::path::Path::new("/vault").exists(),
        "e nessuno dei due ha scritto sul filesystem vero"
    );
}
