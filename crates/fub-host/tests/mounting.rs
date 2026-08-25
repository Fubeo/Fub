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
use fub_testkit::{Bench, Mounted};

// --- il banco ---------------------------------------------------------------

fn vault() -> Mounted {
    Bench::new().with_format(MarkdownProvider::boxed()).mounts()
}

type Journal = Arc<Mutex<Vec<String>>>;

fn lines(journal: &Journal) -> Vec<String> {
    journal.lock().unwrap().clone()
}

// --- una spia che è un bundle intero ----------------------------------------

/// Il plugin di un bundle di prova.
///
/// Nel `deactivate` **prova** due cose invece di limitarsi a segnare che è stato
/// chiamato: che l'host gli risponda ancora, e che i propri provider siano
/// ancora registrati. Sono le due proprietà che si perderebbero chiamandolo un
/// momento più tardi, e un diario che dicesse solo «chiamato» non se ne
/// accorgerebbe.
struct Spy {
    id: &'static str,
    journal: Journal,
    not_is_activates: bool,
}

impl Plugin for Spy {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(self.id, self.id)
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.journal
            .lock()
            .unwrap()
            .push(format!("{}: activating", self.id));
        if self.not_is_activates {
            return Err(PluginError::Internal("I will not activate".into()));
        }
        Ok(())
    }

    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let host_live = host.data_write("addio", b"1").is_ok();
        let provider_live = host
            .run_command(&format!("{}.greet", self.id), serde_json::json!({}))
            .is_ok();
        self.journal.lock().unwrap().push(format!(
            "{}: stopping (host={host_live}, provider={provider_live})",
            self.id
        ));
        Ok(())
    }
}

/// Un comando del bundle: serve a sapere, dall'interno del `deactivate`, se i
/// provider del bundle sono ancora nelle mani del kernel.
struct GreetingProvider(&'static str);

impl CommandProvider for GreetingProvider {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(format!("{}.greet", self.0), "Greet")]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::notify("hello"))
    }
}

/// L'orecchio del bundle: segna il momento in cui il vault annuncia di
/// chiudersi, che è ciò rispetto a cui va misurato l'ordine.
struct EventRecorder {
    id: &'static str,
    journal: Journal,
}

impl EventHandler for EventRecorder {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        if matches!(notice.event, Event::VaultClosed { .. }) {
            self.journal
                .lock()
                .unwrap()
                .push(format!("{}: vault closing", self.id));
        }
        Ok(())
    }
}

struct BundleSpy {
    id: &'static str,
    journal: Journal,
    abi: String,
    not_is_activates: bool,
    loses_a_piece: bool,
}

impl BundleSpy {
    fn new(id: &'static str, journal: &Journal) -> Self {
        BundleSpy {
            id,
            journal: journal.clone(),
            abi: fub_abi::traits::ABI_VERSION.to_string(),
            not_is_activates: false,
            loses_a_piece: false,
        }
    }

    /// Un bundle scritto contro un contratto che questo host non parla.
    fn speaking(mut self, abi: &str) -> Self {
        self.abi = abi.to_string();
        self
    }

    fn that_not_is_activates(mut self) -> Self {
        self.not_is_activates = true;
        self
    }

    /// Un bundle a cui il quarto passo lascia indietro un pezzo: registra il
    /// proprio comando **due volte**, e la seconda il kernel la rifiuta.
    ///
    /// È il caso vero in miniatura — un id doppio, un nome di view conteso —
    /// che il modulo dichiara di non voler far diventare uno smontaggio: il
    /// bundle resta montato meno un pezzo, e l'unica cosa che deve succedere è
    /// che qualcuno lo dica.
    fn that_leaves_back_a_piece(mut self) -> Self {
        self.loses_a_piece = true;
        self
    }
}

impl Bundle for BundleSpy {
    fn manifest(&self) -> PluginManifest {
        let mut manifest = PluginManifest::core(self.id, self.id);
        manifest.abi_version = self.abi.clone();
        manifest
    }

    fn trust(&self) -> Trust {
        Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(Spy {
            id: self.id,
            journal: self.journal.clone(),
            not_is_activates: self.not_is_activates,
        })
    }

    fn register(&self, ws: &mut Workspace) -> Vec<String> {
        let mut warnings = Vec::new();
        if let Err(and) = ws.register_command_provider(self.id, Box::new(GreetingProvider(self.id)))
        {
            warnings.push(format!("command: {and}"));
        }
        if let Err(and) = ws.register_event_handler(
            self.id,
            Box::new(EventRecorder {
                id: self.id,
                journal: self.journal.clone(),
            }),
        ) {
            warnings.push(format!("handler: {and}"));
        }
        if self.loses_a_piece {
            if let Err(and) =
                ws.register_command_provider(self.id, Box::new(GreetingProvider(self.id)))
            {
                warnings.push(format!("command: {and}"));
            }
        }
        warnings
    }
}

// --- le prove ---------------------------------------------------------------

