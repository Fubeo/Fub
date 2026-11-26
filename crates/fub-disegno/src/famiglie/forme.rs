//! La famiglia `forme` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`).
//!
//! - **Le forme** (T13 giro 1): gli strumenti di forma passano dal ponte del
//!   motore (`gesti/strumento.rs`), e i comandi `shape.*` delle finestre delle
//!   misure vengono da qui.
//! - **Le forme composte** (T13, `object.compoundShape.*`): Crea forma
//!   composta mette due o più oggetti scelti in un gruppo segnato del motore,
//!   ognuno col suo metodo forma (`add`, `subtract`, `intersect`, `exclude`).
//!   Nel file è un elemento solo, che la differenza scrive come un `g` col
//!   disegno espanso e la ricetta (`ricetta.rs`, `FormaComposta`): il
//!   Semplice vede un gruppo, il Completo la riapre composta. Gli oggetti di
//!   prima spariscono dal file, perché stanno nella ricetta. Vuole due
//!   oggetti (`needs_two`) che il motore sa comporre: un tracciato, un
//!   composto, un gruppo, un testo; un'immagine o una guida spengono la voce
//!   con `needs_path` e il comando è `unmapped` ([`componibile`]). Un tratto
//!   della penna di Fub, scelto o dentro un gruppo scelto, finirebbe nella
//!   ricetta senza il suo inchiostro: `fub_ink`, e il comando è `unmapped`.
//!   Metodo forma, Rilascia ed Espandi forma composta vogliono una forma
//!   composta scelta; Metodo forma la cambia tutta, perché i suoi membri non
//!   sono elementi del file e non si scelgono da soli: gira su ogni membro
//!   ([`StatoFamiglia::uno_alla_volta`]). Rilascia rimette i membri nel
//!   file, con id nuovi; Espandi lascia il tracciato del disegno. Una
//!   composta che non disegna niente (Intersezione di forme che non si
//!   toccano) è `empty`, che la si crei, la si cambi o la si espanda: nel
//!   file non avrebbe niente da tenere (`differenza.rs`). Metodo forma col
//!   metodo che i membri hanno già è `empty`.
//! - **Espandi forma** (`object.expandShape`): una forma dal vivo (un
//!   rettangolo, un'ellisse) diventa un tracciato qualsiasi. Senza forme dal
//!   vivo scelte il motore non cambia niente, ed è `empty`.

use std::collections::HashSet;
use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::{Node, NodeId, NodeKind, ShapeMode};
use vectorcraft_engine::EngineError;

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;
use crate::catalogo::COMANDI_DI_FORMA;

/// Crea forma composta.
const CREA_COMPOSTA: &str = "object.compoundShape.make";

/// I comandi su una forma composta che c'è già: Metodo forma, Rilascia ed
/// Espandi.
const SULLA_COMPOSTA: [&str; 3] = [
    "object.compoundShape.setMode",
    "object.compoundShape.release",
    "object.compoundShape.expand",
];

/// Metodo forma: gira su ogni membro delle forme composte scelte.
const METODO_FORMA: &str = "object.compoundShape.setMode";

/// Espandi forma: le forme dal vivo scelte diventano tracciati.
const ESPANDI_FORMA: &str = "object.expandShape";

/// Le proprietà della forma viva (`object.setLiveShape`): gli angoli di un tracciato, i lati del
/// poligono, lo spicchio dell'ellisse.
const PROPRIETA_FORMA: &str = "object.setLiveShape";

/// Le lunghezze di [`PROPRIETA_FORMA`], dalla scena al documento del motore: la radice è una scala
/// e uno spostamento, e una lunghezza prende solo la scala. Un valore che non è un numero resta
/// com'è (il motore lo rifiuta).
fn lunghezze_nel_motore(radice: vectorcraft_geom::Affine, mut valore: Value) -> Value {
    let scala = radice.determinant().abs().sqrt();
    if !(scala.is_finite() && scala > 0.0) || (scala - 1.0).abs() < 1e-12 {
        return valore;
    }
    if let Some(campi) = valore.as_object_mut() {
        for chiave in ["radius", "polygonRadius", "sideLength"] {
            if let Some(n) = campi.get(chiave).and_then(Value::as_f64) {
                let n = serde_json::Number::from_f64(n * scala).map_or(Value::Null, Value::Number);
                campi.insert(chiave.into(), n);
            }
        }
    }
    valore
}

