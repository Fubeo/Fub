//! **Il primo plugin vero** (criterio M4): un componente che vive solo per
//! contratto — manifest, attivazione, provider, job — e che si monta e si
//! smonta per intero, senza un solo ramo cablato nel kernel.
//!
//! Fino a qui i plugin di prova erano `OnlyProviders`: un manifest e basta,
//! perché ciò che si provava era il montaggio. Questo è l'altro estremo — un
//! `Plugin` che fa le quattro cose che il capitolo 7 promette a chi ne scrive
//! uno vero, e le fa tutte e quattro **davanti a un host che le governa**:
//!
//! - `manifest` dichiara i permessi (§7.3): il ping legge il vault, e lo dice.
//! - `activate` fa il lavoro del plugin che non ha bisogno di permessi: segna
//!   l'istante in cui si è acceso (l'orologio è una capacità senza permesso).
//! - il **comando** arriva dal quarto passo del montaggio, `Bundle::register`:
//!   è lì che un bundle registra i propri provider, perché l'`HostApi` non ha
//!   metodi `register_*` (decisione 0013) — l'attivazione non può e non deve
//!   registrare, può solo fare. Il comando è di sola lettura, come si conviene
//!   a un ping, e la lettura è ciò che il permesso `read-vault` governa.
//! - `run_job` è il corpo di un job vero: gira sul pool del §9.3, si racconta
//!   con `report_progress` (§10.3) e legge il vault con le stesse capacità del
//!   comando.
//!
//! Il commiato — «dopo lo smontaggio il comando non esiste più» — non sta nel
//! `deactivate` del plugin: sta in `Workspace::deactivate_plugin`, che il
//! `BundleRegistry::unmount` chiama **dopo** il commiato (decisione 0031). Il
//! `deactivate` riceve l'host ancora vivo e i propri provider ancora registrati,
//! e lo prova segnando il commiato; a togliere i provider è il kernel, che è
//! l'unico che li possiede. Ciò che il test osserva è il contratto intero:
//! montato → il comando c'è e risponde; smontato → `UnknownCommand`.
//!
//! La seconda prova è il cancello del §7.3 visto dal lato di chi lo attraversa:
//! lo **stesso** plugin, montato con un manifest senza `read-vault`, si monta
//! lo stesso (l'attivazione non ne ha bisogno), ma la prima lettura — dal
//! comando e dal job — riceve `PermissionDenied`. È la stessa porta che
//! `every_structural_capability_is_refused_by_the_same_gate` presidia dal lato
//! delle famiglie, qui provata dal lato del permesso dichiarato.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::event::{Actor, Event};
use fub_abi::model::DocId;
use fub_abi::options::permission;
use fub_abi::traits::{
    CommandProvider, HostApi, JobProgress, JobSpec, Plugin, PluginManifest,
    PluginPermissions,
};
use fub_abi::PluginError;
use fub_host::registry::Bundle;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust, Workspace};

/// L'id del plugin e del suo comando. Un plugin non-core nomina dentro il
/// proprio id (§7.4): `demo.ping:ping` è il ping di `demo.ping`, e nessun altro
/// plugin può rivendicarlo.
const ID: &str = "demo.ping";
const COMANDO: &str = "demo.ping:ping";

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

type Diario = Arc<Mutex<Vec<String>>>;

fn righe(diario: &Diario) -> Vec<String> {
    diario.lock().unwrap().clone()
}

/// Un host headless con un vault aperto e il bundle di prova montato.
///
/// `permessi` sceglie il manifest: con o senza `read-vault`. È la stessa spia
/// montata in due modi, perché ciò che cambia fra le due prove è **solo** il
/// permesso dichiarato.
fn banco(v: &Vault, permessi: bool) -> (Host, Subscription, Diario) {
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    // Si aspetta che l'apertura abbia finito di indicizzare (§15.7) prima di
    // guardare qualunque cosa: la seconda fase dell'apertura è un job come gli
    // altri, e su un banco a un thread solo occuperebbe l'unico turno.
    host.wait_indexed(None).expect("l'apertura ha finito");
    let eventi = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    let diario: Diario = Arc::default();
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(
                &BundleDemoPing {
                    diario: diario.clone(),
                    permessi,
                },
                &mut ws,
            )
            .expect("il bundle si monta");
    })
    .expect("aperto");
    (host, eventi, diario)
}

