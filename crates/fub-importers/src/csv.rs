//! CSV import/export: rows in as notes (+ a faithful CSV back out), with
//! controlled type inference and a `convertible_to_base` manifest flag.
//!
//! Import claims `.csv`/`.tsv` (extension or `text/csv` / `text/tab-separated-
//! values`). Delimiter is sniffed from `,`/`;`/`\t`/`|` by header + first
//! rows; a declared `delimiter` option overrides. Encoding: UTF-8, else
//! `BadArgs` (no guessing — the loss would be silent). Oversized rows
//! fail explicitly instead of silently dropping the overflow cells.
//!
//! Each row becomes one note: scalar cells become frontmatter keys, long or
//! multiline cells move to the body with a `row_N` reference. The manifest
//! sets `convertible_to_base: true` when every header is identifier-like and
//! every row parsed cleanly — a hint for DataViewsOwner, never a `*.base`
//! write (this crate never writes `*.base`/`*.canvas`/`*.fubsheet` paths).
//!
//! Export (`csv.rows`, target `importers.csv`) renders one row per document
//! from scalar frontmatter keys + `title`/`source`: lossy by construction,
//! so the report logs every dropped key and every non-scalar value.

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::traits::{HostApi, ReadApi};
use fub_abi::transfer::{
    ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportTarget, ImportProvider,
    ImportReport, ImportRequest, ImportSource, TransferNote,
};
use fub_abi::PluginError;

use crate::common::{
    bad_args, content_hash_hex, is_cancelled, resolve_destination, sanitize_component, write_doc,
    MAX_CSV_ROWS, MAX_DOCS_PER_IMPORT,
};

pub const IMPORT_CSV_NOTE: &str = "csv import";
pub const TARGET_CSV_FILES: &str = "importers.csv";

fn media_base(media: Option<&str>) -> Option<&str> {
    media.map(|m| m.split(';').next().unwrap_or(m).trim())
}

fn sniff_delimiter(sample: &[&str]) -> u8 {
    let cands = [b',', b';', b'\t', b'|'];
    let mut best = b',';
    let mut best_score = 0usize;
    for &d in &cands {
        let counts: Vec<usize> = sample
            .iter()
            .take(6)
            .map(|l| l.bytes().filter(|&b| b == d).count())
            .collect();
        if counts.len() < 2 || counts.contains(&0) {
            continue;
        }
        let first = counts[0];
        if counts.iter().all(|&c| c == first) && first > best_score {
            best_score = first;
            best = d;
        }
    }
    best
}

/// Minimal RFC-4180 reader: quotes, doubled quotes, embedded newlines.
/// Returns logical records with their 1-based starting line numbers.
fn parse_records(text: &str, delim: u8) -> Result<Vec<(usize, Vec<String>)>, PluginError> {
    let mut out: Vec<(usize, Vec<String>)> = Vec::new();
    let mut field = String::new();
    let mut row: Vec<String> = Vec::new();
    let mut in_quotes = false;
    let mut start_line = 1usize;
    let mut line = 1usize;
    let mut chars = text.chars().peekable();
    let d = delim as char;
    while let Some(c) = chars.next() {
        if c == '\n' {
            line += 1;
        }
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        if c == '"' && field.is_empty() {
            in_quotes = true;
            continue;
        }
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                continue;
            }
            // Lone CR: end of record.
            row.push(std::mem::take(&mut field));
            out.push((start_line, std::mem::take(&mut row)));
            start_line = line + 1;
        } else if c == '\n' {
            row.push(std::mem::take(&mut field));
            out.push((start_line, std::mem::take(&mut row)));
            start_line = line;
        } else if c == d {
            row.push(std::mem::take(&mut field));
        } else {
            field.push(c);
        }
    }
    if in_quotes {
        return Err(bad_args("CSV ends inside a quoted field"));
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        out.push((start_line, row));
    }
    Ok(out)
}

fn is_ident(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
}

fn infer_scalar(raw: &str) -> (String, bool) {
    // Preserve the complete cell, including surrounding whitespace.
    if raw.len() > 500 || raw.contains('\n') || raw.contains('\r') {
        return (String::new(), false);
    }
    let scalar = if raw.contains('#') || raw.chars().any(|c| c.is_control()) {
        serde_json::to_string(raw).expect("UTF-8 string is JSON-serializable")
    } else {
        crate::common::yaml_scalar(raw)
    };
    (scalar, true)
}

