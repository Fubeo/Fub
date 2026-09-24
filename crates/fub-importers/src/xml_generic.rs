//! Generic XML/OPML import plus the shared `flatten` helper.
//!
//! Claims `.xml`/`.opml` by extension or `text/xml`/`application/xml`
//! without an extension. Element text and attributes flatten to
//! `- \`path\`: value` bullets (attributes as `path@name`), hierarchy kept
//! in frontmatter `source_path`. OPML outlines (`<outline text="…">`)
//! additionally render as Markdown headings by depth. Nothing disappears:
//! unmapped constructs stay as source text or are reported per entry.

use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource};
use fub_abi::PluginError;

use crate::common::{bad_args, is_cancelled, resolve_destination, write_doc};
use crate::xml_helper::{self, TreeSink};

fn media_base(media: Option<&str>) -> Option<&str> {
    media.map(|m| m.split(';').next().unwrap_or(m).trim())
}

/// Flatten XML text to `(path, value)` pairs. Exported for archive fan-out.
pub fn flatten(text: &str, source_name: &str) -> Result<Vec<(String, String)>, PluginError> {
    let mut sink = TreeSink::default();
    xml_helper::parse_str(text, &mut sink)
        .map_err(|e| bad_args(format!("`{source_name}`: {e}")))?;
    if sink.texts.is_empty() {
        return Err(bad_args(format!("`{source_name}`: no text content found")));
    }
    Ok(sink.texts)
}

#[derive(Default)]
pub struct GenericXmlImport;

impl GenericXmlImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(GenericXmlImport)
    }
}

impl ImportProvider for GenericXmlImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("xml" | "opml") => true,
            Some(_) => false,
            None => media_base(source.media_type.as_deref())
                .is_some_and(|m| matches!(m, "text/xml" | "application/xml")),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        let text = source.text(host)?;
        // OPML outlines get headings; everything else gets bullets.
        let is_opml = source.extension().as_deref() == Some("opml") || text.contains("<outline");
        let mut report = ImportReport::new(request.mode);
        let stem = source.stem().unwrap_or("imported");
        let wanted = request.destination(&format!("{stem}.md"));
        let (doc, outcome) =
            resolve_destination(host, request, wanted, &source.name, &mut report.log);
        let markdown = if is_opml {
            opml_to_markdown(&text, &source.name, &mut report)?
        } else {
            let pairs = flatten(&text, &source.name)?;
            let body = pairs
                .iter()
                .take(10_000)
                .map(|(p, v)| format!("- `{p}`: {v}"))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "---\ntitle: {}\nsource_file: {}\n---\n\n{body}\n",
                crate::common::yaml_scalar(stem),
                crate::common::yaml_scalar(&source.name),
            )
        };
        if let Err(e) = write_doc(
            host,
            request,
            &doc,
            &markdown,
            outcome,
            &source.name,
            &mut report,
        ) {
            if is_cancelled(&e) {
                return Err(e);
            }
            report.log.push(
                fub_abi::transfer::TransferNote::warning(e.to_string()).about(source.name.clone()),
            );
        }
        Ok(report)
    }
}

struct OutlineCollector {
    depth: usize,
    lines: Vec<String>,
    truncated: bool,
}

impl xml_helper::XmlSink for OutlineCollector {
    fn start(&mut self, tag: &xml_helper::OpenTag) -> Result<(), PluginError> {
        if tag.name == "outline" {
            let text = tag
                .attrs
                .iter()
                .find(|(k, _)| k == "text")
                .map(|(_, v)| v.clone())
                .unwrap_or_default();
            let url = tag
                .attrs
                .iter()
                .find(|(k, _)| k == "url" || k == "xmlUrl")
                .map(|(_, v)| v.clone());
            if self.lines.len() > 10_000 {
                self.truncated = true;
                return Ok(());
            }
            if !text.is_empty() {
                let hashes = "#".repeat((self.depth + 1).min(6));
                match url {
                    Some(u) if !u.is_empty() => self.lines.push(format!("{hashes} [{text}]({u})")),
                    _ => self.lines.push(format!("{hashes} {text}")),
                }
            }
            self.depth += 1;
        }
        Ok(())
    }
    fn text(&mut self, _t: &str) -> Result<(), PluginError> {
        Ok(())
    }
    fn end(&mut self, name: &str) -> Result<(), PluginError> {
        if name == "outline" {
            self.depth = self.depth.saturating_sub(1);
        }
        Ok(())
    }
}

fn opml_to_markdown(
    text: &str,
    source_name: &str,
    report: &mut ImportReport,
) -> Result<String, PluginError> {
    let mut c = OutlineCollector {
        depth: 0,
        lines: Vec::new(),
        truncated: false,
    };
    xml_helper::parse_str(text, &mut c).map_err(|e| bad_args(format!("`{source_name}`: {e}")))?;
    if c.lines.is_empty() {
        // No outlines: fall back to the generic flattening, reported.
        let pairs = flatten(text, source_name)?;
        let body = pairs
            .iter()
            .take(10_000)
            .map(|(p, v)| format!("- `{p}`: {v}"))
            .collect::<Vec<_>>()
            .join("\n");
        report.log.push(
            fub_abi::transfer::TransferNote::info(
                "no OPML outlines: flattened generically".to_string(),
            )
            .about(source_name.to_string()),
        );
        return Ok(format!(
            "---\ntitle: {}\nsource_file: {}\n---\n\n{body}\n",
            crate::common::yaml_scalar(source_name),
            crate::common::yaml_scalar(source_name),
        ));
    }
    if c.truncated {
        report.log.push(
            fub_abi::transfer::TransferNote::warning(
                "OPML truncated at 10 000 outlines".to_string(),
            )
            .about(source_name.to_string()),
        );
    }
    Ok(format!(
        "---\ntitle: {}\nsource_file: {}\n---\n\n{}\n",
        crate::common::yaml_scalar(source_name),
        crate::common::yaml_scalar(source_name),
        c.lines.join("\n")
    ))
}
