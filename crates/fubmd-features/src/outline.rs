//! Il pannello **outline** (struttura) come `ViewProvider`, secondo provider
//! vero dopo i backlink e sullo stesso giro.
//!
//! È il caso che ha portato nel contratto il **canale metadata**: una view non
//! ha un `FormatProvider` (è un plugin), quindi non può parsare un documento per
//! ricavarne gli heading. Li chiede al kernel — che il modello parsato ce l'ha —
//! con [`IndexQuery::Outline`], la stessa porta dei backlink
//! ([`HostApi::query_index`]). Il click su un heading torna come `on_action` e la
//! view risponde [`ViewUpdate::Reveal`], che la shell esegue portando l'editor
//! sull'intervallo. Nessun pezzo del giro è cablato nell'app.

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::model::{Heading, Span};
use fubmd_abi::traits::{HostApi, IndexQuery, IndexResult, ViewPlacement, ViewProvider, ViewSpec};
use fubmd_abi::ui::{ActionId, Axis, UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const OUTLINE_ID: &str = "fubmd.outline";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const OUTLINE_VIEW: &str = "outline";

/// Prefisso dell'azione di salto a un heading; porta l'intervallo in byte
/// (`start:end`) del titolo. Il documento è quello attivo — lo stesso di cui la
/// view mostra la struttura — e in `on_action` lo si chiede all'host, così un
/// path con caratteri strani non deve stare dentro l'`ActionId`.
const REVEAL: &str = "reveal:";

/// Un livello di rientro nel titolo, reso con uno spazio EM (i normali si
/// collassano nel DOM). L'albero `UiNode` non ha un campo "livello": la
/// gerarchia si vede così, in attesa di un eventuale `UiNode` ad albero.
const INDENT: &str = "\u{2003}";

/// Il pannello struttura. Senza stato: heading e documento attivo li chiede
/// all'host a ogni chiamata.
#[derive(Default)]
pub struct OutlineView;

impl ViewProvider for OutlineView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: OUTLINE_VIEW.to_string(),
            title: "Struttura".to_string(),
            placement: ViewPlacement::RightSidebar,
            // Gli heading cambiano quando cambia il documento: `IndexUpdated`
            // copre ogni scrittura (anche quelle arrivate dal watcher).
            refresh: EventMask(vec![EventKind::IndexUpdated]),
        }]
    }

    fn render_view(&self, _view: &str, host: &dyn HostApi) -> Result<UiNode, PluginError> {
        let Some(active) = host.active_document() else {
            return Ok(placeholder("Nessuna nota aperta."));
        };
        let headings = match host.query_index(IndexQuery::Outline { doc: active })? {
            IndexResult::Outline(h) => h,
            other => {
                return Err(PluginError::Internal(format!(
                    "query outline: risposta fuori tema: {other:?}"
                )))
            }
        };
        Ok(build_outline_view(&headings))
    }

    fn on_action(
        &self,
        _view: &str,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // "reveal:START:END" → salta a quell'intervallo nel documento attivo.
        let Some(rest) = action.action.0.strip_prefix(REVEAL) else {
            return Ok(ViewUpdate::None);
        };
        let Some(span) = parse_span(rest) else {
            return Ok(ViewUpdate::None);
        };
        // Il documento è quello di cui la view mostra la struttura: l'attivo.
        // Cliccare l'outline non cambia il documento attivo, quindi è ancora lui.
        match host.active_document() {
            Some(doc) => Ok(ViewUpdate::Reveal {
                doc_id: doc.as_str().to_string(),
                span,
            }),
            None => Ok(ViewUpdate::None),
        }
    }
}

/// `"start:end"` → `Span`, o `None` se malformato.
fn parse_span(s: &str) -> Option<Span> {
    let (start, end) = s.split_once(':')?;
    Some(Span::new(start.parse().ok()?, end.parse().ok()?))
}

fn placeholder(text: &str) -> UiNode {
    UiNode::Stack {
        dir: Axis::Column,
        gap: 4,
        children: vec![UiNode::Text {
            content: text.to_string(),
        }],
    }
}

/// Costruisce l'albero `UiNode` dell'outline. Separato dal provider perché è
/// pura trasformazione dati→UI: si prova senza un host.
pub fn build_outline_view(headings: &[Heading]) -> UiNode {
    if headings.is_empty() {
        return placeholder("Nessun heading.");
    }

    let items = headings
        .iter()
        .map(|h| UiNode::ListItem {
            title: format!(
                "{}{}",
                INDENT.repeat(h.level.saturating_sub(1) as usize),
                h.text
            ),
            subtitle: None,
            action: Some(ActionId(format!("{REVEAL}{}:{}", h.span.start, h.span.end))),
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
    use fubmd_abi::model::Span;

    fn h(level: u8, text: &str, start: usize, end: usize) -> Heading {
        Heading {
            level,
            text: text.to_string(),
            slug: text.to_lowercase(),
            span: Span::new(start, end),
        }
    }

    #[test]
    fn empty_shows_placeholder() {
        assert!(matches!(
            &build_outline_view(&[]),
            UiNode::Stack { children, .. } if matches!(&children[0], UiNode::Text { .. })
        ));
    }

    #[test]
    fn nested_headings_are_indented_and_carry_reveal_actions() {
        let tree = build_outline_view(&[h(1, "Titolo", 0, 8), h(2, "Sezione", 20, 30)]);
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains("Titolo"));
        // il secondo heading (livello 2) è rientrato di uno EM space
        assert!(json.contains(&format!("{INDENT}Sezione")));
        assert!(json.contains("reveal:0:8"));
        assert!(json.contains("reveal:20:30"));
    }

    #[test]
    fn render_reads_active_doc_and_queries_the_host() {
        let host =
            MemoryHost::new().con_outline("nota.md", &[h(1, "Uno", 0, 5), h(2, "Due", 10, 15)]);
        host.set_active(Some("nota.md"));
        let tree = OutlineView.render_view(OUTLINE_VIEW, &host).unwrap();
        let json = serde_json::to_string(&tree).unwrap();
        assert!(json.contains("Uno"));
        assert!(json.contains("reveal:10:15"));
    }

    #[test]
    fn render_without_active_doc_is_a_placeholder() {
        let host = MemoryHost::new();
        assert!(matches!(
            OutlineView.render_view(OUTLINE_VIEW, &host).unwrap(),
            UiNode::Stack { children, .. } if matches!(&children[0], UiNode::Text { .. })
        ));
    }

    #[test]
    fn clicking_a_heading_reveals_its_span_in_the_active_doc() {
        let mut host = MemoryHost::new();
        host.set_active(Some("nota.md"));
        let update = OutlineView
            .on_action(
                OUTLINE_VIEW,
                UiAction {
                    action: ActionId("reveal:10:15".into()),
                    payload: serde_json::Value::Null,
                },
                &mut host,
            )
            .unwrap();
        assert_eq!(
            update,
            ViewUpdate::Reveal {
                doc_id: "nota.md".into(),
                span: Span::new(10, 15),
            }
        );
    }
}
