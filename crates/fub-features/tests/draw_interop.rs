//! L'export dei disegni verso Excalidraw e draw.io (`fub.draw`): le forme
//! escono modificabili, agganci ed etichette compresi, ciò che non ha una
//! forma esce come immagine, e il log dice ciò che cambia.

#![cfg(feature = "draw")]

use std::fs;
use std::path::Path;

use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
use fub_abi::model::DocId;
use fub_abi::transfer::{ExportProvider, ExportReport, ExportRequest, ExportSelection, MemorySink};
use fub_features::{DrawioExport, ExcalidrawExport, DRAW_DRAWIO, DRAW_EXCALIDRAW};
use fub_sdk::testing::MemoryHost;
use resvg::usvg::roxmltree;
use serde_json::{json, Value};

fn host() -> MemoryHost {
    MemoryHost::new().with_format(
        "svg",
        DocumentFormat {
            descriptor: FormatDescriptor::text("svg", "Drawing", &["svg"]),
            capabilities: FormatCapabilities::default(),
        },
    )
}

fn read(path: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn scena() -> String {
    read("tests/fixtures/draw/scena.svg")
}

fn diagram() -> String {
    read("templates/diagram.it.svg")
}

fn quaderno() -> String {
    read("../fub-format-svg/tests/fixtures/boards.svg")
}

fn export(
    provider: &dyn ExportProvider,
    host: &MemoryHost,
    target: &str,
    doc: &str,
    options: Value,
) -> ExportReport {
    let request = ExportRequest::new(target, ExportSelection::Documents(vec![DocId::new(doc)]))
        .with_options(options);
    provider
        .export(&request, host, &mut MemorySink::default())
        .unwrap()
}

fn artifacts(report: &ExportReport) -> Vec<(String, String)> {
    report
        .artifacts
        .iter()
        .map(|artifact| {
            let bytes = artifact.as_bytes().expect("in memoria").to_vec();
            (
                artifact.path.clone(),
                String::from_utf8(bytes).expect("UTF-8"),
            )
        })
        .collect()
}

fn messages(report: &ExportReport) -> Vec<String> {
    report.log.iter().map(|note| note.message.clone()).collect()
}

fn excalidraw(host: &MemoryHost, doc: &str, options: Value) -> (Value, ExportReport) {
    let report = export(&ExcalidrawExport, host, DRAW_EXCALIDRAW, doc, options);
    let files = artifacts(&report);
    assert_eq!(files.len(), 1, "{:?}", report.log);
    (serde_json::from_str(&files[0].1).unwrap(), report)
}

fn element<'v>(file: &'v Value, id: &str) -> &'v Value {
    file["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|element| element["id"] == id)
        .unwrap_or_else(|| panic!("{id} manca"))
}

