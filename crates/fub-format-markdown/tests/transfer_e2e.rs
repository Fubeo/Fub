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
use fub_abi::model::{Block, DocId, DocumentModel, Frontmatter, Inline, Span};
use fub_abi::traits::IndexQuery;
use fub_abi::transfer::{
    ConflictPolicy, ExportArtifact, ExportReport, ExportRequest, ExportSelection, ImportMode,
    ImportOutcome, ImportRequest, ImportSource, NoteLevel,
};
use fub_abi::PluginError;
use fub_format_markdown::{
    MarkdownExport, MarkdownImport, MarkdownProvider, TARGET_FILES, TARGET_SINGLE,
};
use fub_kernel::{FormatRegistry, Workspace};
use fub_sdk::testing::conformita;

mod corpus;

use crate::corpus::{corpus, divergenti, muta, quanti_casi, seme, Caso64};

/// Un `Workspace` sulla radice data, coi due provider di trasferimento
/// registrati.
fn workspace_su(root: &Utf8Path) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(root, registry);
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
fn vault_con(note: &[(String, String)]) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    std::fs::create_dir_all(&root).expect("la radice esiste anche se le note sono zero");
    for (rel, body) in note {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }
    let mut ws = workspace_su(&root);
    ws.reindex().expect("reindex");
    (dir, ws)
}

