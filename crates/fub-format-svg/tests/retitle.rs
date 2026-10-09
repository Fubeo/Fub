//! Il titolo di un disegno che già c'è: la copia di un modello nasce con il
//! nome del disegno nuovo, e di tutto il resto non cambia un byte.

use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;
use fub_format_svg::{retitle, SvgProvider};

const ROOT: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">"#;
const PAPER: &str = r##"<rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>"##;

fn new_document(id: &str) -> String {
    SvgProvider
        .serialize(&DocumentModel::empty(DocId::new(id)))
        .unwrap()
}

fn title_of(source: &str) -> Option<String> {
    let scene = fub_scene::read(source).unwrap();
    scene.index.title.map(|title| title.text)
}

/// Un disegno a mano, con `head` prima della radice e `body` dentro.
fn drawing(head: &str, body: &str) -> String {
    format!("{head}{ROOT}{body}</svg>\n")
}

#[test]
fn the_text_of_the_title_is_replaced_and_nothing_else() {
    let source = drawing("", &format!("\n  <title>Modello</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\">\n  </g>\n"));
    let written = retitle(&source, "Il mio disegno").unwrap();
    assert_eq!(written, source.replace("Modello", "Il mio disegno"));
    assert_eq!(title_of(&written).as_deref(), Some("Il mio disegno"));
}

#[test]
fn a_new_document_retitled_is_the_document_of_that_name() {
    let source = new_document("disegni/Modello.svg");
    let written = retitle(&source, "Ciclo dell'acqua").unwrap();
    // Cambia il titolo e il livello (che dipende dal nome): il titolo è solo
    // quello che si chiede, e il resto della forma è la stessa.
    assert_eq!(title_of(&written).as_deref(), Some("Ciclo dell'acqua"));
    assert_eq!(written.lines().count(), source.lines().count());
    assert_eq!(written, source.replace("Modello", "Ciclo dell'acqua"));
}

#[test]
fn the_attributes_of_the_title_element_stay() {
    let source = drawing(
        "",
        &format!("\n  <title id=\"t\" data-x=\"a>b\" xml:lang=\"it\">Vecchio</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"),
    );
    let written = retitle(&source, "Nuovo").unwrap();
    assert!(
        written.contains("<title id=\"t\" data-x=\"a>b\" xml:lang=\"it\">Nuovo</title>"),
        "{written}"
    );
    assert_eq!(title_of(&written).as_deref(), Some("Nuovo"));
}

#[test]
fn an_old_title_with_entities_and_cdata_is_replaced_whole() {
    for old in [
        "A &amp; B",
        "<![CDATA[ A & B ]]>",
        "A<!-- un commento --> B",
        "  A   B  ",
    ] {
        let source = drawing(
            "",
            &format!("\n  <title>{old}</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"),
        );
        let written = retitle(&source, "Nuovo").unwrap();
        assert_eq!(written, source.replace(old, "Nuovo"), "{old}");
    }
}

#[test]
fn a_missing_title_goes_in_as_the_first_child_with_its_indent() {
    let source = drawing(
        "",
        &format!("\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\">\n  </g>\n"),
    );
    assert_eq!(title_of(&source), None);
    let written = retitle(&source, "Senza titolo").unwrap();
    assert_eq!(
        written,
        format!(
            "{ROOT}\n  <title>Senza titolo</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\">\n  </g>\n</svg>\n"
        )
    );
    assert_eq!(title_of(&written).as_deref(), Some("Senza titolo"));
}

#[test]
fn a_title_goes_in_before_a_first_child_on_the_same_line() {
    let source = drawing(
        "",
        &format!("{PAPER}<g id=\"l1\" fub:layer=\"Livello 1\"></g>"),
    );
    let written = retitle(&source, "Compatto").unwrap();
    assert_eq!(
        written,
        format!(
            "{ROOT}<title>Compatto</title>{PAPER}<g id=\"l1\" fub:layer=\"Livello 1\"></g></svg>\n"
        )
    );
}

