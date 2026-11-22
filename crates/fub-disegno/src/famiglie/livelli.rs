//! La famiglia `livelli` della mappa: le voci di ≡ › Selezione (K6 T15, giro 1) e i comandi di livello
//! della scheda Livelli del Completo (giro 3): nuovo livello, elimina, rinomina e colore, occhio,
//! lucchetto, livello corrente e spostamento. «Maschere di ritaglio» (K6 T12) sceglie le maschere, i
//! `<g clip-path>` del file. Selezionare non cambia il documento: quelle voci non
//! scrivono niente, e il motore dice che cosa seleziona. Un livello si nomina nei suoi argomenti col suo
//! numero del motore, come il motore vuole (`ids`, `id`, `parent`): la scheda lo legge da
//! `document.inspect`. Un livello bloccato si sblocca e si nasconde, ma non si rinomina né si colora.
//! Il formato della scena scrive di un livello il nome, l'occhio e il lucchetto: un nome che non vale
//! è un errore degli argomenti prima del motore, un livello nuovo senza nome prende il primo
//! «Livello N» libero, e le altre opzioni (il colore, il modello, la stampa) sono `Unsupported`.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::NodeId;

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;
use crate::mappa::nome_di_livello_sbagliato;

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

    /// Le voci spente col loro perché, prima di chiedere al motore. Il confronto con l'oggetto scelto
    /// (Uguale) e «Tutto sugli stessi livelli» vogliono qualcosa di scelto, e con un oggetto che la mappa
    /// non ha non si usano, come nel nucleo; l'istanza di simbolo vuole un'istanza scelta; «Tutti gli
    /// oggetti di testo» vuole un testo nel disegno. I comandi di livello cambiano il documento: sul
    /// disegno di sola lettura non si fanno. Il livello scelto sta negli argomenti (`rifiuto_valore`).
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if vuole_selezione(id) && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if (cambia_il_livello(id) || crea_livello(id)) && !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        // Con un oggetto che la mappa non ha in selezione, nessun comando che cambia il documento parte.
        if (cambia_il_livello(id) || crea_livello(id)) && matches!(nodi_scelti(copia, selezione), Err(DrawingRefusal::Unmapped)) {
            return Some(DrawingDisabledReason::Unmapped);
        }
        if vuole_selezione(id) {
            match nodi_scelti(copia, selezione) {
                Err(DrawingRefusal::Locked) | Ok(_) => {}
                Err(_) => return Some(DrawingDisabledReason::Unmapped),
            }
        }
        match id {
            "select.same.symbolInstance" => {
                let istanza = |nome: &String| {
                    copia
                        .mappa
                        .dell_id(nome)
                        .and_then(|i| copia.mappa.elemento(i))
                        .is_some_and(|e| e.ruolo == Role::Instance)
                };
                (!selezione.iter().any(istanza)).then(|| DrawingDisabledReason::Other {
                    text: "Non è un'istanza.".into(),
                })
            }
            "select.object.clippingMasks" => {
                (!c_e_una_maschera(copia)).then(|| DrawingDisabledReason::Other {
                    text: "Nel disegno non ci sono maschere di ritaglio.".into(),
                })
            }
            "select.object.textObjects" => {
                let c_e_testo = copia.mappa.elementi().iter().any(|e| e.ruolo == Role::Text);
                (!c_e_testo).then(|| DrawingDisabledReason::Other {
                    text: "Nel disegno non ci sono oggetti di testo.".into(),
                })
            }
            _ => None,
        }
    }

    /// Il nome di un livello, nuovo o rinominato, è quello che il formato tiene
    /// (`nome_di_livello_sbagliato`): se no `BadArgs` col perché, prima del motore. Un livello nuovo
    /// senza nome prende il primo «Livello N» libero, come la scheda nativa.
    fn argomenti_della_copia(id: &str, copia: &Copia, mut valore: Value) -> Result<Value, PluginError> {
        if !matches!(id, "layer.new" | "layer.setProps") {
            return Ok(valore);
        }
        match valore.get("name") {
            Some(Value::String(nome)) => {
                if let Some(perche) = nome_di_livello_sbagliato(nome) {
                    return Err(PluginError::BadArgs(perche.into()));
                }
            }
            Some(Value::Null) | None if id == "layer.new" => {
                if !valore.is_object() {
                    valore = Value::Object(serde_json::Map::new());
                }
                if let Some(o) = valore.as_object_mut() {
                    o.insert("name".into(), Value::String(copia.mappa.nome_libero()));
                }
            }
            None => {}
            Some(_) => return Err(PluginError::BadArgs("Il nome del livello dev'essere un testo.".into())),
        }
        Ok(valore)
    }

    /// I livelli negli argomenti: senza nessuno il comando non parte (il motore prenderebbe il livello
    /// corrente, quello da cancellare o da spostare). Un livello bloccato non si cancella, non si sposta
    /// e non si rinomina né si colora; un livello non va dentro se stesso.
    fn rifiuto_valore(id: &str, copia: &Copia, _selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
        match id {
            // Senza maschere nel file il motore sceglierebbe solo ritagli suoi (un `clip-path` scritto
            // su un tracciato), che la selezione di Fub non sa dire: niente da scegliere.
            "select.object.clippingMasks" => (!c_e_una_maschera(copia)).then_some(DrawingRefusal::Empty),
            "layer.setCurrent" => livelli_del_valore(copia, valore).err(),
            "layer.delete" => match livelli_del_valore(copia, valore) {
                Ok(livelli) => livelli.iter().any(|&i| bloccato_con_antenati(copia, i)).then_some(DrawingRefusal::Locked),
                Err(motivo) => Some(motivo),
            },
            "layer.setProps" => {
                let livelli = match livelli_del_valore(copia, valore) {
                    Ok(livelli) => livelli,
                    Err(motivo) => return Some(motivo),
                };
                let cambia_nome_o_colore = CHIAVI_DI_UN_LIVELLO_BLOCCATO.iter().any(|chiave| valore.get(*chiave).is_some());
                if cambia_nome_o_colore && livelli.iter().any(|&i| bloccato_con_antenati(copia, i)) {
                    return Some(DrawingRefusal::Locked);
                }
                fuori_dal_formato(valore)
            }
            "layer.new" => fuori_dal_formato(valore),
            "node.move" => {
                let Some(chi) = valore.get("id").and_then(Value::as_u64) else {
                    return Some(DrawingRefusal::Empty);
                };
                let Some(chi) = copia.mappa.del_nodo(NodeId(chi)) else {
                    return Some(DrawingRefusal::Unmapped);
                };
                if bloccato_con_antenati(copia, chi) {
                    return Some(DrawingRefusal::Locked);
                }
                match valore.get("parent") {
                    None | Some(Value::Null) => None,
                    Some(parent) => {
                        let Some(parent) = parent.as_u64().and_then(|n| copia.mappa.del_nodo(NodeId(n))) else {
                            return Some(DrawingRefusal::Unmapped);
                        };
                        dentro_se_stesso(copia, chi, parent).then_some(DrawingRefusal::Unsupported)
                    }
                }
            }
            _ => None,
        }
    }
}

