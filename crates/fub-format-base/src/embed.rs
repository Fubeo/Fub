//! Regola di sintassi e renderer per i blocchi ```base dentro markdown.
//!
//! Riusa i pattern `DiagramRule`/`DiagramRenderer`: la regola si innesta sul
//! formato reale `markdown` (mai un target inventato), il renderer emette un
//! `UiKind::Custom { ns: "fub:base" }` con fallback dichiarativo per le shell
//! che non conoscono il namespace. Nessuna nuova famiglia ABI.

use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger, SECTION_ATTR,
};
use fub_abi::format::{ParseContext, RenderOptions};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::ui::{Axis, UiKind, UiNode};
use fub_abi::FormatError;
use serde_json::json;

/// Id della regola di sintassi (namespace core, come `fub:diagrams`).
pub const BASE_RULE_ID: &str = "fub:base:rule";
/// Id del renderer (stesso namespace che la shell riconosce nei pixel).
pub const BASE_RENDERER_ID: &str = "fub:base";
/// Namespace con cui il blocco arriva alla shell dentro `UiKind::Custom`.
/// Stessa regola dei diagrammi: chi manda e chi disegna sono riconoscibili
/// come la stessa estensione.
pub const BASE_NS: &str = "fub:base";
/// Formato proprietario della regola.
pub const BASE_FORMAT: &str = "base";
/// Formato su cui la regola si innesta (quello reale, non uno inventato).
pub const MARKDOWN_FORMAT: &str = "markdown";
/// Il `custom_kind` emesso dalla regola.
pub const BASE_CUSTOM_KIND: &str = "base";

const VIEW_TITLE: &str = "view_title";
const SOURCE_KEY: &str = "source";
const VIEW_KEY: &str = "view";

/// Le stringhe del blocco base (solo il fallback ne ha una).
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it").with(VIEW_TITLE, "Base ({view})"),
        StringCatalog::new("en").with(VIEW_TITLE, "Base ({view})"),
    ]
}

/// ```base (e ```BASE, case-insensitive come gli altri recinti) diventa un
/// blocco custom `base` con `{ source, view, container }` dal documento sorgente.
pub struct BaseRule;

impl SyntaxRule for BaseRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: BASE_RULE_ID.into(),
            format: MARKDOWN_FORMAT.into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["base".into()],
            },
            order: 0,
            // Sempre attiva: non esiste una voce `fub:base` nel vocabolario
            // `syntax` dell'ABI e il contesto obsidian non potrebbe accenderla.
            // Una regola senza `option` è sempre attiva per contratto.
            option: None,
            produces: vec![BASE_CUSTOM_KIND.into()],
        }
    }

    fn apply(
        &self,
        m: &SyntaxMatch,
        ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        // Un recinto vuoto non è una base: declinare lo lascia com'è, cioè un
        // blocco di codice, che è ciò che l'utente ha scritto.
        if m.text.trim().is_empty() {
            return Ok(None);
        }
        // A future or invalid definition must stay the original fenced source:
        // an empty custom block would otherwise make the user's text vanish.
        let definition = match crate::model::BaseDefinition::parse(&m.text) {
            Ok(definition) => definition,
            Err(_) => return Ok(None),
        };
        let Some(first) = definition.views.first() else {
            return Ok(None);
        };
        let view = Some(first.name.clone());
        Ok(Some(SyntaxProduct::Block {
            custom_kind: BASE_CUSTOM_KIND.into(),
            attrs: json!({ "source": m.text, "view": view, "container": ctx.doc_id }),
            blocks: vec![],
        }))
    }
}

/// Disegna un blocco `base` mandando alla shell un `UiKind::Custom`.
pub struct BaseRenderer;

