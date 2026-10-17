//! Preimage-backed commit/restart control around existing ImportProvider ports.
//! Staging remains authoritative until the caller explicitly commits. A journal
//! is durable before the first target mutation, so interrupted work can be
//! inspected and rolled back after reopening the vault.
//!
//! # Che cosa è dell'import
//!
//! Il journal è scritto **prima** dell'apply, e fra l'apply e il rollback un
//! altro scrittore può creare un bersaglio o modificarne uno (FUB-007). Il
//! rollback quindi agisce soltanto su ciò che può provare scritto dall'import:
//!
//! - la **ricevuta** che l'importer lascia dopo ogni scrittura ([`receipts`])
//!   dice con quale revisione l'ha lasciato, e il rollback torna indietro solo
//!   se la revisione attuale è quella;
//! - per un importer senza ricevute vale ciò che il suo rapporto dichiara
//!   scritto, con l'impronta riletta subito dopo l'apply;
//! - ciò che non ha né l'una né l'altra, e non è com'era prima, è **ambiguo**: il
//!   rollback non lo indovina, si ferma con un conflitto e tiene backup e
//!   journal.
//!
//! Il confronto e la mutazione sono un'operazione sola dell'host (scrittura o
//! cestinamento condizionati alla revisione controllata): rileggere una
//! revisione dopo aver guardato il contenuto non proteggerebbe ciò che si è
//! guardato.
//!
//! # Il rollback è tutto o niente, e ha una via d'uscita
//!
//! Il rollback controlla **ogni** bersaglio prima di cambiarne uno: un
//! rollback a metà lascerebbe un import riportato indietro in parte, che non è
//! né quello che l'utente ha approvato né ciò che c'era prima. Quando un
//! bersaglio non si può provare (un journal di prima delle ricevute, un import
//! interrotto di un importer di terzi) il rollback si ferma e journal e
//! preimmagini restano. L'utente ha due strade: sistemare a mano il bersaglio
//! ambiguo e rilanciare il rollback, oppure decidere di tenere il vault com'è e
//! [`abandon`]are il journal, che toglie journal, ricevute e preimmagini senza
//! toccare nessun bersaglio.
//!
//! [`receipts`]: crate::receipts

use std::collections::HashSet;

use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_abi::transfer::{
    ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportSource, SourceContent,
};
use fub_abi::PluginError;

use crate::common::{bad_args, content_hash_hex, MAX_MANIFEST_BYTES, MAX_TOTAL_UNCOMPRESSED};
use crate::receipts;
use crate::template::{Importer, StagingManifest};

const JOURNAL_SCHEMA: u32 = 1;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Preimage {
    doc: DocId,
    existed: bool,
    before_sha: Option<String>,
    after_sha: Option<String>,
    /// The apply did not write this target (skipped, failed or absent from
    /// its report): whatever it holds belongs to someone else.
    #[serde(default)]
    untouched: bool,
    /// La revisione che l'import ha lasciato sul bersaglio, dalla ricevuta
    /// dell'importer. Senza, il bersaglio si prova con l'impronta del dopo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Journal {
    schema: u32,
    source_sha: String,
    entries: Vec<Preimage>,
    committed: Option<ImportReport>,
}

pub(crate) fn journal_path(job: &str) -> String {
    format!("imports/commit/{job}.json")
}
fn receipt_path(job: &str) -> String {
    format!("imports/commit-receipts/{job}.json")
}

fn backup_path(job: &str, index: usize) -> String {
    format!("imports/preimages/{job}/{index}")
}

fn save(job: &str, journal: &Journal, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let raw = serde_json::to_vec(journal)
        .map_err(|e| bad_args(format!("commit journal cannot be serialized: {e}")))?;
    if raw.len() > MAX_MANIFEST_BYTES {
        return Err(bad_args("commit journal exceeds 1 MiB"));
    }
    host.data_write(&journal_path(job), &raw)
}