/// I comandi di ≡ › Selezione che lavorano su ciò che è scelto: il confronto con
/// l'oggetto scelto, e «Tutto sugli stessi livelli». Gli altri lavorano su tutto
/// il disegno.
fn vuole_selezione(id: &str) -> bool {
    id.starts_with("select.same.") || id == "select.object.allOnSameLayers"
}

/// I comandi che cambiano il documento su un livello: la scheda Livelli li chiama con il suo livello.
fn cambia_il_livello(id: &str) -> bool {
    matches!(id, "layer.delete" | "layer.setProps" | "node.move")
}

/// Il nuovo livello non vuole un livello scelto, ma cambia il documento.
fn crea_livello(id: &str) -> bool {
    id == "layer.new"
}

/// Le chiavi di `layer.setProps` che un livello bloccato non prende.
const CHIAVI_DI_UN_LIVELLO_BLOCCATO: [&str; 6] = ["name", "color", "template", "printable", "preview", "dimImages"];

/// Le opzioni di un livello che il formato della scena non ha (§3: un livello ha nome, blocco e
/// visibilità): il colore, il modello, la stampa, l'anteprima e le immagini sbiadite. Chiederle è
/// `unsupported`, prima del motore, e niente cambia.
const OPZIONI_FUORI_DAL_FORMATO: [&str; 5] = ["color", "template", "printable", "preview", "dimImages"];

/// `unsupported` se gli argomenti chiedono un'opzione di [`OPZIONI_FUORI_DAL_FORMATO`].
fn fuori_dal_formato(valore: &Value) -> Option<DrawingRefusal> {
    OPZIONI_FUORI_DAL_FORMATO
        .iter()
        .any(|chiave| valore.get(*chiave).is_some())
        .then_some(DrawingRefusal::Unsupported)
}

/// I livelli che il comando nomina nei suoi argomenti, con `ids` o con `id`, come elementi della mappa.
/// Nessuno è `empty`; un numero che la mappa non ha, o che non è un numero, è `unmapped`.
fn livelli_del_valore(copia: &Copia, valore: &Value) -> Result<Vec<usize>, DrawingRefusal> {
    let mut nomi: Vec<&Value> = valore.get("ids").and_then(Value::as_array).map(|lista| lista.iter().collect()).unwrap_or_default();
    nomi.extend(valore.get("id"));
    if nomi.is_empty() {
        return Err(DrawingRefusal::Empty);
    }
    nomi.into_iter()
        .map(|nome| {
            let n = nome.as_u64().ok_or(DrawingRefusal::Unmapped)?;
            copia.mappa.del_nodo(NodeId(n)).ok_or(DrawingRefusal::Unmapped)
        })
        .collect()
}

/// Vero se il file ha una maschera di ritaglio, un `<g clip-path>` della mappa. Il motore sceglie i
/// tracciati che ritagliano, e nel file ciascuno vale per la sua maschera (`selezione_di_fub`).
fn c_e_una_maschera(copia: &Copia) -> bool {
    copia.mappa.elementi().iter().any(|e| {
        e.nodo
            .and_then(|n| copia.documento.node(n))
            .is_some_and(|n| matches!(n.kind, vectorcraft_doc::NodeKind::Group { clip: true, .. }))
    })
}

/// Il livello `i`, o un suo antenato, è bloccato nella mappa.
fn bloccato_con_antenati(copia: &Copia, mut i: usize) -> bool {
    loop {
        let Some(e) = copia.mappa.elemento(i) else {
            return false;
        };
        if e.bloccato {
            return true;
        }
        match e.genitore {
            Some(genitore) => i = genitore,
            None => return false,
        }
    }
}

/// Il livello `chi` sta dentro `parent`, o dentro un suo discendente: dentro se stesso.
fn dentro_se_stesso(copia: &Copia, chi: usize, parent: usize) -> bool {
    let mut j = Some(parent);
    while let Some(i) = j {
        if i == chi {
            return true;
        }
        j = copia.mappa.elemento(i).and_then(|e| e.genitore);
    }
    false
}
