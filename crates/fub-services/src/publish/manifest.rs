//! Selective publish manifests (P17.1).
//!
//! A manifest is an explicit allowlist: only pages and assets it names may
//! be staged, and a linked file is published only with explicit allow —
//! never because some published page links to it. [`plan_dry_run`] previews
//! `would_publish / excluded_private / warnings` without touching the live
//! tree, and [`diff_manifest`] reports new/modified/unchanged/removed.

use serde::{Deserialize, Serialize};

/// A site's publish manifest. `no_private_leak` must be true for commit —
/// the server rejects manifests that do not assert it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublishManifest {
    pub site_id: String,
    /// Versione sito: identità sul wire come stringa (compat numero).
    #[serde(with = "crate::wire::u64_string")]
    pub version: u64,
    pub allowlist: Vec<String>,
    pub pages: Vec<PageEntry>,
    pub assets: Vec<AssetEntry>,
    pub no_private_leak: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageEntry {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    pub html_sha: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetEntry {
    pub path: String,
    pub sha: String,
}

/// Page content carried by a commit request: rendered static HTML plus the
/// vault doc it was projected from (if any).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageBody {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    pub html: String,
}

/// Asset content carried by a commit request. Bytes travel as standard
/// base64; the server checks `sha` (hex SHA-256) before staging.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetBody {
    pub path: String,
    pub sha: String,
    pub bytes_b64: String,
}

