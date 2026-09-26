//! Publish slice (P17): selective static publishing with no private leak.
//!
//! The backend verifies manifest hashes, assembles static page chrome and
//! scans the full projected bundle before atomic staging. It never reads the vault.
//! Account sessions, MFA and ACL checks live in the parent modules — this
//! module owns the wire contract, the manifest logic ([`manifest`]), the
//! site lifecycle ([`site`]) and the rendering/access guards ([`guard`]).
//!
//! Publish never depends on sync: the only shared surface is authentication,
//! which the parent injects (account store / ACL check) at the `handle`
//! boundary. Protocol versions come from the parent [`routing`] module —
//! never redefined here, so the two slices cannot diverge.

mod assembly;
pub mod guard;
pub mod manifest;
pub mod site;

pub use guard::{
    assert_no_leakage, escape_html, hash_site_password, is_safe_href, sha256_hex,
    verify_site_password, BearerToken, EmbedKind, Leak, PreflightError, PublishedBundle,
    PublishedSurface,
};
pub use manifest::{
    check_publish_path, check_site_id, diff_manifest, glob_match, matches_allowlist, plan_dry_run,
    validate_manifest_for_commit, AssetBody, AssetEntry, CommitRequest, CommitResponse,
    DryRunRequest, DryRunResponse, LinkedDoc, ManifestDiff, PageBody, PageEntry, PublishManifest,
    RollbackRequest, RollbackResponse, StatusResponse, UnpublishRequest, UnpublishResponse,
};
pub use site::{
    build_feed, build_nav, build_robots, build_search_index, build_site_graph, build_sitemap,
    can_administer, can_publish, check_password_gate, commit_site, content_type_for, create_site,
    load_record, page_outline, prune_versions, public_base_path, read_live_version,
    recover_interrupted_commit, resolve_redirect, resolve_static, revoke_collaborator,
    rollback_site, save_record, seo_head, site_dir, sites_root, static_content_type, status_of,
    unpublish_site, PasswordGate, Redirect, SearchEntry, SiteQuota, SiteRecord, StagedPage,
    TlsConfig,
};

/// Wire protocol version — single source of truth is the parent routing
/// module; mismatch is a hard error, never a fallback.
pub use crate::routing::PUBLISH_PROTOCOL;
/// Server identification returned by `GET /v1/hello`.
pub use crate::routing::SERVER_IDENT as SERVICES_SERVER;

/// Endpoint paths served by the parent router (`main.rs` dispatches
/// `/v1/publish/*` and `/s/*` here).
pub const HELLO_PATH: &str = "/v1/hello";
pub const DRY_RUN_PATH: &str = "/v1/publish/dry-run";
pub const COMMIT_PATH: &str = "/v1/publish/commit";
pub const SITE_ADMIN_PATH: &str = "/v1/publish/site";
pub const UNPUBLISH_PATH: &str = "/v1/publish/unpublish";
pub const ROLLBACK_PATH: &str = "/v1/publish/rollback";
/// Additive status read (GET with `?site_id=`), needed by the host client and
/// the publish panel. Not part of the minimal contract, no fallback implied.
pub const STATUS_PATH: &str = "/v1/publish/status";
/// Static prefix: `GET /s/<site>/...` serves the live tree, behind the
/// site-password / bearer gate enforced by the parent router.
pub const SITE_PREFIX: &str = "/s/";

