//! Il registro dei comandi (§1.1) e ciò che l'host garantisce a chi lo usa
//! senza aver letto il codice dei comandi (§1.36).
//!
//! Le due garanzie non sono di cortesia: sono ciò che distingue un registro
//! **eseguibile da terzi** da un elenco di funzioni con un nome.
//!
//! 1. **Gli argomenti sono convalidati contro la spec, prima del comando.** Un
//!    chiamante che sbaglia riceve un errore che dice cosa manca; un comando non
//!    deve difendersi da solo.
//! 2. **Le capacità dipendono da ciò che il comando ha dichiarato.** In
//!    simulazione — e per chi si è dichiarato di sola lettura — l'host prestato
//!    rifiuta le scritture. I comandi di questo file ci provano *apposta*: se un
//!    giorno la garanzia sparisse, il vault cambierebbe e il test lo direbbe.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::command::{
    CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit,
};
use fubmd_abi::edit::{EditRequest, TextEdit};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventMask};
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, Span};
use fubmd_abi::traits::{CommandProvider, EventHandler, HostApi};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Provider di formato minimo (come negli altri test del kernel).
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

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(PlainProvider));
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex");
    (dir, ws)
}

type Log = Arc<Mutex<Vec<String>>>;

/// Un comando che dichiara i propri parametri e annota gli argomenti ricevuti:
/// serve a provare che la convalida avviene **prima** di lui.
struct Echo(Log);

impl CommandProvider for Echo {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.echo", "Ripeti")
            .describing("Ripete ciò che gli si dà.")
            .with_param(ParamSpec::new("what", "Cosa", ParamKind::Text).required())
            .with_param(ParamSpec::new("loud", "Forte", ParamKind::Bool))]
    }

    fn invoke(
        &self,
        _command: &str,
        args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        self.0.lock().unwrap().push(args.to_string());
        Ok(CommandOutcome::notify("fatto"))
    }
}

/// Un comando che scrive **sempre**, qualunque cosa gli si chieda: è il comando
/// di terzi che non onora le convenzioni. Ciò che lo ferma è l'host, non lui.
struct AlwaysWrites {
    /// Come si dichiara: onestamente (`writes: true`) o no.
    dichiara_scritture: bool,
    /// L'errore che l'host gli ha restituito, se ce n'è stato uno.
    rifiutato: Arc<Mutex<Option<String>>>,
}

impl CommandProvider for AlwaysWrites {
    fn commands(&self) -> Vec<CommandSpec> {
        let scope = if self.dichiara_scritture {
            CommandScope::writing(CommandReach::Document)
        } else {
            CommandScope::read_only()
        };
        vec![CommandSpec::new("test.write", "Scrivi comunque")
            .describing("Scrive, anche quando gli si chiede solo cosa farebbe.")
            .with_scope(scope)]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let doc = DocId::new("nota.md");
        if let Err(e) = host.write_document(&doc, "scritto dal comando") {
            *self.rifiutato.lock().unwrap() = Some(e.to_string());
        }
        if mode.is_dry_run() {
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                CommandPlan::of_edits("niente", Vec::new()),
            )));
        }
        Ok(CommandOutcome::done())
    }
}

/// Un comando che restituisce un piano **incompleto**: tocca due note e ne
/// nomina una. È l'errore che rende un consenso strappato.
struct HalfHonestPlan;

impl CommandProvider for HalfHonestPlan {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.plan", "Piano")
            .describing("Restituisce un piano su due note e ne dichiara una.")
            .with_scope(CommandScope::writing(CommandReach::Documents))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let edits = |doc: &str| {
            Ok::<_, PluginError>(PlannedEdit::new(
                DocId::new(doc),
                EditRequest::new(
                    host.document_revision(&DocId::new(doc))?,
                    vec![TextEdit::insert(0, "x")],
                ),
            ))
        };
        Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan {
                summary: "due note".into(),
                docs: vec![DocId::new("a.md")],
                edits: vec![edits("a.md")?, edits("b.md")?],
            })),
        )
    }
}

/// Un comando che scrive davvero (dichiarandolo): serve a provare la consegna
/// degli eventi a chiamata tornata.
struct Toucher;

