//! I trait del §1.7 su un vault vero: una sorgente che entra, degli artefatti
//! che escono, e in mezzo il kernel.
//!
//! Sta qui e non fra i test del kernel per la stessa ragione di
//! `index_queries_e2e.rs`: serve markdown *vero* — il frontmatter che l'export
//! toglie, i link che l'import conta, il documento che si riapre com'era. Il
//! giro è quello che farà un plugin di M5: `Workspace::import` /
//! `Workspace::export`, nessuna scorciatoia sui provider.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::IndexQuery;
use fubmd_abi::transfer::{
    ConflictPolicy, ExportRequest, ExportSelection, ImportMode, ImportOutcome, ImportRequest,
    ImportSource, NoteLevel,
};
use fubmd_abi::PluginError;
use fubmd_format_markdown::{
    MarkdownExport, MarkdownImport, MarkdownProvider, TARGET_FILES, TARGET_SINGLE,
};
use fubmd_kernel::{FormatRegistry, Workspace};

/// Un vault a tre note, con i due provider di trasferimento registrati.
///
/// - `Progetti/Alpha.md` (frontmatter, un link a Beta, un tag)
/// - `Progetti/Beta.md`
/// - `Diario.md` (senza frontmatter)
fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    write(
        "Progetti/Alpha.md",
        "---\ntipo: progetto\n---\n\n# Alpha\n\nVedi [[Beta]]. #lavoro\n",
    );
    write("Progetti/Beta.md", "---\ntipo: progetto\n---\n\nBeta.\n");
    write("Diario.md", "Nessun frontmatter qui.\n");

    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());
    let mut ws = Workspace::new(&root, registry);
    ws.register_import_provider("fubmd.markdown", MarkdownImport::boxed());
    ws.register_export_provider("fubmd.markdown", MarkdownExport::boxed());
    ws.reindex().expect("reindex");
    (dir, ws)
}

fn artifact<'a>(
    report: &'a fubmd_abi::transfer::ExportReport,
    path: &str,
) -> &'a fubmd_abi::transfer::ExportArtifact {
    report
        .artifacts
        .iter()
        .find(|a| a.path == path)
        .unwrap_or_else(|| {
            panic!(
                "artefatto `{path}` assente; ci sono {:?}",
                report.artifacts.iter().map(|a| &a.path).collect::<Vec<_>>()
            )
        })
}

fn text(bytes: &[u8]) -> &str {
    std::str::from_utf8(bytes).expect("gli artefatti markdown sono testo")
}

// --- import ----------------------------------------------------------------

#[test]
fn a_preview_says_what_would_happen_and_writes_nothing() {
    let (_g, mut ws) = vault();
    let source = ImportSource::text_source("Nuova.md", "# Nuova\n\nVedi [[Alpha]]. #import\n");

    let report = ws
        .import(&source, &ImportRequest::preview())
        .expect("il provider markdown riconosce un .md");

    assert_eq!(report.mode, ImportMode::Preview);
    assert_eq!(report.documents.len(), 1);
    assert_eq!(report.documents[0].doc, DocId::new("Nuova.md"));
    assert_eq!(report.documents[0].outcome, ImportOutcome::Created);
    assert_eq!(
        report.documents[0].entry.as_deref(),
        Some("Nuova.md"),
        "il rapporto si riconduce all'originale"
    );
    assert!(
        !ws.documents().contains(&DocId::new("Nuova.md")),
        "una prova a vuoto NON scrive: è tutta la differenza fra il piano e \
         l'import (17.3 «migration preview»)"
    );

    // …e lo stesso identico rapporto, applicato, scrive.
    let report = ws.import(&source, &ImportRequest::apply()).expect("import");
    assert_eq!(report.mode, ImportMode::Apply);
    assert_eq!(report.documents[0].outcome, ImportOutcome::Created);
    assert!(ws.documents().contains(&DocId::new("Nuova.md")));
    assert_eq!(
        ws.read_source(&DocId::new("Nuova.md")).unwrap(),
        "# Nuova\n\nVedi [[Alpha]]. #import\n",
        "un import markdown scrive la sorgente COM'ERA: `serialize` è \
         generazione, non round-trip"
    );
}

