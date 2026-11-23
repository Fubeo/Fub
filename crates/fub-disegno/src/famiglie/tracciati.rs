//! La famiglia `tracciati` della mappa (piano K6, T12;
//! `docs/architecture/disegno-strumenti.md`, «I tracciati e i punti»).
//!
//! - **I comandi sui punti scelti** (`SUI_PUNTI`): la selezione di Fub dice
//!   oggetti, non punti. I punti scelti col gesto tornano nel `value` del
//!   comando (`anchors`, [`fub_abi::DrawingAnchor`]); [`punti`] li legge e li
//!   controlla sulla copia, e chi esegue li mette nella selezione del motore.
//! - **L'inchiostro di Fub** (`fub:ink`): uno strumento della famiglia che
//!   cambierebbe o toglierebbe un tratto della penna di Fub è rifiutato con
//!   `unmapped`, e niente cambia ([`inchiostro_toccato`]): i tratti si fanno
//!   dai campioni, e un taglio li perderebbe in tracciati qualsiasi. Lo
//!   stesso per i comandi sui punti ([`sceglie_inchiostro`]).
//! - **Oggetto › Tracciato** (`SUGLI_OGGETTI`, e con la finestra
//!   `CON_FINESTRA` ed Espandi): i comandi sui tracciati scelti. Spenti col
//!   perché come quelli sui punti (un tratto della penna di Fub scelto è
//!   `fub_ink`); un tratto della penna di Fub, scelto o toccato dal risultato
//!   (Dividi gli oggetti sotto taglia anche quelli sotto), è rifiutato con
//!   `unmapped`; un risultato che non divide niente è `empty`, e niente cambia
//!   ([`StatoFamiglia::rifiuto_dopo`]).
//! - **Elaborazione tracciati** (`ELABORAZIONE`, T12 giro 5): i quattro metodi
//!   forma e le sei operazioni di `object.pathfinder.*`, senza finestra. Il
//!   motore sostituisce gli oggetti scelti col risultato, nel posto del più
//!   alto: un metodo forma dà un tracciato (composto, regola `nonzero`, se ha
//!   più pezzi) con lo stile che sceglie il motore (fra due tracciati il più
//!   alto per Unione, Intersezione, Escludi e Meno dietro, il più basso per
//!   Meno davanti), un'operazione un gruppo nuovo di tracciati, che la
//!   differenza scrive come un `g` con i pezzi dentro. Gli id sono nuovi.
//!   Servono due oggetti scelti (`needs_two`); un testo diventa il contorno
//!   delle sue lettere, un gruppo vale per le forme che ha. Un'immagine, una
//!   guida, un gruppo di ritaglio o un gruppo vuoto il motore li toglierebbe
//!   senza usarli: la voce è spenta con `needs_path` e il comando rifiutato con
//!   `unmapped` ([`elaborabile`]). Un risultato vuoto (due forme che non si
//!   toccano, con Intersezione) è `empty`, e niente cambia
//!   ([`StatoFamiglia::rifiuto_del_motore`]).
//! - **Maschera di ritaglio** (`RITAGLI`, T12): Crea, Rilascia e Modifica
//!   contenuto, spenti e rifiutati col perché in `tracciati_ritagli.rs`.
//! - **I comandi su un punto** (`SU_UN_PUNTO`, T12 punti): spostare un punto o
//!   una maniglia, aggiungere, eliminare o convertire un punto, chiudere,
//!   continuare o dividere un tracciato. Nominano il tracciato con `element` e
//!   il punto per numero; `tracciati_punti.rs` li traduce per il motore.
//!   Sposta ancoraggi ed Elimina punti di ancoraggio (Canc) sono comandi sui
//!   punti scelti.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use fub_abi::{DrawingAnchor, DrawingDisabledReason, DrawingRefusal, MAX_DRAWING_ANCHORS};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::{Document, Node, NodeId, NodeKind};
use vectorcraft_engine::EngineError;

use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

#[path = "tracciati_ritagli.rs"]
mod ritagli;
use ritagli::{ritaglio_rifiutato, ritaglio_spento, RITAGLI};

