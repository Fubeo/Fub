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
/// Livelli di lista oltre i quali una voce non rientra più (come il clipper).
/// Il rientro costa due spazi per livello **per ogni voce**: senza tetto,
/// centomila `<ul><li>` annidati in 2 MiB di HTML diventavano decine di GB di
/// Markdown, e l'importazione finiva la memoria dell'app. Le voci più profonde
/// restano a questo livello, col testo intero.
pub const MAX_LIST_INDENT: usize = 16;

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

/// Un `href`/`src` come lo legge il browser: senza caratteri di controllo né
/// spazi ai bordi, senza tab e a capo in mezzo, così `java\tscript:` è
/// `javascript:`. Gemella di `browserHref` in `convert.js`.
fn browser_href(raw: &str) -> String {
    raw.trim_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect()
}

/// Le entità nominate che una destinazione risolve per vedere il suo schema:
/// quelle che scrivono punteggiatura ASCII o un tab.
const DEST_ENTITIES: [(&str, &str); 11] = [
    ("amp", "&"),
    ("colon", ":"),
    ("sol", "/"),
    ("quest", "?"),
    ("num", "#"),
    ("lt", "<"),
    ("gt", ">"),
    ("quot", "\""),
    ("apos", "'"),
    ("Tab", "\t"),
    ("NewLine", "\n"),
];