/// Accoda un job come lo accoderebbe una feature: dall'`HostApi`, e basta.
fn chiedi(host: &Host, job: &str) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

/// Il primo `JobDone` che arriva, o il fallimento del test.
fn esito(eventi: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
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

// --- il plugin --------------------------------------------------------------

/// Il comando del plugin: legge una nota e risponde. È di sola lettura, come
/// si conviene a un ping — e la lettura è ciò che il permesso `read-vault`
/// governa, cioè la capacità che la seconda prova toglie.
struct PingProvider;

impl CommandProvider for PingProvider {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(COMANDO, "Ping del plugin demo")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let testo = host.read_document(&DocId::new("Nota.md"))?;
        Ok(CommandOutcome::notify(format!(
            "pong: {} caratteri in Nota.md",
            testo.chars().count()
        )))
    }
}

/// Il plugin: manifest, attivazione, commiato e il corpo dei suoi job.
struct DemoPing {
    diario: Diario,
}

impl Plugin for DemoPing {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::new(ID, "Demo Ping")
            .granting(PluginPermissions::of(&[permission::READ_VAULT]))
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        // Il lavoro dell'attivazione che non ha bisogno di permessi: l'orologio
        // è una capacità senza permesso (§7.3), e un ping che non sapesse che
        // ore sono non sarebbe un ping. È anche ciò che tiene la seconda prova
        // in piedi: un `activate` che leggesse il vault fallirebbe **prima**
        // del cancello che si vuole provare.
        let adesso = host.now_unix_millis();
        self.diario
            .lock()
            .unwrap()
            .push(format!("mi attivo a {adesso}"));
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.diario.lock().unwrap().push("smetto".to_string());
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        _payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            "ping" => {
                host.report_progress(JobProgress {
                    done: 1,
                    total: Some(1),
                    label: Some("leggo Nota.md".to_string()),
                });
                let testo = host.read_document(&DocId::new("Nota.md"))?;
                Ok(serde_json::json!({
                    "nota": "Nota.md",
                    "caratteri": testo.chars().count(),
                }))
            }
            altro => Err(PluginError::UnknownJob(altro.into())),
        }
    }
}

/// Il bundle: manifest (con o senza permesso), fiducia, il corpo dei job e la
/// registrazione dei provider — il quarto passo del montaggio.
struct BundleDemoPing {
    diario: Diario,
    permessi: bool,
}

impl Bundle for BundleDemoPing {
    fn manifest(&self) -> PluginManifest {
        let mut manifest = PluginManifest::new(ID, "Demo Ping");
        if self.permessi {
            manifest = manifest.granting(PluginPermissions::of(&[permission::READ_VAULT]));
        }
        manifest
    }

    fn trust(&self) -> Trust {
        Trust::Community
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(DemoPing {
            diario: self.diario.clone(),
        })
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        let mut avvisi = Vec::new();
        if let Err(e) = ws.register_command_provider(ID, Box::new(PingProvider)) {
            avvisi.push(format!("comando: {e}"));
        }
        avvisi
    }
}

// --- le prove ---------------------------------------------------------------