impl CommandProvider for Toucher {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.touch", "Tocca")
            .describing("Scrive una nota.")
            .with_scope(CommandScope::writing(CommandReach::Document))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        host.write_document(&DocId::new("nota.md"), "toccata")?;
        Ok(CommandOutcome::done())
    }
}

/// Handler che annota gli eventi ricevuti, per vedere *quando* arrivano.
struct Recorder(Log);

impl EventHandler for Recorder {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, event: &Event, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0.lock().unwrap().push(format!("{:?}", event.kind()));
        Ok(())
    }
}

#[test]
fn a_command_that_nobody_offers_is_named_as_unknown() {
    let (_dir, mut ws) = vault();
    let err = ws
        .invoke_command("test.nope", serde_json::Value::Null, InvokeMode::Apply)
        .unwrap_err();
    assert!(
        matches!(err, PluginError::UnknownCommand(id) if id == "test.nope"),
        "un id ignoto è un caso a sé, non un errore interno"
    );
}

#[test]
fn the_registry_lists_what_a_caller_needs_to_invoke_without_reading_the_code() {
    let (_dir, mut ws) = vault();
    ws.register_command_provider("test", Box::new(Echo(Log::default())));
    let specs = ws.commands();
    assert_eq!(specs.len(), 1);
    let spec = &specs[0];
    assert_eq!(spec.id, "test.echo");
    assert!(!spec.description.is_empty());
    assert_eq!(spec.params.len(), 2);
    assert!(spec.params[0].required, "`what` è obbligatorio");
    assert!(!spec.scope.writes, "chi non dichiara scritture non ne fa");
}

#[test]
fn the_arguments_are_validated_before_the_command_is_ever_called() {
    let (_dir, mut ws) = vault();
    let log = Log::default();
    ws.register_command_provider("test", Box::new(Echo(log.clone())));

    let err = ws
        .invoke_command("test.echo", serde_json::json!({}), InvokeMode::Apply)
        .unwrap_err();
    let PluginError::BadArgs(msg) = err else {
        panic!("un argomento obbligatorio che manca è BadArgs")
    };
    assert!(
        msg.contains("what"),
        "il messaggio nomina cosa manca: {msg}"
    );

    let err = ws
        .invoke_command(
            "test.echo",
            serde_json::json!({ "what": "ciao", "loud": "sì" }),
            InvokeMode::Apply,
        )
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "specie sbagliata");

    assert!(
        log.lock().unwrap().is_empty(),
        "il comando non è stato chiamato nemmeno una volta: la convalida è \
         dell'host, e un comando non deve difendersi da un chiamante distratto"
    );

    ws.invoke_command(
        "test.echo",
        serde_json::json!({ "what": "ciao" }),
        InvokeMode::Apply,
    )
    .expect("gli argomenti buoni passano");
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[test]
fn a_dry_run_cannot_write_even_if_the_command_tries() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("nota.md");
    ws.write_document(&doc, "originale").expect("scrive");

    let rifiutato = Arc::new(Mutex::new(None));
    ws.register_command_provider(
        "test",
        Box::new(AlwaysWrites {
            dichiara_scritture: true,
            rifiutato: rifiutato.clone(),
        }),
    );

    ws.invoke_command("test.write", serde_json::Value::Null, InvokeMode::DryRun)
        .expect("la simulazione riesce");
    assert_eq!(
        ws.read_source(&doc).expect("legge"),
        "originale",
        "simulare non scrive: la garanzia è dell'host, non del comando"
    );
    let messaggio = rifiutato
        .lock()
        .unwrap()
        .clone()
        .expect("l'host ha rifiutato");
    assert!(
        messaggio.contains("simulazione"),
        "e il rifiuto dice perché, così chi scrive il comando lo legge nei \
         propri test: {messaggio}"
    );

    // Lo stesso comando, applicato: adesso scrive davvero.
    ws.invoke_command("test.write", serde_json::Value::Null, InvokeMode::Apply)
        .expect("applica");
    assert_eq!(ws.read_source(&doc).expect("legge"), "scritto dal comando");
}

