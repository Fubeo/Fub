//! Gli **interruttori** del §11.1
//! ([decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)):
//! quello della feature e quello dell'host, che sono due cose diverse e vanno
//! provate diverse.
//!
//! - `versioning.enabled` è l'interruttore **della feature**: spenta si
//!   dichiara lo stesso e non registra niente (D7). «Dichiarato con zero
//!   registrazioni» è uno stato vero, ed è quello che l'inventario del §7.6
//!   mostra.
//! - `plugins.disabled` è l'interruttore **dell'host**: un bundle che ci
//!   compare non viene montato affatto — niente dichiarazione, niente
//!   inventario, e nemmeno le sue impostazioni esistono.
//!
//! E in mezzo la cosa che al §11.1 mancava davvero: **dove sta scritto fra un
//! avvio e l'altro**, e come si riaccende.

use camino::Utf8PathBuf;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::PluginError;
use fub_features::VERSIONING_ID;
use fub_host::{Host, NoWatcher};

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

fn headless() -> Host {
    Host::new().with_watcher(Box::new(NoWatcher))
}

/// Il livello macchina e il registro dei vault di un host **installato**, in
/// una cartella di prova: senza questa riga un test scriverebbe nella
/// configurazione di chi lo esegue.
fn installed(config: &Utf8PathBuf) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

/// Chi è dichiarato **nel kernel**, in ordine.
fn declared(host: &Host) -> Vec<String> {
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let mut ids: Vec<String> = ws.plugins().into_iter().map(|p| p.id).collect();
        ids.sort();
        ids
    })
    .expect("open")
}

#[test]
fn the_versioning_and_a_setting_and_not_a_variable_d_environment() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");

    // Acceso di default: è una rete di sicurezza, e una rete che va accesa a
    // mano non c'è quando serve.
    assert!(host.versions(None).is_ok(), "enabled by default");

    // Spegnerlo è scrivere una chiave — la stessa strada di un comando o di un
    // pannello — e non toccare l'ambiente del processo.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
            .expect("written");
    })
    .expect("open");
    host.close_vault(&v.root).expect("closed");

    let host = headless();
    host.open(&v.root).expect("reopens");
    assert!(
        host.versions(None).is_err(),
        "reopened, versioning is off: the value lives in the vault, not in the process"
    );
    // D7: **si dichiara lo stesso**. È lo stato che distingue «spento» da «non
    // c'è», ed è quello che il pannello dei plugin (20.1) mostrerà.
    assert!(
        declared(&host).contains(&VERSIONING_ID.to_string()),
        "disabled does not mean unmounted: {:?}",
        declared(&host)
    );
}

#[test]
fn a_component_off_not_is_mounts_at_all_and_is_turns_on_again() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");
    assert!(declared(&host).contains(&"fub.stats".to_string()));

    let problems = host
        .set_plugin_enabled(None, "fub.stats", false)
        .expect("disables");
    assert!(problems.is_empty(), "{problems:?}");
    assert!(
        !declared(&host).contains(&"fub.stats".to_string()),
        "disabled **by the host** means unmounted: no declaration, \
         no inventory"
    );
    // E l'inventario dei bundle continua a saperlo: «spento» e «non
    // installato» sono due stati diversi, e senza questo elenco il secondo si
    let inventory = host.bundles(None).expect("open");
    let stats = inventory
        .iter()
        .find(|b| b.id == "fub.stats")
        .expect("remains among the known");
    assert!(!stats.mounted);

    // Riaccenderlo lo rimonta: un interruttore che si può solo spegnere non è
    // un interruttore.
    host.set_plugin_enabled(None, "fub.stats", true)
        .expect("re-enables");
    assert!(declared(&host).contains(&"fub.stats".to_string()));
}

