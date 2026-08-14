//! **Ciò che è della macchina esiste anche senza un vault** (§16.3,
//! [decisione 0116](../../../docs/decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)).
//!
//! `SettingScope::Machine` è nato per il log, e il suo doc-comment dice perché:
//! il livello del log «deve valere anche **quando un vault non si apre**, che è
//! precisamente il caso in cui serve». La promessa era mantenuta a metà — il
//! *valore* stava nel file della macchina, ma lo **schema** stava nello store di
//! un vault, cioè nell'unico posto che sparisce proprio in quel caso: senza
//! vault aperto `log.level` non si poteva né leggere né scrivere.
//!
//! Da questa voce le chiavi di macchina del core sono dichiarate al livello
//! macchina, e quel livello risponde da solo. È ciò che permette alle
//! scorciatoie dei comandi **della shell** di essere riconfigurabili: la loro è
//! l'unica famiglia per cui il caso «nessun vault aperto» non è un caso limite
//! ma il momento in cui si usano — `shell.vault.open` è il comando che serve ad
//! aprire il primo.
//!
//! # I controlli negativi contano quanto gli altri
//!
//! Due, e nessuno dei due è un di più. Che una chiave **di vault** chiesta senza
//! vault dica «nessun vault aperto» e non «non dichiarata»: la seconda frase
//! manda a cercare il difetto nello schema, dove non c'è. E che con un vault
//! aperto la scrittura continui a passare dal `Workspace`: è lui che emette
//! `setting_changed`, e una scorciatoia della shell rimappata a vault aperto
//! deve svegliare la tastiera come tutte le altre.

use camino::Utf8PathBuf;
use fub_abi::settings::{SettingScope, SettingSource, SettingValue};
use fub_host::shell::{shell_keybinding_specs, SHELL_COMMANDS};
use fub_host::{Host, NoWatcher};

/// La chiave della scorciatoia di «apri un vault»: il comando che esiste prima
/// di ogni vault, cioè la ragione per cui questa famiglia è di macchina.
const APRI: &str = "keys.shell.vault.open";
/// Una chiave di **vault**: la scorciatoia di un comando del kernel.
const CREA: &str = "keys.note.create";

fn cartelle() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

fn installato(config: &Utf8PathBuf) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = cartelle();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    (dir, root)
}

fn valore(host: &Host, key: &str) -> Option<(SettingValue, SettingSource)> {
    host.machine_settings()
        .into_iter()
        .find(|e| e.spec.key == key)
        .map(|e| (e.value, e.source))
}

/// Senza vault le righe di macchina ci sono, e sono quelle che il core dichiara
/// tali.
#[test]
fn senza_vault_le_impostazioni_della_macchina_si_leggono() {
    let host = Host::new();
    let chiavi: Vec<String> = host
        .machine_settings()
        .into_iter()
        .map(|e| e.spec.key)
        .collect();
    assert!(chiavi.contains(&"log.level".to_string()), "{chiavi:?}");
    assert!(chiavi.contains(&APRI.to_string()), "{chiavi:?}");
    // E **solo** quelle: una chiave di vault qui sarebbe una riga che risponde
    // col default mentre il valore vero sta nel vault.
    assert!(!chiavi.contains(&CREA.to_string()), "{chiavi:?}");
}

/// Il caso della voce: si rimappa «apri un vault» dalla finestra vuota, e la
/// combinazione nuova è quella che vale — adesso e al prossimo avvio.
#[test]
fn senza_vault_una_scorciatoia_di_shell_si_riconfigura_e_resta() {
    let (_c, config) = cartelle();

    let host = installato(&config);
    assert_eq!(
        valore(&host, APRI),
        Some((
            SettingValue::Text("Mod-Shift-o".into()),
            SettingSource::Default
        ))
    );
    host.set_setting_for_user(None, APRI, SettingValue::Text("Mod-Alt-o".into()))
        .expect("si scrive senza vault");
    assert_eq!(
        valore(&host, APRI),
        Some((
            SettingValue::Text("Mod-Alt-o".into()),
            SettingSource::Machine
        ))
    );

    // Il prossimo avvio: un host nuovo sulla stessa cartella di configurazione.
    let dopo = installato(&config);
    assert_eq!(
        valore(&dopo, APRI).map(|(v, _)| v),
        Some(SettingValue::Text("Mod-Alt-o".into()))
    );

    // E azzerare torna al dichiarato, senza vault come con.
    dopo.reset_setting_for_user(None, APRI).expect("si azzera");
    assert_eq!(
        valore(&dopo, APRI),
        Some((
            SettingValue::Text("Mod-Shift-o".into()),
            SettingSource::Default
        ))
    );
}

