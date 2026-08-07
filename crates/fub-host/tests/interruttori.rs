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
fn installato(config: &Utf8PathBuf) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

/// Chi è dichiarato **nel kernel**, in ordine.
fn dichiarati(host: &Host) -> Vec<String> {
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let mut ids: Vec<String> = ws.plugins().into_iter().map(|p| p.id).collect();
        ids.sort();
        ids
    })
    .expect("aperto")
}

#[test]
fn il_versioning_e_una_impostazione_e_non_una_variabile_d_ambiente() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");

    // Acceso di default: è una rete di sicurezza, e una rete che va accesa a
    // mano non c'è quando serve.
    assert!(host.versions(None).is_ok(), "acceso di default");

    // Spegnerlo è scrivere una chiave — la stessa strada di un comando o di un
    // pannello — e non toccare l'ambiente del processo.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.set_setting("versioning.enabled", SettingValue::Toggle(false))
            .expect("scritto");
    })
    .expect("aperto");
    host.close_vault(&v.root).expect("chiuso");

    let host = headless();
    host.open(&v.root).expect("si riapre");
    assert!(
        host.versions(None).is_err(),
        "riaperto, il versioning è spento: il valore vive nel vault, non nel processo"
    );
    // D7: **si dichiara lo stesso**. È lo stato che distingue «spento» da «non
    // c'è», ed è quello che il pannello dei plugin (20.1) mostrerà.
    assert!(
        dichiarati(&host).contains(&VERSIONING_ID.to_string()),
        "spento non vuol dire smontato: {:?}",
        dichiarati(&host)
    );
}

#[test]
fn un_componente_spento_non_si_monta_affatto_e_si_riaccende() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");
    assert!(dichiarati(&host).contains(&"fub.stats".to_string()));

    let problemi = host
        .set_plugin_enabled(None, "fub.stats", false)
        .expect("si spegne");
    assert!(problemi.is_empty(), "{problemi:?}");
    assert!(
        !dichiarati(&host).contains(&"fub.stats".to_string()),
        "spento **dall'host** vuol dire smontato: niente dichiarazione, \
         niente inventario"
    );
    // E l'inventario dei bundle continua a saperlo: «spento» e «non
    // installato» sono due stati diversi, e senza questo elenco il secondo si
    // mangerebbe il primo.
    let inventario = host.bundles(None).expect("aperto");
    let stats = inventario
        .iter()
        .find(|b| b.id == "fub.stats")
        .expect("resta fra i conosciuti");
    assert!(!stats.mounted);

    // Riaccenderlo lo rimonta: un interruttore che si può solo spegnere non è
    // un interruttore.
    host.set_plugin_enabled(None, "fub.stats", true)
        .expect("si riaccende");
    assert!(dichiarati(&host).contains(&"fub.stats".to_string()));
}

