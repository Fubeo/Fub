//! Gli span reggono un BOM e un CRLF? (§15.5)
//!
//! Uno [`Span`] è in byte **della sorgente**, e la sorgente sono i byte del file
//! decodificati integralmente — BOM e terminatori compresi (vedi il doc di `Span`
//! in `fub-abi/src/model.rs`). Questo test lo verifica dove la promessa si può
//! rompere senza rumore: il ponte fra le posizioni riga/colonna di comrak e i
//! nostri offset in byte (`src/offsets.rs`).
//!
//! **Cosa questi test hanno trovato, e cosa no.** L'ipotesi da cui partivano era
//! che comrak tollerasse il BOM solo davanti al frontmatter, e che un BOM a inizio
//! file finisse dentro il contenuto del primo blocco. Controllato: **non è così**
//! — questi sette test passavano anche prima che `parse_markdown` chiamasse
//! `strip_bom`, e per passare serve che lo span dell'heading cominci al byte 3.
//! comrak 0.54 salta già il BOM di suo, e taglia da sé il `\r` di fine riga.
//!
//! Quello che restava vero è la ragione per cui questo file esiste comunque: le
//! proprietà reggevano per **comportamento di una dipendenza**, non per una
//! decisione di Fub, e un comportamento non dichiarato è una cosa che una `cargo
//! update` cambia in silenzio. Adesso il BOM lo salta `strip_bom` e la traslazione
//! sta in `Offsets::new`; i due giri si annullano, il risultato è identico, e la
//! differenza è chi risponde della proprietà.
//!
//! La forma dell'asserzione è sempre la stessa, ed è quella che conta: si prende
//! lo span che il modello riporta e si **affetta la sorgente originale** con lui.
//! Se il pezzo che ne esce non è quello che ci si aspetta, lo span è sbagliato —
//! qualunque cosa dica il resto del modello.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{Block, DocumentModel, Inline, Span};
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("il markdown parsa")
}

/// Il pezzo di sorgente che uno span nomina. È l'unico modo onesto di controllare
/// uno span: chiedere alla sorgente, non al modello.
fn slice(source: &str, span: Span) -> &str {
    assert!(
        span.end <= source.len(),
        "span {span:?} fuori dalla sorgente ({} byte)",
        source.len()
    );
    &source[span.start..span.end]
}

/// Lo span del primo heading, e il testo che il modello gli ha attribuito.
fn primo_heading(doc: &DocumentModel) -> (Span, String) {
    for block in &doc.body {
        if let Block::Heading { span, inlines, .. } = block {
            return (*span, testo_di(inlines));
        }
    }
    panic!("nessun heading nel modello: {:?}", doc.body);
}

/// Lo span del primo paragrafo, e il testo che il modello gli ha attribuito.
fn primo_paragrafo(doc: &DocumentModel) -> (Span, String) {
    for block in &doc.body {
        if let Block::Paragraph { span, inlines, .. } = block {
            return (*span, testo_di(inlines));
        }
    }
    panic!("nessun paragrafo nel modello: {:?}", doc.body);
}

fn testo_di(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|i| match i {
            Inline::Text(text) => text.clone(),
            Inline::Code(text) => text.clone(),
            Inline::Emph(dentro) | Inline::Strong(dentro) => testo_di(dentro),
            altro => format!("{altro:?}"),
        })
        .collect()
}

/// Le quattro forme dello stesso documento. Il contenuto è identico per un umano;
/// per i byte no, ed è quello il punto.
fn quattro_forme(base: &str) -> Vec<(&'static str, String)> {
    vec![
        ("lf", base.to_string()),
        ("crlf", base.replace('\n', "\r\n")),
        ("bom+lf", format!("\u{feff}{base}")),
        (
            "bom+crlf",
            format!("\u{feff}{}", base.replace('\n', "\r\n")),
        ),
    ]
}

#[test]
fn lo_span_di_un_heading_affetta_il_titolo_in_ogni_forma() {
    for (nome, source) in quattro_forme("# Titolo\n\nUn paragrafo.\n") {
        let doc = parse(&source);
        let (span, testo) = primo_heading(&doc);
        assert_eq!(
            slice(&source, span),
            "# Titolo",
            "{nome}: lo span dell'heading non affetta l'heading"
        );
        assert_eq!(testo, "Titolo", "{nome}: il testo dell'heading");
    }
}