/// La stessa risposta **dal canale dati**, che è la porta da cui la shell la
/// chiede davvero: senza vault le righe di macchina, con un vault quelle del
/// vault. Le altre domande continuano a volere un vault, e lo dicono.
#[test]
fn il_canale_dati_serve_le_impostazioni_anche_senza_vault() {
    use fub_abi::traits::{IndexQuery, IndexResult};

    let (_c, config) = cartelle();
    let host = installato(&config);
    let IndexResult::Settings(righe) = host
        .query_index(None, IndexQuery::Settings { plugin: None })
        .expect("il canale risponde senza vault")
    else {
        panic!("il canale ha risposto con un'altra specie");
    };
    assert!(righe.iter().any(|e| e.spec.key == APRI));

    // E una domanda che il vault deve servire resta un «nessun vault aperto».
    let errore = host
        .query_index(
            None,
            IndexQuery::Tags {
                matching: fub_abi::query::QueryExpr::default(),
                page: None,
            },
        )
        .expect_err("i tag vogliono un vault");
    assert!(format!("{errore}").contains("Nessun vault aperto"));

    // Con un vault aperto la domanda torna al canale del vault, dove le righe
    // sono tutte e non le sole di macchina.
    let (_v, root) = vault();
    host.open(&root).expect("si apre");
    let IndexResult::Settings(tutte) = host
        .query_index(None, IndexQuery::Settings { plugin: None })
        .expect("risponde")
    else {
        panic!("altra specie");
    };
    assert!(tutte.len() > righe.len(), "{} {}", tutte.len(), righe.len());
    assert!(tutte.iter().any(|e| e.spec.key == CREA));
}

/// Una chiave che **il vault** tiene, chiesta senza vault, dice cosa manca: il
/// vault, non lo schema.
#[test]
fn senza_vault_una_chiave_di_vault_dice_che_manca_il_vault() {
    let (_c, config) = cartelle();
    let host = installato(&config);
    let errore = host
        .set_setting_for_user(None, CREA, SettingValue::Text("Mod-Alt-n".into()))
        .expect_err("senza vault non si scrive una chiave di vault");
    let detto = format!("{errore}");
    assert!(detto.contains("Nessun vault aperto"), "{detto}");
}

/// Con un vault aperto la scrittura passa dal `Workspace` — che è chi emette
/// `setting_changed` — e i due livelli dicono la stessa cosa.
#[test]
fn con_un_vault_aperto_una_chiave_di_macchina_resta_una_sola() {
    let (_c, config) = cartelle();
    let (_v, root) = vault();
    let host = installato(&config);
    host.open(&root).expect("si apre");

    host.set_setting_for_user(None, APRI, SettingValue::Text("Mod-Alt-o".into()))
        .expect("si scrive con un vault aperto");

    // Letta dal canale del vault…
    let dal_vault = host
        .with_session(None, |s| s.workspace().read().unwrap().setting_source(APRI))
        .expect("aperto")
        .expect("dichiarata");
    assert_eq!(
        dal_vault,
        (
            SettingValue::Text("Mod-Alt-o".into()),
            SettingSource::Machine
        )
    );
    // …e dal livello macchina: è la stessa mappa, non due.
    assert_eq!(valore(&host, APRI), Some(dal_vault));
}

