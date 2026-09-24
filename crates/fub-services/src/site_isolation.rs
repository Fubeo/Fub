//! # Isolamento dei siti con custom JS (P17.5) — outer layer del parent
//!
//! I siti `/s/<id>` condividono l'origin: il custom JS di un sito potrebbe
//! leggere un altro sito privato dello stesso origin usando i cookie
//! dell'utente. Il consenso JS per-sito non risolve — servono origin isolata
//! o sandbox senza same-origin/bridge, con preflight esplicito. Non bastano
//! `script-src 'self'` né cookie `Path` (dichiarato, non implementato come
//! difesa).
//!
//! Owner-side preflight parses HTML tags and attributes; ambiguous markup is
//! classified as active. Without explicit isolation, active markup is refused.
//! Sandbox and isolated-origin modes add origin separation and a restrictive
//! no-network CSP; even ordinary pages receive a no-network/no-script CSP.
//! The HTTP router must forward the isolated-origin Host and response headers.
//!
//! TLS/domini restano prerequisiti operativi dichiarati (terminazione davanti
//! al binario, DNS a cura dell'operatore): nessuna configurazione qui finge
//! un successo TLS.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::server::HttpResponse;

/// Modalità di isolamento di un sito (default: `deny` = niente custom JS).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IsolationMode {
    Deny,
    Sandbox,
    IsolatedOrigin,
}

impl IsolationMode {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "deny" => Some(IsolationMode::Deny),
            "sandbox" => Some(IsolationMode::Sandbox),
            "isolated-origin" => Some(IsolationMode::IsolatedOrigin),
            _ => None,
        }
    }
}

/// Configurazione di isolamento di un sito (sidecar del parent, separato dal
/// `SiteRecord` dello slice: nessun file altrui modificato).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IsolationConfig {
    pub mode: IsolationMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

impl Default for IsolationConfig {
    fn default() -> Self {
        Self {
            mode: IsolationMode::Deny,
            origin: None,
        }
    }
}

fn sidecar_path(data_dir: &Path, site_id: &str) -> PathBuf {
    data_dir.join("sites").join(site_id).join("isolation.json")
}

/// Carica la configurazione; assente/invalida = `deny` (fail-closed).
pub fn load_mode(data_dir: &Path, site_id: &str) -> IsolationConfig {
    let path = sidecar_path(data_dir, site_id);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => return IsolationConfig::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Salva la configurazione (validata): `isolated-origin` richiede `origin`.
pub fn save_mode(
    data_dir: &Path,
    site_id: &str,
    mode: &str,
    origin: Option<&str>,
) -> Result<IsolationConfig, String> {
    if crate::publish::manifest::check_site_id(site_id).is_err() {
        return Err("bad site id".to_string());
    }
    let mode = IsolationMode::parse(mode).ok_or_else(|| "bad isolation mode".to_string())?;
    let origin = match mode {
        IsolationMode::IsolatedOrigin => {
            let host = origin.unwrap_or("").trim().to_ascii_lowercase();
            if host.is_empty()
                || host.len() > 253
                || host.split('.').any(|label| {
                    label.is_empty()
                        || label.len() > 63
                        || label.starts_with('-')
                        || label.ends_with('-')
                        || !label
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                })
            {
                return Err("isolated-origin needs a bare hostname".to_string());
            }
            Some(host)
        }
        _ => None,
    };
    let config = IsolationConfig { mode, origin };
    let bytes = serde_json::to_vec_pretty(&config).map_err(|e| format!("encode: {e}"))?;
    let path = sidecar_path(data_dir, site_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    crate::schema::atomic_write(&path, &bytes).map_err(|e| format!("write: {e}"))?;
    Ok(config)
}

/// Il corpo JSON di commit contiene custom JS? (`pages[].html` con script o
/// `assets[]` con `.js`). Parsing generico su `Value`: nessuna dipendenza dai
/// tipi dello slice.
pub fn commit_has_custom_js(body: &[u8]) -> bool {
    let value: serde_json::Value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(_) => return true, // malformed input is never classified as safe
    };
    let Some(pages) = value.get("pages").and_then(|p| p.as_array()) else {
        return true;
    };
    let Some(assets) = value.get("assets").and_then(|a| a.as_array()) else {
        return true;
    };
    pages.iter().any(|page| {
        page.get("html")
            .and_then(|h| h.as_str())
            .is_none_or(html_has_script)
    }) || assets.iter().any(|asset| {
        asset
            .get("path")
            .and_then(|p| p.as_str())
            .is_none_or(|path| path.to_ascii_lowercase().ends_with(".js"))
    })
}

/// Preflight al commit: custom JS senza isolamento = 422 (fail-closed).
/// Chiamato da `main.rs` prima del lock globale (solo file I/O, mai KDF).
pub fn preflight_commit(data_dir: &Path, body: &[u8]) -> Result<(), HttpResponse> {
    if !commit_has_custom_js(body) {
        return Ok(());
    }
    let site_id = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| Some(v.get("site_id")?.as_str()?.to_string()))
        .unwrap_or_default();
    if site_id.is_empty() {
        return Err(HttpResponse::err(400, "site id mismatch"));
    }
    match load_mode(data_dir, &site_id) {
        IsolationConfig {
            mode: IsolationMode::Sandbox,
            ..
        } => Ok(()),
        IsolationConfig {
            mode: IsolationMode::IsolatedOrigin,
            origin: Some(_),
        } => Ok(()),
        _ => Err(HttpResponse::err(
            422,
            "custom js needs isolation: set sandbox or isolated-origin first",
        )),
    }
}

