//! Il protocollo di **UI dichiarativa** dei plugin.
//!
//! Un plugin descrive la sua UI come albero `UiNode` (serializzabile,
//! neutro rispetto al framework); il frontend del core lo rende con i suoi
//! componenti nativi → temi coerenti, niente JS nei plugin. La variante
//! `WebView` è l'escape hatch: solo quando il dichiarativo non basta davvero.
//!
//! # Confine di fiducia
//!
//! `Html` e `WebView` iniettano contenuto attivo nella webview principale, che
//! ha accesso all'IPC con pieni privilegi: un plugin sandboxato che potesse
//! emetterle aggirerebbe l'intera sandbox via UI. Sono quindi varianti
//! **riservate al codice fidato** (core e feature ufficiali). L'host che riceve
//! un albero da un provider non fidato DEVE rifiutarlo con
//! [`UiNode::validate_untrusted`] — è lo stesso principio dell'enforcement dei
//! permessi in un solo punto (`HostApi`). Vedi
//! `docs/architecture/ui-protocol.md`.

use serde::{Deserialize, Serialize};

/// Id di un'azione richiamabile dalla UI (torna al provider via `on_action`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionId(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Axis {
    Row,
    Column,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Intent {
    #[default]
    Neutral,
    Primary,
    Danger,
}

/// Nodo di UI dichiarativa. Il frontend ha un componente per variante; il tema
/// è interamente controllato dal core (i plugin scelgono intenti semantici, non
/// colori).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case")]
pub enum UiNode {
    Stack {
        dir: Axis,
        gap: u8,
        children: Vec<UiNode>,
    },
    Text {
        content: String,
    },
    Heading {
        level: u8,
        content: String,
    },
    List {
        items: Vec<UiNode>,
    },
    ListItem {
        title: String,
        subtitle: Option<String>,
        action: Option<ActionId>,
    },
    Button {
        label: String,
        intent: Intent,
        action: ActionId,
    },
    /// Frammento già renderizzato a HTML (es. anteprima di un backlink).
    /// **Solo codice fidato**: vedi il confine di fiducia nel doc del modulo.
    Html {
        html: String,
    },
    /// Escape hatch: web-view isolata. Usata con parsimonia.
    /// **Solo codice fidato** finché non esistono asset story e CSP per i
    /// plugin (vedi `docs/architecture/ui-protocol.md`).
    WebView {
        url: String,
        height: u32,
    },
}

impl UiNode {
    /// Valida un albero proveniente da un provider **non fidato**: rifiuta le
    /// varianti riservate (`Html`, `WebView`) ovunque nell'albero.
    ///
    /// È il punto di enforcement del confine di fiducia della UI: l'host (M5:
    /// il proxy WASM; M4: il registry per i plugin nativi non-core) lo chiama
    /// su ogni albero restituito da `render_view` prima di passarlo al
    /// frontend.
    pub fn validate_untrusted(&self) -> Result<(), crate::error::PluginError> {
        match self {
            UiNode::Html { .. } => Err(crate::error::PluginError::PermissionDenied(
                "UiNode::Html è riservato al codice fidato".into(),
            )),
            UiNode::WebView { .. } => Err(crate::error::PluginError::PermissionDenied(
                "UiNode::WebView è riservato al codice fidato".into(),
            )),
            UiNode::Stack { children, .. } => {
                children.iter().try_for_each(UiNode::validate_untrusted)
            }
            UiNode::List { items } => items.iter().try_for_each(UiNode::validate_untrusted),
            UiNode::Text { .. }
            | UiNode::Heading { .. }
            | UiNode::ListItem { .. }
            | UiNode::Button { .. } => Ok(()),
        }
    }
}

/// Azione emessa dal frontend verso un `ViewProvider`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UiAction {
    pub action: ActionId,
    pub payload: serde_json::Value,
}

/// Aggiornamento restituito da un `ViewProvider` dopo un'azione.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewUpdate {
    /// Rimpiazza l'intero albero della view.
    Replace { root: UiNode },
    /// Nessun cambiamento visivo.
    None,
    /// Chiedi al core di navigare a un documento (usato dai backlink).
    Navigate { doc_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untrusted_tree_without_html_is_valid() {
        let tree = UiNode::Stack {
            dir: Axis::Column,
            gap: 1,
            children: vec![
                UiNode::Heading {
                    level: 2,
                    content: "Titolo".into(),
                },
                UiNode::List {
                    items: vec![UiNode::ListItem {
                        title: "voce".into(),
                        subtitle: None,
                        action: Some(ActionId("open".into())),
                    }],
                },
            ],
        };
        assert!(tree.validate_untrusted().is_ok());
    }

    #[test]
    fn untrusted_html_is_rejected_even_if_nested() {
        let tree = UiNode::Stack {
            dir: Axis::Row,
            gap: 0,
            children: vec![UiNode::List {
                items: vec![UiNode::Html {
                    html: "<script>evil()</script>".into(),
                }],
            }],
        };
        assert!(tree.validate_untrusted().is_err());
        let webview = UiNode::WebView {
            url: "https://x".into(),
            height: 100,
        };
        assert!(webview.validate_untrusted().is_err());
    }
}
