//! Il registro dei comandi (decisione 0009) e ciò che l'host garantisce a chi lo usa
//! senza aver letto il codice dei comandi (decisione 0010).
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
use fubmd_abi::error::PluginError;
use fubmd_abi::event::{Actor, EventMask, Notice};
use fubmd_abi::model::{DocId, Span};
use fubmd_abi::settings::SettingValue;
use fubmd_abi::traits::{CommandProvider, EventHandler, HostApi};
use fubmd_kernel::{FormatRegistry, Workspace};
use fubmd_testkit::TestoDiProva;

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("md").boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in ["test", "recorder"] {
        ws.register_core_feature(plugin, plugin)
            .expect("dichiarato");
    }
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

/// Un comando che prova **ogni capacità strutturale** della decisione 0013 e annota cosa
/// gli ha risposto l'host. Serve a una cosa sola: che il varco della decisione 0010 copra
/// anche le capacità nuove, e che non ne resti una scoperta il giorno che
/// qualcuno ne aggiunge un'altra senza pensarci.
struct TriesEverything {
    rifiuti: Arc<Mutex<Vec<(&'static str, String)>>>,
}

impl CommandProvider for TriesEverything {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.strutturale", "Prova tutto")
            .describing("Prova ogni operazione strutturale, comunque gli si chieda.")
            .with_scope(CommandScope::writing(CommandReach::Vault))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let doc = DocId::new("nota.md");
        let annota = |quale: &'static str, esito: Result<(), PluginError>| {
            if let Err(e) = esito {
                self.rifiuti.lock().unwrap().push((quale, e.to_string()));
            }
        };
        annota("create", host.create_document(&DocId::new("nuova.md"), "x"));
        annota(
            "rename",
            host.rename_document(&doc, &DocId::new("altra.md")),
        );
        annota("trash", host.trash_document(&doc).map(|_| ()));
        annota("restore", host.restore_document(&doc, None).map(|_| ()));
        annota("empty", host.empty_trash().map(|_| ()));
        // La configurazione sta in questo elenco perché è l'effetto **meno
        // ritirabile** di tutti: sopravvive alla sessione, e una simulazione che
        // spegnesse il versioning lo lascerebbe spento. Il guard risponde prima
        // di guardare se la chiave esista, che è il verso giusto: un rifiuto per
        // «stai simulando» non deve dipendere da cosa si stava per scrivere.
        annota(
            "setting",
            host.set_setting("test.chiave", SettingValue::Toggle(true)),
        );
        // Lo stato di vista (§11.2) è in questo elenco per la stessa ragione
        // della configurazione: sopravvive alla sessione. Una prova a vuoto che
        // spostasse lo scroll di un pannello avrebbe lasciato dietro di sé
        // l'unica cosa che doveva non lasciare. E il cancello risponde **prima**
        // di guardare se ci sia un esemplare: un rifiuto per «stai simulando»
        // non deve dipendere da chi stava scrivendo.
        annota(
            "view-state",
            host.set_view_state("scroll", Some(serde_json::json!(10))),
        );
        Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                "niente",
                Vec::new(),
            ))),
        )
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

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        let event = &notice.event;
        self.0.lock().unwrap().push(format!("{:?}", event.kind()));
        Ok(())
    }
}

#[test]
fn a_command_that_nobody_offers_is_named_as_unknown() {
    let (_dir, mut ws) = vault();
    let err = ws
        .invoke_command(
            "test.nope",
            serde_json::Value::Null,
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(
        matches!(err, PluginError::UnknownCommand(id) if id == "test.nope"),
        "un id ignoto è un caso a sé, non un errore interno"
    );
}

#[test]
fn the_registry_lists_what_a_caller_needs_to_invoke_without_reading_the_code() {
    let (_dir, mut ws) = vault();
    ws.register_command_provider("test", Box::new(Echo(Log::default())))
        .expect("registrato");
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
    ws.register_command_provider("test", Box::new(Echo(log.clone())))
        .expect("registrato");

    let err = ws
        .invoke_command(
            "test.echo",
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    let PluginError::BadArgs(msg) = err else {
        panic!("un argomento obbligatorio che manca è BadArgs")
    };
    assert!(
        msg.to_string().contains("what"),
        "il messaggio nomina cosa manca: {msg}"
    );

    let err = ws
        .invoke_command(
            "test.echo",
            serde_json::json!({ "what": "ciao", "loud": "sì" }),
            InvokeMode::Apply,
            Actor::User,
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
        Actor::User,
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
    )
    .expect("registrato");

    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::DryRun,
        Actor::User,
    )
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
    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
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
    )
    .expect("registrato");

    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
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
fn every_structural_capability_is_refused_by_the_same_gate() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("nota.md");
    ws.write_document(&doc, "originale").expect("scrive");

    let rifiuti = Arc::new(Mutex::new(Vec::new()));
    ws.register_command_provider(
        "test",
        Box::new(TriesEverything {
            rifiuti: rifiuti.clone(),
        }),
    )
    .expect("registrato");

    ws.invoke_command(
        "test.strutturale",
        serde_json::Value::Null,
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("la simulazione riesce");

    let visti = rifiuti.lock().unwrap().clone();
    let quali: Vec<&str> = visti.iter().map(|(q, _)| *q).collect();
    assert_eq!(
        quali,
        vec![
            "create",
            "rename",
            "trash",
            "restore",
            "empty",
            "setting",
            "view-state"
        ],
        "ogni capacità strutturale è stata rifiutata: se una passasse, \
         mancherebbe da questo elenco"
    );
    for (quale, messaggio) in &visti {
        assert!(
            messaggio.contains("permesso negato") && messaggio.contains("simulazione"),
            "{quale}: il rifiuto dice perché — {messaggio}"
        );
    }

    assert_eq!(
        ws.read_source(&doc).expect("legge"),
        "originale",
        "e il vault non si è mosso"
    );
    assert_eq!(
        ws.documents(),
        vec![doc],
        "nessuna nota creata, nessuna cestinata"
    );
    assert!(ws.list_trash().expect("cestino").is_empty());
}

#[test]
fn the_host_completes_the_set_of_documents_a_plan_would_touch() {
    let (_dir, mut ws) = vault();
    ws.write_document(&DocId::new("a.md"), "a").expect("scrive");
    ws.write_document(&DocId::new("b.md"), "b").expect("scrive");
    ws.register_command_provider("test", Box::new(HalfHonestPlan))
        .expect("registrato");

    let outcome = ws
        .invoke_command(
            "test.plan",
            serde_json::Value::Null,
            InvokeMode::DryRun,
            Actor::User,
        )
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
    ws.register_command_provider("test", Box::new(HalfHonestPlan))
        .expect("registrato");
    ws.write_document(&DocId::new("b.md"), "b").expect("scrive");

    let outcome = ws
        .invoke_command(
            "test.plan",
            serde_json::Value::Null,
            InvokeMode::DryRun,
            Actor::User,
        )
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
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registrato");
    ws.register_command_provider("test", Box::new(Toucher))
        .expect("registrato");

    ws.invoke_command(
        "test.touch",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
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