#[test]
fn spegnere_un_componente_resta_scritto_fra_un_avvio_e_l_altro() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");
    host.set_plugin_enabled(None, "fub.stats", false)
        .expect("si spegne");
    host.close_vault(&v.root).expect("chiuso");

    let host = headless();
    host.open(&v.root).expect("si riapre");
    assert!(
        !dichiarati(&host).contains(&"fub.stats".to_string()),
        "è il pezzo che al §11.1 mancava: dove stare scritto fra un avvio e l'altro"
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
        .expect("aperto")
    else {
        panic!("risposta fuori tema");
    };
    let spenti = entries
        .iter()
        .find(|e| e.spec.key == "plugins.disabled")
        .expect("dichiarata dal bundle di core");
    assert_eq!(spenti.value, SettingValue::List(vec!["fub.stats".into()]));
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
fn un_permesso_negato_sopravvive_allo_spegnimento_e_alla_riapertura() {
    use fub_abi::options::permission;
    use fub_abi::settings::permission_key;

    let v = Vault::new();
    let chiave = permission_key("fub.stats", permission::WRITE_VAULT);

    let host = headless();
    host.open(&v.root).expect("si apre");
    host.with_session(None, |s| {
        s.workspace()
            .write()
            .unwrap()
            .set_setting(&chiave, SettingValue::Toggle(false))
            .expect("la chiave è dichiarata")
    })
    .expect("aperto");
    assert!(!concessa(&host, "fub.stats", permission::WRITE_VAULT));

    // Spento, il componente non è dichiarato: non ha permessi, e nemmeno la
    // chiave che li nega. Il valore però è già sul disco.
    host.set_plugin_enabled(None, "fub.stats", false)
        .expect("si spegne");
    host.set_plugin_enabled(None, "fub.stats", true)
        .expect("si riaccende");
    assert!(
        !concessa(&host, "fub.stats", permission::WRITE_VAULT),
        "riaccendere un componente non è il modo di ridargli ciò che gli è \
         stato tolto"
    );

    host.close_vault(&v.root).expect("chiuso");
    let host = headless();
    host.open(&v.root).expect("si riapre");
    assert!(
        !concessa(&host, "fub.stats", permission::WRITE_VAULT),
        "e vale anche fra un avvio e l'altro, come per `plugins.disabled`"
    );
    // Le **altre** non le ha toccate nessuno: si nega un permesso per volta, e
    // negarne uno non è spegnere il componente.
    assert!(concessa(&host, "fub.stats", permission::READ_VAULT));
}

/// Questo componente ha ancora questa famiglia? Si chiede alla **politica**, che
/// è ciò che il cancello legge davvero — non alla mappa del manifest, che non
/// cambia mai.
fn concessa(host: &Host, plugin: &str, permesso: &str) -> bool {
    use fub_kernel::{Capability, Policy};
    let famiglia = Capability::ALL
        .into_iter()
        .find(|c| c.permission() == Some(permesso))
        .expect("un permesso che governa una famiglia");
    host.with_session(None, |s| {
        s.workspace()
            .read()
            .unwrap()
            .granted_policy(plugin)
            .denies(famiglia)
            .is_none()
    })
    .expect("aperto")
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
fn i_permessi_sono_gli_stessi_di_qua_e_di_la() {
    let permessi_ts =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src/ui/permessi.ts");
    let sorgente = std::fs::read_to_string(&permessi_ts)
        .unwrap_or_else(|e| panic!("la shell non ha più {}: {e}", permessi_ts.display()));

    let elenco = sorgente
        .split_once("export const PERMESSI = [")
        .and_then(|(_, resto)| resto.split_once("] as const;"))
        .map(|(dentro, _)| dentro)
        .expect(
            "in `ui/permessi.ts` non c'è più un `export const PERMESSI = [ … ] as const;`: \
             o l'elenco si chiama in un altro modo, o questo presidio sta leggendo il vuoto",
        );
    let dalla_shell: Vec<String> = elenco
        .lines()
        .filter_map(|riga| {
            let riga = riga.trim().trim_end_matches(',');
            riga.strip_prefix('"')?.strip_suffix('"').map(String::from)
        })
        .collect();

    let dal_contratto: Vec<String> = fub_abi::options::permission::ALL
        .iter()
        .map(|k| (*k).to_string())
        .collect();
    assert_eq!(
        dalla_shell, dal_contratto,
        "la shell e il contratto non hanno lo stesso elenco di permessi. Uno in \
         più di qua è una frase che non si mostrerà mai; uno in meno è un \
         permesso che il manifest dichiara, che il cancello onora e che nessuno \
         fa vedere a chi dovrebbe accettarlo. **L'ordine conta anche lui**: è \
         l'ordine in cui si leggono."
    );
}

/// Il bundle che tiene l'elenco degli spenti non può essere fra gli spenti.
#[test]
fn il_core_non_si_spegne() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");
    let errore = host
        .set_plugin_enabled(None, "fub.core", false)
        .expect_err("non si spegne");
    assert!(
        matches!(errore, PluginError::BadArgs(_)),
        "chiedere di spegnere il core e' una richiesta da correggere: {errore}"
    );
    assert!(errore.to_string().contains("fub.core"), "{errore}");
}

/// I due cancelli si vedono meglio **sullo schema del core**, cioè sulle sole
/// due chiavi che esistono davvero oggi.
///
/// `plugins.disabled` non è scrivibile da un programma, ed è il caso più chiaro
/// che ci sia: un componente che potesse spegnere gli altri avrebbe potere di
/// veto su tutto ciò che gli sta accanto, compreso ciò che lo controlla.
/// `versioning.enabled` lo è, e la differenza fra le due è la voce.
#[test]
fn chi_puo_spegnere_gli_altri_non_e_un_programma() {
    let core = fub_host::settings::core_settings();
    let disabled = core
        .iter()
        .find(|s| s.key == fub_host::settings::PLUGINS_DISABLED)
        .expect("il core la dichiara");
    assert!(
        !disabled.program_writable,
        "`{}` scrivibile da un programma sarebbe un veto di ogni componente su \
         ogni altro",
        disabled.key
    );

    let versioning = fub_host::settings::versioning_settings();
    let enabled = versioning
        .iter()
        .find(|s| s.key == fub_host::settings::VERSIONING_ENABLED)
        .expect("il versioning la dichiara");
    assert!(
        enabled.program_writable,
        "«questo vault è un archivio: niente versioning» è il caso che la voce \
         apre, ed è reversibile e non riguarda la privacy"
    );
}

#[test]
fn accendere_un_componente_che_non_esiste_e_un_errore_e_non_un_silenzio() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");
    let errore = host
        .set_plugin_enabled(None, "com.acme.mai-visto", true)
        .expect_err("non si accende ciò che non c'è");
    assert!(
        matches!(errore, PluginError::NotFound(_)),
        "«l'ho riacceso» e «ho scritto male l'id» devono essere due risposte \
         diverse, e adesso lo sono nel `kind`: {errore}"
    );
    assert!(
        errore.to_string().contains("com.acme.mai-visto"),
        "l'errore deve nominare chi non si e\' trovato: {errore}"
    );
}

