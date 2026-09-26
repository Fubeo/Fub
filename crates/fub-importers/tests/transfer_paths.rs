use fub_abi::command::InvokeMode;
use fub_abi::model::DocId;
use fub_abi::traits::{
    CommandProvider, DataRead, HostQuery, IndexQuery, IndexResult, Plugin, VaultRead, VaultWrite,
};
use fub_abi::transfer::{
    ArtifactHandle, ArtifactSink, ExportArtifact, ExportProvider, ExportRequest, ExportSelection,
    ImportMode, ImportOutcome, ImportProvider, ImportRequest, ImportSource,
};
use fub_importers::pipeline::StagingManifest;
use fub_importers::{
    AppleImport, ArchiveImport, CsvExport, EnexImport, JsonImport, OneNoteImport, PdfExport,
    TextpackImport,
};
use fub_importers::{ImportCommands, ImportPlugin};
use fub_sdk::testing::MemoryHost;

const BEAR: &str = include_str!("../../../tests/fixtures/imports/bear.json");
const KEEP: &str = include_str!("../../../tests/fixtures/imports/keep.json");
const ROAM: &str = include_str!("../../../tests/fixtures/imports/roam.json");
const ENEX: &str = include_str!("../../../tests/fixtures/imports/sample.enex");

/// Every file the host holds, documents and attachments alike: a preview or a
/// refused archive must leave none of them behind, and `list_documents` only
/// counts what a format parses.
fn written(host: &MemoryHost) -> Vec<DocId> {
    match host
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .unwrap()
    {
        IndexResult::Entries(page) => page.items.into_iter().map(|entry| entry.id).collect(),
        other => panic!("off-topic answer: {}", other.kind_name()),
    }
}

#[test]
fn generic_registry_exposes_and_runs_staged_transfer_jobs() {
    // Il job non porta una lista sua: sceglie fra ciò che l'host ha
    // registrato, come nel montaggio vero.
    let mut host = MemoryHost::new()
        .with_import_provider(Box::new(JsonImport))
        .with_export_provider(Box::new(CsvExport));
    let source = ImportSource::text_source("bear.json", BEAR);
    let payload = serde_json::json!({
        "op": "prepare", "job": "generic-registry", "source": source,
        "request": ImportRequest::apply(),
    });
    let prepared = ImportPlugin
        .run_job("import.transfer", payload, &mut host)
        .unwrap();
    assert_eq!(
        prepared["preview"]["documents"].as_array().unwrap().len(),
        2
    );
    let sample = ImportCommands
        .invoke(
            "import.sample",
            serde_json::json!({"job":"generic-registry", "count":1}),
            InvokeMode::Apply,
            &mut host,
        )
        .unwrap();
    let sampled = match sample.notify {
        Some(fub_abi::text::Text::Literal(text)) => text,
        _ => panic!("sample has no result"),
    };
    let sampled: serde_json::Value = serde_json::from_str(&sampled).unwrap();
    assert_eq!(sampled["documents"].as_array().unwrap().len(), 1);
    assert!(written(&host).is_empty());
    let committed = ImportPlugin
        .run_job(
            "import.transfer",
            serde_json::json!({"op":"commit", "job":"generic-registry"}),
            &mut host,
        )
        .unwrap();
    assert_eq!(committed["documents"].as_array().unwrap().len(), 2);
    let export = ImportPlugin
        .run_job(
            "import.transfer",
            serde_json::json!({
                "op":"export",
                "request":ExportRequest::new("importers.csv", ExportSelection::Documents(vec![
                    fub_abi::DocId::new("Shared.md"),
                ])),
            }),
            &mut host,
        )
        .unwrap();
    assert!(export["artifacts"][0]["content"]["value"]
        .as_array()
        .is_some());
    ImportPlugin
        .run_job(
            "import.transfer",
            serde_json::json!({"op":"rollback", "job":"generic-registry"}),
            &mut host,
        )
        .unwrap();
    assert!(written(&host).is_empty());
}