#[test]
fn an_empty_title_gives_way_to_the_new_one() {
    for empty in [
        "<title></title>",
        "<title/>",
        "<title />",
        "<title>  \n </title>",
    ] {
        let source = drawing(
            "",
            &format!("\n  {empty}\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"),
        );
        assert_eq!(title_of(&source), None, "{empty}");
        let written = retitle(&source, "Pieno").unwrap();
        assert_eq!(
            written,
            source.replace(empty, "<title>Pieno</title>"),
            "{empty}"
        );
        assert_eq!(written.matches("<title").count(), 1, "{written}");
    }
}

#[test]
fn a_root_without_children_is_opened_to_make_room() {
    let source = format!("{}\n", ROOT.replace("\">", "\"/>"));
    // Senza livelli la scena si legge, e il titolo dà il posto che manca.
    let written = retitle(&source, "Vuoto").unwrap();
    assert_eq!(title_of(&written).as_deref(), Some("Vuoto"));
    assert!(written.ends_with("</svg>\n"), "{written}");
}

#[test]
fn the_name_is_escaped_and_read_back_as_written() {
    for (name, text) in [
        ("Mari & Monti", "Mari &amp; Monti"),
        ("a < b > c", "a &lt; b &gt; c"),
        ("<svg>", "&lt;svg&gt;"),
        ("Il \"giorno\" e l'ora", "Il \"giorno\" e l'ora"),
    ] {
        let with = drawing(
            "",
            &format!("\n  <title>Vecchio</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"),
        );
        let without = drawing(
            "",
            &format!("\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"),
        );
        for source in [with, without] {
            let written = retitle(&source, name).unwrap();
            assert!(
                written.contains(&format!("<title>{text}</title>")),
                "{name}: {written}"
            );
            assert_eq!(title_of(&written).as_deref(), Some(name));
        }
    }
}

#[test]
fn the_name_is_one_line_without_characters_xml_cannot_hold() {
    let source = new_document("a.svg");
    let written = retitle(&source, "  due \n righe \t e\u{0}\u{b} un controllo  ").unwrap();
    assert_eq!(
        title_of(&written).as_deref(),
        Some("due righe e un controllo")
    );
    assert!(retitle(&source, "").is_err());
    assert!(retitle(&source, " \n\t \u{0} ").is_err());
}

#[test]
fn what_comes_before_the_root_is_kept_byte_for_byte() {
    let body = format!(
        "\n  <title>Vecchio</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"
    );
    let heads = [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
        "<?xml version=\"1.0\"?>\n<!-- generato <svg><title>Finto</title> -->\n",
        "<!-- una riga -->\n<!-- <title>Altro</title> -->\n",
        "\u{feff}<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"no\"?>\n<?stile tipo=\"x\"?>\n",
        "\u{feff}",
    ];
    for head in heads {
        let source = drawing(head, &body);
        let written = retitle(&source, "Nuovo").unwrap();
        assert_eq!(written, source.replace("Vecchio", "Nuovo"), "{head:?}");
        assert!(written.starts_with(head), "{head:?}");

        // Anche quando il titolo manca e va inserito.
        let bare = drawing(head, &body.replace("<title>Vecchio</title>\n  ", ""));
        let written = retitle(&bare, "Nuovo").unwrap();
        assert!(written.starts_with(head), "{head:?}");
        assert!(
            written.contains("\n  <title>Nuovo</title>\n  <rect"),
            "{written}"
        );
        assert_eq!(title_of(&written).as_deref(), Some("Nuovo"), "{head:?}");
    }
}

#[test]
fn a_comment_inside_the_root_does_not_fool_the_search() {
    let source = drawing(
        "",
        &format!("\n  <!-- <title>Finto</title> -->\n  <title>Vero</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"),
    );
    let written = retitle(&source, "Nuovo").unwrap();
    assert_eq!(
        written,
        source.replace("<title>Vero</title>", "<title>Nuovo</title>")
    );
    assert_eq!(title_of(&written).as_deref(), Some("Nuovo"));
}

