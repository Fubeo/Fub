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

// --- l'aggiornamento, che non è una scrittura -------------------------------
//
// Ciò che segue non presidia più la scrittura di **un file** ma la fusione di un
// **aggiornamento**: due installazioni di Fub sulla stessa cartella di
// configurazione, e nessuna delle due che cancella le chiavi dell'altra
// ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)).
//
// Due istanze aperte sullo stesso path **sono** il caso, e non una sua imitazione
// approssimata: ognuna ha letto il file una volta e da lì tiene la propria copia
// in memoria, che è esattamente ciò che distingue due processi da due chiamate.
// Un test scritto con una sola istanza presidierebbe il caso che già non
// esisteva, perché dentro un processo il livello macchina è uno solo.

fn chiave(nome: &str) -> fub_abi::settings::SettingSpec {
    fub_abi::settings::SettingSpec::toggle(nome, nome, false).per_machine()
}

/// Un'installazione con la sua copia in memoria del livello macchina: è ciò che
/// un secondo processo ha, e un secondo `MachineSettings` sullo stesso path lo
/// riproduce senza bisogno di un secondo processo.
fn installazione(path: &Utf8Path, chiavi: &[&str]) -> fub_kernel::SettingsStore {
    use std::sync::Arc;

    let (machine, avviso) = fub_kernel::MachineSettings::open(path);
    assert!(avviso.is_none(), "{avviso:?}");
    let mut store = fub_kernel::SettingsStore::open(
        Utf8Path::new("/vault"),
        Arc::new(fub_kernel::storage::MemStorage::new()) as Arc<dyn VaultStorage>,
        machine,
    );
    let specs: Vec<_> = chiavi.iter().map(|k| chiave(k)).collect();
    store.declare("prova", &specs).unwrap();
    store
}

/// La *lost update*: la seconda installazione che salva **non** cancella la
/// chiave che la prima ha scritto dopo che lei aveva letto.
///
/// L'ordine dei tre passi è il difetto: entrambe leggono, poi entrambe scrivono.
/// Prima della 0066 la seconda scriveva un file integro contenente solo la
/// propria chiave, e la prima non aveva modo di accorgersene — il file era
/// valido, l'unica cosa persa era il suo contenuto.
#[test]
fn due_installazioni_non_si_cancellano_le_chiavi() {
    use fub_abi::settings::SettingValue;

    let (_tmp, root) = banco();
    let path = root.join("settings.json");

    // Le due leggono **prima** che l'altra scriva: è il presupposto del caso.
    let mut prima = installazione(&path, &["a.uno", "a.due"]);
    let mut seconda = installazione(&path, &["a.uno", "a.due"]);

    prima.set("a.uno", SettingValue::Toggle(true)).unwrap();
    seconda.set("a.due", SettingValue::Toggle(true)).unwrap();

    let terza = installazione(&path, &["a.uno", "a.due"]);
    assert_eq!(
        terza.effective("a.uno").unwrap().0,
        SettingValue::Toggle(true),
        "la chiave della prima è sopravvissuta al salvataggio della seconda"
    );
    assert_eq!(
        terza.effective("a.due").unwrap().0,
        SettingValue::Toggle(true),
        "e quella della seconda c'è"
    );
}

/// E la copia in memoria di chi ha scritto per **seconda** adotta la fusione,
/// invece di restare l'unica a non sapere.
///
/// Senza questa riga il file sul disco sarebbe giusto e la finestra aperta
/// mostrerebbe ancora lo stato di prima, fino al riavvio: la stessa «terza
/// verità che torna al riavvio» che l'ordine disco→memoria esiste per evitare.
#[test]
fn chi_fonde_adotta_ciò_che_ha_trovato() {
    use fub_abi::settings::SettingValue;

    let (_tmp, root) = banco();
    let path = root.join("settings.json");
    let mut prima = installazione(&path, &["a.uno", "a.due"]);
    let mut seconda = installazione(&path, &["a.uno", "a.due"]);

    prima.set("a.uno", SettingValue::Toggle(true)).unwrap();
    seconda.set("a.due", SettingValue::Toggle(true)).unwrap();

    assert_eq!(
        seconda.effective("a.uno").unwrap().0,
        SettingValue::Toggle(true),
        "la seconda ha letto la chiave dell'altra fondendola, e se la tiene"
    );
}

/// Lo stesso caso sull'altro file della macchina: due finestre depositano lo
/// scroll di due esemplari diversi, e nessuno dei due sparisce.
#[test]
fn due_installazioni_non_si_cancellano_lo_stato_di_vista() {
    let (_tmp, root) = banco();
    let path = root.join("view-state.json");

    let (prima, _) = fub_kernel::ViewStates::open(&path);
    let (seconda, _) = fub_kernel::ViewStates::open(&path);

    prima
        .set("/v", "p", "uno", "scroll", Some(serde_json::json!(10)))
        .unwrap();
    seconda
        .set("/v", "p", "due", "scroll", Some(serde_json::json!(99)))
        .unwrap();

    let (terza, avviso) = fub_kernel::ViewStates::open(&path);
    assert!(avviso.is_none(), "{avviso:?}");
    assert_eq!(
        terza.get("/v", "p", "uno", "scroll"),
        Some(serde_json::json!(10)),
        "l'esemplare della prima finestra è ancora lì"
    );
    assert_eq!(
        terza.get("/v", "p", "due", "scroll"),
        Some(serde_json::json!(99))
    );
}

/// La fusione toglie la perdita, il lock toglie la **finestra**: fra la
/// rilettura e la scrittura c'è un istante in cui un'altra installazione può
/// infilarsi, e questo test lo cerca apposta.
///
/// Otto scrittori concorrenti, ognuno con la propria copia in memoria — cioè
/// otto processi, se non fosse che condividono un binario. Senza il lock questo
/// test è rosso a intermittenza, che è la forma peggiore di un presidio: qui il
/// conteggio finale dice quante chiavi sono sopravvissute, e non ce n'è una che
/// possa mancare per una ragione legittima.
#[test]
fn otto_scrittori_insieme_e_nessuna_chiave_persa() {
    use fub_abi::settings::SettingValue;

    let (_tmp, root) = banco();
    let path = root.join("settings.json");
    let nomi: Vec<String> = (0..8).map(|i| format!("a.k{i}")).collect();
    let tutte: Vec<&str> = nomi.iter().map(String::as_str).collect();

    std::thread::scope(|scope| {
        for nome in &nomi {
            let path = path.clone();
            let tutte = tutte.clone();
            scope.spawn(move || {
                let mut store = installazione(&path, &tutte);
                store.set(nome, SettingValue::Toggle(true)).unwrap();
            });
        }
    });

    let finale = installazione(&path, &tutte);
    let accese = tutte
        .iter()
        .filter(|k| finale.effective(k).unwrap().0 == SettingValue::Toggle(true))
        .count();
    assert_eq!(accese, 8, "otto scritture, otto chiavi");
}
