//! Rendering HTML **dal modello comune** (non dalla sorgente): così il render
//! è una funzione pura del `DocumentModel`, esattamente come vuole il trait, e
//! la navigazione dei wikilink passa per data-attribute che il frontend risolve.

use fub_abi::format::RenderOptions;
use fub_abi::model::{
    custom_kind, Block, ColumnAlign, DocumentModel, Inline, LinkTarget, TableRow,
};
use fub_abi::rules::loads;

use fub_abi::html::{attr, escape};
use std::fmt::Write;

pub fn render_html(model: &DocumentModel, opts: &RenderOptions) -> String {
    // La capacità si stima dal corpo: il numero di blocchi per una media
    // grezza di byte resi. Non tocca i byte, solo le riallocazioni.
    let mut out = String::with_capacity(model.body.len() * 128);
    render_blocks(&model.body, opts, &mut out);
    out
}

fn render_blocks(blocks: &[Block], opts: &RenderOptions, out: &mut String) {
    for block in blocks {
        render_block(block, opts, out);
    }
}

/// L'attributo con cui un blocco diventa **indirizzabile** nella pagina: è la
/// resa dell'ancora del modello, e senza di essa un link a blocco arriverebbe
/// al documento giusto senza avere dove atterrare.
fn anchor_attr(block: &Block) -> String {
    match block.anchor() {
        Some(id) => attr("id", id),
        None => String::new(),
    }
}

