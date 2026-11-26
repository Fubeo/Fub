//! La sessione di un vault: apertura transazionale, prenotazioni di chiusura e di ripristino, il registro delle sessioni.

use super::*;

/// Dove finiscono gli eventi del kernel una volta usciti dall'host.
///
/// Il kernel ha già un bus e chiunque può abbonarsi: questo trait esiste perché
/// il subscriber live va **registrato dopo la scansione e prima che il
/// rilevatore possa emettere il primo evento verso di esso**, e quel momento lo
/// conosce solo chi apre. Il thread del ponte viene acceso subito dopo; un
/// subscriber temporaneo, registrato prima del rilevatore, copre il tratto
/// precedente senza esporre al sink gli eventi interni all'apertura.
///
/// Per l'app è il webview (`fub://event`); per un'API locale sarebbero SSE o
/// websocket; per una CLI stdout; per un e2e headless, niente — e "niente" qui
/// si dice non passando nessun sink, non passandone uno che butta via, così il
/// thread del ponte non nasce nemmeno.
pub trait EventSink: Send + Sync + 'static {
    /// Manda fuori un notice, e **dice se è uscito**.
    ///
    /// La risposta esiste perché senza di essa non c'era nessuno a cui dirlo: le
    /// due strade per cui un'uscita fallisce — il webview non c'è ancora, e la
    /// consegna torna con un errore — erano scritte tutte e due come un ramo
    /// vuoto e un `let _ =`, cioè come niente. Un evento che non esce non è un
    /// evento in meno: è una shell che resta ferma su uno stato vecchio, ed è
    /// esattamente il fatto per cui [`Event::Overflow`](fub_abi::Event::Overflow)
    /// esiste. Chi tiene il conto è il ponte, che è uno solo
    /// (`bridge::consegna`); chi implementa questo trait deve solo **non
    /// mentire**.
    ///
    /// **`vault` dice di quale vault è il fatto** (#216): la radice canonica
    /// della sessione il cui ponte lo consegna, la stessa stringa di
    /// `VaultInfo::root`. `None` è un fatto che non appartiene a un vault (una
    /// chiave della macchina). L'host tiene una sessione per vault aperto, ma
    /// il canale verso chi guarda è uno: senza questo un `document_changed
    /// "Nota.md"` di un vault lasciato aperto arriverebbe identico a uno del
    /// vault che la shell mostra. L'uscita deve portarlo fino a chi riceve
    /// ([`ShellNotice`]); chi riceve decide cosa è suo.
    #[must_use = "un'uscita che non dice se ha consegnato è una perdita silenziosa: \
                  chi riceve resta indietro e nessuno gli dice di riconciliare"]
    fn emit(&self, notice: &Notice, vault: Option<&str>) -> Delivery;
}

/// Un notice **come lo riceve una shell**: l'evento, la sua origine e il vault
/// da cui viene (#216).
///
/// È la forma di `fub://event`: i campi di [`Notice`] allo stesso livello, più
/// `vault` quando il fatto è di un vault. Il campo è additivo — una shell che
/// non lo legge riceve il notice di sempre — e assente, non `null`, per un
/// fatto della macchina.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct ShellNotice<'a> {
    #[serde(flatten)]
    pub notice: &'a Notice,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault: Option<&'a str>,
}

/// Cosa è successo a un notice arrivato a un'[uscita](EventSink).
///
/// Non è un `Result`: non c'è niente da fare con l'errore — chi emette è il
/// kernel, che non ha nessuno a cui rispondere ([decisione 0126]) — e ciò che
/// serve sapere è una cosa sola, se chi sta dall'altra parte l'ha visto.
///
/// [decisione 0126]: ../../../docs/decisions/0184-eventi-accodati-e-job.md
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Delivery {
    /// È uscito.
    Done,
    /// Non è uscito, e non uscirà: chi sta dall'altra parte ne resta in debito.
    Dropped,
}