fn load(job: &str, host: &dyn HostApi) -> Result<Option<Journal>, PluginError> {
    let Some(raw) = host.data_read(&journal_path(job))? else {
        if host.data_read(&receipt_path(job))?.is_some() {
            return Err(PluginError::Conflict(
                format!("job `{job}` has a receipt without its preimage journal").into(),
            ));
        }
        return Ok(None);
    };
    if raw.len() > MAX_MANIFEST_BYTES {
        return Err(bad_args("commit journal exceeds 1 MiB"));
    }
    let mut journal: Journal = serde_json::from_slice(&raw)
        .map_err(|e| bad_args(format!("commit journal unreadable: {e}")))?;
    if journal.schema != JOURNAL_SCHEMA {
        return Err(bad_args(format!(
            "unsupported commit journal schema {}",
            journal.schema
        )));
    }
    if let Some(receipt) = host.data_read(&receipt_path(job))? {
        // A torn receipt never destroys the immutable preimage journal.
        if receipt.len() <= MAX_MANIFEST_BYTES {
            if let Ok(saved) = serde_json::from_slice::<Journal>(&receipt) {
                if saved.schema != JOURNAL_SCHEMA || saved.source_sha != journal.source_sha {
                    return Err(PluginError::Conflict(
                        "commit receipt has a different schema or source".into(),
                    ));
                }
                journal = saved;
            }
        }
    }
    Ok(Some(journal))
}

fn save_receipt(job: &str, journal: &Journal, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let raw = serde_json::to_vec(journal)
        .map_err(|e| bad_args(format!("commit receipt cannot be serialized: {e}")))?;
    if raw.len() > MAX_MANIFEST_BYTES {
        return Err(bad_args("commit receipt exceeds 1 MiB"));
    }
    host.data_write(&receipt_path(job), &raw)
}

/// Quante volte si riprova una lettura che cambia mentre la si fa.
const STABLE_TRIES: usize = 4;

/// Un documento com'è adesso: i byte e la revisione che li identifica, letti in
/// modo che coincidano. La revisione si prende prima e dopo i byte, e vale solo
/// se è la stessa: chi la usa come condizione di una scrittura sa che ciò che ha
/// guardato è ciò che la condizione protegge. `None` = il documento non c'è.
fn stable_read(
    host: &dyn HostApi,
    doc: &DocId,
) -> Result<Option<(Vec<u8>, Revision)>, PluginError> {
    for _ in 0..STABLE_TRIES {
        let revision = match host.document_revision(doc) {
            Ok(revision) => revision,
            Err(PluginError::NotFound(_)) => return Ok(None),
            Err(error) => return Err(error),
        };
        let bytes = match host.read_document_bytes(doc) {
            Ok(bytes) => bytes,
            Err(PluginError::NotFound(_)) => return Ok(None),
            Err(error) => return Err(error),
        };
        match host.document_revision(doc) {
            Ok(again) if again == revision => return Ok(Some((bytes, revision))),
            Ok(_) => {}
            Err(PluginError::NotFound(_)) => return Ok(None),
            Err(error) => return Err(error),
        }
    }
    Err(PluginError::Conflict(
        format!("`{doc}` keeps changing; no stable read").into(),
    ))
}

pub fn status(job: &str, host: &dyn HostApi) -> Result<&'static str, PluginError> {
    Ok(match load(job, host)? {
        Some(Journal {
            committed: Some(_), ..
        }) => "committed",
        Some(_) => "recovery_required",
        None => "staged",
    })
}

/// Recheck the full plan on staged bytes, save preimages, then apply. Repeating
/// an already committed job returns the recorded report without another write.
/// An interrupted journal must be rolled back explicitly before retrying.
pub fn commit(
    job: &str,
    provider: &mut dyn ImportProvider,
    host: &mut dyn HostApi,
) -> Result<ImportReport, PluginError> {
    commit_with(job, Importer::Provider(provider), host)
}

/// Like [`commit`], with the importer the host has registered for the staged
/// source ([`HostServices::run_import`]).
///
/// [`HostServices::run_import`]: fub_abi::traits::HostServices::run_import
pub fn commit_registered(job: &str, host: &mut dyn HostApi) -> Result<ImportReport, PluginError> {
    commit_with(job, Importer::Registered, host)
}

