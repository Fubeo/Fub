//! Ciò che rende [`fub_features::every_official_feature`] **la sorgente**
//! invece di una copia in più.
//!
//! Un inventario delle feature ufficiali si può scrivere in due modi che
//! sembrano lo stesso e non lo sono. Il primo è un elenco che *descrive* la
//! registrazione: comodo per i presidi, e falso il giorno in cui qualcuno
//! registra qualcosa senza passare di lì — nessun test diventa rosso, perché
//! ogni test che itera l'inventario continua a vedere ciò che l'inventario dice.
//! È il difetto del
//! [§16.7](../../../docs/project/roadmap.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! spostato di un file, non chiuso.
//!
//! Il secondo è un elenco da cui la registrazione **discende**, ed è quello che
//! `mount` fa adesso: le righe letterali non ci sono più, il ciclo legge
//! l'inventario. Ma «discende» è una proprietà del codice di oggi, e domani
//! qualcuno può sempre aggiungere un `CoreBundle` a mano accanto al ciclo — la
//! strada per farlo è aperta e deve restarlo, perché è la stessa da cui passano
//! i bundle infrastrutturali dell'host, che nell'inventario delle feature non
//! ci sono.
//!
//! Questo file è ciò che chiude il varco. Monta un workspace vero e confronta
//! **insiemi**, nelle due direzioni, su due giri concentrici:
//!
//! - i **bundle** dichiarati sono esattamente le feature dell'inventario più i
//!   bundle infrastrutturali dell'host: `fub.core`, `fub.maintenance`,
//!   `fub.markdown`, `fub.sheet`, il tema di serie e `fub.importers` (sempre),
//!   più `fub.sync` e `fub.publish` solo con la cargo feature `http-client`.
//!   Una feature registrata a mano è rossa qui;
//! - le **view** montate sono esattamente quelle che i provider dell'inventario
//!   dichiarano, più `sync.status`/`sync.versions`/`sync.conflicts` e
//!   `publish.sites` solo con `http-client`. Una view registrata a mano è
//!   rossa qui.
//!
//! I due giri non si implicano: una feature può montarsi senza registrare
//! niente — è lo stato in cui sta il versioning spento (§11.1) — e una view può
//! comparire da un bundle che con l'inventario non c'entra. Sono due domande, e
//! vanno fatte tutte e due.
//!
//! Un terzo giro guarda ciò che una riga dichiara oltre ai provider: le
//! impostazioni arrivano al bundle montato, e un servizio richiesto che manca
//! tiene fuori chi lo richiede. Il ciclo di mount non confronta id, quindi
//! queste proprietà discendono dalla riga o non ci sono.

use std::collections::BTreeSet;
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_host::CORE_ID;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, root)
}

fn mount(root: &Utf8PathBuf) -> fub_host::Mounted {
    fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount succeeds")
}

#[test]
fn declared_bundles_are_inventory_plus_host_infrastructure() {
    let (_dir, root) = vault();
    let mounted = mount(&root);

    let declared: BTreeSet<String> = mounted
        .registry
        .inventory()
        .into_iter()
        .map(|bundle| bundle.id)
        .collect();

    #[allow(unused_mut)]
    let mut expected: BTreeSet<String> = fub_features::every_official_feature()
        .iter()
        .map(|feature| feature.id.to_string())
        .chain([
            CORE_ID.to_string(),
            fub_kernel::maintenance::MAINTENANCE_ID.to_string(),
            "fub.markdown".to_string(),
            "fub.sheet".to_string(),
            fub_host::theme::SERIES_ID.to_string(),
            fub_importers::PLUGIN_ID.to_string(),
        ])
        .collect();
    #[cfg(feature = "http-client")]
    {
        expected.insert(fub_host::remote::views::SYNC_ID.to_string());
        expected.insert(fub_host::publish::views::PUBLISH_ID.to_string());
    }

    let extra: Vec<&String> = declared.difference(&expected).collect();
    assert!(
        extra.is_empty(),
        "these bundles are declared but neither the official feature inventory nor the host infrastructure names them: {extra:?}\n\
         Someone registered them by hand and the inventory guards no longer see them"
    );

    let missing: Vec<&String> = expected.difference(&declared).collect();
    assert!(
        missing.is_empty(),
        "these bundles are promised but not declared: {missing:?}\n\
         The mount table and its authoritative inventories have diverged"
    );

    assert_eq!(
        declared.len(),
        expected.len(),
        "the only bundles outside `fub-features` are the host infrastructure bundles"
    );
}

