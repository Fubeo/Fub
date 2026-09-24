//! Archive import: ZIP (stored/deflated) and Textbundle/Textpack folders
//! packed inside a ZIP, fanned out to one provider per entry.
//!
//! Claims `.zip` by extension/`application/zip` (prologue `PK\x03\x04` only
//! breaks ties against other ZIP-based formats) and delegates every entry to
//! the matching inner provider (Markdown stays first: `.md` entries import
//! through `fub.markdown`'s own semantics only when this bundle runs inside
//! the real workspace dispatch — here they convert losslessly to the same
//! bytes with provenance frontmatter). `.base`/`.canvas`/`.fubsheet` entries
//! retain their extension and exact UTF-8 contents for format owners; binary
//! or invalid UTF-8 entries fail explicitly rather than being replaced.
//!
//! Security: traversal (`..`, absolute, drive-letter, backslash escapes,
//! symlink names are just names here), bombs (entry/total caps + ratio
//! check in [`crate::zip`]), and interruption (cancel → `Err(Cancelled)`;
//! dropping the source mid-entry → `Io`, never a silent truncation).

use std::collections::HashSet;

use fub_abi::traits::HostApi;
use fub_abi::transfer::{
    ConflictPolicy, ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportRequest,
    ImportSource, TransferNote,
};
use fub_abi::PluginError;

use crate::common::{
    bad_args, content_hash_hex, entry_stem, is_cancelled, join_doc_path, sanitize_component,
    unserved, MAX_DOCS_PER_IMPORT, MAX_ENTRIES, MAX_SOURCE_BYTES, MAX_TOTAL_UNCOMPRESSED,
};
use crate::zip;

fn media_base(media: Option<&str>) -> Option<&str> {
    media.map(|m| m.split(';').next().unwrap_or(m).trim())
}

/// Route one entry's bytes to text: returns `(stem_extension, body)` for a
/// convertible entry, or `None` when the entry must be kept verbatim (format-
/// owned extensions) — the caller then writes the raw bytes as-is.
fn route_entry(name: &str, bytes: &[u8], host: &dyn HostApi) -> Result<Route, PluginError> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".mdown")
        || lower.ends_with(".mkd")
        || lower.ends_with(".txt")
        || lower.ends_with(".text")
        || lower.ends_with(".log")
        || lower.ends_with(".html")
        || lower.ends_with(".htm")
        || lower.ends_with(".xhtml")
    {
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| bad_args(format!("entry `{name}` is not UTF-8 text")))?;
        return Ok(Route::Text(text));
    }
    if lower.ends_with(".csv") || lower.ends_with(".tsv") {
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| bad_args(format!("entry `{name}` is not UTF-8 text")))?;
        return Ok(Route::Csv(text));
    }
    if lower.ends_with(".json") {
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| bad_args(format!("entry `{name}` is not UTF-8 text")))?;
        return Ok(Route::Json(text));
    }
    if lower.ends_with(".enex") {
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| bad_args(format!("entry `{name}` is not UTF-8 text")))?;
        return Ok(Route::Enex(text));
    }
    if lower.ends_with(".note") || lower.ends_with(".xml") || lower.ends_with(".opml") {
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| bad_args(format!("entry `{name}` is not UTF-8 text")))?;
        return Ok(Route::Xml(text));
    }
    // Format-owned or binary: keep verbatim if the host serves the format,
    // else still keep verbatim (an asset-like note is worse than the bytes).
    let _ = host;
    Ok(Route::Verbatim)
}

enum Route {
    Text(String),
    Csv(String),
    Json(String),
    Enex(String),
    Xml(String),
    Verbatim,
}

#[derive(Default)]
pub struct ArchiveImport;

