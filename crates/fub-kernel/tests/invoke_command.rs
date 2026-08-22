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

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit,
};
use fub_abi::edit::WriteBase;
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{Actor, EventMask, Notice};
use fub_abi::model::{DocId, Span};
use fub_abi::settings::SettingValue;
use fub_abi::traits::{CommandProvider, EventHandler, HostApi, JobSpec};
use fub_kernel::{Capability, FormatRegistry, Policy, ReadOnly, Workspace};
use fub_testkit::SampleExtractor;

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(SampleExtractor::by_extension("md").boxed())
        .expect("no extension conflict");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in ["test", "recorder"] {
        ws.register_core_feature(plugin, plugin).expect("declared");
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
        vec![CommandSpec::new("test.echo", "Repeat")
            .describing("Repeats whatever is given to it.")
            .with_param(ParamSpec::new("what", "What", ParamKind::Text).required())
            .with_param(ParamSpec::new("loud", "Loud", ParamKind::Bool))]
    }

    fn invoke(
        &self,
        _command: &str,
        args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        self.0.lock().unwrap().push(args.to_string());
        Ok(CommandOutcome::notify("done"))
    }
}

/// Un comando che scrive **sempre**, qualunque cosa gli si chieda: è il comando
/// di terzi che non onora le convenzioni. Ciò che lo ferma è l'host, non lui.
struct AlwaysWrites {
    /// Come si dichiara: onestamente (`writes: true`) o no.
    declares_writes: bool,
    /// L'errore che l'host gli ha restituito, se ce n'è stato uno.
    refused: Arc<Mutex<Option<String>>>,
}

impl CommandProvider for AlwaysWrites {
    fn commands(&self) -> Vec<CommandSpec> {
        let scope = if self.declares_writes {
            CommandScope::writing(CommandReach::Document)
        } else {
            CommandScope::read_only()
        };
        vec![CommandSpec::new("test.write", "Write anyway")
            .describing("Writes, even when asked only what it would do.")
            .with_scope(scope)]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let doc = DocId::new("note.md");
        if let Err(and) = host.write_document(&doc, "written by the command", WriteBase::Dictated) {
            *self.refused.lock().unwrap() = Some(and.to_string());
        }
        if mode.is_dry_run() {
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                CommandPlan::of_edits("nothing", Vec::new()),
            )));
        }
        Ok(CommandOutcome::done())
    }
}

/// Un comando che prova **ogni famiglia che una politica di sola lettura nega**
/// e annota cosa gli ha risposto l'host.
///
/// Ogni tentativo porta due nomi e non uno. La [`Capability`] è quello su cui il
/// test ragiona — è la grana a cui il `Guard` decide, e l'unica su cui si possa
/// calcolare un insieme atteso invece di elencarlo. L'etichetta è quella che
/// finisce nel messaggio d'errore: un rifiuto che dice soltanto
/// «`VaultStructure`» lascia chi legge a cercare *quale* dei cinque metodi sia
/// passato, e cercarlo è esattamente il lavoro che un presidio deve risparmiare.
///
/// Perché ci siano più metodi per la stessa famiglia — cinque per
/// `VaultStructure` — vedi il doc-comment del test: la copertura che questo
/// provider garantisce è per famiglia, i metodi in più sono cortesia.
struct TriesEverything {
    /// Cosa ha provato, nell'ordine.
    attempts: Arc<Mutex<Vec<Attempt>>>,
}

