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
fn first_heading(doc: &DocumentModel) -> (Span, String) {
    for block in &doc.body {
        if let Block::Heading { span, inlines, .. } = block {
            return (*span, text_of(inlines));
        }
    }
    panic!("nessun heading nel modello: {:?}", doc.body);
}

/// Lo span del primo paragrafo, e il testo che il modello gli ha attribuito.
fn first_paragraph(doc: &DocumentModel) -> (Span, String) {
    for block in &doc.body {
        if let Block::Paragraph { span, inlines, .. } = block {
            return (*span, text_of(inlines));
        }
    }
    panic!("nessun paragrafo nel modello: {:?}", doc.body);
}

fn text_of(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|the| match the {
            Inline::Text(text) => text.clone(),
            Inline::Code(text) => text.clone(),
            Inline::Emph(within) | Inline::Strong(within) => text_of(within),
            Inline::Superscript(within) | Inline::Strikethrough(within) => text_of(within),
            other => format!("{other:?}"),
        })
        .collect()
}

/// Le quattro forme dello stesso documento. Il contenuto è identico per un umano;
/// per i byte no, ed è quello il punto.
fn four_forms(base: &str) -> Vec<(&'static str, String)> {
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
fn a_headings_span_slices_its_title_in_every_form() {
    for (name, source) in four_forms("# Titolo\n\nUn paragrafo.\n") {
        let doc = parse(&source);
        let (span, text) = first_heading(&doc);
        assert_eq!(
            slice(&source, span),
            "# Titolo",
            "{name}: lo span dell'heading non affetta l'heading"
        );
        assert_eq!(text, "Titolo", "{name}: il testo dell'heading");
    }
}

#[test]
fn a_bom_at_file_start_does_not_end_up_in_content() {
    // Il caso su cui la proprietà si romperebbe senza rumore: un `U+FEFF` dentro
    // il testo del primo blocco è invisibile a schermo e comunque presente nel
    // modello, nell'HTML e nell'indice di ricerca — una nota che si trova
    // cercando il suo titolo, e un titolo che non si trova.
    //
    // Oggi non capita, e la riga che lo garantisce è `strip_bom` in
    // `parse_markdown`. Prima lo garantiva comrak, che è un'altra cosa.
    for (name, source) in four_forms("Prima riga.\n") {
        let doc = parse(&source);
        let (span, text) = first_paragraph(&doc);
        assert_eq!(
            slice(&source, span),
            "Prima riga.",
            "{name}: lo span del paragrafo non affetta il paragrafo"
        );
        assert!(
            !text.contains('\u{feff}'),
            "{name}: il BOM è finito nel contenuto ({text:?})"
        );
        assert!(
            !doc.text.contains('\u{feff}'),
            "{name}: il BOM è finito nel testo indicizzato ({:?})",
            doc.text
        );
        assert_eq!(text, "Prima riga.", "{name}: il testo del paragrafo");
    }
}

#[test]
fn frontmatter_handles_bom_and_crlf() {
    for (name, source) in four_forms("---\ntitolo: Ciao\n---\n\n# Corpo\n") {
        let doc = parse(&source);
        assert_eq!(
            doc.frontmatter.get("titolo").and_then(|v| v.as_str()),
            Some("Ciao"),
            "{name}: il frontmatter non è stato read_value"
        );
        let (span, _) = first_heading(&doc);
        assert_eq!(
            slice(&source, span),
            "# Corpo",
            "{name}: dopo il frontmatter lo span è spostato"
        );
    }
}

#[test]
fn a_wikilinks_span_slices_the_wikilink() {
    // Un inline in fondo a un documento a più righe: se la tabella riga→byte
    // sbaglia di un byte per riga, qui si vede.
    for (name, source) in four_forms("# T\n\nuna\n\ndue\n\nvedi [[Altra]] qui\n") {
        let doc = parse(&source);
        let link = doc.links.first().expect("un link");
        assert_eq!(
            slice(&source, link.span),
            "[[Altra]]",
            "{name}: lo span del wikilink non affetta il wikilink"
        );
    }
}

#[test]
fn a_crlf_rows_span_does_not_carry_the_carriage_return() {
    // Il `\r` è terminatore, non contenuto: uno span che se lo prendesse dentro
    // farebbe finire un carattere invisibile in ogni titolo di ogni file Windows.
    let source = "# Titolo\r\n\r\nParagrafo.\r\n";
    let doc = parse(source);
    let (span, _) = first_heading(&doc);
    let affected = slice(source, span);
    assert_eq!(affected, "# Titolo");
    assert!(
        !affected.contains('\r'),
        "lo span si è portato dentro il `\\r`: {affected:?}"
    );
}

#[test]
fn mixed_terminators_do_not_shift_spans() {
    // Un file mezzo convertito da qualcun altro: è la forma che nessuno scrive
    // di proposito e che si trova nei vault veri.
    let source = "# Titolo\r\n\nuna riga\r\n\naltra riga\n\nvedi [[Altra]]\r\n";
    let doc = parse(source);
    let (span, text) = first_heading(&doc);
    assert_eq!(slice(source, span), "# Titolo");
    assert_eq!(text, "Titolo");
    let link = doc.links.first().expect("un link");
    assert_eq!(slice(source, link.span), "[[Altra]]");
}

#[test]
fn every_model_span_falls_within_the_source() {
    // La proprietà debole ma esaustiva: qualunque cosa il modello contenga, i
    // suoi span devono essere affettabili. Un `end` oltre la fine, o un offset a
    // metà di un carattere, farebbe panicare uno slice — che è come questo
    // difetto si presenterebbe a chi apre una nota.
    let base = "---\na: 1\n---\n\n# Titolo\n\nUn *paragrafo* con `codice`, [[Link]] e #tag.\n\n\
                - [ ] un task\n- [x] fatto\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> citazione\n";
    for (name, source) in four_forms(base) {
        let doc = parse(&source);
        let mut seen = 0;
        for block in &doc.body {
            slice(&source, block.span());
            seen += 1;
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
        assert!(seen > 3, "{name}: il documento non è stato parsato");
    }
}
