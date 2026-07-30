//! Il corpus dei costrutti, e il fuzzer: **un presidio con due sorgenti
//! d'ingresso** (§17.1).
//!
//! # Cosa questo file NON chiede
//!
//! Non chiede «comrak è conforme a CommonMark». Non è una proprietà di FubMD, e
//! asserirla renderebbe questa suite rossa il giorno in cui comrak **corregge**
//! un bug. Chiede l'altra cosa, che è di FubMD e che finora nessuno chiedeva:
//! **ciò che il modello dice del documento è vero rispetto ai byte del file.**
//!
//! Le proprietà stanno in [`fubmd_sdk::testing::conformita`] e non qui, perché
//! sono di un `FormatProvider` **qualunque**: un secondo provider (org-mode,
//! AsciiDoc, il canvas) le eredita senza riscriverle, e il criterio è quello
//! della [0059](../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md)
//! — il soggetto della garanzia decide dove sta il presidio. Qui sta l'**ingresso**,
//! che è markdown e quindi di questo crate. Fino a oggi la sezione
//! `FormatProvider` del banco aveva due proprietà e **nessun cliente**, cioè era
//! esattamente ciò che la [0054](../../../docs/decisions/0054-il-banco-del-lato-provider.md)
//! dichiara vietato: *«una suite di conformità che nessuna implementazione vera
//! passa non è una suite, è un'opinione»*.
//!
//! # Perché il costo di questa voce cresceva con l'attesa, e adesso no
//!
//! Il §17.1 lo dice così: «ogni sintassi nuova è un caso in più da scrivere a
//! posteriori». Il costo non cresce perché scrivere il caso sia caro — cresce
//! perché **nessuno si accorge che il corpus non è cresciuto**. Quindi il corpus
//! non è un elenco su cui si itera ([0056](../../../docs/decisions/0056-un-elenco-che-e-la-sorgente.md)):
//! si **confronta**, in tre direzioni, con altrettante sorgenti che non sono lui.
//!
//! 1. le varianti di `Block` e `Inline`, estratte dal sorgente del contratto;
//! 2. i `custom_kind` del registro, estratti dallo stesso;
//! 3. le sintassi che il provider **dichiara** in `capabilities()`.
//!
//! Un costrutto nuovo che nessun caso esercita fa diventare rosso questo file, e
//! da lì in poi il costo lo paga chi aggiunge la sintassi, nel giro in cui la
//! aggiunge.
//!
//! # Le divergenze sono dichiarate, non scoperte
//!
//! Un corpus serve anche — soprattutto — a dire **dove il modello e il file non
//! sono d'accordo**. Ogni caso sta in [`divergenze_dichiarate`], una per riga,
//! con la sua ragione: la stessa forma dell'allowlist della
//! [0059](../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md).
//! Non dicono «va bene così»: dicono «succede questo, ed è scritto». Il giorno in
//! cui qualcuno mappa `~~barrato~~` nel modello, la riga diventa rossa e va
//! **tolta** — che è il modo in cui una divergenza smette di essere silenziosa.
//!
//! La regola che tiene onesto questo file: **un caso che non passa le proprietà
//! non si toglie dal corpus, si sposta lì.** Togliere un ingresso perché è rosso è
//! il solo modo di trasformare un presidio in un'opinione, e la lista delle
//! divergenze esiste perché quel gesto abbia un'alternativa che costa meno.
//!
//! # Le due sorgenti d'ingresso non pretendono la stessa cosa
//!
//! Sul corpus curato si chiede tutto ([`conformita::Pretesa::ELaCoerenza`]); sulle
//! mutazioni generate si chiede solo ciò la cui violazione fa **panicare o
//! scrivere alla cieca** ([`conformita::Pretesa::CheAffettino`]), che è
//! esattamente ciò che il §17.1 chiede al fuzzing — *«un parser che pania è un
//! vault che non si apre»*, dove la casella che lo chiede è il capitolo 5.3 di
//! `FEATURES.md`. La ragione della differenza sta nel doc di
//! [`conformita::Pretesa`], e il caso che l'ha imposta è nella lista delle
//! divergenze: il termine di una definition list «stretta» ha uno span di **un
//! byte**, su markdown perfettamente normale, e finché non è deciso *cosa sia*
//! quello span la coerenza non è una cosa che si possa pretendere.

use std::collections::BTreeSet;

use fubmd_abi::format::{FormatProvider, ParseContext};
use fubmd_abi::model::{Block, DocumentModel, Inline, LinkTarget, Span};
use fubmd_abi::options::syntax;
use fubmd_format_markdown::MarkdownProvider;
use fubmd_sdk::testing::conformita;

/// Il sorgente del contratto, da cui si estraggono le tre sorgenti di verità del
/// confronto.
///
/// Arriva per `include_str!` e non per path a runtime: se `model.rs` si sposta,
/// questo file **non compila** — invece di passare avendo confrontato il corpus
/// con un elenco vuoto. È il gesto della
/// [0059](../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md).
const CONTRATTO: &str = include_str!("../../fubmd-abi/src/model.rs");

fn provider() -> MarkdownProvider {
    MarkdownProvider::new()
}

fn ctx() -> ParseContext {
    ParseContext::obsidian("corpus/nota.md")
}

fn parse(source: &str) -> DocumentModel {
    provider()
        .parse(&source.into(), &ctx())
        .expect("il corpus è markdown, e il markdown parsa")
}

// ---------------------------------------------------------------------------
// Il corpus
// ---------------------------------------------------------------------------