/// Una chiamata provata: la famiglia esercitata, l'etichetta leggibile del
/// metodo, e l'errore ricevuto.
///
/// L'errore è un `Option` e non un `Vec` di soli rifiuti perché i due modi di
/// non essere rifiutati sono **diversi**: `None` dice «l'ha provato ed è
/// passato» — un buco nel cancello — e l'assenza della riga dice «non l'ha
/// provato affatto» — un buco nel presidio. Un elenco dei soli rifiuti li
/// confonderebbe, e il messaggio d'errore direbbe la cosa sbagliata proprio nel
/// momento in cui qualcuno la legge per rimediare.
type Attempt = (Capability, &'static str, Option<String>);

impl CommandProvider for TriesEverything {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.structural", "Try everything")
            .describing("Tries every structural operation, whatever is asked.")
            .with_scope(CommandScope::writing(CommandReach::Vault))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let doc = DocId::new("note.md");
        let annotate = |cap: Capability, which: &'static str, result: Result<(), PluginError>| {
            self.attempts.lock().unwrap().push((
                cap,
                which,
                result.err().map(|and| and.to_string()),
            ));
        };
        annotate(
            Capability::VaultWrite,
            "write",
            host.write_document(&doc, "written by the command", WriteBase::Dictated)
                .map(|_| ()),
        );
        annotate(
            Capability::VaultStructure,
            "create",
            host.create_document(&DocId::new("new.md"), "x"),
        );
        annotate(
            Capability::VaultStructure,
            "rename",
            host.rename_document(&doc, &DocId::new("other.md")),
        );
        annotate(
            Capability::VaultStructure,
            "trash",
            host.trash_document(&doc).map(|_| ()),
        );
        annotate(
            Capability::VaultStructure,
            "restore",
            host.restore_document(&doc, None).map(|_| ()),
        );
        annotate(
            Capability::VaultStructure,
            "empty",
            host.empty_trash().map(|_| ()),
        );
        // Il proprio recinto persistente: non ha un permesso dichiarabile —
        // i blob sono già solo i propri — ma sopravvive alla sessione, e questo
        // basta a metterlo fra ciò che una simulazione non deve poter toccare.
        annotate(
            Capability::DataWrite,
            "data-write",
            host.data_write("test.bin", b"x"),
        );
        // La configurazione sta in questo elenco perché è l'effetto **meno
        // ritirabile** di tutti: sopravvive alla sessione, e una simulazione che
        // spegnesse il versioning lo lascerebbe spento. Il guard risponde prima
        // di guardare se la chiave esista, che è il verso giusto: un rifiuto per
        // «stai simulando» non deve dipendere da cosa si stava per scrivere.
        // Lo stato di vista (§11.2) è in questo elenco per la stessa ragione
        annotate(
            Capability::SettingsWrite,
            "setting",
            host.set_setting("test.key", SettingValue::Toggle(true)),
        );
        // della configurazione: sopravvive alla sessione. Una prova a vuoto che
        // spostasse lo scroll di un pannello avrebbe lasciato dietro di sé
        // l'unica cosa che doveva non lasciare. E il cancello risponde **prima**
        // di guardare se ci sia un esemplare: un rifiuto per «stai simulando»
        // non deve dipendere da chi stava scrivendo.
        // `Events` si prova con `spawn_job` e **non** con `emit`, e non è un
        annotate(
            Capability::ViewStateWrite,
            "view-state",
            host.set_view_state("scroll", Some(serde_json::json!(10))),
        );
        // dettaglio di comodo: `emit` non restituisce un `Result`: è una delle
        // sei capacità che non sanno dire di no (`host/guard.rs`), e il suo
        // rifiuto è il silenzio. Un tentativo che non può fallire non prova
        // niente; un job invece rientra quando la simulazione è finita da un
        // pezzo, e il suo rifiuto ha un canale per dirsi.
        // Un servizio di un altro plugin girerebbe con le capacità di **chi lo
        annotate(
            Capability::Events,
            "spawn-job",
            host.spawn_job(JobSpec {
                job: "test".into(),
                payload: serde_json::Value::Null,
            })
            .map(|_| ()),
        );
        // offre**: se passasse, una simulazione avrebbe una scala per uscire da
        // sé stessa. Che nessuno serva `test.other` non c'entra — il cancello
        // risponde prima di cercare chi lo serve, e un `Unserved` qui sarebbe
        // già la prova che il controllo è arrivato dopo.
        // **Una `DryRun` che scarica non è una simulazione**, ed è l'unica
        // famiglia il cui effetto non è nemmeno *in questo processo*: un `POST`
        annotate(
            Capability::Services,
            "call-service",
            host.call_service("test.other", "something", serde_json::Value::Null)
                .map(|_| ()),
        );
        // crea qualcosa dall'altra parte, e un `GET` viene contato e registrato
        // da chi risponde. Che questo montaggio non abbia un client di rete non
        // c'entra — come sopra, il cancello risponde prima, e un `Unserved` qui
        // sarebbe già la prova che il controllo è arrivato dopo.
        // Un comando che restituisce un piano **incompleto**: tocca due note e ne
        // nomina una. È l'errore che rende un consenso strappato.
        annotate(
            Capability::Network,
            "fetch",
            host.fetch(fub_abi::net::HttpRequest::get("https://api.acme.test/x"))
                .map(|_| ()),
        );
        Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                "nothing",
                Vec::new(),
            ))),
        )
    }
}

/// Un comando che scrive davvero (dichiarandolo): serve a provare la consegna
/// degli eventi a chiamata tornata.
struct HalfHonestPlan;