/// Sessione di un vault aperto: il workspace condiviso, la metà leggibile del
/// versioning, e il rilevatore tenuto vivo.
pub struct VaultSession {
    /// La radice, **canonica**: è la chiave con cui questa sessione si trova, e
    /// due nomi diversi dello stesso vault non devono essere due sessioni — la
    /// seconda troverebbe il lock dell'indice della prima.
    pub(super) root: Utf8PathBuf,
    /// Il supporto su cui il vault è montato: lo stesso del workspace, ed è
    /// l'unico da cui l'host legge o scrive dentro la radice.
    pub(super) storage: Arc<dyn VaultStorage>,
    /// Il workspace, dietro il lock che distingue chi legge da chi scrive.
    ///
    /// Le misure del banco in `examples/contention.rs` confrontano un gate
    /// esterno omologo al percorso pubblico (`Mutex<()>` contro `RwLock<()>`):
    /// entrambe le varianti eseguono le stesse letture e scritture sotto la
    /// rispettiva guardia. Quel banco non osserva il `Custody<Workspace>` privato
    /// e quindi non dimostra un rapporto di velocità del lock interno.
    pub(super) workspace: Custody<Workspace>,
    /// Rotte esterne esplicite, fuori dal lock workspace. Il turno serializza
    /// add/remove, non trattiene mai il prestito durante stat del target.
    pub(super) mounts: Custody<MountRegistry>,
    /// **Chi possiede i bundle** di questo vault (§9.3): i plugin montati, in
    /// ordine di montaggio. Vive quanto la sessione perché è chi chiama
    /// `Plugin::deactivate` quando si chiude — il kernel quei plugin non li ha
    /// mai avuti.
    ///
    /// Condiviso col runner, che da qui prende il **corpo** di un job. Il lock
    /// lo si tiene per il tempo di una `body`, mai per la durata di un job: chi
    /// chiude deve poterci passare mentre un export cammina il vault.
    pub(super) registry: Custody<BundleRegistry>,
    /// I documenti ricchi che la shell ha aperti in questo vault, con le
    /// revisioni che ha ricevuto ([`crate::engines`]): cadono con la sessione.
    pub(super) open_rich: Arc<crate::engines::OpenRich>,
    /// Risorse preparate dalla `FormatSource`, vive quanto la sessione.
    pub(super) _format_resources: Vec<Box<dyn std::any::Any + Send + Sync>>,
    /// Diagnostica tipizzata prodotta dalla sorgente di startup per questa apertura.
    pub(super) startup_diagnostics: Vec<PluginError>,
    /// **Cosa questa apertura non ha letto** (§15.7): l'esito dell'apertura,
    /// tenuto per la vita della sessione.
    ///
    /// Sta qui e non lo si ricalcola perché è un fatto **di questa apertura**:
    /// riaprire lo stesso vault non lo rimonta, quindi chi chiede l'informazione
    /// dopo deve ricevere quella di quando il vault è stato scandito, non un
    /// silenzio che sembrerebbe dire «adesso è tutto a posto».
    ///
    /// È **condiviso e mutabile** da quando l'apertura è a fasi: chi apre non
    /// aspetta più di aver letto, quindi al ritorno di `open` questa lista è
    /// necessariamente vuota e si riempie mentre l'indicizzazione cammina. Il
    /// campo non dice più «cosa non si è letto» ma «cosa non si è letto
    /// **finora**», e le due frasi coincidono solo da `IndexUpdated` in poi.
    pub(super) unread: Custody<Vec<UnreadDoc>>,
    /// **Quando l'indicizzazione di questa apertura ha finito** (§15.7): la
    /// condizione su cui aspetta chi non può proseguire con una ricerca
    /// parziale — un test, e la CLI che indicizza ed esce.
    ///
    /// L'app non la usa e non deve: il verso giusto per lei è disegnare subito
    /// e aggiornare, che è tutto ciò per cui l'apertura è a fasi.
    pub(super) indexed: Arc<(Mutex<bool>, std::sync::Condvar)>,
    /// **Chi esegue il lavoro lungo** (§9.3): il pool che drena la coda dei job.
    /// Va fermato **prima** di chiudere, ed è il gemello del watcher — quello
    /// smette di guardare, questo smette di lavorare.
    pub(super) runner: JobRunner,
    /// Copia dello store delle versioni, se il versioning è acceso. L'altra
    /// vive dentro l'handler registrato nel workspace: il kernel non sa che il
    /// versioning esiste, ed è l'host a comporre le due metà.
    #[cfg(feature = "versioning")]
    pub(super) versions: Option<VersionStore>,
    /// Va tenuto in vita, e **lasciato andare per primo**: quando smette di
    /// guardare, il vault non cambia più da sotto a chi lo sta chiudendo.
    pub(super) watcher: RunningWatcher,
    /// **Quando questa sessione è stata usata l'ultima volta**, nel contatore
    /// di [`Sessions::usi`]. Da qui si legge il corrente, e per questo sta
    /// sulla sessione e non accanto alla mappa: una sessione porta con sé il
    /// proprio posto nell'ordine, e toglierla dalla mappa toglie anche quello.
    ///
    /// Zero è «aperta ma non ancora diventata corrente», che dura il tempo fra
    /// l'inserimento e [`Host::become_current`] e perde contro chiunque:
    /// aprire un vault lo rende corrente **quando l'apertura è finita**, non a
    /// metà.
    pub(super) used: u64,
    /// **Il diritto di scrivere nel vault**, esclusivo fra processi. Lo prende
    /// l'apertura prima di toccare il disco e lo lascia la chiusura per ultimo,
    /// quando nessun thread di questa sessione può più scrivere.
    pub(super) writer: Arc<VaultWriterLock>,
}

