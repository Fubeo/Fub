//! Le sintassi e i renderer ufficiali — il dogfooding del §3.1 e del §3.2.
//!
//! Sono la strada che percorrerà un plugin di terzi, e la percorrono per intero:
//! nessuna di queste tre regole tocca il provider markdown, nessuno di questi
//! due renderer sta dentro di lui. Un plugin che volesse aggiungere la propria
//! sintassi scriverebbe **esattamente questo codice**, con un altro namespace.
//!
//! | | trigger | produce | chi lo disegna |
//! |---|---|---|---|
//! | `fub:diagrams` | recinto `mermaid`, `plantuml`, `graphviz`, `dot`, `d2` | [`custom_kind::DIAGRAM`] | [`DiagramRenderer`], via `UiNode` |
//! | `fub:math` | recinto `math`, `latex`, `tex` | [`custom_kind::MATH`] | [`MathRenderer`], via HTML |
//! | `fub:highlight` | `==…==` | [`custom_kind::HIGHLIGHT`] (inline) | il provider, nel degrado generico |
//!
//! Le due vie di [`CustomRendering`] sono entrambe esercitate, e non per
//! simmetria: sono **diverse**. Il diagramma esce come `UiNode` perché nessuno
//! qui dentro sa disegnare un grafo — il nodo `Custom { ns }` porta il sorgente
//! alla shell, che ci mette il suo widget se ce l'ha e altrimenti disegna il
//! `fallback` dichiarativo. La formula esce come HTML perché ciò che si può fare
//! senza un motore TeX è mostrarla in un blocco suo, e quello è markup.
//!
//! **`fub:highlight` non ha un renderer, ed è deliberato.** Un `Inline::Custom`
//! lo disegna il provider (il registro del §3.2 è dei blocchi), e ciò che
//! serviva era che il degrado generico degli inline smettesse di emettere
//! **niente** — che è il difetto che questa regola ha scoperto.

use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::error::FormatError;
use fub_abi::format::{ParseContext, RenderOptions};
use fub_abi::html::{attr, escape};
use fub_abi::model::custom_kind;
use fub_abi::options::syntax;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::ui::{Axis, UiKind, UiNode};
use serde_json::json;

/// L'id del formato su cui queste regole si innestano.
const MARKDOWN: &str = "markdown";

/// Identità della feature che offre le sintassi innestate e i loro renderer: è
/// lo spazio dati che l'host le concede, e dal §7.3 anche il proprietario dei
/// nomi che registra.
pub const BLOCKS_ID: &str = "fub.blocks";

pub const DIAGRAMS_RULE: &str = "fub:diagrams";
pub const MATH_RULE: &str = "fub:math";
pub const HIGHLIGHT_RULE: &str = "fub:highlight";
pub const DIAGRAM_RENDERER: &str = "fub:diagram";
pub const MATH_RENDERER: &str = "fub:math";

/// Il namespace con cui un diagramma arriva alla shell dentro `UiKind::Custom`.
/// È lo stesso nome del renderer, e non per pigrizia: chi manda e chi disegna
/// devono essere riconoscibili come **la stessa estensione**.
pub const DIAGRAM_NS: &str = "fub:diagram";

/// Il titolo del ripiego di un diagramma: l'**unica** stringa che questo
/// componente scriva a un umano.
///
/// Vale la pena dirlo perché è il caso che il §12.4 non prevedeva: «sei feature
/// senza catalogo» suggerisce sei cataloghi da riempire, e uno di questi ha una
/// voce sola. Non è una svista — i blocchi sono un `CustomBlockProvider`, e ciò
/// che rendono è il contenuto di chi scrive la nota, non prosa loro. La riga
/// che resta è quella che compare quando il rendering vero non c'è: e proprio
/// perché è l'unica, sarebbe stata l'ultima a essere tradotta.
const FALLBACK_TITLE: &str = "fallback_title";
/// Il nome del motore (`mermaid`, `graphviz`): un dato, non una parola da
/// tradurre — `ArgValue::Text` è per questo.
const ENGINE: &str = "engine";

/// Le stringhe dei blocchi. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it").with(FALLBACK_TITLE, "Diagramma ({engine})"),
        StringCatalog::new("en").with(FALLBACK_TITLE, "Diagram ({engine})"),
    ]
}

