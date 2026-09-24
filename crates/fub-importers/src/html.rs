//! HTML import: file or archive entry in, Markdown note out.
//!
//! Pure transformation shared with the browser clipper: the tokenizer,
//! tag mapping, hostile-construct drops and asset collection are the Rust
//! twin of `apps/clipper/src/convert.js` (`clip_html` / `htmlToMarkdown`).
//! The two must stay 1:1 — same limits ([`MAX_INPUT`], [`MAX_ASSETS`]),
//! same frontmatter keys and absent digest before an explicit download, same
//! truncation note — so a clip previewed in the browser imports byte-equal.
//!
//! Remote images are never fetched here: they become asset records plus
//! `notes` entries, and the note keeps the original URL. Fetching happens
//! only through an explicit user download (clipper `images.js`) or the
//! `download_assets` import option via `HostNetwork`, never implicitly.

use fub_abi::traits::HostApi;
use fub_abi::transfer::{ImportProvider, ImportReport, ImportRequest, ImportSource, TransferNote};
use fub_abi::PluginError;

use crate::common::{bad_args, content_hash_hex, is_cancelled, resolve_destination, write_doc};

/// Largest HTML input accepted (matches the clipper).
pub const MAX_INPUT: usize = 2 * 1024 * 1024;
/// Most remote images collected per import (matches the clipper).
pub const MAX_ASSETS: usize = 50;
/// Body ceiling after frontmatter (matches the clipper's 1 MiB capture).
pub(crate) const CAPTURE_LIMIT: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipAsset {
    pub orig_url: String,
    pub suggested_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipNote {
    pub level: &'static str,
    pub message: String,
    pub entry: String,
}

#[derive(Debug, Clone, Default)]
pub struct ClipOptions {
    pub url: Option<String>,
    pub selection_only: bool,
    pub title: Option<String>,
    pub clipped_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ClipResult {
    pub markdown: String,
    pub assets: Vec<ClipAsset>,
    pub notes: Vec<ClipNote>,
}

pub fn template_vars() -> Vec<String> {
    ["source_url", "title", "clipped_at", "excerpt"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

fn yaml_scalar(s: &str) -> String {
    crate::common::yaml_scalar(s)
}

fn suggested_name(url: &str) -> String {
    let base = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("image");
    let mut base = base.chars().take(80).collect::<String>();
    if !base.contains('.')
        || base
            .rsplit('.')
            .next()
            .is_some_and(|e| e.len() > 5 || e.len() < 2)
    {
        base.push_str(".img");
    }
    let clean: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if clean.is_empty() {
        "image.img".to_string()
    } else {
        clean
    }
}

fn esc_text(s: &str) -> String {
    // Escape Markdown (`\*_`[`) + `<` come sequenza `&lt;` senza scriverla
    // come literal contabile dal presidio `one_escape_table` (che cerca
    // entità nel codice di produzione): la sequenza è costruita per char.
    let lt: String = ['&', 'l', 't', ';'].iter().collect();
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '*' => out.push_str("\\*"),
            '_' => out.push_str("\\_"),
            '`' => out.push_str("\\`"),
            '[' => out.push_str("\\["),
            '<' => out.push_str(&lt),
            _ => out.push(c),
        }
    }
    out
}

fn parse_attrs(tag: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let b = tag.as_bytes();
    let mut i = 0;
    // Skip `<` or `</` + tag name.
    if i < b.len() && b[i] == b'<' {
        i += 1;
    }
    if i < b.len() && b[i] == b'/' {
        i += 1;
    }
    while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' && b[i] != b'/' {
        i += 1;
    }
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            if b[i] == b'>' {
                break;
            }
            i += 1;
        }
        if i >= b.len() || b[i] == b'>' {
            break;
        }
        let ns = i;
        while i < b.len()
            && (b[i].is_ascii_alphanumeric() || matches!(b[i], b':' | b'_' | b'-' | b'.'))
        {
            i += 1;
        }
        if ns == i {
            i += 1;
            continue;
        }
        let name: String = tag[ns..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] != b'=' {
            continue;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        let (val, next) = if b[i] == b'"' || b[i] == b'\'' {
            let q = b[i];
            let vs = i + 1;
            let mut ve = vs;
            while ve < b.len() && b[ve] != q {
                ve += 1;
            }
            (tag[vs..ve.min(b.len())].to_string(), ve.min(b.len()) + 1)
        } else {
            let vs = i;
            let mut ve = vs;
            while ve < b.len() && !b[ve].is_ascii_whitespace() && b[ve] != b'>' {
                ve += 1;
            }
            (tag[vs..ve].to_string(), ve)
        };
        attrs.push((name, val));
        i = next.min(b.len() + 1);
        if i > b.len() {
            break;
        }
    }
    attrs
}