impl VaultSession {
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }
    #[cfg(test)]
    pub(crate) fn workspace(&self) -> &Custody<Workspace> {
        &self.workspace
    }

    /// Chi possiede i bundle di questo vault (§9.3): serve a chi ne monta uno a
    /// mano — un test, e a M5 il caricatore che installa un plugin a vault già
    /// aperto.
    #[cfg(test)]
    pub(crate) fn bundles(&self) -> &Custody<BundleRegistry> {
        &self.registry
    }

    #[cfg(feature = "versioning")]
    pub fn versions(&self) -> Option<&VersionStore> {
        self.versions.as_ref()
    }

    /// Diagnostica tipizzata conservata dall'apertura del vault.
    pub fn startup_diagnostics(&self) -> Vec<PluginError> {
        self.startup_diagnostics.clone()
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? (§9.7)
    pub fn is_watching(&self) -> bool {
        self.watcher.is_watching()
    }

    /// Chiude la sessione: **prima smette di guardare**, poi chiude il vault.
    ///
    /// L'ordine è il punto. Il watcher entra nel workspace da un thread suo:
    /// lasciarlo vivo durante la chiusura vorrebbe dire poter ricevere una
    /// sincronizzazione e un `flush_indexes` *dopo* che gli indici sono stati
    /// chiusi — cioè scrivere in un vault che si sta chiudendo, che è la
    /// versione a due thread del problema che questa funzione risolve.
    ///
    /// «Smette di guardare» vuol dire **e ha smesso**: lasciarlo andare aspetta
    /// il suo thread di consegna, ed è una riga del rilevatore e non di qui
    /// (difetto 0159). Prima non lo aspettava, e questo commento raccontava un
    /// ordine che la riga sotto non teneva.
    ///
    /// La chiusura passa dal registry e non dal workspace, ed è l'unica
    /// differenza col §9.5: l'ordine resta quello di [`Workspace::close`] —
    /// l'evento mentre tutti sono vivi, il flush, poi ognuno che smette a
    /// rovescio — con `Plugin::deactivate` di ogni bundle infilato al proprio
    /// posto (§9.3).
    ///
    /// Gli errori tornano a chi chiude: la chiusura non si interrompe per uno di
    /// loro ([`Workspace::close`]), e chi ha un canale per dirli li mostra.
    pub fn close(self) -> Vec<PluginError> {
        let VaultSession {
            workspace,
            watcher,
            registry,
            mut runner,
            _format_resources,
            writer,
            ..
        } = self;
        // 1. smette di guardare, 2. smette di lavorare, 3. si chiude. I primi
        // due sono la stessa regola letta due volte: nessun altro thread deve
        // poter entrare nel vault mentre lo si chiude.
        let mut errors: Vec<PluginError> = watcher.stop().err().into_iter().collect();
        errors.extend(runner.stop());
        drop(runner);
        close_session_resources(&workspace, &registry, &mut errors);
        errors.extend(crate::format_source::dispose_format_resources(
            _format_resources,
        ));
        // Il lease si lascia per ultimo: fino a qui un altro processo che
        // aprisse il vault troverebbe indici e plugin ancora al lavoro.
        drop(writer);
        errors
    }

    /// **Annulla** un job in volo (o che deve ancora partire): alzare la sua
    /// bandiera è tutto ciò che vuol dire, e alla capacità successiva il suo host
    /// gli dice di no.
    pub fn cancel_job(&self, id: JobId) {
        self.runner.cancel(id);
    }
}

