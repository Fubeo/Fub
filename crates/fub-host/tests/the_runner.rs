//! **Chi esegue il lavoro lungo** (§9.3, decisione 0032): il pool che drena la
//! coda, la cancellazione che non aggiunge capacità, e il panico che costa il
//! job.
//!
//! Il giro `spawn_job` → `run_job` → `JobDone` era coperto da un test del kernel
//! fin dalla 0027, ma **con il test come unico esecutore**: era il test a
//! drenare la coda e a chiamare `run_job`. Qui non lo fa nessuno — si accoda e
//! basta, come fa una feature — e ciò che si prova è che qualcun altro se ne
//! accorge.
//!
//! Le prove usano una barriera a due tempi (`Passi`) invece di dormire: un job
//! dice «sono partito» e aspetta il via, e il test intanto fa la sua mossa. Un

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::{
    HostApi, HostEvents, IndexQuery, IndexResult, JobProgress, JobSpec, JobStatus, Plugin,
    PluginManifest, TimerSchedule, TimerSpec,
};
use fub_abi::{Event, PluginError};
use fub_host::registry::Bundle;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust};

const SPY: &str = "test.lavoratore";

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

/// Una barriera a due tempi: il job dice dove è arrivato, il test gli dà il via.
#[derive(Clone)]
struct Steps {
    arrived: Sender<String>,
    via: Arc<Mutex<Receiver<()>>>,
}

struct Conductor {
    arrivals: Receiver<String>,
    via: Sender<()>,
}

fn steps() -> (Steps, Conductor) {
    let (arrived, arrivals) = channel();
    let (via_tx, via_rx) = channel();
    (
        Steps {
            arrived,
            via: Arc::new(Mutex::new(via_rx)),
        },
        Conductor {
            arrivals,
            via: via_tx,
        },
    )
}

impl Steps {
    fn mark(&self, marker: &str) {
        let _ = self.arrived.send(marker.to_string());
    }

    fn waits_the_via(&self) {
        let _ = self.via.lock().unwrap().recv();
    }
}

impl Conductor {
    fn waits(&self, expected: &str) {
        let marker = self
            .arrivals
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("nobody arrived at `{expected}`"));
        assert_eq!(marker, expected);
    }

    fn via(&self) {
        let _ = self.via.send(());
    }
}

// --- un bundle che ha dei job ------------------------------------------------

/// Il plugin di prova: quattro job, uno per ogni cosa da provare.
struct Worker {
    steps: Steps,
}

