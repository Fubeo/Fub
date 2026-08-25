//! I trait della decisione 0006 su un vault vero: una sorgente che entra, degli artefatti
//! che escono, e in mezzo il kernel.
//!
//! Sta qui e non fra i test del kernel per la stessa ragione di
//! `index_queries_e2e.rs`: serve markdown *vero* — il frontmatter che l'export
//! toglie, i link che l'import conta, il documento che si riapre com'era. Il
//! giro è quello che farà un plugin di M5: `Workspace::import` /
//! `Workspace::export`, nessuna scorciatoia sui provider.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{custom_kind, Block, DocId, DocumentModel, Frontmatter, Inline, Span};
use fub_abi::traits::IndexQuery;
use fub_abi::transfer::{
    ConflictPolicy, ExportArtifact, ExportReport, ExportRequest, ExportSelection, ImportMode,
    ImportOutcome, ImportRequest, ImportSource, NoteLevel, SourceContent,
};
use fub_abi::PluginError;
use fub_format_markdown::{
    MarkdownExport, MarkdownImport, MarkdownProvider, TARGET_FILES, TARGET_SINGLE,
};
use fub_kernel::{FormatRegistry, Workspace};
use fub_sdk::testing::conformance;

mod corpus;

use crate::corpus::{corpus, divergent, how_many_cases, mutate, seed, Case64};

/// Un `Workspace` sulla radice data, coi due provider di trasferimento
/// registrati.
fn workspace_on(root: &Utf8Path) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(root, registry).expect("l'apertura del vault riesce");
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    ws.register_core_feature("fub.markdown", "fub.markdown")
        .expect("dichiarato");
    ws.register_import_provider("fub.markdown", MarkdownImport::boxed())
        .expect("registrato");
    ws.register_export_provider("fub.markdown", MarkdownExport::boxed())
        .expect("registrato");
    ws
}

/// Un vault con le note date, posate **sul disco** e non fatte entrare
/// dall'import.
///
/// È la differenza che tiene onesto il round-trip di qui sotto: se le note
/// entrassero dall'import, il presidio confronterebbe l'import con sé stesso e
/// una normalizzazione fatta in tutt'e due i versi passerebbe inosservata.
fn vault_with(notes: &[(String, String)]) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    std::fs::create_dir_all(&root).expect("la radice esiste anche se le note sono zero");
    for (rel, body) in notes {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }
    let mut ws = workspace_on(&root);
    ws.reindex().expect("reindex");
    (dir, ws)
}

/// Un vault a tre note, con i due provider di trasferimento registrati.
///
/// - `Progetti/Alpha.md` (frontmatter, un link a Beta, un tag)
/// - `Progetti/Beta.md`
/// - `Diario.md` (senza frontmatter)
fn vault() -> (tempfile::TempDir, Workspace) {
    vault_with(&[
        (
            "Progetti/Alpha.md".to_string(),
            "---\ntipo: progetto\n---\n\n# Alpha\n\nVedi [[Beta]]. #lavoro\n".to_string(),
        ),
        (
            "Progetti/Beta.md".to_string(),
            "---\ntipo: progetto\n---\n\nBeta.\n".to_string(),
        ),
        (
            "Diario.md".to_string(),
            "Nessun frontmatter qui.\n".to_string(),
        ),
    ])
}