/// Il giro intero del criterio M4: montare, vedere il comando, invocarlo,
/// fargli girare un job, smontare, e trovare `UnknownCommand` al posto del
/// comando.
#[test]
fn un_plugin_vivo_per_contratto_si_monta_vive_e_si_smonta() {
    let v = Vault::nuovo();
    let (host, eventi, diario) = banco(&v, true);

    // Montato: il comando è nel registro, il plugin è nell'inventario del §7.6
    // con il permesso dichiarato, e il registry lo possiede.
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        assert!(
            ws.commands().iter().any(|c| c.id == COMANDO),
            "il comando del plugin è nel registro"
        );
        let info = ws
            .plugins()
            .into_iter()
            .find(|p| p.id == ID)
            .expect("il plugin è nell'inventario del §7.6");
        assert!(
            info.permissions.enabled(permission::READ_VAULT),
            "il manifest dichiara `read-vault` e l'inventario lo mostra"
        );
        assert!(
            s.bundles().read().unwrap().ids().contains(&ID),
            "il registry possiede il bundle"
        );
    })
    .expect("aperto");

    // Il comando si invoca e risponde leggendo il vault.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let esito = ws
            .invoke_command(COMANDO, serde_json::json!(null), InvokeMode::Apply, Actor::User)
            .expect("il ping risponde");
        let messaggio = esito.notify.expect("il ping dice qualcosa");
        assert!(
            messaggio
                .as_literal()
                .is_some_and(|m| m.contains("pong")),
            "il ping risponde pong: {messaggio:?}"
        );
    })
    .expect("aperto");

    // Il job gira sul pool vero e torna con l'esito: ha letto la nota.
    chiedi(&host, "ping");
    let (job, result) = esito(&eventi);
    assert_eq!(job, "ping");
    let valore = result.expect("il job è riuscito");
    assert_eq!(valore["nota"], "Nota.md");
    assert!(
        valore["caratteri"].as_u64().unwrap() > 0,
        "il job ha letto davvero: {valore}"
    );

    // Smontato: il commiato è stato chiamato, il comando non c'è più, e
    // invocarlo è `UnknownCommand`.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errori = s.bundles().write().unwrap().unmount(&mut ws, ID);
        assert!(errori.is_empty(), "niente è andato storto: {errori:?}");
        assert!(
            !ws.commands().iter().any(|c| c.id == COMANDO),
            "il comando non c'è più"
        );
        let errore = ws
            .invoke_command(COMANDO, serde_json::json!(null), InvokeMode::Apply, Actor::User)
            .expect_err("il comando non esiste più");
        assert!(
            matches!(errore, PluginError::UnknownCommand(_)),
            "è un comando sconosciuto: {errore}"
        );
    })
    .expect("aperto");

    let righe = righe(&diario);
    assert_eq!(righe.len(), 2, "attivazione e commiato: {righe:?}");
    assert!(
        righe[0].starts_with("mi attivo"),
        "l'attivazione è avvenuta: {righe:?}"
    );
    assert_eq!(righe[1], "smetto", "il commiato è stato chiamato");

    host.close();
}

/// Il cancello del §7.3 dal lato di chi lo attraversa: lo stesso plugin, senza
/// `read-vault` nel manifest, si monta lo stesso — ma la prima lettura, dal
/// comando e dal job, riceve `PermissionDenied`.
#[test]
fn un_plugin_senza_il_permesso_vede_chiudersi_il_cancello() {
    let v = Vault::nuovo();
    let (host, eventi, _diario) = banco(&v, false);

    // Il comando c'è — il montaggio non dipende dal permesso — ma la lettura
    // che fa è negata: il cancello è davanti all'host, non alla registrazione.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errore = ws
            .invoke_command(COMANDO, serde_json::json!(null), InvokeMode::Apply, Actor::User)
            .expect_err("senza `read-vault` il ping non legge");
        assert!(
            matches!(&errore, PluginError::PermissionDenied(t)
                if t.as_literal().is_some_and(|m| m.contains("non ha dichiarato il permesso"))),
            "è il permesso a chiudere: {errore}"
        );
    })
    .expect("aperto");

    // Lo stesso cancello vale dentro un job: il job parte (gli eventi non hanno
    // permesso), ma la sua lettura riceve lo stesso rifiuto.
    chiedi(&host, "ping");
    let (job, result) = esito(&eventi);
    assert_eq!(job, "ping");
    let errore = result.expect_err("il job senza permesso non legge");
    assert!(
        matches!(&errore, PluginError::PermissionDenied(t)
            if t.as_literal().is_some_and(|m| m.contains("non ha dichiarato il permesso"))),
        "è il permesso a chiudere anche per il job: {errore}"
    );

    host.close();
}
