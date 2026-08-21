//! **Il secondo trait che attraversa il confine**: `CommandProvider`.
//!
//! `il_primo_componente.rs` prova che un `.wasm` è un [`Plugin`] — si monta,
//! si attiva, fa girare un job, si smonta. Ciò che non prova è il quarto passo
//! del montaggio: `Bundle::register`, il punto in cui un bundle consegna al
//! kernel i propri provider. Là dentro `register` tornava `Vec::new()`, e un
//! componente era un plugin che nessuno poteva **invocare**.
//!
//! La differenza non è di quantità. Un job lo chiede l'host a chi già conosce;
//! un comando lo chiedono la palette, una scorciatoia, una macro e la CLI, che
//! non sanno cosa c'è dall'altra parte e non devono saperlo. Il registro dei
//! comandi è il posto dove «un trait, due backend» smette di essere una
//! proprietà del kernel e diventa una cosa che l'utente vede: nella palette il
//! comando di un `.wasm` e quello di una `struct` Rust sono due righe uguali.
//!
//! # Cosa si prova qui, e in che ordine
//!
//! 1. **Le spec attraversano.** `ws.commands()` contiene i due comandi del
//!    componente con i loro parametri — obbligatorietà, tipo, e le scelte di un
//!    `param-kind` che porta un payload.
//! 2. **L'invocazione attraversa in tutt'e due i versi.** Il comando riceve gli
//!    argomenti e il modo, legge il vault, e risponde con un esito che l'host
//!    rilegge.
//! 3. **La forma profonda dell'esito attraversa.** Piano con edit, annullamento
//!    a passi, parziale con un guasto dentro: sono i tipi più annidati del
//!    contratto, e finché nessuno li pronunciava la traduzione era una promessa.
//! 4. **La convalida sta prima del confine.** Un argomento obbligatorio che
//!    manca è un `bad-args` del kernel, e il componente non viene nemmeno
//!    svegliato.
//! 5. **Il provider se ne va col bundle.** Smontato, il comando è
//!    `unknown-command` — come nel gemello nativo.

mod common;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandReach, InvokeMode, ParamKind, UndoStep};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;

const ID: &str = "demo.ping";
const COUNT: &str = "demo.ping:conta";
const RICH: &str = "demo.ping:esito-ricco";

/// Il contenuto della nota, e la sua lunghezza: il comando `conta` risponde
/// **questo** numero, e un numero scritto qui accanto al testo è ciò che rende
/// l'asserzione una misura invece di una tautologia.
const NOTE: &str = "# Nota\n";

// --- il banco ---------------------------------------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), NOTE).unwrap();
        Vault { _dir: dir, root }
    }
}

/// Un host headless col vault aperto e il ping montato.
fn bench(v: &Vault) -> Host {
    let wasm = common::ping("");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(&bundle, &mut ws)
            .expect("il bundle si monta");
    })
    .expect("aperto");
    host
}

/// Invoca un comando del componente e restituisce l'esito grezzo.
fn invoke_cmd(
    host: &Host,
    command: &str,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.invoke_command(command, args, mode, Actor::User)
    })
    .expect("aperto")
}

// --- le prove ---------------------------------------------------------------

