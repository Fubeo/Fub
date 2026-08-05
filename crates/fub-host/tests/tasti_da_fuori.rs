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

use camino::Utf8PathBuf;
use fub_abi::settings::{SettingSource, SettingValue};
use fub_host::{Host, NoWatcher};

const CREA: &str = "keys.note.create";
const SVUOTA: &str = "keys.trash.empty";

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
    fn con_impostazioni(self, righe: &[(&str, &str)]) -> Self {
        let dir = self.root.join(".fub");
        std::fs::create_dir_all(&dir).unwrap();
        let corpo: String = righe
            .iter()
            .map(|(k, v)| format!("    \"{k}\": \"{v}\""))
            .collect::<Vec<_>>()
            .join(",\n");
        std::fs::write(
            dir.join("settings.json"),
            format!("{{\n  \"version\": 1,\n  \"values\": {{\n{corpo}\n  }}\n}}\n"),
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

fn installato(config: &Utf8PathBuf) -> Host {
    Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_config_dir(config)
}

/// Il valore **efficace** di una chiave, come lo legge chi disegna la tastiera.
fn accordo(host: &Host, key: &str) -> (SettingValue, SettingSource) {
    host.with_session(None, |s| {
        s.workspace()
            .read()
            .unwrap()
            .setting_source(key)
            .expect("dichiarata")
    })
    .expect("aperto")
}

/// Il caso della voce, in un banco: un vault che arriva da fuori arma una
/// combinazione su un comando che cancella, e non la preme.
#[test]
fn un_vault_mai_visto_non_preme_i_tasti() {
    let (_c, config) = config();
    let v = Vault::new().con_impostazioni(&[(SVUOTA, "Mod-s")]);

    let host = installato(&config);
    host.open(&v.root).expect("si apre");

    // Il valore efficace è quello **dichiarato dal comando** — nessuno — e la
    // provenienza lo dice: non c'è nessuna decisione che valga.
    let (valore, da_dove) = accordo(&host, SVUOTA);
    assert_eq!(valore, SettingValue::Text(String::new()));
    assert_eq!(da_dove, SettingSource::Default);

    // E la domanda c'è, con l'accordo che il vault propone: chi disegna deve
    // poter dire *quale* combinazione e *su quale comando*.
    let in_attesa = host.pending_keybindings(None).expect("aperto");
    assert_eq!(in_attesa.get(SVUOTA).map(String::as_str), Some("Mod-s"));

    // Il file **non è stato toccato**: nel dubbio non si cancella, e la
    // sospensione è la mossa che si disfa.
    let scritto = std::fs::read_to_string(v.root.join(".fub").join("settings.json")).unwrap();
    assert!(scritto.contains("Mod-s"), "{scritto}");
}

/// «Usa le sue»: da lì in poi valgono, e non le si chiede più — **nemmeno alla
/// riapertura**, che è la metà che rende la risposta una risposta invece di una
/// preferenza di sessione.
#[test]
fn adottare_vale_adesso_e_al_prossimo_avvio() {
    let (_c, config) = config();
    let v = Vault::new().con_impostazioni(&[(CREA, "Mod-Alt-k")]);

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    host.adopt_keybindings(None).expect("adottate");

    let (valore, da_dove) = accordo(&host, CREA);
    assert_eq!(valore, SettingValue::Text("Mod-Alt-k".into()));
    assert_eq!(da_dove, SettingSource::Vault, "adesso decide il vault");
    assert!(host.pending_keybindings(None).unwrap().is_empty());

    // Un altro avvio, con la stessa configurazione di macchina.
    let host = installato(&config);
    host.open(&v.root).expect("si riapre");
    assert!(
        host.pending_keybindings(None).unwrap().is_empty(),
        "una risposta data non si richiede"
    );
    assert_eq!(accordo(&host, CREA).1, SettingSource::Vault);
}

/// «Tieni le mie»: la chiave esce dal file del vault invece di restare sospesa
/// per sempre. Un valore che nessuno leggerà mai è la cosa peggiore che un file
/// di configurazione possa contenere (0076), e vale anche per un valore
/// rifiutato.
#[test]
fn rifiutare_toglie_la_chiave_dal_file_invece_di_lasciarla_li() {
    let (_c, config) = config();
    let v = Vault::new().con_impostazioni(&[(CREA, "Mod-Alt-k")]);

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    host.discard_keybindings(None).expect("rifiutate");

    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert_eq!(accordo(&host, CREA).1, SettingSource::Default);
    let scritto = std::fs::read_to_string(v.root.join(".fub").join("settings.json")).unwrap();
    assert!(
        !scritto.contains("Mod-Alt-k"),
        "dopo una risposta non resta niente di ambiguo nel file: {scritto}"
    );
}

/// La domanda è **sui tasti, non sul vault**, ed è qui che si vede la
/// differenza: un vault aperto e risposto ieri può ricevere stanotte un accordo
/// nuovo, da una sincronizzazione o da un collega. Un criterio basato su «questo
/// vault l'ho già visto» lo lascerebbe passare.
#[test]
fn un_accordo_cambiato_a_app_chiusa_si_richiede() {
    let (_c, config) = config();
    let v = Vault::new().con_impostazioni(&[(CREA, "Mod-Alt-k")]);

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    host.adopt_keybindings(None).expect("adottate");
    host.close_vault(&v.root).expect("chiuso");

    // Il file cambia mentre l'app non guarda, e cambia **su una chiave già
    // adottata**: è il caso che un confronto sulla presenza non vedrebbe.
    let v = v.con_impostazioni(&[(CREA, "Mod-s")]);
    let host = installato(&config);
    host.open(&v.root).expect("si riapre");

    let in_attesa = host.pending_keybindings(None).expect("aperto");
    assert_eq!(in_attesa.get(CREA).map(String::as_str), Some("Mod-s"));
    assert_eq!(accordo(&host, CREA).1, SettingSource::Default);
}

/// Rispondere su **una** scorciatoia non è rispondere sulle altre: chi rimappa
/// un comando dal pannello non ha guardato le altre che quel vault portava.
///
/// È il caso in cui la memoria per chiave paga ciò che un'impronta sola non
/// saprebbe pagare.
#[test]
fn scriverne_una_non_adotta_le_altre() {
    let (_c, config) = config();
    let v = Vault::new().con_impostazioni(&[(CREA, "Mod-Alt-k"), (SVUOTA, "Mod-s")]);

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    host.set_setting_for_user(None, CREA, SettingValue::Text("Mod-j".into()))
        .expect("il pannello scrive");

    // Quella scritta vale — l'ha battuta una persona — e l'altra no.
    assert_eq!(accordo(&host, CREA).0, SettingValue::Text("Mod-j".into()));
    assert_eq!(accordo(&host, SVUOTA).1, SettingSource::Default);
    let in_attesa = host.pending_keybindings(None).expect("aperto");
    assert_eq!(in_attesa.keys().collect::<Vec<_>>(), vec![SVUOTA]);
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
#[test]
fn le_scorciatoie_scritte_qui_viaggiano_ancora_col_vault() {
    let (_c, config) = config();
    let v = Vault::new();

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    host.set_setting_for_user(None, CREA, SettingValue::Text("Mod-Alt-k".into()))
        .expect("il pannello scrive");
    assert!(
        host.pending_keybindings(None).unwrap().is_empty(),
        "ciò che si è appena battuto non si chiede"
    );
    host.close_vault(&v.root).expect("chiuso");

    let host = installato(&config);
    host.open(&v.root).expect("si riapre");
    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert_eq!(
        accordo(&host, CREA).0,
        SettingValue::Text("Mod-Alt-k".into())
    );
}

/// **Le altre chiavi del vault non si sospendono.** Un tema che arriva da fuori
/// si applica, ed è la 0076 che regge: si vede subito e si disfa in un gesto.
/// Sospendere anche quelle sarebbe stato il modo di far pagare a tutti il
/// prezzo di una famiglia sola.
#[test]
fn un_tema_che_arriva_da_fuori_si_applica_ancora() {
    let (_c, config) = config();
    let v = Vault::new().con_impostazioni(&[
        (fub_host::settings::APPEARANCE_THEME, "dark"),
        (fub_kernel::locale::LANGUAGE, "en"),
    ]);

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert_eq!(
        accordo(&host, fub_host::settings::APPEARANCE_THEME),
        (SettingValue::Text("dark".into()), SettingSource::Vault)
    );
    assert_eq!(
        accordo(&host, fub_kernel::locale::LANGUAGE).1,
        SettingSource::Vault
    );
}

/// **Un vault senza scorciatoie non chiede niente**, e non scrive niente nel
/// registro: la strada che costa meno è quella di chi il problema non ce l'ha,
/// che sono quasi tutti.
#[test]
fn un_vault_che_non_porta_tasti_non_fa_domande() {
    let (_c, config) = config();
    let v = Vault::new();

    let host = installato(&config);
    host.open(&v.root).expect("si apre");
    assert!(host.pending_keybindings(None).unwrap().is_empty());
    assert!(
        host.known_vaults()[0].keys_seen.is_empty(),
        "niente da guardare, niente da ricordare"
    );
}
