//! Che cosa manca a un documento aperto in sola lettura: dove sta ciò che la
//! superficie non mostrerebbe o non riscriverebbe identico, perché chi legge
//! lo trovi. Lo dice la proiezione ([`Projection::missing`]); il ritorno lo
//! ignora.
//!
//! Lo si cerca soltanto per le ragioni che hanno un posto: le revisioni che
//! la superficie non mostra e i blocchi che la proiezione non riporta
//! identici. Un documento protetto, o letto da un importatore, manca di
//! qualcosa ovunque, e la ragione basta.

use serde_json::Value;
use wordcraft_doc::{Document, PartKind, RevisionKind};

use crate::projection::{Missing, MissingWhat, Projection};
use crate::unproject::unproject;

/// Quante voci dice al massimo l'elenco: il resto lo dice la ragione.
pub const MAX_MISSING: usize = 50;

/// Le revisioni che la superficie non mostra: quelle di formato, nel blocco
/// del corpo che le porta, e ogni revisione fuori dal corpo, una volta per
/// specie di parte.
pub(crate) fn revisions(document: &Document) -> Vec<Missing> {
    let mut out = Vec::new();
    for (at, block) in document.body.iter().enumerate() {
        if out.len() == MAX_MISSING {
            return out;
        }
        if serde_json::to_value(&**block).is_ok_and(|value| tracked(document, &value, false)) {
            out.push(Missing {
                what: MissingWhat::Format,
                block: Some(at),
            });
        }
    }
    let mut parts: Vec<MissingWhat> = Vec::new();
    for part in document.parts.values() {
        let what = part_what(part.kind);
        if parts.contains(&what) {
            continue;
        }
        let tracked = part.blocks.iter().any(|block| {
            serde_json::to_value(&**block).is_ok_and(|value| tracked(document, &value, true))
        });
        if tracked {
            parts.push(what);
        }
    }
    parts.sort();
    out.extend(parts.into_iter().map(|what| Missing { what, block: None }));
    out.truncate(MAX_MISSING);
    if out.is_empty() {
        // Una revisione di formato fuori dai blocchi: della pagina dell'ultima
        // sezione, per esempio.
        out.push(Missing {
            what: MissingWhat::Outside,
            block: None,
        });
    }
    out
}

/// I blocchi del corpo che la proiezione non riporta identici. Se il corpo
/// torna identico, manca qualcosa fuori dal corpo; se non torna con lo
/// stesso numero di blocchi, non si sa dove.
pub(crate) fn changes(projection: &Projection, document: &Document) -> Vec<Missing> {
    let changed = |block| {
        vec![Missing {
            what: MissingWhat::Changed,
            block,
        }]
    };
    let Ok(wire) = projection
        .to_json()
        .and_then(|json| Projection::from_json(&json))
    else {
        return changed(None);
    };
    let back = match unproject(&wire, document) {
        Ok(back) => back,
        Err(_) => return changed(first_refused(&wire, document)),
    };
    if back.body.len() != document.body.len() {
        return changed(None);
    }
    let out: Vec<Missing> = back
        .body
        .iter()
        .zip(&document.body)
        .enumerate()
        .filter(|(_, (a, b))| a != b)
        .map(|(at, _)| Missing {
            what: MissingWhat::Changed,
            block: Some(at),
        })
        .take(MAX_MISSING)
        .collect();
    if out.is_empty() {
        return vec![Missing {
            what: MissingWhat::Outside,
            block: None,
        }];
    }
    out
}

/// Il primo blocco con cui il ritorno rifiuta la proiezione: il più corto
/// dei suoi inizi che il ritorno rifiuta finisce con lui. Si cerca a metà,
/// così un documento lungo non si riporta indietro una volta per blocco.
fn first_refused(wire: &Projection, document: &Document) -> Option<usize> {
    let refuses = |len: usize| {
        let mut prefix = wire.clone();
        prefix.blocks.truncate(len);
        unproject(&prefix, document).is_err()
    };
    // Fra `ok` e `refused` sta il primo inizio rifiutato.
    let (mut ok, mut refused) = (1, wire.blocks.len());
    if refuses(ok) {
        // Il primo blocco, se senza blocchi il ritorno non rifiuta.
        return (!refuses(0)).then_some(0);
    }
    while refused - ok > 1 {
        let mid = ok + (refused - ok) / 2;
        if refuses(mid) {
            refused = mid;
        } else {
            ok = mid;
        }
    }
    Some(refused - 1)
}

fn part_what(kind: PartKind) -> MissingWhat {
    match kind {
        PartKind::Header => MissingWhat::Header,
        PartKind::Footer => MissingWhat::Footer,
        PartKind::Footnote | PartKind::Endnote => MissingWhat::Note,
        PartKind::Comment => MissingWhat::Comment,
        PartKind::TextBox => MissingWhat::TextBox,
    }
}

/// Il blocco serializzato porta una revisione di formato (un `rev` che
/// indica una revisione `Format`) o, con `any`, anche un inserimento o
/// un'eliminazione (`ins`, `del`).
fn tracked(document: &Document, value: &Value, any: bool) -> bool {
    match value {
        Value::Object(map) => {
            let format = map
                .get("rev")
                .and_then(Value::as_u64)
                .and_then(|rev| document.revisions.get(rev as usize))
                .is_some_and(|revision| revision.kind == RevisionKind::Format);
            let change = any
                && ["ins", "del"]
                    .iter()
                    .any(|key| map.get(*key).is_some_and(Value::is_u64));
            format || change || map.values().any(|value| tracked(document, value, any))
        }
        Value::Array(items) => items.iter().any(|value| tracked(document, value, any)),
        _ => false,
    }
}