/// Hard protocol check: anything but [`PUBLISH_PROTOCOL`] is an error, never
/// a silent fallback to another protocol version.
pub fn assert_protocol(peer: &str) -> Result<(), PublishError> {
    if peer == crate::routing::PUBLISH_PROTOCOL {
        Ok(())
    } else {
        Err(PublishError::ProtocolMismatch {
            expected: crate::routing::PUBLISH_PROTOCOL.to_string(),
            got: peer.to_string(),
        })
    }
}
/// Publish-slice errors. Authenticated identity and role decisions come from
/// the parent; these cover everything the slice itself can decide.
#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    #[error("protocol mismatch: expected {expected}, got {got}")]
    ProtocolMismatch { expected: String, got: String },
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("site not found: {0}")]
    SiteNotFound(String),
    #[error("version not found: site {site} has no version {version}")]
    VersionNotFound { site: String, version: u64 },
    #[error("static file not found: {0}")]
    StaticNotFound(String),
    #[error("quota exceeded: {0}")]
    QuotaExceeded(String),
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("invalid site id: {0}")]
    InvalidSiteId(String),
    #[error("preflight: {0}")]
    Preflight(#[from] guard::PreflightError),
    #[error("site: {0}")]
    Site(#[from] site::SiteError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("base64: {0}")]
    Base64(String),
}

// ---------------------------------------------------------------------------
// HTTP dispatch. `main.rs` routes `/v1/publish/*` and `GET /s/*` here with
// `&mut ServiceState` (single mutex in the binary). Publish never calls sync
// code; the only shared surface is `state.bearer` + the `site:<id>` ACL.
// ---------------------------------------------------------------------------

use crate::server::{HttpResponse, ServiceState};

/// ACL resource key for a site.
pub fn site_resource(site_id: &str) -> String {
    format!("site:{site_id}")
}

/// Entry point for the parent router: full path (`/v1/publish/commit`,
/// `/v1/publish/status?site_id=...`, `/s/<site>/...`), `auth` is the raw
/// `Authorization` header value (or None).
pub fn handle(
    state: &mut ServiceState,
    method: &str,
    path: &str,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let (base, query) = split_query(path);
    if base.starts_with(SITE_PREFIX) {
        if query_get(&query, "password").is_some() {
            return HttpResponse::err(400, "credentials in URL are forbidden");
        }
        return handle_static(state, method, base, auth, body);
    }
    match (method, base) {
        ("POST", SITE_ADMIN_PATH) => handle_site_admin(state, auth, body),
        ("POST", DRY_RUN_PATH) => handle_dry_run(state, auth, body),
        ("POST", COMMIT_PATH) => handle_commit(state, auth, body),
        ("POST", UNPUBLISH_PATH) => handle_unpublish(state, auth, body),
        ("POST", ROLLBACK_PATH) => handle_rollback(state, auth, body),
        ("GET", STATUS_PATH) => handle_status(state, auth, &query),
        _ => HttpResponse::err(404, "unknown publish route"),
    }
}

fn split_query(path: &str) -> (&str, Vec<(String, String)>) {
    let (base, query) = match path.find('?') {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => (path, ""),
    };
    let mut params = Vec::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = match pair.find('=') {
            Some(i) => (&pair[..i], &pair[i + 1..]),
            None => (pair, ""),
        };
        params.push((key.to_string(), value.to_string()));
    }
    (base, params)
}

fn query_get<'a>(query: &'a [(String, String)], key: &str) -> Option<&'a str> {
    query
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

fn account_of(state: &ServiceState, auth: Option<&str>) -> Result<String, HttpResponse> {
    state.bearer(auth)
}

/// Publish capability (dry-run, commit, rollback): owner always, otherwise a
/// `Writer` grant on `site:<id>`. A brand-new site (no record yet) is
/// creatable by any authenticated account, subject to the `max_sites` quota
/// enforced at commit time.
fn authorize_publish(
    state: &ServiceState,
    site_id: &str,
    account: &str,
) -> Result<(), HttpResponse> {
    match site::load_record(&state.data_dir, site_id) {
        Err(site::SiteError::SiteNotFound(_)) => Ok(()),
        Err(e) => Err(site_err(e)),
        Ok(record) => {
            if record.owner == account {
                return Ok(());
            }
            if record.revoked.iter().any(|r| r == account) {
                return Err(HttpResponse::err(403, "revoked"));
            }
            if let Some(role) = record.collaborator_roles.get(account) {
                if !role.covers(crate::acl::Role::Writer) {
                    return Err(HttpResponse::err(403, "role too low"));
                }
                return Ok(());
            }
            match state.acls.get(&site_resource(site_id)) {
                Some(acl) => crate::acl::check(acl, account, crate::acl::Role::Writer)
                    .map_err(|e| HttpResponse::err(403, &e)),
                None => Err(HttpResponse::err(403, "no grant")),
            }
        }
    }
}