impl CustomRenderer for BaseRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: BASE_RENDERER_ID.into(),
            kinds: vec![BASE_CUSTOM_KIND.into()],
        }
    }

    fn render(
        &self,
        block: &CustomBlock,
        opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let Some(source) = block.attrs.get("source").and_then(|v| v.as_str()) else {
            return Ok(CustomRendering::Fallback);
        };
        // La sezione scelta dal riferimento (`[[x.base#Vista]]`) vince sulla
        // vista di default del blocco.
        let view = block
            .attrs
            .get(SECTION_ATTR)
            .or_else(|| block.attrs.get(VIEW_KEY))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        // Static/print output must be inert source, not a JS-only placeholder.
        if opts.target != fub_abi::format::RenderTarget::Screen {
            return Ok(CustomRendering::Fallback);
        }
        let Ok(definition) = crate::model::BaseDefinition::parse(source) else {
            return Ok(CustomRendering::Fallback);
        };
        // Never fall back to the first view when an explicit selector is wrong.
        if !view
            .as_ref()
            .is_some_and(|name| definition.views.iter().any(|v| &v.name == name))
        {
            return Ok(CustomRendering::Fallback);
        }
        let title = match &view {
            Some(view) => Text::message(VIEW_TITLE, vec![Arg::text(VIEW_KEY, view)]),
            None => Text::from("Base"),
        };
        let fallback = UiNode::new(UiKind::Section {
            title,
            collapsed: true,
            children: vec![UiNode::new(UiKind::Stack {
                dir: Axis::Column,
                gap: 0,
                children: vec![UiNode::text(source)],
            })],
        });
        Ok(CustomRendering::Ui(Box::new(UiNode::new(UiKind::Custom {
            ns: BASE_NS.into(),
            payload: json!({ SOURCE_KEY: source, VIEW_KEY: view, "container": block.attrs.get("container") }),
            fallback: vec![fallback],
        }))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::custom::SyntaxTrigger as Trigger;

    #[test]
    fn spec_innesta_markdown_sempre_attiva() {
        let spec = BaseRule.spec();
        assert_eq!(spec.id, BASE_RULE_ID);
        assert_eq!(spec.format, MARKDOWN_FORMAT);
        assert_eq!(spec.option, None);
        assert_eq!(spec.produces, vec![BASE_CUSTOM_KIND.to_string()]);
        match spec.trigger {
            Trigger::Fence { info } => assert_eq!(info, vec!["base".to_string()]),
            other => panic!("trigger inatteso: {other:?}"),
        }
    }

    #[test]
    fn recinto_vuoto_declina_recinto_pieno_produce() {
        let ctx = ParseContext::bare("n.md");
        let span = fub_abi::Span::EMPTY;
        let empty = SyntaxMatch {
            trigger: "fence:base".into(),
            text: "   \n".into(),
            span,
        };
        assert!(BaseRule.apply(&empty, &ctx).unwrap().is_none());
        let future = SyntaxMatch {
            trigger: "fence:base".into(),
            text: "version: 999\nviews:\n  - {name: A, type: table}\n".into(),
            span,
        };
        assert!(BaseRule.apply(&future, &ctx).unwrap().is_none());
        let full = SyntaxMatch {
            trigger: "fence:base".into(),
            text: "views:\n  - {name: A, type: table}\n".into(),
            span,
        };
        let product = BaseRule.apply(&full, &ctx).unwrap().expect("produce");
        match product {
            SyntaxProduct::Block {
                custom_kind, attrs, ..
            } => {
                assert_eq!(custom_kind, BASE_CUSTOM_KIND);
                assert!(attrs.get("source").is_some());
                assert_eq!(attrs["container"], json!("n.md"));
            }
            other => panic!("prodotto inatteso: {other:?}"),
        }
    }

    #[test]
    fn renderer_manda_custom_con_fallback_e_rifiuta_sorgente_rotta() {
        let good = CustomBlock {
            custom_kind: BASE_CUSTOM_KIND.into(),
            attrs: json!({ "source": "views:\n  - {name: A, type: table}\n", "view": "A", "container": "Projects/host.md" }),
            blocks: vec![],
            anchor: None,
            span: fub_abi::Span::EMPTY,
        };
        let out = BaseRenderer
            .render(&good, &RenderOptions::preview())
            .unwrap();
        let CustomRendering::Ui(node) = out else {
            panic!("atteso Ui");
        };
        let UiKind::Custom {
            ns,
            payload,
            fallback,
        } = &node.kind
        else {
            panic!("atteso Custom");
        };
        assert_eq!(ns, BASE_NS);
        assert_eq!(
            payload.get(SOURCE_KEY).and_then(|source| source.as_str()),
            good.attrs.get("source").and_then(|source| source.as_str())
        );
        assert_eq!(payload["container"], json!("Projects/host.md"));
        assert_eq!(fallback.len(), 1);
        let mut unknown = good.clone();
        unknown.attrs["view"] = json!("Missing");
        assert!(matches!(
            BaseRenderer
                .render(&unknown, &RenderOptions::preview())
                .unwrap(),
            CustomRendering::Fallback
        ));
        assert!(matches!(
            BaseRenderer
                .render(
                    &good,
                    &RenderOptions {
                        target: fub_abi::format::RenderTarget::StaticSite,
                        ..RenderOptions::default()
                    }
                )
                .unwrap(),
            CustomRendering::Fallback
        ));

        let broken = CustomBlock {
            custom_kind: BASE_CUSTOM_KIND.into(),
            attrs: json!({ "source": "filters: [non chiuso\n" }),
            blocks: vec![],
            anchor: None,
            span: fub_abi::Span::EMPTY,
        };
        assert!(matches!(
            BaseRenderer
                .render(&broken, &RenderOptions::preview())
                .unwrap(),
            CustomRendering::Fallback
        ));
    }

    #[test]
    fn la_sezione_scelta_vince_sulla_vista_di_default() {
        let mut block = CustomBlock {
            custom_kind: BASE_CUSTOM_KIND.into(),
            attrs: json!({
                "source": "views:\n  - {name: A, type: table}\n  - {name: B, type: table}\n",
                "view": "A",
            }),
            blocks: vec![],
            anchor: None,
            span: fub_abi::Span::EMPTY,
        };
        block.attrs[SECTION_ATTR] = json!("B");
        let CustomRendering::Ui(node) = BaseRenderer
            .render(&block, &RenderOptions::preview())
            .unwrap()
        else {
            panic!("atteso Ui");
        };
        let UiKind::Custom { payload, .. } = &node.kind else {
            panic!("atteso Custom");
        };
        assert_eq!(payload[VIEW_KEY], json!("B"));
    }
}
