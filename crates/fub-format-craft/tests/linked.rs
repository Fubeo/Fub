//! I file collegati di un documento Craft: i campi che si leggono, i percorsi
//! che si tengono e quelli che si scartano, i tetti, e il provider che li dà
//! al kernel come link incorporati.

use std::io::{Cursor, Read, Write};

use fub_abi::model::{DocumentModel, Link, LinkTarget, Span};
use fub_abi::{DocumentSource, FormatProvider, ParseContext};
use fub_format_craft::linked::{collect, LINK_KEYS, MAX_DEPTH, MAX_LINKS};
use fub_format_craft::{CraftApp, CraftProvider};
use serde_json::{json, Value};

/// Il disegno finto del piano: una foto piazzata in un livello.
const DRAWING: &str = r#"{"layers":[{"type":"image","href":"../Foto/mare.jpg"}]}"#;

fn paths_of(doc: &Value) -> Vec<String> {
    collect(doc)
}

/// Un documento con un solo campo `src` che vale `raw`.
fn one(raw: &str) -> Vec<String> {
    paths_of(&json!({ "src": raw }))
}

/// Uno ZIP di FigCraft con `document.json`, in Deflate.
fn figcraft_zip(document: &str) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("document.json", options).unwrap();
    writer.write_all(document.as_bytes()).unwrap();
    writer.finish().unwrap().into_inner()
}

fn embed(path: &str) -> Link {
    Link {
        target: LinkTarget::Path(path.to_owned()),
        embed: true,
        span: Span::EMPTY,
        context: None,
    }
}

fn model(app: CraftApp, doc: &str, bytes: Vec<u8>) -> DocumentModel {
    CraftProvider::new(app)
        .parse(&DocumentSource::Bytes(bytes), &ParseContext::bare(doc))
        .unwrap()
}

#[test]
fn la_foto_piazzata_in_un_disegno_è_un_collegato() {
    let doc: Value = serde_json::from_str(DRAWING).unwrap();
    assert_eq!(paths_of(&doc), ["../Foto/mare.jpg"]);
}

#[test]
fn ogni_campo_dei_collegati_si_legge_in_oggetti_e_array() {
    let doc = json!({
        "href": "a.png",
        "pages": [
            { "src": "b.png", "children": [{ "path": "c/d.png" }] },
            [{ "file": "e.psd" }, { "uri": "f.svg" }],
        ],
        "link": "g.pdf",
        // Il nome del campo si confronta così com'è scritto.
        "HREF": "no.png",
        "source": "no.png",
    });
    assert_eq!(
        paths_of(&doc),
        ["a.png", "b.png", "c/d.png", "e.psd", "f.svg", "g.pdf"]
    );
    assert_eq!(LINK_KEYS, ["href", "src", "path", "file", "uri", "link"]);
}

#[test]
fn l_ordine_è_quello_del_file_e_senza_doppioni() {
    let doc: Value = serde_json::from_str(
        r#"{"z":{"src":"z.png"},"a":{"src":"a.png"},"m":[{"href":"z.png"},{"href":"a.png#x"}]}"#,
    )
    .unwrap();
    assert_eq!(paths_of(&doc), ["z.png", "a.png"]);
}

#[test]
fn un_valore_vuoto_non_è_un_collegato() {
    assert!(one("").is_empty());
    assert!(one("   ").is_empty());
    assert!(one("#solo-frammento").is_empty());
    assert!(one("?solo=query").is_empty());
}

#[test]
fn frammento_e_query_si_tolgono() {
    assert_eq!(one("foto.png#livello-2"), ["foto.png"]);
    assert_eq!(one("foto.png?v=3"), ["foto.png"]);
    assert_eq!(one("foto.png?v=3#a"), ["foto.png"]);
    assert_eq!(one("foto.png#a?v=3"), ["foto.png"]);
}

#[test]
fn il_percorso_si_tiene_com_è_scritto() {
    // Il kernel decodifica `%20` quando risolve il link.
    assert_eq!(one("Foto/mare%20blu.jpg"), ["Foto/mare%20blu.jpg"]);
    assert_eq!(one("../Foto/mare.jpg"), ["../Foto/mare.jpg"]);
    assert_eq!(one("./mare.jpg"), ["./mare.jpg"]);
    // Spazi e controlli intorno, a capo dentro: come li legge un URL.
    assert_eq!(one("  mare.jpg\n"), ["mare.jpg"]);
    assert_eq!(one("Fo\nto/ma\tre.jpg"), ["Foto/mare.jpg"]);
    // Un `:` dopo una barra non fa uno schema.
    assert_eq!(one("cartella/nota:1.png"), ["cartella/nota:1.png"]);
}

#[test]
fn assoluti_e_url_si_scartano() {
    for raw in [
        "data:image/png;base64,iVBORw0KGgo=",
        "https://example.com/mare.jpg",
        "http://example.com/mare.jpg",
        "HTTPS://example.com/mare.jpg",
        "file:///home/a/mare.jpg",
        "file:mare.jpg",
        "C:\\Foto\\a.jpg",
        "c:/Foto/a.jpg",
        "mailto:a@example.com",
        "x-app+v2.1:qualcosa",
        "/home/a/mare.jpg",
        "//host/mare.jpg",
        "\\\\server\\Foto\\a.jpg",
        "\\Foto\\a.jpg",
        "nota:1.png",
    ] {
        assert!(one(raw).is_empty(), "{raw:?} non va tenuto");
    }
}