impl Plugin for Worker {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(SPY, "Lavoratore")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    /// Il commiato si **annuncia** come un passo del job, sullo stesso canale:
    /// «è stato chiamato» e «non è stato chiamato» sono la stessa domanda fatta
    /// a due tempi diversi, e un banco che le legga da due posti diversi non
    /// può dire quale è venuto prima.
    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.steps.mark("congedato");
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            // Vede il vault, e lo dice scrivendoci.
            "scrivi" => {
                let which = payload["nota"].as_str().unwrap_or("Job.md");
                host.create_document(&DocId::new(which), "# fatto da un job\n")?;
                Ok(serde_json::json!({ "scritta": which }))
            }
            // Scrive una volta, aspetta il via, e poi ci riprova: la seconda
            // volta è dove si vede l'annullamento.
            "due-volte" => {
                host.create_document(&DocId::new("Prima.md"), "# prima\n")?;
                self.steps.mark("ha scritto la prima");
                self.steps.waits_the_via();
                host.create_document(&DocId::new("Seconda.md"), "# seconda\n")?;
                Ok(serde_json::json!("due"))
            }
            // Non tocca mai l'host: è il limite dichiarato della cancellazione.
            "puro" => {
                self.steps.mark("sta calcolando");
                self.steps.waits_the_via();
                Ok(serde_json::json!(40 + 2))
            }
            // **Si racconta** (§10.3): tre passi, e a ogni passo dice a che
            // punto è. Non nomina sé stesso — non conosce il proprio id — e
            // aspetta il via fra un passo e l'altro perché il test possa
            // guardarlo mentre è vivo.
            "racconta" => {
                for step in 1..=3u64 {
                    host.report_progress(JobProgress {
                        done: step,
                        total: Some(3),
                        label: Some(format!("passo {step}")),
                    });
                    self.steps.mark(&format!("ha detto {step}"));
                    self.steps.waits_the_via();
                }
                Ok(serde_json::json!("raccontato"))
            }
            // **Esce solo se qualcuno gli dice di no.** Non aspetta un via dal
            // banco: chiede all'host, e richiede, finché l'host non lo rifiuta.
            // È la forma con cui si costruisce (invece di aspettarla) la corsa
            // fra un job in volo e lo spegnimento del suo componente — il job è
            // dentro `run_job` finché lo spegnimento non è deciso, e non per un
            // tempo che il banco spera sia abbastanza.
            //
            // La scadenza non è un'attesa: è la rete che fa **fallire** un banco
            // rotto invece di lasciarlo appeso.
            "insiste" => {
                self.steps.mark("is inside");
                let expiration = std::time::Instant::now() + Duration::from_secs(5);
                loop {
                    host.random_bytes(1)?;
                    assert!(
                        std::time::Instant::now() < expiration,
                        "nobody ever said no to this job"
                    );
                }
            }
            "esplodi" => panic!("the job exploded"),
            other => Err(PluginError::UnknownJob(other.into())),
        }
    }
}

struct BundleWorker {
    steps: Steps,
}

impl Bundle for BundleWorker {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(SPY, "Lavoratore")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Worker {
            steps: self.steps.clone(),
        })
    }

    fn register(&self, _ws: &mut fub_kernel::Workspace) -> Vec<String> {
        Vec::new()
    }
}

/// Un host headless con un vault aperto, il bundle di prova montato e **un solo
/// thread** nel pool: un thread solo rende osservabile l'ordine.
fn bench(v: &Vault, steps: &Steps) -> (Host, Subscription) {
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    // **Si aspetta che l'apertura abbia finito di indicizzare** (§15.7) prima
    // di guardare qualunque cosa. La seconda fase dell'apertura è un job come
    // gli altri — ha un id, compare fra i vivi, racconta un progresso — e su un
    // banco a un thread solo occupa anche l'unico turno disponibile. Senza
    // questa riga ogni presidio del pool conterebbe un lavoro in più e
    // aspetterebbe il proprio dietro a uno che non ha chiesto.
    host.wait_indexed(None).expect("l'apertura ha finito");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(
                &BundleWorker {
                    steps: steps.clone(),
                },
                &mut ws,
            )
            .expect("il bundle si mount");
    })
    .expect("aperto");
    (host, events)
}

