//! Shared limits, naming, hashing and write helpers for every provider.
//!
//! All user-visible failures go through [`PluginError`]; anything about one
//! piece of a half-successful transfer is an outcome/note, never a top-level
//! error. `Cancelled` always propagates as `Err` so a cancelled job never
//! reports a partial success as complete.

use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_abi::transfer::{
    ConflictPolicy, ImportMode, ImportOutcome, ImportReport, ImportRequest, TransferNote,
};
use fub_abi::PluginError;

/// Largest single source accepted without an explicit chunked path.
pub const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
/// Largest single archive entry after inflation.
pub const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
/// Largest total inflation of one archive (zip-bomb ceiling).
pub const MAX_TOTAL_UNCOMPRESSED: u64 = 256 * 1024 * 1024;
/// Most entries accepted from one archive.
pub const MAX_ENTRIES: usize = 10_000;
/// Compression ratio above which an entry is treated as hostile when it is
/// also large (small highly-compressible files are legitimate).
pub const BOMB_RATIO: u64 = 200;
/// Size above which the ratio check applies.
pub const BOMB_MIN_BYTES: u64 = 10 * 1024 * 1024;
/// Most rows converted from one CSV.
pub const MAX_CSV_ROWS: usize = 100_000;
/// Most notes written by one import call (archive fan-out guard).
pub const MAX_DOCS_PER_IMPORT: usize = 10_000;
/// Private staging/manifest payload ceiling (data space).
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

pub fn bad_args(msg: impl Into<String>) -> PluginError {
    PluginError::BadArgs(msg.into().into())
}

pub fn permission_denied(msg: impl Into<String>) -> PluginError {
    PluginError::PermissionDenied(msg.into().into())
}

pub fn unserved(msg: impl Into<String>) -> PluginError {
    PluginError::Unserved(msg.into().into())
}

pub fn io_error(msg: impl Into<String>) -> PluginError {
    PluginError::Io(msg.into().into())
}

pub fn is_cancelled(err: &PluginError) -> bool {
    matches!(err, PluginError::Cancelled(_))
}

/// Content hash as lowercase hex (no `sha256:` prefix).
pub fn content_hash_hex(bytes: &[u8]) -> String {
    Revision::of_bytes(bytes)
        .as_str()
        .trim_start_matches("sha256:")
        .to_owned()
}

/// Minimal YAML scalar quoting, mirroring the clipper's `yamlScalar`.
///
/// Plain when safe, JSON-quoted otherwise (covers `:`, `#`, leading
/// specials, surrounding whitespace, and `true`/`false`/`null`/numbers that
/// YAML would otherwise retype).
pub fn yaml_scalar(raw: &str) -> String {
    if raw.is_empty() {
        return "\"\"".to_string();
    }
    let first = raw.chars().next().unwrap_or(' ');
    let risky_first = matches!(
        first,
        ':' | '#'
            | '['
            | ']'
            | '{'
            | '}'
            | ','
            | '&'
            | '*'
            | '!'
            | '|'
            | '>'
            | '\''
            | '"'
            | '%'
            | '@'
            | '`'
            | '\n'
            | '\r'
    );
    let risky_body = raw.contains('\n')
        || raw.contains('\r')
        || raw.contains(':')
        || raw.starts_with(char::is_whitespace)
        || raw.ends_with(char::is_whitespace);
    let looks_typed = matches!(raw, "true" | "false" | "null" | "~")
        || (raw.len() <= 64
            && !raw.is_empty()
            && raw
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'+' | b'-' | b'e' | b'E'))
            && raw.bytes().any(|b| b.is_ascii_digit()));
    if risky_first || risky_body || looks_typed {
        serde_json::to_string(raw).unwrap_or_else(|_| format!("{raw:?}"))
    } else {
        raw.to_string()
    }
}

