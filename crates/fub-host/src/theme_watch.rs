//! Chi guarda la cartella del tema collegato, e chi la tiene: il custode dei
//! temi dell'host ([`ThemeKeeper`]).
//!
//! Sta accanto a [`crate::watcher`], ma non è l'osservatore del vault e non ne
//! condivide niente oltre a `notify` e al suo debouncer: il vault si
//! sincronizza col kernel, un tema collegato dice soltanto alla shell «è
//! cambiato, rileggilo». Ci sono tre differenze che contano:
//!
//! - **una cartella sola**, quella scritta nella chiave
//!   [`DEVELOPER_THEME_FOLDER`](crate::settings::DEVELOPER_THEME_FOLDER), e
//!   solo con la modalità sviluppatore accesa e solo se le porte la dicono
//!   `ready` (mai una radice qualunque, mai seguendo i link simbolici); il
//!   montaggio gira su un thread del custode, mai su quello di chi scrive
//!   l'impostazione, e fra due richieste vince l'ultima; con una cartella nuova il
//!   vecchio osservatore si smonta prima che parta il nuovo, e si smonta con
//!   «Scollega», con la modalità spenta e alla chiusura dell'app;
//! - **un debounce di circa 200 ms** ([`THEME_WATCH_DEBOUNCE`]): un editor che
//!   salva con un rename (un file temporaneo, poi il nome vero) fa un cambio
//!   solo, e cinquanta salvataggi di fila fanno pochi eventi, non cinquanta;
//! - **nessun lucchetto dell'host attraverso la consegna**: la callback legge
//!   la cartella con le porte di [`crate::theme::theme_link`] e chiama
//!   l'uscita (l'evento `fub://theme-changed` dell'app), senza prendere il
//!   lucchetto del custode. Chi smonta può quindi aspettare che la consegna in
//!   volo finisca (`Debouncer::stop` aspetta il suo thread) tenendo il proprio
//!   lucchetto, e dopo lo smontaggio niente di vecchio esce più.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};

use crate::theme::{theme_link, ThemeLink, ThemeLinkState};

/// Quanto aspetta il debouncer prima di dire che la cartella è cambiata.
pub const THEME_WATCH_DEBOUNCE: Duration = Duration::from_millis(200);

/// L'uscita degli eventi del tema collegato: l'app la riempie con l'evento
/// `fub://theme-changed` verso la finestra principale.
pub type ThemeLinkSink = Arc<dyn Fn(&ThemeLink) + Send + Sync>;

/// L'ultimo id e nome letti dal manifest della cartella collegata: un
/// salvataggio a metà, col manifest che non si legge, dice ancora di chi è
/// l'evento.
#[cfg_attr(not(feature = "notify-watcher"), allow(dead_code))]
#[derive(Clone, Default)]
struct Known {
    id: Option<String>,
    name: Option<String>,
}

/// Il custode del tema collegato: la cartella guardata e il suo osservatore.
///
/// Ogni cambio di collegamento passa da [`ThemeKeeper::watch_now`] o da
/// [`ThemeKeeper::request`], serializzato dal lucchetto `ops`; la consegna
/// degli eventi non lo prende mai. Ogni richiesta ha un numero (`generation`):
/// sotto `ops` passa soltanto l'ultima, quindi un risultato vecchio non
/// sovrascrive mai uno nuovo.
pub(crate) struct ThemeKeeper {
    /// Serializza montaggio e smontaggio, e tiene ciò che è montato.
    ops: Mutex<Mounted>,
    /// L'uscita, che l'app installa dopo aver creato la finestra.
    sink: Arc<Mutex<Option<ThemeLinkSink>>>,
    known: Arc<Mutex<Known>>,
    /// Il numero dell'ultima richiesta: chi arriva sotto `ops` con un numero
    /// più vecchio non tocca niente.
    generation: AtomicU64,
    /// Chiuso (fine dell'app): nessuna richiesta monta più niente.
    closed: AtomicBool,
    /// I thread delle richieste in volo, che [`ThemeKeeper::settle`] aspetta.
    pending: Mutex<Vec<std::thread::JoinHandle<()>>>,
    /// Chi fa partire l'osservatore: `FolderWatch::start`, o un finto nei test.
    start: StartWatch,
}

/// Fa partire l'osservatore di una cartella.
type StartWatch = fn(&Utf8Path, Delivery) -> Result<FolderWatch, String>;

impl Default for ThemeKeeper {
    fn default() -> Self {
        Self::starting_with(FolderWatch::start)
    }
}

