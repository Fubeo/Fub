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
//! strada per farlo è aperta e deve restarlo, perché è la stessa da cui passa il
//! core, che nell'inventario non c'è.
//!
//! Questo file è ciò che chiude il varco. Monta un workspace vero e confronta
//! **insiemi**, nelle due direzioni, su due giri concentrici:
//!
//! - i **bundle** dichiarati sono esattamente le feature dell'inventario più
//!   `fub.core`, che è dell'host e non di `fub-features` (le sue chiavi
//!   stanno accanto al proprio schema, ed è anche il motivo per cui non si può
//!   spegnere). Una nona feature registrata a mano è rossa qui;
//! - le **view** montate sono esattamente quelle che i provider dell'inventario
//!   dichiarano. Una quinta view registrata a mano è rossa qui.
//!
//! I due giri non si implicano: una feature può montarsi senza registrare
//! niente — è lo stato in cui sta il versioning spento (§11.1) — e una view può
//! comparire da un bundle che con l'inventario non c'entra. Sono due domande, e
//! vanno fatte tutte e due.
//!
//! In ogni caso il difetto è lo stesso e vale la pena dirlo per esteso: da quel
//! momento **ogni presidio che itera l'inventario sta guardando altrove**, e lo
//! fa restando verde. Nessuno dei due si vede da dentro `fub-features`, che il
//! montaggio non lo fa: per questo il presidio sta qui, dove il montaggio c'è.
//! mount exists.

use std::collections::BTreeSet;
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_host::CORE_ID;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

/// Un vault vuoto: chi si dichiara lo si decide al montaggio, e cosa ci sia
/// dentro non cambia l'elenco.
fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    (dir, root)
}

/// Il montaggio come lo fa `Host::open`, meno la scansione: qui interessa chi si
/// è dichiarato, non cosa ha indicizzato.
///
/// Tutto **in memoria** — impostazioni di macchina e stato delle viste — perché
/// un test che leggesse la configurazione di chi lo esegue potrebbe trovarci un
/// `plugins.disabled` con dentro una feature, e diventerebbe rosso per una
/// scelta dell'utente invece che per un difetto del repo.
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
fn declared_bundles_are_inventory_plus_core() {
    let (_dir, root) = vault();
    let mounted = mount(&root);

    // L'inventario del registry e non `ids()`: quello elenca chi è **montato**,
    // e un bundle spento resterebbe fuori da entrambi gli insiemi senza dire
    // niente. Qui la domanda è chi la tabella di montaggio abbia dichiarato.
    let declared: BTreeSet<String> = mounted
        .registry
        .inventory()
        .into_iter()
        .map(|b| b.id)
        .collect();

    let expected: BTreeSet<String> = fub_features::every_official_feature()
        .iter()
        .map(|f| f.id.to_string())
        .chain([CORE_ID.to_string()])
        .chain([fub_host::theme::SERIES_ID.to_string()])
        .collect();

    let extra: Vec<&String> = declared.difference(&expected).collect();
    assert!(
        extra.is_empty(),
        "these bundles are declared but the inventory does not name them: {extra:?}\n\
         Someone registered them by hand, bypassing \
         `fub_features::every_official_feature`, and from now on guards that \
         iterate the inventory — starting with the catalog guard — do not \
         see them: their strings may be missing in a language without \
         anything turning red"
    );

    let missing: Vec<&String> = expected.difference(&declared).collect();
    assert!(
        missing.is_empty(),
        "these features are in the inventory but not declared: {missing:?}\n\
         The list promises something the user does not have, and guards are \
         testing it on a component that does not exist in the app"
    );

    // E le eccezioni sono **due e non più**: il core e il tema di serie sono
    // i soli bundle che non vengono da `fub-features` — l'host li porta
    // perché sono suoi (§29.4). Se domani ne comparisse un terzo, il conto
    // sotto lo direbbe.
    assert_eq!(
        declared.len(),
        fub_features::every_official_feature().len() + 2,
        "the only bundles that are not `fub-features` features are \
         `{CORE_ID}` and `{}`",
        fub_host::theme::SERIES_ID
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

    // Si passa **dai provider** e non da `FeatureUfficiale::id`, e la differenza
    // conta: l'id del componente e quello della view sono due cose diverse, e un
    // provider ha il diritto di offrirne più d'una. Confrontare gli id dei
    // componenti proverebbe che i bundle ci sono, non che le view ci sono.
    let promised: BTreeSet<String> = fub_features::every_official_view()
        .flat_map(|f| (f.view.expect("is a row with a view"))().views())
        .map(|spec| spec.id)
        .collect();

    assert!(
        !promised.is_empty(),
        "the inventory promises no view: a guard that iterates zero \
         elements always passes, and that is how this file would stop \
         saying anything"
    );

    let extra: Vec<&String> = mounted_views.difference(&promised).collect();
    assert!(
        extra.is_empty(),
        "these views are mounted but the inventory does not name them: {extra:?}\n\
         Someone registered them by hand, bypassing \
         `fub_features::every_official_view`, and from now on \
         `view_refresh_masks` and `conformity` skip them silently — which \
         is exactly the form of bug the inventory exists to catch"
    );

    let missing: Vec<&String> = promised.difference(&mounted_views).collect();
    assert!(
        missing.is_empty(),
        "these views are in the inventory but not mounted: {missing:?}\n\
         Either the `mount` loop no longer picks them up, or their bundle \
         did not register: in both cases feature guards are testing a panel \
         that does not exist in the app"
    );
}
