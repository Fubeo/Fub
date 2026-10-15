//! **L'istanza e il turno non si aspettano a vicenda** (FUB-019).
//!
//! Plugin e provider di formato di una stessa apertura condividono un'istanza,
//! cioè un `Mutex`. Due thread la chiedono in ordine opposto:
//!
//! - il **job** del plugin tiene l'istanza per tutta la chiamata e, quando
//!   chiede qualcosa che cambia lo stato del vault (qui `spawn-job`; `emit` e
//!   `report-progress` passano dallo stesso turno), lo chiede all'host;
//! - il **salvataggio** di una nota del formato tiene il turno e chiama il
//!   parser, cioè chiede l'istanza.
//!
//! Ognuno aspetta ciò che l'altro tiene, e le attese sono native: né la
//! cancellazione del job né i limiti di esecuzione del componente le
//! interrompono.
//!
//! # Come si fissa l'ordine senza un orologio
//!
//! Il ciclo si chiude solo se il salvataggio prende il turno **prima** che il
//! job lo chieda, e se il job ha già l'istanza. Tre fatti osservabili lo
//! garantiscono, e nessuno è «è passato abbastanza tempo»:
//!
//! 1. il job si annuncia con un evento **dopo** aver preso l'istanza e prima di
//!    aspettare il segnale;
//! 2. il banco lancia il salvataggio e aspetta che il turno di scrittura sia in
//!    mano a qualcuno: il job, che in quel momento legge soltanto, non lo ha;
//! 3. solo allora il banco crea il segnale **fuori dal workspace**, e il job,
//!    che lo legge senza chiedere nessun turno, passa alla richiesta.
//!
//! L'unica scadenza è quella che riconosce il blocco: se entro il tempo
//! concesso uno dei due non ha finito, il banco lo dice col suo nome invece di
//! restare appeso.
//!
//! Come per gli altri componenti, `esempi/stallo-wasm` sta fuori dal workspace
//! e si compila qui per `wasm32-wasip2`.

mod common;

use std::mem::ManuallyDrop;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::event::Event;
use fub_abi::model::DocId;
use fub_abi::traits::JobId;
use fub_abi::{PluginError, Revision};
use fub_host::Host;
use fub_kernel::Subscription;
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::InstalledPluginManager;

const ID: &str = "demo.stallo";
const JOB: &str = "demo.stallo:scrivi";
const DATO: &str = "dato.fubstallo";
const SEGNALE: &str = "segnale.md";

/// Quanto si aspetta un fatto che deve succedere subito. Larga di proposito:
/// non è il tempo che le cose devono metterci, è il tempo oltre il quale
/// restare ad aspettare è una risposta.
const SCADENZA: Duration = Duration::from_secs(20);

struct Vault {
    _dir: tempfile::TempDir,
    _config: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        std::fs::write(root.join(DATO), "prima").unwrap();
        let config = tempfile::tempdir().expect("config tempdir");
        Vault {
            _dir: dir,
            _config: config,
            root,
        }
    }
}

/// L'host, il vault aperto, il componente installato e l'orecchio sul bus.
///
/// Il componente passa dal gestore dei plugin installati e non da
/// `mount_bundle`: è la via per cui plugin e formato dello stesso componente
/// **condividono l'istanza**, che è ciò che la prova vuole. Le decisioni
/// installate diventano effettive alla riapertura del vault.
///
/// L'host sta dietro un `ManuallyDrop`: se la prova trova il blocco, i thread
/// che lo compongono sono fermi per sempre, e un `drop` che li aspettasse
/// terrebbe appeso il banco proprio nel momento in cui deve dire cosa è
/// successo.
struct Banco {
    _manager: Arc<InstalledPluginManager>,
    host: ManuallyDrop<Arc<Host>>,
    events: Subscription,
    seen: Vec<Event>,
}

