//! Il corpus dei costrutti, e il fuzzer: **un presidio con due sorgenti
//! d'ingresso** (§17.1).
//!
//! # Cosa questo file NON chiede
//!
//! Non chiede «comrak è conforme a CommonMark». Non è una proprietà di Fub, e
//! asserirla renderebbe questa suite rossa il giorno in cui comrak **corregge**
//! un bug. Chiede l'altra cosa, che è di Fub e che finora nessuno chiedeva:
//! **ciò che il modello dice del documento è vero rispetto ai byte del file.**
//!
//! Le proprietà stanno in [`fub_sdk::testing::conformance`] e non qui, perché
//! sono di un `FormatProvider` **qualunque**: un secondo provider (org-mode,
//! AsciiDoc, il canvas) le eredita senza riscriverle, e il criterio è quello
//! della [0059](../../../docs/decisions/0180-compatibilita-wit-additiva.md)
//! — il soggetto della garanzia decide dove sta il presidio. Qui sta l'**ingresso**,
//! che è markdown e quindi di questo crate. Fino a oggi la sezione
//! `FormatProvider` del banco aveva due proprietà e **nessun cliente**, cioè era
//! esattamente ciò che la [0054](../../../docs/decisions/0196-test-e-artefatti-generati.md)
//! dichiara vietato: *«una suite di conformità che nessuna implementazione vera
//! passa non è una suite, è un'opinione»*.
//!
//! # Perché il costo di questa voce cresceva con l'attesa, e adesso no
//!
//! Il §17.1 lo dice così: «ogni sintassi nuova è un caso in più da scrivere a
//! posteriori». Il costo non cresce perché scrivere il caso sia caro — cresce
//! perché **nessuno si accorge che il corpus non è cresciuto**. Quindi il corpus
//! non è un elenco su cui si itera ([0056](../../../docs/decisions/0196-test-e-artefatti-generati.md)):
//! si **compare**, in tre direzioni, con altrettante sorgenti che non sono lui.
//!
//! 1. le varianti di `Block` e `Inline`, estratte dal sorgente del contratto;
//! 2. i `custom_kind` del registro, estratti dallo stesso;
//! 3. le sintassi che il provider **dichiara** in `capabilities()`.
//!
//! Un costrutto nuovo che nessun caso esercita fa diventare rosso questo file, e
//! da lì in poi il costo lo paga chi aggiunge la sintassi, nel giro in cui la
//! aggiunge.
//!
//! # Le sorgenti stanno altrove, e il perché conta
//!
//! I byte del corpus stanno in [`crate::corpus`], un modulo condiviso, da quando
//! i clienti sono due: questo file chiede **cosa il modello dice** di quelle
//! sorgenti, `transfer_e2e.rs` chiede **cosa il trasferimento ne fa** — gli
//! stessi byte che escono da un vault e rientrano in un altro. Un modulo sotto
//! `tests/` viene compilato dentro ciascun binario che lo dichiara, quindi le due
//! suite vedono per costruzione lo stesso elenco: non c'è il modo di fallimento
//! in cui uno dei due corpus cresce e l'altro no.
//!
//! # Le divergenze sono dichiarate, non scoperte
//!
//! Un corpus serve anche — soprattutto — a dire **dove il modello e il file non
//! sono d'accordo**. Ogni caso sta in [`divergenze_dichiarate`], una per riga,
//! con la sua ragione: la stessa forma dell'allowlist della
//! [0059](../../../docs/decisions/0180-compatibilita-wit-additiva.md).
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
//! Sul corpus curato si chiede tutto ([`conformance::Claim::Coherence`]); sulle
//! mutazioni generate si chiede solo ciò la cui violazione fa **panicare o
//! scrivere alla cieca** ([`conformance::Claim::SliceOnly`]), che è
//! esattamente ciò che il §17.1 chiede al fuzzing — *«un parser che pania è un
//! vault che non si apre»*, dove la casella che lo chiede è il capitolo 5.3 di
//! `FEATURES.md`. La ragione della differenza sta nel doc di
//! [`conformance::Claim`], e il caso che l'ha imposta è nella lista delle
//! divergenze: il termine di una definition list «stretta» ha uno span di **un
//! byte**, su markdown perfettamente normale, e finché non è deciso *cosa sia*
//! quello span la coerenza non è una cosa che si possa pretendere.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget, Span};
use fub_abi::options::syntax;
use fub_format_markdown::MarkdownProvider;
use fub_sdk::testing::conformance;
use serde_json::{json, Value};

mod corpus;

use crate::corpus::{corpus, divergent, how_many_cases, mutate, seed, Case64};

/// Il sorgente del contratto, da cui si estraggono le tre sorgenti di verità del
/// confronto.
///
/// Arriva per `include_str!` e non per path a runtime: se `model.rs` si sposta,
/// questo file **non compila** — invece di passare avendo compareto il corpus
/// con un elenco vuoto. È il gesto della
/// [0059](../../../docs/decisions/0180-compatibilita-wit-additiva.md).
const CONTRATTO: &str = include_str!("../../fub-abi/src/model.rs");

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
// Le proprietà, su ogni voce del corpus
// ---------------------------------------------------------------------------

#[test]
fn every_corpus_entry_produces_a_model_that_tells_the_truth() {
    let p = provider();
    let mut verified_count = 0;
    for c in corpus() {
        let valid = std::panic::catch_unwind(|| {
            conformance::a_model_tells_the_truth_about_the_source(&p, c.source, &ctx())
        })
        .unwrap_or_else(|_| {
            panic!(
                "il caso `{}` ({:?}) ha rotto una proprietà",
                c.name, c.source
            )
        });
        assert!(
            valid,
            "il caso `{}` ({:?}) è stato **rifiutato** dal provider.\n\
             Un corpus curato è fatto di documenti che si aprono: se questo non si\n\
             apre, o la sorgente è sbagliata o il provider ha smesso di accettare\n\
             qualcosa che accettava.",
            c.name, c.source
        );
        verified_count += 1;
    }
    assert!(
        verified_count >= 80,
        "il corpus ha verificato {verified_count} casi su ottanta: un corpus che si\n\
         svuota passa sempre, quindi la soglia è il conteggio di oggi — cresce con\n\
         lui, e scende solo in un commit che dice perché."
    );
}

#[test]
fn the_format_respects_the_contract_without_input() {
    // Le due che c'erano dalla 0054 e che nessuno chiamava.
    conformance::a_format_respects_the_contract(&provider());
}

// ---------------------------------------------------------------------------
// La copertura, in tre direzioni
// ---------------------------------------------------------------------------

