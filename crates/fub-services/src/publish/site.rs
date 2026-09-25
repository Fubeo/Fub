//! Site lifecycle for the publish slice (P17.2, P17.4, P17.5).
//!
//! Layout under `<data>/sites/<site_id>/`:
//! ```text
//! record.json        — SiteRecord (owner, collaborators, password, versions…)
//! live               — symlink to the currently published bundles/<n>/
//! bundles/<n>/       — immutable public tree, without manifest metadata
//! versions/<n>/      — immutable rollback snapshot plus manifest.json
//! ```
//!
//! Crash safety: complete immutable version snapshots and public bundles are
//! prepared before an atomic live symlink swap. The record is the committed
//! pointer: recovery restores that version (or intentional unpublication)
//! after a crash. Legacy live directories are preserved during migration.
//!
//! Roles (`publish` vs `administer`) are decided by the parent ACL check —
//! this module only maps the parent role names (`owner`/`admin`/`writer`/
//! `reader`) to the two publish capabilities so the dispatch in the parent
//! `handle` stays readable. Revoking a collaborator blocks future publishes;
//! copies already fetched survive (they are static files elsewhere).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::guard::{assert_no_leakage_bytes, sha256_hex};
use super::manifest::{
    check_publish_path, check_site_id, validate_manifest_for_commit, AssetBody, CommitRequest,
    ManifestError, PublishManifest, StatusResponse,
};

/// Per-site quota view. The authoritative [`ServiceQuotas`] live in the
/// parent `schema` module; these are the two byte caps the site layer
/// enforces, passed in by the dispatcher so this module never imports
/// parent state directly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SiteQuota {
    pub max_asset_bytes: u64,
    pub max_site_bytes: u64,
}

/// TLS / custom-domain configuration. Exact external blocker: certificate
/// provisioning and DNS are operator concerns — the backend only stores the
/// desired hostname and serves the site under it once the operator's
/// reverse proxy terminates TLS. No cert is minted here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TlsConfig {
    pub domain: String,
    pub path_prefix: String,
    /// True once the operator confirms DNS + certificate out of band.
    pub provisioned: bool,
}
/// Hostname/path intent is deliberately narrower than a URL: no scheme,
/// port, userinfo, wildcard, query, traversal or control characters.
pub fn valid_tls_intent(tls: &TlsConfig) -> bool {
    let domain = tls.domain.as_str();
    let labels: Vec<_> = domain.split('.').collect();
    !tls.provisioned
        && domain.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        && (tls.path_prefix == "/"
            || (tls.path_prefix.starts_with('/')
                && tls.path_prefix.ends_with('/')
                && tls.path_prefix.len() <= 128
                && tls.path_prefix[1..tls.path_prefix.len() - 1]
                    .split('/')
                    .all(|part| {
                        !part.is_empty()
                            && part
                                .bytes()
                                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                    })))
}

fn record_schema_version() -> u32 {
    1
}

/// Persistent site record (`record.json`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SiteRecord {
    #[serde(default = "record_schema_version")]
    pub schema_version: u32,
    pub site_id: String,
    pub owner: String,
    #[serde(default)]
    pub collaborators: Vec<String>,
    /// Durable grants: the parent ACL map is process-local and cannot alone
    /// authorize collaborators after a service restart.
    #[serde(default)]
    pub collaborator_roles: BTreeMap<String, crate::acl::Role>,
    /// `v1$…` PBKDF2 site-password hash, or None for a public site.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    #[serde(default, with = "crate::wire::vec_u64_string")]
    pub versions: Vec<u64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "crate::wire::opt_u64_string"
    )]
    pub live_version: Option<u64>,
    /// Epoch cache: contatore operativo piccolo, resta number (non identità).
    #[serde(default)]
    pub cache_epoch: u64,
    #[serde(default)]
    pub redirects: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<TlsConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_css: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(default)]
    pub revoked: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Redirect {
    pub from: String,
    pub to: String,
}

/// One published page as staged: path, source doc and rendered static HTML.
pub struct StagedPage<'a> {
    pub path: &'a str,
    pub doc_id: Option<&'a str>,
    pub html: &'a str,
}

pub fn sites_root(data_dir: &Path) -> PathBuf {
    data_dir.join("sites")
}

pub fn site_dir(data_dir: &Path, site_id: &str) -> PathBuf {
    sites_root(data_dir).join(site_id)
}

pub fn public_base_path(data_dir: &Path, site_id: &str) -> PathBuf {
    site_dir(data_dir, site_id).join("live")
}

// ---------------------------------------------------------------------------
// Roles: publish (owner/admin/writer) vs administer (owner/admin).
// Names mirror parent acl::Role; the check itself is the parent's.
// ---------------------------------------------------------------------------

/// Roles allowed to publish (dry-run, commit, rollback): owner, admin, writer.
pub fn can_publish(role: &str) -> bool {
    matches!(role, "owner" | "admin" | "writer")
}

/// Roles allowed to administer (create, unpublish, password/domain, revoke):
/// owner and admin only.
pub fn can_administer(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

/// `&'static` content type for static dispatch (the parent `HttpResponse`
/// carries `content_type: &'static str`, so the mapping lives here).
pub fn content_type_for(path: &str) -> &'static str {
    static_content_type(path)
}

/// `&'static` content type for static dispatch (the parent `HttpResponse`
/// carries `content_type: &'static str`, so the mapping lives here).
pub fn static_content_type(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".xml") {
        "application/xml; charset=utf-8"
    } else if path.ends_with(".txt") {
        "text/plain; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    }
}

// ---------------------------------------------------------------------------
// Record I/O.
// ---------------------------------------------------------------------------

fn record_path(data_dir: &Path, site_id: &str) -> PathBuf {
    site_dir(data_dir, site_id).join("record.json")
}

pub fn load_record(data_dir: &Path, site_id: &str) -> Result<SiteRecord, SiteError> {
    check_site_id(site_id).map_err(SiteError::Manifest)?;
    let bytes = fs::read(record_path(data_dir, site_id)).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            SiteError::SiteNotFound(site_id.to_string())
        } else {
            SiteError::Io(e)
        }
    })?;
    let record: SiteRecord = serde_json::from_slice(&bytes).map_err(SiteError::Json)?;
    if record.schema_version != 1 {
        return Err(SiteError::BadPath("unsupported site schema".to_string()));
    }
    Ok(record)
}