fn render_block(block: &Block, opts: &RenderOptions, out: &mut String) {
    let id = anchor_attr(block);
    match block {
        Block::Heading { level, inlines, .. } => {
            let the = (*level).clamp(1, 6);
            write!(out, "<h{the}{id}>").unwrap();
            render_inlines(inlines, opts, out);
            write!(out, "</h{the}>").unwrap();
        }
        Block::Paragraph { inlines, .. } => {
            write!(out, "<p{id}>").unwrap();
            render_inlines(inlines, opts, out);
            out.push_str("</p>");
        }
        Block::List {
            ordered,
            items,
            start,
            ..
        } => {
            let tag = if *ordered { "ol" } else { "ul" };
            // `<ol start>` è il campo `start` del modello: senza, una lista che
            // nel file comincia da 3 si legge da 1 in anteprima, cioè il testo
            // e ciò che se ne vede dicono due cose diverse.
            let from = match start {
                Some(n) if *ordered && *n != 1 => format!(" start=\"{n}\""),
                _ => String::new(),
            };
            write!(out, "<{tag}{id}{from}>").unwrap();
            for item in items {
                match &item.task {
                    Some(t) => {
                        // La casella è **disabilitata**: spuntare da anteprima è
                        // una scrittura sul documento, e passa da un'azione del
                        // protocollo, non da uno stato del DOM che nessuno legge.
                        let checked = if t.checked() { " checked" } else { "" };
                        let symbol = t.symbol.map(String::from).unwrap_or_default();
                        write!(
                            out,
                            "<li class=\"task\"{}><input type=\"checkbox\" disabled{checked}>",
                            attr("data-task", &symbol)
                        )
                        .unwrap();
                    }
                    None => out.push_str("<li>"),
                }
                render_blocks(&item.blocks, opts, out);
                out.push_str("</li>");
            }
            write!(out, "</{tag}>").unwrap();
        }
        Block::Table {
            head, rows, align, ..
        } => {
            write!(out, "<table{id}>").unwrap();
            if let Some(h) = head {
                out.push_str("<thead>");
                render_row(h, align, true, opts, out);
                out.push_str("</thead>");
            }
            out.push_str("<tbody>");
            for r in rows {
                render_row(r, align, false, opts, out);
            }
            out.push_str("</tbody></table>");
        }
        Block::CodeBlock { lang, code, .. } => {
            match lang {
                Some(the) => write!(
                    out,
                    "<pre{id}><code{}>",
                    attr("class", &format!("language-{the}"))
                )
                .unwrap(),
                None => write!(out, "<pre{id}><code>").unwrap(),
            }
            out.push_str(&escape(code));
            out.push_str("</code></pre>");
        }
        Block::Quote { blocks, .. } => {
            write!(out, "<blockquote{id}>").unwrap();
            render_blocks(blocks, opts, out);
            out.push_str("</blockquote>");
        }
        Block::ThematicBreak { .. } => write!(out, "<hr{id}>").unwrap(),
        Block::ReferenceDefinition {
            label, url, title, ..
        } => {
            // La resa è **visibile** come quella del frontmatter illeggibile:
            // una definizione è metadata, non prosa, ma un `<div>` vuoto
            // sarebbe la sparizione muta di una riga che l'utente ha scritto.
            // Non è un link (`<a>`) e non ha semantica di paragrafo: è un
            // contenitore con l'etichetta come attributo, e il titolo accanto
            // alla destinazione, entrambi escapati — dati, non markup.
            let title = title
                .as_deref()
                .map(|t| format!(" {}", escape(t)))
                .unwrap_or_default();
            write!(
                out,
                "<div{id} class=\"reference-definition\"{}>{}{}</div>",
                attr("data-label", label),
                escape(url),
                title
            )
            .unwrap();
        }
        Block::Custom {
            custom_kind,
            attrs,
            blocks,
            ..
        } => {
            if custom_kind == custom_kind::CALLOUT {
                let ty = attrs.get("type").and_then(|v| v.as_str()).unwrap_or("note");
                write!(
                    out,
                    "<div{id} class=\"callout\"{}>",
                    attr("data-callout", ty)
                )
                .unwrap();
                if let Some(title) = attrs.get("title").and_then(|v| v.as_str()) {
                    if !title.is_empty() {
                        write!(out, "<div class=\"callout-title\">{}</div>", escape(title))
                            .unwrap();
                    }
                }
                render_blocks(blocks, opts, out);
                out.push_str("</div>");
            } else if custom_kind == custom_kind::FRONTMATTER_UNPARSED {
                // Il degrado generico qui non basterebbe: questo blocco non ha
                // figli, e un `<div>` vuoto è di nuovo la sparizione muta —
                // l'utente ha sbagliato una virgola nelle proprietà e vedrebbe
                // le proprietà svanire senza un avviso. Il testo resta **dato**
                // (escapato), e il motivo si legge accanto.
                let reason = attrs.get("error").and_then(|v| v.as_str()).unwrap_or("");
                let text = attrs.get("text").and_then(|v| v.as_str()).unwrap_or("");
                write!(
                    out,
                    "<div{id} class=\"block-frontmatter-unparsed\">\
                     <div class=\"frontmatter-error\">{}</div><pre>{}</pre></div>",
                    escape(reason),
                    escape(text)
                )
                .unwrap();
            } else {
                // Ogni altro kind — registrato o no — degrada a resa generica,
                // col suo `custom_kind` come classe. L'HTML grezzo di
                // `custom_kind::HTML` resta **dato** e non torna markup: la
                // decisione su cosa sia lecito eseguire è della sanitizzazione
                // (5.3), non del provider che ha letto il file.
                let label = attrs
                    .get("label")
                    .and_then(|v| v.as_str())
                    .map(|the| attr("data-label", the))
                    .unwrap_or_default();
                write!(
                    out,
                    "<div{id}{}{label}>",
                    attr("class", &css_class("block", custom_kind))
                )
                .unwrap();
                // Un blocco **senza figli** non ha niente da rendere per questa
                // strada, e finiva in un `<div>` vuoto: la frase qui sopra
                // diceva che l'HTML grezzo «resta dato», e invece non restava
                // affatto. Il contenuto di questi kind sta negli `attrs` — è la
                // forma che `parse.rs` dà a un `NodeValue::HtmlBlock`, ed è
                // quella che una `SyntaxRule` produce — quindi va letto di lì.
                if blocks.is_empty() {
                    out.push_str(&escape(
                        text_content(custom_kind, attrs).unwrap_or_default(),
                    ));
                } else {
                    render_blocks(blocks, opts, out);
                }
                out.push_str("</div>");
            }
        }
    }
}

fn render_row(
    row: &TableRow,
    align: &[ColumnAlign],
    header: bool,
    opts: &RenderOptions,
    out: &mut String,
) {
    out.push_str("<tr>");
    for (the, cell) in row.cells.iter().enumerate() {
        let tag = if header { "th" } else { "td" };
        let style = match align.get(the).copied().unwrap_or(ColumnAlign::None) {
            ColumnAlign::None => String::new(),
            ColumnAlign::Left => " style=\"text-align:left\"".into(),
            ColumnAlign::Center => " style=\"text-align:center\"".into(),
            ColumnAlign::Right => " style=\"text-align:right\"".into(),
        };
        write!(out, "<{tag}{style}>").unwrap();
        render_inlines(&cell.inlines, opts, out);
        write!(out, "</{tag}>").unwrap();
    }
    out.push_str("</tr>");
}

