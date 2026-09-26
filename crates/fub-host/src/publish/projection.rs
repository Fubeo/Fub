//! Static projection from the document AST. Never runs a dynamic block or
//! follows a link to an unapproved vault document.
use fub_abi::html::{attr, escape};
use fub_abi::model::{Block, DocId, DocumentModel, Inline, LinkTarget};
use fub_format_canvas::{parse_canvas, CanvasNodeType};
use std::collections::{BTreeMap, BTreeSet};

/// The local references of one page, already resolved by the vault index
/// (`IndexQuery::Resolve`): the rule the app follows when it navigates, so a
/// short `[[Note]]` reaches `dir/Note.md` and a link needs no `.md` guess.
/// Keys are written forms: a wikilink's page, a local link's path without its
/// fragment. A reference missing here resolved to nothing.
#[derive(Debug, Default)]
pub struct Resolved {
    pub wiki: BTreeMap<String, DocId>,
    pub paths: BTreeMap<String, DocId>,
}

/// What projecting one page knows besides its model.
#[derive(Clone, Copy)]
struct Projection<'a> {
    /// The projected document: relative asset paths start here.
    source: &'a str,
    site: &'a str,
    /// Approved pages: document id -> route inside the site.
    pages: &'a BTreeMap<String, String>,
    /// Approved assets, by exact vault path.
    assets: &'a BTreeSet<String>,
    links: &'a Resolved,
}

pub fn page(
    model: &DocumentModel,
    site_id: &str,
    pages: &BTreeMap<String, String>,
    assets: &BTreeSet<String>,
    links: &Resolved,
) -> Result<String, &'static str> {
    let mut html = String::new();
    let projection = Projection {
        source: &model.id.0,
        site: site_id,
        pages,
        assets,
        links,
    };
    blocks(&model.body, projection, &mut html, 0)?;
    Ok(html)
}

/// The site route of a resolved vault document, if it is an approved page.
fn route_of<'a>(p: Projection<'a>, doc: Option<&DocId>) -> Option<&'a String> {
    p.pages.get(doc?.as_str())
}

fn blocks(
    source: &[Block],
    p: Projection<'_>,
    out: &mut String,
    depth: usize,
) -> Result<(), &'static str> {
    if depth >= 64 {
        return Err("publish projection depth exceeded");
    }
    for block in source {
        match block {
            Block::Heading {
                level,
                inlines,
                anchor,
                ..
            } if (1..=6).contains(level) => {
                out.push_str(&format!("<h{level}"));
                if let Some(anchor) = anchor {
                    out.push_str(&attr("id", anchor));
                }
                out.push('>');
                inlines_into(inlines, p, out, depth + 1)?;
                out.push_str(&format!("</h{level}>\n"));
            }
            Block::Paragraph { inlines, .. } => {
                out.push_str("<p>");
                inlines_into(inlines, p, out, depth + 1)?;
                out.push_str("</p>\n");
            }
            Block::List {
                ordered,
                items,
                start,
                ..
            } => {
                if *ordered {
                    out.push_str("<ol");
                    if let Some(start) = start {
                        out.push_str(&attr("start", &start.to_string()));
                    }
                    out.push('>');
                } else {
                    out.push_str("<ul>");
                }
                for item in items {
                    out.push_str("<li>");
                    blocks(&item.blocks, p, out, depth + 1)?;
                    out.push_str("</li>");
                }
                out.push_str(if *ordered { "</ol>\n" } else { "</ul>\n" });
            }
            Block::Quote { blocks: inner, .. } => {
                out.push_str("<blockquote>");
                blocks(inner, p, out, depth + 1)?;
                out.push_str("</blockquote>\n");
            }
            Block::CodeBlock { code, .. } => {
                out.push_str("<pre><code>");
                out.push_str(&escape(code));
                out.push_str("</code></pre>\n");
            }
            Block::ThematicBreak { .. } => out.push_str("<hr>\n"),
            Block::Table { head, rows, .. } => {
                out.push_str("<table>");
                if let Some(head) = head {
                    out.push_str("<thead><tr>");
                    for cell in &head.cells {
                        out.push_str("<th>");
                        inlines_into(&cell.inlines, p, out, depth + 1)?;
                        out.push_str("</th>");
                    }
                    out.push_str("</tr></thead>");
                }
                out.push_str("<tbody>");
                for row in rows {
                    out.push_str("<tr>");
                    for cell in &row.cells {
                        out.push_str("<td>");
                        inlines_into(&cell.inlines, p, out, depth + 1)?;
                        out.push_str("</td>");
                    }
                    out.push_str("</tr>");
                }
                out.push_str("</tbody></table>\n");
            }
            // Dynamic/custom blocks and reference definitions have no verified
            // static meaning. Refuse rather than silently dropping content.
            _ => return Err("unsupported publish block projection"),
        }
    }
    Ok(())
}

