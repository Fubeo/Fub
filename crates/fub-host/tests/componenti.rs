//! **La mappa dei componenti è ciò che l'host monta**, e non cambia che cosa
//! monta.
//!
//! Un `Host` di default su un vault temporaneo monta esattamente i bundle di
//! prima della mappa (l'elenco è scritto qui, preso da `main` prima del
//! cambio); ogni bundle montato che non è un tema è una riga della mappa o sta
//! nel nucleo; il manifest di ogni bundle con una riga dice ciò che dice la
//! riga; e `plugins.disabled` spegne ancora un componente solo.

use std::collections::BTreeSet;
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_host::componenti;
use fub_host::registry::BundleKind;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, root)
}

#[cfg_attr(not(feature = "graph"), allow(dead_code))]
fn disable(root: &Utf8PathBuf, ids: &[&str]) {
    std::fs::create_dir_all(root.join(".fub")).unwrap();
    std::fs::write(
        root.join(".fub").join("settings.json"),
        serde_json::json!({"version": 1, "values": {"plugins.disabled": ids}}).to_string(),
    )
    .unwrap();
}

/// I bundle montati da un `Host` di default: `(id, è un tema)`.
fn mounted(root: &Utf8PathBuf) -> Vec<(String, bool)> {
    let host = fub_host::Host::new();
    host.open(root).expect("the vault opens");
    host.bundles(None)
        .expect("bundles")
        .into_iter()
        .filter(|bundle| bundle.mounted)
        .map(|bundle| (bundle.id, bundle.kind == BundleKind::Theme))
        .collect()
}

/// I bundle che `main` montava prima della mappa, con le feature di questa
/// build.
fn before() -> BTreeSet<&'static str> {
    let always = [
        "fub.core",
        "fub.maintenance",
        "fub.markdown",
        "fub.importers",
        "fub.serie",
    ];
    let with_feature = [
        ("fub.rich", cfg!(feature = "rich")),
        ("fub.xlsx", cfg!(feature = "xlsx")),
        ("fub.search", cfg!(feature = "search")),
        ("fub.versioning", cfg!(feature = "versioning")),
        ("fub.backlinks", cfg!(feature = "backlinks")),
        ("fub.outline", cfg!(feature = "outline")),
        ("fub.tags", cfg!(feature = "tags")),
        ("fub.properties", cfg!(feature = "properties")),
        ("fub.template", cfg!(feature = "template")),
        ("fub.queries", cfg!(feature = "queries")),
        ("fub.dashboard", cfg!(feature = "dashboard")),
        ("fub.backup", cfg!(feature = "backup")),
        ("fub.trash", cfg!(feature = "trash")),
        ("fub.graph", cfg!(feature = "graph")),
        ("fub.formatting", cfg!(feature = "formatting")),
        ("fub.proof", cfg!(feature = "proof")),
        ("fub.stats", cfg!(feature = "stats")),
        ("fub.base", cfg!(feature = "base")),
        ("fub.commands", cfg!(feature = "commands")),
        ("fub.blocks", cfg!(feature = "blocks")),
        ("fub.draw", cfg!(feature = "draw")),
        ("fub.sync", cfg!(feature = "http-client")),
        ("fub.publish", cfg!(feature = "http-client")),
        ("fub.updates", cfg!(feature = "http-client")),
        ("fub.linkcard", cfg!(feature = "http-client")),
    ];
    always
        .into_iter()
        .chain(
            with_feature
                .into_iter()
                .filter(|(_, on)| *on)
                .map(|(id, _)| id),
        )
        .collect()
}

#[test]
fn a_default_host_mounts_the_same_bundles() {
    let (_dir, root) = vault();
    let mounted: BTreeSet<String> = mounted(&root).into_iter().map(|(id, _)| id).collect();
    let before: BTreeSet<String> = before().into_iter().map(str::to_string).collect();
    assert_eq!(mounted, before, "the map changed which bundles mount");
}

#[test]
fn every_mounted_bundle_is_a_row_or_a_theme() {
    let (_dir, root) = vault();
    let map = componenti::mappa();
    let mut themes = 0;
    for (id, theme) in mounted(&root) {
        if theme {
            assert!(
                map.componente(&id).is_none(),
                "the theme `{id}` is not a component"
            );
            themes += 1;
            continue;
        }
        assert!(
            map.componente(&id).is_some() || componenti::NUCLEO.contains(&id.as_str()),
            "`{id}` is mounted and is not a row of the map"
        );
        let row = componenti::riga(&id).expect("a row");
        assert!(
            row.bundle,
            "`{id}` is mounted and its row says it is not a bundle"
        );
    }
    assert!(themes > 0, "the series theme is mounted");
}

/// The manifest of every bundle that the host builds from a row carries the
/// row: `uses`, `kind`, `group`, `ui`, and the same `provides` and `requires`
/// (without those that are only of the map).
#[test]
fn the_manifest_says_what_the_row_says() {
    let (_dir, root) = vault();
    let mounted = fub_host::mount::mount(
        &root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount succeeds");

    let mut ids: Vec<&str> = fub_features::every_official_feature()
        .iter()
        .map(|feature| feature.id)
        .collect();
    #[cfg(feature = "rich")]
    ids.push("fub.rich");
    #[cfg(feature = "xlsx")]
    ids.push("fub.xlsx");
    let strings = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    for id in &ids {
        let row = componenti::riga(id).unwrap_or_else(|| panic!("`{id}` has no row"));
        let manifest = mounted
            .registry
            .body(id)
            .unwrap_or_else(|| panic!("`{id}` is not mounted"))
            .manifest();
        assert_eq!(manifest.uses, strings(row.uses), "uses of `{id}`");
        assert_eq!(manifest.kind, row.kind, "kind of `{id}`");
        assert_eq!(
            manifest.group.as_deref(),
            Some(row.gruppo),
            "group of `{id}`"
        );
        assert_eq!(manifest.ui, strings(row.ui), "ui of `{id}`");
        assert_eq!(
            manifest.provides,
            strings(row.provides),
            "provides of `{id}`"
        );
        assert_eq!(
            manifest.requires,
            strings(&row.requires_del_manifest()),
            "requires of `{id}`"
        );
    }
}

#[cfg(feature = "graph")]
#[test]
fn disabling_the_graph_turns_off_only_the_graph() {
    let (_dir, root) = vault();
    disable(&root, &["fub.graph"]);
    let mounted: BTreeSet<String> = mounted(&root).into_iter().map(|(id, _)| id).collect();
    let mut expected: BTreeSet<String> = before().into_iter().map(str::to_string).collect();
    expected.remove("fub.graph");
    assert_eq!(mounted, expected);
}

/// Built without `rich`, the two rows of the documents go with the codec; the
/// sheets stay if `xlsx` is on.
#[test]
fn the_rows_follow_the_cargo_features() {
    let ids: BTreeSet<&str> = componenti::righe().iter().map(|row| row.id).collect();
    assert_eq!(ids.contains("fub.rich"), cfg!(feature = "rich"));
    assert_eq!(ids.contains("fub.motore-documenti"), cfg!(feature = "rich"));
    assert_eq!(ids.contains("fub.xlsx"), cfg!(feature = "xlsx"));
    assert_eq!(ids.contains("fub.motore-fogli"), cfg!(feature = "xlsx"));
    assert_eq!(ids.contains("fub.sync"), cfg!(feature = "http-client"));
    assert_eq!(ids.contains("fub.graph"), cfg!(feature = "graph"));
}
