//! Inoltro degli indirizzi `fub://` e dei file aperti dal sistema alla shell.

use super::*;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedAction {
    pub(crate) raw: String,
    pub(crate) kind: &'static str,
    pub(crate) reason: Option<String>,
}

pub(crate) fn forward_uri(app: &AppHandle, raw: &str) {
    // Prima la coda dell'host, che c'è anche a freddo, quando la webview non
    // esiste ancora: la shell la prende con `uri.pending` all'avvio e a ogni
    // evento qui sotto, che è soltanto il campanello.
    if let Some(host) = app.try_state::<Host>() {
        if !host.receive_uri(raw) {
            // Il testo non va nel log: una cattura porta il ritaglio intero.
            tracing::warn!(target: "fub.app", "coda dei fub:// piena: un collegamento resta fuori");
        }
    }
    let action = match uri::handle_fub_uri(raw) {
        Ok(
            uri::UriOutcome::Navigate { .. }
            | uri::UriOutcome::Search { .. }
            | uri::UriOutcome::ChooseVault,
        ) => OpenedAction {
            raw: raw.to_string(),
            kind: "navigation",
            reason: None,
        },
        Ok(uri::UriOutcome::Create { .. } | uri::UriOutcome::CapturePending { .. }) => {
            OpenedAction {
                raw: raw.to_string(),
                kind: "pending_action",
                reason: None,
            }
        }
        Err(error) => OpenedAction {
            raw: raw.to_string(),
            kind: "invalid",
            reason: Some(error),
        },
    };
    if let Some(main) = app.get_webview_window("main") {
        if main
            .url()
            .is_ok_and(|url| resources::is_local_origin(url.as_str()))
        {
            let _ = main.emit("fub://pending-action", action);
        }
    }
}

#[cfg(mobile)]
pub(crate) fn forward_mobile_opened(app: &AppHandle, raw: &str) {
    // Spinta senza coda di recupero: la shell mobile riceve `fub://opened-url`
    // e riclassifica con `mobile_classify_opened_url` prima di ogni gesto.
    match mobile::classify_opened_url(raw) {
        Ok(opened) => {
            if let Some(main) = app.get_webview_window("main") {
                if main
                    .url()
                    .is_ok_and(|url| resources::is_local_origin(url.as_str()))
                {
                    let _ = main.emit("fub://opened-url", opened);
                }
            }
        }
        Err(error) => tracing::warn!(target: "fub.app", "rejected OS URL: {error}"),
    }
}
