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

use camino::Utf8PathBuf;
use fub_abi::settings::{SettingScope, SettingSource, SettingValue};
use fub_host::shell::{shell_keybinding_specs, SHELL_COMMANDS};
use fub_host::{Host, NoWatcher};

/// La chiave della scorciatoia di «apri un vault»: il comando che esiste prima
/// di ogni vault, cioè la ragione per cui questa famiglia è di macchina.
const OPEN: &str = "keys.shell.vault.open";
/// Una chiave di **vault**: la scorciatoia di un comando del kernel.
const CREATE: &str = "keys.note.create";

fn folders() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

fn installed(config: &Utf8PathBuf) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = folders();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    (dir, root)
}

fn value(host: &Host, key: &str) -> Option<(SettingValue, SettingSource)> {
    host.machine_settings()
        .into_iter()
        .find(|and| and.spec.key == key)
        .map(|and| (and.value, and.source))
}

/// Senza vault le righe di macchina ci sono, e sono quelle che il core dichiara
/// tali.
#[test]
fn without_vault_the_settings_of_the_machine_is_read() {
    let host = Host::new();
    let keys: Vec<String> = host
        .machine_settings()
        .into_iter()
        .map(|and| and.spec.key)
        .collect();
    assert!(keys.contains(&"log.level".to_string()), "{keys:?}");
    assert!(keys.contains(&OPEN.to_string()), "{keys:?}");
    // E **solo** quelle: una chiave di vault qui sarebbe una riga che risponde
    // col default mentre il valore vero sta nel vault.
    assert!(!keys.contains(&CREATE.to_string()), "{keys:?}");
}

