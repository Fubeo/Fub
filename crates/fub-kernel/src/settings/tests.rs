//! Test dei due livelli delle impostazioni: lettura, scrittura, profili,
//! schema e file illeggibili.

use super::*;
use crate::storage::{write_atomic, FsStorage, Stat};
use fub_abi::settings::SettingKind;

fn store_on(dir: &Utf8Path) -> SettingsStore {
    SettingsStore::open(
        dir,
        Arc::new(crate::storage::FsStorage),
        MachineSettings::in_memory(),
    )
}

/// La `TempDir` va **tenuta**: cade con lei la cartella, e uno store che
/// scrive dentro una cartella già cancellata fallirebbe per una ragione che
/// non c'entra con ciò che si sta provando.
fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
    (dir, path)
}

/// Uno store con una scorciatoia già scritta nel file del vault.
fn store_with_key(dir: &Utf8Path, chord: &str) -> SettingsStore {
    let mut store = store_on(dir);
    store
        .declare(
            "fub.core",
            &[SettingSpec::new(
                "keys.note.create",
                "Nuova nota",
                SettingKind::Text {
                    default: String::new(),
                },
            )],
        )
        .unwrap();
    store
        .set("keys.note.create", SettingValue::Text(chord.into()))
        .unwrap();
    store
}

/// **Un supporto che fonde due volte non è un panico**, è un supporto.
///
/// `Merge` è una `FnMut`: il protocollo permette di chiamarla più di una
/// volta, ed è ciò che fa un supporto che riprova quando qualcun altro gli
/// ha cambiato il file sotto. Il `FsStorage` non lo fa, quindi il secondo
/// giro non lo vedeva nessuno finché il solo supporto montabile era lui.
struct SupportThatMergesTwice(crate::storage::FsStorage);

