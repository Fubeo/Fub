//! **Dove sta la configurazione della macchina** (§11.1).
//!
//! È l'unica cosa che non può essere un'impostazione: dove sono le impostazioni.
//! Da qui viene la forma di questo modulo — tre regole in ordine, nessuna delle
//! quali si legge da un file di configurazione — e il fatto che
//! `FUB_CONFIG_DIR` resti una variabile d'ambiente mentre il §11.1 le sta
//! togliendo tutte. Non è un'eccezione concessa: è il **bootstrap**, e una
//! variabile d'ambiente che dice dove cercare è diversa da una che dice cosa
//! fare — la prima la si può togliere solo scegliendo un posto e basta.
//!
//! Le tre regole, in ordine:
//!
//! 1. `FUB_CONFIG_DIR`, se c'è: è la porta di chi esegue una suite di test,
//!    di chi ne tiene due installazioni, e di chi impacchetta.
//! 2. Il **portable**: un file `fub.portable` accanto all'eseguibile fa
//!    scrivere la configurazione lì di fianco (`fub-config/`), invece che nel
//!    profilo dell'utente. È il terzo «livello» che il §11.1 nominava, e non è
//!    un livello: è *dove sta* quello della macchina — un terzo strato di merge
//!    avrebbe voluto dire un terzo posto in cui la stessa chiave vale un'altra
//!    cosa, senza che nessuno dei tre sappia dire chi ha vinto.
//! 3. Il profilo dell'utente, con la convenzione del sistema.
//!
//! # Perché non una dipendenza
//!
//! `dirs` (o `directories`) farebbe questo, e porterebbe un albero di crate in
//! un progetto che ne dichiara l'SBOM ([decisione 0001](../../../docs/decisions/0001-supply-chain-e-sbom.md))
//! per **venti righe** che sono variabili d'ambiente documentate da vent'anni. Il
//! giorno che servisse anche «dove stanno le cache» e «dove stanno i dati», la
//! dipendenza tornerebbe a valere il suo prezzo.

use camino::Utf8PathBuf;

/// Il nome della cartella dell'app dentro il profilo dell'utente.
const APP_DIR: &str = "fub";
/// Il file che, accanto all'eseguibile, dichiara un'installazione portable.
const PORTABLE_MARKER: &str = "fub.portable";
/// Dove scrive un'installazione portable, accanto all'eseguibile.
const PORTABLE_DIR: &str = "fub-config";

/// La cartella di configurazione della macchina, o `None` se questo sistema non
/// sa dire dove sia.
///
/// `None` non è un errore da mostrare: è un host senza un posto dove scrivere —
/// un ambiente senza `HOME` — e chi lo riceve lavora **in memoria**. Perdere il
/// tema è meglio di un'app che non parte.
pub fn config_dir() -> Option<Utf8PathBuf> {
    if let Some(dir) = env_path("FUB_CONFIG_DIR") {
        return Some(dir);
    }
    if let Some(dir) = portable_dir() {
        return Some(dir);
    }
    user_config_dir().map(|dir| dir.join(APP_DIR))
}

/// Il file delle impostazioni di macchina dentro una cartella di
/// configurazione.
pub fn machine_settings_path(config_dir: &camino::Utf8Path) -> Utf8PathBuf {
    config_dir.join("settings.json")
}

/// Il file del registro dei vault dentro una cartella di configurazione.
///
/// Accanto alle impostazioni e non dentro di esse: un'impostazione ha **un
/// valore**, il registro ha **dei record** (path, icona, preferito, ultima
/// apertura). Ficcarlo in una chiave di tipo lista avrebbe voluto dire
/// serializzare dei record dentro delle stringhe, cioè un formato dentro un
/// formato. Stessa cartella, stessa disciplina — versione di schema e scrittura
/// atomica — due file.
pub fn vault_registry_path(config_dir: &camino::Utf8Path) -> Utf8PathBuf {
    config_dir.join("vaults.json")
}

/// Il file dello **stato di vista** (§11.2) dentro una cartella di
/// configurazione.
///
/// Terzo file accanto agli altri due, per la stessa ragione del secondo: non è
/// un'impostazione — non ha uno schema, non lo decide l'utente, e un pannello di
/// impostazioni con dentro lo scroll di ieri sarebbe stato il segno che la
/// distinzione mancava. Qui e non nel vault perché **non viaggia col vault**: lo
/// scroll di ieri sul portatile non è un fatto sul vault, e sincronizzarlo
/// vorrebbe dire far litigare due macchine su dove si era rimasti.
pub fn view_states_path(config_dir: &camino::Utf8Path) -> Utf8PathBuf {
    config_dir.join("view-state.json")
}

