//! Le capacità **strutturali** e `run_command` della decisione 0013, provate dal lato da
//! cui le userà un plugin: `&mut dyn HostApi` e nient'altro.
//!
//! Quattro cose non si vedono dal codice del kernel e si vedono solo di qui:
//!
//! 1. `create_document` **rifiuta** un path occupato — è la sola differenza con
//!    `write_document`, e senza quella differenza non ci sarebbe motivo di
//!    avere due capacità.
//! 2. `rename_document` prestato a un plugin è quello del kernel: riscrive i
//!    backlink entranti. Non ce n'è una versione "nuda" al confine, e questo
//!    test è il posto in cui si accorgerebbe chi ne aggiungesse una.
//! 3. Il giro del cestino si chiude *attraverso il contratto*: cestina, elenca,
//!    ripristina, svuota, senza mai toccare `Workspace` direttamente.
//! 4. `run_command` compone: eredita il modo (una simulazione resta una
//!    simulazione), eredita l'attore e il lotto, e rifiuta il giro nominandolo.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::command::{
    CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec,
};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Actor, Event};
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fubmd_abi::traits::{CommandProvider, HostApi};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Provider di formato minimo, per i casi che non guardano i link.
struct PlainProvider;

impl FormatProvider for PlainProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "plain".into(),
            name: "Testo piatto (test)".into(),
            extensions: vec!["md".into()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Come [`PlainProvider`], ma ogni riga non vuota è un wikilink: basta a far
/// esistere dei backlink da riscrivere, e non tira dentro il provider markdown
/// (il kernel non dipende da nessun formato — è l'invariante che
/// `dependency_invariant.rs` presidia).
struct LinkLineProvider;

impl FormatProvider for LinkLineProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "link-lines".into(),
            name: "Una riga, un wikilink (test)".into(),
            extensions: vec!["md".into()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities {
            wikilinks: true,
            ..FormatCapabilities::default()
        }
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let mut offset = 0usize;
        for line in source.lines() {
            let span = Span::new(offset, offset + line.len());
            offset += line.len() + 1;
            let page = line.trim();
            if !page.is_empty() {
                model.links.push(Link {
                    target: LinkTarget::wiki(page),
                    embed: false,
                    span,
                    context: None,
                });
            }
        }
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

fn vault_plain() -> (tempfile::TempDir, Workspace) {
    vault(Box::new(PlainProvider))
}

/// Il vault dove i link esistono: serve dove il test guarda la riscrittura.
fn vault_con_link() -> (tempfile::TempDir, Workspace) {
    vault(Box::new(LinkLineProvider))
}

fn vault(provider: Box<dyn FormatProvider>) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry.register(provider);
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex");
    (dir, ws)
}

// ---------------------------------------------------------------------------
// Creare
// ---------------------------------------------------------------------------

#[test]
fn creating_over_an_existing_note_is_refused_and_writing_over_it_is_not() {
    let (_dir, mut ws) = vault_plain();
    let id = DocId::new("nota.md");

    ws.with_host("prova.plugin", |host| {
        host.create_document(&id, "primo")
            .expect("il path è libero");

        let e = host
            .create_document(&id, "secondo")
            .expect_err("il path è occupato");
        assert!(
            matches!(e, PluginError::Internal(ref m) if m.contains("nota.md")),
            "l'errore nomina il documento: {e}"
        );

        assert_eq!(
            host.read_document(&id).expect("legge"),
            "primo",
            "il rifiuto non ha scritto niente"
        );

        // La differenza è tutta qui: la stessa scrittura, con l'altra capacità,
        // passa. Se `create_document` si comportasse così, un template che
        // sbaglia la data cancellerebbe una nota dell'utente.
        host.write_document(&id, "sovrascritto")
            .expect("sovrascrive");
        assert_eq!(host.read_document(&id).expect("legge"), "sovrascritto");
    });
}

#[test]
fn a_created_document_cannot_escape_the_vault() {
    let (_dir, mut ws) = vault_plain();
    ws.with_host("prova.plugin", |host| {
        let e = host
            .create_document(&DocId::new("../fuori.md"), "no")
            .expect_err("il recinto vale anche per la creazione");
        assert!(matches!(e, PluginError::PermissionDenied(_)), "{e}");
    });
    assert!(ws.documents().is_empty(), "niente è stato creato");
}

#[test]
fn free_name_and_create_compose_into_what_create_note_did() {
    let (_dir, mut ws) = vault_plain();
    ws.with_host("prova.plugin", |host| {
        // Il flusso che il kernel faceva da sé in `create_note(None)`: due
        // capacità che si compongono invece di una che rinomina in silenzio.
        for atteso in ["Senza titolo.md", "Senza titolo 1.md", "Senza titolo 2.md"] {
            let id = host.free_name(&DocId::new("Senza titolo.md"));
            assert_eq!(id.as_str(), atteso);
            host.create_document(&id, "").expect("crea");
        }
    });
}

// ---------------------------------------------------------------------------
// Rinominare: quella del kernel, non una nuda
// ---------------------------------------------------------------------------

#[test]
fn the_rename_a_plugin_gets_is_the_one_that_rewrites_backlinks() {
    let (_dir, mut ws) = vault_con_link();
    ws.write_document(&DocId::new("bersaglio.md"), "")
        .expect("scrive");
    ws.write_document(&DocId::new("chi-linka.md"), "bersaglio")
        .expect("scrive");

    ws.with_host("prova.plugin", |host| {
        host.rename_document(
            &DocId::new("bersaglio.md"),
            &DocId::new("Archivio/nuovo.md"),
        )
        .expect("rinomina");
    });

    let sorgente = ws
        .read_source(&DocId::new("chi-linka.md"))
        .expect("il sorgente di terzi");
    assert_eq!(
        sorgente.trim(),
        "nuovo",
        "il rename del contratto è quello del kernel: il backlink è stato riscritto"
    );
}

#[test]
fn a_rename_through_the_boundary_is_one_batch_not_one_per_backlink() {
    let (_dir, mut ws) = vault_con_link();
    ws.write_document(&DocId::new("bersaglio.md"), "")
        .expect("scrive");
    for nome in ["uno.md", "due.md", "tre.md"] {
        ws.write_document(&DocId::new(nome), "bersaglio")
            .expect("scrive");
    }
    let rx = ws.bus().subscribe();

    ws.with_host("automazione", |host| {
        host.rename_document(&DocId::new("bersaglio.md"), &DocId::new("altro.md"))
            .expect("rinomina");
    });

    let notices: Vec<_> = rx.try_iter().collect();
    let batches: Vec<_> = notices
        .iter()
        .filter(|n| matches!(n.event, Event::BatchEnded { .. }))
        .collect();
    assert_eq!(
        batches.len(),
        1,
        "una rinomina con tre backlink è UNA cosa: {:?}",
        notices.iter().map(|n| n.kind()).collect::<Vec<_>>()
    );
    let Event::BatchEnded { changed, .. } = &batches[0].event else {
        unreachable!()
    };
    assert!(
        changed.len() >= 4,
        "il lotto elenca il rinominato e i sorgenti riscritti: {changed:?}"
    );
}

// ---------------------------------------------------------------------------
// Il cestino, tutto dal contratto
// ---------------------------------------------------------------------------

#[test]
fn the_trash_round_trip_closes_without_touching_the_workspace() {
    let (_dir, mut ws) = vault_plain();
    ws.write_document(&DocId::new("nota.md"), "contenuto")
        .expect("scrive");

    let ripristinata = ws.with_host("prova.plugin", |host| {
        let dove = host
            .trash_document(&DocId::new("nota.md"))
            .expect("cestina");
        assert!(
            dove.as_str().starts_with(".trash/"),
            "il ritorno dice DOVE è finita: {dove}"
        );
        assert!(
            !host
                .list_documents()
                .expect("elenca")
                .contains(&DocId::new("nota.md")),
            "una nota cestinata non è più un documento del vault"
        );

        let voci = host.list_trash().expect("elenca il cestino");
        assert_eq!(voci.len(), 1);
        assert_eq!(voci[0].id, dove, "l'id con cui si ripristina");
        assert_eq!(voci[0].original.as_str(), "nota.md", "dove tornerebbe");

        let entry = voci[0].id.clone();
        host.restore_document(&entry, None).expect("ripristina")
    });

    assert_eq!(ripristinata.as_str(), "nota.md");
    assert_eq!(
        ws.read_source(&DocId::new("nota.md")).expect("rileggibile"),
        "contenuto"
    );
    assert!(
        ws.list_trash().expect("cestino").is_empty(),
        "ciò che è tornato non è più nel cestino"
    );
}

#[test]
fn restoring_onto_an_occupied_path_asks_instead_of_overwriting() {
    let (_dir, mut ws) = vault_plain();
    ws.write_document(&DocId::new("nota.md"), "vecchia")
        .expect("scrive");

    ws.with_host("prova.plugin", |host| {
        let voce = host
            .trash_document(&DocId::new("nota.md"))
            .expect("cestina");
        // Qualcuno rioccupa il path mentre la nota è nel cestino.
        host.create_document(&DocId::new("nota.md"), "nuova")
            .expect("crea");

        host.restore_document(&voce, None)
            .expect_err("il path d'origine è occupato: si rifiuta, non si sovrascrive");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).expect("legge"),
            "nuova"
        );

        // Chi chiama ha `free_name` e decide: è la stessa composizione di
        // `create_document`, e il motivo per cui l'host non sceglie da sé.
        let alternativa = host.free_name(&DocId::new("nota.md"));
        let dove = host
            .restore_document(&voce, Some(alternativa.clone()))
            .expect("ripristina sotto un altro nome");
        assert_eq!(dove, alternativa);
    });
}