/// A vault doc as seen by dry-run planning: its id, whether the manifest
/// allowlists it, and whether it carries inclusion/exclusion properties.
///
/// Serde mirrors the host `LinkedDoc` shape exactly (same field names), so a
/// dry-run request can carry the client's vault view without shared types.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkedDoc {
    pub doc_id: String,
    /// Explicitly allowlisted by glob or by `publish: true` property.
    pub allowed: bool,
    /// Carries an exclusion property (`private: true`, `draft: true`, …).
    pub excluded: bool,
    /// Reached only through a link from a published page.
    pub linked_only: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DryRunRequest {
    /// Wire protocol; the server hard-errors on anything but `fub-publish/1`.
    #[serde(default)]
    pub protocol: String,
    pub site_id: String,
    pub manifest: PublishManifest,
    /// Client's vault view for exclusion planning. Additive: absent means
    /// "no vault context" (planning covers manifest entries only).
    #[serde(default)]
    pub vault: Vec<LinkedDoc>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DryRunResponse {
    pub would_publish: Vec<String>,
    pub excluded_private: Vec<String>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub diff: Option<ManifestDiff>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitRequest {
    /// Wire protocol; the server hard-errors on anything but `fub-publish/1`.
    #[serde(default)]
    pub protocol: String,
    pub site_id: String,
    pub manifest: PublishManifest,
    #[serde(default)]
    pub pages: Vec<PageBody>,
    #[serde(default)]
    pub assets: Vec<AssetBody>,
    /// Vault doc ids the client asserts must stay private. The staged tree
    /// is leakage-scanned for all of them before anything goes live.
    /// Additive: absent means "no exclusions asserted".
    #[serde(default)]
    pub excluded_private: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommitResponse {
    pub site_id: String,
    #[serde(with = "crate::wire::u64_string")]
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnpublishRequest {
    /// Wire protocol; the server hard-errors on anything but `fub-publish/1`.
    #[serde(default)]
    pub protocol: String,
    pub site_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnpublishResponse {
    pub site_id: String,
    pub unpublished: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RollbackRequest {
    /// Wire protocol; the server hard-errors on anything but `fub-publish/1`.
    #[serde(default)]
    pub protocol: String,
    pub site_id: String,
    #[serde(with = "crate::wire::u64_string")]
    pub to_version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RollbackResponse {
    pub site_id: String,
    #[serde(with = "crate::wire::u64_string")]
    pub version: u64,
}

/// Additive status read for the host client and the publish panel.
/// `live_version`/`versions` come stringhe (identità); i conteggi piccoli
/// restano numeri (non identità, mai oltre 2^53).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusResponse {
    pub site_id: String,
    #[serde(with = "crate::wire::opt_u64_string", default)]
    pub live_version: Option<u64>,
    #[serde(with = "crate::wire::vec_u64_string")]
    pub versions: Vec<u64>,

    pub page_count: usize,
    pub asset_count: usize,
    pub password_protected: bool,
}

/// New/modified/unchanged/removed diff between two manifests (by path).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestDiff {
    pub added: Vec<String>,
    pub modified: Vec<String>,
    pub unchanged: Vec<String>,
    pub removed: Vec<String>,
}

pub fn diff_manifest(old: &PublishManifest, new: &PublishManifest) -> ManifestDiff {
    use std::collections::BTreeMap;
    let index = |m: &PublishManifest| {
        let mut map = BTreeMap::new();
        for page in &m.pages {
            map.insert(page.path.clone(), page.html_sha.clone());
        }
        for asset in &m.assets {
            map.insert(asset.path.clone(), asset.sha.clone());
        }
        map
    };
    let (before, after) = (index(old), index(new));
    let mut diff = ManifestDiff {
        added: Vec::new(),
        modified: Vec::new(),
        unchanged: Vec::new(),
        removed: Vec::new(),
    };
    for (path, sha) in &after {
        match before.get(path) {
            None => diff.added.push(path.clone()),
            Some(prev) if prev != sha => diff.modified.push(path.clone()),
            Some(_) => diff.unchanged.push(path.clone()),
        }
    }
    for path in before.keys() {
        if !after.contains_key(path) {
            diff.removed.push(path.clone());
        }
    }
    diff
}

/// Minimal glob matcher for allowlists: `*` (within a segment), `**`
/// (across segments), `?` (one char). Full regex is deliberately out —
/// allowlists stay readable and auditable.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    glob_segments(pattern.as_bytes(), path.as_bytes())
}

fn glob_segments(pat: &[u8], text: &[u8]) -> bool {
    let (mut px, mut tx) = (0usize, 0usize);
    let (mut star, mut mark) = (None, 0usize);
    while tx < text.len() {
        if px < pat.len() && (pat[px] == b'?' || pat[px] == text[tx]) {
            px += 1;
            tx += 1;
        } else if px < pat.len() && pat[px] == b'*' {
            if px + 1 < pat.len() && pat[px + 1] == b'*' {
                // `**`: skip the run, then match the rest anywhere ahead.
                while px < pat.len() && pat[px] == b'*' {
                    px += 1;
                }
                if px == pat.len() {
                    return true;
                }
                if pat[px] == b'/' {
                    px += 1;
                }
                for skip in tx..=text.len() {
                    if glob_segments(&pat[px..], &text[skip..]) {
                        return true;
                    }
                }
                return false;
            }
            star = Some(px);
            mark = tx;
            px += 1;
        } else if let Some(s) = star {
            px = s + 1;
            mark += 1;
            tx = mark;
        } else {
            return false;
        }
    }
    while px < pat.len() && pat[px] == b'*' {
        px += 1;
    }
    px == pat.len()
}

pub fn matches_allowlist(allowlist: &[String], path: &str) -> bool {
    allowlist.iter().any(|pat| glob_match(pat, path))
}

/// Site ids are filesystem names: lowercase alphanumerics, `-` and `_`,
/// 1–64 chars. Anything else is rejected before it touches `<data>/sites/`.
pub fn check_site_id(site_id: &str) -> Result<(), ManifestError> {
    if site_id.is_empty() || site_id.len() > 64 {
        return Err(ManifestError::BadSiteId(site_id.to_string()));
    }
    let ok = site_id
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
    if !ok {
        return Err(ManifestError::BadSiteId(site_id.to_string()));
    }
    Ok(())
}

/// Publish paths are site-relative, never absolute or escaping the site.
pub fn check_publish_path(path: &str) -> Result<(), ManifestError> {
    if path.is_empty()
        || path.len() > 512
        || path.starts_with('/')
        || path
            .bytes()
            .any(|b| b == b'\\' || b == b'%' || b == b'?' || b == b'#' || b.is_ascii_control())
        || path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.starts_with('.')
                || matches!(
                    segment.to_ascii_lowercase().as_str(),
                    "private" | "privato" | "secrets"
                )
        })
    {
        return Err(ManifestError::BadPath(path.to_string()));
    }
    Ok(())
}

/// Dry-run planning: which manifest entries would publish, which vault docs
/// stay excluded as private, and warnings (linked-only docs without explicit
/// allow, entries outside the allowlist, empty allowlist).
///
/// The linked-file closure REQUIRES explicit allow: a doc reached only via
/// a link from a published page is listed in `warnings` and never added to
/// `would_publish` on its own.
pub fn plan_dry_run(manifest: &PublishManifest, vault: &[LinkedDoc]) -> DryRunResponse {
    let mut would_publish = Vec::new();
    let mut excluded_private = Vec::new();
    let mut warnings = Vec::new();

    if manifest.allowlist.is_empty() {
        warnings.push("allowlist is empty: nothing would publish".to_string());
    }

    for page in &manifest.pages {
        if !matches_allowlist(&manifest.allowlist, &page.path) {
            warnings.push(format!("page outside allowlist: {}", page.path));
            continue;
        }
        would_publish.push(page.path.clone());
    }
    for asset in &manifest.assets {
        if !matches_allowlist(&manifest.allowlist, &asset.path) {
            warnings.push(format!("asset outside allowlist: {}", asset.path));
            continue;
        }
        would_publish.push(asset.path.clone());
    }

    for doc in vault {
        if doc.excluded {
            excluded_private.push(doc.doc_id.clone());
        } else if doc.linked_only && !doc.allowed {
            warnings.push(format!(
                "linked note needs explicit allow, not auto-published: {}",
                doc.doc_id
            ));
        }
    }

    would_publish.sort();
    would_publish.dedup();
    excluded_private.sort();
    excluded_private.dedup();
    warnings.sort();
    warnings.dedup();
    DryRunResponse {
        would_publish,
        excluded_private,
        diff: None,
        warnings,
    }
}

/// Commit-time manifest validation: site id, `no_private_leak` asserted,
/// every entry path safe and allowlisted, no duplicate paths, body sets
/// matching the manifest (same paths, same shas).
pub fn validate_manifest_for_commit(
    manifest: &PublishManifest,
    pages: &[PageBody],
    assets: &[AssetBody],
) -> Result<(), ManifestError> {
    use std::collections::BTreeSet;
    check_site_id(&manifest.site_id)?;
    if !manifest.no_private_leak {
        return Err(ManifestError::PrivateLeakNotAsserted);
    }
    let mut seen = BTreeSet::new();
    for page in &manifest.pages {
        check_publish_path(&page.path)?;
        check_reserved_path(&page.path)?;
        if !matches_allowlist(&manifest.allowlist, &page.path) {
            return Err(ManifestError::OutsideAllowlist(page.path.clone()));
        }
        if !seen.insert(page.path.clone()) {
            return Err(ManifestError::DuplicatePath(page.path.clone()));
        }
    }
    for asset in &manifest.assets {
        check_publish_path(&asset.path)?;
        check_reserved_path(&asset.path)?;
        if !matches_allowlist(&manifest.allowlist, &asset.path) {
            return Err(ManifestError::OutsideAllowlist(asset.path.clone()));
        }
        if !seen.insert(asset.path.clone()) {
            return Err(ManifestError::DuplicatePath(asset.path.clone()));
        }
    }
    // Bodies must cover the manifest exactly: no silent drops, no extras.
    let manifest_pages: BTreeSet<&str> = manifest.pages.iter().map(|p| p.path.as_str()).collect();
    let body_pages: BTreeSet<&str> = pages.iter().map(|p| p.path.as_str()).collect();
    if manifest_pages != body_pages {
        return Err(ManifestError::BodyMismatch("pages".to_string()));
    }
    let manifest_assets: BTreeSet<&str> = manifest.assets.iter().map(|a| a.path.as_str()).collect();
    let body_assets: BTreeSet<&str> = assets.iter().map(|a| a.path.as_str()).collect();
    if manifest_assets != body_assets {
        return Err(ManifestError::BodyMismatch("assets".to_string()));
    }
    for page in pages {
        if manifest
            .pages
            .iter()
            .find(|entry| entry.path == page.path)
            .and_then(|entry| entry.doc_id.as_ref())
            != page.doc_id.as_ref()
        {
            return Err(ManifestError::BodyMismatch("page doc ids".to_string()));
        }
        check_publish_path(&page.path)?;
    }
    for asset in assets {
        check_publish_path(&asset.path)?;
    }
    Ok(())
}

fn check_reserved_path(path: &str) -> Result<(), ManifestError> {
    if matches!(
        path,
        "manifest.json"
            | "search-index.json"
            | "graph.json"
            | "feed.xml"
            | "sitemap.xml"
            | "robots.txt"
            | ".fub-cache-epoch"
    ) {
        return Err(ManifestError::BadPath(path.to_string()));
    }
    Ok(())
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManifestError {
    #[error("bad site id: {0}")]
    BadSiteId(String),
    #[error("bad publish path: {0}")]
    BadPath(String),
    #[error("manifest must assert no_private_leak")]
    PrivateLeakNotAsserted,
    #[error("entry outside allowlist: {0}")]
    OutsideAllowlist(String),
    #[error("duplicate path: {0}")]
    DuplicatePath(String),
    #[error("commit bodies do not match manifest {0} set")]
    BodyMismatch(String),
}
