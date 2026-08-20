//! Il **buffer di crash** e i **comandi di manutenzione** (§15.2), che sono le
//! due caselle di recovery della voce e si presidiano insieme perché la seconda
//! è, in parte, la lettrice della prima.
//!
//! Cosa questo file presidia davvero, in una riga per famiglia:
//!
//! - che una bozza **sopravviva alla chiusura**, che è tutto ciò che «buffer di
//!   crash» significa in un test senza un crash vero (la stessa avvertenza di
//!   `la_durabilita.rs`: il crash non si simula, si presidiano i passi
//!   osservabili);
//! - che la lettura dica **anche ciò che non ha letto**, perché una bozza persa
//!   in silenzio è la sola forma d'errore che questa voce non può permettersi;
//! - che i tre comandi passino dal **registro** come tutti gli altri — sono
//!   negli elenchi, hanno una chiave di scorciatoia, si simulano — pur essendo
//!   eseguiti dal kernel.

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::Revision;
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_kernel::maintenance::{
    Maintenance, MAINTENANCE_ID, VAULT_CLEAR_JOURNAL, VAULT_DIAGNOSTIC_BUNDLE, VAULT_REBUILD_INDEX,
    VAULT_REPAIR,
};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::SampleText;

fn vault() -> (tempfile::TempDir, Utf8PathBuf, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("md").boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    // Col suo catalogo, come lo monta `fub-host`: senza, l'esito uscirebbe
    // come una chiave invece che come una frase, e questo banco presidia anche
    // quello.
    ws.register_plugin(
        fub_abi::traits::PluginManifest::core(MAINTENANCE_ID, "Manutenzione")
            .speaking("it", fub_kernel::maintenance::catalog()),
        fub_kernel::Trust::Core,
    )
    .expect("dichiarato");
    ws.register_command_provider(MAINTENANCE_ID, Box::new(Maintenance))
        .expect("registrato");
    ws.reindex().expect("reindex");
    (dir, root, ws)
}

fn notes(root: &Utf8PathBuf, name: &str, text: &str) {
    std::fs::write(root.join(name), text).expect("scrive la nota");
}

fn drafts(ws: &Workspace) -> Vec<fub_abi::traits::DraftInfo> {
    match ws.query_index(IndexQuery::Drafts { page: None }) {
        Ok(IndexResult::Drafts(page)) => page.items,
        other => panic!("la query delle bozze ha risposto {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Il buffer di crash
// ---------------------------------------------------------------------------

/// La proprietà per cui la casella esiste: ciò che era nel buffer si ritrova
/// **dopo**, quando in memoria non è rimasto niente.
///
/// Il secondo workspace sulla stessa cartella è il modello più onesto di un
/// riavvio che si possa scrivere senza far morire un processo: nessuno stato
/// passa fra i due, e ciò che il secondo trova lo ha trovato sul disco.
#[test]
fn a_draft_survives_to_the_closing() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Idea.md", "sul disco");
    ws.reindex().expect("reindex");

    let doc = DocId::new("Idea.md");
    ws.save_draft(
        &doc,
        "quello che stavo scrivendo",
        Some(Revision::of("sul disco")),
    )
    .expect("bozza scritta");
    drop(ws);

    let mut registry = FormatRegistry::new();
    registry
        .register(SampleText::by_extension("md").boxed())
        .expect("nessun conflitto");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.reindex().expect("reindex");

    let found = drafts(&ws);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].text, "quello che stavo scrivendo");
    assert_eq!(found[0].doc, doc);
    assert!(found[0].exists, "la nota c'è ancora");
}

/// La bozza porta i **due fatti** che servono a decidere, e non la decisione.
///
/// Se il file è cambiato sotto — un'altra app, un sync — chi mostra il recupero
/// deve poterlo dire. Il kernel dà `base` e `current` e tace su cosa farne.
#[test]
fn the_draft_says_if_the_file_and_changed_under() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Idea.md", "com'era");
    ws.reindex().expect("reindex");
    let doc = DocId::new("Idea.md");
    let base = ws.document_revision(&doc).expect("revisione");

    ws.save_draft(&doc, "il mio testo", Some(base.clone()))
        .expect("bozza");
    // Qualcun altro riscrive il file mentre il buffer era sporco.
    notes(&root, "Idea.md", "com'è adesso");
    ws.reindex().expect("reindex");

    let found = drafts(&ws);
    assert_eq!(found[0].base.as_ref(), Some(&base));
    assert_eq!(
        found[0].current, found[0].base,
        "i due fatti divergono, ed è ciò che permette di accorgersene"
    );
}

/// Una bozza la cui nota non c'è più **resta**, e si dichiara orfana.
///
/// È la scelta della voce: lo spazio per-documento si raccoglie da sé perché
/// non ha senso senza la nota, una bozza ce l'ha eccome — è l'unica copia
/// rimasta di quel testo.
#[test]
fn a_draft_orphan_not_disappears_from_single() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Idea.md", "c'era");
    ws.reindex().expect("reindex");
    let doc = DocId::new("Idea.md");
    ws.save_draft(&doc, "testo mai salvato", None)
        .expect("bozza");

    std::fs::remove_file(root.join("Idea.md")).expect("cancella");
    ws.reindex().expect("reindex");

    let found = drafts(&ws);
    assert_eq!(found.len(), 1, "la bozza non si butta da sola");
    assert!(!found[0].exists, "e si dichiara orfana");
    assert_eq!(found[0].text, "testo mai salvato");
}