fn artifact<'a>(report: &'a ExportReport, path: &str) -> &'a ExportArtifact {
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
    let existing = "---\ntipo: progetto\n---\n\n# Alpha\n\nVedi [[Beta]]. #lavoro\n";
    let new = "# Altro Alpha\n";
    let source = ImportSource::text_source("Alpha.md", new);
    let alpha = DocId::new("Progetti/Alpha.md");

    // skip: ciò che c'è non si tocca. È il default perché è l'unica politica
    // che non può distruggere lavoro dell'utente.
    let (_g, mut ws) = vault();
    let report = ws
        .import(&source, &ImportRequest::apply().into_folder("Progetti"))
        .expect("import");
    assert_eq!(report.documents[0].outcome, ImportOutcome::Skipped);
    assert_eq!(ws.read_source(&alpha).unwrap(), existing);

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
    assert_eq!(ws.read_source(&alpha).unwrap(), new);

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
         cestino: `VaultRead::free_name`"
    );
    assert_eq!(
        ws.read_source(&alpha).unwrap(),
        existing,
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
        content: SourceContent::Bytes(vec![0x50, 0x4b, 0x03, 0x04]),
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
    let broken = ImportSource {
        name: "Nota.md".to_string(),
        media_type: None,
        content: SourceContent::Bytes(vec![0xff, 0xfe, 0x00]),
    };
    assert!(matches!(
        ws.import(&broken, &ImportRequest::apply()),
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
        text(
            artifact(&report, "Progetti/Beta.md")
                .as_bytes()
                .expect("in memoria")
        ),
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
    // «Export query results» (17.2): la selezione è il canale della decisione 0005, e chi
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
        ExportSelection::Query(IndexQuery::Tags {
            matching: fub_abi::query::QueryExpr::all(),
            page: None,
        }),
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
        text(
            artifact(&report, "Progetti/Beta.md")
                .as_bytes()
                .expect("in memoria")
        ),
        "Beta.\n",
        "«export senza metadati» (17.2), tagliato sullo span del primo blocco"
    );
    assert_eq!(
        text(
            artifact(&report, "Diario.md")
                .as_bytes()
                .expect("in memoria")
        ),
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
    let out = text(
        artifact(&report, "export.md")
            .as_bytes()
            .expect("in memoria"),
    );
    assert!(out.starts_with("# Alpha\n"));
    assert!(out.contains("\n---\n"), "i documenti sono separati");
    assert!(out.contains("# Beta\n"));
}

/// **In una concatenazione un frontmatter non è un frontmatter**, e ciò che ne
/// resta non deve cambiare significato per il posto in cui è finito.
///
/// Un `---` in testa a un file apre i metadati; in mezzo a un documento è un
/// divisore orizzontale, e la riga dopo — `titolo: X` — diventa il testo di
/// un'intestazione setext chiusa dal `---` di chiusura. Copiare la testa dov'era
/// non perdeva byte: ne cambiava il senso, che è peggio, perché il file uscito
/// *sembra* giusto.
///
/// # Una premessa del difetto era falsa, e sembrava vera
///
/// Diceva «dal secondo documento in poi». Sono **tutti**, primo compreso: prima
/// di ogni corpo va un `# Nome`, quindi il frontmatter non è mai in testa
/// nemmeno per il primo. La premessa sembrava vera perché la si legge dal *modo
/// in cui si concatena* — il primo arriva per primo — invece che da *cosa rende
/// un frontmatter un frontmatter*, che è stare al byte zero.
#[test]
fn in_a_document_single_the_frontmatter_remains_metadata_and_not_becomes_a_separator() {
    let (_g, ws) = vault();
    let report = ws
        .export(&ExportRequest::new(
            TARGET_SINGLE,
            ExportSelection::Folder("Progetti".to_string()),
        ))
        .expect("export");
    let out = text(
        artifact(&report, "export.md")
            .as_bytes()
            .expect("in memoria"),
    );

    // I byte dei metadati ci sono tutti, per tutt'e due le note.
    assert_eq!(
        out.matches("tipo: progetto").count(),
        2,
        "il documento unico ha perso dei metadati:\n{out}"
    );

    // E non sono diventati sintassi: ciò che li porta è un recinto, quindi il
    // modello del documento uscito li vede come **codice**, non come un divisore
    // seguito da un'intestazione.
    let m = model(out, "export.md");
    let fences: Vec<&String> = m
        .body
        .iter()
        .filter_map(|b| match b {
            Block::CodeBlock { lang, code, .. } if lang.as_deref() == Some("yaml") => Some(code),
            _ => None,
        })
        .collect();
    assert_eq!(
        fences.len(),
        2,
        "i due frontmatter non sono due blocchi yaml:\n{out}"
    );
    for r in fences {
        assert!(r.contains("tipo: progetto"), "recinto: {r:?}");
    }
    assert_eq!(
        m.body
            .iter()
            .filter(|b| matches!(b, Block::ThematicBreak { .. }))
            .count(),
        1,
        "l'unico divisore ammesso è quello che separa i due documenti:\n{out}"
    );

    // L'altra metà dell'opzione: senza metadati non ne esce nessuno, ed è ciò
    // che rende la bandiera una scelta invece di una parola.
    let without = ws
        .export(
            &ExportRequest::new(
                TARGET_SINGLE,
                ExportSelection::Folder("Progetti".to_string()),
            )
            .with_options(serde_json::json!({ "frontmatter": false })),
        )
        .expect("export");
    let out = text(
        artifact(&without, "export.md")
            .as_bytes()
            .expect("in memoria"),
    );
    assert!(
        !out.contains("tipo: progetto"),
        "«senza metadati» ne ha lasciati:\n{out}"
    );
}

#[test]
fn a_frontmatter_empty_not_becomes_syntax_in_the_document_single() {
    let (_g, ws) = vault_with(&[
        ("Prima.md".to_string(), "---\n\n---\n\nCorpo.\n".to_string()),
        ("Seconda.md".to_string(), "Altro.\n".to_string()),
    ]);
    let report = ws
        .export(
            &ExportRequest::new(
                TARGET_SINGLE,
                ExportSelection::Documents(vec![DocId::new("Prima.md"), DocId::new("Seconda.md")]),
            )
            .with_options(serde_json::json!({ "frontmatter": false })),
        )
        .expect("export");
    let out = text(
        artifact(&report, "export.md")
            .as_bytes()
            .expect("in memoria"),
    );

    let model = model(out, "export.md");
    assert_eq!(
        model
            .body
            .iter()
            .filter(|b| matches!(b, Block::ThematicBreak { .. }))
            .count(),
        1,
        "l'unico divisore ammesso separa i due documenti:\n{out}"
    );
    assert!(out.contains("Corpo."));
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

/// Rimette un artefatto dentro un vault, **dalla porta dell'import**.
///
/// Il path dell'artefatto porta la cartella; il nome del documento è l'ultimo
/// componente, e la cartella la dice la richiesta — che è il confine della
/// decisione 0006: una sorgente ha un nome, non un path.
fn reimport(ws: &mut Workspace, a: &ExportArtifact) -> DocId {
    let (folder, name) = a.path.rsplit_once('/').unwrap_or(("", a.path.as_str()));
    let report = ws
        .import(
            &ImportSource {
                name: name.to_string(),
                media_type: Some("text/markdown".to_string()),
                content: SourceContent::Bytes(a.as_bytes().expect("in memoria").to_vec()),
            },
            &ImportRequest::apply().into_folder(folder),
        )
        .unwrap_or_else(|and| panic!("`{}` non è rientrata: {and}", a.path));
    assert_eq!(report.documents.len(), 1);
    assert_eq!(
        report.documents[0].outcome,
        ImportOutcome::Created,
        "`{}` doveva entrare in un vault vuoto e invece è {:?}",
        a.path,
        report.documents[0].outcome
    );
    report.documents[0].doc.clone()
}

#[test]
fn what_goes_out_comes_back_in_identical() {
    // Il round-trip che il §17.1 del piano chiede «appena i trait della decisione 0006
    // esistono». Non è una proprietà del markdown: è la prova che i due versi
    // del trasferimento si parlano — e che nessuno dei due passa da
    // `serialize`, che è lossy per costruzione.
    //
    // Su un vault scritto a mano: quello **sul corpus**, che il §17.1 chiede
    // subito dopo, sta in fondo a questo file.
    let (_g, ws) = vault();
    let exported = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::default(),
        ))
        .expect("export");

    let (_g2, mut other) = vault_with(&[]);
    for a in &exported.artifacts {
        reimport(&mut other, a);
    }

    assert_eq!(other.documents(), ws.documents());
    for doc in ws.documents() {
        assert_eq!(
            other.read_source(&doc).unwrap(),
            ws.read_source(&doc).unwrap(),
            "`{doc}` è tornata diversa da com'era uscita"
        );
    }
}

// --- il giro completo, sul corpus ------------------------------------------
//
// La riga del §17.1 che diceva «resta da farlo **sul corpus**, dove la proprietà
// smette di essere un esempio e diventa una misura». Il corpus è quello della
// [0060](../../../docs/decisions/0180-compatibilita-wit-additiva.md), e
// arriva da `tests/corpus/mod.rs`: le stesse sorgenti che là si guardano dal
// lato del modello, qui diventano **note di un vault**.
//
// La tesi che rende possibile tutto questo, e che va provata invece che
// affermata: il verso che copia i byte **non passa dal modello**, quindi le
// tredici divergenze dichiarate non lo toccano — ed è per questo che le loro
// sorgenti stanno nel vault accanto ai casi curati, e non fuori. L'unico verso
// che dal modello ci passa è `frontmatter: false`, che taglia il file sullo span
// del primo blocco: è là che il corpus morde, ed è là che questo file guarda.

/// Le note del vault del corpus: una per caso curato, una per sorgente
/// divergente, in due cartelle che dicono da quale elenco vengono.
fn notes_of_the_corpus() -> Vec<(String, String)> {
    corpus()
        .into_iter()
        .map(|c| (format!("corpus/{}.md", c.name), c.source.to_string()))
        .chain(
            divergent()
                .into_iter()
                .map(|c| (format!("divergenze/{}.md", c.name), c.source.to_string())),
        )
        .collect()
}

/// Il frontmatter che si mette davanti a una sorgente per farle attraversare il
/// verso che passa dal modello.
const HAT: &str = "---\na: 1\n---\n\n";

/// Le stesse sorgenti, **con un frontmatter davanti**.
///
/// Serve perché senza di loro il presidio del taglio sarebbe quasi tutto vuoto:
/// delle settantacinque sorgenti del corpus **quattro** hanno un frontmatter, e
/// `strip_frontmatter` su un documento che non ne ha restituisce il sorgente
/// tale e quale ([`super::MarkdownExport`], `transfer.rs`). Su settantuno note su
/// settantacinque, quindi, «l'uscita è una coda del sorgente» e «la struttura non
/// è cambiata» sono `x == x`: verdi, e su nulla. Uno `strip_frontmatter` che non
/// facesse niente le passerebbe tutte.
///
/// Con il cappello davanti il taglio avviene su ognuna, e il corpus torna a essere
/// quello che deve: l'elenco delle forme su cui quello span è stato guardato.
///
/// Le quattro che già hanno un frontmatter restano fuori, e non per pigrizia:
/// mettergliene un secondo davanti costruisce il caso del doppio frontmatter, che
/// è la maglia dichiarata di [`and_that_fixed_point_is_a_fact_about_this_corpus_not_about_the_format`]
/// — il primo giro ne toglie uno e scopre l'altro. Farle entrare qui vorrebbe dire
/// pretendere il punto fisso proprio dove è noto che non tiene.
///
/// Restano fuori anche le tre di [`OUTSIDE_FROM_THE_HAT`], ciascuna con la sua
/// ragione, e [`the_exclusions_from_the_hat_serve_again`] pretende che ognuna
/// diverga davvero: una scusa che non serve più è la cosa peggiore di un elenco a
/// mano, perché sta lì a dire che qualcosa non si può fare e nessuno la
/// ricontrolla.
fn notes_with_hat() -> Vec<(String, String)> {
    notes_of_the_corpus()
        .into_iter()
        .filter(|(path, source)| model(source, path).frontmatter.is_empty())
        .filter(|(path, _)| {
            let name = case_name(path);
            !OUTSIDE_FROM_THE_HAT.iter().any(|(n, _)| *n == name)
        })
        .map(|(path, source)| {
            (
                format!("cappello/{}.md", case_name(&path)),
                format!("{HAT}{source}"),
            )
        })
        .collect()
}

fn case_name(path: &str) -> &str {
    path.rsplit_once('/')
        .map(|(_, n)| n)
        .unwrap_or(path)
        .strip_suffix(".md")
        .expect("l'estensione la mettiamo noi")
}

/// Le sorgenti a cui il cappello **non** si può mettere, e la ragione.
///
/// Non è una lacuna del presidio: è dove passa il confine di ciò che «togliere il
/// frontmatter» può promettere. Mettere dei byte davanti a un documento cambia
/// *dove cominciano* i suoi, e ci sono byte per cui quel dove **è** significato —
/// tolto il frontmatter tornano in testa, e in testa vogliono dire un'altra cosa.
/// Il taglio non ha spostato niente: è il documento che, cominciando altrove,
/// significa altro.
const OUTSIDE_FROM_THE_HAT: [(&str, &str); 3] = [
    (
        "bom",
        "un BOM in mezzo al documento è testo; tolto il frontmatter torna in testa e \
         smette di esserlo, quindi l'heading che lo segue torna un heading",
    ),
    (
        "solo un bom",
        "la stessa cosa sul documento che è **solo** un BOM: col cappello davanti ha \
         un paragrafo, tagliato non ha niente",
    ),
    (
        "frontmatter illeggibile",
        "col cappello davanti diventa un doppio frontmatter, che è la maglia già \
         dichiarata da `and_that_fixed_point_is_a_fact_about_this_corpus_not_about_the_format`",
    ),
];

#[test]
fn the_exclusions_from_the_hat_serve_again() {
    for (name, reason) in OUTSIDE_FROM_THE_HAT {
        let source = corpus()
            .into_iter()
            .chain(divergent())
            .find(|c| c.name == name)
            .unwrap_or_else(|| {
                panic!(
                    "`{name}` è escluso dal cappello e non è più nel corpus: la \
                     scusa nomina un caso che non c'è"
                )
            })
            .source;
        let path = "Prova.md".to_string();
        let hatted = format!("{HAT}{source}");
        let (_g, ws) = vault_with(&[(path.clone(), hatted.clone())]);
        let outside = ws.export(&without_metadata()).expect("export");
        let cut = text(outside.artifacts[0].as_bytes().expect("in memoria"));
        // Il confronto è quello del presidio: il documento **come sta nel vault**
        // contro quello che ne esce senza metadati. Confrontare l'uscita con la
        // sorgente originale direbbe un'altra cosa — che il taglio ha reso i byte
        // che erano — e sarebbe vero per costruzione.
        assert_ne!(
            structure(&model(cut, &path)),
            structure(&model(&hatted, &path)),
            "`{name}` è escluso dal cappello perché «{reason}», e adesso col \
             cappello davanti si comporta come tutti gli altri.\n\
             Se è stato riparato è una bella notizia e va scritta nel verbale: \
             questa riga va tolta da `OUTSIDE_FROM_THE_HAT`, e il caso torna nella \
             famiglia dove le pretese sono tutte."
        );
    }
}

/// La richiesta «tutto il vault, senza metadati»: l'unica opzione dell'export
/// markdown, e l'unico verso che passa dal modello.
fn without_metadata() -> ExportRequest {
    ExportRequest::new(TARGET_FILES, ExportSelection::default())
        .with_options(serde_json::json!({ "frontmatter": false }))
}

fn model(source: &str, doc_id: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian(doc_id))
        .unwrap_or_else(|and| panic!("`{doc_id}` non parsa: {and}"))
}

