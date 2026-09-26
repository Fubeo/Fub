//! Publish client (P17, F36): Web2 `PublishClient` su ureq.
//!
//! Chiama `dry_run` / `commit` / `unpublish` / `rollback` / `status` del
//! backend, con assert sul protocollo `fub-publish/1` via `GET /v1/hello`
//! (campo `publish_protocol`). Strutture serde proprie che rispecchiano i
//! nomi wire del backend — nessuna dipendenza da `fub-services` (il server
//! resta fuori dall'host per decisione Main).
//!
//! L'export legge il censimento autorevole del vault. Solo note opt-in,
//! asset elencati esplicitamente, link locali approvati, immagini e tabelle
//! statiche passano: embed remoti e blocchi dinamici falliscono chiusi.

use fub_abi::traits::Page;

/// Versione wire attesa (`GET /v1/hello` → `publish_protocol`).
pub const PUBLISH_PROTOCOL: &str = "fub-publish/1";

/// u64-as-string sul wire (mirror di `remote::u64_string`, locale per non
/// toccare il modulo parent): stringhe decimali in scrittura, numeri
/// accettati in lettura, spazzatura = errore. Conteggi/ms restano numeri.
mod wire_str {
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum One {
        Number(u64),
        String(String),
    }

    impl One {
        fn parse(self) -> Result<u64, String> {
            match self {
                One::Number(n) => Ok(n),
                One::String(s) => s.trim().parse().map_err(|e| format!("bad u64: {e}")),
            }
        }
    }

    pub mod u64_string {
        use super::One;
        pub fn serialize<S: serde::Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
            s.collect_str(v)
        }
        pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
            <One as serde::Deserialize>::deserialize(d)?
                .parse()
                .map_err(serde::de::Error::custom)
        }
    }

    pub mod opt_u64_string {
        use super::One;
        pub fn deserialize<'de, D: serde::Deserializer<'de>>(
            d: D,
        ) -> Result<Option<u64>, D::Error> {
            let opt: Option<One> =
                serde::Deserialize::deserialize(d).map_err(serde::de::Error::custom)?;
            match opt {
                None => Ok(None),
                Some(one) => one.parse().map(Some).map_err(serde::de::Error::custom),
            }
        }
    }

    pub mod vec_u64_string {
        use super::One;
        pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<u64>, D::Error> {
            let raw: Vec<One> =
                serde::Deserialize::deserialize(d).map_err(serde::de::Error::custom)?;
            raw.into_iter()
                .map(|v| v.parse().map_err(serde::de::Error::custom))
                .collect()
        }
    }
}
/// Voce pagina del manifest (nomi serde = backend `PageEntry`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ManifestPage {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    pub html_sha: String,
}

/// Voce asset del manifest (nomi serde = backend `AssetEntry`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ManifestAsset {
    pub path: String,
    pub sha: String,
}

/// Manifest selettivo costruito dal client (nomi serde = backend).
/// `version` viaggia u64-as-string (compat numero in lettura).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClientManifest {
    pub site_id: String,
    #[serde(with = "wire_str::u64_string")]
    pub version: u64,
    pub allowlist: Vec<String>,
    pub pages: Vec<ManifestPage>,
    pub assets: Vec<ManifestAsset>,
    pub no_private_leak: bool,
}

/// Doc del vault visto dal dry-run (nomi serde = backend `LinkedDoc`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LinkedDoc {
    pub doc_id: String,
    pub allowed: bool,
    pub excluded: bool,
    pub linked_only: bool,
}

/// Pagina renderizzata pronta al commit (nomi serde = backend `PageBody`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CommitPage {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    pub html: String,
}

/// Asset pronto al commit (nomi serde = backend `AssetBody`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CommitAsset {
    pub path: String,
    pub sha: String,
    pub bytes_b64: String,
}

/// Validate the allowlist and provenance before dry-run as well as commit.
pub fn preflight_manifest(
    site_id: &str,
    manifest: &ClientManifest,
    vault: &[LinkedDoc],
) -> Result<(), &'static str> {
    use std::collections::BTreeSet;
    if !valid_site_id(site_id)
        || manifest.site_id != site_id
        || manifest.version == 0
        || !manifest.no_private_leak
    {
        return Err("invalid site or leak assertion");
    }
    let mut ids = BTreeSet::new();
    let mut approved = BTreeSet::new();
    for doc in vault {
        if doc.doc_id.is_empty() || !ids.insert(doc.doc_id.as_str()) {
            return Err("duplicate or empty vault document id");
        }
        if doc.allowed && !doc.excluded {
            approved.insert(doc.doc_id.as_str());
        }
    }
    let mut seen = BTreeSet::new();
    for page in &manifest.pages {
        if page
            .doc_id
            .as_deref()
            .is_some_and(|id| !approved.contains(id))
        {
            return Err("page source is not explicitly approved");
        }
    }
    for path in manifest
        .pages
        .iter()
        .map(|p| p.path.as_str())
        .chain(manifest.assets.iter().map(|a| a.path.as_str()))
    {
        if !valid_publish_path(path)
            || is_private_path(path)
            || is_generated_path(path)
            || !manifest
                .allowlist
                .iter()
                .any(|pattern| super::glob_match(pattern, path))
            || !seen.insert(path)
        {
            return Err("unsafe or duplicate manifest path");
        }
    }
    Ok(())
}

