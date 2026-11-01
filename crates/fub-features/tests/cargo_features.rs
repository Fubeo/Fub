//! **Una cargo feature per bundle, e l'inventario è dove si legge** (§16.3).
//!
//! Il primo tempo del §16.3 mette ogni feature ufficiale dietro una cargo
//! feature omonima, con tantivy dietro `search`. Il guadagno è misurabile — il
//! grafo delle dipendenze di questo crate passa da 120 crate a 26 se si compila
//! il solo pannello struttura — ma il rischio che introduce è di forma: due
//! elenchi di cosa esiste, uno nel `Cargo.toml` e uno in `src/inventory.rs`,
//! che nessuno confronta.
//!
//! # E adesso anche le righe della mappa dei componenti
//!
//! Le cargo feature non sono più solo i moduli dell'inventario: ogni riga di
//! `fub_features::componenti` che sta dietro una feature lo dice
//! (`cargo_feature`), e le feature dei componenti che non sono moduli di questo
//! crate (`rich`, `xlsx`, i due motori, `http-client`) sono marcatori. Il
//! confronto si fa fra le righe e `[features]`, nei due versi.
//!
//! # Il guardiano di `fub-host`
//!
//! Prima questo presidio guardava solo il `Cargo.toml` di questo crate. Chi
//! consuma le feature ufficiali le **inoltra** (`fub-host` ha una cargo feature omonima per ognuna, e la
//! dipendenza è a `default-features = false`), e quell'elenco lì nessuno lo
//! confronta con questo: `trash` ci è mancato dal giorno in cui il bundle è
//! nato, e non se n'è accorto nessuno perché `cargo test --workspace` unifica
//! le feature — questo crate è anche un membro, quindi si compila coi suoi
//! default e la mancanza sparisce. Si vede solo compilando `fub-host` da solo,
//! che è ciò che farebbe chi lo usa come libreria. È il §16.3 visto da un piano
//! più su, ed è una casella della [0079](../../../docs/decisions/0190-sessioni-documento-e-undo.md).
//! Adesso lo guarda [`fub_host_inoltra_ogni_feature_componente`].
//!
//! È esattamente il difetto che la
//! [decisione 0056](../../../docs/decisions/0196-test-e-artefatti-generati.md)
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
fn declared() -> (BTreeSet<String>, BTreeSet<String>) {
    let manifest =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    let section = manifest
        .split("\n[features]\n")
        .nth(1)
        .expect("il Cargo.toml ha una sezione [features]");
    // Fino alla sezione successiva, e non fino alla fine del file: `[features]`
    // non è l'ultima.
    let section = section.split("\n[").next().unwrap();

    let mut feature = BTreeSet::new();
    let mut default = BTreeSet::new();
    let mut inside_default = false;
    for row in section.lines() {
        let row = row.trim();
        if row.is_empty() || row.starts_with('#') {
            continue;
        }
        if inside_default {
            if row.starts_with(']') {
                inside_default = false;
            } else {
                default.insert(row.trim_matches([',', '"']).to_string());
            }
            continue;
        }
        let Some((name, rest)) = row.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if name == "default" {
            inside_default = rest.trim() == "[";
            continue;
        }
        feature.insert(name.to_string());
    }
    (feature, default)
}

