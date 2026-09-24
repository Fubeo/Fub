//! JSON import: Roam export, Google Keep Takeout, Bear backup, Logseq
//! file-graph sidecars, and generic JSON — one provider, format sniffing by
//! shape, never by name alone.
//!
//! Claims `.json` by extension or `application/json` without an extension.
//! Shapes (checked in order):
//! - Roam: `[{title, children:[{string, children…}]}]` → one note per
//!   top-level page, blocks as nested bullets, `((uid))` refs kept verbatim
//!   + reported;
//! - Keep: `{"notes":[{title, textContent/listContent, labels, isArchived…}]}`
//!   (Takeout `Keep/*.json` merged or single) → checklist to `- [ ]`,
//!   labels to `#tags` + frontmatter, reminders/assignees reported as
//!   non-reconstructible;
//! - Bear: `{"notes":[{"title","text","tags","trashed"…}]}` → text + tags;
//! - Craft: `{"pages"|"documents":[{"title","content_markdown"|"content"}]}`;
//! - Logseq graph: `{"blocks":[…]}` file-graph → outline bullets,
//!   `query`/`macro` values kept as text when non-translatable;
//! - Generic: pretty fenced `json` body + scalar top-level keys as
//!   frontmatter. Arrays/objects without a mapping stay as source text,
//!   never dropped.
//!
//! Attachments referenced by path/URL are kept verbatim + reported; nothing
//! is downloaded here.

use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource, TransferNote};
use fub_abi::PluginError;

use crate::common::{
    bad_args, content_hash_hex, is_cancelled, resolve_destination, sanitize_component, write_doc,
    MAX_DOCS_PER_IMPORT,
};

