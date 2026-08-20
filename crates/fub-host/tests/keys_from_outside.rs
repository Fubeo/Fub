//! **I tasti che arrivano da fuori** (§23.13,
//! [decisione 0100](../../../docs/decisions/0100-i-tasti-che-arrivano-da-fuori.md)):
//! un vault porta con sé le proprie scorciatoie, e finché nessuno le ha
//! guardate non premono niente.
//!
//! La riga che questi banchi difendono è una sola, e va detta al negativo
//! perché è così che si rompe: **non deve esistere un momento in cui una
//! combinazione scritta in un file che arriva da fuori fa qualcosa senza che
//! l'utente l'abbia vista**. Il caso peggiore non è teorico — fra i comandi che
//! una chiave può armare c'è `trash.empty`, che dichiara zero parametri e si
//! dichiara irreversibile, quindi da una scorciatoia parte e basta.
//!
//! I controlli **negativi** contano quanto gli altri e sono qui apposta: un
//! presidio che diventasse rosso solo per la strada nuova non direbbe che quella
//! vecchia — le scorciatoie viaggiano col vault, ed è la cosa buona della 0077 —
//! è ancora al suo posto.
//! 0077 — is still in place.

use camino::Utf8PathBuf;
use fub_abi::settings::{SettingSource, SettingValue};
use fub_host::{Host, NoWatcher};

const CREATE: &str = "keys.note.create";
const EMPTY: &str = "keys.trash.empty";

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

    /// Scrive il `.fub/settings.json` **a mano**, che è il solo modo di
    /// riprodurre il caso: un vault che arriva da fuori non ha usato questa app
    /// per configurarsi.
    fn with_settings(self, lines: &[(&str, &str)]) -> Self {
        let dir = self.root.join(".fub");
        std::fs::create_dir_all(&dir).unwrap();
        let body: String = lines
            .iter()
            .map(|(k, v)| format!("    \"{k}\": \"{v}\""))
            .collect::<Vec<_>>()
            .join(",\n");
        std::fs::write(
            dir.join("settings.json"),
            format!("{{\n  \"version\": 1,\n  \"values\": {{\n{body}\n  }}\n}}\n"),
        )
        .unwrap();
        self
    }
}

fn config() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

fn installed(config: &Utf8PathBuf) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

/// Il valore **efficace** di una chiave, come lo legge chi disegna la tastiera.
fn effective_binding(host: &Host, key: &str) -> (SettingValue, SettingSource) {
    host.with_session(None, |s| {
        s.workspace()
            .read()
            .unwrap()
            .setting_source(key)
            .expect("declared")
    })
    .expect("open")
}

/// Il caso della voce, in un banco: un vault che arriva da fuori arma una
/// combinazione su un comando che cancella, e non la preme.
#[test]
fn never_seen_vault_does_not_apply_keys() {
    let (_c, config) = config();
    let v = Vault::new().with_settings(&[(EMPTY, "Mod-s")]);

    let host = installed(&config);
    host.open(&v.root).expect("opens");

    // Il valore efficace è quello **dichiarato dal comando** — nessuno — e la
    // provenienza lo dice: non c'è nessuna decisione che valga.
    let (value, from_where) = effective_binding(&host, EMPTY);
    assert_eq!(value, SettingValue::Text(String::new()));
    assert_eq!(from_where, SettingSource::Default);

    // E la domanda c'è, con l'accordo che il vault propone: chi disegna deve
    // poter dire *quale* combinazione e *su quale comando*.
    // Il file **non è stato toccato**: nel dubbio non si cancella, e la
    let pending = host.pending_keybindings(None).expect("open");
    assert_eq!(pending.get(EMPTY).map(String::as_str), Some("Mod-s"));

    // sospensione è la mossa che si disfa.
    // sospensione è la mossa che si disfa.
    let written = std::fs::read_to_string(v.root.join(".fub").join("settings.json")).unwrap();
    assert!(written.contains("Mod-s"), "{written}");
}

/// «Usa le sue»: da lì in poi valgono, e non le si chiede più — **nemmeno alla
/// riapertura**, che è la metà che rende la risposta una risposta invece di una
/// preferenza di sessione.
#[test]
fn adopt_applies_now_and_on_next_launch() {
    let (_c, config) = config();
    let v = Vault::new().with_settings(&[(CREATE, "Mod-Alt-k")]);

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    host.adopt_keybindings(None).expect("adopted");

    let (value, from_where) = effective_binding(&host, CREATE);
    assert_eq!(value, SettingValue::Text("Mod-Alt-k".into()));
    assert_eq!(from_where, SettingSource::Vault, "now the vault decides");
    assert!(host.pending_keybindings(None).unwrap().is_empty());

    // Un altro avvio, con la stessa configurazione di macchina.
    let host = installed(&config);
    host.open(&v.root).expect("reopens");
    assert!(
        host.pending_keybindings(None).unwrap().is_empty(),
        "an answered question is not asked again"
    );
    assert_eq!(effective_binding(&host, CREATE).1, SettingSource::Vault);
}

/// «Tieni le mie»: la chiave esce dal file del vault invece di restare sospesa
/// per sempre. Un valore che nessuno leggerà mai è la cosa peggiore che un file
/// di configurazione possa contenere (0076), e vale anche per un valore
#[test]
fn discard_removes_key_from_file_instead_of_leaving_it() {
    let (_c, config) = config();
    let v = Vault::new().with_settings(&[(CREATE, "Mod-Alt-k")]);

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    host.discard_keybindings(None).expect("discarded");

    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert_eq!(effective_binding(&host, CREATE).1, SettingSource::Default);
    let written = std::fs::read_to_string(v.root.join(".fub").join("settings.json")).unwrap();
    assert!(
        !written.contains("Mod-Alt-k"),
        "after an answer nothing ambiguous remains in the file: {written}"
    );
}

