//! **L'istanza e il turno non si aspettano a vicenda** (FUB-019).
//!
//! Plugin e provider di uno stesso componente di una stessa apertura condividono
//! un'istanza, cioè un `Mutex`. Due thread la chiedono in ordine opposto:
//!
//! - il **job** del plugin tiene l'istanza per tutta la chiamata e, quando
//!   chiede qualcosa che cambia lo stato del vault (qui `spawn-job`; `emit` e
//!   `report-progress` passano dallo stesso turno), lo chiede all'host;
//! - il **salvataggio** di una nota tiene il turno di scrittura e, in uno dei
//!   suoi passi, chiede l'istanza: il **parser** del formato del componente, un
//!   **gancio** nativo che chiama un suo comando, l'**indice** che il componente
//!   offre, l'**handler di eventi** che il componente registra.
//!
//! Ognuno aspetta ciò che l'altro tiene, e le attese erano native: né la
//! cancellazione del job né i limiti di esecuzione del componente le
//! interrompevano. Ora chi sta dentro il guest cede: la richiesta del job torna
//! con un conflitto, il job esce e restituisce l'istanza, il salvataggio finisce
//! e il job, ritentato, passa.
//!
//! # Come si fissa l'ordine senza un orologio
//!
//! Il ciclo si chiude solo se il salvataggio prende il turno **prima** che il
//! job lo chieda, e se il job ha già l'istanza. Tre fatti osservabili lo
//! garantiscono, e nessuno è «è passato abbastanza tempo»:
//!
//! 1. il job si annuncia con un evento **dopo** aver preso l'istanza e prima di
//!    aspettare il segnale;
//! 2. il banco lancia il salvataggio su un thread suo e aspetta che **quel
//!    thread** risulti in attesa dell'istanza (`waits::thread_waits_for_an_instance`):
//!    per aspettarla ha il turno, e l'istanza la tiene il job. Il turno «in mano a
//!    qualcuno» non basta: nei primi millisecondi lo tiene anche l'`emit` con cui
//!    il job si è annunciato, a tratti, e il segnale arriverebbe prima che il
//!    salvataggio sia partito (sotto carico, la variante degli eventi falliva così);
//! 3. solo allora il banco crea il segnale **fuori dal workspace**, e il job,
//!    che lo legge senza chiedere nessun turno, passa alla richiesta.
//!
//! L'unica scadenza è quella che riconosce il blocco: se entro il tempo
//! concesso uno dei due non ha finito, il banco lo dice col suo nome invece di
//! restare appeso.
//!
//! Come per gli altri componenti, `esempi/stallo-wasm` sta fuori dal workspace
//! e si compila qui per `wasm32-wasip2`, una variante per punto d'ingresso.

mod common;

use std::mem::ManuallyDrop;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::event::Event;
use fub_abi::model::DocId;
use fub_abi::traits::{HostApi, JobId, Plugin, PluginManifest, PluginPermissions};
use fub_abi::{PluginError, Revision};
use fub_host::registry::{Bundle, Registrar};
use fub_host::Host;
use fub_kernel::Subscription;
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::InstalledPluginManager;

const ID: &str = "demo.stallo";
const JOB: &str = "demo.stallo:scrivi";
const COMANDO: &str = "demo.stallo:vuoto";
const DATO: &str = "dato.fubstallo";
const SEGNALE: &str = "segnale.md";
const NOTA: &str = "Nota.md";
const GANCIO: &str = "demo.gancio";

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
        std::fs::write(root.join(NOTA), "# Nota\n").unwrap();
        std::fs::write(root.join(DATO), "prima").unwrap();
        let config = tempfile::tempdir().expect("config tempdir");
        Vault {
            _dir: dir,
            _config: config,
            root,
        }
    }
}

/// Il gancio chiama un comando, e chiamarlo costa un permesso dichiarato.
fn manifesto() -> PluginManifest {
    PluginManifest::new(GANCIO, "Gancio di prova").granting(PluginPermissions::of(&[
        fub_abi::options::permission::RUN_COMMAND,
    ]))
}

