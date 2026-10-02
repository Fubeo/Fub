//! **Le formule fra dollari le legge il parser, e arrivano intatte alla stampa.**
//!
//! Il difetto era nella resa di stampa dell'host: `$…$` restava testo, e il
//! testo era già passato per la grammatica markdown — `\{` diventava `{`, `\,`
//! una virgola, `a*b*c` un corsivo. Una `SyntaxRule` non poteva rimediare,
//! perché prende il testo **dopo** il parse. Con `syntax::MATH` acceso il
//! provider accende `math_dollars` di comrak: la formula diventa un
//! `Inline::Custom` `math` col sorgente TeX com'è scritto, e la resa ne fa il
//! segnaposto inerte che la shell compone (`span.math-inline`, o
//! `div.math-block` quando `$$…$$` è tutto il paragrafo).

use fub_abi::format::{FormatProvider, ParseContext, RenderOptions};
use fub_abi::model::{custom_kind, Block, DocId, DocumentModel, Inline, LinkTarget, Span};
use fub_format_markdown::MarkdownProvider;

fn parse_with(src: &str, ctx: &ParseContext) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), ctx)
        .expect("the input is markdown, and markdown parses")
}

fn parse(src: &str) -> DocumentModel {
    parse_with(src, &ParseContext::obsidian("nota.md"))
}

fn render(doc: &DocumentModel) -> String {
    MarkdownProvider::new()
        .render_html(doc, &RenderOptions::default())
        .expect("the model renders")
}

fn inlines(block: &Block) -> &[Inline] {
    match block {
        Block::Paragraph { inlines, .. } => inlines,
        other => panic!("expected a paragraph, got {other:?}"),
    }
}

/// `(sorgente, display)` di ogni formula del paragrafo, in ordine.
fn formulas(inlines: &[Inline]) -> Vec<(String, bool)> {
    inlines
        .iter()
        .filter_map(|inline| match inline {
            Inline::Custom {
                custom_kind, attrs, ..
            } if custom_kind == custom_kind::MATH => Some((
                attrs["source"].as_str().expect("source").to_string(),
                attrs["display"].as_bool().expect("display"),
            )),
            _ => None,
        })
        .collect()
}