/// Il nome della variante di [`Block`], come sta scritto nel contratto.
///
/// Il `match` è **esaustivo**: una variante nuova non compila finché qualcuno
/// non le dà un nome qui, e da quel momento la direzione «il contratto ne ha una
/// che il corpus non produce» la vede.
fn block_name(b: &Block) -> &'static str {
    match b {
        Block::Heading { .. } => "Heading",
        Block::Paragraph { .. } => "Paragraph",
        Block::List { .. } => "List",
        Block::CodeBlock { .. } => "CodeBlock",
        Block::Quote { .. } => "Quote",
        Block::ThematicBreak { .. } => "ThematicBreak",
        Block::ReferenceDefinition { .. } => "ReferenceDefinition",
        Block::Custom { .. } => "Custom",
        Block::Table { .. } => "Table",
    }
}

/// Il nome della variante di [`Inline`]. Esaustivo per la stessa ragione.
fn inline_name(the: &Inline) -> &'static str {
    match the {
        Inline::Text(_) => "Text",
        Inline::Emph(_) => "Emph",
        Inline::Strong(_) => "Strong",
        Inline::Superscript(_) => "Superscript",
        Inline::Strikethrough(_) => "Strikethrough",
        Inline::Code(_) => "Code",
        Inline::Link { .. } => "Link",
        Inline::TagRef { .. } => "TagRef",
        Inline::Custom { .. } => "Custom",
        Inline::HardBreak => "HardBreak",
        Inline::SoftBreak => "SoftBreak",
    }
}

/// Ciò che il corpus, parsato, produce davvero: nomi di variante e
/// `custom_kind`.
#[derive(Default)]
struct Observed {
    blocks: BTreeSet<String>,
    inlines_set: BTreeSet<String>,
    kinds: BTreeSet<String>,
    syntaxes: BTreeSet<String>,
}

fn observe_corpus() -> Observed {
    let mut or = Observed::default();
    for c in corpus() {
        let doc = parse(c.source);
        if !doc.frontmatter.is_empty() {
            or.syntaxes.insert(syntax::FRONTMATTER.to_string());
        }
        if !doc.tags.is_empty() {
            or.syntaxes.insert(syntax::TAGS.to_string());
        }
        for the in &doc.links {
            if matches!(the.target, LinkTarget::Wiki { .. }) {
                or.syntaxes.insert(syntax::WIKILINKS.to_string());
            }
            if the.embed {
                or.syntaxes.insert(syntax::EMBEDS.to_string());
            }
        }
        observe_blocks(&doc.body, &mut or);
    }
    or
}

fn observe_blocks(blocks: &[Block], or: &mut Observed) {
    for b in blocks {
        or.blocks.insert(block_name(b).to_string());
        if let Block::Custom { custom_kind, .. } = b {
            or.kinds.insert(custom_kind.clone());
            match custom_kind.as_str() {
                "callout" => or.syntaxes.insert(syntax::CALLOUTS.to_string()),
                "footnote-definition" => or.syntaxes.insert(syntax::FOOTNOTES.to_string()),
                "definition-list" => or.syntaxes.insert(syntax::DEFINITION_LISTS.to_string()),
                _ => false,
            };
        }
        match b {
            Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => {
                observe_inlines(inlines, or)
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                observe_blocks(blocks, or)
            }
            Block::List { items, .. } => {
                for it in items {
                    observe_blocks(&it.blocks, or);
                }
            }
            Block::Table { head, rows, .. } => {
                for row in head.iter().chain(rows.iter()) {
                    for cell in &row.cells {
                        observe_inlines(&cell.inlines, or);
                    }
                }
            }
            Block::CodeBlock { .. }
            | Block::ThematicBreak { .. }
            | Block::ReferenceDefinition { .. } => {}
        }
    }
}

fn observe_inlines(inlines: &[Inline], or: &mut Observed) {
    for the in inlines {
        or.inlines_set.insert(inline_name(the).to_string());
        match the {
            Inline::Custom { custom_kind, .. } => {
                or.kinds.insert(custom_kind.clone());
                if custom_kind == "footnote-reference" {
                    or.syntaxes.insert(syntax::FOOTNOTES.to_string());
                }
            }
            Inline::Emph(children)
            | Inline::Strong(children)
            | Inline::Superscript(children)
            | Inline::Strikethrough(children) => observe_inlines(children, or),
            Inline::Text(_)
            | Inline::Code(_)
            | Inline::Link { .. }
            | Inline::TagRef { .. }
            | Inline::HardBreak
            | Inline::SoftBreak => {}
        }
    }
}

#[test]
fn the_corpus_produces_every_model_variant() {
    let or = observe_corpus();
    compare(
        "le varianti di `Block`",
        &enum_variants(CONTRATTO, "Block"),
        &or.blocks,
        &BTreeSet::new(),
    );
    compare(
        "le varianti di `Inline`",
        &enum_variants(CONTRATTO, "Inline"),
        &or.inlines_set,
        &BTreeSet::new(),
    );
}

