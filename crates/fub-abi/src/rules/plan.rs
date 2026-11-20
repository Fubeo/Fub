//! **Come si scrive un piano su più documenti, tutto o niente** (A-10).
//!
//! Un comando che sposta un blocco da una nota a un'altra scrive due file. Il
//! lotto del kernel ([`Workspace::batch`]) li fa diventare *una cosa sola* per
//! chi ascolta — un `batch-ended`, il dispatch rimandato — ma non è una
//! transazione: se il secondo file non si scrive, il primo resta scritto, e il
//! blocco è sparito da una nota senza arrivare nell'altra.
//!
//! Questa è la regola che lo impedisce, e sta nel contratto per la stessa
//! ragione delle altre di questo modulo: chi la usa è un comando, cioè codice
//! che riceve soltanto un [`HostApi`] — il kernel, il proxy che lo serve fuori
//! dal lucchetto, il gemello dei test. Composta dalle capacità che ognuno di
//! loro già serve, è **la stessa** per tutti, e passa da ogni loro guardia: un
//! piano non dà a un comando un permesso che le capacità una per una non gli
//! darebbero. E per la stessa ragione non tiene il workspace fra un passo e
//! l'altro: ogni passo è una capacità, e ogni capacità prende e rilascia il
//! suo turno.
//!
//! # I tre tempi
//!
//! 1. **Il controllo, prima di scrivere.** Ogni modifica ha la sua revisione,
//!    ogni rinomina la sua, ogni nome da creare o da occupare dev'essere
//!    libero. Se uno non passa l'errore torna subito, e non è stato scritto
//!    niente. È anche il momento in cui si tiene la copia di ogni documento
//!    che si sta per toccare.
//! 2. **La scrittura**, passo per passo nell'ordine del piano. Ogni passo
//!    porta ancora la sua base: se un altro scrittore è passato fra il
//!    controllo e la scrittura, il passo fallisce invece di sovrascrivere.
//! 3. **Il ritorno, se un passo cade.** I passi già fatti si disfano
//!    all'indietro — l'inverso della modifica, il cestino per ciò che è nato
//!    (mai la distruzione), la rinomina all'incontrario — e poi torna l'errore
//!    del passo caduto. Se anche un ritorno fallisce, la copia di prima va nei
//!    dati del plugin (sotto `.fub/`) e l'errore nomina i file e dove sono le
//!    copie: nessuna perdita silenziosa.
//!
//! Gli eventi non sono affare di questa regola: dentro un comando il kernel
//! tiene già un lotto aperto, quindi ciò che il piano scrive (e ciò che
//! disfa) esce **una volta, dopo**, come fatti in coda.
//!
//! [`Workspace::batch`]: https://docs.rs/fub-kernel
//! [`HostApi`]: crate::traits::HostApi

use std::collections::HashMap;

use crate::command::{AppliedPlan, AppliedStep, WritePlan, WriteStep};
use crate::edit::Revision;
use crate::error::PluginError;
use crate::model::DocId;
use crate::traits::HostApi;

/// La cartella, nello spazio dati del plugin, dove finiscono le copie dei file
/// che un piano non è riuscito a rimettere com'erano.
pub const UNRESTORED_DIR: &str = "piani-non-rimessi";

/// Perché un piano non è stato scritto.
///
/// Due casi, e [`rolled_back`](PlanFailure::rolled_back) li distingue: o il
/// vault è com'era prima (il caso normale: un conflitto, un nome occupato, un
/// disco pieno e il ritorno riuscito), o qualche file non è tornato e
/// [`unrestored`](PlanFailure::unrestored) dice quali e dov'è la loro copia.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanFailure {
    /// L'errore del passo che ha fermato il piano (o del controllo).
    pub error: PluginError,
    /// Il documento su cui il piano si è fermato, se è uno solo.
    pub failed: Option<DocId>,
    /// I documenti che il ritorno non ha rimesso com'erano. Vuoto = il vault è
    /// com'era prima del piano.
    pub unrestored: Vec<Unrestored>,
}

/// Un documento che il ritorno non ha rimesso com'era.
#[derive(Clone, Debug, PartialEq)]
pub struct Unrestored {
    /// Il documento, col nome che aveva **prima** del piano.
    pub doc: DocId,
    /// Dove sta la copia di prima, nello spazio dati del plugin
    /// (`piani-non-rimessi/…`). `None` per un documento che prima non c'era
    /// (nato dal piano e rimasto) o se anche la copia non si è potuta scrivere.
    pub copy: Option<String>,
    /// Perché non è tornato.
    pub why: PluginError,
}

impl PlanFailure {
    fn before_writing(error: PluginError, doc: &DocId) -> Self {
        PlanFailure {
            error,
            failed: Some(doc.clone()),
            unrestored: Vec::new(),
        }
    }

