//! Ciò che rende [`fub_features::ogni_feature_ufficiale`] **la sorgente**
//! invece di una copia in più.
//!
//! Un inventario delle feature ufficiali si può scrivere in due modi che
//! sembrano lo stesso e non lo sono. Il primo è un elenco che *descrive* la
//! registrazione: comodo per i presidi, e falso il giorno in cui qualcuno
//! registra qualcosa senza passare di lì — nessun test diventa rosso, perché
//! ogni test che itera l'inventario continua a vedere ciò che l'inventario dice.
//! È il difetto del
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
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
fn monta(root: &Utf8PathBuf) -> fub_host::Mounted {
    fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
    )
    .expect("il montaggio riesce")
}

#[test]
fn i_bundle_dichiarati_sono_linventario_piu_il_core() {
    let (_dir, root) = vault();
    let montato = monta(&root);

    // L'inventario del registry e non `ids()`: quello elenca chi è **montato**,
    // e un bundle spento resterebbe fuori da entrambi gli insiemi senza dire
    // niente. Qui la domanda è chi la tabella di montaggio abbia dichiarato.
    let dichiarati: BTreeSet<String> = montato
        .registry
        .inventory()
        .into_iter()
        .map(|b| b.id)
        .collect();

    let attesi: BTreeSet<String> = fub_features::ogni_feature_ufficiale()
        .iter()
        .map(|f| f.id.to_string())
        .chain([CORE_ID.to_string()])
        .collect();

    let di_troppo: Vec<&String> = dichiarati.difference(&attesi).collect();
    assert!(
        di_troppo.is_empty(),
        "questi bundle sono dichiarati e l'inventario non li nomina: {di_troppo:?}\n\
         Qualcuno li ha registrati a mano scavalcando \
         `fub_features::ogni_feature_ufficiale`, e da adesso i presidi che \
         iterano l'inventario — a partire da quello dei cataloghi — non li \
         guardano: le loro stringhe possono mancare in una lingua senza che \
         niente diventi rosso"
    );

    let mancanti: Vec<&String> = attesi.difference(&dichiarati).collect();
    assert!(
        mancanti.is_empty(),
        "queste feature sono nell'inventario e non risultano dichiarate: {mancanti:?}\n\
         L'elenco promette qualcosa che l'utente non ha, e i presidi la stanno \
         provando su un componente che nell'app non esiste"
    );

    // E il core è **uno**: se domani ne comparisse un secondo che non viene da
    // `fub-features`, l'asserzione sopra lo direbbe, ma vale la pena che il
    // conto sia scritto — è il modo in cui questo file dice quanto è larga
    // l'eccezione che si concede.
    assert_eq!(
        dichiarati.len(),
        fub_features::ogni_feature_ufficiale().len() + 1,
        "l'unico bundle che non è una feature di `fub-features` è `{CORE_ID}`"
    );
}

#[test]
fn le_view_montate_sono_esattamente_quelle_dellinventario() {
    let (_dir, root) = vault();
    let montato = monta(&root);

    let montate: BTreeSet<String> = montato
        .workspace
        .views()
        .into_iter()
        .map(|spec| spec.id)
        .collect();

    // Si passa **dai provider** e non da `FeatureUfficiale::id`, e la differenza
    // conta: l'id del componente e quello della view sono due cose diverse, e un
    // provider ha il diritto di offrirne più d'una. Confrontare gli id dei
    // componenti proverebbe che i bundle ci sono, non che le view ci sono.
    let promesse: BTreeSet<String> = fub_features::ogni_view_ufficiale()
        .flat_map(|f| (f.view.expect("è una riga con view"))().views())
        .map(|spec| spec.id)
        .collect();

    assert!(
        !promesse.is_empty(),
        "l'inventario non promette nessuna view: un presidio che itera zero \
         elementi passa sempre, ed è il modo in cui questo file smetterebbe di \
         dire qualcosa"
    );

    let di_troppo: Vec<&String> = montate.difference(&promesse).collect();
    assert!(
        di_troppo.is_empty(),
        "queste view sono montate e l'inventario non le nomina: {di_troppo:?}\n\
         Qualcuno le ha registrate a mano scavalcando \
         `fub_features::ogni_view_ufficiale`, e da adesso `view_refresh_masks` \
         e `conformita` le stanno saltando in silenzio — che è esattamente la \
         forma di difetto per cui l'inventario esiste"
    );

    let mancanti: Vec<&String> = promesse.difference(&montate).collect();
    assert!(
        mancanti.is_empty(),
        "queste view sono nell'inventario e non risultano montate: {mancanti:?}\n\
         O il ciclo di `mount` non le prende più, o il loro bundle non si è \
         registrato: in entrambi i casi i presidi delle feature stanno provando \
         un pannello che nell'app non c'è"
    );
}