#[test]
fn shutdown_a_component_remains_written_between_a_startup_and_the_other() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");
    host.set_plugin_enabled(None, "fub.stats", false)
        .expect("disables");
    host.close_vault(&v.root).expect("closed");

    let host = headless();
    host.open(&v.root).expect("reopens");
    assert!(
        !declared(&host).contains(&"fub.stats".to_string()),
        "this is the piece §11.1 was missing: where to persist across restarts"
    );
    // E il valore è un'impostazione come le altre, leggibile dal canale dati.
    let IndexResult::Settings(entries) = host
        .with_session(None, |s| {
            s.workspace()
                .read()
                .unwrap()
                .query_index(IndexQuery::Settings { plugin: None })
                .expect("serve")
        })
        .expect("open")
    else {
        panic!("response off-topic");
    };
    let disabled = entries
        .iter()
        .find(|and| and.spec.key == "plugins.disabled")
        .expect("declared by the core bundle");
    assert_eq!(disabled.value, SettingValue::List(vec!["fub.stats".into()]));
}

/// **Un permesso negato sopravvive a chi lo aveva** (§23.17).
///
/// È il presidio più importante di questa voce, e prova una cosa che si vede
/// solo mettendo insieme due meccanismi che non si conoscono. La chiave con cui
/// si nega un permesso è dichiarata **dal componente a cui appartiene**, quindi
/// spegnere quel componente la fa sparire dallo schema; il valore però resta nel
/// file, perché togliere uno schema non è cancellare un valore. Se non fosse
/// così, spegnere e riaccendere un componente sarebbe il modo di **ridargli
/// tutto** — e sarebbe un giro che si fa con due clic, per sbaglio, senza che
/// niente lo dica.
///
/// Le tre righe si provano in fila: negare, spegnere e riaccendere, riaprire il
/// vault da capo.
#[test]
fn a_permission_denied_survives_to_the_shutdown_and_to_the_reopening() {
    use fub_abi::options::permission;
    use fub_abi::settings::permission_key;

    let v = Vault::new();
    let key = permission_key("fub.stats", permission::WRITE_VAULT);

    let host = headless();
    host.open(&v.root).expect("opens");
    host.with_session(None, |s| {
        s.workspace()
            .write()
            .unwrap()
            .set_setting(&key, SettingValue::Toggle(false))
            .expect("the key is declared")
    })
    .expect("open");
    assert!(!granted(&host, "fub.stats", permission::WRITE_VAULT));

    // Spento, il componente non è dichiarato: non ha permessi, e nemmeno la
    // chiave che li nega. Il valore però è già sul disco.
    host.set_plugin_enabled(None, "fub.stats", false)
        .expect("disables");
    host.set_plugin_enabled(None, "fub.stats", true)
        .expect("re-enables");
    assert!(
        !granted(&host, "fub.stats", permission::WRITE_VAULT),
        "re-enabling a component is not the way to give back what was \
         taken from it"
    );

    host.close_vault(&v.root).expect("closed");
    let host = headless();
    host.open(&v.root).expect("reopens");
    assert!(
        !granted(&host, "fub.stats", permission::WRITE_VAULT),
        "and it also holds across restarts, as with `plugins.disabled`"
    );
    // Le **altre** non le ha toccate nessuno: si nega un permesso per volta, e
    // negarne uno non è spegnere il componente.
    assert!(granted(&host, "fub.stats", permission::READ_VAULT));
}

/// Questo componente ha ancora questa famiglia? Si chiede alla **politica**, che
/// è ciò che il cancello legge davvero — non alla mappa del manifest, che non
/// cambia mai.
fn granted(host: &Host, plugin: &str, permission: &str) -> bool {
    use fub_kernel::{Capability, Policy};
    let family = Capability::ALL
        .into_iter()
        .find(|c| c.permission() == Some(permission))
        .expect("a permission that governs a capability");
    host.with_session(None, |s| {
        s.workspace()
            .read()
            .unwrap()
            .granted_policy(plugin)
            .denies(family)
            .is_none()
    })
    .expect("open")
}