#[path = "tracciati_punti.rs"]
mod su_un_punto;
use su_un_punto::{argomenti_del_punto, punto_rifiutato, SU_UN_PUNTO};

#[path = "tracciati_mano.rs"]
mod mano;

#[path = "tracciati_curva.rs"]
mod curva;

#[path = "tracciati_angoli.rs"]
mod angoli;

#[path = "tracciati_tagli.rs"]
mod tagli;

#[path = "tracciati_strumenti.rs"]
mod strumenti;

/// I comandi che lavorano sui punti di ancoraggio scelti.
pub(crate) const SUI_PUNTI: [&str; 10] = [
    "path.moveAnchors",
    "path.deleteAnchors",
    "path.convertAnchors",
    "path.cutAtAnchors",
    "path.join",
    "path.average",
    "path.averageJoin",
    "path.removeAnchors",
    "addon.pathtools.removeKeepShape",
    // Imposta punto di ancoraggio: muove i punti scelti (con le maniglie) e ne imposta le maniglie.
    "addon.pathtools.setAnchor",
];

/// I comandi sui punti che senza punti scelti non fanno niente: da ≡ sono
/// spenti con `needs_anchors`.
const SOLO_COI_PUNTI: [&str; 5] = [
    "path.deleteAnchors",
    "path.cutAtAnchors",
    "path.removeAnchors",
    "addon.pathtools.removeKeepShape",
    "addon.pathtools.setAnchor",
];

/// I comandi di Oggetto › Tracciato senza finestra, sui tracciati scelti.
const SUGLI_OGGETTI: [&str; 19] = [
    "path.reverse",
    "object.path.outlineStroke",
    "object.path.addAnchorPoints",
    "object.path.divideObjectsBelow",
    "object.compoundPath.make",
    "object.compoundPath.release",
    "addon.pathtools.smooth",
    "addon.pathtools.corner",
    "addon.pathtools.equalize",
    "addon.pathtools.close",
    "addon.pathtools.crossings",
    "addon.pathtools.expandDashes",
    "addon.pen.closeJoin",
    "addon.pathtools.cornerSet",
    "addon.pathtools.cornerRemove",
    "path.lineCut",
    "path.rectCut",
    "path.mirrorCut",
    "addon.pathtools.erase",
];

/// I comandi di Oggetto › Tracciato con una finestra (T12, giro 3), sui
/// tracciati scelti: i campi sono in `catalogo::FINESTRE_SCRITTE`.
const CON_FINESTRA: [&str; 4] = [
    "object.path.simplify",
    "object.path.smooth",
    "object.path.offsetPath",
    "addon.pathtools.divideDashes",
];

/// Espandi, con la sua finestra: vale su ogni oggetto scelto (un testo, una
/// forma, un tratto), non solo sui tracciati.
const ESPANDI: &str = "object.expand";

/// I metodi forma e le operazioni di Elaborazione tracciati (T12, giro 5),
/// nell'ordine del pannello del motore: senza finestra, su almeno due oggetti.
pub(crate) const ELABORAZIONE: [&str; 10] = [
    "object.pathfinder.unite",
    "object.pathfinder.minusFront",
    "object.pathfinder.intersect",
    "object.pathfinder.exclude",
    "object.pathfinder.divide",
    "object.pathfinder.trim",
    "object.pathfinder.merge",
    "object.pathfinder.crop",
    "object.pathfinder.outline",
    "object.pathfinder.minusBack",
];

/// La fine del messaggio del motore quando un'operazione di Elaborazione
/// tracciati non lascia niente (`run_pf` in `engine/src/cmd/pathops.rs`,
/// «{label} produced an empty result»). Il caso `empty` di
/// `tests/famiglie/tracciati.json` cade se il motore la cambia.
const RISULTATO_VUOTO: &str = "produced an empty result";

/// Il comando è uno di Oggetto › Tracciato (o Espandi) sugli oggetti scelti.
fn sugli_oggetti(id: &str) -> bool {
    SUGLI_OGGETTI.contains(&id)
        || CON_FINESTRA.contains(&id)
        || id == ESPANDI
        || ELABORAZIONE.contains(&id)
}