/// **Scrivere si dice**, anche senza vault: chi ascolta rilegge gli accordi.
///
/// Con un vault aperto l'evento lo emette il `Workspace`; senza, il `Workspace`
/// non c'è. Senza questa riga una scorciatoia rimappata nella finestra vuota
/// resterebbe scritta, riletta e mostrata giusta mentre la tastiera continua a
/// rispondere a quella vecchia — che è il difetto che la 0090 aveva già trovato
/// una volta per l'altra metà della stessa famiglia.
#[test]
fn una_scrittura_senza_vault_si_dice_lo_stesso() {
    use fub_abi::event::{Actor, EventKind};
    use fub_abi::Notice;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Registratore(Mutex<Vec<Notice>>);
    impl fub_host::EventSink for Registratore {
        fn emit(&self, notice: &Notice) -> fub_host::Consegna {
            self.0.lock().unwrap().push(notice.clone());
            fub_host::Consegna::Fatta
        }
    }

    let (_c, config) = cartelle();
    let sink = std::sync::Arc::new(Registratore::default());
    let host = installato(&config).with_sink(sink.clone());

    host.set_setting_for_user(None, APRI, SettingValue::Text("Mod-Alt-o".into()))
        .expect("si scrive");
    host.reset_setting_for_user(None, APRI).expect("si azzera");

    let detti = sink.0.lock().unwrap();
    assert_eq!(detti.len(), 2, "{detti:?}");
    for notice in detti.iter() {
        assert_eq!(notice.kind(), EventKind::SettingChanged);
        // Di qui passa la persona davanti allo schermo, non un programma: è la
        // stessa distinzione per cui `set_setting` è un comando IPC e non
        // `settings.set` del registro.
        assert_eq!(notice.origin.actor, Actor::User);
    }
}

/// Ogni comando di shell ha la sua chiave, e ognuna è **di macchina**.
///
/// La riga di progetto di questa voce, presa dove si scrive: se qualcuno toglie
/// il `.per_machine()`, la famiglia torna a vivere dentro il vault che serve ad
/// aprire i vault, e nessun altro presidio se ne accorgerebbe — il pannello
/// funzionerebbe, la scrittura andrebbe a buon fine, e a mancare sarebbe solo la
/// finestra vuota.
#[test]
fn ogni_comando_di_shell_ha_una_chiave_di_macchina() {
    let specs = shell_keybinding_specs();
    assert_eq!(specs.len(), SHELL_COMMANDS.len());
    for ((id, chord), spec) in SHELL_COMMANDS.iter().zip(&specs) {
        assert_eq!(spec.key, fub_abi::settings::keybinding_key(id));
        assert_eq!(
            spec.scope,
            SettingScope::Machine,
            "`{id}` non è di macchina"
        );
        assert_eq!(
            spec.kind.default_value(),
            SettingValue::Text(chord.unwrap_or_default().to_string())
        );
    }
}

/// **La porta dell'avviso di sessione (§25.5): si consegna una volta, e con
/// la forma che la shell sa mostrare.**
///
/// La diagnosi «la cartella di configurazione non si può scrivere» nasce in
/// `install_logging`, quando nessun canale verso chi guarda esiste ancora —
/// il ponte parte al primo vault aperto, la shell si iscrive dopo: una spinta
/// a quell'ora sarebbe emessa nel vuoto. Questo banco tiene fermo ciò che
/// l'host promette al tiraggio: il `Notice` giusto, **una volta sola** — il
/// `take` rende la seconda chiamata `None` per costruzione, e toglierlo è il
/// modo in cui questo banco va rosso.
///
/// La zona cieca va detta: il cablaggio `install_logging → run →
/// `with_avviso_di_sessione`` non è provabile qui (il collettore è globale al
/// processo, nessun banco può rifare `install_logging`); lo presidiano la
/// firma di `install_logging` e i banchi di `pavimento` in `config.rs`, che
/// tengono fermo che la diagnosi esiste nei due rami.
#[test]
fn un_avviso_di_sessione_si_dice_una_volta_sola() {
    use fub_abi::event::{Actor, Severity};
    use fub_abi::{Event, Notice};

    let senza = Host::new();
    assert_eq!(
        senza.avviso_di_sessione(),
        None,
        "senza diagnosi non si dice niente"
    );

    let host = Host::new().with_avviso_di_sessione(Some("`/config` non si può scrivere".into()));
    let Notice { event, origin } = host
        .avviso_di_sessione()
        .expect("la diagnosi c'è e si consegna");
    let Event::Trouble {
        severity,
        subject,
        error,
        ..
    } = event
    else {
        panic!("l'avviso non è un Trouble: {event:?}");
    };
    assert_eq!(
        severity,
        Severity::Warning,
        "un derivato perduto informa (0052)"
    );
    assert_eq!(
        subject, None,
        "il guasto è della macchina, non di un documento"
    );
    assert!(
        error.to_string().contains("/config"),
        "la diagnosi arriva intera: {error}"
    );
    assert_eq!(
        origin.actor,
        Actor::Kernel,
        "la diagnosi non è di nessun altro (0012)"
    );

    assert_eq!(
        host.avviso_di_sessione(),
        None,
        "una volta per sessione: la seconda chiamata non consegna"
    );
}