#[test]
fn the_shapes_of_a_scene_become_excalidraw_shapes() {
    let host = host().with_document("acqua.svg", &scena());
    let (file, report) = excalidraw(&host, "acqua.svg", Value::Null);
    assert_eq!(report.artifacts[0].path, "acqua.excalidraw");
    assert_eq!(file["type"], "excalidraw");
    assert_eq!(file["appState"]["viewBackgroundColor"], "#ffffff");

    let ellipse = element(&file, "o1a2b3c4d");
    assert_eq!(ellipse["type"], "ellipse");
    assert_eq!(
        [
            &ellipse["x"],
            &ellipse["y"],
            &ellipse["width"],
            &ellipse["height"]
        ],
        [&json!(30.0), &json!(35.0), &json!(100.0), &json!(50.0)]
    );
    assert_eq!(ellipse["strokeColor"], "#0072b2");
    assert_eq!(ellipse["strokeWidth"], 4.0);
    assert_eq!(ellipse["backgroundColor"], "transparent");

    // Il riempimento trasparente resta nel colore, il tratteggio diventa
    // quello di Excalidraw, gli angoli tondi restano.
    let rect = element(&file, "o2r3e4t5t");
    assert_eq!(rect["type"], "rectangle");
    assert_eq!(rect["backgroundColor"], "#e69f0099");
    assert_eq!(rect["strokeStyle"], "dashed");
    assert_eq!(rect["roundness"]["value"], 8.0);

    let arrow = element(&file, "o5e6f7g8h");
    assert_eq!(arrow["type"], "arrow");
    assert_eq!(arrow["points"], json!([[0.0, 0.0], [120.0, 90.0]]));
    assert_eq!(arrow["endArrowhead"], "arrow");
    assert_eq!(arrow["startArrowhead"], Value::Null);

    let line = element(&file, "o6p7o8l9y");
    assert_eq!(line["type"], "line");
    assert_eq!(line["points"].as_array().unwrap().len(), 4);

    let text = element(&file, "o3l4i5t6e");
    assert_eq!(text["type"], "text");
    assert_eq!(text["text"], "Pioggia");
    assert_eq!(text["fontSize"], 16.0);
    let lines = element(&file, "o9i0j1k2l");
    assert_eq!(lines["text"], "Evaporazione\nCittà, perché?");
    assert_eq!(element(&file, "o7m8o9n0o")["fontFamily"], 3, "monospazio");

    // L'immagine incorporata resta un PNG; lo sfumato e il tratto a mano
    // libera escono come SVG.
    let image = element(&file, "o1i2m3g4p");
    assert_eq!(image["type"], "image");
    let png = &file["files"][image["fileId"].as_str().unwrap()];
    assert_eq!(png["mimeType"], "image/png");
    assert!(png["dataURL"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    for id in ["o0c1e2l3o", "o7k2m9x4q"] {
        let picture = element(&file, id);
        assert_eq!(picture["type"], "image", "{id}");
        let data = &file["files"][picture["fileId"].as_str().unwrap()];
        assert_eq!(data["mimeType"], "image/svg+xml", "{id}");
    }

    let log = messages(&report);
    assert!(
        log.iter()
            .any(|m| m.starts_with("2 objects") && m.contains("pictures")),
        "{log:?}"
    );
    assert!(
        log.iter().any(|m| m.contains("Helvetica or Cascadia")),
        "{log:?}"
    );
    assert!(log.iter().any(|m| m.contains("1 dash pattern")), "{log:?}");
    assert!(
        log.iter().any(|m| m.contains("first part")),
        "il grassetto: {log:?}"
    );
}

#[test]
fn connectors_and_labels_stay_bound_in_excalidraw() {
    let host = host().with_document("flusso.svg", &diagram());
    let (file, report) = excalidraw(&host, "flusso.svg", Value::Null);

    // Il connettore nomina il gruppo: si aggancia alla sua forma.
    let arrow = element(&file, "olink1001");
    assert_eq!(arrow["startBinding"]["elementId"], "oinizio01");
    assert_eq!(arrow["endBinding"]["elementId"], "opasso001");
    assert_eq!(arrow["endArrowhead"], "triangle");

    let start = element(&file, "oinizio01");
    assert_eq!(start["groupIds"], json!(["oinizio02"]));
    let bound = start["boundElements"].as_array().unwrap();
    assert!(
        bound.contains(&json!({ "type": "text", "id": "oinizio03" })),
        "{bound:?}"
    );
    assert!(
        bound.contains(&json!({ "type": "arrow", "id": "olink1001" })),
        "{bound:?}"
    );

    let label = element(&file, "oinizio03");
    assert_eq!(label["containerId"], "oinizio01");
    assert_eq!(label["text"], "Inizio");
    assert_eq!(label["textAlign"], "center");

    assert_eq!(element(&file, "oscelta01")["type"], "diamond");
    assert_eq!(element(&file, "osi000001")["containerId"], "olink3001");
    let elbow = element(&file, "olink5001");
    assert_eq!(elbow["points"].as_array().unwrap().len(), 3);

    assert!(
        !messages(&report).iter().any(|m| m.contains("pictures")),
        "{:?}",
        report.log
    );
}

fn drawio(host: &MemoryHost, doc: &str, options: Value) -> (Vec<(String, String)>, ExportReport) {
    let report = export(&DrawioExport, host, DRAW_DRAWIO, doc, options);
    (artifacts(&report), report)
}

fn cell<'a, 'i>(doc: &'a roxmltree::Document<'i>, id: &str) -> roxmltree::Node<'a, 'i> {
    doc.descendants()
        .find(|node| node.has_tag_name("mxCell") && node.attribute("id") == Some(id))
        .unwrap_or_else(|| panic!("{id} manca"))
}

#[test]
fn a_diagram_becomes_draw_io_cells_with_connected_edges() {
    let host = host().with_document("flusso.svg", &diagram());
    let (files, report) = drawio(&host, "flusso.svg", Value::Null);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].0, "flusso.drawio");
    let doc = roxmltree::Document::parse(&files[0].1).unwrap();
    assert_eq!(doc.root_element().tag_name().name(), "mxfile");
    let diagrams: Vec<_> = doc
        .descendants()
        .filter(|node| node.has_tag_name("diagram"))
        .collect();
    assert_eq!(diagrams.len(), 1);
    assert_eq!(diagrams[0].attribute("name"), Some("flusso"));

    let layer = cell(&doc, "llivello1");
    assert_eq!(layer.attribute("parent"), Some("0"));
    assert_eq!(layer.attribute("value"), Some("Livello 1"));

    let start = cell(&doc, "oinizio01");
    assert_eq!(start.attribute("value"), Some("Inizio"));
    assert_eq!(start.attribute("vertex"), Some("1"));
    assert_eq!(start.attribute("parent"), Some("llivello1"));
    let style = start.attribute("style").unwrap();
    assert!(
        style.starts_with("rounded=1;absoluteArcSize=1;arcSize=60;"),
        "{style}"
    );
    assert!(
        style.contains("strokeColor=#000000;strokeWidth=4;"),
        "{style}"
    );
    let geometry = start.first_element_child().unwrap();
    assert_eq!(
        ["x", "y", "width", "height"].map(|key| geometry.attribute(key).unwrap()),
        ["320", "380", "160", "60"]
    );

    assert!(cell(&doc, "oscelta01")
        .attribute("style")
        .unwrap()
        .starts_with("rhombus;"));

    let edge = cell(&doc, "olink1001");
    assert_eq!(edge.attribute("edge"), Some("1"));
    assert_eq!(edge.attribute("source"), Some("oinizio01"));
    assert_eq!(edge.attribute("target"), Some("opasso001"));
    let style = edge.attribute("style").unwrap();
    assert!(style.contains("endArrow=block;endFill=1;"), "{style}");
    assert!(
        style.contains("exitX=1;exitY=0.5;entryX=0;entryY=0.5;"),
        "{style}"
    );
    assert_eq!(cell(&doc, "olink3001").attribute("value"), Some("Sì"));
    let elbow = cell(&doc, "olink5001");
    let waypoints: Vec<_> = elbow
        .descendants()
        .filter(|node| node.has_tag_name("mxPoint") && node.attribute("as").is_none())
        .collect();
    assert_eq!(waypoints.len(), 1);

    // Le etichette non restano anche come testi liberi.
    assert!(!doc
        .descendants()
        .any(|node| node.attribute("id") == Some("oinizio03")));
    let log = messages(&report);
    assert!(
        log.iter().any(|m| m.contains("groups were dissolved")),
        "{log:?}"
    );
}