#[derive(Default)]
struct Mounted {
    folder: Option<Utf8PathBuf>,
    watch: Option<FolderWatch>,
}

fn held<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl ThemeKeeper {
    fn starting_with(start: StartWatch) -> Self {
        Self {
            ops: Mutex::default(),
            sink: Arc::default(),
            known: Arc::default(),
            generation: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            pending: Mutex::default(),
            start,
        }
    }

    /// Installa l'uscita degli eventi; gli osservatori già montati la usano
    /// dal prossimo cambio.
    pub(crate) fn set_sink(&self, sink: ThemeLinkSink) {
        *held(&self.sink) = Some(sink);
    }

    /// La cartella guardata adesso da un osservatore vivo, se c'è.
    pub(crate) fn watched(&self) -> Option<Utf8PathBuf> {
        let mounted = held(&self.ops);
        mounted.watch.as_ref().and(mounted.folder.clone())
    }

    /// `folder` è guardata adesso da un osservatore vivo?
    pub(crate) fn is_watching(&self, folder: &Utf8Path) -> bool {
        let mounted = held(&self.ops);
        mounted.watch.is_some() && mounted.folder.as_deref() == Some(folder)
    }

    /// Chiede un cambio di collegamento **fuori da chi chiama**: `resolve`
    /// (che rilegge la chiave e la modalità) e il montaggio, che legge il disco
    /// e aspetta lo smontaggio del vecchio, girano su un thread loro. Così un
    /// comando sincrono dell'app, sul thread principale, non si ferma qui. Fra
    /// più richieste vince l'ultima.
    pub(crate) fn request(
        self: &Arc<Self>,
        resolve: impl FnOnce() -> (Option<Utf8PathBuf>, Option<Utf8PathBuf>) + Send + 'static,
    ) {
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let keeper = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("fub-theme-link".into())
            .spawn(move || {
                let (config_dir, folder) = resolve();
                keeper.apply(generation, config_dir.as_deref(), folder.as_deref(), false);
            });
        match spawned {
            Ok(handle) => {
                let mut pending = held(&self.pending);
                pending.retain(|handle| !handle.is_finished());
                pending.push(handle);
            }
            Err(error) => tracing::warn!(
                target: "fub.host",
                "the linked theme folder could not be synchronised: {error}"
            ),
        }
    }

    /// Aspetta che le richieste in volo abbiano finito: chi legge lo stato
    /// subito dopo un cambio (Aspetto, i test) vede quello deciso.
    pub(crate) fn settle(&self) {
        let pending = std::mem::take(&mut *held(&self.pending));
        for handle in pending {
            let _ = handle.join();
        }
    }

    /// Guarda `folder` adesso, da chi chiama (che è già fuori dal thread
    /// principale): come una richiesta, ma senza thread. Con `again` anche la
    /// stessa cartella si rimonta: chi la collega di nuovo (sparita e tornata)
    /// vuole che la si guardi da capo.
    pub(crate) fn watch_now(
        &self,
        config_dir: Option<&Utf8Path>,
        folder: Option<&Utf8Path>,
        again: bool,
    ) {
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.apply(generation, config_dir, folder, again);
    }

    /// Guarda `folder`, o niente con `None`, se la richiesta `generation` è
    /// ancora l'ultima. La stessa cartella già guardata non si rimonta; una
    /// diversa smonta prima la vecchia (aspettando la sua consegna in volo).
    ///
    /// Si monta solo su una cartella che adesso è `ready`: una cartella
    /// mancante, rifiutata o di un altro tema non si guarda, e nessun percorso
    /// arrivato da chissà dove (`/`) apre un osservatore ricorsivo. Un
    /// osservatore che non parte (la piattaforma non lo sa fare, il sistema ha
    /// finito gli osservatori) lascia il collegamento senza rimontaggi, e lo
    /// dice il campo `watched` di [`ThemeLink`].
    fn apply(
        &self,
        generation: u64,
        config_dir: Option<&Utf8Path>,
        folder: Option<&Utf8Path>,
        again: bool,
    ) {
        let mut mounted = held(&self.ops);
        if generation != self.generation.load(Ordering::Acquire) {
            return;
        }
        if self.closed.load(Ordering::Acquire) && folder.is_some() {
            return;
        }
        if !again
            && mounted.folder.as_deref() == folder
            && (folder.is_none() || mounted.watch.is_some())
        {
            return;
        }
        // Prima si smonta: `drop` aspetta la consegna in volo del vecchio.
        mounted.watch = None;
        mounted.folder = None;
        *held(&self.known) = Known::default();
        let Some(folder) = folder else {
            return;
        };
        let first = theme_link(config_dir, folder);
        *held(&self.known) = Known {
            id: first.id,
            name: first.name,
        };
        mounted.folder = Some(folder.to_owned());
        if first.state != ThemeLinkState::Ready {
            return;
        }
        let deliver = Delivery {
            config_dir: config_dir.map(Utf8Path::to_owned),
            folder: folder.to_owned(),
            sink: self.sink.clone(),
            known: self.known.clone(),
        };
        match (self.start)(folder, deliver) {
            Ok(watch) => mounted.watch = Some(watch),
            Err(error) => tracing::warn!(
                target: "fub.host",
                folder = %folder,
                "the linked theme folder is not watched: {error}"
            ),
        }
    }

    /// Smonta l'osservatore (chiusura dell'app): dopo, nessuna richiesta
    /// rimonta più niente.
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.settle();
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.apply(generation, None, None, false);
    }
}