#[test]
fn bear_wins_over_keep_and_duplicate_titles_keep_distinct_sources() {
    let mut host = MemoryHost::new();
    let mut importer = JsonImport;
    let source = ImportSource::text_source("bear.json", BEAR);
    let preview = importer
        .import(&source, &ImportRequest::preview(), &mut host)
        .unwrap();
    assert_eq!(preview.documents.len(), 2);
    assert_eq!(preview.documents[0].doc.as_str(), "Shared.md");
    assert_eq!(preview.documents[1].doc.as_str(), "Shared-2.md");
    assert_eq!(preview.documents[0].entry.as_deref(), Some("bear.json:1"));
    assert!(matches!(
        preview.documents[0].outcome,
        ImportOutcome::Created
    ));
    assert!(written(&host).is_empty());
    let applied = importer
        .import(&source, &ImportRequest::apply(), &mut host)
        .unwrap();
    assert_eq!(preview.documents, applied.documents);
    let first = host.read_document(&applied.documents[0].doc).unwrap();
    assert!(first.contains("source_id: bear-a"));
    assert!(first.contains("source_sha:"));
    assert!(first.contains("[[Other]]"));
    assert!(host
        .read_document(&applied.documents[1].doc)
        .unwrap()
        .contains("trashed: true"));
    let rerun = importer
        .import(&source, &ImportRequest::apply(), &mut host)
        .unwrap();
    assert!(rerun
        .documents
        .iter()
        .all(|d| matches!(d.outcome, ImportOutcome::Skipped)));
}

#[test]
fn mixed_bear_keep_backup_refuses_without_writing() {
    let source = ImportSource::text_source(
        "mixed.json",
        r#"{"notes":[{"title":"Bear","text":"original"},{"title":"Keep","textContent":"original"}]}"#,
    );
    let mut host = MemoryHost::new();
    let error = JsonImport
        .import(&source, &ImportRequest::apply(), &mut host)
        .unwrap_err();
    assert!(error.to_string().contains("mixed Bear and Google Keep"));
    assert!(written(&host).is_empty());
}

#[test]
fn source_shapes_remain_distinct_and_preview_has_no_writes() {
    for (filename, input, needle) in [
        ("keep.json", KEEP, "- [ ] Bread"),
        ("roam.json", ROAM, "((block-id))"),
        (
            "craft.json",
            include_str!("../../../tests/fixtures/imports/craft.json"),
            "craftdocs://",
        ),
        (
            "logseq.json",
            include_str!("../../../tests/fixtures/imports/logseq.json"),
            "task:: TODO",
        ),
    ] {
        let mut host = MemoryHost::new();
        let mut provider = JsonImport;
        let source = ImportSource::text_source(filename, input);
        let planned = provider
            .import(&source, &ImportRequest::preview(), &mut host)
            .unwrap();
        assert!(!planned.documents.is_empty(), "{filename}");
        assert!(written(&host).is_empty(), "{filename}");
        let applied = provider
            .import(&source, &ImportRequest::apply(), &mut host)
            .unwrap();
        assert_eq!(planned.documents, applied.documents, "{filename}");
        assert!(
            host.read_document(&applied.documents[0].doc)
                .unwrap()
                .contains(needle),
            "{filename}"
        );
    }
}

#[test]
fn staged_plan_survives_reload_and_cancel_never_touches_vault() {
    let mut host = MemoryHost::new();
    let mut provider = JsonImport;
    let source = host.with_source("bear.json", None, BEAR.as_bytes());
    let manifest = StagingManifest::prepare(
        "portable-1",
        &source,
        &ImportRequest::apply(),
        &mut provider,
        &mut host,
        42,
    )
    .unwrap();
    assert_eq!(manifest.preview.mode, ImportMode::Preview);
    assert_eq!(manifest.sample(1).documents.len(), 1);
    assert_eq!(
        StagingManifest::load("portable-1", &host).unwrap(),
        manifest
    );
    assert_eq!(manifest.verify(&host).unwrap(), BEAR.as_bytes());
    assert!(written(&host).is_empty());
    StagingManifest::cancel("portable-1", &mut host).unwrap();
    StagingManifest::cancel("portable-1", &mut host).unwrap();
    assert!(host
        .data_read(&StagingManifest::manifest_path("portable-1"))
        .unwrap()
        .is_none());
    assert!(written(&host).is_empty());
}

