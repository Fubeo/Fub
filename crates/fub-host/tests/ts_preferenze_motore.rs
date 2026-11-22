//! Le parole della sezione «Motore del disegno» di Impostazioni › Disegni
//! (piano K6, T11): categorie, titoletti, etichette e scelte delle preferenze
//! del motore (`fub_disegno::preferenze::elenco`), in italiano e in inglese,
//! passate per il glossario del disegno (`crates/fub-disegno/glossario.tsv`),
//! con la versione di `draw.motore` che questa versione di Fub scrive.
//!
//! `apps/client/src/panels/settings-motore.generated.json` lo scrive questo
//! file con `UPDATE_MIRROR=1`, e il test cade se è stantio. L'italiano è
//! quello del catalogo del motore (`vendor/vectorcraft/crates/ui-egui/src/i18n/it.tsv`);
//! una parola che non ci sta resta inglese, e il test la elenca.
#![cfg(feature = "drawing-complete")]

use std::collections::BTreeMap;
use std::path::PathBuf;

use fub_disegno::catalogo::{glossario, Lingua};
use fub_disegno::preferenze::elenco;
use serde_json::{json, Map, Value};

const RIGENERA: &str = "UPDATE_MIRROR=1 cargo test -p fub-host --test ts_preferenze_motore";

fn radice() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// `it.tsv`: sorgente → traduzione, dalle righe senza contesto.
fn italiano() -> BTreeMap<String, String> {
    let testo = std::fs::read_to_string(
        radice().join("vendor/vectorcraft/crates/ui-egui/src/i18n/it.tsv"),
    )
    .expect("il catalogo italiano del motore");
    testo
        .lines()
        .filter(|riga| !riga.starts_with('#'))
        .filter_map(|riga| {
            let mut celle = riga.trim_end_matches('\r').split('\t');
            let (contesto, sorgente, traduzione) = (celle.next()?, celle.next()?, celle.next()?);
            (contesto.is_empty() && !traduzione.trim().is_empty())
                .then(|| (sorgente.to_string(), traduzione.to_string()))
        })
        .collect()
}

/// Il file, e le parole che restano inglesi.
fn genera() -> (String, Vec<String>) {
    let it = italiano();
    let glossario = glossario();
    let mut parole = BTreeMap::<&str, ()>::new();
    let mut scelte = Map::new();
    for voce in elenco() {
        parole.insert(voce.categoria, ());
        if !voce.sezione.is_empty() {
            parole.insert(voce.sezione, ());
        }
        parole.insert(voce.etichetta, ());
        if !voce.scelte.is_empty() {
            for (_, etichetta) in &voce.scelte {
                parole.insert(etichetta, ());
            }
            scelte.insert(
                voce.chiave.to_string(),
                Value::Array(
                    voce.scelte
                        .iter()
                        .map(|(valore, etichetta)| json!([valore, etichetta]))
                        .collect(),
                ),
            );
        }
    }
    let mut mancanti = Vec::new();
    let mut testi = Map::new();
    for parola in parole.keys() {
        let italiana = match it.get(*parola) {
            Some(tradotta) => glossario.applica(Lingua::It, tradotta),
            None => {
                mancanti.push((*parola).to_string());
                glossario.applica(Lingua::En, parola)
            }
        };
        testi.insert(
            (*parola).to_string(),
            json!({ "it": italiana, "en": glossario.applica(Lingua::En, parola) }),
        );
    }
    let file = json!({
        "_": format!("File generato da crates/fub-host/tests/ts_preferenze_motore.rs, non modificare a mano; rigenera con {RIGENERA}"),
        "versione": fub_features::DRAW_ENGINE_PREFS_VERSION,
        "testi": testi,
        "scelte": scelte,
    });
    let mut testo = serde_json::to_string_pretty(&file).expect("JSON");
    testo.push('\n');
    (testo, mancanti)
}

#[test]
fn le_parole_della_sezione_sono_quelle_generate() {
    let (atteso, mancanti) = genera();
    let percorso = radice().join("apps/client/src/panels/settings-motore.generated.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&percorso, &atteso).expect("scrive il file generato");
    }
    if !mancanti.is_empty() {
        eprintln!("restano inglesi ({}): {mancanti:?}", mancanti.len());
    }
    let scritto = std::fs::read_to_string(&percorso).unwrap_or_default();
    assert!(
        scritto == atteso,
        "{} è stantio: rigenera con `{RIGENERA}`",
        percorso.display()
    );
}

#[test]
fn nessuna_parola_porta_il_nome_del_motore() {
    let (testo, _) = genera();
    assert!(!testo.contains("VectorCraft"), "{testo}");
}