impl VaultStorage for SupportThatMergesTwice {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.0.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.0.write(path, bytes)
    }
    fn update(&self, path: &Utf8Path, merge: crate::storage::Merge<'_>) -> std::io::Result<()> {
        // Il primo giro si butta via, come lo butterebbe via chi riprova
        // dopo essersi accorto che il file è cambiato: ciò che conta è che
        // il secondo parta dai byte di adesso e dia lo stesso risultato.
        let before = self.0.read(path).ok();
        let _ = merge(before.as_deref())?;
        self.0.update(path, merge)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.0.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.0.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<crate::storage::DirEntry>> {
        self.0.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<crate::storage::Stat> {
        self.0.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.0.remove_empty_dir(dir)
    }
}

/// Un supporto che dice di sì **senza fondere niente**: il caso limite
/// dell'altro lato, e l'altro `expect` che stava qui.
struct SupportThatDoesNotMerge(crate::storage::FsStorage);

impl VaultStorage for SupportThatDoesNotMerge {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.0.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        self.0.write(path, bytes)
    }
    fn update(&self, _path: &Utf8Path, _merge: crate::storage::Merge<'_>) -> std::io::Result<()> {
        Ok(())
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.0.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.0.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.0.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<crate::storage::DirEntry>> {
        self.0.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<crate::storage::Stat> {
        self.0.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.0.remove_empty_dir(dir)
    }
}

fn store_with_support(dir: &Utf8Path, storage: Arc<dyn VaultStorage>) -> SettingsStore {
    let mut store = SettingsStore::open(dir, storage, MachineSettings::in_memory());
    store
        .declare(
            "fub.core",
            &[SettingSpec::new(
                "keys.note.create",
                "Nuova nota",
                SettingKind::Text {
                    default: String::new(),
                },
            )],
        )
        .unwrap();
    store
}

/// **Chi monta un supporto suo riceve una risposta, non un panico.**
///
/// Erano due `expect` in `store_vault`, che promettevano al posto della
/// firma: «il supporto fonde una volta sola» e «una fusione riuscita ha
/// lasciato la mappa». Nessuna delle due sta nel tratto, e la 0032 dice cosa
/// costa scoprirlo: un panico uccide il processo, cioè il vault di chi stava
/// scrivendo.
#[test]
fn a_support_that_not_and_the_disk_receives_a_error_and_not_a_panic() {
    let (_tmp, dir) = tempdir();
    let mut store = store_with_support(&dir, Arc::new(SupportThatMergesTwice(FsStorage)));
    // Non pania (se paniasse il banco morirebbe qui), e ciò che resta è il
    // valore giusto: la seconda fusione ha rifatto il lavoro, non l'ha
    // raddoppiato.
    store
        .set("keys.note.create", SettingValue::Text("Mod-j".into()))
        .expect("scrive");
    assert_eq!(
        store.vault_keybindings().get("keys.note.create"),
        Some(&"Mod-j".to_string())
    );

    let mut store = store_with_support(&dir, Arc::new(SupportThatDoesNotMerge(FsStorage)));
    let outcome = store.set("keys.note.create", SettingValue::Text("Mod-k".into()));
    assert!(
        outcome.is_err(),
        "un supporto che dice di aver scritto senza fondere non lascia \
         niente da adottare: la risposta è una frase, non un processo morto"
    );
}

/// Una chiave sospesa si legge come se il file non ne parlasse (§23.13). E
/// la provenienza dice il vero: `Default`, perché nessuna decisione che
/// valga è stata presa.
#[test]
fn a_key_suspended_equals_the_default_and_the_file_not_is_touches() {
    let (_tmp, dir) = tempdir();
    let mut store = store_with_key(&dir, "Mod-Alt-k");
    assert_eq!(
        store.effective("keys.note.create").unwrap(),
        (SettingValue::Text("Mod-Alt-k".into()), SettingSource::Vault)
    );

    store.suspend(BTreeSet::from(["keys.note.create".to_string()]));
    assert_eq!(
        store.effective("keys.note.create").unwrap(),
        (SettingValue::Text(String::new()), SettingSource::Default)
    );

    // Il valore è **sospeso**, non cancellato: si legge ancora dal file, che
    // è ciò che permette di adottarlo dopo. Sospendere è la mossa che si
    // disfa, ed è la ragione per cui è quella che si fa nel dubbio.
    assert_eq!(
        store.vault_keybindings().get("keys.note.create"),
        Some(&"Mod-Alt-k".to_string())
    );
}

/// **Scrivere risveglia**, ed è l'unica cosa che questo modulo decide da sé:
/// chi scrive un'impostazione è una persona, e un valore che ha appena
/// battuto non può restare fra quelli che nessuno leggerà mai.
#[test]
fn write_a_key_suspended_the_wakes() {
    let (_tmp, dir) = tempdir();
    let mut store = store_with_key(&dir, "Mod-Alt-k");
    store.suspend(BTreeSet::from(["keys.note.create".to_string()]));

    store
        .set("keys.note.create", SettingValue::Text("Mod-j".into()))
        .unwrap();
    assert!(store.suspended().is_empty());
    assert_eq!(
        store.effective("keys.note.create").unwrap(),
        (SettingValue::Text("Mod-j".into()), SettingSource::Vault)
    );
}

/// E **azzerare** la risveglia allo stesso modo: è la strada del «tieni le
/// mie», e se non risvegliasse resterebbe una sospensione appesa a una
/// chiave che nel file non c'è più.
#[test]
fn clear_a_key_suspended_the_wakes() {
    let (_tmp, dir) = tempdir();
    let mut store = store_with_key(&dir, "Mod-Alt-k");
    store.suspend(BTreeSet::from(["keys.note.create".to_string()]));

    store.reset("keys.note.create").unwrap();
    assert!(store.suspended().is_empty());
    assert!(store.vault_keybindings().is_empty());
}

/// Il file si guarda **prima** che gli schemi esistano, ed è il momento in
/// cui chi monta deve decidere: una scorciatoia scritta per un comando che
/// questo montaggio non ha esce lo stesso da `vault_keybindings`, o il
/// giorno che quel componente si accende il suo accordo diventerebbe attivo
/// senza che nessuno l'abbia mai visto.
#[test]
fn the_keys_of_the_file_is_read_also_without_no_one_that_them_declare() {
    let (_tmp, dir) = tempdir();
    write_atomic(
        &dir.join(crate::vault::FUB_DIR).join("settings.json"),
        br#"{"version":1,"values":{
                "keys.notes.create":"Mod-Alt-k",
                "com.acme:keys.tasks.add":"Mod-t",
                "appearance.theme":"dark",
                "keys.broken": 12
            }}"#,
    )
    .unwrap();
    let store = store_on(&dir);
    let keys = store.vault_keybindings();

    assert_eq!(keys.len(), 2, "{keys:?}");
    assert_eq!(keys.get("com.acme:keys.tasks.add").unwrap(), "Mod-t");
    // Il tema non è una scorciatoia, e un accordo che non è testo è un file
    // scritto male — che `declare` diagnostica e `resolve` scarta già.
    assert!(!keys.contains_key("appearance.theme"));
    assert!(!keys.contains_key("keys.rotto"));
}

