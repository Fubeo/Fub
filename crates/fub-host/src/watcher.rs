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
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::event::Event;
use fub_abi::{PluginError, Severity};
use fub_kernel::{ParsedChange, Workspace};

use crate::custodia::Custodia;

/// Un rilevatore vivo: si tiene, e quando cade smette di guardare.
///
/// Il metodo è uno solo perché uno solo è ciò che l'host vorrà davvero sapere
/// di un watcher. Senza di lui il trait sarebbe `Box<dyn Any + Send>` con un
/// nome nuovo, che è esattamente il punto di partenza.
/// **`Sync` e non solo `Send`**, e non è un vezzo: un rilevatore vive dentro la
/// mappa delle sessioni, e da quando quella mappa sta dietro la porta unica
/// della [decisione 0120] la si presta **in condivisione** a più thread insieme.
/// La premessa che quella decisione ha rotto è che «un `RwLock` sia un `Mutex`
/// con un permesso in più»: `Mutex<T>` è `Sync` per ogni `T: Send`, perché
/// presta a uno alla volta; `RwLock<T>` lo è solo per `T: Send + Sync`. Il
/// rilevatore stava in una mappa condivisa contando su un lucchetto che non lo
/// prestava mai a due lettori — cioè su una proprietà che nessuno aveva scelto.
///
/// [decisione 0120]: ../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md
pub trait VaultWatcher: Send + Sync {
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
        workspace: Custodia<Workspace>,
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
        _workspace: Custodia<Workspace>,
        _watching: Arc<AtomicBool>,
    ) -> Result<Box<dyn VaultWatcher>, String> {
        Ok(Box::new(NoWatcher))
    }
}

/// Un cambiamento visto da fuori, **nel vocabolario di nessun rilevatore**.
///
/// I tipi di `notify` restano di là dietro la cargo feature: qui passa ciò che
/// un lotto significa, e significa la stessa cosa se un giorno a formarlo sarà
/// il rilevamento di una piattaforma diversa — o un test, che è il primo
/// cliente non-`notify` che questo tipo ha.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternalChange {
    /// Un path che è cambiato: creato, riscritto, sparito. Chi lo riceve non sa
    /// quale dei tre, e non deve: lo scopre il kernel guardando il disco.
    Touched(Utf8PathBuf),
    /// Una rinomina **accoppiata**: la stessa identità, un nome nuovo. Non è
    /// remove+add — la storia del versioning resta attaccata alla nota, e
    /// `DocumentRenamed` viene emesso anche per i rename fatti da
    /// Finder/Obsidian/sync.
    Renamed { from: Utf8PathBuf, to: Utf8PathBuf },
}

/// Chi porta nel workspace ciò che è cambiato da fuori, **un lotto alla volta**.
///
/// # Perché è un tipo e non una funzione
///
/// Perché `batch` prende `&mut self`, e questo è l'unico posto in cui l'ordine
/// dei lotti è scritto invece che sperato. Un lotto legge il disco in una fase
/// e muta in un'altra: due lotti che si accavallassero potrebbero applicare in
/// ordine invertito, e il secondo lascerebbe nel workspace lo stato più vecchio
/// dei due. Oggi non si accavallano — il debouncer di `notify` chiama il
/// proprio handler da un thread solo, e l'handler è un `FnMut` — ma «oggi non
/// succede» è la forma di garanzia che la
/// [0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md) ha
/// già dovuto scrivere in prosa una volta. Qui la dice il prestito: da un
/// `&mut ExternalSync` non se ne ricava un secondo, quindi due lotti sullo
/// stesso sincronizzatore non compilano.
///
/// # Le tre fasi, e perché sono tre
///
/// È la regola della 0024 applicata alla porta da cui il vault cambia da fuori:
///
/// 1. **leggere e parsare** i file cambiati sotto prestito **condiviso** — è
///    l'I/O più lungo del lotto, e chi legge (la ricerca, il disegno dei
///    pannelli) non ha niente a che farci;
/// 2. **mutare** il workspace sotto quello esclusivo, con i modelli già in
///    mano;
/// 3. **rendere durevole** con un prestito suo.
///
/// La terza fase resta esclusiva, e non per distrazione: `IndexProvider::flush`
/// riceve un `&mut dyn HostApi`, che il kernel costruisce su `&mut Workspace` —
/// finché la firma è quella, la durevolezza degli indici *non può* stare fuori
/// dal prestito esclusivo. Ciò che si compra tenendola in una fase sua è che
/// chi aspetta non aspetta più il lotto **intero**: fra la 2 e la 3 il lucchetto
/// si rilascia, e i lettori in coda passano.
pub struct ExternalSync {
    workspace: Custodia<Workspace>,
}

impl ExternalSync {
    pub fn new(workspace: Custodia<Workspace>) -> Self {
        ExternalSync { workspace }
    }