/// **L'elenco dei permessi è lo stesso di qua e di là** (§23.17).
///
/// Terzo presidio della stessa specie, dopo il tema e la memoria, e con la posta
/// più alta dei tre. Le frasi che l'utente legge decidendo di cosa fidarsi le
/// scrive la **shell**, dal proprio catalogo, e non chi il permesso lo sta
/// chiedendo: è la riga di sicurezza di questa voce. Ma una frase per elenco
/// vuol dire due elenchi, e due elenchi divergono — e qui divergerebbero nel
/// verso peggiore, perché un permesso che il contratto conosce e la shell no è
/// un permesso **che nessuno mostra**, cioè esattamente il difetto da cui questa
/// voce è nata.
///
/// Il verso del controllo è quello utile, come per il tema: si legge l'elenco
/// **dal file della shell** e lo si confronta con quello del contratto. Al
/// contrario — cercare le stringhe di Rust dentro il TypeScript — passerebbe
/// anche trovandole in un commento.
#[test]
fn the_permissions_are_the_same_of_here_and_of_the() {
    let permissions_ts = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src/ui/permissions.ts");
    let source = std::fs::read_to_string(&permissions_ts).unwrap_or_else(|and| {
        panic!(
            "the shell no longer has {}: {and}",
            permissions_ts.display()
        )
    });

    let list = source
        .split_once("export const PERMISSIONS = [")
        .and_then(|(_, rest)| rest.split_once("] as const;"))
        .map(|(inside, _)| inside)
        .expect(
            "in `ui/permissions.ts` there is no longer an `export const PERMISSIONS = [ … ] as const;`: \
             or the list is called something else, or this guard is reading emptiness",
        );
    let from_the_shell: Vec<String> = list
        .lines()
        .filter_map(|row| {
            let row = row.trim().trim_end_matches(',');
            row.strip_prefix('"')?.strip_suffix('"').map(String::from)
        })
        .collect();

    let from_the_contract: Vec<String> = fub_abi::options::permission::ALL
        .iter()
        .map(|k| (*k).to_string())
        .collect();
    assert_eq!(
        from_the_shell, from_the_contract,
        "the shell and the contract do not have the same permission list. One more \
         more here is a phrase that will never be shown; one fewer is a \\
         permission that the manifest declares, that the gate honors, and that nobody \
         shown to who should accept it. **The order counts too**: it is \
         the order in which they are read."
    );
}

/// Il bundle che tiene l'elenco degli spenti non può essere fra gli spenti.
#[test]
fn the_core_not_is_turns_off() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");
    let error = host
        .set_plugin_enabled(None, "fub.core", false)
        .expect_err("cannot be disabled");
    assert!(
        matches!(error, PluginError::BadArgs(_)),
        "requesting to disable the core is a request to fix: {error}"
    );
    assert!(error.to_string().contains("fub.core"), "{error}");
}

/// I due cancelli si vedono meglio **sullo schema del core**, cioè sulle sole
/// due chiavi che esistono davvero oggi.
///
/// `plugins.disabled` non è scrivibile da un programma, ed è il caso più chiaro
/// che ci sia: un componente che potesse spegnere gli altri avrebbe potere di
/// veto su tutto ciò che gli sta accanto, compreso ciò che lo controlla.
/// `versioning.enabled` lo è, e la differenza fra le due è la voce.
/// `versioning.enabled` lo è, e la differenza fra le due è la voce.
#[test]
fn who_can_shutdown_the_other_not_and_a_program() {
    let core = fub_host::settings::core_settings();
    let disabled = core
        .iter()
        .find(|s| s.key == fub_host::settings::PLUGINS_DISABLED)
        .expect("the core declares it");
    assert!(
        !disabled.program_writable,
        "`{}` writable by a program would be a veto of every component on \
         every other",
        disabled.key
    );

    let versioning = fub_host::settings::versioning_settings();
    let enabled = versioning
        .iter()
        .find(|s| s.key == fub_host::settings::VERSIONING_ENABLED)
        .expect("versioning declares it");
    assert!(
        enabled.program_writable,
        "\"this vault is an archive: no versioning\" is the case the entry \
         opens, and it is reversible and does not concern privacy"
    );
}

