//! SVG veri, scritti da altri programmi: si leggono senza perdere un byte.
//!
//! I file di `tests/corpus/`:
//!
//! - `mermaid-flowchart.svg` e `mermaid-sequence.svg`: esportati da Mermaid
//!   11.4.2 (`@mermaid-js/mermaid-cli`), dai due diagrammi di
//!   `docs/architecture/overview.md` di Fub. Una riga sola, `<style>` con il
//!   CSS del tema, `foreignObject` con XHTML dentro.
//! - `chromium.svg`: un SVG scritto dentro una pagina HTML, con un cerchio
//!   aggiunto dal DOM, serializzato da Chromium 149 con `XMLSerializer`, come
//!   fa un editor web quando salva.
//! - `inkscape.svg`: ricostruito a mano sul formato di un salvataggio «SVG di
//!   Inkscape» di Inkscape 1.3.2: `sodipodi:namedview`, livelli
//!   `inkscape:groupmode`, una stella `sodipodi:type`, testo a righe
//!   `sodipodi:role="line"`, metadati RDF, un'immagine incorporata con il
//!   base64 a capo.
//! - `illustrator.svg`: ricostruito a mano sul formato di Adobe Illustrator
//!   con DTD: entità interne usate nei namespace (`xmlns="&ns_svg;"`),
//!   `switch` con il PGF, una sezione CDATA.
//!
//! Più l'icona di `apps/clipper`, che sta già nel repository.

mod common;

use common::load;
use fub_scene::{Code, Item, ReadOnly, Scene, Status};

const ICON: &str = include_str!("../../../apps/clipper/icons/icon.svg");
const FLOWCHART: &str = include_str!("corpus/mermaid-flowchart.svg");
const SEQUENCE: &str = include_str!("corpus/mermaid-sequence.svg");
const CHROMIUM: &str = include_str!("corpus/chromium.svg");
const INKSCAPE: &str = include_str!("corpus/inkscape.svg");
const ILLUSTRATOR: &str = include_str!("corpus/illustrator.svg");

const CORPUS: [(&str, &str); 6] = [
    ("icon", ICON),
    ("mermaid-flowchart", FLOWCHART),
    ("mermaid-sequence", SEQUENCE),
    ("chromium", CHROMIUM),
    ("inkscape", INKSCAPE),
    ("illustrator", ILLUSTRATOR),
];

/// Una riga per voce: il tipo, dove sta e che cosa è.
fn describe(scene: &Scene) -> Vec<String> {
    scene
        .items
        .iter()
        .map(|item| match item {
            Item::Root(_) => "root".to_owned(),
            Item::Element(element) => {
                format!(
                    "{:?} {}",
                    element.path,
                    serde_json::to_value(element.role)
                        .unwrap()
                        .as_str()
                        .unwrap()
                )
            }
            Item::Foreign(block) => match &block.parent_path {
                Some(path) => format!("{path:?} foreign {:?}", block.elements),
                None => format!("document foreign {:?}", block.elements),
            },
        })
        .collect()
}

#[test]
fn every_file_reads_without_loss_with_bom_and_crlf_too() {
    for (name, source) in CORPUS {
        let scene = load(source);
        let shape = describe(&scene);
        // Lo stesso file con il BOM e con CRLF: stesse voci, altri byte.
        let with_bom = format!("\u{feff}{source}");
        let with_crlf = source.replace('\n', "\r\n");
        for variant in [with_bom, with_crlf] {
            let other = load(&variant);
            assert_eq!(describe(&other), shape, "{name}");
            assert_eq!(other.read_only, scene.read_only, "{name}");
        }
    }
}

#[test]
fn the_icon_is_entirely_editable() {
    let scene = load(ICON);
    assert_eq!(scene.status, Status::Foreign);
    assert!(scene.read_only.is_empty());
    assert_eq!(
        describe(&scene),
        ["root", "[0] rect", "[1] path", "[2] circle"]
    );
    assert!(scene.diagnostics.is_empty());
}

#[test]
fn a_browser_export_keeps_what_it_can_edit() {
    let scene = load(CHROMIUM);
    assert_eq!(scene.status, Status::Foreign);
    assert!(scene.read_only.is_empty());
    assert_eq!(
        describe(&scene),
        [
            "root",
            "[0] title",
            "[1] desc",
            "[] foreign [2, 5]",
            "[5] group",
            "[5] foreign [0, 1]",
            "[5, 1] polyline",
            // Il `text` ha un `dy` in `em`: estraneo, insieme ai due `use`,
            // all'`a` verso un sito e al `foreignObject`.
            "[] foreign [6, 11]",
            "[11] image",
            "[] foreign [12, 13]",
            "[13] circle",
        ]
    );
}

#[test]
fn an_inkscape_file_keeps_its_layers_as_groups() {
    let scene = load(INKSCAPE);
    assert_eq!(scene.status, Status::Foreign);
    assert!(scene.read_only.is_empty());
    assert_eq!(
        describe(&scene),
        [
            "document foreign [0, 0]",
            "root",
            "[0] title",
            "[] foreign [1, 3]",
            "[3] group",
            "[3] foreign [0, 1]",
            "[4] group",
            "[4] foreign [0, 1]",
            "[4, 1] circle",
            "[4] foreign [2, 4]",
            "[4, 4] group",
            "[4, 4, 0] rect",
            "[4, 4] foreign [1, 2]",
            "[4] foreign [5, 6]",
            "[4, 6] image",
            "[] foreign [5, 7]",
        ]
    );
}

#[test]
fn an_illustrator_file_resolves_its_entities_and_stays_read_only() {
    let scene = load(ILLUSTRATOR);
    assert_eq!(scene.status, Status::Foreign);
    assert_eq!(scene.read_only, [ReadOnly::Doctype]);
    assert_eq!(
        describe(&scene),
        [
            "document foreign [0, 0]",
            "root",
            "[] foreign [0, 3]",
            "[3] group",
            "[3] foreign [0, 1]",
            "[3, 1] rect",
        ]
    );
    assert!(scene.diagnostics.iter().any(|d| d.code == Code::S008));
}

#[test]
fn mermaid_diagrams_are_mostly_foreign_and_whole() {
    for source in [FLOWCHART, SEQUENCE] {
        let scene = load(source);
        assert_eq!(scene.status, Status::Foreign);
        assert!(scene.read_only.is_empty());
    }
    // Il diagramma di flusso: lo stile, un gruppo di soli estranei (nodi,
    // archi, etichette in XHTML), poi i marcatori.
    assert_eq!(
        describe(&load(FLOWCHART)),
        [
            "root",
            "[] foreign [0, 1]",
            "[1] group",
            "[1] foreign [0, 13]",
            "[] foreign [2, 4]"
        ]
    );
    // Il diagramma di sequenza: i riquadri dei partecipanti, ognuno un gruppo
    // senza attributi con un rettangolo e un testo che usano `class`, poi
    // linee di vita, frecce e messaggi.
    let mut expected = vec!["root".to_owned()];
    for i in 0..10 {
        expected.push(format!("[{i}] group"));
        expected.push(format!("[{i}] foreign [0, 2]"));
    }
    expected.extend(["[] foreign [10, 11]", "[11] group", "[] foreign [12, 39]"].map(String::from));
    assert_eq!(describe(&load(SEQUENCE)), expected);
}