/// Il Generatore forme (T13 giro 7): il comando che unisce o toglie le regioni
/// (`shapeBuilder.merge`), che lo strumento del motore `shapeBuilder` manda al
/// trascinare. Le sue regioni si leggono con `shapeBuilder.regions`, una lettura.
const GENERATORE: &str = "shapeBuilder.merge";

/// Lo strumento del Generatore forme nella colonna.
pub(crate) const STRUMENTO_GENERATORE: &str = "shapeBuilder";

/// Un oggetto che il Generatore unisce: un tracciato che non è una guida, una forma
/// composta, o un gruppo fatto solo di questi. Un'immagine o un testo non entrano
/// (il motore li lascerebbe com'erano, ma la forma unita non li contiene).
fn unibile(nodo: &Node) -> bool {
    match &nodo.kind {
        NodeKind::Path { guide, .. } => !guide,
        NodeKind::Compound { .. } => true,
        NodeKind::Group { children, .. } => {
            !children.is_empty() && children.iter().all(|c| unibile(c))
        }
        _ => false,
    }
}

/// Perché il Generatore non unisce gli oggetti scelti, per il gesto: meno di due
/// (`empty`, il solo motivo che un gesto ha per «non tocca niente»), un oggetto che
/// non si unisce (`unmapped`), o uno bloccato (`locked`, da [`nodi_scelti`]).
pub(crate) fn rifiuto_del_generatore(
    copia: &Copia,
    selezione: &[String],
) -> Option<DrawingRefusal> {
    let nodi = match nodi_scelti(copia, selezione) {
        Ok(nodi) => nodi,
        Err(motivo) => return Some(motivo),
    };
    if nodi.len() < 2 {
        return Some(DrawingRefusal::Empty);
    }
    let tutti = nodi
        .iter()
        .all(|n| copia.documento.node(*n).is_some_and(unibile));
    (!tutti).then_some(DrawingRefusal::Unmapped)
}

/// Perché il comando del Generatore è spento sulla selezione: niente scelto, il
/// disegno o un oggetto bloccato (`read_only`), meno di due oggetti (`needs_two`),
/// un oggetto che non è una forma (`needs_path`).
fn generatore_spento(copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    if selezione.is_empty() {
        return Some(DrawingDisabledReason::NoSelection);
    }
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    let nodi = match nodi_scelti(copia, selezione) {
        Ok(nodi) => nodi,
        Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
        Err(_) => return Some(DrawingDisabledReason::Unmapped),
    };
    if nodi.len() < 2 {
        return Some(DrawingDisabledReason::NeedsTwo);
    }
    let tutti = nodi
        .iter()
        .all(|n| copia.documento.node(*n).is_some_and(unibile));
    (!tutti).then_some(DrawingDisabledReason::NeedsPath)
}

/// La fine del messaggio del motore quando Espandi forma composta non lascia
/// niente (`expand` in `engine/src/cmd/compoundshape.rs`, «Expand Compound
/// Shape produced an empty result»). Il caso `empty` di
/// `tests/forme_composte.rs` cade se il motore la cambia.
const RISULTATO_VUOTO: &str = "produced an empty result";

/// Il perché di una voce spenta senza una forma composta scelta: nessun
/// motivo tipato del contratto lo dice (`livelli.rs` fa lo stesso per
/// un'istanza).
const SCEGLI_UNA_COMPOSTA: &str = "Scegli una forma composta.";