/// Ciò che di un documento **non deve cambiare** quando gli si toglie il
/// frontmatter, letto senza gli offset.
///
/// I tag ci sono, e la ragione va scritta perché la prima versione di questa
/// funzione li escludeva credendo il contrario: un `tag: [a, b]` nel frontmatter
/// **non è** un tag del documento. `parse_markdown` popola `model.tags` solo dai
/// `#tag` scritti nel corpo (`parse.rs`, `push_plain_or_tags`) e non travasa mai il
/// frontmatter; quindi togliendo il frontmatter i tag non cambiano, e escluderli
/// era buttare via del segnale credendo di dichiarare una scelta.
///
/// Questa proiezione serve a produrre un **messaggio leggibile**: la garanzia
/// forte è il confronto del modello intero in
/// [`without_metadata_the_round_trip_is_a_fixed_point`], che con gli span rimessi
/// al loro posto non lascia passare niente. Una lista di righe però si legge, e un
/// `DocumentModel` a schermo no.
fn structure(d: &DocumentModel) -> Vec<String> {
    let mut outside = Vec::new();
    outside.extend(kind_of_the_blocks(&d.body));
    for h in &d.outline {
        outside.push(format!("heading {} {:?} {:?}", h.level, h.slug, h.text));
    }
    for t in &d.tags {
        outside.push(format!("tag {:?}", t.name));
    }
    // I bersagli dei link li proietta l'SDK e non questo file:
    // `conformance::targets` esiste dalla 0060 per «la forma in cui un corpus li
    // confronta con ciò che si aspetta», e fino a qui era **senza un cliente** —
    // dichiarata tale nel suo doc, con la condizione che il primo corpus a
    // chiedersi *cosa un documento nomina* le desse una ragione o la togliesse.
    // Questo è quel corpus. (Non era la sola del banco in quello stato:
    // `cio_che_non_e_perduto_si_ritrova` è ancora là, dichiarata dalla 0054, e non
    // la chiama questo file.)
    //
    // È un insieme, quindi perde l'ordine, i doppioni e il flag `embed`: la riga
    // dopo li rimette, perché un taglio che duplica un link o che ne perde
    // l'incorporamento è esattamente il difetto che si sta cercando.
    for b in conformance::targets(d) {
        outside.push(format!("nomina {b}"));
    }
    outside.push(format!(
        "{} link, di cui {} incorporati",
        d.links.len(),
        d.links.iter().filter(|the| the.embed).count()
    ));
    for a in &d.anchors {
        outside.push(format!("ancora {:?}", a.id));
    }
    outside.push(format!("testo {:?}", d.text));
    outside
}