/// La prima delle tre porte: la versione del contratto. `abi_compatible`
/// esisteva dal freeze e non la chiamava nessuno in produzione — la chiamava
/// solo il test che la definisce.
#[test]
fn a_bundle_that_speaks_a_other_contract_not_is_mounts() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.future", &journal).speaking("0.2.0");
    let error = registry
        .mount(&bundle, &mut ws)
        .expect_err("a minor version newer than the host is not served");

    assert!(
        matches!(error, BundleError::Abi { .. }),
        "it is the contract version that rejects it: {error}"
    );
    assert!(
        ws.plugins().is_empty(),
        "a rejected bundle does not appear in the §7.6 inventory"
    );
    assert!(
        ws.commands().is_empty(),
        "and registered nothing: the declaration never happened"
    );
    assert!(
        lines(&journal).is_empty(),
        "its plugin was not even constructed"
    );
    assert!(registry.ids().is_empty(), "e il registry non lo possiede");
}

/// La terza porta: l'attivazione. È l'unica che fallisce **dopo** aver lasciato
/// una traccia nel kernel, e per questo è l'unica che deve disfarla.
#[test]
fn a_activate_that_fails_not_leaves_a_plugin_declared() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.broken", &journal).that_not_is_activates();
    let error = registry
        .mount(&bundle, &mut ws)
        .expect_err("a failed activate is a bundle that does not exist");

    assert!(
        matches!(error, BundleError::Activation { .. }),
        "it is the activation that rejected it: {error}"
    );
    assert_eq!(
        lines(&journal),
        vec!["test.broken: activating"],
        "it tried, and did not reach the point of stopping"
    );
    assert!(
        ws.plugins().is_empty(),
        "the declaration just made was withdrawn: \"declared\" means \
         «montato», o l'inventario del §7.6 racconterebbe i tentativi"
    );
    assert!(
        ws.commands().is_empty(),
        "and providers were never registered"
    );
    assert!(registry.ids().is_empty());
}

/// Il punto della decisione: `Plugin::deactivate` arriva **mentre il bundle è
/// ancora intero**. Un momento più tardi — dopo `Workspace::deactivate_plugin`
/// — l'host intestato a quell'id nega tutto e i suoi provider non esistono più,
/// cioè il `host` nella firma di `deactivate` non servirebbe a niente.
#[test]
fn who_stops_has_again_the_host_and_the_own_provider() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.one", &journal);
    registry.mount(&bundle, &mut ws).expect("mounts");
    assert_eq!(registry.ids(), vec!["test.one"]);
    assert!(
        registry
            .body("test.one")
            .is_some_and(|p| p.manifest().id == "test.one"),
        "the registry OWNS the plugin: that is where the job runner will find the \
         code to execute"
    );

    let errors = registry.unmount(&mut ws, "test.one");
    assert!(errors.is_empty(), "nothing went wrong: {errors:?}");

    assert_eq!(
        lines(&journal),
        vec![
            "test.one: activating".to_string(),
            "test.one: stopping (host=true, provider=true)".to_string(),
        ],
        "the one who stops still writes and still calls its own commands"
    );
    assert!(
        ws.plugins().is_empty() && ws.commands().is_empty(),
        "and after that nothing of him remained"
    );
    assert!(
        registry.body("test.one").is_none(),
        "the registry no longer owns it"
    );
}

/// La chiusura del vault, con dentro il passo nuovo. L'ordine della decisione
/// 0029 non cambia — l'annuncio a tutti, poi ognuno che smette a rovescio della
/// dichiarazione — e il `Plugin::deactivate` di ogni bundle sta **dopo**
/// l'annuncio e **prima** che il kernel gli tolga tutto.
#[test]
fn closing_stops_bundles_in_reverse_while_they_are_still_intact() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    // Un plugin dichiarato **fuori** dal registry: il kernel accetta anche chi
    // non viene da qui (una feature montata a mano in un test), e la chiusura
    // non deve inciamparci.
    ws.register_core_feature("test.manual", "Manual")
        .expect("declared");
    for id in ["test.one", "test.two"] {
        let bundle = BundleSpy::new(id, &journal);
        registry.mount(&bundle, &mut ws).expect("mounts");
    }
    journal.lock().unwrap().clear();

    let errors = registry.close(&mut ws);
    assert!(errors.is_empty(), "nothing went wrong: {errors:?}");

    assert_eq!(
        lines(&journal),
        vec![
            "test.one: vault closing".to_string(),
            "test.two: vault closing".to_string(),
            "test.two: stopping (host=true, provider=true)".to_string(),
            "test.one: stopping (host=true, provider=true)".to_string(),
        ],
        "first it says to everyone while they are alive, then each stops in reverse"
    );
    assert!(ws.is_closed(), "the vault is closed");
    assert!(
        ws.plugins().is_empty(),
        "and nobody is registered anymore, not even who did not how from the registry"
    );
    assert!(registry.ids().is_empty(), "the registry is empty");
}

