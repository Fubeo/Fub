//! # fubmd-format-markdown
//!
//! Il primo [`FormatProvider`] nativo: markdown in stile Obsidian, su comrak.
//! È l'unico crate di M1 che sa che il markdown esiste — il kernel lo vede solo
//! come `dyn FormatProvider`.

mod offsets;
mod parse;
mod render;
mod serialize;
mod util;

use fubmd_abi::format::{
    FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fubmd_abi::model::DocumentModel;
use fubmd_abi::{FormatError, FormatProvider};

/// Provider markdown (dialetto Obsidian).
#[derive(Default)]
pub struct MarkdownProvider;

impl MarkdownProvider {
    pub fn new() -> Self {
        MarkdownProvider
    }

    /// Comodo costruttore già in `Box` per la registrazione nel kernel.
    pub fn boxed() -> Box<dyn FormatProvider> {
        Box::new(MarkdownProvider)
    }
}

impl FormatProvider for MarkdownProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "markdown".to_string(),
            name: "Markdown (Obsidian)".to_string(),
            extensions: vec!["md".to_string(), "markdown".to_string()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities {
            wikilinks: true,
            tags: true,
            frontmatter: true,
            callouts: true,
            embeds: true,
        }
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        parse::parse_markdown(source, ctx)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(render::render_html(model, opts))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(serialize::serialize(model))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::model::{Block, LinkTarget};

    fn parse(src: &str) -> DocumentModel {
        MarkdownProvider::new()
            .parse(src, &ParseContext::obsidian("nota.md"))
            .unwrap()
    }

    #[test]
    fn extracts_frontmatter() {
        let doc = parse("---\ntitle: Ciao\naliases: [X, Y]\n---\n\nCorpo.");
        assert_eq!(doc.frontmatter.get("title").unwrap(), "Ciao");
        assert_eq!(doc.frontmatter.aliases(), vec!["X", "Y"]);
    }

    #[test]
    fn extracts_wikilink_with_heading_and_alias() {
        let doc = parse("Vedi [[Altra Nota#Sezione|qui]].");
        assert_eq!(doc.links.len(), 1);
        assert_eq!(
            doc.links[0].target,
            LinkTarget::Wiki {
                page: "Altra Nota".into(),
                heading: Some("Sezione".into()),
                block: None,
                embed: false,
            }
        );
        // il contesto del backlink è il testo del paragrafo
        assert!(doc.links[0].context.as_deref().unwrap().contains("Vedi"));
    }

    #[test]
    fn extracts_embed_wikilink() {
        let doc = parse("![[Immagine.png]]");
        match &doc.links[0].target {
            LinkTarget::Wiki { embed, page, .. } => {
                assert!(embed);
                assert_eq!(page, "Immagine.png");
            }
            _ => panic!("atteso wiki"),
        }
    }

    #[test]
    fn extracts_tags_but_not_in_code() {
        let doc = parse("Un #progetto attivo e `#nontag` nel codice.");
        let names: Vec<_> = doc.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["progetto"]);
    }

    #[test]
    fn builds_outline_with_slugs() {
        let doc = parse("# Titolo Uno\n\n## Sotto Sezione\n");
        assert_eq!(doc.outline.len(), 2);
        assert_eq!(doc.outline[0].slug, "titolo-uno");
        assert_eq!(doc.outline[1].level, 2);
        assert_eq!(doc.outline[1].slug, "sotto-sezione");
    }

    #[test]
    fn parses_callout_as_custom_block() {
        let doc = parse("> [!note] Attenzione\n> corpo del callout\n");
        let has_callout = doc.body.iter().any(|b| {
            matches!(b, Block::Custom { custom_kind, .. } if custom_kind == "callout")
        });
        assert!(has_callout, "atteso un blocco callout, trovato: {:?}", doc.body);
    }

    #[test]
    fn renders_wikilink_as_data_attr() {
        let doc = parse("[[Nota Due]]");
        let html = MarkdownProvider::new()
            .render_html(
                &doc,
                &RenderOptions {
                    wikilinks_as_data_attrs: true,
                },
            )
            .unwrap();
        assert!(html.contains("data-wikilink-page=\"Nota Due\""), "html: {html}");
        assert!(html.contains("class=\"wikilink\""));
    }

    #[test]
    fn renders_basic_formatting() {
        let doc = parse("Testo **grassetto** e *corsivo* e `codice`.");
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert!(html.contains("<strong>grassetto</strong>"));
        assert!(html.contains("<em>corsivo</em>"));
        assert!(html.contains("<code>codice</code>"));
    }

    #[test]
    fn plaintext_projection_populated() {
        let doc = parse("# Titolo\n\nParagrafo con [[Link]] e #tag.");
        assert!(doc.text.contains("Titolo"));
        assert!(doc.text.contains("Paragrafo"));
    }
}