    /// Il vault è com'era prima del piano?
    pub fn rolled_back(&self) -> bool {
        self.unrestored.is_empty()
    }
}

impl From<PlanFailure> for PluginError {
    /// Un piano tornato indietro è l'errore del suo passo, col suo tipo: un
    /// [`Conflict`](PluginError::Conflict) resta un conflitto, e chi lo riceve
    /// rilegge e riprova come per una modifica sola.
    ///
    /// Uno **non** tornato non può restare un conflitto — «non è stato
    /// scritto niente, riprova» sarebbe falso — e diventa
    /// [`Io`](PluginError::Io), con i file e le copie nella frase.
    fn from(failure: PlanFailure) -> Self {
        if failure.rolled_back() {
            return failure.error;
        }
        let files: Vec<String> = failure
            .unrestored
            .iter()
            .map(|left| match &left.copy {
                Some(copy) => format!("«{}» (la copia di prima è in `{copy}`)", left.doc),
                None => format!("«{}»", left.doc),
            })
            .collect();
        let at = failure
            .failed
            .as_ref()
            .map(|doc| format!(" su «{doc}»"))
            .unwrap_or_default();
        PluginError::Io(
            format!(
                "il piano si è fermato{at} ({}) e questi file non sono tornati com'erano: {}",
                failure.error,
                files.join(", ")
            )
            .into(),
        )
    }
}

/// Cosa il controllo sa di un documento, a metà del piano.
enum Known {
    /// Non c'è (o non ci sarà più: è stato rinominato altrove).
    Absent,
    /// È il nome nuovo di una rinomina: ha i byte di prima, ancora intatti.
    Moved(Vec<u8>),
    /// Il piano lo scrive già: un secondo passo sullo stesso documento non ha
    /// una base che si possa controllare prima.
    Written,
}

/// Scrive `plan` tutto o niente. Vedi il modulo.
pub fn apply(host: &mut dyn HostApi, plan: WritePlan) -> Result<AppliedPlan, PlanFailure> {
    let before = check(host, &plan)?;
    let mut applied: Vec<AppliedStep> = Vec::with_capacity(plan.steps.len());
    for step in plan.steps {
        let (doc, outcome) = match step {
            WriteStep::Edit(planned) => {
                let outcome =
                    host.apply_edit(&planned.doc, planned.edit)
                        .map(|report| AppliedStep::Edited {
                            doc: planned.doc.clone(),
                            report,
                        });
                (planned.doc, outcome)
            }
            WriteStep::Create { doc, source } => {
                let outcome = host.create_document(&doc, &source).map(|()| {
                    // La revisione la dice l'host, che sa cosa ha scritto; se
                    // non risponde, quella del testo consegnato è la stessa
                    // per una sorgente UTF-8, che è ciò che `source` è.
                    let revision = host
                        .document_revision(&doc)
                        .unwrap_or_else(|_| Revision::of(&source));
                    AppliedStep::Created {
                        doc: doc.clone(),
                        revision,
                    }
                });
                (doc, outcome)
            }
            WriteStep::Rename { from, to, base } => {
                let outcome = host
                    .rename_document(&from, &to)
                    .map(|()| AppliedStep::Renamed {
                        from: from.clone(),
                        to: to.clone(),
                        // Una rinomina non cambia i byte: la revisione è la base.
                        revision: base,
                    });
                (from, outcome)
            }
        };
        match outcome {
            Ok(done) => applied.push(done),
            Err(error) => {
                let unrestored = roll_back(host, applied, &before);
                return Err(PlanFailure {
                    error,
                    failed: Some(doc),
                    unrestored,
                });
            }
        }
    }
    Ok(AppliedPlan { steps: applied })
}