/// La cartella dei temi installati dentro una cartella di configurazione.
///
/// Una sottocartella `themes/`, come `logs/`, perché un tema non è
/// un'impostazione: non ha uno schema, non lo dichiara il core, e il suo
/// contenuto è un manifest e dei fogli — non una chiave in un file JSON. Sta
/// qui e non dentro un vault perché è della **macchina**: la pelle che questa
/// installazione conosce deve valere anche quando un vault non si apre (è la
/// stessa ragione di [`log_path`]), e un tema che viaggiasse con le note
/// sarebbe un tema per vault — il contrario di ciò che la
/// [decisione 0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md)
/// ha deciso per le preferenze.
///
/// La struttura è `<config>/themes/<id>/`, con il manifest in
/// `manifest.json` accanto al foglio e alla pelle: un tema è **una cartella
/// sola**, e una cartella si installa, si disinstalla e si riconosce senza
/// inventare un registro.
pub fn themes_dir(config_dir: &camino::Utf8Path) -> Utf8PathBuf {
    config_dir.join("themes")
}

/// Il file di log della macchina (§17.3). Sta accanto alla configurazione e
/// non nel vault: è uno strumento di chi guarda Fub, non un dato che viaggia
/// con le note. In una sottocartella `logs/` perché non è un'impostazione e non
/// va confuso con i tre file della macchina.
pub fn log_path(config_dir: &camino::Utf8Path) -> Utf8PathBuf {
    config_dir.join("logs").join("fub.log")
}

/// **Installa il collettore del log per tutto il processo** (§17.3) e torna i
/// livelli condivisi **e l'avviso** che il pavimento ha composto — la diagnosi
/// «il log non ha potuto aprire il suo file», o «non c'è nessuna cartella di
/// configurazione». Chi chiama (solo `fub_app::run`) lo passa all'host, che è
/// il livello in cui la diagnosi diventa un `Event::Trouble` (§25.5): qui non
/// può — non esiste ancora nessun canale verso chi guarda.
///
/// È la prima cosa che fa `fub_app::run`, prima di qualunque vault: ogni riga
/// di `tracing` da lì in poi — comprese quelle di `Host::installed`, che apre i
/// file della macchina — ha un posto dove andare. Senza un `config_dir`
/// (`Host::new`, ambienti senza `HOME`) il sink è `stderr`, ed è l'unico
/// `stderr` che resta in Fub: là non c'è nessun altro canale.
///
/// Il file non apre? Il sink ripiega su `stderr` **e la ragione si dice**, con
/// la prima riga che passa dal collettore appena montato: un log che non si apre
/// non deve impedire all'app di partire — la stessa regola di
/// `MachineSettings::open` — ma non deve nemmeno sparire senza una parola.
pub fn install_logging() -> (std::sync::Arc<fub_kernel::log::Levels>, Option<String>) {
    use std::sync::Arc;
    let levels = Arc::new(fub_kernel::log::Levels::default());
    let (sink, notice) = floor(config_dir());
    // In `run` siamo i primi; il `Err` si vede solo se qualcuno ha già
    // installato, e in un test non si passa di qui.
    let _ = fub_kernel::log::install(Arc::clone(&levels), sink);
    // **Dopo** l'installazione e non prima: questa riga esiste per essere letta,
    // e prima del collettore non avrebbe avuto dove andare. Il canale che la
    // riceve è proprio quello su cui si è appena ripiegato.
    if let Some(ref notice) = notice {
        tracing::warn!(target: "fub.host", "{notice}");
    }
    (levels, notice)
}

