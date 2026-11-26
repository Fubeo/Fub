//! La famiglia `testo` della mappa: il suo stato (`docs/architecture/disegno-completo.md`).
//!
//! Le facce dei caratteri aggiunte: pesano, ma non si svuotano senza rompere i testi che le usano.

use std::collections::HashSet;
use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use serde_json::{json, Value};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::{Document, NodeId, NodeKind};
use vectorcraft_geom::{Affine, Point};

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
    "type.step",
    "type.size.increase",
    "type.size.decrease",
    "type.size.increaseByFive",
    "type.size.decreaseByFive",
    "type.resetTracking",
    "type.resetHorizontalScale",
    "type.orientation.vertical",
    "type.orientation.horizontal",
    "type.scaleTextAttributes",
    "text.setText",
    "type.fillPlaceholder",
    "type.insert",
    OPZIONI_AREA,
    OPZIONI_TRACCIATO,
];

/// Opzioni testo in area (`text.areaOptions`): senza valori legge quelle del primo testo scelto.
const OPZIONI_AREA: &str = "text.areaOptions";

/// Opzioni testo su tracciato (`type.pathOptions`): senza valori legge quelle del primo testo scelto.
const OPZIONI_TRACCIATO: &str = "type.pathOptions";

/// Le lunghezze delle due finestre di opzioni, che vanno e tornano con la scala della radice.
const LUNGHEZZE_DELLE_OPZIONI: &[&str] = &["width", "height", "gutter", "rowGutter", "inset", "firstBaselineMin", "spacing"];

/// I comandi che in VectorCraft mandano gli strumenti Testo e la Selezione diretta: dal client
/// nominano gli oggetti con l'id del file (o li prendono dalla selezione) e danno punti e
/// spostamenti nella scena.
const DEGLI_STRUMENTI: &[&str] = &[
    "text.create",
    "text.createInPath",
    "text.discardEmpty",
    "text.reshapeArea",
    "text.reshapePath",
];

/// I comandi che fanno un testo nuovo: il `<text>` si scrive come quello degli strumenti Testo
/// (`gesti::strumento::scrivi_testo`, con le righe di `con_le_righe`).
pub(crate) const FANNO_UN_TESTO: &[&str] = &["text.create", "text.createInPath"];

/// Un argomento sbagliato del comando `id`, col perché.
fn argomento_sbagliato(id: &str, perche: impl std::fmt::Display) -> PluginError {
    PluginError::BadArgs(format!("{id}: {perche}").into())
}