/// Il primo tempo: controlla tutto, non scrive niente, e torna le copie dei
/// documenti che il piano toccherà.
fn check(host: &dyn HostApi, plan: &WritePlan) -> Result<HashMap<DocId, Vec<u8>>, PlanFailure> {
    let mut known: HashMap<DocId, Known> = HashMap::new();
    let mut before: HashMap<DocId, Vec<u8>> = HashMap::new();
    let twice = |doc: &DocId| {
        PlanFailure::before_writing(
            PluginError::BadArgs(
                format!("«{doc}» compare due volte nel piano: ogni documento si scrive una volta")
                    .into(),
            ),
            doc,
        )
    };
    for step in &plan.steps {
        match step {
            WriteStep::Edit(planned) => {
                let doc = &planned.doc;
                let bytes = match known.get(doc) {
                    None => {
                        let bytes = read_existing(host, doc)?;
                        before.insert(doc.clone(), bytes.clone());
                        bytes
                    }
                    Some(Known::Moved(bytes)) => bytes.clone(),
                    Some(Known::Absent) => {
                        return Err(PlanFailure::before_writing(
                            PluginError::BadArgs(
                                format!("«{doc}» non c'è più quando il piano lo modifica").into(),
                            ),
                            doc,
                        ))
                    }
                    Some(Known::Written) => return Err(twice(doc)),
                };
                if !planned.edit.base.matches_bytes(&bytes) {
                    return Err(changed(doc));
                }
                known.insert(doc.clone(), Known::Written);
            }
            WriteStep::Create { doc, .. } => {
                match known.get(doc) {
                    None => require_free(host, doc)?,
                    Some(Known::Absent) => {}
                    Some(_) => return Err(twice(doc)),
                }
                known.insert(doc.clone(), Known::Written);
            }
            WriteStep::Rename { from, to, base } => {
                if known.contains_key(from) {
                    return Err(twice(from));
                }
                let bytes = read_existing(host, from)?;
                if !base.matches_bytes(&bytes) {
                    return Err(changed(from));
                }
                match known.get(to) {
                    None => require_free(host, to)?,
                    Some(Known::Absent) => {}
                    Some(_) => return Err(twice(to)),
                }
                before.insert(from.clone(), bytes.clone());
                // La copia anche sotto il nome nuovo: una modifica del piano
                // su quel nome che poi non torna ha bisogno dei byte di prima
                // lì, perché il ritorno la cerca col nome che il documento ha
                // quando cade (A-10).
                before.insert(to.clone(), bytes.clone());
                known.insert(from.clone(), Known::Absent);
                known.insert(to.clone(), Known::Moved(bytes));
            }
        }
    }
    Ok(before)
}

fn changed(doc: &DocId) -> PlanFailure {
    PlanFailure::before_writing(
        PluginError::Conflict(
            format!("«{doc}» è cambiato da quando il piano è stato calcolato").into(),
        ),
        doc,
    )
}

fn read_existing(host: &dyn HostApi, doc: &DocId) -> Result<Vec<u8>, PlanFailure> {
    host.read_document_bytes(doc)
        .map_err(|error| PlanFailure::before_writing(error, doc))
}

/// Un nome da occupare dev'essere libero. «Non trovato» è la risposta che
/// cerchiamo; ogni altro errore (un permesso, un disco) resta un errore e non
/// diventa «libero».
fn require_free(host: &dyn HostApi, doc: &DocId) -> Result<(), PlanFailure> {
    match host.read_document_bytes(doc) {
        Err(PluginError::NotFound(_)) => Ok(()),
        Err(error) => Err(PlanFailure::before_writing(error, doc)),
        Ok(_) => Err(PlanFailure::before_writing(
            PluginError::AlreadyExists(format!("«{doc}» esiste già").into()),
            doc,
        )),
    }
}

/// Il terzo tempo: disfa all'indietro ciò che è stato scritto, e torna ciò che
/// non è tornato (con la sua copia al sicuro).
fn roll_back(
    host: &mut dyn HostApi,
    applied: Vec<AppliedStep>,
    before: &HashMap<DocId, Vec<u8>>,
) -> Vec<Unrestored> {
    let mut left: Vec<(DocId, PluginError)> = Vec::new();
    for step in applied.into_iter().rev() {
        match step {
            AppliedStep::Edited { doc, report } => {
                if report.is_empty() {
                    continue;
                }
                if let Err(why) = host.apply_edit(&doc, report.inverse()) {
                    left.push((doc, why));
                }
            }
            AppliedStep::Created { doc, revision } => {
                // Il cestino e non la distruzione: se il ritorno sbagliasse,
                // l'inverso di un gesto reversibile deve restare reversibile.
                if let Err(why) = host.trash_document_if(&doc, &revision) {
                    left.push((doc, why));
                }
            }
            AppliedStep::Renamed { from, to, .. } => match host.rename_document(&to, &from) {
                // Ciò che non è tornato sotto il nome nuovo ora sta sotto il
                // vecchio, ed è con quello che lo si nomina.
                Ok(()) => left
                    .iter_mut()
                    .filter(|(doc, _)| *doc == to)
                    .for_each(|(doc, _)| *doc = from.clone()),
                Err(why) => left.push((from, why)),
            },
        }
    }
    if left.is_empty() {
        return Vec::new();
    }
    let stamp = host.now_unix_millis();
    left.into_iter()
        .map(|(doc, why)| {
            let copy = before.get(&doc).and_then(|bytes| {
                let path = format!("{UNRESTORED_DIR}/{stamp}/{}", doc.as_str());
                host.data_write(&path, bytes).ok().map(|()| path)
            });
            Unrestored { doc, copy, why }
        })
        .collect()
}
