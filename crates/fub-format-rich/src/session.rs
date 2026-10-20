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

use serde::{Deserialize, Serialize};
use wordcraft_doc::{Document, RevisionKind};

use crate::fidelity::{reads_back, revisions_outside_body, same};
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
    /// Non si rilegge identico dopo una scrittura del codec.
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
        None => fidelity(codec, &projection, &normal)?,
    };
    projection.readonly = readonly;
    Ok(Opened {
        projection: projection.to_json()?,
        readonly,
    })
}

/// Scrive la proiezione `json` sul documento `current`, i byte del file alla
/// revisione su cui la shell ha lavorato.
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
    Ok(Saved::Bytes(bytes))
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
/// della shell.
fn fidelity(
    codec: Codec,
    projection: &Projection,
    document: &Document,
) -> Result<Option<ReadOnly>, RichError> {
    let wire = Projection::from_json(&projection.to_json()?)?;
    if unproject(&wire, document).ok().as_ref() != Some(document) {
        return Ok(Some(ReadOnly::Projection));
    }
    let reread = codec
        .write(document)
        .and_then(|bytes| codec.read(&bytes))
        .map(|d| normalized(&d));
    if !reread.is_ok_and(|reread| reads_back(document, &reread)) {
        return Ok(Some(ReadOnly::Codec));
    }
    Ok(None)
}