    /// Applica un lotto di cambiamenti. Vedi le tre fasi nel doc del tipo.
    /// **Un vault avvelenato smette di sincronizzarsi** (decisione 0120), e
    /// smette in silenzio *qui*: la riga che dice perché l'ha già scritta la
    /// porta, una volta sola. Ciò che si perde è il rilevamento — cioè un
    /// derivato — su un vault che è già irrecuperabile.
    pub fn batch(&mut self, changes: &[ExternalChange]) {
        if changes.is_empty() {
            return;
        }
        // Fase 1 — il disco, sotto prestito condiviso. Un piano è `None` per i
        // rami che non leggono niente (un path ignorato, un file di un'altra
        // specie, un file sparito) e per una lettura che non è riuscita: la
        // fase 2 li rifà per intero, dove stavano già.
        let prepared: Vec<Option<ParsedChange>> = {
            let Ok(ws) = self.workspace.read() else {
                return;
            };
            changes
                .iter()
                .map(|change| match change {
                    ExternalChange::Touched(path) => ws.plan_sync(path),
                    ExternalChange::Renamed { .. } => None,
                })
                .collect()
        };
        // Fase 2 — la memoria, sotto prestito esclusivo.
        {
            let Ok(mut ws) = self.workspace.write() else {
                return;
            };
            for (change, plan) in changes.iter().zip(prepared) {
                match change {
                    ExternalChange::Touched(path) => {
                        let _ = ws.sync_path_prepared(path, plan);
                    }
                    ExternalChange::Renamed { from, to } => {
                        let _ = ws.sync_renamed_path(from, to);
                    }
                }
            }
        }
        // Fase 3 — la durevolezza.
        self.flush();
    }

    /// Fine del lotto: è il punto tranquillo in cui rendere durevoli gli indici.
    /// Il kernel non sa quando finisce un lotto — lo sa chi il lotto lo ha
    /// formato.
    ///
    /// Un flush che non scrive perde un **derivato** (0052: `Warning`), ed è una
    /// perdita che l'utente ha il diritto di sapere: chi cerca, fino alla
    /// prossima apertura, riceve una risposta incompleta. Pavimento e porta
    /// insieme (0062): una riga nel log, una nel canale.
    fn flush(&mut self) {
        let Ok(mut ws) = self.workspace.write() else {
            return;
        };
        let flush_errors = ws.flush_indexes();
        if flush_errors.is_empty() {
            return;
        }
        for e in &flush_errors {
            tracing::warn!(target: "fub.host", "flush indice: {e}");
        }
        ws.with_host("fub.host", |host| {
            for e in flush_errors {
                host.emit(Event::Trouble {
                    severity: Severity::Warning,
                    subject: None,
                    error: PluginError::Internal(format!("flush indice: {e}").into()),
                });
            }
        });
    }

    /// **Il rilevamento è finito, e da adesso si vede** (§9.7). Un errore del
    /// debouncer non è un evento perso: è che questo vault ha smesso di sapere
    /// quando cambia da fuori — limite di inotify su un vault grande, un network
    /// share che si stacca. Non è la perdita di un dato ma la perdita di un
    /// meccanismo: da qui in poi l'indice drifta in silenzio, e non sapere che
    /// il rilevamento è morto è esattamente il caso in cui il canale serve.
    /// `Failure` perché ciò che si perde non si ricostruisce riaprendo il vault
    /// — il rilevamento va riallacciato a mano.
    /// È `pub` come `batch`, e per la stessa ragione: le due cose che un
    /// rilevatore ha da dire al workspace sono «ecco cosa è cambiato» e «ho
    /// smesso di vedere», e la seconda non è meno di `notify` della prima.
    pub fn watch_died(&mut self, motivi: Vec<String>) {
        // I motivi si scrivono nel log **prima** del prestito: se il vault è
        // avvelenato il canale degli eventi non c'è più, e la ragione per cui
        // il rilevamento è morto resterebbe l'unica cosa che nessuno ha detto.
        for motivo in &motivi {
            tracing::error!(target: "fub.host", "{motivo}");
        }
        let Ok(mut ws) = self.workspace.write() else {
            return;
        };
        ws.with_host("fub.host", |host| {
            for motivo in motivi {
                host.emit(Event::Trouble {
                    severity: Severity::Failure,
                    subject: None,
                    error: PluginError::Internal(motivo.into()),
                });
            }
        });
    }
}

#[cfg(feature = "notify-watcher")]
pub use notify_watcher::NotifyWatcher;

#[cfg(feature = "notify-watcher")]
mod notify_watcher {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use crate::custodia::Custodia;
    use std::time::Duration;

    use camino::{Utf8Path, Utf8PathBuf};
    use fub_kernel::Workspace;
    use notify::event::{EventKind, MetadataKind, ModifyKind, RenameMode};
    use notify::RecursiveMode;
    use notify_debouncer_full::{new_debouncer, DebounceEventResult};