/// La specie di ogni blocco, annidamento compreso, e ciò che la distingue da un
/// blocco della stessa specie: lo stato di una task, il linguaggio di un code
/// block, l'allineamento di una tabella.
///
/// Senza questa, `structure` non vedeva la differenza fra `- [x] fatta` e
/// `- [ ] fatta`, fra un code block recintato e uno indentato, fra una citazione e
/// un paragrafo: tre coppie di sorgenti diverse con la stessa proiezione.
fn kind_of_the_blocks(bs: &[Block]) -> Vec<String> {
    let mut outside = Vec::new();
    for b in bs {
        match b {
            Block::Heading { level, .. } => outside.push(format!("blocco heading {level}")),
            Block::Paragraph { .. } => outside.push("blocco paragrafo".to_string()),
            Block::CodeBlock { lang, code, .. } => {
                outside.push(format!("blocco codice {lang:?} {code:?}"))
            }
            Block::ThematicBreak { .. } => outside.push("blocco riga".to_string()),
            Block::ReferenceDefinition {
                label, url, title, ..
            } => outside.push(format!(
                "blocco definizione riferimento {label:?} {url:?} {title:?}"
            )),
            Block::List { ordered, items, .. } => {
                outside.push(format!("blocco lista ordinata={ordered}"));
                for it in items {
                    // Il simbolo, non il `TaskMarker` intero: quello porta uno span,
                    // e uno span dentro una proiezione dichiarata «senza gli offset»
                    // la fa divergere per il solo fatto che il taglio è avvenuto.
                    // È il difetto che questa riga aveva nella prima versione.
                    outside.push(format!(
                        "  voce task={:?}",
                        it.task.as_ref().map(|t| t.symbol)
                    ));
                    outside.extend(kind_of_the_blocks(&it.blocks).into_iter().map(indenta));
                }
            }
            Block::Quote { blocks, .. } => {
                outside.push("blocco citazione".to_string());
                outside.extend(kind_of_the_blocks(blocks).into_iter().map(indenta));
            }
            Block::Custom {
                custom_kind,
                attrs,
                blocks,
                ..
            } => {
                outside.push(format!("blocco {custom_kind} {attrs}"));
                outside.extend(kind_of_the_blocks(blocks).into_iter().map(indenta));
            }
            Block::Table {
                head, rows, align, ..
            } => {
                outside.push(format!(
                    "blocco tabella intestazione={} righe={} allineamenti={align:?}",
                    head.is_some(),
                    rows.len()
                ));
            }
        }
        if let Some(a) = b.anchor() {
            outside.push(format!("  ancora del blocco {a:?}"));
        }
    }
    outside
}

fn indenta(r: String) -> String {
    format!("  {r}")
}

/// Sposta ogni offset del modello di `delta` byte.
///
/// È ciò che rende confrontabili i due modelli senza rinunciare agli span. La
/// prima versione di questo presidio li escludeva dicendo che «direbbero soltanto
/// che un taglio è avvenuto», e non era vero: l'invariante della coda ha già
/// stabilito quanti byte sono usciti, quindi lo scostamento **è noto** ed è
/// `source.len() - fuori.len()`. Rimessi a posto, gli span diventano la parte più
/// severa del confronto — sono la sola cosa che vede un taglio che ha spostato dei
/// byte invece di toglierne un prefisso.
fn shift_spans(d: &mut DocumentModel, delta: usize) {
    fn s(x: &mut Span, delta: usize) {
        x.start += delta;
        x.end += delta;
    }
    fn within_inlines(is: &mut [Inline], delta: usize) {
        for the in is {
            match the {
                Inline::Link { label, span, .. } => {
                    s(span, delta);
                    if let Some(the) = label {
                        within_inlines(the, delta);
                    }
                }
                Inline::TagRef { span, .. } | Inline::Custom { span, .. } => s(span, delta),
                Inline::Emph(within)
                | Inline::Strong(within)
                | Inline::Superscript(within)
                | Inline::Strikethrough(within) => within_inlines(within, delta),
                // I due a-capo non portano span: come Text e Code.
                Inline::Text(_) | Inline::Code(_) | Inline::HardBreak | Inline::SoftBreak => {}
            }
        }
    }
    fn within_blocks(bs: &mut [Block], delta: usize) {
        for b in bs {
            match b {
                Block::Heading { inlines, span, .. } | Block::Paragraph { inlines, span, .. } => {
                    s(span, delta);
                    within_inlines(inlines, delta);
                }
                Block::List { items, span, .. } => {
                    s(span, delta);
                    for it in items {
                        s(&mut it.span, delta);
                        if let Some(t) = &mut it.task {
                            s(&mut t.span, delta);
                        }
                        within_blocks(&mut it.blocks, delta);
                    }
                }
                Block::CodeBlock { span, .. }
                | Block::ThematicBreak { span, .. }
                | Block::ReferenceDefinition { span, .. } => s(span, delta),
                Block::Quote { blocks, span, .. } | Block::Custom { blocks, span, .. } => {
                    s(span, delta);
                    within_blocks(blocks, delta);
                }
                Block::Table {
                    head, rows, span, ..
                } => {
                    s(span, delta);
                    for row in head.iter_mut().chain(rows.iter_mut()) {
                        for cell in &mut row.cells {
                            s(&mut cell.span, delta);
                            within_inlines(&mut cell.inlines, delta);
                        }
                    }
                }
            }
        }
    }
    within_blocks(&mut d.body, delta);
    for h in &mut d.outline {
        s(&mut h.span, delta);
    }
    for the in &mut d.links {
        s(&mut the.span, delta);
    }
    for t in &mut d.tags {
        s(&mut t.span, delta);
    }
    for a in &mut d.anchors {
        s(&mut a.span, delta);
        s(&mut a.marker, delta);
    }
}