/// Una voce del corpus: un nome per leggere il fallimento, e i byte esatti.
///
/// I byte stanno scritti qui come stringhe Rust e non come file committati, per
/// la ragione della [0058](../../../docs/decisions/0058-un-nome-che-nasce.md):
/// un file con un BOM o con CRLF dentro un repo è alla mercé di
/// `.gitattributes`, degli editor e dei checkout su Windows.
struct Caso {
    nome: &'static str,
    source: &'static str,
}

const fn caso(nome: &'static str, source: &'static str) -> Caso {
    Caso { nome, source }
}

/// Ogni costrutto che il provider markdown sa produrre, una volta.
///
/// L'ordine è quello del contratto: prima le varianti di `Block`, poi quelle di
/// `Inline`, poi i `custom_kind`, poi le forme ostili del testo. Non è un elenco
/// da cui si itera per **dedurre** la copertura: la copertura si misura
/// **parsando** queste sorgenti e guardando cosa ne esce.
fn corpus() -> Vec<Caso> {
    vec![
        // --- Block ---
        caso("heading atx", "# Titolo\n"),
        caso("heading setext", "Titolo\n===\n"),
        caso("heading di ogni livello", "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f\n"),
        caso("paragrafo", "Un paragrafo qualunque.\n"),
        caso("lista non ordinata", "- a\n- b\n"),
        caso("lista ordinata", "1. a\n2. b\n"),
        caso("lista annidata", "- a\n  - b\n    - c\n"),
        caso("code block recintato", "```\nx\n```\n"),
        caso("code block con linguaggio", "```rust\nfn main() {}\n```\n"),
        caso("code block indentato", "    quattro spazi\n"),
        caso("code block non chiuso", "```rs\nsenza chiusura\n"),
        caso("citazione", "> citata\n"),
        caso("citazione annidata", "> > due volte\n"),
        caso("riga orizzontale", "***\n"),
        caso("tabella con sola intestazione", "| a |\n| - |\n"),
        caso(
            "tabella con allineamenti",
            "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n",
        ),
        caso("tabella con inline nelle celle", "| a | b |\n| - | - |\n| [[N]] | `c` |\n"),
        // --- ListItem / TaskMarker ---
        caso("task vuota", "- [ ] da fare\n"),
        caso("task fatta", "- [x] fatta\n"),
        caso("task a stato personalizzato", "- [/] in corso\n"),
        // --- Inline ---
        caso("enfasi", "*enfasi*\n"),
        caso("forte", "**forte**\n"),
        caso("codice inline", "`codice`\n"),
        caso("enfasi dentro forte", "**forte con *enfasi* dentro**\n"),
        caso("link markdown a un path", "[etichetta](nota.md)\n"),
        caso("link markdown a un url", "[etichetta](https://esempio.invalid/a)\n"),
        caso("wikilink", "[[Nota]]\n"),
        caso("wikilink completo", "[[Nota#Sezione^blocco|Alias]]\n"),
        caso("wikilink al solo heading", "[[#Sezione]]\n"),
        caso("embed di wikilink", "![[Nota]]\n"),
        caso("embed di immagine", "![alt](figura.png)\n"),
        caso("tag", "#tag\n"),
        caso("tag annidato", "#genitore/figlio\n"),
        caso("softbreak", "una riga\nun'altra\n"),
        caso("linebreak", "una riga  \nun'altra\n"),
        caso("link di riferimento", "[a][rif]\n\n[rif]: nota.md\n"),
        // --- custom_kind ---
        caso("callout senza titolo", "> [!note]\n> corpo\n"),
        caso("callout con titolo", "> [!warning] Attenzione\n> corpo\n"),
        caso("callout di ogni tipo", "> [!note]\n> a\n\n> [!tip]\n> b\n\n> [!important]\n> c\n\n> [!warning]\n> d\n\n> [!caution]\n> e\n"),
        caso("footnote", "una nota[^n]\n\n[^n]: il corpo\n"),
        caso("definition list", "Termine\n\n: la definizione\n"),
        caso("html a blocco", "<div>blocco</div>\n"),
        caso("commento html", "<!-- un commento -->\n"),
        // --- frontmatter ---
        caso("frontmatter", "---\ntitolo: X\n---\n\n# Corpo\n"),
        caso(
            "frontmatter con ogni specie di proprietà",
            "---\ntesto: X\nnumero: 4\nvero: true\nvuota:\ndata: 2026-07-30\nquando: 2026-07-30T10:30:00+02:00\nelenco: [a, b]\nrelazione: \"[[Nota]]\"\nannidata:\n  a: 1\n---\n\nx\n",
        ),
        // --- ancore ---
        caso("ancora di paragrafo", "Un paragrafo ^abc123\n"),
        caso("ancora su riga propria", "Un paragrafo\n\n^abc123\n"),
        caso("ancora che non è un'ancora", "2^10 = 1024\n"),
        // --- le forme ostili del testo (§15.5) ---
        caso("crlf", "# Titolo\r\n\r\nUn paragrafo con [[Link]].\r\n"),
        caso("cr solo", "# Titolo\rUn paragrafo.\r"),
        // Il `\r` nudo su **più blocchi**, che è il caso in cui la tabella
        // riga→byte sballa e non si vede: `byte()` è robusto ai valori fuori
        // range, quindi una riga che non esiste torna la fine del file, e gli
        // span sono vuoti invece che sbagliati. Sta qui per il difetto che ha
        // scoperto, non per completezza.
        caso(
            "cr solo su più blocchi",
            "# Titolo\r\rUn paragrafo con [[Nota]] e #tag.\r\r## Sezione\r\r- [x] fatta\r",
        ),
        caso("un cr nudo in mezzo a un file a lf", "# Ti\rtolo\n\nvedi [[Nota]]\n\n## Poi\n"),
        caso("terminatori misti", "# Titolo\r\n\nuna\r\n\naltra\n\nvedi [[Nota]]\r\n"),
        caso("bom", "\u{feff}# Titolo\n\nUn paragrafo.\n"),
        caso("bom e frontmatter", "\u{feff}---\na: 1\n---\n\n# Corpo\n"),
        caso("senza newline finale", "Una riga sola senza a capo"),
        caso("solo un bom", "\u{feff}"),
        caso("vuoto", ""),
        caso("solo spazi", "   \n\n  \t\n"),
        caso("fuori dal bmp", "# 🎉 Titolo\n\nvedi [[Nota 🎉]] e #tag🎉\n"),
        caso("nfd nel contenuto", "# Cafe\u{301}\n\nvedi [[Cafe\u{301}]]\n"),
        // --- un documento che ha tutto insieme, che è il caso vero ---
        caso(
            "un documento intero",
            "---\ntitolo: Tutto\ntag: [a, b]\n---\n\n\
             # Titolo ^testa\n\n\
             Un paragrafo con *enfasi*, **forte**, `codice`, [[Nota]], \
             ![[Altra]], [md](x.md), ![img](f.png) e #tag.\n\n\
             ## Sezione\n\n\
             - [ ] una task con [[Link]]\n\
             - [x] fatta\n\
               - annidata\n\n\
             > [!tip] Suggerimento\n> con dentro un [[Wikilink]]\n\n\
             | a | b |\n| :-- | --: |\n| 1 | [[N]] |\n\n\
             ```rust\nfn main() {}\n```\n\n\
             > citazione con - [x] task [[A]] #t\n\n\
             una nota[^f]\n\n[^f]: il corpo della nota\n\n\
             ***\n\n\
             Termine\n\n: definizione\n",
        ),
    ]
}