fn str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn render_blocks(children: &serde_json::Value, depth: usize, out: &mut String, refs: &mut bool) {
    let Some(arr) = children.as_array() else {
        return;
    };
    for child in arr {
        let s = child
            .get("string")
            .or_else(|| child.get("text"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        if s.contains("((") {
            *refs = true;
        }
        let indent = "  ".repeat(depth.min(12));
        if !s.trim().is_empty() {
            out.push_str(&format!("{indent}- {s}\n"));
        }
        if let Some(sub) = child.get("children") {
            render_blocks(sub, depth + 1, out, refs);
        }
    }
}

pub(crate) struct Note {
    pub(crate) title: String,
    pub(crate) markdown: String,
    pub(crate) warnings: Vec<String>,
}

pub(crate) fn convert(
    value: &serde_json::Value,
    source_name: &str,
) -> Result<Vec<Note>, PluginError> {
    // Roam: top-level array of {title, children}.
    if let Some(arr) = value.as_array() {
        if !arr.is_empty()
            && arr
                .iter()
                .all(|p| p.get("title").and_then(|t| t.as_str()).is_some())
        {
            let mut notes = Vec::new();
            for page in arr {
                let title = str_field(page, "title").unwrap_or_else(|| "Untitled".to_string());
                let mut body = String::new();
                let mut refs = false;
                if let Some(children) = page.get("children") {
                    render_blocks(children, 0, &mut body, &mut refs);
                }
                let mut warnings = Vec::new();
                if refs {
                    warnings.push(
                        "block references ((uid)) kept verbatim (no vault equivalent)".to_string(),
                    );
                }
                let mut fm = format!(
                    "---\ntitle: {}\nsource_file: {}\n",
                    crate::common::yaml_scalar(&title),
                    crate::common::yaml_scalar(source_name),
                );
                if let Some(uid) = page.get("uid").and_then(|v| v.as_str()) {
                    fm.push_str(&format!("source_id: {}\n", crate::common::yaml_scalar(uid)));
                }
                if let Some(created) = page.get("create-time").and_then(|v| v.as_i64()) {
                    fm.push_str(&format!("source_created_ms: {created}\n"));
                }
                fm.push_str(&format!(
                    "source_payload_json: {}\n---\n\n",
                    crate::common::yaml_scalar(&page.to_string())
                ));
                notes.push(Note {
                    title,
                    markdown: format!("{fm}{}", body.trim_end()),
                    warnings,
                });
            }
            return Ok(notes);
        }
    }
    // Keep Takeout: {"notes":[…]} or a single note object.
    if let Some(obj) = value.as_object() {
        if let Some(notes) = obj.get("notes").and_then(|v| v.as_array()) {
            let bear = notes
                .iter()
                .any(|n| n.get("text").and_then(|t| t.as_str()).is_some());
            let keep = notes
                .iter()
                .any(|n| n.get("textContent").is_some() || n.get("listContent").is_some());
            if bear && keep {
                return Err(bad_args(
                    "mixed Bear and Google Keep note shapes: refusing to discard either schema",
                ));
            }
            if bear {
                return Ok(notes.iter().map(|n| bear_note(n, source_name)).collect());
            }
            return Ok(notes.iter().map(|n| keep_note(n, source_name)).collect());
        }
        if obj.contains_key("textContent") || obj.contains_key("listContent") {
            return Ok(vec![keep_note(value, source_name)]);
        }
        // Craft: {"pages"|"documents":[{title, content_markdown|content}]}.
        for key in ["pages", "documents"] {
            if let Some(arr) = obj.get(key).and_then(|v| v.as_array()) {
                let mut out = Vec::new();
                for p in arr {
                    let title = str_field(p, "title").unwrap_or_else(|| "Untitled".to_string());
                    let content = str_field(p, "content_markdown")
                        .or_else(|| str_field(p, "content"))
                        .unwrap_or_default();
                    let mut fm = format!(
                        "---\ntitle: {}\nsource_file: {}\n",
                        crate::common::yaml_scalar(&title),
                        crate::common::yaml_scalar(source_name),
                    );
                    for (field, key) in [
                        ("id", "source_id"),
                        ("folder", "source_folder"),
                        ("created", "source_created"),
                        ("modified", "source_modified"),
                    ] {
                        if let Some(value) = p.get(field).and_then(|v| v.as_str()) {
                            fm.push_str(&format!("{key}: {}\n", crate::common::yaml_scalar(value)));
                        }
                    }
                    fm.push_str(&format!(
                        "source_payload_json: {}\n---\n\n",
                        crate::common::yaml_scalar(&p.to_string())
                    ));
                    out.push(Note {
                        title,
                        markdown: format!("{fm}{}", content.trim_end()),
                        warnings: vec!["non-standard Craft links kept verbatim".to_string()],
                    });
                }
                return Ok(out);
            }
        }
        // Logseq file-graph sidecar: {"blocks":[…], "properties":{…}}.
        if let Some(blocks) = obj.get("blocks") {
            let title = str_field(value, "title")
                .or_else(|| str_field(value, "page"))
                .unwrap_or_else(|| "Untitled".to_string());
            let mut body = String::new();
            let mut refs = false;
            render_blocks(blocks, 0, &mut body, &mut refs);
            let mut warnings = Vec::new();
            if refs {
                warnings.push("block references kept verbatim".to_string());
            }
            for key in ["query", "macro", "macros"] {
                if obj.contains_key(key) {
                    warnings.push(format!("`{key}` preserved as text (not translatable)"));
                }
            }
            let mut fm = format!(
                "---\ntitle: {}\nsource_file: {}\n",
                crate::common::yaml_scalar(&title),
                crate::common::yaml_scalar(source_name),
            );
            if let Some(props) = obj.get("properties") {
                fm.push_str(&format!(
                    "source_properties_json: {}\n",
                    crate::common::yaml_scalar(&props.to_string())
                ));
            }
            fm.push_str(&format!(
                "source_payload_json: {}\n---\n\n",
                crate::common::yaml_scalar(&value.to_string())
            ));
            return Ok(vec![Note {
                title,
                markdown: format!("{fm}{}", body.trim_end()),
                warnings,
            }]);
        }
    }
    // Generic: scalars to frontmatter, rest fenced.
    let pretty = serde_json::to_string_pretty(value)
        .map_err(|e| bad_args(format!("`{source_name}`: JSON unrestorable: {e}")))?;
    let title = source_name
        .rsplit('/')
        .next()
        .unwrap_or(source_name)
        .trim_end_matches(".json")
        .to_string();
    let mut fm = format!(
        "---\ntitle: {}\nsource_file: {}\n",
        crate::common::yaml_scalar(&title),
        crate::common::yaml_scalar(source_name),
    );
    if let Some(obj) = value.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                if s.len() <= 500 && !s.contains('\n') {
                    fm.push_str(&format!("{k}: {}\n", crate::common::yaml_scalar(s)));
                }
            } else if v.is_number() || v.is_boolean() {
                fm.push_str(&format!("{k}: {v}\n"));
            }
        }
    }
    fm.push_str("---\n\n");
    Ok(vec![Note {
        title,
        markdown: format!("{fm}```json\n{pretty}\n```\n"),
        warnings: vec!["no specific mapping: structure preserved as source text".to_string()],
    }])
}

fn bear_note(n: &serde_json::Value, source_name: &str) -> Note {
    let title = str_field(n, "title").unwrap_or_else(|| "Untitled".to_string());
    let text = str_field(n, "text").unwrap_or_default();
    let mut fm = format!(
        "---\ntitle: {}\nsource_file: {}\n",
        crate::common::yaml_scalar(&title),
        crate::common::yaml_scalar(source_name),
    );
    if let Some(id) = n
        .get("id")
        .or_else(|| n.get("uniqueIdentifier"))
        .and_then(|v| v.as_str())
    {
        fm.push_str(&format!("source_id: {}\n", crate::common::yaml_scalar(id)));
    }
    if let Some(tags) = n.get("tags").and_then(|v| v.as_array()) {
        fm.push_str("tags:\n");
        for t in tags.iter().filter_map(|t| t.as_str()) {
            fm.push_str(&format!("  - {}\n", crate::common::yaml_scalar(t)));
        }
    }
    for key in ["created", "modified"] {
        if let Some(value) = n.get(key).and_then(|v| v.as_str()) {
            fm.push_str(&format!("{key}: {}\n", crate::common::yaml_scalar(value)));
        }
    }
    if n.get("trashed").and_then(|v| v.as_bool()).unwrap_or(false) {
        fm.push_str("trashed: true\n");
    }
    fm.push_str(&format!(
        "source_payload_json: {}\n",
        crate::common::yaml_scalar(&n.to_string())
    ));
    fm.push_str("---\n\n");
    Note {
        title,
        markdown: format!("{fm}{}", text.trim_end()),
        warnings: vec!["Bear-specific links and attachments retained in source text; referenced assets require their original export".to_string()],
    }
}

