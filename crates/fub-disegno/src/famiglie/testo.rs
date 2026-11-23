//! La famiglia `testo` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! Le facce dei caratteri aggiunte: pesano, ma non si svuotano senza rompere i testi che le usano.

use std::collections::HashSet;
use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use serde_json::{json, Value};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::{Document, NodeId, NodeKind};

use super::{byte_delle_tabelle, libera_le_tabelle, nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["font_faces"];

/// I comandi del testo scelto che il motore vuole su un testo solo
/// (`text.setRangeStyle` senza `id` prende «il» testo scelto): Fub li fa
/// girare una volta per testo, e Carattere e Paragrafo cambiano tutti i
/// testi scelti in un passo.
const SU_UN_TESTO: &[&str] = &["text.setRangeStyle", "text.setStyle"];

/// I comandi che cambiano i testi scelti: senza un testo fra gli oggetti
/// scelti sono spenti, e non cambiano niente (`empty`) invece dell'errore
/// del motore.
const SUI_TESTI: &[&str] = &[
    "text.setRangeStyle",
    "text.setStyle",
    "text.setFormat",
    "type.changeCase",
    "type.createOutlines",
    "type.convertToAreaType",
    "type.convertToPointType",
];

/// Cambia le parole di un testo (`text.editRange`).
const CAMBIA_LE_PAROLE: &str = "text.editRange";

/// Un argomento sbagliato di `text.editRange`, col perché.
fn sbagliato(perche: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(format!("{CAMBIA_LE_PAROLE}: {perche}").into())
}

/// L'elemento di `text.editRange`, con l'oggetto del motore del suo testo.
fn testo_nominato<'a>(
    copia: &'a Copia,
    valore: &Value,
) -> Result<(&'a crate::mappa::Elemento, NodeId), PluginError> {
    let o = valore
        .as_object()
        .ok_or_else(|| sbagliato("the value must be an object"))?;
    if o.contains_key("id") {
        return Err(sbagliato("name the text with `element`, not `id`"));
    }
    let element = o
        .get("element")
        .and_then(Value::as_str)
        .ok_or_else(|| sbagliato("missing `element`"))?;
    let e = copia
        .mappa
        .dell_id(element)
        .and_then(|i| copia.mappa.elemento(i))
        .filter(|e| e.testo.is_some())
        .ok_or_else(|| sbagliato(format!("`{element}` is not a text of the drawing")))?;
    let nodo = e
        .nodo
        .ok_or_else(|| sbagliato(format!("`{element}` is not a text of the drawing")))?;
    Ok((e, nodo))
}

/// Il pezzo che cambia fra il testo `prima` e il testo `dopo`: il byte dove
/// comincia, dove finisce in `prima`, e ciò che va al suo posto (le parti
/// uguali in testa e in coda restano).
fn pezzo_cambiato<'a>(prima: &str, dopo: &'a str) -> (usize, usize, &'a str) {
    let testa: usize = prima
        .chars()
        .zip(dopo.chars())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum();
    let coda: usize = prima[testa..]
        .chars()
        .rev()
        .zip(dopo[testa..].chars().rev())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum();
    (testa, prima.len() - coda, &dopo[testa..dopo.len() - coda])
}

/// Gli oggetti del motore dei `<text>` scelti, nell'ordine della selezione.
fn testi_scelti(copia: &Copia, selezione: &[String]) -> Vec<NodeId> {
    selezione
        .iter()
        .filter_map(|id| copia.mappa.elemento(copia.mappa.dell_id(id)?))
        .filter(|e| e.testo.is_some())
        .filter_map(|e| e.nodo)
        .collect()
}