/// Un comando delle forme composte, o Espandi forma.
fn delle_composte(id: &str) -> bool {
    id == CREA_COMPOSTA || SULLA_COMPOSTA.contains(&id) || id == ESPANDI_FORMA
}

/// Il motore sa fare di un oggetto il membro di una forma composta: un
/// tracciato che non è una guida, un tracciato composto, un gruppo (anche
/// una forma composta) o un testo (`make` in `engine/src/cmd/compoundshape.rs`).
/// Un gruppo vale se valgono tutti i suoi figli: un'immagine (che
/// l'apertura mette in un gruppo) o una guida dentro un gruppo il motore la
/// accetterebbe, ma la forma composta non la disegna.
fn componibile(nodo: &Node) -> bool {
    match &nodo.kind {
        NodeKind::Path { guide, .. } => !guide,
        NodeKind::Compound { .. } | NodeKind::Text(_) => true,
        NodeKind::Group { children, .. } => children.iter().all(|c| componibile(c)),
        _ => false,
    }
}

/// Un tratto della penna di Fub (`fub:ink`, ruolo `Stroke` o `Width`) è
/// scelto, o sta dentro un oggetto scelto: in una forma composta perderebbe
/// il suo inchiostro.
fn tocca_inchiostro(copia: &Copia, selezione: &[String]) -> bool {
    let mappa = &copia.mappa;
    let scelti: HashSet<usize> = selezione.iter().filter_map(|id| mappa.dell_id(id)).collect();
    mappa.elementi().iter().enumerate().any(|(i, e)| {
        if !crate::famiglie::tracciati::inchiostro(copia, e) {
            return false;
        }
        let mut j = Some(i);
        while let Some(k) = j {
            if scelti.contains(&k) {
                return true;
            }
            j = mappa.elemento(k).and_then(|e| e.genitore);
        }
        false
    })
}

/// Le forme composte fra gli oggetti scelti.
fn composte_scelte(copia: &Copia, nodi: &[NodeId]) -> Vec<NodeId> {
    nodi.iter()
        .copied()
        .filter(|n| copia.documento.node(*n).is_some_and(Node::is_compound_shape))
        .collect()
}