/// Ciò che la callback dell'osservatore usa: niente del custode oltre
/// all'uscita e all'ultimo manifest, ognuno col suo lucchetto breve.
#[cfg_attr(not(feature = "notify-watcher"), allow(dead_code))]
struct Delivery {
    config_dir: Option<Utf8PathBuf>,
    folder: Utf8PathBuf,
    sink: Arc<Mutex<Option<ThemeLinkSink>>>,
    known: Arc<Mutex<Known>>,
}

#[cfg_attr(not(feature = "notify-watcher"), allow(dead_code))]
impl Delivery {
    /// La cartella è cambiata: si rilegge con le porte e si dice. `changed`
    /// sono i path toccati, che diventano i file salvati.
    fn changed(&self, touched: impl IntoIterator<Item = std::path::PathBuf>) {
        let mut link = theme_link(self.config_dir.as_deref(), &self.folder);
        link.changed = saved_files(&self.folder, touched);
        // Chi consegna è l'osservatore vivo.
        link.watched = true;
        {
            let mut known = held(&self.known);
            if link.id.is_some() {
                known.id = link.id.clone();
                known.name = link.name.clone();
            } else {
                link.id = known.id.clone();
                link.name = known.name.clone();
            }
        }
        let sink = held(&self.sink).clone();
        if let Some(sink) = sink {
            sink(&link);
        }
    }
}

/// I file salvati, relativi alla cartella e scritti con `/`: solo quelli che
/// adesso sono file veri dentro di lei (il temporaneo di un editor che salva
/// con un rename non c'è già più), senza doppioni, al più
/// [`MAX_LINK_CHANGED`](crate::theme::MAX_LINK_CHANGED), in ordine.
#[cfg_attr(not(feature = "notify-watcher"), allow(dead_code))]
fn saved_files(
    folder: &Utf8Path,
    touched: impl IntoIterator<Item = std::path::PathBuf>,
) -> Vec<String> {
    let mut files = std::collections::BTreeSet::new();
    for path in touched {
        let Ok(path) = Utf8PathBuf::from_path_buf(path) else {
            continue;
        };
        let Ok(relative) = path.strip_prefix(folder) else {
            continue;
        };
        if relative.as_str().is_empty() || !stays_inside(folder, relative) {
            continue;
        }
        let regular = std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_file());
        if regular {
            files.insert(
                relative
                    .components()
                    .map(|part| part.as_str())
                    .collect::<Vec<_>>()
                    .join("/"),
            );
        }
    }
    files
        .into_iter()
        .take(crate::theme::MAX_LINK_CHANGED)
        .collect()
}

/// `relative` resta dentro `folder`: solo nomi veri (niente `..`), e nessuna
/// cartella di mezzo è un link simbolico, che porterebbe il file fuori.
#[cfg_attr(not(feature = "notify-watcher"), allow(dead_code))]
fn stays_inside(folder: &Utf8Path, relative: &Utf8Path) -> bool {
    let mut parts = relative.components().peekable();
    let mut at = folder.to_owned();
    while let Some(part) = parts.next() {
        let camino::Utf8Component::Normal(name) = part else {
            return false;
        };
        at.push(name);
        if parts.peek().is_some() {
            let directory =
                std::fs::symlink_metadata(&at).is_ok_and(|metadata| metadata.file_type().is_dir());
            if !directory {
                return false;
            }
        }
    }
    true
}