/// Administer capability (unpublish, password/domain, revoke): owner always,
/// otherwise an `Admin` grant. New sites have nothing to administer.
fn authorize_administer(
    state: &ServiceState,
    site_id: &str,
    account: &str,
) -> Result<(), HttpResponse> {
    match site::load_record(&state.data_dir, site_id) {
        Err(site::SiteError::SiteNotFound(_)) => Err(HttpResponse::err(404, "site not found")),
        Err(e) => Err(site_err(e)),
        Ok(record) => {
            if record.owner == account {
                return Ok(());
            }
            if record.revoked.iter().any(|r| r == account) {
                return Err(HttpResponse::err(403, "revoked"));
            }
            if let Some(role) = record.collaborator_roles.get(account) {
                if !role.covers(crate::acl::Role::Admin) {
                    return Err(HttpResponse::err(403, "role too low"));
                }
                return Ok(());
            }
            match state.acls.get(&site_resource(site_id)) {
                Some(acl) => crate::acl::check(acl, account, crate::acl::Role::Admin)
                    .map_err(|e| HttpResponse::err(403, &e)),
                None => Err(HttpResponse::err(403, "no grant")),
            }
        }
    }
}

/// Read capability (status, password-gated static): owner or any grant.
/// Revoked collaborators are rejected even if a stale grant lingers.
fn authorize_read(state: &ServiceState, site_id: &str, account: &str) -> Result<(), HttpResponse> {
    match site::load_record(&state.data_dir, site_id) {
        Err(site::SiteError::SiteNotFound(_)) => Err(HttpResponse::err(404, "site not found")),
        Err(e) => Err(site_err(e)),
        Ok(record) => {
            if record.owner == account {
                return Ok(());
            }
            if record.revoked.iter().any(|r| r == account) {
                return Err(HttpResponse::err(403, "revoked"));
            }
            if record.collaborator_roles.contains_key(account) {
                return Ok(());
            }
            match state.acls.get(&site_resource(site_id)) {
                Some(acl) if acl.role_of(account).is_some() => Ok(()),
                _ => Err(HttpResponse::err(403, "no grant")),
            }
        }
    }
}

fn check_wire_protocol(peer: &str) -> Result<(), HttpResponse> {
    assert_protocol(peer).map_err(|_| HttpResponse::err(400, "protocol mismatch"))
}

/// Additive owner endpoint. TLS is an operator intent, never a claim that a
/// certificate was issued. No hash or plaintext password is returned.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SiteAdminRequest {
    protocol: String,
    site_id: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    clear_password: bool,
    #[serde(default)]
    tls: Option<site::TlsConfig>,
    #[serde(default)]
    clear_tls: bool,
    #[serde(default)]
    theme_css: Option<String>,
    #[serde(default)]
    favicon: Option<String>,
    #[serde(default)]
    grant: Option<SiteGrant>,
    #[serde(default)]
    revoke: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SiteGrant {
    account_id: String,
    role: crate::acl::Role,
}