/// Perché un comando delle forme composte non vale sugli oggetti scelti
/// `nodi` (già controllati da [`nodi_scelti`]).
fn composta_spenta(id: &str, copia: &Copia, nodi: &[NodeId]) -> Option<DrawingDisabledReason> {
    if id == CREA_COMPOSTA {
        if nodi.len() < 2 {
            return Some(DrawingDisabledReason::NeedsTwo);
        }
        let tutti = nodi
            .iter()
            .all(|n| copia.documento.node(*n).is_some_and(|nodo| !nodo.locked && componibile(nodo)));
        return (!tutti).then_some(DrawingDisabledReason::NeedsPath);
    }
    if SULLA_COMPOSTA.contains(&id) && composte_scelte(copia, nodi).is_empty() {
        return Some(DrawingDisabledReason::Other { text: SCEGLI_UNA_COMPOSTA.into() });
    }
    None
}

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

    /// Una forma nuova non usa la selezione, ma con un pezzo che il motore non
    /// sa toccare, o bloccato, la selezione spegne il comando come per gli altri
    /// (`esegui` lo rifiuta comunque). I comandi delle forme composte vogliono
    /// una selezione che sanno usare, col perché.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if id == GENERATORE {
            return generatore_spento(copia, selezione);
        }
        if !delle_composte(id) {
            return super::selezione_spenta(copia, selezione);
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let nodi = match nodi_scelti(copia, selezione) {
            Ok(nodi) => nodi,
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        };
        if id == CREA_COMPOSTA && tocca_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::FubInk);
        }
        composta_spenta(id, copia, &nodi)
    }

    /// Una forma composta che non si può fare: un oggetto solo è `empty`;
    /// un oggetto che il motore non compone, o un tratto della penna di Fub,
    /// `unmapped`. Un comando su una composta senza una composta scelta è
    /// `empty`: non c'è niente da cambiare.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if id == GENERATORE {
            return rifiuto_del_generatore(copia, selezione);
        }
        if !delle_composte(id) {
            return None;
        }
        if id == CREA_COMPOSTA && tocca_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        let nodi = nodi_scelti(copia, selezione).ok()?;
        match composta_spenta(id, copia, &nodi)? {
            DrawingDisabledReason::NeedsPath => Some(DrawingRefusal::Unmapped),
            _ => Some(DrawingRefusal::Empty),
        }
    }

    /// Metodo forma col metodo che i membri hanno già: il motore non cambia
    /// niente, ma lascerebbe scelti i membri, e l'esito sembrerebbe un cambio
    /// della selezione. È `empty`, come ogni comando che non cambia niente.
    fn rifiuto_valore(id: &str, copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
        if id != METODO_FORMA {
            return None;
        }
        let metodo = valore.get("mode").and_then(Value::as_str).and_then(ShapeMode::parse)?;
        let membri = Self::uno_alla_volta(id, copia, selezione)?;
        let tutti = membri
            .iter()
            .all(|n| copia.documento.node(*n).is_some_and(|m| m.extras().shape_mode == metodo));
        (!membri.is_empty() && tutti).then_some(DrawingRefusal::Empty)
    }

    /// Metodo forma gira su ogni membro delle forme composte scelte: il
    /// motore cambia il metodo dei membri scelti, e nel file i membri non
    /// sono elementi che si scelgono.
    fn uno_alla_volta(id: &str, copia: &Copia, selezione: &[String]) -> Option<Vec<NodeId>> {
        if id != METODO_FORMA {
            return None;
        }
        let nodi = nodi_scelti(copia, selezione).ok()?;
        let membri = composte_scelte(copia, &nodi)
            .into_iter()
            .filter_map(|n| copia.documento.node(n).and_then(Node::children))
            .flat_map(|figli| figli.iter().map(|c| c.id))
            .collect();
        Some(membri)
    }

    /// Le lunghezze delle proprietà della forma (raggio degli angoli, raggio e lato del poligono)
    /// arrivano nella scena, come le legge Ispeziona documento (`nucleo::forma_della_selezione`):
    /// vanno al documento del motore con la scala della radice.
    fn argomenti_della_copia(id: &str, copia: &Copia, _selezione: &[String], valore: Value) -> Result<Value, PluginError> {
        if id != PROPRIETA_FORMA {
            return Ok(valore);
        }
        Ok(lunghezze_nel_motore(copia.radice, valore))
    }

    /// Espandi forma composta che non lascia niente: `empty`.
    fn rifiuto_del_motore(id: &str, errore: &EngineError) -> Option<DrawingRefusal> {
        let vuoto = matches!(errore, EngineError::Other(m) if m.ends_with(RISULTATO_VUOTO));
        (SULLA_COMPOSTA.contains(&id) && vuoto).then_some(DrawingRefusal::Empty)
    }

    /// Una forma nuova va nello stesso livello dove andrebbe lo strumento senza
    /// un livello scelto: il più alto che non è nascosto né bloccato. Senza
    /// livelli, la radice (`None`). Un livello bloccato o nascosto per tutti
    /// dice perché, come il gesto.
    fn livello(id: &str, copia: &Copia, _valore: &Value) -> Result<Option<NodeId>, DrawingRefusal> {
        if !COMANDI_DI_FORMA.contains(&id) {
            return Ok(None);
        }
        let mut livelli: Vec<_> = copia.mappa.elementi().iter().filter(|e| e.ruolo == Role::Layer).collect();
        if livelli.is_empty() {
            return Ok(None);
        }
        livelli.sort_by(|a, b| a.percorso.cmp(&b.percorso));
        let scelto = livelli
            .iter()
            .rev()
            .find(|e| !e.nascosto && !e.bloccato)
            .ok_or(DrawingRefusal::Locked)?;
        scelto.nodo.map(Some).ok_or(DrawingRefusal::Unmapped)
    }
}
