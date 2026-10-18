//! Esportare una copia: le sei destinazioni scrivono con gli esportatori di
//! WordCraft, il documento resta com'è e il rapporto dice ciò che la copia non
//! porta, misurato rileggendola.

mod common;

use common::{sample, text};
use fub_abi::traits::CommandProvider;
use fub_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportSelection, MemorySink, NoteLevel,
    TransferNote,
};
use fub_abi::{DocId, DocumentFormat, FormatProvider, InvokeMode, PluginError};
use fub_format_rich::export::{Inventory, Item, RichCommands, RichExport, Target};
use fub_format_rich::{Codec, RichProvider};
use fub_sdk::testing::MemoryHost;
use wordcraft_doc::{para_block, CharProps, Comment, Document, InlineObject, PartKind};

fn docx(document: &Document) -> Vec<u8> {
    common::bytes(document)
}

/// Un banco con i formati di videoscrittura nel registro, come li monta
/// l'host: il provider riconosce un documento dal suo formato.
fn bench() -> MemoryHost {
    let mut host = MemoryHost::new();
    for codec in Codec::ALL {
        let provider = RichProvider::new(codec);
        let descriptor = provider.descriptor();
        for ext in &descriptor.extensions {
            host = host.with_format(
                ext,
                DocumentFormat {
                    descriptor: descriptor.clone(),
                    capabilities: provider.capabilities(),
                },
            );
        }
    }
    host
}

fn export(host: &MemoryHost, target: Target, docs: &[&str]) -> Result<ExportReport, PluginError> {
    export_with(host, target, docs, serde_json::Value::Null)
}

fn export_with(
    host: &MemoryHost,
    target: Target,
    docs: &[&str],
    options: serde_json::Value,
) -> Result<ExportReport, PluginError> {
    let request = ExportRequest::new(
        target.id(),
        ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
    )
    .with_options(options);
    RichExport.export(&request, host, &mut MemorySink::default())
}

fn warnings(report: &ExportReport) -> Vec<&TransferNote> {
    report
        .log
        .iter()
        .filter(|note| note.level == NoteLevel::Warning)
        .collect()
}

fn lost(report: &ExportReport) -> String {
    warnings(report)
        .iter()
        .find(|note| note.message.contains("non porta"))
        .map(|note| note.message.clone())
        .unwrap_or_default()
}

fn commented() -> Document {
    let mut document = sample();
    let part = document.add_part(
        PartKind::Comment,
        vec![para_block(text("Da rivedere.", CharProps::default()))],
    );
    document.comments.insert(
        1,
        Comment {
            author: "Redazione".into(),
            part,
            ..Default::default()
        },
    );
    let wordcraft_doc::Block::Para(para) = std::sync::Arc::make_mut(&mut document.body[1]) else {
        panic!("not a paragraph");
    };
    para.insert_object(
        0,
        InlineObject::CommentStart { id: 1 },
        &CharProps::default(),
    )
    .unwrap();
    let end = para.len();
    para.insert_object(
        end,
        InlineObject::CommentEnd { id: 1 },
        &CharProps::default(),
    )
    .unwrap();
    document
}

#[test]
fn every_target_is_a_single_file_with_its_extension() {
    let targets = RichExport.targets();
    let ids: Vec<&str> = targets.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "rich.copy.html",
            "rich.copy.txt",
            "rich.copy.latex",
            "rich.copy.rtf",
            "rich.copy.odt",
            "rich.copy.wordxml"
        ]
    );
    let extensions: Vec<_> = targets
        .iter()
        .map(|t| t.extension.as_deref().unwrap())
        .collect();
    assert_eq!(extensions, ["html", "txt", "tex", "rtf", "odt", "xml"]);
}