/// La bozza segue la nota che si rinomina, come lo stato per-documento (§13.2).
#[test]
fn a_draft_follows_the_rename_of_the_its_notes() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Prima.md", "x");
    ws.reindex().expect("reindex");
    ws.save_draft(&DocId::new("Prima.md"), "non salvato", None)
        .expect("bozza");

    ws.rename_document(&DocId::new("Prima.md"), &DocId::new("Dopo.md"))
        .expect("rinomina");

    let found = drafts(&ws);
    assert_eq!(found.len(), 1, "una sola, non due");
    assert_eq!(found[0].doc, DocId::new("Dopo.md"));
    assert_eq!(found[0].text, "non salvato");
}

/// Salvare per davvero butta la bozza: il buffer è tornato pulito.
#[test]
fn discard_a_draft_the_removes_from_the_list() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Idea.md", "x");
    ws.reindex().expect("reindex");
    let doc = DocId::new("Idea.md");
    ws.save_draft(&doc, "sporco", None).expect("bozza");
    assert_eq!(drafts(&ws).len(), 1);

    ws.discard_draft(&doc).expect("buttata");
    assert!(drafts(&ws).is_empty());
}

// ---------------------------------------------------------------------------
// I comandi di manutenzione
// ---------------------------------------------------------------------------

/// I quattro sono nel registro **come tutti gli altri**: è ciò che li rende
/// rimappabili, cercabili in palette e invocabili da una macro o dalla CLI.
/// Se un giorno finissero in un ramo privilegiato senza spec, questo test lo
/// direbbe.
#[test]
fn the_four_commands_are_in_the_record() {
    let (_dir, _root, ws) = vault();
    let ids: Vec<String> = ws.commands().into_iter().map(|s| s.id).collect();
    for expected in [
        VAULT_REBUILD_INDEX,
        VAULT_REPAIR,
        VAULT_DIAGNOSTIC_BUNDLE,
        VAULT_CLEAR_JOURNAL,
    ] {
        assert!(ids.contains(&expected.to_string()), "manca `{expected}`");
    }
}

