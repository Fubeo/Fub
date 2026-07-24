//! Costruzione della view dichiarativa dei backlink.
//!
//! È il primo esempio di feature ufficiale espressa nel protocollo di UI
//! dichiarativa ([`UiNode`]): il frontend la rende con i suoi componenti nativi,
//! esattamente come farà un plugin di terzi.

use fubmd_abi::traits::BacklinkRef;
use fubmd_abi::ui::{ActionId, Axis, UiNode};

/// Costruisce l'albero `UiNode` del pannello backlink per un documento.
pub fn build_backlinks_view(refs: &[BacklinkRef]) -> UiNode {
    if refs.is_empty() {
        return UiNode::Stack {
            dir: Axis::Column,
            gap: 4,
            children: vec![UiNode::Text {
                content: "Nessun backlink.".to_string(),
            }],
        };
    }

    let items = refs
        .iter()
        .map(|r| UiNode::ListItem {
            title: r.source.page_name().to_string(),
            subtitle: r.context.clone(),
            // l'azione porta il DocId sorgente, così il frontend può navigare.
            action: Some(ActionId(format!("open:{}", r.source.as_str()))),
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
}