pub fn save_record(data_dir: &Path, record: &SiteRecord) -> Result<(), SiteError> {
    check_site_id(&record.site_id).map_err(SiteError::Manifest)?;
    let dir = site_dir(data_dir, &record.site_id);
    fs::create_dir_all(&dir).map_err(SiteError::Io)?;
    if record.schema_version != 1 {
        return Err(SiteError::BadPath("unsupported site schema".to_string()));
    }
    atomic_write_file(&dir, "record.json", &serde_json::to_vec_pretty(record)?)
}

/// Write `name` inside `dir` atomically: temp file + fsync + rename.
fn atomic_write_file(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), SiteError> {
    use std::io::Write as _;
    let tmp = dir.join(format!(".{name}.tmp-{}", unique_suffix()));
    let mut file = fs::File::create(&tmp).map_err(SiteError::Io)?;
    file.write_all(bytes).map_err(SiteError::Io)?;
    file.sync_all().map_err(SiteError::Io)?;
    fs::rename(&tmp, dir.join(name)).map_err(SiteError::Io)?;
    sync_dir(dir)
}

fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
}

// ---------------------------------------------------------------------------
// Site creation.
// ---------------------------------------------------------------------------

pub fn create_site(
    data_dir: &Path,
    site_id: &str,
    owner: &str,
    password_hash: Option<String>,
) -> Result<SiteRecord, SiteError> {
    check_site_id(site_id).map_err(SiteError::Manifest)?;
    if owner.is_empty() {
        return Err(SiteError::EmptyOwner);
    }
    let dir = site_dir(data_dir, site_id);
    if record_path(data_dir, site_id).exists() {
        return Err(SiteError::AlreadyExists(site_id.to_string()));
    }
    if fs::symlink_metadata(&dir).is_ok_and(|meta| !meta.is_dir() || meta.file_type().is_symlink())
    {
        return Err(SiteError::BadPath(site_id.to_string()));
    }
    fs::create_dir_all(dir.join("versions")).map_err(SiteError::Io)?;
    let record = SiteRecord {
        schema_version: 1,
        site_id: site_id.to_string(),
        owner: owner.to_string(),
        collaborators: Vec::new(),
        collaborator_roles: BTreeMap::new(),
        password_hash,
        theme_css: None,
        favicon: None,
        versions: Vec::new(),
        live_version: None,
        cache_epoch: 0,
        redirects: BTreeMap::new(),
        tls: None,
        revoked: Vec::new(),
    };
    save_record(data_dir, &record)?;
    Ok(record)
}

/// Revoke a collaborator: future publishes by them are rejected. Copies
/// already fetched survive — revocation cannot reach static files elsewhere.
pub fn revoke_collaborator(
    data_dir: &Path,
    site_id: &str,
    user: &str,
) -> Result<SiteRecord, SiteError> {
    let mut record = load_record(data_dir, site_id)?;
    record.collaborators.retain(|c| c != user);
    record.collaborator_roles.remove(user);
    if !record.revoked.contains(&user.to_string()) {
        record.revoked.push(user.to_string());
    }
    save_record(data_dir, &record)?;
    Ok(record)
}

// ---------------------------------------------------------------------------
// Commit: validate, verify, stage, leakage-scan, atomic publish.
// ---------------------------------------------------------------------------

