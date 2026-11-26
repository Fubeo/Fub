use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::custody::Custody;
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_kernel::ignore::WatchScope;
use fub_kernel::Workspace;
use notify::event::{EventKind, MetadataKind, ModifyKind, RenameMode};
use notify::{RecommendedWatcher, RecursiveMode, Watcher, WatcherKind};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

use super::folders::{FolderWatches, PerFolder};
use super::{ExternalChange, ExternalSync, SyncLifecycle, VaultWatcher, WatcherFactory};

/// Il debouncer sul backend della piattaforma.
type Backend = Debouncer<RecommendedWatcher, RecommendedCache>;

impl FolderWatches for Backend {
    fn watch_folder(&mut self, dir: &Path) -> notify::Result<()> {
        self.watch(dir, RecursiveMode::NonRecursive)
    }

    fn unwatch_folder(&mut self, dir: &Path) {
        // Il backend può averla già lasciata (spostata, rimossa): non c'è
        // niente da togliere, e non è un guasto.
        let _ = self.unwatch(dir);
    }
}

/// Il debouncer e, sui backend che pagano un osservatore per cartella,
/// l'elenco delle cartelle guardate.
///
/// Sta dietro un `Mutex` condiviso perché lo usano due thread: chi chiude
/// (per fermare il debouncer) e il thread che consegna i lotti (per
/// guardare le cartelle nate dentro il vault). La consegna lo tiene per un
/// `Weak`: il debouncer possiede la consegna, e un `Arc` lì dentro sarebbe
/// un ciclo che nessun `Drop` romperebbe.
struct Watching {
    backend: Option<Backend>,
    /// `None` quando il backend guarda l'albero da sé (Windows, macOS).
    folders: Option<PerFolder>,
}

/// Il backend paga un osservatore per cartella?
///
/// inotify sì: ogni cartella guardata è un osservatore del budget
/// dell'utente. FSEvents e `ReadDirectoryChangesW` guardano un albero con
/// un handle solo, e restano ricorsivi come prima.
fn per_folder() -> bool {
    RecommendedWatcher::kind() == WatcherKind::Inotify
}

/// Questo evento può aver fatto nascere, spostare o togliere una cartella?
fn moves_folders(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Any
            | EventKind::Other
    )
}

/// Porta le cartelle guardate al lotto che sta per essere consegnato.
///
/// Gira **prima** della consegna, ed è l'ordine che chiude la finestra: una
/// cartella nata dentro il vault prende il suo osservatore, e soltanto dopo
/// il lotto la cammina (`scan_within`) per i file che ci sono già. Ciò che
/// arriva dopo l'osservatore è un evento; ciò che c'era prima è nella
/// camminata.
///
/// Tre mosse: dimentica le cartelle andate via (il backend ha già lasciato i
/// loro osservatori), riallinea se la politica di esclusione è cambiata
/// (`.fub/settings.json` è guardata apposta), e guarda le cartelle arrivate.
/// Un `Rescan` vuol dire eventi persi, comprese le nascite di cartelle: si
/// ricammina il vault intero.
fn follow(
    watching: &Mutex<Watching>,
    scope: Option<WatchScope>,
    events: &[notify_debouncer_full::DebouncedEvent],
) -> notify::Result<()> {
    let mut guard = watching.lock().unwrap_or_else(|and| and.into_inner());
    let Watching { backend, folders } = &mut *guard;
    let (Some(backend), Some(folders)) = (backend.as_mut(), folders.as_mut()) else {
        return Ok(());
    };
    let mut arrived: Vec<PathBuf> = Vec::new();
    let mut rescan = false;
    for event in events {
        if event.need_rescan() {
            rescan = true;
            continue;
        }
        if !moves_folders(&event.kind) {
            continue;
        }
        for path in &event.paths {
            match std::fs::symlink_metadata(path) {
                Ok(meta) if meta.is_dir() => arrived.push(path.clone()),
                _ => folders.forget(path),
            }
        }
    }
    let walked = match scope {
        Some(scope) => folders.realign(backend, scope)?,
        None => false,
    };
    if walked {
        return Ok(());
    }
    if rescan {
        let root = folders.root().to_path_buf();
        return folders.cover(backend, &root);
    }
    for dir in arrived {
        folders.cover(backend, &dir)?;
    }
    Ok(())
}

