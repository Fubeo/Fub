//! Asset and access guards for the publish slice (P17.3, P17.5).
//!
//! The server never renders markdown: pages arrive as HTML the host has
//! already projected. What guards them on the way in and out is
//! [`crate::site_isolation`] — a parsed-HTML preflight that refuses active
//! markup (script/style/iframe, event handlers, unsafe schemes) without
//! explicit isolation, and a no-script CSP on every served page. Here live
//! the pieces it shares: safe link schemes, embeds/boards/dataviews that need
//! a verified static projection, size-capped assets, and the site password
//! gate, PBKDF2 ver=1 with constant-time verification.
//!
//! The leakage scanner ([`assert_no_leakage`]) is the second wall behind
//! selective manifests: it asserts an excluded note appears in *none* of
//! the html/index/graph/feed/sitemap/cache surfaces.

use base64::Engine as _;
use ring::{digest, pbkdf2};
use subtle::ConstantTimeEq;

/// PBKDF2-HMAC-SHA256 parameters for site passwords: versioned, `ver=1`,
/// 210 000 iterations, 16-byte salt. Same discipline as account passwords,
/// separate hash from any vault key material.
pub const SITE_PBKDF2_VERSION: u32 = 1;
pub const SITE_PBKDF2_ITERATIONS: u32 = 210_000;
const SITE_PBKDF2_SALT_LEN: usize = 16;
const SITE_PBKDF2_DK_LEN: usize = 32;

/// Opaque bearer token: 32 random bytes as unpadded base64url, carried only
/// in `Authorization: Bearer` (env-file/stdin on the client, never argv).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BearerToken([u8; 32]);

impl BearerToken {
    pub fn parse(raw: &str) -> Result<Self, GuardError> {
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(raw.trim())
            .map_err(|_| GuardError::BadToken)?;
        if bytes.len() != 32 {
            return Err(GuardError::BadToken);
        }
        let mut fixed = [0u8; 32];
        fixed.copy_from_slice(&bytes);
        Ok(BearerToken(fixed))
    }

    /// Constant-time equality: token comparison must not leak prefixes.
    pub fn constant_time_eq(&self, other: &BearerToken) -> bool {
        bool::from(self.0.ct_eq(&other.0))
    }
}

/// Hash a site password. Returns `v1$210000$<salt_b64>$<dk_b64>`.
pub fn hash_site_password(password: &str) -> Result<String, GuardError> {
    use ring::rand::SecureRandom as _;
    if password.is_empty() {
        return Err(GuardError::EmptyPassword);
    }
    let mut salt = [0u8; SITE_PBKDF2_SALT_LEN];
    ring::rand::SystemRandom::new()
        .fill(&mut salt)
        .map_err(|_| GuardError::RandomUnavailable)?;
    let mut dk = [0u8; SITE_PBKDF2_DK_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(SITE_PBKDF2_ITERATIONS).expect("nonzero"),
        &salt,
        password.as_bytes(),
        &mut dk,
    );
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(format!(
        "v{SITE_PBKDF2_VERSION}${SITE_PBKDF2_ITERATIONS}${}${}",
        b64.encode(salt),
        b64.encode(dk)
    ))
}

/// Verify a site password against a stored hash, constant-time on the key.
pub fn verify_site_password(password: &str, stored: &str) -> bool {
    let mut parts = stored.split('$');
    let (Some(ver), Some(iter), Some(salt_b64), Some(dk_b64)) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    if ver != format!("v{SITE_PBKDF2_VERSION}") {
        return false;
    }
    let Ok(iterations) = iter.parse::<u32>() else {
        return false;
    };
    if iterations != SITE_PBKDF2_ITERATIONS {
        return false;
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let (Ok(salt), Ok(expected)) = (b64.decode(salt_b64), b64.decode(dk_b64)) else {
        return false;
    };
    if salt.len() != SITE_PBKDF2_SALT_LEN || expected.len() != SITE_PBKDF2_DK_LEN {
        return false;
    }
    let Some(count) = std::num::NonZeroU32::new(iterations) else {
        return false;
    };
    pbkdf2::verify(
        pbkdf2::PBKDF2_HMAC_SHA256,
        count,
        &salt,
        password.as_bytes(),
        &expected,
    )
    .is_ok()
}

/// Escape `&<>"'` for HTML text and attribute contexts.
/// Unica tabella del repo (`fub_abi::html`): qui nessuna copia locale.
pub fn escape_html(raw: &str) -> String {
    fub_abi::html::escape(raw)
}

/// Safe link/image targets: relative paths, `#anchors`, `http(s):`, `mailto:`.
/// Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, …) is
/// rejected — the preflight then classifies the page as active markup.
pub fn is_safe_href(href: &str) -> bool {
    let target = href.trim();
    if target.is_empty() {
        return false;
    }
    if target.starts_with("//")
        || target.starts_with('\\')
        || target.bytes().any(|b| b.is_ascii_control() || b == b'\\')
    {
        return false;
    }
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("data:")
        || lower.starts_with("vbscript:")
        || lower.starts_with("file:")
        || lower.starts_with("blob:")
    {
        return false;
    }
    if let Some((scheme, _)) = target.split_once(':') {
        return matches!(
            scheme.to_ascii_lowercase().as_str(),
            "http" | "https" | "mailto"
        ) && !scheme.is_empty();
    }
    true
}

/// Dynamic content that has no business running on the publish server.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EmbedKind {
    /// A transcluded note or file embed.
    Embed,
    /// A kanban/board view.
    Board,
    /// A dataview-style live query.
    Dataview,
    /// Any third-party plugin block, named.
    Plugin,
}