/// Gli escape e le entità che il Markdown risolve in una destinazione,
/// quanto basta per vedere lo schema che porterà: gli escape di
/// punteggiatura, i riferimenti numerici e i nomi di [`DEST_ENTITIES`]; un
/// nome sconosciuto resta com'è. Gemella di `markdownDestination` in
/// `convert.js`.
fn markdown_destination(dest: &str) -> String {
    let mut unescaped = String::with_capacity(dest.len());
    let mut chars = dest.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&next) = chars.peek().filter(|next| next.is_ascii_punctuation()) {
                unescaped.push(next);
                chars.next();
                continue;
            }
        }
        unescaped.push(c);
    }
    let mut out = String::with_capacity(unescaped.len());
    let mut rest = unescaped.as_str();
    while let Some(c) = rest.chars().next() {
        if c == '&' {
            if let Some((decoded, len)) = entity_at(rest) {
                out.push_str(&decoded);
                rest = &rest[len..];
                continue;
            }
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// Il riferimento a carattere all'inizio di `s` (che comincia con `&`) e la
/// sua lunghezza: `&#x` e da uno a sei esadecimali, `&#` e da una a sette
/// cifre, o un nome di 2..=32 lettere e cifre, sempre chiusi da `;`.
fn entity_at(s: &str) -> Option<(String, usize)> {
    let b = s.as_bytes();
    let run = |from: usize, max: usize, ok: fn(&u8) -> bool| {
        b.get(from..).map_or(0, |tail| {
            tail.iter().take(max).take_while(|c| ok(c)).count()
        })
    };
    let closed = |end: usize| b.get(end) == Some(&b';');
    let numeric = |digits: &str, radix: u32| {
        let code = u32::from_str_radix(digits, radix).unwrap_or(0);
        let valid = code != 0 && !(0xd800..=0xdfff).contains(&code);
        char::from_u32(code)
            .filter(|_| valid)
            .unwrap_or('\u{fffd}')
            .to_string()
    };
    match (b.get(1), b.get(2)) {
        (Some(b'#'), Some(b'x' | b'X')) => {
            let n = run(3, 6, u8::is_ascii_hexdigit);
            (n > 0 && closed(3 + n)).then(|| (numeric(&s[3..3 + n], 16), 4 + n))
        }
        (Some(b'#'), _) => {
            let n = run(2, 7, u8::is_ascii_digit);
            (n > 0 && closed(2 + n)).then(|| (numeric(&s[2..2 + n], 10), 3 + n))
        }
        (Some(first), _) if first.is_ascii_alphabetic() => {
            let n = run(2, 31, u8::is_ascii_alphanumeric);
            (n > 0 && closed(2 + n)).then(|| {
                let name = &s[1..2 + n];
                let decoded = DEST_ENTITIES
                    .iter()
                    .find(|(known, _)| *known == name)
                    .map_or(&s[..3 + n], |(_, value)| value);
                (decoded.to_string(), 3 + n)
            })
        }
        _ => None,
    }
}

/// Una destinazione non http che il Markdown può portare così com'è. Lo
/// schema si giudica sull'indirizzo che il Markdown risolverà (escape ed
/// entità sciolti, poi letto come il browser): `javascript:`, `vbscript:` e
/// `data:`, anche mascherati come `javascript&colon;` o `javascript\:`, fanno
/// cadere il link. Gli altri schemi restano, perché un importatore porta i
/// suoi (`evernote://`) e la resa li filtra di nuovo; un relativo
/// `a&amp;b.html` resta. Gemella di `safeDestination` in `convert.js`.
fn safe_destination(dest: &str) -> bool {
    if dest
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '\u{feff}' | '"' | '<' | '>'))
    {
        return false;
    }
    let resolved = browser_href(&markdown_destination(dest));
    let head = resolved.split(['/', '?', '#']).next().unwrap_or("");
    match head.split_once(':') {
        Some((scheme, _)) => !["javascript", "vbscript", "data"]
            .iter()
            .any(|active| scheme.eq_ignore_ascii_case(active)),
        None => true,
    }
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
    let mut link_stack: Vec<Option<(String, usize)>> = Vec::new();
    let mut pre_depth = 0usize;
    let mut skip_depth = 0usize;
    let mut blockquote_depth = 0usize;
    let mut flattened = false;

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
        let href = browser_href(
            attr(&attrs, "href")
                .or_else(|| attr(&attrs, "src"))
                .unwrap_or(""),
        );
        if href.to_ascii_lowercase().starts_with("javascript:") {
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
                    let dest = browser_href(attr(&attrs, "href").unwrap_or(""));
                    link_stack.push(Some((dest, out.len())));
                    out.push("[".to_string());
                } else {
                    // Un link che cade lascia l'etichetta come testo semplice,
                    // senza le quadre che una definizione `[etichetta]: …`
                    // farebbe tornare link. Un link `javascript:` scartato non
                    // ha scritto nemmeno la `[`.
                    match link_stack.pop() {
                        Some(None) => {}
                        None => out.push("]".to_string()),
                        Some(Some((dest, at))) => {
                            if is_http_img(&dest) {
                                out.push(format!("]({})", md_url(&dest)));
                            } else {
                                if !dest.is_empty() && safe_destination(&dest) {
                                    out.push(format!("]({})", md_url(&dest)));
                                } else {
                                    out[at].clear();
                                }
                                if !dest.is_empty() {
                                    notes.push(ClipNote {
                                        level: "info",
                                        message: "kept non-http link as text".to_string(),
                                        entry: "a".to_string(),
                                    });
                                }
                            }
                        }
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
            "li" if !closing => {
                let depth = list_stack.len().saturating_sub(1);
                if depth > MAX_LIST_INDENT && !flattened {
                    flattened = true;
                    notes.push(ClipNote {
                        level: "warn",
                        message: format!(
                            "list nesting deeper than {MAX_LIST_INDENT} levels kept at that level"
                        ),
                        entry: "li".to_string(),
                    });
                }
                let indent = "  ".repeat(depth.min(MAX_LIST_INDENT));
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
            "mark" => out.push("==".to_string()),
            "table" => {
                if !closing {
                    need_blank(&mut out);
                } else {
                    out.push("\n\n".to_string());
                }
            }
            "tr" if !closing => {
                out.push("\n| ".to_string());
            }
            "th" | "td"
                if !closing
                    // Cell separator: leading `| ` came from `tr`.
                    && !out.last().is_some_and(|s| s.ends_with("| ")) =>
            {
                out.push(" | ".to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Un `href` si legge come lo legge il browser, e diventa destinazione
    /// solo se è sicura: niente schemi attivi né mascherati. Lo
    /// stesso ingresso e la stessa uscita di `apps/clipper/tests/
    /// security-limits.test.mjs`: i due convertitori restano 1:1.
    #[test]
    fn links_keep_only_safe_destinations() {
        let html = "<p><a href=\"java\tscript:alert(1)\">a</a> <a href=\"\u{1}javascript:alert(1)\">b</a> <a href=\"data:text/html,x\">c</a> <a href=\"&#106;avascript:alert(1)\">d</a> <a href=\"javascript\\:alert(1)\">e</a> <a href=\"other.html#s\">f</a> <a href=\"#comment-1\">g</a> <a href=\"mailto:a@b.it\">h</a> <a href=\" https://x.it/a \">i</a> <a href=\"//evil.it/x\">j</a> <a href=\"evernote://a/b\">k</a> <a href=\"VBScript:x\">l</a> <a href=\"a&amp;b.html\">m</a> <a href=\"dir\\f.html\">n</a> <a href=\"javascript&colon;alert(1)\">o</a> <a href=\"javascript&#58;alert(1)\">p</a> <a href=\"java&Tab;script:alert(1)\">q</a> <a>r</a> <a href=\"https://en.wikipedia.org/wiki/Hitchhiker's_Guide\">w</a></p>";
        let (md, _, notes) = html_to_markdown(html, &ClipOptions::default());
        assert_eq!(
            md,
            "a b c d e [f](other.html#s) [g](#comment-1) [h](mailto:a@b.it) [i](https://x.it/a) [j](//evil.it/x) [k](evernote://a/b) l [m](a&amp;b.html) [n](dir\\f.html) o p q r [w](https://en.wikipedia.org/wiki/Hitchhiker's_Guide)"
        );
        assert_eq!(
            notes
                .iter()
                .filter(|note| note.message == "dropped javascript: URL")
                .count(),
            2
        );
    }

    /// Una lista annidata oltre ogni ragione costa quanto è lunga: il testo di
    /// ogni voce resta, il rientro si ferma al tetto e una nota lo dice.
    #[test]
    fn deep_lists_stay_linear_and_keep_their_text() {
        let depth = 50_000;
        let html = "<ul><li>x".repeat(depth);
        let (md, _, notes) = html_to_markdown(&html, &ClipOptions::default());
        assert!(
            md.len() <= depth * (2 * MAX_LIST_INDENT + 8),
            "{}",
            md.len()
        );
        assert_eq!(md.matches("- x").count(), depth);
        assert_eq!(notes.iter().filter(|note| note.entry == "li").count(), 1);

        let shallow = "<ul><li>a<ul><li>b</li></ul></li></ul>";
        let (md, _, notes) = html_to_markdown(shallow, &ClipOptions::default());
        assert!(md.contains("\n  - b"), "{md:?}");
        assert!(notes.is_empty());
    }
}