#[test]
fn staged_import_refuses_persisting_a_raw_api_token() {
    let mut host = MemoryHost::new();
    let source = ImportSource::text_source("bear.json", BEAR);
    let mut request = ImportRequest::apply();
    request.options = serde_json::json!({"token": "private-secret"});
    let error =
        StagingManifest::prepare("secret", &source, &request, &mut JsonImport, &mut host, 42)
            .unwrap_err();
    assert!(error.to_string().contains("token_env"));
    assert!(host
        .data_read(&StagingManifest::manifest_path("secret"))
        .unwrap()
        .is_none());
}

#[test]
fn committed_plan_is_rerunnable_and_rollback_restores_preimages() {
    let mut host = MemoryHost::new().with_document("Shared.md", "original user bytes\n");
    let mut provider = JsonImport;
    let source = ImportSource::text_source("bear.json", BEAR);
    let request = ImportRequest::apply().on_conflict(fub_abi::transfer::ConflictPolicy::Replace);
    StagingManifest::prepare(
        "recoverable",
        &source,
        &request,
        &mut provider,
        &mut host,
        42,
    )
    .unwrap();
    let applied = fub_importers::pipeline::commit("recoverable", &mut provider, &mut host).unwrap();
    assert_eq!(applied.documents.len(), 2);
    assert!(host
        .read_document(&applied.documents[0].doc)
        .unwrap()
        .contains("bear-a"));
    let again = fub_importers::pipeline::commit("recoverable", &mut provider, &mut host).unwrap();
    assert_eq!(again, applied);
    fub_importers::pipeline::rollback("recoverable", &mut host).unwrap();
    assert_eq!(
        host.read_document(&applied.documents[0].doc).unwrap(),
        "original user bytes\n"
    );
    assert!(!written(&host).contains(&applied.documents[1].doc));
    fub_importers::pipeline::rollback("recoverable", &mut host).unwrap();
}

#[test]
fn rollback_refuses_to_erase_a_later_user_edit() {
    let mut host = MemoryHost::new();
    let mut provider = JsonImport;
    let source = ImportSource::text_source("bear.json", BEAR);
    StagingManifest::prepare(
        "user-edit",
        &source,
        &ImportRequest::apply(),
        &mut provider,
        &mut host,
        42,
    )
    .unwrap();
    let report = fub_importers::pipeline::commit("user-edit", &mut provider, &mut host).unwrap();
    host.write_document(
        &report.documents[0].doc,
        "user edit",
        fub_abi::edit::WriteBase::Dictated,
    )
    .unwrap();
    assert!(fub_importers::pipeline::rollback("user-edit", &mut host).is_err());
    assert_eq!(
        host.read_document(&report.documents[0].doc).unwrap(),
        "user edit"
    );
    assert!(host
        .read_document(&report.documents[1].doc)
        .unwrap()
        .contains("Second note"));
}

#[test]
fn evernote_preview_and_apply_preserve_resource_bytes_and_provenance() {
    let mut host = MemoryHost::new();
    let mut provider = EnexImport;
    let source = ImportSource::text_source("meeting.enex", ENEX);
    let planned = provider
        .import(&source, &ImportRequest::preview(), &mut host)
        .unwrap();
    assert!(written(&host).is_empty());
    assert_eq!(planned.documents.len(), 2);
    let applied = provider
        .import(&source, &ImportRequest::apply(), &mut host)
        .unwrap();
    assert_eq!(planned.documents, applied.documents);
    assert_eq!(applied.documents[0].doc.as_str(), "Work/Meeting.md");
    assert!(applied.documents[1]
        .doc
        .as_str()
        .starts_with("Work/assets/"));
    let note = host.read_document(&applied.documents[0].doc).unwrap();
    assert!(note.contains("evernote://a/b"));
    assert!(note.contains("assets/"));
    assert_eq!(
        host.read_document_bytes(&applied.documents[1].doc).unwrap(),
        b"PNG"
    );
}

