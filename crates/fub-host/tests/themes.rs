//! **I temi come bundle** (§29.4): la porta unica del [`BundleRegistry`], i
//! cancelli del manifest che si applicano **prima** di toccare il disco, e
//! l'installazione da cartella — atomica, anti-traversal, anti-collisione.
//!
//! Le prove sono due giri. Il primo monta un workspace vero e guarda
//! l'inventario: il tema di serie è nella tabella di `mount` con `kind =
//! theme` e `mounted`, e un tema installato nella cartella di configurazione
//! entra dalla stessa porta. Il secondo prova le porte di `theme` da sole,
//! senza un vault: il motore sbagliato e i permessi si respingono **per
//! nome**, prima di scrivere una riga, e l'installazione non lascia né un tema
//! a metà né una destinazione toccata.

use camino::{Utf8Path, Utf8PathBuf};
use fub_host::registry::BundleKind;
use fub_host::Host;

/// L'albero di un tema installabile: manifest valido + un foglio per luce.
/// Il contenuto del foglio non conta (i cancelli CSS girano nella shell), ma
/// un tema senza file oltre al manifest non è una cartella realistica.
fn write_theme(root: &Utf8Path, id: &str, engine: &str, extra: &str) {
    std::fs::create_dir_all(root).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Prova", "version": "1.0.0", "engine": "{engine}", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"]{extra}}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    std::fs::write(root.join("sheet-light.css"), "body { color: #333; }\n").unwrap();
    std::fs::write(root.join("sheet-dark.css"), "body { color: #ddd; }\n").unwrap();
    std::fs::write(root.join("skin.css"), ".surface { color: inherit; }\n").unwrap();
}

fn folders() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

fn installed(config: &Utf8Path) -> Host {
    Host::without_watcher().with_config_dir(config)
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = folders();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    (dir, root)
}

// --- il tema di serie e la porta unica -------------------------------------

/// Il tema di serie è **una riga della tabella di `mount`**, come il core:
/// nell'inventario compare con la sua famiglia e montato. È l'unico modo in
/// cui l'host può sapere che la pelle che disegna per default è un tema senza
/// passare da una seconda porta.
#[test]
fn the_series_theme_is_a_row_of_the_mount_table() {
    let (_dir, root) = folders();
    let mounted = fub_host::mount::mount(
        &root,
        fub_kernel::MachineSettings::in_memory(),
        fub_kernel::ViewStates::in_memory(),
        std::sync::Arc::new(fub_kernel::SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount succeeds");

    let series = mounted
        .registry
        .inventory()
        .into_iter()
        .find(|b| b.id == fub_host::theme::SERIES_ID)
        .expect("the series theme is declared by the mount table");
    assert_eq!(series.kind, BundleKind::Theme);
    assert!(
        series.mounted,
        "the series theme is enabled by default, like every official feature"
    );
    assert_eq!(series.name, "Fub di serie");
}

/// Un tema installato in `config/themes/<id>/` entra dall'inventario dei
/// bundle, con `kind = theme` e `mounted` — la stessa porta delle feature
/// ufficiali, e la riga `mounted` distinta da «spento».
#[test]
fn an_installed_theme_is_mounted_from_the_machine_folder() {
    let (_config_dir, config) = folders();
    let (_vault_dir, v) = vault();
    let (dir, root) = folders();
    write_theme(&root, "test.paper", "theme-1", "");
    fub_host::theme::install_theme(&config, &root).expect("installs");

    let host = installed(&config);
    host.open(&v).expect("opens");

    let theme = host
        .bundles(None)
        .expect("inventory")
        .into_iter()
        .find(|b| b.id == "test.paper")
        .expect("the installed theme is known");
    assert_eq!(theme.kind, BundleKind::Theme);
    assert!(theme.mounted);
    drop(dir);
    drop(_config_dir);
    drop(_vault_dir);
}

#[test]
fn theme_inventory_and_read_are_typed_and_path_free() {
    let (_config_dir, config) = folders();
    let (dir, root) = folders();
    write_theme(&root, "test.paper", "theme-1", "");
    std::fs::create_dir_all(root.join("icons")).unwrap();
    std::fs::write(root.join("icons/icon.png"), [1_u8, 2, 3]).unwrap();
    std::fs::write(root.join("icons/quoted.svg"), [4_u8, 5, 6]).unwrap();
    std::fs::write(root.join("icons/ignored.svg"), [7_u8, 8, 9]).unwrap();
    std::fs::write(root.join("icons/unused.bin"), [9_u8, 9, 9]).unwrap();
    std::fs::write(
        root.join("skin.css"),
        r#".surface {
  background-image: image-set(
    "theme://test.paper/icons/quoted.svg" 1x,
    u\72 l("theme://test.paper/icons/icon\2e png") 2x
  );
  content: 'image-set("theme://test.paper/icons/ignored.svg" 1x)';
  /* url("theme://test.paper/icons/ignored.svg") */
}"#,
    )
    .unwrap();
    fub_host::theme::install_theme(&config, &root).expect("installs");

    let themes = fub_host::theme::list_themes(&config);
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].manifest.id, "test.paper");
    assert_eq!(
        themes[0].manifest.motion,
        [
            fub_abi::theme::ThemeMotion::Opacity,
            fub_abi::theme::ThemeMotion::Transform
        ]
    );

    let payload =
        fub_host::theme::read_theme(&config, "test.paper", fub_abi::theme::ThemeLight::Light)
            .expect("reads authorized theme");
    assert_eq!(payload.manifest.id, "test.paper");
    assert!(!payload
        .assets
        .contains_key("theme://test.paper/icons/unused.bin"));
    assert!(!payload
        .assets
        .contains_key("theme://test.paper/icons/ignored.svg"));
    assert_eq!(payload.light, fub_abi::theme::ThemeLight::Light);
    assert!(payload
        .sheet
        .as_deref()
        .is_some_and(|sheet| sheet.contains("#333")));
    assert!(payload.skin.is_some());
    assert_eq!(
        payload.assets["theme://test.paper/icons/quoted.svg"],
        [4, 5, 6]
    );
    assert_eq!(
        payload.assets["theme://test.paper/icons/icon.png"],
        [1, 2, 3]
    );
    assert!(fub_host::theme::read_theme(
        &config,
        "../test.paper",
        fub_abi::theme::ThemeLight::Light,
    )
    .is_err());
    drop(dir);
}

// --- i cancelli del manifest, prima di toccare il disco ---------------------

/// Un tema che parla un contratto che l'host non conosce è respinto **per
/// nome** e prima di ogni altro passo: non è un difetto del tema, è un tema
/// che questo host non serve. Il disco non viene toccato.
#[test]
fn a_theme_with_a_newer_engine_is_rejected_before_installing() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.future", "theme-3", "");

    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-3 is not served");
    assert!(
        matches!(&error, fub_host::theme::ThemeError::Engine { id, declared } if id == "test.future" && declared == "theme-3"),
        "it is the engine that rejects it: {error}"
    );
    let told = error.to_string();
    assert!(
        told.contains("`theme-1`") && told.contains("`theme-2`"),
        "the refusal names every engine this host serves: {told}"
    );
    assert!(
        !fub_host::config::themes_dir(&config)
            .join("test.future")
            .exists(),
        "a rejected theme leaves nothing behind"
    );
}