/// Accoda un job come lo accoderebbe una feature: dall'`HostApi`, e basta.
fn ask(host: &Host, job: &str, payload: serde_json::Value) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(SPY, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload,
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

/// Il primo `JobDone` che arriva, o il fallimento del test.
fn outcome(events: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
    let expiration = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < expiration {
        match events.recv_timeout(Duration::from_millis(200)) {
            Ok(notice) => {
                if let Event::JobDone { job, result, .. } = notice.event {
                    return (job, result);
                }
            }
            Err(_) => continue,
        }
    }
    panic!("no job ever returned: nobody drains the queue");
}

// --- le prove ---------------------------------------------------------------

/// Il fatto nuovo, e da solo vale la voce: **la coda la drena qualcuno**. Prima
/// `spawn_job` accodava e il job restava lì per sempre.
#[test]
fn a_job_queued_part_from_only_and_sees_the_vault() {
    let v = Vault::new();
    let (steps, _regia) = steps();
    let (host, events) = bench(&v, &steps);

    ask(&host, "scrivi", serde_json::json!({ "nota": "Done.md" }));

    let (job, result) = outcome(&events);
    assert_eq!(job, "scrivi");
    assert_eq!(
        result.expect("the job succeeded"),
        serde_json::json!({ "scritta": "Done.md" })
    );
    assert!(
        v.root.join("Done.md").exists(),
        "the job wrote to the vault for real, not in its own world"
    );
    host.close();
}

/// **La cancellazione non aggiunge nessuna capacità**: il job non controlla
/// niente: è il suo host che smette di servirlo, e la seconda scrittura riceve
/// `Cancelled` invece di avvenire.
#[test]
fn a_job_cancelled_receives_refusals_to_the_call_next() {
    let v = Vault::new();
    let (steps, regia) = steps();
    let (host, events) = bench(&v, &steps);

    let id = ask(&host, "due-volte", serde_json::json!(null));
    regia.waits("ha scritto la prima");
    host.cancel_job(None, id).expect("annullato");
    regia.via();

    let (_, result) = outcome(&events);
    let error = result.expect_err("un job annullato non arriva in fondo");
    assert!(
        matches!(error, PluginError::Cancelled(_)),
        "the outcome says it was **cancelled**, not that it failed: {error}"
    );
    assert!(
        v.root.join("Prima.md").exists(),
        "what it had already done stays done: cancelling is not undoing effects"
    );
    assert!(
        !v.root.join("Seconda.md").exists(),
        "and what it tried to do after did not happen"
    );
    host.close();
}

/// **Il limite, dichiarato.** Un job che non chiama mai l'host non lo si può
/// fermare: non c'è niente da rifiutargli, e in Rust un thread non si uccide.
#[test]
fn a_job_pure_that_not_calls_never_the_host_arrives_in_end_anyway() {
    let v = Vault::new();
    let (steps, regia) = steps();
    let (host, events) = bench(&v, &steps);

    let id = ask(&host, "puro", serde_json::json!(null));
    regia.waits("sta calcolando");
    host.cancel_job(None, id).expect("annullato");
    regia.via();

    let (_, result) = outcome(&events);
    assert_eq!(
        result.expect("a pure calculation has nothing to have refused"),
        serde_json::json!(42),
        "cancellation is cooperative because it cannot be anything else"
    );
    host.close();
}

/// **Spegnere un componente aspetta i suoi job, e poi lo congeda.**
///
/// È il difetto scritto al contrario. Chi esegue un job tiene una copia del
/// bundle finché il job dura (`BundleRegistry::body` rende un `Arc`), e
/// `Plugin::deactivate` vuole essere solo: spegnere un componente dalle
/// impostazioni mentre un suo job è in volo non chiamava il commiato affatto —
/// lo diceva in un errore, e il bundle veniva smontato lo stesso. Il plugin
/// perdeva l'unico momento in cui può lasciar andare ciò che tiene (un file
/// aperto, una connessione, un thread suo) *mentre è ancora intero*.
///
/// La corsa è **costruita, non aspettata**: il job in volo è «insiste», che da
/// `run_job` esce soltanto quando l'host lo rifiuta. Nessun via del banco lo
/// libera, nessun `sleep` spera che lo spegnimento arrivi prima — l'unica cosa
/// che può farlo uscire è lo spegnimento stesso, quindi quando lo spegnimento
/// arriva a `Arc::get_mut` il job è dentro per costruzione.
///
/// E ciò che si aspetta alla fine non è un tempo ma un fatto: il commiato arriva
/// sullo stesso canale dei passi del job, e con la forma vecchia non arriverebbe
/// mai.
#[test]
fn shutdown_a_component_waits_the_its_job_and_then_the_dismisses() {
    let v = Vault::new();
    let (steps, regia) = steps();
    let (host, _events) = bench(&v, &steps);

    ask(&host, "insiste", serde_json::json!(null));
    regia.waits("is inside");

    // Lo spegnimento lo chiede questo thread e basta: non c'è più niente da
    // fare in parallelo, perché il job non aspetta il banco.
    let errors = host.set_plugin_enabled(None, SPY, false);

    assert!(
        errors.expect("the component disables").is_empty(),
        "disabling a component with its job in flight is not a bug: it is a wait"
    );
    // Il commiato è stato chiamato, ed è la riga per cui questo banco esiste:
    // senza l'attesa, qui non arriverebbe niente e questa riga scadrebbe.
    regia.waits("congedato");
    host.close();
}

/// Un job che pania costa **il job**: il pool resta vivo, il vault non è
/// avvelenato, e chi ha chiesto riceve un esito che nomina il colpevole.
#[test]
fn a_job_that_panics_costs_the_job_and_not_the_pool() {
    let v = Vault::new();
    let (steps, _regia) = steps();
    let (host, events) = bench(&v, &steps);

    ask(&host, "esplodi", serde_json::json!(null));
    let (job, result) = outcome(&events);
    assert_eq!(job, "esplodi");
    let error = result.expect_err("a panicking job does not yield a result");
    assert!(
        error.to_string().contains(SPY) && error.to_string().contains("went into a panic"),
        "the outcome names who exploded: {error}"
    );

    // Il thread del pool è ancora al suo posto: il job dopo gira.
    ask(&host, "scrivi", serde_json::json!({ "nota": "Dopo.md" }));
    let (job, result) = outcome(&events);
    assert_eq!(job, "scrivi");
    assert!(
        result.is_ok(),
        "the pool survived a job's panic"
    );

    // E il vault risponde ancora: il panico non ha attraversato nessun prestito.
    host.with_session(None, |s| {
        s.workspace()
            .write()
            .unwrap()
            .write_document(
                &DocId::new("Nota.md"),
                "# ancora qui\n",
                WriteBase::Dictated,
            )
            .expect("writing still works");
    })
    .expect("aperto");
    host.close();
}

/// **Chi chiude aspetta chi ha già cominciato**, dopo avergli detto di smettere;
/// e chi non è ancora partito riceve comunque un esito, perché qualcuno lo
/// aspetta.
#[test]
fn close_stops_the_pool_and_no_job_disappears_in_silence() {
    let v = Vault::new();
    let (steps, regia) = steps();
    let (host, events) = bench(&v, &steps);

    // Due job, un thread solo: il secondo è dietro al primo.
    ask(&host, "due-volte", serde_json::json!(null));
    ask(
        &host,
        "scrivi",
        serde_json::json!({ "nota": "MaiScritta.md" }),
    );
    regia.waits("ha scritto la prima");

    // Chiude mentre il primo è in volo. Il via non arriva mai da qui: lo dà la
    // chiusura, annullandolo — il job si sblocca perché il test lo lascia
    // andare subito dopo, e la chiusura lo aspetta.
    let closed = {
        let via = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            regia.via();
            regia
        });
        let errors = host.close();
        let _ = via.join();
        errors
    };

    let finished: Vec<_> = events
        .try_iter()
        .filter_map(|n| match n.event {
            Event::JobDone { job, result, .. } => Some((job, result)),
            _ => None,
        })
        .collect();
    assert_eq!(
        finished.len(),
        2,
        "both jobs received an outcome: {finished:?}"
    );
    assert!(
        finished
            .iter()
            .all(|(_, result)| matches!(result, Err(PluginError::Cancelled(_)))),
        "the one in flight was cancelled and the one queued did not start: {finished:?}"
    );
    assert!(
        !v.root.join("MaiScritta.md").exists(),
        "the job that did not start left nothing behind"
    );
    assert!(
        closed
            .iter()
            .all(|and| matches!(and, PluginError::Cancelled(_))),
        "the close tells what it stopped: {closed:?}"
    );
}