// ---------------------------------------------------------------------------
// I diagrammi: un recinto che il core delimita e non sa disegnare
// ---------------------------------------------------------------------------

/// ```` ```mermaid ```` (e i suoi fratelli) diventano un [`custom_kind::DIAGRAM`].
///
/// Il motore sta negli `attrs` e non nel kind perché il kind è la **famiglia**:
/// chi disegna i diagrammi vuole un punto d'innesto solo, e chi ne aggiunge un
/// dialetto non deve registrarne un altro.
pub struct DiagramRule;

/// I motori che questa regola rivendica. Tenerli in una costante è ciò che
/// permette di dirlo due volte — nel trigger e nell'`engine` degli `attrs` —
/// senza che i due elenchi possano divergere.
const ENGINES: &[&str] = &["mermaid", "plantuml", "graphviz", "dot", "d2"];

impl SyntaxRule for DiagramRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: DIAGRAMS_RULE.into(),
            format: MARKDOWN.into(),
            trigger: SyntaxTrigger::Fence {
                info: ENGINES.iter().map(|and| and.to_string()).collect(),
            },
            order: 0,
            option: Some(syntax::DIAGRAMS.into()),
            produces: vec![custom_kind::DIAGRAM.into()],
        }
    }

    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        let engine = m.trigger.strip_prefix("fence:").unwrap_or(&m.trigger);
        // Un recinto vuoto non è un diagramma: declinare lo lascia com'è, cioè
        // un blocco di codice, che è ciò che l'utente ha scritto.
        if m.text.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(SyntaxProduct::Block {
            custom_kind: custom_kind::DIAGRAM.into(),
            attrs: json!({ "engine": engine, "source": m.text }),
            blocks: vec![],
        }))
    }
}

/// Disegna un [`custom_kind::DIAGRAM`] mandando alla shell un `UiKind::Custom`.
///
/// È il **primo cliente** del ramo che la [decisione 0016] aveva lasciato
/// aperto: «la shell che conosce `ns` disegna il suo widget» non si era fatto
/// perché un registro con zero clienti è un meccanismo senza mestiere. Adesso il
/// cliente c'è, e chi non conosce `ns` disegna il `fallback` — che qui è il
/// sorgente del diagramma in una sezione ripiegabile, cioè il degrado onesto:
/// Fub non ha un motore di diagrammi nel bundle e non finge di averlo.
///
/// [decisione 0016]: ../../../docs/decisions/0016-cosa-e-una-view.md
pub struct DiagramRenderer;

impl CustomRenderer for DiagramRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: DIAGRAM_RENDERER.into(),
            kinds: vec![custom_kind::DIAGRAM.into()],
        }
    }

    fn render(
        &self,
        block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let engine = block.attrs.get("engine").and_then(|v| v.as_str());
        let source = block.attrs.get("source").and_then(|v| v.as_str());
        // Attributi che non sono quelli attesi: si torna al degrado del
        // provider, che è precisamente ciò per cui `Fallback` esiste.
        let (Some(engine), Some(source)) = (engine, source) else {
            return Ok(CustomRendering::Fallback);
        };
        let fallback = UiNode::new(UiKind::Section {
            title: Text::message(FALLBACK_TITLE, vec![Arg::text(ENGINE, engine)]),
            collapsed: true,
            children: vec![UiNode::new(UiKind::Stack {
                dir: Axis::Column,
                gap: 0,
                children: vec![UiNode::text(source)],
            })],
        });
        Ok(CustomRendering::Ui(Box::new(UiNode::new(UiKind::Custom {
            ns: DIAGRAM_NS.into(),
            payload: json!({ "engine": engine, "source": source }),
            fallback: vec![fallback],
        }))))
    }
}

// ---------------------------------------------------------------------------
// Le formule: la via HTML
// ---------------------------------------------------------------------------

/// ```` ```math ```` diventa un [`custom_kind::MATH`] a display.
pub struct MathRule;

