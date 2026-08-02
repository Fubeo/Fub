//! **Una cargo feature per bundle, e l'inventario è dove si legge** (§16.3).
//!
//! Il primo tempo del §16.3 mette ogni feature ufficiale dietro una cargo
//! feature omonima, con tantivy dietro `search`. Il guadagno è misurabile — il
//! grafo delle dipendenze di questo crate passa da 120 crate a 26 se si compila
//! il solo pannello struttura — ma il rischio che introduce è di forma: due
//! elenchi di cosa esiste, uno nel `Cargo.toml` e uno in `src/inventario.rs`,
//! che nessuno confronta.
//!
//! È esattamente il difetto che la
//! [decisione 0056](../../../docs/decisions/0056-un-elenco-che-e-la-sorgente.md)
//! ha chiuso per la registrazione, e la ragione per cui la voce diceva che
//! l'inventario è «il posto naturale da cui una cargo feature per bundle si
//! legge»: una riga che sparisce dietro un `#[cfg]` deve sparire da lì, o
//! l'inventario torna a descrivere invece di costituire.
//!
//! # Perché il confronto non ha bisogno di una tabella di corrispondenza
//!
//! Perché il nome non è due volte: l'id di un bundle è `fub.<nome del modulo>`,
//! e la cargo feature ha lo stesso nome del modulo. La corrispondenza si
//! **calcola** togliendo il prefisso, quindi non c'è un terzo elenco da tenere
//! allineato — che sarebbe stato il difetto di partenza scritto una volta di
//! più.

use std::collections::BTreeSet;

/// Il prefisso degli id delle feature ufficiali. È anche ciò che le rende
/// confrontabili con i nomi delle cargo feature senza una tabella in mezzo.
const PREFISSO: &str = "fub.";

/// Le cargo feature dichiarate in `[features]`, e cosa elenca `default`.
///
/// Si legge il `Cargo.toml` come testo e non come struttura perché la domanda è
/// «cosa c'è scritto», e un parser TOML in dev-dependency per tre righe sarebbe
/// più dipendenza che presidio. Il formato è quello che scriviamo noi: una
/// chiave per riga, e `default` come lista su più righe.
fn dichiarate() -> (BTreeSet<String>, BTreeSet<String>) {
    let manifest =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    let sezione = manifest
        .split("\n[features]\n")
        .nth(1)
        .expect("il Cargo.toml ha una sezione [features]");
    // Fino alla sezione successiva, e non fino alla fine del file: `[features]`
    // non è l'ultima.
    let sezione = sezione.split("\n[").next().unwrap();

    let mut feature = BTreeSet::new();
    let mut default = BTreeSet::new();
    let mut dentro_default = false;
    for riga in sezione.lines() {
        let riga = riga.trim();
        if riga.is_empty() || riga.starts_with('#') {
            continue;
        }
        if dentro_default {
            if riga.starts_with(']') {
                dentro_default = false;
            } else {
                default.insert(riga.trim_matches([',', '"']).to_string());
            }
            continue;
        }
        let Some((nome, resto)) = riga.split_once('=') else {
            continue;
        };
        let nome = nome.trim();
        if nome == "default" {
            dentro_default = resto.trim() == "[";
            continue;
        }
        feature.insert(nome.to_string());
    }
    (feature, default)
}

/// Le righe dell'inventario **di questa build**, per nome di modulo.
fn nell_inventario() -> BTreeSet<String> {
    fub_features::ogni_feature_ufficiale()
        .iter()
        .map(|f| {
            f.id.strip_prefix(PREFISSO)
                .unwrap_or_else(|| panic!("l'id «{}» non comincia per «{PREFISSO}»", f.id))
                .to_string()
        })
        .collect()
}

/// Ogni riga dell'inventario ha la sua cargo feature.
///
/// È la direzione che si rompe per prima: chi aggiunge una feature ufficiale
/// scrive il modulo, lo mette nell'inventario, e il `Cargo.toml` se lo dimentica
/// — con l'effetto che quella feature non si può spegnere e nessuno se ne
/// accorge, perché tutto compila e tutto funziona.
#[test]
fn ogni_riga_dell_inventario_ha_la_sua_cargo_feature() {
    let (dichiarate, _) = dichiarate();
    for nome in nell_inventario() {
        assert!(
            dichiarate.contains(&nome),
            "«{nome}» è nell'inventario e non è una cargo feature: aggiungila a \
             `[features]` e a `default`, o l'unico modo di non compilarla è \
             cancellarla"
        );
    }
}

/// Ogni cargo feature è accesa di default.
///
/// Il default **è** l'applicazione che spediamo: una feature ufficiale fuori da
/// `default` sarebbe una feature che l'utente non ha, e la si sarebbe spenta
/// senza dirlo a nessuno. Spegnere resta una scelta di chi compila, riga di
/// comando alla mano.
#[test]
fn ogni_cargo_feature_e_accesa_di_default() {
    let (dichiarate, default) = dichiarate();
    assert_eq!(
        dichiarate, default,
        "le cargo feature dichiarate e quelle in `default` non coincidono: \
         l'app che spediamo le ha tutte"
    );
}

/// E nella build piena i due elenchi sono **lo stesso elenco**.
///
/// Questa è la direzione opposta, e vale solo qui: se una riga sparisse
/// dall'inventario lasciando la sua cargo feature nel `Cargo.toml`, il primo
/// test resterebbe verde — l'inventario sarebbe più corto, non incoerente. Il
/// `cfg` in testa è l'unico posto di questo file in cui gli otto nomi sono
/// scritti, e serve a dire *quando* la domanda ha senso: in una build parziale
/// l'inventario è più corto di proposito.
#[test]
#[cfg(all(
    feature = "search",
    feature = "versioning",
    feature = "backlinks",
    feature = "outline",
    feature = "tags",
    feature = "stats",
    feature = "commands",
    feature = "blocks"
))]
fn con_tutte_le_feature_i_due_elenchi_coincidono() {
    let (dichiarate, _) = dichiarate();
    assert_eq!(
        dichiarate,
        nell_inventario(),
        "una cargo feature senza riga nell'inventario è un bundle che il \
         `Cargo.toml` promette e che non si monta"
    );
}
