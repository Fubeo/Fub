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
//! test che aspettasse un tempo fisso proverebbe la macchina su cui gira.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{HostApi, JobSpec, Plugin, PluginManifest};
use fubmd_abi::{Event, Notice, PluginError};
use fubmd_host::registry::Bundle;
use fubmd_host::{Host, NoWatcher};
use fubmd_kernel::Trust;

const SPIA: &str = "test.lavoratore";

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

/// Una barriera a due tempi: il job dice dove è arrivato, il test gli dà il via.
#[derive(Clone)]
struct Passi {
    arrivato: Sender<String>,
    via: Arc<Mutex<Receiver<()>>>,
}

struct Regia {
    arrivi: Receiver<String>,
    via: Sender<()>,
}

fn passi() -> (Passi, Regia) {
    let (arrivato, arrivi) = channel();
    let (via_tx, via_rx) = channel();
    (
        Passi {
            arrivato,
            via: Arc::new(Mutex::new(via_rx)),
        },
        Regia {
            arrivi,
            via: via_tx,
        },
    )
}

impl Passi {
    fn segna(&self, dove: &str) {
        let _ = self.arrivato.send(dove.to_string());
    }

    fn aspetta_il_via(&self) {
        let _ = self.via.lock().unwrap().recv();
    }
}

impl Regia {
    fn aspetta(&self, atteso: &str) {
        let dove = self
            .arrivi
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("nessuno è arrivato a `{atteso}`"));
        assert_eq!(dove, atteso);
    }

    fn via(&self) {
        let _ = self.via.send(());
    }
}

// --- un bundle che ha dei job ------------------------------------------------

/// Il plugin di prova: quattro job, uno per ogni cosa da provare.
struct Lavoratore {
    passi: Passi,
}

impl Plugin for Lavoratore {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(SPIA, "Lavoratore")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
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
                let quale = payload["nota"].as_str().unwrap_or("Job.md");
                host.create_document(&DocId::new(quale), "# fatto da un job\n")?;
                Ok(serde_json::json!({ "scritta": quale }))
            }
            // Scrive una volta, aspetta il via, e poi ci riprova: la seconda
            // volta è dove si vede l'annullamento.
            "due-volte" => {
                host.create_document(&DocId::new("Prima.md"), "# prima\n")?;
                self.passi.segna("ha scritto la prima");
                self.passi.aspetta_il_via();
                host.create_document(&DocId::new("Seconda.md"), "# seconda\n")?;
                Ok(serde_json::json!("due"))
            }
            // Non tocca mai l'host: è il limite dichiarato della cancellazione.
            "puro" => {
                self.passi.segna("sta calcolando");
                self.passi.aspetta_il_via();
                Ok(serde_json::json!(40 + 2))
            }
            "esplodi" => panic!("il job è esploso"),
            altro => Err(PluginError::UnknownJob(altro.to_string())),
        }
    }
}

struct BundleLavoratore {
    passi: Passi,
}

impl Bundle for BundleLavoratore {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(SPIA, "Lavoratore")
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Lavoratore {
            passi: self.passi.clone(),
        })
    }

    fn register(&self, _ws: &mut fubmd_kernel::Workspace) -> Vec<String> {
        Vec::new()
    }
}

/// Un host headless con un vault aperto, il bundle di prova montato e **un solo
/// thread** nel pool: un thread solo rende osservabile l'ordine.
fn banco(v: &Vault, passi: &Passi) -> (Host, Receiver<Notice>) {
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    let eventi = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .lock()
            .unwrap()
            .mount(
                &BundleLavoratore {
                    passi: passi.clone(),
                },
                &mut ws,
            )
            .expect("il bundle si monta");
    })
    .expect("aperto");
    (host, eventi)
}