impl SyntaxRule for MathRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: MATH_RULE.into(),
            format: MARKDOWN.into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["math".into(), "latex".into(), "tex".into()],
            },
            order: 0,
            option: Some(syntax::MATH.into()),
            produces: vec![custom_kind::MATH.into()],
        }
    }

    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        if m.text.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(SyntaxProduct::Block {
            custom_kind: custom_kind::MATH.into(),
            // La forma degli `attrs` è quella registrata nel contratto per
            // `custom_kind::MATH`: `{ source, display }`. Un recinto è sempre a
            // display — è un blocco.
            attrs: json!({ "source": m.text, "display": true }),
            blocks: vec![],
        }))
    }
}

/// Disegna una formula come HTML.
///
/// Senza un motore TeX nel bundle, ciò che si può fare onestamente è darle un
/// blocco suo e conservare il sorgente in un data-attribute — che è esattamente
/// ciò di cui un motore avrebbe bisogno il giorno che c'è. Non è un segnaposto
/// che finge: è la formula, non composta.
pub struct MathRenderer;

impl CustomRenderer for MathRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: MATH_RENDERER.into(),
            kinds: vec![custom_kind::MATH.into()],
        }
    }

    fn render(
        &self,
        block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let Some(source) = block.attrs.get("source").and_then(|v| v.as_str()) else {
            return Ok(CustomRendering::Fallback);
        };
        let anchor = match &block.anchor {
            Some(a) => attr("id", a),
            None => String::new(),
        };
        Ok(CustomRendering::Html(format!(
            "<div{anchor} class=\"math-block\"{}>{}</div>",
            attr("data-tex", source),
            escape(source)
        )))
    }
}

// ---------------------------------------------------------------------------
// L'evidenziato: il trigger inline
// ---------------------------------------------------------------------------

/// `==evidenziato==` diventa un [`custom_kind::HIGHLIGHT`] inline.
///
/// È l'unica delle tre a usare un trigger inline, ed è qui per provarlo: un
/// delimitatore che il provider markdown non conosce affatto — comrak non ha
/// l'evidenziato — diventa un nodo del modello **senza toccare il provider**. È
/// anche il §4.4 visto da vicino: la live preview della shell riconosce già
/// `==…==` per conto suo, e finché il modello non le arriva quella regola resta
/// scritta due volte.
pub struct HighlightRule;