/// I `custom_kind` che il **provider markdown** non emette, e la ragione.
///
/// Non è una lacuna del corpus: è dove passa il confine del §3.1
/// ([0017](../../../docs/decisions/0182-provider-e-porte-generiche.md)).
/// Tre di questi kind li innesta una `SyntaxRule` registrata — `MathRule`,
/// `DiagramRule`, `HighlightRule` in `fub-features/src/blocks.rs` — e un
/// provider che li producesse da sé rimetterebbe in piedi le due categorie di
/// estensioni che quella decisione ha rifiutato. Il loro corpus sta con le
/// regole, in `fub-features/tests/custom_blocks_e2e.rs`.
///
/// `block` è un'altra specie: è il **fallback** di `convert_block`, e con
/// l'insieme di estensioni che `build_options` accende non risulta
/// raggiungibile. Sta qui, non tolto: il giorno in cui si accende un'estensione
/// nuova di comrak diventa la rete che raccoglie ciò che nessuno ha mappato, e
/// toglierlo perché «non serve» vorrebbe dire farlo diventare un `panic` o un
/// blocco perso.
fn kind_not_of_the_provider() -> BTreeSet<String> {
    ["math", "diagram", "highlight", "block"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[test]
fn the_corpus_produces_every_custom_kind_from_the_registry() {
    let or = observe_corpus();
    compare(
        "i `custom_kind` del registro del contratto",
        &module_constants(CONTRATTO, "custom_kind"),
        &or.kinds,
        &kind_not_of_the_provider(),
    );
}

#[test]
fn the_corpus_exercises_every_syntax_the_provider_declares() {
    let or = observe_corpus();
    let declared: BTreeSet<String> = provider()
        .capabilities()
        .syntax
        .keys()
        .map(|k| k.to_string())
        .collect();
    compare(
        "le sintassi dichiarate in `capabilities()`",
        &declared,
        &or.syntaxes,
        &BTreeSet::new(),
    );
}

/// Il confronto nei due versi, che è la forma canonica di questo repo
/// ([0056](../../../docs/decisions/0196-test-e-artefatti-generati.md)).
///
/// `attesi` viene da una sorgente che non è il corpus; `osservati` viene dal
/// corpus parsato; `scusati` è l'elenco chiuso di ciò che il corpus non può
/// produrre, con la ragione scritta accanto alla sua definizione.
fn compare(
    which: &str,
    expected: &BTreeSet<String>,
    observed: &BTreeSet<String>,
    excused: &BTreeSet<String>,
) {
    assert!(
        !expected.is_empty(),
        "l'elenco atteso di {which} è **vuoto**: la sorgente da cui si estrae non\n\
         ha risposto niente, e un confronto contro il vuoto passa sempre."
    );

    let missing: Vec<&String> = expected
        .difference(observed)
        .filter(|a| !excused.contains(*a))
        .collect();
    assert!(
        missing.is_empty(),
        "il corpus non esercita {which}: {missing:?}.\n\
         Aggiungere il caso costa una riga; non aggiungerlo costa che nessuno se\n\
         ne accorga — che è il modo in cui il costo di questa voce cresceva con\n\
         l'attesa. Se il costrutto non è del provider, la sua riga va nell'elenco\n\
         degli scusati **con la ragione**, non qui."
    );

    let of_too: Vec<&String> = observed.difference(expected).collect();
    assert!(
        of_too.is_empty(),
        "il corpus produce {which} che la sorgente non conosce: {of_too:?}.\n\
         O il nome è cambiato nel contratto e qui è rimasto quello vecchio, o\n\
         l'estrattore non lo vede più."
    );

    let useless_excused: Vec<&String> = excused
        .iter()
        .filter(|s| observed.contains(*s) || !expected.contains(*s))
        .collect();
    assert!(
        useless_excused.is_empty(),
        "l'elenco degli scusati di {which} nomina {useless_excused:?}, che o il\n\
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
fn enum_variants(source: &str, name: &str) -> BTreeSet<String> {
    let mut outside = true;
    let mut depth = 0usize;
    let mut variants = BTreeSet::new();
    let opening = format!("pub enum {name} {{");
    for row in source.lines() {
        let t = row.trim();
        if outside {
            if t == opening {
                outside = false;
                depth = 1;
            }
            continue;
        }
        if depth == 1 {
            if let Some(first) = t.chars().next() {
                if first.is_ascii_uppercase() {
                    let ident: String = t
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || *c == '_')
                        .collect();
                    variants.insert(ident);
                }
            }
        }
        // Le graffe si contano **dopo** aver deciso se la riga è una variante:
        // `Heading {` apre a profondità 1 ed è la variante, non il suo campo.
        if t.starts_with("///") || t.starts_with("//") {
            continue;
        }
        depth += t.matches('{').count();
        depth = depth.saturating_sub(t.matches('}').count());
        if depth == 0 {
            break;
        }
    }
    variants
}

/// I **valori** delle `pub const … : &str` di un modulo del contratto.
///
/// Sono i valori e non i nomi perché è il valore che compare in un
/// `Block::Custom`: il registro dichiara `CALLOUT = "callout"`, e nel modello
/// c'è `"callout"`.
fn module_constants(source: &str, name: &str) -> BTreeSet<String> {
    let mut outside = true;
    let mut values = BTreeSet::new();
    let opening = format!("pub mod {name} {{");
    for row in source.lines() {
        let t = row.trim();
        if outside {
            if t == opening {
                outside = false;
            }
            continue;
        }
        if t == "}" {
            break;
        }
        if let Some(rest) = t.strip_prefix("pub const ") {
            if let Some((_, value)) = rest.split_once('=') {
                let v = value.trim().trim_end_matches(';').trim();
                if let Some(within) = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
                    values.insert(within.to_string());
                }
            }
        }
    }
    values
}

/// Un estrattore che torna a vuoto fa passare ogni confronto, quindi si prova
/// che veda: sono i «test del test» della
/// [0059](../../../docs/decisions/0180-compatibilita-wit-additiva.md).
#[test]
fn the_extractor_sees_the_contract() {
    let blocks = enum_variants(CONTRATTO, "Block");
    assert!(
        blocks.contains("Heading") && blocks.contains("Table") && blocks.len() >= 8,
        "l'estrattore non trova le varianti di `Block`: {blocks:?}"
    );
    // I campi non sono varianti: `level`, `inlines`, `span` cominciano minuscoli
    // e nessuno di loro deve entrare.
    assert!(
        !blocks.iter().any(|v| v.is_empty() || v == "Span"),
        "l'estrattore ha preso qualcosa che non è una variante: {blocks:?}"
    );

    let inline = enum_variants(CONTRATTO, "Inline");
    assert!(
        inline.contains("Text") && inline.contains("TagRef") && inline.len() >= 7,
        "l'estrattore non trova le varianti di `Inline`: {inline:?}"
    );

    let kind = module_constants(CONTRATTO, "custom_kind");
    assert!(
        kind.contains("callout") && kind.contains("definition-term") && kind.len() >= 11,
        "l'estrattore non trova i `custom_kind` del registro: {kind:?}"
    );

    // Un enum che non c'è dà l'insieme vuoto, ed è il caso che `compare`
    // rifiuta esplicitamente: senza quel rifiuto un nome sbagliato qui sopra
    // renderebbe verde ogni confronto.
    assert!(enum_variants(CONTRATTO, "NonEsiste").is_empty());
    assert!(module_constants(CONTRATTO, "non_esiste").is_empty());
}

// ---------------------------------------------------------------------------
// Le perdite dichiarate
// ---------------------------------------------------------------------------

/// In che modo il modello e il file **non sono d'accordo**.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Reason {
    /// Il modello la rappresenta, e chi la legge a valle non la trova dove la
    /// cerca.
    RepresentedButUnreachable,
    /// Nasce dalla forma dei byte, e la conseguenza è che due file identici a
    /// schermo danno due modelli diversi.
    DependsOnBytes,
}

/// Dove il modello e il file **non sono d'accordo**, una riga per divergenza.
///
/// Ogni riga è un'affermazione su come le cose stanno **oggi**, non su come
/// devono stare: il predicato descrive la divergenza, e il giorno in cui qualcuno
/// la ripara la riga diventa rossa e va tolta. È l'unico modo che conosco di far
/// smettere una divergenza di essere silenziosa senza fermare il lavoro per
/// ripararla adesso — e la ragione per cui questa forma è quella giusta invece di
/// una riga di prosa in un documento è la §16.8: una prosa non diventa rossa.
///
/// Le **sorgenti** non stanno qui ma in [`crate::corpus::divergenti`], perché le
/// vuole anche `transfer_e2e.rs`: là entrano in un vault come note qualunque, e
/// provano la tesi su cui poggia il round-trip — una divergenza fra il modello e
/// il file non è una perdita nel trasferimento, perché i byte che il
/// trasferimento copia non vengono dal modello. Il nome è la chiave che lega le
/// due metà, e [`le_divergenze_sono_quelle_dichiarate`] compare i due elenchi
/// **nei due versi**: un nome senza predicato o un predicato senza nome è rosso.
///
/// # Perché il predicato riceve anche la sorgente
///
/// Perché separare il nome dai byte ha aperto un modo di fallire che prima non
/// c'era: finché stavano nella stessa tupla, un predicato non poteva finire
/// accoppiato a una sorgente diversa dalla sua. Adesso il legame è una stringa, e
/// un predicato **negativo** o **generico** — `!d.text.contains("didascalia")`,
/// `d.frontmatter.is_empty()` — resterebbe verde su una sorgente qualunque, cioè
/// la divergenza tornerebbe silenziosa senza che nulla diventi rosso.
///
/// La sorgente nel predicato è ciò che rende la divergenza esprimibile per quello
/// che è: non «il modello dice X» ma **«il file dice X e il modello dice Y»**. E
/// [`nessuna_divergenza_e_vera_su_un_documento_qualunque`] chiude il cerchio
/// pretendendo che ogni predicato sia **falso** su dei documenti di controllo: un
/// predicato che passa su `""` non sta descrivendo una divergenza, sta descrivendo
/// il vuoto.
#[allow(clippy::type_complexity)]
fn declared_divergences() -> Vec<(&'static str, Reason, fn(&DocumentModel, &str) -> bool)> {
    vec![
        (
            "uno slug vuoto è un'ancora che il contratto rifiuterebbe",
            Reason::RepresentedButUnreachable,
            |d, _| d.body.first().map(Block::anchor) == Some(Some("")),
        ),
        (
            "l'alt di un'immagine non entra nel testo indicizzato",
            Reason::RepresentedButUnreachable,
            // La negazione da sola è vera su ogni documento che non dice
            // «didascalia», cioè su tutti tranne uno: la divergenza è che la parola
            // **c'è nel file** e non nel testo che si indicizza.
            |d, src| src.contains("didascalia") && !d.text.contains("didascalia"),
        ),
        (
            "la sintassi grezza di un embed entra nel testo indicizzato",
            Reason::RepresentedButUnreachable,
            |d, _| d.text.contains("![["),
        ),
        (
            // Non è markdown ostile: è la forma «stretta» della definition list,
            // quella senza riga vuota fra il termine e la definizione. Il termine
            // ha uno span di **un byte** — il primo carattere — quindi non è
            // indirizzabile, un embed del termine ritaglia una lettera, e un tag
            // scritto nel termine esce dallo span del blocco che lo contiene. È
            // il caso che ha costretto a distinguere le due pretese di
            // `conformance::Claim`: la coerenza non si può pretendere su
            // qualunque ingresso finché questo non è riparato.
            "il termine di una definition list stretta ha uno span di un byte",
            Reason::DependsOnBytes,
            |d, _| {
                fn first_term(b: &[Block]) -> Option<Span> {
                    b.iter().find_map(|b| match b {
                        Block::Custom {
                            custom_kind,
                            blocks,
                            span,
                            ..
                        } if custom_kind == "definition-term" => {
                            Some(blocks.first().map(Block::span).unwrap_or(*span))
                        }
                        Block::Custom { blocks, .. } => first_term(blocks),
                        _ => None,
                    })
                }
                first_term(&d.body) == Some(Span::new(0, 1))
            },
        ),
        (
            // La forma **larga** invece è giusta, e sta accanto alla stretta
            // perché è ciò che rende la stretta un difetto e non una scelta.
            "e la forma larga della stessa definition list ce l'ha giusto",
            Reason::DependsOnBytes,
            |d, _| {
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
            Reason::DependsOnBytes,
            // La divergenza è un **confronto fra il file e il modello**, e va scritta
            // così: il file ha tre righe terminate da `\n` — intestazione,
            // separatore, una riga di dati — e la tabella nel modello ne ha due. Un
            // `rows.len() > 1` da solo sarebbe vero su qualunque tabella a due righe
            // scritta bene, cioè avrebbe smesso di parlare del `\r`.
            |d, src| {
                src.matches('\n').count() == 3
                    && d.body.iter().any(|b| match b {
                        Block::Table { rows, .. } => rows.len() == 2,
                        _ => false,
                    })
            },
        ),
    ]
}

#[test]
fn the_divergences_are_the_declared_ones() {
    let declared = declared_divergences();
    let sources = divergent();
    assert!(
        declared.len() >= 6,
        "l'elenco delle divergenze si è svuotato: {} righe. Se sono\n\
         state riparate è una bella notizia e va scritta dove la riparazione sta\n\
         — e allora si abbassa questo numero **nello stesso commit**, che è ciò\n\
         che lo tiene una soglia e non un desiderio; se è l'elenco che si è\n\
         rotto, questo file ha smesso di presidiare la cosa per cui esiste.\n\
         L'ultima scesa: l'ancora esplicita di un heading è diventata\n\
         raggiungibile dall'albero — `Block::Heading.explicit_anchor` porta\n\
         l'id scritto, com'è scritto, e `serialize` lo riscrive — e la sua\n\
         sorgente («heading con ancora esplicita», `## Titolo ^Mio-ID`) sta\n\
         adesso nel corpus curato, dove le proprietà la pretendono.",
        declared.len()
    );

    // Le due metà si tengono per il nome, quindi il nome dev'essere una chiave:
    // due righe omonime si accoppierebbero con la stessa sorgente, e una delle
    // due divergenze smetterebbe di essere verificata senza diventare rossa.
    let with_predicate: BTreeSet<&str> = declared.iter().map(|(n, _, _)| *n).collect();
    let with_source: BTreeSet<&str> = sources.iter().map(|c| c.name).collect();
    assert_eq!(
        with_predicate.len(),
        declared.len(),
        "due divergenze dichiarate portano lo stesso nome"
    );
    assert_eq!(
        with_source.len(),
        sources.len(),
        "due sorgenti divergenti portano lo stesso nome"
    );

    let without_source: Vec<&&str> = with_predicate.difference(&with_source).collect();
    assert!(
        without_source.is_empty(),
        "queste divergenze hanno un predicato e nessuna sorgente in\n\
         `corpus::divergenti()`: {without_source:?}.\n\
         Il nome è la chiave fra le due metà: senza la sorgente il predicato non\n\
         viene mai valutato, e una divergenza che nessuno valuta è tornata a\n\
         essere silenziosa."
    );
    let without_predicate: Vec<&&str> = with_source.difference(&with_predicate).collect();
    assert!(
        without_predicate.is_empty(),
        "queste sorgenti stanno in `corpus::divergenti()` e nessuno dice **in che\n\
         modo** divergono: {without_predicate:?}.\n\
         Se la divergenza è stata riparata la sorgente va spostata nel corpus\n\
         curato, dove le proprietà la pretendono tutta; se non lo è, le manca la\n\
         riga che dice cosa succede."
    );

    for (name, reason, still_true) in declared {
        let source = sources
            .iter()
            .find(|c| c.name == name)
            .expect("il confronto nei due versi qui sopra lo garantisce")
            .source;
        let doc = parse(source);
        assert!(
            still_true(&doc, source),
            "the declared divergence \"{name}\" ({reason:?}) no longer appears on\n\
             {source:?}.\n\
             \n\
             Se è stata **riparata**, questa riga va tolta da\n\
             `declared_divergences` — and that is the moment when a divergence\n\
             smette di essere silenziosa. Se invece si è solo spostata, va\n\
             riscritta, perché così com'è dice il falso.\n\
             \n\
             Il modello, adesso: {doc:#?}"
        );
    }
}

/// La riparazione delle due divergenze dichiarate — «il barrato non arriva nel
/// modello» e «l'apice non arriva nel modello» — che stavano qui sopra e ora
/// stanno nel corpus curato, col nome «barrato» e «apice». L'apice e il barrato
/// arrivano come **due varianti distinte** ([`Inline::Superscript`] e
/// [`Inline::Strikethrough`]), non collassano in un unico stile né nel testo
/// piatto, e fanno il giro intero: parsa, serializza, riparsa, rende.
#[test]
fn superscript_and_strikethrough_are_distinct_constructs_that_round_trip() {
    let source = "~~barrato~~ e testo ^apice^ qui\n";
    let doc = parse(source);
    let inl: Vec<&Inline> = match &doc.body[0] {
        Block::Paragraph { inlines, .. } => inlines.iter().collect(),
        _ => panic!("atteso un paragrafo: {:?}", doc.body),
    };
    // Ognuno nel suo contenitore, con il suo testo: nessun collasso in uno
    // stile unico, in `Custom` o nel solo testo.
    assert!(
        inl.iter().any(|the| matches!(
            the,
            Inline::Strikethrough(kids) if kids.as_slice() == [Inline::Text("barrato".into())]
        )),
        "il barrato non è arrivato come `Strikethrough`: {inl:?}"
    );
    assert!(
        inl.iter().any(|the| matches!(
            the,
            Inline::Superscript(kids) if kids.as_slice() == [Inline::Text("apice".into())]
        )),
        "l'apice non è arrivato come `Superscript`: {inl:?}"
    );
    assert!(
        !inl.iter().any(|the| matches!(
            the,
            Inline::Emph(_) | Inline::Strong(_) | Inline::Custom { .. }
        )),
        "il barrato e l'apice non sono enfasi, forza né Custom: {inl:?}"
    );
    // E nessuno dei due è passato dall'escape hatch: il registro dei
    // `custom_kind` di questo documento è vuoto.
    assert!(
        kind_names(&doc).is_empty(),
        "i kind del documento: {:?}",
        kind_names(&doc)
    );
    // Il testo piatto conserva le parole — è quello che si legge.
    assert_eq!(flat_text(&doc), "barrato e testo apice qui");
    // La riscrittura riproduce la sintassi di partenza, costrutto per
    // costrutto, e il giro riparte da lì identico.
    let rewritten = provider().serialize(&doc).unwrap();
    assert_eq!(rewritten, source, "la riscrittura cambia il documento");
    assert_eq!(parse(&rewritten), doc, "il giro non è stabile");
    // La resa dà a ciascuno il suo elemento: `<del>` per il barrato, `<sup>`
    // per l'apice — due elementi, non uno stile.
    let html = provider()
        .render_html(&doc, &fub_abi::format::RenderOptions::default())
        .unwrap();
    assert!(html.contains("<del>barrato</del>"), "html: {html}");
    assert!(html.contains("<sup>apice</sup>"), "html: {html}");
}

/// I documenti di controllo: markdown senza niente di strano, più i due casi
/// degeneri.
///
/// Servono a una cosa sola, e la vale: un predicato di divergenza che passa su
/// uno di questi non sta descrivendo una divergenza. `!d.text.contains("x")` è
/// vero su un documento vuoto; `d.frontmatter.is_empty()` è vero su quasi tutti.
/// Sono i due modi in cui una riga dell'elenco può diventare verde per sempre
/// **senza** che nessuno l'abbia riparata — ed è precisamente il fallimento che
/// l'elenco esiste per impedire.
const CHECKS: [&str; 5] = [
    "",
    "# Titolo\n\nUn paragrafo con [[Nota]], #tag e `codice`.\n",
    "- [ ] una task\n- [x] un'altra\n",
    "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n",
    "---\ntitolo: X\n---\n\n# Corpo ^abc\n",
];

#[test]
fn no_divergence_is_true_on_an_arbitrary_document() {
    for (name, reason, still_true) in declared_divergences() {
        for check in CHECKS {
            let doc = parse(check);
            assert!(
                !still_true(&doc, check),
                "the predicate for divergence \"{name}\" ({reason:?}) is also true on\n\
                 un documento di controllo: {check:?}.\n\
                 \n\
                 Vuol dire che non descrive **quella** divergenza ma una proprietà\n\
                 che quasi ogni documento ha — tipicamente una negazione\n\
                 (`!d.text.contains(…)`) o un campo vuoto (`frontmatter.is_empty()`).\n\
                 Da quando le sorgenti stanno in `corpus::divergenti()` e il legame è\n\
                 il nome, un predicato così resta verde anche accoppiato alla\n\
                 sorgente sbagliata: la divergenza smette di essere verificata senza\n\
                 che nulla diventi rosso.\n\
                 \n\
                 Il predicato riceve anche la sorgente: la forma che funziona è\n\
                 «il file dice X **e** il modello dice Y», non «il modello dice Y»."
            );
        }
    }
}

/// **Ogni link scoperto in una qualunque sorgente del corpus porta il suo
/// contesto**, cioè la riga che il pannello dei backlink mostra sotto il nome.
///
/// È un **conto**, non un test per ramo, e la differenza è tutta qui: un test
/// per ramo prova i rami che c'erano il giorno in cui è stato scritto, e il
/// difetto era esattamente che il ramo `Paragraph` assegnava il contesto e gli
/// altri no. Questo conto guarda il corpus, e il corpus è già presidiato per
/// contenere **ogni variante di `Block`** ([`il_corpus_produce_ogni_variante_del_modello`]):
/// il giorno in cui `convert_block` cresce di un ramo che porta dei link, il
/// caso che lo esercita entra di là e questo diventa rosso di qua, senza che
/// nessuno debba ricordarsi di aggiungere un assert.
///
/// Un contesto **vuoto** non conta come contesto: `Some("")` occuperebbe il
/// campo dicendo niente, ed è il modo in cui questa riga resterebbe verde
/// riparando male.
///
/// # La pretesa è «se il blocco ha dell'altro», e va detto perché
///
/// Non «ogni link ha un contesto»: esiste un blocco che di testo non ne ha —
/// `![alt](f.png)` da solo in un paragrafo, dove l'alt non entra nel testo
/// indicizzato (è una divergenza dichiarata qui accanto) — e lì il contesto non
/// c'è, perché non c'è. La condizione si legge dalla **sorgente**, non dal
/// modello: il blocco, tolti i byte dei suoi link, deve avere ancora qualcosa
/// da dire. Ricostruire il testo del blocco dal modello sarebbe stata una
/// seconda implementazione di `convert_inlines`, cioè un presidio che si rompe
/// quando il parser cambia idea invece di quando sbaglia.
#[test]
fn every_corpus_link_carries_the_context_of_its_block() {
    let mut without: Vec<String> = Vec::new();
    let mut with_context = 0usize;
    let mut claimed = 0usize;
    for case in corpus() {
        let doc = parse(case.source);
        let contexts: BTreeMap<(usize, usize), Option<String>> = doc
            .links
            .iter()
            .map(|the| ((the.span.start, the.span.end), the.context.clone()))
            .collect();
        for (block, link) in inline_block_spans(&doc.body) {
            let context = contexts.get(&(link.start, link.end)).cloned().flatten();
            if let Some(c) = &context {
                with_context += 1;
                assert!(
                    !c.trim().is_empty(),
                    "«{}»: il link a {}..{} porta un contesto vuoto, che occupa il \
                     campo dicendo niente",
                    case.name,
                    link.start,
                    link.end
                );
            }
            // Il blocco, tolti i byte del link: se resta qualcosa, quel qualcosa
            // è il contesto che al link tocca.
            let within =
                &case.source[block.start.min(case.source.len())..block.end.min(case.source.len())];
            let rest: String = within
                .char_indices()
                .filter(|(the, _)| {
                    let absolute = block.start + the;
                    !(link.start..link.end).contains(&absolute)
                })
                .map(|(_, c)| c)
                .collect();
            if rest
                .trim_matches(|c: char| c.is_whitespace() || "#|>-*".contains(c))
                .is_empty()
            {
                continue;
            }
            claimed += 1;
            if context.is_none() {
                without.push(format!(
                    "  «{}»: link a {}..{}, nel blocco {}..{} che dice anche {:?}",
                    case.name, link.start, link.end, block.start, block.end, rest
                ));
            }
        }
    }
    assert!(
        without.is_empty(),
        "{} link nascono senza contesto pur stando in un blocco che ne ha uno da \
         dare:\n{}\n\n\
         Il contesto di un link è una **finestra** del testo del blocco che lo\n\
         contiene (la regola sta in `fub_abi::rules::snippet`), e si assegna in\n\
         `inlines_del_blocco` — l'unico ingresso agli inline di un\n\
         blocco. Un ramo di `convert_block` che chiami `convert_inlines`\n\
         direttamente salta quella regola, ed è il difetto che questo conto\n\
         presidia: la risposta non è aggiungere l'assegnazione nel ramo nuovo, è\n\
         farlo passare dall'ingresso che ce l'ha già.",
        without.len(),
        without.join("\n")
    );
    // I due test del test. Un corpus in cui nessun link stia in un blocco
    // parlante renderebbe la riga qui sopra vera per vacuità; e uno in cui
    // nessun link abbia contesto la renderebbe vera con un `context` sempre
    // `None`, che è precisamente ciò che si sta presidiando.
    assert!(
        claimed >= 6 && with_context >= 8,
        "il corpus pretende un contesto per {claimed} link e ne vede {with_context} \
         con contesto: troppo pochi perché questo conto provi qualcosa"
    );
}

/// Ogni link del modello, con lo span del **blocco** che lo contiene: è la
/// grana a cui il contesto si assegna.
///
/// Un blocco che porta blocchi (una citazione, una voce d'elenco, un callout)
/// non compare come contenitore: i suoi figli sì, uno per uno, ed è giusto — il
/// contesto di un link è il testo del blocco più vicino che ne porti, non
/// quello dell'involucro.
fn inline_block_spans(blocks: &[Block]) -> Vec<(Span, Span)> {
    fn inline(nodes: &[Inline], out: &mut Vec<Span>) {
        for n in nodes {
            match n {
                Inline::Emph(children)
                | Inline::Strong(children)
                | Inline::Superscript(children)
                | Inline::Strikethrough(children) => inline(children, out),
                Inline::Link { label, span, .. } => {
                    out.push(*span);
                    inline(label.as_deref().unwrap_or(&[]), out);
                }
                Inline::Text(_)
                | Inline::Code(_)
                | Inline::TagRef { .. }
                | Inline::Custom { .. }
                | Inline::HardBreak
                | Inline::SoftBreak => {}
            }
        }
    }
    fn from(nodes: &[Inline], block: Span, out: &mut Vec<(Span, Span)>) {
        let mut link = Vec::new();
        inline(nodes, &mut link);
        out.extend(link.into_iter().map(|the| (block, the)));
    }
    fn round(blocks: &[Block], out: &mut Vec<(Span, Span)>) {
        for b in blocks {
            match b {
                Block::Heading { inlines, span, .. } | Block::Paragraph { inlines, span, .. } => {
                    from(inlines, *span, out)
                }
                Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => round(blocks, out),
                Block::List { items, .. } => {
                    for the in items {
                        round(&the.blocks, out);
                    }
                }
                Block::Table { head, rows, .. } => {
                    for r in head.iter().chain(rows) {
                        for cell in &r.cells {
                            from(&cell.inlines, cell.span, out);
                        }
                    }
                }
                Block::CodeBlock { .. }
                | Block::ThematicBreak { .. }
                | Block::ReferenceDefinition { .. } => {}
            }
        }
    }
    let mut out = Vec::new();
    round(blocks, &mut out);
    out
}

/// **Un embed comincia dal suo punto esclamativo**, e finisce dove finiscono le
/// parentesi.
///
/// Il `!` è parte del riferimento, non del testo che lo precede: chi cancella o
/// riscrive un embed guidato dal suo span deve portarsi via anche quello.
///
/// # Questo presidio è **verde per costruzione**, e va detto
///
/// Le strade che leggono un `[[…]]` sono due — il nodo `WikiLink` di comrak e il
/// ripiego testuale di `find_embeds` — e davano due risposte diverse sullo
/// stesso `!`: il ripiego lo teneva dentro lo span, comrak lo guardava per
/// decidere `embed` e poi lo lasciava fuori. Nessuno dei due era rosso, perché
/// **le due strade non si incontrano su nessun ingresso**: comrak un `![[` non
/// lo riconosce affatto (lo lascia come testo, e lì entra il ripiego), e quando
/// il `!` è sotto escape non c'è nessun embed di cui parlare. Il caso in cui la
/// divergenza si vedrebbe è quello in cui comrak cambia idea su `![[`, cioè un
/// aggiornamento di dipendenza — ed è precisamente per quello che le due
/// risposte adesso sono **una funzione sola** (`embed_before`) invece di due
/// righe che si somigliano.
///
/// Ciò che questo test aggiunge davvero è quindi il **contorno**: le due
/// proprietà osservabili oggi, scritte, così che l'unificazione non possa averle
/// cambiate di nascosto e il giorno del cambio di comrak ci sia qualcosa da
/// rompere.
#[test]
fn an_embed_starts_at_its_exclamation_mark() {
    // Il ripiego testuale: `![[…]]` è un embed, e lo span parte dal `!`.
    for (source, expected) in [
        ("![[Nota]]\n", "![[Nota]]"),
        ("testo ![[Nota]] dopo\n", "![[Nota]]"),
        ("![[Nota#^blocco]]\n", "![[Nota#^blocco]]"),
    ] {
        let doc = parse(source);
        let link = doc.links.first().expect("un embed è un link");
        assert!(link.embed, "{source:?}: non è stato letto come embed");
        assert_eq!(
            &source[link.span.start..link.span.end],
            expected,
            "{source:?}: lo span dell'embed non comincia dal `!`"
        );
    }
    // Il ramo comrak, che è raggiungibile solo con il `!` sotto escape: allora
    // non è un embed, e lo span è quello delle sole parentesi — il `!`
    // letterale resta del testo, perché è testo.
    let source = "\\![[Nota]]\n";
    let doc = parse(source);
    let link = doc.links.first().expect("un wikilink è un link");
    assert!(
        !link.embed,
        "un `!` sotto escape è un punto esclamativo, non un embed"
    );
    assert_eq!(&source[link.span.start..link.span.end], "[[Nota]]");
}

/// Il testo di tutti gli inline, concatenato: è la lettura più cruda del
/// modello, e serve a dire «di quel costrutto non è rimasto che il testo».
fn flat_text(d: &DocumentModel) -> String {
    fn round(inlines: &[Inline], out: &mut String) {
        for the in inlines {
            match the {
                Inline::Text(t) | Inline::Code(t) => out.push_str(t),
                Inline::Emph(children)
                | Inline::Strong(children)
                | Inline::Superscript(children)
                | Inline::Strikethrough(children) => round(children, out),
                Inline::TagRef { name, .. } => {
                    out.push('#');
                    out.push_str(name);
                }
                Inline::Link { label, .. } => round(label.as_deref().unwrap_or(&[]), out),
                // Gli a-capo non portano testo, ma non sono niente: il duro
                // cambia riga, il morbido è uno spazio.
                Inline::HardBreak => out.push('\n'),
                Inline::SoftBreak => out.push(' '),
                Inline::Custom { .. } => {}
            }
        }
    }
    let mut out = String::new();
    for b in &d.body {
        if let Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } = b {
            round(inlines, &mut out);
        }
    }
    out
}

fn kind_names(d: &DocumentModel) -> BTreeSet<String> {
    let mut or = Observed::default();
    observe_blocks(&d.body, &mut or);
    or.kinds
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
//   `a_text_provider_refuses_bytes`;
// - il seme è **fisso**, quindi questa è una rete di regressione e non
//   un'esplorazione: la stessa corsa a ogni push. Cercare davvero è alzare
//   `FUB_FUZZ_CASI` a mano — con tre milioni di casi la corsa dura una
//   quindicina di secondi — oppure è il lavoro di libFuzzer, che sta con la
//   macchina della seconda metà del §17.1.

/// Il mutatore — `Case64`, `HOSTILE`, `mutate` — sta in [`crate::corpus`] insieme
/// alle sorgenti che semina, perché da oggi lo usa anche `transfer_e2e.rs`: là le
/// mutazioni diventano note di un vault e il bersaglio è l'export, qui restano
/// testo e il bersaglio è il parser. Il seme è lo stesso
/// (`FUB_FUZZ_SEME`), il conteggio no: le due porte non costano uguale.
#[test]
fn no_corpus_mutation_breaks_a_property() {
    let (cases, seed) = (how_many_cases("FUB_FUZZ_CASI", 20_000), seed());
    let p = provider();
    let seeds: Vec<&'static str> = corpus().iter().map(|c| c.source).collect();
    let mut rng = Case64::new(seed);
    let mut models = 0usize;

    for n in 0..cases {
        let (mutation, source) = mutate(&mut rng, &seeds);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            conformance::no_span_panics_its_user(&p, &source, &ctx())
        }));
        match outcome {
            Ok(verified) => models += usize::from(verified),
            Err(_) => panic!(
                "caso {n} di {cases} — mutazione «{mutation}» — ha rotto una\n\
                 proprietà. Il panico vero è stampato qui sopra.\n\
                 \n\
                 Per rifarlo esattamente:\n\
                 FUB_FUZZ_SEME={seed} FUB_FUZZ_CASI={} cargo test -p \
                 fub-format-markdown --test the_corpus -- no_corpus_mutation\n\
                 \n\
                 La sorgente, byte per byte: {source:?}",
                n + 1
            ),
        }
    }

    // Un fuzzer che genera solo sorgenti rifiutate non prova niente: sta
    // verificando `Err`, non le proprietà.
    assert!(
        models * 2 > cases,
        "su {cases} mutazioni solo {models} hanno prodotto un modello. Il\n\
         generatore sta producendo quasi solo sorgenti rifiutate, e le proprietà\n\
         non le sta verificando quasi mai."
    );
}