// --- il lavoro lungo si racconta (§10.3, decisione 0035) --------------------

/// I job vivi **adesso**, chiesti al canale dati come li chiede il centro
/// attività della shell.
fn live(host: &Host) -> Vec<JobStatus> {
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        match ws
            .query_index(IndexQuery::Jobs)
            .expect("il kernel risponde")
        {
            IndexResult::Jobs(jobs) => jobs,
            other => panic!("risposta fuori tema: {}", other.kind_name()),
        }
    })
    .expect("aperto")
}

/// Il giro intero di ciò che il centro attività guarda: il lavoro **compare**
/// quando è accettato, **dice dove è arrivato** mentre cammina, e **sparisce**
/// quando finisce — senza che nessuno debba tenere il conto.
///
/// Prova insieme le tre metà della voce, e non si possono separare: un elenco
/// che non si svuota è peggio di un elenco che non c'è, e un progresso che
#[test]
fn a_job_that_walks_compare_says_where_and_arrived_and_disappears() {
    let v = Vault::new();
    let (steps, regia) = steps();
    let (host, events) = bench(&v, &steps);

    let id = ask(&host, "racconta", serde_json::json!(null));

    // 1. Compare **subito**, prima ancora che un thread lo prenda in mano: è
    //    ciò che permette di fermare un job che sta ancora aspettando.
    let startup = events
        .recv_timeout(Duration::from_secs(10))
        .expect("the start of a job is an event");
    assert!(
        matches!(&startup.event, Event::JobStarted { id: which, job } if *which == id && job == "racconta"),
        "the first event is the start: {:?}",
        startup.event
    );

    // 2. Dice dove è arrivato, e chi arriva dopo lo può **chiedere**: sono le
    //    due strade per la stessa verità, e devono dire la stessa cosa.
    //
    //    Si **guarda** dentro il ciclo e si **giudica** dopo, ed è una regola di
    //    questo banco e non una preferenza: mentre il job è fermo alla barriera
    //    un'asserzione che cade lascerebbe il thread del pool in attesa di un
    //    via che nessuno darà più, e la suite si pianterebbe invece di
    //    diventare rossa.
    let mut seen: Vec<Vec<JobStatus>> = Vec::new();
    for step in 1..=3u64 {
        regia.waits(&format!("ha detto {step}"));
        seen.push(live(&host));
        regia.via();
    }
    for (n, live) in seen.iter().enumerate() {
        let step = n as u64 + 1;
        assert_eq!(live.len(), 1, "un solo lavoro in volo: {live:?}");
        assert_eq!(live[0].id, id);
        assert_eq!(live[0].job, "racconta");
        assert_eq!(live[0].plugin, SPY, "the line says whose work it is");
        assert_eq!(
            live[0].progress,
            Some(JobProgress {
                done: step,
                total: Some(3),
                label: Some(format!("passo {step}")),
            }),
            "chi chiede vede l'ultimo passo raccontato"
        );
    }

    // 3. Finisce, e da lì non è più vivo: l'elenco si svuota **prima** che
    //    l'esito parta, o chi riceve `job-done` e ricontrolla troverebbe ancora
    //    là dentro il lavoro che gli è appena stato detto finito.
    let (job, result) = outcome(&events);
    assert_eq!(job, "racconta");
    assert_eq!(result.expect("it reached the end"), "raccontato");
    assert!(
        live(&host).is_empty(),
        "a finished job is no longer work in progress"
    );
    host.close();
}