/// Il motore sa usare tutto l'oggetto in un'operazione di Elaborazione
/// tracciati: un tracciato, un composto, un testo, o un gruppo che ha almeno
/// una forma e soltanto di questi. Il motore toglie gli oggetti scelti interi e
/// mette il risultato al loro posto: un'immagine, una guida, un gruppo di
/// ritaglio o un gruppo vuoto se ne andrebbero senza entrare nel risultato.
fn elaborabile(nodo: &Node) -> bool {
    fn conta(nodo: &Node, forme: &mut usize) -> bool {
        match &nodo.kind {
            NodeKind::Path { guide: true, .. } | NodeKind::Path { clipping: true, .. } => false,
            NodeKind::Path { .. } | NodeKind::Compound { .. } => {
                *forme += 1;
                true
            }
            // Il motore usa il contorno delle lettere: un testo senza lettere
            // disegnate (vuoto, o senza i caratteri della sua famiglia e del
            // ripiego) sparirebbe senza entrare nel risultato.
            NodeKind::Text(t) => {
                let lettere =
                    vectorcraft_text::layout(vectorcraft_text::FontDb::global(), t).to_bezpath();
                *forme += 1;
                !lettere.elements().is_empty()
            }
            NodeKind::Group { clip: false, children } => children.iter().all(|c| conta(c, forme)),
            _ => false,
        }
    }
    let mut forme = 0;
    conta(nodo, &mut forme) && forme > 0
}

/// Perché un'operazione di Elaborazione tracciati non vale sugli oggetti
/// scelti `nodi`: meno di due (`needs_two`), o uno che il motore toglierebbe
/// senza usarlo (`needs_path`).
fn elaborazione_spenta(copia: &Copia, nodi: &[NodeId]) -> Option<DrawingDisabledReason> {
    if nodi.len() < 2 {
        return Some(DrawingDisabledReason::NeedsTwo);
    }
    let tutti = nodi
        .iter()
        .all(|n| copia.documento.node(*n).is_some_and(|nodo| !nodo.locked && elaborabile(nodo)));
    (!tutti).then_some(DrawingDisabledReason::NeedsPath)
}

/// Media e unisci (T12): porta due estremi aperti nel loro punto di mezzo e
/// li unisce lì.
const MEDIA_E_UNISCI: &str = "path.averageJoin";

/// Il perché di Media e unisci spento.
const DUE_ESTREMI: &str = "Scegli due tracciati aperti, o un tracciato aperto da chiudere.";

/// Semplifica e Smussa (con il livello, o `auto`): sul testo e sulle forme vive non c'è un tracciato da
/// cambiare, e il motore risponderebbe in modo generico. Con una scelta che ha almeno un tracciato, il
/// motore salta il resto, come dice la sua descrizione (K6 T12, finestre).
const SEMPLIFICA_E_SMUSSA: [&str; 2] = ["object.path.simplify", "object.path.smooth"];

/// Il perché, in italiano, per un testo o una forma viva scelti da sola (o con altri che non sono tracciati).
const TESTO_NON_SI_SEMPLIFICA: &str = "Il testo non si semplifica: prima crea i profili.";
const FORMA_NON_SI_SEMPLIFICA: &str = "Una forma non si semplifica: prima trasformala in tracciato.";

/// Il perché di Semplifica e Smussa quando la scelta non ha nessun tracciato, ma solo testo o forme
/// primitive (un `rect` o un `ellipse` di Fub, che il motore non ha come nodo). Si guarda il tag di
/// ciascun elemento della mappa, prima di legarlo al motore. `None` se c'è almeno un altro elemento
/// (un tracciato, un'immagine…), o se la scelta è vuota.
fn solo_testo_o_forme(copia: &Copia, selezione: &[String]) -> Option<&'static str> {
    if selezione.is_empty() {
        return None;
    }
    let mut c_e_testo = false;
    for id in selezione {
        let elemento = copia.mappa.elemento(copia.mappa.dell_id(id)?)?;
        match elemento.tag {
            "text" => c_e_testo = true,
            "rect" | "ellipse" => {}
            // Una forma viva di Fub (un rettangolo arrotondato, un'ellisse con la sua ricetta) ha un nodo
            // con la sua forma: vale come una forma primitiva.
            _ if elemento.nodo.and_then(|n| copia.documento.node(n)).is_some_and(|n| n.live_shape().is_some()) => {}
            _ => return None,
        }
    }
    Some(if c_e_testo { TESTO_NON_SI_SEMPLIFICA } else { FORMA_NON_SI_SEMPLIFICA })
}