// ---------------------------------------------------------------------------
// §4.4 — il corpus su cui le DUE PASSATE devono concordare
// ---------------------------------------------------------------------------
//
// Fin qui il file ha chiesto una cosa sola: che il modello dica il vero sui
// byte. Da qui ne chiede una seconda, sullo stesso ingresso e con lo stesso
// argomento, spostato di un asse: che **la passata della shell** dica del testo
// la stessa cosa che ne dice il modello.
//
// Sono due riconoscitori che non si vedono. Il modello legge il **file**; la
// live preview legge il **buffer**, che è sporco e che al di qua del confine
// non conosce nessuno (0018), quindi le due grammatiche restano due — non per
// pigrizia, ma perché stanno su due oggetti diversi. Il prezzo di quel «due» è
// che la loro divergenza non era rossa da nessuna parte, e il difetto che ne
// esce non è un crash: è che ciò che si vede scrivendo e ciò che viene reso e
// indicizzato dicono due cose diverse sullo stesso testo, sul caso che nessuno
// prova. In un editor quel caso lo trova l'utente tutti i giorni.
//
// Qui si **emette** ciò che il modello dice delle stesse sorgenti; il gemello
// `frontend/src/editor/corpus.test.ts` ci passa la passata della shell. È la
// mossa della 0060 applicata all'altro asse, ed è la parte della §4.4 che non
// aspetta la dichiarazione condivisa e non costa quanto lei.
//
// Perché sta in questo file e non in un binario suo: `corpus/mod.rs` non ha un
// `allow(dead_code)`, e il perché sta scritto lì — `clippy --all-targets` è il
// solo posto che si accorgerebbe di un caso del corpus che nessuno semina più.
// Un terzo binario che ne usasse **una parte** avrebbe reso quel guardiano
// rumoroso, e il modo di zittirlo sarebbe stato spegnerlo.