#[test]
fn boards_become_pages_in_draw_io_and_frames_in_excalidraw() {
    let host = host().with_document("quaderno.svg", &quaderno());
    let (files, report) = drawio(
        &host,
        "quaderno.svg",
        json!({ "scope": "boards", "boards": ["b00000001", "b00000002"] }),
    );
    assert_eq!(files.len(), 1, "{:?}", report.log);
    assert_eq!(files[0].0, "quaderno.drawio");
    let doc = roxmltree::Document::parse(&files[0].1).unwrap();
    let names: Vec<_> = doc
        .descendants()
        .filter(|node| node.has_tag_name("diagram"))
        .map(|node| node.attribute("name").unwrap().to_string())
        .collect();
    assert_eq!(names.len(), 2);
    assert_eq!(names[0], "Copertina");
    // Il collegamento resta, su un `UserObject`.
    let linked = doc
        .descendants()
        .find(|node| node.has_tag_name("UserObject"))
        .unwrap();
    assert_eq!(linked.attribute("link"), Some("../note/Porto.md"));
    assert_eq!(linked.attribute("label"), Some("Il porto"));

    // Il disegno intero su una pagina sola lo dice.
    let (_, whole) = drawio(&host, "quaderno.svg", Value::Null);
    assert!(
        messages(&whole)
            .iter()
            .any(|m| m.contains("4 boards are on one page")),
        "{:?}",
        whole.log
    );

    let (file, _) = excalidraw(&host, "quaderno.svg", Value::Null);
    let frame = element(&file, "b00000002");
    assert_eq!(frame["type"], "frame");
    assert_eq!(frame["x"], 700.0);
    assert_eq!(element(&file, "o3c4d5e6f")["frameId"], "b00000002");
    assert_eq!(element(&file, "o3c4d5e6f")["link"], "../note/Porto.md");
    assert_eq!(element(&file, "o1a2b3c4d")["frameId"], "b00000001");
}

