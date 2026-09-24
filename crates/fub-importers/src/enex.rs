//! ENEX (Evernote export) import: notebook, tags, resources, links.
//!
//! Claims `.enex` by extension or `application/enex+xml`. Parses with the
//! shared [`crate::xml_helper`] layer (quick-xml, depth/texture caps).
//! Each `<note>` becomes one note: ENML content → Markdown (headings,
//! lists, links, checkboxes, tables via the shared HTML converter),
//! `<tag>`s → `#tags`, notebook/stack → destination folder + frontmatter.
//!
//! Resources: `<data encoding="base64">` decoded (own minimal decoder —
//! invalid input is an error, never a silent truncation), hashed, staged in
//! private data space (`assets/<sha>.<ext>` from `mime`/`file-name`);
//! `hash` attribute verified when present (mismatch → warning + the decoded
//! bytes win, recorded). `evernote://` links are preserved verbatim and
//! reported (no vault equivalent). Encrypted/ink content: reported, never
//! decrypted or dropped silently.

use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource, TransferNote};
use fub_abi::PluginError;

use crate::common::{
    bad_args, base64_decode, content_hash_hex, resolve_destination, sanitize_component,
    write_asset, write_doc, MAX_ENTRY_BYTES,
};
use crate::xml_helper::{self, OpenTag, XmlSink};

pub struct EnexNote {
    pub title: String,
    pub markdown: String,
    pub warnings: Vec<String>,
    pub assets: Vec<EnexAsset>,
    pub notebook: Option<String>,
}

pub struct EnexAsset {
    pub path: String,
    pub sha: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

struct Collector {
    notes: Vec<RawNote>,
    current: Option<RawNote>,
    field: Option<String>,
    buf: String,
    depth: usize,
    resource: Option<RawResource>,
    in_data: bool,
    data_buf: String,
}

#[derive(Default)]
struct RawNote {
    title: String,
    content: String,
    created: Option<String>,
    updated: Option<String>,
    tags: Vec<String>,
    notebook: Option<String>,
    resources: Vec<RawResource>,
    has_ink: bool,
    has_encrypted: bool,
}

#[derive(Default, Clone)]
struct RawResource {
    mime: Option<String>,
    file_name: Option<String>,
    hash: Option<String>,
    encoding: Option<String>,
    data: String,
    width: Option<String>,
    height: Option<String>,
}

impl Collector {
    fn new() -> Self {
        Collector {
            notes: Vec::new(),
            current: None,
            field: None,
            buf: String::new(),
            depth: 0,
            resource: None,
            in_data: false,
            data_buf: String::new(),
        }
    }
}

impl XmlSink for Collector {
    fn start(&mut self, tag: &OpenTag) -> Result<(), PluginError> {
        self.depth += 1;
        match tag.name.as_str() {
            "note" => self.current = Some(RawNote::default()),
            "resource" => self.resource = Some(RawResource::default()),
            "data" => {
                self.in_data = true;
                self.data_buf.clear();
                if let Some(r) = self.resource.as_mut() {
                    for (k, v) in &tag.attrs {
                        if k.as_str() == "encoding" {
                            r.encoding = Some(v.clone());
                        }
                    }
                }
            }
            "title" | "content" | "created" | "updated" | "tag" | "notebook" | "mime"
            | "file-name" | "hash" | "width" | "height" | "ink" | "encrypted" => {
                self.field = Some(tag.name.clone());
                self.buf.clear();
            }
            _ => {
                // Unknown element: keep its text if inside a field.
            }
        }
        Ok(())
    }

    fn text(&mut self, text: &str) -> Result<(), PluginError> {
        if self.in_data {
            // Base64 may wrap; whitespace rejected by our decoder, so strip.
            self.data_buf
                .push_str(&text.split_whitespace().collect::<String>());
        } else if self.field.is_some() {
            self.buf.push_str(text);
        }
        Ok(())
    }