/// Il rilevatore di default: `notify` con un debouncer da 300 ms.
pub struct NotifyWatcher;

/// Il debouncer vivo, **e il thread che consegna i lotti**.
///
/// Il tipo concreto di `notify_debouncer_full` è parametrico sul backend
/// della piattaforma, e per questo stava dietro un `dyn Any`: interessava
/// solo che stesse in piedi finché la sessione è aperta. Ma non interessava
/// solo quello (difetto 0159): interessa anche **smettere per davvero**, e
/// smettere aspettando è `Debouncer::stop`, che prende il `self` concreto —
/// un `Any` non lo sa fare. Il prezzo è il nome del backend scritto qui; ciò
/// che si compra è che chiudere un vault voglia dire che nessuno ci sta più
/// scrivendo dentro.
struct Debounced {
    /// Il debouncer sta in un `Option` perché `stop` lo vuole per valore e
    /// un `drop` ha solo un `&mut`: la `take` è il ponte fra i due.
    ///
    /// `Sync` (decisione 0120, le sessioni si prestano in condivisione) lo
    /// dà il `Mutex` a ogni contenuto `Send`: se il backend smettesse di
    /// esserlo, a dirlo sarebbe il compilatore su `Box<dyn VaultWatcher>`.
    state: Arc<Mutex<Watching>>,
    /// La bandiera del kernel, che questo debouncer possiede finché è vivo.
    watching: Arc<AtomicBool>,
    lifecycle: Arc<SyncLifecycle>,
}

impl VaultWatcher for Debounced {
    fn is_watching(&self) -> bool {
        self.watching.load(Ordering::Relaxed)
    }
}

impl Drop for Debounced {
    /// **Chi smette lo dice, e chi chiude aspetta che abbia smesso.**
    ///
    /// La bandiera è la metà che c'era già: senza, resterebbe alzata su una
    /// sessione che non guarda più niente, che è la stessa bugia di prima
    /// spostata di un momento (§9.7).
    ///
    /// L'altra metà è la 0159. Prima lo shutdown dipendeva soltanto dal
    /// comportamento interno del debouncer. Adesso chiude gli ingressi di
    /// [`ExternalSync`] e aspetta che le consegne già accettate completino
    /// anche la propria durevolezza; solo dopo ferma il worker e abbassa la
    /// bandiera. La `Condvar` rilascia il proprio mutex mentre aspetta,
    /// quindi un lotto in volo può uscire e notificare la chiusura.
    fn drop(&mut self) {
        self.lifecycle.invalidate_and_wait();
        // Il debouncer esce dal lucchetto prima di fermarsi: `stop` aspetta
        // il thread delle consegne, e quel thread prende lo stesso
        // lucchetto per guardare le cartelle nuove.
        let backend = self
            .state
            .lock()
            .unwrap_or_else(|and| and.into_inner())
            .backend
            .take();
        if let Some(debouncer) = backend {
            debouncer.stop();
        }
        self.watching.store(false, Ordering::Release);
    }
}

/// Se questo evento dice che **qualcosa è cambiato**, o solo che qualcuno
/// ha guardato.
///
/// La distinzione non è un'ottimizzazione: un rilevatore che confonde la
/// lettura con la scrittura non rileva le scritture altrui — rileva anche le
/// proprie letture, e le proprie letture le fa in risposta a ciò che ha
/// rilevato. Il verso in cui si sbaglia, nel dubbio, è quello di
/// **considerarlo un cambiamento**: `Any` e `Other` arrivano dai backend che
/// non sanno dire cosa è successo, e lì una rilettura di troppo costa un
/// file aperto, mentre una di meno costa un indice che drifta in silenzio.
fn is_a_change(event: &notify_debouncer_full::DebouncedEvent) -> bool {
    is_a_change_kind(&event.kind)
}