fn inlines_into(
    source: &[Inline],
    p: Projection<'_>,
    out: &mut String,
    depth: usize,
) -> Result<(), &'static str> {
    if depth >= 64 {
        return Err("publish inline depth exceeded");
    }
    for inline in source {
        match inline {
            Inline::Text(text) | Inline::Code(text) => {
                if matches!(inline, Inline::Code(_)) {
                    out.push_str("<code>");
                }
                out.push_str(&escape(text));
                if matches!(inline, Inline::Code(_)) {
                    out.push_str("</code>");
                }
            }
            Inline::Emph(inner)
            | Inline::Strong(inner)
            | Inline::Superscript(inner)
            | Inline::Strikethrough(inner) => {
                let tag = match inline {
                    Inline::Emph(_) => "em",
                    Inline::Strong(_) => "strong",
                    Inline::Superscript(_) => "sup",
                    _ => "del",
                };
                out.push_str(&format!("<{tag}>"));
                inlines_into(inner, p, out, depth + 1)?;
                out.push_str(&format!("</{tag}>"));
            }
            Inline::TagRef { name, .. } => {
                out.push('#');
                out.push_str(&escape(name));
            }
            Inline::HardBreak => out.push_str("<br>"),
            Inline::SoftBreak => out.push(' '),
            Inline::Link {
                target,
                label,
                embed,
                ..
            } => {
                let destination = match target {
                    LinkTarget::Url(url) if !*embed && safe_external(url) => url.clone(),
                    LinkTarget::Path(path) => {
                        let (path, fragment) = path.split_once('#').unwrap_or((path, ""));
                        if !fragment
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                        {
                            return Err("unsafe link anchor");
                        }
                        let id = source_path(p.source, path).ok_or("unsafe link path")?;
                        if *embed {
                            if !is_image(&id) || !p.assets.contains(&id) {
                                return Err("image requires approved asset projection");
                            }
                            format!("/s/{}/{}", p.site, id)
                        } else {
                            let route = route_of(p, p.links.paths.get(path))
                                .ok_or("link target is not published")?;
                            format!(
                                "/s/{}/{}{}{}",
                                p.site,
                                route,
                                if fragment.is_empty() { "" } else { "#" },
                                fragment
                            )
                        }
                    }
                    LinkTarget::Wiki {
                        page,
                        heading,
                        block,
                    } if !*embed => {
                        if block.is_some() {
                            return Err("block link needs verified projection");
                        }
                        let route = if target.names_host() {
                            p.pages.get(p.source)
                        } else {
                            route_of(p, p.links.wiki.get(page))
                        }
                        .ok_or("wikilink target is not published")?;
                        let fragment = heading.as_deref().unwrap_or("");
                        if !fragment
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                        {
                            return Err("unsupported heading link");
                        }
                        format!(
                            "/s/{}/{}{}{}",
                            p.site,
                            route,
                            if fragment.is_empty() { "" } else { "#" },
                            fragment
                        )
                    }
                    _ => return Err("remote embed or unsafe link has no static projection"),
                };
                if *embed {
                    out.push_str("<img");
                    out.push_str(&attr("src", &destination));
                    out.push_str(&attr(
                        "alt",
                        label
                            .as_ref()
                            .and_then(|l| l.first())
                            .and_then(|n| match n {
                                Inline::Text(t) => Some(t.as_str()),
                                _ => None,
                            })
                            .unwrap_or(""),
                    ));
                    out.push('>');
                } else {
                    out.push_str("<a");
                    out.push_str(&attr("href", &destination));
                    out.push('>');
                    if let Some(label) = label {
                        inlines_into(label, p, out, depth + 1)?;
                    } else {
                        out.push_str(&escape(match target {
                            LinkTarget::Wiki { page, .. } => page,
                            LinkTarget::Url(url) => url,
                            LinkTarget::Path(path) => path,
                        }));
                    }
                    out.push_str("</a>");
                }
            }
            Inline::Custom { .. } => return Err("unsupported publish inline projection"),
        }
    }
    Ok(())
}