#[test]
fn without_no_value_equals_the_default_of_the_schema() {
    let (_tmp, dir) = tempdir();
    let mut store = store_on(&dir);
    store
        .declare(
            "fub.versioning",
            &[SettingSpec::toggle("versioning.enabled", "V", true)],
        )
        .unwrap();
    let (value, source) = store.effective("versioning.enabled").unwrap();
    assert_eq!(value, SettingValue::Toggle(true));
    assert_eq!(source, SettingSource::Default);
}

/// Le righe escono nell'ordine in cui sono state dichiarate, non per
/// chiave: chi dichiara le scrive nell'ordine in cui vanno lette. Una chiave
/// ritirata e ridichiarata torna in fondo, come un componente riacceso.
#[test]
fn entries_follow_the_declaration_order() {
    let (_tmp, dir) = tempdir();
    let mut store = store_on(&dir);
    store
        .declare(
            "fub.a",
            &[
                SettingSpec::toggle("zeta.theme", "Z", true),
                SettingSpec::toggle("alpha.accent", "A", true),
            ],
        )
        .unwrap();
    store
        .declare("fub.b", &[SettingSpec::toggle("beta.other", "B", true)])
        .unwrap();
    let keys = |store: &SettingsStore| -> Vec<String> {
        store
            .entries(None)
            .into_iter()
            .map(|e| e.spec.key)
            .collect()
    };
    assert_eq!(keys(&store), ["zeta.theme", "alpha.accent", "beta.other"]);
    store.withdraw("fub.a");
    store
        .declare("fub.a", &[SettingSpec::toggle("zeta.theme", "Z", true)])
        .unwrap();
    assert_eq!(keys(&store), ["beta.other", "zeta.theme"]);

    let machine = MachineSettings::in_memory();
    machine
        .declare(&[
            SettingSpec::toggle("zeta.theme", "Z", true).for_machine(),
            SettingSpec::toggle("alpha.accent", "A", true).for_machine(),
        ])
        .unwrap();
    let machine_keys: Vec<String> = machine.entries().into_iter().map(|e| e.spec.key).collect();
    assert_eq!(machine_keys, ["zeta.theme", "alpha.accent"]);
}

/// Una chiave di vault legge **solo** il file del vault (0076): il livello
/// macchina non è più il gradino sotto di lei, ed è la prova che la
/// precedenza è sparita davvero e non solo dalla prosa.
#[test]
fn a_vault_key_does_not_watch_the_machine_file() {
    let (_tmp, dir) = tempdir();
    let machine = MachineSettings::in_memory();
    let mut store = SettingsStore::open(&dir, Arc::new(crate::storage::FsStorage), machine.clone());
    let spec = SettingSpec::new(
        "editor.font-size",
        "Corpo",
        SettingKind::Number {
            default: 14.0,
            min: None,
            max: None,
        },
    );
    store.declare("fub.editor", &[spec]).unwrap();

    // Un valore rimasto nel file della macchina — da una versione di prima
    // della 0076, o da una chiave che allora era di macchina — non parla
    // più per una chiave di vault.
    machine
        .write("editor.font-size", Some(SettingValue::Number(16.0)))
        .unwrap();
    assert_eq!(
        store.effective("editor.font-size").unwrap(),
        (SettingValue::Number(14.0), SettingSource::Default)
    );

    store
        .set("editor.font-size", SettingValue::Number(18.0))
        .unwrap();
    assert_eq!(
        store.effective("editor.font-size").unwrap(),
        (SettingValue::Number(18.0), SettingSource::Vault)
    );

    // E azzerare riporta al **default dello schema**, perché sotto non c'è
    // più niente.
    store.reset("editor.font-size").unwrap();
    assert_eq!(
        store.effective("editor.font-size").unwrap(),
        (SettingValue::Number(14.0), SettingSource::Default)
    );
}