#[test]
fn the_corpus_names_are_usable_as_notes_names() {
    // Un nome del corpus diventa il nome di un file. Se due casi collidessero, o
    // se un nome portasse una barra, il vault del round-trip avrebbe meno note
    // del corpus — e il confronto sui byte passerebbe lo stesso, avendo
    // confrontato di meno. È la stessa specie di guardia di `confronta` in
    // `il_corpus.rs`: un elenco che si svuota passa sempre.
    let notes = notes_of_the_corpus();
    let mut seen = std::collections::BTreeSet::new();
    for (path, _) in &notes {
        let name = path
            .rsplit_once('/')
            .expect("le note stanno in due cartelle")
            .1;
        let name = name
            .strip_suffix(".md")
            .expect("l'estensione la mettiamo noi");
        assert!(!name.is_empty(), "un caso senza nome");
        assert!(
            !name.contains('/') && !name.contains('\\') && !name.contains('\n'),
            "il nome del caso `{name}` non è un componente di path solo"
        );
        assert!(seen.insert(path.clone()), "due casi si chiamano `{path}`");
    }
    assert_eq!(
        notes.len(),
        corpus().len() + divergent().len(),
        "il vault del corpus non ha una nota per sorgente: qualche nome è collassato \
         su un altro"
    );
    assert!(
        notes.len() >= 75,
        "il vault del corpus ha {} note su settantacinque: il corpus si è svuotato, \
         e un round-trip su niente è verde. La soglia è il conteggio di oggi — sale \
         con lui, e scende solo in un commit che dice perché",
        notes.len()
    );
}

#[test]
fn the_whole_corpus_leaves_the_vault_and_comes_back_byte_for_byte() {
    let notes = notes_of_the_corpus();
    let (_g, ws) = vault_with(&notes);

    // Prima ancora del giro: i byte del caso sono i byte che il vault
    // restituisce. Se il kernel normalizzasse in lettura — un BOM tolto, un CRLF
    // ridotto — il round-trip resterebbe verde normalizzando due volte, e questa
    // riga è ciò che impedisce a quel verde di essere vuoto.
    for (path, source) in &notes {
        let doc = DocId::new(path.as_str());
        let read_value = ws
            .read_source(&doc)
            .unwrap_or_else(|and| panic!("`{path}` non si rilegge: {and}"));
        assert_eq!(
            read_value, *source,
            "`{path}`: il vault non restituisce i byte che ci sono stati messi"
        );
    }

    let exported = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::default(),
        ))
        .expect("export");
    assert_eq!(
        exported.artifacts.len(),
        notes.len(),
        "l'export ha lasciato indietro delle note"
    );
    assert!(
        exported.log.is_empty(),
        "un export senza problemi non ha righe di log: {:?}",
        exported.log
    );

    // L'export non tocca i byte…
    for a in &exported.artifacts {
        let expected = ws
            .read_source(&DocId::new(a.path.as_str()))
            .expect("il documento c'è, l'abbiamo appena esportato");
        assert_eq!(
            text(a.as_bytes().expect("in memoria")),
            expected.as_str(),
            "`{}` è uscita diversa da com'era nel vault",
            a.path
        );
    }

    // …e l'import nemmeno.
    let (_g2, mut other) = vault_with(&[]);
    for a in &exported.artifacts {
        reimport(&mut other, a);
    }
    assert_eq!(
        other.documents(),
        ws.documents(),
        "il vault d'arrivo non ha gli stessi documenti di quello di partenza"
    );
    for doc in ws.documents() {
        assert_eq!(
            other.read_source(&doc).unwrap(),
            ws.read_source(&doc).unwrap(),
            "`{doc}` è tornata diversa da com'era uscita"
        );
    }
}

#[test]
fn without_metadata_the_round_trip_is_a_fixed_point() {
    // Il verso che passa dal modello. `strip_frontmatter` taglia il sorgente su
    // `first.span().start`, quindi qui il corpus non è più solo un mucchio di
    // byte: è l'elenco delle forme su cui quello span è stato guardato.
    //
    // E ci sta **due volte**: come sono, e col cappello di frontmatter davanti.
    // Senza il cappello il taglio avverrebbe su quattro note su settantacinque, e
    // sulle altre settantuno ogni assert qui sotto sarebbe `x == x`.
    let mut notes = notes_of_the_corpus();
    notes.extend(notes_with_hat());
    let (_g, ws) = vault_with(&notes);

    let first = ws.export(&without_metadata()).expect("export");
    assert_eq!(first.artifacts.len(), notes.len());

    let mut projected = std::collections::BTreeSet::new();
    let mut cut = 0usize;
    for a in &first.artifacts {
        let source = ws.read_source(&DocId::new(a.path.as_str())).unwrap();
        let outside = text(a.as_bytes().expect("in memoria"));

        // L'invariante che vale su qualunque ingresso: togliendo il frontmatter
        // l'export **non può inventare byte**. Ciò che esce è il sorgente, o una
        // sua coda, o niente. Debole da sola — una coda sbagliata resta una coda
        // — ed è la ragione delle due righe dopo.
        assert!(
            source.ends_with(outside),
            "`{}` senza metadati non è una coda del sorgente:\n  fuori {:?}\n  dentro {:?}",
            a.path,
            outside,
            source
        );
        if outside.len() == source.len() {
            // Nessun frontmatter da togliere: qui non c'è niente da presidiare, e
            // contarla fra le tagliate sarebbe contare un `x == x`.
            continue;
        }
        cut += 1;

        // La proiezione leggibile, che è quella che si legge quando diventa rossa.
        // Il frontmatter illeggibile è metadata come quello proiettato: il suo
        // blocco verbatim non appartiene al corpo atteso dopo l'export.
        let mut expected = model(&source, a.path.as_str());
        if matches!(
            expected.body.first(),
            Some(Block::Custom { custom_kind, .. })
                if custom_kind == custom_kind::FRONTMATTER_UNPARSED
        ) {
            expected.body.remove(0);
        }
        let before = structure(&expected);
        projected.extend(before.iter().cloned());
        assert_eq!(
            structure(&model(outside, a.path.as_str())),
            before,
            "`{}`: togliendo il frontmatter è cambiato anche il corpo. Il taglio \
             sullo span ha spostato dei byte invece di toglierne un prefisso",
            a.path
        );

        // E quella severa: **il taglio prende un prefisso e nient'altro.** Lo
        // scostamento è noto — l'invariante della coda l'ha appena stabilito —
        // quindi gli span si possono rimettere al loro posto, e i due modelli
        // devono essere identici. Il frontmatter è la sola differenza ammessa: è
        // ciò che si è tolto.
        let delta = source.len() - outside.len();
        let mut rimesso = model(outside, a.path.as_str());
        shift_spans(&mut rimesso, delta);
        expected.frontmatter = Frontmatter::default();
        // E la sua **presenza**, che dal 0213 è un campo a sé: una mappa vuota
        // non distingue «non c'era» da «c'era e non aveva chiavi», e l'export
        // senza metadati toglie i delimitatori insieme alle chiavi. Azzerare
        // solo la mappa lascerebbe qui l'unica differenza che è proprio ciò
        // che si voleva togliere.
        expected.frontmatter_present = false;
        assert_eq!(
            rimesso, expected,
            "`{}`: il modello del documento tagliato, con gli span rimessi indietro \
             di {delta} byte, non è quello di prima. È il confronto che vede un \
             taglio spostato di un byte, che la sola proiezione qui sopra non vede",
            a.path
        );
    }

    // Le due guardie che un confronto fra proiezioni non può darsi da sé.
    //
    // La prima: quante note hanno **davvero** attraversato il taglio. Senza questa
    // riga uno `strip_frontmatter` che restituisse sempre il sorgente passerebbe
    // tutti gli assert qui sopra, perché diventerebbero riflessivi — ed è
    // precisamente il difetto per cui esiste il cappello.
    let with_frontmatter = notes
        .iter()
        .filter(|(p, s)| {
            let parsed = model(s, p);
            parsed.frontmatter_present
                || matches!(
                    parsed.body.first(),
                    Some(Block::Custom { custom_kind, .. })
                        if custom_kind == custom_kind::FRONTMATTER_UNPARSED
                )
        })
        .count();
    assert_eq!(
        cut, with_frontmatter,
        "il taglio è avvenuto su {cut} note e {with_frontmatter} hanno un \
         frontmatter: sono lo stesso insieme o non lo sono. Se `tagliate` è meno, \
         `strip_frontmatter` ha smesso di tagliare su qualcosa che doveva."
    );
    assert!(
        cut >= 70,
        "il taglio è avvenuto su {cut} note su {}: sotto questa soglia la prova \
         sta confrontando quasi ogni documento con sé stesso, ed è il difetto per \
         cui esiste il cappello.",
        notes.len()
    );

    // La seconda: se `structure` proiettasse il vuoto, i due lati sarebbero uguali
    // per ogni documento. È la stessa specie di rifiuto di `confronta` in
    // `il_corpus.rs` — «un confronto contro il vuoto passa sempre» — e nessun
    // sabotaggio della sola proiezione potrebbe farla diventare rossa.
    for expected in ["blocco ", "heading ", "nomina ", "ancora ", "tag "] {
        assert!(
            projected.iter().any(|r| r.starts_with(expected)),
            "in {cut} note tagliate la proiezione non ha prodotto una sola riga \
             `{expected}…`: sta confrontando meno di quel che dice.\n\
             Ha prodotto: {projected:#?}"
        );
    }
    assert!(
        projected
            .iter()
            .any(|r| r.starts_with("testo") && r.len() > 12),
        "nessuna nota ha del testo indicizzato: la proiezione confronta stringhe \
         vuote"
    );

    let (_g2, mut other) = vault_with(&[]);
    for a in &first.artifacts {
        reimport(&mut other, a);
    }
    let second = other.export(&without_metadata()).expect("export");

    assert_eq!(
        first.artifacts.iter().map(|a| &a.path).collect::<Vec<_>>(),
        second.artifacts.iter().map(|a| &a.path).collect::<Vec<_>>(),
    );
    for (a, b) in first.artifacts.iter().zip(second.artifacts.iter()) {
        assert_eq!(
            text(b.as_bytes().expect("in memoria")),
            text(a.as_bytes().expect("in memoria")),
            "`{}`: il secondo giro senza metadati ha tolto altro. Il taglio sullo \
             span ha lasciato dietro qualcosa che al giro dopo è tornato a essere \
             frontmatter",
            a.path
        );
    }
}

