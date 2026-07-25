//! Il pannello **tag** come `ViewProvider`, terzo provider vero.
//!
//! Come l'outline, legge dal kernel via il canale metadata: i tag dell'intero
//! vault con la loro frequenza li aggrega il kernel dai modelli
//! ([`IndexQuery::Tags`]) — una view non parsa e non conosce l'intero vault.
//! Cliccare un tag chiede una ricerca ([`ViewUpdate::RunSearch`]): il pannello
//! non ha un indice suo, riusa quello di ricerca com'è (i tag sono un campo
//! indicizzato).

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::traits::{
    HostApi, IndexQuery, IndexResult, TagCount, ViewPlacement, ViewProvider, ViewSpec,
};
use fubmd_abi::ui::{ActionId, Axis, UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const TAGS_ID: &str = "fubmd.tags";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const TAGS_VIEW: &str = "tags";

/// Prefisso dell'azione di ricerca per tag; porta il nome del tag (senza `#`).
const SEARCH: &str = "tag:";

/// Il pannello tag. Senza stato: l'aggregazione la chiede all'host a ogni
/// render (i tag del vault cambiano a ogni modifica).
#[derive(Default)]
pub struct TagPanelView;

impl ViewProvider for TagPanelView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: TAGS_VIEW.to_string(),
            title: "Tag".to_string(),
            // Finché il `placement` era lettera morta la shell metteva il
            // pannello a destra per conoscenza privata; ora che il montaggio
            // lo rispetta, la dichiarazione dice la stessa cosa.
            placement: ViewPlacement::RightSidebar,
            // I tag sono aggregati vault-wide: invecchiano a ogni modifica
            // dell'indice, non al cambio di nota.
            refresh: EventMask(vec![EventKind::IndexUpdated]),
        }]
    }

    fn render_view(&self, _view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError> {
        // Senza finestra: il pannello mostra la distribuzione intera, ed è la
        // ragione per cui la `Page` è opzionale invece che obbligatoria.
        let tags = match host.query_index(IndexQuery::Tags { page: None })? {
            IndexResult::Tags(t) => t,
            other => {
                return Err(PluginError::Internal(format!(
                    "query tag: risposta fuori tema: {other:?}"
                )))
            }
        };
        Ok(build_tags_view(&tags.items))
    }

    fn on_action(
        &self,
        _view: &str,
        action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // "tag:<nome>" → cerca le note con quel tag. La query di ricerca è la
        // stessa che digiterebbe l'utente: `tag` è il campo indicizzato.
        match action.action.0.strip_prefix(SEARCH) {
            Some(name) => Ok(ViewUpdate::RunSearch {
                query: format!("tags:{name}"),
            }),
            None => Ok(ViewUpdate::None),
        }
    }
}

/// Costruisce l'albero `UiNode` del pannello tag. Separato dal provider perché è
/// pura trasformazione dati→UI: si prova senza un host. I tag arrivano già
/// ordinati per nome dal kernel.
pub fn build_tags_view(tags: &[TagCount]) -> UiNode {
    if tags.is_empty() {
        return UiNode::Stack {
            dir: Axis::Column,
            gap: 4,
            children: vec![UiNode::Text {
                content: "Nessun tag.".to_string(),
            }],
        };
    }

    let items = tags
        .iter()
        .map(|t| UiNode::ListItem {
            title: format!("#{}", t.name),
            subtitle: Some(t.count.to_string()),
            action: Some(ActionId(format!("{SEARCH}{}", t.name))),
        })
        .collect();

    UiNode::Stack {
        dir: Axis::Column,
        gap: 2,
        children: vec![UiNode::List { items }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;

    #[test]
    fn empty_shows_placeholder() {
        assert!(matches!(
            &build_tags_view(&[]),
            UiNode::Stack { children, .. } if matches!(&children[0], UiNode::Text { .. })
        ));
    }

    #[test]
    fn lists_tags_with_counts_and_search_actions() {
        let tags = [
            TagCount {
                name: "rust".into(),
                count: 3,
            },
            TagCount {
                name: "a/b".into(),
                count: 1,
            },
        ];
        let json = serde_json::to_string(&build_tags_view(&tags)).unwrap();
        assert!(json.contains("#rust"));
        assert!(json.contains("#a/b"));
        assert!(json.contains("tag:rust"));
    }

    #[test]
    fn render_asks_the_host_for_the_vault_tags() {
        let host = MemoryHost::new().con_tags(&[("rust", 2), ("note", 5)]);
        let json =
            serde_json::to_string(&TagPanelView.render_view(TAGS_VIEW, &host).unwrap()).unwrap();
        assert!(json.contains("#rust"));
        assert!(json.contains("#note"));
    }

    #[test]
    fn clicking_a_tag_asks_for_a_search() {
        let mut host = MemoryHost::new();
        let update = TagPanelView
            .on_action(
                TAGS_VIEW,
                UiAction {
                    action: ActionId("tag:rust".into()),
                    payload: serde_json::Value::Null,
                },
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::RunSearch {
                query: "tags:rust".into()
            }
        );
    }
}