#[test]
fn a_copy_reads_back_in_its_format_and_the_source_is_unchanged() {
    let source = docx(&sample());
    let host = bench().with_binary_document("Documenti/Lettera.docx", &source);
    for target in Target::ALL {
        let report = export(&host, target, &["Documenti/Lettera.docx"]).unwrap();
        assert_eq!(report.artifacts.len(), 1, "{target:?}");
        let artifact = &report.artifacts[0];
        assert_eq!(
            artifact.path,
            format!("Documenti/Lettera.{}", target.extension())
        );
        let bytes = artifact.as_bytes().unwrap();
        let copy = match target {
            Target::WordXml => wordcraft_docx::read_xml(bytes).unwrap(),
            target => wordcraft_formats::import(target.extension(), bytes)
                .unwrap()
                .unwrap(),
        };
        let words: String = copy
            .body
            .iter()
            .filter_map(|block| match &**block {
                wordcraft_doc::Block::Para(para) => Some(para.plain_text()),
                wordcraft_doc::Block::Table(_) => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(words.contains("Il titolo"), "{target:?}: {words}");
        assert!(words.contains("Una prosa forte"), "{target:?}: {words}");
        // Un documento Word si legge per intero: nessun avviso sull'importatore.
        assert!(
            !report
                .log
                .iter()
                .any(|note| note.message.contains("importatore")),
            "{target:?}"
        );
    }
    // Esportare legge soltanto: i byte del documento sono quelli di prima.
    assert_eq!(
        fub_abi::traits::VaultRead::read_document_bytes(
            &host,
            &DocId::new("Documenti/Lettera.docx")
        )
        .unwrap(),
        source
    );
    assert_eq!(host.writes_on("Documenti/Lettera.docx"), (0, 0));
}

#[test]
fn plain_text_says_what_it_does_not_carry() {
    let host = bench().with_binary_document("Lettera.docx", &docx(&sample()));
    let report = export(&host, Target::Txt, &["Lettera.docx"]).unwrap();
    let lost = lost(&report);
    for item in [
        "1 titolo",
        "2 voci d'elenco",
        "1 tabella",
        "1 link",
        "1 immagine",
        "1 nota a piè di pagina",
        "caratteri in grassetto",
    ] {
        assert!(lost.contains(item), "{item} not in: {lost}");
    }
    assert!(lost.starts_with("la copia Testo semplice non porta"));
    // Le parole ci sono tutte.
    assert!(!lost.contains("parol"), "{lost}");
    assert!(report
        .log
        .iter()
        .all(|note| note.entry.as_deref() == Some("Lettera.docx")));
}

#[test]
fn word_xml_carries_what_a_docx_carries() {
    let host = bench().with_binary_document("Lettera.docx", &docx(&commented()));
    let report = export(&host, Target::WordXml, &["Lettera.docx"]).unwrap();
    assert_eq!(warnings(&report), Vec::<&TransferNote>::new());
    assert!(report.log.is_empty(), "{:?}", report.log);
}

#[test]
fn comments_are_lost_or_printed_at_the_end() {
    let host = bench().with_binary_document("Lettera.docx", &docx(&commented()));
    let without = export(&host, Target::Html, &["Lettera.docx"]).unwrap();
    assert!(lost(&without).contains("1 commento"), "{}", lost(&without));

    let with = export_with(
        &host,
        Target::Html,
        &["Lettera.docx"],
        serde_json::json!({"comments": true}),
    )
    .unwrap();
    assert!(!lost(&with).contains("commento"), "{}", lost(&with));
    assert!(with.log.iter().any(
        |note| note.level == NoteLevel::Info && note.message.starts_with("1 commento in fondo")
    ));
    let html = String::from_utf8(with.artifacts[0].as_bytes().unwrap().to_vec()).unwrap();
    assert!(html.contains("Da rivedere."), "{html}");
}

#[test]
fn an_imported_document_says_it_starts_from_less() {
    let rtf = wordcraft_formats::rtf::export(&sample());
    let host = bench().with_binary_document("Vecchio.rtf", rtf.as_bytes());
    let report = export(&host, Target::Html, &["Vecchio.rtf"]).unwrap();
    assert!(warnings(&report)
        .iter()
        .any(|note| note.message.contains("importatore di WordCraft")));
}

#[test]
fn a_copy_in_the_same_format_is_not_made() {
    let rtf = wordcraft_formats::rtf::export(&sample());
    let host = bench()
        .with_binary_document("Vecchio.rtf", rtf.as_bytes())
        .with_binary_document("Lettera.docx", &docx(&sample()));
    assert!(matches!(
        export(&host, Target::Rtf, &["Vecchio.rtf"]),
        Err(PluginError::BadArgs(_))
    ));
    let report = export(&host, Target::Rtf, &["Lettera.docx", "Vecchio.rtf"]).unwrap();
    assert_eq!(report.artifacts.len(), 1);
    assert_eq!(report.artifacts[0].path, "Lettera.rtf");
    assert!(report
        .log
        .iter()
        .any(|note| note.entry.as_deref() == Some("Vecchio.rtf")
            && note.message.contains("già un documento RTF")));
}

#[test]
fn other_documents_stay_out_and_names_never_collide() {
    let bytes = docx(&sample());
    let odt = wordcraft_formats::odt::export(&sample()).unwrap();
    let host = bench()
        .with_binary_document("Lettera.docx", &bytes)
        .with_binary_document("Lettera.odt", &odt)
        .with_document("Appunti.md", "# Appunti\n");
    let request = ExportRequest::new(Target::Html.id(), ExportSelection::Folder(String::new()));
    let report = RichExport
        .export(&request, &host, &mut MemorySink::default())
        .unwrap();
    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(paths, ["Lettera.docx.html", "Lettera.odt.html"]);
    assert!(report
        .log
        .iter()
        .any(|note| note.entry.as_deref() == Some("Appunti.md") && note.level == NoteLevel::Info));
    // Soltanto documenti che non sono di videoscrittura: niente da esportare.
    let only = bench().with_document("Appunti.md", "# Appunti\n");
    assert!(matches!(
        RichExport.export(&request, &only, &mut MemorySink::default()),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn an_unreadable_document_is_a_note_not_a_failure_of_the_others() {
    let host = bench()
        .with_binary_document("Lettera.docx", &docx(&sample()))
        .with_binary_document("Rotto.docx", b"non sono uno zip");
    let report = export(&host, Target::Txt, &["Lettera.docx", "Rotto.docx"]).unwrap();
    assert_eq!(report.artifacts.len(), 1);
    assert!(warnings(&report)
        .iter()
        .any(|note| note.entry.as_deref() == Some("Rotto.docx")));
    assert!(matches!(
        export(&host, Target::Txt, &["Rotto.docx"]),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn an_unknown_target_is_refused() {
    let host = bench().with_binary_document("Lettera.docx", &docx(&sample()));
    let request = ExportRequest::new(
        "rich.copy.pdf",
        ExportSelection::Documents(vec![DocId::new("Lettera.docx")]),
    );
    assert!(matches!(
        RichExport.export(&request, &host, &mut MemorySink::default()),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn the_inventory_counts_what_the_sample_has() {
    let inventory = Inventory::of(&commented());
    for (item, n) in [
        (Item::Headings, 1),
        (Item::ListItems, 2),
        (Item::Tables, 1),
        (Item::Links, 1),
        (Item::Images, 1),
        (Item::Footnotes, 1),
        (Item::Comments, 1),
        // Il titolo ha lo stile Strong, e «forte» è in grassetto.
        (Item::Bold, "Iltitolo".len() + "forte".len()),
    ] {
        assert_eq!(inventory.count(item), n, "{item:?}");
    }
}

#[test]
fn the_command_refuses_what_it_cannot_export_before_queuing() {
    let mut host = bench().with_binary_document("Vecchio.rtf", b"{\\rtf1 x}");
    let invoke = |host: &mut MemoryHost, args: serde_json::Value| {
        RichCommands.invoke("rich.export-copy", args, InvokeMode::Apply, host)
    };
    for args in [
        serde_json::json!({"doc": "Appunti.md", "format": "html"}),
        serde_json::json!({"doc": "Vecchio.rtf", "format": "rtf"}),
        serde_json::json!({"doc": "Vecchio.rtf", "format": "pdf"}),
        serde_json::json!({"doc": "Vecchio.rtf"}),
    ] {
        assert!(
            matches!(
                invoke(&mut host, args.clone()),
                Err(PluginError::BadArgs(_))
            ),
            "{args}"
        );
    }
    // Il resto passa da `export.run`, che questo banco non ha.
    assert_eq!(
        invoke(
            &mut host,
            serde_json::json!({"doc": "Vecchio.rtf", "format": "html", "comments": true})
        ),
        Err(PluginError::UnknownCommand("export.run".into()))
    );
}