/// Esegue il protocollo condiviso da chiusura pubblicata e rollback
/// pre-pubblicazione, quando workspace e registry sono ancora vivi.
pub(super) fn close_session_resources(
    workspace: &Custody<Workspace>,
    registry: &Custody<BundleRegistry>,
    errors: &mut Vec<PluginError>,
) {
    // Il turno conserva una sola chiusura logica, ma non è il `RwLock`:
    // `VaultClosed` può così rientrare nelle capacità del proprio plugin.
    // La prepare alza `closed` e accoda il terminale; il drain ripristina
    // sempre tabella, attore e flag prima che la finalize ritiri i provider.
    // Il seguito usa token propri anche per flush, deactivate e close;
    // nessuna di queste callback conserva il guard del workspace.
    let _closing_turn = workspace.write_turn();
    let prepared = match workspace.write() {
        Ok(mut ws) => ws.prepare_close(),
        Err(error) => {
            errors.push(error);
            return;
        }
    };
    let Some(prepared) = prepared else {
        return;
    };
    if let Err(error) = drain_events(workspace) {
        errors.push(error);
    }
    // I comandi di sola lettura non tengono il turno: chi era in volo quando
    // la chiusura è cominciata si ferma alla prossima chiamata all'host e si
    // aspetta qui, prima che i provider vengano smontati. Si aspetta senza
    // il lucchetto del workspace (una lettura, per finire, ne prende un
    // prestito condiviso); le letture lanciate dalla chiusura stessa non sono
    // in volo e non fanno aspettare.
    match workspace.read() {
        Ok(ws) => {
            let reads = ws.reads_in_flight();
            drop(ws);
            reads.cancel_all();
            reads.wait_idle();
        }
        Err(error) => errors.push(error),
    }

    // Flush globale, corpi plugin e indici sono callback distinte. Ogni
    // errore viene raccolto, senza saltare il resto del teardown.
    match crate::teardown::flush_indexes(workspace) {
        Ok(found) => errors.extend(found),
        Err(error) => errors.push(error),
    }
    let plugins = match workspace.read() {
        Ok(ws) => ws.closing_plugins(&prepared),
        Err(error) => Err(error),
    };
    match plugins {
        Ok(plugins) => {
            for id in plugins {
                match crate::teardown::unmount(workspace, registry, &id) {
                    Ok(found) => errors.extend(found),
                    Err(error) => errors.push(error),
                }
            }
        }
        Err(error) => errors.push(error),
    }
    match workspace.write() {
        Ok(mut ws) => {
            if let Err((_prepared, error)) = ws.finish_detached_close(prepared) {
                errors.push(error);
            }
        }
        Err(error) => errors.push(error),
    }
}

/// Possesso transazionale di tutte le risorse fra mount e pubblicazione.
///
/// Un'uscita anticipata libera il turno di apertura, ferma watcher e runner e
/// percorre lo stesso teardown di [`VaultSession::close`]. Gli errori di
/// rollback vengono registrati senza sostituire l'errore che ha interrotto
/// l'apertura.
pub(super) struct OpeningTransaction<'a> {
    pub(super) workspace: Custody<Workspace>,
    pub(super) registry: Custody<BundleRegistry>,
    /// Il supporto su cui il workspace è stato montato: passa alla sessione.
    pub(super) storage: Arc<dyn VaultStorage>,
    pub(super) format_resources: Vec<Box<dyn std::any::Any + Send + Sync>>,
    pub(super) startup_diagnostics: Vec<PluginError>,
    pub(super) watcher: Option<OpeningWatcher<'a>>,
    pub(super) runner: Option<JobRunner>,
    pub(super) session: Option<VaultSession>,
    pub(super) startup_lease: Option<StartupLease>,
    pub(super) published: bool,
}

