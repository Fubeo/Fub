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
    // Non ha un titolo: l'icona di un'estensione non ne ha bisogno, un
    // disegno sì.
    let codes: Vec<_> = scene.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(codes, [Code::S001]);
    // Il rettangolo arrotondato contiene il resto.
    let summary = &scene.summary;
    assert_eq!(summary.counts.shapes, 3);
    let bbox = summary.bbox.unwrap();
    assert_eq!(
        [bbox.x, bbox.y, bbox.width, bbox.height],
        [14.0, 14.0, 100.0, 100.0]
    );
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
            // La `defs` tiene un gradiente modificabile e un `symbol`
            // estraneo; il `style` è estraneo, e il rettangolo che usa il
            // gradiente no.
            "[2] defs",
            "[2, 0] resource",
            "[2] foreign [1, 2]",
            "[] foreign [3, 4]",
            "[4] rect",
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
            "[] foreign [1, 2]",
            // I gradienti di Inkscape hanno i colori in `style` e si rimandano
            // con `xlink:href`: estranei, dentro una `defs` che resta un
            // contenitore.
            "[2] defs",
            "[2] foreign [0, 2]",
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
    // archi, etichette in XHTML), poi due `defs` con un'ombra ciascuna, un
    // filtro modificabile.
    assert_eq!(
        describe(&load(FLOWCHART)),
        [
            "root",
            "[] foreign [0, 1]",
            "[1] group",
            "[1] foreign [0, 13]",
            "[2] defs",
            "[2, 0] resource",
            "[3] defs",
            "[3, 0] resource",
        ]
    );
    // Il diagramma di sequenza: i riquadri dei partecipanti, ognuno un gruppo
    // senza attributi con un rettangolo e un testo che usano `class`; poi
    // una `defs` per ogni simbolo, estraneo, e per ogni punta di freccia, un
    // marcatore modificabile tranne quella con lo `style`; infine linee di
    // vita, frecce e messaggi.
    let mut expected = vec!["root".to_owned()];
    for i in 0..10 {
        expected.push(format!("[{i}] group"));
        expected.push(format!("[{i}] foreign [0, 2]"));
    }
    expected.extend(["[] foreign [10, 11]", "[11] group"].map(String::from));
    for i in 12..23 {
        expected.push(format!("[{i}] defs"));
        expected.push(if i < 15 || i == 16 {
            format!("[{i}] foreign [0, 1]")
        } else {
            format!("[{i}, 0] resource")
        });
    }
    expected.push("[] foreign [23, 39]".to_owned());
    assert_eq!(describe(&load(SEQUENCE)), expected);
}

/// I testi dell'indice di un file.
fn texts(scene: &Scene) -> Vec<&str> {
    scene.index.texts.iter().map(|t| t.text.as_str()).collect()
}

#[test]
fn the_index_reads_foreign_files_too() {
    // Ciò che FubDraw non modifica si cerca lo stesso.
    let scene = load(CHROMIUM);
    let index = &scene.index;
    assert_eq!(index.title.as_ref().unwrap().text, "Pianta del giardino");
    assert_eq!(
        index.desc.as_ref().unwrap().text,
        "Aiuole & sentieri, disegnati a mano"
    );
    // Lo spazio indivisibile resta: non è uno spazio XML.
    assert_eq!(
        texts(&scene),
        ["Giardini <pubblici> \u{a0}— “guida”", "Riga uno Riga due"]
    );
    // Le righe di Inkscape sono `tspan` con `sodipodi:role="line"`.
    let scene = load(INKSCAPE);
    assert_eq!(scene.index.title.as_ref().unwrap().text, "Giardino");
    assert_eq!(
        texts(&scene),
        ["Aiuola delle rose e dei gerani", "Da potare in marzo"]
    );
    // Illustrator: il riferimento a carattere è risolto, il titolo manca.
    let scene = load(ILLUSTRATOR);
    assert!(scene.index.title.is_none());
    assert_eq!(texts(&scene), ["Etichetta — prova"]);
    assert!(scene.diagnostics.iter().any(|d| d.code == Code::S001));
    // Le etichette del diagramma di flusso sono XHTML, non `text`; quelle
    // del diagramma di sequenza sì: i partecipanti due volte, poi i messaggi.
    assert!(load(FLOWCHART).index.texts.is_empty());
    let scene = load(SEQUENCE);
    let found = texts(&scene);
    assert_eq!(found.len(), 18);
    assert_eq!(found[0], "Provider");
    assert_eq!(found[17], "payload IPC");
}
