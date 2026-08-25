//! **Un componente che dice qualcosa di propria iniziativa.**
//!
//! `il_primo_componente.rs` prova il verso normale: si chiama il guest, il guest
//! chiede all'host, l'host risponde. Qui il verso è rovesciato — è `host-events`,
//! la famiglia con cui un plugin parla **mentre** lo stanno chiamando — e la
//! prova non può essere il valore di ritorno del job: un job che tornasse
//! dicendo «ho emesso» proverebbe solo che ha eseguito una riga. Ciò che si
//! asserisce qui è che l'evento **è arrivato dall'altra parte**, cioè sul bus
//! della sessione, con dentro ciò che il componente ci ha messo.
//!
//! # Il componente lo compila il test
//!
//! Come per il ping: `esempi/eventi-wasm` sta fuori dal workspace e si compila
//! per `wasm32-wasip2`. Il test invoca `cargo` da sé invece di cercare un
//! artefatto che qualcun altro dovrebbe aver prodotto — un test che si salta da
//! solo quando il file non c'è è un test che un giorno non gira più e nessuno se
//! ne accorge. Se il bersaglio manca, il fallimento dice come installarlo.
//!
//! # Due thread, di proposito
//!
//! Il banco dà al pool **due** thread e non uno, e la ragione è la rientranza.
//! L'istanza WASM sta dietro un `Mutex` (vedi `WasmPlugin`), e uno `spawn-job`
//! chiesto da dentro un job dello stesso plugin mette in coda un lavoro che
//! finirà sulla **stessa** istanza. Con un thread solo quel caso non si
//! presenterebbe mai; con due, il secondo thread prende il figlio mentre il
//! padre tiene ancora il lucchetto — e ciò che si vuole vedere è che aspetta e
//! poi gira, non che si ferma per sempre. `spawn-job` accoda e non esegue: è la
//! proprietà su cui questo test poggia, e se un giorno smettesse di valere è
//! qui che il verde diventa un timeout.

mod common;

use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::event::{Event, Severity};
use fub_abi::traits::JobSpec;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust};
use fub_wasm_host::WasmBundle;

const ID: &str = "demo.eventi";

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

/// Un host headless col vault aperto, il componente montato e **l'orecchio già
/// attaccato al bus**.
///
/// L'abbonamento si prende prima del montaggio di proposito: ciò che si vuole
/// leggere sono eventi che nascono più tardi, ma un abbonamento preso dopo
/// perderebbe in silenzio tutto ciò che è successo nel mezzo, e un test che
/// perde eventi in silenzio è il test sbagliato per una voce che parla di
/// eventi.
fn bench(v: &Vault) -> (Host, Subscription) {
    let wasm = common::component("eventi-wasm", "eventi_wasm", "");
    let bundle = WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(2);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(&bundle, &mut ws)
            .expect("il bundle si monta");
    })
    .expect("aperto");
    (host, events)
}

fn ask(host: &Host, job: &str) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!({ "da": "il banco" }),
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

/// Ascolta finché **quel** job non è tornato, e rende tutto ciò che ha sentito
/// per strada.
///
/// Gli eventi di mezzo sono la sostanza del test, non un contorno: sono l'unica
/// forma in cui la parola di un componente arriva fin qui. Il `JobDone` è solo
/// il momento in cui si può smettere di ascoltare senza rischiare di aver
/// chiuso troppo presto.
fn until_end(
    events: &Subscription,
    expected: &str,
) -> (Vec<Event>, Result<serde_json::Value, PluginError>) {
    let expiration = std::time::Instant::now() + Duration::from_secs(30);
    let mut seen: Vec<Event> = Vec::new();
    while std::time::Instant::now() < expiration {
        let Ok(notice) = events.recv_timeout(Duration::from_millis(200)) else {
            continue;
        };
        if let Event::JobDone { job, result, .. } = &notice.event {
            if job == expected {
                return (seen, result.clone());
            }
        }
        seen.push(notice.event);
    }
    panic!("il job `{expected}` non è mai tornato. Intanto era arrivato: {seen:#?}");
}

// --- le prove ---------------------------------------------------------------

/// **Il progresso e l'evento attraversano**, dentro lo stesso job.
///
/// Le due capacità senza esito del contratto, sullo stesso giro: il componente
/// dice due volte a che punto è e una volta che è successa una cosa, e tutt'e
/// tre le frasi compaiono sul bus della sessione. Che il `job-progress` porti
/// l'`id` **giusto** è metà del punto: un job non conosce la propria identità,
/// quindi quel numero non può venire dal componente — lo mette l'host che lo
/// sta eseguendo, ed è la ragione per cui `report-progress` non ha un parametro
/// per l'id.
#[test]
fn a_component_reports_a_that_point_and_and_what_and_success() {
    let v = Vault::new();
    let (host, events) = bench(&v);

    let id = ask(&host, "racconta");
    let (seen, outcome) = until_end(&events, "racconta");
    outcome.expect("il job è riuscito");

    let progress: Vec<_> = seen
        .iter()
        .filter_map(|and| match and {
            Event::JobProgress { id: j, progress } if *j == id => Some(progress),
            _ => None,
        })
        .collect();
    assert_eq!(
        progress.len(),
        2,
        "i due `report-progress` del componente sono arrivati tutti e due: {seen:#?}"
    );
    assert_eq!(progress[0].done, 1);
    assert_eq!(progress[0].total, Some(3));
    assert_eq!(progress[0].label.as_deref(), Some("il primo passo"));
    assert_eq!(progress[1].done, 3);
    assert_eq!(progress[1].label.as_deref(), Some("l'ultimo passo"));

    let said = seen
        .iter()
        .find_map(|and| match and {
            Event::Custom { topic, payload } if topic == "demo.eventi:detto" => Some(payload),
            _ => None,
        })
        .unwrap_or_else(|| panic!("l'evento del componente non è sul bus: {seen:#?}"));
    assert_eq!(
        said["passi"], 3,
        "il payload è quello che il componente ha scritto, riportato a JSON: {said}"
    );

    host.close();
}