/// Le righe dell'inventario **di questa build**, per nome di modulo.
fn in_the_inventory() -> BTreeSet<String> {
    fub_features::every_official_feature()
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
fn every_row_of_the_inventory_has_the_its_cargo_feature() {
    let (declared, _) = declared();
    for name in in_the_inventory() {
        assert!(
            declared.contains(&name),
            "«{name}» è nell'inventario e non è una cargo feature: aggiungila a \
             `[features]` e a `default`, o l'unico modo di non compilarla è \
             cancellarla"
        );
    }
}

/// Le cargo feature che stanno fuori da `default` **di proposito**: il nome, se
/// questa build l'ha accesa, e perché è fuori.
///
/// È l'unico elenco del genere, e il perché è obbligatorio: senza, una
/// feature fuori dal default è una dimenticanza che non si distingue da una
/// scelta.
const OUT_OF_DEFAULT: &[(&str, bool, &str)] = &[(
    "draw",
    cfg!(feature = "draw"),
    "l'export dei disegni va con il formato dei disegni, che in `fub-host` sta \
     dietro la feature `draw`, fuori dal default fino a che FubDraw non entra \
     nell'app",
)];

/// Ogni cargo feature è accesa di default, tranne quelle dichiarate qui sopra.
///
/// Il default **è** l'applicazione che spediamo: una feature ufficiale fuori da
/// `default` sarebbe una feature che l'utente non ha, e la si sarebbe spenta
/// senza dirlo a nessuno. Spegnere resta una scelta di chi compila, riga di
/// comando alla mano.
#[test]
fn every_cargo_feature_and_on_of_default() {
    let (declared, default) = declared();
    let out: BTreeSet<String> = OUT_OF_DEFAULT
        .iter()
        .map(|(name, _, why)| {
            assert!(!why.is_empty());
            assert!(declared.contains(*name), "«{name}» non è una cargo feature");
            assert!(
                !default.contains(*name),
                "«{name}» è dichiarata fuori ed è in `default`"
            );
            name.to_string()
        })
        .collect();
    assert_eq!(
        declared.difference(&out).cloned().collect::<BTreeSet<_>>(),
        default,
        "le cargo feature dichiarate e quelle in `default` non coincidono: \
         l'app che spediamo le ha tutte, tranne quelle in `OUT_OF_DEFAULT`"
    );
}

/// Le cargo feature che non sono componenti, e perché. Oggi nessuna: ogni
/// feature ha almeno una riga nella mappa.
const NON_COMPONENTI: &[(&str, &str)] = &[];

/// Le righe della mappa senza una cargo feature: sempre compilate, e il test le
/// elenca perché una riga in più senza feature è una riga che non si spegne da
/// Cargo.
const SENZA_FEATURE: &[(&str, &str)] = &[
    ("fub.core", "il nucleo dell'host"),
    (
        "fub.maintenance",
        "il nucleo: la manutenzione non sparisce nel vault da riparare",
    ),
    ("fub.markdown", "il nucleo: le note sono sempre compilate"),
    ("fub.importers", "l'importazione è sempre montata dall'host"),
    ("fub.lavagna", "la lavagna è sempre compilata nel client"),
    (
        "fub.penna",
        "l'inchiostro è una libreria dei formati, sempre compilata",
    ),
    (
        "fub.dizionari",
        "i dizionari della macchina, sempre letti da chi li vuole",
    ),
];

/// Le cargo feature dei componenti: quelle dichiarate, tolte quelle che non lo
/// sono.
fn feature_dei_componenti() -> BTreeSet<String> {
    let (declared, _) = declared();
    declared
        .into_iter()
        .filter(|name| NON_COMPONENTI.iter().all(|(non, _)| non != name))
        .collect()
}

/// Ogni riga con una cargo feature la trova in `[features]` e nel `default`
/// (o fra le feature fuori dal default di proposito).
#[test]
fn ogni_riga_con_feature_e_una_feature_del_default() {
    let (declared, default) = declared();
    for riga in fub_features::componenti::righe() {
        let Some(feature) = riga.cargo_feature else {
            continue;
        };
        assert!(
            declared.contains(feature),
            "«{}» sta dietro «{feature}», che non è in `[features]`",
            riga.id
        );
        assert!(
            default.contains(feature) || OUT_OF_DEFAULT.iter().any(|(out, _, _)| *out == feature),
            "«{}» sta dietro «{feature}», che non è nel `default`",
            riga.id
        );
    }
}

/// Le righe senza cargo feature sono esattamente quelle di [`SENZA_FEATURE`].
#[test]
fn le_righe_senza_feature_sono_quelle_elencate() {
    let senza: BTreeSet<&str> = fub_features::componenti::righe()
        .iter()
        .filter(|riga| riga.cargo_feature.is_none())
        .map(|riga| riga.id)
        .collect();
    let attese: BTreeSet<&str> = SENZA_FEATURE
        .iter()
        .map(|(id, perche)| {
            assert!(!perche.is_empty());
            *id
        })
        .collect();
    assert_eq!(
        senza, attese,
        "una riga senza cargo feature non si spegne da Cargo: o le dai la sua \
         feature, o la scrivi in `SENZA_FEATURE` con il perché"
    );
}

/// **Una riga che ne richiede un'altra ne accende la cargo feature**: così la
/// mappa di una build parziale non resta con un requisito che nessuno offre.
#[test]
fn una_riga_richiesta_e_una_feature_accesa() {
    let implied = implied();
    let righe = fub_features::componenti::righe();
    for riga in &righe {
        let Some(feature) = riga.cargo_feature else {
            continue;
        };
        for requisito in riga.requires {
            let chi = righe
                .iter()
                .find(|altra| altra.id == *requisito)
                .or_else(|| {
                    righe
                        .iter()
                        .find(|altra| altra.provides.contains(requisito))
                })
                .unwrap_or_else(|| panic!("«{}» richiede «{requisito}» e non c'è", riga.id));
            let Some(sua) = chi.cargo_feature else {
                continue;
            };
            let accese = implied.get(feature).cloned().unwrap_or_default();
            assert!(
                sua == feature || accese.contains(sua),
                "«{}» richiede «{}», che sta dietro «{sua}», ma «{feature}» non la accende",
                riga.id,
                chi.id
            );
        }
    }
}

/// **`fub-host` inoltra ogni feature dei componenti.** Senza, spegnere un
/// componente in `fub-host` lascerebbe la sua riga (o accendere il bundle non
/// la porterebbe), e `cargo test --workspace`, che unifica le feature, non lo
/// vedrebbe mai.
#[test]
fn fub_host_inoltra_ogni_feature_componente() {
    let manifest = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fub-host/Cargo.toml"
    ))
    .unwrap();
    let section = manifest
        .split("\n[features]\n")
        .nth(1)
        .expect("fub-host ha una sezione [features]");
    let section = section.split("\n[").next().unwrap();
    let mancanti: Vec<String> = feature_dei_componenti()
        .into_iter()
        .filter(|feature| !section.contains(&format!("\"fub-features/{feature}\"")))
        .collect();
    assert!(
        mancanti.is_empty(),
        "`fub-host` non inoltra {mancanti:?}: compilato da solo, quei componenti \
         non si spengono o non arrivano"
    );
}

