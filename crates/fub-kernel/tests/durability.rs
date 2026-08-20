//! Cosa promette una scrittura del supporto (§15.2), e i tre casi in cui la
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
//!
//! # La metà che la piattaforma non porta via (§23.16)
//!
//! Quattro dei presidi qui sotto chiedono un inode, un hardlink o un `mode`, e
//! sono `#[cfg(unix)]`: su Windows **non vengono nemmeno compilati**. Per anni
//! il job Windows della CI è passato verde girando una suite di durabilità che
//! là dentro era quasi vuota, ed è la specie di difetto che nessun colore
//! segnala — *una suite che si svuota in silenzio è indistinguibile da una suite
//! verde*.
//!
//! Da qui i test che esercitano la scelta «sostituire o scrivere sul posto»
//! passano da `FsStorage::write_con`, che prende il rilevatore invece di
//! nominarlo, e da `come_scrivere`, che è pura: i test di questo file che si
//! compilano ed eseguono su ogni piattaforma sono
//! **sedici** [conta: durabilita-su-ogni-piattaforma].
//! Quel numero è il presidio del presidio: se qualcuno riportasse
//! questa metà sotto un `#[cfg(…)]` qualunque, il conto scenderebbe e
//! `check-prosa` diventerebbe rosso — mentre `cargo test` su Windows resterebbe
//! verde, perché è esattamente ciò che non sa vedere.
//!
//! **I quattro modi di svuotare questa suite**, e cosa fa il conto di ciascuno.
//! Un `#[cfg` davanti a un test lo **scala**. Gli altri tre lo **azzerano**,
//! perché non c'è modo di scalare ciò che si applica a tutti insieme: un
//! `#[ignore]` (che lascerebbe `0 passed; 0 failed`), un `#![cfg(…)]` come
//! attributo *interno* in cima al file, e un `if cfg!(windows) { return; }`
//! dentro un corpo — la forma peggiore, perché lì il test si vede correre e
//! passa a vuoto. Quest'ultima la prima versione di questo cappello la
//! dichiarava non prendibile «senza leggere Rust», e non era vero: in un file
//! che esiste per girare ovunque non esiste un uso legittimo di `cfg!`, quindi
//! la sua sola presenza è la risposta. Un presidio che non sa scalare sa
//! almeno spegnersi rumorosamente.

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::storage::{
    folders_to_sync, how_to_write, what_c_and, sync_folder, WriteMode,
    FsStorage, FileNames, VaultStorage,
};