// --- theme-2 e le impostazioni che un tema dichiara --------------------------

const SETTINGS: &str = r#", "settings": [
    {"name": "bordi", "label": "Bordi", "kind": {"kind": "toggle", "default": true}},
    {"name": "raggio", "label": "Raggio", "description": "Quanto sono tondi gli angoli.",
     "kind": {"kind": "number", "default": 8, "min": 0, "max": 16}},
    {"name": "trama", "label": "Trama", "kind": {"kind": "choice", "default": "fine",
     "options": [{"value": "fine", "label": "Fine"}, {"value": "grossa", "label": "Grossa"}]}}
]"#;

/// Le righe di configurazione di un tema, lette dalla porta di tutti.
fn theme_entries(host: &Host, vault: &Utf8Path, id: &str) -> Vec<fub_abi::settings::SettingEntry> {
    let answer = host
        .query_index(
            Some(vault.as_str()),
            fub_abi::traits::IndexQuery::Settings {
                plugin: Some(id.to_string()),
            },
        )
        .expect("settings answer");
    match answer {
        fub_abi::traits::IndexResult::Settings(entries) => entries,
        other => panic!("not a settings answer: {other:?}"),
    }
}

/// `theme-2` è un motore che l'host trasporta: si installa, si elenca e si
/// legge come `theme-1`. Se la shell lo sappia vestire lo decide la shell.
#[test]
fn a_theme_2_theme_is_installed_listed_and_read() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.due", "theme-2", "");
    fub_host::theme::install_theme(&config, &root).expect("theme-2 installs");

    let themes = fub_host::theme::list_themes(&config);
    assert_eq!(themes.len(), 1);
    assert_eq!(
        themes[0].manifest.engine,
        fub_abi::theme::ThemeEngine::Theme2
    );
    let payload =
        fub_host::theme::read_theme(&config, "test.due", fub_abi::theme::ThemeLight::Dark)
            .expect("reads theme-2");
    assert_eq!(payload.manifest.engine, fub_abi::theme::ThemeEngine::Theme2);
    assert!(payload.manifest.settings.is_empty());
}

// --- extends: un tema che parte dalla serie ---------------------------------

/// Un tema `theme-2` che parte dalla serie con i soli file dati: il manifest
/// dichiara le due luci, i fogli e la pelle li sceglie chi chiama.
fn write_extending_theme(root: &Utf8Path, id: &str, engine: &str, extends: &str, files: &[&str]) {
    std::fs::create_dir_all(root).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Eredita", "version": "1.0.0", "engine": "{engine}", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"], "extends": {extends}}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    for name in files {
        let parent = root.join(name);
        std::fs::create_dir_all(parent.parent().unwrap()).unwrap();
        std::fs::write(parent, "body { color: #444; }\n").unwrap();
    }
}

fn malformed_because(error: fub_host::theme::ThemeError, why: &str) {
    match error {
        fub_host::theme::ThemeError::Malformed(message) => assert!(
            message.contains(why),
            "the refusal says why (`{why}`): {message}"
        ),
        other => panic!("not a malformed manifest: {other}"),
    }
}

/// Un manifest scritto prima di `extends` si legge e si riscrive come prima,
/// byte per byte: il campo assente non compare sul filo.
#[test]
fn a_manifest_without_extends_keeps_its_bytes() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.main", "theme-2", "");
    let raw = r#"{"id":"test.main","name":"Prova","version":"1.0.0","engine":"theme-2","lights":["light","dark"],"asset_namespace":"theme://test.main/","motion":["opacity","transform"]}"#;
    std::fs::write(root.join("manifest.json"), raw).unwrap();
    fub_host::theme::install_theme(&config, &root).expect("installs");

    let themes = fub_host::theme::list_themes(&config);
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].manifest.extends, None);
    assert_eq!(serde_json::to_string(&themes[0].manifest).unwrap(), raw);
    let payload =
        fub_host::theme::read_theme(&config, "test.main", fub_abi::theme::ThemeLight::Dark)
            .expect("reads");
    assert_eq!(serde_json::to_string(&payload.manifest).unwrap(), raw);
    assert!(payload.sheet.is_some());
}

/// Senza `extends` il foglio di ogni luce offerta resta d'obbligo: un tema
/// che ne perde uno non è nel catalogo e la sua luce non si legge.
#[test]
fn without_extends_every_offered_light_needs_its_sheet() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.monco", "theme-2", "");
    std::fs::remove_file(root.join("sheet-dark.css")).unwrap();
    fub_host::theme::install_theme(&config, &root).expect("installs");

    assert!(fub_host::theme::list_themes(&config).is_empty());
    let error =
        fub_host::theme::read_theme(&config, "test.monco", fub_abi::theme::ThemeLight::Dark)
            .expect_err("the dark sheet is missing");
    assert!(
        error.to_string().contains("sheet-dark.css"),
        "the refusal names the missing sheet: {error}"
    );
}

/// Un tema che parte dalla serie e porta il solo foglio chiaro: si installa,
/// si elenca con entrambe le luci, e la luce scura arriva senza foglio (la
/// shell userà quello di serie).
#[test]
fn an_extending_theme_with_only_the_light_sheet_offers_both_lights() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_extending_theme(
        &root,
        "test.chiaro",
        "theme-2",
        r#""fub.serie""#,
        &["sheet-light.css"],
    );
    fub_host::theme::install_theme(&config, &root).expect("installs");

    let themes = fub_host::theme::list_themes(&config);
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].manifest.extends.as_deref(), Some("fub.serie"));
    assert_eq!(
        themes[0].manifest.lights,
        [
            fub_abi::theme::ThemeLight::Light,
            fub_abi::theme::ThemeLight::Dark
        ]
    );

    let light =
        fub_host::theme::read_theme(&config, "test.chiaro", fub_abi::theme::ThemeLight::Light)
            .expect("reads the light sheet");
    assert!(light.sheet.as_deref().is_some_and(|s| s.contains("#444")));
    assert_eq!(light.skin, None);
    let dark =
        fub_host::theme::read_theme(&config, "test.chiaro", fub_abi::theme::ThemeLight::Dark)
            .expect("the dark light comes from the series");
    assert_eq!(dark.sheet, None);
    assert_eq!(dark.manifest.extends.as_deref(), Some("fub.serie"));
    let wire = serde_json::to_value(&dark).unwrap();
    assert_eq!(wire["sheet"], serde_json::Value::Null);
    assert_eq!(wire["manifest"]["extends"], "fub.serie");
}