/// Validate the exact bytes to be sent, not merely the manifest paths. This
/// runs before any network request; the service repeats validation at staging.
pub fn preflight_commit(
    site_id: &str,
    manifest: &ClientManifest,
    pages: &[CommitPage],
    assets: &[CommitAsset],
    vault: &[LinkedDoc],
) -> Result<Vec<String>, &'static str> {
    use base64::Engine as _;
    use std::collections::{BTreeMap, BTreeSet};

    preflight_manifest(site_id, manifest, vault)?;
    let mut excluded = BTreeSet::new();
    for doc in vault {
        if doc.excluded || !doc.allowed {
            excluded.insert(doc.doc_id.as_str());
        }
    }
    let page_bodies: BTreeMap<_, _> = pages.iter().map(|p| (p.path.as_str(), p)).collect();
    let asset_bodies: BTreeMap<_, _> = assets.iter().map(|a| (a.path.as_str(), a)).collect();
    if page_bodies.len() != pages.len()
        || asset_bodies.len() != assets.len()
        || manifest.pages.len() != pages.len()
        || manifest.assets.len() != assets.len()
    {
        return Err("manifest and bodies differ");
    }
    for page in &manifest.pages {
        let body = page_bodies
            .get(page.path.as_str())
            .ok_or("missing page body")?;
        if page.doc_id != body.doc_id || digest_hex(body.html.as_bytes()) != page.html_sha {
            return Err("page body does not match approved manifest");
        }
        if excluded
            .iter()
            .any(|id| !id.is_empty() && body.html.contains(id))
        {
            return Err("private document reference in page");
        }
    }
    for asset in &manifest.assets {
        let body = asset_bodies
            .get(asset.path.as_str())
            .ok_or("missing asset body")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&body.bytes_b64)
            .map_err(|_| "invalid asset encoding")?;
        if body.sha != asset.sha || digest_hex(&bytes) != asset.sha {
            return Err("asset body does not match approved manifest");
        }
        if excluded.iter().any(|id| {
            !id.is_empty()
                && bytes
                    .windows(id.len())
                    .any(|window| window == id.as_bytes())
        }) {
            return Err("private document reference in asset");
        }
    }
    Ok(excluded.into_iter().map(str::to_string).collect())
}

pub fn valid_site_id(site: &str) -> bool {
    !site.is_empty()
        && site.len() <= 64
        && site
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_'))
}

fn valid_publish_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.starts_with('/')
        && !path
            .bytes()
            .any(|b| b == b'\\' || b == b'%' || b == b'?' || b == b'#' || b.is_ascii_control())
        && path
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != ".." && !s.starts_with('.'))
}

fn is_private_path(path: &str) -> bool {
    path.split('/').any(|segment| {
        matches!(
            segment.to_ascii_lowercase().as_str(),
            "private" | "privato" | "secrets" | ".fub"
        )
    })
}

fn is_generated_path(path: &str) -> bool {
    matches!(
        path,
        "manifest.json"
            | "search-index.json"
            | "graph.json"
            | "feed.xml"
            | "sitemap.xml"
            | "robots.txt"
            | ".fub-cache-epoch"
    )
}

fn digest_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let digest = ring::digest::digest(&ring::digest::SHA256, bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest.as_ref() {
        write!(&mut hex, "{byte:02x}").expect("writing to String cannot fail");
    }
    hex
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ManifestDiff {
    pub added: Vec<String>,
    pub modified: Vec<String>,
    pub unchanged: Vec<String>,
    pub removed: Vec<String>,
}

/// Risposta dry-run (costruita solo da `DryRunWire`: mai default inventati).
#[derive(Clone, Debug)]
pub struct DryRun {
    pub would_publish: Vec<String>,
    pub excluded_private: Vec<String>,
    pub warnings: Vec<String>,
    pub diff: ManifestDiff,
}

/// Risposta status (costruita solo da `SiteStatusWire`).
/// Tutti i campi wire sono obbligatori: assenza = errore di protocollo.
#[derive(Clone, Debug)]
pub struct SiteStatus {
    pub site_id: String,
    pub live_version: Option<u64>,
    pub versions: Vec<u64>,
    pub page_count: usize,
    pub asset_count: usize,
    pub password_protected: bool,
}

/// Forma wire del dry-run: nessun default — un campo assente è un errore
/// di protocollo esplicito, mai un elenco vuoto inventato.
#[derive(Clone, Debug, serde::Deserialize)]
struct DryRunWire {
    would_publish: Vec<String>,
    excluded_private: Vec<String>,
    warnings: Vec<String>,
    diff: ManifestDiff,
}

/// Forma wire di commit/rollback: `version` u64-as-string (compat numero).
#[derive(Clone, Debug, serde::Deserialize)]
struct VersionWire {
    site_id: String,
    #[serde(with = "wire_str::u64_string")]
    version: u64,
}

/// Forma wire di unpublish: `unpublished` obbligatorio (mai `false` di default).
#[derive(Clone, Debug, serde::Deserialize)]
struct UnpublishWire {
    site_id: String,
    unpublished: bool,
}

/// Forma wire dello status: versioni u64-as-string, conteggi numeri.
#[derive(Clone, Debug, serde::Deserialize)]
struct SiteStatusWire {
    site_id: String,
    #[serde(deserialize_with = "wire_str::opt_u64_string::deserialize")]
    live_version: Option<u64>,
    #[serde(deserialize_with = "wire_str::vec_u64_string::deserialize")]
    versions: Vec<u64>,
    page_count: usize,
    asset_count: usize,
    password_protected: bool,
}

/// Owner-plane intent. DNS and certificate provisioning remain external; the
/// wire never carries password hashes and the response never echoes secrets.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SiteTlsIntent {
    pub domain: String,
    pub path_prefix: String,
    pub provisioned: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollaboratorRole {
    Reader,
    Writer,
    Admin,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SiteGrant {
    pub account_id: String,
    pub role: CollaboratorRole,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct SiteAdminChange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    pub clear_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<SiteTlsIntent>,
    pub clear_tls: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_css: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant: Option<SiteGrant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoke: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct SiteAdminStatus {
    pub site_id: String,
    pub owner: String,
    pub collaborators: std::collections::BTreeMap<String, CollaboratorRole>,
    pub tls: Option<SiteTlsIntent>,
    pub theme_css: Option<String>,
    pub favicon: Option<String>,
    pub password_protected: bool,
    pub revoked: Vec<String>,
}

/// Errori del client publish. Portano solo metodo + path-base + status:
/// mai URL, mai query, mai token/corpi (redazione per costruzione).
/// `MissingCredentials` non ha né metodo né path: il token manca prima
/// di qualsiasi chiamata (F36, exit 4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PublishClientError {
    Transport {
        method: String,
        path: String,
        detail: String,
    },
    Protocol {
        method: String,
        path: String,
        status: Option<u16>,
        detail: String,
    },
    Rejected {
        method: String,
        path: String,
        status: u16,
    },
    MissingCredentials,
    /// No endpoint configured (neither explicit env nor setting): CLI exit 2,
    /// host `BadArgs`. Never implicit loopback.
    MissingConfiguration,
    /// Explicit endpoint fails validation: CLI exit 2, host `BadArgs`.
    BadEndpoint(String),
}

impl std::fmt::Display for PublishClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PublishClientError::Transport { method, path, .. } => {
                write!(f, "publish transport: {method} {path}")
            }
            PublishClientError::Protocol {
                method,
                path,
                status,
                ..
            } => match status {
                Some(s) => write!(f, "publish protocol: {method} {path} -> {s}"),
                None => write!(f, "publish protocol: {method} {path}"),
            },
            PublishClientError::Rejected {
                method,
                path,
                status,
            } => {
                write!(f, "publish rejected: {method} {path} -> {status}")
            }
            PublishClientError::MissingCredentials => write!(f, "missing credentials"),
            PublishClientError::MissingConfiguration => write!(f, "publish not configured"),
            PublishClientError::BadEndpoint(detail) => write!(f, "bad endpoint: {detail}"),
        }
    }
}