#[cfg(feature = "notify-watcher")]
use notify_folder::FolderWatch;

#[cfg(feature = "notify-watcher")]
mod notify_folder {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use camino::Utf8Path;
    use notify::event::EventKind;
    use notify::{RecommendedWatcher, RecursiveMode};
    use notify_debouncer_full::{
        new_debouncer_opt, DebounceEventResult, Debouncer, RecommendedCache,
    };

    use super::{Delivery, THEME_WATCH_DEBOUNCE};

    /// Il debouncer vivo sulla cartella collegata. Cade = ha finito: `stop`
    /// aspetta il thread che consegna, e la bandiera ferma una consegna che
    /// arriva dopo che lo smontaggio è cominciato.
    pub(super) struct FolderWatch {
        debouncer: Option<Debouncer<RecommendedWatcher, RecommendedCache>>,
        live: Arc<AtomicBool>,
    }

    impl FolderWatch {
        pub(super) fn start(folder: &Utf8Path, deliver: Delivery) -> Result<Self, String> {
            let live = Arc::new(AtomicBool::new(true));
            let open = live.clone();
            // I link simbolici dentro la cartella non si seguono: le porte li
            // rifiutano, e un osservatore che li seguisse guarderebbe fuori.
            let config = notify::Config::default().with_follow_symlinks(false);
            let mut debouncer = new_debouncer_opt::<_, RecommendedWatcher, RecommendedCache>(
                THEME_WATCH_DEBOUNCE,
                None,
                move |result: DebounceEventResult| {
                    if !open.load(Ordering::Acquire) {
                        return;
                    }
                    match result {
                        Ok(events) => {
                            // Chi ha solo guardato non ha cambiato niente.
                            let touched: Vec<_> = events
                                .into_iter()
                                .filter(|event| !matches!(event.kind, EventKind::Access(_)))
                                .flat_map(|event| event.event.paths)
                                .collect();
                            if !touched.is_empty() {
                                deliver.changed(touched);
                            }
                        }
                        // L'osservatore non vede più la cartella (sparita, o il
                        // sistema ha smesso): si rilegge e si dice com'è.
                        Err(errors) => {
                            tracing::warn!(
                                target: "fub.host",
                                "the linked theme folder watch reported: {errors:?}"
                            );
                            deliver.changed(Vec::new());
                        }
                    }
                },
                RecommendedCache::new(),
                config,
            )
            .map_err(|error| error.to_string())?;
            debouncer
                .watch(folder.as_std_path(), RecursiveMode::Recursive)
                .map_err(|error| error.to_string())?;
            Ok(Self {
                debouncer: Some(debouncer),
                live,
            })
        }
    }

    impl Drop for FolderWatch {
        fn drop(&mut self) {
            self.live.store(false, Ordering::Release);
            if let Some(debouncer) = self.debouncer.take() {
                debouncer.stop();
            }
        }
    }
}

/// Senza `notify` (gli host headless, mobile e PWA) la cartella non si guarda:
/// il tema collegato si legge, ma non si rimonta da solo.
#[cfg(not(feature = "notify-watcher"))]
struct FolderWatch;