fn render_inlines(inlines: &[Inline], opts: &RenderOptions, out: &mut String) {
    for inline in inlines {
        render_inline(inline, opts, out);
    }
}

fn render_inline(inline: &Inline, opts: &RenderOptions, out: &mut String) {
    match inline {
        Inline::Text(s) => out.push_str(&escape(s)),
        Inline::Emph(children) => {
            out.push_str("<em>");
            render_inlines(children, opts, out);
            out.push_str("</em>");
        }
        // L'apice e il barrato hanno un elemento loro — `<sup>` e `<del>` —
        // e non collassano in un unico stile: la resa distingue i due
        // costrutti come li distingue il modello.
        Inline::Superscript(children) => {
            out.push_str("<sup>");
            render_inlines(children, opts, out);
            out.push_str("</sup>");
        }
        Inline::Strikethrough(children) => {
            out.push_str("<del>");
            render_inlines(children, opts, out);
            out.push_str("</del>");
        }
        Inline::Strong(children) => {
            out.push_str("<strong>");
            render_inlines(children, opts, out);
            out.push_str("</strong>");
        }
        // Il duro cambia riga davvero; il morbido è uno spazio — la stessa
        // resa che il browser dà a un a-capo singolo nel testo.
        Inline::HardBreak => out.push_str("<br />"),
        Inline::SoftBreak => out.push(' '),
        Inline::Code(s) => {
            out.push_str("<code>");
            out.push_str(&escape(s));
            out.push_str("</code>");
        }
        Inline::TagRef { name, .. } => {
            write!(
                out,
                "<span class=\"tag\"{}>#{}</span>",
                attr("data-tag", name),
                escape(name)
            )
            .unwrap();
        }
        Inline::Link {
            target,
            label,
            embed,
            ..
        } => render_link(target, label.as_deref(), *embed, opts, out),
        Inline::Custom {
            custom_kind, attrs, ..
        } if custom_kind == custom_kind::FOOTNOTE_REFERENCE => {
            let label = attrs.get("label").and_then(|v| v.as_str()).unwrap_or("");
            write!(
                out,
                "<sup class=\"footnote-ref\"{}>{}</sup>",
                attr("data-label", label),
                escape(label)
            )
            .unwrap();
        }
        // Il degrado generico degli inline. **Prima non c'era**: un
        // `Inline::Custom` che il provider non riconosceva spariva dalla
        // resa, in silenzio — ed era il gemello inline del difetto che il
        // §3.2 nomina sui blocchi, con l'aggravante che qui non restava
        // nemmeno il testo. Un kind che porta i propri byte sotto la chiave
        // che il contratto dichiara (la tabella per il core, `source` per i
        // terzi — §25.7) li mostra dentro uno span con la sua classe: chi ha
        // un tema lo veste, chi non ce l'ha lo legge.
        Inline::Custom {
            custom_kind, attrs, ..
        } => {
            // La stessa domanda del degrado dei blocchi, e la stessa
            // espressione: qui si guardava solo `text`, e un inline che portasse
            // il proprio contenuto sotto un altro nome del registro spariva
            // esattamente come sparivano i blocchi. Adesso la domanda la fa
            // `carichi::carico_testuale`, come per i blocchi.
            let text = text_content(custom_kind, attrs).unwrap_or_default();
            write!(
                out,
                "<span{}>{}</span>",
                attr("class", &css_class("inline", custom_kind)),
                escape(text)
            )
            .unwrap();
        }
    }
}

/// **Il testo che un `Custom` porta negli `attrs`**, quando è lui tutto il
/// contenuto che il blocco ha.
///
/// I `custom_kind` che non hanno figli portano i byte dell'utente in un attrs,
/// e **la chiave la dichiara il contratto**, non questo file: la domanda sta
/// in [`carichi::carico_testuale`] — la tabella [`custom_kind::CARICHI`] per i
/// kind del core, la chiave convenzionale `source` per quelli di terzi
/// (§25.7). Prima erano tre stringhe a campione (`html`, `source`, `text`)
/// scritte qui dentro, cioè lo stesso elenco di `model.rs` copiato in un
/// renderer: un kind del core che chiamasse il proprio contenuto in un quarto
/// modo si rendeva vuoto, e la copia non aveva nessuno che la tenesse
/// allineata all'originale.
///
/// Sta in una funzione sola perché il degrado dei blocchi e quello degli inline
/// facevano la stessa domanda in due punti, e la facevano diversa: l'inline
/// guardava `text` e il blocco non guardava niente. Chiedere due volte la stessa
/// cosa in due modi è il difetto, non la ripetizione.
///
/// **Il limite, dichiarato**: un kind di terzi che non porta i byte sotto la
/// chiave convenzionale si rende vuoto — è il prezzo della forma (b) della
/// §25.7, e oggi nessun plugin lo paga. «Sostituire il campione con niente»
/// è ciò che la riga vecchia rifiutava: non è niente, è la **chiave
/// dichiarata** in `rules::loads`, e chi la segue rende come prima.
fn text_content<'a>(kind: &str, attrs: &'a serde_json::Value) -> Option<&'a str> {
    loads::text_payload(kind, attrs)
}