#[test]
fn turn_on_a_component_that_not_exists_and_a_error_and_not_a_silence() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");
    let error = host
        .set_plugin_enabled(None, "com.acme.mai-seen", true)
        .expect_err("cannot enable what does not exist");
    assert!(
        matches!(error, PluginError::NotFound(_)),
        "\"re-enabled it\" and \"wrote the wrong ID\" must be two different \
         answers, and now they are in `kind`: {error}"
    );
    assert!(
        error.to_string().contains("com.acme.mai-seen"),
        "the error must name who was not found: {error}"
    );
}

/// Gli id che il file del vault dichiara spenti, **come li vede chi legge**.
fn disabled(host: &Host) -> Vec<String> {
    host.with_session(None, |s| {
        fub_host::settings::disabled_plugins(&s.workspace().read().unwrap())
    })
    .expect("open")
}

/// **Se la riga non si scrive, il componente non si spegne.**
///
/// Il difetto è scritto al contrario: si smontava per primo e si scriveva
/// `plugins.disabled` per ultimo, quindi una scrittura che non riusciva
/// lasciava il componente smontato *adesso* e acceso *nel file* — cioè uno
/// stato che alla prima riapertura si disfa da sé, senza dire niente a
/// nessuno. Adesso la mossa che può fallire sta davanti: `unmount` non
/// fallisce — raccoglie i guasti del commiato e li rende, ma smonta comunque —
/// quindi delle due metà solo una ha un modo di andare storta, e sta prima.
///
/// Il guasto è **iniettato, non aspettato**: al posto di `.fub/settings.json`
/// c'è una cartella, e un file che non si rilegge non lo si sovrascrive (§20.2).
/// La cartella resta lì per tutto il banco, quindi la rilettura sotto lucchetto
/// dice di no a ogni giro: ogni scrittura d'impostazione fallisce, sempre, senza
/// corse e senza attese.
#[test]
fn that_that_the_file_not_has_accepted_not_remains_off_in_memory() {
    let v = Vault::new();
    std::fs::create_dir_all(v.root.join(".fub").join("settings.json")).expect("the folder");

    let host = headless();
    host.open(&v.root)
        .expect("an unreadable settings file does not prevent opening");
    assert!(declared(&host).contains(&"fub.stats".to_string()));

    let error = host
        .set_plugin_enabled(None, "fub.stats", false)
        .expect_err("the line is not written, and the disable is not faked");

    assert!(
        declared(&host).contains(&"fub.stats".to_string()),
        "disabled in memory and enabled on disk is the state that must not exist: \
         if the line was not written, the component is still mounted ({error})"
    );
    let inventory = host.bundles(None).expect("open");
    assert!(
        inventory
            .iter()
            .find(|b| b.id == "fub.stats")
            .expect("remains among the known")
            .mounted,
        "e l'inventario says la stessa cosa del kernel"
    );
}

const BROKEN: &str = "test.non-si-mount";

/// Un bundle che **non si monta**, e che lo dichiara nel manifest: una major
/// del contratto che questo host non parla è il primo dei quattro passi di
/// `mount`, e cade sempre. Il guasto è costruito, non atteso.
/// `mount`, e cade sempre. Il guasto è costruito, non atteso.
struct BundleThatDoesNotMount;

impl fub_host::registry::Bundle for BundleThatDoesNotMount {
    fn manifest(&self) -> fub_abi::traits::PluginManifest {
        let mut manifest = fub_abi::traits::PluginManifest::core(BROKEN, "Does not mount");
        manifest.abi_version = "99.0.0".to_string();
        manifest
    }

    fn plugin(&self) -> Box<dyn fub_abi::traits::Plugin> {
        unreachable!("the mount stops at the contract version")
    }

    fn register(&self, _ws: &mut fub_kernel::Workspace) -> Vec<String> {
        Vec::new()
    }
}