/// Parsed table shared by the importer and the template preview.
#[derive(Debug, Clone)]
pub struct CsvTable {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub delimiter: u8,
    /// 1-based source line of each row (header excluded).
    pub lines: Vec<usize>,
}

pub fn parse_table(text: &str, forced_delim: Option<u8>) -> Result<CsvTable, PluginError> {
    let head: Vec<&str> = text.lines().take(6).collect();
    let delim = forced_delim.unwrap_or_else(|| sniff_delimiter(&head));
    let records = parse_records(text, delim)?;
    if records.is_empty() {
        return Err(bad_args("CSV source has no rows"));
    }
    let headers: Vec<String> = records[0].1.iter().map(|h| h.trim().to_string()).collect();
    if headers.iter().all(|h| h.is_empty()) {
        return Err(bad_args("CSV header row is empty"));
    }
    let width = headers.len().max(1);
    let mut rows = Vec::new();
    let mut lines = Vec::new();
    for (ln, mut rec) in records.into_iter().skip(1) {
        if rec.len() > width {
            return Err(bad_args(format!(
                "CSV row at line {ln} has {} cells but header has {width}",
                rec.len()
            )));
        }
        if rec.iter().all(|c| c.trim().is_empty()) {
            continue;
        }
        rec.resize(width, String::new());
        rows.push(rec);
        lines.push(ln);
        if rows.len() > MAX_CSV_ROWS {
            return Err(bad_args(format!("CSV exceeds {MAX_CSV_ROWS} rows")));
        }
    }
    Ok(CsvTable {
        headers,
        rows,
        delimiter: delim,
        lines,
    })
}

/// The same CSV row representation is used by direct and archived imports.
/// `source_file` is the full provenance (including the archive name, if any).
pub(crate) struct CsvRowNote {
    pub title: String,
    pub markdown: String,
    pub convertible: bool,
}

pub(crate) fn row_note(
    headers: &[String],
    row: &[String],
    source_file: &str,
    index: usize,
) -> CsvRowNote {
    let title = row
        .iter()
        .find(|c| !c.trim().is_empty())
        .map(|c| c.trim().chars().take(80).collect::<String>())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| format!("row_{}", index + 1));
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut used: BTreeSet<String> = ["title", "source_file", "source_row", "source_sha"]
        .into_iter()
        .map(str::to_string)
        .collect();
    let mut fm_pairs: Vec<(String, String)> = Vec::new();
    let mut body_parts: Vec<String> = Vec::new();
    let mut convertible = true;
    for (hi, h) in headers.iter().enumerate() {
        let base = if h.trim().is_empty() {
            convertible = false;
            format!("col_{hi}")
        } else {
            h.trim().to_string()
        };
        let n = seen.entry(base.clone()).or_insert(0);
        *n += 1;
        let mut key = if *n == 1 {
            base.clone()
        } else {
            format!("{base}_{n}")
        };
        if *n > 1 {
            convertible = false;
        }
        while used.contains(&key) {
            *n += 1;
            key = format!("{base}_{n}");
            convertible = false;
        }
        used.insert(key.clone());
        if !is_ident(&key) {
            convertible = false;
        }
        let cell = row.get(hi).map(String::as_str).unwrap_or("");
        let (scalar, is_scalar) = infer_scalar(cell);
        if is_scalar && is_ident(&key) {
            fm_pairs.push((key, scalar));
        } else {
            convertible = false;
            if !cell.is_empty() {
                body_parts.push(format!("## {key}\n\n{cell}\n"));
            }
        }
    }
    let sha = content_hash_hex(format!("{}:{}", headers.join("|"), row.join("|")).as_bytes());
    let mut fm = format!(
        "---\ntitle: {}\nsource_file: {}\nsource_row: {}\nsource_sha: {sha}\n",
        crate::common::yaml_scalar(&title),
        crate::common::yaml_scalar(source_file),
        index + 1
    );
    for (key, value) in fm_pairs {
        fm.push_str(&format!("{key}: {value}\n"));
    }
    fm.push_str("---\n\n");
    let markdown = if body_parts.is_empty() {
        format!("{fm}Row {} of `{source_file}`.\n", index + 1)
    } else {
        format!("{fm}{}\n", body_parts.join("\n"))
    };
    CsvRowNote {
        title,
        markdown,
        convertible,
    }
}

fn option_delim(request: &ImportRequest) -> Result<Option<u8>, PluginError> {
    let Some(v) = request.options.get("delimiter").and_then(|v| v.as_str()) else {
        return Ok(None);
    };
    match v {
        "," => Ok(Some(b',')),
        ";" => Ok(Some(b';')),
        "\t" | "tab" => Ok(Some(b'\t')),
        "|" => Ok(Some(b'|')),
        _ => Err(bad_args("option `delimiter` must be one of , ; tab |")),
    }
}

