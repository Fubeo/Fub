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
//! **E il rilevatore può morire** (§9.7,
//! [decisione 0030](../../../docs/decisions/0030-il-rilevamento-si-puo-chiedere.md)).
//! Prima [`VaultWatcher::is_watching`] rispondeva *per costruzione* — `false`
//! per [`NoWatcher`], `true` per un debouncer **avviato** — e nessuno gliela
//! chiedeva: un debouncer che moriva continuava a rispondere `true` per sempre.
//! Adesso la risposta è una bandiera condivisa che il kernel presta
//! (`Workspace::watch_flag`), il debouncer la abbassa quando riporta errori e
//! quando smette, e chiunque può leggerla dal canale dati
//! (`IndexQuery::VaultStatus`).

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};

use camino::Utf8Path;
use fub_kernel::Workspace;

/// Un rilevatore vivo: si tiene, e quando cade smette di guardare.
///
/// Il metodo è uno solo perché uno solo è ciò che l'host vorrà davvero sapere
/// di un watcher. Senza di lui il trait sarebbe `Box<dyn Any + Send>` con un
/// nome nuovo, che è esattamente il punto di partenza.
pub trait VaultWatcher: Send {
    /// `true` se questo vault ha il rilevamento delle modifiche esterne
    /// **adesso**.
    ///
    /// Non «è stato avviato»: un debouncer che riporta errori ha smesso di
    /// guardare, e da quel momento risponde `false` (§9.7). È la stessa
    /// risposta che il canale dati serve come
    /// `VaultStatus.watching`, perché è lo stesso `AtomicBool`: due copie
    /// sarebbero due verità, e la seconda mentirebbe in silenzio.
    fn is_watching(&self) -> bool;
}

/// Chi sa avviare un rilevatore su una radice.
///
/// Sta separato dal watcher perché è la parte che si sceglie **prima** di avere
/// un vault: `Host::with_watcher` la prende una volta, e ogni apertura la usa.
pub trait WatcherFactory: Send + Sync {
    /// Avvia il rilevamento su `root`, sincronizzando `workspace` a ogni
    /// cambiamento.
    ///
    /// `watching` è la bandiera del kernel (`Workspace::watch_flag`): chi
    /// guarda davvero la alza avviandosi e la abbassa quando smette. Chi non
    /// guarda la lascia dov'è, che è `false`.
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Arc<RwLock<Workspace>>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String>;
}

/// Nessun rilevamento: il vault cambia solo attraverso Fub.
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
    /// La bandiera resta com'è, cioè `false`: non alzarla è l'unica cosa da
    /// fare, ed è ciò che rende «qui nessuno vede le scritture altrui» un fatto
    /// che si può chiedere invece di una proprietà del montaggio che nessuno
    /// scrive da nessuna parte.
    fn start(
        &self,
        _root: &Utf8Path,
        _workspace: Arc<RwLock<Workspace>>,
        _watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        Ok(Box::new(NoWatcher))
    }
}

#[cfg(feature = "notify-watcher")]
pub use notify_watcher::NotifyWatcher;

#[cfg(feature = "notify-watcher")]
mod notify_watcher {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, RwLock};
    use std::time::Duration;

    use camino::{Utf8Path, Utf8PathBuf};
    use fub_abi::event::Event;
    use fub_abi::{PluginError, Severity};
    use fub_kernel::Workspace;
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
        /// La bandiera del kernel, che questo debouncer possiede finché è vivo.
        watching: Arc<AtomicBool>,
    }

    impl VaultWatcher for Debounced {
        fn is_watching(&self) -> bool {
            self.watching.load(Ordering::Relaxed)
        }
    }

    impl Drop for Debounced {
        /// **Chi smette lo dice.** Il debouncer si ferma quando viene distrutto,
        /// e senza questa riga la bandiera resterebbe alzata su una sessione che
        /// non guarda più niente — che è la stessa bugia di prima, spostata di
        /// un momento (§9.7).
        fn drop(&mut self) {
            self.watching.store(false, Ordering::Relaxed);
        }
    }

    impl WatcherFactory for NotifyWatcher {
        fn start(
            &self,
            root: &Utf8Path,
            workspace: Arc<RwLock<Workspace>>,
            watching: Arc<AtomicBool>,
        ) -> Result<Box<dyn VaultWatcher>, String> {
            let failed = watching.clone();
            let mut debouncer = new_debouncer(
                Duration::from_millis(300),
                None,
                move |result: DebounceEventResult| match result {
                    Ok(events) => {
                        let mut ws = workspace.write().unwrap();
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
                        // Un flush che non scrive perde un **derivato** (0052:
                        // `Warning`), ed è una perdita che l'utente ha il diritto
                        // di sapere: chi cerca, fino alla prossima apertura,
                        // riceve una risposta incompleta. Pavimento e porta
                        // insieme (0062): una riga nel log, una nel canale.
                        let flush_errors = ws.flush_indexes();
                        if !flush_errors.is_empty() {
                            for e in &flush_errors {
                                tracing::warn!(target: "fub.host", "flush indice: {e}");
                            }
                            ws.with_host("fub.host", |host| {
                                for e in flush_errors {
                                    host.emit(Event::Trouble {
                                        severity: Severity::Warning,
                                        subject: None,
                                        error: PluginError::Internal(
                                            format!("flush indice: {e}").into(),
                                        ),
                                    });
                                }
                            });
                        }
                    }
                    Err(errors) => {
                        // **Il rilevamento è finito, e da adesso si vede**
                        // (§9.7). Un errore del debouncer non è un evento
                        // perso: è che questo vault ha smesso di sapere quando
                        // cambia da fuori — limite di inotify su un vault
                        // grande, un network share che si stacca. Non è la
                        // perdita di un dato ma la perdita di un meccanismo: da
                        // qui in poi l'indice drifta in silenzio, e non sapere
                        // che il rilevamento è morto è esattamente il caso in
                        // cui il canale serve. `Failure` perché ciò che si perde
                        // non si ricostruisce riaprendo il vault — il rilevamento
                        // va riallacciato a mano.
                        failed.store(false, Ordering::Relaxed);
                        let mut ws = workspace.write().unwrap();
                        for e in &errors {
                            tracing::error!(target: "fub.host", "watch error: {e:?}");
                        }
                        ws.with_host("fub.host", |host| {
                            for e in errors {
                                host.emit(Event::Trouble {
                                    severity: Severity::Failure,
                                    subject: None,
                                    error: PluginError::Internal(
                                        format!("watch error: {e:?}").into(),
                                    ),
                                });
                            }
                        });
                    }
                },
            )
            .map_err(|e| e.to_string())?;
            debouncer
                .watch(root.as_std_path(), RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
            // Alzata **dopo** che `watch` è riuscita: fra il debouncer costruito
            // e la radice osservata c'è un errore possibile, e in mezzo la
            // risposta giusta è ancora `false`.
            watching.store(true, Ordering::Relaxed);
            Ok(Box::new(Debounced {
                _debouncer: Box::new(debouncer),
                watching,
            }))
        }
    }
}