/// Commit a manifest with bodies. `excluded_ids` are vault docs the client
/// asserts must stay private — the staged tree is scanned for all of them
/// before anything goes live.
#[allow(clippy::too_many_arguments)]
pub fn commit_site(
    data_dir: &Path,
    request: &CommitRequest,
    excluded_ids: &[String],
    quota: SiteQuota,
    max_sites: usize,
    site_count: usize,
    is_new_site: bool,
) -> Result<(SiteRecord, u64), SiteError> {
    let manifest = &request.manifest;
    check_site_id(&manifest.site_id).map_err(SiteError::Manifest)?;
    if is_new_site && site_count >= max_sites {
        return Err(SiteError::QuotaExceeded(format!(
            "site count {site_count} reaches max {max_sites}"
        )));
    }
    validate_manifest_for_commit(manifest, &request.pages, &request.assets)
        .map_err(SiteError::Manifest)?;
    if let Some(id) = request
        .pages
        .iter()
        .filter_map(|page| page.doc_id.as_deref())
        .find(|id| excluded_ids.iter().any(|excluded| excluded == id))
    {
        return Err(SiteError::PrivateLeak(vec![format!(
            "{id} is excluded from publication"
        )]));
    }
    recover_interrupted_commit(data_dir, &manifest.site_id)?;
    let next_version = next_version_number(data_dir, &manifest.site_id)?;
    if manifest.version != next_version {
        return Err(SiteError::StaleVersion {
            expected: next_version,
            received: manifest.version,
        });
    }
    let presentation = load_record(data_dir, &manifest.site_id)?;
    for required in [&presentation.theme_css, &presentation.favicon]
        .into_iter()
        .flatten()
    {
        if !manifest.assets.iter().any(|entry| &entry.path == required) {
            return Err(SiteError::BadPath(format!(
                "missing configured site asset: {required}"
            )));
        }
    }
    let asset_paths: std::collections::HashSet<&str> = manifest
        .assets
        .iter()
        .map(|asset| asset.path.as_str())
        .collect();
    let own_assets = format!("/s/{}/", manifest.site_id);
    for page in &request.pages {
        for src in extract_attributes(&page.html, "src=\"") {
            if !src
                .strip_prefix(&own_assets)
                .is_some_and(|path| asset_paths.contains(path))
            {
                return Err(SiteError::BadPath(format!(
                    "unpublished image reference in {}",
                    page.path
                )));
            }
        }
    }

    // Verify client hashes, project deterministic surfaces, and byte-scan
    // everything BEFORE any unapproved bytes reach a staging directory.
    let mut surfaces: Vec<(String, Vec<u8>)> =
        Vec::with_capacity(request.pages.len() + request.assets.len() + 6);
    for page in &request.pages {
        if sha256_hex(page.html.as_bytes()) != manifest_page_sha(manifest, &page.path)? {
            return Err(SiteError::ShaMismatch(page.path.clone()));
        }
    }
    for asset in &request.assets {
        let bytes = decode_asset(asset)?;
        if bytes.len() as u64 > quota.max_asset_bytes {
            return Err(SiteError::QuotaExceeded(format!(
                "asset {} exceeds {} bytes",
                asset.path, quota.max_asset_bytes
            )));
        }
        validate_public_asset(&asset.path, &bytes)?;
        if sha256_hex(&bytes) != manifest_asset_sha(manifest, &asset.path)? {
            return Err(SiteError::ShaMismatch(asset.path.clone()));
        }
        surfaces.push((asset.path.clone(), bytes));
    }
    let staged_pages: Vec<StagedPage<'_>> = request
        .pages
        .iter()
        .map(|p| StagedPage {
            path: &p.path,
            doc_id: p.doc_id.as_deref(),
            html: &p.html,
        })
        .collect();
    let chrome = super::assembly::SiteChrome::new(&presentation, &staged_pages);
    for (index, page) in staged_pages.iter().enumerate() {
        surfaces.push((
            page.path.to_string(),
            super::assembly::assemble(&presentation, &staged_pages, &chrome, index).into_bytes(),
        ));
    }
    surfaces.push((
        "search-index.json".to_string(),
        build_search_index(&staged_pages).into_bytes(),
    ));
    surfaces.push((
        "graph.json".to_string(),
        build_site_graph(&manifest.site_id, &staged_pages).into_bytes(),
    ));
    surfaces.push((
        "feed.xml".to_string(),
        build_feed(&presentation, &staged_pages).into_bytes(),
    ));
    surfaces.push((
        "sitemap.xml".to_string(),
        build_sitemap(&presentation, &staged_pages).into_bytes(),
    ));
    surfaces.push(("robots.txt".to_string(), build_robots().into_bytes()));
    surfaces.push((
        ".fub-cache-epoch".to_string(),
        format!("{next_version}\n").into_bytes(),
    ));
    let actual_bytes: u64 = surfaces.iter().map(|(_, bytes)| bytes.len() as u64).sum();
    if actual_bytes > quota.max_site_bytes {
        return Err(SiteError::QuotaExceeded(
            "derived site exceeds byte quota".to_string(),
        ));
    }
    let excluded: Vec<&str> = excluded_ids.iter().map(String::as_str).collect();
    if let Err(leaks) = assert_no_leakage_bytes(&surfaces, &excluded) {
        return Err(SiteError::PrivateLeak(leaks_into_strings(leaks)));
    }

    let dir = site_dir(data_dir, &manifest.site_id);
    let staging_tmp = dir.join(format!("staging.{}", unique_suffix()));
    fs::create_dir_all(&staging_tmp).map_err(SiteError::Io)?;
    for (path, bytes) in &surfaces {
        write_staged(&staging_tmp, path, bytes)?;
    }

    // Prepare both the history snapshot and the public tree before swapping.
    // The manifest is only in history, never in the served bundle.
    let snapshot_tmp = dir.join(format!("snapshot.{}", unique_suffix()));
    copy_tree(&staging_tmp, &snapshot_tmp)?;
    fs::write(
        snapshot_tmp.join("manifest.json"),
        serde_json::to_vec_pretty(manifest)?,
    )
    .map_err(SiteError::Io)?;
    sync_tree(&snapshot_tmp)?;
    sync_tree(&staging_tmp)?;
    let snap = dir.join(format!("versions/{next_version}"));
    fs::create_dir_all(dir.join("versions")).map_err(SiteError::Io)?;
    fs::rename(&snapshot_tmp, &snap).map_err(SiteError::Io)?;
    sync_dir(&dir.join("versions"))?;
    let bundle = dir.join(format!("bundles/{next_version}"));
    fs::create_dir_all(dir.join("bundles")).map_err(SiteError::Io)?;
    fs::rename(&staging_tmp, &bundle).map_err(SiteError::Io)?;
    sync_dir(&dir.join("bundles"))?;

    // Record update: redirects from prior URLs, epoch bump.
    let mut record = load_record(data_dir, &manifest.site_id)?;

    if !record.versions.contains(&next_version) {
        record.versions.push(next_version);
        record.versions.sort_unstable();
    }
    // Permalink stability: paths that vanished since the previous version
    // redirect to the site home instead of 404ing bookmarks.
    if let Some(prev) = record.live_version {
        if let Ok(old_manifest) = load_version_manifest(data_dir, &manifest.site_id, prev) {
            let new_paths: std::collections::BTreeSet<&str> =
                manifest.pages.iter().map(|p| p.path.as_str()).collect();
            for old in &old_manifest.pages {
                if !new_paths.contains(old.path.as_str())
                    && !record.redirects.contains_key(&old.path)
                {
                    record
                        .redirects
                        .insert(old.path.clone(), "index.html".to_string());
                }
            }
        }
    }
    let previous = record.live_version;
    if let Err(error) = replace_live(&dir, next_version) {
        restore_live(&dir, previous)?;
        return Err(error);
    }
    record.live_version = Some(next_version);
    record.cache_epoch = record.cache_epoch.saturating_add(1);
    if let Err(error) = save_record(data_dir, &record) {
        restore_live(&dir, previous)?;
        return Err(error);
    }
    let _ = discard_legacy_backup(&dir); // Reconciliation can retry cleanup.
    Ok((record, next_version))
}

fn manifest_page_sha(manifest: &PublishManifest, path: &str) -> Result<String, SiteError> {
    manifest
        .pages
        .iter()
        .find(|p| p.path == path)
        .map(|p| p.html_sha.clone())
        .ok_or_else(|| SiteError::Manifest(ManifestError::BodyMismatch("pages".to_string())))
}

fn manifest_asset_sha(manifest: &PublishManifest, path: &str) -> Result<String, SiteError> {
    manifest
        .assets
        .iter()
        .find(|a| a.path == path)
        .map(|a| a.sha.clone())
        .ok_or_else(|| SiteError::Manifest(ManifestError::BodyMismatch("assets".to_string())))
}

/// Only deterministic, inert asset types enter the public tree. JavaScript
/// assets have no verified static projector, and CSS cannot fetch remotely.
pub fn validate_public_asset(path: &str, bytes: &[u8]) -> Result<(), SiteError> {
    let okay = if path.ends_with(".css") {
        std::str::from_utf8(bytes).is_ok_and(|css| {
            let lower = css.to_ascii_lowercase();
            !css.contains('\\')
                && !css
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
                && !lower.contains("@import")
                && !lower.contains("url(")
                && !lower.contains("expression(")
                && !lower.contains("behavior:")
                && !lower.contains("@font-face")
                && !lower.contains("-moz-binding")
                && !lower.contains("image-set(")
                && !lower.contains("http:")
                && !lower.contains("https:")
                && !lower.contains("//")
        })
    } else if path.ends_with(".png") {
        bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        bytes.starts_with(&[0xff, 0xd8, 0xff])
    } else if path.ends_with(".webp") {
        bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..])
    } else if path.ends_with(".ico") {
        bytes.starts_with(&[0, 0, 1, 0])
    } else {
        false
    };
    if okay {
        Ok(())
    } else {
        Err(SiteError::BadPath(path.to_string()))
    }
}