// ---------------------------------------------------------------------------
// Le proprietà, su ogni voce del corpus
// ---------------------------------------------------------------------------

#[test]
fn ogni_voce_del_corpus_produce_un_modello_che_dice_il_vero() {
    let p = provider();
    let mut verificati = 0;
    for c in corpus() {
        let verificato = std::panic::catch_unwind(|| {
            conformita::un_modello_dice_il_vero_sulla_sorgente(&p, c.source, &ctx())
        })
        .unwrap_or_else(|_| {
            panic!(
                "il caso `{}` ({:?}) ha rotto una proprietà",
                c.nome, c.source
            )
        });
        assert!(
            verificato,
            "il caso `{}` ({:?}) è stato **rifiutato** dal provider.\n\
             Un corpus curato è fatto di documenti che si aprono: se questo non si\n\
             apre, o la sorgente è sbagliata o il provider ha smesso di accettare\n\
             qualcosa che accettava.",
            c.nome, c.source
        );
        verificati += 1;
    }
    assert!(
        verificati > 50,
        "il corpus ha verificato {verificati} casi: sono troppo pochi perché sia\n\
         il corpus di questo file, e un corpus che si svuota passa sempre."
    );
}

#[test]
fn il_formato_rispetta_le_proprieta_senza_ingresso() {
    // Le due che c'erano dalla 0054 e che nessuno chiamava.
    conformita::un_formato_rispetta_il_contratto(&provider());
}

// ---------------------------------------------------------------------------
// La copertura, in tre direzioni
// ---------------------------------------------------------------------------

/// Il nome della variante di [`Block`], come sta scritto nel contratto.
///
/// Il `match` è **esaustivo**: una variante nuova non compila finché qualcuno
/// non le dà un nome qui, e da quel momento la direzione «il contratto ne ha una
/// che il corpus non produce» la vede.
fn nome_del_blocco(b: &Block) -> &'static str {
    match b {
        Block::Heading { .. } => "Heading",
        Block::Paragraph { .. } => "Paragraph",
        Block::List { .. } => "List",
        Block::CodeBlock { .. } => "CodeBlock",
        Block::Quote { .. } => "Quote",
        Block::ThematicBreak { .. } => "ThematicBreak",
        Block::Custom { .. } => "Custom",
        Block::Table { .. } => "Table",
    }
}

/// Il nome della variante di [`Inline`]. Esaustivo per la stessa ragione.
fn nome_dell_inline(i: &Inline) -> &'static str {
    match i {
        Inline::Text(_) => "Text",
        Inline::Emph(_) => "Emph",
        Inline::Strong(_) => "Strong",
        Inline::Code(_) => "Code",
        Inline::Link { .. } => "Link",
        Inline::TagRef { .. } => "TagRef",
        Inline::Custom { .. } => "Custom",
    }
}

/// Ciò che il corpus, parsato, produce davvero: nomi di variante e
/// `custom_kind`.
#[derive(Default)]
struct Osservato {
    blocchi: BTreeSet<String>,
    inline: BTreeSet<String>,
    kind: BTreeSet<String>,
    sintassi: BTreeSet<String>,
}

fn osserva_il_corpus() -> Osservato {
    let mut o = Osservato::default();
    for c in corpus() {
        let doc = parse(c.source);
        if !doc.frontmatter.is_empty() {
            o.sintassi.insert(syntax::FRONTMATTER.to_string());
        }
        if !doc.tags.is_empty() {
            o.sintassi.insert(syntax::TAGS.to_string());
        }
        for l in &doc.links {
            if matches!(l.target, LinkTarget::Wiki { .. }) {
                o.sintassi.insert(syntax::WIKILINKS.to_string());
            }
            if l.embed {
                o.sintassi.insert(syntax::EMBEDS.to_string());
            }
        }
        osserva_blocchi(&doc.body, &mut o);
    }
    o
}

