//! Static, dependency-free PDF projection of the document model.
//! Dynamic views, formulas and diagrams are not rendered as live output:
//! the report makes this limitation explicit instead of claiming a faithful
//! print projection. The shell print path uses RenderTarget::Print separately.

use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget};
use fub_abi::rules::path::strip_ext;
use fub_abi::traits::ReadApi;
use fub_abi::transfer::{
    ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportTarget, TransferNote,
};
use fub_abi::PluginError;

use crate::common::bad_args;

pub const TARGET_PDF: &str = "importers.pdf";
pub const TARGET_PDF_SINGLE: &str = "importers.pdf.single";

#[derive(Default)]
pub struct PdfExport;

impl PdfExport {
    pub fn boxed() -> Box<dyn ExportProvider> {
        Box::new(PdfExport)
    }
}

impl ExportProvider for PdfExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![
            ExportTarget {
                id: TARGET_PDF.to_string(),
                name: "PDF (one file per note, static)".to_string(),
                extension: None,
            },
            ExportTarget {
                id: TARGET_PDF_SINGLE.to_string(),
                name: "PDF (selection in one static file)".to_string(),
                extension: Some("pdf".to_string()),
            },
        ]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        if request.target != TARGET_PDF && request.target != TARGET_PDF_SINGLE {
            return Err(bad_args(format!(
                "`{}` is not a destination of this provider",
                request.target
            )));
        }
        let with_meta = request
            .options
            .get("with_meta")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let docs = request.selection.resolve(host)?;
        if docs.is_empty() {
            return Err(bad_args("nothing selected: the PDF would be empty"));
        }
        if docs.len() > 4096 {
            return Err(bad_args(
                "PDF exceeds 4096 documents: select a smaller batch",
            ));
        }
        let mut report = ExportReport::default();
        if request.target == TARGET_PDF_SINGLE {
            let mut total_bytes = 0usize;
            let mut pages: Vec<Vec<String>> = Vec::new();
            for doc in &docs {
                match host.read_model(doc) {
                    Ok(model) => {
                        if model.text.len() > 32 * 1024 * 1024 {
                            return Err(bad_args(format!(
                                "`{doc}` exceeds the 32 MiB PDF input limit"
                            )));
                        }
                        total_bytes += model.text.len();
                        if total_bytes > 32 * 1024 * 1024 {
                            return Err(bad_args("single PDF exceeds 32 MiB of source text; export in separate files"));
                        }
                        let lines = model_to_lines(&model, doc.as_str(), with_meta, &mut report);
                        warn_unrenderable(&lines, doc.as_str(), &mut report);
                        pages.push(lines);
                    }
                    Err(e) => report
                        .log
                        .push(TransferNote::warning(e.to_string()).about(doc.to_string())),
                }
            }
            if pages.is_empty() {
                return Err(bad_args(
                    "none of the selected documents could be read as PDF input",
                ));
            }
            ensure_page_budget(&pages)?;
            let pdf = render_pdf(&pages);
            let h = out.open_artifact("export.pdf", "application/pdf")?;
            // Chunked writes: the sink sees a stream, not a buffer.
            for chunk in pdf.chunks(64 * 1024) {
                out.write_artifact(h, chunk)?;
            }
            report.artifacts.push(out.close_artifact(h)?);
            report.log.push(static_note());
            return Ok(report);
        }
        let mut index: Vec<String> = Vec::new();
        for doc in &docs {
            let model = match host.read_model(doc) {
                Ok(model) => model,
                Err(e) => {
                    report
                        .log
                        .push(TransferNote::warning(e.to_string()).about(doc.to_string()));
                    continue;
                }
            };
            if model.text.len() > 32 * 1024 * 1024 {
                return Err(bad_args(format!(
                    "`{doc}` exceeds the 32 MiB PDF input limit"
                )));
            }
            let lines = model_to_lines(&model, doc.as_str(), with_meta, &mut report);
            warn_unrenderable(&lines, doc.as_str(), &mut report);
            ensure_page_budget(std::slice::from_ref(&lines))?;
            let pdf = render_pdf(&[lines]);
            let path = format!("{}.pdf", strip_ext(doc.as_str()));
            let h = out.open_artifact(&path, "application/pdf")?;
            for chunk in pdf.chunks(64 * 1024) {
                out.write_artifact(h, chunk)?;
            }
            report.artifacts.push(out.close_artifact(h)?);
            index.push(path);
        }
        if index.is_empty() {
            return Err(bad_args(
                "none of the selected documents could be read as PDF input",
            ));
        }
        // Index manifest as a final PDF page-list (plain text artifact).
        let listing = index.join("\n");
        let h = out.open_artifact("index.txt", "text/plain")?;
        out.write_artifact(h, listing.as_bytes())?;
        report.artifacts.push(out.close_artifact(h)?);
        report.log.push(static_note());
        Ok(report)
    }
}

