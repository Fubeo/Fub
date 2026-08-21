//! # fub-format-markdown
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

use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::DocumentModel;
use fub_abi::options::syntax;
use fub_abi::{FormatError, FormatProvider};

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
        FormatDescriptor::text("markdown", "Markdown (Obsidian)", &["md", "markdown"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        // Le sintassi che questo provider sa leggere **da sé**. Ciò che gli
        // arriva innestato da una `SyntaxRule` non sta qui: quelle capacità
        // sono del vault, non del provider, e chiederle a lui darebbe una
        // risposta diversa a seconda di cosa è installato.
        FormatCapabilities::of(&[
            syntax::WIKILINKS,
            syntax::TAGS,
            syntax::FRONTMATTER,
            syntax::CALLOUTS,
            syntax::EMBEDS,
            syntax::FOOTNOTES,
            syntax::DEFINITION_LISTS,
        ])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        // Un provider testuale non indovina l'encoding: dei byte sono un «non
        // so», non un tentativo. Vedi `FormatDescriptor::source`.
        let text = source.text().ok_or_else(|| FormatError::Unsupported {
            format: self.descriptor().id,
            got: source.kind(),
        })?;
        parse::parse_markdown(text, ctx)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(render::render_html(model, opts))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        serialize::serialize(model)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::{
        custom_kind, Block, ColumnAlign, DateFormats, DocId, Inline, LinkTarget, PropertyValue,
        Span,
    };

    fn parse(src: &str) -> DocumentModel {
        MarkdownProvider::new()
            .parse(&src.into(), &ParseContext::obsidian("nota.md"))
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

    fn paragrafo_inlines(doc: &DocumentModel) -> Vec<&Inline> {
        match &doc.body[0] {
            Block::Paragraph { inlines, .. } => inlines.iter().collect(),
            _ => panic!("atteso un paragrafo come primo blocco"),
        }
    }

    #[test]
    fn entity_nominale_with_tag_is_resolves_not_is_doubles() {
        // `&amp;` col tag: il modello porta la `&` decodificata — come nel ramo
        // senza tag — e il render la ri-escapa una volta sola, non `&amp;amp;`.
        let doc = parse("A&amp;B #tag fine");
        let inl = paragrafo_inlines(&doc);
        match &inl[0] {
            Inline::Text(t) => assert_eq!(t, "A&B "),
            other => panic!("atteso testo, {:?}", other),
        }
        let html = MarkdownProvider::new()
            .render_html(&doc, &Default::default())
            .unwrap();
        assert!(html.contains("A&amp;B"), "render: {html}");
        assert!(!html.contains("amp;amp"), "doppia codifica: {html}");
    }

    #[test]
    fn entity_numeric_with_tag_is_resolves_in_the_model() {
        let doc = parse("pre &#65; #tag fine");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "pre A "),
            other => panic!("{:?}", other),
        }
        // `&#x27;` → `'`: prima la serializzazione ne ri-escapava il `#`.
        let doc = parse("pre &#x27; #tag fine");
        let ser = MarkdownProvider::new().serialize(&doc).unwrap();
        assert!(ser.contains("pre ' "), "serialize: {ser}");
        assert!(!ser.contains("#x27"), "l'entità resta scritta: {ser}");
    }

    #[test]
    fn a_and_commerciale_bare_with_tag_remains_a_and() {
        let doc = parse("Tom & Jerry #tag");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "Tom & Jerry "),
            other => panic!("{:?}", other),
        }
        let html = MarkdownProvider::new()
            .render_html(&doc, &Default::default())
            .unwrap();
        assert!(html.contains("Tom &amp; Jerry"), "render: {html}");
    }

    #[test]
    fn the_branch_with_tag_decodes_as_that_without_for_the_entity() {
        // Un'entità nominale fuori dai cinque caratteri HTML significativi:
        // comrak la scioglie, e il ramo con il tag fa lo stesso — la `©`
        // resta `©`, non `&amp;copy;`.
        let with_tag = parse("&copy; #t");
        let without = parse("&copy; qui");
        let with = match &paragrafo_inlines(&with_tag)[0] {
            Inline::Text(t) => t.clone(),
            _ => unreachable!(),
        };
        let sen = match &paragrafo_inlines(&without)[0] {
            Inline::Text(t) => t.clone(),
            _ => unreachable!(),
        };
        assert_eq!(with, "© ");
        assert_eq!(sen, "© qui");
        let html = MarkdownProvider::new()
            .render_html(&with_tag, &Default::default())
            .unwrap();
        assert!(html.contains("© <span"), "render: {html}");
        assert!(!html.contains("amp;copy"), "render: {html}");
    }

    #[test]
    fn the_escape_in_the_segments_with_tag_is_dissolved_compressed() {
        // Un escape (`\*` → `*`) nel segmento prima del tag: la traduzione
        // degli offset non deve perderlo. Il modello porta `*testo*`, non
        // `\*testo\*`.
        let doc = parse("\\*testo\\* #tag");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "*testo* "),
            other => panic!("{:?}", other),
        }
        // Escape + entità + tag insieme: `\#pseudo` si scioglie in `#pseudo`
        // testuale (non è un tag), e resta nel segmento prima di `#vero`.
        let doc = parse("\\* A&amp;B \\#pseudo #vero");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "* A&B #pseudo "),
            other => panic!("{:?}", other),
        }
        assert_eq!(doc.tags.len(), 1, "solo #vero è un tag: {:?}", doc.tags);
    }

    #[test]
    fn entity_a_two_codepoint_followed_from_a_other_not_is_realigns() {
        // `&acE;` decodifica in DUE code point (U+223E U+0333): l'allineamento
        // a ritroso provava 1 o 2 code point contro il token dopo — un'altra
        // entità — e non aveva modo di decidere. La decodifica lineare usa la
        // `characters` della tabella: i due code point escono insieme, e
        // l'entità subito dopo si decodifica da sé, senza riallineare.
        let doc = parse("pre &acE;&copy; #tag fine");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "pre \u{223E}\u{0333}\u{00A9} "),
            other => panic!("{:?}", other),
        }
        assert_eq!(doc.tags.len(), 1, "il tag resta: {:?}", doc.tags);
    }

    #[test]
    fn a_ampersand_escaped_not_opens_entity() {
        // `\&amp;` è `&amp;` letterale: l'escape della `&` ha priorità, e la
        // sequenza che da lì in poi sembrerebbe un'entità non si decodifica.
        let doc = parse("\\&amp; #tag fine");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "&amp; "),
            other => panic!("{:?}", other),
        }
        assert_eq!(doc.tags.len(), 1, "il tag resta: {:?}", doc.tags);
        // `\\&amp;` invece è `\` + `&`: la coppia di barre ne escapa una, e la
        // `&amp;` che segue è un'entità vera. I due escape stanno nello stesso
        // nodo di comrak: la barra all'inizio dello span è **decodificata**, e
        // il decoder la riconosce dal sorgente; l'`&` dopo la coppia è
        // un'entità vera e si scioglie.
        let doc = parse("\\&amp; vs \\\\&amp; #tag fine");
        let par = paragrafo_inlines(&doc);
        match &par[0] {
            Inline::Text(t) => assert_eq!(t, "&amp; vs \\& "),
            other => panic!("{:?}", other),
        }
        assert!(matches!(&par[1], Inline::TagRef { name, .. } if name == "tag"));
        assert_eq!(par[2], &Inline::Text(" fine".into()));
        assert_eq!(doc.tags.len(), 1, "il tag resta: {:?}", doc.tags);
    }

    #[test]
    fn the_references_numeric_outside_range_become_ufffd() {
        // Codepoint 0, surrogati e oltre U+10FFFF non sono caratteri: comrak
        // li sostituisce con U+FFFD, e il decoder fa lo stesso.
        let doc = parse("&#0; &#x110000; &#xD800; #tag");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "\u{FFFD} \u{FFFD} \u{FFFD} "),
            other => panic!("{:?}", other),
        }
    }

    #[test]
    fn the_digits_beyond_the_ceiling_not_are_a_entity() {
        // 8 cifre decimali o 7 esadecimali non sono un riferimento numerico
        // (i tetti di comrak sono 7 e 6): la `&` resta letterale.
        let doc = parse("&#12345678; &#x1234567; #tag");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "&#12345678; &#x1234567; "),
            other => panic!("{:?}", other),
        }
        assert_eq!(doc.tags.len(), 1, "il tag resta: {:?}", doc.tags);
        // 7 decimali e 6 esadecimali invece sì, fino al tetto di U+10FFFF.
        let doc = parse("&#1114111; &#x10FFFF; #tag");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "\u{10FFFF} \u{10FFFF} "),
            other => panic!("{:?}", other),
        }
    }

    #[test]
    fn a_entity_without_point_and_comma_remains_text() {
        // Il `;` è obbligatorio: `&amp` e `&amp x;` (spazio nella finestra)
        // restano letterali.
        let doc = parse("&amp &amp x; #tag");
        match &paragrafo_inlines(&doc)[0] {
            Inline::Text(t) => assert_eq!(t, "&amp &amp x; "),
            other => panic!("{:?}", other),
        }
    }

    /// **Il bersaglio di un wikilink non è prosa, l'alias sì.**
    ///
    /// Senza alias l'etichetta la sintetizza comrak copiando il bersaglio, e
    /// finché veniva scandita come una frase qualunque `[[#Sezione]]` — il modo
    /// in cui si punta a un heading di questa stessa nota — faceva nascere un
    /// tag `Sezione` che nessuno aveva scritto, con lo span **dentro** quello
    /// del link: gli stessi byte rivendicati da due tabelle, e una rinomina
    /// della nota e una del tag che si contendono la stessa patch.
    ///
    /// **Le due metà stanno nello stesso banco apposta**, perché la
    /// riparazione sbagliata è quella che le confonde: togliere i tag da dentro
    /// i wikilink e basta cancellerebbe anche `#tag` in un alias, che l'autore
    /// ha battuto lettera per lettera. Il criterio non è «dentro un link», è
    /// «l'ha scritto qualcuno».
    ///
    /// Il banco è stato **rosso** sulla prima metà: `[[#Sezione]]` dichiarava
    /// un tag `Sezione`. Era una divergenza dichiarata del corpus — «un link a
    /// un heading di questa nota inventa un tag» — e adesso quella sorgente sta
    /// nel corpus curato.
    #[test]
    fn a_tag_born_only_where_someone_the_has_written() {
        for src in [
            "[[#Sezione]]",
            "[[Nota#Sezione]]",
            "[[#Sezione|alias]]",
            "[[Nota]]",
            "![[#Sezione]]",
        ] {
            let doc = parse(src);
            assert!(
                doc.tags.is_empty(),
                "«{src}»: il bersaglio del link è diventato un tag: {:?}",
                doc.tags
            );
            assert!(
                !format!("{:?}", doc.body).contains("TagRef"),
                "«{src}»: un `TagRef` dentro l'etichetta del link: {:?}",
                doc.body
            );
        }

        // E l'altra metà: dentro un alias il `#` è dell'autore, e resta un tag.
        let doc = parse("[[Nota|alias con #tag]]");
        let names: Vec<_> = doc.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["tag"], "body: {:?}", doc.body);
        // Lo span punta al `#tag` della sorgente, non a un'invenzione.
        let s = doc.tags[0].span;
        assert_eq!(&"[[Nota|alias con #tag]]"[s.start..s.end], "#tag");
    }

    #[test]
    fn embed_spans_point_at_the_source_even_after_escapes() {
        let src = "pre \\# poi ![[Nota#Sez]] fine";
        let doc = parse(src);
        let embed = doc
            .links
            .iter()
            .find(|the| the.embed && matches!(&the.target, LinkTarget::Wiki { .. }))
            .expect("un embed");
        assert_eq!(
            &src[embed.span.start..embed.span.end],
            "![[Nota#Sez]]",
            "lo span dell'embed deve ritagliare la sintassi intera nel sorgente"
        );
        // E un `!` sotto escape non apre un embed.
        let doc = parse("testo \\![[Nota]] qui");
        assert!(!doc.links.iter().any(|the| the.embed), "links: {:?}", doc.links);
    }

    #[test]
    fn builds_outline_with_slugs() {
        let doc = parse("# Titolo Uno\n\n## Sotto Sezione\n");
        assert_eq!(doc.outline.len(), 2);
        assert_eq!(doc.outline[0].slug, "titolo-uno");
        assert_eq!(doc.outline[1].level, 2);
        assert_eq!(doc.outline[1].slug, "sotto-sezione");
    }

    /// Due `## Note` nella stessa nota davano lo **stesso** `id` nell'HTML, e
    /// un link interno atterrava sempre sul primo — in silenzio, che è il modo
    /// peggiore di sbagliare destinazione.
    ///
    /// Qui si guarda il verso che l'utente vede (gli `id` dell'HTML sono
    /// diversi) e quello che tiene fermo il resto (per gli heading **senza
    /// ancora esplicita** l'ancora del blocco È lo slug dell'outline: sono la
    /// stessa assegnazione, non due chiamate che si danno la stessa risposta
    /// per fortuna — con un `^id` scritto l'ancora è quell'id com'è scritto, e
    /// lo prova `l_id_esplicito_di_un_heading_si_conserva_esattamente`).
    #[test]
    fn two_headings_with_the_same_text_get_different_ids() {
        let doc = parse("## Note\n\ntesto\n\n## Note 1\n\naltro\n\n## Note\n");
        let slugs: Vec<&str> = doc.outline.iter().map(|h| h.slug.as_str()).collect();
        assert_eq!(slugs, ["note", "note-1", "note-2"]);

        let anchors: Vec<Option<&str>> = doc
            .body
            .iter()
            .filter(|b| matches!(b, Block::Heading { .. }))
            .map(Block::anchor)
            .collect();
        assert_eq!(
            anchors,
            [Some("note"), Some("note-1"), Some("note-2")],
            "l'ancora del blocco e lo slug dell'outline sono la stessa assegnazione"
        );

        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::preview())
            .unwrap();
        assert!(html.contains("<h2 id=\"note\">"), "html: {html}");
        assert!(html.contains("<h2 id=\"note-1\">"), "html: {html}");
        assert!(html.contains("<h2 id=\"note-2\">"), "html: {html}");

        // E il verso che protegge i link già scritti: senza omonimi, gli id
        // sono quelli di sempre.
        let doc = parse("# Titolo Uno\n\n## Sotto Sezione\n");
        assert_eq!(doc.outline[0].slug, "titolo-uno");
        assert_eq!(doc.outline[1].slug, "sotto-sezione");
    }

    /// **Un'ancora esplicita su un heading sopravvive al giro, esattamente
    /// com'era scritta.**
    ///
    /// `## Titolo ^Mio-ID` è due cose insieme: una chiave (l'heading è
    /// indirizzabile, e la chiave è la forma canonica dell'id — `mio-id`, la
    /// stessa con cui `[[Nota#^Mio-ID]]` e `[[Nota#^mio-id]]` risolvono) e un
    /// **testo da riscrivere verbatim** (la maiuscola e i trattini non sono un
    /// ornamento: sono ciò che l'utente ha scritto). Prima di `explicit_anchor`
    /// il giro perdeva l'id — `## Titolo ^Mio-ID` rileggeva come `## Titolo`,
    /// con lo slug generato `titolo` — e una maiuscola è proprio ciò che
    /// distingue «la forma canonica» dalla «forma scritta»: se il test usasse
    /// `^abc`, il giro passerebbe anche su un'implementazione che confonde le
    /// due, e la confusione tornerebbe a mordere sul primo id scritto con una
    /// lettera maiuscola.
    #[test]
    fn the_id_explicit_of_a_heading_is_preserves_exactly() {
        let doc = parse("## Titolo ^Mio-ID\n");
        // La chiave: lo slug è la forma canonica dell'id scritto — la stessa
        // che la tabella piatta `anchors` usa per `[[Nota#^mio-id]]` — e
        // l'heading non ha consumato la generazione dello slug.
        assert_eq!(doc.outline.len(), 1);
        assert_eq!(doc.outline[0].slug, "mio-id");
        assert_eq!(doc.outline[0].explicit_anchor.as_deref(), Some("Mio-ID"));
        assert_eq!(
            doc.anchors
                .iter()
                .map(|a| a.id.as_str())
                .collect::<Vec<_>>(),
            ["mio-id"],
            "la tabella piatta risolve l'id esplicito con la sua forma canonica"
        );
        // Il blocco: l'`id` dell'HTML è quello scritto, non la forma canonica.
        let Block::Heading { anchor, .. } = &doc.body[0] else {
            panic!("atteso un heading");
        };
        assert_eq!(anchor.as_deref(), Some("Mio-ID"));

        // La riscrittura riporta l'id **com'era scritto**, sulla riga del
        // titolo — e il giro è stabile: rileggere ciò che si è scritto dà lo
        // stesso modello.
        let round = MarkdownProvider::new().serialize(&doc).unwrap();
        assert_eq!(round, "## Titolo ^Mio-ID\n");
        let reparsed = parse(&round);
        assert_eq!(reparsed, doc);

        // La resa HTML porta l'id scritto: `id="Mio-ID"`, non `id="mio-id"`.
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::preview())
            .unwrap();
        assert!(html.contains("<h2 id=\"Mio-ID\">"), "html: {html}");
    }

    /// **Le opzioni del chiamante valgono anche dentro l'etichetta di un link.**
    ///
    /// `render_link_label` rendeva gli inline dell'etichetta con un
    /// `RenderOptions::default()` fabbricato sul posto invece delle opzioni che
    /// il chiamante aveva chiesto: lo stesso wikilink usciva con l'`href="#"`
    /// in mezzo a un paragrafo e **senza** dentro l'etichetta di un altro link,
    /// cioè una via di configurazione del contratto era dichiarata e in quel
    /// punto non aveva effetto. `WIKILINKS_AS_DATA_ATTRS` è l'unica opzione che
    /// questa resa legge, quindi è quella che lo misura; la riparazione però non
    /// è su quel nome — è passare le `opts` giù come fa ogni altro ramo, così
    /// **un'opzione nuova la ereditano tutti e sei i siti** senza che nessuno
    /// debba ricordarsene.
    ///
    /// Il modello si costruisce qui a mano e non da una sorgente markdown perché
    /// comrak non innesta un wikilink dentro il testo di un link — ma
    /// `render_html` è una funzione pura del **modello**, e un modello con
    /// quella forma è ciò che una `SyntaxRule` di terzi produce
    /// (`SyntaxProduct::Block` porta i propri `blocks`, e quei blocchi arrivano
    /// qui). Il banco misura ciò che questa funzione promette: le `opts`
    /// arrivano intere ovunque ci sia un inline.
    #[test]
    fn the_callers_options_also_apply_inside_the_label() {
        let within = Inline::Link {
            target: LinkTarget::Wiki {
                page: "Nota".into(),
                heading: None,
                block: None,
            },
            label: None,
            embed: false,
            span: Span::EMPTY,
        };
        let mut doc = DocumentModel::empty(DocId::new("nota.md"));
        doc.body.push(Block::Paragraph {
            inlines: vec![
                within.clone(),
                Inline::Link {
                    target: LinkTarget::Url("https://esempio.it".into()),
                    label: Some(vec![Inline::Text("vai a ".into()), within]),
                    embed: false,
                    span: Span::EMPTY,
                },
            ],
            anchor: None,
            span: Span::EMPTY,
        });

        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::preview())
            .unwrap();
        assert_eq!(
            html.matches("class=\"wikilink\" data-wikilink-page=\"Nota\" href=\"#\"")
                .count(),
            2,
            "il wikilink dentro l'etichetta esce come quello fuori: {html}"
        );

        // Anche senza opzioni, entrambi i wikilink restano navigabili da tastiera.
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::default())
            .unwrap();
        assert_eq!(
            html.matches("class=\"wikilink\" data-wikilink-page=\"Nota\" href=\"#\"").count(),
            2,
            "il fallback href vale anche senza opzioni: {html}"
        );
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
            .render_html(&doc, &RenderOptions::preview())
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
            .render_html(&doc, &RenderOptions::preview())
            .unwrap();
        assert!(html.contains("class=\"embed\""), "html: {html}");
        assert!(html.contains("data-embed-page=\"Altra Nota\""));
        assert!(html.contains("data-embed-heading=\"Sezione\""));
        assert!(!html.contains("class=\"wikilink\""));
    }

    /// **Un segnaposto di embed porta le stesse tre coordinate di un
    /// riferimento**, perché sono la stessa cosa vista da due prefissi.
    ///
    /// Il link portava pagina, heading *e* blocco; l'embed solo pagina e
    /// heading, e i due elenchi stavano scritti a mano in due rami. Un
    /// `![[Nota#^blocco]]` arrivava quindi alla shell come un embed della nota
    /// intera — l'unica cosa che diceva *quale* blocco era il pezzo che non
    /// veniva scritto, e un campo che manca non lo vede nessuno.
    ///
    /// La seconda metà è il contrario e vale uguale: un campo **assente** non si
    /// scrive. Un `data-embed-heading=""` non dice «non c'è heading», dice
    /// «l'heading si chiama nulla», e chi legge l'attributo con un `?? null`
    /// riceve la stringa vuota e va a cercare una sezione che non esiste.
    #[test]
    fn the_placeholder_of_a_embed_carries_also_the_again_of_block() {
        let html = MarkdownProvider::new()
            .render_html(&parse("![[Altra Nota#^blocco]]"), &RenderOptions::preview())
            .unwrap();
        assert!(
            html.contains("data-embed-page=\"Altra Nota\""),
            "html: {html}"
        );
        assert!(html.contains("data-embed-block=\"blocco\""), "html: {html}");
        assert!(
            !html.contains("data-embed-heading"),
            "un heading che non c'è non si scrive: {html}"
        );
        // E l'altro prefisso, sulla stessa sorgente senza il `!`.
        let html = MarkdownProvider::new()
            .render_html(&parse("[[Altra Nota#^blocco]]"), &RenderOptions::preview())
            .unwrap();
        assert!(
            html.contains("data-wikilink-block=\"blocco\""),
            "html: {html}"
        );
        assert!(
            !html.contains("data-wikilink-heading"),
            "un heading che non c'è non si scrive: {html}"
        );
    }

    /// **L'apice esce escapato da ogni attributo**, e non perché qui si scrivano
    /// gli attributi fra apici singoli — oggi sono tutti fra virgolette doppie.
    ///
    /// Il valore di un attributo è testo dell'utente: il nome di una nota, il
    /// simbolo di un task, l'`info string` di un recinto. L'escape incompleto
    /// che c'era prima (`&`, `<`, `>`, `"` e basta, in `fub-features` e nel
    /// kernel) era innocuo per una ragione che nessuno aveva scritto da nessuna
    /// parte — *tutti i chiamanti di oggi usano le virgolette doppie* — cioè per
    /// una proprietà di chi chiama, non di chi escapa. Il giorno che un
    /// emettitore scrive `class='…'`, che è HTML valido, quella proprietà cade
    /// in silenzio e il difetto smette di essere estetico.
    ///
    /// Adesso l'attributo lo scrive `fub_abi::html::attr`, che mette lui le
    /// virgolette e l'escape: la domanda «quali caratteri servono per *questo*
    /// delimitatore» non si pone più a chi chiama. Questo banco fissa il
    /// risultato sull'**HTML prodotto**, che è l'artefatto vero — un banco sul
    /// modello non vedrebbe niente, perché il modello l'apice ce l'ha e basta.
    ///
    /// **Verde per costruzione, e va detto**: delle tre tabelle divergenti
    /// questa era la completa, quindi su *questo* provider il banco non sarebbe
    /// mai stato rosso. Sta qui perché fissa il risultato dopo la migrazione a
    /// `fub_abi::html`; il banco che era davvero rosso sull'apice è quello di
    /// `fub-features` · `blocks.rs`, dove la tabella incompleta stava.
    #[test]
    fn a_quote_in_a_attribute_exits_as_entity() {
        let html = MarkdownProvider::new()
            .render_html(&parse("[[L'ora del tè]]"), &RenderOptions::preview())
            .unwrap();
        assert!(
            html.contains("data-wikilink-page=\"L&#39;ora del tè\""),
            "html: {html}"
        );
        assert!(
            !html.contains("L'ora"),
            "l'apice grezzo è rimasto nell'attributo: {html}"
        );
        // E nel testo del link, che è contenuto e non attributo: stessa tabella.
        assert!(html.contains(">L&#39;ora del tè<"), "html: {html}");
    }

    /// **Un blocco senza figli non si rende come un `<div>` vuoto**: il suo
    /// contenuto sta negli `attrs`, e di lì esce.
    ///
    /// Il caso che si vede sempre, con tutto montato come lo monta l'app, è
    /// l'HTML grezzo: `custom_kind::HTML` non ha un renderer registrato da
    /// nessuno — e non deve averlo, perché cosa sia lecito eseguire lo decide la
    /// sanitizzazione (5.3) — quindi cade nel degrado generico, che è questo. Il
    /// `parse.rs` mette i byte in `attrs.html` e `blocks` resta vuoto; il
    /// degrado rendeva i figli, cioè niente. Un `<div>` e un commento HTML
    /// **sparivano dall'anteprima**, mentre nel file restavano — `serialize.rs`
    /// la sua metà della stessa perdita l'aveva già chiusa, e questa era
    /// rimasta indietro.
    ///
    /// Che il testo esca **escapato** è la metà che non cambia: resta dato, non
    /// torna markup.
    #[test]
    fn a_block_without_children_does_not_lose_its_own_text() {
        let html = MarkdownProvider::new()
            .render_html(
                &parse("<div class=\"x\">ciao</div>\n"),
                &RenderOptions::preview(),
            )
            .unwrap();
        assert!(html.contains("class=\"block-html\""), "html: {html}");
        assert!(
            html.contains("&lt;div class=&quot;x&quot;&gt;ciao&lt;/div&gt;"),
            "l'HTML grezzo è sparito dall'anteprima: {html}"
        );
        assert!(
            !html.contains("<div class=\"x\">"),
            "e non deve tornare markup: {html}"
        );

        // Il commento HTML, che è l'altro modo di scriverne uno.
        let html = MarkdownProvider::new()
            .render_html(&parse("<!-- nota per me -->\n"), &RenderOptions::preview())
            .unwrap();
        assert!(html.contains("nota per me"), "html: {html}");

        // E un kind qualunque senza figli che porta il proprio sorgente: è la
        // forma di una formula o di un diagramma quando il renderer che li
        // disegna non c'è (spento, revocato, o fallito).
        let doc = DocumentModel {
            body: vec![Block::Custom {
                custom_kind: custom_kind::MATH.into(),
                attrs: serde_json::json!({ "source": "E = mc^2", "display": true }),
                blocks: vec![],
                anchor: None,
                span: fub_abi::model::Span::new(0, 0),
            }],
            ..DocumentModel::empty(fub_abi::model::DocId::new("nota.md"))
        };
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::preview())
            .unwrap();
        assert!(html.contains("E = mc^2"), "html: {html}");
    }

    /// **Due estensioni omonime di due autori diversi non finiscono sulla
    /// stessa classe CSS**, e questo vale sul lato blocco *e* sul lato inline.
    ///
    /// È il caso per cui il namespace di un `custom_kind` esiste: `terzi` e
    /// `altri` possono chiamare `spoiler` la propria estensione senza mettersi
    /// d'accordo, e il modello li tiene distinti. Il render li perdeva a metà
    /// strada — il blocco scriveva il kind intero, l'inline lo tagliava al `:`
    /// — quindi un tema scritto per lo `spoiler` di uno vestiva anche quello
    /// dell'altro, in silenzio.
    ///
    /// **Il banco è stato rosso**, e sull'inline soltanto: rimettendo il taglio
    /// del namespace i due span uscivano tutti e due su `inline-spoiler`.
    ///
    /// L'ultima metà è quella che tiene ferma la parte che **non** deve
    /// cambiare: un kind del core non ha namespace, quindi la sua classe è
    /// quella di prima. `.inline-highlight` è un selettore vero della shell
    /// (`frontend/src/theme/serie/pelle.css`), e allargare la classe con un prefisso
    /// avrebbe scollegato il tema senza che niente diventasse rosso.
    #[test]
    fn two_kind_same_named_of_namespace_different_not_collide_on_the_class() {
        let custom_inline = |kind: &str, key: &str, text: &str| Inline::Custom {
            custom_kind: kind.into(),
            attrs: serde_json::json!({ key: text }),
            span: fub_abi::model::Span::EMPTY,
        };
        let custom_block = |kind: &str, source: &str| Block::Custom {
            custom_kind: kind.into(),
            attrs: serde_json::json!({ "source": source }),
            blocks: vec![],
            anchor: None,
            span: fub_abi::model::Span::EMPTY,
        };
        let doc = DocumentModel {
            body: vec![
                Block::Paragraph {
                    inlines: vec![
                        custom_inline("terzi:spoiler", "source", "di terzi"),
                        custom_inline("altri:spoiler", "source", "di altri"),
                    ],
                    anchor: None,
                    span: fub_abi::model::Span::EMPTY,
                },
                custom_block("terzi:spoiler", "blocco di terzi"),
                custom_block("altri:spoiler", "blocco di altri"),
            ],
            ..DocumentModel::empty(fub_abi::model::DocId::new("nota.md"))
        };
        let html = MarkdownProvider::new()
            .render_html(&doc, &RenderOptions::preview())
            .unwrap();

        for side in ["inline", "block"] {
            for ns in ["terzi", "altri"] {
                assert!(
                    html.contains(&format!("class=\"{side}-{ns}:spoiler\"")),
                    "manca la classe `{side}-{ns}:spoiler`: {html}"
                );
            }
            // E la classe senza namespace non esce affatto: se uscisse, i due
            // autori sarebbero di nuovo lo stesso selettore.
            assert!(
                !html.contains(&format!("class=\"{side}-spoiler\"")),
                "il namespace è stato tagliato sul lato {side}: {html}"
            );
        }

        // La metà che non cambia: un kind del core resta dov'era.
        let core = DocumentModel {
            body: vec![Block::Paragraph {
                inlines: vec![custom_inline(custom_kind::HIGHLIGHT, "text", "importante")],
                anchor: None,
                span: fub_abi::model::Span::EMPTY,
            }],
            ..DocumentModel::empty(fub_abi::model::DocId::new("nota.md"))
        };
        let html = MarkdownProvider::new()
            .render_html(&core, &RenderOptions::preview())
            .unwrap();
        assert!(
            html.contains("<span class=\"inline-highlight\">importante</span>"),
            "html: {html}"
        );
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
    // decisione 0003 — ciò che il modello non sapeva dire
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
                .map(|the| the.task.map(|t| (t.symbol, t.checked())))
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
            .any(|the| the.target == LinkTarget::wiki("Nota")));

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
        assert!(inlines.iter().any(|the| matches!(
            the,
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
    fn frontmatter_properties_as_out_typed() {
        let doc = parse("---\nscadenza: 2026-07-25\nrating: 4\nautore: \"[[Mario]]\"\ntag: [a, b]\n---\n\nCorpo.");
        assert!(matches!(
            doc.frontmatter.property("scadenza", &DateFormats::ISO),
            Some(PropertyValue::Date(d)) if (d.year, d.month, d.day) == (2026, 7, 25)
        ));
        assert_eq!(
            doc.frontmatter.property("rating", &DateFormats::ISO),
            Some(PropertyValue::Number(4.0))
        );
        assert_eq!(
            doc.frontmatter.property("autore", &DateFormats::ISO),
            Some(PropertyValue::Link(LinkTarget::wiki("Mario")))
        );
        assert!(matches!(
            doc.frontmatter.property("tag", &DateFormats::ISO),
            Some(PropertyValue::List(v)) if v.len() == 2
        ));
    }
}