fn osserva_blocchi(blocchi: &[Block], o: &mut Osservato) {
    for b in blocchi {
        o.blocchi.insert(nome_del_blocco(b).to_string());
        if let Block::Custom { custom_kind, .. } = b {
            o.kind.insert(custom_kind.clone());
            match custom_kind.as_str() {
                "callout" => o.sintassi.insert(syntax::CALLOUTS.to_string()),
                "footnote-definition" => o.sintassi.insert(syntax::FOOTNOTES.to_string()),
                "definition-list" => o.sintassi.insert(syntax::DEFINITION_LISTS.to_string()),
                _ => false,
            };
        }
        match b {
            Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => {
                osserva_inline(inlines, o)
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                osserva_blocchi(blocks, o)
            }
            Block::List { items, .. } => {
                for it in items {
                    osserva_blocchi(&it.blocks, o);
                }
            }
            Block::Table { head, rows, .. } => {
                for riga in head.iter().chain(rows.iter()) {
                    for cella in &riga.cells {
                        osserva_inline(&cella.inlines, o);
                    }
                }
            }
            Block::CodeBlock { .. } | Block::ThematicBreak { .. } => {}
        }
    }
}

fn osserva_inline(inlines: &[Inline], o: &mut Osservato) {
    for i in inlines {
        o.inline.insert(nome_dell_inline(i).to_string());
        match i {
            Inline::Custom { custom_kind, .. } => {
                o.kind.insert(custom_kind.clone());
                if custom_kind == "footnote-reference" {
                    o.sintassi.insert(syntax::FOOTNOTES.to_string());
                }
            }
            Inline::Emph(dentro) | Inline::Strong(dentro) => osserva_inline(dentro, o),
            Inline::Text(_) | Inline::Code(_) | Inline::Link { .. } | Inline::TagRef { .. } => {}
        }
    }
}

#[test]
fn il_corpus_produce_ogni_variante_del_modello() {
    let o = osserva_il_corpus();
    confronta(
        "le varianti di `Block`",
        &varianti_di_enum(CONTRATTO, "Block"),
        &o.blocchi,
        &BTreeSet::new(),
    );
    confronta(
        "le varianti di `Inline`",
        &varianti_di_enum(CONTRATTO, "Inline"),
        &o.inline,
        &BTreeSet::new(),
    );
}

/// I `custom_kind` che il **provider markdown** non emette, e la ragione.
///
/// Non è una lacuna del corpus: è dove passa il confine del §3.1
/// ([0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)).
/// Tre di questi kind li innesta una `SyntaxRule` registrata — `MathRule`,
/// `DiagramRule`, `HighlightRule` in `fubmd-features/src/blocks.rs` — e un
/// provider che li producesse da sé rimetterebbe in piedi le due categorie di
/// estensioni che quella decisione ha rifiutato. Il loro corpus sta con le
/// regole, in `fubmd-features/tests/custom_blocks_e2e.rs`.
///
/// `block` è un'altra specie: è il **fallback** di `convert_block`, e con
/// l'insieme di estensioni che `build_options` accende non risulta
/// raggiungibile. Sta qui, non tolto: il giorno in cui si accende un'estensione
/// nuova di comrak diventa la rete che raccoglie ciò che nessuno ha mappato, e
/// toglierlo perché «non serve» vorrebbe dire farlo diventare un `panic` o un
/// blocco perso.
fn kind_non_del_provider() -> BTreeSet<String> {
    ["math", "diagram", "highlight", "block"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[test]
fn il_corpus_produce_ogni_custom_kind_del_registro() {
    let o = osserva_il_corpus();
    confronta(
        "i `custom_kind` del registro del contratto",
        &costanti_di_modulo(CONTRATTO, "custom_kind"),
        &o.kind,
        &kind_non_del_provider(),
    );
}

#[test]
fn il_corpus_esercita_ogni_sintassi_che_il_provider_dichiara() {
    let o = osserva_il_corpus();
    let dichiarate: BTreeSet<String> = provider()
        .capabilities()
        .syntax
        .keys()
        .map(|k| k.to_string())
        .collect();
    confronta(
        "le sintassi dichiarate in `capabilities()`",
        &dichiarate,
        &o.sintassi,
        &BTreeSet::new(),
    );
}

/// Il confronto nei due versi, che è la forma canonica di questo repo
/// ([0056](../../../docs/decisions/0056-un-elenco-che-e-la-sorgente.md)).
///
/// `attesi` viene da una sorgente che non è il corpus; `osservati` viene dal
/// corpus parsato; `scusati` è l'elenco chiuso di ciò che il corpus non può
/// produrre, con la ragione scritta accanto alla sua definizione.
fn confronta(
    quale: &str,
    attesi: &BTreeSet<String>,
    osservati: &BTreeSet<String>,
    scusati: &BTreeSet<String>,
) {
    assert!(
        !attesi.is_empty(),
        "l'elenco atteso di {quale} è **vuoto**: la sorgente da cui si estrae non\n\
         ha risposto niente, e un confronto contro il vuoto passa sempre."
    );

    let mancanti: Vec<&String> = attesi
        .difference(osservati)
        .filter(|a| !scusati.contains(*a))
        .collect();
    assert!(
        mancanti.is_empty(),
        "il corpus non esercita {quale}: {mancanti:?}.\n\
         Aggiungere il caso costa una riga; non aggiungerlo costa che nessuno se\n\
         ne accorga — che è il modo in cui il costo di questa voce cresceva con\n\
         l'attesa. Se il costrutto non è del provider, la sua riga va nell'elenco\n\
         degli scusati **con la ragione**, non qui."
    );

    let di_troppo: Vec<&String> = osservati.difference(attesi).collect();
    assert!(
        di_troppo.is_empty(),
        "il corpus produce {quale} che la sorgente non conosce: {di_troppo:?}.\n\
         O il nome è cambiato nel contratto e qui è rimasto quello vecchio, o\n\
         l'estrattore non lo vede più."
    );

    let scusati_inutili: Vec<&String> = scusati
        .iter()
        .filter(|s| osservati.contains(*s) || !attesi.contains(*s))
        .collect();
    assert!(
        scusati_inutili.is_empty(),
        "l'elenco degli scusati di {quale} nomina {scusati_inutili:?}, che o il\n\
         corpus produce già, o la sorgente non dichiara più.\n\
         Una scusa che non serve più è la cosa peggiore di un elenco a mano: sta\n\
         lì a dire che qualcosa non si può fare, e nessuno la ricontrolla."
    );
}

// ---------------------------------------------------------------------------
// L'estrattore, e il suo presidio
// ---------------------------------------------------------------------------

/// I nomi delle varianti di un `enum` del contratto, letti dal **testo** del
/// sorgente.
///
/// Legge i sorgenti come testo, e va detto qui invece che scoperto dopo: un
/// `enum` generato da una macro, o una variante scritta sulla stessa riga della
/// graffa aperta, non li vedrebbe. Nessuna delle due forme esiste in `model.rs`,
/// che `cargo fmt --all --check` tiene su una variante per riga.
fn varianti_di_enum(sorgente: &str, nome: &str) -> BTreeSet<String> {
    let mut fuori = true;
    let mut profondita = 0usize;
    let mut varianti = BTreeSet::new();
    let apertura = format!("pub enum {nome} {{");
    for riga in sorgente.lines() {
        let t = riga.trim();
        if fuori {
            if t == apertura {
                fuori = false;
                profondita = 1;
            }
            continue;
        }
        if profondita == 1 {
            if let Some(primo) = t.chars().next() {
                if primo.is_ascii_uppercase() {
                    let ident: String = t
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || *c == '_')
                        .collect();
                    varianti.insert(ident);
                }
            }
        }
        // Le graffe si contano **dopo** aver deciso se la riga è una variante:
        // `Heading {` apre a profondità 1 ed è la variante, non il suo campo.
        if t.starts_with("///") || t.starts_with("//") {
            continue;
        }
        profondita += t.matches('{').count();
        profondita = profondita.saturating_sub(t.matches('}').count());
        if profondita == 0 {
            break;
        }
    }
    varianti
}

/// I **valori** delle `pub const … : &str` di un modulo del contratto.
///
/// Sono i valori e non i nomi perché è il valore che compare in un
/// `Block::Custom`: il registro dichiara `CALLOUT = "callout"`, e nel modello
/// c'è `"callout"`.
fn costanti_di_modulo(sorgente: &str, nome: &str) -> BTreeSet<String> {
    let mut fuori = true;
    let mut valori = BTreeSet::new();
    let apertura = format!("pub mod {nome} {{");
    for riga in sorgente.lines() {
        let t = riga.trim();
        if fuori {
            if t == apertura {
                fuori = false;
            }
            continue;
        }
        if t == "}" {
            break;
        }
        if let Some(resto) = t.strip_prefix("pub const ") {
            if let Some((_, valore)) = resto.split_once('=') {
                let v = valore.trim().trim_end_matches(';').trim();
                if let Some(dentro) = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
                    valori.insert(dentro.to_string());
                }
            }
        }
    }
    valori
}