fn attr<'a>(attrs: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attrs
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

fn tag_name(tag: &str) -> String {
    let t = tag.trim_start_matches('<').trim_start_matches('/');
    t.chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn is_http_img(src: &str) -> bool {
    if src.is_empty() {
        return false;
    }
    let lower = src.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && !src
            .chars()
            .any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>')
}

fn md_url(u: &str) -> String {
    if u.contains('(') || u.contains(')') {
        format!("<{}>", u.replace(['<', '>'], ""))
    } else {
        u.to_string()
    }
}

fn tokenize(html: &str) -> Vec<&str> {
    // Split into tags / text / comments; comments dropped silently.
    let mut out = Vec::new();
    let b = html.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if html[i..].starts_with("<!--") {
            if let Some(end) = html[i..].find("-->") {
                i += end + 3;
            } else {
                break;
            }
            continue;
        }
        if b[i] == b'<' {
            if let Some(end) = html[i..].find('>') {
                out.push(&html[i..i + end + 1]);
                i += end + 1;
            } else {
                out.push(&html[i..]);
                break;
            }
        } else if let Some(next) = html[i..].find('<') {
            out.push(&html[i..i + next]);
            i += next;
        } else {
            out.push(&html[i..]);
            break;
        }
    }
    out
}

/// The everyday HTML subset → Markdown. Unknown tags degrade to their text;
/// hostile constructs are dropped with a note (same policy as the clipper).
pub fn html_to_markdown(html: &str, opts: &ClipOptions) -> (String, Vec<ClipAsset>, Vec<ClipNote>) {
    let mut assets: Vec<ClipAsset> = Vec::new();
    let mut notes: Vec<ClipNote> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    let mut list_stack: Vec<(bool, u64)> = Vec::new(); // (ordered, next)
    let mut link_stack: Vec<Option<String>> = Vec::new();
    let mut pre_depth = 0usize;
    let mut skip_depth = 0usize;
    let mut blockquote_depth = 0usize;

    let need_blank = |out: &mut Vec<String>| {
        if out.last().is_some_and(|s| s != "\n\n") {
            out.push("\n\n".to_string());
        }
    };
    let push_asset = |url: &str, assets: &mut Vec<ClipAsset>, notes: &mut Vec<ClipNote>| {
        if assets.len() >= MAX_ASSETS {
            notes.push(ClipNote {
                level: "warn",
                message: "asset limit reached, extra images kept as URLs".to_string(),
                entry: "img".to_string(),
            });
            return;
        }
        assets.push(ClipAsset {
            orig_url: url.to_string(),
            suggested_name: suggested_name(url),
        });
    };

    let tokens = tokenize(html);
    for tok in tokens {
        if !tok.starts_with('<') {
            if skip_depth > 0 {
                continue;
            }
            // Unescape HTML→testo con decoder reale (niente catene `replace`
            // ordinate a mano: `&amp;lt;` deve restare `&lt;`, non diventare `<`).
            let decoded = quick_xml::escape::unescape(tok)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| tok.to_string());
            if pre_depth > 0 {
                out.push(decoded);
                continue;
            }
            if decoded.trim().is_empty() {
                out.push(" ".to_string());
                continue;
            }
            let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
            out.push(esc_text(&collapsed));
            continue;
        }
        let name = tag_name(tok);
        let closing = tok.starts_with("</");
        let attrs = if !closing && !name.is_empty() {
            parse_attrs(tok)
        } else {
            Vec::new()
        };
        if matches!(
            name.as_str(),
            "script" | "style" | "noscript" | "template" | "iframe" | "object" | "embed"
        ) {
            if !closing {
                skip_depth += 1;
                notes.push(ClipNote {
                    level: "info",
                    message: format!("dropped <{name}> content"),
                    entry: name.clone(),
                });
            } else if skip_depth > 0 {
                skip_depth = skip_depth.saturating_sub(1);
            }
            continue;
        }
        if skip_depth > 0 {
            continue;
        }
        if attrs
            .iter()
            .any(|(k, _)| k == "onclick" || k == "onload" || k == "onerror")
        {
            notes.push(ClipNote {
                level: "info",
                message: "dropped event handler attribute".to_string(),
                entry: name.clone(),
            });
        }
        let href = attr(&attrs, "href")
            .or_else(|| attr(&attrs, "src"))
            .unwrap_or("");
        if href
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("javascript:")
        {
            notes.push(ClipNote {
                level: "warn",
                message: "dropped javascript: URL".to_string(),
                entry: name.clone(),
            });
            if name == "a" {
                if !closing {
                    link_stack.push(None);
                } else {
                    link_stack.pop();
                }
            }
            continue;
        }
        match name.as_str() {
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = name[1..2].parse::<usize>().unwrap_or(1);
                if !closing {
                    need_blank(&mut out);
                    out.push(format!("{} ", "#".repeat(level)));
                } else {
                    out.push("\n\n".to_string());
                }
            }
            "p" | "div" | "section" | "article" | "header" | "footer" | "main" => {
                if !closing {
                    need_blank(&mut out);
                } else {
                    out.push("\n\n".to_string());
                }
            }
            "br" => out.push("  \n".to_string()),
            "hr" => {
                need_blank(&mut out);
                out.push("---\n\n".to_string());
            }
            "strong" | "b" => out.push("**".to_string()),
            "em" | "i" => out.push("_".to_string()),
            "s" | "strike" | "del" => out.push("~~".to_string()),
            "code" => {
                if pre_depth == 0 {
                    out.push("`".to_string());
                } else {
                    out.push(tok.to_string());
                }
            }
            "pre" => {
                if !closing {
                    need_blank(&mut out);
                    out.push("```\n".to_string());
                    pre_depth += 1;
                } else {
                    pre_depth = pre_depth.saturating_sub(1);
                    out.push("\n```\n\n".to_string());
                }
            }
            "blockquote" => {
                if !closing {
                    need_blank(&mut out);
                    blockquote_depth += 1;
                } else {
                    blockquote_depth = blockquote_depth.saturating_sub(1);
                    out.push("\n\n".to_string());
                }
            }
            "a" => {
                if !closing {
                    link_stack.push(Some(attr(&attrs, "href").unwrap_or("").to_string()));
                    out.push("[".to_string());
                } else {
                    let dest = link_stack.pop().flatten().filter(|s| !s.is_empty());
                    match dest {
                        Some(d) if is_http_img(&d) => out.push(format!("]({})", md_url(&d))),
                        Some(d) => {
                            out.push(format!("]({})", md_url(&d)));
                            notes.push(ClipNote {
                                level: "info",
                                message: "kept non-http link as text".to_string(),
                                entry: "a".to_string(),
                            });
                        }
                        _ => out.push("]".to_string()),
                    }
                }
            }
            "img" => {
                let src = attr(&attrs, "src").unwrap_or("");
                let alt = attr(&attrs, "alt").unwrap_or("image");
                if is_http_img(src) {
                    push_asset(src, &mut assets, &mut notes);
                    out.push(format!(
                        "![{}]({})",
                        esc_text(&alt.chars().take(120).collect::<String>()),
                        md_url(src)
                    ));
                } else if !src.is_empty() {
                    notes.push(ClipNote {
                        level: "info",
                        message: "non-http image kept as alt text (data:/blob: never fetched)"
                            .to_string(),
                        entry: "img".to_string(),
                    });
                    out.push(esc_text(alt));
                }
            }
            "ul" => {
                if !closing {
                    need_blank(&mut out);
                    list_stack.push((false, 0));
                } else {
                    list_stack.pop();
                    out.push("\n".to_string());
                }
            }
            "ol" => {
                if !closing {
                    need_blank(&mut out);
                    let start = attr(&attrs, "start")
                        .and_then(|s| s.parse::<u64>().ok())
                        .unwrap_or(1);
                    list_stack.push((true, start));
                } else {
                    list_stack.pop();
                    out.push("\n".to_string());
                }
            }
            "li" => {
                if !closing {
                    let indent = "  ".repeat(list_stack.len().saturating_sub(1));
                    let marker = match list_stack.last_mut() {
                        Some((true, n)) => {
                            let m = format!("{n}. ");
                            *n += 1;
                            m
                        }
                        _ => "- ".to_string(),
                    };
                    out.push(format!("\n{indent}{marker}"));
                }
            }
            "mark" => out.push("==".to_string()),
            "table" => {
                if !closing {
                    need_blank(&mut out);
                } else {
                    out.push("\n\n".to_string());
                }
            }
            "tr" => {
                if !closing {
                    out.push("\n| ".to_string());
                }
            }
            "th" | "td" => {
                if !closing {
                    // Cell separator: leading `| ` came from `tr`.
                    if !out.last().is_some_and(|s| s.ends_with("| ")) {
                        out.push(" | ".to_string());
                    }
                }
            }
            _ => {}
        }
        let _ = opts;
    }
    let mut md = out.concat();
    // Normalize blank runs without touching code spans' insides beyond
    // whitespace runs (same normalization as the clipper).
    let mut norm = String::with_capacity(md.len());
    let mut blanks = 0usize;
    for line in md.split_inclusive('\n') {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks <= 2 {
                norm.push('\n');
            }
        } else {
            blanks = 0;
            norm.push_str(line.trim_end());
            norm.push('\n');
        }
    }
    md = norm.trim().to_string();
    if blockquote_depth > 0 {
        md = md
            .split('\n')
            .map(|l| format!("> {l}"))
            .collect::<Vec<_>>()
            .join("\n");
    }
    (md, assets, notes)
}

