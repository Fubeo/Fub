//! Il tema di serie e la porta unica, i cancelli del manifest, theme-2 e le impostazioni che un tema dichiara.

use super::*;

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

pub(super) const SETTINGS: &str = r#", "settings": [
    {"name": "bordi", "label": "Bordi", "kind": {"kind": "toggle", "default": true}},
    {"name": "raggio", "label": "Raggio", "description": "Quanto sono tondi gli angoli.",
     "kind": {"kind": "number", "default": 8, "min": 0, "max": 16}},
    {"name": "trama", "label": "Trama", "kind": {"kind": "choice", "default": "fine",
     "options": [{"value": "fine", "label": "Fine"}, {"value": "grossa", "label": "Grossa"}]}}
]"#;

/// Le righe di configurazione di un tema, lette dalla porta di tutti.
pub(super) fn theme_entries(
    host: &Host,
    vault: &Utf8Path,
    id: &str,
) -> Vec<fub_abi::settings::SettingEntry> {
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
