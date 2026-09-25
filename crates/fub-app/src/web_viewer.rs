//! Il web viewer isolato (P07/F24): una finestra con un'altra origine.
//!
//! # Perche' una finestra separata e non un iframe
//!
//! Un `iframe` nel DOM fidato eredita niente di cio' che serve: condivide
//! `localStorage`, cookie e permessi col documento che lo ospita, e il
//! `sandbox="allow-scripts"` esistente lascia comunque eseguire JavaScript nel
//! processo della shell con accesso alla navigazione del frame. La CSP
//! dell'app (`frame-src 'none'; object-src 'none'`) lo vieta e resta com'e'.
//!
//! Una `WebviewWindow` con label dedicata ha invece: profilo (storage, cookie,
//! cache) separato via `data_directory` dedicata sotto la config dir, niente
//! bridge IPC (nessuna capability remota registrata: la label `fub-viewer`
//! **non** sta in `capabilities/default.json`, quindi `invoke` da li' dentro
//! non risolve nessuna capability), niente accesso al filesystem del vault
//! (l'asset scope della finestra principale non si eredita), permessi negati
//! di default, download intercettati (`on_download` torna `false`: niente
//! scritture implicite; il salvataggio come nota passa da `viewer_save`,
//! ovvero da una trasformazione controllata via rete consentita).
//!
//! # Remoto default negato
//!
//! `ViewerOpen.allow_remote == false` apre solo `about:blank` (lettore locale):
//! qualunque URL http/https con remoto negato e' `PermissionDenied`, non un
//! fallback silenzioso. L'allowlist di default accetta solo https (mai http in
//! chiaro, mai `file:` — che aprirebbe il disco — mai schemi `javascript:`/`data:`).

use fub_abi::PluginError;

/// La label della finestra del viewer. Dedicata e stabile: le capability sono
/// legate alle label, quindi riusare `main` erediterebbe il bridge IPC. Main
/// aggiunge `capabilities/viewer.json` con `windows: ["fub-viewer"]` e
/// `permissions: []` (lista vuota: nessun comando raggiungibile); questa
/// costante e' l'unico punto che la nomina dal codice.
pub const VIEWER_LABEL: &str = "fub-viewer";

/// Protocolli mai aperti dal viewer, in nessuna modalita'.
const BLOCKED_SCHEMES: &[&str] = &["javascript", "data", "file", "blob", "fub-asset", "asset"];

/// Cosa aprire nel viewer: l'URL, il titolo (solo etichetta della finestra,
/// mai contenuto eseguito), se la rete e' consentita, e l'allowlist di host.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ViewerOpen {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub allow_remote: bool,
    #[serde(default)]
    pub allowlist: Vec<String>,
}

/// Una URL http(s) con host in allowlist (confronto case-insensitive, senza
/// porta ne' sottodomini impliciti: `www.esempio.it` non copre
/// `statico.www.esempio.it`).
fn host_allowed(url: &tauri::Url, allowlist: &[String]) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    url.port_or_known_default() == Some(443)
        && allowlist
            .iter()
            .any(|entry| entry.eq_ignore_ascii_case(host))
}

/// Decide se una URL puo' entrare nel viewer, senza aprirla.
///
/// - schema bloccato (`javascript:`, `data:`, `file:`, `blob:`, `fub-asset:`,
///   `asset:`) -> sempre `PermissionDenied`, anche con remoto consentito: il
///   viewer non e' una porta verso il disco o verso le risorse del vault;
/// - `about:blank` (lettore locale) -> sempre ammesso;
/// - http/https con `allow_remote == false` -> `PermissionDenied`;
/// - http in chiaro con remoto consentito -> `PermissionDenied` (niente rete
///   non cifrata verso contenuti di terzi);
/// - https con remoto consentito -> solo se l'host sta nell'allowlist.
pub fn check_viewer_url(open: &ViewerOpen) -> Result<tauri::Url, PluginError> {
    check_viewer_address(&open.url, open.allow_remote, &open.allowlist)
}

