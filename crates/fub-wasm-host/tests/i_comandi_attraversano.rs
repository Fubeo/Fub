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

mod comune;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandReach, InvokeMode, ParamKind, UndoStep};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;

const ID: &str = "demo.ping";
const CONTA: &str = "demo.ping:conta";
const RICCO: &str = "demo.ping:esito-ricco";

/// Il contenuto della nota, e la sua lunghezza: il comando `conta` risponde
/// **questo** numero, e un numero scritto qui accanto al testo è ciò che rende
/// l'asserzione una misura invece di una tautologia.
const NOTA: &str = "# Nota\n";

// --- il banco ---------------------------------------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), NOTA).unwrap();
        Vault { _dir: dir, root }
    }
}

/// Un host headless col vault aperto e il ping montato.
fn banco(v: &Vault) -> Host {
    let wasm = comune::ping("");
    let bundle = WasmBundle::da_file(&wasm, Trust::Community).expect("il componente si carica");

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
fn invoca(
    host: &Host,
    comando: &str,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<fub_abi::command::CommandOutcome, PluginError> {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.invoke_command(comando, args, mode, Actor::User)
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
fn le_spec_di_un_componente_stanno_nel_registro() {
    let v = Vault::nuovo();
    let host = banco(&v);

    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let comandi = ws.commands();

        let conta = comandi
            .iter()
            .find(|c| c.id == CONTA)
            .expect("il comando del componente è nel registro");
        assert!(
            conta
                .title
                .as_literal()
                .is_some_and(|t| t.contains("Conta")),
            "il titolo è quello scritto di là: {:?}",
            conta.title
        );
        assert!(!conta.scope.writes, "si è dichiarato di sola lettura");
        assert_eq!(conta.scope.reach, CommandReach::Document);
        assert!(conta.params.is_empty(), "non chiede niente");

        let ricco = comandi
            .iter()
            .find(|c| c.id == RICCO)
            .expect("anche il secondo comando c'è");
        assert_eq!(ricco.params.len(), 2, "due parametri: {:?}", ricco.params);

        let quante = &ricco.params[0];
        assert_eq!(quante.name, "quante");
        assert_eq!(quante.kind, ParamKind::Number);
        assert!(
            quante.required,
            "è obbligatorio, e il kernel lo farà valere"
        );

        let stile = &ricco.params[1];
        assert_eq!(stile.name, "stile");
        assert!(!stile.required);
        let ParamKind::Choice(scelte) = &stile.kind else {
            panic!("`stile` è una scelta: {:?}", stile.kind);
        };
        assert_eq!(
            scelte.iter().map(|c| c.value.as_str()).collect::<Vec<_>>(),
            ["corto", "lungo"],
            "le due scelte attraversano intere, valore e ordine"
        );
        assert!(
            scelte[1].title.as_literal() == Some("Lungo"),
            "col loro titolo: {:?}",
            scelte[1].title
        );
    })
    .expect("aperto");

    host.close();
}

/// Il comando che lavora: legge il vault attraverso il confine e risponde con un
/// effetto che nomina il documento e lo span.
#[test]
fn un_comando_di_un_componente_legge_e_risponde() {
    let v = Vault::nuovo();
    let host = banco(&v);

    let esito = invoca(&host, CONTA, serde_json::json!({}), InvokeMode::Apply)
        .expect("il comando risponde");

    let messaggio = esito.notify.expect("il comando dice qualcosa");
    assert_eq!(
        messaggio.as_literal(),
        Some(format!("{} caratteri", NOTA.chars().count()).as_str()),
        "ha letto la nota vera, non una risposta cablata"
    );
    assert_eq!(
        esito.effect,
        CommandEffect::Reveal {
            doc: DocId::new("Nota.md"),
            span: fub_abi::model::Span {
                start: 0,
                end: NOTA.len(),
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
fn lesito_completo_di_un_componente_torna_intero() {
    let v = Vault::nuovo();
    let host = banco(&v);

    let esito = invoca(
        &host,
        RICCO,
        serde_json::json!({ "quante": 3 }),
        InvokeMode::DryRun,
    )
    .expect("il comando risponde");

    assert_eq!(
        esito.notify.as_ref().and_then(|t| t.as_literal()),
        Some("dry-run"),
        "il modo è arrivato di là"
    );

    // Il piano. `docs` lo completa il kernel dagli edit, e qui coincide con
    // quello che il componente aveva già dichiarato: la prova è che l'edit
    // dentro sia quello scritto di là, non l'elenco.
    let CommandEffect::Plan(piano) = &esito.effect else {
        panic!("l'effetto è un piano: {:?}", esito.effect);
    };
    assert!(
        piano
            .summary
            .as_literal()
            .is_some_and(|s| s.starts_with("3 cose")),
        "il riassunto ha visto l'argomento: {:?}",
        piano.summary
    );
    assert_eq!(piano.docs, vec![DocId::new("Nota.md")]);
    assert_eq!(piano.edits.len(), 1);
    let modifica = &piano.edits[0];
    assert_eq!(modifica.doc, DocId::new("Nota.md"));
    assert!(
        !modifica.edit.base.0.is_empty(),
        "la revisione base viene dall'host, chiesta dal componente"
    );
    assert_eq!(modifica.edit.edits.len(), 1);
    assert_eq!(modifica.edit.edits[0].text, "<!-- proposta -->\n");
    assert_eq!(modifica.edit.edits[0].span.start, 0);
    assert_eq!(modifica.edit.edits[0].span.end, 0);

    // L'annullamento a passi: un `undo-step` che è un comando, cioè la variante
    // che porta dentro di sé un altro id e i suoi argomenti.
    let undo = esito
        .undo
        .as_ref()
        .expect("dichiara come si torna indietro");
    assert_eq!(undo.steps.len(), 1);
    let UndoStep::Command { command, args } = &undo.steps[0] else {
        panic!("il passo è un comando: {:?}", undo.steps[0]);
    };
    assert_eq!(command, CONTA);
    assert_eq!(args, &serde_json::json!({}));

    // Il parziale, col guasto dentro: un `plugin-error` annidato in un esito
    // riuscito, che è il caso che la traduzione degli errori non incontra mai
    // quando l'errore è il valore di ritorno.
    let parziale = esito.partial.as_ref().expect("il conto c'è");
    assert_eq!(parziale.attempted, 3);
    assert_eq!(parziale.done, 2);
    assert_eq!(parziale.failures.len(), 1);
    assert_eq!(
        parziale.failures[0].subject,
        Some(DocId::new("Nota.md")),
        "il guasto nomina il suo soggetto"
    );
    assert!(
        matches!(&parziale.failures[0].error, PluginError::Conflict(t)
            if t.as_literal() == Some("l'ultima non è andata")),
        "ed è un conflitto, non un `internal` generico: {:?}",
        parziale.failures[0].error
    );

    // Lo stesso comando in `Apply`: cambia una parola, e quella parola è il modo.
    let applicato = invoca(
        &host,
        RICCO,
        serde_json::json!({ "quante": 1 }),
        InvokeMode::Apply,
    )
    .expect("il comando risponde");
    assert_eq!(
        applicato.notify.as_ref().and_then(|t| t.as_literal()),
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
fn un_argomento_obbligatorio_che_manca_non_arriva_al_componente() {
    let v = Vault::nuovo();
    let host = banco(&v);

    let errore = invoca(&host, RICCO, serde_json::json!({}), InvokeMode::DryRun)
        .expect_err("senza `quante` il comando non si invoca");
    assert!(
        matches!(&errore, PluginError::BadArgs(t)
            if t.as_literal().is_some_and(|m| m.contains("quante"))),
        "il rifiuto nomina il parametro che manca: {errore}"
    );

    host.close();
}

/// Smontato il bundle, il provider se ne va con lui: il comando non esiste più.
///
/// È la stessa riga del gemello nativo, e prova la metà del quarto passo che
/// `register` da sola non prova — a togliere i provider è il kernel, che è
/// l'unico che li possiede (decisione 0031).
#[test]
fn smontato_il_componente_i_suoi_comandi_non_ci_sono_piu() {
    let v = Vault::nuovo();
    let host = banco(&v);

    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errori = s.bundles().write().unwrap().unmount(&mut ws, ID);
        assert!(errori.is_empty(), "niente è andato storto: {errori:?}");
        assert!(
            !ws.commands().iter().any(|c| c.id == CONTA),
            "il comando non è più nel registro"
        );
        let errore = ws
            .invoke_command(CONTA, serde_json::json!({}), InvokeMode::Apply, Actor::User)
            .expect_err("il comando non esiste più");
        assert!(
            matches!(errore, PluginError::UnknownCommand(_)),
            "è un comando sconosciuto: {errore}"
        );
    })
    .expect("aperto");

    host.close();
}