impl PublishClientError {
    /// F36 exit code: 0 ok (unused here), 2 usage/config, 3 transport, 4
    /// protocol/missing-credentials, 5 rejected. Mirrors SyncClientError.
    pub fn exit_code(&self) -> i32 {
        match self {
            PublishClientError::MissingConfiguration => 2,
            PublishClientError::BadEndpoint(_) => 2,
            PublishClientError::Transport { .. } => 3,
            PublishClientError::Protocol { .. } => 4,
            PublishClientError::MissingCredentials => 4,
            PublishClientError::Rejected { .. } => 5,
        }
    }

    pub fn to_plugin_error(&self) -> fub_abi::PluginError {
        match self {
            PublishClientError::Transport { method, path, .. } => {
                fub_abi::PluginError::Io(format!("publish transport: {method} {path}").into())
            }
            PublishClientError::Protocol {
                method,
                path,
                status,
                ..
            } => match status {
                Some(s) => fub_abi::PluginError::Internal(
                    format!("publish protocol: {method} {path} -> {s}").into(),
                ),
                None => fub_abi::PluginError::Internal(
                    format!("publish protocol: {method} {path}").into(),
                ),
            },
            PublishClientError::Rejected { status, .. } => match status {
                401 | 403 | 429 => fub_abi::PluginError::PermissionDenied(
                    format!("publish rejected -> {status}").into(),
                ),
                404 => {
                    fub_abi::PluginError::NotFound(format!("publish rejected -> {status}").into())
                }
                409 => {
                    fub_abi::PluginError::Conflict(format!("publish rejected -> {status}").into())
                }
                _ => fub_abi::PluginError::Io(format!("publish rejected -> {status}").into()),
            },
            PublishClientError::MissingCredentials => {
                fub_abi::PluginError::PermissionDenied("missing credentials".into())
            }
            PublishClientError::MissingConfiguration => {
                fub_abi::PluginError::BadArgs("publish not configured".into())
            }
            PublishClientError::BadEndpoint(detail) => {
                fub_abi::PluginError::BadArgs(format!("bad endpoint: {detail}").into())
            }
        }
    }
}
/// Client sincrono (ureq) verso `fub-services`. Publish non chiama mai sync.
pub struct PublishClient {
    base: String,
    token: Option<String>,
}

impl PublishClient {
    pub fn new(base: String, token: Option<String>) -> Self {
        Self { base, token }
    }

    /// Built from an explicit endpoint source: env `FUB_SERVICES_URL` wins,
    /// else `setting_url` (the `publish.server_url` value read by the caller
    /// via the settings channel). Both empty = `MissingConfiguration`
    /// (CLI exit 2), never implicit loopback. Resolve runs BEFORE any I/O;
    /// token absent from `token` = `MissingCredentials` unchanged (CLI exit 4).
    pub fn from_env_with_setting(
        setting_url: &str,
        token: &crate::remote::TokenSource,
    ) -> Result<Self, PublishClientError> {
        let base = crate::remote::resolve_base(setting_url).map_err(|e| match e {
            crate::remote::RemoteError::MissingConfiguration => {
                PublishClientError::MissingConfiguration
            }
            crate::remote::RemoteError::BadEndpoint(detail) => {
                PublishClientError::BadEndpoint(detail)
            }
        })?;
        match token.load() {
            Some(token) => Ok(Self::new(base, Some(token))),
            None => Err(PublishClientError::MissingCredentials),
        }
    }
    fn require_token(&self) -> Result<&str, PublishClientError> {
        self.token
            .as_deref()
            .ok_or(PublishClientError::MissingCredentials)
    }