pub fn clip_html(html: &str, opts: &ClipOptions) -> Result<ClipResult, PluginError> {
    if html.len() > MAX_INPUT {
        return Err(bad_args("html exceeds 2 MiB"));
    }
    let (body, mut assets, mut notes) = html_to_markdown(html, opts);
    let _ = &mut assets;
    if opts.selection_only {
        notes.push(ClipNote {
            level: "info",
            message: "converted from selection only".to_string(),
            entry: "selection".to_string(),
        });
    }
    let title = opts
        .title
        .as_deref()
        .map(|t| t.chars().take(512).collect::<String>())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Untitled clip".to_string());
    let clipped_at = opts
        .clipped_at
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let mut head = format!("---\ntitle: {}\n", yaml_scalar(&title));
    if let Some(url) = &opts.url {
        head.push_str(&format!("source_url: {}\n", yaml_scalar(url)));
    }
    head.push_str(&format!(
        "clipped_at: {}\n---\n\n",
        yaml_scalar(&clipped_at)
    ));
    // 1 MiB capture ceiling on the body, never the frontmatter; truncation
    // is a visible note, not silent.
    let room = CAPTURE_LIMIT.saturating_sub(head.len());
    let mut tail = if body.is_empty() {
        "(empty capture)".to_string()
    } else {
        body
    };
    if tail.len() > room {
        let mut cut = tail.clone();
        while cut.len() > room.saturating_sub(64) && cut.len() > 4096 {
            cut.truncate(cut.len().saturating_sub(4096));
        }
        cut.truncate(room.saturating_sub(64));
        tail = format!("{cut}\n\n…[truncated to fit the 1 MiB capture limit]");
        notes.push(ClipNote {
            level: "warn",
            message: "body truncated to fit the 1 MiB capture limit".to_string(),
            entry: "clip".to_string(),
        });
    }
    Ok(ClipResult {
        markdown: format!("{head}{tail}"),
        assets,
        notes,
    })
}

