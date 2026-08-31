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
//!   quattro bundle dell'host: `fub.core`, `fub.maintenance`, `fub.markdown` e
//!   il tema di serie. Una feature registrata a mano è rossa qui;
//! - le **view** montate sono esattamente quelle che i provider dell'inventario
//!   dichiarano. Una quinta view registrata a mano è rossa qui.
//!
//! I due giri non si implicano: una feature può montarsi senza registrare
//! niente — è lo stato in cui sta il versioning spento (§11.1) — e una view può
//! comparire da un bundle che con l'inventario non c'entra. Sono due domande, e
//! vanno fatte tutte e due.

use std::collections::BTreeSet;
use std::sync::Arc;

use camino::Utf8PathBuf;
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

    let expected: BTreeSet<String> = fub_features::every_official_feature()
        .iter()
        .map(|feature| feature.id.to_string())
        .chain([
            CORE_ID.to_string(),
            fub_kernel::maintenance::MAINTENANCE_ID.to_string(),
            "fub.markdown".to_string(),
            fub_host::theme::SERIES_ID.to_string(),
        ])
        .collect();

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
        fub_features::every_official_feature().len() + 4,
        "the only bundles outside `fub-features` are core, maintenance, markdown and the series theme"
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

    let promised: BTreeSet<String> = fub_features::every_official_view()
        .flat_map(|feature| (feature.view.expect("is a row with a view"))().views())
        .map(|spec| spec.id)
        .collect();

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