    /// `GET /v1/hello` + assert su `publish_protocol` (mismatch = errore duro).
    /// Il corpo hello non valido è un errore di protocollo, mai un ok.
    pub fn check_hello(&self) -> Result<(), PublishClientError> {
        const PATH: &str = "/v1/hello";
        let token = self.require_token()?;
        let (status, body) =
            crate::remote::get(&self.base, PATH, Some(token)).map_err(|detail| {
                PublishClientError::Transport {
                    method: "GET".to_string(),
                    path: PATH.to_string(),
                    detail,
                }
            })?;
        if !(200..300).contains(&status) {
            return Err(PublishClientError::Rejected {
                method: "GET".to_string(),
                path: PATH.to_string(),
                status,
            });
        }
        crate::publish::assert_hello_publish(&body).map_err(|detail| PublishClientError::Protocol {
            method: "GET".to_string(),
            path: PATH.to_string(),
            status: None,
            detail,
        })
    }

    fn ensure_site(method: &str, path: &str, site_id: &str) -> Result<(), PublishClientError> {
        if valid_site_id(site_id) {
            Ok(())
        } else {
            Err(PublishClientError::Rejected {
                method: method.to_string(),
                path: path.to_string(),
                status: 422,
            })
        }
    }
    fn ensure_reply_site(
        method: &str,
        path: &str,
        expected: &str,
        actual: &str,
    ) -> Result<(), PublishClientError> {
        if expected == actual {
            Ok(())
        } else {
            Err(PublishClientError::Protocol {
                method: method.to_string(),
                path: path.to_string(),
                status: None,
                detail: "response site id mismatch".to_string(),
            })
        }
    }

    fn parse_json(
        method: &str,
        path: &str,
        status: u16,
        body: &[u8],
    ) -> Result<serde_json::Value, PublishClientError> {
        serde_json::from_slice(body).map_err(|e| PublishClientError::Protocol {
            method: method.to_string(),
            path: path.to_string(),
            status: Some(status),
            detail: format!("invalid json: {e}"),
        })
    }

    /// POST JSON via `remote::post_json` (timeout/redirect/igiene URL dentro);
    /// 2xx + JSON valido, altrimenti errore con status preservato.
    /// Il corpo di errore non si registra mai: solo metodo + path-base + status.
    fn post(
        &self,
        path: &str,
        payload: &serde_json::Value,
    ) -> Result<serde_json::Value, PublishClientError> {
        let token = self.require_token()?;
        let (status, body) = crate::remote::post_json(&self.base, path, Some(token), payload)
            .map_err(|detail| PublishClientError::Transport {
                method: "POST".to_string(),
                path: path.to_string(),
                detail,
            })?;
        if !(200..300).contains(&status) {
            return Err(PublishClientError::Rejected {
                method: "POST".to_string(),
                path: path.to_string(),
                status,
            });
        }
        Self::parse_json("POST", path, status, &body)
    }