/// Da byte UTF-8 a code unit UTF-16, come `byte_to_utf16` del mirror.
fn code_unit(text: &str, byte: usize) -> usize {
    let byte = byte.min(text.len());
    text[..byte].encode_utf16().count()
}

fn span_in_code_unit(text: &str, span: &Span) -> (usize, usize) {
    (code_unit(text, span.start), code_unit(text, span.end))
}

/// I marcatori di task del modello, in ordine di apparizione.
///
/// Lo span di un [`TaskMarker`](fub_abi::model::TaskMarker) è il **simbolo**,
/// non le parentesi: `[x]` → la `x`. La shell decora `[x]` intero, quindi la
/// fixture porta il simbolo e chi compare ci allarga di uno per lato — la
/// differenza è dichiarata qui e non nascosta in un `-1` di là.
fn model_tasks(model: &DocumentModel, text: &str, out: &mut Vec<Value>) {
    fn walk(blocks: &[Block], text: &str, out: &mut Vec<Value>) {
        for b in blocks {
            match b {
                Block::List { items, .. } => {
                    for item in items {
                        if let Some(t) = &item.task {
                            let (from, to) = span_in_code_unit(text, &t.span);
                            out.push(json!({"symbol": t.symbol, "from": from, "to": to}));
                        }
                        walk(&item.blocks, text, out);
                    }
                }
                Block::Quote { blocks, .. } => walk(blocks, text, out),
                Block::Custom { blocks, .. } => walk(blocks, text, out),
                _ => {}
            }
        }
    }
    walk(&model.body, text, out);
    out.sort_by_key(|v| v["from"].as_u64().unwrap_or(0));
}

