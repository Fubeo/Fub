//! L'export delle annotazioni dei PDF: il PDF annotato e il PDF redatto.
//!
//! I PDF si costruiscono qui con `lopdf`, così ogni prova dice che cosa c'è
//! dentro: un testo per pagina, un commento del PDF, un titolo nei metadati.
//! Le prove guardano il file che esce come lo guarda un lettore: rilette con
//! `lopdf`, e cercando nei flussi decompressi il testo che la redazione deve
//! aver tolto.

#![cfg(feature = "draw")]

use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
use fub_abi::model::DocId;
use fub_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportSelection, MemorySink, NoteLevel,
};
use fub_abi::PluginError;
use fub_features::{AnnotatedPdfExport, RedactedPdfExport, DRAW_ANNOTATED_PDF, DRAW_REDACTED_PDF};
use fub_sdk::testing::MemoryHost;
use lopdf::{
    dictionary, Dictionary, Document, EncryptionState, EncryptionVersion, Object, ObjectId,
    Permissions, Stream, StringFormat,
};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Il banco
// ---------------------------------------------------------------------------

const PDF: &str = "Gare/Bando.pdf";
const ANNOTATIONS: &str = "Gare/Bando.pdf.fubann";

/// Un PDF di pagine 612 × 792 con un testo per pagina, due annotazioni del
/// PDF sulla prima e un titolo nei metadati. Le annotazioni non hanno un
/// aspetto scritto: il commento pdf.js non lo disegna sulla pagina, il
/// riquadro sì, con un aspetto suo.
fn source_document(texts: &[&str]) -> Document {
    let mut doc = Document::with_version("1.4");
    let pages = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let resources = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font } });
    let mut kids = Vec::new();
    for (index, text) in texts.iter().enumerate() {
        let content = format!("BT /F1 24 Tf 72 700 Td ({text}) Tj ET");
        let content = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
        let mut page = dictionary! {
            "Type" => "Page",
            "Parent" => pages,
            "Contents" => content,
            "Resources" => resources,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        };
        if index == 0 {
            let comment = doc.add_object(dictionary! {
                "Type" => "Annot",
                "Subtype" => "Text",
                "Rect" => vec![300.into(), 300.into(), 320.into(), 320.into()],
                "Contents" => Object::String(b"SEGRETO nel commento".to_vec(), StringFormat::Literal),
            });
            let square = doc.add_object(dictionary! {
                "Type" => "Annot",
                "Subtype" => "Square",
                "Rect" => vec![400.into(), 400.into(), 500.into(), 450.into()],
                "Contents" => Object::String(b"SEGRETO nel riquadro".to_vec(), StringFormat::Literal),
            });
            page.set(
                "Annots",
                vec![Object::Reference(comment), Object::Reference(square)],
            );
        }
        kids.push(Object::Reference(doc.add_object(page)));
    }
    let count = kids.len() as i64;
    doc.objects.insert(
        pages,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    let info = doc.add_object(dictionary! {
        "Title" => Object::String(b"SEGRETO nel titolo".to_vec(), StringFormat::Literal),
    });
    doc.trailer.set("Root", catalog);
    doc.trailer.set("Info", info);
    let id = Object::String(vec![0x42; 16], StringFormat::Hexadecimal);
    doc.trailer.set("ID", vec![id.clone(), id]);
    doc
}

fn save(mut doc: Document) -> Vec<u8> {
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn source_pdf() -> Vec<u8> {
    save(source_document(&["SEGRETO", "PUBBLICO"]))
}

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// Le annotazioni del PDF: una copertura sul testo della prima pagina e una
/// nota sulla seconda.
fn annotations(root: &str) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\"{root}>\
         <g id=\"p0001\" fub:page=\"1\" fub:page-size=\"612 792\"><rect x=\"60\" y=\"60\" width=\"220\" height=\"50\" fill=\"#000000\"/></g>\
         <g id=\"p0002\" fub:page=\"2\" fub:page-size=\"612 792\"><text id=\"n1\" x=\"72\" y=\"200\" font-size=\"14\" fub:note=\"Da verificare&#10;con l'ufficio\">Verifica</text></g>\
         </svg>"
    )
}

fn anchored(pdf: &[u8]) -> String {
    annotations(&format!(" fub:digest=\"{}\" fub:pages=\"2\"", digest(pdf)))
}

