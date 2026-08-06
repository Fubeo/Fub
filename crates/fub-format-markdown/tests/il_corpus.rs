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
//! Le proprietà stanno in [`fub_sdk::testing::conformita`] e non qui, perché
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

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{Block, DocumentModel, Inline, LinkTarget, Span};
use fub_abi::options::syntax;
use fub_format_markdown::MarkdownProvider;
use fub_sdk::testing::conformita;
use serde_json::{json, Value};

mod corpus;

use crate::corpus::{corpus, divergenti, muta, quanti_casi, seme, Caso64};

/// Il sorgente del contratto, da cui si estraggono le tre sorgenti di verità del
/// confronto.
///
/// Arriva per `include_str!` e non per path a runtime: se `model.rs` si sposta,
/// questo file **non compila** — invece di passare avendo confrontato il corpus
/// con un elenco vuoto. È il gesto della
/// [0059](../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md).
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
        verificati >= 62,
        "il corpus ha verificato {verificati} casi su sessantadue: un corpus che si\n\
         svuota passa sempre, quindi la soglia è il conteggio di oggi — cresce con\n\
         lui, e scende solo in un commit che dice perché."
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
///
/// Le **sorgenti** non stanno qui ma in [`crate::corpus::divergenti`], perché le
/// vuole anche `transfer_e2e.rs`: là entrano in un vault come note qualunque, e
/// provano la tesi su cui poggia il round-trip — una divergenza fra il modello e
/// il file non è una perdita nel trasferimento, perché i byte che il
/// trasferimento copia non vengono dal modello. Il nome è la chiave che lega le
/// due metà, e [`le_divergenze_sono_quelle_dichiarate`] confronta i due elenchi
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
fn divergenze_dichiarate() -> Vec<(&'static str, Perche, fn(&DocumentModel, &str) -> bool)> {
    vec![
        (
            "un link a un heading di questa nota inventa un tag",
            Perche::InventataDalParser,
            |d, _| {
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
            Perche::AccesaEnonMappata,
            |d, _| testo_piatto(d) == "barrato" && !nomi_dei_kind(d).contains("strikethrough"),
        ),
        (
            "l'apice non arriva nel modello",
            Perche::AccesaEnonMappata,
            |d, _| testo_piatto(d) == "testo apice qui" && nomi_dei_kind(d).is_empty(),
        ),
        (
            "l'html inline sparisce, mentre quello a blocco resta",
            Perche::AccesaEnonMappata,
            |d, _| testo_piatto(d) == "un grassetto inline" && nomi_dei_kind(d).is_empty(),
        ),
        (
            "un frontmatter che non si parsa non lascia traccia",
            Perche::AccesaEnonMappata,
            // `frontmatter.is_empty()` da solo è vero su qualunque documento senza
            // frontmatter, cioè sulla maggior parte: la divergenza è che il **file**
            // apre con i delimitatori e il modello non ne sa niente.
            |d, src| src.starts_with("---\n") && d.frontmatter.is_empty(),
        ),
        (
            "l'ancora esplicita di un heading non è raggiungibile dall'albero",
            Perche::RappresentataEnonRaggiungibile,
            |d, _| {
                d.anchors.iter().any(|a| a.id == "xyz")
                    && d.body.first().map(Block::anchor) == Some(Some("titolo"))
            },
        ),
        (
            "uno slug vuoto è un'ancora che il contratto rifiuterebbe",
            Perche::RappresentataEnonRaggiungibile,
            |d, _| d.body.first().map(Block::anchor) == Some(Some("")),
        ),
        (
            "l'alt di un'immagine non entra nel testo indicizzato",
            Perche::RappresentataEnonRaggiungibile,
            // La negazione da sola è vera su ogni documento che non dice
            // «didascalia», cioè su tutti tranne uno: la divergenza è che la parola
            // **c'è nel file** e non nel testo che si indicizza.
            |d, src| src.contains("didascalia") && !d.text.contains("didascalia"),
        ),
        (
            "la sintassi grezza di un embed entra nel testo indicizzato",
            Perche::RappresentataEnonRaggiungibile,
            |d, _| d.text.contains("![["),
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
            Perche::DipendeDaiByte,
            |d, _| {
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
            Perche::DipendeDaiByte,
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
            Perche::DipendeDaiByte,
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
        (
            "lo slug di un heading dipende dalla normalizzazione unicode",
            Perche::DipendeDaiByte,
            |d, _| {
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
    let sorgenti = divergenti();
    assert!(
        dichiarate.len() >= 13,
        "l'elenco delle divergenze si è svuotato: {} righe su tredici. Se sono\n\
         state riparate è una bella notizia e va scritta nel verbale — e allora si\n\
         abbassa questo numero **nello stesso commit**, che è ciò che lo tiene una\n\
         soglia e non un desiderio; se è l'elenco che si è rotto, questo file ha\n\
         smesso di presidiare la cosa per cui esiste.",
        dichiarate.len()
    );

    // Le due metà si tengono per il nome, quindi il nome dev'essere una chiave:
    // due righe omonime si accoppierebbero con la stessa sorgente, e una delle
    // due divergenze smetterebbe di essere verificata senza diventare rossa.
    let con_predicato: BTreeSet<&str> = dichiarate.iter().map(|(n, _, _)| *n).collect();
    let con_sorgente: BTreeSet<&str> = sorgenti.iter().map(|c| c.nome).collect();
    assert_eq!(
        con_predicato.len(),
        dichiarate.len(),
        "due divergenze dichiarate portano lo stesso nome"
    );
    assert_eq!(
        con_sorgente.len(),
        sorgenti.len(),
        "due sorgenti divergenti portano lo stesso nome"
    );

    let senza_sorgente: Vec<&&str> = con_predicato.difference(&con_sorgente).collect();
    assert!(
        senza_sorgente.is_empty(),
        "queste divergenze hanno un predicato e nessuna sorgente in\n\
         `corpus::divergenti()`: {senza_sorgente:?}.\n\
         Il nome è la chiave fra le due metà: senza la sorgente il predicato non\n\
         viene mai valutato, e una divergenza che nessuno valuta è tornata a\n\
         essere silenziosa."
    );
    let senza_predicato: Vec<&&str> = con_sorgente.difference(&con_predicato).collect();
    assert!(
        senza_predicato.is_empty(),
        "queste sorgenti stanno in `corpus::divergenti()` e nessuno dice **in che\n\
         modo** divergono: {senza_predicato:?}.\n\
         Se la divergenza è stata riparata la sorgente va spostata nel corpus\n\
         curato, dove le proprietà la pretendono tutta; se non lo è, le manca la\n\
         riga che dice cosa succede."
    );

    for (nome, perche, ancora_vero) in dichiarate {
        let source = sorgenti
            .iter()
            .find(|c| c.nome == nome)
            .expect("il confronto nei due versi qui sopra lo garantisce")
            .source;
        let doc = parse(source);
        assert!(
            ancora_vero(&doc, source),
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

/// I documenti di controllo: markdown senza niente di strano, più i due casi
/// degeneri.
///
/// Servono a una cosa sola, e la vale: un predicato di divergenza che passa su
/// uno di questi non sta descrivendo una divergenza. `!d.text.contains("x")` è
/// vero su un documento vuoto; `d.frontmatter.is_empty()` è vero su quasi tutti.
/// Sono i due modi in cui una riga dell'elenco può diventare verde per sempre
/// **senza** che nessuno l'abbia riparata — ed è precisamente il fallimento che
/// l'elenco esiste per impedire.
const CONTROLLI: [&str; 5] = [
    "",
    "# Titolo\n\nUn paragrafo con [[Nota]], #tag e `codice`.\n",
    "- [ ] una task\n- [x] un'altra\n",
    "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n",
    "---\ntitolo: X\n---\n\n# Corpo ^abc\n",
];

#[test]
fn nessuna_divergenza_e_vera_su_un_documento_qualunque() {
    for (nome, perche, ancora_vero) in divergenze_dichiarate() {
        for controllo in CONTROLLI {
            let doc = parse(controllo);
            assert!(
                !ancora_vero(&doc, controllo),
                "il predicato della divergenza «{nome}» ({perche:?}) è vero anche su\n\
                 un documento di controllo: {controllo:?}.\n\
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
//   `FUB_FUZZ_CASI` a mano — con tre milioni di casi la corsa dura una
//   quindicina di secondi — oppure è il lavoro di libFuzzer, che sta con la
//   macchina della seconda metà del §17.1.

/// Il mutatore — `Caso64`, `OSTILI`, `muta` — sta in [`crate::corpus`] insieme
/// alle sorgenti che semina, perché da oggi lo usa anche `transfer_e2e.rs`: là le
/// mutazioni diventano note di un vault e il bersaglio è l'export, qui restano
/// testo e il bersaglio è il parser. Il seme è lo stesso
/// (`FUB_FUZZ_SEME`), il conteggio no: le due porte non costano uguale.
#[test]
fn nessuna_mutazione_del_corpus_rompe_una_proprieta() {
    let (casi, seme) = (quanti_casi("FUB_FUZZ_CASI", 20_000), seme());
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
                 FUB_FUZZ_SEME={seme} FUB_FUZZ_CASI={} cargo test -p \
                 fub-format-markdown --test il_corpus -- nessuna_mutazione\n\
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
/// fixture porta il simbolo e chi confronta ci allarga di uno per lato — la
/// differenza è dichiarata qui e non nascosta in un `-1` di là.
fn task_del_modello(model: &DocumentModel, text: &str, out: &mut Vec<Value>) {
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
fn wikilink_del_modello(model: &DocumentModel, text: &str) -> Vec<Value> {
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
                Inline::Emph(kids) | Inline::Strong(kids) => inline(kids, text, out),
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

fn corpus_per_la_shell() -> Value {
    let mut casi = Vec::new();
    for caso in corpus() {
        let model = parse(caso.source);
        let tags: Vec<Value> = model
            .tags
            .iter()
            .map(|t| {
                let (from, to) = span_in_code_unit(caso.source, &t.span);
                json!({"name": t.name, "from": from, "to": to})
            })
            .collect();
        let mut task = Vec::new();
        task_del_modello(&model, caso.source, &mut task);
        casi.push(json!({
            "nome": caso.nome,
            "source": caso.source,
            "tag": tags,
            "wikilink": wikilink_del_modello(&model, caso.source),
            "task": task,
        }));
    }
    Value::Array(casi)
}

fn percorso_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src/__fixtures__/corpus-sintassi.json")
}

#[test]
fn la_fixture_del_corpus_e_quella_del_modello() {
    let atteso = corpus_per_la_shell();
    let path = percorso_fixture();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        let mut json = serde_json::to_string_pretty(&atteso).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("scrive la fixture del corpus");
        return;
    }

    let committata = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture del corpus mancante ({}): {e}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fub-format-markdown --test corpus_della_shell`.",
            path.display()
        )
    });
    let committata: Value = serde_json::from_str(&committata).expect("fixture JSON valida");

    assert_eq!(
        committata, atteso,
        "la fixture del corpus è stantia: il modello dice qualcosa di diverso \
         di queste sorgenti. Rigenerala con `UPDATE_MIRROR=1 cargo test -p \
         fub-format-markdown --test corpus_della_shell`, poi guarda se \
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
fn il_corpus_esercita_tutte_e_tre_le_famiglie() {
    let casi = corpus_per_la_shell();
    let casi = casi.as_array().expect("array");
    let mut conti: BTreeMap<&str, usize> = BTreeMap::new();
    let mut misti = 0;
    for c in casi {
        let mut famiglie = 0;
        for f in ["tag", "wikilink", "task"] {
            let n = c[f].as_array().map(|a| a.len()).unwrap_or(0);
            *conti.entry(f).or_default() += n;
            if n > 0 {
                famiglie += 1;
            }
        }
        if famiglie >= 2 {
            misti += 1;
        }
    }
    for (famiglia, n) in &conti {
        assert!(
            *n >= 3,
            "la famiglia `{famiglia}` ha {n} occorrenze in tutto il corpus: \
             troppo poche perché una divergenza si veda"
        );
    }
    assert!(
        misti >= 2,
        "solo {misti} casi mescolano due famiglie: è lì che i riconoscitori si \
         disturbano a vicenda, ed è lì che una divergenza si nasconde"
    );
}