impl SyntaxRule for HighlightRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: HIGHLIGHT_RULE.into(),
            format: MARKDOWN.into(),
            trigger: SyntaxTrigger::Inline {
                open: "==".into(),
                close: "==".into(),
            },
            order: 0,
            option: Some(syntax::HIGHLIGHT.into()),
            produces: vec![custom_kind::HIGHLIGHT.into()],
        }
    }

    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        if m.text.is_empty() {
            return Ok(None);
        }
        Ok(Some(SyntaxProduct::Inline {
            custom_kind: custom_kind::HIGHLIGHT.into(),
            attrs: json!({ "text": m.text }),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::Span;

    fn m(trigger: &str, text: &str) -> SyntaxMatch {
        SyntaxMatch {
            trigger: trigger.into(),
            text: text.into(),
            span: Span::new(0, text.len()),
        }
    }

    #[test]
    fn the_engine_becomes_from_the_trigger_not_from_the_attrs() {
        let ctx = ParseContext::obsidian("a.md");
        let out = DiagramRule
            .apply(&m("fence:plantuml", "@startuml"), &ctx)
            .unwrap();
        match out {
            Some(SyntaxProduct::Block { attrs, .. }) => {
                assert_eq!(attrs["engine"], "plantuml");
                assert_eq!(attrs["source"], "@startuml");
            }
            other => panic!("atteso un blocco, trovato {other:?}"),
        }
    }

    #[test]
    fn a_fence_empty_remains_a_block_of_code() {
        let ctx = ParseContext::obsidian("a.md");
        // Declinare è diverso da fallire: il nodo resta com'era.
        assert!(DiagramRule
            .apply(&m("fence:mermaid", "  \n"), &ctx)
            .unwrap()
            .is_none());
        assert!(MathRule
            .apply(&m("fence:math", ""), &ctx)
            .unwrap()
            .is_none());
    }

    #[test]
    fn the_diagram_arrives_to_the_shell_with_a_fallback_declarative() {
        let block = CustomBlock {
            custom_kind: custom_kind::DIAGRAM.into(),
            attrs: json!({ "engine": "mermaid", "source": "graph TD;" }),
            blocks: vec![],
            anchor: None,
            span: Span::new(0, 0),
        };
        let out = DiagramRenderer
            .render(&block, &RenderOptions::preview())
            .unwrap();
        let CustomRendering::Ui(node) = out else {
            panic!("il diagramma esce come albero, non come markup");
        };
        let UiKind::Custom { ns, fallback, .. } = &node.kind else {
            panic!("atteso un nodo Custom");
        };
        assert_eq!(ns, DIAGRAM_NS);
        assert_eq!(fallback.len(), 1);
        // Il fallback è dichiarativo: nessun campo è interpretato come markup,
        // quindi passa anche da un renderer non fidato.
        assert!(node.validate_untrusted().is_ok());
        assert!(matches!(fallback[0].kind, UiKind::Section { .. }));
    }

    #[test]
    fn attrs_that_not_are_those_expected_return_to_the_degradation_of_the_provider() {
        let block = CustomBlock {
            custom_kind: custom_kind::DIAGRAM.into(),
            attrs: json!({ "qualcosaltro": 1 }),
            blocks: vec![],
            anchor: None,
            span: Span::new(0, 0),
        };
        let out = DiagramRenderer
            .render(&block, &RenderOptions::preview())
            .unwrap();
        assert!(matches!(out, CustomRendering::Fallback));
    }

    /// **Il sorgente di una formula è testo dell'utente, e nell'attributo esce
    /// per intero.**
    ///
    /// L'apice è la metà che era rossa: l'escape privato di questo file copriva
    /// `&`, `<`, `>` e `"`, e l'apice lo lasciava passare. Era innocuo *oggi*
    /// solo perché `data-tex` si scrive fra virgolette doppie — una proprietà
    /// del chiamante, non dell'escape — e questo file è quello che il repo
    /// indica come l'esempio da copiare per scrivere un renderer di terzi.
    #[test]
    fn the_formula_exits_as_html_col_source_escaped() {
        let block = CustomBlock {
            custom_kind: custom_kind::MATH.into(),
            attrs: json!({ "source": "a < b & \"c\" e l'apice", "display": true }),
            blocks: vec![],
            anchor: Some("^f1".into()),
            span: Span::new(0, 0),
        };
        let CustomRendering::Html(html) = MathRenderer
            .render(&block, &RenderOptions::preview())
            .unwrap()
        else {
            panic!("la formula esce come markup");
        };
        assert!(html.contains("id=\"^f1\""), "{html}");
        assert!(html.contains("class=\"math-block\""));
        assert!(
            !html.contains("a < b"),
            "the source must be escaped: {html}"
        );
        // Le virgolette escapate anche nel testo: `fub_abi::html` ha **una**
        // tabella per il contenuto e per l'attributo, e la ragione sta nel suo
        // doc — due tabelle vogliono un chiamante che ne scelga una, ed è la
        // scelta da cui nascevano le tre copie divergenti.
        assert!(
            html.contains("a &lt; b &amp; &quot;c&quot; e l&#39;apice"),
            "{html}"
        );
        // E l'attributo dice la stessa cosa: è il `data-tex` che un motore TeX
        // rileggerà il giorno che c'è, quindi deve portare il sorgente intero.
        assert!(
            html.contains("data-tex=\"a &lt; b &amp; &quot;c&quot; e l&#39;apice\""),
            "{html}"
        );
        assert!(
            !html.contains("l'apice"),
            "the raw apostrophe remained: {html}"
        );
    }

    #[test]
    fn highlighted_and_a_inline_col_its_text() {
        let ctx = ParseContext::obsidian("a.md");
        let out = HighlightRule
            .apply(&m("inline:==", "importante"), &ctx)
            .unwrap();
        match out {
            Some(SyntaxProduct::Inline { custom_kind, attrs }) => {
                assert_eq!(custom_kind, custom_kind::HIGHLIGHT);
                assert_eq!(attrs["text"], "importante");
            }
            other => panic!("atteso un inline, trovato {other:?}"),
        }
    }
}