/// Il vocabolario di `notify` tradotto in quello del lotto.
///
/// `Both` porta già i due path ed è una migrazione esplicita. Due metà
/// `From`/`To` diventano una migrazione soltanto quando lo stesso tracker
/// non nullo identifica esattamente una partenza e un arrivo nel lotto.
/// Metà orfane, tracker assenti e tracker ambigui restano path toccati: i
/// byte uguali non sono una prova d'identità.
fn changes(events: Vec<notify_debouncer_full::DebouncedEvent>) -> Vec<ExternalChange> {
    let mut halves: HashMap<usize, (Option<usize>, Option<usize>, bool)> = HashMap::new();
    for (index, event) in events.iter().enumerate() {
        let slot = match &event.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => 0,
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => 1,
            _ => continue,
        };
        let Some(tracker) = event.tracker() else {
            continue;
        };
        let pair = halves.entry(tracker).or_default();
        let occupied = if slot == 0 {
            pair.0.replace(index).is_some()
        } else {
            pair.1.replace(index).is_some()
        };
        pair.2 |= occupied;
    }

    let mut out = Vec::new();
    for (index, event) in events.iter().enumerate() {
        if matches!(
            &event.kind,
            EventKind::Modify(ModifyKind::Name(RenameMode::Both))
        ) && event.paths.len() == 2
        {
            if let (Ok(from), Ok(to)) = (
                Utf8PathBuf::from_path_buf(event.paths[0].clone()),
                Utf8PathBuf::from_path_buf(event.paths[1].clone()),
            ) {
                out.push(ExternalChange::Renamed { from, to });
                continue;
            }
        }

        if matches!(
            &event.kind,
            EventKind::Modify(ModifyKind::Name(RenameMode::From | RenameMode::To))
        ) {
            if let Some((Some(from_index), Some(to_index), false)) =
                event.tracker().and_then(|tracker| halves.get(&tracker))
            {
                let from = &events[*from_index];
                let to = &events[*to_index];
                if from.paths.len() == 1 && to.paths.len() == 1 {
                    if let (Ok(from), Ok(to)) = (
                        Utf8PathBuf::from_path_buf(from.paths[0].clone()),
                        Utf8PathBuf::from_path_buf(to.paths[0].clone()),
                    ) {
                        if index == *from_index {
                            out.push(ExternalChange::Renamed { from, to });
                        }
                        continue;
                    }
                }
            }
        }

        for path in &event.paths {
            if let Ok(p) = Utf8PathBuf::from_path_buf(path.clone()) {
                out.push(ExternalChange::Touched(p));
            }
        }
    }
    out
}

/// Un lotto del debouncer, dall'evento al workspace.
fn deliver(sync: &mut ExternalSync, events: Vec<notify_debouncer_full::DebouncedEvent>) {
    // Il backend ha perso eventi (coda di inotify piena, FSEvents che
    // chiede di riscandire): l'evento non ha path, e un lotto vuoto lo
    // lasciava cadere in silenzio con l'anagrafe ferma fino alla
    // riapertura.
    if events.iter().any(|event| event.need_rescan()) {
        sync.catch_up();
        return;
    }
    // **Leggere un file non è cambiarlo.** inotify riporta anche le
    // aperture e gli accessi (`Access(Open)`, `Access(Close(Read))`, e
    // l'atime che ne segue), e chi apre i documenti di questo vault più
    // spesso di chiunque altro è Fub stesso: la localizzazione delle
    // occorrenze (§21.3) apre il sorgente di ogni riga di una pagina di
    // risultati. Trattare quelle aperture come cambiamenti chiudeva un
    // anello: una ricerca leggeva sessanta note, il rilevatore riferiva
    // sessanta «modifiche», il kernel rileggeva quelle note per scoprire
    // che erano identiche — e quelle riletture erano altre sessanta
    // aperture. Il giro si alimentava da solo, con un `DocumentChanged` a
    // vuoto e un `IndexUpdated` per ogni passaggio, finché il ponte non
    // andava in overflow e la shell non rispondeva più.
    let events: Vec<_> = events.into_iter().filter(is_a_change).collect();
    // Un lotto di sole letture non è un lotto: non c'è niente da
    // sincronizzare e niente da rendere durevole, e prendere il lucchetto
    // esclusivo per non fare niente toglierebbe il vault ai lettori a ogni
    // ricerca.
    if events.is_empty() {
        return;
    }
    sync.batch(&changes(events));
}