/// Il numero `x` come valore JSON (`null` se non è finito: il motore lo rifiuta).
fn numero(x: f64) -> Value {
    serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// La scala della radice (il `viewBox`), che una lunghezza prende.
fn scala(radice: Affine) -> f64 {
    radice.determinant().abs().sqrt()
}

/// Le lunghezze delle finestre di opzioni, moltiplicate per `per` (la scala della radice per
/// andare al motore, il suo inverso per tornare alla scena). Ciò che non è un numero resta.
fn lunghezze(mut valore: Value, per: f64) -> Value {
    if !(per.is_finite() && per > 0.0) || (per - 1.0).abs() < 1e-12 {
        return valore;
    }
    if let Some(campi) = valore.as_object_mut() {
        for chiave in LUNGHEZZE_DELLE_OPZIONI {
            if let Some(n) = campi.get(*chiave).and_then(Value::as_f64) {
                campi.insert((*chiave).into(), numero(n * per));
            }
        }
    }
    valore
}

/// L'oggetto del motore dell'elemento `nome` del file, se la mappa lo ha.
fn nodo_dell_id(copia: &Copia, nome: &str) -> Option<NodeId> {
    copia.mappa.elemento(copia.mappa.dell_id(nome)?)?.nodo
}

/// L'oggetto che il comando `id` nomina con la chiave `chiave`: l'id del file, oppure, senza, il
/// primo degli oggetti scelti che `adatto` prende. Un numero (l'id del motore) non si accetta: il
/// client non vede gli oggetti del motore.
fn oggetto_nominato(
    id: &str,
    chiave: &str,
    copia: &Copia,
    selezione: &[String],
    valore: &Value,
    adatto: impl Fn(&NodeKind) -> bool,
) -> Result<NodeId, PluginError> {
    let preso = |n: NodeId| copia.documento.node(n).is_some_and(|nodo| adatto(&nodo.kind));
    match valore.get(chiave) {
        Some(Value::String(nome)) => nodo_dell_id(copia, nome)
            .filter(|n| preso(*n))
            .ok_or_else(|| argomento_sbagliato(id, format!("`{nome}` is not an object this command takes"))),
        Some(_) => Err(argomento_sbagliato(id, format!("name the object in `{chiave}` with its id in the file"))),
        None => selezione
            .iter()
            .filter_map(|nome| nodo_dell_id(copia, nome))
            .find(|n| preso(*n))
            .ok_or_else(|| argomento_sbagliato(id, format!("missing `{chiave}`, and no object selected takes it"))),
    }
}

/// Il punto `[x, y]` della chiave `chiave`, dalla scena al documento del motore.
fn punto_nel_motore(campi: &mut serde_json::Map<String, Value>, chiave: &str, radice: Affine) {
    let xy = campi.get(chiave).and_then(Value::as_array).and_then(|o| match o.as_slice() {
        [x, y] => Some([x.as_f64()?, y.as_f64()?]),
        _ => None,
    });
    if let Some([x, y]) = xy {
        let p = radice * Point::new(x, y);
        campi.insert(chiave.into(), Value::Array(vec![numero(p.x), numero(p.y)]));
    }
}

/// Gli argomenti di un comando degli strumenti, dalla scena e dagli id del file al motore.
fn argomenti_degli_strumenti(
    id: &str,
    copia: &Copia,
    selezione: &[String],
    mut valore: Value,
) -> Result<Value, PluginError> {
    let radice = copia.radice;
    let [a, _, _, d, e, f] = radice.as_coeffs();
    let testo = |k: &NodeKind| matches!(k, NodeKind::Text(_));
    let tracciato = |k: &NodeKind| matches!(k, NodeKind::Path { guide: false, .. });
    let nodo = match id {
        "text.createInPath" => Some(("path", oggetto_nominato(id, "path", copia, selezione, &valore, tracciato)?)),
        "text.discardEmpty" => Some(("id", oggetto_nominato(id, "id", copia, selezione, &valore, testo)?)),
        "text.reshapeArea" | "text.reshapePath" if valore.get("items").is_none() => {
            Some(("id", oggetto_nominato(id, "id", copia, selezione, &valore, testo)?))
        }
        _ => None,
    };
    let elementi = match valore.get("items").and_then(Value::as_array) {
        Some(voci) if id == "text.reshapeArea" => Some(
            voci.iter()
                .map(|voce| {
                    let n = oggetto_nominato(id, "id", copia, &[], voce, testo)?;
                    let mut voce = voce.clone();
                    if let Some(o) = voce.as_object_mut() {
                        o.insert("id".into(), json!(n.0));
                    }
                    Ok(voce)
                })
                .collect::<Result<Vec<_>, PluginError>>()?,
        ),
        _ => None,
    };
    let Some(campi) = valore.as_object_mut() else {
        return Err(argomento_sbagliato(id, "the value must be an object"));
    };
    // Un testo nuovo nasce col carattere e il corpo di Fub, come quello degli strumenti: il
    // carattere di serie del motore Fub non lo ha.
    if FANNO_UN_TESTO.contains(&id) {
        campi.entry("font").or_insert_with(|| json!(crate::gesti::testo::TEXT_FONT));
        campi.entry("size").or_insert_with(|| json!(crate::gesti::testo::TEXT_SIZE));
    }
    if let Some((chiave, n)) = nodo {
        campi.insert(chiave.into(), json!(n.0));
    }
    if let Some(voci) = elementi {
        campi.insert("items".into(), Value::Array(voci));
    }
    if radice == Affine::IDENTITY {
        return Ok(valore);
    }
    let mut cambia = |chiave: &str, come: &dyn Fn(f64) -> f64| {
        if let Some(n) = campi.get(chiave).and_then(Value::as_f64) {
            campi.insert(chiave.into(), numero(come(n)));
        }
    };
    match id {
        "text.create" => {
            cambia("x", &|x| a * x + e);
            cambia("y", &|y| d * y + f);
            cambia("size", &|n| n * scala(radice));
            if let Some(area) = campi.get_mut("area") {
                *area = lunghezze(area.take(), scala(radice));
            }
        }
        "text.createInPath" => cambia("size", &|n| n * scala(radice)),
        "text.reshapeArea" | "text.reshapePath" => {
            cambia("dx", &|x| a * x);
            cambia("dy", &|y| d * y);
        }
        _ => {}
    }
    punto_nel_motore(campi, "at", radice);
    Ok(valore)
}

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

    /// Le due finestre di opzioni senza valori leggono quelle del primo testo scelto.
    fn legge(&self, id: &str) -> bool {
        id == OPZIONI_AREA || id == OPZIONI_TRACCIATO
    }

    /// Le opzioni lette tornano nella scena: le lunghezze col contrario della scala della radice.
    fn lettura(&self, id: &str, copia: &Copia, risultato: Value) -> Value {
        if id == OPZIONI_AREA || id == OPZIONI_TRACCIATO {
            return lunghezze(risultato, 1.0 / scala(copia.radice));
        }
        risultato
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

    /// Cambia le parole di un testo bloccato o nascosto: no, col motivo. Un testo nuovo senza
    /// parole (né il testo segnaposto) non si fa: nel file sarebbe un `<text>` vuoto, che il motore
    /// non rilegge come un suo oggetto, e VectorCraft lo scarta (Scarta testo vuoto).
    fn rifiuto_valore(
        id: &str,
        copia: &Copia,
        _selezione: &[String],
        valore: &Value,
    ) -> Option<DrawingRefusal> {
        if FANNO_UN_TESTO.contains(&id) {
            let parole = valore.get("text").and_then(Value::as_str).is_some_and(|t| !t.is_empty());
            let segnaposto = valore.get("placeholder").and_then(Value::as_bool).unwrap_or(false);
            return (!parole && !segnaposto).then_some(DrawingRefusal::Empty);
        }
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
    fn argomenti_della_copia(id: &str, copia: &Copia, selezione: &[String], valore: Value) -> Result<Value, PluginError> {
        if DEGLI_STRUMENTI.contains(&id) {
            return argomenti_degli_strumenti(id, copia, selezione, valore);
        }
        if id == OPZIONI_AREA || id == OPZIONI_TRACCIATO {
            return Ok(lunghezze(valore, scala(copia.radice)));
        }
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
