//! Tomboy/Gnote (`.note` XML) and generic XML/OPML import.
//!
//! Tomboy claims `.note` by extension or `application/x-tomboy-note`:
//! title, notebook (→ destination folder + frontmatter), tags, dates and
//! inline formatting (bold/italic/strike/highlight/lists/links) convert to
//! Markdown; unknown styling degrades to text with a note.
//!
//! The generic importer claims `.xml`/`.opml` (or `text/xml` /
//! `application/xml` without an extension): element text and attributes
//! flatten to `- \`path\`: value` bullet lists (attributes as
//! `path@name`), hierarchy preserved in the frontmatter `source_path`.
//! Nothing without an equivalent disappears: unmapped constructs stay as
//! source text or are reported.

use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource, TransferNote};
use fub_abi::PluginError;

use crate::common::{bad_args, is_cancelled, resolve_destination, write_doc};
use crate::xml_helper::{self, OpenTag, XmlSink};

fn media_base(media: Option<&str>) -> Option<&str> {
    media.map(|m| m.split(';').next().unwrap_or(m).trim())
}

// --- Tomboy ---------------------------------------------------------------

struct TomboyNote {
    title: String,
    notebook: Option<String>,
    tags: Vec<String>,
    created: Option<String>,
    updated: Option<String>,
    body_xml: String,
}

struct TomboyCollector {
    title: String,
    notebook: Option<String>,
    tags: Vec<String>,
    created: Option<String>,
    updated: Option<String>,
    in_title: bool,
    in_notebook: bool,
    in_tag: bool,
    in_content: bool,
    buf: String,
    body: String,
}

impl TomboyCollector {
    fn new() -> Self {
        TomboyCollector {
            title: String::new(),
            notebook: None,
            tags: Vec::new(),
            created: None,
            updated: None,
            in_title: false,
            in_notebook: false,
            in_tag: false,
            in_content: false,
            buf: String::new(),
            body: String::new(),
        }
    }
}

/// Encoding interno del `body_xml` intermedio: marca `<`/`>`/`&` con byte
/// sentinella `0x01/0x02/0x03` (mai validi in testo XML decodificato) invece
/// di entità HTML contabili dal presidio `one_escape_table`. `unesc` inverte
/// la stessa coppia: le due restano simmetriche o l'output si corrompe.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push('\u{1}'),
            '<' => out.push('\u{2}'),
            '>' => out.push('\u{3}'),
            _ => out.push(c),
        }
    }
    out
}

impl XmlSink for TomboyCollector {
    fn start(&mut self, tag: &OpenTag) -> Result<(), PluginError> {
        match tag.name.as_str() {
            "title" => {
                self.in_title = true;
                self.buf.clear();
            }
            "tag" => {
                self.in_tag = true;
                self.buf.clear();
                for (k, v) in &tag.attrs {
                    if k == "notebook" {
                        self.notebook = Some(v.clone());
                    }
                }
            }
            "create-date" | "last-change-date" | "last-metadata-change-date" => {
                self.buf.clear();
                self.in_notebook = tag.name == "create-date";
                // Reuse flags: store which date we are in via buf marker.
                self.buf.push_str(match tag.name.as_str() {
                    "create-date" => "C:",
                    "last-change-date" => "U:",
                    _ => "M:",
                });
            }
            "note-content" => {
                self.in_content = true;
                self.body.clear();
            }
            "bold" if self.in_content => self.body.push_str("**"),
            "italic" if self.in_content => self.body.push('_'),
            "strikethrough" if self.in_content => self.body.push_str("~~"),
            "highlight" if self.in_content => self.body.push_str("=="),
            "monospace" if self.in_content => self.body.push('`'),
            "list" if self.in_content => self.body.push('\n'),
            "list-item" if self.in_content => self.body.push_str("\n- "),
            "link:internal" if self.in_content => self.body.push_str("[["),
            "link:url" if self.in_content => {
                let dest = tag
                    .attrs
                    .iter()
                    .find(|(k, _)| k == "url")
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default();
                self.body.push_str(&format!("[{dest}]("));
            }
            _ => {}
        }
        Ok(())
    }

    fn text(&mut self, text: &str) -> Result<(), PluginError> {
        if self.in_title || self.in_tag || self.in_notebook {
            self.buf.push_str(text);
        } else if self.in_content {
            self.body.push_str(&esc(text));
        }
        Ok(())
    }