/// Anche la sola pelle, o un solo asset, è «portare qualcosa».
#[test]
fn an_extending_theme_may_bring_only_a_skin_or_an_asset() {
    let (_config_dir, config) = folders();
    let (_skin_dir, skin) = folders();
    write_extending_theme(
        &skin,
        "test.pelle",
        "theme-2",
        r#""fub.serie""#,
        &["skin.css"],
    );
    fub_host::theme::install_theme(&config, &skin).expect("a skin alone installs");
    let payload =
        fub_host::theme::read_theme(&config, "test.pelle", fub_abi::theme::ThemeLight::Light)
            .expect("reads");
    assert_eq!(payload.sheet, None);
    assert!(payload.skin.is_some());

    let (_asset_dir, asset) = folders();
    write_extending_theme(
        &asset,
        "test.icona",
        "theme-2",
        r#""fub.serie""#,
        &["icons/foglia.svg"],
    );
    fub_host::theme::install_theme(&config, &asset).expect("an asset alone installs");

    let ids: Vec<_> = fub_host::theme::list_themes(&config)
        .into_iter()
        .map(|info| info.manifest.id)
        .collect();
    assert_eq!(ids, ["test.icona", "test.pelle"]);
}

/// Un tema che eredita e non porta niente è la serie con un altro nome.
#[test]
fn an_extending_theme_that_changes_nothing_is_rejected() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_extending_theme(&root, "test.vuoto", "theme-2", r#""fub.serie""#, &[]);

    let error = fub_host::theme::install_theme(&config, &root).expect_err("changes nothing");
    malformed_because(error, "changes nothing");
    assert!(!fub_host::config::themes_dir(&config)
        .join("test.vuoto")
        .exists());
}