/// I due estremi che Media e unisci unirebbe, come li cerca il motore
/// (`average_join_ends` in `engine/src/cmd/path.rs`), o `None`: i due punti
/// scelti `scelti`, se sono estremi di sottotracciati aperti; senza punti,
/// l'unico sottotracciato aperto dei tracciati scelti `nodi` (che si chiude, se
/// ha un punto fra i due estremi) o i due. Restituisce i sottotracciati.
fn estremi_da_unire(
    copia: &Copia,
    nodi: &[NodeId],
    scelti: Option<&BTreeMap<NodeId, BTreeSet<(usize, usize)>>>,
) -> Option<[(NodeId, usize); 2]> {
    let doc = &copia.documento;
    let aperto = |id: NodeId, si: usize| {
        doc.node(id)?
            .path_data()?
            .subpaths
            .get(si)
            .filter(|sp| !sp.closed && !sp.anchors.is_empty())
            .map(|sp| sp.anchors.len())
    };
    let [a, b] = match scelti {
        Some(scelti) => {
            let tutti: Vec<(NodeId, usize, usize)> = scelti
                .iter()
                .flat_map(|(id, punti)| punti.iter().map(move |&(si, ai)| (*id, si, ai)))
                .collect();
            let [x, y] = tutti.as_slice() else { return None };
            for &(id, si, ai) in [x, y] {
                let quanti = aperto(id, si)?;
                if ai != 0 && ai + 1 != quanti {
                    return None;
                }
            }
            [(x.0, x.1), (y.0, y.1)]
        }
        None => {
            let mut tracciati = Vec::new();
            for n in nodi {
                match doc.node(*n).map(|nodo| &nodo.kind) {
                    Some(NodeKind::Path { .. }) => tracciati.push(*n),
                    Some(NodeKind::Compound { children, .. }) => tracciati.extend(children.iter().map(|c| c.id)),
                    _ => {}
                }
            }
            let aperti: Vec<(NodeId, usize)> = tracciati
                .iter()
                .flat_map(|&id| {
                    let quanti = doc.node(id).and_then(|n| n.path_data()).map_or(0, |pd| pd.subpaths.len());
                    (0..quanti).filter(move |&si| aperto(id, si).is_some()).map(move |si| (id, si))
                })
                .collect();
            match aperti.as_slice() {
                [uno] => [*uno, *uno],
                [x, y] => [*x, *y],
                _ => return None,
            }
        }
    };
    // I due estremi di una linea: il punto di mezzo la schiaccerebbe.
    let linea = a == b && aperto(a.0, a.1).is_none_or(|quanti| quanti <= 2);
    (!linea).then_some([a, b])
}

