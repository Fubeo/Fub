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
use fub_host::{Host, NoWatcher};

/// L'albero di un tema installabile: manifest valido + un foglio qualsiasi.
/// Il contenuto del foglio non conta (i cancelli CSS girano nella shell), ma
/// un tema senza file oltre al manifest non è una cartella realistica.
fn write_theme(root: &Utf8Path, id: &str, engine: &str, extra: &str) {
    std::fs::create_dir_all(root).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Prova", "version": "1.0.0", "engine": "{engine}", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/"{extra}}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    std::fs::write(root.join("sheet.css"), "body { color: #333; }\n").unwrap();
}

fn folders() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

fn installed(config: &Utf8Path) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
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
