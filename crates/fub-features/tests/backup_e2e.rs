#![cfg(feature = "backup")]
//! Backup locale end-to-end: snapshot nello spazio plugin, ripristino note mancanti.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{
    BackupCommands, BackupView, BACKUP_ID, BACKUP_KEEP_KEY, BACKUP_VIEW, VAULT_BACKUP,
    VAULT_BACKUP_RESTORE,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn put(&self, rel: &str, body: &str) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn open(&self) -> Workspace {
        self.open_at(Arc::new(fub_kernel::time::SystemClock))
    }

    /// Il vault con un orologio scelto: i backup prendono il nome dal giorno.
    fn open_at(&self, clock: Arc<dyn fub_kernel::time::Clock>) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry)
            .expect("l'apertura del vault riesce")
            .with_clock(clock);
        ws.register_plugin(
            PluginManifest::core(BACKUP_ID, BACKUP_ID)
                .speaking("it", fub_features::backup::catalog())
                .configuring(fub_features::backup::settings()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(BACKUP_ID, Box::new(BackupView))
            .expect("view");
        ws.register_command_provider(BACKUP_ID, Box::new(BackupCommands))
            .expect("comandi");
        ws.reindex().expect("reindex");
        ws
    }
}

fn titles(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::ListItem { title, .. } => out.push(format!("{title}")),
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

#[test]
fn backup_and_restore_deleted_notes() {
    let vault = Vault::new();
    vault.put("Inbox/a.md", "# A\n");
    vault.put("b.md", "# B\n");
    let mut ws = vault.open();

    ws.invoke_command(
        VAULT_BACKUP,
        serde_json::json!({}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("backup");

    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let titles = titles(&tree);
    assert!(titles.iter().any(|t| t.contains("2 note")), "{titles:?}");

    ws.delete_document(&DocId::new("Inbox/a.md"))
        .expect("cestina");
    assert!(
        ws.read_source(&DocId::new("Inbox/a.md")).is_err(),
        "cestinata"
    );

    let id = titles
        .iter()
        .find_map(|t| t.split_whitespace().next().map(str::to_string))
        .expect("id snapshot");
    ws.invoke_command(
        VAULT_BACKUP_RESTORE,
        serde_json::json!({ "id": id }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("restore");

    let src = ws
        .read_source(&DocId::new("Inbox/a.md"))
        .expect("ripristinata");
    assert!(src.contains("# A"), "{src}");
}

/// **Un file dello snapshot che non si legge ferma il ripristino, prima che
/// crei qualcosa.** Veniva saltato: il ripristino riportava meno note dicendo
/// di esserci riuscito, e chi l'aveva chiesto non sapeva quale mancava.
#[cfg(unix)]
#[test]
fn an_unreadable_snapshot_file_stops_the_restore() {
    use std::os::unix::fs::PermissionsExt;

    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    vault.put("b.md", "# B\n");
    let mut ws = vault.open();
    ws.invoke_command(
        VAULT_BACKUP,
        serde_json::json!({}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("backup");
    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let id = titles(&tree)
        .iter()
        .find_map(|t| t.split_whitespace().next().map(str::to_string))
        .expect("id snapshot");
    ws.delete_document(&DocId::new("a.md")).expect("cestina");
    ws.delete_document(&DocId::new("b.md")).expect("cestina");

    let copy = vault
        .root
        .join(".fub/plugins")
        .join(BACKUP_ID)
        .join(&id)
        .join("a.md");
    let set = |mode| {
        std::fs::set_permissions(&copy, std::fs::Permissions::from_mode(mode))
            .expect("permessi della copia")
    };
    set(0o000);
    if std::fs::read(&copy).is_ok() {
        // Chi gira da root legge lo stesso: il guasto non si riproduce.
        set(0o644);
        return;
    }
    let restored = ws.invoke_command(
        VAULT_BACKUP_RESTORE,
        serde_json::json!({ "id": id }),
        InvokeMode::Apply,
        Actor::User,
    );
    set(0o644);

    assert!(restored.is_err(), "{restored:?}");
    assert!(
        ws.read_source(&DocId::new("b.md")).is_err(),
        "un ripristino fermato non crea niente a metà"
    );
}

#[test]
fn dry_run_not_writes() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    let mut ws = vault.open();
    ws.invoke_command(
        VAULT_BACKUP,
        serde_json::json!({}),
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("dry_run");
    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let titles = titles(&tree);
    assert!(
        titles.is_empty(),
        "dry-run non deve lasciare snapshot: {titles:?}"
    );
}

#[test]
fn the_commands_are_in_the_record() {
    let vault = Vault::new();
    let ws = vault.open();
    let ids: Vec<String> = ws.commands().into_iter().map(|c| c.id).collect();
    assert!(ids.contains(&VAULT_BACKUP.to_string()), "{ids:?}");
    assert!(ids.contains(&VAULT_BACKUP_RESTORE.to_string()), "{ids:?}");
}

/// Un orologio che avanza a mano, un giorno alla volta.
struct Days(AtomicU64);

impl fub_kernel::time::Clock for Days {
    fn now_unix_millis(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

const DAY_MS: u64 = 86_400_000;

/// Gli snapshot che hanno ancora file sul disco, per nome di cartella.
fn snapshot_dirs(vault: &Vault) -> Vec<String> {
    let dir = vault.root.join(".fub/plugins").join(BACKUP_ID);
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().is_dir() && std::fs::read_dir(entry.path()).unwrap().next().is_some()
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// Gli snapshot ruotano: dopo un backup restano i più recenti che
/// l'impostazione dice, e i file degli altri se ne vanno dal vault.
#[test]
fn old_snapshots_rotate_out_of_the_vault() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    // 2026-09-20 a mezzogiorno UTC.
    let clock = Arc::new(Days(AtomicU64::new(1_789_905_600_000)));
    let mut ws = vault.open_at(clock.clone());
    ws.set_setting(BACKUP_KEEP_KEY, SettingValue::Number(2.0))
        .expect("the setting is declared");
    for _ in 0..3 {
        ws.invoke_command(
            VAULT_BACKUP,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("backup");
        clock.0.fetch_add(DAY_MS, Ordering::SeqCst);
    }
    assert_eq!(snapshot_dirs(&vault), ["2026-09-21", "2026-09-22"]);
    let tree = ws.render_view(&ViewInstance::only(BACKUP_VIEW)).unwrap();
    let titles = titles(&tree);
    assert_eq!(titles.len(), 2, "{titles:?}");
    assert!(
        titles.iter().all(|t| !t.contains("2026-09-20")),
        "{titles:?}"
    );

    // Zero li tiene tutti.
    ws.set_setting(BACKUP_KEEP_KEY, SettingValue::Number(0.0))
        .unwrap();
    for _ in 0..2 {
        ws.invoke_command(
            VAULT_BACKUP,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("backup");
        clock.0.fetch_add(DAY_MS, Ordering::SeqCst);
    }
    assert_eq!(snapshot_dirs(&vault).len(), 4);
}

/// Rifare il backup nello stesso giorno sostituisce lo snapshot di oggi, e
/// ciò che non c'è più nel vault non ci resta. La copia nuova sta nell'altra
/// cartella del giorno, e quella vecchia se ne va.
#[test]
fn a_second_backup_on_the_same_day_replaces_todays_snapshot() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n");
    vault.put("b.md", "# B\n");
    let clock = Arc::new(Days(AtomicU64::new(1_789_905_600_000)));
    let mut ws = vault.open_at(clock);
    let backup = |ws: &mut Workspace| {
        ws.invoke_command(
            VAULT_BACKUP,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("backup")
    };
    backup(&mut ws);
    ws.delete_document(&DocId::new("b.md")).expect("cestina");
    backup(&mut ws);
    assert_eq!(snapshot_dirs(&vault), ["2026-09-20.1"]);
    let today = vault
        .root
        .join(".fub/plugins")
        .join(BACKUP_ID)
        .join("2026-09-20.1");
    assert!(today.join("a.md").exists());
    assert!(
        !today.join("b.md").exists(),
        "the snapshot follows the vault"
    );
}

// ── Banco in memoria: guasti a metà backup e manifest di altre versioni ──────

mod in_memory {
    use fub_abi::command::InvokeMode;
    use fub_abi::error::PluginError;
    use fub_abi::model::DocId;
    use fub_abi::traits::{CommandProvider, DataRead, DataWrite, VaultRead, VaultStructure};
    use fub_features::{BackupCommands, VAULT_BACKUP, VAULT_BACKUP_RESTORE};
    use fub_sdk::testing::MemoryHost;
    use serde_json::{json, Value};

    fn backup(host: &mut MemoryHost) -> Result<(), PluginError> {
        BackupCommands
            .invoke(VAULT_BACKUP, json!({}), InvokeMode::Apply, host)
            .map(|_| ())
    }

    fn restore(host: &mut MemoryHost, id: &str) -> Result<(), PluginError> {
        BackupCommands
            .invoke(
                VAULT_BACKUP_RESTORE,
                json!({ "id": id }),
                InvokeMode::Apply,
                host,
            )
            .map(|_| ())
    }

    fn manifest(host: &MemoryHost) -> Value {
        serde_json::from_slice(&host.data_read("snapshots.json").unwrap().unwrap()).unwrap()
    }

    /// Ogni blob dello spazio dati, path e byte.
    fn blobs(host: &MemoryHost) -> Vec<(String, Vec<u8>)> {
        host.data_list("")
            .unwrap()
            .into_iter()
            .map(|path| {
                let bytes = host.data_read(&path).unwrap().unwrap();
                (path, bytes)
            })
            .collect()
    }

    fn read(host: &MemoryHost, doc: &str) -> String {
        host.read_document(&DocId::new(doc)).unwrap()
    }

    fn trash(host: &mut MemoryHost, doc: &str) {
        host.trash_document(&DocId::new(doc)).unwrap();
    }

    /// **Un secondo backup dello stesso giorno che si ferma a metà lascia
    /// intatto quello del mattino.** Sovrascriveva i file della cartella del
    /// giorno uno alla volta: al guasto il manifest nominava ancora lo
    /// snapshot, ma i suoi file erano per metà della sera.
    #[test]
    fn a_second_backup_that_fails_halfway_keeps_the_morning_copy() {
        let mut host = MemoryHost::new()
            .with_document("a.md", "A del mattino")
            .with_document("b.md", "B del mattino");
        backup(&mut host).expect("il primo backup riesce");
        let id = manifest(&host)["snapshots"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let mut host = host
            .with_document("a.md", "A della sera")
            .with_document("b.md", "B della sera");
        // La seconda nota non si scrive, dovunque il backup la metta.
        host.denies_write(&format!("{id}/b.md"));
        host.denies_write(&format!("{id}.1/b.md"));
        assert!(backup(&mut host).is_err(), "il guasto ferma il backup");

        trash(&mut host, "a.md");
        trash(&mut host, "b.md");
        restore(&mut host, &id).expect("lo snapshot del mattino c'è ancora");
        assert_eq!(read(&host, "a.md"), "A del mattino");
        assert_eq!(read(&host, "b.md"), "B del mattino");
    }

    /// Il backup dopo un guasto ripulisce la copia interrotta, e lo snapshot
    /// del giorno passa da una cartella all'altra senza lasciare la vecchia.
    #[test]
    fn the_next_backup_replaces_the_interrupted_copy() {
        let mut host = MemoryHost::new()
            .with_document("a.md", "A1")
            .with_document("b.md", "B1")
            .with_document("c.md", "C1");
        backup(&mut host).unwrap();
        let id = manifest(&host)["snapshots"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let mut host = host.with_document("a.md", "A2");
        host.denies_write(&format!("{id}/c.md"));
        host.denies_write(&format!("{id}.1/c.md"));
        assert!(backup(&mut host).is_err());

        // Senza c.md il backup non incontra più il guasto; b.md della copia
        // interrotta non deve finire nello snapshot.
        trash(&mut host, "b.md");
        trash(&mut host, "c.md");
        backup(&mut host).expect("il backup dopo il guasto riesce");
        let paths: Vec<String> = blobs(&host).into_iter().map(|(path, _)| path).collect();
        assert_eq!(
            paths,
            [
                format!("{id}.1.files.json"),
                format!("{id}.1/a.md"),
                "snapshots.json".to_string()
            ],
            "l'inventario della cartella vecchia se ne va con lei"
        );
        assert_eq!(manifest(&host)["snapshots"][0]["n"], 1);
        trash(&mut host, "a.md");
        restore(&mut host, &id).expect("si ripristina dall'altra cartella");
        assert_eq!(read(&host, "a.md"), "A2");

        let mut host = host.with_document("a.md", "A3");
        backup(&mut host).expect("il terzo torna nella prima cartella");
        let paths: Vec<String> = blobs(&host).into_iter().map(|(path, _)| path).collect();
        assert_eq!(
            paths,
            [
                format!("{id}.files.json"),
                format!("{id}/a.md"),
                "snapshots.json".to_string()
            ]
        );

        trash(&mut host, "a.md");
        restore(&mut host, &id).unwrap();
        assert_eq!(read(&host, "a.md"), "A3");
    }

    /// Uno snapshot che nomina la cartella di un altro non si usa: la rotazione
    /// cancellerebbe i file di quell'altro.
    #[test]
    fn a_snapshot_naming_a_folder_not_its_own_is_refused() {
        let mut host = MemoryHost::new().with_document("a.md", "# A\n");
        let stray = json!({
            "schema_version": 2,
            "snapshots": [
                { "id": "2023-01-01", "n": 1, "dir": "2023-01-02" },
                { "id": "2023-01-02", "n": 1 },
            ],
        });
        host.data_write("snapshots.json", &serde_json::to_vec(&stray).unwrap())
            .unwrap();
        host.data_write("2023-01-02/a.md", b"# A\n").unwrap();
        let before = blobs(&host);

        let error = backup(&mut host).expect_err("la cartella non è sua");
        assert!(error.to_string().contains("2023-01-02"), "{error}");
        assert_eq!(blobs(&host), before);
    }

    /// **Un manifest di una versione più recente non si tocca.** Si leggeva
    /// scartando ciò che non si capiva, e il backup lo riscriveva povero e
    /// cancellava i file degli snapshot che la rotazione credeva di troppo.
    #[test]
    fn a_manifest_from_a_newer_fub_is_refused_and_left_as_it_was() {
        let mut host = MemoryHost::new().with_document("a.md", "# A\n");
        let snapshots: Vec<Value> = (1..=12)
            .map(|day| json!({ "id": format!("2023-01-{day:02}"), "n": 1, "futuro": { "k": day } }))
            .collect();
        let future = serde_json::to_vec(&json!({
            "schema_version": 999,
            "snapshots": snapshots,
            "altro": true,
        }))
        .unwrap();
        host.data_write("snapshots.json", &future).unwrap();
        for day in 1..=12 {
            host.data_write(&format!("2023-01-{day:02}/a.md"), b"# A\n")
                .unwrap();
        }
        let before = blobs(&host);

        for result in [
            backup(&mut host),
            BackupCommands
                .invoke(VAULT_BACKUP, json!({}), InvokeMode::DryRun, &mut host)
                .map(|_| ()),
            restore(&mut host, "2023-01-12"),
        ] {
            let error = result.expect_err("una versione più recente si rifiuta");
            assert!(error.to_string().contains("999"), "{error}");
        }
        assert_eq!(blobs(&host), before, "niente scritto e niente cancellato");
    }

    /// I campi che questa versione non conosce, in un manifest della sua
    /// versione, tornano su disco con il backup successivo.
    #[test]
    fn unknown_fields_of_a_known_manifest_survive_a_backup() {
        let mut host = MemoryHost::new().with_document("a.md", "# A\n");
        let manifest_v1 = json!({
            "schema_version": 1,
            "snapshots": [{ "id": "2023-01-01", "n": 1, "etichetta": "prima" }],
            "altro": { "x": [1, 2] },
        });
        host.data_write("snapshots.json", &serde_json::to_vec(&manifest_v1).unwrap())
            .unwrap();
        host.data_write("2023-01-01/a.md", b"# A vecchia\n")
            .unwrap();

        backup(&mut host).expect("un manifest della prima versione si legge");
        let written = manifest(&host);
        assert_eq!(written["schema_version"], 2);
        assert_eq!(written["altro"], json!({ "x": [1, 2] }));
        assert_eq!(written["snapshots"][0]["etichetta"], "prima");
        assert_eq!(written["snapshots"].as_array().unwrap().len(), 2);

        trash(&mut host, "a.md");
        restore(&mut host, "2023-01-01").expect("lo snapshot vecchio sta dov'era");
        assert_eq!(read(&host, "a.md"), "# A vecchia\n");
    }

    /// Un backup di due note, entrambe cestinate dopo: ciò che serve per
    /// provare un ripristino che deve fermarsi.
    fn backed_up_and_trashed() -> (MemoryHost, String) {
        let mut host = MemoryHost::new()
            .with_document("a.md", "Nota A, intera")
            .with_document("b.md", "Nota B, intera");
        backup(&mut host).expect("il backup riesce");
        let id = manifest(&host)["snapshots"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        trash(&mut host, "a.md");
        trash(&mut host, "b.md");
        (host, id)
    }

    /// Il ripristino che si ferma non ha creato niente, e lo dice con il nome
    /// della copia che non torna: in prova come in esecuzione.
    fn assert_the_restore_stops(host: &mut MemoryHost, id: &str, culprit: &str) {
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = BackupCommands
                .invoke(VAULT_BACKUP_RESTORE, json!({ "id": id }), mode, host)
                .expect_err("lo snapshot non torna");
            assert!(error.to_string().contains(culprit), "{error}");
        }
        assert!(
            host.read_document(&DocId::new("a.md")).is_err(),
            "un ripristino fermato non crea niente a metà"
        );
        assert!(host.read_document(&DocId::new("b.md")).is_err());
    }

    /// **Una copia sparita dallo snapshot non si salta in silenzio.** Spariva
    /// anche dall'elenco dei file, e il ripristino riportava una nota in meno
    /// dicendo di esserci riuscito.
    #[test]
    fn a_copy_missing_from_the_snapshot_stops_the_restore() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_remove(&format!("{id}/b.md")).unwrap();
        assert_the_restore_stops(&mut host, &id, "b.md");
    }

    /// Un testo troncato ma ancora UTF-8 passava: veniva ricreato com'era
    /// rimasto.
    #[test]
    fn a_truncated_copy_that_is_still_text_stops_the_restore() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_write(&format!("{id}/b.md"), b"Nota B").unwrap();
        assert_the_restore_stops(&mut host, &id, "b.md");
    }

    /// Stessa lunghezza, altri byte: la dimensione sola non basta.
    #[test]
    fn a_copy_of_the_same_length_but_other_bytes_stops_the_restore() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_write(&format!("{id}/a.md"), b"Nota X, intera")
            .unwrap();
        assert_the_restore_stops(&mut host, &id, "a.md");
    }

    /// Una copia che non è più testo non si ricrea, e non si salta.
    #[test]
    fn a_copy_that_is_no_longer_text_stops_the_restore() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_write(&format!("{id}/b.md"), &[0xff, 0xfe, 0x00])
            .unwrap();
        assert_the_restore_stops(&mut host, &id, "b.md");
    }

    /// Un inventario che il manifest nomina e non c'è più non si scambia per
    /// «snapshot di prima»: lo snapshot non si può verificare, e lo si dice.
    #[test]
    fn a_snapshot_that_lost_its_inventory_is_not_restored_blind() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_remove(&format!("{id}.files.json")).unwrap();
        assert_the_restore_stops(&mut host, &id, &id);
    }

    /// Il manifest di uno snapshot, con il numero di note che ricorda cambiato.
    fn remember_notes(host: &mut MemoryHost, n: u64) {
        let mut manifest = manifest(host);
        manifest["snapshots"][0]["n"] = json!(n);
        host.data_write("snapshots.json", &serde_json::to_vec(&manifest).unwrap())
            .unwrap();
    }

    /// **Un inventario di prima non descrive una cartella rifatta** (FUB-005).
    /// Una versione che non conosce l'inventario rifà lo snapshot — una nota in
    /// più nella cartella, `n` aggiornato — e il manifest che riscrive porta
    /// ancora `inventory: true`: l'inventario che resta è quello vecchio, tutti
    /// i suoi byte tornano, e il ripristino saltava la nota nuova senza dirlo.
    #[test]
    fn a_snapshot_whose_copies_outgrew_its_inventory_stops_the_restore() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_write(&format!("{id}/c.md"), b"Nota C, nuova")
            .unwrap();
        remember_notes(&mut host, 3);
        assert_the_restore_stops(&mut host, &id, "c.md");
    }

    /// Anche il solo numero che non torna basta: l'inventario ha due voci e il
    /// manifest ne ricorda tre.
    #[test]
    fn an_inventory_with_another_number_of_entries_than_the_manifest_stops_the_restore() {
        let (mut host, id) = backed_up_and_trashed();
        remember_notes(&mut host, 3);
        assert_the_restore_stops(&mut host, &id, "2 su 3");
    }

    /// Una copia che l'inventario non nomina ferma il ripristino anche quando
    /// il numero torna (una nota tolta e una messa).
    #[test]
    fn a_copy_the_inventory_does_not_name_stops_the_restore_even_if_the_count_matches() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_write(&format!("{id}/c.md"), b"Nota C, nuova")
            .unwrap();
        host.data_remove(&format!("{id}/b.md")).unwrap();
        assert_the_restore_stops(&mut host, &id, "c.md");
    }

    /// Uno snapshot di prima dell'inventario non ha impronte da confrontare, ma
    /// il manifest ricorda quante note aveva: una copia in meno si vede.
    #[test]
    fn a_snapshot_from_before_the_inventory_counts_its_copies() {
        let (mut host, id) = backed_up_and_trashed();
        host.data_remove(&format!("{id}.files.json")).unwrap();
        let mut old = manifest(&host);
        old["snapshots"][0]
            .as_object_mut()
            .unwrap()
            .remove("inventory");
        host.data_write("snapshots.json", &serde_json::to_vec(&old).unwrap())
            .unwrap();

        // Intero: si ripristina come sempre.
        restore(&mut host, &id).expect("uno snapshot di prima si ripristina");
        assert_eq!(read(&host, "a.md"), "Nota A, intera");
        assert_eq!(read(&host, "b.md"), "Nota B, intera");

        // Con una copia in meno: no.
        trash(&mut host, "a.md");
        trash(&mut host, "b.md");
        host.data_remove(&format!("{id}/b.md")).unwrap();
        assert_the_restore_stops(&mut host, &id, "1 su 2");
    }

    /// Le note vive non contano: una copia rovinata di una nota che nel vault
    /// c'è ancora non impedisce di ripristinare quelle che mancano davvero.
    #[test]
    fn a_damaged_copy_of_a_note_still_in_the_vault_does_not_matter() {
        let mut host = MemoryHost::new()
            .with_document("a.md", "Nota A, intera")
            .with_document("b.md", "Nota B, intera");
        backup(&mut host).expect("il backup riesce");
        let id = manifest(&host)["snapshots"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        host.data_write(&format!("{id}/a.md"), b"Nota A").unwrap();
        trash(&mut host, "b.md");
        restore(&mut host, &id).expect("b.md si ripristina");
        assert_eq!(read(&host, "b.md"), "Nota B, intera");
        assert_eq!(read(&host, "a.md"), "Nota A, intera", "a.md non si tocca");
    }
}