/// Quanto un punto può essersi spostato (in coordinate di scena) ed essere
/// ancora lui: sotto la precisione dei numeri che il file scrive.
const TOLLERANZA: f64 = 1e-3;

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

    /// I comandi sui punti e quelli di Oggetto › Tracciato spenti, col
    /// perché: vogliono un tracciato scelto, che il motore conosce, non
    /// bloccato e in un disegno modificabile, e non un tratto della penna di
    /// Fub. Tagliare ed eliminare i punti vogliono anche i punti scelti, che
    /// la selezione di oggetti non dice: da ≡ sono spenti, con
    /// `needs_anchors`; la fila dei punti li manda con i suoi punti.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        // I gesti a mano libera (T12 giro 9) hanno le loro regole.
        if mano::MANO.contains(&id) {
            return mano::spento(id, copia, selezione);
        }
        if curva::CURVA.contains(&id) {
            return curva::spento(copia);
        }
        // Un comando su un punto nomina il suo tracciato nel valore: senza il
        // valore si sa solo se il disegno si cambia.
        if SU_UN_PUNTO.contains(&id) {
            return (!copia.modificabile).then_some(DrawingDisabledReason::ReadOnly);
        }
        if !SUI_PUNTI.contains(&id) && !sugli_oggetti(id) && !RITAGLI.contains(&id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        // Semplifica e Smussa: il testo e le forme primitive hanno la loro frase, prima dei nodi.
        if SEMPLIFICA_E_SMUSSA.contains(&id) {
            if let Some(frase) = solo_testo_o_forme(copia, selezione) {
                return Some(DrawingDisabledReason::Other { text: frase.into() });
            }
        }
        let nodi = match nodi_scelti(copia, selezione) {
            Ok(nodi) => nodi,
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        };
        if sceglie_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::FubInk);
        }
        if id == ESPANDI {
            return None;
        }
        if RITAGLI.contains(&id) {
            return ritaglio_spento(id, copia, &nodi);
        }
        if ELABORAZIONE.contains(&id) {
            return elaborazione_spenta(copia, &nodi);
        }
        // La carta è bloccata per il motore: non è un tracciato da cambiare.
        // Un tracciato composto (un `<path>` coi buchi) vale come tracciato.
        let tracciato = |n: &NodeId| {
            copia.documento.node(*n).is_some_and(|nodo| {
                !nodo.locked
                    && (nodo.path_data().is_some()
                        || matches!(nodo.kind, NodeKind::Compound { .. }))
            })
        };
        if !nodi.iter().any(tracciato) {
            return Some(DrawingDisabledReason::NeedsPath);
        }
        if SOLO_COI_PUNTI.contains(&id) {
            return Some(DrawingDisabledReason::NeedsAnchors);
        }
        if id == MEDIA_E_UNISCI && estremi_da_unire(copia, &nodi, None).is_none() {
            return Some(DrawingDisabledReason::Other {
                text: DUE_ESTREMI.into(),
            });
        }
        None
    }

    /// Media e unisci sui punti scelti che non sono due estremi aperti da
    /// unire (o sugli oggetti scelti, se la fila dei punti non ne manda):
    /// `empty`, prima del motore, che non saprebbe quali unire. Un comando su
    /// un punto il cui tracciato non si cambia, o che chiude un tracciato già
    /// chiuso: il suo rifiuto (`tracciati_punti.rs`).
    fn rifiuto_valore(id: &str, copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
        if curva::CURVA.contains(&id) {
            return curva::rifiuto_valore(copia, valore);
        }
        if angoli::ANGOLI.contains(&id) {
            return angoli::rifiuto(copia, selezione, valore);
        }
        if SU_UN_PUNTO.contains(&id) {
            return punto_rifiutato(id, copia, valore);
        }
        if id != MEDIA_E_UNISCI {
            return None;
        }
        let nodi = nodi_scelti(copia, selezione).ok()?;
        let scelti = punti(copia, &mut valore.clone()).ok()?;
        let scelti = (!scelti.is_empty()).then_some(&scelti);
        estremi_da_unire(copia, &nodi, scelti).is_none().then_some(DrawingRefusal::Empty)
    }

    /// I comandi su un punto: `element` diventa l'oggetto del motore, le
    /// coordinate della scena passano nel suo documento, gli indici si
    /// controllano sulla copia (`tracciati_punti.rs`).
    fn argomenti_della_copia(id: &str, copia: &Copia, _selezione: &[String], valore: Value) -> Result<Value, fub_abi::PluginError> {
        if mano::MANO.contains(&id) {
            return mano::argomenti(id, copia, valore);
        }
        if curva::CURVA.contains(&id) {
            return curva::argomenti(id, copia, valore);
        }
        if angoli::ANGOLI.contains(&id) {
            return angoli::argomenti(id, valore);
        }
        if tagli::TAGLI.contains(&id) {
            return tagli::argomenti(id, &valore);
        }
        if strumenti::STRUMENTI.contains(&id) {
            return strumenti::argomenti(id, copia, valore);
        }
        argomenti_del_punto(id, copia, valore)
    }

    /// Un comando di Oggetto › Tracciato su un tratto della penna di Fub:
    /// `unmapped`, prima di farlo girare.
    /// Elaborazione tracciati con meno di due oggetti non ha niente da
    /// combinare: `empty`; con un oggetto che il motore toglierebbe senza
    /// usarlo, `unmapped`.
    fn livello(id: &str, copia: &Copia, _valore: &Value) -> Result<Option<NodeId>, DrawingRefusal> {
        mano::livello(id, copia)
    }

    /// Semplifica e Smussa su solo testo o forme primitive: `unsupported`, prima dei nodi della scelta
    /// (che per un `rect` darebbero `unmapped`), con la stessa frase della voce spenta (K6 T12).
    fn rifiuto_prima_dei_nodi(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if !SEMPLIFICA_E_SMUSSA.contains(&id) {
            return None;
        }
        solo_testo_o_forme(copia, selezione).map(|_| DrawingRefusal::Unsupported)
    }

    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if mano::MANO.contains(&id) {
            return mano::rifiuto(id, copia, selezione);
        }
        if tagli::TAGLI.contains(&id) && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        if tagli::TAGLI.contains(&id) {
            return tagli::rifiuto(copia, selezione);
        }
        if id == strumenti::GOMMA_PUNTI {
            if sceglie_inchiostro(copia, selezione) {
                return Some(DrawingRefusal::Unmapped);
            }
            return strumenti::rifiuto(copia, selezione);
        }
        if (sugli_oggetti(id) || RITAGLI.contains(&id)) && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        if RITAGLI.contains(&id) {
            return ritaglio_rifiutato(id, copia, &nodi_scelti(copia, selezione).ok()?);
        }
        if !ELABORAZIONE.contains(&id) {
            return None;
        }
        let nodi = nodi_scelti(copia, selezione).ok()?;
        match elaborazione_spenta(copia, &nodi)? {
            DrawingDisabledReason::NeedsTwo => Some(DrawingRefusal::Empty),
            _ => Some(DrawingRefusal::Unmapped),
        }
    }

    /// Un'operazione di Elaborazione tracciati che non lascia niente: `empty`.
    fn rifiuto_del_motore(id: &str, errore: &EngineError) -> Option<DrawingRefusal> {
        let vuoto = matches!(errore, EngineError::Other(m) if m.ends_with(RISULTATO_VUOTO));
        (ELABORAZIONE.contains(&id) && vuoto).then_some(DrawingRefusal::Empty)
    }

    /// Dopo il comando: un tratto della penna di Fub cambiato o tolto, anche
    /// se non era scelto, è `unmapped`; Dividi gli oggetti sotto che non
    /// divide niente toglierebbe soltanto il tracciato che taglia: `empty`.
    fn rifiuto_dopo(
        id: &str,
        copia: &Copia,
        dopo: &Document,
        scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal> {
        if inchiostro_toccato(copia, dopo) {
            return Some(DrawingRefusal::Unmapped);
        }
        if id == "path.average" && media_schiaccia(copia, dopo) {
            return Some(DrawingRefusal::Empty);
        }
        (id == "object.path.divideObjectsBelow" && scelti_dopo.is_empty())
            .then_some(DrawingRefusal::Empty)
    }
}