/// Rifare l'indice è un'operazione vera, e il suo esito lo dice.
#[test]
fn redo_the_index_rereads_the_vault() {
    let (_dir, root, mut ws) = vault();
    // Una nota comparsa senza passare da Fub: finché non si rilegge, il vault
    // non la conosce.
    notes(&root, "Nuova.md", "arrivata da fuori");
    let outcome = ws
        .invoke_command(
            VAULT_REBUILD_INDEX,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("il comando gira");
    assert!(outcome.notify.is_some(), "l'esito si racconta");
    assert!(
        ws.documents().iter().any(|d| d.as_str() == "Nuova.md"),
        "dopo il rebuild la nota c'è"
    );
}

/// Una simulazione **non** esegue. Che i tre siano innocui non è una ragione
/// per saltare quel ramo: chi simula una macro si aspetta un piano.
#[test]
fn a_simulation_does_not_rebuild_the_index() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Nuova.md", "arrivata da fuori");
    let outcome = ws
        .invoke_command(
            VAULT_REBUILD_INDEX,
            serde_json::json!({}),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("il comando gira");
    assert!(
        matches!(outcome.effect, fub_abi::command::CommandEffect::Plan(_)),
        "una simulazione risponde con un piano"
    );
    assert!(
        !ws.documents().iter().any(|d| d.as_str() == "Nuova.md"),
        "e non ha riletto niente"
    );
}

/// Il rapporto diagnostico esiste, sta fra i **derivati**, e porta i fatti che
/// servono per chiedere aiuto.
#[test]
fn the_report_diagnostic_is_writes_between_the_derived() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Idea.md", "x");
    ws.reindex().expect("reindex");
    ws.save_draft(&DocId::new("Idea.md"), "non salvato", None)
        .expect("bozza");

    ws.invoke_command(
        VAULT_DIAGNOSTIC_BUNDLE,
        serde_json::json!({}),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("il comando gira");

    // Sotto `.fub/data/` e non in `.fub/`: è una copia di fatti che stanno
    // altrove, quindi si può buttare (§15.4).
    let path = fub_kernel::data_root(&root).join("diagnostics.json");
    let read_value = std::fs::read_to_string(&path).expect("il rapporto c'è");
    let json: serde_json::Value = serde_json::from_str(&read_value).expect("JSON valido");
    assert_eq!(json["v"], 1, "la versione di schema c'è (§15.3)");
    assert_eq!(json["drafts"], 1);
    // «È un array» era tutto ciò che questo presidio pretendeva, e un array con
    // dentro un controllo su tre lo soddisfa: il giorno che un controllo nuovo
    // non fosse aggiunto all'elenco del rapporto, qui non succedeva niente.
    let health = json["health"].as_array().expect("il rapporto ha la salute");
    assert_eq!(
        health.len(),
        fub_abi::traits::HealthCheck::ALL.len(),
        "il rapporto esegue **ogni** controllo di salute, non quelli che \
         qualcuno si è ricordato di elencare"
    );
}

/// Riparare **dice** ciò che non ha riparato. Una bozza orfana non si butta, e
/// chi ripara non deve poterlo far passare per «tutto a posto».
#[test]
fn repair_reports_also_that_that_not_repairs() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Idea.md", "c'era");
    ws.reindex().expect("reindex");
    ws.save_draft(&DocId::new("Idea.md"), "testo", None)
        .expect("bozza");
    std::fs::remove_file(root.join("Idea.md")).expect("cancella");
    ws.reindex().expect("reindex");

    let outcome = ws
        .invoke_command(
            VAULT_REPAIR,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("il comando gira");
    let message = outcome.notify.expect("un esito che si racconta");
    // Il messaggio è **risolto** prima di uscire dal kernel (0040): chi sta
    // fuori dal contratto riceve testo, non una chiave.
    let text = message.as_literal().expect("risolto sulla via d'uscita");
    assert!(
        text.contains('1'),
        "il conto delle bozze rimaste senza nota compare: {text}"
    );
    // E la bozza c'è ancora dopo la riparazione.
    assert_eq!(drafts(&ws).len(), 1);
}

/// Svuotare il registro lo svuota davvero, e **dice quante righe** ha tolto.
///
/// Il conto non è un abbellimento: è l'unica cosa che l'utente vede di un file
/// che non può aprire, e senza di esso il gesto sarebbe indistinguibile da un
/// gesto che non ha fatto niente.
#[test]
fn empty_the_record_and_say_how_many_rows() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Una.md", "prima");
    notes(&root, "Due.md", "seconda");
    ws.reindex().expect("indice");
    ws.write_document(
        &DocId::new("Una.md"),
        "cambiata",
        fub_abi::edit::WriteBase::Dictated,
    )
    .expect("scrittura");
    ws.rename_document(&DocId::new("Due.md"), &DocId::new("Tre.md"))
        .expect("rinomina");
    let before = ws.journal().expect("registro").records.len();
    assert!(before >= 2, "il registro ha delle righe da perdere: {before}");

    let outcome = ws
        .invoke_command(
            VAULT_CLEAR_JOURNAL,
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("il comando gira");
    let message = outcome.notify.expect("un esito che si racconta");
    let text = message.as_literal().expect("risolto sulla via d'uscita");
    assert!(
        text.contains(&before.to_string()),
        "l'esito dice quante righe sono cadute ({before}): {text}"
    );
    assert_eq!(
        ws.journal().expect("registro").records.len(),
        0,
        "e il registro è vuoto davvero, non solo raccontato tale"
    );
    // Le note non si toccano: è la riga che separa questo comando da un
    // rollback, e la sua descrizione la promette all'utente.
    assert!(ws.documents().iter().any(|d| d.as_str() == "Tre.md"));
}

/// In prova il comando che perde qualcosa **mostra il conto**, e gli altri tre
/// no: il sommario di un piano esiste per dire cosa succede, e chi non perde
/// niente non ha niente da dire.
#[test]
fn the_emptying_proof_says_how_many_rows_would_fall() {
    let (_dir, root, mut ws) = vault();
    notes(&root, "Una.md", "prima");
    ws.reindex().expect("indice");
    ws.write_document(
        &DocId::new("Una.md"),
        "cambiata",
        fub_abi::edit::WriteBase::Dictated,
    )
    .expect("scrittura");
    let count = ws.journal().expect("registro").records.len();

    let outcome = ws
        .invoke_command(
            VAULT_CLEAR_JOURNAL,
            serde_json::json!({}),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("il comando gira");
    let fub_abi::command::CommandEffect::Plan(plan) = outcome.effect else {
        panic!("una simulazione risponde con un piano");
    };
    let summary = plan
        .summary
        .as_literal()
        .expect("risolto sulla via d'uscita");
    assert!(
        summary.contains(&count.to_string()),
        "il piano dice quante righe cadrebbero ({count}): {summary}"
    );
    assert_eq!(
        ws.journal().expect("registro").records.len(),
        count,
        "e una prova non ha tolto niente"
    );

    // Il confronto che rende la riga sopra una scelta e non un caso: il rebuild
    // non perde niente, e il suo piano infatti non ha un sommario da mostrare.
    let outcome = ws
        .invoke_command(
            VAULT_REBUILD_INDEX,
            serde_json::json!({}),
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("il comando gira");
    let fub_abi::command::CommandEffect::Plan(plan) = outcome.effect else {
        panic!("una simulazione risponde con un piano");
    };
    assert_eq!(
        plan.summary,
        fub_abi::text::Text::default(),
        "chi non perde niente non ha un conto da mostrare"
    );
}
