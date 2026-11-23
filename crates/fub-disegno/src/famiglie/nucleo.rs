//! La famiglia `nucleo` della mappa: il suo stato, vuoto finché il task della
//! famiglia non lo riempie (`docs/architecture/disegno-completo.md`).

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::NodeId;

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Sposta sul livello corrente (K6 T11): il livello corrente sta nel client,
/// nella sessione del documento, e arriva nel valore del comando.
pub(crate) const SUL_LIVELLO_CORRENTE: &str = "object.arrange.sendToCurrentLayer";

/// Il campo del valore di Sposta sul livello corrente con l'id di Fub del
/// livello corrente. Il ponte lo toglie prima del motore.
const CAMPO_LIVELLO: &str = "layer";

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        0
    }

    fn libera(&self) -> u64 {
        0
    }

    /// I comandi del nucleo spenti, col perché, prima di chiedere al motore:
    /// Seleziona tutto e Inversa valgono sempre; le incolle, le letture del
    /// documento e la selezione per id non vogliono una selezione; Deseleziona,
    /// Pulisci, Duplica e gli oggetti vogliono qualcosa di scelto; l'oggetto
    /// sopra o sotto e l'ordine vogliono oggetti che il motore conosce (chi
    /// cambia il file non va in sola lettura, né su un oggetto bloccato); Separa
    /// vuole un gruppo.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        let cambia = cambia_il_file(id);
        match id {
            "select.all" | "select.inverse" => return None,
            _ if selezione.is_empty() && vuole_selezione(id) => return Some(DrawingDisabledReason::NoSelection),
            "select.none" => return None,
            _ if cambia && !copia.modificabile => return Some(DrawingDisabledReason::ReadOnly),
            _ => {}
        }
        match nodi_scelti(copia, selezione) {
            Err(DrawingRefusal::Locked) if cambia => return Some(DrawingDisabledReason::ReadOnly),
            Err(DrawingRefusal::Locked) => {}
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
            Ok(_) => {}
        }
        if id == "object.ungroup" {
            let gruppo = |nome: &String| {
                copia.mappa.dell_id(nome).and_then(|i| copia.mappa.elemento(i)).is_some_and(|e| e.ruolo == Role::Group)
            };
            if !selezione.iter().any(gruppo) {
                return Some(DrawingDisabledReason::NeedsGroup);
            }
        }
        None
    }

    /// `object.setProps` non scrive il tratto a penna di Fub (`fub:ink`): il
    /// motore lo tiene come elemento grezzo, e lo riscriverebbe come un altro
    /// oggetto. Lo si dice come `unmapped`.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        let tratto = |nome: &String| copia.mappa.dell_id(nome).and_then(|i| copia.mappa.elemento(i)).is_some_and(|e| e.ruolo == Role::Stroke);
        (id == "object.setProps" && selezione.iter().any(tratto)).then_some(DrawingRefusal::Unmapped)
    }

    /// Il livello corrente di Sposta sul livello corrente (`livello_corrente`).
    fn livello(id: &str, copia: &Copia, valore: &Value) -> Result<Option<NodeId>, DrawingRefusal> {
        if id != SUL_LIVELLO_CORRENTE {
            return Ok(None);
        }
        let scelto = valore.get(CAMPO_LIVELLO).and_then(Value::as_str);
        livello_corrente(copia, scelto).map(Some)
    }

    /// Sposta sul livello corrente: l'id del livello corrente esce dal valore
    /// (il motore non lo conosce); un id che non è una stringa è `BadArgs`.
    fn argomenti_della_copia(id: &str, _copia: &Copia, _selezione: &[String], mut valore: Value) -> Result<Value, PluginError> {
        if id != SUL_LIVELLO_CORRENTE {
            return Ok(valore);
        }
        if let Some(campi) = valore.as_object_mut() {
            match campi.remove(CAMPO_LIVELLO) {
                None | Some(Value::String(_)) => {}
                Some(_) => return Err(PluginError::BadArgs("il livello corrente è l'id di un livello, scritto come testo".into())),
            }
        }
        Ok(valore)
    }
}

/// Il livello corrente nel documento del motore, dato l'id di Fub che il client
/// ha scelto (`scelto`): quel livello, se c'è; se non c'è più, o il client non
/// ne ha uno, il più alto né nascosto né bloccato, come le forme nuove. Il
/// livello corrente nascosto è `hidden`, bloccato `locked`, e nessun livello
/// dove andare `locked`. Senza livelli di Fub è la radice, il livello che
/// l'import crea: gli oggetti vanno in cima al disegno.
fn livello_corrente(copia: &Copia, scelto: Option<&str>) -> Result<NodeId, DrawingRefusal> {
    let mut livelli: Vec<_> = copia.mappa.elementi().iter().filter(|e| e.ruolo == Role::Layer).collect();
    if livelli.is_empty() {
        return copia
            .documento
            .layers
            .iter()
            .map(|l| l.id)
            .find(|id| copia.mappa.e_radice(*id))
            .ok_or(DrawingRefusal::Unmapped);
    }
    livelli.sort_by(|a, b| a.percorso.cmp(&b.percorso));
    let e = match scelto.and_then(|id| livelli.iter().find(|e| e.id.as_deref() == Some(id))) {
        Some(e) if e.nascosto => return Err(DrawingRefusal::Hidden),
        Some(e) if e.bloccato => return Err(DrawingRefusal::Locked),
        Some(e) => *e,
        None => *livelli.iter().rev().find(|e| !e.nascosto && !e.bloccato).ok_or(DrawingRefusal::Locked)?,
    };
    e.nodo.ok_or(DrawingRefusal::Unmapped)
}

/// I comandi che cambiano il file: gli oggetti, le incolle, pulisci e duplica,
/// taglia. In sola lettura non si fanno (la copia e le letture sì).
fn cambia_il_file(id: &str) -> bool {
    id.starts_with("object.") || id.starts_with("edit.paste") || matches!(id, "edit.clear" | "edit.duplicate" | "edit.cut")
}

/// I comandi che lavorano sulla selezione. Le incolle vanno dove sta il punto
/// del disegno, le letture del documento leggono tutto, e la selezione per id
/// prende i suoi id: nessuno di loro vuole una selezione. Nemmeno Sblocca
/// tutto e Mostra tutto, che lavorano su tutto il disegno. Riseleziona, invece,
/// vuole la selezione vuota: dopo Deseleziona riparte da quella di prima.
fn vuole_selezione(id: &str) -> bool {
    !(id.starts_with("edit.paste")
        || id.starts_with("document.")
        || matches!(
            id,
            "select.set"
                | "select.add"
                | "select.toggle"
                | "select.reselect"
                | "edit.dropSelection"
                | "object.unlockAll"
                | "object.showAll"
        ))
}