/// I punti scelti del `value` di un comando sui punti, tolti dal valore,
/// come il motore li vuole nella selezione: per oggetto, `(sottotracciato,
/// punto)`. Senza `anchors`, niente (il comando vale sugli oggetti scelti).
/// Un punto che la copia non ha più dove il client l'ha visto è `stale`; uno
/// su un elemento che il motore non conosce `unmapped`, su uno bloccato
/// `locked`; troppi punti o una forma sbagliata sono argomenti sbagliati.
pub(crate) fn punti(
    copia: &Copia,
    valore: &mut Value,
) -> Result<BTreeMap<NodeId, BTreeSet<(usize, usize)>>, Rifiuto> {
    let mut fuori: BTreeMap<NodeId, BTreeSet<(usize, usize)>> = BTreeMap::new();
    let Some(grezzi) = valore.as_object_mut().and_then(|o| o.remove("anchors")) else {
        return Ok(fuori);
    };
    let scelti: Vec<DrawingAnchor> = serde_json::from_value(grezzi)
        .map_err(|e| Rifiuto::Argomenti(format!("`anchors`: {e}")))?;
    if scelti.len() > MAX_DRAWING_ANCHORS {
        return Err(Rifiuto::Argomenti(format!(
            "`anchors` has {} anchors, at most {MAX_DRAWING_ANCHORS}",
            scelti.len()
        )));
    }
    let indietro = copia.radice.inverse();
    for punto in scelti {
        let nodo = nodi_scelti(copia, std::slice::from_ref(&punto.element))
            .map_err(Rifiuto::Motore)?
            .into_iter()
            .next()
            .ok_or(Rifiuto::Motore(DrawingRefusal::Unmapped))?;
        let (si, ai) = (punto.subpath as usize, punto.anchor as usize);
        let qui = copia
            .documento
            .node(nodo)
            .and_then(|n| n.path_data())
            .ok_or(Rifiuto::Motore(DrawingRefusal::Stale))?
            .subpaths
            .get(si)
            .and_then(|sp| sp.anchors.get(ai))
            .map(|a| indietro * a.p)
            .ok_or(Rifiuto::Motore(DrawingRefusal::Stale))?;
        if (qui.x - punto.at[0]).abs() > TOLLERANZA || (qui.y - punto.at[1]).abs() > TOLLERANZA {
            return Err(Rifiuto::Motore(DrawingRefusal::Stale));
        }
        fuori.entry(nodo).or_default().insert((si, ai));
    }
    Ok(fuori)
}