#[test]
fn joplin_tar_parses_before_writes_and_retains_binary_assets() {
    let mut host = MemoryHost::new();
    let mut provider = ArchiveImport;
    let mut archive = tar_entry(
        "notebooks/work.md",
        b"---\nparent_id: root\n---\n\n[[Other]]\n",
    );
    archive.extend(tar_entry("resources/image.png", b"\x89PNG"));
    archive.extend([0u8; 1024]);
    let source = ImportSource::from_bytes("notes.jex", archive.clone());
    let planned = provider
        .import(&source, &ImportRequest::preview(), &mut host)
        .unwrap();
    assert_eq!(planned.documents.len(), 2);
    assert!(written(&host).is_empty());
    let applied = provider
        .import(&source, &ImportRequest::apply(), &mut host)
        .unwrap();
    assert_eq!(planned.documents, applied.documents);
    assert!(host
        .read_document(&applied.documents[0].doc)
        .unwrap()
        .contains("parent_id: root"));
    assert_eq!(
        host.read_document_bytes(&applied.documents[1].doc).unwrap(),
        b"\x89PNG"
    );
    archive[148] ^= 1;
    let malformed = ImportSource::from_bytes("notes.jex", archive);
    assert!(provider
        .import(&malformed, &ImportRequest::apply(), &mut host)
        .is_err());
    assert_eq!(written(&host).len(), 2);
}

fn tar_entry(name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut header = [0u8; 512];
    header[..name.len()].copy_from_slice(name.as_bytes());
    header[100..108].copy_from_slice(b"0000644\0");
    header[124..136].copy_from_slice(format!("{:011o}\0", bytes.len()).as_bytes());
    header[156] = b'0';
    header[257..263].copy_from_slice(b"ustar\0");
    for byte in &mut header[148..156] {
        *byte = b' ';
    }
    let checksum: u64 = header.iter().map(|b| *b as u64).sum();
    header[148..156].copy_from_slice(format!("{:06o}\0 ", checksum).as_bytes());
    let mut out = header.to_vec();
    out.extend_from_slice(bytes);
    out.resize(512 + bytes.len().div_ceil(512) * 512, 0);
    out
}

#[test]
fn staged_textbundle_keeps_relative_links_to_vault_assets_and_rolls_back_bytes() {
    let mut host = MemoryHost::new();
    let source = ImportSource::from_bytes(
        "sample.textpack",
        include_bytes!("../../../tests/fixtures/imports/sample.textpack").to_vec(),
    );
    let mut importer = TextpackImport;
    let plan = StagingManifest::prepare(
        "textbundle-assets",
        &source,
        &ImportRequest::apply(),
        &mut importer,
        &mut host,
        42,
    )
    .unwrap();
    assert_eq!(plan.preview.documents.len(), 2);
    assert!(written(&host).is_empty());
    let applied =
        fub_importers::pipeline::commit("textbundle-assets", &mut importer, &mut host).unwrap();
    assert_eq!(plan.preview.documents, applied.documents);
    let note = host
        .read_document(&fub_abi::DocId::new("sample.md"))
        .unwrap();
    assert!(note.contains("Original **Markdown** and ![photo](assets/photo.png)"));
    assert_eq!(
        host.read_document_bytes(&fub_abi::DocId::new("assets/photo.png"))
            .unwrap(),
        b"\x89PNG\r\n\x1a\nasset-fixture"
    );
    fub_importers::pipeline::rollback("textbundle-assets", &mut host).unwrap();
    assert!(written(&host).is_empty());
}

#[test]
fn proprietary_sources_refuse_without_platform_prerequisites() {
    let mut host = MemoryHost::new();
    let error = OneNoteImport
        .import(
            &ImportSource::from_bytes("notes.one", vec![1, 2]),
            &ImportRequest::apply(),
            &mut host,
        )
        .unwrap_err();
    assert!(error.to_string().contains("converter"));
    let error = AppleImport
        .import(
            &ImportSource::from_bytes("notes.applenotes", vec![1, 2]),
            &ImportRequest::apply(),
            &mut host,
        )
        .unwrap_err();
    assert!(error.to_string().contains("Full Disk Access"));
    assert!(written(&host).is_empty());
}

#[derive(Default)]
struct CollectSink {
    path: String,
    media_type: String,
    bytes: Vec<u8>,
}

impl ArtifactSink for CollectSink {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, fub_abi::PluginError> {
        self.path = path.to_string();
        self.media_type = media_type.to_string();
        self.bytes.clear();
        Ok(ArtifactHandle(1))
    }
    fn write_artifact(
        &mut self,
        _: ArtifactHandle,
        bytes: &[u8],
    ) -> Result<(), fub_abi::PluginError> {
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }
    fn close_artifact(
        &mut self,
        _: ArtifactHandle,
    ) -> Result<ExportArtifact, fub_abi::PluginError> {
        Ok(ExportArtifact::bytes(
            &self.path,
            &self.media_type,
            self.bytes.clone(),
        ))
    }
}

