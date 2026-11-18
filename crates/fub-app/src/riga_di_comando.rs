//! Gli argomenti del binario `fub` che non aprono l'app: `--version` (`-V`) e
//! `--help` (`-h`) scrivono una riga o un aiuto breve ed escono, prima di
//! Tauri, della configurazione e dei log. Tutto il resto, `fub://` compresi e
//! gli argomenti che qui nessuno conosce, lascia l'avvio di sempre: un
//! collegamento lo legge il `setup`, e un argomento ignoto non deve impedire a
//! un lanciatore del sistema di aprire l'app.
//!
//! Su Windows il binario di rilascio è un programma a finestra
//! (`windows_subsystem = "windows"`) e non ha una console: prima di scrivere
//! si aggancia a quella del terminale che l'ha lanciato (`AttachConsole`).
//! Un'uscita rediretta su file o pipe ha già la sua maniglia e non cambia.

use std::ffi::OsStr;
use std::io::Write;

/// Il nome del programma, come lo chiamano i pacchetti.
const PROGRAMMA: &str = "fub";

/// Le azioni dei collegamenti `fub://` che l'app accetta, come le legge
/// `fub_host::automation::parse_fub_uri` (il test lo controlla).
pub const AZIONI_FUB: [&str; 7] = [
    "open",
    "new",
    "daily",
    "unique",
    "search",
    "capture",
    "choose-vault",
];

/// Che cosa chiede la riga di comando.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Richiesta {
    /// La versione, e basta.
    Versione,
    /// L'aiuto breve.
    Aiuto,
    /// L'avvio dell'app, con gli argomenti che il `setup` saprà leggere.
    Avvio,
}

/// Legge gli argomenti **dopo** il nome del programma. Vince la prima
/// richiesta che si riconosce; `--` chiude le opzioni, e ciò che segue (o un
/// `fub://` che contenga per caso `--help`) non si guarda. Un argomento ignoto
/// non è un errore: è l'avvio di sempre.
pub fn richiesta<I, S>(argomenti: I) -> Richiesta
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    for argomento in argomenti {
        let argomento = argomento.as_ref();
        if argomento == "--" {
            break;
        }
        if argomento == "--version" || argomento == "-V" {
            return Richiesta::Versione;
        }
        if argomento == "--help" || argomento == "-h" {
            return Richiesta::Aiuto;
        }
    }
    Richiesta::Avvio
}

/// La riga di `--version`.
pub fn testo_versione() -> String {
    format!("{PROGRAMMA} {}\n", env!("CARGO_PKG_VERSION"))
}

/// Il testo di `--help`.
pub fn testo_aiuto() -> String {
    let versione = env!("CARGO_PKG_VERSION");
    let azioni = AZIONI_FUB.join(", ");
    format!(
        "Fub {versione}: note, documenti, fogli, PDF e disegni in un vault di file.\n\
         \n\
         Uso:\n  \
           {PROGRAMMA}                  apre l'app\n  \
           {PROGRAMMA} fub://AZIONE?…   apre l'app e le consegna il collegamento\n  \
           {PROGRAMMA} --version, -V    scrive la versione ed esce\n  \
           {PROGRAMMA} --help, -h       scrive questo aiuto ed esce\n\
         \n\
         Azioni dei collegamenti fub://: {azioni}.\n\
         \n\
         Per lavorare su un vault dal terminale, senza finestra, c'è il programma\n\
         a parte fub-cli, se è installato: fub-cli help.\n"
    )
}

/// Risponde a `--version` e `--help` e dice con che codice uscire; `None` è
/// l'avvio dell'app. Non tocca né la configurazione né i log.
pub fn rispondi<I, S>(argomenti: I) -> Option<i32>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let testo = match richiesta(argomenti) {
        Richiesta::Avvio => return None,
        Richiesta::Versione => testo_versione(),
        Richiesta::Aiuto => testo_aiuto(),
    };
    aggancia_la_console();
    let mut uscita = std::io::stdout().lock();
    let scritto = uscita
        .write_all(testo.as_bytes())
        .and_then(|()| uscita.flush());
    Some(if scritto.is_ok() { 0 } else { 1 })
}