/// **Accendere scrive ciò che l'utente vuole, anche se il montaggio non
/// riesce.**
///
/// È l'altra metà della voce, e l'unica in cui l'ordine è una scelta: qui le
/// mosse che possono fallire sono due, la scrittura e il montaggio. La riga va
/// per prima perché `plugins.disabled` è ciò che l'utente **vuole** — non a
/// caso non è scrivibile da un programma — e non lo specchio di ciò che è
/// montato adesso; e perché «scritto come acceso, non montato» è lo stato che
/// ogni avvio produce quando un bundle non si monta (`mount.rs` scrive
/// l'errore nel log e tira avanti), quindi il prossimo avvio ci riprova. Con
/// l'ordine vecchio, invece, il gesto dell'utente veniva dimenticato: il
/// montaggio falliva, la riga restava fra gli spenti, e alla riapertura del
#[test]
fn turning_on_records_intention_even_when_mounting_fails() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");
    host.with_session(None, |s| {
        s.bundles()
            .write()
            .unwrap()
            .remember(std::sync::Arc::new(BundleThatDoesNotMount));
    })
    .expect("open");

    // Prima si spegne — ed è un no-op sul montaggio, perché montato non lo è
    // mai stato: quello che conta è la riga che entra nel file.
    host.set_plugin_enabled(None, BROKEN, false)
        .expect("disables");
    assert!(disabled(&host).contains(&BROKEN.to_string()));

    // E poi si riaccende, e il montaggio non riesce. L'errore si dice — non si
    // finge che sia acceso — ma la riga se n'è andata lo stesso.
    let error = host
        .set_plugin_enabled(None, BROKEN, true)
        .expect_err("a contract this host does not speak does not mount");
    assert!(
        matches!(error, PluginError::Unserved(_)),
        "it is nobody's bug: this host does not speak that contract ({error})"
    );
    assert!(
        !disabled(&host).contains(&BROKEN.to_string()),
        "the mount failed, but \"enable it\" was the request: {:?}",
        disabled(&host)
    );

    // E sta **sul disco**, che è il punto della voce: riaperto il vault, la
    // riga non è tornata indietro.
    host.close_vault(&v.root).expect("closed");
    let host = headless();
    host.open(&v.root).expect("reopens");
    assert!(
        !disabled(&host).contains(&BROKEN.to_string()),
        "disk must not lag behind what the user requested: {:?}",
        disabled(&host)
    );
}

/// Il livello **macchina** è uno solo, e vive fuori dai vault: è la metà che
/// prima non esisteva affatto, e la ragione per cui il registro dei vault non
/// poteva nascere prima di questa voce.
#[test]
fn the_configuration_of_the_machine_and_a_for_all_the_vault_open() {
    let config = tempfile::tempdir().expect("tempdir");
    let config = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap();
    let one = Vault::new();
    let two = Vault::new();

    let host = installed(&config);
    host.open(&one.root).expect("opens");
    host.open(&two.root).expect("opens");

    // Una chiave di macchina, dichiarata da un plugin montato a mano su **un**
    // vault, scritta da lì.
    host.with_session(Some(one.root.as_str()), |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core("fub.tema", "Tema").configuring(vec![
                fub_abi::settings::SettingSpec::toggle("tema.scuro", "Scuro", false).for_machine(),
            ]),
            fub_kernel::Trust::Core,
        )
        .expect("declared");
        ws.set_setting("tema.scuro", SettingValue::Toggle(true))
            .expect("written");
    })
    .expect("open");

    // L'altro vault, che ha dichiarato la stessa chiave, vede lo stesso valore:
    // la configurazione della macchina è **una**, e N copie sarebbero N idee del
    // tema — con la seconda finestra che vince sulla prima senza saperlo.
    let read_value = host
        .with_session(Some(two.root.as_str()), |s| {
            let mut ws = s.workspace().write().unwrap();
            ws.register_plugin(
                fub_abi::traits::PluginManifest::core("fub.tema", "Tema").configuring(vec![
                    fub_abi::settings::SettingSpec::toggle("tema.scuro", "Scuro", false)
                        .for_machine(),
                ]),
                fub_kernel::Trust::Core,
            )
            .expect("declared");
            ws.setting("tema.scuro").expect("dichiarata")
        })
        .expect("open");
    assert_eq!(read_value, SettingValue::Toggle(true));

    // E sta nel file della macchina, non in nessuno dei due vault.
    assert!(config.join("settings.json").is_file());
    assert!(!one.root.join(".fub").join("settings.json").is_file());
}