    /// GET JSON via `remote::get`; stessa disciplina del POST.
    /// `path` può avere query; gli errori usano `status_path` (path-base puro).
    fn get_json(
        &self,
        path: &str,
        status_path: &str,
    ) -> Result<serde_json::Value, PublishClientError> {
        let token = self.require_token()?;
        let (status, body) =
            crate::remote::get(&self.base, path, Some(token)).map_err(|detail| {
                PublishClientError::Transport {
                    method: "GET".to_string(),
                    path: status_path.to_string(),
                    detail,
                }
            })?;
        if !(200..300).contains(&status) {
            return Err(PublishClientError::Rejected {
                method: "GET".to_string(),
                path: status_path.to_string(),
                status,
            });
        }
        Self::parse_json("GET", status_path, status, &body)
    }
    /// Anteprima allowlist: `would_publish / excluded_private / warnings`.
    /// Ogni campo wire è obbligatorio: assenza = errore di protocollo.
    pub fn dry_run(
        &self,
        site_id: &str,
        manifest: &ClientManifest,
        vault: &[LinkedDoc],
    ) -> Result<DryRun, PublishClientError> {
        const PATH: &str = "/v1/publish/dry-run";
        preflight_manifest(site_id, manifest, vault).map_err(|_| PublishClientError::Rejected {
            method: "POST".to_string(),
            path: PATH.to_string(),
            status: 422,
        })?;
        let payload = serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site_id,
            "manifest": manifest,
            "vault": vault,
        });
        let value = self.post(PATH, &payload)?;
        let dry: DryRunWire =
            serde_json::from_value(value).map_err(|_| PublishClientError::Protocol {
                method: "POST".to_string(),
                path: PATH.to_string(),
                status: None,
                detail: "missing or mistyped field: DryRun".to_string(),
            })?;
        Ok(DryRun {
            would_publish: dry.would_publish,
            excluded_private: dry.excluded_private,
            warnings: dry.warnings,
            diff: dry.diff,
        })
    }

    /// Commit atomico: pagine + asset + esclusioni asserite.
    pub fn commit(
        &self,
        site_id: &str,
        manifest: &ClientManifest,
        pages: &[CommitPage],
        assets: &[CommitAsset],
        excluded_private: &[String],
    ) -> Result<u64, PublishClientError> {
        let mut vault: Vec<LinkedDoc> = manifest
            .pages
            .iter()
            .filter_map(|page| {
                page.doc_id.as_ref().map(|id| LinkedDoc {
                    doc_id: id.clone(),
                    allowed: !excluded_private.iter().any(|excluded| excluded == id),
                    excluded: excluded_private.iter().any(|excluded| excluded == id),
                    linked_only: false,
                })
            })
            .collect();
        vault.extend(excluded_private.iter().map(|id| LinkedDoc {
            doc_id: id.clone(),
            allowed: false,
            excluded: true,
            linked_only: false,
        }));
        preflight_commit(site_id, manifest, pages, assets, &vault).map_err(|_| {
            PublishClientError::Rejected {
                method: "POST".to_string(),
                path: "/v1/publish/commit".to_string(),
                status: 422,
            }
        })?;
        let payload = serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site_id,
            "manifest": manifest,
            "pages": pages,
            "assets": assets,
            "excluded_private": excluded_private,
        });
        let value = self.post("/v1/publish/commit", &payload)?;
        let reply: VersionWire =
            serde_json::from_value(value).map_err(|_| PublishClientError::Protocol {
                method: "POST".to_string(),
                path: "/v1/publish/commit".to_string(),
                status: None,
                detail: "missing or mistyped field: version".to_string(),
            })?;
        Self::ensure_reply_site("POST", "/v1/publish/commit", site_id, &reply.site_id)?;
        Ok(reply.version)
    }

    pub fn administer_site(
        &self,
        site_id: &str,
        change: &SiteAdminChange,
    ) -> Result<SiteAdminStatus, PublishClientError> {
        const PATH: &str = "/v1/publish/site";
        Self::ensure_site("POST", PATH, site_id)?;
        let mut payload =
            serde_json::to_value(change).map_err(|_| PublishClientError::Protocol {
                method: "POST".into(),
                path: PATH.into(),
                status: None,
                detail: "invalid site administration change".into(),
            })?;
        let fields = payload
            .as_object_mut()
            .expect("admin change is a JSON object");
        fields.insert("protocol".into(), serde_json::json!(PUBLISH_PROTOCOL));
        fields.insert("site_id".into(), serde_json::json!(site_id));
        let reply: SiteAdminStatus =
            serde_json::from_value(self.post(PATH, &payload)?).map_err(|_| {
                PublishClientError::Protocol {
                    method: "POST".into(),
                    path: PATH.into(),
                    status: None,
                    detail: "missing or mistyped site administration response".into(),
                }
            })?;
        Self::ensure_reply_site("POST", PATH, site_id, &reply.site_id)?;
        Ok(reply)
    }

    /// `unpublished` è obbligatorio: assenza/tipo errato = errore di protocollo.
    pub fn unpublish(&self, site_id: &str) -> Result<bool, PublishClientError> {
        const PATH: &str = "/v1/publish/unpublish";
        Self::ensure_site("POST", PATH, site_id)?;
        let payload = serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site_id,
        });
        let value = self.post(PATH, &payload)?;
        let reply: UnpublishWire =
            serde_json::from_value(value).map_err(|_| PublishClientError::Protocol {
                method: "POST".to_string(),
                path: PATH.to_string(),
                status: None,
                detail: "missing or mistyped field: unpublished".to_string(),
            })?;
        Self::ensure_reply_site("POST", PATH, site_id, &reply.site_id)?;
        Ok(reply.unpublished)
    }

    pub fn rollback(&self, site_id: &str, to_version: u64) -> Result<u64, PublishClientError> {
        const PATH: &str = "/v1/publish/rollback";
        Self::ensure_site("POST", PATH, site_id)?;
        let payload = serde_json::json!({
            "protocol": PUBLISH_PROTOCOL,
            "site_id": site_id,
            "to_version": to_version.to_string(),
        });
        let value = self.post(PATH, &payload)?;
        let reply: VersionWire =
            serde_json::from_value(value).map_err(|_| PublishClientError::Protocol {
                method: "POST".to_string(),
                path: PATH.to_string(),
                status: None,
                detail: "missing or mistyped field: version".to_string(),
            })?;
        Self::ensure_reply_site("POST", PATH, site_id, &reply.site_id)?;
        Ok(reply.version)
    }
    /// Ogni campo dello status è obbligatorio; la query non entra negli errori.
    pub fn status(&self, site_id: &str) -> Result<SiteStatus, PublishClientError> {
        const STATUS_BASE: &str = "/v1/publish/status";
        Self::ensure_site("GET", STATUS_BASE, site_id)?;
        let value = self.get_json(&format!("{STATUS_BASE}?site_id={site_id}"), STATUS_BASE)?;
        let wire: SiteStatusWire =
            serde_json::from_value(value).map_err(|_| PublishClientError::Protocol {
                method: "GET".to_string(),
                path: STATUS_BASE.to_string(),
                status: None,
                detail: "missing or mistyped field: SiteStatus".to_string(),
            })?;
        Self::ensure_reply_site("GET", STATUS_BASE, site_id, &wire.site_id)?;
        Ok(SiteStatus {
            site_id: wire.site_id,
            live_version: wire.live_version,
            versions: wire.versions,
            page_count: wire.page_count,
            asset_count: wire.asset_count,
            password_protected: wire.password_protected,
        })
    }
}

/// One coherent explicitly approved snapshot; image/CSS/favicon assets are
/// projected only from paths listed by a published note's `publish_assets`.
/// Canvas cards are reduced to an inert table or refused before transmission.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExportSnapshot {
    pub manifest: ClientManifest,
    pub vault: Vec<LinkedDoc>,
    pub pages: Vec<CommitPage>,
    pub assets: Vec<CommitAsset>,
}