/// Il progresso **non lo si può firmare a nome di un altro**, e la ragione è
/// che non c'è dove scrivere il nome: `report_progress` non ha un parametro per
/// l'identità, e a metterla è l'host del job.
///
/// Qui si prova il caso in cui quell'identità non c'è: un `JobHost` costruito a
/// mano — le capacità di un plugin fuori dal pool — non è l'host di nessun job,
/// e il suo `report_progress` non inventa una riga nell'elenco.
#[test]
fn outside_from_a_job_the_progress_not_has_of_who_be() {
    let v = Vault::new();
    let (steps, _regia) = steps();
    let (host, _events) = bench(&v, &steps);

    let ws = host.workspace(None).expect("aperto");
    let mut outside = fub_host::JobHost::new(ws, SPY);
    outside.report_progress(JobProgress {
        done: 1,
        total: Some(2),
        label: Some("da nessuna parte".into()),
    });

    assert!(
        live(&host).is_empty(),
        "un progresso senza job non fa comparire niente"
    );
    host.close();
}

// --- le sveglie (§22.1, decisione 0069) -------------------------------------
//
// La metà che il contratto non guarda: il pool che, invece di dormire senza
// scadenza, dorme **fino alla prossima sveglia**. Sta qui e non nel kernel per
// la ragione che la 0032 ha già stabilito — i thread sono dell'host — e sta
// nello stesso file del runner perché è lo stesso ciclo: il punto in cui un
// thread stava per non fare niente.

