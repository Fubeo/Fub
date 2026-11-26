//! Le corsie dell'host: dove gira il lavoro dei comandi, fuori dal thread principale.

use super::*;

/// Chi dà l'host al lavoro di una corsia: l'app, e nei test un `Arc<Host>`,
/// così le prove dell'ordine passano per le stesse funzioni dei comandi.
pub(crate) trait HostSource: Send + 'static {
    fn with_host<T>(&self, work: impl FnOnce(&Host) -> T) -> T;
}

impl HostSource for AppHandle {
    fn with_host<T>(&self, work: impl FnOnce(&Host) -> T) -> T {
        work(&self.state::<Host>())
    }
}

#[cfg(test)]
impl HostSource for Arc<Host> {
    fn with_host<T>(&self, work: impl FnOnce(&Host) -> T) -> T {
        work(self)
    }
}

/// Chi dà al lavoro di una corsia l'host e il registro delle finestre
/// documento (`close_vault`): l'app, e nei test una coppia di `Arc`.
pub(crate) trait WindowsSource: Send + 'static {
    fn with_windows<T>(
        &self,
        work: impl FnOnce(&Host, &document_windows::DocumentWindows) -> T,
    ) -> T;
}

impl WindowsSource for AppHandle {
    fn with_windows<T>(
        &self,
        work: impl FnOnce(&Host, &document_windows::DocumentWindows) -> T,
    ) -> T {
        work(
            &self.state::<Host>(),
            &self.state::<document_windows::DocumentWindows>(),
        )
    }
}

#[cfg(test)]
impl WindowsSource for (Arc<Host>, Arc<document_windows::DocumentWindows>) {
    fn with_windows<T>(
        &self,
        work: impl FnOnce(&Host, &document_windows::DocumentWindows) -> T,
    ) -> T {
        work(&self.0, &self.1)
    }
}

/// Gli effetti nativi di un'impostazione scritta: lo zoom della finestra che
/// l'ha scritta e il tetto dei fotogrammi di tutte. Li applica la corsia,
/// subito dopo la scrittura riuscita: Tauri li porta al thread principale
/// nell'ordine in cui partono, così due zoom scritti di fila lasciano la
/// finestra sull'ultimo. Nei test un registro prende il loro posto.
pub(crate) trait NativeSettings: Send + 'static {
    fn set_zoom(&self, scale: f64) -> Result<(), String>;
    fn set_frame_rate(&self, beyond_60: bool);
}

impl NativeSettings for tauri::WebviewWindow {
    fn set_zoom(&self, scale: f64) -> Result<(), String> {
        tauri::WebviewWindow::set_zoom(self, scale).map_err(|and| and.to_string())
    }

    fn set_frame_rate(&self, beyond_60: bool) {
        frame_rate::apply_all(self.app_handle(), beyond_60);
    }
}

/// Il lavoro di una porta dell'host fuori dal thread principale, in fondo
/// alla corsia `corsia` (`domande`). Un comando sincrono di Tauri gira sul
/// thread che presenta i fotogrammi: una chiamata a un provider, una
/// scrittura su disco o l'attesa di un prestito del workspace tenuto da un
/// salvataggio fermavano la finestra per tutto quel tempo. La corsia tiene
/// l'ordine d'arrivo che il thread principale dava; gli errori restano quelli
/// dell'host, e un panico risponde `Internal`.
pub(crate) async fn host_lane<S, T, F>(
    source: S,
    corsie: &domande::Corsie,
    cosa: &'static str,
    corsia: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    S: HostSource,
    T: Send + 'static,
    F: FnOnce(&Host) -> Result<T, PluginError> + Send + 'static,
{
    corsie
        .chiedi(cosa, corsia.into(), move || source.with_host(work))
        .await
}

/// Una lettura dell'host senza un ordine da tenere (gli elenchi di view, di
/// comandi, di componenti e di temi, la mappa dei componenti, un tema) fuori
/// dal thread principale, senza corsia: prende il workspace in prestito
/// condiviso o legge il disco, e sul thread principale aspetterebbe chi lo
/// sta scrivendo. Chi la chiede la aspetta prima di usarla, e due letture
/// uguali rispondono la stessa cosa in qualunque ordine escano. Ci passa
/// anche `cancel_job`, che vale lo stesso in qualunque momento arrivi.
pub(crate) async fn host_read<T, F>(
    app: AppHandle,
    cosa: &'static str,
    work: F,
) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host) -> Result<T, PluginError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Host>()))
        .await
        .map_err(|error| unfinished(cosa, error))?
}
