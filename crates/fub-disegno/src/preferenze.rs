//! Le preferenze del motore come impostazione di Fub (piano K6, T11;
//! `docs/architecture/disegno-completo.md#le-preferenze-del-motore`).
//!
//! Le preferenze del motore (`vectorcraft_engine::Prefs`) stanno nella sessione
//! di ogni istanza. Fub le tiene nell'impostazione `draw.motore`: l'host la dà
//! all'istanza quando nasce ([`componi`]), e dopo ogni comando l'istanza dice
//! quali preferenze il comando ha cambiato ([`differenza`]), così l'host le
//! salva. Restano così anche i preset che le famiglie tengono nelle preferenze
//! (ricalco, PDF, stampa, esportazione, nuovo documento), senza codice loro.
//!
//! Le quattro preferenze che sono cartelle ([`CARTELLE`]) non si mostrano, non
//! si salvano e non si scrivono mai: il motore non tocca il disco (T28), e un
//! `prefs.set` che ne nomina una si rifiuta prima del motore
//! ([`crate::disco::controlla`]).

use serde_json::{Map, Value};
use vectorcraft_engine::cmd::prefscmds::{spec, PREF_GROUPS};
use vectorcraft_engine::Prefs;

/// Le preferenze del motore che sono cartelle, con la chiave del motore: i
/// caratteri, i plug-in, il recupero e i modelli. In Fub sono del kernel.
pub const CARTELLE: [&str; 4] = [
    "fontsFolder",
    "pluginsFolder",
    "recoveryFolder",
    "templatesFolder",
];

/// Se `chiave` è una preferenza che è una cartella.
pub fn e_cartella(chiave: &str) -> bool {
    CARTELLE.contains(&chiave)
}

/// Le preferenze come le vede Fub: il JSON del motore senza le cartelle.
pub fn json_di(prefs: &Prefs) -> Map<String, Value> {
    match prefs.to_json() {
        Value::Object(mut tutte) => {
            for cartella in CARTELLE {
                tutte.remove(cartella);
            }
            tutte
        }
        _ => Map::new(),
    }
}

/// Le preferenze di serie, come le vede Fub.
pub fn di_serie() -> Map<String, Value> {
    json_di(&Prefs::default())
}

/// La lettura di `prefs.get` o `prefs.list` senza le cartelle: l'oggetto
/// `{prefs}` senza le loro chiavi, l'elenco senza le loro righe.
pub fn lettura_senza_cartelle(mut lettura: Value) -> Value {
    match &mut lettura {
        Value::Array(righe) => righe.retain(|riga| {
            !riga
                .get("key")
                .and_then(Value::as_str)
                .is_some_and(e_cartella)
        }),
        Value::Object(campi) => {
            if let Some(Value::Object(prefs)) = campi.get_mut("prefs") {
                for cartella in CARTELLE {
                    prefs.remove(cartella);
                }
            }
        }
        _ => {}
    }
    lettura
}

/// Una preferenza dell'elenco del motore (`prefs.list`) con le parole del
/// motore: categoria, sezione, etichetta e, per una scelta, le etichette di
/// ogni valore. Impostazioni › Disegni le traduce una volta, in un file
/// generato (`crates/fub-host/tests/ts_preferenze_motore.rs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoceElenco {
    pub chiave: &'static str,
    pub categoria: &'static str,
    /// Il titoletto dentro la categoria; vuoto: nessuno.
    pub sezione: &'static str,
    pub etichetta: &'static str,
    /// `(valore, etichetta)` di ogni scelta; vuoto per gli altri tipi.
    pub scelte: Vec<(&'static str, &'static str)>,
}