pub fn handle_site_admin(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let request: SiteAdminRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad site administration body"),
    };
    if let Err(r) = check_wire_protocol(&request.protocol) {
        return r;
    }
    if let Err(e) = manifest::check_site_id(&request.site_id) {
        return HttpResponse::err(400, &e.to_string());
    }
    if request.password.is_some() && request.clear_password {
        return HttpResponse::err(400, "conflicting password operations");
    }
    let existing = match site::load_record(&state.data_dir, &request.site_id) {
        Ok(r) => Some(r),
        Err(site::SiteError::SiteNotFound(_)) => None,
        Err(e) => return site_err(e),
    };
    if existing.is_some() {
        if let Err(r) = authorize_administer(state, &request.site_id, &account) {
            return r;
        }
    } else if count_sites(&state.data_dir) >= state.config.quotas.max_sites as usize {
        return HttpResponse::err(413, "site quota exceeded");
    }
    let password_hash = match request.password {
        Some(password) if password.len() <= 1024 => match guard::hash_site_password(&password) {
            Ok(hash) => Some(hash),
            Err(_) => return HttpResponse::err(400, "invalid site password"),
        },
        Some(_) => return HttpResponse::err(413, "site password too long"),
        None => None,
    };
    if let Some(tls) = &request.tls {
        if !site::valid_tls_intent(tls) {
            return HttpResponse::err(400, "invalid domain or path prefix");
        }
    }
    if request.tls.is_some() && request.clear_tls {
        return HttpResponse::err(400, "conflicting TLS intent");
    }
    for (candidate, suffixes) in [
        (&request.theme_css, &[".css"][..]),
        (&request.favicon, &[".ico", ".png"][..]),
    ] {
        if let Some(path) = candidate {
            if !path.is_empty()
                && (manifest::check_publish_path(path).is_err()
                    || !suffixes.iter().any(|suffix| path.ends_with(suffix))
                    || path.split('/').any(|part| {
                        part.starts_with('.') || matches!(part, "private" | "secrets" | "privato")
                    }))
            {
                return HttpResponse::err(400, "invalid site asset intent");
            }
        }
    }
    if let Some(grant) = &request.grant {
        let known_live = state
            .accounts
            .accounts
            .get(&grant.account_id)
            .is_some_and(|user| !user.deleted);
        let role_ok = matches!(
            grant.role,
            crate::acl::Role::Admin | crate::acl::Role::Writer | crate::acl::Role::Reader
        );
        if grant.account_id == account || !known_live || !role_ok {
            return HttpResponse::err(400, "invalid collaborator");
        }
    }
    if request
        .revoke
        .as_deref()
        .is_some_and(|id| id == account || id.is_empty())
        || request
            .grant
            .as_ref()
            .zip(request.revoke.as_ref())
            .is_some_and(|(g, r)| &g.account_id == r)
    {
        return HttpResponse::err(400, "invalid revocation");
    }
    if request.revoke.as_deref().is_some_and(|id| {
        existing
            .as_ref()
            .map_or(account.as_str(), |record| record.owner.as_str())
            == id
    }) {
        return HttpResponse::err(400, "cannot revoke site owner");
    }
    let mut record = match existing {
        Some(record) => record,
        None => match site::create_site(&state.data_dir, &request.site_id, &account, None) {
            Ok(record) => record,
            Err(e) => return site_err(e),
        },
    };
    if password_hash.is_some() || request.clear_password {
        record.password_hash = password_hash;
    }
    if request.tls.is_some() || request.clear_tls {
        record.tls = request.tls;
    }
    if let Some(css) = request.theme_css {
        record.theme_css = if css.is_empty() { None } else { Some(css) };
    }
    if let Some(favicon) = request.favicon {
        record.favicon = if favicon.is_empty() {
            None
        } else {
            Some(favicon)
        };
    }
    if let Some(grant) = request.grant {
        record.revoked.retain(|id| id != &grant.account_id);
        if !record.collaborators.contains(&grant.account_id) {
            record.collaborators.push(grant.account_id.clone());
        }
        record
            .collaborator_roles
            .insert(grant.account_id, grant.role);
    }
    if let Some(revoke) = request.revoke {
        record.collaborators.retain(|id| id != &revoke);
        record.collaborator_roles.remove(&revoke);
        if !record.revoked.contains(&revoke) {
            record.revoked.push(revoke);
        }
    }
    match site::save_record(&state.data_dir, &record) {
        Ok(()) => HttpResponse::json(
            200,
            &serde_json::json!({
                "site_id": record.site_id,
                "owner": record.owner,
                "collaborators": record.collaborator_roles,
                "tls": record.tls,
                "password_protected": record.password_hash.is_some(),
                "theme_css": record.theme_css,
                "favicon": record.favicon,
                "revoked": record.revoked
            }),
        ),
        Err(e) => site_err(e),
    }
}

