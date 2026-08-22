//! Le impostazioni viste dal **kernel** (§11.1,
//! [decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)):
//! chi dichiara una chiave, chi la può leggere, chi la può scrivere e cosa
//! succede a chi ci prova senza titolo.
//!
//! Le regole di *risoluzione* — vault sopra macchina sopra default, un valore
//! fuori specie che si scarta, una chiave di macchina scritta dentro un vault —
//! stanno nei test di modulo di `settings.rs`, dove lo store si costruisce senza
//! un workspace. Qui c'è ciò che si vede solo **attraverso il contratto**: il
//! manifest che dichiara, l'`HostApi` che presta, il canale dati che risponde,
//! e l'evento che parte.

use camino::Utf8PathBuf;
use fub_abi::options::permission;
use fub_abi::settings::{SettingKind, SettingSource, SettingSpec, SettingValue};
use fub_abi::traits::{IndexQuery, IndexResult, PluginManifest};
use fub_abi::{Event, PluginError};
use fub_kernel::{FormatRegistry, Trust, Workspace};
use fub_testkit::Bench;

/// Un manifest di core che dichiara delle impostazioni.
fn with_settings(id: &str, settings: Vec<SettingSpec>) -> PluginManifest {
    PluginManifest::core(id, id).configuring(settings)
}

fn toggle() -> SettingSpec {
    SettingSpec::toggle("versioning.enabled", "Versioning", true)
        .describing("Keeps a history.")
        .grouped("Vault")
        .program_writable()
}

/// Un'impostazione che **l'utente decide e un programma no**: è la riga non
/// negoziabile del §11.1, e il default del contratto la scrive da sé.
fn untouchable() -> SettingSpec {
    SettingSpec::toggle("privacy.telemetry", "Telemetry", false)
}

#[test]
fn a_key_exists_because_a_manifest_declares_it() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    assert!(
        ws.setting("versioning.enabled").is_err(),
        "before the declaration the key does not exist"
    );

    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .expect("declared");

    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(true),
        "and immediately the schema default applies: a value is always present"
    );
}

/// Le chiavi di impostazione sono uno degli otto spazi di nomi del §7.4, e non
/// per modo di dire: chi le dichiara deve poterle nominare.
#[test]
fn a_key_outside_the_own_namespace_is_not_declared() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    let manifest = PluginManifest::new("com.acme.tasks", "Tasks")
        .configuring(vec![SettingSpec::toggle("versioning.enabled", "V", false)]);

    let err = ws
        .register_plugin(manifest, Trust::Community)
        .expect_err("a bare key is not owned by a plugin");
    assert!(
        err.to_string().contains("com.acme.tasks"),
        "the refusal names who should have titled it: {err}"
    );
    assert!(
        ws.plugins().is_empty(),
        "and the plugin does not declare at all: a half declaration is a state \
         that nobody asked for"
    );
}

#[test]
fn a_plugin_reads_settings_from_the_host_like_it_reads_the_rest() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .expect("declared");

    let read = ws.with_host("fub.versioning", |host| host.setting("versioning.enabled"));
    assert_eq!(read.unwrap(), SettingValue::Toggle(true));

    // E anche **la chiave di un altro**: la configurazione non è un recinto, e
    // un plugin di tema che non potesse leggere `editor.font-size` perché non è
    // sua sarebbe un plugin di tema inutile. Ciò che è recintato è la scrittura.
    ws.register_core_feature("fub.other", "Other").unwrap();
    let from_outside = ws.with_host("fub.other", |host| host.setting("versioning.enabled"));
    assert!(from_outside.is_ok());
}