/// **Dove va il log, e — se non è il file — perché.**
///
/// Sta fuori da [`install_logging`] perché quella monta un collettore *globale
/// al processo*, cioè si esegue una volta sola e nessun banco la può rifare. La
/// scelta invece è il pezzo che si sbaglia, ed è il pezzo che si prova.
///
/// Il caso che questa funzione esiste per non ripetere: `config_dir()` è un
/// path, non una promessa che ci si possa scrivere. Un'installazione portable
/// (il marcatore [`PORTABLE_MARKER`] accanto all'eseguibile) su un supporto in
/// sola lettura torna `Some(dir)` come qualunque altra, e prima di questa
/// riparazione ciò che ne usciva era un `FileSink` senza file: ogni riga di
/// `tracing` del processo — comprese quelle con cui le impostazioni, il registro
/// dei vault e lo stato di vista denunciano di non essersi salvati — finiva nel
/// vuoto. Il canale con cui ogni altro guasto si racconta era il primo a
/// tacere, e taceva proprio nel caso in cui c'era di più da dire.
fn floor(dir: Option<Utf8PathBuf>) -> (std::sync::Arc<dyn fub_kernel::log::Sink>, Option<String>) {
    use std::sync::Arc;
    let Some(dir) = dir else {
        // Nessuna cartella di configurazione — un ambiente senza `HOME` — e
        // `stderr` è il canale **normale**, non un ripiego: il log non ha un
        // posto dove andare. Ma perde le stesse undici specie di stato del ramo
        // non scrivibile (impostazioni della macchina, registro dei vault,
        // stato di vista), e la voce 25.5 ha deciso che anche questo si dice:
        // una volta per sessione, come l'altro ramo. Prima (0062) non c'era
        // niente da spiegare — non scrivere non era un guasto; da questa voce
        // tacere è la diagnosi che manca, non la riga.
        return (
            Arc::new(fub_kernel::log::StderrSink),
            Some(
                "No configuration folder (an environment without `HOME`): Fub \
                 works in memory, and machine settings, the vault journal, and \
                 the view state will not be saved anywhere."
                    .into(),
            ),
        );
    };
    match fub_kernel::log::FileSink::open(&log_path(&dir)) {
        Ok(file) => (Arc::new(file), None),
        Err(and) => (
            Arc::new(fub_kernel::log::StderrSink),
            Some(format!(
                "{and}. This session's log goes to stderr. If `{dir}` is not \
                 writable, machine settings, the vault journal, and the view \
                 state will not be saved either: a portable installation takes \
                 the folder next to the executable because the \
                 `{PORTABLE_MARKER}` marker is there, not because it is \
                 writable."
            )),
        ),
    }
}

fn env_path(key: &str) -> Option<Utf8PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(Utf8PathBuf::from)
}

/// L'installazione è portable? Lo dice un file accanto all'eseguibile, e non una
/// variabile d'ambiente: una chiavetta la si sposta da un computer all'altro, e
/// ciò che la rende portable deve viaggiare **con lei**.
///
/// **Il marcatore dice dove, non dice che ci si possa scrivere**, e le due cose
/// non coincidono: una chiavetta in sola lettura, o un `fub.portable` finito
/// accanto a un eseguibile di sistema. Cosa fare in quel caso — ripiegare sul
/// profilo dell'utente, lavorare in memoria, o rifiutarsi di partire — è una
/// scelta di prodotto e non è stata presa: ripiegare in silenzio sulla home
/// sparpaglierebbe i dati di chi ha scelto la chiavetta proprio per non
/// lasciarne in giro. Ciò che è deciso è che **non si tace**: il guasto si
/// scopre all'avvio e lo dice [`pavimento`], perché il primo a provare a
/// scrivere in quella cartella è il log.
fn portable_dir() -> Option<Utf8PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = Utf8PathBuf::from_path_buf(exe.parent()?.to_path_buf()).ok()?;
    dir.join(PORTABLE_MARKER)
        .is_file()
        .then(|| dir.join(PORTABLE_DIR))
}

/// La convenzione del sistema, senza dipendenze.
#[cfg(target_os = "windows")]
fn user_config_dir() -> Option<Utf8PathBuf> {
    env_path("APPDATA")
}