fn handle_dry_run(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let request: manifest::DryRunRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad dry-run body"),
    };
    if let Err(r) = check_wire_protocol(&request.protocol) {
        return r;
    }
    if request.site_id != request.manifest.site_id {
        return HttpResponse::err(400, "site id mismatch");
    }
    if let Err(r) = authorize_publish(state, &request.site_id, &account) {
        return r;
    }
    let mut plan = manifest::plan_dry_run(&request.manifest, &request.vault);
    let previous = match site::current_manifest(&state.data_dir, &request.site_id) {
        Ok(value) => value,
        Err(site::SiteError::SiteNotFound(_)) => None,
        Err(e) => return site_err(e),
    };
    let empty = manifest::PublishManifest {
        site_id: request.site_id.clone(),
        version: 0,
        allowlist: vec![],
        pages: vec![],
        assets: vec![],
        no_private_leak: true,
    };
    plan.diff = Some(manifest::diff_manifest(
        previous.as_ref().unwrap_or(&empty),
        &request.manifest,
    ));
    HttpResponse::json(200, &plan)
}

fn handle_commit(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let request: manifest::CommitRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad commit body"),
    };
    if let Err(r) = check_wire_protocol(&request.protocol) {
        return r;
    }
    if request.site_id != request.manifest.site_id {
        return HttpResponse::err(400, "site id mismatch");
    }
    if let Err(r) = authorize_publish(state, &request.site_id, &account) {
        return r;
    }
    let site_id = request.manifest.site_id.clone();
    if let Err(response) = crate::site_isolation::preflight_commit(&state.data_dir, body) {
        return response;
    }
    let is_new = site::load_record(&state.data_dir, &site_id).is_err();
    if is_new {
        // First commit creates the site with the committer as owner.
        // A lost race (record appeared meanwhile) falls through to commit.
        match site::create_site(&state.data_dir, &site_id, &account, None) {
            Ok(_) | Err(site::SiteError::AlreadyExists(_)) => {}
            Err(e) => return site_err(e),
        }
    }
    let quotas = &state.config.quotas;
    let quota = site::SiteQuota {
        max_asset_bytes: quotas.max_asset_bytes,
        max_site_bytes: quotas.max_vault_bytes,
    };
    let site_count = count_sites(&state.data_dir);
    match site::commit_site(
        &state.data_dir,
        &request,
        &request.excluded_private,
        quota,
        quotas.max_sites as usize,
        site_count,
        is_new,
    ) {
        Err(e) => site_err(e),
        Ok((mut record, version)) => {
            if record.owner.is_empty() {
                record.owner = account.clone();
                if site::save_record(&state.data_dir, &record).is_err() {
                    return HttpResponse::err(500, "record write failed");
                }
            }
            state
                .acl_mut(&site_resource(&site_id))
                .grant(&account, crate::acl::Role::Owner);
            HttpResponse::json(200, &manifest::CommitResponse { site_id, version })
        }
    }
}

fn handle_unpublish(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let request: manifest::UnpublishRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad unpublish body"),
    };
    if let Err(r) = check_wire_protocol(&request.protocol) {
        return r;
    }
    if let Err(r) = authorize_administer(state, &request.site_id, &account) {
        return r;
    }
    match site::unpublish_site(&state.data_dir, &request.site_id) {
        Err(e) => site_err(e),
        Ok(_) => HttpResponse::json(
            200,
            &manifest::UnpublishResponse {
                site_id: request.site_id,
                unpublished: true,
            },
        ),
    }
}

fn handle_rollback(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let request: manifest::RollbackRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad rollback body"),
    };
    if let Err(r) = check_wire_protocol(&request.protocol) {
        return r;
    }
    if let Err(r) = authorize_publish(state, &request.site_id, &account) {
        return r;
    }
    match site::rollback_site(&state.data_dir, &request.site_id, request.to_version) {
        Err(e) => site_err(e),
        Ok(_) => HttpResponse::json(
            200,
            &manifest::RollbackResponse {
                site_id: request.site_id,
                version: request.to_version,
            },
        ),
    }
}