fn host(pdf: &[u8], annotations: &str) -> MemoryHost {
    MemoryHost::new()
        .with_format(
            "fubann",
            DocumentFormat {
                descriptor: FormatDescriptor::text("fubann", "PDF annotations", &["fubann"]),
                capabilities: FormatCapabilities::default(),
            },
        )
        .with_binary_document(PDF, pdf)
        .with_document(ANNOTATIONS, annotations)
}

fn export(
    provider: &dyn ExportProvider,
    host: &MemoryHost,
    target: &str,
    docs: &[&str],
    options: serde_json::Value,
) -> Result<ExportReport, PluginError> {
    let request = ExportRequest::new(
        target,
        ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
    )
    .with_options(options);
    provider.export(&request, host, &mut MemorySink::default())
}

fn annotated(host: &MemoryHost) -> Result<ExportReport, PluginError> {
    export(
        &AnnotatedPdfExport,
        host,
        DRAW_ANNOTATED_PDF,
        &[ANNOTATIONS],
        serde_json::Value::Null,
    )
}

fn redacted(host: &MemoryHost) -> Result<ExportReport, PluginError> {
    export(
        &RedactedPdfExport,
        host,
        DRAW_REDACTED_PDF,
        &[ANNOTATIONS],
        serde_json::Value::Null,
    )
}

fn only_artifact(report: &ExportReport) -> (String, Vec<u8>) {
    assert_eq!(report.artifacts.len(), 1, "{:?}", report.log);
    let artifact = &report.artifacts[0];
    (
        artifact.path.clone(),
        artifact.as_bytes().expect("in memoria").to_vec(),
    )
}

fn error_key(error: &PluginError) -> String {
    match error {
        PluginError::BadArgs(text) => text.as_message().expect("un messaggio").key.clone(),
        other => panic!("non un BadArgs: {other:?}"),
    }
}

fn messages(report: &ExportReport, level: NoteLevel) -> Vec<String> {
    report
        .log
        .iter()
        .filter(|note| note.level == level)
        .map(|note| note.message.clone())
        .collect()
}

fn page_ids(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

fn dict<'a>(doc: &'a Document, value: &'a Object) -> &'a Dictionary {
    match value {
        Object::Reference(id) => doc.get_dictionary(*id).unwrap(),
        Object::Dictionary(dict) => dict,
        other => panic!("non un dizionario: {other:?}"),
    }
}

/// Tutto il testo del file: i byte, ogni flusso decompresso e ogni stringa,
/// in chiaro.
fn everything(bytes: &[u8]) -> Vec<u8> {
    let doc = Document::load_mem(bytes).unwrap();
    let mut all = bytes.to_vec();
    for object in doc.objects.values() {
        match object {
            Object::Stream(stream) => {
                all.extend(
                    stream
                        .decompressed_content()
                        .unwrap_or_else(|_| stream.content.clone()),
                );
            }
            Object::String(text, _) => all.extend(text),
            Object::Dictionary(dict) => {
                for (_, value) in dict.iter() {
                    if let Object::String(text, _) = value {
                        all.extend(text);
                    }
                }
            }
            _ => {}
        }
    }
    all
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}

// ---------------------------------------------------------------------------
// Il PDF annotato
// ---------------------------------------------------------------------------

#[test]
fn the_annotated_pdf_is_the_original_with_an_update() {
    let pdf = source_pdf();
    let host = host(&pdf, &anchored(&pdf));
    let report = annotated(&host).unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "Gare/Bando (annotated).pdf");
    // L'originale resta intero, byte per byte, in testa.
    assert!(bytes.starts_with(&pdf));
    assert!(bytes.len() > pdf.len());

    let doc = Document::load_mem(&bytes).unwrap();
    // Il livello delle annotazioni, col nome del file perché non hanno un
    // titolo.
    let catalog = doc.catalog().unwrap();
    let properties = dict(&doc, catalog.get(b"OCProperties").unwrap());
    let groups = properties.get(b"OCGs").unwrap().as_array().unwrap();
    let layer = groups.last().unwrap().as_reference().unwrap();
    let name = doc.get_dictionary(layer).unwrap().get(b"Name").unwrap();
    assert_eq!(name.as_str().unwrap(), b"Bando.pdf.fubann");

    let pages = page_ids(&doc);
    // La prima pagina disegna lo XObject delle annotazioni, nel livello.
    let first = doc.get_dictionary(pages[0]).unwrap();
    let resources = dict(&doc, first.get(b"Resources").unwrap());
    let xobjects = dict(&doc, resources.get(b"XObject").unwrap());
    let (_, drawing) = xobjects.iter().next().expect("lo XObject del disegno");
    let drawing = doc
        .get_object(drawing.as_reference().unwrap())
        .unwrap()
        .as_stream()
        .unwrap();
    assert_eq!(
        drawing.dict.get(b"OC").unwrap().as_reference().unwrap(),
        layer
    );
    // Le annotazioni del PDF restano dov'erano.
    assert_eq!(first.get(b"Annots").unwrap().as_array().unwrap().len(), 2);

    // La nota della seconda pagina è una nota del PDF, col corpo e l'id.
    let second = doc.get_dictionary(pages[1]).unwrap();
    let annots = second.get(b"Annots").unwrap().as_array().unwrap();
    assert_eq!(annots.len(), 1);
    let note = dict(&doc, &annots[0]);
    assert_eq!(note.get(b"Subtype").unwrap().as_name().unwrap(), b"Text");
    assert_eq!(note.get(b"NM").unwrap().as_str().unwrap(), b"n1");
    assert_eq!(
        note.get(b"Contents").unwrap().as_str().unwrap(),
        b"Da verificare\ncon l'ufficio"
    );
    assert_eq!(note.get(b"OC").unwrap().as_reference().unwrap(), layer);

    // Il log ricorda che la copertura nasconde soltanto alla vista.
    let warnings = messages(&report, NoteLevel::Warning);
    assert!(
        warnings.iter().any(|m| m.starts_with("Page 1 has covers")),
        "{warnings:?}"
    );
}