#[test]
fn emptying_the_trash_says_how_much_it_destroyed() {
    let (_dir, mut ws) = vault_plain();
    for nome in ["a.md", "b.md"] {
        ws.write_document(&DocId::new(nome), "x").expect("scrive");
    }

    ws.with_host("prova.plugin", |host| {
        host.trash_document(&DocId::new("a.md")).expect("cestina");
        host.trash_document(&DocId::new("b.md")).expect("cestina");
        assert_eq!(host.empty_trash().expect("svuota"), 2);
        assert!(host.list_trash().expect("elenca").is_empty());
        assert_eq!(
            host.empty_trash().expect("svuota di nuovo"),
            0,
            "svuotare un cestino vuoto riesce e non ha distrutto niente"
        );
    });
}

// ---------------------------------------------------------------------------
// `run_command`: comporre
// ---------------------------------------------------------------------------

type Log = Arc<Mutex<Vec<String>>>;

/// Tre comandi in **un solo** provider: una macro, il passo che scrive, e il
/// comando che si invoca da sé.
///
/// Stessa registrazione apposta: se l'host estraesse il provider per la durata
/// della chiamata (la disciplina di view, indici e handler) la macro non
/// troverebbe il proprio passo, e questo test sarebbe rosso.
struct Macro(Log);