#[cfg(target_os = "macos")]
fn user_config_dir() -> Option<Utf8PathBuf> {
    env_path("HOME").map(|home| home.join("Library").join("Application Support"))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn user_config_dir() -> Option<Utf8PathBuf> {
    // XDG: la variabile se c'è, il fallback che la specifica stessa dichiara se
    // non c'è. Un `XDG_CONFIG_HOME` **relativo** va ignorato per specifica, e
    // ignorarlo qui vuol dire non scrivere in una cartella a caso relativa alla
    // directory di lavoro di chi ha lanciato l'app.
    env_path("XDG_CONFIG_HOME")
        .filter(|p| p.is_absolute())
        .or_else(|| env_path("HOME").map(|home| home.join(".config")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le variabili d'ambiente sono globali al processo: i test che le toccano
    /// vanno in fila, o si guardano a vicenda.
    static ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn bootstrap_variable_wins_over_everything() {
        let _guard = ENV.lock().unwrap_or_else(|and| and.into_inner());
        // SAFETY: sotto il mutex di questo modulo, e rimessa a posto sotto.
        unsafe { std::env::set_var("FUB_CONFIG_DIR", "/tmp/fub-test") };
        assert_eq!(config_dir(), Some(Utf8PathBuf::from("/tmp/fub-test")));
        unsafe { std::env::remove_var("FUB_CONFIG_DIR") };
    }

    /// Una variabile di soli spazi non è una scelta: `config_dir` la ignora e
    /// cade sulla convenzione del sistema. L'ambiente reale di chi esegue il
    /// banco non deve decidere il risultato, quindi la convenzione si forza a
    /// valori noti — e si rimette a posto sotto il mutex.
    #[test]
    fn empty_variable_does_not_count_as_a_choice() {
        let _guard = ENV.lock().unwrap_or_else(|and| and.into_inner());
        unsafe { std::env::set_var("FUB_CONFIG_DIR", "   ") };
        #[cfg(target_os = "windows")]
        let expected = {
            unsafe { std::env::set_var("APPDATA", "C:\\fub-test") };
            Utf8PathBuf::from("C:\\fub-test\\fub")
        };
        #[cfg(target_os = "macos")]
        let expected = {
            unsafe { std::env::set_var("HOME", "/tmp/fub-test") };
            Utf8PathBuf::from("/tmp/fub-test/Library/Application Support/fub")
        };
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let expected = {
            unsafe { std::env::set_var("XDG_CONFIG_HOME", "/tmp/fub-test") };
            Utf8PathBuf::from("/tmp/fub-test/fub")
        };
        assert_eq!(config_dir(), Some(expected));
        unsafe { std::env::remove_var("FUB_CONFIG_DIR") };
        #[cfg(target_os = "windows")]
        unsafe {
            std::env::remove_var("APPDATA")
        };
        #[cfg(target_os = "macos")]
        unsafe {
            std::env::remove_var("HOME")
        };
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        unsafe {
            std::env::remove_var("XDG_CONFIG_HOME")
        };
    }

    /// **Un log che non si apre ripiega su `stderr`, e la ragione esiste.**
    ///
    /// La cartella non scrivibile si produce **senza permessi**: `create_dir_all`
    /// non può creare una cartella *dentro un file*, e questo vale da root — dove
    /// un `chmod` non toglie niente a nessuno — e vale su Windows, dove un
    /// `chmod` non c'è. Iniettare la forma del guasto batte aspettarsi che
    /// l'ambiente lo produca.
    ///
    /// **Verde per costruzione**, e va detto: prima della riparazione la scelta
    /// non era una funzione — stava dentro `install_logging`, che monta un
    /// collettore globale al processo e che nessun banco poteva chiamare due
    /// volte. Ciò che tiene fermo il pozzo è il **compilatore**: `FileSink::open`
    /// torna un `Result`, quindi un sink senza file non si costruisce più
    /// distrattamente. Questo presidia l'altra metà, quella che nessun tipo può
    /// esprimere: che il ripiego dica *perché* e nomini la cartella.
    #[test]
    fn log_that_wont_open_falls_back_and_reports_reason() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let base = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).expect("path UTF-8");
        let occupied = base.join("not-a-folder");
        std::fs::write(&occupied, b"a file, not a folder").expect("write");

        let (_, notice) = floor(Some(occupied.clone()));
        let notice = notice.expect("a folder inside a file cannot be created");
        assert!(
            notice.contains(occupied.as_str()),
            "notice does not name the folder: {notice}"
        );
        assert!(
            notice.contains("stderr"),
            "notice does not say where the log ended up: {notice}"
        );
    }

    /// Senza cartella di configurazione `stderr` resta il canale **normale**, e
    /// la voce 25.5 ha deciso che anche questo si dice: le undici specie di
    /// stato della macchina si perdono come nel ramo non scrivibile, e tacere
    /// sarebbe la diagnosi che manca. Prima (0062) «non c'era niente da
    /// spiegare» — la scelta di prodotto era un'altra, e questo banco la
    /// presidiava nel verso vecchio; da questa voce la riga esiste ed è
    /// questa.
    #[test]
    fn without_folder_the_diagnosis_is_still_reported() {
        let (_, notice) = floor(None);
        let notice = notice.expect("even without folder the diagnosis must be reported");
        assert!(
            notice.contains("No configuration folder"),
            "notice does not say the folder is missing: {notice}"
        );
        assert!(
            notice.contains("will not be saved anywhere"),
            "notice does not say the data will be lost: {notice}"
        );
    }

    #[test]
    fn the_three_files_sit_next_to_each_other_not_inside() {
        let dir = Utf8PathBuf::from("/config");
        assert_eq!(machine_settings_path(&dir), "/config/settings.json");
        assert_eq!(vault_registry_path(&dir), "/config/vaults.json");
        assert_eq!(view_states_path(&dir), "/config/view-state.json");
    }
}