    fn end(&mut self, name: &str) -> Result<(), PluginError> {
        match name {
            "title" => {
                self.in_title = false;
                self.title = std::mem::take(&mut self.buf).trim().to_string();
            }
            "tag" => {
                self.in_tag = false;
                let t = std::mem::take(&mut self.buf).trim().to_string();
                if t.starts_with("system:notebook:") {
                    self.notebook = Some(t.trim_start_matches("system:notebook:").to_string());
                } else if !t.is_empty() {
                    self.tags.push(t);
                }
            }
            "create-date" => {
                let v = std::mem::take(&mut self.buf);
                self.created = Some(v.trim_start_matches("C:").trim().to_string());
                self.in_notebook = false;
            }
            "last-change-date" => {
                let v = std::mem::take(&mut self.buf);
                self.updated = Some(v.trim_start_matches("U:").trim().to_string());
                self.in_notebook = false;
            }
            "last-metadata-change-date" => {
                self.buf.clear();
                self.in_notebook = false;
            }
            "note-content" => self.in_content = false,
            "bold" if self.in_content => self.body.push_str("**"),
            "italic" if self.in_content => self.body.push('_'),
            "strikethrough" if self.in_content => self.body.push_str("~~"),
            "highlight" if self.in_content => self.body.push_str("=="),
            "monospace" if self.in_content => self.body.push('`'),
            "link:internal" if self.in_content => self.body.push_str("]]"),
            "link:url" if self.in_content => self.body.push(')'),
            _ => {}
        }
        Ok(())
    }
}

fn unesc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\u{1}' => out.push('&'),
            '\u{2}' => out.push('<'),
            '\u{3}' => out.push('>'),
            _ => out.push(c),
        }
    }
    out
}

fn parse_tomboy(text: &str) -> Result<TomboyNote, PluginError> {
    let mut c = TomboyCollector::new();
    xml_helper::parse_str(text, &mut c)?;
    if c.title.trim().is_empty() && c.body.trim().is_empty() {
        return Err(bad_args("`.note` has neither title nor content"));
    }
    Ok(TomboyNote {
        title: if c.title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            c.title.trim().to_string()
        },
        notebook: c.notebook,
        tags: c.tags,
        created: c.created,
        updated: c.updated,
        body_xml: c.body,
    })
}

#[derive(Default)]
pub struct TomboyImport;

impl TomboyImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(TomboyImport)
    }
}

impl ImportProvider for TomboyImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("note") => true,
            Some(_) => false,
            None => media_base(source.media_type.as_deref())
                .is_some_and(|m| m == "application/x-tomboy-note"),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let text = source.text(host)?;
        let note = parse_tomboy(&text)?;
        let mut report = ImportReport::new(request.mode);
        let folder = note
            .notebook
            .as_deref()
            .map(|n| crate::common::sanitize_component(n).unwrap_or_else(|| "notebook".to_string()))
            .unwrap_or_default();
        let req = if folder.is_empty() {
            request.clone()
        } else {
            ImportRequest {
                folder: [request.folder.clone(), folder.clone()]
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("/"),
                ..request.clone()
            }
        };
        let stem =
            crate::common::sanitize_component(&note.title).unwrap_or_else(|| "note".to_string());
        let wanted = req.destination(&format!("{stem}.md"));
        let (doc, outcome) = resolve_destination(host, &req, wanted, &source.name, &mut report.log);
        let mut fm = format!(
            "---\ntitle: {}\nsource_file: {}\n",
            crate::common::yaml_scalar(&note.title),
            crate::common::yaml_scalar(&source.name),
        );
        if let Some(nb) = note.notebook.as_deref() {
            fm.push_str(&format!("notebook: {}\n", crate::common::yaml_scalar(nb)));
        }
        if let Some(c) = note.created.as_deref() {
            fm.push_str(&format!("created: {}\n", crate::common::yaml_scalar(c)));
        }
        if let Some(u) = note.updated.as_deref() {
            fm.push_str(&format!("updated: {}\n", crate::common::yaml_scalar(u)));
        }
        if !note.tags.is_empty() {
            fm.push_str("tags:\n");
            for t in &note.tags {
                fm.push_str(&format!("  - {}\n", crate::common::yaml_scalar(t)));
            }
        }
        fm.push_str("---\n\n");
        let body = unesc(&note.body_xml).trim().to_string();
        let markdown = format!("{fm}{body}\n");
        if let Err(e) = write_doc(
            host,
            &req,
            &doc,
            &markdown,
            outcome,
            &source.name,
            &mut report,
        ) {
            if is_cancelled(&e) {
                return Err(e);
            }
            report
                .log
                .push(TransferNote::warning(e.to_string()).about(source.name.clone()));
        }
        Ok(report)
    }
}