/// Il binario di rilascio su Windows non ha console: si scrive in quella del
/// terminale che l'ha lanciato, se c'è. Lanciato da un collegamento non c'è
/// nessuna console, e il testo non va da nessuna parte (l'uscita resta 0).
#[cfg(windows)]
fn aggancia_la_console() {
    use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    // SAFETY: `AttachConsole` non prende puntatori; se il processo ha già una
    // console (build di debug, uscita rediretta) fallisce senza effetti.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
fn aggancia_la_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_e_v_chiedono_la_versione() {
        assert_eq!(richiesta(["--version"]), Richiesta::Versione);
        assert_eq!(richiesta(["-V"]), Richiesta::Versione);
    }

    #[test]
    fn help_e_h_chiedono_l_aiuto() {
        assert_eq!(richiesta(["--help"]), Richiesta::Aiuto);
        assert_eq!(richiesta(["-h"]), Richiesta::Aiuto);
    }

    #[test]
    fn senza_argomenti_o_con_un_collegamento_si_avvia() {
        assert_eq!(richiesta(Vec::<&str>::new()), Richiesta::Avvio);
        assert_eq!(richiesta(["fub://open?note=Diario"]), Richiesta::Avvio);
        // Un collegamento che contiene la parola non è l'opzione.
        assert_eq!(richiesta(["fub://search?q=--help"]), Richiesta::Avvio);
    }

    #[test]
    fn un_argomento_ignoto_lascia_l_avvio_di_sempre() {
        assert_eq!(richiesta(["--sconosciuto"]), Richiesta::Avvio);
        assert_eq!(richiesta(["-v"]), Richiesta::Avvio);
        assert_eq!(richiesta(["version"]), Richiesta::Avvio);
    }

    #[test]
    fn vince_la_prima_richiesta_e_il_doppio_trattino_chiude() {
        assert_eq!(
            richiesta(["fub://open", "--help", "--version"]),
            Richiesta::Aiuto
        );
        assert_eq!(richiesta(["--version", "--help"]), Richiesta::Versione);
        assert_eq!(richiesta(["--", "--version"]), Richiesta::Avvio);
    }

    #[test]
    fn la_versione_e_quella_del_pacchetto() {
        assert_eq!(
            testo_versione(),
            format!("fub {}\n", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn l_aiuto_dice_versione_opzioni_collegamenti_e_cli() {
        let aiuto = testo_aiuto();
        assert!(aiuto.contains(env!("CARGO_PKG_VERSION")));
        for opzione in ["--version", "-V", "--help", "-h", "fub://", "fub-cli"] {
            assert!(aiuto.contains(opzione), "l'aiuto non dice {opzione}");
        }
        for azione in AZIONI_FUB {
            assert!(aiuto.contains(azione), "l'aiuto non dice {azione}");
        }
    }

    /// Le azioni che l'aiuto elenca sono quelle che l'host riconosce: un
    /// `fub://` di una di loro non è mai un'«azione sconosciuta».
    #[test]
    fn le_azioni_dell_aiuto_sono_quelle_dell_host() {
        for azione in AZIONI_FUB {
            if let Err(errore) = fub_host::automation::parse_fub_uri(&format!("fub://{azione}")) {
                assert!(
                    !format!("{errore:?}").contains("azione sconosciuta"),
                    "{azione}: {errore:?}"
                );
            }
        }
        let ignota = fub_host::automation::parse_fub_uri("fub://inventata").unwrap_err();
        assert!(format!("{ignota:?}").contains("azione sconosciuta"));
    }

    #[test]
    fn rispondi_esce_con_zero_e_lascia_passare_l_avvio() {
        assert_eq!(rispondi(["--version"]), Some(0));
        assert_eq!(rispondi(["fub://open"]), None);
        assert_eq!(rispondi(["--sconosciuto"]), None);
    }
}