    use super::{ExternalChange, ExternalSync, VaultWatcher, WatcherFactory};

    /// Il rilevatore di default: `notify` con un debouncer da 300 ms.
    pub struct NotifyWatcher;

    /// Il debouncer vivo. Il tipo concreto di `notify_debouncer_full` è
    /// parametrico sul backend della piattaforma, quindi resta cancellato: qui
    /// interessa solo che stia in piedi finché la sessione è aperta.
    struct Debounced {
        /// `+ Sync` da quando le sessioni si prestano in condivisione
        /// (decisione 0120): il debouncer non lo tocca nessuno — sta qui per
        /// restare vivo — ma il tipo che lo contiene sì.
        _debouncer: Box<dyn std::any::Any + Send + Sync>,
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
    /// Un rename accoppiato (`paths = [from, to]`) è una migrazione d'identità e
    /// non remove+add; tutto il resto è un path toccato, e cosa gli sia successo
    /// lo scopre il kernel guardando il disco.
    fn changes(events: Vec<notify_debouncer_full::DebouncedEvent>) -> Vec<ExternalChange> {
        let mut out = Vec::new();
        for event in events {
            if matches!(
                event.kind,
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
            for path in &event.paths {
                if let Ok(p) = Utf8PathBuf::from_path_buf(path.clone()) {
                    out.push(ExternalChange::Touched(p));
                }
            }
        }
        out
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
            workspace: Custodia<Workspace>,
            watching: Arc<AtomicBool>,
        ) -> Result<Box<dyn VaultWatcher>, String> {
            let failed = watching.clone();
            // Il sincronizzatore è **uno** e la chiusura lo possiede: è il modo
            // in cui l'ordine dei lotti smette di dipendere da quanti thread
            // `notify` decide di usare (vedi il doc di `ExternalSync`).
            let mut sync = ExternalSync::new(workspace);
            let mut debouncer = new_debouncer(
                Duration::from_millis(300),
                None,
                move |result: DebounceEventResult| match result {
                    Ok(events) => {
                        // **Leggere un file non è cambiarlo.** inotify riporta
                        // anche le aperture e gli accessi (`Access(Open)`,
                        // `Access(Close(Read))`, e l'atime che ne segue), e chi
                        // apre i documenti di questo vault più spesso di
                        // chiunque altro è Fub stesso: la localizzazione delle
                        // occorrenze (§21.3) apre il sorgente di ogni riga di
                        // una pagina di risultati. Trattare quelle aperture come
                        // cambiamenti chiudeva un anello: una ricerca leggeva
                        // sessanta note, il rilevatore riferiva sessanta
                        // «modifiche», il kernel rileggeva quelle note per
                        // scoprire che erano identiche — e quelle riletture
                        // erano altre sessanta aperture. Il giro si alimentava
                        // da solo, con un `DocumentChanged` a vuoto e un
                        // `IndexUpdated` per ogni passaggio, finché il ponte non
                        // andava in overflow e la shell non rispondeva più.
                        let events: Vec<_> = events.into_iter().filter(is_a_change).collect();
                        // Un lotto di sole letture non è un lotto: non c'è
                        // niente da sincronizzare e niente da rendere durevole,
                        // e prendere il lucchetto esclusivo per non fare niente
                        // toglierebbe il vault ai lettori a ogni ricerca.
                        if events.is_empty() {
                            return;
                        }
                        sync.batch(&changes(events));
                    }
                    Err(errors) => {
                        // Il rilevamento è finito, e da adesso si vede (§9.7):
                        // il perché sta sul metodo che lo racconta.
                        failed.store(false, Ordering::Relaxed);
                        sync.watch_died(
                            errors
                                .iter()
                                .map(|e| format!("watch error: {e:?}"))
                                .collect(),
                        );
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

    #[cfg(test)]
    mod tests {
        use super::*;
        use notify::event::{AccessKind, AccessMode, CreateKind, DataChange, RemoveKind};

        /// **L'anello che si chiudeva.** Questi sono gli eventi che inotify
        /// riporta quando Fub apre un documento per localizzare le occorrenze
        /// di una ricerca: se contassero come cambiamenti, il rilevatore
        /// chiederebbe al kernel di rileggere ciò che il kernel ha appena
        /// letto — e la rilettura sarebbe un'altra apertura.
        #[test]
        fn reading_a_document_is_not_changing_it() {
            for kind in [
                EventKind::Access(AccessKind::Open(AccessMode::Any)),
                EventKind::Access(AccessKind::Read),
                EventKind::Access(AccessKind::Close(AccessMode::Read)),
                EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)),
            ] {
                assert!(!is_a_change_kind(&kind), "{kind:?} non è un cambiamento");
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
                assert!(is_a_change_kind(&kind), "{kind:?} è un cambiamento");
            }
        }
    }
}