#[test]
fn the_annotated_pdf_is_named_by_its_title_and_suffix() {
    let pdf = source_pdf();
    let source = anchored(&pdf).replacen("<g ", "<title>Revisione di marzo</title><g ", 1);
    let host = host(&pdf, &source);
    let report = export(
        &AnnotatedPdfExport,
        &host,
        DRAW_ANNOTATED_PDF,
        &[ANNOTATIONS],
        serde_json::json!({ "suffix": "annotato" }),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "Gare/Bando (annotato).pdf");
    let doc = Document::load_mem(&bytes).unwrap();
    let properties = dict(&doc, doc.catalog().unwrap().get(b"OCProperties").unwrap());
    let layer = properties
        .get(b"OCGs")
        .unwrap()
        .as_array()
        .unwrap()
        .last()
        .unwrap();
    let name = dict(&doc, layer).get(b"Name").unwrap();
    // Il titolo, se il modello lo dà; nel vault finto il modello non c'è, e
    // vale il nome del file.
    assert!(
        [b"Revisione di marzo".as_slice(), b"Bando.pdf.fubann"].contains(&name.as_str().unwrap()),
        "{name:?}"
    );
}

#[test]
fn a_changed_pdf_is_annotated_with_a_warning() {
    let pdf = source_pdf();
    let older = annotations(&format!(
        " fub:digest=\"{}\" fub:pages=\"2\"",
        digest(b"un'altra versione")
    ));
    let host = host(&pdf, &older);
    let report = annotated(&host).unwrap();
    only_artifact(&report);
    let warnings = messages(&report, NoteLevel::Warning);
    assert!(
        warnings
            .iter()
            .any(|m| m.contains("another version of Gare/Bando.pdf")),
        "{warnings:?}"
    );
}

#[test]
fn a_pdf_that_opens_without_a_password_is_annotated() {
    let mut doc = source_document(&["SEGRETO", "PUBBLICO"]);
    let state = EncryptionState::try_from(EncryptionVersion::V2 {
        document: &doc,
        owner_password: "proprietario",
        user_password: "",
        key_length: 128,
        permissions: Permissions::PRINTABLE,
    })
    .unwrap();
    doc.encrypt(&state).unwrap();
    let pdf = save(doc);
    let host = host(&pdf, &anchored(&pdf));
    let report = annotated(&host).unwrap();
    let (_, bytes) = only_artifact(&report);
    // Il file si riapre, cifrato come l'originale, con le note leggibili.
    let doc = Document::load_mem(&bytes).unwrap();
    let pages = page_ids(&doc);
    let annots = doc
        .get_dictionary(pages[1])
        .unwrap()
        .get(b"Annots")
        .unwrap();
    let note = dict(&doc, &annots.as_array().unwrap()[0]);
    assert_eq!(
        note.get(b"Contents").unwrap().as_str().unwrap(),
        b"Da verificare\ncon l'ufficio"
    );
}