const MACRO: &str = "test.macro";
const PASSO: &str = "test.passo";
const OUROBOROS: &str = "test.ouroboros";

impl CommandProvider for Macro {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(MACRO, "Macro")
                .describing("Invoca il passo, due volte.")
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            CommandSpec::new(PASSO, "Passo")
                .describing("Crea una nota.")
                .with_param(ParamSpec::new("id", "Id", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(OUROBOROS, "Si chiama da sé")
                .describing("Invoca sé stesso.")
                .with_scope(CommandScope::writing(CommandReach::Document)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            MACRO => {
                for id in ["macro-a.md", "macro-b.md"] {
                    let esito = host.run_command(PASSO, serde_json::json!({ "id": id }))?;
                    self.0
                        .lock()
                        .unwrap()
                        .push(format!("{id}:{:?}", esito.effect));
                }
                Ok(CommandOutcome::notify("macro fatta"))
            }
            PASSO => {
                let id = DocId::new(args["id"].as_str().unwrap_or_default());
                if mode.is_dry_run() {
                    // Il passo *sa* di essere simulato senza che la macro
                    // gliel'abbia detto: il modo è dell'host.
                    return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                        fubmd_abi::command::CommandPlan::of_edits(format!("crea {id}"), Vec::new())
                            .with_doc(id),
                    )));
                }
                host.create_document(&id, "")?;
                Ok(CommandOutcome::notify("passo fatto"))
            }
            OUROBOROS => host.run_command(OUROBOROS, serde_json::Value::Null),
            other => Err(PluginError::UnknownCommand(other.to_string())),
        }
    }
}