#[test]
fn what_enters_the_vault_is_indexed_like_everything_else() {
    let (_g, mut ws) = vault();
    ws.import(
        &ImportSource::text_source("Nuova.md", "Vedi [[Alpha]].\n"),
        &ImportRequest::apply(),
    )
    .expect("import");

    // Non è un file comparso sul disco: è passato da `write_document`, quindi
    // modelli, grafo e indici lo conoscono.
    let backlinks = ws.backlinks(&DocId::new("Progetti/Alpha.md"));
    assert!(
        backlinks.iter().any(|b| b.source == DocId::new("Nuova.md")),
        "il grafo ha visto il link della nota importata"
    );
}

#[test]
fn a_source_lands_in_the_folder_that_was_asked_for() {
    let (_g, mut ws) = vault();
    let report = ws
        .import(
            &ImportSource::text_source("Appunti.markdown", "# Appunti\n"),
            &ImportRequest::apply().into_folder("Importati/2026"),
        )
        .expect("import");

    assert_eq!(
        report.documents[0].doc,
        DocId::new("Importati/2026/Appunti.md"),
        "l'estensione dentro il vault è quella canonica, non quella della \
         sorgente"
    );
    assert!(ws
        .documents()
        .contains(&DocId::new("Importati/2026/Appunti.md")));
}

#[test]
fn the_three_conflict_policies_do_three_different_things() {
    let esistente = "---\ntipo: progetto\n---\n\n# Alpha\n\nVedi [[Beta]]. #lavoro\n";
    let nuovo = "# Altro Alpha\n";
    let source = ImportSource::text_source("Alpha.md", nuovo);
    let alpha = DocId::new("Progetti/Alpha.md");

    // skip: ciò che c'è non si tocca. È il default perché è l'unica politica
    // che non può distruggere lavoro dell'utente.
    let (_g, mut ws) = vault();
    let report = ws
        .import(&source, &ImportRequest::apply().into_folder("Progetti"))
        .expect("import");
    assert_eq!(report.documents[0].outcome, ImportOutcome::Skipped);
    assert_eq!(ws.read_source(&alpha).unwrap(), esistente);

    // replace
    let (_g, mut ws) = vault();
    let report = ws
        .import(
            &source,
            &ImportRequest::apply()
                .into_folder("Progetti")
                .on_conflict(ConflictPolicy::Replace),
        )
        .expect("import");
    assert_eq!(report.documents[0].outcome, ImportOutcome::Replaced);
    assert_eq!(ws.read_source(&alpha).unwrap(), nuovo);

    // rename: la convenzione è quella dell'host (D3), non una dell'importer.
    let (_g, mut ws) = vault();
    let report = ws
        .import(
            &source,
            &ImportRequest::apply()
                .into_folder("Progetti")
                .on_conflict(ConflictPolicy::Rename),
        )
        .expect("import");
    assert_eq!(report.documents[0].outcome, ImportOutcome::Created);
    assert_eq!(
        report.documents[0].doc,
        DocId::new("Progetti/Alpha 1.md"),
        "è la stessa famiglia di nomi di `create_note` e del ripristino dal \
         cestino: `HostApi::free_name`"
    );
    assert_eq!(
        ws.read_source(&alpha).unwrap(),
        esistente,
        "l'originale è ancora lì"
    );
    assert!(report.log.iter().any(|n| n.level == NoteLevel::Warning));
}