/// Un estrattore che torna a vuoto fa passare ogni confronto, quindi si prova
/// che veda: sono i «test del test» della
/// [0059](../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md).
#[test]
fn l_estrattore_vede_il_contratto() {
    let blocchi = varianti_di_enum(CONTRATTO, "Block");
    assert!(
        blocchi.contains("Heading") && blocchi.contains("Table") && blocchi.len() >= 8,
        "l'estrattore non trova le varianti di `Block`: {blocchi:?}"
    );
    // I campi non sono varianti: `level`, `inlines`, `span` cominciano minuscoli
    // e nessuno di loro deve entrare.
    assert!(
        !blocchi.iter().any(|v| v.is_empty() || v == "Span"),
        "l'estrattore ha preso qualcosa che non è una variante: {blocchi:?}"
    );

    let inline = varianti_di_enum(CONTRATTO, "Inline");
    assert!(
        inline.contains("Text") && inline.contains("TagRef") && inline.len() >= 7,
        "l'estrattore non trova le varianti di `Inline`: {inline:?}"
    );

    let kind = costanti_di_modulo(CONTRATTO, "custom_kind");
    assert!(
        kind.contains("callout") && kind.contains("definition-term") && kind.len() >= 11,
        "l'estrattore non trova i `custom_kind` del registro: {kind:?}"
    );

    // Un enum che non c'è dà l'insieme vuoto, ed è il caso che `confronta`
    // rifiuta esplicitamente: senza quel rifiuto un nome sbagliato qui sopra
    // renderebbe verde ogni confronto.
    assert!(varianti_di_enum(CONTRATTO, "NonEsiste").is_empty());
    assert!(costanti_di_modulo(CONTRATTO, "non_esiste").is_empty());
}

// ---------------------------------------------------------------------------
// Le perdite dichiarate
// ---------------------------------------------------------------------------

/// In che modo il modello e il file **non sono d'accordo**.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Perche {
    /// Il parser accende l'estensione, il modello non ha dove metterla, e
    /// mapparla è lavoro con una sua decisione (quale rappresentazione).
    AccesaEnonMappata,
    /// Il modello la rappresenta, e chi la legge a valle non la trova dove la
    /// cerca.
    RappresentataEnonRaggiungibile,
    /// Nasce dalla forma dei byte, e la conseguenza è che due file identici a
    /// schermo danno due modelli diversi.
    DipendeDaiByte,
    /// La specie peggiore: il modello dichiara qualcosa che **nel documento non
    /// c'è**. Una perdita si nota — chi ha scritto `~~barrato~~` vede che non è
    /// barrato; un'invenzione no, perché il posto in cui compare è un pannello
    /// che l'utente non sta guardando mentre scrive.
    InventataDalParser,
}