fn commit_with(
    job: &str,
    mut importer: Importer<'_>,
    host: &mut dyn HostApi,
) -> Result<ImportReport, PluginError> {
    let manifest = StagingManifest::load(job, host)?;
    if manifest.schema != 2 {
        return Err(bad_args(
            "legacy staging manifest has no request; prepare the source again",
        ));
    }
    let request = manifest
        .request
        .as_ref()
        .ok_or_else(|| bad_args("staged import has no request"))?;
    if let Some(journal) = load(job, host)? {
        if journal.source_sha != manifest.source_sha {
            return Err(PluginError::Conflict(
                "staging and commit journal name different sources".into(),
            ));
        }
        return journal.committed.ok_or_else(|| {
            PluginError::Conflict(
                format!(
                    "job `{job}` has an interrupted commit; roll it back (or abandon it) before \
                     retrying"
                )
                .into(),
            )
        });
    }
    let bytes = manifest.verify(host)?;
    let source = ImportSource {
        name: manifest.source_name.clone(),
        media_type: manifest.media_type.clone(),
        content: SourceContent::Bytes(bytes),
    };
    importer
        .check(&source)
        .map_err(|_| bad_args("staged source no longer matches its importer"))?;
    let mut dry = request.clone();
    dry.mode = ImportMode::Preview;
    let current_plan = importer.import(&source, &dry, host)?;
    if current_plan.documents != manifest.preview.documents
        || current_plan.log != manifest.preview.log
    {
        return Err(PluginError::Conflict(
            format!("job `{job}` no longer matches its preview; no targets changed").into(),
        ));
    }
    let mut seen = HashSet::new();
    let mut journal = Journal {
        schema: JOURNAL_SCHEMA,
        source_sha: manifest.source_sha.clone(),
        entries: Vec::new(),
        committed: None,
    };
    let mut total = 0u64;
    // La revisione che il preflight ha visto su ogni bersaglio da sostituire:
    // l'importer la usa come condizione della propria scrittura.
    let mut expect = Vec::new();
    for document in &manifest.preview.documents {
        let existed = match document.outcome {
            ImportOutcome::Replaced => true,
            ImportOutcome::Created => false,
            _ => continue,
        };
        if !seen.insert(document.doc.clone()) {
            return Err(bad_args(format!(
                "plan targets `{}` more than once",
                document.doc
            )));
        }
        let (before, before_revision) = match stable_read(host, &document.doc)? {
            Some((bytes, revision)) => (Some(bytes), Some(revision)),
            None => (None, None),
        };
        if before.is_some() != existed {
            return Err(PluginError::Conflict(
                format!("`{}` changed since preview", document.doc).into(),
            ));
        }
        if let Some(revision) = before_revision {
            expect.push((document.doc.clone(), revision));
        }
        total = total.saturating_add(before.as_ref().map_or(0, |b| b.len() as u64));
        if total > MAX_TOTAL_UNCOMPRESSED {
            return Err(bad_args(
                "preimages exceed the 256 MiB backup limit; no targets changed",
            ));
        }
        let before_sha = before.as_ref().map(|b| content_hash_hex(b));
        let index = journal.entries.len();
        if let Some(bytes) = before {
            host.data_write(&backup_path(job, index), &bytes)?;
        }
        journal.entries.push(Preimage {
            doc: document.doc.clone(),
            existed,
            before_sha,
            after_sha: None,
            untouched: false,
            receipt: None,
        });
    }
    save(job, &journal, host)?;
    let mut apply = request.clone();
    apply.mode = ImportMode::Apply;
    receipts::arm(&mut apply, job, expect);
    let result = importer.import(&source, &apply, host);
    // Le ricevute che l'importer ha lasciato entrano nel journal: da qui in poi
    // sono la prova di ciò che è dell'import. Una che non si legge vale come
    // assente, cioè ambigua.
    for entry in &mut journal.entries {
        entry.receipt = receipts::read(host, job, &entry.doc)
            .ok()
            .flatten()
            .map(|revision| revision.0);
    }
    let mut persist_error = None;
    if let Ok(report) = &result {
        if report.documents == manifest.preview.documents
            && !report
                .documents
                .iter()
                .any(|d| matches!(d.outcome, ImportOutcome::Failed(_)))
        {
            // Il journal committato è ciò che protegge dal rollback le
            // modifiche successive dell'utente: senza l'impronta del dopo, il
            // rollback non distinguerebbe l'import da ciò che l'utente ha
            // scritto poi. Un bersaglio che non si rilegge — assente dopo un
            // Created/Replaced, o un disco che non risponde — non si committa.
            for entry in &mut journal.entries {
                match host.read_document_bytes(&entry.doc) {
                    Ok(bytes) => entry.after_sha = Some(content_hash_hex(&bytes)),
                    Err(error) => {
                        persist_error = Some(error);
                        break;
                    }
                }
            }
            if persist_error.is_none() {
                journal.committed = Some(report.clone());
                if let Err(e) = save_receipt(job, &journal, host) {
                    persist_error = Some(e);
                } else {
                    // Le ricevute sono ora nel journal committato: quelle
                    // sciolte non servono più, e se non si tolgono restano
                    // solo file orfani.
                    let _ = receipts::clear(host, job, journal.entries.iter().map(|e| &e.doc));
                    return Ok(report.clone());
                }
            }
        }
    }
    // Il rollback tocca soltanto ciò che l'apply ha scritto. Una ricevuta lo
    // prova; senza, vale ciò che il rapporto dichiara scritto, e un bersaglio
    // che nessuno dei due rivendica (per esempio uno che un altro scrittore ha
    // creato dopo l'anteprima) non è dell'import e non si tocca. Quelli
    // rivendicati dal solo rapporto si fissano all'impronta di adesso, perché
    // le modifiche successive restino protette. Con un apply finito in errore
    // non c'è rapporto: restano le ricevute, e il rollback ferma ciò che non sa
    // provare.
    journal.committed = None;
    if let Ok(report) = &result {
        for entry in &mut journal.entries {
            let claimed = report.documents.iter().any(|d| {
                d.doc == entry.doc
                    && matches!(d.outcome, ImportOutcome::Created | ImportOutcome::Replaced)
            });
            entry.untouched = !claimed && entry.receipt.is_none();
            entry.after_sha = if claimed && entry.receipt.is_none() {
                host.read_document_bytes(&entry.doc)
                    .ok()
                    .map(|bytes| content_hash_hex(&bytes))
            } else {
                None
            };
        }
    }
    if let Err(error) = save(job, &journal, host) {
        return Err(PluginError::Conflict(
            format!("job `{job}` stopped and rollback needs recovery: {error}; preimages retained")
                .into(),
        ));
    }
    match rollback(job, host) {
        Ok(()) => {
            if let Some(e) = persist_error {
                Err(e)
            } else {
                match result {
                    Ok(_) => Err(PluginError::Conflict(
                        "apply diverged from staged preview; changes rolled back".into(),
                    )),
                    Err(error) => Err(error),
                }
            }
        }
        Err(rollback_error) => Err(PluginError::Conflict(
            format!(
            "job `{job}` stopped and rollback needs recovery: {rollback_error}; preimages retained"
        )
            .into(),
        )),
    }
}