fn is_a_change_kind(kind: &EventKind) -> bool {
    match kind {
        // Aperture, letture, chiusure: nessun byte è diverso da prima.
        EventKind::Access(_) => false,
        // L'atime è la traccia di una lettura, scritta dal filesystem: è la
        // stessa cosa detta come metadato.
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)) => false,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => true,
        EventKind::Any | EventKind::Other => true,
    }
}

impl WatcherFactory for NotifyWatcher {
    fn start(
        &self,
        root: &Utf8Path,
        workspace: Custody<Workspace>,
        watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        let failed = watching.clone();
        // Il recinto si legge qui, prima del primo osservatore: la
        // fabbrica può leggere il workspace durante l'avvio (vedi il doc
        // del trait), e nessun lotto può ancora entrarci.
        let folders = if per_folder() {
            let scope = workspace
                .read()
                .map_err(|and| and.to_string())?
                .watch_scope();
            Some(PerFolder::new(root.as_std_path(), scope))
        } else {
            None
        };
        let state = Arc::new(Mutex::new(Watching {
            backend: None,
            folders,
        }));
        let following = Arc::downgrade(&state);
        // Il sincronizzatore è **uno** e la chiusura lo possiede: è il modo
        // in cui l'ordine dei lotti smette di dipendere da quanti thread
        // `notify` decide di usare (vedi il doc di `ExternalSync`).
        let mut sync = ExternalSync::new(workspace);
        let lifecycle = sync.lifecycle();
        let debouncer = new_debouncer(
            Duration::from_millis(300),
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    let Some(_operation) = sync.lifecycle.enter() else {
                        return;
                    };
                    // Le cartelle nuove prendono l'osservatore **prima**
                    // che il lotto le cammini: il perché sta su `follow`.
                    let lost = match following.upgrade() {
                        Some(state) if per_folder() => {
                            follow(&state, sync.watch_scope(), &events).err()
                        }
                        _ => None,
                    };
                    deliver(&mut sync, events);
                    // Un osservatore che il sistema rifiuta per il limite è
                    // una cartella del vault che nessuno guarda più: il
                    // rilevamento non mantiene ciò che promette, e lo dice
                    // come ogni altro errore del backend (§9.7).
                    if let Some(error) = lost {
                        if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) {
                            failed.store(false, Ordering::Relaxed);
                            sync.watch_died(vec![format!("watch error: {error:?}")]);
                        } else {
                            tracing::warn!(
                                target: "fub.host",
                                "cartelle nuove non guardate: {error}"
                            );
                        }
                    }
                }
                Err(errors) => {
                    let Some(_operation) = sync.lifecycle.enter() else {
                        return;
                    };
                    // Il rilevamento è finito, e da adesso si vede (§9.7):
                    // il perché sta sul metodo che lo racconta.
                    failed.store(false, Ordering::Relaxed);
                    sync.watch_died(
                        errors
                            .iter()
                            .map(|and| format!("watch error: {and:?}"))
                            .collect(),
                    );
                }
            },
        )
        .map_err(|and| and.to_string())?;
        // La callback può essere invocata immediatamente da `watch` (per
        // esempio se il backend riporta già un errore della radice). La
        // bandiera deve essere vera prima di consegnarle il controllo:
        // così un errore osservato durante l'avvio la abbassa e nessuna
        // scrittura finale può sovrascriverlo con `true`.
        watching.store(true, Ordering::Release);
        // Il lucchetto resta preso per tutta la prima camminata: un lotto
        // che arriva intanto aspetta qui e poi trova l'elenco completo.
        // Non c'è un ciclo: `watch` parla col thread del backend, non con
        // quello delle consegne.
        let mut guard = state.lock().unwrap_or_else(|and| and.into_inner());
        let Watching { backend, folders } = &mut *guard;
        let debouncer = backend.insert(debouncer);
        let started = match folders {
            Some(folders) => folders.cover(debouncer, root.as_std_path()),
            None => debouncer.watch(root.as_std_path(), RecursiveMode::Recursive),
        };
        if let Err(error) = started {
            let debouncer = backend.take();
            drop(guard);
            drop(debouncer);
            return Err(error.to_string());
        }
        drop(guard);
        Ok(Box::new(Debounced {
            state,
            watching,
            lifecycle,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, AccessMode, CreateKind, DataChange, RemoveKind};

    /// 0159 — **chi lascia andare il rilevatore aspetta che abbia finito.**
    ///
    /// `VaultSession::close` lascia andare il watcher per primo, e dice
    /// perché: «nessun altro thread deve poter entrare nel vault mentre lo
    /// si chiude». Ma lasciarlo andare non era aspettare che avesse finito —
    /// il `Drop` del debouncer alza una bandiera e torna — e un lotto già
    /// partito continuava per conto suo a sincronizzare e a scrivere indici
    /// dentro un vault chiuso.
    ///
    /// Qui una consegna — riuscita o fallita — resta aperta su un canale.
    /// Il teardown raggiunge deterministicamente l'invalidazione e non può
    /// tornare né abbassare `watching` finché il test non la libera. Nessuno
    /// `sleep` trasforma il tempo della macchina in un segnale.
    #[test]
    fn dropping_the_watcher_waits_for_the_in_flight_delivery() {
        let dir = tempfile::tempdir().expect("a folder to watch");
        let (inside_tx, inside_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let lifecycle = Arc::new(SyncLifecycle::new());
        let callback_lifecycle = Arc::clone(&lifecycle);
        let observed_lifecycle = Arc::clone(&lifecycle);
        let delivered = Arc::new(AtomicBool::new(false));
        let batch_done = Arc::clone(&delivered);
        let mut debouncer = new_debouncer(
            Duration::from_millis(20),
            None,
            move |_result: DebounceEventResult| {
                let Some(operation) = callback_lifecycle.enter() else {
                    return;
                };
                inside_tx.send(()).expect("the test waits for the callback");
                release_rx.recv().expect("the test releases the callback");
                batch_done.store(true, Ordering::SeqCst);
                drop(operation);
            },
        )
        .expect("the debouncer starts");
        debouncer
            .watch(dir.path(), RecursiveMode::Recursive)
            .expect("the root is watched");
        let watching = Arc::new(AtomicBool::new(true));
        let watcher = Debounced {
            state: Arc::new(Mutex::new(Watching {
                backend: Some(debouncer),
                folders: None,
            })),
            watching: Arc::clone(&watching),
            lifecycle,
        };

        std::fs::write(dir.path().join("note.md"), b"hello").expect("a file that changes");
        inside_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("the watcher enters its callback");

        let (stopped_tx, stopped_rx) = std::sync::mpsc::channel();
        let stopping = std::thread::spawn(move || {
            drop(watcher);
            stopped_tx.send(()).expect("the test waits for teardown");
        });
        observed_lifecycle.wait_until_invalidated();
        assert!(
            stopped_rx.try_recv().is_err() && watching.load(Ordering::Acquire),
            "teardown returned or lowered watching while a callback was still in flight"
        );
        release_tx.send(()).expect("the callback can finish");
        stopped_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("teardown finishes after the callback");
        stopping.join().expect("teardown does not panic");

        assert!(
            delivered.load(Ordering::SeqCst),
            "the vault closed with a batch still in flight"
        );
        assert!(
            !watching.load(Ordering::Acquire),
            "the watcher lowered its flag before teardown completed"
        );
    }

    /// **L'anello che si chiudeva.** Questi sono gli eventi che inotify
    /// riporta quando Fub apre un documento per localizzare le occorrenze
    /// di una ricerca: se contassero come cambiamenti, il rilevatore
    /// chiederebbe al kernel di rileggere ciò che il kernel ha appena
    /// letto — e la rilettura sarebbe un'altra apertura.
    /// Un backend che ha perso eventi lo dice con un `Rescan` senza path.
    /// Quali file siano cambiati non si sa più: la consegna riallinea
    /// tutto il vault invece di lasciar cadere l'avviso come un lotto vuoto.
    #[test]
    fn a_rescan_realigns_the_whole_vault() {
        let dir = tempfile::tempdir().expect("a vault");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("vecchia.txt"), "prima").expect("seeds");
        let mut ws =
            Workspace::new(&root, fub_kernel::FormatRegistry::new()).expect("the vault opens");
        ws.reindex().expect("initial scan");
        let ws = Custody::new("the rescan vault", ws);
        std::fs::remove_file(root.join("vecchia.txt")).expect("removed behind the back");
        std::fs::create_dir(root.join("Nuova")).expect("a folder");
        std::fs::write(root.join("Nuova/arrivata.txt"), "dopo").expect("written behind the back");

        let rescan = notify::Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan);
        deliver(
            &mut ExternalSync::new(ws.clone()),
            vec![notify_debouncer_full::DebouncedEvent::new(
                rescan,
                std::time::Instant::now(),
            )],
        );

        let fub_abi::traits::IndexResult::Entries(page) = ws
            .read()
            .expect("the vault is alive")
            .query_index(fub_abi::traits::IndexQuery::Entries {
                of_kind: None,
                within: None,
                page: None,
            })
            .expect("the kernel serves the index")
        else {
            panic!("expected the index");
        };
        let ids: Vec<_> = page.items.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["Nuova/arrivata.txt"]);
    }

    #[test]
    fn reading_a_document_is_not_changing_it() {
        for kind in [
            EventKind::Access(AccessKind::Open(AccessMode::Any)),
            EventKind::Access(AccessKind::Read),
            EventKind::Access(AccessKind::Close(AccessMode::Read)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)),
        ] {
            assert!(!is_a_change_kind(&kind), "{kind:?} is not a change");
        }
    }

    /// E ciò che cambia davvero continua ad arrivare: il filtro sta fra le
    /// letture e le scritture, non fra il rilevatore e il vault.
    #[test]
    fn what_changes_still_gets_through() {
        for kind in [
            EventKind::Create(CreateKind::File),
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            EventKind::Remove(RemoveKind::File),
            // Chi non sa dire cosa è successo va creduto: meglio una
            // rilettura in più di un indice che drifta.
            EventKind::Any,
            EventKind::Other,
        ] {
            assert!(is_a_change_kind(&kind), "{kind:?} is a change");
        }
    }

    fn rename_half(
        mode: RenameMode,
        tracker: Option<usize>,
        paths: &[&str],
    ) -> notify_debouncer_full::DebouncedEvent {
        let mut event = notify::Event::new(EventKind::Modify(ModifyKind::Name(mode)));
        for path in paths {
            event = event.add_path((*path).into());
        }
        if let Some(tracker) = tracker {
            event = event.set_tracker(tracker);
        }
        notify_debouncer_full::DebouncedEvent::new(event, std::time::Instant::now())
    }

    #[test]
    fn rename_halves_require_one_shared_tracker_in_the_same_batch() {
        let changes = changes(vec![
            rename_half(RenameMode::From, Some(7), &["tracked-from.md"]),
            rename_half(RenameMode::To, Some(7), &["tracked-to.md"]),
            rename_half(RenameMode::From, None, &["untracked-from.md"]),
            rename_half(RenameMode::To, None, &["untracked-to.md"]),
            rename_half(RenameMode::From, Some(9), &["ambiguous-a.md"]),
            rename_half(RenameMode::From, Some(9), &["ambiguous-b.md"]),
            rename_half(RenameMode::To, Some(9), &["ambiguous-to.md"]),
            rename_half(RenameMode::Both, None, &["both-from.md", "both-to.md"]),
        ]);

        assert_eq!(
            changes,
            vec![
                ExternalChange::Renamed {
                    from: "tracked-from.md".into(),
                    to: "tracked-to.md".into(),
                },
                ExternalChange::Touched("untracked-from.md".into()),
                ExternalChange::Touched("untracked-to.md".into()),
                ExternalChange::Touched("ambiguous-a.md".into()),
                ExternalChange::Touched("ambiguous-b.md".into()),
                ExternalChange::Touched("ambiguous-to.md".into()),
                ExternalChange::Renamed {
                    from: "both-from.md".into(),
                    to: "both-to.md".into(),
                },
            ]
        );
    }

    /// **Una rinomina orfana esce lo stesso** (difetto 0199, premessa
    /// caduta).
    ///
    /// La riga temeva che la metà «da» di una rinomina restasse appesa in
    /// attesa del gemello: chi porta una nota fuori dal vault dal Finder un
    /// evento di arrivo non ce l'ha mai, e il documento sparito dal disco
    /// sarebbe rimasto vivo in anagrafe fino alla riapertura del vault.
    /// Rimisurata, la paura non regge, e il perché sta nel debouncer:
    /// `handle_rename_from` l'evento lo tiene da parte **e** lo mette nella
    /// coda del suo path, e a toglierlo di lì è solo il gemello che si
    /// connette — `push_rename_event` fa `pop_back` sulla coda di partenza
    /// proprio per non dire due volte la stessa mossa. Senza gemello non lo
    /// toglie nessuno, e la coda lo consegna alla scadenza come qualunque
    /// altro evento. Di qua `changes` lo vede a **un path solo** — il ramo
    /// accoppiato pretende `paths.len() == 2` — e lo rende un path toccato,
    /// che è la domanda giusta: il kernel guarda il disco, non trova più
    /// niente e toglie il documento.
    ///
    /// Il banco pretende un ordine fra due fatti e non un tempo (§23.16):
    /// prima la nascita della nota dev'essere stata consegnata, poi la sua
    /// sparizione dev'essere un secondo lotto. Se la metà «da» non uscisse,
    /// il secondo lotto non arriverebbe mai.
    #[test]
    fn an_orphan_rename_emerges_as_a_touched_path() {
        let inside = tempfile::tempdir().expect("the watched folder");
        let outside = tempfile::tempdir().expect("a folder nobody watches");
        // FSEvents reports canonical paths on macOS (for example
        // `/private/var` instead of `/var`), so keep the watched root and
        // the expected event path in the same representation.
        let root = inside
            .path()
            .canonicalize()
            .expect("the canonical watched folder");
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut debouncer = new_debouncer(
            Duration::from_millis(20),
            None,
            move |result: DebounceEventResult| {
                let Ok(events) = result else { return };
                let events: Vec<_> = events.into_iter().filter(is_a_change).collect();
                if events.is_empty() {
                    return;
                }
                let _ = sender.send(changes(events));
            },
        )
        .expect("a watcher");
        debouncer
            .watch(&root, RecursiveMode::Recursive)
            .expect("watching the folder");

        let notes = root.join("note.md");
        let touched = ExternalChange::Touched(
            Utf8PathBuf::from_path_buf(notes.clone()).expect("a utf-8 path"),
        );
        let arrives = || {
            for _ in 0..50 {
                if let Ok(batch) = receiver.recv_timeout(Duration::from_millis(100)) {
                    if batch.contains(&touched) {
                        return true;
                    }
                }
            }
            false
        };

        std::fs::write(&notes, b"hello").expect("a note");
        assert!(
            arrives(),
            "the birth of the note was not delivered: without this \
                 first half the test proves nothing"
        );

        // Fuori dalla cartella guardata: una partenza che non avrà mai un
        // arrivo da accoppiarci.
        std::fs::rename(&notes, outside.path().join("note.md")).expect("the orphan rename");
        assert!(
            arrives(),
            "the 'from' half of an orphan rename did not come out: the note \
                 is gone from disk and stays alive in the registry until someone \
                 reopens the vault"
        );
    }

    /// Gli inode che gli osservatori inotify di **questo processo**
    /// guardano, letti dal kernel (`/proc/self/fdinfo`) e non dall'elenco
    /// che il rilevatore tiene di sé: la prova non si fida del codice che
    /// prova.
    #[cfg(target_os = "linux")]
    fn watched_inodes() -> std::collections::BTreeSet<u64> {
        let mut out = std::collections::BTreeSet::new();
        let fds = std::fs::read_dir("/proc/self/fd").expect("the process lists its fds");
        for fd in fds.flatten() {
            let inotify = std::fs::read_link(fd.path())
                .is_ok_and(|target| target.to_string_lossy().contains("inotify"));
            if !inotify {
                continue;
            }
            let info = std::fs::read_to_string(Path::new("/proc/self/fdinfo").join(fd.file_name()))
                .unwrap_or_default();
            for line in info.lines().filter(|line| line.starts_with("inotify ")) {
                let inode = line
                    .split_whitespace()
                    .find_map(|field| field.strip_prefix("ino:"))
                    .and_then(|hex| u64::from_str_radix(hex, 16).ok());
                out.extend(inode);
            }
        }
        out
    }

    /// Aspetta che `check` diventi vero, per al più dieci secondi.
    #[cfg(target_os = "linux")]
    fn eventually(mut check: impl FnMut() -> bool) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            if check() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        check()
    }

    /// IMP-156 — **un vault che è anche un repo git non esaurisce gli
    /// osservatori.** inotify ne mette uno per cartella, e il rilevatore
    /// ricorsivo li metteva anche dentro `.git/objects` e `node_modules`,
    /// che il vault esclude: al limite dell'utente il rilevamento moriva.
    /// Qui le cartelle escluse non hanno osservatore, nemmeno quelle nate
    /// dopo l'avvio, mentre una cartella nuova del vault lo prende e un
    /// file scritto lì dentro dopo arriva all'indice.
    #[cfg(target_os = "linux")]
    #[test]
    fn inotify_watches_only_the_folders_the_vault_counts() {
        use std::os::unix::fs::MetadataExt;

        let dir = tempfile::tempdir().expect("a vault");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().expect("canonical"))
            .expect("utf8");
        for folder in [
            ".git/objects/aa",
            ".git/objects/bb",
            "node_modules/pacchetto",
            "note/sotto",
        ] {
            std::fs::create_dir_all(root.join(folder)).expect("a folder");
        }
        std::fs::write(root.join("note/a.txt"), "a").expect("a note");
        let mut ws =
            Workspace::new(&root, fub_kernel::FormatRegistry::new()).expect("the vault opens");
        ws.reindex().expect("initial scan");
        let ws = Custody::new("the pruned vault", ws);
        let flag = ws.read().expect("the vault is alive").watch_flag();
        let watcher = NotifyWatcher
            .start(&root, ws.clone(), Arc::clone(&flag))
            .expect("the watcher starts");
        let inode = |rel: &str| {
            std::fs::metadata(root.join(rel))
                .expect("the folder exists")
                .ino()
        };

        let watched = watched_inodes();
        for rel in ["", "note", "note/sotto"] {
            assert!(watched.contains(&inode(rel)), "{rel:?} must be watched");
        }
        for rel in [
            ".git",
            ".git/objects",
            ".git/objects/aa",
            "node_modules",
            "node_modules/pacchetto",
        ] {
            assert!(
                !watched.contains(&inode(rel)),
                "{rel} is excluded from the vault and must not spend a watch"
            );
        }

        std::fs::create_dir(root.join(".git/objects/cc")).expect("git writes an object");
        std::fs::create_dir(root.join("nuova")).expect("a new folder of the vault");
        assert!(
            eventually(|| watched_inodes().contains(&inode("nuova"))),
            "a folder born inside the vault must be watched"
        );
        std::fs::write(root.join("nuova/dopo.txt"), "dopo").expect("written after the watch");
        let indexed = || {
            let ws = ws.read().expect("the vault is alive");
            let Ok(fub_abi::traits::IndexResult::Entries(page)) =
                ws.query_index(fub_abi::traits::IndexQuery::Entries {
                    of_kind: None,
                    within: None,
                    page: None,
                })
            else {
                return false;
            };
            page.items
                .iter()
                .any(|entry| entry.id.as_str() == "nuova/dopo.txt")
        };
        assert!(
            eventually(indexed),
            "a file written in the new folder must reach the index"
        );
        assert!(
            !watched_inodes().contains(&inode(".git/objects/cc")),
            "an excluded folder born after the start must not be watched"
        );
        assert!(flag.load(Ordering::Acquire), "the watcher is still alive");
        drop(watcher);
    }
}
