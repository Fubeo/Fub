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
        custom_kind, Block, ColumnAlign, DateFormats, Inline, LinkTarget, PropertyValue,
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
    fn un_tag_nasce_solo_dove_qualcuno_lo_ha_scritto() {
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
        let nomi: Vec<_> = doc.tags.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(nomi, vec!["tag"], "body: {:?}", doc.body);
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

    /// Due `## Note` nella stessa nota davano lo **stesso** `id` nell'HTML, e
    /// un link interno atterrava sempre sul primo — in silenzio, che è il modo
    /// peggiore di sbagliare destinazione.
    ///
    /// Qui si guarda il verso che l'utente vede (gli `id` dell'HTML sono
    /// diversi) e quello che tiene fermo il resto (l'ancora del blocco È lo
    /// slug dell'outline: sono la stessa assegnazione, non due chiamate che si
    /// danno la stessa risposta per fortuna).
    #[test]
    fn two_headings_with_the_same_text_get_different_ids() {
        let doc = parse("## Note\n\ntesto\n\n## Note 1\n\naltro\n\n## Note\n");
        let slugs: Vec<&str> = doc.outline.iter().map(|h| h.slug.as_str()).collect();
        assert_eq!(slugs, ["note", "note-1", "note-2"]);

        let ancore: Vec<Option<&str>> = doc
            .body
            .iter()
            .filter(|b| matches!(b, Block::Heading { .. }))
            .map(Block::anchor)
            .collect();
        assert_eq!(
            ancore,
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
    fn il_segnaposto_di_un_embed_porta_anche_l_ancora_di_blocco() {
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
    fn un_apice_in_un_attributo_esce_come_entita() {
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
    fn un_blocco_senza_figli_non_perde_il_proprio_testo() {
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
    /// (`frontend/src/style.css`), e allargare la classe con un prefisso
    /// avrebbe scollegato il tema senza che niente diventasse rosso.
    #[test]
    fn due_kind_omonimi_di_namespace_diversi_non_collidono_sulla_classe() {
        let custom_inline = |kind: &str, chiave: &str, text: &str| Inline::Custom {
            custom_kind: kind.into(),
            attrs: serde_json::json!({ chiave: text }),
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

        for lato in ["inline", "block"] {
            for ns in ["terzi", "altri"] {
                assert!(
                    html.contains(&format!("class=\"{lato}-{ns}:spoiler\"")),
                    "manca la classe `{lato}-{ns}:spoiler`: {html}"
                );
            }
            // E la classe senza namespace non esce affatto: se uscisse, i due
            // autori sarebbero di nuovo lo stesso selettore.
            assert!(
                !html.contains(&format!("class=\"{lato}-spoiler\"")),
                "il namespace è stato tagliato sul lato {lato}: {html}"
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