pub fn is_image(path: &str) -> bool {
    [".png", ".jpg", ".jpeg", ".webp", ".ico"]
        .iter()
        .any(|ext| path.ends_with(ext))
}

fn safe_external(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:"))
        && !url.contains(['<', '>', '"', '\'', '\\'])
        && !url.chars().any(char::is_control)
}

pub fn source_path(source: &str, path: &str) -> Option<String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with("//")
        || path.contains(['?', '#', '%', '\\', ':'])
    {
        return None;
    }
    let mut parts: Vec<&str> = source
        .rsplit_once('/')
        .map(|(parent, _)| parent.split('/').collect())
        .unwrap_or_default();
    for part in path.split('/') {
        match part {
            "." => {}
            ".." => {
                parts.pop()?;
            }
            "" => return None,
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

/// JSON Canvas has a deterministic, inert subset: text/group cards and
/// connections between them. The document is read by the canvas format's own
/// parser; this projector only narrows it. File/web cards, backgrounds and any
/// member the model keeps as unknown (`extra`) fail closed.
pub fn canvas(bytes: &[u8]) -> Result<String, &'static str> {
    if bytes.len() > 1_048_576 {
        return Err("canvas exceeds publish cap");
    }
    let source = std::str::from_utf8(bytes).map_err(|_| "bad canvas json")?;
    let canvas = parse_canvas(source).map_err(|_| "bad canvas json")?;
    if !canvas.extra.is_empty() {
        return Err("unknown canvas fields need a verified projector");
    }
    if canvas.nodes.len() > 256 || canvas.edges.len() > 1024 {
        return Err("canvas exceeds publish cap");
    }
    let mut out = String::from(
        "<h1>Canvas</h1><table><thead><tr><th>Card</th><th>Text</th></tr></thead><tbody>",
    );
    for node in &canvas.nodes {
        if !node.extra.is_empty() || node.background.is_some() || node.background_style.is_some() {
            return Err("unknown canvas node needs a verified projector");
        }
        let text = match node.node_type {
            CanvasNodeType::Text => node.text.as_deref(),
            CanvasNodeType::Group => node.label.as_deref(),
            CanvasNodeType::File | CanvasNodeType::Link => {
                return Err("canvas file or remote card cannot publish")
            }
        };
        // A text or group card that also names a file or a URL carries a
        // reference this projection would silently drop.
        if node.file.is_some() || node.subpath.is_some() || node.url.is_some() {
            return Err("canvas file or remote card cannot publish");
        }
        let text = text.ok_or("canvas card missing text")?;
        out.push_str("<tr><td>");
        out.push_str(&escape(&node.id));
        out.push_str("</td><td>");
        out.push_str(&escape(text));
        out.push_str("</td></tr>");
    }
    out.push_str("</tbody></table><h2>Connections</h2><ul>");
    // The parser has already refused duplicate cards and dangling edges.
    for edge in &canvas.edges {
        if !edge.extra.is_empty() {
            return Err("unknown canvas edge needs a verified projector");
        }
        out.push_str("<li>");
        out.push_str(&escape(&edge.from_node));
        out.push_str(" → ");
        out.push_str(&escape(&edge.to_node));
        out.push_str("</li>");
    }
    out.push_str("</ul>");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_refuses_remote_cards_and_projects_text_edges_as_inert_markup() {
        let public = br#"{"nodes":[{"id":"a","type":"text","text":"<secret>","x":0,"y":0,"width":100,"height":100},{"id":"b","type":"group","label":"Public","x":1,"y":1,"width":100,"height":100}],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}"#;
        let html = canvas(public).unwrap();
        assert!(html.contains("&lt;secret&gt;"));
        assert!(html.contains("a → b"));
        assert!(!html.contains("<secret>"));
        let remote = br#"{"nodes":[{"id":"a","type":"link","url":"https://example.test","x":0,"y":0,"width":100,"height":100}],"edges":[]}"#;
        assert!(canvas(remote).is_err());
    }
}