#[test]
fn and_that_fixed_point_is_a_fact_about_this_corpus_not_about_the_format() {
    // La maglia della prova qui sopra, scritta invece che taciuta: il punto fisso
    // **non** è una proprietà dell'export. Due frontmatter in fila, e il primo
    // giro toglie il primo scoprendo il secondo — che al giro dopo è frontmatter
    // a tutti gli effetti, perché il frontmatter si riconosce dall'inizio del
    // documento e l'inizio del documento è cambiato.
    //
    // Sta qui nella forma delle divergenze dichiarate della 0060: se qualcuno lo
    // ripara — un export che taglia finché c'è da tagliare — questa prova diventa
    // rossa, e va tolta. È il solo modo di non lasciare la maglia silenziosa.
    let double_frontmatter = "---\na: 1\n---\n\n---\nb: 2\n---\n\nx\n";
    let (_g, ws) = vault_with(&[("Doppio.md".to_string(), double_frontmatter.to_string())]);

    let first = ws.export(&without_metadata()).expect("export");
    let exited = text(first.artifacts[0].as_bytes().expect("in memoria")).to_string();
    assert!(
        double_frontmatter.ends_with(&exited),
        "anche qui l'export non inventa byte"
    );

    let (_g2, mut other) = vault_with(&[]);
    reimport(&mut other, &first.artifacts[0]);
    let second = other.export(&without_metadata()).expect("export");

    assert_ne!(
        text(second.artifacts[0].as_bytes().expect("in memoria")),
        exited.as_str(),
        "il secondo giro non ha tolto niente: o comrak ha smesso di vedere il \
         secondo `---` come frontmatter, o l'export ha imparato a tagliare fino \
         in fondo. Nel secondo caso è una bella notizia e questa prova va tolta"
    );
}

// --- il fuzzer del trasferimento -------------------------------------------
//
// L'altra porta d'ingresso del corpus, la stessa della 0060: le mutazioni. Là il
// bersaglio era il parser — «un parser che pania è un vault che non si apre»;
// qui è l'export, e la frase gemella è che **un export che pania è un vault che
// non esce**.
//
// La ragione per cui questo presidio ha un bersaglio vero e non è simmetria:
// `strip_frontmatter` fa `source[first.span().start..]`, cioè affetta i byte del
// file con un numero che viene dal modello. Uno span fuori range, o in mezzo a un
// carattere, non è un modello sbagliato — è un panico dentro l'export. La
// proprietà che lo impedisce esiste dalla 0060
// (`conformance::spans_slice_the_source`) e fino a oggi non aveva un
// cliente di produzione di cui si potesse dire «protegge questo». Adesso ce l'ha.

