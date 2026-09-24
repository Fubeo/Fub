//! # Client publish: manifest locale + dry-run/commit/unpublish/rollback (P17, F36)
//!
//! Il modulo possiede preflight allowlist/provenienza, client HTTP e comandi
//! job basati su `HostApi`; l'authority del sito resta il servizio.
//! Le credenziali non entrano nel manifest e nessun comando richiede sync.

/// Sotto-moduli del discendente PublishSlice: lifecycle siti + provider UI.
/// `site.rs` = `PublishClient` (ureq); `views.rs` = `PublishViews`
/// (ViewProvider); `commands.rs` = `PublishCommands` (CommandProvider).
pub mod commands;
pub mod projection;
pub mod site;
pub mod views;

/// Versione wire attesa dal server (`GET /v1/hello` → `publish_protocol`).
pub const PUBLISH_PROTOCOL: &str = "fub-publish/1";

/// Glob minimale (`*` non attraversa `/`, `**` sì, `?` un carattere).
pub fn glob_match(pattern: &str, path: &str) -> bool {
    glob_segments(
        &pattern.split('/').collect::<Vec<_>>(),
        &path.split('/').collect::<Vec<_>>(),
    )
}

fn glob_segments(pattern: &[&str], path: &[&str]) -> bool {
    match (pattern.first(), path.first()) {
        (None, None) => true,
        (Some(p), _) if *p == "**" => {
            if pattern.len() == 1 {
                return true;
            }
            for i in 0..=path.len() {
                if glob_segments(&pattern[1..], &path[i..]) {
                    return true;
                }
            }
            false
        }
        (None, _) | (_, None) => false,
        (Some(p), Some(s)) => {
            if !glob_one(p, s) {
                return false;
            }
            glob_segments(&pattern[1..], &path[1..])
        }
    }
}

fn glob_one(pattern: &str, text: &str) -> bool {
    let (px, tx) = (pattern.as_bytes(), text.as_bytes());
    let (mut star, mut mark) = (None::<usize>, 0usize);
    let (mut i, mut j) = (0usize, 0usize);
    while j < tx.len() {
        if i < px.len() && (px[i] == b'?' || px[i] == tx[j]) {
            i += 1;
            j += 1;
        } else if i < px.len() && px[i] == b'*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(s) = star {
            i = s + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    while i < px.len() && px[i] == b'*' {
        i += 1;
    }
    i == px.len()
}

/// Verifica `GET /v1/hello` lato publish (`publish_protocol`).
pub fn assert_hello_publish(body: &[u8]) -> Result<(), String> {
    #[derive(serde::Deserialize)]
    struct Hello {
        publish_protocol: String,
    }
    let hello: Hello = serde_json::from_slice(body).map_err(|_| "bad hello body".to_string())?;
    if hello.publish_protocol == PUBLISH_PROTOCOL {
        Ok(())
    } else {
        Err(format!(
            "protocol mismatch: got {}, want {PUBLISH_PROTOCOL}",
            hello.publish_protocol
        ))
    }
}

/// Sottocartella di stato publish dell'istanza: `config_root.join("publish")`
/// (Main). Il bundle TRUSTED la riceve già scoped; questo helper serve ai
/// chiamanti che partono dalla radice (mai cwd/env inventate).
pub fn scoped_state_dir(config_root: &camino::Utf8Path) -> camino::Utf8PathBuf {
    config_root.join("publish")
}