impl<'a> OpeningTransaction<'a> {
    pub(super) fn new(
        workspace: &'a Custody<Workspace>,
        registry: &Custody<BundleRegistry>,
        storage: Arc<dyn VaultStorage>,
        format_resources: Vec<Box<dyn std::any::Any + Send + Sync>>,
        startup_diagnostics: Vec<PluginError>,
        startup_lease: Option<StartupLease>,
    ) -> Self {
        Self {
            workspace: workspace.clone(),
            registry: registry.clone(),
            storage,
            format_resources,
            startup_diagnostics,
            watcher: Some(OpeningWatcher::new(workspace)),
            runner: None,
            session: None,
            startup_lease,
            published: false,
        }
    }

    pub(super) fn workspace(&self) -> &Custody<Workspace> {
        &self.workspace
    }

    pub(super) fn registry(&self) -> &Custody<BundleRegistry> {
        &self.registry
    }

    pub(super) fn watcher(&mut self) -> &mut OpeningWatcher<'a> {
        self.watcher
            .as_mut()
            .expect("la transazione non ha ancora costruito la sessione")
    }

    pub(super) fn set_runner(&mut self, runner: JobRunner) {
        assert!(
            self.runner.replace(runner).is_none(),
            "una apertura avvia un solo runner"
        );
    }

    pub(super) fn finish_session(
        &mut self,
        root: Utf8PathBuf,
        unread: Custody<Vec<UnreadDoc>>,
        indexed: Arc<(Mutex<bool>, std::sync::Condvar)>,
        #[cfg(feature = "versioning")] versions: Option<VersionStore>,
        mounts: MountRegistry,
        writer: Arc<VaultWriterLock>,
    ) {
        assert!(
            self.session.is_none() && self.watcher.is_some() && self.runner.is_some(),
            "la sessione nasce una sola volta dopo watcher e runner"
        );
        let watcher = self
            .watcher
            .take()
            .expect("il watcher è stato verificato")
            .finish();
        let runner = self.runner.take().expect("il runner è stato verificato");
        self.session = Some(VaultSession {
            root,
            storage: Arc::clone(&self.storage),
            workspace: self.workspace.clone(),
            registry: self.registry.clone(),
            mounts: Custody::new("i mount esterni", mounts),
            open_rich: Arc::default(),
            startup_diagnostics: std::mem::take(&mut self.startup_diagnostics),
            _format_resources: std::mem::take(&mut self.format_resources),
            unread,
            indexed,
            runner,
            #[cfg(feature = "versioning")]
            versions,
            watcher,
            used: 0,
            writer,
        });
    }

    pub(super) fn session(&self) -> &VaultSession {
        self.session
            .as_ref()
            .expect("la pubblicazione richiede una sessione completa")
    }

    pub(super) fn into_session_with_lease(mut self) -> (VaultSession, Option<StartupLease>) {
        let session = self
            .session
            .take()
            .expect("la pubblicazione richiede una sessione completa");
        let lease = self.startup_lease.take();
        self.published = true;
        (session, lease)
    }
}

impl Drop for OpeningTransaction<'_> {
    fn drop(&mut self) {
        if self.published {
            return;
        }
        let mut errors = if let Some(session) = self.session.take() {
            session.close()
        } else {
            let mut errors = Vec::new();
            if let Some(watcher) = self.watcher.take() {
                errors.extend(watcher.rollback().err());
            }
            if let Some(mut runner) = self.runner.take() {
                errors.extend(runner.stop());
                drop(runner);
            }
            close_session_resources(&self.workspace, &self.registry, &mut errors);
            errors.extend(crate::format_source::dispose_format_resources(
                std::mem::take(&mut self.format_resources),
            ));
            errors
        };
        for error in errors.drain(..) {
            tracing::error!(target: "fub.host", "opening rollback failed: {error}");
        }
    }
}

/// Errore locale dell'orchestrazione host per uno snapshot globale.
///
/// Il kernel error resta strutturato nel ramo `Snapshot`; il ramo lifecycle
/// separa un vault aperto/assente dall'I/O del contenitore, senza estendere ABI
/// o WIT. `Reopen` conserva invece il fallimento della riapertura dopo commit.
#[derive(Debug)]
pub enum SnapshotHostError {
    Snapshot(fub_kernel::snapshot::SnapshotError),
    Lifecycle(PluginError),
    Reopen(PluginError),
}

impl fmt::Display for SnapshotHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Snapshot(error) => write!(formatter, "snapshot: {error}"),
            Self::Lifecycle(error) => write!(formatter, "lifecycle snapshot: {error}"),
            Self::Reopen(error) => write!(formatter, "reopen snapshot: {error}"),
        }
    }
}

