//! Server-owned static page chrome, derived only from the committed page set.
use std::collections::BTreeMap;

use super::guard::escape_html;
use super::site::{build_nav, page_outline, page_title, SiteRecord, StagedPage};

/// Compute graph/link topology and navigation once per commit, not once per
/// generated page. Edges can only point to a page in this staged set.
pub struct SiteChrome {
    nav: Vec<(String, String)>,
    previews: Vec<Vec<usize>>,
    backlinks: Vec<Vec<usize>>,
}

impl SiteChrome {
    pub fn new(record: &SiteRecord, pages: &[StagedPage<'_>]) -> Self {
        let known: BTreeMap<&str, usize> =
            pages.iter().enumerate().map(|(i, p)| (p.path, i)).collect();
        let mut previews = vec![Vec::new(); pages.len()];
        let mut backlinks = vec![Vec::new(); pages.len()];
        let public_base = super::site::public_base(record);
        let local_base = format!("/s/{}/", record.site_id);
        for (source, page) in pages.iter().enumerate() {
            for href in super::site::extract_hrefs(page.html) {
                let target = href.split('#').next().unwrap_or("");
                let target = target
                    .strip_prefix(&local_base)
                    .or_else(|| target.strip_prefix(&public_base))
                    .unwrap_or(target);
                if let Some(&dest) = known.get(target) {
                    if !previews[source].contains(&dest) {
                        previews[source].push(dest);
                        if source != dest {
                            backlinks[dest].push(source);
                        }
                    }
                }
            }
        }
        Self {
            nav: build_nav(pages, "index.html"),
            previews,
            backlinks,
        }
    }
}

pub fn assemble(
    record: &SiteRecord,
    pages: &[StagedPage<'_>],
    chrome: &SiteChrome,
    index: usize,
) -> String {
    let page = &pages[index];
    let title = page_title(page.path, page.html);
    let description = super::site::strip_tags(page.html)
        .chars()
        .take(150)
        .collect::<String>();
    let base = super::site::public_base(record);
    let mut out = String::with_capacity(page.html.len() + chrome.nav.len() * 90 + 512);
    out.push_str("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\n");
    out.push_str(&super::site::seo_head(
        record,
        page.path,
        &title,
        &description,
    ));
    out.push_str("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n");
    if let Some(css) = &record.theme_css {
        out.push_str(&format!(
            "<link rel=\"stylesheet\" href=\"{}{}\">\n",
            base,
            escape_html(css)
        ));
    }
    if let Some(icon) = &record.favicon {
        out.push_str(&format!(
            "<link rel=\"icon\" href=\"{}{}\">\n",
            base,
            escape_html(icon)
        ));
    }
    out.push_str("</head><body><nav aria-label=\"Site\"><ul>");
    for (path, title) in &chrome.nav {
        out.push_str(&format!(
            "<li><a href=\"{}{}\">{}</a></li>",
            base,
            escape_html(path),
            escape_html(title)
        ));
    }
    out.push_str("</ul></nav><main>");
    out.push_str(page.html);
    out.push_str("</main>");
    let outline = page_outline(page.html);
    if !outline.is_empty() {
        out.push_str("<aside aria-label=\"Outline\"><ul>");
        for (level, text) in outline {
            out.push_str(&format!(
                "<li data-level=\"{}\">{}</li>",
                level,
                escape_html(&text)
            ));
        }
        out.push_str("</ul></aside>");
    }
    if !chrome.previews[index].is_empty() {
        out.push_str("<aside aria-label=\"Link previews\"><ul>");
        for &target in &chrome.previews[index] {
            let dest = &pages[target];
            let title = page_title(dest.path, dest.html);
            let excerpt = super::site::strip_tags(dest.html)
                .chars()
                .take(120)
                .collect::<String>();
            out.push_str(&format!(
                "<li><a href=\"{}{}\">{}</a> <small>{}</small></li>",
                base,
                escape_html(dest.path),
                escape_html(&title),
                escape_html(&excerpt)
            ));
        }
        out.push_str("</ul></aside>");
    }
    if !chrome.backlinks[index].is_empty() {
        out.push_str("<aside aria-label=\"Backlinks\"><ul>");
        for &source in &chrome.backlinks[index] {
            let source = &pages[source];
            let title = page_title(source.path, source.html);
            out.push_str(&format!(
                "<li><a href=\"{}{}\" title=\"{}\">{}</a></li>",
                base,
                escape_html(source.path),
                escape_html(&title),
                escape_html(&title)
            ));
        }
        out.push_str("</ul></aside>");
    }
    out.push_str("</body></html>");
    out
}