/// La diagnostica è l'eccezione dichiarata, e continua a vivere nel file
/// della macchina: è ciò che deve valere anche quando un vault non si apre.
#[test]
fn the_log_remains_of_the_machine() {
    let (_tmp, dir) = tempdir();
    let machine = MachineSettings::in_memory();
    let mut store = SettingsStore::open(&dir, Arc::new(crate::storage::FsStorage), machine.clone());
    store
        .declare(
            "fub.core",
            &[SettingSpec::toggle("log.verbose", "Verboso", false).for_machine()],
        )
        .unwrap();
    store
        .set("log.verbose", SettingValue::Toggle(true))
        .unwrap();
    assert_eq!(
        store.effective("log.verbose").unwrap(),
        (SettingValue::Toggle(true), SettingSource::Machine)
    );
    assert_eq!(
        machine.get("log.verbose"),
        Some(SettingValue::Toggle(true)),
        "ed è finita nel file della macchina, non in quello del vault"
    );
}

/// **Chi legge un'impostazione non aspetta il disco** (0172).
///
/// Il fatto è uno — il lucchetto dei valori non copre l'andata al file — e
/// si osserva dal verso che si può fermare a comando invece che col
/// cronometro: un lettore tiene la sua guardia, e la scrittura arriva
/// **lo stesso** fino al disco. Se la sezione critica coprisse l'I/O quel
/// lettore la starebbe bloccando, il file resterebbe vuoto finché non
/// molla, e questo banco girerebbe fino alla scadenza — che è la stessa
/// cosa, letta dall'altro capo, del pannello che aspetta il disco per una
/// chiave che non sta scrivendo nessuno.
///
/// Il cronometro qui non misura niente: è solo il modo di far fallire
/// un'attesa infinita con una frase invece che con un test appeso.
#[test]
fn who_reads_not_waits_the_disk() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("settings.json");
    let (machine, warning) = MachineSettings::open(&path);
    assert!(warning.is_none(), "un file che non c'è non è un guasto");
    machine
        .declare(&[SettingSpec::toggle("log.verbose", "Verboso", false).for_machine()])
        .unwrap();

    // Un lettore fermo in mezzo alla sua lettura.
    let reader = machine.values.read().expect("livello macchina");

    let writer = {
        let machine = Arc::clone(&machine);
        std::thread::spawn(move || machine.set("log.verbose", SettingValue::Toggle(true)))
    };

    let expiration = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while load_from(&path, |p| std::fs::read(p))
        .expect("leggibile")
        .is_empty()
    {
        assert!(
            std::time::Instant::now() < expiration,
            "la scrittura non è arrivata al disco finché un lettore teneva il \
             lucchetto: la sezione critica copre l'I/O invece della sola \
             sostituzione in memoria"
        );
        std::thread::yield_now();
    }

    // E l'ordine resta quello di sempre: sul disco c'è già, in memoria non
    // ancora, perché adottare è l'unica cosa che aspetta questo lettore.
    assert!(
        reader.get("log.verbose").is_none(),
        "la memoria non si muove prima del disco"
    );
    drop(reader);
    writer.join().expect("il thread di scrittura").unwrap();
    assert_eq!(
        machine.get("log.verbose"),
        Some(SettingValue::Toggle(true)),
        "e ciò che si adotta è ciò che il disco ha accettato"
    );
}

/// La riga di sicurezza: un vault non decide della macchina.
#[test]
fn a_key_of_machine_written_in_the_vault_not_is_apply() {
    let (_tmp, dir) = tempdir();
    let vault_file = dir.join(".fub").join("settings.json");
    std::fs::create_dir_all(vault_file.parent().unwrap()).unwrap();
    std::fs::write(
        &vault_file,
        r#"{"version":1,"values":{"privacy.telemetry":true}}"#,
    )
    .unwrap();

    let mut store = store_on(&dir);
    store
        .declare(
            "fub.privacy",
            &[SettingSpec::toggle("privacy.telemetry", "Telemetria", false).for_machine()],
        )
        .unwrap();

    let (value, source) = store.effective("privacy.telemetry").unwrap();
    assert_eq!(
        value,
        SettingValue::Toggle(false),
        "il vault non è stato ascoltato"
    );
    assert_eq!(source, SettingSource::Default);
    let warnings = store.take_warnings();
    assert!(
        warnings.iter().any(|w| w.contains("privacy.telemetry")),
        "e non in silenzio: {warnings:?}"
    );
}

