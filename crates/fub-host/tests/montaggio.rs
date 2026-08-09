//! **Chi possiede i bundle** (§9.3, decisione 0031): come si monta un bundle,
//! cosa succede quando uno dei passi dice di no, e in che momento chi smette
//! viene avvisato.
//!
//! Prima di questa decisione le feature erano cablate a mano in `mount`, e tre
//! cose non avevano un presidio perché non avevano un chiamante: la versione del
//! contratto (`abi_compatible` non la chiedeva nessuno in produzione),
//! `Plugin::activate` e `Plugin::deactivate`. Le prove qui sotto sono quelle tre
//! più la sola che conta davvero per chi scriverà un plugin: **quando ti dico
//! che stai smettendo, hai ancora tutto** — l'host vivo e i tuoi provider
//! registrati.
//!
//! La spia è un bundle intero e non un plugin nudo: un `Plugin`, un
//! `CommandProvider` e un `EventHandler`, cioè le tre cose che un bundle vero
//! porta e che devono sparire insieme a lui.

use std::sync::{Arc, Mutex};

use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::traits::{CommandProvider, EventHandler, HostApi, Plugin, PluginManifest};
use fub_abi::PluginError;
use fub_format_markdown::MarkdownProvider;
use fub_host::registry::{Bundle, BundleError, BundleRegistry};
use fub_kernel::{Trust, Workspace};
use fub_testkit::{Banco, Montato};

// --- il banco ---------------------------------------------------------------

fn vault() -> Montato {
    Banco::nuovo()
        .con_formato(MarkdownProvider::boxed())
        .monta()
}

type Diario = Arc<Mutex<Vec<String>>>;

fn righe(diario: &Diario) -> Vec<String> {
    diario.lock().unwrap().clone()
}

// --- una spia che è un bundle intero ----------------------------------------

/// Il plugin di un bundle di prova.
///
/// Nel `deactivate` **prova** due cose invece di limitarsi a segnare che è stato
/// chiamato: che l'host gli risponda ancora, e che i propri provider siano
/// ancora registrati. Sono le due proprietà che si perderebbero chiamandolo un
/// momento più tardi, e un diario che dicesse solo «chiamato» non se ne
/// accorgerebbe.
struct Spia {
    id: &'static str,
    diario: Diario,
    non_si_attiva: bool,
}

impl Plugin for Spia {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.id)
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.diario
            .lock()
            .unwrap()
            .push(format!("{}: mi attivo", self.id));
        if self.non_si_attiva {
            return Err(PluginError::Internal("non mi attivo".into()));
        }
        Ok(())
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let host_vivo = host.data_write("addio", b"1").is_ok();
        let provider_vivi = host
            .run_command(&format!("{}.saluta", self.id), serde_json::json!({}))
            .is_ok();
        self.diario.lock().unwrap().push(format!(
            "{}: smetto (host={host_vivo}, provider={provider_vivi})",
            self.id
        ));
        Ok(())
    }
}

/// Un comando del bundle: serve a sapere, dall'interno del `deactivate`, se i
/// provider del bundle sono ancora nelle mani del kernel.
struct Saluto(&'static str);

impl CommandProvider for Saluto {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(format!("{}.saluta", self.0), "Saluta")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::notify("ciao"))
    }
}

/// L'orecchio del bundle: segna il momento in cui il vault annuncia di
/// chiudersi, che è ciò rispetto a cui va misurato l'ordine.
struct Orecchio {
    id: &'static str,
    diario: Diario,
}

impl EventHandler for Orecchio {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        if matches!(notice.event, Event::VaultClosed { .. }) {
            self.diario
                .lock()
                .unwrap()
                .push(format!("{}: il vault si chiude", self.id));
        }
        Ok(())
    }
}

struct BundleSpia {
    id: &'static str,
    diario: Diario,
    abi: String,
    non_si_attiva: bool,
}

impl BundleSpia {
    fn nuovo(id: &'static str, diario: &Diario) -> Self {
        BundleSpia {
            id,
            diario: diario.clone(),
            abi: fub_abi::traits::ABI_VERSION.to_string(),
            non_si_attiva: false,
        }
    }

    /// Un bundle scritto contro un contratto che questo host non parla.
    fn parlando(mut self, abi: &str) -> Self {
        self.abi = abi.to_string();
        self
    }

    fn che_non_si_attiva(mut self) -> Self {
        self.non_si_attiva = true;
        self
    }
}