impl CommandProvider for HalfHonestPlan {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.plan", "Plan")
            .describing("Returns a plan on two notes and declares one.")
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
                summary: "two notes".into(),
                docs: vec![DocId::new("a.md")],
                edits: vec![edits("a.md")?, edits("b.md")?],
            })),
        )
    }
}

/// Handler che annota gli eventi ricevuti, per vedere *quando* arrivano.
// Lo stesso comando, applicato: adesso scrive davvero.
struct Toucher;

impl CommandProvider for Toucher {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("test.touch", "Touch")
            .describing("Writes a note.")
            .with_scope(CommandScope::writing(CommandReach::Document))]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        host.write_document(&DocId::new("note.md"), "touched", WriteBase::Dictated)?;
        Ok(CommandOutcome::done())
    }
}

// Si dichiara innocuo e non lo è.
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
        "an unknown id is its own case, not an internal error"
    );
}

#[test]
fn the_registry_lists_what_a_caller_needs_to_invoke_without_reading_the_code() {
    let (_dir, mut ws) = vault();
    ws.register_command_provider("test", Box::new(Echo(Log::default())))
        .expect("registered");
    let specs = ws.commands();
    assert_eq!(specs.len(), 1);
    let spec = &specs[0];
    assert_eq!(spec.id, "test.echo");
    assert!(!spec.description.is_empty());
    assert_eq!(spec.params.len(), 2);
    assert!(spec.params[0].required, "`what` is required");
    assert!(
        !spec.scope.writes,
        "whoever does not declare writes does not write"
    );
}

