//! **Il tempo e la memoria di un componente, quando di là non collabora
//! nessuno.**
//!
//! `il_primo_componente.rs` prova che il contratto si attraversa e che il
//! cancello del §7.3 si chiude: tutt'e due con un plugin che si comporta bene.
//! Questo file prova la cosa che quello non può provare, ed è il buco che la
//! [0164](../../../docs/decisions/0164-il-secondo-backend-una-interfaccia-alla-volta.md)
//! aveva dichiarato per nome — «*l'interruzione a epoche e i limiti di memoria*
//! […] *un componente lento o ostile non viene ancora interrotto*».
//!
//! # Perché ci vogliono due componenti, non uno
//!
//! Un presidio che vede solo il ciclo infinito fermarsi non distingue «l'host
//! interrompe l'ostile» da «l'host interrompe tutto»: un `set_epoch_deadline`
//! sbagliato che abbatte ogni chiamata dopo cinque secondi dalla nascita
//! dell'istanza passerebbe quel presidio a occhi chiusi. Quindi nello stesso
//! host, sullo stesso pool con **un thread solo**, ci stanno due plugin:
//! `demo.ciclo`, che non torna, e `demo.ping` — lo stesso di
//! `il_primo_componente.rs`, compilato e montato uguale — che non deve
//! accorgersi di niente. Che il ping risponda *dopo* che il ciclo è stato
//! fermato è la prova doppia: i limiti non lo hanno disturbato, e il thread del
//! job non è rimasto appeso.
//!
//! # Il componente lo compila il test
//!
//! Come là, e per la stessa ragione: un test che si salta da solo quando il
//! file non c'è è un test che un giorno non gira più e nessuno se ne accorge.

mod common;

use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::event::Event;
use fub_abi::traits::{JobId, JobSpec};
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust};
use fub_wasm_host::WasmBundle;

/// Il plugin che non collabora: `esempi/ciclo-wasm`.
const CYCLE: &str = "demo.ciclo";
/// Il plugin che si comporta bene: `esempi/ping-wasm`, lo stesso di M5.
const PING: &str = "demo.ping";

/// Quanto aspettiamo un esito prima di dichiarare la coda ferma.
///
/// Deve stare **sopra** la scadenza di `crate::limiti` (≈5 s) e sotto la
/// pazienza di chi guarda una CI: se il ciclo non venisse interrotto, questo è
/// il tempo dopo il quale il test lo dice invece di restare appeso per sempre.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Il `.wasm` del plugin che non collabora.
fn cycle() -> Utf8PathBuf {
    common::component("ciclo-wasm", "ciclo_wasm", "")
}

/// Il `.wasm` del plugin che si comporta bene: lo stesso ping di M5, e lo
/// stesso artefatto che gli altri presidi montano.
fn ping() -> Utf8PathBuf {
    common::ping("")
}

// --- il banco ---------------------------------------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        Vault { _dir: dir, root }
    }
}

/// Un host headless con il vault aperto e i componenti di `wasm` montati.
///
/// **Un thread di job solo**, e non è una svista: è la condizione in cui il
/// difetto che stiamo presidiando si vede. Con due thread un ciclo infinito
/// lascerebbe l'altro libero, il ping risponderebbe lo stesso, e il test sarebbe
/// verde anche senza una riga di `limiti.rs`.
fn bench(v: &Vault, wasm: &[Utf8PathBuf]) -> (Host, Subscription) {
    let bundle: Vec<WasmBundle> = wasm
        .iter()
        .map(|w| WasmBundle::from_file(w, Trust::Community).expect("il componente si carica"))
        .collect();

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let mut registry = s.bundles().write().unwrap();
        for b in &bundle {
            registry.mount(b, &mut ws).expect("il bundle si monta");
        }
    })
    .expect("aperto");
    (host, events)
}