/// Il residuo della decisione 0010, chiuso: **quali chiavi sono scrivibili da un
/// programma**. Due cancelli, e nessuno dei due basta da solo.
#[test]
fn a_program_writes_only_keys_declared_as_writable() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(
        with_settings("fub.versioning", vec![toggle(), untouchable()]),
        Trust::Core,
    )
    .expect("declared");

    let result = ws.with_host("fub.versioning", |host| {
        host.set_setting("versioning.enabled", SettingValue::Toggle(false))
    });
    assert!(result.is_ok(), "the key was declared writable");
    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(false)
    );

    let denied = ws.with_host("fub.versioning", |host| {
        host.set_setting("privacy.telemetry", SettingValue::Toggle(true))
    });
    assert!(
        matches!(denied, Err(PluginError::PermissionDenied(_))),
        "and this one no, not even for the one who declared it: {denied:?}"
    );
    assert_eq!(
        ws.setting("privacy.telemetry").unwrap(),
        SettingValue::Toggle(false),
        "the value remained the same"
    );
}

/// L'altro cancello: il permesso del manifest (§7.3).
#[test]
fn without_the_permission_not_even_a_writable_key_is_written() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    // Un plugin di terzi che dichiara la chiave nel proprio namespace, e che
    // **non** dichiara `fub:write-settings`.
    let manifest =
        PluginManifest::new("com.acme.tasks", "Tasks").configuring(vec![SettingSpec::toggle(
            "com.acme.tasks:show",
            "Show",
            true,
        )
        .program_writable()]);
    ws.register_plugin(manifest, Trust::Community)
        .expect("declared");

    let denied = ws.with_host("com.acme.tasks", |host| {
        host.set_setting("com.acme.tasks:show", SettingValue::Toggle(false))
    });
    assert!(
        matches!(&denied, Err(PluginError::PermissionDenied(m)) if m.to_string().contains(permission::WRITE_SETTINGS)),
        "the refusal names the missing permission: {denied:?}"
    );

    // Leggere invece passa: uno schema è pubblico per costruzione, e questo
    // store non contiene segreti (regola scritta in `fub_abi::settings`).
    let read = ws.with_host("com.acme.tasks", |host| host.setting("com.acme.tasks:show"));
    assert!(read.is_ok(), "reading has no permission: {read:?}");
}