/// Un elenco di vault non sta in nessun vault: è il §9.6 che la 0029 non poteva
/// chiudere, perché il livello in cui vive non esisteva.
#[test]
fn open_a_vault_the_does_enter_between_the_known_and_there_remains() {
    let config = tempfile::tempdir().expect("tempdir");
    let config = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap();
    let v = Vault::new();

    let host = installed(&config);
    assert!(host.known_vaults().is_empty());
    host.open(&v.root).expect("opens");
    let known = host.known_vaults();
    assert_eq!(known.len(), 1);
    assert!(known[0].last_opened > 0, "l'ordine dei recenti");
    host.set_vault_favorite(&v.root, true).expect("appuntato");

    // Un altro avvio: il registro è nel livello macchina, quindi lo ritrova.
    let host = installed(&config);
    let known = host.known_vaults();
    assert_eq!(known.len(), 1);
    assert!(known[0].favorite);

    // Dimenticare toglie dall'elenco **e non tocca il disco**. Si dimentica per
    // una forma **non canonica** della stessa radice, che è il caso vero: la
    // shell manda il path che l'utente ha scelto, e su macOS o Windows quello
    // non è quasi mai la forma con cui l'apertura ha scritto la voce
    // (`/var` → `/private/var`, il prefisso UNC). Su Linux le due forme
    // coincidono, ed è per questo che qui se ne costruisce una a mano: un test
    // che passasse `v.root` proverebbe la stessa cosa su un solo sistema.
    let name = v.root.file_name().expect("il tempdir ha un name");
    let crooked = v.root.join("..").join(name);
    host.forget_vault(&crooked).expect("dimenticato");
    assert!(host.known_vaults().is_empty());
    assert!(v.root.join("Nota.md").is_file());
}

/// Un host senza installazione non scrive da nessuna parte: è il default, ed è
/// ciò che permette a questa suite di girare senza toccare la configurazione di
/// chi la esegue.
#[test]
fn a_host_without_installation_remembers_only_until_lasts() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("opens");
    assert_eq!(host.known_vaults().len(), 1, "in memory yes");

    let other = headless();
    assert!(
        other.known_vaults().is_empty(),
        "e su disco no: un test non scrive nel profilo di chi lo esegue"
    );
}

/// La chiave del tema è nominata **da due parti** (§12.4), e questo è il filo
/// che le tiene insieme.
///
/// `appearance.theme` esiste qui, in `core_settings()`; ma chi la legge è la
/// shell, che è TypeScript e non può importare una costante Rust — quindi se
/// la riscrive (`frontend/src/theme/theme.ts`). Due stringhe uguali per
/// convenzione sono due stringhe che divergono, e questa divergerebbe **in
/// silenzio**: l'impostazione resterebbe nel pannello, si potrebbe cambiare, e
/// non succederebbe niente. Nessun compilatore ha modo di accorgersene, il che
/// è esattamente la condizione in cui la 0014 chiede un presidio meccanico.
///
/// Il verso del controllo è quello utile: si legge la chiave **dal file della
/// shell** e si chiede al core se la conosce. Al contrario — cercare la
/// stringa di Rust dentro il TypeScript — passerebbe anche trovandola in un
/// commento.
#[test]
fn the_key_of_the_theme_and_the_same_of_here_and_of_the() {
    let theme_ts =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src/theme/theme.ts");
    let source = std::fs::read_to_string(&theme_ts)
        .unwrap_or_else(|and| panic!("the shell no longer has {}: {and}", theme_ts.display()));

    let declared = source
        .lines()
        .find_map(|row| {
            row.strip_prefix("export const THEME_KEY = \"")?
                .strip_suffix("\";")
        })
        .expect(
            "in `theme/theme.ts` there is no longer a line `export const THEME_KEY = \"…\";`: \
             or the key is called something else, or this guard is reading emptiness",
        )
        .to_string();

    let core = fub_host::settings::core_settings();
    let keys: Vec<&str> = core.iter().map(|s| s.key.as_str()).collect();
    assert!(
        keys.contains(&declared.as_str()),
        "the shell reads the setting \"{declared}\", which the core does not declare: \
         the theme could be changed from the panel without anything changing. \
         Declared keys are {keys:?}"
    );
    assert_eq!(
        declared,
        fub_host::settings::APPEARANCE_THEME,
        "the shell and the core name two different keys"
    );
}

