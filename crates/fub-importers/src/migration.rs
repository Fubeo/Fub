//! Preimage-backed commit/restart control around existing ImportProvider ports.
//! Staging remains authoritative until the caller explicitly commits. A journal
//! is durable before the first target mutation, so interrupted work can be
//! inspected and rolled back after reopening the vault.

use std::collections::HashSet;

use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_abi::transfer::{
    ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportSource, SourceContent,
};
use fub_abi::PluginError;

use crate::common::{bad_args, content_hash_hex, MAX_MANIFEST_BYTES, MAX_TOTAL_UNCOMPRESSED};
use crate::template::{Importer, StagingManifest};

const JOURNAL_SCHEMA: u32 = 1;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Preimage {
    doc: DocId,
    existed: bool,
    before_sha: Option<String>,
    after_sha: Option<String>,
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
                format!("job `{job}` has an interrupted commit; roll it back before retrying")
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
        let before = match host.read_document_bytes(&document.doc) {
            Ok(bytes) => Some(bytes),
            Err(PluginError::NotFound(_)) => None,
            Err(error) => return Err(error),
        };
        if before.is_some() != existed {
            return Err(PluginError::Conflict(
                format!("`{}` changed since preview", document.doc).into(),
            ));
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
        });
    }
    save(job, &journal, host)?;
    let mut apply = request.clone();
    apply.mode = ImportMode::Apply;
    let result = importer.import(&source, &apply, host);
    let mut persist_error = None;
    if let Ok(report) = &result {
        for entry in &mut journal.entries {
            if let Ok(bytes) = host.read_document_bytes(&entry.doc) {
                entry.after_sha = Some(content_hash_hex(&bytes));
            }
        }
        if report.documents == manifest.preview.documents
            && !report
                .documents
                .iter()
                .any(|d| matches!(d.outcome, ImportOutcome::Failed(_)))
        {
            journal.committed = Some(report.clone());
            if let Err(e) = save_receipt(job, &journal, host) {
                persist_error = Some(e);
            } else {
                return Ok(report.clone());
            }
        }
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

/// Restore every touched target, most recent first. Committed postimages are
/// checked against their digest: later user edits are a conflict, never erased.
/// For a crash during provider.import, only preimages are certain; the host
/// cannot distinguish a concurrent external edit without its own batch journal.
pub fn rollback(job: &str, host: &mut dyn HostApi) -> Result<(), PluginError> {
    let Some(journal) = load(job, host)? else {
        return Ok(());
    };
    // Check every target and backup before changing any of them. A later
    // user edit in one document must not make us partly roll back the others.
    for (index, entry) in journal.entries.iter().enumerate() {
        let current = match host.read_document_bytes(&entry.doc) {
            Ok(bytes) => Some(bytes),
            Err(PluginError::NotFound(_)) if !entry.existed => None,
            Err(PluginError::NotFound(_)) => {
                return Err(PluginError::Conflict(
                    format!("`{}` vanished before rollback", entry.doc).into(),
                ));
            }
            Err(error) => return Err(error),
        };
        if let Some(current) = current {
            let sha = content_hash_hex(&current);
            if entry.before_sha.as_deref() != Some(sha.as_str()) {
                if let Some(after_sha) = &entry.after_sha {
                    if after_sha != &sha {
                        return Err(PluginError::Conflict(
                            format!(
                                "`{}` changed after import; refusing to erase user's edit",
                                entry.doc
                            )
                            .into(),
                        ));
                    }
                }
            }
        }
        if entry.existed {
            let original = host
                .data_read(&backup_path(job, index))?
                .ok_or_else(|| bad_args(format!("preimage for `{}` is missing", entry.doc)))?;
            if entry.before_sha.as_deref() != Some(content_hash_hex(&original).as_str()) {
                return Err(PluginError::Conflict(
                    format!("preimage for `{}` is corrupt", entry.doc).into(),
                ));
            }
        }
    }
    for (index, entry) in journal.entries.iter().enumerate().rev() {
        let current = match host.read_document_bytes(&entry.doc) {
            Ok(bytes) => bytes,
            Err(PluginError::NotFound(_)) if !entry.existed => continue,
            Err(PluginError::NotFound(_)) => {
                return Err(PluginError::Conflict(
                    format!("`{}` vanished before rollback", entry.doc).into(),
                ));
            }
            Err(error) => return Err(error),
        };
        let current_sha = content_hash_hex(&current);
        if entry.before_sha.as_deref() == Some(current_sha.as_str()) {
            continue;
        }
        if let Some(after_sha) = &entry.after_sha {
            if after_sha != &current_sha {
                return Err(PluginError::Conflict(
                    format!(
                        "`{}` changed after import; refusing to erase user's edit",
                        entry.doc
                    )
                    .into(),
                ));
            }
        }
        if entry.existed {
            let original = host
                .data_read(&backup_path(job, index))?
                .ok_or_else(|| bad_args(format!("preimage for `{}` is missing", entry.doc)))?;
            if entry.before_sha.as_deref() != Some(content_hash_hex(&original).as_str()) {
                return Err(PluginError::Conflict(
                    format!("preimage for `{}` is corrupt", entry.doc).into(),
                ));
            }
            let revision = host.document_revision(&entry.doc)?;
            host.write_document_bytes(&entry.doc, &original, Some(revision))?;
        } else {
            host.trash_document(&entry.doc)?;
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
    Ok(())
}