#[test]
fn no_mutation_of_the_corpus_makes_the_export_slice_outside_the_bytes() {
    // Lo stesso conteggio del fuzzer del parser, che è un budget e non una
    // simmetria: ventimila mutazioni costano qui 3,3 s e là 2,6, cioè 0,17 ms per
    // caso contro 0,13. La differenza non è la scrittura del file né l'indice — è
    // che metà dei semi sono più lunghi, avendo un frontmatter davanti.
    let cases = how_many_cases("FUB_FUZZ_TRASFERIMENTO", 20_000);
    assert!(
        cases >= 1_000,
        "{cases} mutazioni non sono un fuzzer: con zero il ciclo non gira nemmeno, e \
         ogni assert qui sotto viene saltato senza che niente diventi rosso. Per \
         alzarlo si passa `FUB_FUZZ_TRASFERIMENTO`; per abbassarlo sotto mille non \
         c'è ragione che valga il verde falso che si compra."
    );
    let mut rng = Case64::new(seed());

    // I semi sono il corpus **e il corpus col cappello di frontmatter davanti**, e
    // la seconda metà è ciò che dà al fuzzer un bersaglio. Misurato senza:
    // sole 560 mutazioni su 20 000 conservavano un frontmatter, cioè il 2,8% —
    // sulle altre 19 440 `strip_frontmatter` restituisce il sorgente tale e quale e
    // l'assert diventa `source.ends_with(source)`. Un fuzzer che nel 97% dei casi
    // non arriva al codice che dichiara di provare sta contando le sue corse, non
    // le sue prove.
    let hatted: Vec<String> = corpus()
        .iter()
        .chain(divergent().iter())
        .map(|c| format!("{HAT}{}", c.source))
        .collect();
    let mut seeds: Vec<&str> = corpus()
        .iter()
        .map(|c| c.source)
        .chain(divergent().iter().map(|c| c.source))
        .collect();
    seeds.extend(hatted.iter().map(|s| s.as_str()));

    // Le mutazioni entrano tutte in **un** vault: costruire un vault per caso
    // costerebbe ventimila tempdir e misurerebbe il filesystem, non l'export.
    let mutations: Vec<(&'static str, String)> =
        (0..cases).map(|_| mutate(&mut rng, &seeds)).collect();
    let notes: Vec<(String, String)> = mutations
        .iter()
        .enumerate()
        .map(|(n, (_, source))| (format!("fuzz/{n:05}.md"), source.clone()))
        .collect();
    let (_g, ws) = vault_with(&notes);
    assert_eq!(
        ws.documents().len(),
        cases,
        "il vault delle mutazioni ha perso delle note per strada"
    );

    // Documento per documento, per avere l'attribuzione: un panico deve dire
    // **quale** mutazione, non solo che è successo.
    let mut cut = 0usize;
    let mut empty = 0usize;
    for (n, (mutation, source)) in mutations.iter().enumerate() {
        let doc = DocId::new(format!("fuzz/{n:05}.md"));
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ws.export(
                &ExportRequest::new(TARGET_FILES, ExportSelection::Documents(vec![doc.clone()]))
                    .with_options(serde_json::json!({ "frontmatter": false })),
            )
        }));
        let report = match outcome {
            Ok(r) => r.unwrap_or_else(|and| {
                panic!("caso {n} — mutazione «{mutation}» — non è nemmeno uscita: {and}")
            }),
            Err(_) => panic!(
                "caso {n} di {cases} — mutazione «{mutation}» — ha fatto panicare\n\
                 l'export. Il panico vero è stampato qui sopra.\n\
                 \n\
                 Per rifarlo esattamente, con lo stesso conteggio: la sequenza è\n\
                 deterministica e si ferma di nuovo al caso {n}.\n\
                 FUB_FUZZ_SEME={seed} FUB_FUZZ_TRASFERIMENTO={cases} cargo test -p \
                 fub-format-markdown --test transfer_e2e -- no_mutation_of\n\
                 \n\
                 La sorgente, byte per byte: {source:?}",
                seed = seed(),
            ),
        };

        assert_eq!(report.artifacts.len(), 1);
        let outside = text(report.artifacts[0].as_bytes().expect("in memoria"));
        assert!(
            source.ends_with(outside),
            "caso {n} — mutazione «{mutation}» — l'export senza metadati ha\n\
             prodotto qualcosa che non è una coda del sorgente. Il taglio sullo\n\
             span ha spostato dei byte invece di toglierne un prefisso.\n\
             \n\
             fuori: {outside:?}\n\
             dentro: {source:?}"
        );
        if outside.len() != source.len() {
            cut += 1;
            if outside.is_empty() {
                empty += 1;
            }
        }
    }

    // Quante mutazioni sono arrivate al codice che questo fuzzer dichiara di
    // provare. Senza questa riga il conteggio dei casi direbbe ventimila e il
    // numero delle prove sarebbe un altro, e più basso — che è il modo in cui un
    // fuzzer diventa una cerimonia. La soglia è larga di proposito: il generatore
    // può cambiare, e ciò che non deve tornare è il 2,8% da cui si è partiti.
    let quota = cut * 100 / cases;
    assert!(
        quota >= 20,
        "solo {cut} mutazioni su {cases} ({quota}%) hanno prodotto un documento\n\
         con un frontmatter, cioè hanno fatto avvenire il taglio. Sulle altre\n\
         `strip_frontmatter` restituisce il sorgente e l'assert è `x == x`: questo\n\
         fuzzer sta contando le sue corse invece delle sue prove.\n\
         Il generatore semina il corpus **e** il corpus col cappello di frontmatter\n\
         davanti proprio per questo."
    );
    // E fra le tagliate, quelle la cui uscita è vuota sono un caso a parte: là
    // `source.ends_with("")` è vero per definizione, quindi non provano niente.
    assert!(
        empty * 4 < cut,
        "su {cut} tagli {empty} hanno prodotto un'uscita vuota, dove\n\
         `ends_with(\"\")` è vero per costruzione: il generatore sta producendo quasi\n\
         solo documenti che sono tutti frontmatter."
    );
}