impl Banco {
    fn new(v: &Vault) -> Self {
        let config = Utf8PathBuf::from_path_buf(v._config.path().to_path_buf()).expect("utf8");
        let manager = Arc::new(InstalledPluginManager::open(&config).expect("il gestore si apre"));
        let installed = manager
            .install(&common::component("stallo-wasm", "stallo_wasm", ""))
            .expect("il componente si installa");
        let host = Host::without_watcher()
            .with_job_threads(2)
            .with_startup_source(manager.clone());
        host.open(&v.root).expect("il vault si apre");
        host.wait_indexed(None).expect("l'apertura ha finito");
        manager
            .set_enabled(&host, installed.installation, true)
            .expect("la scelta si salva")
            .is_empty()
            .then_some(())
            .expect("accendere non dà diagnostiche");
        manager
            .set_consent(&host, installed.installation, Consent::Granted)
            .expect("il consenso si salva")
            .is_empty()
            .then_some(())
            .expect("il consenso non dà diagnostiche");
        let permission =
            fub_abi::settings::permission_key(ID, fub_abi::options::permission::READ_VAULT);
        host.set_setting_for_user(
            Some(v.root.as_str()),
            &permission,
            fub_abi::settings::SettingValue::Toggle(true),
        )
        .expect("l'utente concede la lettura dichiarata");
        host.close_vault(&v.root).expect("la prima sessione chiude");
        host.open(&v.root).expect("la sessione gestita si riapre");
        host.wait_indexed(None).expect("la riapertura ha finito");
        let events = host.subscribe(None).expect("aperto");
        Banco {
            _manager: manager,
            host: ManuallyDrop::new(Arc::new(host)),
            events,
            seen: Vec::new(),
        }
    }

    fn host(&self) -> Arc<Host> {
        Arc::clone(&self.host)
    }

    /// Ascolta finché un evento non soddisfa `wanted`. Tutto ciò che passa si
    /// ricorda, perché il racconto di un blocco sta negli eventi di mezzo.
    fn hear(&mut self, what: &str, wanted: impl Fn(&Event) -> bool) -> Event {
        let end = Instant::now() + SCADENZA;
        while Instant::now() < end {
            let Ok(notice) = self.events.recv_timeout(Duration::from_millis(50)) else {
                continue;
            };
            let found = wanted(&notice.event);
            self.seen.push(notice.event.clone());
            if found {
                return notice.event;
            }
        }
        panic!(
            "non è mai arrivato: {what}. Intanto era arrivato: {:#?}",
            self.seen
        );
    }

    fn job_done(&mut self, id: JobId) -> Result<serde_json::Value, PluginError> {
        let Event::JobDone { result, .. } = self.hear(
            "la fine del job",
            |event| matches!(event, Event::JobDone { id: done, .. } if *done == id),
        ) else {
            unreachable!("`hear` rende l'evento che soddisfa il filtro")
        };
        result
    }

    /// Lascia vivere i thread dell'host: dopo un blocco non li si può
    /// aspettare, e dopo un esito buono li ferma il `drop` normale.
    fn close(mut self) {
        // SAFETY: `host` non si usa più dopo questa riga.
        unsafe { ManuallyDrop::drop(&mut self.host) };
    }
}