#[test]
fn un_bom_a_inizio_file_non_finisce_nel_contenuto() {
    // Il caso su cui la proprietà si romperebbe senza rumore: un `U+FEFF` dentro
    // il testo del primo blocco è invisibile a schermo e comunque presente nel
    // modello, nell'HTML e nell'indice di ricerca — una nota che si trova
    // cercando il suo titolo, e un titolo che non si trova.
    //
    // Oggi non capita, e la riga che lo garantisce è `strip_bom` in
    // `parse_markdown`. Prima lo garantiva comrak, che è un'altra cosa.
    for (nome, source) in quattro_forme("Prima riga.\n") {
        let doc = parse(&source);
        let (span, testo) = primo_paragrafo(&doc);
        assert_eq!(
            slice(&source, span),
            "Prima riga.",
            "{nome}: lo span del paragrafo non affetta il paragrafo"
        );
        assert!(
            !testo.contains('\u{feff}'),
            "{nome}: il BOM è finito nel contenuto ({testo:?})"
        );
        assert!(
            !doc.text.contains('\u{feff}'),
            "{nome}: il BOM è finito nel testo indicizzato ({:?})",
            doc.text
        );
        assert_eq!(testo, "Prima riga.", "{nome}: il testo del paragrafo");
    }
}

#[test]
fn il_frontmatter_regge_il_bom_e_il_crlf() {
    for (nome, source) in quattro_forme("---\ntitolo: Ciao\n---\n\n# Corpo\n") {
        let doc = parse(&source);
        assert_eq!(
            doc.frontmatter.get("titolo").and_then(|v| v.as_str()),
            Some("Ciao"),
            "{nome}: il frontmatter non è stato letto"
        );
        let (span, _) = primo_heading(&doc);
        assert_eq!(
            slice(&source, span),
            "# Corpo",
            "{nome}: dopo il frontmatter lo span è spostato"
        );
    }
}

#[test]
fn lo_span_di_un_wikilink_affetta_il_wikilink() {
    // Un inline in fondo a un documento a più righe: se la tabella riga→byte
    // sbaglia di un byte per riga, qui si vede.
    for (nome, source) in quattro_forme("# T\n\nuna\n\ndue\n\nvedi [[Altra]] qui\n") {
        let doc = parse(&source);
        let link = doc.links.first().expect("un link");
        assert_eq!(
            slice(&source, link.span),
            "[[Altra]]",
            "{nome}: lo span del wikilink non affetta il wikilink"
        );
    }
}

#[test]
fn lo_span_di_una_riga_crlf_non_si_porta_dietro_il_ritorno_a_capo() {
    // Il `\r` è terminatore, non contenuto: uno span che se lo prendesse dentro
    // farebbe finire un carattere invisibile in ogni titolo di ogni file Windows.
    let source = "# Titolo\r\n\r\nParagrafo.\r\n";
    let doc = parse(source);
    let (span, _) = primo_heading(&doc);
    let affettato = slice(source, span);
    assert_eq!(affettato, "# Titolo");
    assert!(
        !affettato.contains('\r'),
        "lo span si è portato dentro il `\\r`: {affettato:?}"
    );
}

#[test]
fn i_terminatori_misti_non_spostano_gli_span() {
    // Un file mezzo convertito da qualcun altro: è la forma che nessuno scrive
    // di proposito e che si trova nei vault veri.
    let source = "# Titolo\r\n\nuna riga\r\n\naltra riga\n\nvedi [[Altra]]\r\n";
    let doc = parse(source);
    let (span, testo) = primo_heading(&doc);
    assert_eq!(slice(source, span), "# Titolo");
    assert_eq!(testo, "Titolo");
    let link = doc.links.first().expect("un link");
    assert_eq!(slice(source, link.span), "[[Altra]]");
}

#[test]
fn ogni_span_del_modello_sta_dentro_la_sorgente() {
    // La proprietà debole ma esaustiva: qualunque cosa il modello contenga, i
    // suoi span devono essere affettabili. Un `end` oltre la fine, o un offset a
    // metà di un carattere, farebbe panicare uno slice — che è come questo
    // difetto si presenterebbe a chi apre una nota.
    let base = "---\na: 1\n---\n\n# Titolo\n\nUn *paragrafo* con `codice`, [[Link]] e #tag.\n\n\
                - [ ] un task\n- [x] fatto\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> citazione\n";
    for (nome, source) in quattro_forme(base) {
        let doc = parse(&source);
        let mut visti = 0;
        for block in &doc.body {
            slice(&source, block.span());
            visti += 1;
        }
        for link in &doc.links {
            slice(&source, link.span);
        }
        for tag in &doc.tags {
            slice(&source, tag.span);
        }
        for heading in &doc.outline {
            slice(&source, heading.span);
        }
        assert!(visti > 3, "{nome}: il documento non è stato parsato");
    }
}