fn ask(host: &Host, plugin: &str, job: &str) -> JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(plugin, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

/// L'esito **di quel job**, e quanto ci ha messo ad arrivare.
///
/// L'id e non il nome: in questo banco ci sono due plugin, e un presidio che
/// riconoscesse il job dal nome sarebbe un presidio che il giorno in cui i due
/// hanno un job omonimo guarda la risposta sbagliata. Il tempo torna insieme
/// all'esito perché **è metà della prova**: che un job sia finito non dice se
/// l'ha fermato la scadenza o il tetto, e la differenza si legge sull'orologio.
fn outcome(
    events: &Subscription,
    expected: JobId,
) -> (Result<serde_json::Value, PluginError>, Duration) {
    let start = Instant::now();
    while start.elapsed() < TIMEOUT {
        if let Ok(notice) = events.recv_timeout(Duration::from_millis(50)) {
            if let Event::JobDone { id, result, .. } = notice.event {
                if id == expected {
                    return (result, start.elapsed());
                }
            }
        }
    }
    panic!("job {expected:?} never returned: either nobody drains it, or nobody stops it");
}

/// Il testo di un errore che ci aspettiamo essere un guasto del componente.
fn crashed(error: &PluginError) -> String {
    match error {
        PluginError::Internal(t) => t
            .as_literal()
            .map(str::to_string)
            .unwrap_or_else(|| format!("{error}")),
        other => panic!("un trap arriva al contratto come `internal`, non come {other:?}"),
    }
}

// --- le prove ---------------------------------------------------------------

/// **Un componente che non torna viene fermato, e l'host resta vivo.**
///
/// Il giro è di quattro passi sullo stesso pool a un thread, e ognuno dice una
/// cosa che gli altri non dicono:
///
/// 1. `eco` sul plugin ostile torna subito — i limiti sono armati su
///    *quell'istanza* e non le danno fastidio.
/// 2. `ciclo` non torna mai, e l'host lo ferma: un `internal`, dopo un tempo
///    che è quello della scadenza e non zero.
/// 3. il ping — un altro componente, un'altra istanza — risponde ancora: il
///    thread del job è tornato libero, e il vault si legge come prima.
/// 4. il plugin fermato resta fermato: la sua istanza ha trappato, e il modello
///    dei componenti non fa rientrare in un'istanza che ha trappato.
#[test]
fn a_component_that_not_returns_becomes_stopped_and_the_host_remains_live() {
    let v = Vault::new();
    let (host, events) = bench(&v, &[cycle(), ping()]);

    // 1. Lo stesso componente, un job che torna: i limiti non sono una tassa su
    //    chi si comporta bene.
    let id = ask(&host, CYCLE, "eco");
    let (echo_outcome, amount) = outcome(&events, id);
    assert_eq!(
        echo_outcome.expect("un job che torna, torna")["eco"],
        serde_json::json!(true)
    );
    assert!(
        amount < Duration::from_secs(2),
        "un job che torna subito torna subito: {amount:?}"
    );

    // 2. Il ciclo infinito. Il componente non chiama nessuno e non alloca
    //    niente: la sola cosa che lo raggiunge è il controllo dell'epoca che
    //    cranelift ha infilato nel suo `loop`.
    let id = ask(&host, CYCLE, "ciclo");
    let (cycle_outcome, amount) = outcome(&events, id);
    let error = cycle_outcome.expect_err("un ciclo infinito non riesce");
    let said = crashed(&error);

    // Il messaggio che l'utente riceve. Quello che wasmtime dà da sé era:
    //
    //     il componente è crashed: error while executing at wasm backtrace:
    //         0:   0x3513 - <unknown>!<wasm function 30>: wasm trap: interrupt
    //
    // cioè la parola «interrupt», che non dice che il plugin è stato fermato
    // perché non rispondeva e non si distingue da un `unwrap` di là dal confine.
    // `componente::guasto` riconosce quella trap — è l'unica che **non** è del
    // componente, perché è l'host ad averla causata — e la nomina. Il presidio
    // sta sulla frase, non sul tipo: è la frase che qualcuno leggerà.
    assert!(
        said.contains("entro il tempo concesso"),
        "la scadenza arriva al contratto detta com'è, non come `interrupt`: {said}"
    );

    // Il tempo è la seconda metà dell'asserzione. Senza, un componente che
    // fallisse subito per un'altra ragione qualsiasi — un import non servito,
    // un'istanza già morta — passerebbe questo test.
    assert!(
        amount >= Duration::from_secs(4),
        "il ciclo ha girato fin quasi alla scadenza, non è crashed subito: {amount:?}"
    );
    assert!(
        amount < Duration::from_secs(15),
        "la scadenza è ≈5 s e questa non è: {amount:?}"
    );

    // 3. La prova che l'host è sano: un altro componente, sullo stesso thread di
    //    job che il ciclo teneva un istante fa, legge il vault e risponde.
    let id = ask(&host, PING, "ping");
    let (ping_outcome, amount) = outcome(&events, id);
    let value = ping_outcome.expect("il ping non è stato disturbato dai limiti");
    assert_eq!(value["nota"], "Nota.md");
    assert!(
        value["caratteri"].as_u64().unwrap() > 0,
        "il ping ha letto davvero attraverso il confine: {value}"
    );
    assert!(
        amount < Duration::from_secs(2),
        "il ping risponde subito: il thread del job non è rimasto appeso ({amount:?})"
    );

    // 4. Chi ha trappato resta trappato. È la regola di rientranza del modello
    //    dei componenti — wasmtime non lascia rientrare in un'istanza che ha
    //    trappato — ed è la regola giusta: un'istanza interrotta a metà di una
    //    funzione ha uno stato che nessuno sa più descrivere. Il plugin è morto,
    //    l'host no, ed è esattamente la separazione che questo file presidia.
    let id = ask(&host, CYCLE, "eco");
    let (after, _) = outcome(&events, id);
    let said = crashed(&after.expect_err("un'istanza che ha trappato non risponde più"));
    assert!(
        said.contains("cannot enter component instance"),
        "il componente fermato non riparte da solo: {said}"
    );

    host.close();
}

/// **Un componente che divora memoria trova il tetto**, e lo trova prima della
/// scadenza.
///
/// Il job `mangia` chiede 1 MiB per volta e non smette mai da sé: si ferma
/// quando `memory.grow` dice di no, e risponde **quanti morsi** aveva ottenuto
/// fino a lì. Quel numero è il tetto di `limiti.rs` misurato dal di dentro, ed è
/// il modo più diretto di provarlo che esista: senza `StoreLimits` il ciclo
/// arriverebbe ai 4 GiB del bersaglio, cioè alla RAM della macchina — e quando
/// finisce quella, il messaggio parla del processo, non del plugin.
///
/// Che il rifiuto torni come **valore** e non come trap è la stessa scelta di
/// `trappable_imports` spento (0164), portata sulla memoria: l'host lascia
/// spento `trap_on_grow_failure`, `memory.grow` restituisce `-1` come dice la
/// specifica, e un plugin che sa leggerlo resta vivo per raccontarlo. Questo
/// job è il plugin che lo sa leggere; il suo gemello che non lo sa — l'allocatore
/// di default di Rust — aborta, ed è un trap una riga dopo.
///
/// L'orologio è la seconda metà della prova. Il ciclo di allocazione ha un giro
/// di ciclo come quello del job `ciclo`, e quindi **anche la scadenza lo
/// fermerebbe**, cinque secondi dopo. Se il job torna in meno di due, a fermarlo
/// è stato il tetto — è l'unica delle due cose che sa arrivare così in fretta.
#[test]
fn a_component_that_devours_memory_finds_the_ceiling() {
    let v = Vault::new();
    let (host, events) = bench(&v, &[cycle()]);

    let id = ask(&host, CYCLE, "mangia");
    let (answer, amount) = outcome(&events, id);
    let value = answer.expect("chi legge il rifiuto di `memory.grow` resta vivo per dirlo");
    let mib = value["mib"]
        .as_u64()
        .unwrap_or_else(|| panic!("il job dice quanto ha ottenuto: {value}"));

    // Il tetto è 64 MiB, e ogni morso è 1 MiB: il plugin non può averne avuti di
    // più, per quanto insista. Il limite inferiore serve all'altra metà — un
    // tetto che concedesse quattro morsi sarebbe un tetto sbagliato, e un test
    // che guardasse solo il massimo lo direbbe verde. Misurato oggi: **62**, e i
    // due MiB che mancano sono il componente stesso — il suo modulo, il suo
    // stack, l'arena dell'allocatore — che nel tetto ci stanno dentro, perché il
    // tetto è la memoria lineare e non l'avanzo.
    assert!(
        (16..=64).contains(&mib),
        "il plugin ha preso {mib} MiB: il tetto dichiarato è 64 MiB, e sotto i 16 non ci si lavora"
    );
    assert!(
        amount < Duration::from_secs(2),
        "a fermarlo è stato il tetto e non la scadenza: {amount:?}"
    );

    // E il plugin è ancora vivo: non ha trappato, ha solo finito lo spazio.
    // L'istanza però la memoria non l'ha restituita — non lo fa nessuno, in
    // wasm: la memoria lineare non si accorcia — quindi il secondo giro trova
    // il tetto dov'era, e non ne ottiene più.
    let id = ask(&host, CYCLE, "mangia");
    let (still, _) = outcome(&events, id);
    assert_eq!(
        still.expect("il plugin è ancora vivo")["mib"],
        serde_json::json!(0),
        "la memoria lineare non torna indietro: il secondo giro non ottiene niente"
    );

    host.close();
}
