//! Il pannello backlink come **`ViewProvider`** — la prima feature ufficiale
//! che esercita il protocollo di view per intero, non solo il rendering.
//!
//! È dogfooding vero: il provider non riceve i dati già pronti dall'app, se li
//! prende dall'[`HostApi`] come dovrà fare un plugin di terzi. Le due capacità
//! che glielo permettono — [`HostApi::active_context`] (quale nota guardo) e
//! [`HostApi::query_index`] (i suoi backlink) — sono esattamente ciò che prima
//! mancava al contratto e costringeva l'app a fargli da tramite. Il giro
//! completo è: la shell imposta il documento attivo → chiama `render_view` →
//! il provider chiede i backlink all'host → un click torna come `on_action` e
//! il provider risponde [`ViewUpdate::Navigate`], che la shell esegue. Nessun
//! pezzo del percorso è cablato nell'app.

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::session::ContextMask;
use fubmd_abi::traits::{
    BacklinkRef, HostApi, IndexQuery, IndexResult, ViewPlacement, ViewProvider, ViewSpec,
};
use fubmd_abi::ui::{ActionId, Axis, UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const BACKLINKS_ID: &str = "fubmd.backlinks";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const BACKLINKS_VIEW: &str = "backlinks";

/// Prefisso dell'azione di navigazione emessa dai `ListItem` del pannello.
/// L'id porta con sé il `DocId` sorgente perché il click possa navigare senza
/// che il frontend sappia nulla della semantica: la rimanda al provider così
/// com'è, ed è il provider a tradurla in [`ViewUpdate::Navigate`].
const OPEN: &str = "open:";

/// Il pannello backlink. Senza stato: tutto ciò che gli serve lo chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct BacklinksView;

impl ViewProvider for BacklinksView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: BACKLINKS_VIEW.to_string(),
            title: "Backlink".to_string(),
            placement: ViewPlacement::RightSidebar,
            // I backlink invecchiano quando il grafo cambia: ogni modifica al
            // vault arriva come `IndexUpdated`.
            refresh: EventMask(vec![EventKind::IndexUpdated]),
            // …e quando cambia la nota guardata. Non dove ci si trova dentro:
            // i backlink di una nota sono gli stessi da ogni punto di essa, e
            // seguire la selezione qui sarebbe una query per battuta di tasto.
            follows: ContextMask::document(),
        }]
    }

    fn render_view(&self, _view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError> {
        let Some(active) = host.active_context().and_then(|c| c.doc) else {
            // Nessuna nota aperta: non è un errore, è uno stato.
            return Ok(placeholder("Nessuna nota aperta."));
        };
        // Senza finestra: il pannello elenca tutti i backlink della nota
        // aperta, e chi ne ha migliaia ha un problema di vault, non di pagina.
        let refs = match host.query_index(IndexQuery::Backlinks {
            target: active,
            page: None,
        })? {
            IndexResult::Backlinks(refs) => refs,
            other => {
                return Err(PluginError::Internal(format!(
                    "query backlink: risposta fuori tema: {other:?}"
                )))
            }
        };
        Ok(build_backlinks_view(&refs.items))
    }

    fn on_action(
        &self,
        _view: &str,
        action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // L'unica azione del pannello è "apri la sorgente di un backlink".
        match action.action.0.strip_prefix(OPEN) {
            Some(id) => Ok(ViewUpdate::Navigate {
                doc_id: id.to_string(),
            }),
            None => Ok(ViewUpdate::None),
        }
    }
}

/// Il segnaposto (nessun backlink / nessuna nota aperta).
fn placeholder(text: &str) -> UiNode {
    UiNode::Stack {
        dir: Axis::Column,
        gap: 4,
        children: vec![UiNode::Text {
            content: text.to_string(),
        }],
    }
}

/// Costruisce l'albero `UiNode` del pannello backlink per un insieme di
/// riferimenti entranti. Separato da [`BacklinksView`] perché è pura
/// trasformazione dati→UI: si prova senza un host.
pub fn build_backlinks_view(refs: &[BacklinkRef]) -> UiNode {
    if refs.is_empty() {
        return placeholder("Nessun backlink.");
    }

    let items = refs
        .iter()
        .map(|r| UiNode::ListItem {
            title: r.source.page_name().to_string(),
            subtitle: r.context.clone(),
            // l'azione porta il DocId sorgente, così il provider può navigare.
            action: Some(ActionId(format!("{OPEN}{}", r.source.as_str()))),
        })
        .collect();

    UiNode::Stack {
        dir: Axis::Column,
        gap: 6,
        children: vec![
            UiNode::Heading {
                level: 3,
                content: format!("{} backlink", refs.len()),
            },
            UiNode::List { items },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;
    use fubmd_abi::model::DocId;

    #[test]
    fn empty_shows_placeholder() {
        let node = build_backlinks_view(&[]);
        match node {
            UiNode::Stack { children, .. } => {
                assert!(matches!(&children[0], UiNode::Text { .. }));
            }
            _ => panic!("atteso stack"),
        }
    }

    #[test]
    fn lists_backlinks_with_actions() {
        let refs = vec![BacklinkRef {
            source: DocId::new("a/Nota.md"),
            context: Some("→ target".into()),
        }];
        let node = build_backlinks_view(&refs);
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("Nota"));
        assert!(json.contains("open:a/Nota.md"));
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        // Il provider non riceve niente: il documento attivo e i backlink li
        // prende dall'host, esattamente come farà un plugin.
        let host = MemoryHost::new().con_backlink("target.md", &["a/Uno.md", "Due.md"]);
        host.set_active(Some("target.md"));

        let tree = BacklinksView.render_view(BACKLINKS_VIEW, &host).unwrap();
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains("2 backlink"));
        assert!(json.contains("open:a/Uno.md"));
        assert!(json.contains("open:Due.md"));
    }

    #[test]
    fn render_without_active_doc_is_a_placeholder_not_an_error() {
        let host = MemoryHost::new();
        let tree = BacklinksView.render_view(BACKLINKS_VIEW, &host).unwrap();
        match tree {
            UiNode::Stack { children, .. } => {
                assert!(matches!(&children[0], UiNode::Text { .. }));
            }
            _ => panic!("atteso stack segnaposto"),
        }
    }

    #[test]
    fn clicking_a_backlink_asks_the_shell_to_navigate() {
        let mut host = MemoryHost::new();
        let update = BacklinksView
            .on_action(
                BACKLINKS_VIEW,
                UiAction {
                    action: ActionId("open:a/Uno.md".into()),
                    payload: serde_json::Value::Null,
                },
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Navigate {
                doc_id: "a/Uno.md".into()
            }
        );
    }
}
