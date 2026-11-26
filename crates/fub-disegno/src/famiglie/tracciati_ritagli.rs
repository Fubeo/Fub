//! Le maschere di ritaglio della famiglia `tracciati` (piano K6, T12): Oggetto
//! › Maschera di ritaglio › Crea, Rilascia e Modifica contenuto. Come il file
//! le scrive lo dice `differenza_ritagli.rs`.
//!
//! - **Crea** vuole almeno due oggetti scelti (`needs_two`), e il più alto
//!   deve essere un tracciato o un tracciato composto (`needs_path`): il
//!   motore ritaglia anche con un testo, ma il file non sa ancora scrivere un
//!   testo dentro un `clipPath`.
//! - **Rilascia** vuole una maschera fra gli oggetti scelti; **Modifica
//!   contenuto** una maschera, o un oggetto dentro una maschera. Senza, la
//!   voce è spenta col perché e il comando è `empty`: il motore non farebbe
//!   niente.
//! - Un `clip-path` scritto su un tracciato, non su un gruppo (come lo
//!   scrivono altri programmi), si apre e resta com'è; il motore lo mette in un
//!   gruppo suo che il file non ha, così Rilascia lo rifiuta `unsupported` e
//!   Modifica contenuto non lo conta come maschera.
//!
//! - **Modifica maschera** sceglie il tracciato che ritaglia di ogni maschera
//!   fra gli oggetti scelti (o che li contiene), come il motore. Il file lo
//!   tiene come forma del `clipPath` privato del gruppo, con un id suo
//!   (`Mappa::lega_i_ritagli`): così si sceglie, si sposta e si modifica come
//!   ogni oggetto, e il cambio si scrive sulla forma. Un ritaglio senza quella
//!   forma (di un altro programma, o con il `clipPath` condiviso) non ha un
//!   tracciato da scegliere: la voce è spenta col perché.

use fub_abi::{DrawingDisabledReason, DrawingRefusal};
use vectorcraft_doc::{Node, NodeId, NodeKind};

use crate::apertura::Copia;

/// I comandi delle maschere di ritaglio.
pub(super) const RITAGLI: [&str; 4] = [
    "object.clippingMask.make",
    "object.clippingMask.release",
    "object.clippingMask.editContents",
    "object.clippingMask.editMask",
];

/// Il perché di una voce spenta quando non c'è una maschera da usare.
const SCEGLI_UNA_MASCHERA: &str = "Scegli una maschera di ritaglio.";

/// Il perché di Rilascia spento su un oggetto che ha il ritaglio scritto su di
/// sé (`clip-path` su un tracciato, come lo scrivono altri programmi), non in
/// un gruppo: il file non ha un gruppo da sciogliere.
const RITAGLIO_SULL_OGGETTO: &str =
    "Questo ritaglio è scritto sull'oggetto stesso, non su un gruppo: Rilascia non lo toglie ancora.";

/// Il perché di Modifica maschera spento su una maschera il cui tracciato
/// non è una forma del file che si sceglie.
const MASCHERA_SENZA_FORMA: &str =
    "Il tracciato di questa maschera non si modifica da solo: è scritto in un ritaglio di un altro programma o condiviso. Rilascia la maschera e rifalla.";

