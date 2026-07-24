//! Il protocollo di **UI dichiarativa** dei plugin.
//!
//! Un plugin descrive la sua UI come albero `UiNode` (serializzabile,
//! neutro rispetto al framework); il frontend del core lo rende con i suoi
//! componenti nativi → temi coerenti, niente JS nei plugin. La variante
//! `WebView` è l'escape hatch: solo quando il dichiarativo non basta davvero.

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
    Html {
        html: String,
    },
    /// Escape hatch: web-view isolata. Usata con parsimonia.
    WebView {
        url: String,
        height: u32,
    },
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