fn keep_note(n: &serde_json::Value, source_name: &str) -> Note {
    let title = str_field(n, "title")
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Untitled".to_string());
    let mut body = String::new();
    let mut warnings = Vec::new();
    if let Some(text) = n.get("textContent").and_then(|v| v.as_str()) {
        body.push_str(text.trim_end());
    }
    if let Some(items) = n.get("listContent").and_then(|v| v.as_array()) {
        for item in items {
            let t = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let checked = item
                .get("isChecked")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            body.push_str(&format!("\n- [{}] {t}", if checked { "x" } else { " " }));
        }
        body = body.trim_start_matches('\n').to_string();
    }
    let labels: Vec<String> = n
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|l| l.get("name").and_then(|x| x.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if n.get("reminders").is_some_and(|v| !v.is_null()) {
        warnings.push("reminders/assignees not reconstructible: declared".to_string());
    }
    let mut fm = format!(
        "---\ntitle: {}\nsource_file: {}\n",
        crate::common::yaml_scalar(&title),
        crate::common::yaml_scalar(source_name),
    );
    if n.get("isArchived")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        fm.push_str("archived: true\n");
    }
    if n.get("isTrashed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        fm.push_str("trashed: true\n");
    }
    if !labels.is_empty() {
        fm.push_str("labels:\n");
        for l in &labels {
            fm.push_str(&format!("  - {}\n", crate::common::yaml_scalar(l)));
        }
    }
    fm.push_str(&format!(
        "source_payload_json: {}\n",
        crate::common::yaml_scalar(&n.to_string())
    ));
    fm.push_str("---\n\n");
    if !labels.is_empty() {
        body = format!(
            "{}\n\n{body}",
            labels
                .iter()
                .map(|l| format!("#{l}"))
                .collect::<Vec<_>>()
                .join(" ")
        );
    }
    Note {
        title,
        markdown: format!("{fm}{}", body.trim_end()),
        warnings,
    }
}

#[derive(Default)]
pub struct JsonImport;

impl JsonImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(JsonImport)
    }
}

impl ImportProvider for JsonImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("json") => true,
            Some(_) => false,
            None => source
                .media_type
                .as_deref()
                .is_some_and(|m| m.split(';').next().unwrap_or(m).trim() == "application/json"),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let text = source.text(host)?;
        let value: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| bad_args(format!("`{}` is not JSON: {e}", source.name)))?;
        let notes = convert(&value, &source.name)?;
        let mut report = ImportReport::new(request.mode);
        let source_sha = content_hash_hex(text.as_bytes());
        let mut seen = std::collections::HashSet::new();
        for (index, n) in notes.into_iter().enumerate() {
            if report.documents.len() >= MAX_DOCS_PER_IMPORT {
                report.log.push(
                    TransferNote::warning(format!("stopped after {MAX_DOCS_PER_IMPORT} notes"))
                        .about(source.name.clone()),
                );
                break;
            }
            let stem = sanitize_component(&n.title).unwrap_or_else(|| "note".to_string());
            let mut name = format!("{stem}.md");
            let mut suffix = 1;
            while !seen.insert(name.clone()) {
                suffix += 1;
                name = format!("{stem}-{suffix}.md");
            }
            let entry = format!("{}:{}", source.name, index + 1);
            let wanted = request.destination(&name);
            let (doc, outcome) =
                resolve_destination(host, request, wanted, &entry, &mut report.log);
            for w in &n.warnings {
                report
                    .log
                    .push(TransferNote::warning(w.clone()).about(entry.clone()));
            }
            let markdown = if let Some(rest) = n.markdown.strip_prefix("---\n") {
                format!(
                    "---\nsource_sha: {source_sha}\nsource_entry: {}\n{rest}",
                    index + 1
                )
            } else {
                n.markdown
            };
            if let Err(e) = write_doc(host, request, &doc, &markdown, outcome, &entry, &mut report)
            {
                if is_cancelled(&e) {
                    return Err(e);
                }
                report
                    .log
                    .push(TransferNote::warning(e.to_string()).about(entry));
            }
        }
        Ok(report)
    }
}