/// I wikilink del modello, cioè i riferimenti con bersaglio `Wiki`.
///
/// Si leggono dagli inline e non da `model.links`, per una ragione che è tutto
/// il punto della voce: `links` è l'**estratto** — la stessa nota linkata due
/// volte ci sta due volte, ma senza il `!` dell'embed e senza garanzia
/// d'ordine — mentre qui serve dove sta ogni occorrenza sul testo.
fn model_wikilinks(model: &DocumentModel, text: &str) -> Vec<Value> {
    fn inline(nodes: &[Inline], text: &str, out: &mut Vec<Value>) {
        for n in nodes {
            match n {
                Inline::Link {
                    target: LinkTarget::Wiki { page, .. },
                    embed,
                    span,
                    ..
                } => {
                    let (from, to) = span_in_code_unit(text, span);
                    out.push(json!({"page": page, "embed": embed, "from": from, "to": to}));
                }
                Inline::Emph(kids)
                | Inline::Strong(kids)
                | Inline::Superscript(kids)
                | Inline::Strikethrough(kids) => inline(kids, text, out),
                Inline::Link {
                    label: Some(kids), ..
                } => inline(kids, text, out),
                _ => {}
            }
        }
    }
    fn walk(blocks: &[Block], text: &str, out: &mut Vec<Value>) {
        for b in blocks {
            match b {
                Block::Paragraph { inlines, .. } | Block::Heading { inlines, .. } => {
                    inline(inlines, text, out)
                }
                Block::List { items, .. } => {
                    for item in items {
                        walk(&item.blocks, text, out);
                    }
                }
                Block::Quote { blocks, .. } => walk(blocks, text, out),
                Block::Custom { blocks, .. } => walk(blocks, text, out),
                Block::Table { head, rows, .. } => {
                    for row in head.iter().chain(rows) {
                        for cell in &row.cells {
                            inline(&cell.inlines, text, out);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(&model.body, text, &mut out);
    out.sort_by_key(|v| v["from"].as_u64().unwrap_or(0));
    out
}

fn corpus_for_the_shell() -> Value {
    let mut cases = Vec::new();
    for case in corpus() {
        let model = parse(case.source);
        let tags: Vec<Value> = model
            .tags
            .iter()
            .map(|t| {
                let (from, to) = span_in_code_unit(case.source, &t.span);
                json!({"name": t.name, "from": from, "to": to})
            })
            .collect();
        let mut task = Vec::new();
        model_tasks(&model, case.source, &mut task);
        cases.push(json!({
            "name": case.name,
            "source": case.source,
            "tag": tags,
            "wikilink": model_wikilinks(&model, case.source),
            "task": task,
        }));
    }
    Value::Array(cases)
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src/__fixtures__/corpus-syntax.json")
}

#[test]
fn the_corpus_fixture_matches_the_model_one() {
    let expected = corpus_for_the_shell();
    let path = fixture_path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("scrive la fixture del corpus");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "fixture del corpus mancante ({}): {and}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fub-format-markdown --test the_corpus`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture del corpus è stantia: il modello dice qualcosa di diverso \
         di queste sorgenti. Rigenerala con `UPDATE_MIRROR=1 cargo test -p \
         fub-format-markdown --test the_corpus`, poi guarda se \
         `frontend/src/editor/corpus.test.ts` è ancora d'accordo — se non lo è, \
         le due passate hanno cominciato a dire due cose diverse."
    );
}

/// **Il test del test**: un corpus in cui nessun caso porta niente non
/// presidierebbe niente.
///
/// Non conta i casi — quelli li conta `il_corpus.rs` contro il contratto — ma
/// pretende che ognuna delle tre famiglie abbia dei portatori, e che almeno un
/// caso ne porti due insieme: è la forma in cui i riconoscitori si disturbano a
/// vicenda (un `#tag` dentro un `[[wikilink]]`, una task con dentro un link), ed
/// è dove una divergenza si nasconde.
#[test]
fn the_corpus_exercises_all_three_families() {
    let cases = corpus_for_the_shell();
    let cases = cases.as_array().expect("array");
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    let mut mixed = 0;
    for c in cases {
        let mut families = 0;
        for f in ["tag", "wikilink", "task"] {
            let n = c[f].as_array().map(|a| a.len()).unwrap_or(0);
            *counts.entry(f).or_default() += n;
            if n > 0 {
                families += 1;
            }
        }
        if families >= 2 {
            mixed += 1;
        }
    }
    for (family, n) in &counts {
        assert!(
            *n >= 3,
            "la famiglia `{family}` ha {n} occorrenze in tutto il corpus: \
             troppo poche perché una divergenza si veda"
        );
    }
    assert!(
        mixed >= 2,
        "solo {mixed} casi mescolano due famiglie: è lì che i riconoscitori si \
         disturbano a vicenda, ed è lì che una divergenza si nasconde"
    );
}