/// Preflight for dynamic content: embeds/boards/dataviews/plugins publish
/// only with a verified static projection. Without one this is a hard error —
/// arbitrary plugins never run on the server to fill the gap.
pub fn check_static_projection(
    kind: EmbedKind,
    has_projection: bool,
) -> Result<(), PreflightError> {
    if has_projection {
        return Ok(());
    }
    Err(match kind {
        EmbedKind::Embed => PreflightError::EmbedNeedsProjection,
        EmbedKind::Board => PreflightError::BoardNeedsProjection,
        EmbedKind::Dataview => PreflightError::DataviewNeedsProjection,
        EmbedKind::Plugin => PreflightError::PluginNeedsProjection,
    })
}

/// Enforce per-asset and per-site byte quotas before anything is staged.
pub fn check_asset_quota(
    asset_len: u64,
    staged_total: u64,
    max_asset_bytes: u64,
    max_site_bytes: u64,
) -> Result<(), PreflightError> {
    if asset_len > max_asset_bytes {
        return Err(PreflightError::AssetTooLarge {
            len: asset_len,
            max: max_asset_bytes,
        });
    }
    if staged_total.saturating_add(asset_len) > max_site_bytes {
        return Err(PreflightError::SiteTooLarge {
            total: staged_total.saturating_add(asset_len),
            max: max_site_bytes,
        });
    }
    Ok(())
}

/// Hex SHA-256 of bytes, via ring. Manifest `sha` fields are checked against
/// this on commit — a page/asset that does not match its manifest is rejected.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let hash = digest::digest(&digest::SHA256, bytes);
    let mut hex = String::with_capacity(64);
    for byte in hash.as_ref() {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// One rendered surface of a published site, for the leakage scanner.
pub struct PublishedSurface<'a> {
    /// `html`, `index`, `graph`, `feed`, `sitemap` or `cache`.
    pub name: &'a str,
    pub body: &'a str,
}

/// An excluded note found where it must never appear.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Leak {
    pub surface: String,
    pub doc_id: String,
}

/// Leakage scanner: every excluded id must be absent from every surface.
/// Case: an excluded note id appearing in html/index/graph/feed/sitemap/cache
/// is a publish-blocking leak, by construction *and* by scan.
pub fn assert_no_leakage(
    surfaces: &[PublishedSurface<'_>],
    excluded_doc_ids: &[&str],
) -> Result<(), Vec<Leak>> {
    let mut leaks = Vec::new();
    for surface in surfaces {
        scan_surface(
            surface.name,
            surface.body.as_bytes(),
            excluded_doc_ids,
            &mut leaks,
        );
    }
    if leaks.is_empty() {
        Ok(())
    } else {
        Err(leaks)
    }
}

/// Scan raw staged bytes as well: a non-UTF8 asset must not bypass privacy checks.
pub(crate) fn assert_no_leakage_bytes(
    surfaces: &[(String, Vec<u8>)],
    excluded_doc_ids: &[&str],
) -> Result<(), Vec<Leak>> {
    let mut leaks = Vec::new();
    for (name, body) in surfaces {
        scan_surface(name, body, excluded_doc_ids, &mut leaks);
    }
    if leaks.is_empty() {
        Ok(())
    } else {
        Err(leaks)
    }
}

fn scan_surface(name: &str, body: &[u8], excluded_doc_ids: &[&str], leaks: &mut Vec<Leak>) {
    for &doc_id in excluded_doc_ids {
        let needle = doc_id.as_bytes();
        if !needle.is_empty() && body.windows(needle.len()).any(|part| part == needle) {
            leaks.push(Leak {
                surface: name.to_string(),
                doc_id: doc_id.to_string(),
            });
        }
    }
}

/// A fully rendered site bundle, ready for staging. Built only from pages
/// the manifest allowlisted — see `manifest::plan_dry_run`.
pub struct PublishedBundle {
    pub pages: Vec<PublishedPage>,
    pub assets: Vec<PublishedAsset>,
}

pub struct PublishedPage {
    pub path: String,
    pub html: String,
}

pub struct PublishedAsset {
    pub path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum PreflightError {
    #[error("embed needs a verified static projection")]
    EmbedNeedsProjection,
    #[error("board needs a verified static projection")]
    BoardNeedsProjection,
    #[error("dataview needs a verified static projection")]
    DataviewNeedsProjection,
    #[error("plugin content needs a verified static projection")]
    PluginNeedsProjection,
    #[error("asset too large: {len} bytes exceeds {max}")]
    AssetTooLarge { len: u64, max: u64 },
    #[error("site too large: {total} bytes exceeds {max}")]
    SiteTooLarge { total: u64, max: u64 },
}

#[derive(Debug, thiserror::Error)]
pub enum GuardError {
    #[error("malformed bearer token")]
    BadToken,
    #[error("empty password")]
    EmptyPassword,
    #[error("no random source")]
    RandomUnavailable,
}