#[test]
fn csv_has_reversible_source_and_neutralizes_spreadsheet_formulas() {
    let source = "---\ntitle: \"History\"\ntags:\n  - work\n---\n\n=SUM(1,2), café\n";
    let host = MemoryHost::new().with_document("History.md", source);
    let mut sink = CollectSink::default();
    let request = ExportRequest::new(
        "importers.csv",
        ExportSelection::Documents(vec![fub_abi::model::DocId::new("History.md")]),
    );
    let report = CsvExport.export(&request, &host, &mut sink).unwrap();
    let csv = String::from_utf8(sink.bytes).unwrap();
    assert!(csv.contains("source_json"));
    assert!(csv.contains("'\n=SUM(1,2)"));
    let encoded = serde_json::to_string(source).unwrap().replace('"', "\"\"");
    assert!(csv.contains(&encoded));
    assert!(report
        .log
        .iter()
        .any(|n| n.message.contains("spreadsheet-formula")));
    assert!(report.log.iter().any(|n| n.message.contains("tags")));
}

/// Il banco non parsa: il modello lo dà il parser vero del formato, come
/// farebbe l'host.
fn with_parsed(host: MemoryHost, doc: &str, source: &str) -> MemoryHost {
    use fub_abi::format::{DocumentSource, FormatProvider, ParseContext};
    let model = fub_format_markdown::MarkdownProvider
        .parse(
            &DocumentSource::Text(source.to_string()),
            &ParseContext::obsidian(doc),
        )
        .unwrap();
    host.with_document(doc, source).with_model(doc, model)
}

#[test]
fn pdf_uses_valid_stream_length_and_explicit_glyph_warning() {
    let host = with_parsed(MemoryHost::new(), "print.md", "Café 😀\n");
    let mut sink = CollectSink::default();
    let request = ExportRequest::new(
        "importers.pdf.single",
        ExportSelection::Documents(vec![fub_abi::model::DocId::new("print.md")]),
    );
    let report = PdfExport.export(&request, &host, &mut sink).unwrap();
    let pdf = String::from_utf8_lossy(&sink.bytes);
    assert!(pdf.starts_with("%PDF-1.4"));
    assert!(pdf.contains("Caf\\351"));
    assert!(report.log.iter().any(|n| n.message.contains("glyph")));
    let length_start = pdf.find("/Length ").unwrap() + "/Length ".len();
    let length_end = pdf[length_start..].find(' ').unwrap() + length_start;
    let declared: usize = pdf[length_start..length_end].parse().unwrap();
    let stream_start = pdf.find("stream\n").unwrap() + "stream\n".len();
    let stream_end = pdf.find("endstream").unwrap();
    assert_eq!(declared, stream_end - stream_start);
}

#[test]
fn pdf_prints_the_model_the_format_read_not_a_markdown_guess() {
    let source = "---\ntitle: Diario\n---\n\n# Oggi\n\n```\n# non un titolo\n```\n\n- [x] fatto\n";
    let host = with_parsed(MemoryHost::new(), "note/oggi.markdown", source);
    let mut sink = fub_abi::transfer::MemorySink::default();
    let request = ExportRequest::new(
        "importers.pdf",
        ExportSelection::Documents(vec![fub_abi::model::DocId::new("note/oggi.markdown")]),
    );
    let report = PdfExport.export(&request, &host, &mut sink).unwrap();
    assert_eq!(
        report.artifacts[0].path, "note/oggi.pdf",
        "l'estensione è quella del documento"
    );
    let fub_abi::transfer::ArtifactContent::Bytes(bytes) = &report.artifacts[0].content else {
        panic!("in memoria l'artefatto porta i byte");
    };
    let pdf = String::from_utf8_lossy(bytes).into_owned();
    assert!(pdf.contains("(note / oggi) Tj"), "{pdf}");
    assert!(
        pdf.contains("(title: Diario) Tj"),
        "la proprietà viene dal modello"
    );
    assert!(pdf.contains("(OGGI) Tj"));
    assert!(
        pdf.contains("(# non un titolo) Tj"),
        "il contenuto di un fence resta codice"
    );
    assert!(pdf.contains("([x] fatto) Tj"));
}