/// Le preferenze dell'elenco del motore, nel suo ordine, senza le cartelle.
pub fn elenco() -> Vec<VoceElenco> {
    use vectorcraft_engine::cmd::prefscmds::{PrefKind, PREF_SPECS};
    PREF_SPECS
        .iter()
        .filter(|voce| !e_cartella(voce.key))
        .map(|voce| VoceElenco {
            chiave: voce.key,
            categoria: voce.category,
            sezione: voce.section,
            etichetta: voce.label,
            scelte: match voce.kind {
                PrefKind::Choice(scelte) => scelte.to_vec(),
                _ => Vec::new(),
            },
        })
        .collect()
}

/// Le preferenze di serie con sopra quelle salvate in `salvate`, una chiave
/// alla volta: una chiave che il motore non conosce o un valore che non vale
/// si salta, e lo dice un avviso. Le cartelle si saltano sempre, in silenzio
/// per quelle vuote.
pub fn componi(salvate: &Map<String, Value>) -> (Prefs, Vec<String>) {
    let mut prefs = Prefs::default();
    let mut avvisi = Vec::new();
    for (chiave, valore) in salvate {
        if e_cartella(chiave) {
            if valore.as_str().is_some_and(|v| !v.trim().is_empty()) {
                avvisi.push(format!(
                    "`{chiave}` è una cartella: il motore del disegno non ne ha"
                ));
            }
            continue;
        }
        match una(&prefs, chiave, valore) {
            Ok(nuove) => prefs = nuove,
            Err(perche) => avvisi.push(format!("`{chiave}` si salta: {perche}")),
        }
    }
    (prefs, avvisi)
}

/// `prefs` con la sola `chiave` a `valore`: validata dal motore se è una
/// preferenza del suo elenco o un gruppo, letta come la legge il motore
/// altrimenti (i preset).
fn una(prefs: &Prefs, chiave: &str, valore: &Value) -> Result<Prefs, String> {
    if spec(chiave).is_some() || PREF_GROUPS.contains(&chiave) {
        let mut nuove = prefs.clone();
        let mut una = Map::new();
        una.insert(chiave.to_string(), valore.clone());
        nuove.set_values(&una)?;
        return Ok(nuove);
    }
    let Value::Object(mut tutte) = prefs.to_json() else {
        return Err("le preferenze non si leggono".into());
    };
    if !tutte.contains_key(chiave) {
        return Err("il motore non la conosce".into());
    }
    tutte.insert(chiave.to_string(), valore.clone());
    serde_json::from_value(Value::Object(tutte)).map_err(|e| e.to_string())
}

/// Le preferenze che cambiano da `prima` a `dopo`, con il valore di `dopo`;
/// le cartelle mai. Vuota se nessuna cambia.
pub fn differenza(prima: &Map<String, Value>, dopo: &Map<String, Value>) -> Map<String, Value> {
    dopo.iter()
        .filter(|(chiave, valore)| !e_cartella(chiave) && prima.get(*chiave) != Some(*valore))
        .map(|(chiave, valore)| (chiave.clone(), valore.clone()))
        .collect()
}

/// Le preferenze che i comandi di un'istanza hanno cambiato e che l'host non
/// ha ancora preso: il valore di prima (per rimetterlo se il salvataggio non
/// riesce) e quello di adesso, chiave per chiave.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CambioPreferenze {
    /// Il valore di ogni chiave prima del primo comando che l'ha cambiata.
    pub prima: Map<String, Value>,
    /// Il valore di ogni chiave adesso.
    pub dopo: Map<String, Value>,
}

impl CambioPreferenze {
    /// Aggiunge il cambio da `prima` a `dopo` (le due preferenze intere) di
    /// un comando: il primo valore di prima resta, quello di dopo si
    /// aggiorna.
    pub fn aggiungi(&mut self, prima: &Map<String, Value>, dopo: &Map<String, Value>) {
        for (chiave, valore) in differenza(prima, dopo) {
            if let Some(vecchio) = prima.get(&chiave) {
                self.prima
                    .entry(chiave.clone())
                    .or_insert_with(|| vecchio.clone());
            }
            self.dopo.insert(chiave, valore);
        }
    }