/// E nella build piena i due elenchi sono **lo stesso elenco**.
///
/// Questa è la direzione opposta, e vale solo qui: se una riga sparisse
/// dall'inventario lasciando la sua cargo feature nel `Cargo.toml`, il primo
/// test resterebbe verde — l'inventario sarebbe più corto, non incoerente. Il
/// `cfg` in testa è l'unico posto di questo file in cui i dieci nomi sono
/// scritti, e serve a dire *quando* la domanda ha senso: in una build parziale
/// l'inventario è più corto di proposito. Le feature fuori dal default non ci
/// sono: contano se la build le ha accese, e lo dice `OUT_OF_DEFAULT`.
#[test]
#[cfg(all(
    feature = "search",
    feature = "versioning",
    feature = "backlinks",
    feature = "outline",
    feature = "tags",
    feature = "trash",
    feature = "stats",
    feature = "graph",
    feature = "commands",
    feature = "blocks",
    feature = "rich",
    feature = "xlsx",
    feature = "engine-documents",
    feature = "engine-sheets",
    feature = "http-client"
))]
fn with_all_the_feature_the_two_lists_coincide() {
    // Una feature fuori dal default c'è nella mappa solo se questa build l'ha
    // accesa.
    let expected: BTreeSet<String> = feature_dei_componenti()
        .into_iter()
        .filter(|name| OUT_OF_DEFAULT.iter().all(|(out, on, _)| out != name || *on))
        .collect();
    let nella_mappa: BTreeSet<String> = fub_features::componenti::righe()
        .iter()
        .filter_map(|riga| riga.cargo_feature.map(str::to_string))
        .collect();
    assert_eq!(
        expected, nella_mappa,
        "una cargo feature senza riga nella mappa è un componente che il \
         `Cargo.toml` promette e che non esiste"
    );
    // Le feature dell'inventario sono quelle delle sue righe, che sono anche
    // righe della mappa.
    assert!(in_the_inventory().is_subset(&nella_mappa));
}

/// Ciò che ogni cargo feature accende, per nome: le liste su una riga
/// (`trash = ["commands"]`), senza le dipendenze `dep:`.
fn implied() -> std::collections::BTreeMap<String, BTreeSet<String>> {
    let manifest =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    let section = manifest
        .split("\n[features]\n")
        .nth(1)
        .expect("il Cargo.toml ha una sezione [features]");
    let section = section.split("\n[").next().unwrap();
    section
        .lines()
        .filter_map(|row| {
            let (name, rest) = row.split_once('=')?;
            let list = rest.trim().strip_prefix('[')?.strip_suffix(']')?;
            let features = list
                .split(',')
                .map(|item| item.trim().trim_matches('"'))
                .filter(|item| !item.is_empty() && !item.starts_with("dep:"))
                .map(str::to_string)
                .collect();
            Some((name.trim().to_string(), features))
        })
        .collect()
}

/// **Un servizio richiesto nel manifest è anche una cargo feature accesa.**
///
/// Il manifest dice chi deve essere montato prima; il `Cargo.toml` dice chi
/// deve essere compilato insieme. Se una riga richiedesse un servizio senza
/// accenderne la cargo feature, una build con la sola feature dipendente
/// compilerebbe un bundle che non si monta mai.
#[test]
fn a_required_service_is_also_an_implied_cargo_feature() {
    let implied = implied();
    let rows = fub_features::every_official_feature();
    let name = |id: &str| id.strip_prefix(PREFISSO).unwrap_or(id).to_string();
    for row in rows.iter().filter(|row| !row.requires.is_empty()) {
        for service in row.requires {
            let provider = rows
                .iter()
                .find(|other| other.provides.contains(service))
                .unwrap_or_else(|| {
                    panic!("«{}» richiede «{service}» e nessuno lo fornisce", row.id)
                });
            let accese = implied.get(&name(row.id)).cloned().unwrap_or_default();
            assert!(
                accese.contains(&name(provider.id)),
                "«{}» richiede «{service}», che fornisce «{}», ma la sua cargo feature \
                 non accende «{}»",
                row.id,
                provider.id,
                name(provider.id)
            );
        }
    }
}