/// Perché i punti di un comando non si prendono.
#[derive(Debug)]
pub(crate) enum Rifiuto {
    /// Un rifiuto del disegno (`stale`, `unmapped`, `locked`).
    Motore(DrawingRefusal),
    /// Argomenti sbagliati.
    Argomenti(String),
}

/// La selezione ha un tratto della penna di Fub (`fub:ink`, ruolo `Stroke`
/// o `Width`): i comandi sui punti non lo cambiano, come gli strumenti.
pub(crate) fn sceglie_inchiostro(copia: &Copia, selezione: &[String]) -> bool {
    selezione.iter().any(|id| {
        copia
            .mappa
            .dell_id(id)
            .and_then(|i| copia.mappa.elemento(i))
            .is_some_and(|e| matches!(e.ruolo, Role::Stroke | Role::Width))
    })
}

/// Vero se Media ha portato tutti i punti di un tracciato in un punto solo:
/// succede scegliendo un tracciato intero, senza punti scelti, con l'asse
/// «Tutti e due». Il tracciato non si vedrebbe più, e il file avrebbe una
/// trasformazione che schiaccia tutto: niente da fare (`empty`).
fn media_schiaccia(copia: &Copia, dopo: &Document) -> bool {
    copia.mappa.elementi().iter().any(|e| {
        let Some(n) = e.nodo else { return false };
        let (Some(prima), Some(ora)) = (copia.documento.node(n), dopo.node(n)) else {
            return false;
        };
        if std::ptr::eq(prima, ora) {
            return false;
        }
        let Some(dati) = ora.path_data() else { return false };
        let mut punti = dati.anchors().map(|(_, _, a)| a.p);
        let Some(primo) = punti.next() else { return false };
        let mut altri = punti.peekable();
        altri.peek().is_some() && altri.all(|p| (p - primo).hypot() < 1e-6)
    })
}

/// Lo strumento della famiglia ha cambiato o tolto un tratto della penna di
/// Fub (`fub:ink`, ruolo `Stroke` o `Width`): il suo oggetto in `dopo` non è
/// più quello della copia.
pub(crate) fn inchiostro_toccato(copia: &Copia, dopo: &Document) -> bool {
    copia.mappa.elementi().iter().any(|e| {
        matches!(e.ruolo, Role::Stroke | Role::Width)
            && e.nodo.is_some_and(|n| match (copia.documento.node(n), dopo.node(n)) {
                (Some(prima), Some(ora)) => !std::ptr::eq(prima, ora),
                (Some(_), None) => true,
                _ => false,
            })
    })
}