fn con_macro() -> (tempfile::TempDir, Workspace, Log) {
    let (dir, mut ws) = vault_plain();
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    ws.register_command_provider("test.macro", Box::new(Macro(log.clone())));
    (dir, ws, log)
}

#[test]
fn a_macro_of_two_commands_is_one_batch_and_one_actor() {
    let (_dir, mut ws, _log) = con_macro();
    let rx = ws.bus().subscribe();

    ws.invoke_command(
        MACRO,
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::Plugin {
            id: "automazione".into(),
        },
    )
    .expect("la macro gira");

    assert_eq!(
        ws.documents(),
        vec![DocId::new("macro-a.md"), DocId::new("macro-b.md")],
        "i due passi hanno scritto davvero"
    );

    let notices: Vec<_> = rx.try_iter().collect();
    let batches: Vec<_> = notices
        .iter()
        .filter(|n| matches!(n.event, Event::BatchEnded { .. }))
        .collect();
    assert_eq!(
        batches.len(),
        1,
        "tre invocazioni annidate, un lotto: l'utente ha chiesto una cosa"
    );
    assert_eq!(
        batches[0].origin.actor,
        Actor::Plugin {
            id: "automazione".into()
        },
        "invocare non riazzera l'attore: chi ha chiesto resta chi è entrato"
    );
}

#[test]
fn simulating_a_macro_simulates_its_steps_and_writes_nothing() {
    let (_dir, mut ws, log) = con_macro();

    let esito = ws
        .invoke_command(
            MACRO,
            serde_json::Value::Null,
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("la simulazione gira");

    assert!(
        ws.documents().is_empty(),
        "una simulazione non scrive, nemmeno attraverso un comando che invoca"
    );
    assert!(
        matches!(esito.effect, CommandEffect::Done),
        "l'esito della macro è il suo; ciò che conta è cosa hanno risposto i passi"
    );
    let visto = log.lock().unwrap().clone();
    assert_eq!(visto.len(), 2);
    for riga in visto {
        assert!(
            riga.contains("Plan"),
            "il passo ha risposto col piano perché l'host in cui girava era \
             già quello di una simulazione: {riga}"
        );
    }
}

#[test]
fn a_command_that_invokes_itself_is_refused_by_name() {
    let (_dir, mut ws, _log) = con_macro();

    let e = ws
        .invoke_command(
            OUROBOROS,
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .expect_err("il giro è rifiutato");

    let messaggio = e.to_string();
    assert!(
        messaggio.contains(OUROBOROS) && messaggio.contains('→'),
        "l'errore NOMINA il giro invece di essere uno stack overflow: {messaggio}"
    );
}

#[test]
fn a_read_only_command_cannot_launder_a_write_through_run_command() {
    let (_dir, mut ws, _log) = con_macro();

    // La macro si è dichiarata `writes`, quindi in `Apply` scrive. Ma il passo
    // che invoca, se la macro fosse simulata, non può scrivere: è ciò che il
    // test qui sopra prova. Qui si prova l'altra metà — un `Apply` di un
    // comando *di sola lettura* non esiste come varco: l'host che riceve è
    // read-only e `run_command` di lì forza la simulazione.
    let esito = ws
        .invoke_command(
            MACRO,
            serde_json::Value::Null,
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("gira");
    assert!(matches!(esito.effect, CommandEffect::Done));
    assert!(ws.documents().is_empty());
}