/// One component of a vault path: trimmed, no empty / `.` / `..`, no
/// separators, no controls, bounded length. `None` = not namable.
pub fn sanitize_component(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || t == "." || t == ".." {
        return None;
    }
    if t.contains('/') || t.contains('\\') || t.contains('\0') {
        return None;
    }
    if t.chars().any(|c| c.is_control()) {
        return None;
    }
    if t.len() > 200 || t.chars().count() > 120 {
        return None;
    }
    // Windows-reserved bare stems travel badly through sync; keep them
    // addressable by suffixing instead of refusing the whole entry.
    const RESERVED: &[&str] = &[
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let lower = t.to_ascii_lowercase();
    let bare = lower.rsplit('.').next_back().unwrap_or(&lower);
    if RESERVED.contains(&bare) {
        return Some(format!("{t}_"));
    }
    Some(t.to_string())
}

/// Stem of an archive entry / source name with the same rule as
/// [`ImportSource::stem`](fub_abi::transfer::ImportSource::stem): single
/// trailing component, no extension, trimmed, never `.`/`..`.
pub fn entry_stem(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = match base.rsplit_once('.') {
        Some((s, _)) if !s.is_empty() => s,
        _ => base,
    };
    sanitize_component(stem)
}

/// Join sanitized folder components + file name into a `DocId` string.
/// Returns `None` when nothing namable remains.
pub fn join_doc_path(folder: &[String], file: &str) -> Option<String> {
    let f = sanitize_component(file)?;
    let mut parts: Vec<String> = Vec::with_capacity(folder.len() + 1);
    for c in folder {
        parts.push(sanitize_component(c)?);
    }
    parts.push(f);
    Some(parts.join("/"))
}

/// Resolve the destination for one document under the requested folder,
/// following the conflict policy. Read-only: safe in `Preview`.
pub fn resolve_destination(
    host: &dyn HostApi,
    request: &ImportRequest,
    wanted: DocId,
    entry: &str,
    log: &mut Vec<TransferNote>,
) -> (DocId, ImportOutcome) {
    let occupied = host
        .list_documents(None)
        .map(|p| p.items.contains(&wanted))
        .unwrap_or(false);
    match (occupied, request.on_conflict) {
        (false, _) => (wanted, ImportOutcome::Created),
        (true, ConflictPolicy::Skip) => (wanted.clone(), ImportOutcome::Skipped),
        (true, ConflictPolicy::Replace) => (wanted, ImportOutcome::Replaced),
        (true, ConflictPolicy::Rename) => {
            let free = host.free_name(&wanted);
            log.push(
                TransferNote::warning(format!("`{wanted}` exists already: imported as `{free}`"))
                    .about(entry.to_string()),
            );
            (free, ImportOutcome::Created)
        }
    }
}

/// Binary assets are not necessarily indexed as documents; existence must be
/// determined by byte read, never by `list_documents`.
pub fn resolve_binary_destination(
    host: &dyn HostApi,
    request: &ImportRequest,
    wanted: DocId,
    entry: &str,
    log: &mut Vec<TransferNote>,
) -> Result<(DocId, ImportOutcome), PluginError> {
    let occupied = match host.read_document_bytes(&wanted) {
        Ok(_) => true,
        Err(PluginError::NotFound(_)) => false,
        Err(error) => return Err(error),
    };
    Ok(match (occupied, request.on_conflict) {
        (false, _) => (wanted, ImportOutcome::Created),
        (true, ConflictPolicy::Skip) => (wanted, ImportOutcome::Skipped),
        (true, ConflictPolicy::Replace) => (wanted, ImportOutcome::Replaced),
        (true, ConflictPolicy::Rename) => {
            let free = host.free_name(&wanted);
            log.push(
                TransferNote::warning(format!("`{wanted}` exists already: imported as `{free}`"))
                    .about(entry),
            );
            (free, ImportOutcome::Created)
        }
    })
}

/// Write one document, honouring `Preview` (no writes) and propagating
/// `Cancelled` as `Err`. Any other write failure becomes
/// [`ImportOutcome::Failed`] so the import stays valid.
pub fn write_doc(
    host: &mut dyn HostApi,
    request: &ImportRequest,
    doc: &DocId,
    text: &str,
    outcome: ImportOutcome,
    entry: &str,
    report: &mut ImportReport,
) -> Result<(), PluginError> {
    debug_assert_eq!(report.mode, request.mode);
    let writes = matches!(outcome, ImportOutcome::Created | ImportOutcome::Replaced)
        && request.mode == ImportMode::Apply;
    let outcome = if writes {
        let res = match &outcome {
            ImportOutcome::Replaced => host
                .write_document(doc, text, WriteBase::Dictated)
                .map(|_| ()),
            _ => host.create_document(doc, text),
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
        doc: doc.clone(),
        outcome,
        entry: Some(entry.to_string()),
    });
    Ok(())
}

/// Binary assets use the same preview/conflict semantics as notes, but byte
/// writes are revision-guarded so a race cannot replace a user's attachment.
pub fn write_asset(
    host: &mut dyn HostApi,
    request: &ImportRequest,
    doc: &DocId,
    bytes: &[u8],
    outcome: ImportOutcome,
    entry: &str,
    report: &mut ImportReport,
) -> Result<(), PluginError> {
    let outcome = if request.mode == ImportMode::Apply {
        match outcome {
            ImportOutcome::Created => match host.write_document_bytes(doc, bytes, None) {
                Ok(_) => ImportOutcome::Created,
                Err(e) if is_cancelled(&e) => return Err(e),
                Err(e) => ImportOutcome::Failed(e.to_string()),
            },
            ImportOutcome::Replaced => {
                let result = host
                    .document_revision(doc)
                    .and_then(|revision| host.write_document_bytes(doc, bytes, Some(revision)));
                match result {
                    Ok(_) => ImportOutcome::Replaced,
                    Err(e) if is_cancelled(&e) => return Err(e),
                    Err(e) => ImportOutcome::Failed(e.to_string()),
                }
            }
            other => other,
        }
    } else {
        outcome
    };
    report.documents.push(fub_abi::transfer::ImportedDocument {
        doc: doc.clone(),
        outcome,
        entry: Some(entry.to_string()),
    });
    Ok(())
}

/// Standard frontmatter header for imported notes.
///
/// Keeps the original identifiers verbatim (`source_id`, `source_file`,
/// `source_row`, `source_sha`) so re-imports are repeatable and collisions
/// are explainable. Dates are preserved as the source wrote them.
pub fn frontmatter(
    title: Option<&str>,
    source_file: &str,
    source_id: Option<&str>,
    source_sha: Option<&str>,
    extra: &[(&str, &str)],
) -> String {
    let mut out = String::from("---\n");
    if let Some(t) = title {
        out.push_str(&format!("title: {}\n", yaml_scalar(t)));
    }
    out.push_str(&format!("source_file: {}\n", yaml_scalar(source_file)));
    if let Some(id) = source_id {
        out.push_str(&format!("source_id: {}\n", yaml_scalar(id)));
    }
    if let Some(sha) = source_sha {
        out.push_str(&format!("source_sha: {sha}\n"));
    }
    for (k, v) in extra {
        out.push_str(&format!("{k}: {}\n", yaml_scalar(v)));
    }
    out.push_str("---\n\n");
    out
}

/// Minimal base64 decoder (standard alphabet, `=` padding, whitespace
/// rejected). Avoids a new dependency for the single ENEX `<data>` case;
/// invalid input is an error, never silent truncation.
pub fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut vals: Vec<u8> = Vec::with_capacity(input.len() / 4 * 3);
    let mut buf: u32 = 0;
    let mut bits: u8 = 0;
    let mut pad = 0usize;
    for b in input.bytes() {
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                pad += 1;
                0
            }
            _ => return Err(format!("invalid base64 character: {b:#04x}")),
        };
        if pad > 0 && b != b'=' {
            return Err("data after base64 padding".to_string());
        }
        buf = (buf << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            vals.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    if pad > 2 {
        return Err("too much base64 padding".to_string());
    }
    for _ in 0..pad {
        vals.pop();
    }
    Ok(vals)
}