/// La domanda è **sui tasti, non sul vault**, ed è qui che si vede la
/// differenza: un vault aperto e risposto ieri può ricevere stanotte un accordo
/// nuovo, da una sincronizzazione o da un collega. Un criterio basato su «questo
/// vault l'ho già visto» lo lascerebbe passare.
#[test]
fn changed_binding_requires_prompt_when_app_closed() {
    let (_c, config) = config();
    let v = Vault::new().with_settings(&[(CREATE, "Mod-Alt-k")]);

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    host.adopt_keybindings(None).expect("adopted");
    host.close_vault(&v.root).expect("closed");

    // Il file cambia mentre l'app non guarda, e cambia **su una chiave già
    // adottata**: è il caso che un confronto sulla presenza non vedrebbe.
    let v = v.with_settings(&[(CREATE, "Mod-s")]);
    let host = installed(&config);
    host.open(&v.root).expect("reopens");

    let pending = host.pending_keybindings(None).expect("open");
    assert_eq!(pending.get(CREATE).map(String::as_str), Some("Mod-s"));
    assert_eq!(effective_binding(&host, CREATE).1, SettingSource::Default);
}

/// Rispondere su **una** scorciatoia non è rispondere sulle altre: chi rimappa
/// un comando dal pannello non ha guardato le altre che quel vault portava.
///
/// È il caso in cui la memoria per chiave paga ciò che un'impronta sola non
/// saprebbe pagare.
/// saprebbe pagare.
#[test]
fn setting_one_does_not_adopt_others() {
    let (_c, config) = config();
    let v = Vault::new().with_settings(&[(CREATE, "Mod-Alt-k"), (EMPTY, "Mod-s")]);

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    host.set_setting_for_user(None, CREATE, SettingValue::Text("Mod-j".into()))
        .expect("panel writes");

    // Quella scritta vale — l'ha battuta una persona — e l'altra no.
    // Quella scritta vale — l'ha battuta una persona — e l'altra no.
    assert_eq!(effective_binding(&host, CREATE).0, SettingValue::Text("Mod-j".into()));
    assert_eq!(effective_binding(&host, EMPTY).1, SettingSource::Default);
    let pending = host.pending_keybindings(None).expect("open");
    assert_eq!(pending.keys().collect::<Vec<_>>(), vec![EMPTY]);
}

// --- i controlli negativi ------------------------------------------------
//
// Tre cose che devono continuare a **non** succedere.

/// **Le scorciatoie viaggiano ancora col vault.** È la cosa buona della 0077, e
/// una sospensione che la togliesse avrebbe risolto la voce buttando ciò che la
/// rendeva utile: portarsi la propria tastiera da una macchina all'altra.
///
/// Questo banco fa il giro intero — le scorciatoie si scrivono dal pannello, il
/// vault si chiude, si riapre — e pretende che valgano **senza nessuna
/// domanda**: chi le ha scritte le ha già guardate.
/// domanda**: chi le ha scritte le ha già guardate.
#[test]
fn shortcuts_written_here_still_travel_with_vault() {
    let (_c, config) = config();
    let v = Vault::new();

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    host.set_setting_for_user(None, CREATE, SettingValue::Text("Mod-Alt-k".into()))
        .expect("panel writes");
    assert!(
        host.pending_keybindings(None).unwrap().is_empty(),
        "what was just typed is not asked about"
    );
    host.close_vault(&v.root).expect("closed");

    let host = installed(&config);
    host.open(&v.root).expect("reopens");
    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert_eq!(
        effective_binding(&host, CREATE).0,
        SettingValue::Text("Mod-Alt-k".into())
    );
}

/// **Le altre chiavi del vault non si sospendono.** Un tema che arriva da fuori
/// si applica, ed è la 0076 che regge: si vede subito e si disfa in un gesto.
/// Sospendere anche quelle sarebbe stato il modo di far pagare a tutti il
/// prezzo di una famiglia sola.
#[test]
fn theme_arriving_from_outside_is_still_applied() {
    let (_c, config) = config();
    let v = Vault::new().with_settings(&[
        (fub_host::settings::APPEARANCE_THEME, "dark"),
        (fub_kernel::locale::LANGUAGE, "en"),
    ]);

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert_eq!(
        effective_binding(&host, fub_host::settings::APPEARANCE_THEME),
        (SettingValue::Text("dark".into()), SettingSource::Vault)
    );
    assert_eq!(
        effective_binding(&host, fub_kernel::locale::LANGUAGE).1,
        SettingSource::Vault
    );
}

/// **Un vault senza scorciatoie non chiede niente**, e non scrive niente nel
/// registro: la strada che costa meno è quella di chi il problema non ce l'ha,
/// che sono quasi tutti.
#[test]
fn vault_without_keys_asks_no_questions() {
    let (_c, config) = config();
    let v = Vault::new();

    let host = installed(&config);
    host.open(&v.root).expect("opens");
    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert!(
        host.known_vaults()[0].keys_seen.is_empty(),
        "nothing to look at, nothing to remember"
    );
}
