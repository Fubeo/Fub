//! Aprire un documento come proiezione e salvarlo da una proiezione.
//!
//! Le due operazioni sono pure: byte in, byte o JSON out, senza stato fra una
//! chiamata e l'altra. Chi le compone (l'host) tiene la revisione e il CAS.
//!
//! **Aprire** chiede prima al codec se il documento letto descrive tutto il
//! file ([`Codec::lossless`]): un importatore apre in sola lettura con
//! [`ReadOnly::Import`]. Poi controlla due andate e ritorni prima di permettere
//! di scrivere:
//! la proiezione deve tornare al documento identico, e il documento deve
//! rileggersi identico dopo una scrittura del codec. Se uno dei due fallisce,
//! la proiezione esce lo stesso, con [`ReadOnly`]: si legge, non si scrive.
//!
//! L'OpenDocument fa eccezione: apre e salva con il codec di Fub (`odt`), che
//! lavora sull'XML del file e fa le proprie prove, con le stesse specie.
//!
//! **Salvare** rilegge sempre ciò che sta per scrivere: se i byte nuovi non
//! descrivono il documento voluto non si scrive niente, e chi scrive tiene il
//! proprio buffer.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use wordcraft_doc::{Document, RevisionKind};


use crate::fidelity::{reads_back, revisions_outside_body, same};
use crate::preservation;
use crate::projection::{self, Projection};
use crate::unproject::unproject;
use crate::{Codec, RichError};

/// Perché un documento si apre soltanto in lettura.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadOnly {
    /// Ha revisioni tracciate che la superficie non mostra (modifiche di
    /// formato, o revisioni in note, intestazioni, commenti e caselle di
    /// testo): scriverci sopra le accetterebbe o le perderebbe. Gli
    /// inserimenti e le eliminazioni del testo si mostrano e si scrivono.
    Revisions,
    /// Registra le modifiche, in un formato in cui la superficie non le
    /// registra (l'OpenDocument): ogni scrittura dovrebbe diventare una
    /// revisione. Un `.docx` che le registra si apre con `track`.
    TrackChanges,
    /// È protetto contro le modifiche.
    Protected,
    /// Non torna identico dalla proiezione.
    Projection,
    /// Il codec non lo riscriverebbe identico: il modello non si rilegge
    /// uguale, oppure la prova a vuoto perde o aggiunge qualcosa nei byte del
    /// pacchetto (un elemento, un attributo, una relazione, una parte copiata;
    /// vedi [`crate::preservation`]).
    Codec,
    /// È stato letto da un importatore che non riporta il file intero.
    Import,
}

/// Un documento aperto.
#[derive(Clone, Debug, PartialEq)]
pub struct Opened {
    /// La proiezione in JSON, con `readonly` quando non si scrive.
    pub projection: String,
    pub readonly: Option<ReadOnly>,
}

/// L'esito di un salvataggio.
#[derive(Clone, Debug, PartialEq)]
pub enum Saved {
    /// La proiezione descrive il documento com'è: non c'è niente da scrivere.
    Unchanged,
    /// I byte nuovi del file, già riletti.
    Bytes(Vec<u8>),
}

/// Apre i byte di un file come proiezione.
pub fn open(codec: Codec, bytes: &[u8]) -> Result<Opened, RichError> {
    if codec == Codec::Odt {
        return crate::odt::open(bytes);
    }
    let document = codec.read(bytes)?;
    let normal = normalized(&document);
    let mut projection = projection::project(&normal)?;
    let readonly = match policy(&normal) {
        Some(reason) => Some(reason),
        None if !codec.lossless() => Some(ReadOnly::Import),
        None => match fidelity(codec, bytes, &projection, &normal)? {
            Ok(locked) => {
                projection.locked = locked.iter().map(|at| *at as u32).collect();
                None
            }
            Err(reason) => Some(reason),
        },
    };
    projection.readonly = readonly;
    Ok(Opened {
        projection: projection.to_json()?,
        readonly,
    })
}

/// Scrive la proiezione `json` sul documento `current`, i byte del file alla
/// revisione su cui la shell ha lavorato.
///
/// Il codec scrive il documento voluto, e i byte devono rileggersi uguali.
/// Poi, quando il corpo si legge come flusso ([`crate::flow`]):
///
/// - un blocco che l'apertura ha chiuso non si tocca ([`RichError::Locked`]);
/// - nei blocchi toccati resta ciò che la proiezione non porta;
/// - se fuori dal corpo niente è cambiato, il file nuovo è un **innesto**
///   ([`crate::graft`]): il file com'era, con le unità toccate prese dai
///   byte del codec, e riletto uguale al voluto.
///
/// Altrimenti si scrive il pacchetto del codec, se l'apertura ha dimostrato
/// che il codec lo riscrive intero senza perdite, con il controllo dei
/// blocchi e delle parti non toccati ([`preservation::check_save`]).
pub fn save(codec: Codec, current: &[u8], json: &str) -> Result<Saved, RichError> {
    if codec == Codec::Odt {
        return crate::odt::save(current, json);
    }
    let base = normalized(&codec.read(current)?);
    if let Some(reason) = policy(&base) {
        return Err(RichError::ReadOnly(reason));
    }
    if !codec.lossless() {
        return Err(RichError::ReadOnly(ReadOnly::Import));
    }
    let projection = Projection::from_json(json)?;
    // Aperto in sola lettura per una ragione che l'apertura ha misurato: come
    // per quelle che il documento dice di sé, nessun salvataggio, con la sua
    // specie. La rilettura qui sotto resta la garanzia per chi quel campo lo
    // togliesse.
    if let Some(reason) = projection.readonly {
        return Err(RichError::ReadOnly(reason));
    }
    let wanted = unproject(&projection, &base)?;
    // Uguale a meno del numero delle parti: una storia che un oggetto ha
    // riportato con un altro id è la stessa storia.
    if same(&wanted, &base) {
        return Ok(Saved::Unchanged);
    }
    let bytes = codec.write(&wanted)?;
    if !reads_back(&wanted, &normalized(&codec.read(&bytes)?)) {
        return Err(RichError::Fidelity);
    }
    // I controlli di Fub sui byte: il file da sovrascrivere deve essere quello
    // che il codec sa riscrivere, e i byte nuovi devono lasciare identico ciò
    // che l'utente non ha toccato. La prova a vuoto della base l'ha già fatta,
    // di solito, l'apertura degli stessi byte.
    let key = preservation::key(current);
    let baseline = match preservation::remembered(&key) {
        Some(baseline) => baseline,
        None => {
            let dry = codec.write(&base)?;
            let Ok(baseline) = preservation::check_open(current, &dry, base.body.len()) else {
                return Err(RichError::ReadOnly(ReadOnly::Codec));
            };
            let baseline = Arc::new(baseline);
            preservation::remember(key, Arc::clone(&baseline));
            baseline
        }
    };
    let pairs = preservation::untouched_blocks(&base, &wanted);
    if baseline.flow {
        if let Some(saved) = flowing(codec, current, &bytes, &base, &wanted, &pairs, &baseline)? {
            return Ok(Saved::Bytes(saved));
        }
    }
    if !baseline.whole {
        return Err(RichError::Locked(None));
    }
    if preservation::check_save(&baseline, &bytes, &base, &wanted, &pairs).is_err() {
        return Err(RichError::Fidelity);
    }
    Ok(Saved::Bytes(bytes))
}