/// Le due spec arrivano nel registro come le ha scritte il componente: id,
/// raggio, e i parametri con la loro obbligatorietà.
///
/// Che le scelte di `stile` arrivino intere è il pezzo che vale la riga: un
/// `param-kind` senza payload attraversa anche se la traduzione sbaglia il
/// caso, un `choice(list<choice>)` no.
#[test]
fn the_spec_of_a_component_are_in_the_record() {
    let v = Vault::new();
    let host = bench(&v);

    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let commands = ws.commands();

        let count = commands
            .iter()
            .find(|c| c.id == COUNT)
            .expect("il comando del componente è nel registro");
        assert!(
            count
                .title
                .as_literal()
                .is_some_and(|t| t.contains("Conta")),
            "il titolo è quello scritto di là: {:?}",
            count.title
        );
        assert!(!count.scope.writes, "si è dichiarato di sola lettura");
        assert_eq!(count.scope.reach, CommandReach::Document);
        assert!(count.params.is_empty(), "non chiede niente");

        let rich = commands
            .iter()
            .find(|c| c.id == RICH)
            .expect("anche il secondo comando c'è");
        assert_eq!(rich.params.len(), 2, "due parametri: {:?}", rich.params);

        let count = &rich.params[0];
        assert_eq!(count.name, "quante");
        assert_eq!(count.kind, ParamKind::Number);
        assert!(
            count.required,
            "è obbligatorio, e il kernel lo farà valere"
        );

        let style = &rich.params[1];
        assert_eq!(style.name, "stile");
        assert!(!style.required);
        let ParamKind::Choice(choices) = &style.kind else {
            panic!("`stile` è una scelta: {:?}", style.kind);
        };
        assert_eq!(
            choices.iter().map(|c| c.value.as_str()).collect::<Vec<_>>(),
            ["corto", "lungo"],
            "le due scelte attraversano intere, valore e ordine"
        );
        assert!(
            choices[1].title.as_literal() == Some("Lungo"),
            "col loro titolo: {:?}",
            choices[1].title
        );
    })
    .expect("aperto");

    host.close();
}

/// Il comando che lavora: legge il vault attraverso il confine e risponde con un
/// effetto che nomina il documento e lo span.
#[test]
fn a_command_of_a_component_reads_and_responds() {
    let v = Vault::new();
    let host = bench(&v);

    let status = invoke_cmd(&host, COUNT, serde_json::json!({}), InvokeMode::Apply)
        .expect("il comando risponde");

    let message = status.notify.expect("il comando dice qualcosa");
    assert_eq!(
        message.as_literal(),
        Some(format!("{} caratteri", NOTE.chars().count()).as_str()),
        "ha letto la nota vera, non una risposta cablata"
    );
    assert_eq!(
        status.effect,
        CommandEffect::Reveal {
            doc: DocId::new("Nota.md"),
            span: fub_abi::model::Span {
                start: 0,
                end: NOTE.len(),
            },
        },
        "lo span a 64 bit del confine è tornato un `usize` di casa"
    );

    host.close();
}

