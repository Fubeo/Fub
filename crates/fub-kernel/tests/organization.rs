//! L'**organizzazione** del vault vista dal kernel (§11.3,
//! [decisione 0038](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)):
//! chi la possiede, chi la migra, e da dove si chiede.
//!
//! Le regole dello *store* — i mutatori per chiave, la potatura di un ordine
//! vuoto, il file dal futuro, quello illeggibile che non si riscrive — stanno
//! nei test di modulo di `organization.rs`. Qui c'è ciò che si vede solo
//! **attraverso il workspace**: che l'organizzazione segue l'identità di un
//! documento (anche quando a spostarla è stato qualcun altro), e che la si
//! chiede dal canale dati come qualunque altro dato.

use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::FormatProvider;
use fub_kernel::{organization_path, FormatRegistry, Workspace};
use fub_testkit::{Bench, Mounted};

/// Il minimo per avere documenti da rinominare: qui non si prova il parsing.
struct Note;

impl FormatProvider for Note {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("note", "Note (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        _source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        Ok(DocumentModel::empty(DocId::new(ctx.doc_id.clone())))
    }

    fn render_html(
        &self,
        _model: &DocumentModel,
        _options: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(String::new())
    }

    fn serialize(&self, _model: &DocumentModel) -> Result<String, FormatError> {
        Ok(String::new())
    }
}

fn registry() -> FormatRegistry {
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(Note)).expect("no conflict");
    registry
}

fn vault() -> Mounted {
    Bench::new()
        .with_format(Box::new(Note))
        .without_scan()
        .mounts()
}

fn organization(ws: &Workspace) -> fub_abi::organization::Organization {
    match ws.query_index(IndexQuery::Organization).expect("query") {
        IndexResult::Organization(org) => org,
        other => panic!("off-topic response: {other:?}"),
    }
}

/// La si chiede **dal canale dati**, come i tag e le impostazioni: è ciò che
/// permette a un provider di leggerla: prima era un comando IPC, cioè una cosa
/// che sapeva chiedere la shell e nessun altro.
#[test]
fn it_is_queried_from_the_data_channel() {
    let ws = vault();
    assert_eq!(organization(&ws), Default::default());

    ws.set_icon("Nota.md", Some("📌".into())).expect("writes");
    ws.set_pinned("Nota.md", true).expect("writes");
    let org = organization(&ws);
    assert_eq!(org.icons.get("Nota.md").map(String::as_str), Some("📌"));
    assert_eq!(org.pinned, ["Nota.md"]);
}

/// **L'organizzazione segue l'identità.** Togli la riga da `migrate_identity` e
/// questa prova cade: l'icona resta attaccata a un path che non esiste più.
#[test]
fn a_rename_brings_organization_along() {
    let mut ws = vault();
    ws.write_document(&DocId::new("Nota.md"), "body", WriteBase::Dictated)
        .expect("writes");
    ws.set_icon("Nota.md", Some("📌".into())).expect("writes");
    ws.set_pinned("Nota.md", true).expect("writes");

    ws.rename_document(&DocId::new("Nota.md"), &DocId::new("Altra.md"))
        .expect("renames");

    let org = organization(&ws);
    assert_eq!(org.icons.get("Altra.md").map(String::as_str), Some("📌"));
    assert!(!org.icons.contains_key("Nota.md"));
    assert_eq!(org.pinned, ["Altra.md"]);
}

/// Il guadagno di averla messa **dentro l'operazione** invece che sull'evento:
/// una rinomina fatta da un'altra app mentre Fub è aperto passa da
/// `sync_renamed_path`, che arriva allo stesso punto. Sull'evento
/// `DocumentRenamed` sarebbe stata una migrazione appesa a una consegna che ha
/// un budget e può troncare (decisione 0034).
#[test]
fn even_a_rename_by_another_app_brings_it_along() {
    let mut ws = vault();
    let root = ws.root().to_path_buf();
    ws.write_document(&DocId::new("Nota.md"), "body", WriteBase::Dictated)
        .expect("writes");
    ws.set_icon("Nota.md", Some("📌".into())).expect("writes");

    // Qualcun altro (Finder, Obsidian, sync) sposta il file.
    std::fs::rename(root.join("Nota.md"), root.join("Spostata.md")).expect("rename");
    assert!(ws
        .sync_renamed_path(&root.join("Nota.md"), &root.join("Spostata.md"))
        .expect("syncs"));

    let org = organization(&ws);
    assert_eq!(org.icons.get("Spostata.md").map(String::as_str), Some("📌"));
    assert!(!org.icons.contains_key("Nota.md"));
}

/// Il file resta **dentro il vault**, e ci resta perché l'organizzazione viaggia
/// col vault: chi lo sincronizza si porta dietro il modo in cui lo ha messo in
/// ordine. È la differenza con lo stato di vista (§11.2), che sta nella cartella
/// della macchina.
#[test]
fn the_file_stays_in_the_vault() {
    let ws = vault();
    let root = ws.root().to_path_buf();
    ws.set_icon("Nota.md", Some("📌".into())).expect("writes");

    let path = organization_path(&root);
    assert_eq!(path, root.join(".fub").join("workspace.json"));
    let written = std::fs::read_to_string(&path).expect("the sidecar was written");
    assert!(written.contains("📌"), "{written}");
    // Con la versione di schema, che prima non c'era: un file senza numero è
    // quello di cui poi non si sa da che versione viene.
    assert!(written.contains("\"version\": 1"), "{written}");
}

/// Un sidecar illeggibile **non si riscrive**, e la scrittura lo dice invece di
/// riuscire in silenzio. È la regola della 0036, e qui conta più che altrove:
/// la configurazione al peggio si rifà cliccando, l'organizzazione di un vault
/// di mille note no.
#[test]
fn an_unreadable_sidecar_is_not_overwritten() {
    let bench = vault();
    let root = bench.root().to_path_buf();
    let path = organization_path(&root);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let broken = "{ \"icons\": {,} }";
    std::fs::write(&path, broken).unwrap();

    // Il vault si apre lo stesso: perdere l'organizzazione non vale un'app che
    // non parte — ma lo dice.
    let ws = Workspace::new(&root, registry()).expect("vault opens successfully");
    let warnings = ws.organization_warnings();
    assert!(!warnings.is_empty(), "a broken sidecar is reported");

    let and = ws
        .set_icon("Nota.md", Some("📌".into()))
        .expect_err("does not write what it did not read");
    assert!(and.contains("non lo sovrascrive"), "{and}");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
}