/// Accoda un job come lo accoderebbe una feature: dall'`HostApi`, e basta.
fn chiedi(host: &Host, job: &str, payload: serde_json::Value) -> fubmd_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(SPIA, |h| {
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
fn esito(eventi: &Receiver<Notice>) -> (String, Result<serde_json::Value, PluginError>) {
    let scadenza = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < scadenza {
        match eventi.recv_timeout(Duration::from_millis(200)) {
            Ok(notice) => {
                if let Event::JobDone { job, result, .. } = notice.event {
                    return (job, result);
                }
            }
            Err(_) => continue,
        }
    }
    panic!("nessun job è mai tornato: la coda non la drena nessuno");
}

// --- le prove ---------------------------------------------------------------

/// Il fatto nuovo, e da solo vale la voce: **la coda la drena qualcuno**. Prima
/// `spawn_job` accodava e il job restava lì per sempre.
#[test]
fn un_job_accodato_parte_da_solo_e_vede_il_vault() {
    let v = Vault::nuovo();
    let (passi, _regia) = passi();
    let (host, eventi) = banco(&v, &passi);

    chiedi(&host, "scrivi", serde_json::json!({ "nota": "Fatta.md" }));

    let (job, result) = esito(&eventi);
    assert_eq!(job, "scrivi");
    assert_eq!(
        result.expect("il job è riuscito"),
        serde_json::json!({ "scritta": "Fatta.md" })
    );
    assert!(
        v.root.join("Fatta.md").exists(),
        "il job ha scritto nel vault davvero, non in un suo mondo"
    );
    host.close();
}

/// **La cancellazione non aggiunge nessuna capacità**: il job non controlla
/// niente: è il suo host che smette di servirlo, e la seconda scrittura riceve
/// `Cancelled` invece di avvenire.
#[test]
fn un_job_annullato_riceve_rifiuti_alla_chiamata_successiva() {
    let v = Vault::nuovo();
    let (passi, regia) = passi();
    let (host, eventi) = banco(&v, &passi);

    let id = chiedi(&host, "due-volte", serde_json::json!(null));
    regia.aspetta("ha scritto la prima");
    host.cancel_job(None, id).expect("annullato");
    regia.via();

    let (_, result) = esito(&eventi);
    let errore = result.expect_err("un job annullato non arriva in fondo");
    assert!(
        matches!(errore, PluginError::Cancelled(_)),
        "l'esito dice che è stato **annullato**, non che è fallito: {errore}"
    );
    assert!(
        v.root.join("Prima.md").exists(),
        "ciò che aveva già fatto resta fatto: annullare non è annullare gli effetti"
    );
    assert!(
        !v.root.join("Seconda.md").exists(),
        "e ciò che ha provato a fare dopo non è avvenuto"
    );
    host.close();
}

/// **Il limite, dichiarato.** Un job che non chiama mai l'host non lo si può
/// fermare: non c'è niente da rifiutargli, e in Rust un thread non si uccide.
#[test]
fn un_job_puro_che_non_chiama_mai_lhost_arriva_in_fondo_comunque() {
    let v = Vault::nuovo();
    let (passi, regia) = passi();
    let (host, eventi) = banco(&v, &passi);

    let id = chiedi(&host, "puro", serde_json::json!(null));
    regia.aspetta("sta calcolando");
    host.cancel_job(None, id).expect("annullato");
    regia.via();

    let (_, result) = esito(&eventi);
    assert_eq!(
        result.expect("un calcolo puro non ha niente da farsi rifiutare"),
        serde_json::json!(42),
        "la cancellazione è cooperativa perché non può essere altro"
    );
    host.close();
}

/// Un job che pania costa **il job**: il pool resta vivo, il vault non è
/// avvelenato, e chi ha chiesto riceve un esito che nomina il colpevole.
#[test]
fn un_job_che_pania_costa_il_job_e_non_il_pool() {
    let v = Vault::nuovo();
    let (passi, _regia) = passi();
    let (host, eventi) = banco(&v, &passi);

    chiedi(&host, "esplodi", serde_json::json!(null));
    let (job, result) = esito(&eventi);
    assert_eq!(job, "esplodi");
    let errore = result.expect_err("un job che pania non rende un risultato");
    assert!(
        errore.to_string().contains(SPIA) && errore.to_string().contains("è andato in panico"),
        "l'esito nomina chi è esploso: {errore}"
    );

    // Il thread del pool è ancora al suo posto: il job dopo gira.
    chiedi(&host, "scrivi", serde_json::json!({ "nota": "Dopo.md" }));
    let (job, result) = esito(&eventi);
    assert_eq!(job, "scrivi");
    assert!(
        result.is_ok(),
        "il pool è sopravvissuto al panico di un job"
    );

    // E il vault risponde ancora: il panico non ha attraversato nessun prestito.
    host.with_session(None, |s| {
        s.workspace()
            .write()
            .unwrap()
            .write_document(&DocId::new("Nota.md"), "# ancora qui\n")
            .expect("si scrive ancora");
    })
    .expect("aperto");
    host.close();
}

/// **Chi chiude aspetta chi ha già cominciato**, dopo avergli detto di smettere;
/// e chi non è ancora partito riceve comunque un esito, perché qualcuno lo
/// aspetta.
#[test]
fn chiudere_ferma_il_pool_e_nessun_job_sparisce_in_silenzio() {
    let v = Vault::nuovo();
    let (passi, regia) = passi();
    let (host, eventi) = banco(&v, &passi);

    // Due job, un thread solo: il secondo è dietro al primo.
    chiedi(&host, "due-volte", serde_json::json!(null));
    chiedi(
        &host,
        "scrivi",
        serde_json::json!({ "nota": "MaiScritta.md" }),
    );
    regia.aspetta("ha scritto la prima");

    // Chiude mentre il primo è in volo. Il via non arriva mai da qui: lo dà la
    // chiusura, annullandolo — il job si sblocca perché il test lo lascia
    // andare subito dopo, e la chiusura lo aspetta.
    let chiusa = {
        let via = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            regia.via();
            regia
        });
        let errori = host.close();
        let _ = via.join();
        errori
    };

    let finiti: Vec<_> = eventi
        .try_iter()
        .filter_map(|n| match n.event {
            Event::JobDone { job, result, .. } => Some((job, result)),
            _ => None,
        })
        .collect();
    assert_eq!(
        finiti.len(),
        2,
        "tutti e due i job hanno avuto un esito: {finiti:?}"
    );
    assert!(
        finiti
            .iter()
            .all(|(_, result)| matches!(result, Err(PluginError::Cancelled(_)))),
        "chi era in volo è stato annullato e chi era in coda non è partito: {finiti:?}"
    );
    assert!(
        !v.root.join("MaiScritta.md").exists(),
        "il job che non è partito non ha lasciato niente"
    );
    assert!(
        chiusa
            .iter()
            .all(|e| matches!(e, PluginError::Cancelled(_))),
        "la chiusura racconta ciò che ha fermato: {chiusa:?}"
    );
}