#[test]
fn the_arguments_are_validated_before_the_command_is_ever_called() {
    let (_dir, mut ws) = vault();
    let log = Log::default();
    ws.register_command_provider("test", Box::new(Echo(log.clone())))
        .expect("registered");

    let err = ws
        .invoke_command(
            "test.echo",
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    let PluginError::BadArgs(msg) = err else {
        panic!("a missing required argument is BadArgs")
    };
    assert!(
        msg.to_string().contains("what"),
        "the message names what is missing: {msg}"
    );

    let err = ws
        .invoke_command(
            "test.echo",
            serde_json::json!({ "what": "hi", "loud": "yes" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "wrong type");

    assert!(
        log.lock().unwrap().is_empty(),
        "the command was not called even once: validation is the host's, and a \
         command must not defend itself against a distracted caller"
    );

    ws.invoke_command(
        "test.echo",
        serde_json::json!({ "what": "hi" }),
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("good arguments pass");
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[test]
fn a_dry_run_cannot_write_even_if_the_command_tries() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("note.md");
    ws.write_document(&doc, "original", WriteBase::Dictated)
        .expect("writes");

    let refused = Arc::new(Mutex::new(None));
    ws.register_command_provider(
        "test",
        Box::new(AlwaysWrites {
            declares_writes: true,
            refused: refused.clone(),
        }),
    )
    .expect("registered");

    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("simulation succeeds");
    assert_eq!(
        ws.read_source(&doc).expect("reads"),
        "original",
        "simulating does not write: the guarantee is the host's, not the command's"
    );
    let message = refused.lock().unwrap().clone().expect("the host refused");
    assert!(
        message.contains("simulazione"),
        "and the refusal says why, so the command writer reads it in their own \
         tests: {message}"
    );

    // Il varco della decisione 0010 copre **ogni** famiglia che una politica di
    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("applies");
    assert_eq!(
        ws.read_source(&doc).expect("reads"),
        "written by the command"
    );
}

#[test]
fn declaring_yourself_read_only_is_binding() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("note.md");
    ws.write_document(&doc, "original", WriteBase::Dictated)
        .expect("writes");

    let refused = Arc::new(Mutex::new(None));
    ws.register_command_provider(
        "test",
        Box::new(AlwaysWrites {
            // sola lettura nega — e l'elenco delle famiglie non è scritto qui dentro: si
            declares_writes: false,
            refused: refused.clone(),
        }),
    )
    .expect("registered");

    ws.invoke_command(
        "test.write",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("invocation succeeds");
    assert_eq!(
        ws.read_source(&doc).expect("reads"),
        "original",
        "whoever declares itself read-only receives a host that refuses: the \
         ray declaration is not a decoration"
    );
    let message = refused.lock().unwrap().clone().expect("refused");
    assert!(message.contains("sola lettura"), "{message}");
}

/// calcola.
///
/// # Perché non un elenco
///
/// Fino alla riscrittura di questo test l'asserzione era
/// `quali == vec!["create", "rename", "trash", "restore", "empty", "setting",
/// "view-state"]`: sette nomi scritti a mano, giusti nel momento in cui furono
/// scritti e ciechi a tutto ciò che sarebbe venuto dopo. Il presidio notava se
/// una delle sette **smetteva** di essere rifiutata; non notava l'ottava. La
/// [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md) gli
/// attribuiva invece la proprietà di accorgersi «di quella che un giorno
/// qualcuno aggiungesse senza pensarci», e quella proprietà non ce l'aveva: le
/// due che sono entrate — `setting` con la 0036, `view-state` con la 0037 —
/// sono state aggiunte a mano da chi scriveva quelle decisioni, cioè per
/// attenzione, che è precisamente ciò che un presidio serve a non dover
/// spendere.
///
/// Adesso l'insieme atteso lo dà [`Capability::ALL`] filtrato da
/// [`ReadOnly`]: le famiglie negate sono quelle che dice la politica, oggi e
/// il giorno che ne nascerà un'altra. E l'asserzione è nelle **due** direzioni,
/// perché i due modi di sbagliare sono diversi e vanno detti diversi:
///
/// - una famiglia negata che nessuno qui esercita è **scoperta** — il buco è
///   nel presidio, e si chiude aggiungendo una chiamata a [`TriesEverything`];
/// - una famiglia esercitata che **passa** è un buco nel cancello, e quello si
///   chiude in `host/guard.rs`.
///
/// # Cosa questo presidio non garantisce
///
/// Garantisce la copertura alla grana della **famiglia**, che è la grana a cui
/// il `Guard` decide: una politica risponde su `Capability`, non su
/// `create_document`. Non garantisce che un **metodo nuovo dentro una famiglia
/// già coperta** abbia il suo `check(...)`. Quel controllo è scritto a mano,
/// riga per riga, dentro `host/guard.rs`, e il compilatore obbliga soltanto a
/// *implementare* il metodo — non a metterci dentro la guardia. Un sesto metodo
/// di `VaultStructure` che delegasse all'host sottostante senza chiedere niente
/// alla politica passerebbe di qui **verde**, perché `VaultStructure` risulta
/// coperta dagli altri cinque. È un limite vero e va nominato accanto al
/// presidio invece che scoperto dopo.
// L'insieme atteso, calcolato. La `why` non conta — `ReadOnly` nega per
// famiglia e la ragione è solo il testo che finisce nel messaggio — ma è la
#[test]
fn every_structural_capability_is_refused_by_the_same_gate() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("note.md");
    ws.write_document(&doc, "original", WriteBase::Dictated)
        .expect("writes");

    let attempts = Arc::new(Mutex::new(Vec::new()));
    ws.register_command_provider(
        "test",
        Box::new(TriesEverything {
            attempts: attempts.clone(),
        }),
    )
    .expect("registered");

    ws.invoke_command(
        "test.structural",
        serde_json::Value::Null,
        InvokeMode::DryRun,
        Actor::User,
    )
    .expect("simulation succeeds");

    // stessa frase che il kernel monta simulando, così l'asserzione sul
    // messaggio qui sotto e quella sull'insieme parlano della stessa politica.
    // Basta **un** tentativo passato perché la famiglia non si possa dire
    // rifiutata: cinque `check` su sei metodi sono un cancello con un buco, non
    // un cancello.
    let policy = ReadOnly {
        why: "a simulation does not write",
    };
    let denied: BTreeSet<Capability> = Capability::ALL
        .into_iter()
        .filter(|&cap| policy.denies(cap).is_some())
        .collect();

    let seen = attempts.lock().unwrap().clone();
    let exercised: BTreeSet<Capability> = seen.iter().map(|(cap, _, _)| *cap).collect();
    // E ogni rifiuto dice **perché**: un `permission-denied` muto costringe chi
    // scrive un comando a indovinare se abbia sbagliato permessi o se stia solo
    let passed: BTreeSet<Capability> = seen
        .iter()
        .filter(|(_, _, result)| result.is_none())
        .map(|(cap, _, _)| *cap)
        .collect();

    let discovered: Vec<Capability> = denied.difference(&exercised).copied().collect();
    assert!(
        discovered.is_empty(),
        "{discovered:?}: `ReadOnly` denies them and nobody here tries them, so the
         day the gate lets them pass this test would stay green. Add a call to
         `TriesEverything` for each — a method that returns `Result`, not one of
         the six capabilities that cannot say no — annotating it with its
         `Capability`."
    );

    let holed: Vec<Capability> = denied.intersection(&passed).copied().collect();
    assert!(
        holed.is_empty(),
        "{holed:?}: the policy denies them and the host served them anyway. The
         hole is in the gate, not here: in `host/guard.rs` there is a method of
         that family that delegates without calling `check`. Attempts: {seen:?}"
    );

    // simulando, e sono due rimedi opposti.
    // Fra il piano e l'approvazione, qualcuno scrive.
    // Il tipo dell'effetto è parte del contratto quanto i suoi campi: questo
    for (cap, which, message) in seen
        .iter()
        .filter_map(|(c, q, and)| Some((c, q, and.as_ref()?)))
    {
        assert!(
            message.contains("permission denied") && message.contains("simulazione"),
            "{cap:?}/{which}: the refusal says why — {message}"
        );
    }

    assert_eq!(
        ws.read_source(&doc).expect("reads"),
        "original",
        "and the vault has not moved"
    );
    assert_eq!(
        ws.documents(),
        vec![doc],
        "no note created, no note trashed"
    );
    assert!(ws.list_trash().expect("trash").is_empty());
}

#[test]
fn the_host_completes_the_set_of_documents_a_plan_would_touch() {
    let (_dir, mut ws) = vault();
    ws.write_document(&DocId::new("a.md"), "a", WriteBase::Dictated)
        .expect("writes");
    ws.write_document(&DocId::new("b.md"), "b", WriteBase::Dictated)
        .expect("writes");
    ws.register_command_provider("test", Box::new(HalfHonestPlan))
        .expect("registered");

    let outcome = ws
        .invoke_command(
            "test.plan",
            serde_json::Value::Null,
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simulates");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("a plan")
    };
    assert_eq!(
        plan.docs,
        vec![DocId::new("a.md"), DocId::new("b.md")],
        "the impacted list is what the user approves: the host completes it \
         instead of trusting whoever wrote the plan"
    );
}

#[test]
fn a_plan_calculated_now_refuses_to_apply_over_someone_elses_write() {
    let (_dir, mut ws) = vault();
    let doc = DocId::new("a.md");
    ws.write_document(&doc, "the cat", WriteBase::Dictated)
        .expect("writes");
    ws.register_command_provider("test", Box::new(HalfHonestPlan))
        .expect("registered");
    ws.write_document(&DocId::new("b.md"), "b", WriteBase::Dictated)
        .expect("writes");

    let outcome = ws
        .invoke_command(
            "test.plan",
            serde_json::Value::Null,
            InvokeMode::DryRun,
            Actor::User,
        )
        .expect("simulates");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("a plan")
    };

    // test non chiama nessuno, verifica che la forma sia quella che la shell
    ws.write_document(&doc, "other text", WriteBase::Dictated)
        .expect("writes");

    let plan_on_a = plan
        .edits
        .into_iter()
        .find(|p| p.doc == doc)
        .expect("the plan names a.md");
    let err = ws.apply_edit(&doc, plan_on_a.edit).unwrap_err();
    assert!(
        err.to_string().contains("cambiato"),
        "a plan carries the revision on which it was calculated: applying it \
         after a third-party write fails instead of overwriting it ({err})"
    );
}

#[test]
fn what_a_command_writes_reaches_the_handlers_after_it_has_returned() {
    let (_dir, mut ws) = vault();
    let log = Log::default();
    ws.register_event_handler("recorder", Box::new(Recorder(log.clone())))
        .expect("registered");
    ws.register_command_provider("test", Box::new(Toucher))
        .expect("registered");

    ws.invoke_command(
        "test.touch",
        serde_json::Value::Null,
        InvokeMode::Apply,
        Actor::User,
    )
    .expect("applies");

    let events = log.lock().unwrap().clone();
    assert!(
        events.iter().any(|and| and.contains("DocumentChanged")),
        "the write events arrive: {events:?}"
    );
    assert_eq!(
        ws.read_source(&DocId::new("note.md")).expect("reads"),
        "touched"
    );
}

#[test]
fn a_reveal_from_a_command_speaks_in_bytes_of_the_new_text() {
    // sa interpretare (e che un cambio di forma sia rosso qui).
    // test non chiama nessuno, verifica che la forma sia quella che la shell
    // sa interpretare (e che un cambio di forma sia rosso qui).
    let effect = CommandEffect::Reveal {
        doc: DocId::new("a.md"),
        span: Span::new(3, 7),
    };
    let json = serde_json::to_value(&effect).expect("serializes");
    assert_eq!(json["kind"], "reveal");
    assert_eq!(json["doc"], "a.md");
    assert_eq!(json["span"]["start"], 3);
}