// ---------------------------------------------------------------------------
// Il PDF redatto
// ---------------------------------------------------------------------------

#[test]
fn the_redacted_pdf_has_no_trace_of_what_is_covered() {
    let pdf = source_pdf();
    assert!(contains(&everything(&pdf), "SEGRETO"));
    let host = host(&pdf, &anchored(&pdf));
    let report = redacted(&host).unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "Gare/Bando (redacted).pdf");

    let all = everything(&bytes);
    assert!(
        !contains(&all, "SEGRETO"),
        "il testo coperto, il commento o il titolo sono rimasti"
    );
    assert!(
        contains(&all, "PUBBLICO"),
        "la pagina senza coperture si copia col suo testo"
    );

    let doc = Document::load_mem(&bytes).unwrap();
    let pages = page_ids(&doc);
    assert_eq!(pages.len(), 2);
    // La prima pagina è un'immagine della misura della pagina.
    let first = doc.get_dictionary(pages[0]).unwrap();
    let media: Vec<f32> = first
        .get(b"MediaBox")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_float().unwrap())
        .collect();
    assert_eq!(media, [0.0, 0.0, 612.0, 792.0]);
    let resources = dict(&doc, first.get(b"Resources").unwrap());
    let xobjects = dict(&doc, resources.get(b"XObject").unwrap());
    let image = xobjects.get(b"Fub").unwrap().as_reference().unwrap();
    let image = doc.get_object(image).unwrap().as_stream().unwrap();
    assert_eq!(
        image.dict.get(b"Subtype").unwrap().as_name().unwrap(),
        b"Image"
    );
    // 200 punti per pollice: 612 punti sono 1700 pixel.
    assert_eq!(image.dict.get(b"Width").unwrap().as_i64().unwrap(), 1700);
    assert!(
        first.get(b"Annots").is_err(),
        "le annotazioni del PDF non restano annotazioni"
    );

    // Del documento restano le pagine: niente titolo, il produttore è Fub.
    let info = dict(&doc, doc.trailer.get(b"Info").unwrap());
    assert!(info.get(b"Title").is_err());
    assert_eq!(info.get(b"Producer").unwrap().as_str().unwrap(), b"Fub");

    // La nota della seconda pagina resta una nota.
    let second = doc.get_dictionary(pages[1]).unwrap();
    let annots = second.get(b"Annots").unwrap().as_array().unwrap();
    assert_eq!(annots.len(), 1);

    let infos = messages(&report, NoteLevel::Info);
    assert!(
        infos
            .iter()
            .any(|m| m.starts_with("Page 1 became an image at 200 dpi")),
        "{infos:?}"
    );
    let warnings = messages(&report, NoteLevel::Warning);
    assert!(
        warnings
            .iter()
            .any(|m| m.contains("no appearance of its own")),
        "il riquadro senza aspetto manca, e il log lo dice: {warnings:?}"
    );
}

#[test]
fn the_same_annotations_give_the_same_redacted_bytes() {
    let pdf = source_pdf();
    let host = host(&pdf, &anchored(&pdf));
    let once = only_artifact(&redacted(&host).unwrap()).1;
    let twice = only_artifact(&redacted(&host).unwrap()).1;
    assert_eq!(once, twice);
}

#[test]
fn the_resolution_is_an_option() {
    let pdf = source_pdf();
    let host = host(&pdf, &anchored(&pdf));
    let report = export(
        &RedactedPdfExport,
        &host,
        DRAW_REDACTED_PDF,
        &[ANNOTATIONS],
        serde_json::json!({ "dpi": 72, "suffix": "redatto" }),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "Gare/Bando (redatto).pdf");
    let doc = Document::load_mem(&bytes).unwrap();
    let first = doc.get_dictionary(page_ids(&doc)[0]).unwrap();
    let resources = dict(&doc, first.get(b"Resources").unwrap());
    let image = dict(&doc, resources.get(b"XObject").unwrap())
        .get(b"Fub")
        .unwrap()
        .as_reference()
        .unwrap();
    let image = doc.get_object(image).unwrap().as_stream().unwrap();
    assert_eq!(image.dict.get(b"Width").unwrap().as_i64().unwrap(), 612);

    let error = export(
        &RedactedPdfExport,
        &host,
        DRAW_REDACTED_PDF,
        &[ANNOTATIONS],
        serde_json::json!({ "dpi": 1200 }),
    )
    .unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_dpi");
}