/// Dove il modello e il file **non sono d'accordo**, una riga per divergenza.
///
/// Ogni riga è un'affermazione su come le cose stanno **oggi**, non su come
/// devono stare: il predicato descrive la divergenza, e il giorno in cui qualcuno
/// la ripara la riga diventa rossa e va tolta. È l'unico modo che conosco di far
/// smettere una divergenza di essere silenziosa senza fermare il lavoro per
/// ripararla adesso — e la ragione per cui questa forma è quella giusta invece di
/// una riga di prosa in un documento è la §16.8: una prosa non diventa rossa.
#[allow(clippy::type_complexity)]
fn divergenze_dichiarate() -> Vec<(
    &'static str,
    &'static str,
    Perche,
    fn(&DocumentModel) -> bool,
)> {
    vec![
        (
            "un link a un heading di questa nota inventa un tag",
            "[[#Sezione]]\n",
            Perche::InventataDalParser,
            |d| {
                d.tags.iter().any(|t| t.name == "Sezione")
                    && d.links.first().is_some_and(|l| {
                        matches!(&l.target, LinkTarget::Wiki { heading, .. }
                            if heading.as_deref() == Some("Sezione"))
                    })
                    // E i due span si sovrappongono: il tag sta **dentro** il
                    // link, quindi rinominare la nota e rinominare il tag
                    // riscrivono gli stessi byte.
                    && d.links.first().is_some_and(|l| {
                        d.tags
                            .iter()
                            .any(|t| l.span.start <= t.span.start && t.span.end <= l.span.end)
                    })
            },
        ),
        (
            "il barrato non arriva nel modello",
            "~~barrato~~\n",
            Perche::AccesaEnonMappata,
            |d| testo_piatto(d) == "barrato" && !nomi_dei_kind(d).contains("strikethrough"),
        ),
        (
            "l'apice non arriva nel modello",
            "testo ^apice^ qui\n",
            Perche::AccesaEnonMappata,
            |d| testo_piatto(d) == "testo apice qui" && nomi_dei_kind(d).is_empty(),
        ),
        (
            "l'html inline sparisce, mentre quello a blocco resta",
            "un <b>grassetto</b> inline\n",
            Perche::AccesaEnonMappata,
            |d| testo_piatto(d) == "un grassetto inline" && nomi_dei_kind(d).is_empty(),
        ),
        (
            "un frontmatter che non si parsa non lascia traccia",
            "---\n--- non una chiave\nb: 2\n---\n\nx\n",
            Perche::AccesaEnonMappata,
            |d| d.frontmatter.is_empty(),
        ),
        (
            "l'ancora esplicita di un heading non è raggiungibile dall'albero",
            "## Titolo ^xyz\n",
            Perche::RappresentataEnonRaggiungibile,
            |d| {
                d.anchors.iter().any(|a| a.id == "xyz")
                    && d.body.first().map(Block::anchor) == Some(Some("titolo"))
            },
        ),
        (
            "uno slug vuoto è un'ancora che il contratto rifiuterebbe",
            "#\n",
            Perche::RappresentataEnonRaggiungibile,
            |d| d.body.first().map(Block::anchor) == Some(Some("")),
        ),
        (
            "l'alt di un'immagine non entra nel testo indicizzato",
            "![una didascalia](f.png)\n",
            Perche::RappresentataEnonRaggiungibile,
            |d| !d.text.contains("didascalia"),
        ),
        (
            "la sintassi grezza di un embed entra nel testo indicizzato",
            "![[Nota]]\n",
            Perche::RappresentataEnonRaggiungibile,
            |d| d.text.contains("![["),
        ),
        (
            // Non è markdown ostile: è la forma «stretta» della definition list,
            // quella senza riga vuota fra il termine e la definizione. Il termine
            // ha uno span di **un byte** — il primo carattere — quindi non è
            // indirizzabile, un embed del termine ritaglia una lettera, e un tag
            // scritto nel termine esce dallo span del blocco che lo contiene. È
            // il caso che ha costretto a distinguere le due pretese di
            // `conformita::Pretesa`: la coerenza non si può pretendere su
            // qualunque ingresso finché questo non è riparato.
            "il termine di una definition list stretta ha uno span di un byte",
            "Termine\n: la definizione\n",
            Perche::DipendeDaiByte,
            |d| {
                fn primo_termine(b: &[Block]) -> Option<Span> {
                    b.iter().find_map(|b| match b {
                        Block::Custom {
                            custom_kind,
                            blocks,
                            span,
                            ..
                        } if custom_kind == "definition-term" => {
                            Some(blocks.first().map(Block::span).unwrap_or(*span))
                        }
                        Block::Custom { blocks, .. } => primo_termine(blocks),
                        _ => None,
                    })
                }
                primo_termine(&d.body) == Some(Span::new(0, 1))
            },
        ),
        (
            // La forma **larga** invece è giusta, e sta accanto alla stretta
            // perché è ciò che rende la stretta un difetto e non una scelta.
            "e la forma larga della stessa definition list ce l'ha giusto",
            "Termine\n\n: la definizione\n",
            Perche::DipendeDaiByte,
            |d| {
                d.body.first().is_some_and(|b| {
                    matches!(b, Block::Custom { custom_kind, .. } if custom_kind == "definition-list")
                })
            },
        ),
        (
            // Il `\r` nudo **dentro** una riga di tabella la spezza in due (in
            // CommonMark il CR solitario è un terminatore), e la tabella guadagna
            // una riga che nel file non c'è: una riga di dati diventa due, e la
            // seconda porta una cella che affetta un `|`. Il ritaglio di
            // `ritagliato_dopo` (in `parse.rs`) ha tolto la **sovrapposizione**
            // fra le celle, che era il difetto che rendeva indefinita una patch;
            // la riga in più resta, ed è di qui che si vede che il ritaglio è una
            // rete e non una riparazione.
            "un cr nudo dentro una riga di tabella la spezza in due righe",
            "| a | b |\n| - | - |\n| 1 | 2 \r| 3 |\n",
            Perche::DipendeDaiByte,
            |d| {
                d.body.iter().any(|b| match b {
                    Block::Table { rows, .. } => rows.len() > 1,
                    _ => false,
                })
            },
        ),
        (
            "lo slug di un heading dipende dalla normalizzazione unicode",
            "# Cafe\u{301}\n",
            Perche::DipendeDaiByte,
            |d| {
                d.outline.first().map(|h| h.slug.as_str()) == Some("cafe")
                    && parse("# Caf\u{e9}\n")
                        .outline
                        .first()
                        .map(|h| h.slug.as_str())
                        == Some("caf\u{e9}")
            },
        ),
    ]
}