/// **Gli avvisi dell'organizzazione arrivano a chi monta**, e chi monta se ne fa
/// carico svuotandoli.
///
/// `Workspace::organization_warnings` è ciò che il kernel ha da dire quando il
/// sidecar dell'organizzazione — icone, appuntate, spazi, ordinamenti — non si è
/// potuto leggere all'apertura, o quando una migrazione non ha potuto seguire
/// una rinomina. Il suo doc lo scrive («chi monta le mostra, e svuotandole se ne
/// fa carico») e la [0038](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)
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
/// leggerebbe pieni per la ragione sbagliata.
#[test]
fn warnings_from_organization_are_forwarded_to_the_mount() {
    let config_dir = tempfile::tempdir().expect("tempdir");
    let config = camino::Utf8PathBuf::from_path_buf(config_dir.path().to_path_buf()).expect("utf8");
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("Nota.md"), "# Nota\n").expect("a notes");
    std::fs::create_dir_all(root.join(".fub")).expect("the vault folder");
    std::fs::write(
        root.join(".fub").join("workspace.json"),
        "{ \"icons\": {,} }",
    )
    .expect("an unreadable sidecar");

    let host = fub_host::Host::new()
        .with_watcher(Box::new(fub_host::NoWatcher))
        .with_config_dir(&config);
    host.open(&root)
        .expect("a broken sidecar does not prevent opening");
    let ws = host.workspace(None).expect("a vault is open");

    assert!(
        ws.read()
            .expect("the vault is not poisoned")
            .organization_warnings()
            .is_empty(),
        "the organization warnings are still in the workspace after mounting: \
         the one who mounts did not read them, and then nobody reads them — \
         the sidecar is unreadable and the user will never know"
    );

    let refuse = ws
        .read()
        .expect("the vault is not poisoned")
        .set_icon("Nota.md", Some("📌".into()))
        .expect_err("cannot write to what has not been read");
    assert!(
        refuse.contains("non lo sovrascrive"),
        "the sidecar was supposed to be unreadable, and this test proves \
         nothing more if it is not: {refuse}"
    );
}

/// **Chi accende un componente vede i pezzi che non sono entrati**, e li vede
/// nel log con davanti il nome del componente.
///
/// Il quarto passo del montaggio non è tutto-o-niente apposta: un provider che
/// non entra lascia il bundle in piedi meno quel provider, e il doc di
/// [`Bundle::register`] scrive da sempre che «chi monta ha un canale per dirlo».
/// Il canale c'era e la promessa no: gli avvisi tornavano al chiamante in un
/// `Ok(Vec<String>)`, e dei tre chiamanti che accendono un bundle solo uno li
/// leggeva — il bundle di core finiva in un `if let Err` che il ramo `Ok` non
/// lo guarda nemmeno, e `Host::set_plugin_enabled` in un `?` che non lega il
/// valore. Chi accendeva un componente dalle preferenze si ritrovava un
/// componente a metà e nessuna riga da nessuna parte.
///
/// Adesso la riga la scrive `BundleRegistry::mount`, che è il punto che tutti e
/// tre attraversano, e il payload non c'è più: scartarlo non è più esprimibile.
///
/// La cattura è **thread-local** (`fub_kernel::log::captured_default`), quindi
/// questo banco non vede le righe degli altri test che girano insieme a lui e
/// loro non vedono le sue.
/// loro non vedono le sue.
#[test]
fn turn_on_a_bundle_writes_in_the_log_the_pieces_that_not_are_entered() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    let bundle = BundleSpy::new("test.losing", &journal).that_leaves_back_a_piece();
    registry.remember(Arc::new(bundle));

    let (outcome, lines) =
        fub_kernel::log::captured_default(|| registry.enable(&mut ws, "test.losing"));
    outcome.expect("a provider that does not get in does not prevent the mount");

    assert!(
        registry.ids().contains(&"test.losing"),
        "the bundle is mounted: the fourth pass is not all-or-nothing"
    );

    let warnings: Vec<&String> = lines.iter().filter(|r| r.contains("test.losing")).collect();
    assert_eq!(
        warnings.len(),
        1,
        "one line only, with the component inside: {lines:?}"
    );
    assert!(
        warnings[0].contains("WARN") && warnings[0].contains("fub.host"),
        "it is a notice from the one who mounts: {}",
        warnings[0]
    );
    assert!(
        warnings[0].contains("command:"),
        "and says which piece did not get in: {}",
        warnings[0]
    );
}

/// Il verso opposto: un bundle a cui **non** manca niente non lascia righe.
///
/// Senza questa metà il banco di sopra passerebbe anche se `mount` scrivesse
/// una riga a ogni montaggio, e «qualcosa non è entrato» smetterebbe di essere
#[test]
fn a_whole_bundle_leaves_no_lines_in_the_log() {
    let mut ws = vault();
    let journal: Journal = Arc::default();
    let mut registry = BundleRegistry::new();

    registry.remember(Arc::new(BundleSpy::new("test.whole", &journal)));
    let (outcome, lines) =
        fub_kernel::log::captured_default(|| registry.enable(&mut ws, "test.whole"));
    outcome.expect("mounts");

    assert!(
        !lines.iter().any(|r| r.contains("test.whole")),
        "nothing was left out, and the one who mounts has nothing to say: {lines:?}"
    );
}