/// **Il TeX di una formula in riga non passa per la grammatica.** Backslash,
/// graffe e asterischi restano quelli scritti, e nessuno diventa corsivo.
#[test]
fn an_inline_formula_keeps_its_tex() {
    let doc = parse("vale $\\{x \\mid x>0\\}$ e $a*b*c\\,d$\n");
    let inlines = inlines(&doc.body[0]);
    assert_eq!(
        formulas(inlines),
        [
            ("\\{x \\mid x>0\\}".to_string(), false),
            ("a*b*c\\,d".to_string(), false),
        ]
    );
    assert!(
        !inlines.iter().any(|the| matches!(the, Inline::Emph(_))),
        "the asterisks of a formula are not emphasis: {inlines:?}"
    );

    let html = render(&doc);
    assert!(
        html.contains(r#"<span class="math-inline" data-tex="\{x \mid x&gt;0\}">"#),
        "html: {html}"
    );
    assert!(
        html.contains(r#"<span class="math-inline" data-tex="a*b*c\,d">"#),
        "html: {html}"
    );
}

/// **Un paragrafo che è soltanto `$$…$$` si rende come blocco**, la stessa
/// radice del recinto `math`; in mezzo al testo resta in riga.
#[test]
fn a_display_formula_alone_is_a_block() {
    let doc = parse("prima\n\n$$\n\\sum_{i=1}^n i\n$$\n\ndopo $$x$$ qui\n");
    assert_eq!(
        formulas(inlines(&doc.body[1])),
        [("\n\\sum_{i=1}^n i\n".to_string(), true)]
    );

    let html = render(&doc);
    assert!(
        html.contains(r#"class="math-block" data-tex="\sum_{i=1}^n i">"#),
        "html: {html}"
    );
    assert!(
        html.contains(r#"dopo <span class="math-inline" data-tex="x">x</span> qui"#),
        "html: {html}"
    );
}

/// **I dollari che non chiudono una formula restano testo**: un prezzo, un
/// dollaro escapato, un dollaro dentro il codice.
#[test]
fn dollars_that_are_not_formulas_stay_text() {
    let doc = parse("costa $5, \\$x\\$ resta testo e `$y$` è codice\n");
    let inlines = inlines(&doc.body[0]);
    assert_eq!(formulas(inlines), []);
    assert!(
        inlines.contains(&Inline::Code("$y$".into())),
        "the code span keeps its dollars: {inlines:?}"
    );
}

/// **Il codice in riga vince sulla formula**, come nella shell. comrak
/// chiuderebbe `$5…` sul `$` dentro `` `$HOME` ``: senza il secondo parse il
/// codice, il tag e il wikilink di mezzo sparivano dal modello. La formula del
/// paragrafo accanto resta una formula.
#[test]
fn inline_code_beats_a_formula_that_would_swallow_it() {
    let doc = parse("costa $5 per #spesa e [[Prezzi]], usa `$HOME`\n\nvale $x$\n");
    let first = inlines(&doc.body[0]);
    assert_eq!(formulas(first), []);
    assert!(
        first.contains(&Inline::Code("$HOME".into())),
        "the code span is back: {first:?}"
    );
    assert_eq!(
        doc.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        ["spesa"]
    );
    assert!(
        doc.links.iter().any(|l| matches!(
            &l.target,
            LinkTarget::Wiki { page, .. } if page == "Prezzi"
        )),
        "the wikilink is back: {:?}",
        doc.links
    );
    assert_eq!(formulas(inlines(&doc.body[1])), [("x".to_string(), false)]);
}

/// **Senza `syntax::MATH` i dollari sono testo**: la sintassi è una
/// preferenza, non un fatto del provider.
#[test]
fn without_math_the_dollars_are_text() {
    let doc = parse_with("vale $x$\n", &ParseContext::bare("nota.md"));
    assert_eq!(inlines(&doc.body[0]), &[Inline::Text("vale $x$".into())]);
}

/// **Il sorgente di una formula è un dato, e nella resa resta inerte.**
#[test]
fn a_hostile_formula_renders_inert() {
    let html = render(&parse("$<img src=x onerror=alert(1)>$\n"));
    assert!(!html.contains("<img"), "html: {html}");
    assert!(
        html.contains("&lt;img src=x onerror=alert(1)&gt;"),
        "html: {html}"
    );
}

/// **Il serializer riscrive i dollari, e il giro riparte identico.**
#[test]
fn the_pass_returns_to_the_same_bytes() {
    for source in [
        "vale $\\{x \\mid x>0\\}$ e $a*b*c\\,d$\n",
        "prima\n\n$$\n\\sum_{i=1}^n i\n$$\n\ndopo\n",
    ] {
        let doc = parse(source);
        let rewritten = MarkdownProvider::new()
            .serialize(&doc)
            .expect("the model serializes");
        assert_eq!(rewritten, source, "the rewrite changes the document");
        assert_eq!(parse(&rewritten), doc, "the pass is not stable");
    }
}

/// **Un dollaro letterale in coda al testo guarda ciò che lo segue.** Davanti a
/// una formula, a un'enfasi o al delimitatore che chiude la sua, scritto nudo
/// aprirebbe una formula al giro dopo; davanti a uno spazio, a un a capo o alla
/// fine del paragrafo resta nudo, senza un byte in più.
#[test]
fn a_literal_dollar_before_another_inline_stays_literal() {
    for source in [
        "\\$$x$$\n",
        "a \\$*b* c$\n",
        "*a \\$* b$\n",
        "[a \\$](u) b$\n",
        "a $\nb$ c\n",
        "# costa 5$\n",
        "| costa 5$ |\n| --- |\n",
    ] {
        let doc = parse(source);
        let rewritten = MarkdownProvider::new()
            .serialize(&doc)
            .expect("the model serializes");
        assert_eq!(rewritten, source, "the rewrite changes the document");
        assert_eq!(parse(&rewritten), doc, "the pass is not stable");
    }
}

/// **Il testo che segue conta anche quando è un altro nodo.** Il parser fonde i
/// testi vicini, un modello costruito a mano no: un `$` in coda a un testo che
/// precede `" al chilo"` resta nudo, e quello davanti a un'enfasi no.
#[test]
fn a_dollar_looks_at_the_next_text_node_too() {
    let mut doc = DocumentModel::empty(DocId::new("nota.md"));
    doc.body = vec![Block::Paragraph {
        inlines: vec![
            Inline::Text("costa 5$".into()),
            Inline::Text(" al chilo, $".into()),
            Inline::Emph(vec![Inline::Text("b".into())]),
        ],
        anchor: None,
        span: Span::new(0, 0),
    }];
    let rewritten = MarkdownProvider::new()
        .serialize(&doc)
        .expect("the model serializes");
    assert_eq!(rewritten, "costa 5$ al chilo, \\$*b*\n");
}