#[test]
fn le_divergenze_sono_quelle_dichiarate() {
    let dichiarate = divergenze_dichiarate();
    assert!(
        dichiarate.len() >= 10,
        "l'elenco delle divergenze si è svuotato: {} righe. Se sono state\n\
         riparate è una bella notizia e va scritta nel verbale; se è l'elenco che\n\
         si è rotto, questo file ha smesso di presidiare la cosa per cui esiste.",
        dichiarate.len()
    );
    for (nome, source, perche, ancora_vero) in dichiarate {
        let doc = parse(source);
        assert!(
            ancora_vero(&doc),
            "la divergenza dichiarata «{nome}» ({perche:?}) non si presenta più su\n\
             {source:?}.\n\
             \n\
             Se è stata **riparata**, questa riga va tolta da\n\
             `divergenze_dichiarate` — ed è il momento in cui una divergenza\n\
             smette di essere silenziosa. Se invece si è solo spostata, va\n\
             riscritta, perché così com'è dice il falso.\n\
             \n\
             Il modello, adesso: {doc:#?}"
        );
    }
}

/// Il testo di tutti gli inline, concatenato: è la lettura più cruda del
/// modello, e serve a dire «di quel costrutto non è rimasto che il testo».
fn testo_piatto(d: &DocumentModel) -> String {
    fn giro(inlines: &[Inline], out: &mut String) {
        for i in inlines {
            match i {
                Inline::Text(t) | Inline::Code(t) => out.push_str(t),
                Inline::Emph(dentro) | Inline::Strong(dentro) => giro(dentro, out),
                Inline::TagRef { name, .. } => {
                    out.push('#');
                    out.push_str(name);
                }
                Inline::Link { label, .. } => giro(label.as_deref().unwrap_or(&[]), out),
                Inline::Custom { .. } => {}
            }
        }
    }
    let mut out = String::new();
    for b in &d.body {
        if let Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } = b {
            giro(inlines, &mut out);
        }
    }
    out
}

fn nomi_dei_kind(d: &DocumentModel) -> BTreeSet<String> {
    let mut o = Osservato::default();
    osserva_blocchi(&d.body, &mut o);
    o.kind
}

// ---------------------------------------------------------------------------
// Il fuzzer: le stesse proprietà, con l'ingresso generato
// ---------------------------------------------------------------------------
//
// Perché non `cargo-fuzz`. È la scelta ovvia, e non è questa, per la ragione che
// questa seduta ha già in casa: libFuzzer vuole nightly, un crate fuori dal
// workspace e una macchina che lo esegua a lungo. Diventerebbe il gemello
// dell'inquilino di questa stessa voce — il presidio della §8.4, che c'è e non
// gira — e un presidio che non gira è peggio di uno che non c'è, perché
// qualcuno crede che ci sia. L'esplorazione guidata dalla copertura resta
// dichiarata fuori, e va con la macchina del banco delle prestazioni, cioè con
// la seconda metà del §17.1.
//
// Cosa questo fuzzer è, allora: una **rete di regressione deterministica**.
// Semenza il corpus, mutazioni con un nome, un generatore scritto a mano — e
// scritto a mano perché un fallimento deve essere riproducibile da un seme
// stampato, che è la stessa ragione per cui questo repo si è scritto il parser
// di date invece di prendere `chrono`.
//
// **Cosa pretende, e cosa no.** Chiama `nessuno_span_manda_in_panico_chi_lo_usa`
// e non la suite piena: su un ingresso costruito per essere ostile il provider
// eredita da comrak delle incoerenze di `sourcepos` che sono difetti veri e la
// cui riparazione è una decisione (vedi le divergenze dichiarate qui sopra).
// Pretenderle risolte da qui avrebbe un effetto solo — un fuzzer rosso, che
// qualcuno disattiva — e ne perderebbe quello per cui il §17.1 lo chiede: che
// nessun documento, per quanto storto, faccia panicare chi lo apre.
//
// Due limiti, dichiarati:
//
// - da questa porta passa **solo UTF-8 valido**, perché `parse` prende testo. I
//   byte non decodificabili non sono un buco lasciato aperto: il provider li
//   rifiuta per contratto, e la proprietà che lo dice è
//   `un_provider_testuale_rifiuta_i_byte`;
// - il seme è **fisso**, quindi questa è una rete di regressione e non
//   un'esplorazione: la stessa corsa a ogni push. Cercare davvero è alzare
//   `FUBMD_FUZZ_CASI` a mano — con tre milioni di casi la corsa dura una
//   quindicina di secondi — oppure è il lavoro di libFuzzer, che sta con la
//   macchina della seconda metà del §17.1.