/// Il caso della voce: si rimappa «apri un vault» dalla finestra vuota, e la
/// combinazione nuova è quella che vale — adesso e al prossimo avvio.
#[test]
fn without_vault_a_shell_shortcut_is_reconfigured_and_remains() {
    let (_c, config) = folders();

    let host = installed(&config);
    assert_eq!(
        value(&host, OPEN),
        Some((
            SettingValue::Text("Mod-Shift-o".into()),
            SettingSource::Default
        ))
    );
    host.set_setting_for_user(None, OPEN, SettingValue::Text("Mod-Alt-o".into()))
        .expect("writes without a vault");
    assert_eq!(
        value(&host, OPEN),
        Some((
            SettingValue::Text("Mod-Alt-o".into()),
            SettingSource::Machine
        ))
    );

    // Il prossimo avvio: un host nuovo sulla stessa cartella di configurazione.
    let after = installed(&config);
    assert_eq!(
        value(&after, OPEN).map(|(v, _)| v),
        Some(SettingValue::Text("Mod-Alt-o".into()))
    );

    // E azzerare torna al dichiarato, senza vault come con.
    after.reset_setting_for_user(None, OPEN).expect("resets");
    assert_eq!(
        value(&after, OPEN),
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
fn the_channel_data_serves_the_settings_also_without_vault() {
    use fub_abi::traits::{IndexQuery, IndexResult};

    let (_c, config) = folders();
    let host = installed(&config);
    let IndexResult::Settings(lines) = host
        .query_index(None, IndexQuery::Settings { plugin: None })
        .expect("the channel responds without a vault")
    else {
        panic!("the channel responded with a different kind");
    };
    assert!(lines.iter().any(|and| and.spec.key == OPEN));

    // E una domanda che il vault deve servire resta un «nessun vault aperto».
    let error = host
        .query_index(
            None,
            IndexQuery::Tags {
                matching: fub_abi::query::QueryExpr::default(),
                page: None,
            },
        )
        .expect_err("tags require a vault");
    assert!(format!("{error}").contains("Nessun vault aperto"));

    // Con un vault aperto la domanda torna al canale del vault, dove le righe
    // sono tutte e non le sole di macchina.
    let (_v, root) = vault();
    host.open(&root).expect("opens");
    let IndexResult::Settings(all) = host
        .query_index(None, IndexQuery::Settings { plugin: None })
        .expect("risponde")
    else {
        panic!("a different kind");
    };
    assert!(all.len() > lines.len(), "{} {}", all.len(), lines.len());
    assert!(all.iter().any(|and| and.spec.key == CREATE));
}

/// **Le etichette escono risolte anche da questa porta**, e non solo da quella
/// del vault.
///
/// È la seconda metà di ciò che `settings_come_out_resolved_too` presidia dal
/// lato kernel: là il canale dati passa da `Workspace::query_index`, che
/// localizza ogni riga col catalogo di chi l'ha dichiarata; qui il vault non
/// c'è, e a rispondere è il livello macchina — che i cataloghi non li ha mai
/// visti. Un [`Text::Message`] che uscisse di qua arriverebbe alla shell come
/// `{"key": …}` dove aspetta una stringa, cioè `[object Object]` in ogni
/// etichetta del pannello. E sarebbe il caso peggiore in cui farlo: questa è la
/// porta che risponde **quando un vault non si apre**, cioè quando qualcuno sta
/// cercando l'interruttore del log per capire perché.
///
/// L'asserzione guarda ogni `Text` dell'albero — etichetta, descrizione,
/// gruppo, e le etichette delle opzioni di una `Choice` — perché il difetto si
/// è già nascosto una volta in un ramo che nessuno guardava.
#[test]
fn without_vault_the_labels_emerge_resolved() {
    use fub_abi::text::Localize;
    use fub_abi::traits::{IndexQuery, IndexResult};

    let (_c, config) = folders();
    let host = installed(&config);
    let IndexResult::Settings(mut lines) = host
        .query_index(None, IndexQuery::Settings { plugin: None })
        .expect("the channel responds without a vault")
    else {
        panic!("the channel responded with a different kind");
    };
    // Senza questa riga l'asserzione seguente passerebbe **a vuoto** il giorno
    // in cui il livello macchina smettesse di dichiarare qualcosa.
    assert!(
        !lines.is_empty(),
        "the machine level declares lines, or there is nothing to resolve"
    );

    let mut nude: Vec<String> = Vec::new();
    for line in &mut lines {
        let key = line.spec.key.clone();
        line.visit_texts(&mut |t| {
            if !t.is_literal() {
                nude.push(format!("{key}: {t:?}"));
            }
        });
    }
    assert!(
        nude.is_empty(),
        "these come out with a key to resolve instead of a string, \
         and the shell writes `[object Object]` in every panel label:\n  {}",
        nude.join("\n  ")
    );
}

/// Una chiave che **il vault** tiene, chiesta senza vault, dice cosa manca: il
/// vault, non lo schema.
#[test]
fn without_vault_a_key_of_vault_says_that_missing_the_vault() {
    let (_c, config) = folders();
    let host = installed(&config);
    let error = host
        .set_setting_for_user(None, CREATE, SettingValue::Text("Mod-Alt-n".into()))
        .expect_err("cannot write a vault key without a vault");
    let said = format!("{error}");
    assert!(said.contains("Nessun vault aperto"), "{said}");
}

/// Con un vault aperto la scrittura passa dal `Workspace` — che è chi emette
/// `setting_changed` — e i due livelli dicono la stessa cosa.
#[test]
fn with_a_vault_open_a_key_of_machine_remains_a_single() {
    let (_c, config) = folders();
    let (_v, root) = vault();
    let host = installed(&config);
    host.open(&root).expect("opens");

    host.set_setting_for_user(None, OPEN, SettingValue::Text("Mod-Alt-o".into()))
        .expect("writes with a vault open");

    // Letta dal canale del vault…
    let from_the_vault = host
        .with_session(None, |s| s.workspace().read().unwrap().setting_source(OPEN))
        .expect("open")
        .expect("dichiarata");
    assert_eq!(
        from_the_vault,
        (
            SettingValue::Text("Mod-Alt-o".into()),
            SettingSource::Machine
        )
    );
    // …e dal livello macchina: è la stessa mappa, non due.
    assert_eq!(value(&host, OPEN), Some(from_the_vault));
}

/// **Scrivere si dice**, anche senza vault: chi ascolta rilegge gli accordi.
///
/// Con un vault aperto l'evento lo emette il `Workspace`; senza, il `Workspace`
/// non c'è. Senza questa riga una scorciatoia rimappata nella finestra vuota
/// resterebbe scritta, riletta e mostrata giusta mentre la tastiera continua a
/// rispondere a quella vecchia — che è il difetto che la 0090 aveva già trovato
/// una volta per l'altra metà della stessa famiglia.
/// una volta per l'altra metà della stessa famiglia.
#[test]
fn a_write_without_vault_is_says_the_same() {
    use fub_abi::event::{Actor, EventKind};
    use fub_abi::Notice;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<Notice>>);
    impl fub_host::EventSink for Recorder {
        fn emit(&self, notice: &Notice) -> fub_host::Delivery {
            self.0.lock().unwrap().push(notice.clone());
            fub_host::Delivery::Done
        }
    }

    let (_c, config) = folders();
    let sink = std::sync::Arc::new(Recorder::default());
    let host = installed(&config).with_sink(sink.clone());

    host.set_setting_for_user(None, OPEN, SettingValue::Text("Mod-Alt-o".into()))
        .expect("writes");
    host.reset_setting_for_user(None, OPEN).expect("resets");

    let notices = sink.0.lock().unwrap();
    assert_eq!(notices.len(), 2, "{notices:?}");
    for notice in notices.iter() {
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
fn every_command_of_shell_has_a_key_of_machine() {
    let specs = shell_keybinding_specs();
    assert_eq!(specs.len(), SHELL_COMMANDS.len());
    for ((id, chord), spec) in SHELL_COMMANDS.iter().zip(&specs) {
        assert_eq!(spec.key, fub_abi::settings::keybinding_key(id));
        assert_eq!(
            spec.scope,
            SettingScope::Machine,
            "`{id}` is not machine-level"
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
/// `with_session_notice`` non è provabile qui (il collettore è globale al
/// processo, nessun banco può rifare `install_logging`); lo presidiano la
/// firma di `install_logging` e i banchi di `floor` in `config.rs`, che
/// tengono fermo che la diagnosi esiste nei due rami.
#[test]
fn a_notice_of_session_is_says_a_time_single() {
    use fub_abi::event::{Actor, Severity};
    use fub_abi::{Event, Notice};

    let without = Host::new();
    assert_eq!(
        without.session_notice(),
        None,
        "without a diagnosis nothing is said"
    );

    let host = Host::new().with_session_notice(Some("`/config` cannot be written".into()));
    let Notice { event, origin } = host
        .session_notice()
        .expect("the diagnosis exists and is delivered");
    let Event::Trouble {
        severity,
        subject,
        error,
        ..
    } = event
    else {
        panic!("the notice is not a Trouble: {event:?}");
    };
    assert_eq!(
        severity,
        Severity::Warning,
        "un derivato perduto informa (0052)"
    );
    assert_eq!(
        subject, None,
        "the fault is machine-level, not document-level"
    );
    assert!(
        error.to_string().contains("/config"),
        "la diagnosi arriva intera: {error}"
    );
    assert_eq!(
        origin.actor,
        Actor::Kernel,
        "the diagnosis is not from anyone else (0012)"
    );

    assert_eq!(
        host.session_notice(),
        None,
        "una volta per sessione: la seconda chiamata non deliver"
    );
}