#[test]
fn tracked_machine_rollback_does_not_erase_a_later_aba_write() {
    let machine = MachineSettings::in_memory();
    machine
        .declare(&[SettingSpec::toggle("permission", "Permission", false).for_machine()])
        .unwrap();
    let receipt = machine
        .set_if_default_tracked("permission", SettingValue::Toggle(false))
        .unwrap()
        .expect("the default-deny write happened");

    machine
        .set("permission", SettingValue::Toggle(true))
        .unwrap();
    machine
        .set("permission", SettingValue::Toggle(false))
        .unwrap();

    assert!(!machine.reset_if_current(&receipt).unwrap());
    assert_eq!(
        machine.effective("permission").unwrap(),
        (SettingValue::Toggle(false), SettingSource::Machine),
        "the later explicit false is distinct from the mount's false"
    );
}

#[test]
fn tracked_machine_rollback_removes_its_unchanged_write() {
    let machine = MachineSettings::in_memory();
    machine
        .declare(&[SettingSpec::toggle("permission", "Permission", false).for_machine()])
        .unwrap();
    let receipt = machine
        .set_if_default_tracked("permission", SettingValue::Toggle(false))
        .unwrap()
        .expect("the default-deny write happened");

    assert!(machine.reset_if_current(&receipt).unwrap());
    assert_eq!(
        machine.effective("permission").unwrap(),
        (SettingValue::Toggle(false), SettingSource::Default)
    );
}

/// Il rollback del mount non cancella la scelta di un altro profilo: dopo
/// il cambio di profilo il diniego temporaneo resta nel profilo in cui è
/// stato scritto, e il consenso dell'altro profilo è intatto.
#[test]
fn tracked_rollback_after_a_profile_switch_leaves_the_other_profile_alone() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("settings.json");
    let (machine, _) = MachineSettings::open(&path);
    machine
        .declare(&[SettingSpec::toggle("permission", "Permission", false).for_machine()])
        .unwrap();
    machine
        .duplicate_profile("Default", "Work")
        .expect("a second profile");
    machine.switch_profile("Work").unwrap();
    machine
        .set("permission", SettingValue::Toggle(true))
        .unwrap();
    machine.switch_profile("Default").unwrap();
    let receipt = machine
        .set_if_default_tracked("permission", SettingValue::Toggle(false))
        .unwrap()
        .expect("the temporary denial in `Default`");

    // L'utente passa al profilo con il consenso mentre il mount è in corso.
    machine.switch_profile("Work").unwrap();
    assert!(machine.reset_if_current(&receipt).unwrap());
    assert_eq!(
        machine.effective("permission").unwrap(),
        (SettingValue::Toggle(true), SettingSource::Machine),
        "the consent of the active profile survives the rollback"
    );
    machine.switch_profile("Default").unwrap();
    assert_eq!(
        machine.effective("permission").unwrap(),
        (SettingValue::Toggle(false), SettingSource::Default),
        "the temporary denial is removed from the profile that received it"
    );
}

/// Una scelta scritta da un'altra istanza sullo stesso file non viene
/// cancellata dal rollback di un'istanza che non l'ha vista.
#[test]
fn tracked_rollback_does_not_erase_a_choice_persisted_by_another_instance() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("settings.json");
    let (first, _) = MachineSettings::open(&path);
    let (second, _) = MachineSettings::open(&path);
    for machine in [&first, &second] {
        machine
            .declare(&[SettingSpec::toggle("permission", "Permission", false).for_machine()])
            .unwrap();
    }
    let receipt = first
        .set_if_default_tracked("permission", SettingValue::Toggle(false))
        .unwrap()
        .expect("the temporary denial");
    second
        .set("permission", SettingValue::Toggle(true))
        .unwrap();

    assert!(!first.reset_if_current(&receipt).unwrap());
    let (reopened, _) = MachineSettings::open(&path);
    reopened
        .declare(&[SettingSpec::toggle("permission", "Permission", false).for_machine()])
        .unwrap();
    assert_eq!(
        reopened.effective("permission").unwrap(),
        (SettingValue::Toggle(true), SettingSource::Machine)
    );
}

#[test]
fn a_key_not_declared_not_is_reads_and_not_is_writes() {
    let (_tmp, dir) = tempdir();
    let mut store = store_on(&dir);
    assert!(store.effective("boh").is_err());
    assert!(store.set("boh", SettingValue::Toggle(true)).is_err());
}