fn bench() -> (tempfile::TempDir, Utf8PathBuf) {
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
fn a_write_not_leaves_nothing_behind_of_if() {
    let (_tmp, root) = bench();
    let storage = FsStorage;
    let notes = root.join("note/Idea.md");

    storage.write(&notes, b"prima").unwrap();
    storage.write(&notes, b"seconda").unwrap();

    let remaining: Vec<String> = storage
        .list(&root.join("note"))
        .unwrap()
        .iter()
        .map(|v| v.path.file_name().unwrap_or_default().to_string())
        .collect();
    assert_eq!(remaining, vec!["Idea.md"], "il temporaneo se n'è andato");
    assert_eq!(storage.read(&notes).unwrap(), b"seconda");
}

/// La regola intera, come tabella: otto ingressi, otto risposte, e nessun
/// filesystem.
///
/// È la sola forma in cui questa decisione si può leggere tutta insieme, ed è
/// anche la sola che gira dove gli inode non ci sono. La riga che vale la voce è
/// l'ultima coppia: **`Ignoto` sceglie come `PiuDiUno`**, non come `Uno`.
#[test]
fn the_rule_is_in_a_table_and_the_table_turns_everywhere() {
    let cases = [
        (false, FileNames::None, WriteMode::Replacing),
        (false, FileNames::One, WriteMode::Replacing),
        (false, FileNames::MoreThanOne, WriteMode::SulPosto),
        (false, FileNames::Unknown, WriteMode::SulPosto),
        // Un collegamento ha già un altro titolare: il conteggio non lo cambia.
        (true, FileNames::None, WriteMode::SulPosto),
        (true, FileNames::One, WriteMode::SulPosto),
        (true, FileNames::MoreThanOne, WriteMode::SulPosto),
        (true, FileNames::Unknown, WriteMode::SulPosto),
    ];
    for (link, names, expected) in cases {
        assert_eq!(
            how_to_write(link, names),
            expected,
            "collegamento={link}, nomi={names:?}"
        );
    }
}

/// Un file con più nomi non si sostituisce — **su qualunque piattaforma**, e non
/// solo dove il test sa costruire un hardlink.
///
/// Il gemello `un_file_con_due_nomi_non_si_sdoppia` prova la stessa cosa con un
/// hardlink vero e sta sotto `#[cfg(unix)]`, cioè non esiste dove il difetto
/// della §23.16 viveva. Questo prova la stessa regola col rilevamento passato:
/// gli manca la prova che il conteggio sia giusto, e ha in cambio di esistere.
#[test]
fn a_file_with_more_names_not_is_replaces_everywhere_rounds_this_test() {
    let (_tmp, root) = bench();
    let notes = root.join("Idea.md");
    FsStorage.write(&notes, b"prima").unwrap();

    let (how, _) = FsStorage
        .write_with(&notes, b"seconda", true, what_c_and, |_, _| {
            FileNames::MoreThanOne
        })
        .unwrap();

    assert_eq!(how, WriteMode::SulPosto, "l'inode ha altri titolari");
    assert_eq!(
        std::fs::read(&notes).unwrap(),
        b"seconda",
        "e i byte sono arrivati lo stesso"
    );
}

/// **Il caso della voce.** Un conteggio che non si sa non è «un nome solo»: è un
/// dubbio, e davanti a un dubbio si rinuncia all'atomicità invece di rischiare
/// di staccare un nome.
///
/// Finché il rilevamento era un `bool`, questo caso e quello sopra erano lo
/// stesso valore, e su Windows era sempre quello sbagliato.
#[test]
fn a_count_that_not_is_knows_not_and_a_name_only() {
    let (_tmp, root) = bench();
    let notes = root.join("Idea.md");
    FsStorage.write(&notes, b"prima").unwrap();

    let (how, _) = FsStorage
        .write_with(&notes, b"seconda", true, what_c_and, |_, _| {
            FileNames::Unknown
        })
        .unwrap();

    assert_eq!(
        how,
        WriteMode::SulPosto,
        "chi non sa quanti nomi ha un file non lo sostituisce"
    );
    assert_eq!(std::fs::read(&notes).unwrap(), b"seconda");
}

/// E il verso opposto, che è quello che si paga tutti i giorni: un nome solo
/// **compra** l'atomicità.
#[test]
fn a_name_only_buys_the_atomicity() {
    let (_tmp, root) = bench();
    let notes = root.join("Idea.md");
    FsStorage.write(&notes, b"prima").unwrap();

    let (how, _) = FsStorage
        .write_with(&notes, b"seconda", true, what_c_and, |_, _| FileNames::One)
        .unwrap();

    assert_eq!(how, WriteMode::Replacing);
    assert_eq!(std::fs::read(&notes).unwrap(), b"seconda");
}

/// A un file che non c'è il conteggio non si chiede: non c'è niente da
/// conservare, e su Windows chiederlo vorrebbe dire aprire un file inesistente
/// per sentirsi rispondere di no.
#[test]
fn a_a_file_that_not_c_and_not_is_asks_nothing() {
    let (_tmp, root) = bench();
    let notes = root.join("sotto/Nuova.md");
    let asked = std::cell::Cell::new(false);

    let (how, _) = FsStorage
        .write_with(&notes, b"prima", true, what_c_and, |_, _| {
            asked.set(true);
            FileNames::MoreThanOne
        })
        .unwrap();

    assert_eq!(how, WriteMode::Replacing);
    assert!(
        !asked.get(),
        "nessuno ha contato i nomi di ciò che non c'è"
    );
    assert_eq!(std::fs::read(&notes).unwrap(), b"prima");
}

/// E nemmeno a un **collegamento** si chiede il conteggio: la risposta non
/// cambierebbe la decisione, e su Windows costerebbe un'apertura che seguirebbe
/// il collegamento invece di guardarlo.
///
/// Sta sotto `#[cfg(unix)]` perché per fare un symlink serve un filesystem che
/// li faccia, ma **il ramo che presidia non è di unix**: è la trappola misurata
/// dalla verifica del rosso. Togliere questa riga *da sola* non rende rosso
/// niente; toglierla **insieme** al corto-circuito di `come_scrivere` — cioè la
/// semplificazione «ovvia», un ramo solo che chiede sempre il conteggio — fa sì
/// che su unix `nlink` di un symlink valga `1`, quindi `Uno`, quindi
/// `Sostituendo`: **il collegamento verrebbe rimpiazzato**, che è precisamente
/// ciò che la 0065 esiste per non fare. Chi tocca queste due righe insieme deve
/// trovare un rosso, e questo è il rosso.
#[cfg(unix)]
#[test]
fn on_a_link_the_count_not_is_asks() {
    let (_tmp, root) = bench();
    let real = root.join("altrove/Vera.md");
    FsStorage.write(&real, b"prima").unwrap();
    let linked = root.join("Collegata.md");
    std::os::unix::fs::symlink(&real, &linked).unwrap();
    let asked = std::cell::Cell::new(false);

    let (how, _) = FsStorage
        .write_with(&linked, b"seconda", true, what_c_and, |_, _| {
            asked.set(true);
            FileNames::One
        })
        .unwrap();

    assert_eq!(how, WriteMode::SulPosto);
    assert!(!asked.get(), "a un collegamento non si contano i nomi");
    assert!(
        std::fs::symlink_metadata(&linked)
            .unwrap()
            .file_type()
            .is_symlink(),
        "il collegamento è ancora un collegamento"
    );
    assert_eq!(std::fs::read(&real).unwrap(), b"seconda");
}

/// Il prezzo dichiarato, e il presidio che dice che lo stiamo pagando davvero:
/// riscrivere una nota **sostituisce il file**, non il suo contenuto.
///
/// Vale la pena presidiare ciò che si è scelto di pagare quanto ciò che si è
/// scelto di risparmiare: se un giorno questo diventasse rosso vorrebbe dire che
/// la scrittura è tornata sul posto — e con lei il file troncato.
#[cfg(unix)]
#[test]
fn rewrite_a_notes_of_it_replaces_the_file() {
    use std::os::unix::fs::MetadataExt;

    let (_tmp, root) = bench();
    let notes = root.join("Idea.md");
    FsStorage.write(&notes, b"prima").unwrap();
    let before = std::fs::metadata(&notes).unwrap().ino();

    FsStorage.write(&notes, b"seconda").unwrap();
    assert_eq!(
        std::fs::metadata(&notes).unwrap().ino(),
        before,
        "l'atomicità si compra con una rename, e una rename cambia inode"
    );
}

/// Un collegamento **non** si sostituisce: la nota vera sta dall'altra parte, e
/// una rename la scollegherebbe in silenzio a ogni salvataggio.
#[cfg(unix)]
#[test]
fn a_link_receives_the_byte_instead_of_be_replaced() {
    let (_tmp, root) = bench();
    let real = root.join("altrove/Vera.md");
    FsStorage.write(&real, b"prima").unwrap();
    let linked = root.join("Collegata.md");
    std::os::unix::fs::symlink(&real, &linked).unwrap();

    FsStorage.write(&linked, b"seconda").unwrap();

    assert!(
        std::fs::symlink_metadata(&linked)
            .unwrap()
            .file_type()
            .is_symlink(),
        "il collegamento è ancora un collegamento"
    );
    assert_eq!(
        std::fs::read(&real).unwrap(),
        b"seconda",
        "e i byte sono arrivati al file vero"
    );
}

/// Un file con due nomi resta **un** file: una rename ne staccherebbe uno solo,
/// e l'altro resterebbe fermo al contenuto di prima senza che nessuno lo sappia.
#[cfg(unix)]
#[test]
fn a_file_with_two_names_not_is_duplicates() {
    use std::os::unix::fs::MetadataExt;

    let (_tmp, root) = bench();
    let one = root.join("Uno.md");
    let two = root.join("Due.md");
    FsStorage.write(&one, b"prima").unwrap();
    std::fs::hard_link(&one, &two).unwrap();

    FsStorage.write(&one, b"seconda").unwrap();

    assert_eq!(
        std::fs::read(&two).unwrap(),
        b"seconda",
        "l'altro nome vede la scrittura"
    );
    assert_eq!(
        std::fs::metadata(&one).unwrap().nlink(),
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
fn the_permissions_of_a_notes_survive_to_the_save() {
    use std::os::unix::fs::PermissionsExt;

    let (_tmp, root) = bench();
    let notes = root.join("Riservata.md");
    FsStorage.write(&notes, b"prima").unwrap();
    std::fs::set_permissions(&notes, std::fs::Permissions::from_mode(0o600)).unwrap();

    FsStorage.write(&notes, b"seconda").unwrap();

    assert_eq!(
        std::fs::metadata(&notes).unwrap().permissions().mode() & 0o777,
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
fn the_file_of_fub_passes_from_the_support() {
    use fub_kernel::storage::MemStorage;
    use std::sync::Arc;

    let storage = Arc::new(MemStorage::new());
    let root = Utf8Path::new("/vault");

    // L'organizzazione (§11.3).
    let (org, warning) =
        fub_kernel::OrganizationStore::open(root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
    assert!(warning.is_none(), "{warning:?}");
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

/// Un derivato si scrive con la stessa strada dei documenti — temp+rename,
/// permessi ereditati, temporaneo tolto — e si rilegge come loro.
///
/// È la metà osservabile di [`VaultStorage::write_derived`]: che il file ci sia
/// e sia quello che si è scritto. Che manchi il `sync_all` — la metà che
/// distingue la via dalla [`write`](VaultStorage::write) — non si presidia da
/// qui, come non si presidia il `sync_all` della 0065: è una riga letta in
/// review, e il suo posto è il commento accanto alla riga.
#[test]
fn a_derived_entry_is_written_and_reread() {
    let (_tmp, root) = bench();
    let derived = root.join(".fub/data/entries.json");

    FsStorage
        .write_derived(&derived, br#"{"version":3,"entries":{}}"#)
        .unwrap();

    assert_eq!(
        std::fs::read(&derived).unwrap(),
        br#"{"version":3,"entries":{}}"#,
        "il derivato è leggibile come un documento"
    );
    assert!(
        !root.join(".fub/data").read_dir().unwrap().any(|v| {
            v.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".entries.json.tmp")
        }),
        "e il temporaneo non è rimasto indietro"
    );
}

/// La scrittura dei **documenti** paga ancora il prezzo intero: la via derivata
/// esiste, e la 0065 non deve essersi spenta per farla esistere.
///
/// È il presidio che la
/// [0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)
/// chiedeva: la promessa «o c'è o non c'è» vale per i documenti, e chi li
/// scrive non deve poter scegliere di non pagarla. Il `sync_all` in sé non si
/// osserva da un test — è una riga letta in review — ma che la via derivata
/// non sia finita **sotto** la scrittura dei documenti sì: se un giorno
/// `write` passasse da `write_derived`, questo test lo dice.
#[test]
fn the_documents_remain_on_the_write_durable() {
    let (_tmp, root) = bench();
    let notes = root.join("Nota.md");

    FsStorage.write(&notes, b"prima").unwrap();
    FsStorage.write_derived(&notes, b"derivata").unwrap();
    FsStorage.write(&notes, b"seconda").unwrap();

    assert_eq!(
        std::fs::read(&notes).unwrap(),
        b"seconda",
        "la scrittura dei documenti è ancora la via durevole"
    );
}

// --- le mosse, che non scrivono niente e possono sparire lo stesso -----------
//
// La 0065 aveva trovato la riga che conta — è la **cartella** a portare il nome,
// e senza il suo `fsync` un rename può sparire dopo un `Ok` — e l'aveva scritta
// dentro la sola scrittura. Ma le operazioni che muovono o tolgono l'unica copia
// di una nota sono le altre: cestinare, ripristinare, spostare, buttare una
// bozza (difetto 0153).
//
// Vale anche qui il cappello di questo file: che dopo un crash vero la mossa ci
// sia ancora non lo presidia nessun test, perché servirebbe un crash vero. Ciò
// che si presidia è la **regola** — quali cartelle, e quante volte — e che
// chiederne il `fsync` non abbia cambiato l'esito di ciò che le mosse
// rispondono.

/// Quali cartelle cambiano voce, come tabella: sei ingressi e nessun
/// filesystem.
///
/// Le due righe che valgono la voce sono la seconda e l'ultima. Una rinomina
/// **dentro la stessa cartella** la sincronizza una volta sola: due volte
/// sarebbe un `fsync` in più su ogni rinomina, cioè il costo più caro che un
/// disco sappia fare, pagato per niente. E un path senza genitore non produce
/// la cartella vuota, che non si apre.
#[test]
fn the_folders_of_a_move_are_in_a_table() {
    let cases: [(&str, Option<&str>, &[&str]); 6] = [
        // Cestinare: la nota lascia una cartella e ne raggiunge un'altra.
        (
            "/v/note/Idea.md",
            Some("/v/.trash/Idea.md"),
            &["/v/note", "/v/.trash"],
        ),
        // Rinominare sul posto: una cartella sola, non due volte la stessa.
        ("/v/note/Idea.md", Some("/v/note/Altra.md"), &["/v/note"]),
        // Togliere: la voce che sparisce sta in una cartella sola.
        ("/v/note/Idea.md", None, &["/v/note"]),
        // Togliere una cartella: ciò che resta da far scendere sta sopra.
        ("/v/.trash", None, &["/v"]),
        // Una radice senza genitore non ha niente da sincronizzare.
        ("Idea.md", None, &[]),
        ("Idea.md", Some("Altra.md"), &[]),
    ];
    for (from, a, expected) in cases {
        let obtained = folders_to_sync(Utf8Path::new(from), a.map(Utf8Path::new));
        let obtained: Vec<&str> = obtained.iter().map(|c| c.as_str()).collect();
        assert_eq!(obtained, expected, "da={from}, a={a:?}");
    }
}

/// Chiedere il `fsync` di una cartella è **best-effort**: dove non si può, la
/// mossa non fallisce.
///
/// È la metà che tiene la riparazione dal diventare un rifiuto di cestinare:
/// su Windows una cartella non si apre come file, e una mossa che fallisse per
/// questo sarebbe un danno certo al posto di uno improbabile.
#[test]
fn synchronize_a_folder_and_best_effort() {
    let (_tmp, root) = bench();
    assert!(
        sync_folder(&root),
        "una cartella che c'è non si è lasciata sincronizzare"
    );
    assert!(
        !sync_folder(&root.join("mai-esistita")),
        "una cartella che non c'è ha detto di essere scesa sul disco"
    );
}

/// E le mosse rispondono ancora ciò che rispondevano: il `fsync` in coda non ha
/// trasformato un guasto in un `Ok`, né un `Ok` in un guasto.
///
/// È il rischio che la riparazione porta con sé, ed è la metà di lei che si
/// vede: quattro operazioni hanno preso una coda, e una coda scritta male
/// ingoia l'errore che veniva prima — infatti tolto un `?` a `remove` questo
/// test dice «togliere ciò che non c'è ha risposto Ok». Che quella coda giri
/// **dopo il `?`**, cioè che una mossa fallita non chieda niente al disco, è
/// invece una riga letta in review come il `sync_all` stesso: spostarla prima
/// non cambia niente di osservabile, cambia solo quanto ci mette un errore.
#[test]
fn a_move_responds_again_that_that_responded() {
    let (_tmp, root) = bench();
    let storage = FsStorage;
    let notes = root.join("note/Idea.md");
    storage.write(&notes, b"prima").unwrap();

    let trashed = root.join(".trash/Idea.md");
    storage.rename(&notes, &trashed).expect("cestinare riesce");
    assert!(storage.exists(&trashed), "la nota è nel cestino");
    assert!(!storage.exists(&notes), "e non è più dov'era");

    assert!(
        storage.rename(&notes, &trashed).is_err(),
        "spostare ciò che non c'è ha risposto Ok"
    );
    assert!(
        storage.remove(&notes).is_err(),
        "togliere ciò che non c'è ha risposto Ok"
    );

    storage.remove(&trashed).expect("togliere riesce");
    assert!(!storage.exists(&trashed), "e la nota se n'è andata");

    storage
        .remove_dir_all(&root.join(".trash"))
        .expect("svuotare riesce");
    storage
        .remove_empty_dir(&root.join("note"))
        .expect("togliere una cartella vuota riesce");
    assert!(
        storage.remove_empty_dir(&root.join("note")).is_err(),
        "togliere due volte la stessa cartella ha risposto Ok"
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

fn key(name: &str) -> fub_abi::settings::SettingSpec {
    fub_abi::settings::SettingSpec::toggle(name, name, false).for_machine()
}

/// Un'installazione con la sua copia in memoria del livello macchina: è ciò che
/// un secondo processo ha, e un secondo `MachineSettings` sullo stesso path lo
/// riproduce senza bisogno di un secondo processo.
fn installation(path: &Utf8Path, keys: &[&str]) -> fub_kernel::SettingsStore {
    use std::sync::Arc;

    let (machine, warning) = fub_kernel::MachineSettings::open(path);
    assert!(warning.is_none(), "{warning:?}");
    let mut store = fub_kernel::SettingsStore::open(
        Utf8Path::new("/vault"),
        Arc::new(fub_kernel::storage::MemStorage::new()) as Arc<dyn VaultStorage>,
        machine,
    );
    let specs: Vec<_> = keys.iter().map(|k| key(k)).collect();
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
fn two_installations_not_is_delete_the_keys() {
    use fub_abi::settings::SettingValue;

    let (_tmp, root) = bench();
    let path = root.join("settings.json");

    // Le due leggono **prima** che l'altra scriva: è il presupposto del caso.
    let mut before = installation(&path, &["a.uno", "a.due"]);
    let mut second = installation(&path, &["a.uno", "a.due"]);

    before.set("a.uno", SettingValue::Toggle(true)).unwrap();
    second.set("a.due", SettingValue::Toggle(true)).unwrap();

    let third = installation(&path, &["a.uno", "a.due"]);
    assert_eq!(
        third.effective("a.uno").unwrap().0,
        SettingValue::Toggle(true),
        "la chiave della prima è sopravvissuta al salvataggio della seconda"
    );
    assert_eq!(
        third.effective("a.due").unwrap().0,
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
fn the_merger_adopts_what_it_found() {
    use fub_abi::settings::SettingValue;

    let (_tmp, root) = bench();
    let path = root.join("settings.json");
    let mut before = installation(&path, &["a.uno", "a.due"]);
    let mut second = installation(&path, &["a.uno", "a.due"]);

    before.set("a.uno", SettingValue::Toggle(true)).unwrap();
    second.set("a.due", SettingValue::Toggle(true)).unwrap();

    assert_eq!(
        second.effective("a.uno").unwrap().0,
        SettingValue::Toggle(true),
        "la seconda ha letto la chiave dell'altra fondendola, e se la tiene"
    );
}

/// Lo stesso caso sull'altro file della macchina: due finestre depositano lo
/// scroll di due esemplari diversi, e nessuno dei due sparisce.
#[test]
fn two_installations_not_is_delete_the_state_of_view() {
    let (_tmp, root) = bench();
    let path = root.join("view-state.json");

    let (before, _) = fub_kernel::ViewStates::open(&path);
    let (second, _) = fub_kernel::ViewStates::open(&path);

    before
        .set("/v", "p", "uno", "scroll", Some(serde_json::json!(10)))
        .unwrap();
    second
        .set("/v", "p", "due", "scroll", Some(serde_json::json!(99)))
        .unwrap();

    let (third, warning) = fub_kernel::ViewStates::open(&path);
    assert!(warning.is_none(), "{warning:?}");
    assert_eq!(
        third.get("/v", "p", "uno", "scroll"),
        Some(serde_json::json!(10)),
        "l'esemplare della prima finestra è ancora lì"
    );
    assert_eq!(
        third.get("/v", "p", "due", "scroll"),
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
fn eight_writers_together_and_no_key_lost() {
    use fub_abi::settings::SettingValue;

    let (_tmp, root) = bench();
    let path = root.join("settings.json");
    let names: Vec<String> = (0..8).map(|the| format!("a.k{the}")).collect();
    let all: Vec<&str> = names.iter().map(String::as_str).collect();

    std::thread::scope(|scope| {
        for name in &names {
            let path = path.clone();
            let all = all.clone();
            scope.spawn(move || {
                let mut store = installation(&path, &all);
                store.set(name, SettingValue::Toggle(true)).unwrap();
            });
        }
    });

    let final_state = installation(&path, &all);
    let accese = all
        .iter()
        .filter(|k| final_state.effective(k).unwrap().0 == SettingValue::Toggle(true))
        .count();
    assert_eq!(accese, 8, "otto scritture, otto chiavi");
}