#[test]
fn the_data_channel_responds_with_schema_value_and_origin() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .expect("declared");
    ws.register_plugin(
        with_settings(
            "fub.editor",
            vec![SettingSpec::new(
                "editor.font-size",
                "Body",
                SettingKind::Number {
                    default: 14.0,
                    min: Some(8.0),
                    max: Some(72.0),
                },
            )],
        ),
        Trust::Core,
    )
    .expect("declared");

    let IndexResult::Settings(all) = ws
        .query_index(IndexQuery::Settings { plugin: None })
        .expect("the kernel serves this family")
    else {
        panic!("off-topic response");
    };
    // Le chiavi **dichiarate**, cioè quelle che i due manifest portano. Le
    // altre le fabbrica il kernel: una per permesso concesso (§23.17), e sono
    // le sole chiavi di questo store che un manifest non nomina.
    let declared: Vec<&str> = all
        .iter()
        .map(|and| and.spec.key.as_str())
        .filter(|k| fub_abi::settings::permission_of_key(k).is_none())
        .collect();
    assert_eq!(
        declared,
        vec!["editor.font-size", "versioning.enabled"],
        "in key order"
    );
    let versioning = all
        .iter()
        .find(|and| and.spec.key == "versioning.enabled")
        .expect("the declared key exists");
    assert_eq!(versioning.source, SettingSource::Default);
    assert_eq!(versioning.spec.group, "Vault", "the schema arrives intact");

    // E i permessi di una feature ufficiale ci sono tutti e sette, uno per
    // riga, **accesi**: ciò che il manifest dichiara è concesso finché qualcuno
    let its: Vec<&str> = all
        .iter()
        .filter_map(|and| fub_abi::settings::permission_of_key(&and.spec.key))
        .filter(|(plugin, _)| *plugin == "fub.editor")
        .map(|(_, perm)| perm)
        .map(|p| {
            fub_abi::options::permission::ALL
                .into_iter()
                .find(|k| *k == p)
                .expect("a permission the host knows")
        })
        .collect();
    assert_eq!(
        its,
        vec![
            "fub:read-vault",
            "fub:write-vault",
            "fub:run-command",
            "fub:call-service",
            "fub:write-settings",
            "fub:read-session",
            "fub:read-selection",
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>(),
        "one line per granted permission, in key order"
    );
    assert!(
        all.iter()
            .filter(|and| fub_abi::settings::permission_of_key(&and.spec.key).is_some())
            .all(
                |and| and.value == fub_abi::settings::SettingValue::Toggle(true)
                    && !and.spec.program_writable
            ),
        "granted by default, and not writable by a program"
    );

    // Con un id, solo le sue: è ciò che serve al pannello di **un** plugin, e
    // ciò che permette di non filtrare per prefisso — le chiavi del core un
    let IndexResult::Settings(its_keys) = ws
        .query_index(IndexQuery::Settings {
            plugin: Some("fub.editor".into()),
        })
        .expect("served")
    else {
        panic!("off-topic response");
    };
    // Otto: quella che dichiara, più i sette permessi che il kernel le
    // fabbrica. Che le une e gli altri escano dalla **stessa** domanda è ciò
    // che permette al pannello di disegnarli con lo stesso codice.
    assert_eq!(its_keys.len(), 8);
    assert_eq!(
        its_keys
            .iter()
            .map(|and| and.spec.key.as_str())
            .find(|k| fub_abi::settings::permission_of_key(k).is_none()),
        Some("editor.font-size")
    );

    // E dopo una scrittura la **provenienza** cambia insieme al valore: è ciò
    // da cui il pannello decide se mostrare «azzera».
    ws.set_setting("editor.font-size", SettingValue::Number(18.0))
        .unwrap();
    let IndexResult::Settings(after) = ws
        .query_index(IndexQuery::Settings {
            plugin: Some("fub.editor".into()),
        })
        .expect("served")
    else {
        panic!("off-topic response");
    };
    assert_eq!(after[0].value, SettingValue::Number(18.0));
    assert_eq!(after[0].source, SettingSource::Vault);
}

#[test]
fn changing_a_setting_is_a_fact_that_announces_itself() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .expect("declared");
    let events = ws.bus().subscribe();

    ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
        .unwrap();

    let mut seen: Vec<Event> = Vec::new();
    while let Ok(notice) = events.try_recv() {
        seen.push(notice.event);
    }
    assert!(
        seen.iter().any(|and| matches!(
            and,
            Event::SettingChanged { key, .. } if key == "versioning.enabled"
        )),
        "without the event, a moved toggle is invisible to everything else \
         until someone reloads: {seen:?}"
    );
}

#[test]
fn a_plugin_that_shuts_down_takes_its_schema_but_not_its_value() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .expect("declared");
    ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
        .unwrap();

    ws.deactivate_plugin("fub.versioning").expect("shut down");
    assert!(
        ws.setting("versioning.enabled").is_err(),
        "without schema the key is unreadable: that is what \"not there\" means"
    );

    // E riaccenderlo ritrova la configurazione di prima: spegnere una feature
    // non è riconfigurarla.
    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .expect("re-declared");
    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(false)
    );
}

/// Il valore vive nel vault, non nel processo: è metà di ciò che il §11.1
/// chiedeva («dove stare scritto fra un avvio e l'altro»).
#[test]
fn a_written_value_survives_vault_closure() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");

    {
        let mut ws = Workspace::new(&root, FormatRegistry::new()).expect("the vault opens");
        ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
            .unwrap();
        ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
            .unwrap();
    }

    assert!(
        root.join(".fub").join("settings.json").is_file(),
        "the vault level is in `.fub/settings.json`, and it travels with the vault"
    );

    let mut ws = Workspace::new(&root, FormatRegistry::new()).expect("the vault opens");
    ws.register_plugin(with_settings("fub.versioning", vec![toggle()]), Trust::Core)
        .unwrap();
    assert_eq!(
        ws.setting("versioning.enabled").unwrap(),
        SettingValue::Toggle(false)
    );
}