/// Che cosa fare di un bersaglio al rollback.
enum Undo {
    /// Non è dell'import, o è già com'era: non si tocca.
    Leave,
    /// È dell'import e ha ancora la revisione controllata: si riporta indietro
    /// con una scrittura (o un cestinamento) condizionata a quella revisione.
    Revert(Revision),
}

/// Decide, **senza cambiare niente**, che cosa il rollback fa di `entry`.
fn decide(
    entry: &Preimage,
    receipt: Option<Revision>,
    current: Option<(Vec<u8>, Revision)>,
) -> Result<Undo, PluginError> {
    let Some((bytes, revision)) = current else {
        return if entry.existed {
            Err(PluginError::Conflict(
                format!("`{}` vanished before rollback", entry.doc).into(),
            ))
        } else {
            // Creato e poi tolto da chi l'ha voluto: non c'è niente da riportare.
            Ok(Undo::Leave)
        };
    };
    let sha = content_hash_hex(&bytes);
    if entry.before_sha.as_deref() == Some(sha.as_str()) {
        return Ok(Undo::Leave);
    }
    let changed_after = || {
        PluginError::Conflict(
            format!(
                "`{}` changed after import; refusing to erase user's edit",
                entry.doc
            )
            .into(),
        )
    };
    match (receipt, entry.after_sha.as_deref()) {
        (Some(receipt), _) if receipt == revision => Ok(Undo::Revert(revision)),
        (Some(_), _) => Err(changed_after()),
        (None, Some(after)) if after == sha => Ok(Undo::Revert(revision)),
        (None, Some(_)) => Err(changed_after()),
        (None, None) => Err(PluginError::Conflict(
            format!(
                "`{}` is not as it was before the import, and nothing proves the import wrote \
                 it: left as it is, preimages retained",
                entry.doc
            )
            .into(),
        )),
    }
}