#[test]
fn hidden_things_are_left_out_and_said() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 200 100" width="400" height="200">
  <g id="l1" fub:layer="Sopra">
    <rect id="r1" x="10" y="10" width="40" height="20" fill="#ff0000" transform="rotate(90 30 20)"/>
    <rect id="r2" x="60" y="10" width="40" height="20" fill="#00ff00" display="none"/>
  </g>
  <g id="l2" fub:layer="Sotto" display="none">
    <rect id="r3" x="10" y="50" width="40" height="20" fill="#0000ff"/>
  </g>
</svg>"##;
    let host = host().with_document("prova.svg", svg);
    let (file, report) = excalidraw(&host, "prova.svg", Value::Null);
    // Le unità sono quelle del disegno, non i pixel della sua misura; la
    // rotazione resta.
    let rect = element(&file, "r1");
    assert_eq!(
        [&rect["x"], &rect["y"], &rect["width"], &rect["height"]],
        [&json!(10.0), &json!(10.0), &json!(40.0), &json!(20.0)]
    );
    assert!((rect["angle"].as_f64().unwrap() - std::f64::consts::FRAC_PI_2).abs() < 1e-4);
    assert_eq!(file["elements"].as_array().unwrap().len(), 1);
    assert!(
        messages(&report)
            .iter()
            .any(|m| m.contains("2 hidden objects or layers")),
        "{:?}",
        report.log
    );
    assert_eq!(file["appState"]["viewBackgroundColor"], "transparent");

    let (files, _) = drawio(&host, "prova.svg", Value::Null);
    let doc = roxmltree::Document::parse(&files[0].1).unwrap();
    assert!(cell(&doc, "r1")
        .attribute("style")
        .unwrap()
        .contains("rotation=90;"));
}

#[test]
fn the_same_drawing_gives_the_same_bytes() {
    let host = host()
        .with_document("acqua.svg", &scena())
        .with_document("flusso.svg", &diagram());
    for doc in ["acqua.svg", "flusso.svg"] {
        for (provider, target) in [
            (&ExcalidrawExport as &dyn ExportProvider, DRAW_EXCALIDRAW),
            (&DrawioExport, DRAW_DRAWIO),
        ] {
            let first = artifacts(&export(provider, &host, target, doc, Value::Null));
            let second = artifacts(&export(provider, &host, target, doc, Value::Null));
            assert_eq!(first, second, "{target} {doc}");
        }
    }
}