#[test]
fn no_mutated_name_walks_out_of_the_vault() {
    // L'altra metà del confine: fin qui le mutazioni erano il **contenuto**, e il
    // nome lo sceglievamo noi. Il nome di una sorgente però arriva da fuori — è
    // il file che l'utente ha trascinato — e `a_source_name_cannot_walk_out_of_the_vault`
    // ne prova un caso solo. Qui ce ne sono qualche centinaio, ed è la stessa
    // proprietà: qualunque cosa sia quel nome, il documento che nasce sta sotto
    // la cartella chiesta, con **un** componente in più.
    // Meno degli altri due di un fattore dieci, e la ragione sta nel codice **e** si
    // vede nella curva: `MarkdownImport::import` chiama `host.list_documents(None)`
    // per decidere del conflitto, una volta per sorgente, quindi questo è il solo
    // dei tre giri quadratico nel numero dei casi. Misurato: 2 000 → 0,24 s,
    // 4 000 → 0,54, 8 000 → 1,38, 16 000 → 4,26. Raddoppiare i casi costa più del
    // doppio, e duemila sono già molte più forme di nome di quante un dialogo di
    // sistema ne produca.
    let cases = how_many_cases("FUB_FUZZ_NOMI", 2_000);
    assert!(
        cases >= 100,
        "{cases} nomi non sono un fuzzer: con zero il ciclo non gira e ogni assert \
         qui sotto viene saltato senza che niente diventi rosso."
    );
    let mut rng = Case64::new(seed());
    let seeds: Vec<&'static str> = corpus().iter().map(|c| c.source).collect();

    let (_g, mut ws) = vault_with(&[]);
    let root = Utf8PathBuf::from_path_buf(_g.path().to_path_buf()).expect("utf8");
    let mut decisi = 0usize;
    let mut nati = 0usize;
    let mut rejected = 0usize;
    for n in 0..cases {
        let (mutation, name) = mutate(&mut rng, &seeds);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ws.import(
                &ImportSource::text_source(&name, "# corpo\n"),
                &ImportRequest::apply().into_folder("in"),
            )
        }));
        let Ok(outcome) = outcome else {
            panic!(
                "caso {n} di {cases} — mutazione «{mutation}» — un nome ha fatto\n\
                 panicare l'import.\n\
                 Per rifarlo, con lo stesso conteggio: la sequenza è deterministica e\n\
                 si shutdown di nuovo al caso {n}.\n\
                 FUB_FUZZ_SEME={} FUB_FUZZ_NOMI={cases} cargo test -p \
                 fub-format-markdown --test transfer_e2e -- no_mutated_name\n\
                 Il nome, byte per byte: {name:?}",
                seed(),
            )
        };
        // Un nome che non è markdown è un argomento sbagliato, non un documento
        // fuori posto: è la stessa porta di `a_source_nobody_claims_is_a_bad_argument`.
        let Ok(report) = outcome else {
            rejected += 1;
            continue;
        };
        // Il controllo del path si fa su **ogni** esito, non solo su chi è nato.
        // Un `Failed` è una scrittura che il filesystem ha rifiutato *dopo* che il
        // recinto aveva già deciso dove andava il documento: il recinto l'ha
        // esercitato, e `d.doc` è la sua risposta. Guardare solo i nati vorrebbe
        // dire non guardare la maggioranza dei casi su Windows, che rifiuta i nomi
        // con `<`, `>`, `|`, `?`, `:` — e le mutazioni ne sono piene.
        for d in &report.documents {
            decisi += 1;
            if matches!(d.outcome, ImportOutcome::Created | ImportOutcome::Replaced) {
                nati += 1;
            }
            let path = d.doc.as_str();
            let rest = path.strip_prefix("in/").unwrap_or_else(|| {
                panic!(
                    "caso {n} — mutazione «{mutation}» — il nome {name:?} è \
                     diventato `{path}`, che è fuori dalla cartella chiesta \
                     (esito: {:?})",
                    d.outcome
                )
            });
            assert!(
                !rest.contains('/'),
                "caso {n} — mutazione «{mutation}» — il nome {name:?} è diventato \
                 `{path}`: ha guadagnato dei componenti di path che nella sorgente \
                 erano solo caratteri (esito: {:?})",
                d.outcome
            );
        }
    }

    // Che la prova abbia provato qualcosa. La quantità da guardare è **quante volte
    // il recinto ha deciso**, non quanti file sono nati: la prima è una decisione su
    // una stringa e vale uguale su ogni sistema, la seconda dipende da quali nomi il
    // filesystem accetta e su Windows è un terzo di quella di Linux. La prima
    // versione di questa riga contava i nati, ed è finita rossa in CI su Windows con
    // 310 su 2000 dove Linux ne fa 980: la soglia misurava la tolleranza del
    // filesystem e diceva di misurare il recinto.
    assert!(
        decisi * 4 > cases,
        "su {cases} nomi mutati il recinto ha deciso solo {decisi} volte, e {rejected} \
         sorgenti sono state rifiutate prima di arrivarci: questa prova sta \
         verificando `Err`, non il recinto."
    );
    assert!(
        nati > 100,
        "su {decisi} decisioni del recinto solo {nati} hanno prodotto un documento: \
         senza documenti la camminata del disco qui sotto non ha niente da guardare. \
         Quanti siano dipende dal sistema — su Windows sono circa un terzo che su \
         Linux — quindi la soglia è bassa di proposito."
    );

    assert!(
        ws.documents().len() >= nati / 2,
        "l'indice ha {} documenti e ne sono nati {nati}: sono troppi persi per \
         strada perché il confronto qui sotto valga",
        ws.documents().len()
    );
    for doc in ws.documents() {
        assert!(
            doc.as_str().starts_with("in/"),
            "`{doc}` è finita fuori dalla cartella chiesta"
        );
    }

    // E il **disco**, che è la cosa che l'indice non può dire: fin qui si è
    // guardato il `DocId` che l'importer ha calcolato, cioè un valore che
    // `ImportSource::stem` garantisce per costruzione. Se un nome ostile facesse
    // nascere un file fuori dalla radice del vault, nessuno degli assert qui sopra
    // se ne accorgerebbe — il documento non entrerebbe nemmeno nell'indice.
    let vault = root.join("vault");
    let mut outside = Vec::new();
    walks(root.as_std_path(), &mut outside);
    let intrusi: Vec<&std::path::PathBuf> = outside
        .iter()
        .filter(|p| !p.starts_with(vault.as_std_path()))
        .collect();
    assert!(
        intrusi.is_empty(),
        "un nome mutato ha fatto nascere dei file **fuori** dalla radice del vault: \
         {intrusi:?}"
    );
    assert!(
        outside.len() >= nati / 2,
        "sotto la radice ci sono {} file e ne sono nati {nati}: la camminata del \
         disco non sta guardando dove si scrive",
        outside.len()
    );
}

fn walks(dir: &std::path::Path, within: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walks(&path, within);
        } else {
            within.push(path);
        }
    }
}

/// **Chi perde la corsa del nome libero non cancella la nota di chi l'ha vinta.**
///
/// `VaultRead::free_name` dichiara di non prenotare — *«fra la domanda e la
/// scrittura il nome può diventare occupato, e a quel punto è la scrittura a
/// dirlo»* — e la [0027](../../../docs/decisions/0183-composizione-host-kernel.md)
/// scarica la corsa sulla stessa frase. Nessun banco di questo repo la
/// costruiva: tutti quelli che nominano `free_name` occupano il path **prima**
/// della domanda, che è il caso ordinario e non la corsa.
///
/// E costruendola si vede che la discarica era **falsa proprio per il chiamante
/// più esposto**: l'import con `ConflictPolicy::Rename` scriveva con
/// `WriteBase::Dictated`, che non sa dire di no, quindi il perdente copriva in
/// silenzio la nota che qualcun altro aveva appena creato con quel nome. Fra la
/// domanda e la scrittura ci stanno un `parse` e — su un import di più file —
/// tutto il tempo dei documenti precedenti.
///
/// La corsa si apre **dentro la risposta** (`MemoryHost::la_prossima_corsa_del_nome_si_perde`)
/// e non con dei thread: un tempo non è un segnale, e due thread qui sarebbero
/// una speranza sulla schedulazione invece di un fatto.
#[test]
fn losing_the_free_name_race_fails_the_import_instead_of_overwriting() {
    use fub_abi::traits::VaultRead;
    use fub_abi::transfer::ImportProvider;
    use fub_sdk::testing::MemoryHost;

    let mut host = MemoryHost::new().with_document("Progetti/Alpha.md", "quella che c'era già");
    let source = ImportSource::text_source("Alpha.md", "# Alpha\n\nimportata\n");

    // Il nome che `free_name` risponderà — `Progetti/Alpha 1.md` — se lo prende
    // qualcun altro un istante dopo la risposta.
    host.the_next_run_of_the_name_is_loses();

    let report = MarkdownImport
        .import(
            &source,
            &ImportRequest::apply()
                .into_folder("Progetti")
                .on_conflict(ConflictPolicy::Rename),
            &mut host,
        )
        .expect("l'import nel suo insieme riesce: è la riga che fallisce");

    assert!(
        matches!(report.documents[0].outcome, ImportOutcome::Failed(_)),
        "chi perde la corsa lo dice, invece di scrivere lo stesso: {:?}",
        report.documents[0].outcome
    );
    // La parte che vale: la nota di chi ha vinto la corsa è ancora la sua.
    assert_eq!(
        host.read_document(&DocId::new("Progetti/Alpha 1.md"))
            .ok()
            .as_deref(),
        Some("di qualcun altro"),
        "il perdente ha coperto la nota del vincitore"
    );
    // E quella che c'era prima non è stata toccata da nessuno dei due.
    assert_eq!(
        host.read_document(&DocId::new("Progetti/Alpha.md"))
            .ok()
            .as_deref(),
        Some("quella che c'era già")
    );
}
