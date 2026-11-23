//! Il Pennello tondo (`path.blob`, K6 T12, giro 2): dipinge un tracciato pieno col colore che il client
//! manda. Il tratto arriva in un comando solo, a rilascio, come la Gomma dei punti: niente chiamate al
//! motore a ogni movimento.
//!
//! - **Il tratto** è `points`: i punti in coordinate di scena (`[x, y]` o `[x, y, pressione]`), convertiti nel
//!   documento come quelli della gomma. Un clic porta un punto solo, e il motore lo dipinge come un tondo.
//! - **Il colore** è `color` (`#rrggbb`, obbligatorio). Il motore non lo riceve come argomento: il dispatcher
//!   (`famiglie/mod.rs`) lo mette nella tavolozza della sessione per questo solo comando, e la ripristina.
//! - **Il diametro** è `size` (pt, facoltativo, 0,1 – 2500). Senza, vale quello di serie del motore (10 pt):
//!   Fub non ha ancora un pannello del pennello.
//! - **Fusione**: il motore fonde il tondo con i tracciati pieni dello stesso colore che tocca, e lascia gli
//!   altri (`merge`, di serie vero). Non c'è altro da scrivere qui.

use fub_abi::PluginError;
use serde_json::Value;
use vectorcraft_color::Color;

use super::mano::nel_documento;
use crate::apertura::Copia;

/// Il comando del motore del pennello tondo.
pub(crate) const PENNELLO: &str = "path.blob";

/// Il diametro che il client può chiedere (pt), come quello della gomma.
const DIAMETRO: (f64, f64) = (0.1, 2500.0);

/// Gli argomenti del pennello: il tratto nel documento, il colore controllato e il diametro, se c'è.
/// `color` resta nel valore: il dispatcher lo legge per la tavolozza, il motore non lo usa.
pub(super) fn argomenti(mut valore: Value, copia: &Copia) -> Result<Value, PluginError> {
    let Some(o) = valore.as_object_mut() else {
        return Err(PluginError::BadArgs("Il pennello vuole il suo tratto: i punti, e il colore.".into()));
    };
    if o.contains_key("ids") {
        return Err(PluginError::BadArgs("Il pennello dipinge un tratto nuovo: non si passano gli id del motore.".into()));
    }
    let colore = o.get("color").and_then(Value::as_str).and_then(Color::from_hex);
    if colore.is_none() {
        return Err(PluginError::BadArgs("Il colore del pennello va scritto come #rrggbb.".into()));
    }
    match o.get("size").filter(|v| !v.is_null()).map(Value::as_f64) {
        None => {}
        Some(Some(d)) if d.is_finite() && (DIAMETRO.0..=DIAMETRO.1).contains(&d) => {}
        Some(_) => return Err(PluginError::BadArgs("Il diametro del pennello va da 0,1 a 2500 punti.".into())),
    }
    let Some(Value::Array(punti)) = o.get_mut("points") else {
        return Err(PluginError::BadArgs("Il pennello vuole il suo tratto: una lista di punti [x, y].".into()));
    };
    let dritti = punti.iter().all(|p| {
        p.as_array().is_some_and(|a| (a.len() == 2 || a.len() == 3) && a.iter().all(|n| n.as_f64().is_some_and(f64::is_finite)))
    });
    if punti.is_empty() || !dritti {
        return Err(PluginError::BadArgs("Il pennello vuole il suo tratto: una lista di punti [x, y].".into()));
    }
    nel_documento(punti, copia);
    Ok(valore)
}

/// Il colore del pennello nel valore, già controllato da [`argomenti`].
pub(crate) fn colore(valore: &Value) -> Option<Color> {
    valore.get("color").and_then(Value::as_str).and_then(Color::from_hex)
}