#[test]
fn declaring_yourself_read_only_is_binding() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("nota.md");
    ws.write_document(&doc, "originale").expect("scrive");

    let rifiutato = Arc::new(Mutex::new(None));
    ws.register_command_provider(
        "test",
        Box::new(AlwaysWrites {
            // Si dichiara innocuo e non lo è.
            dichiara_scritture: false,
            rifiutato: rifiutato.clone(),
        }),
    );

    ws.invoke_command("test.write", serde_json::Value::Null, InvokeMode::Apply)
        .expect("l'invocazione riesce");
    assert_eq!(
        ws.read_source(&doc).expect("legge"),
        "originale",
        "chi si dichiara di sola lettura riceve un host che rifiuta: la \
         dichiarazione del raggio non è una decorazione"
    );
    let messaggio = rifiutato.lock().unwrap().clone().expect("rifiutato");
    assert!(messaggio.contains("sola lettura"), "{messaggio}");
}

#[test]
fn the_host_completes_the_set_of_documents_a_plan_would_touch() {
    let (_dir, mut ws) = vault();
    ws.write_document(&DocId::new("a.md"), "a").expect("scrive");
    ws.write_document(&DocId::new("b.md"), "b").expect("scrive");
    ws.register_command_provider("test", Box::new(HalfHonestPlan));

    let outcome = ws
        .invoke_command("test.plan", serde_json::Value::Null, InvokeMode::DryRun)
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un piano")
    };
    assert_eq!(
        plan.docs,
        vec![DocId::new("a.md"), DocId::new("b.md")],
        "l'elenco impattato è ciò che l'utente approva: l'host lo completa \
         invece di fidarsi di chi ha scritto il piano"
    );
}

#[test]
fn a_plan_calculated_now_refuses_to_apply_over_someone_elses_write() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("a.md");
    ws.write_document(&doc, "il gatto").expect("scrive");
    ws.register_command_provider("test", Box::new(HalfHonestPlan));
    ws.write_document(&DocId::new("b.md"), "b").expect("scrive");

    let outcome = ws
        .invoke_command("test.plan", serde_json::Value::Null, InvokeMode::DryRun)
        .expect("simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un piano")
    };

    // Fra il piano e l'approvazione, qualcuno scrive.
    ws.write_document(&doc, "un altro testo").expect("scrive");

    let piano_su_a = plan
        .edits
        .into_iter()
        .find(|p| p.doc == doc)
        .expect("il piano nomina a.md");
    let err = ws.apply_edit(&doc, piano_su_a.edit).unwrap_err();
    assert!(
        err.to_string().contains("cambiato"),
        "un piano porta la revisione su cui è stato calcolato: applicarlo dopo \
         una scrittura di terzi fallisce invece di sovrascriverla ({err})"
    );
}

#[test]
fn what_a_command_writes_reaches_the_handlers_after_it_has_returned() {
    let (_dir, mut ws) = vault();
    let log = Log::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())));
    ws.register_command_provider("test", Box::new(Toucher));

    ws.invoke_command("test.touch", serde_json::Value::Null, InvokeMode::Apply)
        .expect("applica");

    let eventi = log.lock().unwrap().clone();
    assert!(
        eventi.iter().any(|e| e.contains("DocumentChanged")),
        "gli eventi della scrittura arrivano: {eventi:?}"
    );
    assert_eq!(
        ws.read_source(&DocId::new("nota.md")).expect("legge"),
        "toccata"
    );
}

#[test]
fn a_reveal_from_a_command_speaks_in_bytes_of_the_new_text() {
    // Il tipo dell'effetto è parte del contratto quanto i suoi campi: questo
    // test non chiama nessuno, verifica che la forma sia quella che la shell
    // sa interpretare (e che un cambio di forma sia rosso qui).
    let effect = CommandEffect::Reveal {
        doc: DocId::new("a.md"),
        span: Span::new(3, 7),
    };
    let json = serde_json::to_value(&effect).expect("serializza");
    assert_eq!(json["kind"], "reveal");
    assert_eq!(json["doc"], "a.md");
    assert_eq!(json["span"]["start"], 3);
}