#[test]
fn a_source_name_cannot_walk_out_of_the_vault() {
    let (_g, mut ws) = vault();
    let report = ws
        .import(
            &ImportSource::text_source("../../.ssh/authorized_keys.md", "# ops\n"),
            &ImportRequest::apply(),
        )
        .expect("import");

    assert_eq!(
        report.documents[0].doc,
        DocId::new("authorized_keys.md"),
        "il nome di una sorgente arriva da fuori: resta un componente solo"
    );
    assert!(ws.documents().contains(&DocId::new("authorized_keys.md")));
}

#[test]
fn a_source_nobody_claims_is_a_bad_argument_and_not_an_empty_import() {
    let (_g, mut ws) = vault();
    let zip = ImportSource {
        name: "vault.zip".to_string(),
        media_type: Some("application/zip".to_string()),
        bytes: vec![0x50, 0x4b, 0x03, 0x04],
    };
    assert!(
        matches!(
            ws.import(&zip, &ImportRequest::preview()),
            Err(PluginError::BadArgs(_))
        ),
        "il kernel non ha un formato di riserva: fingere di averlo produrrebbe \
         rapporti vuoti e veri"
    );
}

#[test]
fn a_source_that_is_not_text_stops_before_starting() {
    let (_g, mut ws) = vault();
    let rotta = ImportSource {
        name: "Nota.md".to_string(),
        media_type: None,
        bytes: vec![0xff, 0xfe, 0x00],
    };
    assert!(matches!(
        ws.import(&rotta, &ImportRequest::apply()),
        Err(PluginError::BadArgs(_))
    ));
    assert!(!ws.documents().contains(&DocId::new("Nota.md")));
}

// --- export ----------------------------------------------------------------

#[test]
fn the_targets_say_whether_the_result_is_one_file_or_a_tree() {
    let (_g, ws) = vault();
    let targets = ws.export_targets();
    assert_eq!(targets.len(), 2);

    let files = targets.iter().find(|t| t.id == TARGET_FILES).unwrap();
    assert_eq!(
        files.extension, None,
        "un file per nota: chi apre il dialogo di sistema deve chiedere una \
         cartella, e lo sa PRIMA di eseguire"
    );
    let single = targets.iter().find(|t| t.id == TARGET_SINGLE).unwrap();
    assert_eq!(single.extension.as_deref(), Some("md"));
}

#[test]
fn exporting_a_folder_takes_its_descendants_and_keeps_the_paths() {
    let (_g, ws) = vault();
    let report = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::Folder("Progetti".to_string()),
        ))
        .expect("export");

    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(paths, vec!["Progetti/Alpha.md", "Progetti/Beta.md"]);
    assert_eq!(
        text(&artifact(&report, "Progetti/Beta.md").bytes),
        "---\ntipo: progetto\n---\n\nBeta.\n",
        "il path dentro l'esito è il path dentro il vault: si riapre com'era"
    );
    assert!(report.log.is_empty());
}

#[test]
fn the_empty_folder_is_the_whole_vault() {
    let (_g, ws) = vault();
    let report = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::default(),
        ))
        .expect("export");
    assert_eq!(report.artifacts.len(), 3, "«export vault completo» (17.2)");
}

#[test]
fn a_query_selects_the_documents_to_export() {
    let (_g, ws) = vault();
    // «Export query results» (17.2): la selezione è il canale del §1.6, e chi
    // esporta non ha bisogno che l'app gli materializzi la lista.
    let report = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::Query(IndexQuery::Backlinks {
                target: DocId::new("Progetti/Beta.md"),
                page: None,
            }),
        ))
        .expect("export");

    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(
        paths,
        vec!["Progetti/Alpha.md"],
        "chi nomina Beta è Alpha, e solo lei"
    );
}

#[test]
fn a_query_that_does_not_name_documents_is_a_bad_argument() {
    let (_g, ws) = vault();
    let out = ws.export(&ExportRequest::new(
        TARGET_FILES,
        ExportSelection::Query(IndexQuery::Tags { page: None }),
    ));
    assert!(
        matches!(out, Err(PluginError::BadArgs(_))),
        "i tag del vault non sono una selezione vuota: sono una domanda che \
         non seleziona"
    );
}