/// L'esito nella sua forma più profonda: piano, annullamento, parziale.
///
/// E il modo, che è l'unica cosa che attraversa **verso** il componente oltre
/// agli argomenti: lo stesso comando invocato due volte risponde due parole
/// diverse, ed è la prova che `in_invoke_mode` non sta traducendo una costante.
#[test]
fn lstatus_complete_of_a_component_returns_whole() {
    let v = Vault::new();
    let host = bench(&v);

    let status = invoke_cmd(
        &host,
        RICH,
        serde_json::json!({ "quante": 3 }),
        InvokeMode::DryRun,
    )
    .expect("il comando risponde");

    assert_eq!(
        status.notify.as_ref().and_then(|t| t.as_literal()),
        Some("dry-run"),
        "il modo è arrivato di là"
    );

    // Il piano. `docs` lo completa il kernel dagli edit, e qui coincide con
    // quello che il componente aveva già dichiarato: la prova è che l'edit
    // dentro sia quello scritto di là, non l'elenco.
    let CommandEffect::Plan(plan) = &status.effect else {
        panic!("l'effetto è un piano: {:?}", status.effect);
    };
    assert!(
        plan
            .summary
            .as_literal()
            .is_some_and(|s| s.starts_with("3 cose")),
        "il riassunto ha visto l'argomento: {:?}",
        plan.summary
    );
    assert_eq!(plan.docs, vec![DocId::new("Nota.md")]);
    assert_eq!(plan.edits.len(), 1);
    let edit = &plan.edits[0];
    assert_eq!(edit.doc, DocId::new("Nota.md"));
    assert!(
        !edit.edit.base.0.is_empty(),
        "la revisione base viene dall'host, chiesta dal componente"
    );
    assert_eq!(edit.edit.edits.len(), 1);
    assert_eq!(edit.edit.edits[0].text, "<!-- proposta -->\n");
    assert_eq!(edit.edit.edits[0].span.start, 0);
    assert_eq!(edit.edit.edits[0].span.end, 0);

    // L'annullamento a passi: un `undo-step` che è un comando, cioè la variante
    // che porta dentro di sé un altro id e i suoi argomenti.
    let undo = status
        .undo
        .as_ref()
        .expect("dichiara come si torna indietro");
    assert_eq!(undo.steps.len(), 1);
    let UndoStep::Command { command, args } = &undo.steps[0] else {
        panic!("il passo è un comando: {:?}", undo.steps[0]);
    };
    assert_eq!(command, COUNT);
    assert_eq!(args, &serde_json::json!({}));

    // Il parziale, col guasto dentro: un `plugin-error` annidato in un esito
    // riuscito, che è il caso che la traduzione degli errori non incontra mai
    // quando l'errore è il valore di ritorno.
    let partial = status.partial.as_ref().expect("il conto c'è");
    assert_eq!(partial.attempted, 3);
    assert_eq!(partial.done, 2);
    assert_eq!(partial.failures.len(), 1);
    assert_eq!(
        partial.failures[0].subject,
        Some(DocId::new("Nota.md")),
        "il guasto nomina il suo soggetto"
    );
    assert!(
        matches!(&partial.failures[0].error, PluginError::Conflict(t)
            if t.as_literal() == Some("l'ultima non è andata")),
        "ed è un conflitto, non un `internal` generico: {:?}",
        partial.failures[0].error
    );

    // Lo stesso comando in `Apply`: cambia una parola, e quella parola è il modo.
    let applied = invoke_cmd(
        &host,
        RICH,
        serde_json::json!({ "quante": 1 }),
        InvokeMode::Apply,
    )
    .expect("il comando risponde");
    assert_eq!(
        applied.notify.as_ref().and_then(|t| t.as_literal()),
        Some("apply"),
        "il modo non è una costante tradotta una volta sola"
    );

    host.close();
}

/// L'argomento obbligatorio che manca non arriva al componente: lo ferma il
/// kernel, contro la spec che il componente stesso ha dichiarato.
///
/// È la promessa su cui `esempi/ping-wasm` si permette di leggere gli argomenti
/// con venti righe di scansione invece di `serde_json`: un comando non si
/// difende da un chiamante distratto, perché non ne incontra.
#[test]
fn a_required_argument_missing_does_not_reach_the_component() {
    let v = Vault::new();
    let host = bench(&v);

    let error = invoke_cmd(&host, RICH, serde_json::json!({}), InvokeMode::DryRun)
        .expect_err("without `quante` the command does not invoke");
    assert!(
        matches!(&error, PluginError::BadArgs(t)
            if t.as_literal().is_some_and(|m| m.contains("quante"))),
        "the refusal names the missing parameter: {error}"
    );

    host.close();
}

/// Smontato il bundle, il provider se ne va con lui: il comando non esiste più.
///
/// È la stessa riga del gemello nativo, e prova la metà del quarto passo che
/// `register` da sola non prova — a togliere i provider è il kernel, che è
/// l'unico che li possiede (decisione 0031).
#[test]
fn unmounted_the_component_the_its_commands_not_there_are_more() {
    let v = Vault::new();
    let host = bench(&v);

    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errors = s.bundles().write().unwrap().unmount(&mut ws, ID);
        assert!(errors.is_empty(), "niente è andato storto: {errors:?}");
        assert!(
            !ws.commands().iter().any(|c| c.id == COUNT),
            "il comando non è più nel registro"
        );
        let error = ws
            .invoke_command(COUNT, serde_json::json!({}), InvokeMode::Apply, Actor::User)
            .expect_err("il comando non esiste più");
        assert!(
            matches!(error, PluginError::UnknownCommand(_)),
            "è un comando sconosciuto: {error}"
        );
    })
    .expect("aperto");

    host.close();
}