#[test]
fn mounted_views_are_exactly_the_inventory_views() {
    let (_dir, root) = vault();
    let mounted = mount(&root);

    let mounted_views: BTreeSet<String> = mounted
        .workspace
        .views()
        .into_iter()
        .map(|spec| spec.id)
        .collect();

    #[allow(unused_mut)]
    let mut promised: BTreeSet<String> = fub_features::every_official_view()
        .flat_map(|feature| (feature.view.expect("is a row with a view"))().views())
        .map(|spec| spec.id)
        .collect();
    #[cfg(feature = "http-client")]
    {
        promised.insert(fub_host::remote::views::SYNC_STATUS_VIEW.to_string());
        promised.insert(fub_host::remote::views::SYNC_VERSIONS_VIEW.to_string());
        promised.insert(fub_host::remote::views::SYNC_CONFLICTS_VIEW.to_string());
        promised.insert(fub_host::publish::views::PUBLISH_SITES_VIEW.to_string());
    }

    assert!(
        !promised.is_empty(),
        "the inventory promises no view: a guard that iterates zero elements always passes"
    );

    let extra: Vec<&String> = mounted_views.difference(&promised).collect();
    assert!(
        extra.is_empty(),
        "these views are mounted but the inventory does not name them: {extra:?}\n\
         Someone registered them by hand, bypassing `fub_features::every_official_view`"
    );

    let missing: Vec<&String> = promised.difference(&mounted_views).collect();
    assert!(
        missing.is_empty(),
        "these views are in the inventory but not mounted: {missing:?}\n\
         Either the mount loop no longer picks them up, or their bundle did not register"
    );
}

fn declared_plugins(mounted: &fub_host::Mounted) -> BTreeSet<String> {
    mounted
        .workspace
        .plugins()
        .into_iter()
        .map(|plugin| plugin.id)
        .collect()
}

#[test]
fn declared_settings_reach_the_mounted_bundle() {
    let (_dir, root) = vault();
    let mounted = mount(&root);

    let mut checked = 0;
    for feature in fub_features::every_official_feature() {
        let Some(build) = feature.settings else {
            continue;
        };
        let promised: BTreeSet<String> = build().into_iter().map(|spec| spec.key).collect();
        let entries = match mounted.workspace.query_index(IndexQuery::Settings {
            plugin: Some(feature.id.to_string()),
        }) {
            Ok(IndexResult::Settings(entries)) => entries,
            other => panic!("settings of `{}` answered {other:?}", feature.id),
        };
        let mounted_keys: BTreeSet<String> =
            entries.into_iter().map(|entry| entry.spec.key).collect();
        let missing: Vec<&String> = promised.difference(&mounted_keys).collect();
        assert!(
            missing.is_empty(),
            "`{}` declares {missing:?} in the inventory but its mounted bundle does not",
            feature.id
        );
        checked += 1;
    }
    assert!(
        checked > 0,
        "no row declares settings: a guard that iterates zero elements always passes"
    );
}

#[test]
fn a_required_service_that_is_off_keeps_its_dependent_out() {
    let features = fub_features::every_official_feature();
    let mut checked = 0;
    for dependent in features
        .iter()
        .filter(|feature| !feature.requires.is_empty())
    {
        let providers: Vec<&str> = features
            .iter()
            .filter(|feature| {
                feature
                    .provides
                    .iter()
                    .any(|service| dependent.requires.contains(service))
            })
            .map(|feature| feature.id)
            .collect();
        assert!(
            !providers.is_empty(),
            "`{}` requires {:?} and no row provides it",
            dependent.id,
            dependent.requires
        );

        let (_dir, root) = vault();
        std::fs::create_dir_all(root.join(".fub")).unwrap();
        std::fs::write(
            root.join(".fub").join("settings.json"),
            serde_json::json!({"version": 1, "values": {"plugins.disabled": providers}})
                .to_string(),
        )
        .unwrap();
        let declared = declared_plugins(&mount(&root));
        for provider in &providers {
            assert!(!declared.contains(*provider), "`{provider}` is disabled");
        }
        assert!(
            !declared.contains(dependent.id),
            "`{}` mounted although {providers:?}, which provide what it requires, are off",
            dependent.id
        );
        checked += 1;
    }
    assert!(
        checked > 0,
        "no row requires a service: a guard that iterates zero elements always passes"
    );
}