/// Same policy for initial loads, redirects and every subsequent navigation.
pub(crate) fn check_viewer_address(
    address: &str,
    allow_remote: bool,
    allowlist: &[String],
) -> Result<tauri::Url, PluginError> {
    if address == "about:blank" {
        return Ok("about:blank".parse().expect("about:blank parses as a URL"));
    }
    let url: tauri::Url = address.parse().map_err(|_| {
        PluginError::BadArgs(format!("`{address}` is not a URL the viewer can open").into())
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PluginError::PermissionDenied(
            "the viewer does not accept URLs with embedded credentials".into(),
        ));
    }
    let scheme = url.scheme();
    if BLOCKED_SCHEMES.contains(&scheme) {
        return Err(PluginError::PermissionDenied(
            format!("the viewer never opens `{scheme}:` URLs").into(),
        ));
    }
    if !matches!(scheme, "http" | "https") {
        return Err(PluginError::BadArgs(
            format!("`{address}` is not a URL the viewer can open").into(),
        ));
    }
    if !allow_remote {
        return Err(PluginError::PermissionDenied(
            "remote content is denied for this viewer: reopen it allowing remote content".into(),
        ));
    }
    if scheme != "https" {
        return Err(PluginError::PermissionDenied(
            "the viewer opens remote content only over https".into(),
        ));
    }
    if !host_allowed(&url, allowlist) {
        return Err(PluginError::PermissionDenied(
            format!(
                "the viewer opens only allowlisted hosts: `{}` is not listed",
                url.host_str().unwrap_or("?")
            )
            .into(),
        ));
    }
    Ok(url)
}

/// Il titolo della finestra, ridotto a etichetta: max 140 caratteri, niente
/// newline di controllo. Il titolo non esegue mai niente — resta una stringa
/// di `WebviewWindowBuilder::title` — ma una riga pulita evita log troncati e
/// title-bar con righe iniettate.
pub fn viewer_title(title: &str) -> String {
    let flat: String = title
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let trimmed = flat.trim();
    if trimmed.is_empty() {
        return "Web viewer".to_string();
    }
    let mut out = String::new();
    for c in trimmed.chars().take(140) {
        out.push(c);
    }
    out
}

/// Dove vive il profilo isolato del viewer (storage, cookie, cache separati
/// dalla finestra principale). Sotto la config dir, mai dentro il vault.
pub fn viewer_data_dir(config_dir: &camino::Utf8Path) -> camino::Utf8PathBuf {
    config_dir.join("web-viewer")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(url: &str, remote: bool, list: &[&str]) -> ViewerOpen {
        ViewerOpen {
            url: url.to_string(),
            title: "t".to_string(),
            allow_remote: remote,
            allowlist: list.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn the_local_reader_is_always_available() {
        let url = check_viewer_url(&open("about:blank", false, &[])).unwrap();
        assert_eq!(url.as_str(), "about:blank");
    }

    #[test]
    fn remote_is_denied_by_default_not_silently_downgraded() {
        let err = check_viewer_url(&open("https://esempio.it/a", false, &["esempio.it"]))
            .expect_err("remoto negato deve rifiutare, non aprire about:blank");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "faccia sbagliata: {err:?}"
        );
    }

    #[test]
    fn allowlist_cleartext_and_schemes_never_pass() {
        for (url, list) in [
            ("http://esempio.it/a", vec!["esempio.it"]),
            ("https://sotto.esempio.it/a", vec!["esempio.it"]),
            ("https://esempio.it/a", vec!["altro.it"]),
            ("javascript:alert(1)", vec![]),
            ("data:text/html,casa", vec![]),
            ("file:///etc/passwd", vec![]),
            ("fub-asset://localhost/3", vec![]),
            ("blob:https://esempio.it/x", vec!["esempio.it"]),
            ("https://esempio.it:8443/a", vec!["esempio.it"]),
            ("https://user:secret@esempio.it/a", vec!["esempio.it"]),
            ("nota.md", vec![]),
        ] {
            assert!(
                check_viewer_url(&open(url, true, &list)).is_err(),
                "{url:?} non deve entrare nel viewer"
            );
        }
        let ok = check_viewer_url(&open("https://Esempio.IT/a", true, &["esempio.it"])).unwrap();
        assert_eq!(ok.host_str(), Some("esempio.it"));
    }

    #[test]
    fn titles_are_labels_never_content() {
        assert_eq!(viewer_title(""), "Web viewer");
        assert_eq!(viewer_title("  Lettore  "), "Lettore");
        assert_eq!(viewer_title("a\nb\rc"), "a b c");
        assert_eq!(viewer_title(&"x".repeat(500)).chars().count(), 140);
    }

    #[test]
    fn the_viewer_profile_lives_outside_the_vault() {
        // Il separatore è quello del sistema: `\` su Windows.
        let config = camino::Utf8Path::new("/cfg");
        let dir = viewer_data_dir(config);
        assert_eq!(dir.parent(), Some(config));
        assert_eq!(dir.file_name(), Some("web-viewer"));
    }
}