impl Bundle for BundleSpia {
    fn manifest(&self) -> PluginManifest {
        let mut manifest = PluginManifest::core(self.id, self.id);
        manifest.abi_version = self.abi.clone();
        manifest
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Spia {
            id: self.id,
            diario: self.diario.clone(),
            non_si_attiva: self.non_si_attiva,
        })
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        let mut avvisi = Vec::new();
        if let Err(e) = ws.register_command_provider(self.id, Box::new(Saluto(self.id))) {
            avvisi.push(format!("comando: {e}"));
        }
        if let Err(e) = ws.register_event_handler(
            self.id,
            Box::new(Orecchio {
                id: self.id,
                diario: self.diario.clone(),
            }),
        ) {
            avvisi.push(format!("handler: {e}"));
        }
        avvisi
    }
}

// --- le prove ---------------------------------------------------------------

/// La prima delle tre porte: la versione del contratto. `abi_compatible`
/// esisteva dal freeze e non la chiamava nessuno in produzione — la chiamava
/// solo il test che la definisce.
#[test]
fn un_bundle_che_parla_un_altro_contratto_non_si_monta() {
    let mut ws = vault();
    let diario: Diario = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpia::nuovo("test.futuro", &diario).parlando("0.2.0");
    let errore = registry
        .mount(&bundle, &mut ws)
        .expect_err("una minor più nuova di quella dell'host non si serve");

    assert!(
        matches!(errore, BundleError::Abi { .. }),
        "è la versione del contratto a rifiutarlo: {errore}"
    );
    assert!(
        ws.plugins().is_empty(),
        "un bundle rifiutato non compare nell'inventario del §7.6"
    );
    assert!(
        ws.commands().is_empty(),
        "e non ha registrato niente: la dichiarazione non è mai avvenuta"
    );
    assert!(
        righe(&diario).is_empty(),
        "il suo plugin non è nemmeno stato costruito"
    );
    assert!(registry.ids().is_empty(), "e il registry non lo possiede");
}

/// La terza porta: l'attivazione. È l'unica che fallisce **dopo** aver lasciato
/// una traccia nel kernel, e per questo è l'unica che deve disfarla.
#[test]
fn un_activate_che_fallisce_non_lascia_un_plugin_dichiarato() {
    let mut ws = vault();
    let diario: Diario = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpia::nuovo("test.rotto", &diario).che_non_si_attiva();
    let errore = registry
        .mount(&bundle, &mut ws)
        .expect_err("un activate fallito è un bundle che non c'è");

    assert!(
        matches!(errore, BundleError::Activation { .. }),
        "è l'attivazione ad averlo rifiutato: {errore}"
    );
    assert_eq!(
        righe(&diario),
        vec!["test.rotto: mi attivo"],
        "ci ha provato, e non è arrivato a smettere"
    );
    assert!(
        ws.plugins().is_empty(),
        "la dichiarazione appena fatta è stata ritirata: «dichiarato» vuol dire \
         «montato», o l'inventario del §7.6 racconterebbe i tentativi"
    );
    assert!(
        ws.commands().is_empty(),
        "e i provider non sono mai stati registrati"
    );
    assert!(registry.ids().is_empty());
}

/// Il punto della decisione: `Plugin::deactivate` arriva **mentre il bundle è
/// ancora intero**. Un momento più tardi — dopo `Workspace::deactivate_plugin`
/// — l'host intestato a quell'id nega tutto e i suoi provider non esistono più,
/// cioè il `host` nella firma di `deactivate` non servirebbe a niente.
#[test]
fn chi_smette_ha_ancora_lhost_e_i_propri_provider() {
    let mut ws = vault();
    let diario: Diario = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpia::nuovo("test.uno", &diario);
    let avvisi = registry.mount(&bundle, &mut ws).expect("si monta");
    assert!(avvisi.is_empty(), "niente è rimasto fuori: {avvisi:?}");
    assert_eq!(registry.ids(), vec!["test.uno"]);
    assert!(
        registry
            .body("test.uno")
            .is_some_and(|p| p.manifest().id == "test.uno"),
        "il registry POSSIEDE il plugin: è dove il runner dei job troverà il \
         corpo da eseguire"
    );

    let errori = registry.unmount(&mut ws, "test.uno");
    assert!(errori.is_empty(), "niente è andato storto: {errori:?}");

    assert_eq!(
        righe(&diario),
        vec![
            "test.uno: mi attivo".to_string(),
            "test.uno: smetto (host=true, provider=true)".to_string(),
        ],
        "chi smette scrive ancora e chiama ancora i propri comandi"
    );
    assert!(
        ws.plugins().is_empty() && ws.commands().is_empty(),
        "e dopo non è rimasto niente di lui"
    );
    assert!(
        registry.body("test.uno").is_none(),
        "il registry non lo possiede più"
    );
}