/// Il salvataggio sul flusso: i blocchi chiusi, ciò che la proiezione non
/// porta nei blocchi toccati, poi l'innesto. `None` se l'innesto non si fa:
/// chi chiama passa alla scrittura intera.
fn flowing(
    codec: Codec,
    current: &[u8],
    bytes: &[u8],
    base: &Document,
    wanted: &Document,
    pairs: &[(usize, usize)],
    baseline: &preservation::Baseline,
) -> Result<Option<Vec<u8>>, RichError> {
    let touched = preservation::touched_blocks(base, pairs);
    if let Some(at) = touched.iter().find(|at| baseline.locked.contains(at)) {
        return Err(RichError::Locked(Some(*at)));
    }
    let limits = &crate::inventory::LIMITS;
    let (Ok(o), Ok(n)) = (
        crate::flow::main_of(current, limits),
        crate::flow::main_of(bytes, limits),
    ) else {
        return Ok(None);
    };
    if o.scan.blocks.len() != base.body.len() || n.scan.blocks.len() != wanted.body.len() {
        return Ok(None);
    }
    if let Err((at, _)) = preservation::check_touched(&o.scan, &n.scan, pairs) {
        return Err(RichError::Locked(Some(at)));
    }
    if !preservation::body_only(base, wanted, pairs) {
        return Ok(None);
    }
    let Ok(pieces) = crate::graft::plan(&o, &n, pairs) else {
        return Ok(None);
    };
    let Ok(grafted) = crate::graft::graft(current, &o, &n, &pieces, limits) else {
        return Ok(None);
    };
    // L'innesto è un file nuovo: si rilegge come ogni altro.
    match codec.read(&grafted) {
        Ok(read) if reads_back(wanted, &normalized(&read)) => Ok(Some(grafted)),
        _ => Ok(None),
    }
}

/// I byte di un documento vuoto: la base di chi scrive una proiezione in un
/// file che ancora non c'è.
pub fn blank(codec: Codec) -> Result<Vec<u8>, RichError> {
    if codec == Codec::Odt {
        return crate::odt::blank();
    }
    codec.write(&Document::new())
}

fn normalized(document: &Document) -> Document {
    let mut out = document.clone();
    out.normalize_runs();
    out
}

/// Ciò che il documento stesso dice di sé.
fn policy(document: &Document) -> Option<ReadOnly> {
    let format = document
        .revisions
        .iter()
        .any(|revision| revision.kind == RevisionKind::Format);
    if format || revisions_outside_body(document) {
        return Some(ReadOnly::Revisions);
    }
    if document
        .settings
        .protection
        .as_deref()
        .is_some_and(|p| !p.is_empty() && p != "none")
    {
        return Some(ReadOnly::Protected);
    }
    None
}

/// Le due andate e ritorni. La proiezione passa dal JSON, come farà quella
/// della shell. Se il documento si scrive, dà i blocchi che non si toccano.
fn fidelity(
    codec: Codec,
    original: &[u8],
    projection: &Projection,
    document: &Document,
) -> Result<Result<std::collections::BTreeSet<usize>, ReadOnly>, RichError> {
    let wire = Projection::from_json(&projection.to_json()?)?;
    if unproject(&wire, document).ok().as_ref() != Some(document) {
        return Ok(Err(ReadOnly::Projection));
    }
    let Ok(written) = codec.write(document) else {
        return Ok(Err(ReadOnly::Codec));
    };
    let reread = codec.read(&written).map(|d| normalized(&d));
    if !reread.is_ok_and(|reread| reads_back(document, &reread)) {
        return Ok(Err(ReadOnly::Codec));
    }
    // Il modello torna uguale; i byte devono dire che il modello descrive il
    // file: ciò che il lettore ha saltato manca dalla prova a vuoto.
    let Ok(baseline) = preservation::check_open(original, &written, document.body.len()) else {
        return Ok(Err(ReadOnly::Codec));
    };
    let locked = baseline.locked.clone();
    preservation::remember(preservation::key(original), Arc::new(baseline));
    Ok(Ok(locked))
}