/// L'unica base è la serie, scritta esatta: niente vuoto, niente spazi, niente
/// altri temi.
#[test]
fn extends_accepts_only_the_series_id() {
    for (case, extends) in [
        ("empty", r#""""#),
        ("trailing space", r#""fub.serie ""#),
        ("another theme", r#""com.acme.carta""#),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_extending_theme(
            &root,
            "test.base",
            "theme-2",
            extends,
            &["sheet-light.css", "sheet-dark.css"],
        );
        let error =
            fub_host::theme::install_theme(&config, &root).expect_err(&format!("{case}: refused"));
        malformed_because(error, "`extends` must be `fub.serie`");
        assert!(
            !fub_host::config::themes_dir(&config)
                .join("test.base")
                .exists(),
            "{case}: nothing installed"
        );
    }

    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_extending_theme(&root, "test.base", "theme-2", "42", &["skin.css"]);
    let error = fub_host::theme::install_theme(&config, &root).expect_err("not a string");
    assert!(matches!(error, fub_host::theme::ThemeError::Malformed(_)));
}

/// `theme-1` è congelato e non impara a ereditare.
#[test]
fn extends_needs_theme_2() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_extending_theme(
        &root,
        "test.vecchio",
        "theme-1",
        r#""fub.serie""#,
        &["sheet-light.css", "sheet-dark.css", "skin.css"],
    );
    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-1 cannot inherit");
    malformed_because(error, "`extends` needs `theme-2`");
}

/// Il catalogo firmato passa dalla stessa porta: una voce che eredita si
/// installa, e il puntatore che l'host scrive accanto non conta come «portare
/// qualcosa».
#[test]
fn a_signed_catalog_entry_that_extends_installs_like_the_others() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_extending_theme(
        &root,
        "test.firmato",
        "theme-2",
        r#""fub.serie""#,
        &["sheet-dark.css"],
    );
    let digest = fub_host::theme::theme_tree_digest(&root).expect("digest");
    fub_host::theme::install_theme_checked(
        &config,
        &root,
        "test.firmato",
        "1.0.0",
        &digest,
        serde_json::json!({ "generation": "1" }),
    )
    .expect("the signed entry installs");

    let themes = fub_host::theme::list_themes(&config);
    assert_eq!(themes.len(), 1);
    let light =
        fub_host::theme::read_theme(&config, "test.firmato", fub_abi::theme::ThemeLight::Light)
            .expect("the light sheet comes from the series");
    assert_eq!(light.sheet, None);
    let dark =
        fub_host::theme::read_theme(&config, "test.firmato", fub_abi::theme::ThemeLight::Dark)
            .expect("reads the dark sheet");
    assert!(dark.sheet.is_some());

    let (_empty_dir, empty) = folders();
    write_extending_theme(&empty, "test.nulla", "theme-2", r#""fub.serie""#, &[]);
    let digest = fub_host::theme::theme_tree_digest(&empty).expect("digest");
    let error = fub_host::theme::install_theme_checked(
        &config,
        &empty,
        "test.nulla",
        "1.0.0",
        &digest,
        serde_json::json!({ "generation": "1" }),
    )
    .expect_err("an empty signed entry is refused too");
    malformed_because(error, "changes nothing");
}

/// Le impostazioni di un tema non hanno una porta loro: montato il tema sono
/// righe del registro, con la chiave dentro il suo id, il livello della
/// macchina e il default dichiarato. Si scrivono e si rileggono come le altre.
#[test]
fn theme_settings_are_ordinary_machine_settings() {
    let (_config_dir, config) = folders();
    let (_vault_dir, v) = vault();
    let (_dir, root) = folders();
    write_theme(&root, "test.due", "theme-2", SETTINGS);
    fub_host::theme::install_theme(&config, &root).expect("installs");
    assert_eq!(
        fub_host::theme::list_themes(&config)[0]
            .manifest
            .settings
            .len(),
        3,
        "the manifest the shell reads carries the declarations"
    );

    let host = installed(&config);
    host.open(&v).expect("opens");

    let entries = theme_entries(&host, &v, "test.due");
    let keys: Vec<&str> = entries.iter().map(|e| e.spec.key.as_str()).collect();
    for key in ["test.due:bordi", "test.due:raggio", "test.due:trama"] {
        assert!(keys.contains(&key), "{key} is declared: {keys:?}");
    }
    let of = |key: &str| {
        theme_entries(&host, &v, "test.due")
            .into_iter()
            .find(|e| e.spec.key == key)
            .unwrap_or_else(|| panic!("{key} is declared"))
    };
    let trama = of("test.due:trama");
    assert_eq!(trama.spec.scope, fub_abi::settings::SettingScope::Machine);
    assert_eq!(trama.spec.group, fub_abi::Text::Literal("Prova".into()));
    assert_eq!(trama.spec.label, fub_abi::Text::Literal("Trama".into()));
    assert_eq!(
        of("test.due:raggio").spec.description,
        fub_abi::Text::Literal("Quanto sono tondi gli angoli.".into())
    );
    assert!(!trama.spec.program_writable);
    assert_eq!(
        trama.value,
        fub_abi::settings::SettingValue::Text("fine".into())
    );
    assert_eq!(trama.source, fub_abi::settings::SettingSource::Default);

    host.set_setting_for_user(
        Some(v.as_str()),
        "test.due:trama",
        fub_abi::settings::SettingValue::Text("grossa".into()),
    )
    .expect("an admitted choice is written");
    let trama = of("test.due:trama");
    assert_eq!(
        trama.value,
        fub_abi::settings::SettingValue::Text("grossa".into())
    );
    assert_eq!(trama.source, fub_abi::settings::SettingSource::Machine);

    // Lo schema è quello dichiarato: fuori dalle scelte e fuori intervallo
    // sono rifiuti, e il valore di prima resta.
    assert!(host
        .set_setting_for_user(
            Some(v.as_str()),
            "test.due:trama",
            fub_abi::settings::SettingValue::Text("ruvida".into()),
        )
        .is_err());
    assert!(host
        .set_setting_for_user(
            Some(v.as_str()),
            "test.due:raggio",
            fub_abi::settings::SettingValue::Number(40.0),
        )
        .is_err());
    assert_eq!(
        of("test.due:trama").value,
        fub_abi::settings::SettingValue::Text("grossa".into())
    );
    assert_eq!(
        of("test.due:raggio").value,
        fub_abi::settings::SettingValue::Number(8.0)
    );

    host.reset_setting_for_user(Some(v.as_str()), "test.due:trama")
        .expect("resets");
    assert_eq!(
        of("test.due:trama").value,
        fub_abi::settings::SettingValue::Text("fine".into())
    );
}

/// Un manifest che dichiara male le proprie impostazioni non si installa, e lo
/// dice dicendo quale: un tema installato e poi rifiutato dal registro al
/// montaggio sarebbe un tema spento senza un perché.
#[test]
fn a_theme_with_undeclarable_settings_is_rejected() {
    let setting = |body: &str| format!(r#", "settings": [{body}]"#);
    let many = (0..33)
        .map(|i| format!(r#"{{"name": "s{i}", "label": "S", "kind": {{"kind": "toggle", "default": false}}}}"#))
        .collect::<Vec<_>>()
        .join(",");
    let cases: Vec<(&str, &str, String, &str)> = vec![
        (
            "theme-1",
            "test.uno",
            setting(
                r#"{"name": "bordi", "label": "Bordi", "kind": {"kind": "toggle", "default": true}}"#,
            ),
            "settings need `theme-2`",
        ),
        (
            "theme-2",
            "test.nome",
            setting(
                r#"{"name": "Bordi Larghi", "label": "Bordi", "kind": {"kind": "toggle", "default": true}}"#,
            ),
            "setting name",
        ),
        (
            "theme-2",
            "test.doppia",
            setting(
                r#"{"name": "bordi", "label": "A", "kind": {"kind": "toggle", "default": true}},
                   {"name": "bordi", "label": "B", "kind": {"kind": "toggle", "default": false}}"#,
            ),
            "declared twice",
        ),
        (
            "theme-2",
            "test.etichetta",
            setting(
                r#"{"name": "bordi", "label": " ", "kind": {"kind": "toggle", "default": true}}"#,
            ),
            "no label",
        ),
        (
            "theme-2",
            "test.testo",
            setting(
                r#"{"name": "motto", "label": "Motto", "kind": {"kind": "text", "default": ""}}"#,
            ),
            "toggle, a number or a choice",
        ),
        (
            "theme-2",
            "test.intervallo",
            setting(
                r#"{"name": "raggio", "label": "Raggio", "kind": {"kind": "number", "default": 4, "min": 9, "max": 2}}"#,
            ),
            "invalid range",
        ),
        (
            "theme-2",
            "test.aperto",
            setting(
                r#"{"name": "raggio", "label": "Raggio", "kind": {"kind": "number", "default": 4, "min": 0, "max": null}}"#,
            ),
            "needs both `min` and `max`",
        ),
        (
            "theme-2",
            "test.fuori",
            setting(
                r#"{"name": "raggio", "label": "Raggio", "kind": {"kind": "number", "default": 40, "min": 0, "max": 16}}"#,
            ),
            "invalid default",
        ),
        (
            "theme-2",
            "test.scelta",
            setting(
                r#"{"name": "trama", "label": "Trama", "kind": {"kind": "choice", "default": "ruvida",
                    "options": [{"value": "fine", "label": "Fine"}]}}"#,
            ),
            "invalid default",
        ),
        (
            "theme-2",
            "test.opzione",
            setting(
                r#"{"name": "trama", "label": "Trama", "kind": {"kind": "choice", "default": "a b",
                    "options": [{"value": "a b", "label": "A"}]}}"#,
            ),
            "option",
        ),
        (
            "theme-2",
            "test.chiave",
            setting(
                r#"{"name": "trama", "label": "Trama", "kind": {"kind": "choice", "default": "fine",
                    "options": [{"value": "fine", "label": {"key": "trama.fine"}}]}}"#,
            ),
            "without a plain label",
        ),
        (
            "theme-2",
            "test.vuota",
            setting(
                r#"{"name": "trama", "label": "Trama", "kind": {"kind": "choice", "default": "", "options": []}}"#,
            ),
            "options",
        ),
        ("theme-2", "test.troppe", setting(&many), "at most 32"),
        (
            "theme-2",
            "test:due",
            setting(
                r#"{"name": "bordi", "label": "Bordi", "kind": {"kind": "toggle", "default": true}}"#,
            ),
            "contains `:`",
        ),
    ];
    for (engine, id, extra, expected) in cases {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_theme(&root, id, engine, &extra);
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("`{id}` must not install"));
        assert!(
            matches!(&error, fub_host::theme::ThemeError::Malformed(message) if message.contains(expected)),
            "`{id}` is refused for its settings ({expected}): {error}"
        );
        assert!(
            !fub_host::config::themes_dir(&config).join(id).exists(),
            "`{id}` leaves nothing behind"
        );
    }
}
#[test]
fn a_theme_with_a_mismatched_namespace_is_rejected() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.namespace", "theme-1", "");
    let manifest = std::fs::read_to_string(root.join("manifest.json"))
        .unwrap()
        .replace("theme://test.namespace/", "theme://other/");
    std::fs::write(root.join("manifest.json"), manifest).unwrap();

    let error = fub_host::theme::install_theme(&config, &root).expect_err("namespace refused");
    assert!(
        matches!(error, fub_host::theme::ThemeError::Malformed(message) if message.contains("asset namespace"))
    );
}

#[test]
fn a_theme_with_malformed_motion_is_rejected() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.motion", "theme-1", "");
    let manifest = std::fs::read_to_string(root.join("manifest.json"))
        .unwrap()
        .replace("[\"opacity\", \"transform\"]", "[\"opacity\", \"filter\"]");
    std::fs::write(root.join("manifest.json"), manifest).unwrap();

    let error = fub_host::theme::install_theme(&config, &root).expect_err("motion refused");
    assert!(matches!(error, fub_host::theme::ThemeError::Malformed(_)));
}

#[test]
fn a_legacy_theme_1_manifest_defaults_motion() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.legacy", "theme-1", "");
    let manifest = std::fs::read_to_string(root.join("manifest.json"))
        .unwrap()
        .replace(", \"motion\": [\"opacity\", \"transform\"]", "");
    std::fs::write(root.join("manifest.json"), manifest).unwrap();

    fub_host::theme::install_theme(&config, &root).expect("legacy manifest installs");
    let payload =
        fub_host::theme::read_theme(&config, "test.legacy", fub_abi::theme::ThemeLight::Light)
            .expect("legacy manifest reads");
    assert_eq!(
        payload.manifest.motion,
        [
            fub_abi::theme::ThemeMotion::Opacity,
            fub_abi::theme::ThemeMotion::Transform,
        ]
    );
}