/// Un gancio nativo prima della scrittura che chiama un comando del componente.
///
/// È l'unico modo in cui un **hook** entra in un'istanza: i ganci sono solo
/// nativi, e ciò che fanno con un componente lo fanno attraverso le capacità
/// dell'host, qui `run_command`.
struct Gancio;

impl Bundle for Gancio {
    fn manifest(&self) -> PluginManifest {
        manifesto()
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Quieto)
    }

    fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
        match registrar.set_before_write_hook(Arc::new(|host, _id| {
            host.run_command(COMANDO, serde_json::json!({})).map(drop)
        })) {
            Ok(()) => Vec::new(),
            Err(error) => vec![format!("il gancio non si registra: {error}")],
        }
    }
}

struct Quieto;

impl Plugin for Quieto {
    fn manifest(&self) -> PluginManifest {
        manifesto()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
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
    /// `variante` è la feature di `esempi/stallo-wasm` che accende il punto
    /// d'ingresso provato, o `""` per il formato.
    fn new(v: &Vault, variante: &str) -> Self {
        let config = Utf8PathBuf::from_path_buf(v._config.path().to_path_buf()).expect("utf8");
        let manager = Arc::new(InstalledPluginManager::open(&config).expect("il gestore si apre"));
        let installed = manager
            .install(&common::component("stallo-wasm", "stallo_wasm", variante))
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
/// Con `await_turn` il segnale arriva solo quando il salvataggio **sta già
/// aspettando l'istanza** del job, col turno in mano: è l'ordine che chiude il
/// ciclo. Un salvataggio che non chiede l'istanza non aspetta niente, e lì non
/// serve: non c'è niente da incastrare.
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

    // 2. Il salvataggio prende il turno e, prima o poi, va a chiedere l'istanza.
    let (saved_tx, saved_rx) = mpsc::channel();
    let saver = Arc::clone(&host);
    let dato = DocId::new(dato.to_string());
    let salvataggio = std::thread::spawn(move || {
        let saved = saver.write_document(None, &dato, "dopo", WriteBase::Dictated);
        let _ = saved_tx.send(saved);
    });
    if await_turn {
        // Il fatto che chiude il ciclo è questo: **quel** thread aspetta
        // l'istanza, che il job tiene. Per aspettarla ha già il turno. Vedere
        // soltanto «il turno è in mano a qualcuno» non basterebbe: nei primi
        // millisecondi lo tiene anche l'`emit` con cui il job si è annunciato, e
        // il segnale arriverebbe prima che il salvataggio sia partito.
        let thread = salvataggio.thread().id();
        wait_for("il salvataggio aspetta l'istanza del job", || {
            fub_host::waits::thread_waits_for_an_instance(thread)
        });
        assert!(
            host.is_write_turn_held(None).unwrap_or(false),
            "il salvataggio aspetta l'istanza senza il turno di scrittura: non è il ciclo \
             che la prova vuole chiudere"
        );
    }

    // 3. Il segnale, fuori dal workspace: il job passa alla richiesta.
    std::fs::write(vault.root.join(SEGNALE), "via").expect("il segnale si scrive");

    (job, saved_rx.recv_timeout(SCADENZA))
}

/// **Il salvataggio che chiede l'istanza e il job che chiede il turno finiscono
/// tutti e due**: il salvataggio riesce, il job si fa da parte con un conflitto
/// e, ritentato a vault libero, ottiene ciò che chiedeva.
///
/// Prima della correzione la prova non finisce: il salvataggio tiene il turno e
/// aspetta l'istanza, il job tiene l'istanza e aspetta il turno.
fn il_job_cede_al_salvataggio(variante: &str, dato: &str, gancio: bool) {
    let vault = Vault::new();
    let mut banco = Banco::new(&vault, variante);
    let host = banco.host();
    if gancio {
        host.mount_bundle(None, Arc::new(Gancio))
            .expect("il gancio si monta");
        // Un permesso dichiarato non è ancora concesso: lo concede l'utente.
        host.set_setting_for_user(
            None,
            &fub_abi::settings::permission_key(GANCIO, fub_abi::options::permission::RUN_COMMAND),
            fub_abi::settings::SettingValue::Toggle(true),
        )
        .expect("l'utente concede al gancio di chiamare comandi");
    }

    let (job, saved) = salva_mentre_il_job_chiede(&vault, &mut banco, dato, true);
    let saved = saved.unwrap_or_else(|_| {
        // Lascia vivere l'host: i suoi thread sono fermi, e il banco deve poter
        // dire cosa ha visto.
        panic!(
            "STALLO ({variante:?}): il salvataggio non è tornato entro {SCADENZA:?}. Tiene il \
             turno e aspetta l'istanza, che il job tiene mentre aspetta il turno. Eventi: {:#?}",
            banco.seen
        )
    });
    saved.expect("il salvataggio riesce: è il lato che l'utente sta guardando");
    assert_eq!(
        std::fs::read_to_string(vault.root.join(dato)).unwrap(),
        "dopo",
        "il salvataggio è arrivato fino al disco"
    );

    // Il ciclo c'è stato davvero, e a cedere è il job: l'ordine dei fatti non
    // lascia altra uscita. Un job che finisse bene vorrebbe dire che il
    // salvataggio non ha mai chiesto l'istanza, cioè che la prova non prova.
    let outcome = banco.job_done(job);
    match &outcome {
        Err(error) if is_conflict(error) => {}
        other => panic!(
            "({variante:?}) il job avrebbe dovuto cedere con un conflitto, e invece: {other:?}"
        ),
    }

    // Il job che si è fatto da parte si riprova, e questa volta passa: il
    // segnale c'è già e nessuno tiene più il turno.
    let again = ask(&host);
    banco
        .job_done(again)
        .expect("riprovato a vault libero, il job chiede e ottiene");

    drop(host);
    banco.close();
}

/// Il **parser**: il salvataggio di una nota del formato del componente.
#[test]
fn a_save_that_needs_the_parser_and_a_job_that_needs_the_turn_both_finish() {
    il_job_cede_al_salvataggio("", DATO, false);
}

/// Il **gancio** prima della scrittura: nativo, chiama un comando del componente.
#[test]
fn a_before_write_hook_that_runs_a_command_and_a_job_that_needs_the_turn_both_finish() {
    il_job_cede_al_salvataggio("comando", NOTA, true);
}

/// L'**indice** che il componente offre: lo alimenta ogni salvataggio.
#[test]
fn an_index_feed_and_a_job_that_needs_the_turn_both_finish() {
    il_job_cede_al_salvataggio("indice", NOTA, false);
}

/// L'**handler di eventi** che il componente registra: lo chiama il salvataggio
/// quando drena gli eventi della sua scrittura.
#[test]
fn an_event_handler_and_a_job_that_needs_the_turn_both_finish() {
    il_job_cede_al_salvataggio("eventi", NOTA, false);
}

/// **Il controllo negativo**: stesso componente, stesso job, ma la nota salvata
/// è Markdown e il componente non ha nessun punto d'ingresso acceso. Il
/// salvataggio non chiede l'istanza, quindi non c'è ciclo: il job ottiene il
/// turno e finisce bene.
///
/// Se questa prova si bloccasse, il blocco delle prove accanto non starebbe
/// nell'istanza; se il job qui ricevesse un conflitto, la correzione vedrebbe un
/// ciclo dove non c'è.
#[test]
fn a_save_that_does_not_need_the_instance_leaves_the_job_alone() {
    let vault = Vault::new();
    let mut banco = Banco::new(&vault, "");
    let host = banco.host();

    let (job, saved) = salva_mentre_il_job_chiede(&vault, &mut banco, NOTA, false);
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
        std::fs::read_to_string(vault.root.join(NOTA)).unwrap(),
        "dopo"
    );
    banco
        .job_done(job)
        .expect("senza un ciclo il job aspetta il turno e lo ottiene, senza conflitto");

    drop(host);
    banco.close();
}