fn option_flag(request: &fub_abi::transfer::ExportRequest, key: &str, default: bool) -> bool {
    request
        .options
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

#[derive(Default)]
pub struct CsvImport;

impl CsvImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(CsvImport)
    }
}

impl ImportProvider for CsvImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("csv" | "tsv") => true,
            Some(_) => false,
            None => media_base(source.media_type.as_deref()).is_some_and(|m| {
                matches!(
                    m,
                    "text/csv" | "text/tab-separated-values" | "application/csv"
                )
            }),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let text = source.text(host)?;
        let forced = option_delim(request)?;
        // TSV extension without an explicit option still wins over sniffing.
        let forced = forced.or_else(|| {
            if source.extension().as_deref() == Some("tsv") {
                Some(b'\t')
            } else {
                None
            }
        });
        let table = parse_table(&text, forced)?;
        let mut report = ImportReport::new(request.mode);
        let stem_base = source
            .stem()
            .filter(|s| !s.is_empty())
            .unwrap_or("imported");
        let mut clean = true;
        for (idx, row) in table.rows.iter().enumerate() {
            if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                report.log.push(
                    TransferNote::warning(format!(
                        "stopped after {MAX_DOCS_PER_IMPORT} notes; remaining rows skipped"
                    ))
                    .about(source.name.clone()),
                );
                break;
            }
            let line = table.lines.get(idx).copied().unwrap_or(idx + 2);
            let entry = format!("{}:{}", source.name, line);
            let note = row_note(&table.headers, row, &source.name, idx);
            let file_stem =
                sanitize_component(&note.title).unwrap_or_else(|| format!("row_{}", idx + 1));
            let wanted = request.destination(&format!("{stem_base}-{file_stem}.md"));
            let (doc, outcome) =
                resolve_destination(host, request, wanted, &entry, &mut report.log);
            clean &= note.convertible;
            if let Err(e) = write_doc(
                host,
                request,
                &doc,
                &note.markdown,
                outcome,
                &entry,
                &mut report,
            ) {
                if is_cancelled(&e) {
                    return Err(e);
                }
                clean = false;
                report
                    .log
                    .push(TransferNote::warning(e.to_string()).about(entry.clone()));
            }
        }
        let convertible =
            clean && !table.headers.is_empty() && table.headers.iter().all(|h| is_ident(h.trim()));
        report.log.push(
            TransferNote::info(format!(
                "{} rows, delimiter `{}`{}, convertible_to_base: {convertible}",
                table.rows.len(),
                match table.delimiter {
                    b'\t' => "tab".to_string(),
                    d => (d as char).to_string(),
                },
                if forced.is_some() {
                    " (forced)"
                } else {
                    " (sniffed)"
                }
            ))
            .about(source.name.clone()),
        );
        let _ = IMPORT_CSV_NOTE;
        Ok(report)
    }
}

/// Faithful CSV export: one row per document from scalar frontmatter.
#[derive(Default)]
pub struct CsvExport;

impl CsvExport {
    pub fn boxed() -> Box<dyn fub_abi::transfer::ExportProvider> {
        Box::new(CsvExport)
    }
}