fn static_note() -> TransferNote {
    TransferNote::warning(
        "static text PDF only: dynamic views, queries, embeds, diagrams and formulas are not rendered; use the print-target renderer for faithful output".to_string(),
    )
    .about("importers.pdf".to_string())
}

/// Document model → printable text lines (one string per visual line).
///
/// The format provider has already read the source: frontmatter, fences,
/// headings and links come from the model, so a document in any registered
/// format prints the same way and no Markdown is parsed here.
fn model_to_lines(
    model: &DocumentModel,
    doc: &str,
    with_meta: bool,
    report: &mut ExportReport,
) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    lines.push(strip_ext(doc).replace('/', " / "));
    lines.push(String::new());
    if with_meta && !model.frontmatter.is_empty() {
        for (key, value) in &model.frontmatter.0 {
            let value = match value {
                serde_json::Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            lines.push(format!("  {key}: {value}"));
        }
        lines.push(String::new());
    }
    let mut printer = Printer {
        lines,
        doc,
        report,
        embeds_noted: false,
    };
    printer.blocks(&model.body, "");
    printer.lines
}

struct Printer<'a> {
    lines: Vec<String>,
    doc: &'a str,
    report: &'a mut ExportReport,
    embeds_noted: bool,
}

impl Printer<'_> {
    fn blocks(&mut self, blocks: &[Block], indent: &str) {
        for block in blocks {
            self.block(block, indent);
        }
    }

    fn block(&mut self, block: &Block, indent: &str) {
        match block {
            Block::Heading { inlines, .. } => {
                let title = self.inlines(inlines).to_uppercase();
                self.lines.push(format!("{indent}{title}"));
            }
            Block::Paragraph { inlines, .. } => {
                let text = self.inlines(inlines);
                self.wrapped(&text, indent);
                self.lines.push(String::new());
            }
            Block::List {
                ordered,
                items,
                start,
                ..
            } => {
                let first = start.unwrap_or(1);
                for (at, item) in items.iter().enumerate() {
                    let marker = match (&item.task, ordered) {
                        (Some(task), _) if task.symbol.is_some() => "[x] ".to_string(),
                        (Some(_), _) => "[ ] ".to_string(),
                        (None, true) => format!("{}. ", first as usize + at),
                        (None, false) => "- ".to_string(),
                    };
                    let nested = format!("{indent}  ");
                    let mut blocks = item.blocks.iter();
                    match blocks.next() {
                        Some(Block::Paragraph { inlines, .. }) => {
                            let text = self.inlines(inlines);
                            self.wrapped(&format!("{marker}{text}"), indent);
                        }
                        Some(other) => {
                            self.lines.push(format!("{indent}{}", marker.trim_end()));
                            self.block(other, &nested);
                        }
                        None => self.lines.push(format!("{indent}{}", marker.trim_end())),
                    }
                    for block in blocks {
                        self.block(block, &nested);
                    }
                }
                self.lines.push(String::new());
            }
            Block::CodeBlock { code, .. } => {
                self.lines.push(format!("{indent}  ---"));
                for line in code.lines() {
                    self.lines.push(format!("{indent}  {line}"));
                }
                self.lines.push(format!("{indent}  ---"));
            }
            Block::Quote { blocks, .. } => {
                self.blocks(blocks, &format!("{indent}> "));
            }
            Block::ThematicBreak { .. } => self.lines.push(format!("{indent}  ---")),
            Block::Custom { blocks, .. } => self.blocks(blocks, indent),
            Block::Table { head, rows, .. } => {
                for row in head.iter().chain(rows) {
                    let cells: Vec<String> = row
                        .cells
                        .iter()
                        .map(|cell| self.inlines(&cell.inlines))
                        .collect();
                    self.lines
                        .push(format!("{indent}| {} |", cells.join(" | ")));
                }
                self.lines.push(String::new());
            }
            // Where a reference link points is already printed with the link.
            Block::ReferenceDefinition { .. } => {}
        }
    }

    fn wrapped(&mut self, text: &str, indent: &str) {
        for chunk in wrap(text, 96usize.saturating_sub(indent.chars().count()).max(24)) {
            self.lines.push(format!("{indent}{chunk}"));
        }
    }

    fn inlines(&mut self, inlines: &[Inline]) -> String {
        let mut out = String::new();
        for inline in inlines {
            self.inline(inline, &mut out);
        }
        out
    }

    fn inline(&mut self, inline: &Inline, out: &mut String) {
        match inline {
            Inline::Text(text) | Inline::Code(text) => out.push_str(text),
            Inline::Emph(children)
            | Inline::Strong(children)
            | Inline::Superscript(children)
            | Inline::Strikethrough(children) => {
                for child in children {
                    self.inline(child, out);
                }
            }
            Inline::Link {
                target,
                label,
                embed,
                ..
            } => {
                let label = label
                    .as_deref()
                    .map(|label| self.inlines(label))
                    .filter(|label| !label.is_empty());
                match target {
                    LinkTarget::Wiki { page, heading, .. } => {
                        if *embed && !self.embeds_noted {
                            self.embeds_noted = true;
                            self.report.log.push(
                                TransferNote::info(
                                    "embeds render as their link text in PDF".to_string(),
                                )
                                .about(self.doc.to_string()),
                            );
                        }
                        let named = match heading {
                            Some(heading) => format!("{page}#{heading}"),
                            None => page.clone(),
                        };
                        out.push_str(label.as_deref().unwrap_or(&named));
                    }
                    LinkTarget::Url(dest) | LinkTarget::Path(dest) if *embed => {
                        let alt = label.unwrap_or_default();
                        out.push_str(&format!("[image: {alt} ({dest})]"));
                    }
                    LinkTarget::Url(dest) | LinkTarget::Path(dest) => match label {
                        Some(text) if text != *dest => out.push_str(&format!("{text} [{dest}]")),
                        _ => out.push_str(dest),
                    },
                }
            }
            Inline::TagRef { name, .. } => {
                out.push('#');
                out.push_str(name);
            }
            Inline::Custom { attrs, .. } => {
                if let Some(label) = attrs.get("label").and_then(serde_json::Value::as_str) {
                    out.push_str(&format!("[{label}]"));
                }
            }
            Inline::HardBreak | Inline::SoftBreak => out.push(' '),
        }
    }
}

