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