#[test]
fn a_value_outside_kind_written_a_hand_is_discards_with_default_under() {
    let (_tmp, dir) = tempdir();
    let vault_file = dir.join(".fub").join("settings.json");
    std::fs::create_dir_all(vault_file.parent().unwrap()).unwrap();
    std::fs::write(&vault_file, r#"{"version":1,"values":{"a.b":"on"}}"#).unwrap();

    let mut store = store_on(&dir);
    store
        .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
        .unwrap();
    assert_eq!(
        store.effective("a.b").unwrap(),
        (SettingValue::Toggle(false), SettingSource::Default)
    );
    assert!(!store.take_warnings().is_empty());
}

#[test]
fn withdraw_a_schema_not_deletes_the_value() {
    let (_tmp, dir) = tempdir();
    let mut store = store_on(&dir);
    store
        .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
        .unwrap();
    store.set("a.b", SettingValue::Toggle(true)).unwrap();
    store.withdraw("a");
    assert!(store.effective("a.b").is_err(), "lo schema non c'è più");

    // Riaccendere la feature ritrova la configurazione di prima.
    store
        .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
        .unwrap();
    assert_eq!(
        store.effective("a.b").unwrap(),
        (SettingValue::Toggle(true), SettingSource::Vault)
    );
}

#[test]
fn two_schemas_on_the_same_key_not_coexist() {
    let (_tmp, dir) = tempdir();
    let mut store = store_on(&dir);
    store
        .declare("a", &[SettingSpec::toggle("x.y", "Y", false)])
        .unwrap();
    let and = store
        .declare("b", &[SettingSpec::toggle("x.y", "Y", true)])
        .expect_err("la seconda dichiarazione non passa");
    assert!(and.contains("`a`"), "{and}");
}

/// Il doppione **dentro lo stesso manifest**: è l'altra metà della prova
/// qui sopra, e senza di essa a vincere sarebbe l'ultima delle due — cioè
/// due default e due specie per una chiave, decisi dall'ordine di un `Vec`.
#[test]
fn not_even_the_same_manifest_can_declare_two_times_a_key() {
    let (_tmp, dir) = tempdir();
    let mut store = store_on(&dir);
    let and = store
        .declare(
            "a",
            &[
                SettingSpec::toggle("x.y", "Y", false),
                SettingSpec::toggle("x.y", "Y di nuovo", true),
            ],
        )
        .expect_err("un manifest che si contraddice non si dichiara");
    assert!(and.contains("due volte") && and.contains("`x.y`"), "{and}");
    assert!(
        store.spec("x.y").is_none(),
        "e non ne resta metà: il rifiuto è del manifest, non della seconda riga"
    );
}

/// La prova che tiene insieme le due metà della regola sui file malformati.
///
/// Leggere un file rotto e tenersi un livello vuoto salva la configurazione
/// per il tempo di **una** scrittura: la prima riscrive il file intero dalla
/// mappa vuota. Chi ha sbagliato una virgola perderebbe tutto al primo
/// interruttore toccato.
#[test]
fn a_malformed_file_does_not_overwrite_the_first_write() {
    let (_tmp, dir) = tempdir();
    let path = dir.join(".fub").join("settings.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let broken = "{ \"version\": 1, \"values\": { \"a.b\": true,, } }";
    std::fs::write(&path, broken).unwrap();

    let mut store = store_on(&dir);
    assert_eq!(
        store.take_warnings().len(),
        1,
        "il file rotto si dice, e non impedisce di aprire il vault"
    );
    store
        .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
        .unwrap();
    let and = store
        .set("a.b", SettingValue::Toggle(true))
        .expect_err("scrivere su un livello che non si è letto è un rifiuto");
    assert!(format!("{and:?}").contains("non lo sovrascrive"), "{and:?}");
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        broken,
        "e il file è ancora quello che l'utente aveva scritto"
    );
}

/// **E un file corretto a mano non aspetta una riapertura** (difetto 0170).
///
/// La faccia opposta di quello di sopra, ed è la faccia che una bandiera
/// letta all'apertura sbagliava: chi ha dimenticato una virgola la rimette —
/// con l'editor che ha già aperto, mentre Fub è lì — e da quel momento il
/// file si legge. Un rifiuto che continua è un rifiuto che parla di ieri, e
/// lascia come unica via d'uscita da un file **già a posto** il riavvio
/// dell'app.
///
/// Che poi la chiave scritta a mano si ritrovi non è un di più: dice che si
/// è ripartiti da quei byte, cioè che la fusione ha letto il file corretto e
/// non se n'è tenuto uno vuoto in tasca dall'apertura.
#[test]
fn a_file_correct_a_hand_not_waits_a_reopening() {
    let (_tmp, dir) = tempdir();
    let path = dir.join(".fub").join("settings.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "{ \"version\": 1, \"values\": { \"a.b\": true,, } }").unwrap();

    let mut store = store_on(&dir);
    assert_eq!(store.take_warnings().len(), 1, "il file rotto si dice");
    store
        .declare(
            "a",
            &[
                SettingSpec::toggle("a.b", "B", false),
                SettingSpec::toggle("a.c", "C", false),
            ],
        )
        .unwrap();

    // La stessa mano che l'aveva rotto lo rimette a posto, e Fub non si è
    // chiuso in mezzo.
    std::fs::write(&path, "{ \"version\": 1, \"values\": { \"a.b\": true } }").unwrap();

    store.set("a.c", SettingValue::Toggle(true)).expect(
        "il file adesso si legge: rifiutare vorrebbe dire chiedere di \
         riaprire l'app per un file che è già a posto",
    );
    assert_eq!(
        store.effective("a.b").unwrap().0,
        SettingValue::Toggle(true),
        "e si è ripartiti dai byte corretti, non dalla mappa vuota \
         dell'apertura"
    );
}

/// Lo stesso dall'altro livello, e tutte e due le facce in un banco solo: il
/// file della macchina rotto **resta** rotto finché lo è, e smette di
/// esserlo nel momento in cui smette (difetto 0170).
#[test]
fn also_the_level_machine_returns_a_read_from_if() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("settings.json");
    std::fs::write(&path, "{ \"version\": 1, \"values\": {,} }").unwrap();

    let (machine, warning) = MachineSettings::open(&path);
    assert!(warning.is_some(), "il file rotto si dice");
    machine
        .declare(&[SettingSpec::toggle("log.verbose", "Verboso", false).for_machine()])
        .unwrap();

    let and = machine
        .set("log.verbose", SettingValue::Toggle(true))
        .expect_err("finché è rotto non lo si sovrascrive");
    assert!(format!("{and:?}").contains("non lo sovrascrive"), "{and:?}");

    std::fs::write(&path, "{ \"version\": 1, \"values\": {} }").unwrap();
    machine
        .set("log.verbose", SettingValue::Toggle(true))
        .expect("corretto il file, la scrittura non aspetta un riavvio");
    assert_eq!(
        machine.effective("log.verbose").unwrap().0,
        SettingValue::Toggle(true)
    );
}

/// Lo stesso vale **fuori** dalla mappa attiva: un profilo inattivo con una
/// chiave ripetuta, o due profili con lo stesso nome, non si ricompongono
/// scegliendo una riga a caso (difetto 0174).
#[test]
fn duplicates_inside_the_profiles_are_a_malformed_file_too() {
    let profile =
        |values: &str| format!("{{ \"version\": 2, \"name\": \"Work\", \"values\": {values} }}");
    let cases = [
        format!(
            "{{ \"version\": 2, \"values\": {{}}, \"profiles\": {{ \"Work\": {} }} }}",
            profile("{ \"known\": true, \"known\": false }")
        ),
        format!(
            "{{ \"version\": 2, \"values\": {{}}, \"profiles\": {{ \"Work\": {}, \"Work\": {} }} }}",
            profile("{}"),
            profile("{ \"known\": true }")
        ),
    ];
    for (index, body) in cases.iter().enumerate() {
        let (_tmp, dir) = tempdir();
        let path = dir.join(".fub").join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, body).unwrap();

        let mut store = store_on(&dir);
        let warnings = store.take_warnings();
        assert_eq!(warnings.len(), 1, "caso {index}: {warnings:?}");
        assert!(warnings[0].contains("è scritta due volte"), "{warnings:?}");
        store
            .declare("a", &[SettingSpec::toggle("a.b", "B", false)])
            .unwrap();
        store
            .set("a.b", SettingValue::Toggle(true))
            .expect_err("un file ambiguo non si riscrive");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), *body);
    }
}