/// Come il tema, e per una posta più alta: l'interruttore della **memoria**
/// (§21.7) è nominato da due parti, e se le due stringhe divergono la casella
/// resta nel pannello, si lascia spegnere, e non spegne niente.
///
/// La differenza col tema è cosa si perde quando il filo si rompe. Un tema che
/// non cambia lo si vede subito e si riprova; una memoria che continua a
/// scrivere dopo che qualcuno l'ha spenta non dà **nessun** segnale — e ciò che
/// resta sul disco nel frattempo è precisamente il dato che quella casella
/// prometteva di non tenere. Un interruttore di privacy che non comanda niente
/// è peggio di un interruttore che non c'è, perché è una promessa.
/// è peggio di un interruttore che non c'è, perché è una promessa.
#[test]
fn the_key_of_the_memory_and_the_same_of_here_and_of_the() {
    let recent_ts =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src/state/recent.ts");
    let source = std::fs::read_to_string(&recent_ts)
        .unwrap_or_else(|and| panic!("the shell no longer has {}: {and}", recent_ts.display()));

    let declared = source
        .lines()
        .find_map(|row| {
            row.strip_prefix("export const HISTORY_KEY = \"")?
                .strip_suffix("\";")
        })
        .expect(
            "in `state/recent.ts` there is no longer a line \
             `export const HISTORY_KEY = \"…\";`: or the key is called something \
             else, or this guard is reading emptiness",
        )
        .to_string();

    let core = fub_host::settings::core_settings();
    let keys: Vec<&str> = core.iter().map(|s| s.key.as_str()).collect();
    assert!(
        keys.contains(&declared.as_str()),
        "the shell reads the setting \"{declared}\", which the core does not declare: \
         the history of what you search for could be turned off from the panel without \
         anything turning off. Declared keys are {keys:?}"
    );
    assert_eq!(
        declared,
        fub_host::settings::HISTORY_ENABLED,
        "the shell and the core name two different keys"
    );
}

/// E non è scrivibile da un programma, che qui è la riga della
/// [0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md): *le
/// impostazioni di privacy e dell'AI non stanno fra quelle*.
///
/// La differenza con `versioning.enabled`, che invece lo è, non è la
/// reversibilità: è che un versioning riacceso da un profilo di vault fa una
/// cosa in più e visibile, mentre una memoria riaccesa da un componente comincia
/// a **raccogliere** — e la si scopre quando è già lunga.
#[test]
fn who_can_turn_on_again_the_memory_not_and_a_program() {
    let core = fub_host::settings::core_settings();
    let memory = core
        .iter()
        .find(|s| s.key == fub_host::settings::HISTORY_ENABLED)
        .expect("the core declares it");
    assert!(
        !memory.program_writable,
        "`{}` scrivibile da un programma sarebbe un componente che si riaccende \
         on its own the trace of what you search for",
        memory.key
    );
}