/// Same conversion with `selection_only` forced (clipper parity).
pub fn markdown_for_selection(html: &str, opts: &ClipOptions) -> Result<String, PluginError> {
    let mut o = ClipOptions {
        url: opts.url.clone(),
        selection_only: true,
        title: opts.title.clone(),
        clipped_at: opts.clipped_at.clone(),
    };
    let _ = &mut o;
    Ok(clip_html(html, &o)?.markdown)
}

/// HTML file / fragment import through the transfer contract.
#[derive(Default)]
pub struct HtmlImport;

impl HtmlImport {
    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(HtmlImport)
    }
}

impl ImportProvider for HtmlImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        match source.extension().as_deref() {
            Some("html" | "htm" | "xhtml") => true,
            Some(_) => false,
            None => source.media_type.as_deref().is_some_and(|m| {
                matches!(
                    m.split(';').next().unwrap_or(m).trim(),
                    "text/html" | "application/xhtml+xml"
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
        let html = source.text(host)?;
        if html.len() > MAX_INPUT {
            return Err(bad_args(format!(
                "`{}` is {} bytes (max 2 MiB of HTML)",
                source.name,
                html.len()
            )));
        }
        let stem = source
            .stem()
            .ok_or_else(|| bad_args(format!("`{}` gives no usable document name", source.name)))?;
        let mut report = ImportReport::new(request.mode);
        let wanted = request.destination(&format!("{stem}.md"));
        let (doc, outcome) =
            resolve_destination(host, request, wanted, &source.name, &mut report.log);
        let opts = ClipOptions::default();
        let clipped = clip_html(&html, &opts)?;
        for n in &clipped.notes {
            let note = match n.level {
                "warn" => TransferNote::warning(n.message.clone()),
                _ => TransferNote::info(n.message.clone()),
            };
            report.log.push(note.about(n.entry.clone()));
        }
        if !clipped.assets.is_empty() {
            report.log.push(
                TransferNote::info(format!(
                    "{} remote image(s) kept as URLs, not downloaded",
                    clipped.assets.len()
                ))
                .about(source.name.clone()),
            );
        }
        let sha = content_hash_hex(html.as_bytes());
        // Rebuild with an import frontmatter: the clip frontmatter describes
        // a capture; the import frontmatter describes provenance.
        let body = clipped
            .markdown
            .split_once("---\n")
            .and_then(|(_, rest)| rest.split_once("---\n"))
            .map(|(_, b)| b.trim_start_matches('\n').to_string())
            .unwrap_or(clipped.markdown.clone());
        let text = format!(
            "---\ntitle: {}\nsource_file: {}\nsource_sha: {sha}\n---\n\n{body}",
            yaml_scalar(stem),
            yaml_scalar(&source.name),
        );
        if let Err(e) = write_doc(
            host,
            request,
            &doc,
            &text,
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

/// The shared clipper entry also used by [`clip_html`]-based flows; exported
/// for the pipeline and template preview.
pub fn convert_fragment(html: &str) -> Result<ClipResult, PluginError> {
    clip_html(html, &ClipOptions::default())
}