#[test]
fn a_gt_inside_an_attribute_of_the_root_is_not_its_end() {
    let source = format!(
        "{}\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n</svg>\n",
        ROOT.replace("width=\"1600\"", "data-nota=\"a > b\" width=\"1600\"")
    );
    let written = retitle(&source, "Dentro").unwrap();
    assert!(
        written.starts_with(&ROOT.replace("width=\"1600\"", "data-nota=\"a > b\" width=\"1600\""))
    );
    assert_eq!(title_of(&written).as_deref(), Some("Dentro"));
}

#[test]
fn crlf_files_get_crlf_lines() {
    let source = new_document("a.svg")
        .replace("  <title>a</title>\n", "")
        .replace('\n', "\r\n");
    assert_eq!(title_of(&source), None);
    let written = retitle(&source, "Nuovo").unwrap();
    assert!(
        written.contains("\r\n  <title>Nuovo</title>\r\n  <rect"),
        "{written:?}"
    );
    assert!(!written.replace("\r\n", "").contains('\n'));
}

#[test]
fn layers_boards_and_objects_are_untouched() {
    let source = new_document("a.svg");
    let before = fub_scene::read(&source).unwrap();
    let written = retitle(&source, "Altro").unwrap();
    let after = fub_scene::read(&written).unwrap();
    assert_eq!(after.summary.layers, before.summary.layers);
    assert_eq!(after.summary.boards, before.summary.boards);
    assert_eq!(after.summary.counts, before.summary.counts);
    assert!(after.editable());
    assert!(after.diagnostics.is_empty(), "{:?}", after.diagnostics);
}

#[test]
fn what_cannot_be_retitled_is_an_error() {
    // Un SVG di un altro programma: non è una scena FubDraw.
    let foreign = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><title>Altro</title><rect width=\"10\" height=\"10\"/></svg>";
    assert!(retitle(foreign, "Nuovo").is_err());
    // Un doctype lo rende di sola lettura (S008): non se ne fa una copia.
    let doctype = drawing(
        "<!DOCTYPE svg>\n",
        &format!(
            "\n  <title>Vecchio</title>\n  {PAPER}\n  <g id=\"l1\" fub:layer=\"Livello 1\"></g>\n"
        ),
    );
    assert!(retitle(&doctype, "Nuovo").is_err());
    // Una versione che questo programma non sa leggere.
    let future = drawing("", "\n  <title>Vecchio</title>\n")
        .replace("fub:version=\"1\"", "fub:version=\"99\"");
    assert!(retitle(&future, "Nuovo").is_err());
    // Due id uguali.
    let duplicate = drawing(
        "",
        "\n  <title>Vecchio</title>\n  <g id=\"l1\" fub:layer=\"A\"></g>\n  <g id=\"l1\" fub:layer=\"B\"></g>\n",
    );
    assert!(retitle(&duplicate, "Nuovo").is_err());
    // Non è XML.
    assert!(retitle("<svg", "Nuovo").is_err());
    assert!(retitle("", "Nuovo").is_err());
    assert!(retitle("# Una nota\n", "Nuovo").is_err());
    // Il messaggio dice che cosa non va.
    let message = retitle(foreign, "Nuovo").unwrap_err().to_string();
    assert!(!message.is_empty());
}

#[test]
fn a_root_with_a_prefix_has_no_place_for_an_unprefixed_title() {
    let source = "<s:svg xmlns:s=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 10 10\">\n  <s:g id=\"l1\" fub:layer=\"Livello 1\"></s:g>\n</s:svg>\n".to_owned();
    // O non si riconosce come scena, o non si sa dove metterci il titolo: in
    // ogni caso non si scrive un file che non si rilegge come si chiede.
    match retitle(&source, "Nuovo") {
        Ok(written) => assert_eq!(title_of(&written).as_deref(), Some("Nuovo")),
        Err(error) => assert!(!error.to_string().is_empty()),
    }
}