/// La finestra del registro **pota davvero**, e subito: chi la stringe lo fa
/// per far cadere ciò che c'è adesso, non ciò che ci sarà.
///
/// Il banco fabbrica il registro a mano perché ciò che deve invecchiare è il
/// campo `at` di una riga, e l'unico modo onesto di avere una riga vecchia in un
/// test è scriverla vecchia — l'alternativa sarebbe muovere l'orologio, cioè
/// presidiare il banco invece del kernel.
#[test]
fn the_window_of_the_record_does_falls_the_rows_old() {
    let v = Vault::new();
    let old = 30 * 86_400_000u64;
    let row = |at: u64, doc: &str| {
        format!(
            "{{\"v\":1,\"at\":{at},\"origin\":{{\"actor\":{{\"kind\":\"user\"}},\"batch\":null}},\
             \"writer\":\"x\",\"op\":{{\"op\":\"renamed\",\"from\":\"{doc}\",\"to\":\"{doc}2\"}}}}\n"
        )
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after 1970")
        .as_millis() as u64;
    std::fs::create_dir_all(v.root.join(".fub")).expect("the folder");
    std::fs::write(
        v.root.join(".fub/journal.jsonl"),
        format!("{}{}", row(now - old, "vecchia.md"), row(now, "new.md")),
    )
    .expect("the journal");

    let host = headless();
    host.open(&v.root).expect("opens");

    // Il default è **per sempre**: un registro autorevole non si accorcia
    // perché è arrivato un aggiornamento.
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        assert_eq!(
            ws.journal().expect("journal").records.len(),
            2,
            "zero days = forever, and no line drops by itself"
        );
    })
    .expect("open");

    // Sette giorni: quella di un mese fa cade, l'altra resta.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.set_setting(
            fub_kernel::journal::RETENTION_DAYS,
            fub_abi::settings::SettingValue::Number(7.0),
        )
        .expect("the key is declared by the core");
        let records = ws.journal().expect("journal").records;
        assert_eq!(
            records.len(),
            1,
            "the line outside the window drops as soon as the window is written"
        );
        assert!(
            format!("{:?}", records[0].op).contains("new.md"),
            "and the one that drops is the old one: {:?}",
            records[0].op
        );
    })
    .expect("open");

    // **E vale anche all'apertura**, non solo quando la si cambia. È l'altra
    // metà, ed è quella che serve davvero: la finestra la si scrive una volta e
    // poi si aprono i vault per anni. Il registro si riempie di nuovo di righe
    // vecchie con la chiave **già** scritta, e a un'apertura pulita devono
    // cadere da sole.
    //
    // Senza questo pezzo il ramo che pota alla dichiarazione dello schema non
    // sarebbe presidiato da niente — verificato togliendolo e non vedendo
    std::fs::write(
        v.root.join(".fub/journal.jsonl"),
        format!(
            "{}{}",
            row(now - old, "rivecchia.md"),
            row(now, "rinuova.md")
        ),
    )
    .expect("the journal");

    let host = headless();
    host.open(&v.root).expect("reopens");
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let records = ws.journal().expect("journal").records;
        assert_eq!(
            records.len(),
            1,
            "the window written yesterday prunes at today's open: {records:?}"
        );
        assert!(
            format!("{:?}", records[0].op).contains("rinuova.md"),
            "and the old one drops, not the other: {:?}",
            records[0].op
        );
    })
    .expect("open");
}

/// E la finestra non è scrivibile da un programma, per la ragione della
/// memoria qui sopra letta al contrario: un componente che potesse **allungare**
/// la conservazione dei path dell'utente lo farebbe da dietro un interruttore
#[test]
fn who_can_extend_the_window_of_the_record_not_and_a_program() {
    let window = fub_host::settings::core_settings()
        .into_iter()
        .find(|s| s.key == fub_kernel::journal::RETENTION_DAYS)
        .expect("the core mounts it");
    assert!(
        !window.program_writable,
        "`{}` writable by a program would be a component that extends on its own \
         the trace of what you touched",
        window.key
    );
    // E ha un massimo: un estremo che non si può scrivere è meglio di un numero
    // che promette una scadenza e non ne ha una.
    assert!(
        matches!(
            window.kind,
            fub_abi::settings::SettingKind::Number {
                default: 0.0,
                min: Some(0.0),
                max: Some(_)
            }
        ),
        "the window is a number with bounds, and its default is \"forever\": {:?}",
        window.kind
    );
}