fn wrap(s: &str, width: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in s.split_whitespace() {
        if cur.chars().count() + word.chars().count() + 1 > width && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Bound total page count before constructing PDF objects. This is stricter
/// than the per-source byte cap when a document contains many short lines.
fn ensure_page_budget(docs: &[Vec<String>]) -> Result<(), PluginError> {
    let mut lines = 0usize;
    for doc in docs {
        for line in doc {
            lines = lines.saturating_add(wrap(line, 96).len());
            if lines > 46 * 4096 {
                return Err(bad_args(
                    "PDF exceeds 4096 pages; export in smaller batches",
                ));
            }
        }
    }
    Ok(())
}

/// Minimal PDF writer: one Helvetica page per `pages[i]` (46 lines/page).
fn render_pdf(pages_lines: &[Vec<String>]) -> Vec<u8> {
    // Paginate.
    let mut pages: Vec<Vec<String>> = Vec::new();
    for doc in pages_lines {
        let mut cur: Vec<String> = Vec::new();
        for line in doc.iter().flat_map(|l| wrap(l, 96)) {
            cur.push(line);
            if cur.len() >= 46 {
                pages.push(std::mem::take(&mut cur));
            }
        }
        if !cur.is_empty() || pages.is_empty() {
            pages.push(cur);
        }
    }
    // Objects: 1 catalog, 2 pages, 3 font, then (content, page) pairs.
    let mut objs: Vec<Vec<u8>> = Vec::new();
    let font_obj = 3usize;
    let mut page_objs: Vec<usize> = Vec::new();
    let mut content_objs: Vec<Vec<u8>> = Vec::new();
    for page in &pages {
        let mut text = String::from("BT /F1 11 Tf 50 800 Td 13 TL ");
        for line in page {
            text.push_str(&format!("({}) Tj T* ", pdf_escape(line)));
        }
        text.push_str("ET");
        let stream = format!(
            "<< /Length {} >>\nstream\n{text}\nendstream",
            text.len() + 1
        );
        content_objs.push(stream.into_bytes());
        page_objs.push(0); // filled below
    }
    // Numbering: obj1 catalog, obj2 pages, obj3 font, then content+page pairs.
    let mut next = 4usize;
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for _ in &pages {
        let c = next;
        next += 1;
        let p = next;
        next += 1;
        pairs.push((c, p));
    }
    for (i, p) in page_objs.iter_mut().enumerate() {
        *p = pairs[i].1;
    }
    let kids = pairs
        .iter()
        .map(|(_, p)| format!("{p} 0 R"))
        .collect::<Vec<_>>()
        .join(" ");
    objs.push("<< /Type /Catalog /Pages 2 0 R >>".to_string().into_bytes()); // 1
    objs.push(format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", pages.len()).into_bytes()); // 2
    objs.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    ); // 3
    assert_eq!(font_obj, 3);
    let mut ordered: Vec<(usize, Vec<u8>)> = Vec::new();
    ordered.push((1, objs[0].clone()));
    ordered.push((2, objs[1].clone()));
    ordered.push((3, objs[2].clone()));
    for (i, content) in content_objs.into_iter().enumerate() {
        let (c, p) = pairs[i];
        ordered.push((c, content));
        let page = format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {c} 0 R >>");
        ordered.push((p, page.into_bytes()));
    }
    ordered.sort_by_key(|(n, _)| *n);
    let mut pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets: Vec<usize> = vec![0];
    for (n, body) in &ordered {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{n} 0 obj\n").as_bytes());
        pdf.extend_from_slice(body);
        pdf.extend_from_slice(b"\nendobj\n");
        let _ = n;
    }
    let xref_at = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", ordered.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for off in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF",
            ordered.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

fn pdf_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let byte = match c {
            '\u{20ac}' => 0x80,
            '\u{201a}' => 0x82,
            '\u{0192}' => 0x83,
            '\u{201e}' => 0x84,
            '\u{2026}' => 0x85,
            '\u{2020}' => 0x86,
            '\u{2021}' => 0x87,
            '\u{02c6}' => 0x88,
            '\u{2030}' => 0x89,
            '\u{0160}' => 0x8a,
            '\u{2039}' => 0x8b,
            '\u{0152}' => 0x8c,
            '\u{017d}' => 0x8e,
            '\u{2018}' | '\u{2019}' => 0x92,
            '\u{201c}' | '\u{201d}' => 0x93,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{02dc}' => 0x98,
            '\u{2122}' => 0x99,
            '\u{0161}' => 0x9a,
            '\u{203a}' => 0x9b,
            '\u{0153}' => 0x9c,
            '\u{017e}' => 0x9e,
            '\u{0178}' => 0x9f,
            '\n' | '\r' => b' ',
            c if c as u32 <= 0xff => c as u8,
            _ => b'?',
        };
        match byte {
            b'\\' => out.push_str("\\\\"),
            b'(' => out.push_str("\\("),
            b')' => out.push_str("\\)"),
            b if !(32..127).contains(&b) => out.push_str(&format!("\\{b:03o}")),
            b => out.push(b as char),
        }
    }
    out
}

fn warn_unrenderable(lines: &[String], doc: &str, report: &mut ExportReport) {
    if lines.iter().flat_map(|line| line.chars()).any(|c| {
        c as u32 > 255
            && !matches!(
                c,
                '\u{20ac}'
                    | '\u{201a}'
                    | '\u{0192}'
                    | '\u{201e}'
                    | '\u{2026}'
                    | '\u{2020}'
                    | '\u{2021}'
                    | '\u{02c6}'
                    | '\u{2030}'
                    | '\u{0160}'
                    | '\u{2039}'
                    | '\u{0152}'
                    | '\u{017d}'
                    | '\u{2018}'
                    | '\u{2019}'
                    | '\u{201c}'
                    | '\u{201d}'
                    | '\u{2022}'
                    | '\u{2013}'
                    | '\u{2014}'
                    | '\u{02dc}'
                    | '\u{2122}'
                    | '\u{0161}'
                    | '\u{203a}'
                    | '\u{0153}'
                    | '\u{017e}'
                    | '\u{0178}'
            )
    }) {
        report.log.push(
            TransferNote::warning(
                "PDF built-in font cannot represent some glyphs; replaced with `?`",
            )
            .about(doc),
        );
    }
}