/// Read the authoritative vault census. No raw vault HTML, dynamic block,
/// remote embed or unapproved local reference reaches the network.
pub fn collect_export(
    host: &dyn fub_abi::traits::ReadApi,
    site_id: &str,
    version: u64,
) -> Result<ExportSnapshot, fub_abi::PluginError> {
    use base64::Engine as _;
    use fub_abi::model::DocId;
    use std::collections::{BTreeMap, BTreeSet};

    fn truthy(value: Option<&serde_json::Value>) -> bool {
        match value {
            Some(serde_json::Value::Bool(flag)) => *flag,
            Some(serde_json::Value::String(text)) => matches!(
                text.trim().to_ascii_lowercase().as_str(),
                "true" | "yes" | "1"
            ),
            Some(serde_json::Value::Number(number)) => number.as_u64() == Some(1),
            _ => false,
        }
    }
    fn excluded(value: Option<&serde_json::Value>) -> bool {
        match value {
            None | Some(serde_json::Value::Bool(false)) => false,
            Some(serde_json::Value::String(text))
                if matches!(
                    text.trim().to_ascii_lowercase().as_str(),
                    "false" | "no" | "0"
                ) =>
            {
                false
            }
            _ => true,
        }
    }
    if !valid_site_id(site_id) || version == 0 {
        return Err(fub_abi::PluginError::BadArgs(
            "invalid publish site or version".into(),
        ));
    }
    let mut vault = Vec::new();
    let mut selected = Vec::new();
    let mut approved_assets = BTreeSet::new();
    let mut offset = 0u32;
    loop {
        let batch = host.list_documents(Some(Page::new(offset, 500)))?;
        let count = batch.items.len() as u32;
        for doc in batch.items {
            // A page opts in from its frontmatter, so only a format that
            // declares one can carry `publish: true`; any such format goes
            // through the same projection, whatever its extension.
            if host.format_of(&doc).is_none_or(|format| {
                !format
                    .capabilities
                    .supports(fub_abi::options::syntax::FRONTMATTER)
            }) {
                vault.push(LinkedDoc {
                    doc_id: doc.0,
                    allowed: false,
                    excluded: true,
                    linked_only: false,
                });
                continue;
            }
            let model = host.read_model(&doc)?;
            if model.id != doc {
                return Err(fub_abi::PluginError::Internal(
                    "publish model identity mismatch".into(),
                ));
            }
            let publish = truthy(model.frontmatter.0.get("publish"))
                && !excluded(model.frontmatter.0.get("private"))
                && !excluded(model.frontmatter.0.get("draft"));
            let path = doc_path(&doc.0);
            let approved = publish && valid_publish_path(&path) && !is_private_path(&path);
            vault.push(LinkedDoc {
                doc_id: doc.0.clone(),
                allowed: approved,
                excluded: !approved,
                linked_only: false,
            });
            if !publish {
                continue;
            }
            if !approved {
                return Err(fub_abi::PluginError::BadArgs("unsafe publish path".into()));
            }
            if let Some(values) = model.frontmatter.0.get("publish_assets") {
                let paths = values.as_array().ok_or_else(|| {
                    fub_abi::PluginError::BadArgs("publish_assets must be an array".into())
                })?;
                for value in paths {
                    let path = value.as_str().ok_or_else(|| {
                        fub_abi::PluginError::BadArgs("invalid publish asset".into())
                    })?;
                    if !valid_publish_path(path) || is_private_path(path) || is_generated_path(path)
                    {
                        return Err(fub_abi::PluginError::BadArgs("unsafe publish asset".into()));
                    }
                    approved_assets.insert(path.to_string());
                }
            }
            selected.push(model);
        }
        if count < 500 {
            break;
        }
        offset = offset
            .checked_add(count)
            .ok_or_else(|| fub_abi::PluginError::BadArgs("too many publish documents".into()))?;
    }
    let mut page_paths = BTreeMap::new();
    let mut routes = BTreeSet::new();
    for model in &selected {
        let route = doc_path(&model.id.0);
        if !routes.insert(route.clone()) {
            return Err(fub_abi::PluginError::BadArgs(
                format!("two published documents share the page `{route}`").into(),
            ));
        }
        page_paths.insert(model.id.0.clone(), route);
    }
    let mut entries = Vec::new();
    let mut pages = Vec::new();
    let mut assets = Vec::new();
    let mut asset_entries = Vec::new();
    let mut allowlist = Vec::new();
    let mut total_asset_bytes = 0usize;
    for path in &approved_assets {
        let known = vault
            .iter_mut()
            .find(|doc| &doc.doc_id == path)
            .ok_or_else(|| {
                fub_abi::PluginError::BadArgs("publish asset missing from vault".into())
            })?;
        known.allowed = true;
        known.excluded = false;
        let bytes = host.read_document_bytes(&DocId(path.clone()))?;
        total_asset_bytes = total_asset_bytes
            .checked_add(bytes.len())
            .ok_or_else(|| fub_abi::PluginError::BadArgs("publish assets too large".into()))?;
        if bytes.len() > 4 * 1024 * 1024 || total_asset_bytes > 32 * 1024 * 1024 {
            return Err(fub_abi::PluginError::BadArgs(
                "publish assets exceed cap".into(),
            ));
        }
        if host
            .format_of(&DocId(path.clone()))
            .is_some_and(|format| format.descriptor.id == fub_format_canvas::FORMAT_ID)
        {
            let html = super::projection::canvas(&bytes)
                .map_err(|reason| fub_abi::PluginError::BadArgs(reason.into()))?;
            let output = format!("{path}.html");
            entries.push(ManifestPage {
                path: output.clone(),
                doc_id: Some(path.clone()),
                html_sha: digest_hex(html.as_bytes()),
            });
            pages.push(CommitPage {
                path: output.clone(),
                doc_id: Some(path.clone()),
                html,
            });
            allowlist.push(output);
            continue;
        }
        if !verified_asset(path, &bytes) {
            return Err(fub_abi::PluginError::BadArgs(
                "asset has no verified static projector".into(),
            ));
        }
        let sha = digest_hex(&bytes);
        asset_entries.push(ManifestAsset {
            path: path.clone(),
            sha: sha.clone(),
        });
        assets.push(CommitAsset {
            path: path.clone(),
            sha,
            bytes_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
        allowlist.push(path.clone());
    }
    for model in &selected {
        let path = page_paths
            .get(&model.id.0)
            .expect("selected page has a route");
        let links = resolve_links(host, model)?;
        let html = super::projection::page(model, site_id, &page_paths, &approved_assets, &links)
            .map_err(|reason| fub_abi::PluginError::BadArgs(reason.into()))?;
        entries.push(ManifestPage {
            path: path.clone(),
            doc_id: Some(model.id.0.clone()),
            html_sha: digest_hex(html.as_bytes()),
        });
        pages.push(CommitPage {
            path: path.clone(),
            doc_id: Some(model.id.0.clone()),
            html,
        });
        allowlist.push(path.clone());
    }
    if !entries.is_empty() && !entries.iter().any(|entry| entry.path == "index.html") {
        use fub_abi::html::{attr, escape};
        let mut html = String::from("<h1>Pages</h1><nav><ul>");
        for entry in &entries {
            html.push_str("<li><a");
            html.push_str(&attr("href", &entry.path));
            html.push('>');
            html.push_str(&escape(&entry.path));
            html.push_str("</a></li>");
        }
        html.push_str("</ul></nav>");
        entries.push(ManifestPage {
            path: "index.html".into(),
            doc_id: None,
            html_sha: digest_hex(html.as_bytes()),
        });
        pages.push(CommitPage {
            path: "index.html".into(),
            doc_id: None,
            html,
        });
        allowlist.push("index.html".into());
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    pages.sort_by(|a, b| a.path.cmp(&b.path));
    allowlist.sort();
    let snapshot = ExportSnapshot {
        manifest: ClientManifest {
            site_id: site_id.to_string(),
            version,
            allowlist,
            pages: entries,
            assets: asset_entries,
            no_private_leak: true,
        },
        vault,
        pages,
        assets,
    };
    preflight_commit(
        site_id,
        &snapshot.manifest,
        &snapshot.pages,
        &snapshot.assets,
        &snapshot.vault,
    )
    .map_err(|_| fub_abi::PluginError::BadArgs("unsafe publish export".into()))?;
    Ok(snapshot)
}

fn verified_asset(path: &str, bytes: &[u8]) -> bool {
    if super::projection::is_image(path) {
        if path.ends_with(".png") {
            return bytes.starts_with(b"\x89PNG\r\n\x1a\n");
        }
        if path.ends_with(".jpg") || path.ends_with(".jpeg") {
            return bytes.starts_with(&[0xff, 0xd8, 0xff]);
        }
        if path.ends_with(".webp") {
            return bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..]);
        }
        return bytes.starts_with(&[0, 0, 1, 0]);
    }
    if path.ends_with(".css") {
        return std::str::from_utf8(bytes).is_ok_and(|css| {
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
        });
    }
    false
}

/// The local references of a published page, resolved by the vault index
/// with the rule the app navigates by. Embeds stay out: an image is an
/// approved asset named by its exact path, not a page to reach.
fn resolve_links(
    host: &dyn fub_abi::traits::ReadApi,
    model: &fub_abi::model::DocumentModel,
) -> Result<super::projection::Resolved, fub_abi::PluginError> {
    use fub_abi::model::LinkTarget;
    use fub_abi::traits::{IndexQuery, IndexResult};

    let mut resolved = super::projection::Resolved::default();
    for link in model.links.iter().filter(|link| !link.embed) {
        let (table, key, target) = match &link.target {
            LinkTarget::Wiki { page, .. } if !link.target.names_host() => (
                &mut resolved.wiki,
                page.clone(),
                LinkTarget::wiki(page.clone()),
            ),
            LinkTarget::Path(raw) => {
                let (path, _) = fub_abi::rules::path::split_fragment(raw);
                (
                    &mut resolved.paths,
                    path.to_string(),
                    LinkTarget::Path(path.to_string()),
                )
            }
            _ => continue,
        };
        if table.contains_key(&key) {
            continue;
        }
        match host.query_index(IndexQuery::Resolve {
            target,
            from: Some(model.id.clone()),
        })? {
            IndexResult::Resolved(Some(found)) => {
                table.insert(key, found.doc);
            }
            IndexResult::Resolved(None) => {}
            other => {
                return Err(fub_abi::PluginError::Internal(
                    format!("publish: resolving a link answered `{}`", other.kind_name()).into(),
                ))
            }
        }
    }
    Ok(resolved)
}

fn doc_path(doc_id: &str) -> String {
    let stem = fub_abi::rules::path::strip_ext(doc_id)
        .trim_matches('/')
        .replace([' ', '\\'], "-")
        .to_ascii_lowercase();
    if stem.is_empty() {
        "index.html".to_string()
    } else {
        format!("{stem}.html")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approved() -> (ClientManifest, Vec<LinkedDoc>, Vec<CommitPage>) {
        let html = "<h1>Public</h1>".to_string();
        (
            ClientManifest {
                site_id: "blog".into(),
                version: u64::MAX,
                allowlist: vec!["index.html".into()],
                pages: vec![ManifestPage {
                    path: "index.html".into(),
                    doc_id: Some("public.md".into()),
                    html_sha: digest_hex(html.as_bytes()),
                }],
                assets: vec![],
                no_private_leak: true,
            },
            vec![
                LinkedDoc {
                    doc_id: "public.md".into(),
                    allowed: true,
                    excluded: false,
                    linked_only: false,
                },
                LinkedDoc {
                    doc_id: "private.md".into(),
                    allowed: false,
                    excluded: true,
                    linked_only: true,
                },
            ],
            vec![CommitPage {
                path: "index.html".into(),
                doc_id: Some("public.md".into()),
                html,
            }],
        )
    }

    #[test]
    fn preflight_checks_allowlist_provenance_and_exact_bodies() {
        let (mut manifest, vault, mut pages) = approved();
        assert_eq!(
            preflight_commit("blog", &manifest, &pages, &[], &vault).unwrap(),
            vec!["private.md"]
        );
        pages[0].html.push_str(" private.md");
        assert_eq!(
            preflight_commit("blog", &manifest, &pages, &[], &vault),
            Err("page body does not match approved manifest")
        );
        manifest.pages[0].html_sha = digest_hex(pages[0].html.as_bytes());
        assert_eq!(
            preflight_commit("blog", &manifest, &pages, &[], &vault),
            Err("private document reference in page")
        );
        manifest.pages[0].path = "private/index.html".into();
        pages[0].path = manifest.pages[0].path.clone();
        assert_eq!(
            preflight_commit("blog", &manifest, &pages, &[], &vault),
            Err("unsafe or duplicate manifest path")
        );
    }

    #[test]
    fn manifest_version_wire_preserves_u64_max() {
        let (manifest, _, _) = approved();
        let value = serde_json::to_value(&manifest).unwrap();
        assert_eq!(value["version"], "18446744073709551615");
        assert_eq!(
            serde_json::from_value::<ClientManifest>(value)
                .unwrap()
                .version,
            u64::MAX
        );
        let numeric = serde_json::json!({
            "site_id": "blog", "version": 42, "allowlist": [], "pages": [], "assets": [],
            "no_private_leak": true
        });
        assert_eq!(
            serde_json::from_value::<ClientManifest>(numeric)
                .unwrap()
                .version,
            42
        );
    }

    #[test]
    fn asset_preflight_rejects_remote_css_and_scans_binary_private_bytes() {
        assert!(verified_asset("theme.css", b"body{color:#333}"));
        assert!(!verified_asset(
            "theme.css",
            b"body{background:url(https://tracker.test/x)}"
        ));
        let (mut manifest, vault, pages) = approved();
        let bytes = b"\x89PNG\r\n\x1a\n\xffprivate.md";
        assert!(verified_asset("logo.png", bytes));
        let sha = digest_hex(bytes);
        manifest.allowlist.push("logo.png".into());
        manifest.assets.push(ManifestAsset {
            path: "logo.png".into(),
            sha: sha.clone(),
        });
        let assets = vec![CommitAsset {
            path: "logo.png".into(),
            sha,
            bytes_b64: {
                use base64::Engine as _;
                base64::engine::general_purpose::STANDARD.encode(bytes)
            },
        }];
        assert_eq!(
            preflight_commit("blog", &manifest, &pages, &assets, &vault),
            Err("private document reference in asset")
        );
    }

    #[test]
    fn real_vault_export_sends_only_explicit_static_note() {
        use fub_abi::format::ParseContext;
        use fub_abi::FormatProvider;
        use fub_sdk::testing::MemoryHost;

        let public = "---\npublish: true\n---\n# Published\nSafe text";
        let private = "---\npublish: true\nprivate: true\n---\n# Secret";
        let provider = fub_format_markdown::MarkdownProvider::new();
        let host = MemoryHost::new()
            .with_document("public.md", public)
            .with_model(
                "public.md",
                provider
                    .parse(&public.into(), &ParseContext::obsidian("public.md"))
                    .unwrap(),
            )
            .with_document("private.md", private)
            .with_model(
                "private.md",
                provider
                    .parse(&private.into(), &ParseContext::obsidian("private.md"))
                    .unwrap(),
            );
        let export = collect_export(&host, "blog", 1).unwrap();
        assert_eq!(export.manifest.allowlist, vec!["index.html", "public.html"]);
        assert_eq!(export.pages.len(), 2);
        assert!(export
            .pages
            .iter()
            .any(|page| page.path == "public.html" && page.html.contains("Published")));
        assert!(export
            .pages
            .iter()
            .all(|page| !page.html.contains("Secret")));
        assert_eq!(
            export
                .vault
                .iter()
                .filter(|doc| doc.excluded)
                .map(|doc| doc.doc_id.as_str())
                .collect::<Vec<_>>(),
            vec!["private.md"]
        );
        assert!(export.assets.is_empty());
    }
    #[test]
    fn published_local_links_resolve_only_against_approved_pages() {
        use fub_abi::format::ParseContext;
        use fub_abi::FormatProvider;
        use fub_sdk::testing::MemoryHost;
        let provider = fub_format_markdown::MarkdownProvider::new();
        let source = "---\npublish: true\n---\n# First\n[Second](second.md)";
        let target = "---\npublish: true\n---\n# Second";
        let host = MemoryHost::new()
            .with_document("first.md", source)
            .with_model(
                "first.md",
                provider
                    .parse(&source.into(), &ParseContext::obsidian("first.md"))
                    .unwrap(),
            )
            .with_document("second.md", target)
            .with_model(
                "second.md",
                provider
                    .parse(&target.into(), &ParseContext::obsidian("second.md"))
                    .unwrap(),
            );
        let export = collect_export(&host, "blog", 1).unwrap();
        assert!(export
            .pages
            .iter()
            .any(|page| page.path == "first.html"
                && page.html.contains("href=\"/s/blog/second.html\"")));
        let private = "---\nprivate: true\n---\n# Secret";
        let host = MemoryHost::new()
            .with_document("first.md", source)
            .with_model(
                "first.md",
                provider
                    .parse(&source.into(), &ParseContext::obsidian("first.md"))
                    .unwrap(),
            )
            .with_document("second.md", private)
            .with_model(
                "second.md",
                provider
                    .parse(&private.into(), &ParseContext::obsidian("second.md"))
                    .unwrap(),
            );
        assert!(collect_export(&host, "blog", 1).is_err());
    }
}