impl std::error::Error for SnapshotHostError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Snapshot(error) => Some(error),
            Self::Lifecycle(error) | Self::Reopen(error) => Some(error),
        }
    }
}

impl From<fub_kernel::snapshot::SnapshotError> for SnapshotHostError {
    fn from(error: fub_kernel::snapshot::SnapshotError) -> Self {
        Self::Snapshot(error)
    }
}

/// Uno slot pubblicato per una radice.
///
/// `Closing` resta nella mappa per tutta la durata del teardown: è il confine
/// atomico che impedisce a un'apertura concorrente di montare una seconda
/// sessione sulla stessa radice.
///
/// La sessione aperta sta in una `Box`: è grande, gli altri due stati sono un
/// puntatore, e la mappa non deve pagare la sessione per ogni slot.
pub(super) enum SessionSlot {
    Open(Box<VaultSession>),
    Closing(Arc<ClosingToken>),
    Applying(Arc<ApplyingToken>),
}

/// Identità opaca di una singola chiusura.
pub(super) struct ClosingToken;

/// Identità opaca di un'applicazione offline.
pub(super) struct ApplyingToken;

/// Possesso esclusivo del marker `Applying`, senza trattenere lock durante I/O.
pub(super) struct ApplyClaim<'a> {
    pub(super) sessions: &'a Custody<Sessions>,
    pub(super) root: Utf8PathBuf,
    pub(super) token: Arc<ApplyingToken>,
    /// Il vault è chiuso ma non libero: nessun altro processo ci scrive mentre
    /// lo snapshot lo legge o lo sostituisce, e la sessione riaperta eredita
    /// lo stesso lease.
    pub(super) writer: Arc<VaultWriterLock>,
}

impl ApplyClaim<'_> {
    pub(super) fn token(&self) -> Arc<ApplyingToken> {
        Arc::clone(&self.token)
    }

    pub(super) fn writer(&self) -> Arc<VaultWriterLock> {
        Arc::clone(&self.writer)
    }
}

impl Drop for ApplyClaim<'_> {
    fn drop(&mut self) {
        let Ok(mut sessions) = self.sessions.write() else {
            return;
        };
        let owned = matches!(
            sessions.slots.get(&self.root),
            Some(SessionSlot::Applying(token)) if Arc::ptr_eq(token, &self.token)
        );
        if owned {
            sessions.slots.remove(&self.root);
        }
    }
}

/// Ciò che una scrittura di un documento di videoscrittura lascia a chi
/// l'ha chiesta ([`crate::engines`]).
#[derive(Default)]
pub(super) struct RichWrite {
    /// Il documento è di videoscrittura: la revisione dei byte che la
    /// scrittura copre, `None` se il file non c'era.
    pub(super) overwritten: Option<Option<Revision>>,
    /// Le revisioni di cui il codec può aver ricordato la prova a vuoto, anche
    /// se il salvataggio è fallito.
    pub(super) left: Vec<Revision>,
}

/// I registri delle chiavi di apertura dei vault aperti.
pub(super) fn open_registers(sessions: &Sessions) -> Vec<Arc<crate::engines::OpenRich>> {
    sessions
        .slots
        .values()
        .filter_map(|slot| match slot {
            SessionSlot::Open(session) => Some(Arc::clone(&session.open_rich)),
            SessionSlot::Closing(_) | SessionSlot::Applying(_) => None,
        })
        .collect()
}

/// Possesso esclusivo del teardown di una sessione.
///
/// Il marker viene ritirato da `Drop`, quindi anche un panic proveniente da un
/// provider non lascia la radice permanentemente in chiusura. L'identità evita
/// che una chiusura vecchia possa rimuovere lo slot di un'operazione successiva.
pub(super) struct CloseClaim<'a> {
    pub(super) sessions: &'a Custody<Sessions>,
    pub(super) resources: Option<&'a Custody<crate::resources::ResourceTable>>,
    pub(super) root: Utf8PathBuf,
    pub(super) token: Arc<ClosingToken>,
    pub(super) session: Option<VaultSession>,
}

