//! Adattatore OS per `fub://`: thin sopra `fub_host::automation`, mai parser duplicato.
//!
//! L'app non decide cosa sia valido: valida con le stesse firme di CLI/NM e
//! traduce l'esito in navigazione/apertura/ricerca/proposta di capture.
//! Scritture solo con conferma esplicita della shell; callback solo con policy
//! deny-default. Nessuna porta JS, nessuna esecuzione remota.

use fub_host::automation::{parse_fub_uri, validate_callback, CallbackPolicy, FubUri};

/// Esito per la shell: cosa aprire/cercare o cosa confermare.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UriOutcome {
    Navigate {
        vault: Option<String>,
        note: Option<String>,
        heading: Option<String>,
        block: Option<String>,
        split: Option<String>,
        window: Option<String>,
    },
    /// Requires confirmation before mutation.
    Create {
        action: String,
        vault: Option<String>,
        folder: Option<String>,
        name: Option<String>,
        title: Option<String>,
        template: Option<String>,
        date: Option<String>,
    },
    Search {
        vault: Option<String>,
        q: Option<String>,
        tag: Option<String>,
        folder: Option<String>,
    },
    /// Nothing is committed or opened by this pure adapter.
    CapturePending {
        vault: Option<String>,
        folder: Option<String>,
        note: Option<String>,
        mode: Option<String>,
        title: Option<String>,
        markdown: Option<String>,
        source_url: Option<String>,
        success_callback: Option<String>,
        error_callback: Option<String>,
    },
}

/// Policy dell'app: deny di default; l'OS apre solo ciò che la shell conferma.
pub fn app_callback_policy() -> CallbackPolicy {
    CallbackPolicy::deny_all()
}

/// Valida e traduce un URI in esito per la shell. Puro: nessuna I/O.
pub fn handle_fub_uri(raw: &str) -> Result<UriOutcome, String> {
    handle_fub_uri_with_policy(raw, &app_callback_policy())
}

/// The composition layer may supply an explicitly authorized policy. This
/// adapter only classifies and validates; it never follows a callback.
pub fn handle_fub_uri_with_policy(
    raw: &str,
    policy: &CallbackPolicy,
) -> Result<UriOutcome, String> {
    let parsed = parse_fub_uri(raw).map_err(|e| e.to_string())?;
    if let FubUri::Capture {
        success_callback,
        error_callback,
        ..
    } = &parsed
    {
        for callback in [success_callback, error_callback].into_iter().flatten() {
            validate_callback(callback, policy).map_err(|e| e.to_string())?;
        }
    }
    Ok(match parsed {
        FubUri::Open {
            vault,
            note,
            heading,
            block,
            split,
            window,
        } => UriOutcome::Navigate {
            vault,
            note,
            heading,
            block,
            split,
            window,
        },
        FubUri::New {
            vault,
            folder,
            name,
            title,
            template,
        } => UriOutcome::Create {
            action: "new".to_string(),
            vault,
            folder,
            name,
            title,
            template,
            date: None,
        },
        FubUri::Daily { vault, date } => UriOutcome::Create {
            action: "daily".to_string(),
            vault,
            folder: None,
            name: None,
            title: None,
            template: None,
            date,
        },
        FubUri::Unique {
            vault,
            folder,
            prefix,
        } => UriOutcome::Create {
            action: "unique".to_string(),
            vault,
            folder,
            name: prefix,
            title: None,
            template: None,
            date: None,
        },
        FubUri::Search {
            vault,
            q,
            tag,
            folder,
        } => UriOutcome::Search {
            vault,
            q,
            tag,
            folder,
        },
        FubUri::Capture {
            vault,
            folder,
            note,
            mode,
            title,
            markdown,
            source_url,
            success_callback,
            error_callback,
        } => UriOutcome::CapturePending {
            vault,
            folder,
            note,
            mode: mode.map(|m| m.as_str().to_string()),
            title,
            markdown,
            source_url,
            success_callback,
            error_callback,
        },
    })
}

/// Registrazione OS: gli schemi che l'installer dichiara. La GUI resta
/// invocabile esplicitamente (`fub --uri …`); il binario resta `fub`.
pub const URI_SCHEME: &str = "fub";
pub const URI_ACTIONS: &[&str] = &["open", "new", "daily", "unique", "search", "capture"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_maps_to_navigate_without_writing() {
        let outcome = handle_fub_uri("fub://open?vault=v&note=a%2Fb.md#sezione").unwrap();
        assert!(matches!(outcome, UriOutcome::Navigate { .. }));
    }

    #[test]
    fn traversal_is_denied_before_any_shell_action() {
        assert!(handle_fub_uri("fub://open?note=..%2Ffuori.md").is_err());
    }

    #[test]
    fn capture_never_writes_silently() {
        let outcome = handle_fub_uri("fub://capture?mode=create&title=Ciao").unwrap();
        assert!(matches!(
            outcome,
            UriOutcome::CapturePending { markdown: None, .. }
        ));
    }

    #[test]
    fn javascript_callback_is_denied() {
        assert!(
            handle_fub_uri("fub://capture?mode=create&success_callback=javascript%3Aalert(1)")
                .is_err()
        );
    }

    #[test]
    fn unknown_action_is_denied() {
        assert!(handle_fub_uri("fub://exec?cmd=rm").is_err());
    }
}