/// Un xorshift64*, dodici righe e nessuna dipendenza.
struct Caso64(u64);

impl Caso64 {
    fn nuovo(seme: u64) -> Self {
        // Lo zero è il punto fisso di xorshift: un seme nullo darebbe sempre 0.
        Caso64(if seme == 0 { 0x9E3779B97F4A7C15 } else { seme })
    }

    fn prossimo(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }

    fn fino_a(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.prossimo() % n as u64) as usize
        }
    }

    /// Un confine di carattere di `s`, scelto a caso. Serve perché una mutazione
    /// deve produrre UTF-8 valido: tagliare a metà di un carattere non prova il
    /// parser, prova `String::from_utf8`.
    fn confine(&mut self, s: &str) -> usize {
        let mut i = self.fino_a(s.len() + 1);
        while !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    }
}

/// I byte ostili che si infilano dentro una sorgente. Sono quelli che nei vault
/// veri ci sono e che nessuno scrive di proposito.
const OSTILI: [&str; 10] = [
    "\u{feff}", // un BOM in mezzo, non in testa
    "\r",       // un ritorno a capo nudo
    "\0",       // un NUL, che è UTF-8 valido e non se lo aspetta nessuno
    "\u{301}",  // un accento combinante senza la lettera davanti
    "🎉",       // fuori dal BMP: quattro byte, un carattere
    "^",        // il marcatore d'ancora, fuori posto
    "]]",       // una chiusura senza apertura
    "![[",      // un'apertura senza chiusura
    "|",        // il separatore di tabella e di alias
    "\t",       // una tabulazione, che in markdown conta come indentazione
];

/// Le mutazioni, **con un nome**: un fallimento deve dire cosa è stato fatto
/// alla sorgente, non solo che è successo.
fn muta(rng: &mut Caso64, semi: &[&'static str]) -> (&'static str, String) {
    let base = semi[rng.fino_a(semi.len())];
    match rng.fino_a(7) {
        0 => {
            let i = rng.confine(base);
            ("troncato", base[..i].to_string())
        }
        1 => ("duplicato", format!("{base}{base}")),
        2 => {
            let altro = semi[rng.fino_a(semi.len())];
            let i = rng.confine(base);
            let j = rng.confine(altro);
            ("intrecciato", format!("{}{}", &base[..i], &altro[j..]))
        }
        3 => {
            let i = rng.confine(base);
            let ostile = OSTILI[rng.fino_a(OSTILI.len())];
            (
                "con un byte ostile in mezzo",
                format!("{}{}{}", &base[..i], ostile, &base[i..]),
            )
        }
        4 => {
            let i = rng.confine(base);
            let j = rng.confine(base);
            let (a, b) = if i <= j { (i, j) } else { (j, i) };
            (
                "con un pezzo tolto",
                format!("{}{}", &base[..a], &base[b..]),
            )
        }
        5 => {
            let ostile = OSTILI[rng.fino_a(OSTILI.len())];
            (
                "annidato profondo",
                format!("{}{base}", ostile.repeat(1 + rng.fino_a(64))),
            )
        }
        _ => {
            let i = rng.confine(base);
            (
                "con una riga lunghissima",
                format!("{}{}\n{}", &base[..i], "a".repeat(4096), &base[i..]),
            )
        }
    }
}

/// Quanti casi, e da quale seme. I due valori sono **fissi**, ed è il punto: la
/// stessa corsa a ogni push, su tre sistemi operativi, senza un rosso che
/// dipende da quando lo si è lanciato.
///
/// Si alzano dall'ambiente per la corsa lunga a mano
/// (`FUBMD_FUZZ_CASI=2000000 cargo test -p fubmd-format-markdown --test il_corpus`),
/// che è ciò che si fa quando si vuole **cercare** invece di presidiare.
fn quanti_casi() -> (usize, u64) {
    let casi = std::env::var("FUBMD_FUZZ_CASI")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20_000);
    let seme = std::env::var("FUBMD_FUZZ_SEME")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0x4675_6D4D_4420_3031);
    (casi, seme)
}

#[test]
fn nessuna_mutazione_del_corpus_rompe_una_proprieta() {
    let (casi, seme) = quanti_casi();
    let p = provider();
    let semi: Vec<&'static str> = corpus().iter().map(|c| c.source).collect();
    let mut rng = Caso64::nuovo(seme);
    let mut modelli = 0usize;

    for n in 0..casi {
        let (mutazione, source) = muta(&mut rng, &semi);
        let esito = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            conformita::nessuno_span_manda_in_panico_chi_lo_usa(&p, &source, &ctx())
        }));
        match esito {
            Ok(verificato) => modelli += usize::from(verificato),
            Err(_) => panic!(
                "caso {n} di {casi} — mutazione «{mutazione}» — ha rotto una\n\
                 proprietà. Il panico vero è stampato qui sopra.\n\
                 \n\
                 Per rifarlo esattamente:\n\
                 FUBMD_FUZZ_SEME={seme} FUBMD_FUZZ_CASI={} cargo test -p \
                 fubmd-format-markdown --test il_corpus -- nessuna_mutazione\n\
                 \n\
                 La sorgente, byte per byte: {source:?}",
                n + 1
            ),
        }
    }

    // Un fuzzer che genera solo sorgenti rifiutate non prova niente: sta
    // verificando `Err`, non le proprietà.
    assert!(
        modelli * 2 > casi,
        "su {casi} mutazioni solo {modelli} hanno prodotto un modello. Il\n\
         generatore sta producendo quasi solo sorgenti rifiutate, e le proprietà\n\
         non le sta verificando quasi mai."
    );
}