impl ExportProvider for CsvExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: TARGET_CSV_FILES.to_string(),
            name: "CSV (one row per note)".to_string(),
            extension: Some("csv".to_string()),
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        if request.target != TARGET_CSV_FILES {
            return Err(bad_args(format!(
                "`{}` is not a destination of this provider",
                request.target
            )));
        }
        let with_meta = option_flag(request, "with_meta", true);
        let docs = request.selection.resolve(host)?;
        let mut report = ExportReport::default();
        let mut keys: BTreeSet<String> = BTreeSet::new();
        let mut dropped: BTreeMap<String, usize> = BTreeMap::new();
        let mut readable = 0usize;
        for doc in &docs {
            let source = match host.read_document(doc) {
                Ok(s) => s,
                Err(e) => {
                    report
                        .log
                        .push(TransferNote::warning(e.to_string()).about(doc.to_string()));
                    continue;
                }
            };
            if source.len() > 32 * 1024 * 1024 {
                return Err(bad_args(format!(
                    "`{doc}` exceeds the 32 MiB CSV row limit"
                )));
            }
            readable += 1;
            let (fm, _) = split_frontmatter(&source);
            for (k, v) in fm {
                if is_scalar_value(&v) {
                    keys.insert(k);
                } else {
                    *dropped.entry(k).or_insert(0) += 1;
                }
            }
        }
        if readable == 0 {
            return Err(bad_args(
                "none of the selected documents could be read as CSV input",
            ));
        }
        let mut header = vec!["doc".to_string(), "body".to_string()];
        header.extend(keys.iter().cloned());
        if with_meta {
            header.push("source_json".to_string());
        } else {
            report.log.push(TransferNote::warning(
                "with_meta=false omits the reversible source_json column; only body and scalar properties are exported"
            ).about("csv.rows"));
        }
        for (k, n) in &dropped {
            report.log.push(
                TransferNote::warning(format!(
                    "key `{k}` cannot be represented as a scalar CSV cell in {n} note(s){}",
                    if with_meta {
                        "; preserved in source_json column"
                    } else {
                        "; omitted"
                    }
                ))
                .about("csv.rows".to_string()),
            );
        }
        let h = out.open_artifact("export.csv", "text/csv")?;
        let line = csv_line(&header);
        out.write_artifact(h, line.as_bytes())?;
        for doc in &docs {
            let source = match host.read_document(doc) {
                Ok(s) => s,
                Err(e) => {
                    report
                        .log
                        .push(TransferNote::warning(e.to_string()).about(doc.to_string()));
                    continue;
                }
            };
            if source.len() > 32 * 1024 * 1024 {
                return Err(bad_args(format!(
                    "`{doc}` exceeds the 32 MiB CSV row limit"
                )));
            }
            let (fm, body) = split_frontmatter(&source);
            let map: BTreeMap<String, String> =
                fm.into_iter().filter(|(_, v)| is_scalar_value(v)).collect();
            let mut rec = vec![doc.to_string(), body.to_string()];
            for k in &keys {
                rec.push(map.get(k).cloned().unwrap_or_default());
            }
            if with_meta {
                rec.push(
                    serde_json::to_string(&source)
                        .map_err(|e| bad_args(format!("`{doc}` cannot be serialized: {e}")))?,
                );
            }
            if rec
                .iter()
                .any(|cell| cell.trim_start().starts_with(['=', '+', '-', '@']))
            {
                report.log.push(TransferNote::warning(
                    "spreadsheet-formula cell prefixed with apostrophe; exact Markdown remains recoverable from source_json when enabled"
                ).about(doc.to_string()));
            }
            let line = csv_line(&rec);
            for chunk in line.as_bytes().chunks(64 * 1024) {
                out.write_artifact(h, chunk)?;
            }
        }
        report.artifacts.push(out.close_artifact(h)?);
        Ok(report)
    }
}

fn csv_line(cells: &[impl AsRef<str>]) -> String {
    let mut line = String::new();
    for (i, c) in cells.iter().enumerate() {
        if i > 0 {
            line.push(',');
        }
        let s = c.as_ref();
        // A CSV opened as a spreadsheet must never execute user-controlled text.
        let escaped;
        let s = if s.trim_start().starts_with(['=', '+', '-', '@']) {
            escaped = format!("'{s}");
            escaped.as_str()
        } else {
            s
        };
        if s.contains([',', '"', '\n', '\r']) {
            line.push('"');
            line.push_str(&s.replace('"', "\"\""));
            line.push('"');
        } else {
            line.push_str(s);
        }
    }
    line.push('\n');
    line
}

/// Frontmatter is optional. Preserve the body byte-for-byte; a malformed or
/// unterminated header is body, never data we quietly discard.
fn split_frontmatter(source: &str) -> (Vec<(String, String)>, &str) {
    let Some(after_open) = source
        .strip_prefix("---\n")
        .or_else(|| source.strip_prefix("---\r\n"))
    else {
        return (Vec::new(), source);
    };
    let mut offset = 0;
    let mut closing = None;
    for line in after_open.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == "---" || trimmed == "..." {
            closing = Some(offset + line.len());
            break;
        }
        offset += line.len();
    }
    let Some(body_offset) = closing else {
        return (Vec::new(), source);
    };
    let mut pairs = Vec::new();
    for line in after_open[..offset].lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            if is_ident(key) {
                pairs.push((key.to_string(), v.trim().to_string()));
            }
        }
    }
    (pairs, &after_open[body_offset..])
}

fn is_scalar_value(v: &str) -> bool {
    !v.is_empty() && v.len() <= 500 && !v.contains('\n')
}