#[test]
fn un_campo_che_non_è_una_stringa_non_è_un_collegato() {
    let doc = json!({
        "src": 3,
        "href": null,
        "path": true,
        "file": ["dentro.png"],
        "uri": { "src": "sotto.png" },
    });
    // Il valore che non è una stringa non vale, nemmeno un array di stringhe;
    // ma gli oggetti che contiene si guardano.
    assert_eq!(paths_of(&doc), ["sotto.png"]);
}

#[test]
fn al_massimo_mille_collegati() {
    let layers: Vec<Value> = (0..=MAX_LINKS)
        .map(|n| json!({ "src": format!("foto-{n}.png") }))
        .collect();
    assert_eq!(layers.len(), 1001);
    let found = paths_of(&json!({ "layers": layers }));
    assert_eq!(found.len(), MAX_LINKS);
    assert_eq!(found.first().map(String::as_str), Some("foto-0.png"));
    assert_eq!(found.last().map(String::as_str), Some("foto-999.png"));

    // I doppioni non contano nel tetto.
    let mut repeated: Vec<Value> = (0..2000).map(|_| json!({ "src": "uguale.png" })).collect();
    repeated.push(json!({ "src": "ultima.png" }));
    assert_eq!(
        paths_of(&json!({ "layers": repeated })),
        ["uguale.png", "ultima.png"]
    );
}

/// Un JSON di `levels` oggetti uno dentro l'altro, con `href` nell'ultimo.
fn nested(levels: usize) -> Value {
    let mut value = json!({ "href": "fondo.png" });
    for _ in 1..levels {
        value = json!({ "child": value });
    }
    value
}

/// Lo stesso con array uno dentro l'altro, costruito a mano: così la
/// profondità può superare quella che `serde_json` legge da un testo.
fn nested_arrays(levels: usize) -> Value {
    let mut value = json!({ "href": "fondo.png" });
    for _ in 1..levels {
        value = Value::Array(vec![value]);
    }
    value
}

#[test]
fn al_massimo_sessantaquattro_livelli() {
    assert_eq!(MAX_DEPTH, 64);
    assert_eq!(paths_of(&nested(64)), ["fondo.png"]);
    assert!(paths_of(&nested(65)).is_empty());
    assert_eq!(paths_of(&nested_arrays(64)), ["fondo.png"]);
    assert!(paths_of(&nested_arrays(65)).is_empty());

    // Letto dal testo, come arriva da un file.
    let text = format!(
        "{}{{\"href\":\"fondo.png\"}}{}",
        "{\"a\":".repeat(64),
        "}".repeat(64)
    );
    let deep: Value = serde_json::from_str(&text).unwrap();
    assert!(paths_of(&deep).is_empty());
}

#[test]
fn un_documento_molto_profondo_non_fa_traboccare_lo_stack() {
    // Molto oltre ciò che `serde_json` accetta da un testo: l'attraversamento
    // si ferma al livello 64 e non scende oltre.
    let deep = nested_arrays(20_000);
    assert!(paths_of(&deep).is_empty());
    // Il valore si smonta a pezzi, senza ricorsione.
    let mut value = deep;
    while let Value::Array(mut items) = value {
        value = items.pop().unwrap_or(Value::Null);
    }
}

#[test]
fn un_progetto_di_figcraft_nello_zip() {
    let document = r#"{"version":2,"pages":[{"frames":[{"name":"Copertina","fills":[{"type":"image","src":"Immagini/copertina.png"}]},{"link":"https://example.com"}]}]}"#;
    let bytes = figcraft_zip(document);
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut text = String::new();
    archive
        .by_name("document.json")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    let doc: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(paths_of(&doc), ["Immagini/copertina.png"]);
}

#[test]
fn il_provider_dà_i_collegati_di_un_disegno_come_link_incorporati() {
    let model = model(
        CraftApp::VectorCraft,
        "Disegni/logo.vectorcraft",
        DRAWING.as_bytes().to_vec(),
    );
    assert_eq!(model.links, [embed("../Foto/mare.jpg")]);
}

#[test]
fn il_provider_dà_i_collegati_di_un_progetto_di_figcraft() {
    let document = r#"{"pages":[{"src":"Immagini/a.png"},{"href":"data:image/png;base64,AA=="},{"file":"Immagini/b.png#x"}]}"#;
    let model = model(
        CraftApp::FigCraft,
        "Progetti/sito.figcraft",
        figcraft_zip(document),
    );
    assert_eq!(
        model.links,
        [embed("Immagini/a.png"), embed("Immagini/b.png")]
    );
}

#[test]
fn il_provider_legge_i_collegati_dal_testo_con_le_stesse_regole() {
    // Il provider non costruisce il documento: legge i collegati mentre
    // attraversa il testo. Livelli, tetto e doppioni sono quelli di `collect`.
    let layers: Vec<Value> = (0..=MAX_LINKS)
        .map(|n| json!({ "src": format!("foto-{n}.png"), "child": [{ "href": "foto-0.png" }] }))
        .collect();
    let documents = [
        nested(64),
        nested(65),
        nested_arrays(64),
        nested_arrays(65),
        json!({ "layers": layers }),
        json!([{ "src": "a.png" }, [{ "file": "b.png" }], { "uri": 3, "link": "/disco.png" }]),
    ];
    for document in documents {
        let text = serde_json::to_vec(&document).unwrap();
        let expected: Vec<Link> = collect(&document).iter().map(|p| embed(p)).collect();
        let drawing = model(CraftApp::VectorCraft, "logo.vectorcraft", text.clone());
        assert_eq!(drawing.links, expected);
        let project = model(
            CraftApp::FigCraft,
            "sito.figcraft",
            figcraft_zip(std::str::from_utf8(&text).unwrap()),
        );
        assert_eq!(project.links, expected);
    }
}