/// Un tema che dichiara dei **permessi** è respinto per nome: la pelle non può
/// chiedere di leggere il vault. Anche qui, niente è stato scritto.
#[test]
fn a_theme_with_permissions_is_rejected_by_name() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(
        &root,
        "test.greedy",
        "theme-1",
        ",\n  \"permissions\": {\"read-vault\": []}",
    );

    let error =
        fub_host::theme::install_theme(&config, &root).expect_err("permissions are refused");
    assert!(
        matches!(error, fub_host::theme::ThemeError::Permissions { .. }),
        "a theme with permissions is not a theme: {error}"
    );
    assert!(!fub_host::config::themes_dir(&config)
        .join("test.greedy")
        .exists());
}

/// Un id che non è un componente di path sicuro (`..`, slash, iniziale punto)
/// non arriva nemmeno alla cartella: chi installa non scrive un path a mano.
#[test]
fn a_theme_id_that_is_not_a_safe_path_component_is_rejected() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "../escape", "theme-1", "");

    let error = fub_host::theme::install_theme(&config, &root).expect_err("unsafe id");
    assert!(matches!(error, fub_host::theme::ThemeError::InvalidId(_)));
}

/// Installare due volte lo stesso tema è una **collisione**: la seconda
/// installazione non tocca la prima.
#[test]
fn installing_the_same_theme_twice_collides() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.twice", "theme-1", "");

    let first = fub_host::theme::install_theme(&config, &root).expect("first install");
    assert!(first.exists());

    let error = fub_host::theme::install_theme(&config, &root).expect_err("already installed");
    assert!(
        matches!(&error, fub_host::theme::ThemeError::AlreadyInstalled(id) if id == "test.twice"),
        "the collision is named: {error}"
    );
}

#[cfg(unix)]
#[test]
fn a_symlinked_installed_theme_root_is_rejected() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.link", "theme-1", "");
    let themes = fub_host::config::themes_dir(&config);
    std::fs::create_dir_all(&themes).unwrap();
    std::os::unix::fs::symlink(&root, themes.join("test.link")).unwrap();

    let error =
        fub_host::theme::read_theme(&config, "test.link", fub_abi::theme::ThemeLight::Light)
            .expect_err("a symlink root is not an installed theme");
    assert!(matches!(
        error,
        fub_host::theme::ThemeError::Traversal { .. }
    ));
}

#[cfg(unix)]
#[test]
fn discovery_rejects_a_symlinked_themes_root() {
    let (_config_dir, config) = folders();
    let (_outside_dir, outside) = folders();
    write_theme(
        &outside.join("test.external"),
        "test.external",
        "theme-1",
        "",
    );
    let themes = fub_host::config::themes_dir(&config);
    std::os::unix::fs::symlink(&outside, &themes).unwrap();

    let (found, errors) = fub_host::theme::discover_themes(&config);
    assert!(
        found.is_empty(),
        "a symlinked root must not expose external themes"
    );
    assert!(
        matches!(
            errors.as_slice(),
            [fub_host::theme::ThemeError::Traversal { .. }]
        ),
        "the unsafe root is reported, not followed: {errors:?}"
    );
}

#[cfg(unix)]
#[test]
fn uninstall_rejects_a_symlinked_themes_root_without_touching_target() {
    let (_config_dir, config) = folders();
    let (_outside_dir, outside) = folders();
    let external = outside.join("test.external");
    write_theme(&external, "test.external", "theme-1", "");
    let themes = fub_host::config::themes_dir(&config);
    std::os::unix::fs::symlink(&outside, &themes).unwrap();

    let error =
        fub_host::theme::uninstall_theme(&config, "test.external").expect_err("root is unsafe");
    assert!(matches!(
        error,
        fub_host::theme::ThemeError::Traversal { .. }
    ));
    assert!(
        external.join("manifest.json").exists(),
        "uninstall must not follow a symlinked themes root"
    );
}

#[cfg(unix)]
#[test]
fn uninstall_rejects_a_replaced_theme_root_without_touching_target() {
    let (_config_dir, config) = folders();
    let (_source_dir, source) = folders();
    write_theme(&source, "test.external", "theme-1", "");
    fub_host::theme::install_theme(&config, &source).expect("installs");

    let (_outside_dir, outside) = folders();
    let external = outside.join("test.external");
    write_theme(&external, "test.external", "theme-1", "");
    let themes = fub_host::config::themes_dir(&config);
    let moved = config.join("themes.saved");
    std::fs::rename(&themes, &moved).unwrap();
    std::os::unix::fs::symlink(&outside, &themes).unwrap();

    let error =
        fub_host::theme::uninstall_theme(&config, "test.external").expect_err("root is unsafe");
    assert!(matches!(
        error,
        fub_host::theme::ThemeError::Traversal { .. }
    ));
    assert!(
        external.join("manifest.json").exists(),
        "uninstall must not follow a replaced themes root"
    );
    assert!(
        moved.join("test.external/manifest.json").exists(),
        "the original root remains untouched when its name is replaced"
    );
}
/// Un link simbolico dentro la sorgente è un **traversal** in potenza: la sua
/// destinazione può stare ovunque, e il rifiuto è il solo presidio che non
/// dipenda da chi l'ha creato. La staging sparisce, e la destinazione resta
/// vuota.
#[cfg(unix)]
#[test]
fn a_symlink_inside_the_source_is_a_traversal() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.sneaky", "theme-1", "");
    std::os::unix::fs::symlink("/etc", root.join("escape")).unwrap();

    let error = fub_host::theme::install_theme(&config, &root).expect_err("symlink refused");
    assert!(
        matches!(error, fub_host::theme::ThemeError::Traversal { .. }),
        "a symlink inside the theme is a traversal: {error}"
    );
    assert!(
        fub_host::config::themes_dir(&config)
            .read_dir()
            .map(|mut it| it.next().is_none())
            .unwrap_or(true),
        "the staging folder is removed by the failed install"
    );
}

#[cfg(unix)]
#[test]
fn a_replaced_installed_sheet_is_rejected_without_following_the_link() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.replace", "theme-1", "");
    fub_host::theme::install_theme(&config, &root).expect("installs");

    let installed = fub_host::config::themes_dir(&config).join("test.replace");
    let sheet = installed.join("sheet-light.css");
    std::fs::remove_file(&sheet).unwrap();
    let (_outside_dir, outside) = folders();
    std::fs::write(outside.join("outside.css"), "body { color: red; }\n").unwrap();
    std::os::unix::fs::symlink(outside.join("outside.css"), &sheet).unwrap();

    let error =
        fub_host::theme::read_theme(&config, "test.replace", fub_abi::theme::ThemeLight::Light)
            .expect_err("replacement symlink is not a theme sheet");
    assert!(matches!(
        error,
        fub_host::theme::ThemeError::Traversal { .. }
    ));
}