/// La classe CSS di un `Custom`: il prefisso del lato che lo rende — `block` o
/// `inline` — e poi il `custom_kind` **intero**, namespace compreso.
///
/// **Sta in una funzione sola perché i due lati la componevano diversa**, e la
/// differenza non era estetica: il blocco scriveva il kind intero, l'inline lo
/// faceva passare per un `class_of` che tagliava tutto ciò che stava prima del
/// `:`. Così `terzi:spoiler` e `altri:spoiler` — due estensioni omonime di due
/// autori diversi, che è il caso per cui il namespace esiste — uscivano
/// **entrambe** su `.inline-spoiler`, e un tema che ne vestisse una vestiva
/// anche l'altra. Il namespace nel modello li teneva distinti fin qui, e qui si
/// perdeva.
///
/// Il commento che difendeva il taglio diceva che le due restavano
/// distinguibili «dal `data-kind` che il blocco porta»: **quell'attributo non
/// lo emette nessun ramo**, né qui né altrove nel workspace. Era una premessa
/// che sembrava vera perché argomentava.
///
/// I kind del core non hanno namespace, quindi per loro non cambia niente:
/// `highlight` resta `.inline-highlight`, che è il selettore su cui il tema
/// della shell è scritto (`frontend/src/theme/serie/pelle.css`). Il `:` in un nome di
/// classe è lecito in HTML; in un selettore CSS si scrive `\:`, ed è la stessa
/// forma che i blocchi emettono già da prima di questa riga.
fn css_class(side: &str, custom_kind: &str) -> String {
    format!("{side}-{custom_kind}")
}

/// Le coordinate di un wikilink come data-attribute, col prefisso di chi le
/// riceve: `data-wikilink-*` per un riferimento, `data-embed-*` per il
/// segnaposto di una transclusion.
///
/// **Sta in una funzione sola perché i due rami scrivevano due elenchi diversi
/// della stessa cosa.** Il link portava pagina, heading *e* blocco — glielo ha
/// dato la 0049 — l'embed solo pagina e heading: `![[Nota#^b]]` arrivava alla
/// shell senza l'ancora, cioè come un embed della nota intera, e a dirlo non
/// c'era niente perché il campo che mancava non è un campo che manchi al
/// compilatore. Un quinto campo di [`LinkTarget::Wiki`] adesso si scrive qui e
/// lo ereditano tutti e due.
///
/// Un campo assente **non si scrive**: un `data-embed-heading=""` non dice «non
/// c'è heading», dice «l'heading è quello che si chiama nulla», e chi legge
/// l'attributo con un `?? null` riceve la stringa vuota.
fn wiki_attrs(
    prefix: &str,
    page: &str,
    heading: &Option<String>,
    block: &Option<String>,
) -> String {
    let mut out = attr(&format!("data-{prefix}-page"), page);
    if let Some(h) = heading {
        out.push_str(&attr(&format!("data-{prefix}-heading"), h));
    }
    if let Some(b) = block {
        out.push_str(&attr(&format!("data-{prefix}-block"), b));
    }
    out
}