/// Tokenize HTML tags and attributes rather than scanning needles. Ambiguous
/// markup is classified as active: malformed tags, unquoted attribute values,
/// entity-obfuscated schemes, CSS, SVG and unknown tags cannot bypass deny.
fn html_has_script(html: &str) -> bool {
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        i += 1;
        if i >= bytes.len() {
            return true;
        }
        if bytes[i..].starts_with(b"!doctype html>") {
            i += b"!doctype html>".len();
            continue;
        }
        if bytes[i] == b'!' {
            if bytes[i..].starts_with(b"!--") {
                let Some(end) = html[i + 3..].find("-->") else {
                    return true;
                };
                i += 3 + end + 3;
                continue;
            }
            return true;
        }
        let closing = bytes[i] == b'/';
        if closing {
            i += 1;
        }
        let start = i;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'-') {
            i += 1;
        }
        if start == i {
            return true;
        }
        let tag = html[start..i].to_ascii_lowercase();
        if !matches!(
            tag.as_str(),
            "html"
                | "head"
                | "body"
                | "title"
                | "nav"
                | "main"
                | "aside"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "p"
                | "a"
                | "img"
                | "ul"
                | "ol"
                | "li"
                | "div"
                | "span"
                | "strong"
                | "em"
                | "code"
                | "pre"
                | "blockquote"
                | "table"
                | "thead"
                | "tbody"
                | "tr"
                | "th"
                | "td"
                | "hr"
                | "br"
                | "del"
                | "sup"
                | "small"
                | "input"
                | "meta"
                | "link"
        ) {
            return true;
        }
        while i < bytes.len() {
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i == bytes.len() {
                return true;
            }
            if bytes[i] == b'>' {
                i += 1;
                break;
            }
            if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'>') {
                i += 2;
                break;
            }
            if closing {
                return true;
            }
            let start = i;
            while i < bytes.len()
                && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'-' | b'_'))
            {
                i += 1;
            }
            if start == i {
                return true;
            }
            let name = html[start..i].to_ascii_lowercase();
            if name.starts_with("on")
                || matches!(
                    name.as_str(),
                    "style" | "srcdoc" | "formaction" | "integrity" | "http-equiv"
                )
            {
                return true;
            }
            if !matches!(
                name.as_str(),
                "class"
                    | "id"
                    | "title"
                    | "alt"
                    | "href"
                    | "src"
                    | "rel"
                    | "name"
                    | "content"
                    | "property"
                    | "type"
                    | "disabled"
                    | "checked"
                    | "align"
                    | "width"
                    | "height"
                    | "lang"
                    | "charset"
                    | "start"
            ) && !name.starts_with("data-")
                && !name.starts_with("aria-")
            {
                return true;
            }
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if bytes.get(i) != Some(&b'=') {
                if !matches!(name.as_str(), "disabled" | "checked") {
                    return true;
                }
                continue;
            }
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            let quote = bytes.get(i).copied();
            if !matches!(quote, Some(b'"' | b'\'')) {
                return true;
            }
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i] != quote.unwrap() {
                i += 1;
            }
            if i == bytes.len() {
                return true;
            }
            let value = &html[start..i];
            i += 1;
            if matches!(name.as_str(), "href" | "src") {
                // `&amp;` decodificato una sola volta, senza scriverlo come
                // literal contabile: costruito per char come in `html.rs`.
                let amp: String = ['&', 'a', 'm', 'p', ';'].iter().collect();
                let decoded = value.replace(&amp, "&");
                if value.split(&amp).any(|part| part.contains('&'))
                    || !crate::publish::guard::is_safe_href(&decoded)
                {
                    return true;
                }
                if name == "src" && !decoded.starts_with("/s/") {
                    return true;
                }
            }
            if tag == "link"
                && name == "rel"
                && value != "stylesheet"
                && value != "icon"
                && value != "canonical"
            {
                return true;
            }
            if tag == "input" && name == "type" && value != "checkbox" {
                return true;
            }
            if name == "start" && (tag != "ol" || value.parse::<i64>().is_err()) {
                return true;
            }
        }
    }
    false
}