#[cfg(unix)]
#[test]
fn a_fifo_asset_is_rejected_without_reading_or_blocking() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.fifo", "theme-1", "");
    let assets = root.join("icons");
    std::fs::create_dir_all(&assets).unwrap();
    let fifo = assets.join("stream");
    let status = std::process::Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .expect("mkfifo is available on unix test hosts");
    assert!(status.success(), "mkfifo failed for {}", fifo);

    let started = std::time::Instant::now();
    let error = fub_host::theme::install_theme(&config, &root).expect_err("FIFO is not an asset");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "special files must be rejected without blocking"
    );
    assert!(
        matches!(error, fub_host::theme::ThemeError::Malformed(message) if message.contains("regular file"))
    );
}

/// Uninstall toglie la cartella, e il tema di serie non si tocca — come non si
/// installa.
#[test]
fn uninstall_removes_the_folder_and_spares_the_series() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.gone", "theme-1", "");
    fub_host::theme::install_theme(&config, &root).expect("installs");

    fub_host::theme::uninstall_theme(&config, "test.gone").expect("uninstalls");
    assert!(!fub_host::config::themes_dir(&config)
        .join("test.gone")
        .exists());

    let error = fub_host::theme::uninstall_theme(&config, fub_host::theme::SERIES_ID)
        .expect_err("the series theme is reserved");
    assert!(matches!(error, fub_host::theme::ThemeError::InvalidId(_)));
    let error = fub_host::theme::uninstall_theme(&config, "test.ghost").expect_err("unknown theme");
    assert!(matches!(error, fub_host::theme::ThemeError::Io(_)));
}

/// Una cartella `.tmp-…` (staging di un'installazione interrotta da un crash)
/// non è un tema: la scansione la salta, e la racconta come «niente», non come
/// «tema rotto».
#[test]
fn discover_skips_staging_folders() {
    let (_config_dir, config) = folders();
    let staging = fub_host::config::themes_dir(&config).join(".tmp-999-1");
    std::fs::create_dir_all(&staging).unwrap();
    write_theme(&staging, "test.stale", "theme-1", "");

    let (themes, errors) = fub_host::theme::discover_themes(&config);
    assert!(themes.is_empty(), "the staging folder is not a theme");
    assert!(
        errors.is_empty(),
        "and it is not a broken theme either: {errors:?}"
    );
}

// --- i caratteri del tema ----------------------------------------------------

/// I byte di un WOFF2 finto: la firma e poi riempitivo fino a `size`.
fn woff2(size: usize) -> Vec<u8> {
    let mut bytes = b"wOF2".to_vec();
    bytes.resize(size.max(4), 0x2a);
    bytes
}

/// Un tema `theme-2` che parte dalla serie e porta i caratteri dati: `fonts`
/// è il JSON dell'elenco, `files` i file da scrivere con i loro byte.
fn write_font_theme(root: &Utf8Path, id: &str, fonts: &str, files: &[(&str, Vec<u8>)]) {
    std::fs::create_dir_all(root.join("fonts")).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Caratteri", "version": "1.0.0", "engine": "theme-2", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"], "extends": "fub.serie", "fonts": {fonts}}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    std::fs::write(
        root.join("skin.css"),
        ".shell-tooltip { font-family: \"Carta Serif\", var(--font-ui); }\n",
    )
    .unwrap();
    for (name, bytes) in files {
        std::fs::write(root.join(name), bytes).unwrap();
    }
}

fn font(family: &str, file: &str, weight: u16, style: &str) -> String {
    format!(r#"{{"family": "{family}", "file": "{file}", "weight": {weight}, "style": "{style}"}}"#)
}

fn font_list(entries: &[String]) -> String {
    format!("[{}]", entries.join(", "))
}

/// Un tema che porta due facce: si installa, il manifest le nomina, e il fascio
/// porta i file anche se nessun CSS li cita (la regola la scrive la shell).
#[test]
fn a_theme_with_fonts_installs_and_carries_their_files() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_font_theme(
        &root,
        "test.carta",
        &font_list(&[
            font("Carta Serif", "fonts/carta.woff2", 400, "normal"),
            font("Carta Serif", "fonts/carta-italic.woff2", 400, "italic"),
        ]),
        &[
            ("fonts/carta.woff2", woff2(64)),
            ("fonts/carta-italic.woff2", woff2(32)),
        ],
    );
    fub_host::theme::install_theme(&config, &root).expect("a theme with fonts installs");

    let payload =
        fub_host::theme::read_theme(&config, "test.carta", fub_abi::theme::ThemeLight::Light)
            .expect("reads");
    assert_eq!(payload.manifest.fonts.len(), 2);
    assert_eq!(payload.manifest.fonts[0].family, "Carta Serif");
    assert_eq!(
        payload.manifest.fonts[1].style,
        fub_abi::theme::ThemeFontStyle::Italic
    );
    assert_eq!(
        payload.assets.get("theme://test.carta/fonts/carta.woff2"),
        Some(&woff2(64))
    );
    assert_eq!(
        payload
            .assets
            .get("theme://test.carta/fonts/carta-italic.woff2"),
        Some(&woff2(32))
    );
}

/// Un file che non è un asset del tema — un URL, un path che esce, un altro
/// formato, un file che non c'è — è rifiutato.
#[test]
fn a_font_file_must_be_a_woff2_asset_of_the_theme() {
    for (file, why) in [
        ("https://example.com/carta.woff2", "is not a theme asset"),
        (
            "theme://test.file/fonts/carta.woff2",
            "is not a theme asset",
        ),
        ("fonts/../manifest.woff2", "is not a theme asset"),
        ("fonts/sotto/carta.woff2", "is not a theme asset"),
        ("carta.woff2", "is not a theme asset"),
        ("fonts/carta.ttf", "is not a theme asset"),
        ("fonts/mancante.woff2", "is not among the theme assets"),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_font_theme(
            &root,
            "test.file",
            &font_list(&[font("Carta Serif", file, 400, "normal")]),
            &[("fonts/carta.woff2", woff2(16))],
        );
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("`{file}` is refused"));
        malformed_because(error, why);
    }
}