fn decode_asset(asset: &AssetBody) -> Result<Vec<u8>, SiteError> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(&asset.bytes_b64)
        .map_err(|e| SiteError::Base64(format!("{}: {e}", asset.path)))
}

fn write_staged(staging: &Path, path: &str, bytes: &[u8]) -> Result<(), SiteError> {
    if path != ".fub-cache-epoch" {
        check_publish_path(path).map_err(SiteError::Manifest)?;
    }
    let dest = staging.join(path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(SiteError::Io)?;
    }
    fs::write(&dest, bytes).map_err(SiteError::Io)?;
    Ok(())
}

fn next_version_number(data_dir: &Path, site_id: &str) -> Result<u64, SiteError> {
    let dir = site_dir(data_dir, site_id);
    let record = load_record(data_dir, site_id)?;
    // A crash after preparing a bundle but before saving record.json leaves
    // an uncommitted copy. Do not let it block a retry of the same version.
    for parent in ["versions", "bundles"] {
        let parent_dir = dir.join(parent);
        match fs::read_dir(&parent_dir) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry.map_err(SiteError::Io)?;
                    let Some(version) = entry
                        .file_name()
                        .to_str()
                        .and_then(|s| s.parse::<u64>().ok())
                    else {
                        continue;
                    };
                    if !record.versions.contains(&version) {
                        fs::remove_dir_all(entry.path()).map_err(SiteError::Io)?;
                    }
                }
                sync_dir(&parent_dir)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(SiteError::Io(error)),
        }
    }
    record
        .versions
        .iter()
        .max()
        .copied()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| SiteError::QuotaExceeded("version overflow".to_string()))
}
pub fn current_manifest(
    data_dir: &Path,
    site_id: &str,
) -> Result<Option<PublishManifest>, SiteError> {
    let record = load_record(data_dir, site_id)?;
    record
        .live_version
        .map(|version| load_version_manifest(data_dir, site_id, version))
        .transpose()
}

fn load_version_manifest(
    data_dir: &Path,
    site_id: &str,
    version: u64,
) -> Result<PublishManifest, SiteError> {
    let bytes =
        fs::read(site_dir(data_dir, site_id).join(format!("versions/{version}/manifest.json")))
            .map_err(SiteError::Io)?;
    serde_json::from_slice(&bytes).map_err(SiteError::Json)
}

fn leaks_into_strings(leaks: Vec<super::guard::Leak>) -> Vec<String> {
    leaks
        .into_iter()
        .map(|l| format!("{} leaks into {}", l.doc_id, l.surface))
        .collect()
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), SiteError> {
    fs::create_dir_all(dst).map_err(SiteError::Io)?;
    for entry in fs::read_dir(src).map_err(SiteError::Io)? {
        let entry = entry.map_err(SiteError::Io)?;
        let (s, d) = (entry.path(), dst.join(entry.file_name()));
        if s.is_dir() {
            copy_tree(&s, &d)?;
        } else {
            fs::copy(&s, &d).map_err(SiteError::Io)?;
        }
    }
    Ok(())
}

/// A version's manifest is private metadata and must not be copied into live.
fn ensure_bundle(dir: &Path, version: u64) -> Result<(), SiteError> {
    let bundle = dir.join(format!("bundles/{version}"));
    if bundle.is_dir() {
        return Ok(());
    }
    let snap = dir.join(format!("versions/{version}"));
    if !snap.is_dir() {
        return Err(SiteError::VersionNotFound {
            site: dir
                .file_name()
                .expect("site directory has a name")
                .to_string_lossy()
                .into_owned(),
            version,
        });
    }
    fs::create_dir_all(dir.join("bundles")).map_err(SiteError::Io)?;
    let temp = dir.join(format!("bundle.{}", unique_suffix()));
    copy_tree(&snap, &temp)?;
    let metadata = temp.join("manifest.json");
    if metadata.exists() {
        fs::remove_file(metadata).map_err(SiteError::Io)?;
    }
    sync_tree(&temp)?;
    fs::rename(temp, bundle).map_err(SiteError::Io)?;
    sync_dir(&dir.join("bundles"))
}

/// Rende durevole l'elenco di una cartella dopo una rename.
///
/// Su Windows una cartella non si apre come file (`File::open` risponde
/// «accesso negato»): la rename resta quella ordinaria, il limite di
/// piattaforma della decisione 0202 che vale anche per gli snapshot del
/// kernel. Un errore vero sui metadati resta un errore.
fn sync_dir(dir: &Path) -> Result<(), SiteError> {
    #[cfg(windows)]
    {
        fs::symlink_metadata(dir).map(drop).map_err(SiteError::Io)
    }
    #[cfg(not(windows))]
    {
        fs::File::open(dir)
            .and_then(|file| file.sync_all())
            .map_err(SiteError::Io)
    }
}

fn sync_tree(dir: &Path) -> Result<(), SiteError> {
    for entry in fs::read_dir(dir).map_err(SiteError::Io)? {
        let path = entry.map_err(SiteError::Io)?.path();
        if path.is_dir() {
            sync_tree(&path)?;
        } else {
            // Scrivibile: su Windows lo fsync di uno handle di sola lettura
            // fallisce.
            fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .and_then(|file| file.sync_all())
                .map_err(SiteError::Io)?;
        }
    }
    sync_dir(dir)
}

fn remove_live(dir: &Path) -> Result<(), SiteError> {
    let live = dir.join("live");
    match fs::symlink_metadata(&live) {
        Ok(meta) if meta.file_type().is_symlink() || meta.is_file() => {
            fs::remove_file(&live).map_err(SiteError::Io)?
        }
        Ok(_) => fs::remove_dir_all(&live).map_err(SiteError::Io)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(SiteError::Io(error)),
    }
    sync_dir(dir)
}