/// Restore every target the import can prove it wrote, most recent first.
/// A target is the import's when its receipt names the revision it holds now,
/// or, without a receipt, when the report claimed it and its digest is the one
/// read right after the apply: later user edits are a conflict, never erased.
/// A target that is neither as it was nor provably the import's (a crash during
/// provider.import, a writer that raced the apply) stops the rollback with a
/// conflict before anything changes: backups and journal stay.
pub fn rollback(job: &str, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let Some(journal) = load(job, host)? else {
        return Ok(());
    };
    // Check every target and backup before changing any of them. A later
    // user edit in one document must not make us partly roll back the others.
    let mut undo = Vec::with_capacity(journal.entries.len());
    for (index, entry) in journal.entries.iter().enumerate() {
        let receipt = match &entry.receipt {
            Some(revision) => Some(Revision::new(revision.clone())),
            None => receipts::read(host, job, &entry.doc)?,
        };
        if entry.untouched && receipt.is_none() {
            undo.push(Undo::Leave);
            continue;
        }
        let step = decide(entry, receipt, stable_read(host, &entry.doc)?)?;
        if matches!(step, Undo::Revert(_)) && entry.existed {
            let original = host
                .data_read(&backup_path(job, index))?
                .ok_or_else(|| bad_args(format!("preimage for `{}` is missing", entry.doc)))?;
            if entry.before_sha.as_deref() != Some(content_hash_hex(&original).as_str()) {
                return Err(PluginError::Conflict(
                    format!("preimage for `{}` is corrupt", entry.doc).into(),
                ));
            }
        }
        undo.push(step);
    }
    for (index, (entry, step)) in journal.entries.iter().zip(&undo).enumerate().rev() {
        let Undo::Revert(revision) = step else {
            continue;
        };
        if entry.existed {
            let original = host
                .data_read(&backup_path(job, index))?
                .ok_or_else(|| bad_args(format!("preimage for `{}` is missing", entry.doc)))?;
            host.write_document_bytes(&entry.doc, &original, Some(revision.clone()))?;
        } else {
            host.trash_document_if(&entry.doc, revision)?;
        }
    }
    // Removing the receipt then journal leaves only orphaned backup bytes if
    // interrupted during cleanup, never a dangling journal.
    host.data_remove(&receipt_path(job))?;
    host.data_remove(&journal_path(job))?;
    for (index, entry) in journal.entries.iter().enumerate() {
        if entry.existed {
            host.data_remove(&backup_path(job, index))?;
        }
    }
    receipts::clear(host, job, journal.entries.iter().map(|entry| &entry.doc))?;
    Ok(())
}

/// **Rinuncia al rollback di un import interrotto** (FUB-007): toglie il
/// journal, la sua ricevuta, le preimmagini e le ricevute dei bersagli, e non
/// tocca nessun bersaglio. Il job torna `staged`: un commit nuovo ricalcola il
/// piano sul vault di adesso.
///
/// È la via d'uscita di un rollback che non può provare niente — un journal di
/// prima delle ricevute, un import interrotto senza rapporto — e che per questo
/// si ferma con un conflitto per sempre. Chi la sceglie dice di tenere il vault
/// com'è, comprese le note che l'import ha scritto: non c'è modo di annullarle
/// dopo.
///
/// Un import **committato** non si abbandona: il suo journal è ciò che permette
/// il rollback, e il rollback c'è. Un journal che non si legge (schema
/// sconosciuto, JSON rotto) invece sì: il rollback non lo userebbe comunque, e
/// senza questa via resterebbe lì per sempre. Si cancella per elenco e non per
/// voci, perché l'elenco delle voci è proprio ciò che non si legge.
///
/// Non c'è niente da abbandonare se il job non ha un journal: torna `Ok`.
pub fn abandon(job: &str, host: &mut dyn HostApi) -> Result<(), PluginError> {
    // Un journal che non si legge non ha un rollback da proteggere: si rifiuta
    // soltanto quello committato.
    if let Ok(Some(Journal {
        committed: Some(_), ..
    })) = load(job, host)
    {
        return Err(PluginError::Conflict(
            format!("job `{job}` is committed; roll it back instead of abandoning it").into(),
        ));
    }
    // Come il rollback: prima la ricevuta e il journal, poi i byte. Se si
    // interrompe resta al più qualche byte orfano, mai un journal appeso.
    host.data_remove(&receipt_path(job))?;
    host.data_remove(&journal_path(job))?;
    for dir in [
        format!("imports/preimages/{job}"),
        format!("imports/receipts/{job}"),
    ] {
        // L'elenco è della cartella; un altro job che ne condivide il prefisso
        // (`a` e `ab`) non è di questo.
        let under = format!("{dir}/");
        for path in host.data_list(&dir)? {
            if path.starts_with(&under) {
                host.data_remove(&path)?;
            }
        }
    }
    Ok(())
}
