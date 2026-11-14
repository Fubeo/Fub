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
//!   solo con la modalità sviluppatore accesa: con una cartella nuova il
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

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};

use crate::theme::{theme_link, ThemeLink};

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
/// Ogni cambio di collegamento passa da [`ThemeKeeper::watch`], serializzato
/// dal lucchetto `ops`; la consegna degli eventi non lo prende mai.
#[derive(Default)]
pub(crate) struct ThemeKeeper {
    /// Serializza montaggio e smontaggio, e tiene ciò che è montato.
    ops: Mutex<Mounted>,
    /// L'uscita, che l'app installa dopo aver creato la finestra.
    sink: Arc<Mutex<Option<ThemeLinkSink>>>,
    known: Arc<Mutex<Known>>,
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
    /// Installa l'uscita degli eventi; gli osservatori già montati la usano
    /// dal prossimo cambio.
    pub(crate) fn set_sink(&self, sink: ThemeLinkSink) {
        *held(&self.sink) = Some(sink);
    }

    /// La cartella guardata adesso, se c'è.
    pub(crate) fn watched(&self) -> Option<Utf8PathBuf> {
        held(&self.ops).folder.clone()
    }

    /// Guarda `folder`, o niente con `None`. La stessa cartella già guardata
    /// non si rimonta; una diversa smonta prima la vecchia (aspettando la sua
    /// consegna in volo) e poi monta la nuova. Un osservatore che non parte
    /// (la piattaforma non lo sa fare, la cartella è sparita) lascia il
    /// collegamento senza rimontaggi, e lo dice nel log: il tema resta
    /// leggibile, e lo stato della cartella lo dice
    /// [`theme_link`](crate::theme::theme_link).
    ///
    /// Con `again` anche la stessa cartella si rimonta: chi la collega di nuovo
    /// (sparita e tornata) vuole che la si guardi da capo.
    pub(crate) fn watch(
        &self,
        config_dir: Option<&Utf8Path>,
        folder: Option<&Utf8Path>,
        again: bool,
    ) {
        let mut mounted = held(&self.ops);
        if !again && mounted.folder.as_deref() == folder {
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
        let deliver = Delivery {
            config_dir: config_dir.map(Utf8Path::to_owned),
            folder: folder.to_owned(),
            sink: self.sink.clone(),
            known: self.known.clone(),
        };
        match FolderWatch::start(folder, deliver) {
            Ok(watch) => mounted.watch = Some(watch),
            Err(error) => tracing::warn!(
                target: "fub.host",
                folder = %folder,
                "the linked theme folder is not watched: {error}"
            ),
        }
        mounted.folder = Some(folder.to_owned());
    }

    /// Smonta l'osservatore (chiusura dell'app): come `watch(None)`.
    pub(crate) fn close(&self) {
        self.watch(None, None, false);
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
        if relative.as_str().is_empty() {
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

#[cfg(feature = "notify-watcher")]
use notify_folder::FolderWatch;

#[cfg(feature = "notify-watcher")]
mod notify_folder {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use camino::Utf8Path;
    use notify::event::EventKind;
    use notify::{RecommendedWatcher, RecursiveMode};
    use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

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
            let mut debouncer = new_debouncer(
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
