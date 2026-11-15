//! **Quando un frontmatter si legge: la stessa risposta qui e nella testata.**
//!
//! La testata della pagina del client (`properties.ts`) non ha un parser YAML:
//! decide da sé quando un frontmatter non si legge, per lasciarlo com'è scritto
//! invece di mostrarne le proprietà a metà. Il modello lo decide con
//! `serde_yaml_ng`. Se i due non concordano, la testata offre di scrivere in un
//! frontmatter che il modello conserva come testo, o tace su uno che il modello
//! legge. L'elenco dei casi è uno solo, `apps/client/src/__fixtures__/
//! frontmatter-readability.json`, scritto a mano: questa prova lo verifica col
//! modello, `properties.test.ts` con la testata.

use std::path::PathBuf;

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{custom_kind, Block};
use fub_format_markdown::MarkdownProvider;

fn fixture() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/frontmatter-readability.json");
    let text = std::fs::read_to_string(&path).expect("la fixture dei frontmatter si legge");
    serde_json::from_str(&text).expect("la fixture è JSON")
}

#[test]
fn the_model_reads_the_frontmatter_cases_as_the_fixture_says() {
    let fixture = fixture();
    let cases = fixture["cases"].as_array().expect("`cases` è un elenco");
    assert!(!cases.is_empty());
    let mut wrong = Vec::new();
    for case in cases {
        let name = case["name"].as_str().expect("ogni caso ha un nome");
        let source = case["source"].as_str().expect("ogni caso ha una sorgente");
        let readable = case["readable"].as_bool().expect("ogni caso dice se si legge");
        let model = MarkdownProvider::new()
            .parse(&source.into(), &ParseContext::obsidian("nota.md"))
            .expect("markdown parses");
        let unparsed = matches!(
            model.body.first(),
            Some(Block::Custom { custom_kind: kind, .. }) if kind == custom_kind::FRONTMATTER_UNPARSED
        );
        if unparsed == readable {
            wrong.push(format!("«{name}»: la fixture dice readable={readable}, il modello no"));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