/// **La stessa chiave scritta due volte non è un valore da scegliere**
/// (difetto 0174).
///
/// JSON permette di scriverla due volte e la libreria fa vincere l'ultima in
/// silenzio: il file arriva da una mano o da una versione che numerava le
/// chiavi in un altro modo, e la prima scrittura lo ricompone dalla mappa —
/// dove di righe ne è rimasta una. Sparisce una riga di configurazione da un
/// file che nessuno aveva detto all'utente di guardare, e non c'è un momento
/// in cui lo scopre.
#[test]
fn a_key_written_two_times_not_is_resolves_from_if() {
    let (_tmp, dir) = tempdir();
    let path = dir.join(".fub").join("settings.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let a_hand = "{ \"version\": 1, \"values\": { \"a.b\": true, \"a.b\": false } }";
    std::fs::write(&path, a_hand).unwrap();

    let mut store = store_on(&dir);
    let warnings = store.take_warnings();
    assert_eq!(warnings.len(), 1, "il doppione si dice: {warnings:?}");
    assert!(
        warnings[0].contains("`a.b` è scritta due volte"),
        "e dice **quale**, che è l'unica cosa che serve per andare a \
         togliere la riga di troppo: {warnings:?}"
    );

    store
        .declare(
            "a",
            &[
                SettingSpec::toggle("a.b", "B", false),
                SettingSpec::toggle("a.c", "C", false),
            ],
        )
        .unwrap();
    store
        .set("a.c", SettingValue::Toggle(true))
        .expect_err("un file che non si capisce non lo si sovrascrive");
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        a_hand,
        "una delle due righe è sparita, e a dirlo non è stato nessuno"
    );
}

/// E il livello della macchina la eredita senza che nessuno se ne ricordi:
/// la regola sta in `load_from`, che è il solo posto in cui è scritto cosa
/// vuol dire «illeggibile» (difetto 0174).
#[test]
fn also_the_level_machine_not_chooses_between_two_keys_equal() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("settings.json");
    std::fs::write(
        &path,
        "{ \"version\": 1, \"values\": { \"log.verbose\": true, \"log.verbose\": false } }",
    )
    .unwrap();

    let (_machine, warning) = MachineSettings::open(&path);
    assert!(
        warning
            .expect("il doppione si dice anche qui")
            .contains("`log.verbose` è scritta due volte"),
        "e con il nome della chiave"
    );
}

