//! Pulisci (K6 T12, `object.path.cleanUp`): il comando del motore vale su tutto
//! il disegno, non sulla selezione (`clean_up` in `engine/src/cmd/pathops.rs`
//! non legge la selezione), e ha tre interruttori: i punti isolati (un
//! tracciato con al più un punto), i tracciati senza riempimento né contorno,
//! i testi vuoti. Il motore lascia ciò che è su un livello nascosto o bloccato
//! (`is_editable_with`): quelli restano, senza rifiuto. Fub legge gli
//! interruttori della sua finestra come veri o falsi, e dice `empty` quando il
//! comando non cambia il disegno.

use fub_abi::PluginError;
use serde_json::{Map, Value};
use vectorcraft_doc::Document;

use crate::apertura::Copia;

/// L'id del comando.
pub(crate) const PULISCI: &str = "object.path.cleanUp";

/// I tre interruttori, col nome che il motore legge. Un interruttore che manca è
/// vero, come nel motore (`bool_or(p, …, true)`).
const INTERRUTTORI: [&str; 3] = ["strayPoints", "unpaintedObjects", "emptyTextPaths"];

/// Gli argomenti di Pulisci: solo i tre interruttori, veri o falsi. Un nome che
/// non è uno di loro, o un valore che non è vero o falso, è `BadArgs`.
pub(crate) fn argomenti(valore: Value) -> Result<Value, PluginError> {
    let mut campi = match valore {
        Value::Null => Map::new(),
        Value::Object(campi) => campi,
        _ => return Err(sbagliato("the value must be an object")),
    };
    if let Some(nome) = campi
        .keys()
        .find(|nome| !INTERRUTTORI.contains(&nome.as_str()))
    {
        return Err(sbagliato(format!("unknown switch `{nome}`")));
    }
    let mut uscita = Map::new();
    for nome in INTERRUTTORI {
        let acceso = match campi.remove(nome) {
            None => true,
            Some(Value::Bool(acceso)) => acceso,
            Some(_) => return Err(sbagliato(format!("`{nome}` must be true or false"))),
        };
        uscita.insert(nome.into(), Value::Bool(acceso));
    }
    Ok(Value::Object(uscita))
}

/// Pulisci che lascia il disegno com'era: il motore non ha tolto niente, e la
/// famiglia dice `empty`, senza un passo vuoto nella cronologia.
pub(crate) fn non_cambia(copia: &Copia, dopo: &Document) -> bool {
    dopo == copia.documento.as_ref()
}

fn sbagliato(perche: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(format!("{PULISCI}: {perche}").into())
}
