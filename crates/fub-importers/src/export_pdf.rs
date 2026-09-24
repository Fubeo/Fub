//! Static, dependency-free PDF projection of Markdown source.
//! Dynamic views, formulas and diagrams are not rendered as live output:
//! the report makes this limitation explicit instead of claiming a faithful
//! print projection. The shell print path uses RenderTarget::Print separately.

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
                match host.read_document(doc) {
                    Ok(source) => {
                        if source.len() > 32 * 1024 * 1024 {
                            return Err(bad_args(format!(
                                "`{doc}` exceeds the 32 MiB PDF input limit"
                            )));
                        }
                        total_bytes += source.len();
                        if total_bytes > 32 * 1024 * 1024 {
                            return Err(bad_args("single PDF exceeds 32 MiB of source text; export in separate files"));
                        }
                        warn_unrenderable(&source, doc.as_str(), &mut report);
                        let lines =
                            markdown_to_lines(&source, doc.as_str(), with_meta, &mut report);
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
                    "`{doc}` exceeds the 32 MiB PDF input limit"
                )));
            }
            warn_unrenderable(&source, doc.as_str(), &mut report);
            let lines = markdown_to_lines(&source, doc.as_str(), with_meta, &mut report);
            ensure_page_budget(std::slice::from_ref(&lines))?;
            let pdf = render_pdf(&[lines]);
            let path = format!("{}.pdf", doc.as_str().trim_end_matches(".md"));
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
        "static source-text PDF only: dynamic views, queries, embeds, diagrams and formulas are not rendered; use the print-target renderer for faithful output".to_string(),
    )
    .about("importers.pdf".to_string())
}

/// Markdown source → printable text lines (one string per visual line).
fn markdown_to_lines(
    source: &str,
    doc: &str,
    with_meta: bool,
    report: &mut ExportReport,
) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    lines.push(doc.trim_end_matches(".md").replace('/', " / "));
    lines.push(String::new());
    let mut in_fence = false;
    let mut in_frontmatter = false;
    let mut first = true;
    for raw in source.lines() {
        if first && (raw == "---") {
            in_frontmatter = true;
            first = false;
            continue;
        }
        first = false;
        if in_frontmatter {
            if raw == "---" || raw == "..." {
                in_frontmatter = false;
                if !with_meta {
                    continue;
                }
            }
            if with_meta {
                lines.push(format!("  {raw}"));
            }
            continue;
        }
        if raw.trim_start().starts_with("```") {
            in_fence = !in_fence;
            lines.push("  ---".to_string());
            continue;
        }
        if in_fence {
            lines.push(format!("  {raw}"));
            continue;
        }
        let t = raw.trim();
        if t.is_empty() {
            lines.push(String::new());
            continue;
        }
        if let Some(h) = t.strip_prefix("######") {
            lines.push(h.trim().to_uppercase());
        } else if let Some(h) = t.strip_prefix("#####") {
            lines.push(h.trim().to_uppercase());
        } else if let Some(h) = t.strip_prefix("####") {
            lines.push(h.trim().to_uppercase());
        } else if let Some(h) = t.strip_prefix("###") {
            lines.push(h.trim().to_uppercase());
        } else if let Some(h) = t.strip_prefix("##") {
            lines.push(h.trim().to_uppercase());
        } else if let Some(h) = t.strip_prefix("# ") {
            lines.push(h.trim().to_uppercase());
        } else if let Some(b) = t.strip_prefix("- [ ]") {
            lines.push(format!("[ ]{b}"));
        } else if let Some(b) = t.strip_prefix("- [x]") {
            lines.push(format!("[x]{b}"));
        } else if let Some(b) = t.strip_prefix("- ") {
            lines.push(format!("- {b}"));
        } else if t.starts_with("|") {
            lines.push(t.to_string());
        } else if t == "---" {
            lines.push("  ---".to_string());
        } else {
            // Inline cleanup: keep link destinations visible, images as
            // placeholders, strip emphasis markers.
            let mut s = t.to_string();
            // Keep image destinations visible; malformed image syntax remains
            // source text rather than entering an unbounded replacement loop.
            loop {
                let Some(bang) = s.find("![") else { break };
                let Some(cb) = s[bang + 2..].find(']') else {
                    break;
                };
                let alt_end = bang + 2 + cb;
                let rest = &s[alt_end + 1..];
                let Some(dest) = rest.strip_prefix('(') else {
                    break;
                };
                let Some(close) = dest.find(')') else { break };
                let alt = &s[bang + 2..alt_end];
                let url = &dest[..close];
                s = format!("{}[image: {alt} ({url})]{}", &s[..bang], &dest[close + 1..]);
                if s.matches("[image: ").count() > 8 {
                    break;
                }
            }
            // `[text](url)` → `text [url]`.
            loop {
                let Some(ob) = s.find('[') else { break };
                if s[..ob].ends_with("[image: ") {
                    break;
                }
                let Some(cb) = s[ob..].find(']') else { break };
                let text = s[ob + 1..ob + cb].to_string();
                let rest = &s[ob + cb + 1..];
                if rest.starts_with('(') {
                    if let Some(cp) = rest.find(')') {
                        let url = rest[1..cp].to_string();
                        s = format!("{}{text} [{url}]{}", &s[..ob], &rest[cp + 1..]);
                        continue;
                    }
                }
                break;
            }
            s = s.replace("**", "").replace("~~", "");
            if s.contains("![[") {
                report.log.push(
                    TransferNote::info("embeds render as their link text in PDF".to_string())
                        .about(doc.to_string()),
                );
            }
            for chunk in wrap(&s, 96) {
                lines.push(chunk);
            }
        }
    }
    lines
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

fn warn_unrenderable(source: &str, doc: &str, report: &mut ExportReport) {
    if source.chars().any(|c| {
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