impl CloseClaim<'_> {
    pub(super) fn revoke_resources(&mut self) -> Result<(), PluginError> {
        if let Some(resources) = self.resources.take() {
            resources.write()?.drain_vault(self.root.as_str());
        }
        Ok(())
    }

    pub(super) fn close(mut self) -> Vec<PluginError> {
        let mut errors: Vec<_> = self.revoke_resources().err().into_iter().collect();
        // Le chiavi di apertura del vault cadono con la sessione.
        errors.extend(
            self.session
                .take()
                .expect("una pretesa di chiusura possiede la sessione")
                .close(),
        );
        // Ritirato il marker, se non resta un altro vault, aperto o in
        // chiusura, nessun documento ha più bisogno delle cache dei motori:
        // si svuotano. Se resta, o se la mappa non si legge, decide il budget.
        let sessions = self.sessions;
        drop(self);
        let last = sessions
            .read()
            .is_ok_and(|sessions| sessions.slots.is_empty());
        if last {
            crate::rich::empty_engine_caches();
        }
        errors
    }
}

impl Drop for CloseClaim<'_> {
    fn drop(&mut self) {
        // Anche i claim non ancora visitati durante un unwind revocano le
        // lease; Custody conserva la diagnosi dell'eventuale avvelenamento.
        let _ = self.revoke_resources();
        let Ok(mut sessions) = self.sessions.write() else {
            return;
        };
        let owned = matches!(
            sessions.slots.get(&self.root),
            Some(SessionSlot::Closing(token)) if Arc::ptr_eq(token, &self.token)
        );
        if owned {
            sessions.slots.remove(&self.root);
        }
    }
}

pub(super) fn closing_conflict(root: &Utf8Path) -> PluginError {
    PluginError::Conflict(format!("Il vault su {root} è in chiusura.").into())
}

pub(super) fn applying_conflict(root: &Utf8Path) -> PluginError {
    PluginError::Conflict(format!("Il vault su {root} è in applicazione snapshot.").into())
}

/// I vault aperti, **in ordine d'uso**, e quelli il cui teardown è in corso.
///
/// Il vault "corrente" è **della shell**: serve a chi non ne nomina uno, e non
/// è un'assunzione del backend. Uno slot `Closing` non è più aperto e non può
/// quindi essere corrente, ma resta pubblicato finché il teardown termina.
#[derive(Default)]
pub(super) struct Sessions {
    pub(super) slots: BTreeMap<Utf8PathBuf, SessionSlot>,
    /// Quanti «diventa corrente» sono passati di qui. È un **contatore** e non
    /// un orologio: la domanda è *chi è stato usato dopo chi*, e a un ordine
    /// non serve sapere che ore erano — un orologio di sistema, che può
    /// tornare indietro, saprebbe rispondere peggio alla stessa domanda.
    pub(super) usi: u64,
}

impl Sessions {
    /// **Il vault corrente**: il più recente fra quelli ancora aperti.
    pub(super) fn current(&self) -> Option<&Utf8PathBuf> {
        self.slots
            .iter()
            .filter_map(|(root, slot)| match slot {
                SessionSlot::Open(session) => Some((root, session)),
                SessionSlot::Closing(_) | SessionSlot::Applying(_) => None,
            })
            .max_by_key(|(_, session)| session.used)
            .map(|(root, _)| root)
    }

    pub(super) fn session(&self, root: &Utf8Path) -> Result<&VaultSession, PluginError> {
        match self.slots.get(root) {
            Some(SessionSlot::Open(session)) => Ok(session),
            Some(SessionSlot::Closing(_)) => Err(closing_conflict(root)),
            Some(SessionSlot::Applying(_)) => Err(applying_conflict(root)),
            None => Err(PluginError::NotFound(
                format!("Nessun vault aperto su {root}.").into(),
            )),
        }
    }

    /// Questo vault è il più recente. `Ok(false)` se non è aperto; una
    /// chiusura ancora in corso resta invece un conflitto osservabile.
    pub(super) fn make_current(&mut self, root: &Utf8Path) -> Result<bool, PluginError> {
        self.usi += 1;
        let usi = self.usi;
        match self.slots.get_mut(root) {
            Some(SessionSlot::Open(session)) => {
                session.used = usi;
                Ok(true)
            }
            Some(SessionSlot::Closing(_)) => Err(closing_conflict(root)),
            Some(SessionSlot::Applying(_)) => Err(applying_conflict(root)),
            None => Ok(false),
        }
    }
}