/// Perché un comando delle maschere non vale sugli oggetti scelti `nodi`
/// (già controllati: mappati, non bloccati, nel disegno modificabile).
pub(super) fn ritaglio_spento(id: &str, copia: &Copia, nodi: &[NodeId]) -> Option<DrawingDisabledReason> {
    let doc = &copia.documento;
    match id {
        "object.clippingMask.make" => {
            if nodi.len() < 2 {
                return Some(DrawingDisabledReason::NeedsTwo);
            }
            // La carta e gli altri oggetti che il motore tiene bloccati non entrano in un gruppo.
            if nodi.iter().any(|n| doc.node(*n).is_none_or(|nodo| nodo.locked)) {
                return Some(DrawingDisabledReason::ReadOnly);
            }
            let cima = il_piu_alto(copia, nodi).and_then(|n| doc.node(n));
            (!cima.is_some_and(ritaglia)).then_some(DrawingDisabledReason::NeedsPath)
        }
        "object.clippingMask.release" => {
            if nodi.iter().any(|n| doc.node(*n).is_some_and(Node::clips)) {
                return None;
            }
            // `clip-path` scritto sull'oggetto stesso: il motore lo mette in un gruppo di ritaglio
            // suo, che nel file non c'è.
            let sull_oggetto = nodi.iter().any(|n| {
                doc.position(*n)
                    .and_then(|(g, _, _)| g)
                    .is_some_and(|g| doc.node(g).is_some_and(Node::clips) && copia.mappa.del_nodo(g).is_none())
            });
            Some(if sull_oggetto {
                DrawingDisabledReason::Other {
                    text: RITAGLIO_SULL_OGGETTO.into(),
                }
            } else {
                scegli_una_maschera()
            })
        }
        "object.clippingMask.editContents" => {
            let c_e = nodi.iter().any(|n| dentro_una_maschera(copia, *n));
            (!c_e).then(scegli_una_maschera)
        }
        "object.clippingMask.editMask" => {
            let maschere: Vec<NodeId> = nodi.iter().filter_map(|n| maschera_di(copia, *n)).collect();
            if maschere.is_empty() {
                return Some(scegli_una_maschera());
            }
            // Ogni maschera trovata deve avere la sua forma nel file.
            let con_forma = |g: &NodeId| {
                doc.node(*g)
                    .and_then(|n| n.children()?.first().map(|c| c.id))
                    .and_then(|c| copia.mappa.del_nodo(c))
                    .and_then(|i| copia.mappa.elemento(i))
                    .is_some_and(|e| e.ritaglia)
            };
            (!maschere.iter().all(con_forma)).then(|| DrawingDisabledReason::Other {
                text: MASCHERA_SENZA_FORMA.into(),
            })
        }
        _ => None,
    }
}

/// Il rifiuto di un comando delle maschere che non vale: niente da fare
/// (`empty`), o un oggetto in cima che il file non sa scrivere come
/// tracciato di ritaglio (`unsupported`).
pub(super) fn ritaglio_rifiutato(id: &str, copia: &Copia, nodi: &[NodeId]) -> Option<DrawingRefusal> {
    match ritaglio_spento(id, copia, nodi)? {
        DrawingDisabledReason::NeedsPath => Some(DrawingRefusal::Unsupported),
        DrawingDisabledReason::Other { text } if text == RITAGLIO_SULL_OGGETTO || text == MASCHERA_SENZA_FORMA => {
            Some(DrawingRefusal::Unsupported)
        }
        DrawingDisabledReason::ReadOnly => Some(DrawingRefusal::Locked),
        _ => Some(DrawingRefusal::Empty),
    }
}

fn scegli_una_maschera() -> DrawingDisabledReason {
    DrawingDisabledReason::Other {
        text: SCEGLI_UNA_MASCHERA.into(),
    }
}

/// Un oggetto che può ritagliare nel file: un tracciato che non è una guida
/// né già un tracciato di ritaglio, o un tracciato composto.
fn ritaglia(nodo: &Node) -> bool {
    matches!(
        nodo.kind,
        NodeKind::Path {
            guide: false,
            clipping: false,
            ..
        } | NodeKind::Compound { .. }
    )
}

/// Il più alto fra `nodi` nell'ordine di pittura del motore (l'ultimo che il
/// giro del documento incontra), come il motore sceglie il tracciato che
/// ritaglia.
fn il_piu_alto(copia: &Copia, nodi: &[NodeId]) -> Option<NodeId> {
    let mut cima = None;
    copia.documento.walk(|n| {
        if nodi.contains(&n.id) {
            cima = Some(n.id);
        }
    });
    cima
}

/// Vero se `n` è una maschera o sta dentro una maschera, come la cerca
/// Modifica contenuto del motore. Conta solo una maschera che è un elemento
/// del file: il gruppo che il motore fa per un `clip-path` scritto su un
/// tracciato non c'è nel file, e il motore sceglierebbe l'oggetto stesso.
fn dentro_una_maschera(copia: &Copia, n: NodeId) -> bool {
    maschera_di(copia, n).is_some()
}

/// La maschera più vicina che è `n` o lo contiene, come la cerca il motore,
/// se è un elemento del file.
fn maschera_di(copia: &Copia, n: NodeId) -> Option<NodeId> {
    let doc = &copia.documento;
    let mut cur = Some(n);
    while let Some(c) = cur {
        let maschera = doc
            .node(c)
            .is_some_and(|nodo| matches!(nodo.kind, NodeKind::Group { clip: true, .. }));
        if maschera {
            return copia.mappa.del_nodo(c).map(|_| c);
        }
        cur = doc.position(c).and_then(|(genitore, _, _)| genitore);
    }
    None
}
