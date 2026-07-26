//! # fubmd-format-markdown
//!
//! Il primo [`FormatProvider`] nativo: markdown in stile Obsidian, su comrak.
//! È l'unico crate di M1 che sa che il markdown esiste — il kernel lo vede solo
//! come `dyn FormatProvider`.

mod offsets;
mod parse;
mod render;
mod serialize;
mod transfer;
mod util;

use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::DocumentModel;
use fubmd_abi::{FormatError, FormatProvider};

pub use transfer::{MarkdownExport, MarkdownImport, TARGET_FILES, TARGET_SINGLE};

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
    use fubmd_abi::model::{custom_kind, Block, ColumnAlign, Inline, LinkTarget, PropertyValue};

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
            }
        );
        // il contesto del backlink è il testo del paragrafo
        assert!(doc.links[0].context.as_deref().unwrap().contains("Vedi"));
    }

    #[test]
    fn extracts_embed_wikilink() {
        let doc = parse("![[Immagine.png]]");
        assert!(
            doc.links[0].embed,
            "l'embed è del riferimento, non del bersaglio"
        );
        match &doc.links[0].target {
            LinkTarget::Wiki { page, .. } => assert_eq!(page, "Immagine.png"),
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
    fn tag_spans_point_at_the_source_even_after_escapes_and_entities() {
        // Comrak decodifica gli escape (`\#` → `#`), ma gli Span sono offset
        // nel SORGENTE: lo span del tag deve ritagliare esattamente `#tag`
        // anche con un escape prima di lui.
        let src = "pre \\# poi #tag fine";
        let doc = parse(src);
        let names: Vec<_> = doc.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["tag"], "l'escape `\\#` non è un tag");
        let span = doc.tags[0].span;
        assert_eq!(&src[span.start..span.end], "#tag");

        // Stessa cosa con un'entità (che nel decodificato si accorcia).
        let src = "A&amp;B #tag fine";
        let doc = parse(src);
        let span = doc.tags[0].span;
        assert_eq!(&src[span.start..span.end], "#tag");
    }

    #[test]
    fn an_escaped_hash_is_not_a_tag_and_an_entity_is_not_a_tag() {
        let doc = parse("solo \\#nontag qui");
        assert!(doc.tags.is_empty(), "tags: {:?}", doc.tags);
        // `&#x27;` decodifica in `'`: il suo `#x27` non è un tag.
        let doc = parse("l&#x27;apostrofo entita");
        assert!(doc.tags.is_empty(), "tags: {:?}", doc.tags);
    }

    #[test]
    fn embed_spans_point_at_the_source_even_after_escapes() {
        let src = "pre \\# poi ![[Nota#Sez]] fine";
        let doc = parse(src);
        let embed = doc
            .links
            .iter()
            .find(|l| l.embed && matches!(&l.target, LinkTarget::Wiki { .. }))
            .expect("un embed");
        assert_eq!(
            &src[embed.span.start..embed.span.end],
            "![[Nota#Sez]]",
            "lo span dell'embed deve ritagliare la sintassi intera nel sorgente"
        );
        // E un `!` sotto escape non apre un embed.
        let doc = parse("testo \\![[Nota]] qui");
        assert!(!doc.links.iter().any(|l| l.embed), "links: {:?}", doc.links);
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
        let has_callout = doc
            .body
            .iter()
            .any(|b| matches!(b, Block::Custom { custom_kind, .. } if custom_kind == "callout"));
        assert!(
            has_callout,
            "atteso un blocco callout, trovato: {:?}",
            doc.body
        );
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
        assert!(
            html.contains("data-wikilink-page=\"Nota Due\""),
            "html: {html}"
        );
        assert!(html.contains("class=\"wikilink\""));
    }

    #[test]
    fn renders_embed_as_placeholder_not_link() {
        // La transclusion è composta dal frontend via `Workspace::render_embed`:
        // qui deve uscire solo il placeholder, mai il contenuto del target.
        let doc = parse("![[Altra Nota#Sezione]]");
        let html = MarkdownProvider::new()
            .render_html(
                &doc,
                &RenderOptions {
                    wikilinks_as_data_attrs: true,
                },
            )
            .unwrap();
        assert!(html.contains("class=\"embed\""), "html: {html}");
        assert!(html.contains("data-embed-page=\"Altra Nota\""));
        assert!(html.contains("data-embed-heading=\"Sezione\""));
        assert!(!html.contains("class=\"wikilink\""));
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

    // -----------------------------------------------------------------------
    // §1.5 — ciò che il modello non sapeva dire
    // -----------------------------------------------------------------------

    /// Prima, una task list era una lista di **paragrafi**: lo stato viveva nel
    /// testo, e ogni voce del capitolo 10 sarebbe ripartita dal parsing.
    #[test]
    fn a_task_list_carries_its_state_and_its_marker() {
        let src = "- [x] fatta\n- [ ] da fare\n- [/] in corso\n- non è una task\n";
        let doc = parse(src);
        let Some(Block::List { items, .. }) = doc.body.first() else {
            panic!("atteso una lista, trovato {:?}", doc.body);
        };
        assert_eq!(items.len(), 4);
        assert_eq!(
            items
                .iter()
                .map(|i| i.task.map(|t| (t.symbol, t.checked())))
                .collect::<Vec<_>>(),
            vec![
                Some((Some('x'), true)),
                Some((None, false)),
                // Uno stato personalizzato (10.1) sopravvive al parsing e NON
                // è "fatto": inventare quella semantica sarebbe peggio.
                Some((Some('/'), false)),
                None,
            ]
        );
        // Il marcatore ritaglia il SIMBOLO, e nient'altro: spuntare è
        // sostituire un carattere, non riscrivere il documento.
        let m = items[0].task.unwrap().span;
        assert_eq!(&src[m.start..m.end], "x");
        let m = items[1].task.unwrap().span;
        assert_eq!(&src[m.start..m.end], " ");
        let m = items[2].task.unwrap().span;
        assert_eq!(&src[m.start..m.end], "/");
    }

    #[test]
    fn tasks_render_and_serialize_keeping_the_symbol() {
        let doc = parse("- [x] fatta\n- [/] in corso\n");
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert!(
            html.contains("<input type=\"checkbox\" disabled checked>"),
            "html: {html}"
        );
        assert!(html.contains("data-task=\"/\""), "html: {html}");

        let md = MarkdownProvider::new().serialize(&doc).unwrap();
        assert!(md.contains("- [x] fatta"), "md: {md}");
        assert!(md.contains("- [/] in corso"), "md: {md}");
    }

    /// L'ancora esplicita: indirizzo, non contenuto.
    #[test]
    fn an_explicit_anchor_is_addressable_and_not_readable() {
        let src = "Un paragrafo ancorato. ^blocco-1\n";
        let doc = parse(src);
        assert_eq!(doc.body[0].anchor(), Some("blocco-1"));
        assert_eq!(doc.anchors.len(), 1);
        let a = &doc.anchors[0];
        assert_eq!(a.id, "blocco-1");
        assert_eq!(&src[a.marker.start..a.marker.end], "^blocco-1");
        assert_eq!(&src[a.span.start..a.span.end], src.trim_end());
        // Sparita da testo e inline: nell'indice full-text `^blocco-1` non è
        // una parola, e a schermo non è contenuto.
        assert!(!doc.text.contains("^blocco-1"), "text: {:?}", doc.text);
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert_eq!(html, "<p id=\"blocco-1\">Un paragrafo ancorato.</p>");
    }

    #[test]
    fn what_is_not_an_anchor_stays_text() {
        // Il caso che una regola ingenua avrebbe rovinato: un accento
        // circonflesso attaccato a una parola non è un indirizzo.
        for src in ["Il doppio di 2^10 è tanto.\n", "Formula 2^10\n", "a ^ b\n"] {
            let doc = parse(src);
            assert!(
                doc.anchors.is_empty() && doc.body[0].anchor().is_none(),
                "`{src}` non contiene un'ancora: {:?}",
                doc.anchors
            );
        }
    }

    /// La forma su riga propria è l'unica con cui si indirizza un contenitore:
    /// dentro una tabella o una lista non c'è una coda di testo dove scrivere.
    #[test]
    fn a_lone_anchor_line_belongs_to_the_block_before_it() {
        let src = "- una\n- due\n\n^lista-spesa\n";
        let doc = parse(src);
        assert_eq!(
            doc.body.len(),
            1,
            "l'ancora non è un blocco: {:?}",
            doc.body
        );
        assert!(matches!(doc.body[0], Block::List { .. }));
        assert_eq!(doc.body[0].anchor(), Some("lista-spesa"));
        // E lo span registrato è quello del blocco a cui appartiene, non del
        // paragrafo che la conteneva.
        assert_eq!(doc.anchors[0].span, doc.body[0].span());
    }

    #[test]
    fn a_heading_anchor_is_its_generated_slug() {
        let doc = parse("## Una Sezione Lunga\n");
        assert_eq!(doc.body[0].anchor(), Some("una-sezione-lunga"));
        assert_eq!(doc.outline[0].slug, "una-sezione-lunga");
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert!(
            html.contains("<h2 id=\"una-sezione-lunga\">"),
            "html: {html}"
        );
    }

    /// Prima la tabella non era "rappresentata alla grossa": era persa —
    /// `Custom("table")` di `Custom("block")` indistinguibili, senza
    /// allineamento e senza celle.
    #[test]
    fn a_table_keeps_rows_cells_and_alignment() {
        let doc = parse("| a | b |\n| :-- | --: |\n| 1 | [[Nota]] |\n");
        let Some(Block::Table {
            head, rows, align, ..
        }) = doc.body.first()
        else {
            panic!("attesa una tabella, trovato {:?}", doc.body);
        };
        assert_eq!(align, &vec![ColumnAlign::Left, ColumnAlign::Right]);
        assert_eq!(head.as_ref().unwrap().cells.len(), 2);
        assert_eq!(rows.len(), 1);
        // Una cella porta inline: è la ragione per cui la tabella è una
        // variante e non un `Custom`.
        assert!(matches!(
            rows[0].cells[1].inlines.first(),
            Some(Inline::Link { .. })
        ));
        // E il link dentro la cella è un arco del grafo come ogni altro.
        assert!(doc
            .links
            .iter()
            .any(|l| l.target == LinkTarget::wiki("Nota")));

        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert!(
            html.contains("<th style=\"text-align:left\">a</th>"),
            "html: {html}"
        );
        assert!(
            html.contains("<td style=\"text-align:right\">"),
            "html: {html}"
        );
    }

    /// La decisione dichiarata: footnote e definition list restano `Custom`,
    /// ma con un `custom_kind` **registrato** — e prima non esistevano affatto.
    #[test]
    fn footnotes_and_definition_lists_are_registered_custom_kinds() {
        let doc = parse("Testo[^n].\n\n[^n]: La nota.\n");
        let kinds: Vec<&str> = doc
            .body
            .iter()
            .filter_map(|b| match b {
                Block::Custom { custom_kind, .. } => Some(custom_kind.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(kinds, vec![custom_kind::FOOTNOTE_DEFINITION]);
        let Some(Block::Paragraph { inlines, .. }) = doc.body.first() else {
            panic!("atteso un paragrafo");
        };
        assert!(inlines.iter().any(|i| matches!(
            i,
            Inline::Custom { custom_kind, .. } if custom_kind == custom_kind::FOOTNOTE_REFERENCE
        )));

        let doc = parse("Termine\n\n: la definizione\n");
        assert!(
            doc.body.iter().any(|b| matches!(
                b,
                Block::Custom { custom_kind, .. } if custom_kind == custom_kind::DEFINITION_LIST
            )),
            "body: {:?}",
            doc.body
        );
    }

    /// Il buco che rendeva 13.1 irraggiungibile: un'immagine non entrava
    /// **affatto** in `links`, quindi nessun riferimento ad allegato veniva
    /// aggiornato al rename né compariva fra gli orfani.
    #[test]
    fn an_image_is_a_link_and_an_embed() {
        let doc = parse("![alt](allegati/foto.png)\n\n![remota](https://esempio.it/x.png)\n");
        assert_eq!(doc.links.len(), 2, "links: {:?}", doc.links);
        assert_eq!(
            doc.links[0].target,
            LinkTarget::Path("allegati/foto.png".into())
        );
        assert!(doc.links[0].embed && doc.links[1].embed);
        // La specie del bersaglio la decide il contratto, non il provider.
        assert_eq!(
            doc.links[1].target,
            LinkTarget::Url("https://esempio.it/x.png".into())
        );

        // In anteprima resta un segnaposto: caricare una risorsa è una
        // decisione della shell, non di chi ha letto il file.
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert!(
            html.contains("data-embed-path=\"allegati/foto.png\""),
            "html: {html}"
        );
        assert!(!html.contains("<img"), "html: {html}");
    }

    /// Le proprietà tipizzate lette dal frontmatter vero, non da un JSON
    /// costruito a mano: è il giro completo YAML → JSON → `PropertyValue`.
    #[test]
    fn frontmatter_properties_come_out_typed() {
        let doc = parse("---\nscadenza: 2026-07-25\nrating: 4\nautore: \"[[Mario]]\"\ntag: [a, b]\n---\n\nCorpo.");
        assert!(matches!(
            doc.frontmatter.property("scadenza"),
            Some(PropertyValue::Date(d)) if (d.year, d.month, d.day) == (2026, 7, 25)
        ));
        assert_eq!(
            doc.frontmatter.property("rating"),
            Some(PropertyValue::Number(4.0))
        );
        assert_eq!(
            doc.frontmatter.property("autore"),
            Some(PropertyValue::Link(LinkTarget::wiki("Mario")))
        );
        assert!(matches!(
            doc.frontmatter.property("tag"),
            Some(PropertyValue::List(v)) if v.len() == 2
        ));
    }
}
