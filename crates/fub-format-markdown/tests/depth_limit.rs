use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::MAX_DOCUMENT_DEPTH;
use fub_format_markdown::MarkdownProvider;

fn deeply_nested_quote(levels: usize) -> String {
    format!("{}fondo", "> ".repeat(levels))
}

#[test]
fn markdown_rejects_two_hundred_nested_blocks_before_conversion_overflows() {
    let source = deeply_nested_quote(200);
    let error = MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian("profondo/nota.md"))
        .expect_err("deep markdown must be rejected");

    let message = error.to_string();
    assert!(message.contains("annidamento"));
    assert!(message.contains(&MAX_DOCUMENT_DEPTH.to_string()));
}

#[test]
fn markdown_rejects_two_thousand_nested_blocks_without_stack_exhaustion() {
    let source = deeply_nested_quote(2_000);
    assert!(MarkdownProvider::new()
        .parse(
            &source.into(),
            &ParseContext::obsidian("molto-profondo/nota.md"),
        )
        .is_err());
}