/// Un bundle che dichiara una sveglia, e nient'altro.
struct BundleWithTimer;

impl Bundle for BundleWithTimer {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core("test.timer", "Con timer").waking(vec![TimerSpec {
            id: "battito".into(),
            // Un secondo è il minimo che il contratto sappia esprimere, ed è
            // ciò che rende questa prova veloce senza renderla una prova sulla
            // macchina: si aspetta il primo evento, non un tempo fisso.
            schedule: TimerSchedule::Every { seconds: 1 },
        }])
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(TimerPlugin)
    }

    fn register(&self, _ws: &mut fub_kernel::Workspace) -> Vec<String> {
        Vec::new()
    }
}

struct TimerPlugin;

impl Plugin for TimerPlugin {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core("test.timer", "Con timer")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

/// **Una sveglia dichiarata nel manifest suona davvero**, e a farla suonare è il
/// pool: nessuno la chiede, nessuno drena, nessun test chiama `fire_timer`.
///
/// È la prova che distingue questa voce dal tentativo ritirato dalla 0063: là i
/// campi c'erano e non li guardava nessuno.
#[test]
fn a_alarm_declared_rings_from_single() {
    let v = Vault::new();
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    // **Si aspetta che l'apertura abbia finito di indicizzare** (§15.7) prima
    // di guardare qualunque cosa. La seconda fase dell'apertura è un job come
    // gli altri — ha un id, compare fra i vivi, racconta un progresso — e su un
    // banco a un thread solo occupa anche l'unico turno disponibile. Senza
    // questa riga ogni presidio del pool conterebbe un lavoro in più e
    // aspetterebbe il proprio dietro a uno che non ha chiesto.
    host.wait_indexed(None).expect("l'apertura ha finito");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(&BundleWithTimer, &mut ws)
            .expect("il bundle si mount");
    })
    .expect("aperto");

    let expiration = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < expiration {
        if let Ok(notice) = events.recv_timeout(Duration::from_millis(200)) {
            if let Event::TimerFired { owner, timer } = &notice.event {
                assert_eq!(owner, "test.timer");
                assert_eq!(timer, "battito");
                return;
            }
        }
    }
    panic!(
        "the timer did not ring: the declaration exists and nobody watches it,
         which is exactly the defect for which this entry was once withdrawn"
    );
}

/// E chi **non** dichiara sveglie non paga nemmeno un risveglio: il pool torna
/// ad aspettare senza scadenza.
///
/// Non si può osservare un thread che dorme, quindi ciò che si osserva è la
/// promessa nella forma in cui è verificabile: senza dichiarazioni non esce
/// nessun `TimerFired`, per quanto si aspetti.
#[test]
fn who_not_declares_alarms_not_of_it_receives() {
    let v = Vault::new();
    let (steps, _regia) = steps();
    let (_host, events) = bench(&v, &steps);
    let expiration = std::time::Instant::now() + Duration::from_millis(1500);
    while std::time::Instant::now() < expiration {
        if let Ok(notice) = events.recv_timeout(Duration::from_millis(100)) {
            assert!(
                !matches!(notice.event, Event::TimerFired { .. }),
                "nobody declared a timer: {:?}",
                notice.event
            );
        }
    }
}
