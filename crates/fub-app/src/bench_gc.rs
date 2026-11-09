//! La raccolta forzata della WebView, solo per il banco della memoria (R1,
//! [#284](https://github.com/Fubeo/Fub/issues/284)).
//!
//! WebKitGTK restituisce la memoria quando vuole: la retta dei giri di R1
//! misurava quando lo faceva più che quanto restava. Il banco chiede allora una
//! raccolta prima di ogni lettura. WebKitGTK 4.1 non ha un'API del processo
//! dell'app per farlo (né `garbage_collect_javascript_objects` né un evento di
//! memoria scarsa a comando): la raccolta si può chiedere soltanto da dentro il
//! processo della WebView, con un'estensione web. L'estensione la costruisce
//! il banco (`apps/client/bench/webview/raccolta.rs`) e dà alla pagina
//! `window.__fubBenchGc`; qui l'app si limita a caricarla.
//!
//! Il modulo esiste soltanto con la feature `bench-gc`, spenta di serie: l'app
//! che si distribuisce non sa caricare un'estensione. Anche nella build del
//! banco il gancio è **spento di serie**: si accende soltanto con [`ENV`]
//! nell'ambiente all'avvio, che nomina la cartella assoluta dell'estensione. Niente comando
//! IPC, niente porte, niente file del vault: l'app legge la variabile, dice a
//! WebKit dove sta l'estensione e ricarica la finestra principale in un
//! processo nuovo, perché WebKit carica le estensioni soltanto quando il
//! processo della WebView nasce, e quello della finestra principale è già nato
//! quando l'app arriva al `setup`. Chi può scegliere l'ambiente dell'app può
//! già caricarci codice (`LD_PRELOAD`): la variabile non apre niente di nuovo.
//!
//! Soltanto Linux: R1 legge la memoria da `/proc`, e su Windows e macOS il
//! gancio non c'è.

use std::ffi::OsStr;
use std::path::PathBuf;

/// La variabile d'ambiente che accende il gancio: la cartella assoluta
/// dell'estensione del banco.
pub const ENV: &str = "FUB_BENCH_GC";

/// La cartella dell'estensione, se la variabile la nomina: un percorso
/// assoluto di una cartella che esiste. Altrimenti il gancio resta spento.
pub fn requested(value: Option<&OsStr>) -> Option<PathBuf> {
    let path = PathBuf::from(value?);
    (path.is_absolute() && path.is_dir()).then_some(path)
}

/// Accende il gancio sulla finestra principale se [`ENV`] lo chiede; senza la
/// variabile non fa niente.
pub fn install<R: tauri::Runtime>(app: &tauri::App<R>) {
    let Some(dir) = requested(std::env::var_os(ENV).as_deref()) else {
        return;
    };
    #[cfg(target_os = "linux")]
    {
        use tauri::Manager;
        let Some(main) = app.get_webview_window("main") else {
            tracing::warn!(target: "fub.app", "{ENV}: no main window, bench GC hook not installed");
            return;
        };
        let Some(dir) = dir.to_str().map(str::to_owned) else {
            tracing::warn!(target: "fub.app", "{ENV}: the directory is not UTF-8, bench GC hook not installed");
            return;
        };
        // L'indirizzo della pagina come Tauri l'ha chiesto: al `setup` WebKit
        // può non averlo ancora fatto suo, e un `reload` darebbe una pagina
        // vuota.
        let url = match main.url() {
            Ok(url) => url.to_string(),
            Err(error) => {
                tracing::warn!(target: "fub.app", %error, "{ENV}: no page URL, bench GC hook not installed");
                return;
            }
        };
        if let Err(error) = main.with_webview(move |platform| {
            use webkit2gtk::{WebContextExt, WebViewExt};
            let view = platform.inner();
            let Some(context) = view.context() else {
                tracing::warn!(target: "fub.app", "{ENV}: the webview has no context");
                return;
            };
            context.set_web_extensions_directory(&dir);
            // Il processo nuovo carica l'estensione; la pagina riparte da capo,
            // all'avvio, prima che il banco la tocchi.
            view.terminate_web_process();
            view.load_uri(&url);
            tracing::info!(target: "fub.app", "{ENV}: bench GC hook installed");
        }) {
            tracing::warn!(target: "fub.app", %error, "{ENV}: bench GC hook not installed");
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, dir);
        tracing::warn!(target: "fub.app", "{ENV}: the bench GC hook exists only on Linux");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn senza_la_variabile_il_gancio_non_c_e() {
        assert_eq!(requested(None), None);
    }

    #[test]
    fn una_variabile_vuota_relativa_o_senza_cartella_lo_lascia_spento() {
        assert_eq!(requested(Some(OsStr::new(""))), None);
        assert_eq!(requested(Some(OsStr::new("1"))), None);
        assert_eq!(requested(Some(OsStr::new("relativa/cartella"))), None);
        let dir = tempfile::tempdir().expect("cartella temporanea");
        let missing = dir.path().join("manca");
        assert_eq!(requested(Some(missing.as_os_str())), None);
        let file = dir.path().join("file");
        std::fs::write(&file, b"").expect("file");
        assert_eq!(requested(Some(file.as_os_str())), None);
    }

    #[test]
    fn una_cartella_assoluta_lo_accende() {
        let dir = tempfile::tempdir().expect("cartella temporanea");
        assert_eq!(
            requested(Some(dir.path().as_os_str())),
            Some(dir.path().to_path_buf())
        );
    }
}