/// Fallback plain-text import: the contract's faithful minimum.
///
/// Claims `.txt`/`.text` (and `text/plain` without an extension), never
/// `.md`/`.markdown` (owned by `fub.markdown`), never `.base`/`.canvas`/
/// `.fubsheet` (owned by their format crates: those fall back to source
/// text only through their own providers, never through a generic import).
#[derive(Default)]
pub struct TextImport;

impl TextImport {
    pub fn boxed() -> Box<dyn fub_abi::transfer::ImportProvider> {
        Box::new(TextImport)
    }
}

impl fub_abi::transfer::ImportProvider for TextImport {
    fn can_handle(&self, source: &fub_abi::transfer::ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("txt" | "text" | "log") => true,
            Some(_) => false,
            None => source
                .media_type
                .as_deref()
                .is_some_and(|m| m.split(';').next().unwrap_or(m).trim() == "text/plain"),
        }
    }

    fn import(
        &mut self,
        source: &fub_abi::transfer::ImportSource,
        request: &fub_abi::transfer::ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<fub_abi::transfer::ImportReport, PluginError> {
        let text = source.text(host)?;
        let stem = source
            .stem()
            .ok_or_else(|| bad_args(format!("`{}` gives no usable document name", source.name)))?;
        let mut report = ImportReport::new(request.mode);
        let wanted = request.destination(&format!("{stem}.md"));
        let (doc, outcome) =
            resolve_destination(host, request, wanted, &source.name, &mut report.log);
        let body = format!(
            "{}{}",
            frontmatter(
                None,
                &source.name,
                None,
                Some(&content_hash_hex(text.as_bytes())),
                &[]
            ),
            text.trim_end()
        );
        write_doc(
            host,
            request,
            &doc,
            &body,
            outcome,
            &source.name,
            &mut report,
        )?;
        Ok(report)
    }
}