/// Vero se un testo della copia non c'è più in `dopo` e nessun gruppo ne
/// porta il nome (il gruppo dei contorni di Crea profili ha il nome del
/// testo da cui viene).
fn testo_sparito(copia: &Copia, dopo: &Document) -> bool {
    let mut nomi = HashSet::new();
    dopo.walk(|n| {
        if matches!(n.kind, NodeKind::Group { .. }) {
            if let Some(nome) = &n.name {
                nomi.insert(nome.as_str());
            }
        }
    });
    let mut sparito = false;
    copia.documento.walk(|n| {
        if matches!(n.kind, NodeKind::Text(_))
            && dopo.node(n.id).is_none()
            && !n.name.as_deref().is_some_and(|nome| nomi.contains(nome))
        {
            sparito = true;
        }
    });
    sparito
}

/// Lo stato della famiglia: le sue tabelle nel motore.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        byte_delle_tabelle(TABELLE)
    }

    fn libera(&self) -> u64 {
        libera_le_tabelle(TABELLE)
    }

    /// Carattere e Paragrafo vogliono almeno un testo scelto, che si possa
    /// cambiare.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if !SUI_TESTI.contains(&id) {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        match nodi_scelti(copia, selezione) {
            Ok(_) => {}
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        }
        testi_scelti(copia, selezione)
            .is_empty()
            .then_some(DrawingDisabledReason::NeedsText)
    }

    /// Un comando sui testi senza un testo scelto non cambia niente.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        (SUI_TESTI.contains(&id) && testi_scelti(copia, selezione).is_empty())
            .then_some(DrawingRefusal::Empty)
    }

    /// Crea profili toglie un testo che non ha contorni da disegnare (un
    /// carattere che manca, solo spazi) senza mettere niente al suo posto:
    /// le parole sparirebbero dal file, e il comando non si fa.
    fn rifiuto_dopo(
        id: &str,
        copia: &Copia,
        dopo: &Document,
        _scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal> {
        (id == "type.createOutlines" && testo_sparito(copia, dopo))
            .then_some(DrawingRefusal::Unsupported)
    }

    /// Cambia le parole di un testo bloccato o nascosto: no, col motivo.
    fn rifiuto_valore(
        id: &str,
        copia: &Copia,
        _selezione: &[String],
        valore: &Value,
    ) -> Option<DrawingRefusal> {
        if id != CAMBIA_LE_PAROLE {
            return None;
        }
        let (e, _) = testo_nominato(copia, valore).ok()?;
        if e.bloccato {
            return Some(DrawingRefusal::Locked);
        }
        e.nascosto.then_some(DrawingRefusal::Hidden)
    }

    /// `text.editRange` nomina il testo con l'id di Fub (`element`) e dà le
    /// parole nuove intere (`text`, le righe separate da `\n`): Fub ne fa
    /// il pezzo che cambia, in byte del testo del motore, che il motore
    /// sostituisce in un passo. Così il client manda il testo una volta, alla
    /// conferma, e non conta byte di un testo che non vede.
    fn argomenti_della_copia(id: &str, copia: &Copia, _selezione: &[String], valore: Value) -> Result<Value, PluginError> {
        if id != CAMBIA_LE_PAROLE {
            return Ok(valore);
        }
        let (_, nodo) = testo_nominato(copia, &valore)?;
        if ["start", "end", "insert", "runs"].iter().any(|k| valore.get(k).is_some()) {
            return Err(sbagliato("give the new words whole in `text`"));
        }
        let nuovo = valore
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| sbagliato("missing `text`"))?
            .replace("\r\n", "\n")
            .replace('\r', "\n");
        let Some(NodeKind::Text(t)) = copia.documento.node(nodo).map(|n| &n.kind) else {
            return Err(sbagliato("the element is not a text of the drawing"));
        };
        let prima = t.plain_text();
        let (start, end, insert) = pezzo_cambiato(&prima, &nuovo);
        Ok(json!({ "id": nodo.0, "start": start, "end": end, "insert": insert }))
    }

    /// Un testo alla volta: gli altri oggetti scelti restano come sono.
    fn uno_alla_volta(id: &str, copia: &Copia, selezione: &[String]) -> Option<Vec<NodeId>> {
        SU_UN_TESTO
            .contains(&id)
            .then(|| testi_scelti(copia, selezione))
    }
}