/// `write_atomic` non lascia dietro di sé il temporaneo, e il nome che usa
/// è unico: due scritture di fila non si contendono lo stesso `.tmp`.
#[test]
fn the_write_atomic_not_leaves_residue() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("stato.json");
    write_atomic(&path, b"{\"a\":1}").unwrap();
    write_atomic(&path, b"{\"a\":2}").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}");
    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|and| and.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n != "stato.json")
        .collect();
    assert!(leftovers.is_empty(), "temporanei rimasti: {leftovers:?}");
}
#[test]
fn profiles_preserve_unrepresentable_values_and_refuse_future_files() {
    let (_tmp, dir) = tempdir();
    let path = dir.join("settings.json");
    std::fs::write(&path, r#"{"version":1,"values":{"known":true,"foreign":{"nested":[1,null]}},"futureField":{"x":42}}"#).unwrap();
    let (machine, warning) = MachineSettings::open(&path);
    assert!(warning.is_none());
    machine
        .declare(&[SettingSpec::toggle("known", "Known", false).for_machine()])
        .unwrap();
    machine.duplicate_profile("Default", "Copy").unwrap();
    machine.reset_profile("Copy").unwrap();
    machine.switch_profile("Copy").unwrap();
    let copied: serde_json::Value =
        serde_json::from_str(&machine.export_profile("Copy").unwrap()).unwrap();
    assert!(copied["values"].get("known").is_none());
    assert_eq!(
        copied["values"]["foreign"],
        serde_json::json!({"nested":[1,null]})
    );
    machine.set("known", SettingValue::Toggle(false)).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved["futureField"], serde_json::json!({"x":42}));
    assert_eq!(
        saved["profiles"]["Default"]["values"]["foreign"],
        serde_json::json!({"nested":[1,null]})
    );

    let future = r#"{"version":999,"values":{"known":true,"foreign":{"nested":[1,null]}}}"#;
    std::fs::write(&path, future).unwrap();
    assert!(machine.set("known", SettingValue::Toggle(true)).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), future);
}