/// La chiusura del vault, con dentro il passo nuovo. L'ordine della decisione
/// 0029 non cambia — l'annuncio a tutti, poi ognuno che smette a rovescio della
/// dichiarazione — e il `Plugin::deactivate` di ogni bundle sta **dopo**
/// l'annuncio e **prima** che il kernel gli tolga tutto.
#[test]
fn chiudere_ferma_i_bundle_a_rovescio_e_mentre_sono_ancora_interi() {
    let mut ws = vault();
    let diario: Diario = Arc::default();
    let mut registry = BundleRegistry::new();

    // Un plugin dichiarato **fuori** dal registry: il kernel accetta anche chi
    // non viene da qui (una feature montata a mano in un test), e la chiusura
    // non deve inciamparci.
    ws.register_core_feature("test.mano", "A mano")
        .expect("dichiarato");
    for id in ["test.uno", "test.due"] {
        let bundle = BundleSpia::nuovo(id, &diario);
        registry.mount(&bundle, &mut ws).expect("si monta");
    }
    diario.lock().unwrap().clear();

    let errori = registry.close(&mut ws);
    assert!(errori.is_empty(), "niente è andato storto: {errori:?}");

    assert_eq!(
        righe(&diario),
        vec![
            "test.uno: il vault si chiude".to_string(),
            "test.due: il vault si chiude".to_string(),
            "test.due: smetto (host=true, provider=true)".to_string(),
            "test.uno: smetto (host=true, provider=true)".to_string(),
        ],
        "prima si dice a tutti mentre sono vivi, poi ognuno smette a rovescio"
    );
    assert!(ws.is_closed(), "il vault è chiuso");
    assert!(
        ws.plugins().is_empty(),
        "e non è registrato più nessuno, nemmeno chi non veniva dal registry"
    );
    assert!(registry.ids().is_empty(), "il registry è vuoto");
}

/// **Gli avvisi dell'organizzazione arrivano a chi monta**, e chi monta se ne fa
/// carico svuotandoli.
///
/// `Workspace::organization_warnings` è ciò che il kernel ha da dire quando il
/// sidecar dell'organizzazione — icone, appuntate, spazi, ordinamenti — non si è
/// potuto leggere all'apertura, o quando una migrazione non ha potuto seguire
/// una rinomina. Il suo doc lo scrive («chi monta le mostra, e svuotandole se ne
/// fa carico») e la [0038](../../../docs/decisions/0038-il-kernel-possiede-il-sidecar.md)
/// pure («la rinomina vale, l'icona resta indietro, e qualcuno lo dice»), ma
/// nessuno fuori dai banchi le chiedeva: erano l'unica delle quattro famiglie di
/// avvisi del workspace a non passare dal blocco di `mount` che legge le altre
/// tre — impostazioni, stato per-documento, `kind` senza renderer.
///
/// Le due asserzioni si tengono per mano e da sole non provano niente. Che gli
/// avvisi siano **vuoti** dopo l'apertura è anche lo stato di un vault in cui
/// non è andato storto niente; che il sidecar sia rotto lo dice il rifiuto di
/// `set_icon`, che è la prova che quel file è stato letto e giudicato
/// illeggibile — cioè che un avviso c'è stato. Insieme dicono l'unica cosa che
/// si voleva dire: c'era, e se l'è preso il montaggio.
///
/// L'ordine conta e non è una comodità: `set_icon` va **dopo**, perché un
/// rifiuto può a sua volta annotare, e chiedere gli avvisi dopo di lui li
/// leggerebbe pieni per la ragione sbagliata.
#[test]
fn chi_monta_si_prende_gli_avvisi_dell_organizzazione() {
    let casa = tempfile::tempdir().expect("tempdir");
    let config = camino::Utf8PathBuf::from_path_buf(casa.path().to_path_buf()).expect("utf8");
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("una nota");
    std::fs::create_dir_all(root.join(".fub")).expect("la cartella del vault");
    std::fs::write(
        root.join(".fub").join("workspace.json"),
        "{ \"icons\": {,} }",
    )
    .expect("un sidecar che non si legge");

    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_config_dir(&config);
    host.open(&root)
        .expect("un sidecar rotto non impedisce di aprire");
    let ws = host.workspace(None).expect("il vault è aperto");

    assert!(
        ws.read()
            .expect("il vault non è avvelenato")
            .organization_warnings()
            .is_empty(),
        "gli avvisi dell'organizzazione sono ancora nel workspace dopo il \
         montaggio: chi monta non li ha letti, e allora non li legge nessuno — \
         il sidecar è illeggibile e l'utente non lo saprà mai"
    );

    let rifiuto = ws
        .read()
        .expect("il vault non è avvelenato")
        .set_icon("Nota.md", Some("📌".into()))
        .expect_err("non si scrive su ciò che non si è letto");
    assert!(
        rifiuto.contains("non lo sovrascrive"),
        "il sidecar doveva essere illeggibile, e questa prova non prova più \
         niente se non lo è: {rifiuto}"
    );
}