// --- le scorciatoie sono impostazioni (§18.2) ------------------------------

/// Un provider con due comandi: uno che suggerisce una scorciatoia e uno che
/// non ne suggerisce nessuna. Servono tutti e due, perché la chiave nasce per
/// entrambi — chi non ha un suggerimento è precisamente chi ha più bisogno di
/// poterselo dare.
struct TwoCommands;

impl fub_abi::traits::CommandProvider for TwoCommands {
    fn commands(&self) -> Vec<fub_abi::command::CommandSpec> {
        vec![
            fub_abi::command::CommandSpec::new("note.create", "New note")
                .describing("Creates an empty note.")
                .with_keybinding("Mod-n"),
            fub_abi::command::CommandSpec::new("note.reveal", "Show on disk"),
        ]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: fub_abi::command::InvokeMode,
        _host: &mut dyn fub_abi::traits::HostApi,
    ) -> Result<fub_abi::command::CommandOutcome, PluginError> {
        Ok(fub_abi::command::CommandOutcome::done())
    }
}

/// Registrare un `CommandProvider` fa nascere una chiave per comando, col
/// suggerimento dichiarato come **default**: ne segue che il valore efficace
/// della chiave *è* la scorciatoia, sempre, e nessuno a valle deve fondere due
#[test]
fn every_command_carries_its_own_shortcut_key() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(PluginManifest::core("fub.notes", "Note"), Trust::Core)
        .expect("declared");
    ws.register_command_provider("fub.notes", Box::new(TwoCommands))
        .expect("registered");

    assert_eq!(
        ws.setting("keys.note.create").unwrap(),
        SettingValue::Text("Mod-n".into()),
        "the key default is the spec suggestion"
    );
    assert_eq!(
        ws.setting("keys.note.reveal").unwrap(),
        SettingValue::Text(String::new()),
        "and a command without a suggestion still has its key, empty"
    );

    // Ed è un'impostazione come le altre: si scrive, e da lì in poi la
    // provenienza dice che a decidere è stato l'utente.
    ws.set_setting("keys.note.create", SettingValue::Text("Mod-Alt-k".into()))
        .expect("written");
    let IndexResult::Settings(its_keys) = ws
        .query_index(IndexQuery::Settings {
            plugin: Some("fub.notes".into()),
        })
        .expect("served")
    else {
        panic!("off-topic response");
    };
    let row = its_keys
        .iter()
        .find(|and| and.spec.key == "keys.note.create")
        .expect("the key belongs to the command owner");
    assert_eq!(row.value, SettingValue::Text("Mod-Alt-k".into()));
    assert_eq!(row.source, SettingSource::Vault);
    assert_eq!(
        row.spec.label,
        fub_abi::text::Text::from("New note"),
        "the label is the command's: nobody translates the same name twice"
    );

    // **Un programma non riassegna i tasti di nessuno**: quali tasti fanno cosa
    // è dell'utente, come la lingua in cui legge.
    assert!(!row.spec.program_writable);
}

/// Una chiave che **esiste finché esiste il comando**: il componente che smette
/// se le porta via, e con lui il modo di riconfigurare qualcosa che non c'è.
/// Il valore scritto resta — spegnere non è riconfigurare — ed è la regola che
/// lo store applica a ogni ritiro.
#[test]
fn a_shutdown_component_leaves_no_shortcuts_behind() {
    let mut ws = Bench::new().without_format().without_scan().mounts();
    ws.register_plugin(PluginManifest::core("fub.notes", "Note"), Trust::Core)
        .expect("declared");
    ws.register_command_provider("fub.notes", Box::new(TwoCommands))
        .expect("registered");
    assert!(ws.setting("keys.note.create").is_ok());

    let _ = ws.deactivate_plugin("fub.notes");
    assert!(
        ws.setting("keys.note.create").is_err(),
        "component shut down, the key is gone"
    );
}
