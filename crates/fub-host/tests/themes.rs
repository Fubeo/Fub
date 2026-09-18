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
    assert!(payload.sheet.contains("#333"));
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

/// Un tema che parla un contratto più nuovo di [`THEME_ENGINE`] è respinto
/// **per nome** e prima di ogni altro passo: non è un difetto del tema, è un
/// tema che questo host non serve. Il disco non viene toccato.
#[test]
fn a_theme_with_a_newer_engine_is_rejected_before_installing() {
    let (_config_dir, config) = folders();
    let (_dir, root) = folders();
    write_theme(&root, "test.future", "theme-2", "");

    let error = fub_host::theme::install_theme(&config, &root).expect_err("theme-2 is not served");
    assert!(
        matches!(&error, fub_host::theme::ThemeError::Engine { id, .. } if id == "test.future"),
        "it is the engine that rejects it: {error}"
    );
    assert!(
        !fub_host::config::themes_dir(&config)
            .join("test.future")
            .exists(),
        "a rejected theme leaves nothing behind"
    );
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