#[cfg(not(feature = "notify-watcher"))]
impl FolderWatch {
    fn start(_folder: &Utf8Path, _deliver: Delivery) -> Result<Self, String> {
        Err("this host has no folder watcher".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
        (dir, path)
    }

    /// Un tema che passa le porte: manifest, un foglio per luce, la pelle.
    fn write_theme(root: &Utf8Path, id: &str) {
        std::fs::create_dir_all(root).unwrap();
        let manifest = format!(
            r#"{{"id": "{id}", "name": "Prova", "version": "1.0.0", "engine": "theme-2", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"]}}"#
        );
        std::fs::write(root.join("manifest.json"), manifest).unwrap();
        std::fs::write(root.join("sheet-light.css"), "body { color: #333; }\n").unwrap();
        std::fs::write(root.join("sheet-dark.css"), "body { color: #ddd; }\n").unwrap();
        std::fs::write(root.join("skin.css"), ".surface { color: inherit; }\n").unwrap();
    }

    fn never_started(folder: &Utf8Path, _deliver: Delivery) -> Result<FolderWatch, String> {
        panic!("no watch may start on {folder}");
    }

    fn refused(_folder: &Utf8Path, _deliver: Delivery) -> Result<FolderWatch, String> {
        Err("no more watches on this system".into())
    }

    /// Una cartella che non è pronta non si guarda mai: né la radice del disco
    /// (un valore arrivato da fuori), né una cartella vuota, né una sparita.
    #[test]
    fn only_a_ready_folder_is_watched() {
        let keeper = ThemeKeeper::starting_with(never_started);
        let (_dir, empty) = temporary();
        for folder in [Utf8Path::new("/"), empty.as_path(), &empty.join("sparita")] {
            keeper.watch_now(None, Some(folder), true);
            assert_eq!(keeper.watched(), None);
            assert!(!keeper.is_watching(folder));
        }
    }

    /// Un osservatore che non parte lascia il collegamento non guardato, e lo
    /// si sa: `watched` resta falso.
    #[test]
    fn a_watch_that_does_not_start_is_not_watching() {
        let keeper = ThemeKeeper::starting_with(refused);
        let (_dir, root) = temporary();
        let folder = root.join("carta");
        write_theme(&folder, "acme.carta");
        keeper.watch_now(None, Some(&folder), false);
        assert!(!keeper.is_watching(&folder));
        assert_eq!(keeper.watched(), None);
    }

    /// Fra due richieste vince l'ultima, anche se la prima finisce dopo.
    #[cfg(feature = "notify-watcher")]
    #[test]
    fn the_last_request_wins() {
        let keeper = Arc::new(ThemeKeeper::default());
        let (_dir, root) = temporary();
        let first = root.join("carta");
        let second = root.join("lino");
        write_theme(&first, "acme.carta");
        write_theme(&second, "acme.lino");
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let slow = first.clone();
        keeper.request(move || {
            let _ = wait.recv_timeout(Duration::from_secs(10));
            (None, Some(slow))
        });
        let fast = second.clone();
        keeper.request(move || (None, Some(fast)));
        // La seconda ha già deciso; poi la prima arriva, vecchia.
        while !keeper.is_watching(&second) {
            std::thread::sleep(Duration::from_millis(10));
        }
        release.send(()).unwrap();
        keeper.settle();
        assert_eq!(keeper.watched().as_deref(), Some(second.as_path()));
        keeper.close();
        assert_eq!(keeper.watched(), None);
        // Chiuso, niente rimonta più.
        keeper.request(move || (None, Some(first)));
        keeper.settle();
        assert_eq!(keeper.watched(), None);
    }

    /// Un nome con `..`, o un file dietro una cartella che è un link
    /// simbolico, non è un file salvato della cartella.
    #[cfg(unix)]
    #[test]
    fn saved_files_stay_inside_the_folder() {
        let (_outside_dir, outside) = temporary();
        std::fs::write(outside.join("segreto.css"), "a").unwrap();
        let (_dir, root) = temporary();
        let folder = root.join("carta");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(root.join("vicino.css"), "a").unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("fuori")).unwrap();
        let touched = vec![
            folder.join("..").join("vicino.css").into_std_path_buf(),
            folder.join("fuori").join("segreto.css").into_std_path_buf(),
        ];
        assert!(saved_files(&folder, touched).is_empty());
    }

    #[test]
    fn saved_files_are_the_regular_files_inside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let folder = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::create_dir(folder.join("fonts")).unwrap();
        std::fs::write(folder.join("skin.css"), "a").unwrap();
        std::fs::write(folder.join("fonts").join("a.woff2"), "a").unwrap();
        let touched = vec![
            folder.join("skin.css").into_std_path_buf(),
            folder.join("skin.css").into_std_path_buf(),
            // Il temporaneo di un editor, già rinominato.
            folder.join(".skin.css.swp").into_std_path_buf(),
            folder.join("fonts").into_std_path_buf(),
            folder.join("fonts").join("a.woff2").into_std_path_buf(),
            folder.clone().into_std_path_buf(),
            std::path::PathBuf::from("/altrove/skin.css"),
        ];
        assert_eq!(saved_files(&folder, touched), ["fonts/a.woff2", "skin.css"]);
    }

    #[test]
    fn at_most_the_limit_of_saved_files() {
        let dir = tempfile::tempdir().unwrap();
        let folder = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let touched: Vec<_> = (0..20)
            .map(|index| {
                let path = folder.join(format!("{index:02}.css"));
                std::fs::write(&path, "a").unwrap();
                path.into_std_path_buf()
            })
            .collect();
        assert_eq!(
            saved_files(&folder, touched).len(),
            crate::theme::MAX_LINK_CHANGED
        );
    }
}