/// Gli id che il file del vault dichiara spenti, **come li vede chi legge**.
fn spenti(host: &Host) -> Vec<String> {
    host.with_session(None, |s| {
        fub_host::settings::disabled_plugins(&s.workspace().read().unwrap())
    })
    .expect("aperto")
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
/// c'è una cartella, e uno store che non ha potuto leggere il file del vault
/// non lo sovrascrive (è il cancello `vault_readable`, §20.2). Ogni scrittura
/// d'impostazione fallisce, sempre, senza corse e senza attese.
#[test]
fn cio_che_il_file_non_ha_accettato_non_resta_spento_in_memoria() {
    let v = Vault::new();
    std::fs::create_dir_all(v.root.join(".fub").join("settings.json")).expect("la cartella");

    let host = headless();
    host.open(&v.root)
        .expect("un file di impostazioni illeggibile non impedisce di aprire");
    assert!(dichiarati(&host).contains(&"fub.stats".to_string()));

    let errore = host
        .set_plugin_enabled(None, "fub.stats", false)
        .expect_err("la riga non si scrive, e lo spegnimento non si finge");

    assert!(
        dichiarati(&host).contains(&"fub.stats".to_string()),
        "spento in memoria e acceso nel file è lo stato che non deve esistere: \
         se la riga non si è scritta, il componente è ancora montato ({errore})"
    );
    let inventario = host.bundles(None).expect("aperto");
    assert!(
        inventario
            .iter()
            .find(|b| b.id == "fub.stats")
            .expect("resta fra i conosciuti")
            .mounted,
        "e l'inventario dice la stessa cosa del kernel"
    );
}

const ROTTO: &str = "test.non-si-monta";

/// Un bundle che **non si monta**, e che lo dichiara nel manifest: una major
/// del contratto che questo host non parla è il primo dei quattro passi di
/// `mount`, e cade sempre. Il guasto è costruito, non atteso.
struct BundleCheNonSiMonta;

impl fub_host::registry::Bundle for BundleCheNonSiMonta {
    fn manifest(&self) -> fub_abi::traits::PluginManifest {
        let mut manifest = fub_abi::traits::PluginManifest::core(ROTTO, "Non si monta");
        manifest.abi_version = "99.0.0".to_string();
        manifest
    }

    fn plugin(&self) -> Box<dyn fub_abi::traits::Plugin> {
        unreachable!("il montaggio si ferma alla versione del contratto")
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
/// vault non ci provava più nessuno.
#[test]
fn accendere_scrive_l_intenzione_anche_quando_il_montaggio_non_riesce() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");
    host.with_session(None, |s| {
        s.bundles()
            .write()
            .unwrap()
            .remember(std::sync::Arc::new(BundleCheNonSiMonta));
    })
    .expect("aperto");

    // Prima si spegne — ed è un no-op sul montaggio, perché montato non lo è
    // mai stato: quello che conta è la riga che entra nel file.
    host.set_plugin_enabled(None, ROTTO, false)
        .expect("si spegne");
    assert!(spenti(&host).contains(&ROTTO.to_string()));

    // E poi si riaccende, e il montaggio non riesce. L'errore si dice — non si
    // finge che sia acceso — ma la riga se n'è andata lo stesso.
    let errore = host
        .set_plugin_enabled(None, ROTTO, true)
        .expect_err("un contratto che questo host non parla non si monta");
    assert!(
        matches!(errore, PluginError::Unserved(_)),
        "non è un difetto di nessuno: questo host non parla quel contratto ({errore})"
    );
    assert!(
        !spenti(&host).contains(&ROTTO.to_string()),
        "il montaggio è fallito, ma «accendilo» era la richiesta: {:?}",
        spenti(&host)
    );

    // E sta **sul disco**, che è il punto della voce: riaperto il vault, la
    // riga non è tornata indietro.
    host.close_vault(&v.root).expect("chiuso");
    let host = headless();
    host.open(&v.root).expect("si riapre");
    assert!(
        !spenti(&host).contains(&ROTTO.to_string()),
        "il disco non deve restare indietro rispetto a ciò che l'utente ha \
         chiesto: {:?}",
        spenti(&host)
    );
}

/// Il livello **macchina** è uno solo, e vive fuori dai vault: è la metà che
/// prima non esisteva affatto, e la ragione per cui il registro dei vault non
/// poteva nascere prima di questa voce.
#[test]
fn la_configurazione_della_macchina_e_una_per_tutti_i_vault_aperti() {
    let config = tempfile::tempdir().expect("tempdir");
    let config = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap();
    let uno = Vault::new();
    let due = Vault::new();

    let host = installato(&config);
    host.open(&uno.root).expect("si apre");
    host.open(&due.root).expect("si apre");

    // Una chiave di macchina, dichiarata da un plugin montato a mano su **un**
    // vault, scritta da lì.
    host.with_session(Some(uno.root.as_str()), |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core("fub.tema", "Tema").configuring(vec![
                fub_abi::settings::SettingSpec::toggle("tema.scuro", "Scuro", false).per_machine(),
            ]),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.set_setting("tema.scuro", SettingValue::Toggle(true))
            .expect("scritto");
    })
    .expect("aperto");

    // L'altro vault, che ha dichiarato la stessa chiave, vede lo stesso valore:
    // la configurazione della macchina è **una**, e N copie sarebbero N idee del
    // tema — con la seconda finestra che vince sulla prima senza saperlo.
    let letto = host
        .with_session(Some(due.root.as_str()), |s| {
            let mut ws = s.workspace().write().unwrap();
            ws.register_plugin(
                fub_abi::traits::PluginManifest::core("fub.tema", "Tema").configuring(vec![
                    fub_abi::settings::SettingSpec::toggle("tema.scuro", "Scuro", false)
                        .per_machine(),
                ]),
                fub_kernel::Trust::Core,
            )
            .expect("dichiarato");
            ws.setting("tema.scuro").expect("dichiarata")
        })
        .expect("aperto");
    assert_eq!(letto, SettingValue::Toggle(true));

    // E sta nel file della macchina, non in nessuno dei due vault.
    assert!(config.join("settings.json").is_file());
    assert!(!uno.root.join(".fub").join("settings.json").is_file());
}

/// Un elenco di vault non sta in nessun vault: è il §9.6 che la 0029 non poteva
/// chiudere, perché il livello in cui vive non esisteva.
#[test]
fn aprire_un_vault_lo_fa_entrare_fra_i_conosciuti_e_ci_resta() {
    let config = tempfile::tempdir().expect("tempdir");
    let config = Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap();
    let v = Vault::new();

    let host = installato(&config);
    assert!(host.known_vaults().is_empty());
    host.open(&v.root).expect("si apre");
    let conosciuti = host.known_vaults();
    assert_eq!(conosciuti.len(), 1);
    assert!(conosciuti[0].last_opened > 0, "l'ordine dei recenti");
    host.set_vault_favorite(&v.root, true).expect("appuntato");

    // Un altro avvio: il registro è nel livello macchina, quindi lo ritrova.
    let host = installato(&config);
    let conosciuti = host.known_vaults();
    assert_eq!(conosciuti.len(), 1);
    assert!(conosciuti[0].favorite);

    // Dimenticare toglie dall'elenco **e non tocca il disco**. Si dimentica per
    // una forma **non canonica** della stessa radice, che è il caso vero: la
    // shell manda il path che l'utente ha scelto, e su macOS o Windows quello
    // non è quasi mai la forma con cui l'apertura ha scritto la voce
    // (`/var` → `/private/var`, il prefisso UNC). Su Linux le due forme
    // coincidono, ed è per questo che qui se ne costruisce una a mano: un test
    // che passasse `v.root` proverebbe la stessa cosa su un solo sistema.
    let nome = v.root.file_name().expect("il tempdir ha un nome");
    let storta = v.root.join("..").join(nome);
    host.forget_vault(&storta).expect("dimenticato");
    assert!(host.known_vaults().is_empty());
    assert!(v.root.join("Nota.md").is_file());
}

/// Un host senza installazione non scrive da nessuna parte: è il default, ed è
/// ciò che permette a questa suite di girare senza toccare la configurazione di
/// chi la esegue.
#[test]
fn un_host_senza_installazione_ricorda_solo_finche_dura() {
    let v = Vault::new();
    let host = headless();
    host.open(&v.root).expect("si apre");
    assert_eq!(host.known_vaults().len(), 1, "in memoria sì");

    let altro = headless();
    assert!(
        altro.known_vaults().is_empty(),
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
fn la_chiave_del_tema_e_la_stessa_di_qua_e_di_la() {
    let theme_ts =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src/theme/theme.ts");
    let sorgente = std::fs::read_to_string(&theme_ts)
        .unwrap_or_else(|e| panic!("la shell non ha più {}: {e}", theme_ts.display()));

    let dichiarata = sorgente
        .lines()
        .find_map(|riga| {
            riga.strip_prefix("export const CHIAVE_TEMA = \"")?
                .strip_suffix("\";")
        })
        .expect(
            "in `theme/theme.ts` non c'è più una riga `export const CHIAVE_TEMA = \"…\";`: \
             o la chiave si chiama in un altro modo, o questo presidio sta leggendo il vuoto",
        )
        .to_string();

    let core = fub_host::settings::core_settings();
    let chiavi: Vec<&str> = core.iter().map(|s| s.key.as_str()).collect();
    assert!(
        chiavi.contains(&dichiarata.as_str()),
        "la shell legge l'impostazione «{dichiarata}», che il core non dichiara: \
         il tema si potrebbe cambiare dal pannello senza che cambi niente. \
         Le chiavi dichiarate sono {chiavi:?}"
    );
    assert_eq!(
        dichiarata,
        fub_host::settings::APPEARANCE_THEME,
        "la shell e il core nominano due chiavi diverse"
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
#[test]
fn la_chiave_della_memoria_e_la_stessa_di_qua_e_di_la() {
    let recenti_ts = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src/state/recenti.ts");
    let sorgente = std::fs::read_to_string(&recenti_ts)
        .unwrap_or_else(|e| panic!("la shell non ha più {}: {e}", recenti_ts.display()));

    let dichiarata = sorgente
        .lines()
        .find_map(|riga| {
            riga.strip_prefix("export const CHIAVE_CRONOLOGIA = \"")?
                .strip_suffix("\";")
        })
        .expect(
            "in `state/recenti.ts` non c'è più una riga \
             `export const CHIAVE_CRONOLOGIA = \"…\";`: o la chiave si chiama in un \
             altro modo, o questo presidio sta leggendo il vuoto",
        )
        .to_string();

    let core = fub_host::settings::core_settings();
    let chiavi: Vec<&str> = core.iter().map(|s| s.key.as_str()).collect();
    assert!(
        chiavi.contains(&dichiarata.as_str()),
        "la shell legge l'impostazione «{dichiarata}», che il core non dichiara: \
         la memoria di cosa si cerca si potrebbe spegnere dal pannello senza che \
         si spenga niente. Le chiavi dichiarate sono {chiavi:?}"
    );
    assert_eq!(
        dichiarata,
        fub_host::settings::HISTORY_ENABLED,
        "la shell e il core nominano due chiavi diverse"
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
fn chi_puo_riaccendere_la_memoria_non_e_un_programma() {
    let core = fub_host::settings::core_settings();
    let memoria = core
        .iter()
        .find(|s| s.key == fub_host::settings::HISTORY_ENABLED)
        .expect("il core la dichiara");
    assert!(
        !memoria.program_writable,
        "`{}` scrivibile da un programma sarebbe un componente che si riaccende \
         da sé la traccia di cosa cerchi",
        memoria.key
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
fn la_finestra_del_registro_fa_cadere_le_righe_vecchie() {
    let v = Vault::new();
    let vecchia = 30 * 86_400_000u64;
    let riga = |at: u64, doc: &str| {
        format!(
            "{{\"v\":1,\"at\":{at},\"origin\":{{\"actor\":{{\"kind\":\"user\"}},\"batch\":null}},\
             \"writer\":\"x\",\"op\":{{\"op\":\"renamed\",\"from\":\"{doc}\",\"to\":\"{doc}2\"}}}}\n"
        )
    };
    let adesso = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("dopo il 1970")
        .as_millis() as u64;
    std::fs::create_dir_all(v.root.join(".fub")).expect("la cartella");
    std::fs::write(
        v.root.join(".fub/journal.jsonl"),
        format!(
            "{}{}",
            riga(adesso - vecchia, "vecchia.md"),
            riga(adesso, "nuova.md")
        ),
    )
    .expect("il registro");

    let host = headless();
    host.open(&v.root).expect("si apre");

    // Il default è **per sempre**: un registro autorevole non si accorcia
    // perché è arrivato un aggiornamento.
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        assert_eq!(
            ws.journal().records.len(),
            2,
            "zero giorni = per sempre, e nessuna riga cade da sola"
        );
    })
    .expect("aperto");

    // Sette giorni: quella di un mese fa cade, l'altra resta.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.set_setting(
            fub_kernel::journal::RETENTION_DAYS,
            fub_abi::settings::SettingValue::Number(7.0),
        )
        .expect("la chiave è dichiarata dal core");
        let records = ws.journal().records;
        assert_eq!(
            records.len(),
            1,
            "la riga fuori dalla finestra cade appena la finestra è scritta"
        );
        assert!(
            format!("{:?}", records[0].op).contains("nuova.md"),
            "e quella che cade è la vecchia: {:?}",
            records[0].op
        );
    })
    .expect("aperto");

    // **E vale anche all'apertura**, non solo quando la si cambia. È l'altra
    // metà, ed è quella che serve davvero: la finestra la si scrive una volta e
    // poi si aprono i vault per anni. Il registro si riempie di nuovo di righe
    // vecchie con la chiave **già** scritta, e a un'apertura pulita devono
    // cadere da sole.
    //
    // Senza questo pezzo il ramo che pota alla dichiarazione dello schema non
    // sarebbe presidiato da niente — verificato togliendolo e non vedendo
    // rosso, che è il modo in cui questo banco è nato.
    std::fs::write(
        v.root.join(".fub/journal.jsonl"),
        format!(
            "{}{}",
            riga(adesso - vecchia, "rivecchia.md"),
            riga(adesso, "rinuova.md")
        ),
    )
    .expect("il registro");

    let host = headless();
    host.open(&v.root).expect("si riapre");
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let records = ws.journal().records;
        assert_eq!(
            records.len(),
            1,
            "la finestra scritta ieri pota all'apertura di oggi: {records:?}"
        );
        assert!(
            format!("{:?}", records[0].op).contains("rinuova.md"),
            "e cade la vecchia, non l'altra: {:?}",
            records[0].op
        );
    })
    .expect("aperto");
}

/// E la finestra non è scrivibile da un programma, per la ragione della
/// memoria qui sopra letta al contrario: un componente che potesse **allungare**
/// la conservazione dei path dell'utente lo farebbe da dietro un interruttore
/// che l'utente crede suo.
#[test]
fn chi_puo_allungare_la_finestra_del_registro_non_e_un_programma() {
    let finestra = fub_host::settings::core_settings()
        .into_iter()
        .find(|s| s.key == fub_kernel::journal::RETENTION_DAYS)
        .expect("il core la monta");
    assert!(
        !finestra.program_writable,
        "`{}` scrivibile da un programma sarebbe un componente che si allunga da \
         sé la traccia di cosa hai toccato",
        finestra.key
    );
    // E ha un massimo: un estremo che non si può scrivere è meglio di un numero
    // che promette una scadenza e non ne ha una.
    assert!(
        matches!(
            finestra.kind,
            fub_abi::settings::SettingKind::Number {
                default: 0.0,
                min: Some(0.0),
                max: Some(_)
            }
        ),
        "la finestra è un numero con estremi, e il suo default è «per sempre»: {:?}",
        finestra.kind
    );
}