fn handle_status(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let site_id = match query_get(query, "site_id") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return HttpResponse::err(400, "missing site_id"),
    };
    if let Err(r) = authorize_read(state, &site_id, &account) {
        return r;
    }
    match site::status_of(&state.data_dir, &site_id) {
        Err(e) => site_err(e),
        Ok(status) => HttpResponse::json(200, &status),
    }
}

fn handle_static(
    state: &mut ServiceState,
    method: &str,
    base: &str,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    if method != "GET" {
        return HttpResponse::err(400, "static is GET only");
    }
    let tail = base.strip_prefix(SITE_PREFIX).unwrap_or("");
    let (site_id, rest) = match tail.find('/') {
        Some(i) => (tail[..i].to_string(), tail[i..].to_string()),
        None => (tail.to_string(), "/".to_string()),
    };
    if site_id.is_empty() {
        return HttpResponse::err(404, "site not found");
    }
    let record = match site::load_record(&state.data_dir, &site_id) {
        Ok(r) => r,
        Err(site::SiteError::SiteNotFound(_)) => return HttpResponse::err(404, "site not found"),
        Err(e) => return site_err(e),
    };
    // The credential is supplied in a non-URL channel by the caller. This
    // pure dispatch API receives it in `body` for static requests; the HTTP
    // transport must forward `X-Fub-Site-Password` through the reserved router.
    let password = std::str::from_utf8(body)
        .ok()
        .filter(|value| !value.is_empty());
    match site::check_password_gate(&record, password) {
        site::PasswordGate::Public => {}
        site::PasswordGate::Locked { password_ok: true } => {}
        site::PasswordGate::Locked { password_ok: false } => {
            let allowed = match account_of(state, auth) {
                Ok(account) => authorize_read(state, &site_id, &account).is_ok(),
                Err(_) => false,
            };
            if !allowed {
                return HttpResponse::err(401, "site locked");
            }
        }
    }
    let clean = rest.trim_start_matches('/');
    let clean = if clean.is_empty() {
        "index.html"
    } else {
        clean
    };
    match site::resolve_static(&state.data_dir, &site_id, clean) {
        Err(e) => site_err(e),
        Ok((bytes, _)) => HttpResponse {
            status: 200,
            content_type: site::static_content_type(clean),
            body: bytes,
        },
    }
}

fn count_sites(data_dir: &std::path::Path) -> usize {
    std::fs::read_dir(crate::schema::sites_dir(data_dir))
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().join("record.json").is_file())
                .count()
        })
        .unwrap_or(0)
}

fn site_err(error: site::SiteError) -> HttpResponse {
    match &error {
        site::SiteError::SiteNotFound(_) => HttpResponse::err(404, "site not found"),
        site::SiteError::NotPublished(_) => HttpResponse::err(404, "not published"),
        site::SiteError::StaticNotFound(_) => HttpResponse::err(404, "static not found"),
        site::SiteError::VersionNotFound { .. } => HttpResponse::err(404, "version not found"),
        site::SiteError::QuotaExceeded(_) => HttpResponse::err(413, "quota exceeded"),
        site::SiteError::ShaMismatch(_) => HttpResponse::err(422, "sha mismatch"),
        site::SiteError::PrivateLeak(_) => HttpResponse::err(422, "private leak"),
        site::SiteError::StaleVersion { .. } => HttpResponse::err(409, "stale publish version"),
        site::SiteError::Manifest(e) => HttpResponse::err(400, &e.to_string()),
        site::SiteError::Json(_) => HttpResponse::err(400, "bad json"),
        site::SiteError::Base64(_) => HttpResponse::err(400, "bad base64"),
        site::SiteError::BadPath(_) => HttpResponse::err(400, "bad path"),
        site::SiteError::AlreadyExists(_) => HttpResponse::err(409, "site exists"),
        site::SiteError::EmptyOwner => HttpResponse::err(400, "empty owner"),
        site::SiteError::Io(_) => HttpResponse::err(500, "io error"),
    }
}