/// **Un componente chiede un altro lavoro, e quel lavoro gira davvero.**
///
/// È la sola delle tre capacità con un esito, e l'esito è un'identità: il
/// componente la restituisce nel proprio risultato, e il test la ritrova nel
/// `job-started` che il kernel ha emesso. I due numeri che coincidono sono la
/// prova che `spawn-job` ha attraversato — non un `Ok(())` che si poteva
/// inventare.
///
/// Il figlio poi si annuncia con un `emit` suo, e serve: senza, «il job è
/// partito» resterebbe una parola dell'host, mentre quell'evento è il
/// componente che parla dall'interno del lavoro che ha chiesto lui.
#[test]
fn a_component_asks_a_work_and_the_work_speaks() {
    let v = Vault::new();
    let (host, events) = bench(&v);

    ask(&host, "genera");
    let (mut seen, outcome) = until_end(&events, "genera");
    let value = outcome.expect("il job è riuscito");
    let child = value["figlio"]
        .as_u64()
        .unwrap_or_else(|| panic!("il componente ha restituito l'id del figlio: {value}"));

    // `spawn-job` pubblica `JobStarted` mentre il padre è ancora nel guest, ma
    // i due `JobDone` non hanno un ordine contrattuale. `Shared::run` lascia
    // l'istanza del plugin quando `outcome` torna e pubblica il completamento
    // del padre subito dopo; in quella finestra il secondo worker può eseguire
    // e completare il figlio. Su una macchina veloce, quindi, il primo
    // `until_end` può aver già raccolto anche il suo `JobDone`.
    //
    // Si accettano entrambi gli intrecci reali: se l'esito è già fra gli eventi
    // osservati lo si usa; altrimenti si continua ad ascoltare. Le asserzioni
    // sotto restano quelle sostanziali — identità, avvio ed evento emesso
    // dall'interno del figlio — senza trasformare il test in un retry.
    let outcome = seen.iter().find_map(|and| match and {
        Event::JobDone { job, result, .. } if job == "figlio" => Some(result.clone()),
        _ => None,
    });
    let outcome = match outcome {
        Some(outcome) => outcome,
        None => {
            let (queue, outcome) = until_end(&events, "figlio");
            seen.extend(queue);
            outcome
        }
    };
    let value = outcome.expect("il figlio è riuscito");
    assert_eq!(value["chi"], "figlio");

    assert!(
        seen.iter().any(|and| matches!(
            and,
            Event::JobStarted { id, job } if id.0 == child && job == "figlio"
        )),
        "il job accettato porta l'identità che il componente ha ricevuto ({child}): {seen:#?}"
    );
    assert!(
        seen.iter().any(|and| matches!(
            and,
            Event::Custom { topic, .. } if topic == "demo.eventi:nato"
        )),
        "il figlio ha parlato dall'interno del proprio giro: {seen:#?}"
    );

    host.close();
}

/// **Un evento che non attraversa non sparisce in silenzio.**
///
/// `emit` è l'unica capacità del contratto senza esito, quindi quando il
/// payload di un `custom` non è JSON l'host non ha modo di dirlo *a chi ha
/// emesso*. Ha però il canale dei guasti (decisione 0052), e ci passa: sul bus
/// arriva un `trouble` che nomina la perdita, e l'evento rotto non arriva
/// affatto. Le due asserzioni sono una sola cosa detta nei due versi — ciò che
/// non si può tradurre non si consegna, e non si tace.
#[test]
fn a_event_that_not_is_translates_becomes_a_fault_and_not_a_silence() {
    let v = Vault::new();
    let (host, events) = bench(&v);

    ask(&host, "spazzatura");
    let (seen, outcome) = until_end(&events, "spazzatura");
    outcome.expect("il job in sé è riuscito: a non attraversare è stato l'evento");

    let failure = seen
        .iter()
        .find_map(|and| match and {
            Event::Trouble {
                severity, error, ..
            } => Some((severity, error)),
            _ => None,
        })
        .unwrap_or_else(|| panic!("la perdita non è stata raccontata: {seen:#?}"));
    assert_eq!(
        *failure.0,
        Severity::Failure,
        "ciò che si è perso non si ricostruisce riaprendo il vault"
    );
    assert!(
        matches!(failure.1, PluginError::BadArgs(t)
            if t.as_literal().is_some_and(|m| m.contains("evento non emesso"))),
        "il guasto dice cosa non è uscito: {:?}",
        failure.1
    );
    assert!(
        !seen
            .iter()
            .any(|and| matches!(and, Event::Custom { topic, .. } if topic == "demo.eventi:rotto")),
        "l'evento col payload rotto non è stato consegnato a nessuno: {seen:#?}"
    );

    host.close();
}