impl ArchiveImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(ArchiveImport)
    }

    /// Import entries from already-open bytes (shared with Textpack, which
    /// unpacks the same ZIP layout plus `info.json`).
    pub(crate) fn import_bytes(
        &mut self,
        archive_name: &str,
        bytes: &[u8],
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
        entry_prefix: Option<&str>,
    ) -> Result<(), PluginError> {
        if bytes.len() as u64 > MAX_SOURCE_BYTES {
            return Err(bad_args(format!(
                "`{archive_name}` is {} bytes (max 64 MiB)",
                bytes.len()
            )));
        }
        let archive = zip::parse(bytes)?;
        if archive.entries.len() > MAX_ENTRIES {
            return Err(bad_args(format!(
                "`{archive_name}` lists {} entries (max {MAX_ENTRIES})",
                archive.entries.len()
            )));
        }
        let mut total: u64 = 0;
        let mut seen_names: HashSet<String> = HashSet::new();
        for entry in &archive.entries {
            if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                report.log.push(
                    TransferNote::warning(format!(
                        "stopped after {MAX_DOCS_PER_IMPORT} notes; remaining entries skipped"
                    ))
                    .about(archive_name.to_string()),
                );
                break;
            }
            // Directories and resource-fork noise never become documents.
            if entry.is_dir || entry.name.ends_with('/') {
                continue;
            }
            let base = entry.name.rsplit('/').next().unwrap_or(&entry.name);
            if base.starts_with("._") || base == ".DS_Store" || base == "Thumbs.db" {
                continue;
            }
            // Traversal: any `..` / absolute / drive / empty component, or a
            // name that sanitizes to nothing, is a per-entry failure — the
            // archive stays valid.
            if is_traversal(&entry.name) {
                report.documents.push(fub_abi::transfer::ImportedDocument {
                    doc: request.destination("unsafe-entry.md"),
                    outcome: ImportOutcome::Failed(format!(
                        "entry `{}` escapes the archive root: skipped",
                        entry.name
                    )),
                    entry: Some(entry_label(archive_name, &entry.name, entry_prefix)),
                });
                report.log.push(
                    TransferNote::warning(format!(
                        "entry `{}` escapes the archive root: skipped",
                        entry.name
                    ))
                    .about(entry_label(
                        archive_name,
                        &entry.name,
                        entry_prefix,
                    )),
                );
                continue;
            }
            let bytes = match zip::extract(archive.data(), entry, &mut total) {
                Ok(b) => b,
                Err(e) if is_cancelled(&e) => return Err(e),
                Err(e) => {
                    // Bomb / truncation / CRC: per-entry failure keeps the
                    // rest; a bomb aborts the whole import instead.
                    let msg = e.to_string();
                    let abort = msg.contains("bomb") || msg.contains("budget");
                    report.documents.push(fub_abi::transfer::ImportedDocument {
                        doc: request.destination("unreadable-entry.md"),
                        outcome: ImportOutcome::Failed(msg.clone()),
                        entry: Some(entry_label(archive_name, &entry.name, entry_prefix)),
                    });
                    report
                        .log
                        .push(TransferNote::warning(msg).about(entry_label(
                            archive_name,
                            &entry.name,
                            entry_prefix,
                        )));
                    if abort {
                        return Err(bad_args(format!(
                            "`{archive_name}` aborted: archive exceeds safety budget"
                        )));
                    }
                    continue;
                }
            };
            if total > MAX_TOTAL_UNCOMPRESSED {
                return Err(bad_args(format!(
                    "`{archive_name}` exceeds the 256 MiB total budget"
                )));
            }
            let label = entry_label(archive_name, &entry.name, entry_prefix);
            if let Err(e) = self.import_entry(
                archive_name,
                &entry.name,
                &bytes,
                request,
                host,
                report,
                &label,
                &mut seen_names,
            ) {
                if is_cancelled(&e) {
                    return Err(e);
                }
                let msg = e.to_string();
                report.documents.push(fub_abi::transfer::ImportedDocument {
                    doc: request.destination("unreadable-entry.md"),
                    outcome: ImportOutcome::Failed(msg.clone()),
                    entry: Some(label.clone()),
                });
                report.log.push(TransferNote::warning(msg).about(label));
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn import_entry(
        &mut self,
        archive_name: &str,
        name: &str,
        bytes: &[u8],
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
        label: &str,
        seen: &mut HashSet<String>,
    ) -> Result<(), PluginError> {
        // Folder structure: sanitized components, files at root when nothing
        // namable remains above them. Collisions across folders with the same
        // tail are disambiguated by suffixing, never by overwriting.
        let parts: Vec<&str> = name.split('/').collect();
        let (dirs, file) = match parts.as_slice() {
            [] => return Ok(()),
            [f] => (&[][..], *f),
            [dirs @ .., f] => (dirs, *f),
        };
        let mut folder: Vec<String> = Vec::new();
        for d in dirs {
            if d.is_empty() || *d == "." || *d == ".." {
                continue;
            }
            if let Some(c) = sanitize_component(d) {
                folder.push(c);
            }
        }
        let stem = entry_stem(file).unwrap_or_else(|| "entry".to_string());
        let ext = file
            .rsplit_once('.')
            .map(|(_, e)| e.to_ascii_lowercase())
            .unwrap_or_default();
        let route = route_entry(name, bytes, host)?;
        match route {
            Route::Text(text) => {
                let doc_name = join_doc_path(&folder, &format!("{stem}.md"))
                    .unwrap_or_else(|| "entry.md".to_string());
                if matches!(ext.as_str(), "md" | "markdown" | "mdown" | "mkd") {
                    // An existing Markdown header is authoritative. A second
                    // frontmatter block would turn its properties into body.
                    self.write_raw(doc_name, &text, label, request, host, report, seen)
                } else if matches!(ext.as_str(), "html" | "htm" | "xhtml") {
                    let converted = crate::html::convert_fragment(&text)?;
                    for note in converted.notes {
                        report
                            .log
                            .push(TransferNote::warning(note.message).about(label));
                    }
                    self.write_raw(
                        doc_name,
                        &converted.markdown,
                        label,
                        request,
                        host,
                        report,
                        seen,
                    )
                } else {
                    self.write_text_entry(
                        archive_name,
                        label,
                        &text,
                        bytes,
                        doc_name,
                        request,
                        host,
                        report,
                        seen,
                        None,
                    )
                }
            }
            Route::Csv(text) => {
                // Keep archive naming and collision policy, but use the same
                // value/provenance representation as a direct CSV import.
                let forced = (ext == "tsv").then_some(b'\t');
                let table = crate::csv::parse_table(&text, forced)
                    .map_err(|e| bad_args(format!("entry `{name}`: {e}")))?;
                let source_file = format!("{archive_name}:{name}");
                let mut f = folder.clone();
                f.push(sanitize_component(&stem).unwrap_or_else(|| "csv".to_string()));
                for (idx, row) in table.rows.iter().enumerate() {
                    if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                        break;
                    }
                    let note = crate::csv::row_note(&table.headers, row, &source_file, idx);
                    let archive_title: String = note.title.chars().take(60).collect();
                    let fstem = sanitize_component(&archive_title)
                        .unwrap_or_else(|| format!("row_{}", idx + 1));
                    let doc_name = join_doc_path(&[], &format!("{}-{fstem}.md", f.join("-")))
                        .unwrap_or_else(|| format!("{stem}-row-{}.md", idx + 1));
                    let line = table.lines[idx];
                    self.write_raw(
                        doc_name,
                        &note.markdown,
                        &format!("{label}:{line}"),
                        request,
                        host,
                        report,
                        seen,
                    )?;
                }
                Ok(())
            }
            Route::Json(text) => {
                let value: serde_json::Value = serde_json::from_str(&text)
                    .map_err(|e| bad_args(format!("entry `{name}` is not JSON: {e}")))?;
                let source_file = format!("{archive_name}:{name}");
                let notes = crate::json_import::convert(&value, &source_file)?;
                let destination = folder.clone();
                let sha = content_hash_hex(text.as_bytes());
                for (index, note) in notes.into_iter().enumerate() {
                    if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                        break;
                    }
                    let title = sanitize_component(&note.title)
                        .unwrap_or_else(|| format!("note-{}", index + 1));
                    let doc_name = join_doc_path(&destination, &format!("{title}.md"))
                        .unwrap_or_else(|| format!("{stem}-{}.md", index + 1));
                    let markdown = if let Some(rest) = note.markdown.strip_prefix("---\n") {
                        format!(
                            "---\nsource_sha: {sha}\nsource_entry: {}\n{rest}",
                            index + 1
                        )
                    } else {
                        note.markdown
                    };
                    let note_label = format!("{label}:{}", index + 1);
                    self.write_raw(
                        doc_name,
                        &markdown,
                        &note_label,
                        request,
                        host,
                        report,
                        seen,
                    )?;
                    for warning in note.warnings {
                        report
                            .log
                            .push(TransferNote::warning(warning).about(note_label.clone()));
                    }
                }
                Ok(())
            }
            Route::Enex(text) => {
                let notes = crate::enex::parse_enex(&text, name)?;
                for n in notes {
                    if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                        break;
                    }
                    let fstem = sanitize_component(&n.title).unwrap_or_else(|| "note".to_string());
                    let mut f = folder.clone();
                    f.push(sanitize_component(&stem).unwrap_or_else(|| "enex".to_string()));
                    let doc_name = join_doc_path(&[], &format!("{}-{fstem}.md", f.join("-")))
                        .unwrap_or_else(|| "note.md".to_string());
                    self.write_raw(doc_name, &n.markdown, label, request, host, report, seen)?;
                    for w in n.warnings {
                        report
                            .log
                            .push(TransferNote::warning(w).about(label.to_string()));
                    }
                    for asset in n.assets {
                        let asset_label = format!("{label}:{}", asset.name);
                        self.write_binary(
                            asset.path,
                            &asset.bytes,
                            &asset_label,
                            request,
                            host,
                            report,
                            seen,
                        )?;
                    }
                }
                Ok(())
            }
            Route::Xml(text) => {
                let pairs = crate::xml_generic::flatten(&text, name)?;
                let body = pairs
                    .iter()
                    .map(|(p, v)| format!("- `{p}`: {v}"))
                    .collect::<Vec<_>>()
                    .join("\n");
                let doc_name = join_doc_path(&folder, &format!("{stem}.md"))
                    .unwrap_or_else(|| "entry.md".to_string());
                let text = format!(
                    "---\ntitle: {}\nsource_file: {}\n---\n\n{body}\n",
                    crate::common::yaml_scalar(&stem),
                    crate::common::yaml_scalar(&format!("{archive_name}:{name}")),
                );
                self.write_raw(doc_name, &text, label, request, host, report, seen)
            }
            Route::Verbatim => {
                let doc_name = join_doc_path(&folder, &format!("{stem}.{ext}"))
                    .unwrap_or_else(|| format!("{stem}.bin"));
                if is_text_ext(&ext) {
                    let text = std::str::from_utf8(bytes).map_err(|e| {
                        bad_args(format!(
                            "entry `{name}` is not UTF-8 text (invalid byte at offset {})",
                            e.valid_up_to()
                        ))
                    })?;
                    self.write_raw(doc_name, text, label, request, host, report, seen)
                } else {
                    self.write_binary(doc_name, bytes, label, request, host, report, seen)
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn write_text_entry(
        &mut self,
        archive_name: &str,
        label: &str,
        text: &str,
        raw: &[u8],
        doc_name: String,
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
        seen: &mut HashSet<String>,
        title: Option<&str>,
    ) -> Result<(), PluginError> {
        let sha = content_hash_hex(raw);
        let title = title.unwrap_or_else(|| {
            doc_name
                .rsplit('/')
                .next()
                .unwrap_or(&doc_name)
                .trim_end_matches(".md")
        });
        let body = format!(
            "---\ntitle: {}\nsource_file: {}\nsource_sha: {sha}\n---\n\n{}",
            crate::common::yaml_scalar(title),
            crate::common::yaml_scalar(archive_name),
            text.trim_end()
        );
        self.write_raw(doc_name, &body, label, request, host, report, seen)
    }

    #[allow(clippy::too_many_arguments)]
    fn write_binary(
        &mut self,
        doc_name: String,
        bytes: &[u8],
        label: &str,
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
        seen: &mut HashSet<String>,
    ) -> Result<(), PluginError> {
        let mut name = doc_name.clone();
        let mut suffix = 1;
        while !seen.insert(name.clone()) {
            suffix += 1;
            name = match doc_name.rsplit_once('.') {
                Some((stem, ext)) => format!("{stem}-{suffix}.{ext}"),
                None => format!("{doc_name}-{suffix}"),
            };
        }
        let wanted = request.destination(&name);
        let (doc, outcome) = crate::common::resolve_binary_destination(
            host,
            request,
            wanted,
            label,
            &mut report.log,
        )?;
        report.log.push(
            TransferNote::info(format!(
                "binary asset preserved byte-for-byte (sha256:{})",
                content_hash_hex(bytes)
            ))
            .about(label),
        );
        crate::common::write_asset(host, request, &doc, bytes, outcome, label, report)?;
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn write_raw(
        &mut self,
        doc_name: String,
        text: &str,
        label: &str,
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
        seen: &mut HashSet<String>,
    ) -> Result<(), PluginError> {
        // In-archive collision disambiguation: `a/b.md` + `a-b.md` tails.
        let mut candidate = request.destination(&doc_name);
        if seen.contains(candidate.as_str()) {
            let mut n = 1u32;
            loop {
                let alt = match doc_name.rsplit_once('.') {
                    Some((s, e)) => format!("{s} {n}.{e}"),
                    None => format!("{doc_name} {n}"),
                };
                candidate = request.destination(&alt);
                if !seen.contains(candidate.as_str()) {
                    break;
                }
                n += 1;
                if n > 10_000 {
                    return Err(bad_args("too many same-named entries in archive"));
                }
            }
        }
        seen.insert(candidate.as_str().to_string());
        // Vault-level conflicts still follow the requested policy.
        let (doc, outcome) = match (
            host.list_documents(None)
                .map(|p| p.items.contains(&candidate))
                .unwrap_or(false),
            request.on_conflict,
        ) {
            (false, _) => (candidate, ImportOutcome::Created),
            (true, ConflictPolicy::Skip) => (candidate, ImportOutcome::Skipped),
            (true, ConflictPolicy::Replace) => (candidate, ImportOutcome::Replaced),
            (true, ConflictPolicy::Rename) => {
                let free = host.free_name(&candidate);
                report.log.push(
                    TransferNote::warning(format!(
                        "`{candidate}` exists already: imported as `{free}`"
                    ))
                    .about(label.to_string()),
                );
                (free, ImportOutcome::Created)
            }
        };
        let writes = matches!(outcome, ImportOutcome::Created | ImportOutcome::Replaced)
            && request.mode == ImportMode::Apply;
        let outcome = if writes {
            let res = match &outcome {
                ImportOutcome::Replaced => host
                    .write_document(&doc, text, fub_abi::edit::WriteBase::Dictated)
                    .map(|_| ()),
                _ => host.create_document(&doc, text),
            };
            match res {
                Ok(()) => outcome,
                Err(e) if is_cancelled(&e) => return Err(e),
                Err(e) => ImportOutcome::Failed(e.to_string()),
            }
        } else {
            outcome
        };
        report.documents.push(fub_abi::transfer::ImportedDocument {
            doc,
            outcome,
            entry: Some(label.to_string()),
        });
        Ok(())
    }
}

impl ArchiveImport {
    fn import_tar_bytes(
        &mut self,
        archive_name: &str,
        bytes: &[u8],
        request: &ImportRequest,
        host: &mut dyn HostApi,
        report: &mut ImportReport,
    ) -> Result<(), PluginError> {
        let entries = crate::tar::entries(bytes)?;
        let mut seen = HashSet::new();
        for (name, payload) in entries {
            if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                report
                    .log
                    .push(TransferNote::warning("archive note limit reached").about(archive_name));
                break;
            }
            let label = entry_label(archive_name, &name, None);
            if is_traversal(&name) {
                report.documents.push(fub_abi::transfer::ImportedDocument {
                    doc: request.destination("unsafe-entry.md"),
                    outcome: ImportOutcome::Failed(format!(
                        "entry `{name}` escapes the archive root"
                    )),
                    entry: Some(label),
                });
                continue;
            }
            if let Err(e) = self.import_entry(
                archive_name,
                &name,
                payload,
                request,
                host,
                report,
                &label,
                &mut seen,
            ) {
                if is_cancelled(&e) {
                    return Err(e);
                }
                report.documents.push(fub_abi::transfer::ImportedDocument {
                    doc: request.destination("unreadable-entry.md"),
                    outcome: ImportOutcome::Failed(e.to_string()),
                    entry: Some(label),
                });
            }
        }
        Ok(())
    }
}

fn is_traversal(name: &str) -> bool {
    if name.is_empty() {
        return true;
    }
    // Absolute (posix / windows drive / UNC) or backslash escapes.
    if name.starts_with('/') || name.starts_with('\\') {
        return true;
    }
    if name.len() >= 3 && name.as_bytes()[1] == b':' {
        return true;
    }
    if name.contains('\\') {
        return true;
    }
    for comp in name.split('/') {
        if comp == ".." {
            return true;
        }
    }
    false
}

fn entry_label(archive: &str, entry: &str, prefix: Option<&str>) -> String {
    match prefix {
        Some(p) => format!("{p}:{archive}:{entry}"),
        None => format!("{archive}:{entry}"),
    }
}

fn is_text_ext(ext: &str) -> bool {
    matches!(
        ext,
        "md" | "markdown"
            | "mdown"
            | "mkd"
            | "txt"
            | "text"
            | "log"
            | "html"
            | "htm"
            | "xhtml"
            | "json"
            | "xml"
            | "opml"
            | "csv"
            | "tsv"
            | "yaml"
            | "yml"
            | "toml"
            | "base"
            | "canvas"
            | "fubsheet"
    )
}

impl ImportProvider for ArchiveImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        if matches!(source.extension().as_deref(), Some("jex" | "tar")) {
            return true;
        }
        if matches!(source.extension().as_deref(), Some("zip" | "bear2bk")) {
            return true;
        }
        if media_base(source.media_type.as_deref()) == Some("application/zip") {
            return true;
        }
        // Prologue tie-break for extension-less ZIPs: other ZIP-based
        // formats (`.docx`/`.epub`/`.odt`, owned elsewhere) share the
        // signature, so only claim when the name gives no better owner.
        if source.extension().is_none() && zip::looks_like_zip(source.prologue()) {
            return true;
        }
        false
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(bad_args("archive exceeds 64 MiB"));
        }
        let bytes = source.read_all(host)?;
        if source.extension().as_deref() == Some("bear2bk") {
            let archive = zip::parse(&bytes)?;
            let has_readable_notes = archive.entries.iter().any(|entry| {
                let name = entry.name.to_ascii_lowercase();
                name.ends_with(".json") || name.ends_with(".md") || name.ends_with(".markdown")
            });
            if !has_readable_notes {
                return Err(unserved("Bear native SQLite backup has no readable JSON/Markdown notes; export from Bear as Markdown or JSON before importing"));
            }
        }
        let mut report = ImportReport::new(request.mode);
        if matches!(source.extension().as_deref(), Some("jex" | "tar")) {
            self.import_tar_bytes(&source.name, &bytes, request, host, &mut report)?;
        } else {
            self.import_bytes(&source.name, &bytes, request, host, &mut report, None)?;
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::VaultRead;
    use fub_sdk::testing::MemoryHost;

    // One stored entry, including its central directory and a one-byte ZIP
    // comment (the reader scans from just before a bare trailing EOCD).
    fn stored_zip(name: &str, contents: &[u8]) -> Vec<u8> {
        fn u16(out: &mut Vec<u8>, value: u16) {
            out.extend_from_slice(&value.to_le_bytes());
        }
        fn u32(out: &mut Vec<u8>, value: u32) {
            out.extend_from_slice(&value.to_le_bytes());
        }
        let mut crc = !0u32;
        for &byte in contents {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 == 0 {
                    crc >> 1
                } else {
                    (crc >> 1) ^ 0xedb8_8320
                };
            }
        }
        let crc = !crc;
        let size = contents.len() as u32;
        let mut zip = Vec::new();
        u32(&mut zip, 0x0403_4b50);
        u16(&mut zip, 20);
        for _ in 0..4 {
            u16(&mut zip, 0);
        }
        for value in [crc, size, size] {
            u32(&mut zip, value);
        }
        u16(&mut zip, name.len() as u16);
        u16(&mut zip, 0);
        zip.extend_from_slice(name.as_bytes());
        zip.extend_from_slice(contents);
        let directory_start = zip.len() as u32;
        u32(&mut zip, 0x0201_4b50);
        u16(&mut zip, 20);
        u16(&mut zip, 20);
        for _ in 0..4 {
            u16(&mut zip, 0);
        }
        for value in [crc, size, size] {
            u32(&mut zip, value);
        }
        u16(&mut zip, name.len() as u16);
        for _ in 0..4 {
            u16(&mut zip, 0);
        }
        u32(&mut zip, 0);
        u32(&mut zip, 0);
        zip.extend_from_slice(name.as_bytes());
        let directory_size = zip.len() as u32 - directory_start;
        u32(&mut zip, 0x0605_4b50);
        for value in [0, 0, 1, 1] {
            u16(&mut zip, value);
        }
        u32(&mut zip, directory_size);
        u32(&mut zip, directory_start);
        u16(&mut zip, 1);
        zip.push(0);
        zip
    }

    #[test]
    fn archived_csv_retains_cells_and_matches_preview() {
        let csv = "name,detail,detail,memo\nAlice,\"first\nsecond\",42,\"  padded #memo  \"\n";
        let source = ImportSource::from_bytes("bundle.zip", stored_zip("rows.csv", csv.as_bytes()));
        let mut host = MemoryHost::new();
        let preview = ArchiveImport
            .import(&source, &ImportRequest::preview(), &mut host)
            .unwrap();
        let apply = ArchiveImport
            .import(&source, &ImportRequest::apply(), &mut host)
            .unwrap();
        assert_eq!(preview.documents, apply.documents);
        assert_eq!(apply.documents.len(), 1);
        assert_eq!(apply.documents[0].outcome, ImportOutcome::Created);
        assert_eq!(
            apply.documents[0].entry.as_deref(),
            Some("bundle.zip:rows.csv:2")
        );
        let markdown = host.read_document(&apply.documents[0].doc).unwrap();
        assert!(markdown.contains("title: Alice\n"));
        assert!(markdown.contains("source_file: \"bundle.zip:rows.csv\"\n"));
        assert!(markdown.contains("source_row: 1\nsource_sha: "));
        assert!(markdown.contains("name: Alice\n"));
        assert!(markdown.contains("detail_2: \"42\"\n"));
        assert!(markdown.contains("memo: \"  padded #memo  \"\n"));
        assert!(markdown.contains("## detail\n\nfirst\nsecond\n"));
        let direct = crate::csv::CsvImport
            .import(
                &ImportSource::text_source("rows.csv", csv),
                &ImportRequest::apply(),
                &mut host,
            )
            .unwrap();
        let direct_note = host.read_document(&direct.documents[0].doc).unwrap();
        for value in [
            "name: Alice\n",
            "detail_2: \"42\"\n",
            "memo: \"  padded #memo  \"\n",
            "## detail\n\nfirst\nsecond\n",
        ] {
            assert!(direct_note.contains(value));
            assert!(markdown.contains(value));
        }
    }

    #[test]
    fn overflow_row_fails_direct_and_archived_import_without_a_partial_note() {
        let csv = "name,detail\nAlice,kept,formerly_discarded\n";
        let mut host = MemoryHost::new();
        let direct = crate::csv::CsvImport.import(
            &ImportSource::text_source("rows.csv", csv),
            &ImportRequest::apply(),
            &mut host,
        );
        assert!(direct
            .unwrap_err()
            .to_string()
            .contains("3 cells but header has 2"));
        let source = ImportSource::from_bytes("bundle.zip", stored_zip("rows.csv", csv.as_bytes()));
        let report = ArchiveImport
            .import(&source, &ImportRequest::apply(), &mut host)
            .unwrap();
        assert_eq!(report.documents.len(), 1);
        assert_eq!(
            report.documents[0].entry.as_deref(),
            Some("bundle.zip:rows.csv")
        );
        assert!(
            matches!(&report.documents[0].outcome, ImportOutcome::Failed(msg) if msg.contains("3 cells but header has 2"))
        );
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn invalid_utf8_format_owned_file_fails_without_replacement() {
        let source = ImportSource::from_bytes("bundle.zip", stored_zip("view.base", b"ab\xffcd"));
        let mut host = MemoryHost::new();
        let preview = ArchiveImport
            .import(&source, &ImportRequest::preview(), &mut host)
            .unwrap();
        let applied = ArchiveImport
            .import(&source, &ImportRequest::apply(), &mut host)
            .unwrap();
        assert_eq!(preview.documents, applied.documents);
        assert!(
            matches!(&applied.documents[0].outcome, ImportOutcome::Failed(msg) if msg.contains("view.base") && msg.contains("invalid byte at offset 2"))
        );
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }
    #[test]
    fn bear_backup_imports_plaintext_notes_but_refuses_sqlite_only() {
        let json = include_str!("../../../tests/fixtures/imports/bear.json");
        let mut host = MemoryHost::new();
        let source = ImportSource::from_bytes(
            "backup.bear2bk",
            stored_zip("Bear/notes.json", json.as_bytes()),
        );
        let preview = ArchiveImport
            .import(&source, &ImportRequest::preview(), &mut host)
            .unwrap();
        assert_eq!(preview.documents.len(), 2);
        assert!(host.list_documents(None).unwrap().items.is_empty());
        let applied = ArchiveImport
            .import(&source, &ImportRequest::apply(), &mut host)
            .unwrap();
        assert_eq!(preview.documents, applied.documents);
        assert!(host
            .read_document(&applied.documents[0].doc)
            .unwrap()
            .contains("source_id: bear-a"));

        let opaque = ImportSource::from_bytes(
            "opaque.bear2bk",
            stored_zip("Bear.sqlite", b"SQLite format 3"),
        );
        let error = ArchiveImport
            .import(&opaque, &ImportRequest::apply(), &mut host)
            .unwrap_err();
        assert!(error.to_string().contains("SQLite"));
        assert_eq!(host.list_documents(None).unwrap().items.len(), 2);
    }
}
