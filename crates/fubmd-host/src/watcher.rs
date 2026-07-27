//! Chi vede le scritture altrui, dietro un trait.
//!
//! Il watcher era un `Box<dyn Any + Send>` dentro la sessione dell'app: un
//! oggetto senza tipo, tenuto vivo e basta, e con un'unica implementazione
//! possibile perché il codice che lo costruiva era lo stesso che lo usava.
//! Dietro un trait diventa una **scelta di chi monta**, ed è la scelta che i
//! cinque clienti del §8.2 fanno diversa: sul desktop c'è `notify`, sugli e2e
//! headless non serve, su PWA (26.3) e mobile (26.2) non esiste.
//!
//! Due implementazioni fin da subito, e non per simmetria: un'astrazione con un
//! solo cliente non è un'astrazione — è la stessa ragione per cui il §15.1
//! chiede un `MemStorage` accanto a `FsStorage`.
//!
//! **Questa non è la §9.7.** Là la domanda è *cosa promette FubMD dove il
//! rilevamento non c'è*: un fatto interrogabile che la shell mostri, e un esito
//! per la sincronizzazione per-path che smetta di essere scartato. Qui c'è solo
//! il posto dove quella risposta andrà a stare — [`VaultWatcher::is_watching`]
//! oggi risponde per costruzione, e nessuno gliela chiede.

use std::sync::{Arc, Mutex};

use camino::Utf8Path;
use fubmd_kernel::Workspace;

/// Un rilevatore vivo: si tiene, e quando cade smette di guardare.
///
/// Il metodo è uno solo perché uno solo è ciò che l'host vorrà davvero sapere
/// di un watcher. Senza di lui il trait sarebbe `Box<dyn Any + Send>` con un
/// nome nuovo, che è esattamente il punto di partenza.
pub trait VaultWatcher: Send {
    /// `true` se questo vault ha il rilevamento delle modifiche esterne.
    ///
    /// Oggi la risposta è per costruzione — chi non guarda è [`NoWatcher`] — e
    /// nessuno la chiede. Il giorno che un watcher può *morire* mentre l'app è
    /// viva (limite di inotify su vault grandi, network share che si stacca) la
    /// risposta diventa dinamica, e la destinazione è la §9.7.
    fn is_watching(&self) -> bool;
}

/// Chi sa avviare un rilevatore su una radice.
///
/// Sta separato dal watcher perché è la parte che si sceglie **prima** di avere
/// un vault: `Host::with_watcher` la prende una volta, e ogni apertura la usa.
pub trait WatcherFactory: Send + Sync {
    /// Avvia il rilevamento su `root`, sincronizzando `workspace` a ogni
    /// cambiamento.
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Arc<Mutex<Workspace>>,
    ) -> Result<Box<dyn VaultWatcher>, String>;
}

/// Nessun rilevamento: il vault cambia solo attraverso FubMD.
///
/// È l'implementazione onesta per chi non ha un watcher — e non un ripiego: un
/// e2e headless (27.4) che aprisse un debouncer vero starebbe provando anche il
/// debouncer, e un test che fallisce per il filesystem non dice più niente su
/// ciò che doveva provare.
///
/// Serve sia da fabbrica sia da rilevatore: non c'è niente da tenere vivo.
pub struct NoWatcher;

impl VaultWatcher for NoWatcher {
    fn is_watching(&self) -> bool {
        false
    }
}

impl WatcherFactory for NoWatcher {
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Arc<Mutex<Workspace>>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        Ok(Box::new(NoWatcher))
    }
}

#[cfg(feature = "notify-watcher")]
pub use notify_watcher::NotifyWatcher;

#[cfg(feature = "notify-watcher")]
mod notify_watcher {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use camino::{Utf8Path, Utf8PathBuf};
    use fubmd_kernel::Workspace;
    use notify::event::{EventKind, ModifyKind, RenameMode};
    use notify::RecursiveMode;
    use notify_debouncer_full::{new_debouncer, DebounceEventResult};

    use super::{VaultWatcher, WatcherFactory};

    /// Il rilevatore di default: `notify` con un debouncer da 300 ms.
    pub struct NotifyWatcher;

    /// Il debouncer vivo. Il tipo concreto di `notify_debouncer_full` è
    /// parametrico sul backend della piattaforma, quindi resta cancellato: qui
    /// interessa solo che stia in piedi finché la sessione è aperta.
    struct Debounced {
        _debouncer: Box<dyn std::any::Any + Send>,
    }

    impl VaultWatcher for Debounced {
        fn is_watching(&self) -> bool {
            true
        }
    }

    impl WatcherFactory for NotifyWatcher {
        fn start(
            &self,
            root: &Utf8Path,
            workspace: Arc<Mutex<Workspace>>,
        ) -> Result<Box<dyn VaultWatcher>, String> {
            let mut debouncer = new_debouncer(
                Duration::from_millis(300),
                None,
                move |result: DebounceEventResult| match result {
                    Ok(events) => {
                        let mut ws = workspace.lock().unwrap();
                        for event in events {
                            // Un rename accoppiato (`paths = [from, to]`) è una
                            // migrazione d'identità, non remove+add: la storia del
                            // versioning resta attaccata alla nota, il frontend migra
                            // i meta, e `DocumentRenamed` viene emesso anche per i
                            // rename fatti da Finder/Obsidian/sync. Tutto il resto
                            // passa dal fallback per-path qui sotto.
                            if matches!(
                                event.kind,
                                EventKind::Modify(ModifyKind::Name(RenameMode::Both))
                            ) && event.paths.len() == 2
                            {
                                if let (Ok(from), Ok(to)) = (
                                    Utf8PathBuf::from_path_buf(event.paths[0].clone()),
                                    Utf8PathBuf::from_path_buf(event.paths[1].clone()),
                                ) {
                                    let _ = ws.sync_renamed_path(&from, &to);
                                    continue;
                                }
                            }
                            for path in &event.paths {
                                if let Ok(p) = Utf8PathBuf::from_path_buf(path.clone()) {
                                    let _ = ws.sync_path(&p);
                                }
                            }
                        }
                        // Fine del lotto debounced: è il punto tranquillo in cui
                        // rendere durevoli gli indici. Il kernel non sa quando finisce
                        // un lotto — lo sa il watcher, che il lotto lo ha formato.
                        for e in ws.flush_indexes() {
                            eprintln!("flush indice: {e}");
                        }
                    }
                    Err(errors) => {
                        for e in errors {
                            eprintln!("watch error: {e:?}");
                        }
                    }
                },
            )
            .map_err(|e| e.to_string())?;
            debouncer
                .watch(root.as_std_path(), RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
            Ok(Box::new(Debounced {
                _debouncer: Box::new(debouncer),
            }))
        }
    }
}