#[test]
fn metadata_can_be_left_behind() {
    let (_g, ws) = vault();
    let report = ws
        .export(
            &ExportRequest::new(TARGET_FILES, ExportSelection::default())
                .with_options(serde_json::json!({ "frontmatter": false })),
        )
        .expect("export");

    assert_eq!(
        text(&artifact(&report, "Progetti/Beta.md").bytes),
        "Beta.\n",
        "«export senza metadati» (17.2), tagliato sullo span del primo blocco"
    );
    assert_eq!(
        text(&artifact(&report, "Diario.md").bytes),
        "Nessun frontmatter qui.\n",
        "chi non ne ha non perde niente"
    );
}

#[test]
fn a_single_document_target_produces_exactly_one_artifact() {
    let (_g, ws) = vault();
    let report = ws
        .export(&ExportRequest::new(
            TARGET_SINGLE,
            ExportSelection::Folder("Progetti".to_string()),
        ))
        .expect("export");

    assert_eq!(report.artifacts.len(), 1);
    let out = text(&artifact(&report, "export.md").bytes);
    assert!(out.starts_with("# Alpha\n"));
    assert!(out.contains("\n---\n"), "i documenti sono separati");
    assert!(out.contains("# Beta\n"));
}

#[test]
fn an_unknown_target_is_refused_by_the_kernel() {
    let (_g, ws) = vault();
    assert!(matches!(
        ws.export(&ExportRequest::new("pdf.print", ExportSelection::default())),
        Err(PluginError::BadArgs(_))
    ));
}

#[test]
fn a_document_that_vanishes_is_a_log_line_and_not_a_failed_export() {
    let (_g, ws) = vault();
    let report = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::Documents(vec![DocId::new("Diario.md"), DocId::new("Sparita.md")]),
        ))
        .expect("un export riuscito a metà è riuscito");

    assert_eq!(report.artifacts.len(), 1);
    assert_eq!(report.log.len(), 1);
    assert_eq!(report.log[0].level, NoteLevel::Warning);
    assert_eq!(report.log[0].entry.as_deref(), Some("Sparita.md"));
}

// --- il giro completo ------------------------------------------------------

#[test]
fn what_goes_out_comes_back_in_identical() {
    // Il round-trip che il §4.3 del piano chiede «appena i trait del §1.7
    // esistono». Non è una proprietà del markdown: è la prova che i due versi
    // del trasferimento si parlano — e che nessuno dei due passa da
    // `serialize`, che è lossy per costruzione.
    let (_g, ws) = vault();
    let esportato = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::default(),
        ))
        .expect("export");

    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vuoto")).expect("utf8");
    std::fs::create_dir_all(&root).unwrap();
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed());
    let mut altro = Workspace::new(&root, registry);
    altro.register_import_provider("fubmd.markdown", MarkdownImport::boxed());
    altro.reindex().expect("reindex");

    for a in &esportato.artifacts {
        // Il path dell'artefatto porta la cartella; il nome del documento è
        // l'ultimo componente, e la cartella la dice la richiesta.
        let (folder, name) = a.path.rsplit_once('/').unwrap_or(("", a.path.as_str()));
        let report = altro
            .import(
                &ImportSource {
                    name: name.to_string(),
                    media_type: Some("text/markdown".to_string()),
                    bytes: a.bytes.clone(),
                },
                &ImportRequest::apply().into_folder(folder),
            )
            .expect("import");
        assert_eq!(report.documents[0].outcome, ImportOutcome::Created);
    }

    assert_eq!(altro.documents(), ws.documents());
    for doc in ws.documents() {
        assert_eq!(
            altro.read_source(&doc).unwrap(),
            ws.read_source(&doc).unwrap(),
            "`{doc}` è tornata diversa da com'era uscita"
        );
    }
}
