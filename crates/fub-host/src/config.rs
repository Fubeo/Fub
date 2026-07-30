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

/// Il file di log della macchina (§17.3). Sta accanto alla configurazione e
/// non nel vault: è uno strumento di chi guarda Fub, non un dato che viaggia
/// con le note. In una sottocartella `logs/` perché non è un'impostazione e non
/// va confuso con i tre file della macchina.
pub fn log_path(config_dir: &camino::Utf8Path) -> Utf8PathBuf {
    config_dir.join("logs").join("fub.log")
}

/// **Installa il collettore del log per tutto il processo** (§17.3) e torna i
/// livelli condivisi.
///
/// È la prima cosa che fa `fub_app::run`, prima di qualunque vault: ogni riga
/// di `tracing` da lì in poi — comprese quelle di `Host::installed`, che apre i
/// file della macchina — ha un posto dove andare. Senza un `config_dir`
/// (`Host::new`, ambienti senza `HOME`) il sink è `stderr`, ed è l'unico
/// `stderr` che resta in Fub: là non c'è nessun altro canale.
///
/// Il file non apre? `FileSink::open` torna un avviso, e in quel caso il sink
/// degrada a `stderr`: un log che non si apre non deve impedire all'app di
/// partire — la stessa regola di `MachineSettings::open`.
pub fn install_logging() -> std::sync::Arc<fub_kernel::log::Levels> {
    use std::sync::Arc;
    let levels = Arc::new(fub_kernel::log::Levels::default());
    let sink: Arc<dyn fub_kernel::log::Sink> = match config_dir() {
        Some(dir) => {
            let (sink, _warning) = fub_kernel::log::FileSink::open(&log_path(&dir));
            Arc::new(sink)
        }
        None => Arc::new(fub_kernel::log::StderrSink),
    };
    // In `run` siamo i primi; il `Err` si vede solo se qualcuno ha già
    // installato, e in un test non si passa di qui.
    let _ = fub_kernel::log::install(Arc::clone(&levels), sink);
    levels
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
    fn la_variabile_di_bootstrap_vince_su_tutto() {
        let _guardia = ENV.lock().unwrap_or_else(|e| e.into_inner());
        // SAFETY: sotto il mutex di questo modulo, e rimessa a posto sotto.
        unsafe { std::env::set_var("FUB_CONFIG_DIR", "/tmp/fub-prova") };
        assert_eq!(config_dir(), Some(Utf8PathBuf::from("/tmp/fub-prova")));
        unsafe { std::env::remove_var("FUB_CONFIG_DIR") };
    }

    #[test]
    fn una_variabile_vuota_non_conta_come_una_scelta() {
        let _guardia = ENV.lock().unwrap_or_else(|e| e.into_inner());
        unsafe { std::env::set_var("FUB_CONFIG_DIR", "   ") };
        assert_ne!(config_dir(), Some(Utf8PathBuf::from("   ")));
        unsafe { std::env::remove_var("FUB_CONFIG_DIR") };
    }

    #[test]
    fn i_tre_file_stanno_accanto_e_non_dentro() {
        let dir = Utf8PathBuf::from("/config");
        assert_eq!(machine_settings_path(&dir), "/config/settings.json");
        assert_eq!(vault_registry_path(&dir), "/config/vaults.json");
        assert_eq!(view_states_path(&dir), "/config/view-state.json");
    }
}