#[cfg(unix)]
fn link_bundle(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn link_bundle(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

fn replace_live(dir: &Path, version: u64) -> Result<(), SiteError> {
    ensure_bundle(dir, version)?;
    let live = dir.join("live");
    let temp = dir.join(format!(".live-link-{}", unique_suffix()));
    link_bundle(&PathBuf::from(format!("bundles/{version}")), &temp).map_err(SiteError::Io)?;
    if fs::symlink_metadata(&live).is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
    {
        fs::rename(&live, dir.join(".live-previous")).map_err(SiteError::Io)?;
    }
    fs::rename(&temp, &live).map_err(SiteError::Io)?;
    sync_dir(dir)
}

fn restore_live(dir: &Path, previous: Option<u64>) -> Result<(), SiteError> {
    let backup = dir.join(".live-previous");
    match previous {
        None => remove_live(dir)?,
        Some(_) if backup.is_dir() => {
            remove_live(dir)?;
            fs::rename(backup, dir.join("live")).map_err(SiteError::Io)?;
            sync_dir(dir)?;
        }
        Some(version) => replace_live(dir, version)?,
    }
    Ok(())
}

fn discard_legacy_backup(dir: &Path) -> Result<(), SiteError> {
    let backup = dir.join(".live-previous");
    if backup.is_dir() {
        fs::remove_dir_all(backup).map_err(SiteError::Io)?;
        sync_dir(dir)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Unpublish / rollback / recovery / status.
// ---------------------------------------------------------------------------

/// Remove public access without deleting the versions or local vault. Persist
/// the unpublished pointer first, so a crash cannot republish an old version.
pub fn unpublish_site(data_dir: &Path, site_id: &str) -> Result<SiteRecord, SiteError> {
    let mut record = load_record(data_dir, site_id)?;
    record.live_version = None;
    record.cache_epoch = record.cache_epoch.saturating_add(1);
    save_record(data_dir, &record)?;
    let dir = site_dir(data_dir, site_id);
    remove_live(&dir)?;
    discard_legacy_backup(&dir)?;
    Ok(record)
}

/// Roll back the live tree to a prior snapshot version. The versions chain
/// is append-only history — rollback moves the live pointer, it never
/// rewrites the past.
pub fn rollback_site(
    data_dir: &Path,
    site_id: &str,
    to_version: u64,
) -> Result<SiteRecord, SiteError> {
    recover_interrupted_commit(data_dir, site_id)?;
    let mut record = load_record(data_dir, site_id)?;
    if !record.versions.contains(&to_version) {
        return Err(SiteError::VersionNotFound {
            site: site_id.to_string(),
            version: to_version,
        });
    }
    let dir = site_dir(data_dir, site_id);
    ensure_bundle(&dir, to_version)?;
    let previous = record.live_version;
    if let Err(error) = replace_live(&dir, to_version) {
        restore_live(&dir, previous)?;
        return Err(error);
    }
    record.live_version = Some(to_version);
    record.cache_epoch = record.cache_epoch.saturating_add(1);
    if let Err(error) = save_record(data_dir, &record) {
        restore_live(&dir, previous)?;
        return Err(error);
    }
    let _ = discard_legacy_backup(&dir); // Record and live pointer are already committed.
    Ok(record)
}

/// Reconcile the public pointer against the durable record. A missing live
/// tree is repaired from the recorded version, never the newest snapshot:
/// newer snapshots may be uncommitted, and None denotes unpublication.
/// Returns the restored version only when a published tree was repaired.
pub fn recover_interrupted_commit(
    data_dir: &Path,
    site_id: &str,
) -> Result<Option<u64>, SiteError> {
    let record = load_record(data_dir, site_id)?;
    let dir = site_dir(data_dir, site_id);
    let live = dir.join("live");
    match record.live_version {
        None => {
            if fs::symlink_metadata(&live).is_ok() {
                remove_live(&dir)?;
            }
            discard_legacy_backup(&dir)?;
            Ok(None)
        }
        Some(version) => {
            let target = PathBuf::from(format!("bundles/{version}"));
            if fs::read_link(&live).is_ok_and(|link| link == target) && live.is_dir() {
                discard_legacy_backup(&dir)?;
                return Ok(None);
            }
            if live.is_dir()
                && fs::symlink_metadata(&live).is_ok_and(|m| !m.file_type().is_symlink())
                && !dir.join(".live-previous").exists()
            {
                // Pre-migration live directories have a version marker. Do not
                // trust a newer tree left live by an interrupted old commit.
                let marker = fs::read_to_string(live.join(".fub-cache-epoch"))
                    .ok()
                    .and_then(|text| text.trim().parse::<u64>().ok());
                if marker == Some(version) {
                    return Ok(None);
                }
            }
            restore_live(&dir, Some(version))?;
            Ok(Some(version))
        }
    }
}

pub fn read_live_version(data_dir: &Path, site_id: &str) -> Result<Option<u64>, SiteError> {
    Ok(load_record(data_dir, site_id)?.live_version)
}

/// Drop old snapshots, keeping the `keep` newest plus the live version.
/// Retention policy; never touches the live tree or the vault.
pub fn prune_versions(data_dir: &Path, site_id: &str, keep: usize) -> Result<Vec<u64>, SiteError> {
    let mut record = load_record(data_dir, site_id)?;
    if record.versions.len() <= keep {
        return Ok(Vec::new());
    }
    let mut sorted = record.versions.clone();
    sorted.sort_unstable();
    let live = record.live_version;
    let mut removed = Vec::new();
    while sorted.len() > keep {
        let oldest = sorted[0];
        if Some(oldest) == live {
            break;
        }
        sorted.remove(0);
        removed.push(oldest);
    }
    record.versions = sorted;
    save_record(data_dir, &record)?;
    for version in &removed {
        for parent in ["versions", "bundles"] {
            let path = site_dir(data_dir, site_id).join(format!("{parent}/{version}"));
            if path.exists() {
                fs::remove_dir_all(path).map_err(SiteError::Io)?;
            }
        }
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Static serving + redirects.
// ---------------------------------------------------------------------------

/// Resolve a static request path inside the live tree. Returns file bytes
/// and a content-type sniffed from the extension. Never escapes `live/`.
pub fn resolve_static(
    data_dir: &Path,
    site_id: &str,
    request_path: &str,
) -> Result<(Vec<u8>, String), SiteError> {
    recover_interrupted_commit(data_dir, site_id)?;
    let record = load_record(data_dir, site_id)?;
    if record.live_version.is_none() {
        return Err(SiteError::NotPublished(site_id.to_string()));
    }
    let clean = request_path.trim_start_matches('/');
    let clean = if clean.is_empty() {
        "index.html"
    } else {
        clean
    };
    if clean != ".fub-cache-epoch" {
        check_publish_path(clean).map_err(|_| SiteError::StaticNotFound(clean.to_string()))?;
    }
    // Redirects from prior URLs (permalinks) resolve before files.
    if let Some(target) = record.redirects.get(clean) {
        return resolve_static(data_dir, site_id, target);
    }
    let file = public_base_path(data_dir, site_id).join(clean);
    let bytes = fs::read(&file).map_err(|_| SiteError::StaticNotFound(clean.to_string()))?;
    Ok((bytes, content_type(clean)))
}

/// Look up a permalink redirect without serving. Used by the dispatcher to
/// emit 301s; file serving itself also follows them (see above).
pub fn resolve_redirect(
    data_dir: &Path,
    site_id: &str,
    request_path: &str,
) -> Result<Option<Redirect>, SiteError> {
    let record = load_record(data_dir, site_id)?;
    if record.live_version.is_none() {
        return Ok(None);
    }
    let clean = request_path.trim_start_matches('/');
    Ok(record.redirects.get(clean).map(|to| Redirect {
        from: clean.to_string(),
        to: to.clone(),
    }))
}

fn content_type(path: &str) -> String {
    static_content_type(path).to_string()
}

// ---------------------------------------------------------------------------
// Status: live pointer, version chain, counts, password flag.
// ---------------------------------------------------------------------------

/// Build the additive status response for the host client / publish panel.
/// `site:<id>` ACL and session checks happen in the parent dispatcher —
/// this only reads the record and the live tree.
pub fn status_of(data_dir: &Path, site_id: &str) -> Result<StatusResponse, SiteError> {
    let record = load_record(data_dir, site_id)?;
    recover_interrupted_commit(data_dir, site_id)?;
    let live = public_base_path(data_dir, site_id);
    let (mut page_count, mut asset_count) = (0usize, 0usize);
    if live.is_dir() {
        count_live(&live, &mut page_count, &mut asset_count)?;
    }
    Ok(StatusResponse {
        site_id: site_id.to_string(),
        live_version: record.live_version,
        versions: record.versions.clone(),
        page_count,
        asset_count,
        password_protected: record.password_hash.is_some(),
    })
}

fn count_live(dir: &Path, pages: &mut usize, assets: &mut usize) -> Result<(), SiteError> {
    for entry in fs::read_dir(dir).map_err(SiteError::Io)? {
        let entry = entry.map_err(SiteError::Io)?;
        let path = entry.path();
        if path.is_dir() {
            count_live(&path, pages, assets)?;
        } else if path.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "manifest.json"
                || name == "search-index.json"
                || name == "graph.json"
                || name == "feed.xml"
                || name == "sitemap.xml"
                || name == "robots.txt"
                || name == ".fub-cache-epoch"
            {
                continue;
            }
            if path.extension().map(|e| e == "html").unwrap_or(false) {
                *pages += 1;
            } else {
                *assets += 1;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Derived site features, all computed from the published set only.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchEntry {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    pub title: String,
    pub text: String,
}

/// Search index over published pages only: strip tags, keep title + text.
/// Excluded docs never reach this function — it only sees staged pages.
pub fn build_search_index(pages: &[StagedPage<'_>]) -> String {
    let entries: Vec<SearchEntry> = pages
        .iter()
        .map(|p| SearchEntry {
            path: p.path.to_string(),
            doc_id: p.doc_id.map(str::to_string),
            title: page_title(p.path, p.html),
            text: strip_tags(p.html),
        })
        .collect();
    serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string())
}

/// Backlinks + graph limited to the published set: a link counts only when
/// both ends are published pages. `path_prefix` scopes multi-site routing.
pub fn build_site_graph(site_id: &str, pages: &[StagedPage<'_>]) -> String {
    use std::collections::BTreeSet;
    let known: BTreeSet<&str> = pages.iter().map(|p| p.path).collect();
    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut edges: Vec<serde_json::Value> = Vec::new();
    for page in pages {
        nodes.push(serde_json::json!({
            "path": page.path,
            "title": page_title(page.path, page.html),
        }));
        for href in extract_hrefs(page.html) {
            let base = format!("/s/{site_id}/");
            let target = href.strip_prefix(&base).unwrap_or(&href);
            let target = target.split('#').next().unwrap_or("");
            if known.contains(target) {
                edges.push(serde_json::json!({ "from": page.path, "to": target }));
            }
        }
    }
    serde_json::to_string(&serde_json::json!({ "nodes": nodes, "edges": edges }))
        .unwrap_or_else(|_| "{\"nodes\":[],\"edges\":[]}".to_string())
}

/// Outline of a published page: the h1–h3 headings in document order.
pub fn page_outline(html: &str) -> Vec<(u8, String)> {
    let mut outline = Vec::new();
    let mut rest = html;
    while let Some(open) = rest.find("<h") {
        let tail = &rest[open..];
        let level = match tail.chars().nth(2) {
            Some('1') => 1,
            Some('2') => 2,
            Some('3') => 3,
            _ => {
                rest = &tail[2.min(tail.len())..];
                continue;
            }
        };
        let Some(start) = tail.find('>') else { break };
        let after = &tail[start + 1..];
        let Some(end) = after.find("</h") else { break };
        outline.push((level, strip_tags(&after[..end])));
        rest = &after[end..];
    }
    outline
}

/// Site navigation: home-first titles for every published HTML page.
pub fn build_nav(pages: &[StagedPage<'_>], home: &str) -> Vec<(String, String)> {
    let mut nav: Vec<(String, String)> = pages
        .iter()
        .filter(|p| p.path.ends_with(".html"))
        .map(|p| (p.path.to_string(), page_title(p.path, p.html)))
        .collect();
    nav.sort_by(|a, b| {
        if a.0 == home {
            std::cmp::Ordering::Less
        } else if b.0 == home {
            std::cmp::Ordering::Greater
        } else {
            a.0.cmp(&b.0)
        }
    });
    nav
}

/// SEO/social head fragment for a published page. No tracking, no remote
/// content by default — just title, description and canonical path.
pub fn public_base(record: &SiteRecord) -> String {
    if let Some(tls) = &record.tls {
        let intent = TlsConfig {
            provisioned: false,
            ..tls.clone()
        };
        if tls.provisioned && valid_tls_intent(&intent) {
            return format!("https://{}{}", tls.domain, tls.path_prefix);
        }
    }
    format!("/s/{}/", record.site_id)
}

pub fn seo_head(record: &SiteRecord, path: &str, title: &str, description: &str) -> String {
    use super::guard::escape_html;
    format!(
        "<title>{}</title>\n<meta name=\"description\" content=\"{}\">\n<link rel=\"canonical\" href=\"{}{}\">\n<meta property=\"og:title\" content=\"{}\">\n<meta property=\"og:description\" content=\"{}\">\n",
        escape_html(title),
        escape_html(description),
        escape_html(&public_base(record)),
        escape_html(path),
        escape_html(title),
        escape_html(description),
    )
}

pub fn build_sitemap(record: &SiteRecord, pages: &[StagedPage<'_>]) -> String {
    use super::guard::escape_html;
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset>\n");
    for page in pages {
        if page.path.ends_with(".html") {
            out.push_str(&format!(
                "<url><loc>{}{}</loc></url>\n",
                escape_html(&public_base(record)),
                escape_html(page.path)
            ));
        }
    }
    out.push_str("</urlset>\n");
    out
}

pub fn build_feed(record: &SiteRecord, pages: &[StagedPage<'_>]) -> String {
    use super::guard::escape_html;
    let mut out = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\"><channel><title>{}</title>\n",
        escape_html(&record.site_id)
    );
    for page in pages {
        if page.path.ends_with(".html") {
            out.push_str(&format!(
                "<item><title>{}</title><link>{}{}</link></item>\n",
                escape_html(&page_title(page.path, page.html)),
                escape_html(&public_base(record)),
                escape_html(page.path)
            ));
        }
    }
    out.push_str("</channel></rss>\n");
    out
}

pub fn build_robots() -> String {
    "User-agent: *\nAllow: /\n".to_string()
}

pub(crate) fn page_title(path: &str, html: &str) -> String {
    if let Some(start) = html.find("<h1") {
        let tag = &html[start + 3..];
        if let Some(close) = tag.find('>') {
            let after = &tag[close + 1..];
            if let Some(end) = after.find("</h1>") {
                return strip_tags(&after[..end]);
            }
        }
    }
    if let Some(start) = html.find("<title>") {
        let after = &html[start + 7..];
        if let Some(end) = after.find("</title>") {
            return strip_tags(&after[..end]);
        }
    }
    path.trim_end_matches(".html").to_string()
}

pub(crate) fn strip_tags(html: &str) -> String {
    let mut plain = String::with_capacity(html.len());
    let mut inside = false;
    for ch in html.chars() {
        match ch {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => plain.push(ch),
            _ => {}
        }
    }
    let mut decoded = String::with_capacity(plain.len());
    let mut rest = plain.as_str();
    while let Some(start) = rest.find('&') {
        decoded.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let entity = after.find(';').filter(|&end| end <= 12).and_then(|end| {
            let name = &after[..end];
            let character = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .and_then(|digits| u32::from_str_radix(digits, 16).ok())
                    .or_else(|| {
                        name.strip_prefix('#')
                            .and_then(|digits| digits.parse().ok())
                    })
                    .and_then(char::from_u32)
                    .filter(|ch| !ch.is_control()),
            };
            character.map(|ch| (ch, end))
        });
        if let Some((ch, end)) = entity {
            decoded.push(ch);
            rest = &after[end + 1..];
        } else {
            decoded.push('&');
            rest = after;
        }
    }
    decoded.push_str(rest);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn extract_hrefs(html: &str) -> Vec<String> {
    extract_attributes(html, "href=\"")
}

fn extract_attributes(html: &str, prefix: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find(prefix) {
        let after = &rest[pos + prefix.len()..];
        if let Some(end) = after.find('"') {
            values.push(after[..end].to_string());
            rest = &after[end + 1..];
        } else {
            break;
        }
    }
    values
}

// ---------------------------------------------------------------------------
// Access gate.
// ---------------------------------------------------------------------------

/// Site password gate: None hash means public. Otherwise the caller must
/// present either the password (verified constant-time via PBKDF2) or a
/// valid bearer token (compared constant-time by the dispatcher).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PasswordGate {
    Public,
    Locked { password_ok: bool },
}

pub fn check_password_gate(record: &SiteRecord, password: Option<&str>) -> PasswordGate {
    match &record.password_hash {
        None => PasswordGate::Public,
        Some(hash) => {
            let ok = password
                .map(|p| super::guard::verify_site_password(p, hash))
                .unwrap_or(false);
            PasswordGate::Locked { password_ok: ok }
        }
    }
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SiteError {
    #[error("site not found: {0}")]
    SiteNotFound(String),
    #[error("site already exists: {0}")]
    AlreadyExists(String),
    #[error("site has no live version: {0}")]
    NotPublished(String),
    #[error("version not found: site {site} has no version {version}")]
    VersionNotFound { site: String, version: u64 },
    #[error("static file not found: {0}")]
    StaticNotFound(String),
    #[error("sha mismatch: {0}")]
    ShaMismatch(String),
    #[error("quota exceeded: {0}")]
    QuotaExceeded(String),
    #[error("private note would leak: {0:?}")]
    PrivateLeak(Vec<String>),
    #[error("stale publish version: expected {expected}, received {received}")]
    StaleVersion { expected: u64, received: u64 },
    #[error("empty owner")]
    EmptyOwner,
    #[error("bad path: {0}")]
    BadPath(String),
    #[error("base64: {0}")]
    Base64(String),
    #[error("manifest: {0}")]
    Manifest(#[from] ManifestError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod lifecycle_tests {
    use super::super::manifest::{AssetEntry, PageBody, PageEntry};
    use super::*;
    use base64::Engine as _;

    fn fixture() -> PathBuf {
        let data = std::env::temp_dir().join(format!("fub-publish-site-{}", uuid::Uuid::new_v4()));
        create_site(&data, "blog", "alice", None).unwrap();
        data
    }

    fn request(html: &str) -> CommitRequest {
        CommitRequest {
            protocol: "fub-publish/1".to_string(),
            site_id: "blog".to_string(),
            manifest: PublishManifest {
                site_id: "blog".to_string(),
                version: 1,
                allowlist: vec!["index.html".to_string()],
                pages: vec![PageEntry {
                    path: "index.html".to_string(),
                    doc_id: Some("notes/public.md".to_string()),
                    html_sha: sha256_hex(html.as_bytes()),
                }],
                assets: Vec::new(),
                no_private_leak: true,
            },
            pages: vec![PageBody {
                path: "index.html".to_string(),
                doc_id: Some("notes/public.md".to_string()),
                html: html.to_string(),
            }],
            assets: Vec::new(),
            excluded_private: Vec::new(),
        }
    }

    fn publish(data: &Path, html: &str) -> u64 {
        let mut request = request(html);
        request.manifest.version = load_record(data, "blog")
            .unwrap()
            .versions
            .iter()
            .max()
            .copied()
            .unwrap_or(0)
            + 1;
        commit_site(
            data,
            &request,
            &[],
            SiteQuota {
                max_asset_bytes: 1024,
                max_site_bytes: 4096,
            },
            16,
            1,
            false,
        )
        .unwrap()
        .1
    }

    #[test]
    fn unpublished_pointer_survives_recovery_even_with_history_and_stale_live() {
        let data = fixture();
        fs::write(data.join("vault-sentinel"), b"local secret").unwrap();
        assert_eq!(publish(&data, "<h1>public</h1>"), 1);
        unpublish_site(&data, "blog").unwrap();
        let dir = site_dir(&data, "blog");
        link_bundle(Path::new("bundles/1"), &dir.join("live")).unwrap();
        assert_eq!(recover_interrupted_commit(&data, "blog").unwrap(), None);
        assert!(matches!(
            resolve_static(&data, "blog", "index.html"),
            Err(SiteError::NotPublished(_))
        ));
        assert_eq!(status_of(&data, "blog").unwrap().versions, vec![1]);
        assert!(!dir.join("live").exists());
        assert_eq!(
            fs::read(data.join("vault-sentinel")).unwrap(),
            b"local secret"
        );
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn interrupted_rollback_reconciles_to_durable_pointer_without_leaking_manifest() {
        let data = fixture();
        assert_eq!(publish(&data, "one"), 1);
        assert_eq!(publish(&data, "two"), 2);
        let dir = site_dir(&data, "blog");
        let temp = dir.join(".simulated-swap");
        link_bundle(Path::new("bundles/1"), &temp).unwrap();
        fs::rename(&temp, dir.join("live")).unwrap(); // crash before record update
        assert_eq!(recover_interrupted_commit(&data, "blog").unwrap(), Some(2));
        assert!(
            String::from_utf8(resolve_static(&data, "blog", "index.html").unwrap().0)
                .unwrap()
                .contains("<main>two</main>")
        );
        let (html, content_type) = resolve_static(&data, "blog", "index.html").unwrap();
        match crate::site_isolation::serve_headers(&data, "blog", None, &content_type, &html) {
            crate::site_isolation::ServeDecision::Allow(headers) => {
                let policy = headers
                    .iter()
                    .find(|(name, _)| *name == "content-security-policy")
                    .unwrap();
                assert!(
                    !policy.1.contains("sandbox"),
                    "safe assembled pages retain their own origin"
                );
            }
            crate::site_isolation::ServeDecision::DenyOrigin => panic!("local site denied"),
        }
        rollback_site(&data, "blog", 1).unwrap();
        link_bundle(Path::new("bundles/2"), &temp).unwrap();
        fs::rename(&temp, dir.join("live")).unwrap(); // stale live after committed rollback
        assert_eq!(recover_interrupted_commit(&data, "blog").unwrap(), Some(1));
        assert!(
            String::from_utf8(resolve_static(&data, "blog", "index.html").unwrap().0)
                .unwrap()
                .contains("<main>one</main>")
        );
        assert!(matches!(
            resolve_static(&data, "blog", "manifest.json"),
            Err(SiteError::StaticNotFound(_))
        ));
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn replayed_manifest_cannot_replace_live_and_crash_orphan_does_not_block_retry() {
        let data = fixture();
        publish(&data, "one");
        let stale = request("stale");
        assert!(matches!(
            commit_site(
                &data,
                &stale,
                &[],
                SiteQuota {
                    max_asset_bytes: 1024,
                    max_site_bytes: 4096,
                },
                16,
                1,
                false
            ),
            Err(SiteError::StaleVersion {
                expected: 2,
                received: 1
            })
        ));
        assert!(
            String::from_utf8(resolve_static(&data, "blog", "index.html").unwrap().0)
                .unwrap()
                .contains("<main>one</main>")
        );
        let dir = site_dir(&data, "blog");
        fs::create_dir_all(dir.join("versions/2")).unwrap();
        fs::create_dir_all(dir.join("bundles/2")).unwrap();
        assert_eq!(publish(&data, "two"), 2);
        assert!(
            String::from_utf8(resolve_static(&data, "blog", "index.html").unwrap().0)
                .unwrap()
                .contains("<main>two</main>")
        );
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn unavailable_rollback_snapshot_leaves_published_tree_intact() {
        let data = fixture();
        publish(&data, "one");
        publish(&data, "two");
        let dir = site_dir(&data, "blog");
        fs::remove_dir_all(dir.join("versions/1")).unwrap();
        fs::remove_dir_all(dir.join("bundles/1")).unwrap();
        assert!(matches!(
            rollback_site(&data, "blog", 1),
            Err(SiteError::VersionNotFound { .. })
        ));
        assert!(
            String::from_utf8(resolve_static(&data, "blog", "index.html").unwrap().0)
                .unwrap()
                .contains("<main>two</main>")
        );
        assert_eq!(load_record(&data, "blog").unwrap().live_version, Some(2));
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn private_non_utf8_asset_and_excluded_page_do_not_replace_live() {
        let data = fixture();
        publish(&data, "old");
        let mut request = request("new");
        request.manifest.version = 2;
        let bytes = b"\x89PNG\r\n\x1a\n\xffnotes/private.md\x00";
        request.manifest.allowlist.push("image.png".to_string());
        request.manifest.assets.push(AssetEntry {
            path: "image.png".to_string(),
            sha: sha256_hex(bytes),
        });
        request.assets.push(AssetBody {
            path: "image.png".to_string(),
            sha: sha256_hex(bytes),
            bytes_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
        let excluded = ["notes/private.md".to_string()];
        assert!(matches!(
            commit_site(
                &data,
                &request,
                &excluded,
                SiteQuota {
                    max_asset_bytes: 1024,
                    max_site_bytes: 4096,
                },
                16,
                1,
                false
            ),
            Err(SiteError::PrivateLeak(_))
        ));
        assert!(
            String::from_utf8(resolve_static(&data, "blog", "index.html").unwrap().0)
                .unwrap()
                .contains("<main>old</main>")
        );
        request.manifest.assets.clear();
        request.assets.clear();
        request.pages[0].doc_id = Some("notes/private.md".to_string());
        request.manifest.pages[0].doc_id = request.pages[0].doc_id.clone();
        assert!(matches!(
            commit_site(
                &data,
                &request,
                &excluded,
                SiteQuota {
                    max_asset_bytes: 1024,
                    max_site_bytes: 4096,
                },
                16,
                1,
                false
            ),
            Err(SiteError::PrivateLeak(_))
        ));
        assert_eq!(status_of(&data, "blog").unwrap().live_version, Some(1));
        fs::remove_dir_all(data).unwrap();
    }
}