fn render_link(
    target: &LinkTarget,
    label: Option<&[Inline]>,
    embed: bool,
    opts: &RenderOptions,
    out: &mut String,
) {
    match target {
        LinkTarget::Wiki {
            page,
            heading,
            block,
        } => {
            if embed {
                // Transclusion: `render_html` è una funzione pura per-documento
                // e NON può leggere altri documenti (niente HostApi qui). Si
                // emette un placeholder; il frontend chiama `render_embed` del
                // kernel e innesta il contenuto (profondità e cicli a suo
                // carico). Vedi docs/architecture/ui-protocol.md.
                write!(
                    out,
                    "<div class=\"embed\"{}>",
                    wiki_attrs("embed", page, heading, block)
                )
                .unwrap();
                render_link_label(label, &inner(target, page), opts, out);
                out.push_str("</div>");
                return;
            }
            // Le stesse tre coordinate, con l'altro prefisso: il **blocco** il
            // parser lo legge dalla 0003, e fino alla 0049 si fermava qui —
            // `[[Nota#^blocco]]` arrivava alla shell come un link alla nota e
            // basta. Adesso c'è una risposta in cui metterlo
            // (`resolved-ref.at`), e questo è il primo centimetro del giro.
            // Wikilink come data-attribute: il frontend risolve la navigazione.
            write!(
                out,
                "<a class=\"wikilink\"{}",
                wiki_attrs("wikilink", page, heading, block)
            )
            .unwrap();
            out.push_str(" href=\"#\"");
            out.push('>');
            render_link_label(label, &inner(target, page), opts, out);
            out.push_str("</a>");
        }
        // Un riferimento incorporato che non è un wikilink è, quasi sempre,
        // un'immagine. Anche qui si emette il **segnaposto** del protocollo di
        // transclusion e non un `<img>`: caricare una risorsa — del vault o
        // peggio remota — è una decisione della shell (13.1 per gli allegati,
        // 5.3 e 23 per il contenuto remoto), non del provider che ha letto il
        // file. Chi disegna sa dove sta il vault; questo codice no.
        LinkTarget::Url(url) if embed => {
            write!(out, "<div class=\"embed\"{}>", attr("data-embed-url", url)).unwrap();
            render_link_label(label, url, opts, out);
            out.push_str("</div>");
        }
        LinkTarget::Path(p) if embed => {
            write!(out, "<div class=\"embed\"{}>", attr("data-embed-path", p)).unwrap();
            render_link_label(label, p, opts, out);
            out.push_str("</div>");
        }
        LinkTarget::Url(url) => {
            write!(out, "<a{}>", attr("href", url)).unwrap();
            render_link_label(label, url, opts, out);
            out.push_str("</a>");
        }
        LinkTarget::Path(p) => {
            write!(
                out,
                "<a class=\"internal-path\"{} href=\"#\">",
                attr("data-path", p)
            )
            .unwrap();
            render_link_label(label, p, opts, out);
            out.push_str("</a>");
        }
    }
}

/// Ciò che si legge di un wikilink **senza alias**: l'interno intero, non la
/// sola pagina.
///
/// `label: None` vuol dire «l'autore non ha scritto un alias», e allora ciò che
/// si vede è ciò che sta fra le due parentesi — `Nota#Sezione`, non `Nota`.
/// Finché il parser sintetizzava l'etichetta dal bersaglio la differenza non si
/// vedeva mai da qui; adesso che non la sintetizza più, il ripiego sulla sola
/// `page` mangerebbe l'heading a schermo.
fn inner(target: &LinkTarget, page: &str) -> String {
    target.wiki_inner().unwrap_or_else(|| page.to_string())
}

/// L'etichetta di un link, **con le opzioni di chi ha chiesto la resa**.
///
/// Un'etichetta non è testo piatto: è una fetta di inline come le altre, e può
/// contenere un wikilink (`[vai a [[Nota]]](url)`, l'`alt` di un'immagine). Qui
/// si costruiva un `RenderOptions::default()` sul posto, cioè **le opzioni di
/// nessuno**: gli inline dentro l'etichetta venivano resi come se il chiamante
/// non avesse chiesto niente, e `WIKILINKS_AS_DATA_ATTRS` — l'unica opzione che
/// la resa legge, quella che l'anteprima del kernel accende sempre — smetteva di
/// valere appena un link entrava dentro l'etichetta di un altro. Lo stesso
/// wikilink usciva con l'`href="#"` in mezzo a un paragrafo e senza dentro
/// un'etichetta, e a dirlo non c'era niente.
///
/// La riparazione è passare le `opts` che il chiamante ha già in mano, come fa
/// ogni altro ramo della resa: così **un'opzione nuova la ereditano tutti e sei
/// i siti** che rendono un'etichetta, e ogni inline annidato la vede a qualunque
/// profondità, senza che nessuno debba ricordarsene di nuovo.
fn render_link_label(
    label: Option<&[Inline]>,
    fallback: &str,
    opts: &RenderOptions,
    out: &mut String,
) {
    match label {
        Some(inlines) if !inlines.is_empty() => render_inlines(inlines, opts, out),
        _ => out.push_str(&escape(fallback)),
    }
}