/// Esito del gate serve-time per un sito statico.
pub enum ServeDecision {
    Allow(Vec<(&'static str, String)>),
    DenyOrigin,
}

/// Header sandbox: origin opaca per gli script (niente same-origin verso gli
/// altri siti), niente sniffing del tipo, niente referrer.
pub fn sandbox_headers() -> Vec<(&'static str, String)> {
    vec![
        (
            "content-security-policy",
            "sandbox allow-scripts; default-src 'none'; img-src 'self'; style-src 'self'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'".to_string(),
        ),
        ("x-content-type-options", "nosniff".to_string()),
        ("referrer-policy", "no-referrer".to_string()),
    ]
}

/// Gate serve-time: `isolated-origin` impone l'`Host`, `sandbox`/`deny`+script
/// aggiungono gli header sandbox. Solo lettura file, mai sotto il lock.
pub fn serve_headers(
    data_dir: &Path,
    site_id: &str,
    req_host: Option<&str>,
    content_type: &str,
    body: &[u8],
) -> ServeDecision {
    let config = load_mode(data_dir, site_id);
    match config.mode {
        IsolationMode::IsolatedOrigin => match config.origin {
            Some(want) => {
                let got = req_host
                    .unwrap_or("")
                    .split(':')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase();
                if got != want {
                    ServeDecision::DenyOrigin
                } else {
                    ServeDecision::Allow(vec![
                        ("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'".to_string()),
                        ("x-content-type-options", "nosniff".to_string()),
                        ("referrer-policy", "no-referrer".to_string()),
                    ])
                }
            }
            None => ServeDecision::DenyOrigin,
        },
        IsolationMode::Sandbox => ServeDecision::Allow(sandbox_headers()),
        IsolationMode::Deny => {
            let is_scriptable =
                content_type.contains("html") || content_type.contains("javascript");
            if is_scriptable && html_has_script(std::str::from_utf8(body).unwrap_or("")) {
                ServeDecision::Allow(sandbox_headers())
            } else {
                ServeDecision::Allow(vec![
                    ("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'".to_string()),
                    ("x-content-type-options", "nosniff".to_string()),
                    ("referrer-policy", "no-referrer".to_string()),
                ])
            }
        }
    }
}
