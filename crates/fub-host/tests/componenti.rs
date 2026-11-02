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

// ---------------------------------------------------------------------------
// Lo stato dei componenti nel vault: `components.*` accanto a
// `plugins.disabled`, e la lavagna che spenta non registra `.canvas`.

use componenti::{Azione, Orfani, Perche};
use serde_json::Value;

fn host(root: &Utf8PathBuf) -> fub_host::Host {
    let host = fub_host::Host::new();
    host.open(root).expect("the vault opens");
    host
}

fn extensions(host: &fub_host::Host, root: &Utf8PathBuf) -> BTreeSet<String> {
    // Riaprire dà il `VaultInfo` del vault montato adesso.
    host.open(root)
        .expect("the vault opens")
        .extensions
        .into_iter()
        .collect()
}

fn bundles(host: &fub_host::Host) -> BTreeSet<String> {
    host.bundles(None)
        .expect("bundles")
        .into_iter()
        .filter(|bundle| bundle.mounted)
        .map(|bundle| bundle.id)
        .collect()
}

/// `plugins.disabled` e `components.*` come stanno nel file del vault.
fn keys(root: &Utf8PathBuf) -> Vec<(String, Value)> {
    let path = root.join(".fub").join("settings.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let file: Value = serde_json::from_str(&text).expect("settings json");
    let mut keys: Vec<(String, Value)> = file["values"]
        .as_object()
        .map(|values| {
            values
                .iter()
                .filter(|(k, _)| *k == "plugins.disabled" || k.starts_with("components."))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default();
    keys.sort_by(|a, b| a.0.cmp(&b.0));
    keys
}

fn apply(host: &fub_host::Host, azione: Azione) {
    let esito = host
        .apply_components(None, azione.clone(), true)
        .expect("the host answers")
        .unwrap_or_else(|rifiuto| panic!("{azione:?} refused: {rifiuto:?}"));
    assert!(esito.applicato);
}

fn spegni(host: &fub_host::Host, id: &str, orfani: Orfani) {
    apply(
        host,
        Azione::Spegni {
            id: id.into(),
            anche_questi: false,
            orfani,
        },
    );
}

fn accendi(host: &fub_host::Host, id: &str) {
    apply(host, Azione::Accendi { id: id.into() });
}

fn perche(host: &fub_host::Host, id: &str) -> Perche {
    host.components(None)
        .expect("components")
        .righe
        .into_iter()
        .find(|riga| riga.id == id)
        .unwrap_or_else(|| panic!("no row `{id}`"))
        .perche
}

#[test]
fn the_canvas_goes_away_with_the_lavagna_and_comes_back() {
    let (_dir, root) = vault();
    let host = host(&root);
    let before = extensions(&host, &root);
    assert!(before.contains("canvas"), "{before:?}");

    spegni(&host, componenti::LAVAGNA, Orfani::Chiedi);
    let off = extensions(&host, &root);
    assert!(!off.contains("canvas"), "{off:?}");
    // Anche da un host nuovo, che legge il vault da capo.
    host.close();
    assert!(!extensions(&self::host(&root), &root).contains("canvas"));

    let host = self::host(&root);
    accendi(&host, componenti::LAVAGNA);
    assert_eq!(extensions(&host, &root), before);
}

#[test]
fn kept_and_waiting_survive_a_reopen() {
    let (_dir, root) = vault();
    let host = host(&root);
    spegni(&host, componenti::PDF, Orfani::Chiedi);
    // La lavagna richiede ancora la penna.
    assert!(matches!(perche(&host, "fub.penna"), Perche::RichiestoDa(_)));
    spegni(&host, componenti::LAVAGNA, Orfani::Chiedi);
    assert_eq!(perche(&host, "fub.penna"), Perche::InAttesa);
    host.close();
    let host = self::host(&root);
    assert_eq!(perche(&host, "fub.penna"), Perche::InAttesa, "waiting");

    // «Tienili».
    apply(
        &host,
        Azione::Rispondi {
            orfani: Orfani::Tieni,
            ids: vec!["fub.penna".into()],
        },
    );
    assert_eq!(perche(&host, "fub.penna"), Perche::Scelto);
    host.close();
    let host = self::host(&root);
    assert_eq!(perche(&host, "fub.penna"), Perche::Scelto, "kept");
}

#[test]
fn keep_while_turning_off_survives_a_reopen() {
    let (_dir, root) = vault();
    let host = host(&root);
    spegni(&host, componenti::PDF, Orfani::Chiedi);
    spegni(&host, componenti::LAVAGNA, Orfani::Tieni);
    assert_eq!(perche(&host, "fub.penna"), Perche::Scelto);
    host.close();
    assert_eq!(perche(&self::host(&root), "fub.penna"), Perche::Scelto);
}

#[test]
fn a_vault_without_the_keys_mounts_the_same_bundles() {
    let (_dir, root) = vault();
    let host = host(&root);
    assert!(keys(&root).is_empty(), "{:?}", keys(&root));
    let components = host.components(None).expect("components");
    assert!(components.mancanti.is_empty());
    assert_eq!(components.profilo, None);
    let mounted: BTreeSet<String> = bundles(&host);
    let before: BTreeSet<String> = before().into_iter().map(str::to_string).collect();
    assert_eq!(mounted, before);
}

/// Il cancello: spegnere e riaccendere lavagna e PDF lascia le chiavi, i
/// bundle e i formati montati come prima. Con «Tienili» no, ed è giusto: la
/// penna tenuta resta una scelta (`components.kept`).
#[test]
fn turning_lavagna_and_pdf_off_and_on_leaves_everything_as_it_was() {
    for orfani in [Orfani::Chiedi, Orfani::Togli] {
        let (_dir, root) = vault();
        let host = host(&root);
        let keys_before = keys(&root);
        let bundles_before = bundles(&host);
        let extensions_before = extensions(&host, &root);

        spegni(&host, componenti::PDF, orfani);
        spegni(&host, componenti::LAVAGNA, orfani);
        accendi(&host, componenti::LAVAGNA);
        accendi(&host, componenti::PDF);

        assert_eq!(keys(&root), keys_before, "{orfani:?}: the keys");
        assert_eq!(bundles(&host), bundles_before, "{orfani:?}: the bundles");
        assert_eq!(
            extensions(&host, &root),
            extensions_before,
            "{orfani:?}: the formats"
        );
        assert!(matches!(perche(&host, "fub.penna"), Perche::RichiestoDa(_)));
    }
}

/// Gli eventi che escono dal ponte, come li vede la WebView.
struct Uscita(std::sync::Mutex<Vec<fub_abi::Event>>);

impl fub_host::EventSink for Uscita {
    fn emit(&self, notice: &fub_abi::Notice) -> fub_host::Delivery {
        self.0.lock().unwrap().push(notice.event.clone());
        fub_host::Delivery::Done
    }
}

impl Uscita {
    /// Aspetta che dopo un `VaultClosed` di `root` esca un `VaultOpened` dello
    /// stesso vault. Il ponte consegna da un suo thread: l'attesa è parte di
    /// ciò che si prova, e se l'avviso non arriva il test cade sul tempo.
    fn riaperto(&self, root: &str) -> bool {
        let fine = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < fine {
            {
                let visti = self.0.lock().unwrap();
                let chiuso = visti.iter().position(
                    |e| matches!(e, fub_abi::Event::VaultClosed { root: r } if r == root),
                );
                if let Some(chiuso) = chiuso {
                    if visti[chiuso..]
                        .iter()
                        .any(|e| matches!(e, fub_abi::Event::VaultOpened { root: r } if r == root))
                    {
                        return true;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }
}

/// **La shell sa quando il vault si rimonta**, da qualunque strada arrivi la
/// scelta: dalla porta dell'app (`Host::apply_components`, ciò che chiama
/// `components_apply`) e dal canale di controllo (CLI, MCP con l'app aperta).
/// La chiusura esce come `VaultClosed`; dopo, esce un `VaultOpened`.
#[test]
fn a_remount_tells_the_shell_the_vault_is_open_again() {
    let (_dir, root) = vault();
    let uscita = Arc::new(Uscita(std::sync::Mutex::new(Vec::new())));
    let host = fub_host::Host::new().with_sink(uscita.clone());
    let info = host.open(&root).expect("the vault opens");
    let canonica = info.root.to_string();

    // La strada dell'app.
    uscita.0.lock().unwrap().clear();
    spegni(&host, componenti::LAVAGNA, Orfani::Chiedi);
    assert!(
        uscita.riaperto(&canonica),
        "app: no VaultOpened after the remount: {:?}",
        uscita.0.lock().unwrap()
    );

    // La strada del canale di controllo.
    uscita.0.lock().unwrap().clear();
    let risposta = fub_host::control::answer(
        &host,
        fub_host::control::Call::ApplyComponents {
            vault: None,
            azione: Azione::Accendi {
                id: componenti::LAVAGNA.into(),
            },
            apply: true,
        },
    )
    .expect("the control channel answers");
    assert_eq!(risposta["Ok"]["applicato"], true, "{risposta}");
    assert!(
        uscita.riaperto(&canonica),
        "control: no VaultOpened after the remount: {:?}",
        uscita.0.lock().unwrap()
    );
}