#[test]
fn a_changed_pdf_is_not_redacted() {
    let pdf = source_pdf();
    let older = annotations(&format!(
        " fub:digest=\"{}\" fub:pages=\"2\"",
        digest(b"un'altra versione")
    ));
    let error = redacted(&host(&pdf, &older)).unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_changed");
    // Senza impronta, un numero di pagine diverso dice lo stesso.
    let fewer = annotations(" fub:pages=\"3\"");
    let error = redacted(&host(&pdf, &fewer)).unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_changed");
    // Annotazioni non ancora legate a una versione si redigono.
    only_artifact(&redacted(&host(&pdf, &annotations(""))).unwrap());
}

#[test]
fn opaque_marks_that_are_not_covers_are_reported() {
    let pdf = source_pdf();
    let source = anchored(&pdf).replace(
        "<rect x=\"60\" y=\"60\" width=\"220\" height=\"50\" fill=\"#000000\"/>",
        "<path d=\"M60 60 H280 V110 H60 Z\" fill=\"#000000\"/>",
    );
    let report = redacted(&host(&pdf, &source)).unwrap();
    let (_, bytes) = only_artifact(&report);
    // Senza copertura la pagina non si redige: il testo resta, e il log lo
    // dice due volte.
    assert!(contains(&everything(&bytes), "SEGRETO"));
    let warnings = messages(&report, NoteLevel::Warning);
    assert!(
        warnings
            .iter()
            .any(|m| m.starts_with("no page has a cover")),
        "{warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|m| m.starts_with("Page 1 has opaque marks that are not covers")),
        "{warnings:?}"
    );
}

// ---------------------------------------------------------------------------
// Ciò che non si esporta
// ---------------------------------------------------------------------------

#[test]
fn what_cannot_be_exported_says_why() {
    let pdf = source_pdf();
    // Una selezione senza annotazioni.
    let host_ = host(&pdf, &anchored(&pdf));
    let error = export(
        &AnnotatedPdfExport,
        &host_,
        DRAW_ANNOTATED_PDF,
        &[PDF],
        serde_json::Value::Null,
    )
    .unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_none_selected");

    // Un PDF che non c'è.
    let elsewhere = annotations(" fub:annotates=\"Altro.pdf\"");
    let error = annotated(&host(&pdf, &elsewhere)).unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_pdf_missing");

    // Un indirizzo che non è del vault.
    let external = annotations(" fub:annotates=\"https://example.org/Bando.pdf\"");
    let error = annotated(&host(&pdf, &external)).unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_no_pdf");

    // Un PDF rotto.
    let error = annotated(&host(b"%PDF-1.7\nniente", &annotations(""))).unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_pdf_damaged");

    // Un PDF che chiede la password.
    let mut doc = source_document(&["SEGRETO"]);
    let state = EncryptionState::try_from(EncryptionVersion::V2 {
        document: &doc,
        owner_password: "proprietario",
        user_password: "utente",
        key_length: 128,
        permissions: Permissions::PRINTABLE,
    })
    .unwrap();
    doc.encrypt(&state).unwrap();
    let locked = save(doc);
    let error = redacted(&host(&locked, &annotations(""))).unwrap_err();
    assert_eq!(error_key(&error), "e_annotated_pdf_locked");
}

#[test]
fn the_other_documents_are_skipped_and_the_others_still_export() {
    let pdf = source_pdf();
    let host = host(&pdf, &anchored(&pdf))
        .with_document("Rotte.pdf.fubann", "<svg")
        .with_document("Nota.md", "# Nota");
    let report = export(
        &AnnotatedPdfExport,
        &host,
        DRAW_ANNOTATED_PDF,
        &[ANNOTATIONS, "Rotte.pdf.fubann", "Nota.md"],
        serde_json::Value::Null,
    )
    .unwrap();
    only_artifact(&report);
    let infos = messages(&report, NoteLevel::Info);
    assert!(
        infos
            .iter()
            .any(|m| m.starts_with("1 selected document is not")),
        "{infos:?}"
    );
    let failed: Vec<_> = report
        .log
        .iter()
        .filter(|note| note.entry.as_deref() == Some("Rotte.pdf.fubann"))
        .collect();
    assert_eq!(failed.len(), 1, "{:?}", report.log);
}