/// Un vault a tre note, con i due provider di trasferimento registrati.
///
/// - `Progetti/Alpha.md` (frontmatter, un link a Beta, un tag)
/// - `Progetti/Beta.md`
/// - `Diario.md` (senza frontmatter)
fn vault() -> (tempfile::TempDir, Workspace) {
    vault_con(&[
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
         cestino: `VaultRead::free_name`"
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

/// Rimette un artefatto dentro un vault, **dalla porta dell'import**.
///
/// Il path dell'artefatto porta la cartella; il nome del documento è l'ultimo
/// componente, e la cartella la dice la richiesta — che è il confine della
/// decisione 0006: una sorgente ha un nome, non un path.
fn reimporta(ws: &mut Workspace, a: &ExportArtifact) -> DocId {
    let (folder, name) = a.path.rsplit_once('/').unwrap_or(("", a.path.as_str()));
    let report = ws
        .import(
            &ImportSource {
                name: name.to_string(),
                media_type: Some("text/markdown".to_string()),
                bytes: a.bytes.clone(),
            },
            &ImportRequest::apply().into_folder(folder),
        )
        .unwrap_or_else(|e| panic!("`{}` non è rientrata: {e}", a.path));
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
    let esportato = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::default(),
        ))
        .expect("export");

    let (_g2, mut altro) = vault_con(&[]);
    for a in &esportato.artifacts {
        reimporta(&mut altro, a);
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

// --- il giro completo, sul corpus ------------------------------------------
//
// La riga del §17.1 che diceva «resta da farlo **sul corpus**, dove la proprietà
// smette di essere un esempio e diventa una misura». Il corpus è quello della
// [0060](../../../docs/decisions/0060-il-modello-dice-il-vero-sui-byte.md), e
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
fn note_del_corpus() -> Vec<(String, String)> {
    corpus()
        .into_iter()
        .map(|c| (format!("corpus/{}.md", c.nome), c.source.to_string()))
        .chain(
            divergenti()
                .into_iter()
                .map(|c| (format!("divergenze/{}.md", c.nome), c.source.to_string())),
        )
        .collect()
}

/// Il frontmatter che si mette davanti a una sorgente per farle attraversare il
/// verso che passa dal modello.
const CAPPELLO: &str = "---\na: 1\n---\n\n";

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
/// Restano fuori anche le tre di [`FUORI_DAL_CAPPELLO`], ciascuna con la sua
/// ragione, e [`le_esclusioni_dal_cappello_servono_ancora`] pretende che ognuna
/// diverga davvero: una scusa che non serve più è la cosa peggiore di un elenco a
/// mano, perché sta lì a dire che qualcosa non si può fare e nessuno la
/// ricontrolla.
fn note_col_cappello() -> Vec<(String, String)> {
    note_del_corpus()
        .into_iter()
        .filter(|(path, source)| modello(source, path).frontmatter.is_empty())
        .filter(|(path, _)| {
            let nome = nome_del_caso(path);
            !FUORI_DAL_CAPPELLO.iter().any(|(n, _)| *n == nome)
        })
        .map(|(path, source)| {
            (
                format!("cappello/{}.md", nome_del_caso(&path)),
                format!("{CAPPELLO}{source}"),
            )
        })
        .collect()
}

fn nome_del_caso(path: &str) -> &str {
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
const FUORI_DAL_CAPPELLO: [(&str, &str); 3] = [
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
        "un frontmatter che non si parsa non lascia traccia",
        "col cappello davanti diventa un doppio frontmatter, che è la maglia già \
         dichiarata da `and_that_fixed_point_is_a_fact_about_this_corpus_not_about_the_format`",
    ),
];

#[test]
fn le_esclusioni_dal_cappello_servono_ancora() {
    for (nome, ragione) in FUORI_DAL_CAPPELLO {
        let source = corpus()
            .into_iter()
            .chain(divergenti())
            .find(|c| c.nome == nome)
            .unwrap_or_else(|| {
                panic!(
                    "`{nome}` è escluso dal cappello e non è più nel corpus: la \
                     scusa nomina un caso che non c'è"
                )
            })
            .source;
        let path = "Prova.md".to_string();
        let col_cappello = format!("{CAPPELLO}{source}");
        let (_g, ws) = vault_con(&[(path.clone(), col_cappello.clone())]);
        let fuori = ws.export(&senza_metadati()).expect("export");
        let tagliato = text(&fuori.artifacts[0].bytes);
        // Il confronto è quello del presidio: il documento **come sta nel vault**
        // contro quello che ne esce senza metadati. Confrontare l'uscita con la
        // sorgente originale direbbe un'altra cosa — che il taglio ha reso i byte
        // che erano — e sarebbe vero per costruzione.
        assert_ne!(
            struttura(&modello(tagliato, &path)),
            struttura(&modello(&col_cappello, &path)),
            "`{nome}` è escluso dal cappello perché «{ragione}», e adesso col \
             cappello davanti si comporta come tutti gli altri.\n\
             Se è stato riparato è una bella notizia e va scritta nel verbale: \
             questa riga va tolta da `FUORI_DAL_CAPPELLO`, e il caso torna nella \
             famiglia dove le pretese sono tutte."
        );
    }
}

/// La richiesta «tutto il vault, senza metadati»: l'unica opzione dell'export
/// markdown, e l'unico verso che passa dal modello.
fn senza_metadati() -> ExportRequest {
    ExportRequest::new(TARGET_FILES, ExportSelection::default())
        .with_options(serde_json::json!({ "frontmatter": false }))
}

fn modello(source: &str, doc_id: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian(doc_id))
        .unwrap_or_else(|e| panic!("`{doc_id}` non parsa: {e}"))
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
fn struttura(d: &DocumentModel) -> Vec<String> {
    let mut fuori = Vec::new();
    fuori.extend(specie_dei_blocchi(&d.body));
    for h in &d.outline {
        fuori.push(format!("heading {} {:?} {:?}", h.level, h.slug, h.text));
    }
    for t in &d.tags {
        fuori.push(format!("tag {:?}", t.name));
    }
    // I bersagli dei link li proietta l'SDK e non questo file:
    // `conformita::bersagli` esiste dalla 0060 per «la forma in cui un corpus li
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
    for b in conformita::bersagli(d) {
        fuori.push(format!("nomina {b}"));
    }
    fuori.push(format!(
        "{} link, di cui {} incorporati",
        d.links.len(),
        d.links.iter().filter(|l| l.embed).count()
    ));
    for a in &d.anchors {
        fuori.push(format!("ancora {:?}", a.id));
    }
    fuori.push(format!("testo {:?}", d.text));
    fuori
}

/// La specie di ogni blocco, annidamento compreso, e ciò che la distingue da un
/// blocco della stessa specie: lo stato di una task, il linguaggio di un code
/// block, l'allineamento di una tabella.
///
/// Senza questa, `struttura` non vedeva la differenza fra `- [x] fatta` e
/// `- [ ] fatta`, fra un code block recintato e uno indentato, fra una citazione e
/// un paragrafo: tre coppie di sorgenti diverse con la stessa proiezione.
fn specie_dei_blocchi(bs: &[Block]) -> Vec<String> {
    let mut fuori = Vec::new();
    for b in bs {
        match b {
            Block::Heading { level, .. } => fuori.push(format!("blocco heading {level}")),
            Block::Paragraph { .. } => fuori.push("blocco paragrafo".to_string()),
            Block::CodeBlock { lang, code, .. } => {
                fuori.push(format!("blocco codice {lang:?} {code:?}"))
            }
            Block::ThematicBreak { .. } => fuori.push("blocco riga".to_string()),
            Block::List { ordered, items, .. } => {
                fuori.push(format!("blocco lista ordinata={ordered}"));
                for it in items {
                    // Il simbolo, non il `TaskMarker` intero: quello porta uno span,
                    // e uno span dentro una proiezione dichiarata «senza gli offset»
                    // la fa divergere per il solo fatto che il taglio è avvenuto.
                    // È il difetto che questa riga aveva nella prima versione.
                    fuori.push(format!(
                        "  voce task={:?}",
                        it.task.as_ref().map(|t| t.symbol)
                    ));
                    fuori.extend(specie_dei_blocchi(&it.blocks).into_iter().map(indenta));
                }
            }
            Block::Quote { blocks, .. } => {
                fuori.push("blocco citazione".to_string());
                fuori.extend(specie_dei_blocchi(blocks).into_iter().map(indenta));
            }
            Block::Custom {
                custom_kind,
                attrs,
                blocks,
                ..
            } => {
                fuori.push(format!("blocco {custom_kind} {attrs}"));
                fuori.extend(specie_dei_blocchi(blocks).into_iter().map(indenta));
            }
            Block::Table {
                head, rows, align, ..
            } => {
                fuori.push(format!(
                    "blocco tabella intestazione={} righe={} allineamenti={align:?}",
                    head.is_some(),
                    rows.len()
                ));
            }
        }
        if let Some(a) = b.anchor() {
            fuori.push(format!("  ancora del blocco {a:?}"));
        }
    }
    fuori
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
fn sposta(d: &mut DocumentModel, delta: usize) {
    fn s(x: &mut Span, delta: usize) {
        x.start += delta;
        x.end += delta;
    }
    fn dentro_gli_inline(is: &mut [Inline], delta: usize) {
        for i in is {
            match i {
                Inline::Link { label, span, .. } => {
                    s(span, delta);
                    if let Some(l) = label {
                        dentro_gli_inline(l, delta);
                    }
                }
                Inline::TagRef { span, .. } | Inline::Custom { span, .. } => s(span, delta),
                Inline::Emph(dentro) | Inline::Strong(dentro) => dentro_gli_inline(dentro, delta),
                Inline::Text(_) | Inline::Code(_) => {}
            }
        }
    }
    fn dentro_i_blocchi(bs: &mut [Block], delta: usize) {
        for b in bs {
            match b {
                Block::Heading { inlines, span, .. } | Block::Paragraph { inlines, span, .. } => {
                    s(span, delta);
                    dentro_gli_inline(inlines, delta);
                }
                Block::List { items, span, .. } => {
                    s(span, delta);
                    for it in items {
                        s(&mut it.span, delta);
                        if let Some(t) = &mut it.task {
                            s(&mut t.span, delta);
                        }
                        dentro_i_blocchi(&mut it.blocks, delta);
                    }
                }
                Block::CodeBlock { span, .. } | Block::ThematicBreak { span, .. } => s(span, delta),
                Block::Quote { blocks, span, .. } | Block::Custom { blocks, span, .. } => {
                    s(span, delta);
                    dentro_i_blocchi(blocks, delta);
                }
                Block::Table {
                    head, rows, span, ..
                } => {
                    s(span, delta);
                    for riga in head.iter_mut().chain(rows.iter_mut()) {
                        for cella in &mut riga.cells {
                            s(&mut cella.span, delta);
                            dentro_gli_inline(&mut cella.inlines, delta);
                        }
                    }
                }
            }
        }
    }
    dentro_i_blocchi(&mut d.body, delta);
    for h in &mut d.outline {
        s(&mut h.span, delta);
    }
    for l in &mut d.links {
        s(&mut l.span, delta);
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
fn the_corpus_names_are_usable_as_note_names() {
    // Un nome del corpus diventa il nome di un file. Se due casi collidessero, o
    // se un nome portasse una barra, il vault del round-trip avrebbe meno note
    // del corpus — e il confronto sui byte passerebbe lo stesso, avendo
    // confrontato di meno. È la stessa specie di guardia di `confronta` in
    // `il_corpus.rs`: un elenco che si svuota passa sempre.
    let note = note_del_corpus();
    let mut visti = std::collections::BTreeSet::new();
    for (path, _) in &note {
        let nome = path
            .rsplit_once('/')
            .expect("le note stanno in due cartelle")
            .1;
        let nome = nome
            .strip_suffix(".md")
            .expect("l'estensione la mettiamo noi");
        assert!(!nome.is_empty(), "un caso senza nome");
        assert!(
            !nome.contains('/') && !nome.contains('\\') && !nome.contains('\n'),
            "il nome del caso `{nome}` non è un componente di path solo"
        );
        assert!(visti.insert(path.clone()), "due casi si chiamano `{path}`");
    }
    assert_eq!(
        note.len(),
        corpus().len() + divergenti().len(),
        "il vault del corpus non ha una nota per sorgente: qualche nome è collassato \
         su un altro"
    );
    assert!(
        note.len() >= 75,
        "il vault del corpus ha {} note su settantacinque: il corpus si è svuotato, \
         e un round-trip su niente è verde. La soglia è il conteggio di oggi — sale \
         con lui, e scende solo in un commit che dice perché",
        note.len()
    );
}

#[test]
fn the_whole_corpus_leaves_the_vault_and_comes_back_byte_for_byte() {
    let note = note_del_corpus();
    let (_g, ws) = vault_con(&note);

    // Prima ancora del giro: i byte del caso sono i byte che il vault
    // restituisce. Se il kernel normalizzasse in lettura — un BOM tolto, un CRLF
    // ridotto — il round-trip resterebbe verde normalizzando due volte, e questa
    // riga è ciò che impedisce a quel verde di essere vuoto.
    for (path, source) in &note {
        let doc = DocId::new(path.as_str());
        let letto = ws
            .read_source(&doc)
            .unwrap_or_else(|e| panic!("`{path}` non si rilegge: {e}"));
        assert_eq!(
            letto, *source,
            "`{path}`: il vault non restituisce i byte che ci sono stati messi"
        );
    }

    let esportato = ws
        .export(&ExportRequest::new(
            TARGET_FILES,
            ExportSelection::default(),
        ))
        .expect("export");
    assert_eq!(
        esportato.artifacts.len(),
        note.len(),
        "l'export ha lasciato indietro delle note"
    );
    assert!(
        esportato.log.is_empty(),
        "un export senza problemi non ha righe di log: {:?}",
        esportato.log
    );

    // L'export non tocca i byte…
    for a in &esportato.artifacts {
        let atteso = ws
            .read_source(&DocId::new(a.path.as_str()))
            .expect("il documento c'è, l'abbiamo appena esportato");
        assert_eq!(
            text(&a.bytes),
            atteso.as_str(),
            "`{}` è uscita diversa da com'era nel vault",
            a.path
        );
    }

    // …e l'import nemmeno.
    let (_g2, mut altro) = vault_con(&[]);
    for a in &esportato.artifacts {
        reimporta(&mut altro, a);
    }
    assert_eq!(
        altro.documents(),
        ws.documents(),
        "il vault d'arrivo non ha gli stessi documenti di quello di partenza"
    );
    for doc in ws.documents() {
        assert_eq!(
            altro.read_source(&doc).unwrap(),
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
    let mut note = note_del_corpus();
    note.extend(note_col_cappello());
    let (_g, ws) = vault_con(&note);

    let primo = ws.export(&senza_metadati()).expect("export");
    assert_eq!(primo.artifacts.len(), note.len());

    let mut proiettato = std::collections::BTreeSet::new();
    let mut tagliate = 0usize;
    for a in &primo.artifacts {
        let source = ws.read_source(&DocId::new(a.path.as_str())).unwrap();
        let fuori = text(&a.bytes);

        // L'invariante che vale su qualunque ingresso: togliendo il frontmatter
        // l'export **non può inventare byte**. Ciò che esce è il sorgente, o una
        // sua coda, o niente. Debole da sola — una coda sbagliata resta una coda
        // — ed è la ragione delle due righe dopo.
        assert!(
            source.ends_with(fuori),
            "`{}` senza metadati non è una coda del sorgente:\n  fuori {:?}\n  dentro {:?}",
            a.path,
            fuori,
            source
        );
        if fuori.len() == source.len() {
            // Nessun frontmatter da togliere: qui non c'è niente da presidiare, e
            // contarla fra le tagliate sarebbe contare un `x == x`.
            continue;
        }
        tagliate += 1;

        // La proiezione leggibile, che è quella che si legge quando diventa rossa.
        let prima = struttura(&modello(&source, a.path.as_str()));
        proiettato.extend(prima.iter().cloned());
        assert_eq!(
            struttura(&modello(fuori, a.path.as_str())),
            prima,
            "`{}`: togliendo il frontmatter è cambiato anche il corpo. Il taglio \
             sullo span ha spostato dei byte invece di toglierne un prefisso",
            a.path
        );

        // E quella severa: **il taglio prende un prefisso e nient'altro.** Lo
        // scostamento è noto — l'invariante della coda l'ha appena stabilito —
        // quindi gli span si possono rimettere al loro posto, e i due modelli
        // devono essere identici. Il frontmatter è la sola differenza ammessa: è
        // ciò che si è tolto.
        let delta = source.len() - fuori.len();
        let mut rimesso = modello(fuori, a.path.as_str());
        sposta(&mut rimesso, delta);
        let mut atteso = modello(&source, a.path.as_str());
        atteso.frontmatter = Frontmatter::default();
        assert_eq!(
            rimesso, atteso,
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
    let con_frontmatter = note
        .iter()
        .filter(|(p, s)| !modello(s, p).frontmatter.is_empty())
        .count();
    assert_eq!(
        tagliate, con_frontmatter,
        "il taglio è avvenuto su {tagliate} note e {con_frontmatter} hanno un \
         frontmatter: sono lo stesso insieme o non lo sono. Se `tagliate` è meno, \
         `strip_frontmatter` ha smesso di tagliare su qualcosa che doveva."
    );
    assert!(
        tagliate >= 70,
        "il taglio è avvenuto su {tagliate} note su {}: sotto questa soglia la prova \
         sta confrontando quasi ogni documento con sé stesso, ed è il difetto per \
         cui esiste il cappello.",
        note.len()
    );

    // La seconda: se `struttura` proiettasse il vuoto, i due lati sarebbero uguali
    // per ogni documento. È la stessa specie di rifiuto di `confronta` in
    // `il_corpus.rs` — «un confronto contro il vuoto passa sempre» — e nessun
    // sabotaggio della sola proiezione potrebbe farla diventare rossa.
    for atteso in ["blocco ", "heading ", "nomina ", "ancora ", "tag "] {
        assert!(
            proiettato.iter().any(|r| r.starts_with(atteso)),
            "in {tagliate} note tagliate la proiezione non ha prodotto una sola riga \
             `{atteso}…`: sta confrontando meno di quel che dice.\n\
             Ha prodotto: {proiettato:#?}"
        );
    }
    assert!(
        proiettato
            .iter()
            .any(|r| r.starts_with("testo") && r.len() > 12),
        "nessuna nota ha del testo indicizzato: la proiezione confronta stringhe \
         vuote"
    );

    let (_g2, mut altro) = vault_con(&[]);
    for a in &primo.artifacts {
        reimporta(&mut altro, a);
    }
    let secondo = altro.export(&senza_metadati()).expect("export");

    assert_eq!(
        primo.artifacts.iter().map(|a| &a.path).collect::<Vec<_>>(),
        secondo
            .artifacts
            .iter()
            .map(|a| &a.path)
            .collect::<Vec<_>>(),
    );
    for (a, b) in primo.artifacts.iter().zip(secondo.artifacts.iter()) {
        assert_eq!(
            text(&b.bytes),
            text(&a.bytes),
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
    let doppio = "---\na: 1\n---\n\n---\nb: 2\n---\n\nx\n";
    let (_g, ws) = vault_con(&[("Doppio.md".to_string(), doppio.to_string())]);

    let primo = ws.export(&senza_metadati()).expect("export");
    let uscito = text(&primo.artifacts[0].bytes).to_string();
    assert!(
        doppio.ends_with(&uscito),
        "anche qui l'export non inventa byte"
    );

    let (_g2, mut altro) = vault_con(&[]);
    reimporta(&mut altro, &primo.artifacts[0]);
    let secondo = altro.export(&senza_metadati()).expect("export");

    assert_ne!(
        text(&secondo.artifacts[0].bytes),
        uscito.as_str(),
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
// (`conformita::gli_span_affettano_la_sorgente`) e fino a oggi non aveva un
// cliente di produzione di cui si potesse dire «protegge questo». Adesso ce l'ha.

#[test]
fn no_mutation_of_the_corpus_makes_the_export_slice_outside_the_bytes() {
    // Lo stesso conteggio del fuzzer del parser, che è un budget e non una
    // simmetria: ventimila mutazioni costano qui 3,3 s e là 2,6, cioè 0,17 ms per
    // caso contro 0,13. La differenza non è la scrittura del file né l'indice — è
    // che metà dei semi sono più lunghi, avendo un frontmatter davanti.
    let casi = quanti_casi("FUB_FUZZ_TRASFERIMENTO", 20_000);
    assert!(
        casi >= 1_000,
        "{casi} mutazioni non sono un fuzzer: con zero il ciclo non gira nemmeno, e \
         ogni assert qui sotto viene saltato senza che niente diventi rosso. Per \
         alzarlo si passa `FUB_FUZZ_TRASFERIMENTO`; per abbassarlo sotto mille non \
         c'è ragione che valga il verde falso che si compra."
    );
    let mut rng = Caso64::nuovo(seme());

    // I semi sono il corpus **e il corpus col cappello di frontmatter davanti**, e
    // la seconda metà è ciò che dà al fuzzer un bersaglio. Misurato senza:
    // sole 560 mutazioni su 20 000 conservavano un frontmatter, cioè il 2,8% —
    // sulle altre 19 440 `strip_frontmatter` restituisce il sorgente tale e quale e
    // l'assert diventa `source.ends_with(source)`. Un fuzzer che nel 97% dei casi
    // non arriva al codice che dichiara di provare sta contando le sue corse, non
    // le sue prove.
    let col_cappello: Vec<String> = corpus()
        .iter()
        .chain(divergenti().iter())
        .map(|c| format!("{CAPPELLO}{}", c.source))
        .collect();
    let mut semi: Vec<&str> = corpus()
        .iter()
        .map(|c| c.source)
        .chain(divergenti().iter().map(|c| c.source))
        .collect();
    semi.extend(col_cappello.iter().map(|s| s.as_str()));

    // Le mutazioni entrano tutte in **un** vault: costruire un vault per caso
    // costerebbe ventimila tempdir e misurerebbe il filesystem, non l'export.
    let mutate: Vec<(&'static str, String)> = (0..casi).map(|_| muta(&mut rng, &semi)).collect();
    let note: Vec<(String, String)> = mutate
        .iter()
        .enumerate()
        .map(|(n, (_, source))| (format!("fuzz/{n:05}.md"), source.clone()))
        .collect();
    let (_g, ws) = vault_con(&note);
    assert_eq!(
        ws.documents().len(),
        casi,
        "il vault delle mutazioni ha perso delle note per strada"
    );

    // Documento per documento, per avere l'attribuzione: un panico deve dire
    // **quale** mutazione, non solo che è successo.
    let mut tagliate = 0usize;
    let mut vuote = 0usize;
    for (n, (mutazione, source)) in mutate.iter().enumerate() {
        let doc = DocId::new(format!("fuzz/{n:05}.md"));
        let esito = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ws.export(
                &ExportRequest::new(TARGET_FILES, ExportSelection::Documents(vec![doc.clone()]))
                    .with_options(serde_json::json!({ "frontmatter": false })),
            )
        }));
        let report = match esito {
            Ok(r) => r.unwrap_or_else(|e| {
                panic!("caso {n} — mutazione «{mutazione}» — non è nemmeno uscita: {e}")
            }),
            Err(_) => panic!(
                "caso {n} di {casi} — mutazione «{mutazione}» — ha fatto panicare\n\
                 l'export. Il panico vero è stampato qui sopra.\n\
                 \n\
                 Per rifarlo esattamente, con lo stesso conteggio: la sequenza è\n\
                 deterministica e si ferma di nuovo al caso {n}.\n\
                 FUB_FUZZ_SEME={seme} FUB_FUZZ_TRASFERIMENTO={casi} cargo test -p \
                 fub-format-markdown --test transfer_e2e -- no_mutation_of\n\
                 \n\
                 La sorgente, byte per byte: {source:?}",
                seme = seme(),
            ),
        };

        assert_eq!(report.artifacts.len(), 1);
        let fuori = text(&report.artifacts[0].bytes);
        assert!(
            source.ends_with(fuori),
            "caso {n} — mutazione «{mutazione}» — l'export senza metadati ha\n\
             prodotto qualcosa che non è una coda del sorgente. Il taglio sullo\n\
             span ha spostato dei byte invece di toglierne un prefisso.\n\
             \n\
             fuori: {fuori:?}\n\
             dentro: {source:?}"
        );
        if fuori.len() != source.len() {
            tagliate += 1;
            if fuori.is_empty() {
                vuote += 1;
            }
        }
    }

    // Quante mutazioni sono arrivate al codice che questo fuzzer dichiara di
    // provare. Senza questa riga il conteggio dei casi direbbe ventimila e il
    // numero delle prove sarebbe un altro, e più basso — che è il modo in cui un
    // fuzzer diventa una cerimonia. La soglia è larga di proposito: il generatore
    // può cambiare, e ciò che non deve tornare è il 2,8% da cui si è partiti.
    let quota = tagliate * 100 / casi;
    assert!(
        quota >= 20,
        "solo {tagliate} mutazioni su {casi} ({quota}%) hanno prodotto un documento\n\
         con un frontmatter, cioè hanno fatto avvenire il taglio. Sulle altre\n\
         `strip_frontmatter` restituisce il sorgente e l'assert è `x == x`: questo\n\
         fuzzer sta contando le sue corse invece delle sue prove.\n\
         Il generatore semina il corpus **e** il corpus col cappello di frontmatter\n\
         davanti proprio per questo."
    );
    // E fra le tagliate, quelle la cui uscita è vuota sono un caso a parte: là
    // `source.ends_with("")` è vero per definizione, quindi non provano niente.
    assert!(
        vuote * 4 < tagliate,
        "su {tagliate} tagli {vuote} hanno prodotto un'uscita vuota, dove\n\
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
    let casi = quanti_casi("FUB_FUZZ_NOMI", 2_000);
    assert!(
        casi >= 100,
        "{casi} nomi non sono un fuzzer: con zero il ciclo non gira e ogni assert \
         qui sotto viene saltato senza che niente diventi rosso."
    );
    let mut rng = Caso64::nuovo(seme());
    let semi: Vec<&'static str> = corpus().iter().map(|c| c.source).collect();

    let (_g, mut ws) = vault_con(&[]);
    let radice = Utf8PathBuf::from_path_buf(_g.path().to_path_buf()).expect("utf8");
    let mut decisi = 0usize;
    let mut nati = 0usize;
    let mut rifiutati = 0usize;
    for n in 0..casi {
        let (mutazione, nome) = muta(&mut rng, &semi);
        let esito = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ws.import(
                &ImportSource::text_source(&nome, "# corpo\n"),
                &ImportRequest::apply().into_folder("in"),
            )
        }));
        let Ok(esito) = esito else {
            panic!(
                "caso {n} di {casi} — mutazione «{mutazione}» — un nome ha fatto\n\
                 panicare l'import.\n\
                 Per rifarlo, con lo stesso conteggio: la sequenza è deterministica e\n\
                 si ferma di nuovo al caso {n}.\n\
                 FUB_FUZZ_SEME={} FUB_FUZZ_NOMI={casi} cargo test -p \
                 fub-format-markdown --test transfer_e2e -- no_mutated_name\n\
                 Il nome, byte per byte: {nome:?}",
                seme(),
            )
        };
        // Un nome che non è markdown è un argomento sbagliato, non un documento
        // fuori posto: è la stessa porta di `a_source_nobody_claims_is_a_bad_argument`.
        let Ok(report) = esito else {
            rifiutati += 1;
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
            let resto = path.strip_prefix("in/").unwrap_or_else(|| {
                panic!(
                    "caso {n} — mutazione «{mutazione}» — il nome {nome:?} è \
                     diventato `{path}`, che è fuori dalla cartella chiesta \
                     (esito: {:?})",
                    d.outcome
                )
            });
            assert!(
                !resto.contains('/'),
                "caso {n} — mutazione «{mutazione}» — il nome {nome:?} è diventato \
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
        decisi * 4 > casi,
        "su {casi} nomi mutati il recinto ha deciso solo {decisi} volte, e {rifiutati} \
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
    let vault = radice.join("vault");
    let mut fuori = Vec::new();
    cammina(radice.as_std_path(), &mut fuori);
    let intrusi: Vec<&std::path::PathBuf> = fuori
        .iter()
        .filter(|p| !p.starts_with(vault.as_std_path()))
        .collect();
    assert!(
        intrusi.is_empty(),
        "un nome mutato ha fatto nascere dei file **fuori** dalla radice del vault: \
         {intrusi:?}"
    );
    assert!(
        fuori.len() >= nati / 2,
        "sotto la radice ci sono {} file e ne sono nati {nati}: la camminata del \
         disco non sta guardando dove si scrive",
        fuori.len()
    );
}

fn cammina(dir: &std::path::Path, dentro: &mut Vec<std::path::PathBuf>) {
    let Ok(voci) = std::fs::read_dir(dir) else {
        return;
    };
    for voce in voci.flatten() {
        let path = voce.path();
        if path.is_dir() {
            cammina(&path, dentro);
        } else {
            dentro.push(path);
        }
    }
}