    /// Nessun cambio.
    pub fn vuoto(&self) -> bool {
        self.dopo.is_empty()
    }
}

/// `prefs` con i valori di `cambi` (chiavi che il motore conosce: quelle di
/// [`differenza`]). Un valore che non si legge lascia `prefs` com'era.
pub fn con(prefs: &Prefs, cambi: &Map<String, Value>) -> Prefs {
    let Value::Object(mut tutte) = prefs.to_json() else {
        return prefs.clone();
    };
    for (chiave, valore) in cambi {
        if !e_cartella(chiave) {
            tutte.insert(chiave.clone(), valore.clone());
        }
    }
    serde_json::from_value(Value::Object(tutte)).unwrap_or_else(|_| prefs.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mappa(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn le_cartelle_non_si_vedono_ne_si_compongono() {
        let json = json_di(&Prefs::default());
        for cartella in CARTELLE {
            assert!(!json.contains_key(cartella), "{cartella}");
        }
        assert!(json.contains_key("keyboardIncrement"));
        let (prefs, avvisi) = componi(&mappa(json!({"fontsFolder": "/etc", "recoveryFolder": ""})));
        assert_eq!(prefs.fonts_folder, "");
        assert_eq!(avvisi.len(), 1, "{avvisi:?}");
    }

    #[test]
    fn una_chiave_che_non_vale_si_salta_e_le_altre_restano() {
        let (prefs, avvisi) = componi(&mappa(json!({
            "keyboardIncrement": 5.0,
            "constrainAngle": "non un numero",
            "chiaveCheNonCe": 1,
        })));
        assert_eq!(prefs.keyboard_increment, 5.0);
        assert_eq!(prefs.constrain_angle, Prefs::default().constrain_angle);
        assert_eq!(avvisi.len(), 2, "{avvisi:?}");
    }

    #[test]
    fn un_preset_fuori_dall_elenco_si_rilegge() {
        let con_preset = Prefs {
            keyboard_increment: 2.0,
            ..Prefs::default()
        };
        let salvate = json_di(&con_preset);
        let (rilette, avvisi) = componi(&salvate);
        assert!(avvisi.is_empty(), "{avvisi:?}");
        assert_eq!(json_di(&rilette), salvate);
    }

    #[test]
    fn la_differenza_dice_solo_cio_che_cambia_e_mai_le_cartelle() {
        let prima = json_di(&Prefs::default());
        let mut dopo = prima.clone();
        dopo.insert("keyboardIncrement".into(), json!(3.0));
        dopo.insert("fontsFolder".into(), json!("/etc"));
        let cambi = differenza(&prima, &dopo);
        assert_eq!(cambi, mappa(json!({"keyboardIncrement": 3.0})));
        let unite = con(&Prefs::default(), &cambi);
        assert_eq!(unite.keyboard_increment, 3.0);
    }

    #[test]
    fn l_elenco_e_quello_del_motore_senza_le_cartelle() {
        let elenco = elenco();
        assert!(elenco.iter().all(|voce| !e_cartella(voce.chiave)));
        assert_eq!(
            elenco.len() + CARTELLE.len(),
            vectorcraft_engine::cmd::prefscmds::PREF_SPECS.len()
        );
        let griglia = elenco.iter().find(|v| v.chiave == "gridStyle").unwrap();
        assert!(griglia.scelte.contains(&("lines", "Lines")), "{griglia:?}");
    }

    #[test]
    fn le_letture_perdono_le_cartelle() {
        let elenco = lettura_senza_cartelle(json!([
            {"key": "fontsFolder"},
            {"key": "keyboardIncrement"}
        ]));
        assert_eq!(elenco, json!([{"key": "keyboardIncrement"}]));
        let tutte =
            lettura_senza_cartelle(json!({"prefs": {"pluginsFolder": "", "gridStyle": "lines"}}));
        assert_eq!(tutte, json!({"prefs": {"gridStyle": "lines"}}));
    }
}
