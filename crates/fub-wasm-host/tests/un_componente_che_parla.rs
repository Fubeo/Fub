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

mod comune;

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
    fn nuovo() -> Self {
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
fn banco(v: &Vault) -> (Host, Subscription) {
    let wasm = comune::componente("eventi-wasm", "eventi_wasm", "");
    let bundle = WasmBundle::da_file(&wasm, Trust::Community).expect("il componente si carica");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(2);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    let eventi = host
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
    (host, eventi)
}

fn chiedi(host: &Host, job: &str) -> fub_abi::traits::JobId {
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
fn fino_a_fine(
    eventi: &Subscription,
    atteso: &str,
) -> (Vec<Event>, Result<serde_json::Value, PluginError>) {
    let scadenza = std::time::Instant::now() + Duration::from_secs(30);
    let mut visti: Vec<Event> = Vec::new();
    while std::time::Instant::now() < scadenza {
        let Ok(notice) = eventi.recv_timeout(Duration::from_millis(200)) else {
            continue;
        };
        if let Event::JobDone { job, result, .. } = &notice.event {
            if job == atteso {
                return (visti, result.clone());
            }
        }
        visti.push(notice.event);
    }
    panic!("il job `{atteso}` non è mai tornato. Intanto era arrivato: {visti:#?}");
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
fn un_componente_racconta_a_che_punto_e_e_cosa_e_successo() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v);

    let id = chiedi(&host, "racconta");
    let (visti, esito) = fino_a_fine(&eventi, "racconta");
    esito.expect("il job è riuscito");

    let progressi: Vec<_> = visti
        .iter()
        .filter_map(|e| match e {
            Event::JobProgress { id: j, progress } if *j == id => Some(progress),
            _ => None,
        })
        .collect();
    assert_eq!(
        progressi.len(),
        2,
        "i due `report-progress` del componente sono arrivati tutti e due: {visti:#?}"
    );
    assert_eq!(progressi[0].done, 1);
    assert_eq!(progressi[0].total, Some(3));
    assert_eq!(progressi[0].label.as_deref(), Some("il primo passo"));
    assert_eq!(progressi[1].done, 3);
    assert_eq!(progressi[1].label.as_deref(), Some("l'ultimo passo"));

    let detto = visti
        .iter()
        .find_map(|e| match e {
            Event::Custom { topic, payload } if topic == "demo.eventi:detto" => Some(payload),
            _ => None,
        })
        .unwrap_or_else(|| panic!("l'evento del componente non è sul bus: {visti:#?}"));
    assert_eq!(
        detto["passi"], 3,
        "il payload è quello che il componente ha scritto, riportato a JSON: {detto}"
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
fn un_componente_chiede_un_lavoro_e_il_lavoro_parla() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v);

    chiedi(&host, "genera");
    let (mut visti, esito) = fino_a_fine(&eventi, "genera");
    let valore = esito.expect("il job è riuscito");
    let figlio = valore["figlio"]
        .as_u64()
        .unwrap_or_else(|| panic!("il componente ha restituito l'id del figlio: {valore}"));

    // Le due finestre d'ascolto si sommano, e la ragione è una proprietà del
    // kernel che vale la pena aver visto: il `job-started` del figlio arriva
    // **prima** del `job-done` del padre. «Accettato» non vuol dire «partito»
    // — lo emette chi mette in coda, cioè lo `spawn-job` di dentro il padre —
    // ed è la stessa cosa che rende innocua la rientranza: se quell'evento
    // arrivasse dopo, vorrebbe dire che qualcuno ha eseguito il figlio prima di
    // rendere il controllo al padre, cioè dentro l'istanza che il padre teneva.
    //
    // Da qui in poi il figlio è già in coda: si ascolta finché non torna. Con
    // due thread nel pool è il caso della rientranza — il secondo thread lo ha
    // preso mentre il padre teneva ancora l'istanza — e arrivare in fondo è
    // esattamente ciò che si voleva sapere.
    let (coda, esito) = fino_a_fine(&eventi, "figlio");
    visti.extend(coda);
    let valore = esito.expect("il figlio è riuscito");
    assert_eq!(valore["chi"], "figlio");

    assert!(
        visti.iter().any(|e| matches!(
            e,
            Event::JobStarted { id, job } if id.0 == figlio && job == "figlio"
        )),
        "il job accettato porta l'identità che il componente ha ricevuto ({figlio}): {visti:#?}"
    );
    assert!(
        visti.iter().any(|e| matches!(
            e,
            Event::Custom { topic, .. } if topic == "demo.eventi:nato"
        )),
        "il figlio ha parlato dall'interno del proprio giro: {visti:#?}"
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
fn un_evento_che_non_si_traduce_diventa_un_guasto_e_non_un_silenzio() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v);

    chiedi(&host, "spazzatura");
    let (visti, esito) = fino_a_fine(&eventi, "spazzatura");
    esito.expect("il job in sé è riuscito: a non attraversare è stato l'evento");

    let guasto = visti
        .iter()
        .find_map(|e| match e {
            Event::Trouble {
                severity, error, ..
            } => Some((severity, error)),
            _ => None,
        })
        .unwrap_or_else(|| panic!("la perdita non è stata raccontata: {visti:#?}"));
    assert_eq!(
        *guasto.0,
        Severity::Failure,
        "ciò che si è perso non si ricostruisce riaprendo il vault"
    );
    assert!(
        matches!(guasto.1, PluginError::BadArgs(t)
            if t.as_literal().is_some_and(|m| m.contains("evento non emesso"))),
        "il guasto dice cosa non è uscito: {:?}",
        guasto.1
    );
    assert!(
        !visti
            .iter()
            .any(|e| matches!(e, Event::Custom { topic, .. } if topic == "demo.eventi:rotto")),
        "l'evento col payload rotto non è stato consegnato a nessuno: {visti:#?}"
    );

    host.close();
}