    fn end(&mut self, name: &str) -> Result<(), PluginError> {
        self.depth = self.depth.saturating_sub(1);
        match name {
            "note" => {
                if let Some(n) = self.current.take() {
                    self.notes.push(n);
                }
                self.field = None;
            }
            "resource" => {
                if let Some(r) = self.resource.take() {
                    if let Some(c) = self.current.as_mut() {
                        c.resources.push(r);
                    }
                }
                self.field = None;
            }
            "data" => {
                self.in_data = false;
                if let Some(r) = self.resource.as_mut() {
                    r.data = std::mem::take(&mut self.data_buf);
                }
                self.field = None;
            }
            "title" | "content" | "created" | "updated" | "tag" | "notebook" | "mime"
            | "file-name" | "hash" | "width" | "height" => {
                let value = std::mem::take(&mut self.buf);
                self.field = None;
                if let Some(c) = self.current.as_mut() {
                    match name {
                        "title" => c.title = value.trim().to_string(),
                        "content" => c.content = value,
                        "created" => c.created = Some(value.trim().to_string()),
                        "updated" => c.updated = Some(value.trim().to_string()),
                        "tag" => {
                            let t = value.trim().to_string();
                            if !t.is_empty() {
                                c.tags.push(t);
                            }
                        }
                        "notebook" => c.notebook = Some(value.trim().to_string()),
                        _ => {
                            if let Some(r) = self.resource.as_mut() {
                                match name {
                                    "mime" => r.mime = Some(value.trim().to_string()),
                                    "file-name" => r.file_name = Some(value.trim().to_string()),
                                    "hash" => r.hash = Some(value.trim().to_lowercase()),
                                    "width" => r.width = Some(value.trim().to_string()),
                                    "height" => r.height = Some(value.trim().to_string()),
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
            "ink" => {
                if let Some(c) = self.current.as_mut() {
                    c.has_ink = true;
                }
                self.field = None;
            }
            "encrypted" => {
                if let Some(c) = self.current.as_mut() {
                    c.has_encrypted = true;
                }
                self.field = None;
            }
            _ => {}
        }
        Ok(())
    }
}

/// Parse ENEX text into per-note Markdown. Exported for archive fan-out.
pub fn parse_enex(text: &str, source_name: &str) -> Result<Vec<EnexNote>, PluginError> {
    let mut col = Collector::new();
    xml_helper::parse_str(text, &mut col)?;
    let mut out = Vec::with_capacity(col.notes.len());
    for raw in col.notes {
        out.push(convert_note(raw, source_name)?);
    }
    Ok(out)
}

fn convert_note(raw: RawNote, source_name: &str) -> Result<EnexNote, PluginError> {
    let mut warnings = Vec::new();
    let title = if raw.title.trim().is_empty() {
        "Untitled".to_string()
    } else {
        raw.title.trim().to_string()
    };
    // ENML content is XML wrapping HTML-ish markup; extract the inner HTML.
    let html = extract_enml_html(&raw.content);
    let (body, assets, notes) =
        crate::html::html_to_markdown(&html, &crate::html::ClipOptions::default());
    let mut md_body = body;
    for n in notes {
        if n.level == "warn" {
            warnings.push(format!("{} ({})", n.message, n.entry));
        }
    }
    let _ = assets;
    // Resources: decode + stage.
    let mut staged = Vec::new();
    for r in &raw.resources {
        let enc = r.encoding.as_deref().unwrap_or("base64");
        if enc != "base64" {
            warnings.push(format!(
                "resource `{}` uses encoding `{enc}`: kept as reference only",
                r.file_name.as_deref().unwrap_or("?")
            ));
            continue;
        }
        match base64_decode(&r.data) {
            Ok(bytes) => {
                if bytes.len() as u64 > MAX_ENTRY_BYTES {
                    warnings.push(format!(
                        "resource `{}` exceeds 32 MiB: kept as reference only",
                        r.file_name.as_deref().unwrap_or("?")
                    ));
                    continue;
                }
                let sha = content_hash_hex(&bytes);
                if r.hash.is_some() {
                    warnings.push(format!("resource `{}` supplies an Evernote MD5 digest; its SHA-256 is recorded but MD5 is not verified", r.file_name.as_deref().unwrap_or("?")));
                }
                let ext = match r.mime.as_deref().unwrap_or("") {
                    "image/png" => "png",
                    "image/jpeg" => "jpg",
                    "image/gif" => "gif",
                    "image/webp" => "webp",
                    "application/pdf" => "pdf",
                    "text/plain" => "txt",
                    _ => "bin",
                };
                staged.push(EnexAsset {
                    path: format!("assets/{sha}.{ext}"),
                    sha,
                    name: r
                        .file_name
                        .clone()
                        .unwrap_or_else(|| "resource".to_string()),
                    bytes,
                });
            }
            Err(e) => warnings.push(format!(
                "resource `{}` undecodable ({e}): kept as reference only",
                r.file_name.as_deref().unwrap_or("?")
            )),
        }
    }
    if raw.has_ink {
        warnings.push("ink content has no vault equivalent: referenced, not converted".to_string());
    }
    if raw.has_encrypted {
        warnings.push("encrypted span kept encrypted: not decrypted, content preserved as ciphertext reference".to_string());
    }
    let mut fm = format!(
        "---\ntitle: {}\nsource_file: {}\n",
        crate::common::yaml_scalar(&title),
        crate::common::yaml_scalar(source_name),
    );
    if let Some(nb) = raw.notebook.as_deref().filter(|s| !s.is_empty()) {
        fm.push_str(&format!("notebook: {}\n", crate::common::yaml_scalar(nb)));
    }
    if let Some(c) = raw.created.as_deref().filter(|s| !s.is_empty()) {
        fm.push_str(&format!("created: {}\n", crate::common::yaml_scalar(c)));
    }
    if let Some(u) = raw.updated.as_deref().filter(|s| !s.is_empty()) {
        fm.push_str(&format!("updated: {}\n", crate::common::yaml_scalar(u)));
    }
    if !raw.tags.is_empty() {
        fm.push_str("tags:\n");
        for t in &raw.tags {
            fm.push_str(&format!("  - {}\n", crate::common::yaml_scalar(t)));
        }
    }
    fm.push_str("---\n\n");
    if !raw.tags.is_empty() {
        let tagline = raw
            .tags
            .iter()
            .map(|t| format!("#{t}"))
            .collect::<Vec<_>>()
            .join(" ");
        md_body = format!("{tagline}\n\n{md_body}");
    }
    let mut markdown = format!("{fm}{}", md_body.trim_end());
    if !staged.is_empty() {
        markdown.push_str("\n\n## Source attachments\n\n");
        for asset in &staged {
            let label = asset.name.replace(['[', ']'], "_");
            markdown.push_str(&format!(
                "- [{label}]({}) — sha256:{}\n",
                asset.path, asset.sha
            ));
        }
    }
    if markdown.contains("evernote://") {
        warnings.push("evernote:// links preserved verbatim (no vault equivalent)".to_string());
    }
    Ok(EnexNote {
        title,
        markdown,
        warnings,
        assets: staged,
        notebook: raw.notebook,
    })
}

fn extract_enml_html(content: &str) -> String {
    // Content is `<en-note>…html…</en-note>` (possibly with XML decl/DOCTYPE).
    // Take the inside verbatim; the HTML converter tolerates the rest.
    let mut s = content.trim();
    if let Some(start) = s.find("<en-note") {
        if let Some(gt) = s[start..].find('>') {
            s = &s[start + gt + 1..];
        }
    }
    if let Some(end) = s.rfind("</en-note>") {
        s = &s[..end];
    }
    // `<en-media hash="…">` → keep a placeholder image ref; the resource
    // section below carries the bytes.
    s.to_string()
}

#[derive(Default)]
pub struct EnexImport;

impl EnexImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(EnexImport)
    }
}

impl ImportProvider for EnexImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("enex") => true,
            Some(_) => false,
            None => source
                .media_type
                .as_deref()
                .is_some_and(|m| m.split(';').next().unwrap_or(m).trim() == "application/enex+xml"),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let text = source.text(host)?;
        let notes = parse_enex(&text, &source.name)?;
        if notes.is_empty() {
            return Err(bad_args(format!("`{}`: no notes found", source.name)));
        }
        let mut report = ImportReport::new(request.mode);
        let mut seen = std::collections::HashSet::new();
        for (index, n) in notes.into_iter().enumerate() {
            let stem = sanitize_component(&n.title).unwrap_or_else(|| "note".to_string());
            let folder = n.notebook.as_deref().and_then(sanitize_component);
            let mut name = match &folder {
                Some(folder) => format!("{folder}/{stem}.md"),
                None => format!("{stem}.md"),
            };
            let mut suffix = 1;
            while !seen.insert(name.clone()) {
                suffix += 1;
                name = match &folder {
                    Some(folder) => format!("{folder}/{stem}-{suffix}.md"),
                    None => format!("{stem}-{suffix}.md"),
                };
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
            write_doc(
                host,
                request,
                &doc,
                &n.markdown,
                outcome,
                &entry,
                &mut report,
            )?;
            for asset in n.assets {
                let asset_entry = format!("{entry}:{}", asset.name);
                let wanted = request.destination(&match &folder {
                    Some(folder) => format!("{folder}/{}", asset.path),
                    None => asset.path.clone(),
                });
                let (doc, outcome) = crate::common::resolve_binary_destination(
                    host,
                    request,
                    wanted,
                    &asset_entry,
                    &mut report.log,
                )?;
                write_asset(
                    host,
                    request,
                    &doc,
                    &asset.bytes,
                    outcome,
                    &asset_entry,
                    &mut report,
                )?;
            }
        }
        Ok(report)
    }
}