fn wait_for(what: &str, mut condition: impl FnMut() -> bool) {
    let end = Instant::now() + SCADENZA;
    while Instant::now() < end {
        if condition() {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    panic!("non è mai successo: {what}");
}

fn ask(host: &Host) -> JobId {
    host.spawn_job(
        None,
        ID,
        JOB.to_string(),
        serde_json::json!({ "segnale": SEGNALE }),
    )
    .expect("aperto")
}

fn is_conflict(error: &PluginError) -> bool {
    matches!(error, PluginError::Conflict(_))
}

/// Il job è dentro l'istanza; il salvataggio di `dato` parte; poi il segnale
/// arriva e il job chiede il turno a sua volta.
///
/// Con `await_turn` il segnale arriva solo quando il salvataggio **ha** il
/// turno, ed è l'ordine che chiude il ciclo. Un salvataggio che non chiede
/// l'istanza (Markdown nativo) il turno lo rilascia troppo presto per
/// osservarlo, e lì non serve: non c'è niente da incastrare.
///
/// Rende l'identità del job e l'esito del salvataggio, o `Err` se il
/// salvataggio non è tornato entro la scadenza.
fn salva_mentre_il_job_chiede(
    vault: &Vault,
    banco: &mut Banco,
    dato: &str,
    await_turn: bool,
) -> (
    JobId,
    Result<Result<Revision, PluginError>, mpsc::RecvTimeoutError>,
) {
    let host = banco.host();

    // 1. Il job è dentro l'istanza e aspetta il segnale.
    let job = ask(&host);
    banco.hear(
        "l'annuncio del job",
        |event| matches!(event, Event::Custom { topic, .. } if topic == "demo.stallo:dentro"),
    );

    // 2. Il salvataggio prende il turno e, se il formato è del componente, va a
    //    chiedere il parser.
    let (saved_tx, saved_rx) = mpsc::channel();
    let saver = Arc::clone(&host);
    let dato = DocId::new(dato.to_string());
    std::thread::spawn(move || {
        let saved = saver.write_document(None, &dato, "dopo", WriteBase::Dictated);
        let _ = saved_tx.send(saved);
    });
    if await_turn {
        wait_for("il salvataggio ha il turno di scrittura", || {
            host.is_write_turn_held(None).unwrap_or(false)
        });
    }

    // 3. Il segnale, fuori dal workspace: il job passa alla richiesta.
    std::fs::write(vault.root.join(SEGNALE), "via").expect("il segnale si scrive");

    (job, saved_rx.recv_timeout(SCADENZA))
}

/// **Il salvataggio che chiede il parser e il job che chiede il turno finiscono
/// tutti e due**, o uno dei due dice di essersi fatto da parte.
///
/// Prima della correzione la prova non finisce: il salvataggio tiene il turno e
/// aspetta l'istanza, il job tiene l'istanza e aspetta il turno.
#[test]
fn a_save_that_needs_the_parser_and_a_job_that_needs_the_turn_both_finish() {
    let vault = Vault::new();
    let mut banco = Banco::new(&vault);
    let host = banco.host();

    let (job, saved) = salva_mentre_il_job_chiede(&vault, &mut banco, DATO, true);
    let saved = saved.unwrap_or_else(|_| {
        // Lascia vivere l'host: i suoi thread sono fermi, e il banco deve poter
        // dire cosa ha visto.
        panic!(
            "STALLO: il salvataggio non è tornato entro {SCADENZA:?}. Tiene il turno e \
             aspetta l'istanza, che il job tiene mentre aspetta il turno. Eventi: {:#?}",
            banco.seen
        )
    });
    saved.expect("il salvataggio riesce: è il lato che l'utente sta guardando");
    assert_eq!(
        std::fs::read_to_string(vault.root.join(DATO)).unwrap(),
        "dopo",
        "il salvataggio è arrivato fino al disco"
    );

    let outcome = banco.job_done(job);
    match &outcome {
        Ok(_) => {}
        Err(error) => assert!(
            is_conflict(error),
            "il job finisce, o dice di essersi fatto da parte con un conflitto: {error:?}"
        ),
    }

    // Il job che si è fatto da parte si riprova, e questa volta passa: il
    // segnale c'è già e nessuno tiene più il turno.
    if outcome.is_err() {
        let again = ask(&host);
        banco
            .job_done(again)
            .expect("riprovato a vault libero, il job chiede e ottiene");
    }

    drop(host);
    banco.close();
}

/// **Il controllo negativo**: stesso componente, stesso job, ma la nota salvata
/// è Markdown e il suo parser non è del componente. Il salvataggio non chiede
/// l'istanza, quindi non c'è ciclo: il job ottiene il turno e finisce bene.
///
/// Se questa prova si bloccasse, il blocco della prova accanto non starebbe
/// nell'istanza; se il job qui ricevesse un conflitto, la correzione vedrebbe un
/// ciclo dove non c'è.
#[test]
fn a_save_that_does_not_need_the_instance_leaves_the_job_alone() {
    let vault = Vault::new();
    let mut banco = Banco::new(&vault);
    let host = banco.host();

    let (job, saved) = salva_mentre_il_job_chiede(&vault, &mut banco, "Nota.md", false);
    saved
        .unwrap_or_else(|_| {
            panic!(
                "il salvataggio di una nota Markdown non è tornato entro {SCADENZA:?}: non \
                 aspetta l'istanza, quindi il blocco non è dell'istanza. Eventi: {:#?}",
                banco.seen
            )
        })
        .expect("il salvataggio riesce");
    assert_eq!(
        std::fs::read_to_string(vault.root.join("Nota.md")).unwrap(),
        "dopo"
    );
    banco
        .job_done(job)
        .expect("senza un ciclo il job aspetta il turno e lo ottiene, senza conflitto");

    drop(host);
    banco.close();
}