/// Un `.ttf` rinominato in `.woff2` non ha la firma `wOF2`.
#[test]
fn a_renamed_ttf_is_refused_by_its_signature() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    let mut ttf = vec![0x00, 0x01, 0x00, 0x00];
    ttf.resize(128, 0);
    write_font_theme(
        &root,
        "test.ttf",
        &font_list(&[font("Carta Serif", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", ttf)],
    );
    let error = fub_host::theme::install_theme(&config, &root).expect_err("not WOFF2");
    malformed_because(error, "does not start with `wOF2`");

    // Anche un file più corto della firma.
    let (_short_dir, short) = folders();
    write_font_theme(
        &short,
        "test.corto",
        &font_list(&[font("Carta Serif", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", b"wO".to_vec())],
    );
    let error = fub_host::theme::install_theme(&config, &short).expect_err("too short");
    malformed_because(error, "does not start with `wOF2`");
}

/// La famiglia: il nome di una di serie (in qualunque maiuscolo), una parola
/// chiave del CSS, caratteri fuori dall'alfabeto, troppo lunga.
#[test]
fn a_font_family_must_be_its_own_and_well_formed() {
    let too_long = "A".repeat(65);
    for (family, why) in [
        ("Newsreader Variable", "is a series family"),
        ("inter variable", "is a series family"),
        ("IBM Plex Mono", "is a series family"),
        ("serif", "is a CSS keyword"),
        ("Inherit", "is a CSS keyword"),
        ("Carta\\\"; src: url(x)", "must be 1 to 64 characters"),
        ("Carta_Serif", "must be 1 to 64 characters"),
        (" Carta", "must be 1 to 64 characters"),
        ("Carta  Serif", "must be 1 to 64 characters"),
        ("", "must be 1 to 64 characters"),
        (too_long.as_str(), "must be 1 to 64 characters"),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_font_theme(
            &root,
            "test.famiglia",
            &font_list(&[font(family, "fonts/carta.woff2", 400, "normal")]),
            &[("fonts/carta.woff2", woff2(16))],
        );
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("family `{family}` is refused"));
        malformed_because(error, why);
    }

    // 64 caratteri esatti reggono.
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    let longest = "B".repeat(64);
    write_font_theme(
        &root,
        "test.lunga",
        &font_list(&[font(&longest, "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", woff2(16))],
    );
    fub_host::theme::install_theme(&config, &root).expect("64 characters install");
}

/// Il peso sta fra 100 e 900, lo stile è `normal` o `italic`, e la stessa
/// faccia non si dichiara due volte.
#[test]
fn weight_style_and_duplicates_are_checked() {
    for (entries, why) in [
        (
            vec![font("Carta", "fonts/carta.woff2", 99, "normal")],
            "not between 100 and 900",
        ),
        (
            vec![font("Carta", "fonts/carta.woff2", 901, "normal")],
            "not between 100 and 900",
        ),
        (
            vec![font("Carta", "fonts/carta.woff2", 400, "oblique")],
            "unknown variant",
        ),
        (
            vec![
                font("Carta", "fonts/carta.woff2", 400, "normal"),
                font("carta", "fonts/carta.woff2", 400, "normal"),
            ],
            "twice",
        ),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_font_theme(
            &root,
            "test.peso",
            &font_list(&entries),
            &[("fonts/carta.woff2", woff2(16))],
        );
        let error = fub_host::theme::install_theme(&config, &root).expect_err("refused");
        malformed_because(error, why);
    }

    // Gli estremi reggono.
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_font_theme(
        &root,
        "test.estremi",
        &font_list(&[
            font("Carta", "fonts/carta.woff2", 100, "normal"),
            font("Carta", "fonts/carta.woff2", 900, "italic"),
        ]),
        &[("fonts/carta.woff2", woff2(16))],
    );
    fub_host::theme::install_theme(&config, &root).expect("100 and 900 install");
}

/// Al massimo otto caratteri: l'ottavo regge, il nono no.
#[test]
fn at_most_eight_fonts() {
    let names: Vec<String> = (1..=9).map(|n| format!("fonts/f{n}.woff2")).collect();
    let files: Vec<(&str, Vec<u8>)> = names
        .iter()
        .map(|name| (name.as_str(), woff2(16)))
        .collect();
    let entries: Vec<String> = names
        .iter()
        .enumerate()
        .map(|(n, name)| font(&format!("Carta {n}"), name, 400, "normal"))
        .collect();

    let (_config_dir, config) = folders();
    let (_eight_dir, eight) = folders();
    write_font_theme(&eight, "test.otto", &font_list(&entries[..8]), &files[..8]);
    fub_host::theme::install_theme(&config, &eight).expect("eight fonts install");

    let (_nine_dir, nine) = folders();
    write_font_theme(&nine, "test.nove", &font_list(&entries), &files);
    let error = fub_host::theme::install_theme(&config, &nine).expect_err("the ninth is refused");
    malformed_because(error, "9 fonts declared, at most 8");
}

/// 2 MiB l'uno: un byte di più è rifiutato.
#[test]
fn a_font_file_weighs_at_most_two_mib() {
    let limit = fub_abi::theme::MAX_THEME_FONT_BYTES as usize;
    let (_config_dir, config) = folders();
    let (_ok_dir, ok) = folders();
    write_font_theme(
        &ok,
        "test.giusto",
        &font_list(&[font("Carta", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", woff2(limit))],
    );
    fub_host::theme::install_theme(&config, &ok).expect("2 MiB install");

    let (_big_dir, big) = folders();
    write_font_theme(
        &big,
        "test.grosso",
        &font_list(&[font("Carta", "fonts/carta.woff2", 400, "normal")]),
        &[("fonts/carta.woff2", woff2(limit + 1))],
    );
    let error = fub_host::theme::install_theme(&config, &big).expect_err("2 MiB + 1 is refused");
    malformed_because(error, "exceeds 2097152 bytes");
}

/// 6 MiB in tutto: esatti reggono, 6 MiB e un byte no. Un file nominato da due
/// voci si conta una volta.
#[test]
fn the_fonts_weigh_at_most_six_mib_together() {
    let each = fub_abi::theme::MAX_THEME_FONT_BYTES as usize;
    let entries = |last: &str| {
        font_list(&[
            font("Carta", "fonts/a.woff2", 400, "normal"),
            font("Carta", "fonts/b.woff2", 700, "normal"),
            font("Carta", "fonts/c.woff2", 400, "italic"),
            font("Carta", "fonts/c.woff2", 700, "italic"),
            font("Carta", last, 300, "normal"),
        ])
    };

    let (_config_dir, config) = folders();
    let (_ok_dir, ok) = folders();
    write_font_theme(
        &ok,
        "test.sei",
        &entries("fonts/c.woff2"),
        &[
            ("fonts/a.woff2", woff2(each)),
            ("fonts/b.woff2", woff2(each)),
            ("fonts/c.woff2", woff2(each)),
        ],
    );
    fub_host::theme::install_theme(&config, &ok).expect("6 MiB exactly install");

    let (_big_dir, big) = folders();
    write_font_theme(
        &big,
        "test.troppo",
        &entries("fonts/d.woff2"),
        &[
            ("fonts/a.woff2", woff2(each)),
            ("fonts/b.woff2", woff2(each)),
            ("fonts/c.woff2", woff2(each)),
            ("fonts/d.woff2", woff2(4)),
        ],
    );
    let error = fub_host::theme::install_theme(&config, &big).expect_err("6 MiB + 4 is refused");
    malformed_because(error, "exceed 6291456 bytes together");

    // Un byte solo sopra il tetto.
    let (_byte_dir, byte) = folders();
    write_font_theme(
        &byte,
        "test.byte",
        &entries("fonts/d.woff2"),
        &[
            ("fonts/a.woff2", woff2(each)),
            ("fonts/b.woff2", woff2(each)),
            ("fonts/c.woff2", woff2(each - 3)),
            ("fonts/d.woff2", woff2(4)),
        ],
    );
    let error = fub_host::theme::install_theme(&config, &byte).expect_err("6 MiB + 1 is refused");
    malformed_because(error, "exceed 6291456 bytes together");
}

/// `theme-1` è congelato e non impara i caratteri.
#[test]
fn fonts_need_theme_2() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(
        &root,
        "test.vecchio",
        "theme-1",
        &format!(
            r#", "fonts": {}"#,
            font_list(&[font("Carta", "fonts/carta.woff2", 400, "normal")])
        ),
    );
    std::fs::create_dir_all(root.join("fonts")).unwrap();
    std::fs::write(root.join("fonts/carta.woff2"), woff2(16)).unwrap();
    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-1 has no fonts");
    malformed_because(error, "fonts need `theme-2`");
}

// --- le icone di un tema (PA T40) --------------------------------------------

/// Un tema `theme-2` che parte dalla serie e nomina un set di icone: `file` è
/// il valore di `icons` nel manifest, `set` il testo da scrivere in
/// `icons.json` (se c'è).
fn write_icon_theme(root: &Utf8Path, id: &str, file: &str, set: Option<&[u8]>) {
    std::fs::create_dir_all(root).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Icone", "version": "1.0.0", "engine": "theme-2", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"], "extends": "fub.serie", "icons": "{file}"}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    if let Some(set) = set {
        std::fs::write(root.join("icons.json"), set).unwrap();
    }
}

/// Il testo di un set di `count` icone, ognuna con `paths` tracciati `d`.
fn icon_set(count: usize, paths: usize, d: &str) -> String {
    let list = vec![format!("\"{d}\""); paths].join(", ");
    let entries: Vec<String> = (0..count)
        .map(|n| format!("\"icona-{n}\": [{list}]"))
        .collect();
    format!("{{{}}}", entries.join(", "))
}

fn icons_refused(set: &str, why: &str) {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_icon_theme(&root, "test.icone", "icons.json", Some(set.as_bytes()));
    let error = fub_host::theme::install_theme(&config, &root)
        .expect_err(&format!("refused because {why}"));
    malformed_because(error, why);
}

/// Un tema che ridisegna qualche icona si installa, anche con un nome che oggi
/// nessuno disegna, e il fascio porta il set anche se nessun CSS lo nomina.
#[test]
fn a_theme_with_icons_installs_and_carries_the_set() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    let set = r#"{"search": ["M4 4h16v16H4z", "M8 12h8"], "folder": ["M3 6h18v12H3z"], "modulo-spento": ["M12 3v18"]}"#;
    write_icon_theme(&root, "test.icone", "icons.json", Some(set.as_bytes()));
    fub_host::theme::install_theme(&config, &root).expect("a theme with icons installs");

    let payload =
        fub_host::theme::read_theme(&config, "test.icone", fub_abi::theme::ThemeLight::Dark)
            .expect("reads");
    assert_eq!(payload.manifest.icons.as_deref(), Some("icons.json"));
    assert_eq!(
        payload.assets.get("theme://test.icone/icons.json"),
        Some(&set.as_bytes().to_vec())
    );
}

/// Il file del set è un `<nome>.json` minuscolo accanto al manifest, e c'è.
#[test]
fn the_icon_set_must_be_a_json_asset_beside_the_manifest() {
    for (file, why) in [
        ("manifest.json", "is not a theme asset"),
        ("Icons.json", "is not a theme asset"),
        ("icone/icons.json", "is not a theme asset"),
        ("../icons.json", "is not a theme asset"),
        ("theme://test.icone/icons.json", "is not a theme asset"),
        ("icons.svg", "is not a theme asset"),
        ("altre.json", "is not among the theme assets"),
    ] {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_icon_theme(
            &root,
            "test.icone",
            file,
            Some(br#"{"search": ["M0 0h1"]}"#),
        );
        let error = fub_host::theme::install_theme(&config, &root)
            .expect_err(&format!("`{file}` is refused"));
        malformed_because(error, why);
    }
}

/// Un `d` con markup, virgolette o un riferimento non è un tracciato.
#[test]
fn an_icon_accepts_only_path_data() {
    for set in [
        r#"{"search": ["M0 0\"/><script>alert(1)</script><path d=\""]}"#,
        r#"{"search": ["M0 0<"]}"#,
        r#"{"search": ["M0 0 url(#x)"]}"#,
        r#"{"search": [""]}"#,
        "{\"search\": [\"M0\u{a0}0\"]}",
    ] {
        icons_refused(set, "accepts only SVG path data");
    }
    icons_refused(r#"{"Search": ["M0 0h1"]}"#, "lowercase ASCII letters");
    icons_refused(r#"{"search": "M0 0h1"}"#, "is not a list of path data");
    icons_refused(r#"{"search": [1, 2]}"#, "is not a list of path data");
    icons_refused(r#"["search"]"#, "is not a JSON object");
    icons_refused("{ non è json", "is not a JSON object");
}

/// Al massimo 512 nomi, 8 tracciati e 4 KB per nome, 256 KB in tutto.
#[test]
fn the_icon_set_limits_hold_at_their_edges() {
    let accepted = |set: &str| {
        let (_config_dir, config) = folders();
        let (_dir, root) = folders();
        write_icon_theme(&root, "test.icone", "icons.json", Some(set.as_bytes()));
        fub_host::theme::install_theme(&config, &root).expect("at the edge installs");
    };

    accepted(&icon_set(512, 1, "M0 0h1"));
    icons_refused(&icon_set(513, 1, "M0 0h1"), "at most 512 are allowed");

    accepted(&icon_set(1, 8, "M0 0h1"));
    icons_refused(&icon_set(1, 9, "M0 0h1"), "must have 1 to 8 paths");
    icons_refused(r#"{"search": []}"#, "must have 1 to 8 paths");

    accepted(&icon_set(1, 1, &"M".repeat(4096)));
    accepted(&icon_set(1, 2, &"M".repeat(2048)));
    icons_refused(
        &icon_set(1, 1, &"M".repeat(4097)),
        "exceeds 4096 bytes of path data",
    );

    // 256 KB in tutto: spazi fra le voci portano il file al tetto esatto, poi
    // un byte oltre.
    let base = icon_set(100, 1, "M0 0h1");
    let full = format!("{}{}", " ".repeat(256 * 1024 - base.len()), base);
    assert_eq!(full.len(), 256 * 1024);
    accepted(&full);
    icons_refused(&format!(" {full}"), "exceeds 262144 bytes");
}

/// `theme-1` è congelato e non impara le icone.
#[test]
fn icons_need_theme_2() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(
        &root,
        "test.vecchio",
        "theme-1",
        r#", "icons": "icons.json""#,
    );
    std::fs::write(root.join("icons.json"), r#"{"search": ["M0 0h1"]}"#).unwrap();
    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-1 has no icons");
    malformed_because(error, "icons need `theme-2`");
}
