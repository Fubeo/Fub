//! Single source of truth for the browser clipper conversion, mirrored
//! 1:1 in `apps/clipper/src/convert.js` (`clipHtml`, `markdownForSelection`,
//! `htmlToMarkdown`, `templateVars`).
//!
//! Input: HTML string + [`ClipOptions`] (`url?`, `selection_only`, `title?`,
//! `clipped_at?`). No network, no `HostApi`, no fs — pure CPU.
//!
//! Output: [`ClipResult`] `{markdown, assets, notes}`:
//! - `markdown`: YAML frontmatter (`title`, `source_url?`, `clipped_at`)
//!   plus the converted body;
//! - `assets`: `[{orig_url, suggested_name}]` until explicitly downloaded;
//!   only verified downloaded bytes can carry a `sha256` content digest;
//! - `notes`: `[{level: info|warn, message, entry}]`, entry a CSS-ish
//!   selector or URL naming the source construct.
//!
//! Limits mirror the JS exactly: [`MAX_INPUT`] 2 MiB in, [`MAX_ASSETS`] 50,
//! body truncated with a visible `warn` note to the 1 MiB capture ceiling.
//! Dropped with a note: `script`/`style`/`noscript`/`template`/`iframe`/
//! `object`/`embed`, `javascript:` URLs, event-handler attributes;
//! non-`http(s)` images degrade to alt text (never fetched).

pub use crate::html::{
    html_to_markdown as html_to_markdown_raw, markdown_for_selection as markdown_for_selection_raw,
    ClipAsset as ClipAsset_, ClipNote as ClipNote_, ClipOptions as ClipOptions_,
    ClipResult as ClipResult_, HtmlImport, MAX_ASSETS, MAX_INPUT,
};
use fub_abi::PluginError;

use crate::html::ClipOptions as InnerOptions;

/// Re-exported option shape with the exact JSON field names the clipper
/// mirror uses (`url`, `selectionOnly`, `title`, `clippedAt` over the wire).
#[derive(Debug, Clone, Default)]
pub struct ClipOptions {
    pub url: Option<String>,
    pub selection_only: bool,
    pub title: Option<String>,
    pub clipped_at: Option<String>,
}

impl ClipOptions {
    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }
    pub fn selection(mut self) -> Self {
        self.selection_only = true;
        self
    }
}

fn inner(opts: &ClipOptions) -> InnerOptions {
    InnerOptions {
        url: opts.url.clone(),
        selection_only: opts.selection_only,
        title: opts.title.clone(),
        clipped_at: opts.clipped_at.clone(),
    }
}

/// Asset record: a digest is only present for verified downloaded bytes.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipAsset {
    pub orig_url: String,
    pub suggested_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// Stable note record, JSON shape `{level, message, entry}`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipNote {
    pub level: String,
    pub message: String,
    pub entry: String,
}

/// Stable result, JSON shape `{markdown, assets, notes}`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipResult {
    pub markdown: String,
    pub assets: Vec<ClipAsset>,
    pub notes: Vec<ClipNote>,
}

/// `clipHtml(html, opts)`: HTML string in, stable JSON out.
pub fn clip_html(html: &str, opts: &ClipOptions) -> Result<ClipResult, PluginError> {
    let r = crate::html::clip_html(html, &inner(opts))?;
    Ok(ClipResult {
        markdown: r.markdown,
        assets: r
            .assets
            .into_iter()
            .map(|a| ClipAsset {
                orig_url: a.orig_url,
                suggested_name: a.suggested_name,
                sha256: None,
            })
            .collect(),
        notes: r
            .notes
            .into_iter()
            .map(|n| ClipNote {
                level: n.level.to_string(),
                message: n.message,
                entry: n.entry,
            })
            .collect(),
    })
}

/// `markdownForSelection(html, opts)`: same with `selectionOnly` forced.
pub fn markdown_for_selection(html: &str, opts: &ClipOptions) -> Result<String, PluginError> {
    let mut o = inner(opts);
    o.selection_only = true;
    Ok(crate::html::clip_html(html, &o)?.markdown)
}

/// `htmlToMarkdown(html)`: body only, no frontmatter.
pub fn html_to_markdown(html: &str) -> (String, Vec<ClipAsset>, Vec<ClipNote>) {
    let (md, assets, notes) =
        crate::html::html_to_markdown(html, &crate::html::ClipOptions::default());
    (
        md,
        assets
            .into_iter()
            .map(|a| ClipAsset {
                orig_url: a.orig_url,
                suggested_name: a.suggested_name,
                sha256: None,
            })
            .collect(),
        notes
            .into_iter()
            .map(|n| ClipNote {
                level: n.level.to_string(),
                message: n.message,
                entry: n.entry,
            })
            .collect(),
    )
}

/// `templateVars()`: the four import-template variables shared with the
/// clipper (`source_url`, `title`, `clipped_at`, `excerpt`).
pub fn template_vars() -> Vec<String> {
    crate::html::template_vars()
}
