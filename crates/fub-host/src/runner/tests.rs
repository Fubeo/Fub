//! Test della bandiera dei job, dell'apertura a fasi e delle sveglie, senza
//! un pool acceso.

use super::*;
use fub_abi::traits::WallClock;

/// Cosa dice la bandiera di un job, o `None` se non ne ha una.
pub(super) fn flag(flags: &Flags, id: u64) -> Option<bool> {
    flags
        .live
        .get(&JobId(id))
        .map(|f| f.load(Ordering::Relaxed))
}

/// Annullare un job **preso in carico** lo raggiunge: è il caso normale.
#[test]
fn undo_a_job_live_raises_the_its_flag() {
    let mut flags = Flags::default();
    flags.claim(JobId(7));
    flags.cancel(JobId(7), 8);
    assert_eq!(flag(&flags, 7), Some(true));
}

/// Annullare un job che il pool **non ha ancora visto** deve valere: è la
/// corsa che la 0032 ha deciso di non perdere. La bandiera nasce alzata, e
/// il drenaggio la trova così invece di rimetterla a zero.
#[test]
fn undo_a_job_again_in_queue_the_waits() {
    let mut flags = Flags::default();
    flags.claim(JobId(3));
    // Il kernel ha già emesso fino al 9 compreso: quel job esiste, è in
    // coda, e il pool non l'ha ancora drenato.
    flags.cancel(JobId(9), 10);
    assert_eq!(flag(&flags, 9), Some(true));
    flags.claim(JobId(9));
    assert_eq!(flag(&flags, 9), Some(true));
}

/// Annullare un id che il kernel **non ha mai emesso** non lascia niente.
///
/// È il caso che entra da fuori: l'id di un annullamento arriva sull'IPC
/// come stringa, e nessuno garantisce che sia di questo vault — un elenco
/// del centro attività rimasto indietro, o un altro vault diventato
/// corrente, e il numero è di un job che qui non è mai esistito. Sopra il
/// segno di `seen` sembrava «uno che deve ancora partire», e ogni pressione
/// lasciava una bandiera per la vita della sessione.
#[test]
fn undo_a_id_never_issued_not_leaves_nothing() {
    let mut flags = Flags::default();
    flags.claim(JobId(1));
    // Il kernel ha emesso 0 e 1: il 42 non è mai stato un job.
    flags.cancel(JobId(42), 2);
    assert_eq!(flag(&flags, 42), None);
    assert_eq!(
        flags.live.len(),
        1,
        "un id mai emesso ha lasciato una bandiera che nessuno toglierà"
    );
    // E il confine è **esatto**, non prudenziale: l'ultimo emesso resta
    // annullabile prima che il pool lo veda.
    flags.cancel(JobId(1), 2);
    assert_eq!(flag(&flags, 1), Some(true));
}

/// Annullare un job **già concluso** non lascia niente dietro.
///
/// È il pulsante premuto un istante troppo tardi, cioè il più comune dei
/// tre casi: senza il segno ogni pressione lascerebbe una bandiera che
/// nessuno toglie, e la mappa crescerebbe per tutta la vita del vault.
#[test]
fn undo_a_job_finished_not_leaves_nothing() {
    let mut flags = Flags::default();
    for id in [1, 2, 3] {
        flags.claim(JobId(id));
    }
    // Il pool ne ha riconsegnato l'esito: `Shared::forget` li toglie.
    for id in [1, 2, 3] {
        flags.live.remove(&JobId(id));
    }
    for id in [1, 2, 3] {
        flags.cancel(JobId(id), 4);
    }
    assert!(
        flags.live.is_empty(),
        "un annullamento arrivato tardi ha lasciato una bandiera"
    );
}

/// Un job ancora **in mano** al proprio thread è vivo quanto quello che
/// gira, anche se il segno è già andato oltre.
///
/// È la ragione per cui le bandiere nascono al drenaggio e non all'avvio: un
/// lotto si esegue uno alla volta, e nel frattempo un altro thread può
/// averne drenato uno più avanti. Col solo segno, i job in attesa del
/// proprio turno sarebbero scambiati per job già finiti — e annullarli non
/// farebbe niente.
/// **La bandiera si guarda fra una fetta e l'altra**, ed è ciò che rende
/// annullabile un lavoro che non chiama mai l'host (§15.7).
///
/// Sta qui, su [`Shared::advance_opening`] chiamata a mano, e non su un
/// pool acceso, per la ragione in testa a questo modulo: con dei thread
/// veri la differenza fra «la bandiera ha fermato l'indicizzazione» e «il
/// disco è arrivato in fondo prima che la si alzasse» è un istante da
/// indovinare, e un presidio che si indovina non presidia. Chiamata da qui,
/// nessuna fetta è ancora partita: se la bandiera vale, ne parte zero.
#[test]
fn with_the_flag_raised_no_one_slice_part() {
    let (_dir, shared, id) = a_vault_to_index();
    shared.flags.write().unwrap().claim(id);
    shared.flags.write().unwrap().cancel(id, id.0 + 1);

    assert!(
        shared.advance_opening().unwrap(),
        "c'era un'apertura da portare avanti"
    );

    assert!(
        shared.workspace.read().unwrap().documents().is_empty(),
        "una fetta è partita lo stesso: la bandiera non l'ha fermata"
    );
    // E l'apertura è **chiusa**, non sospesa: chi smette riceve un esito
    // come chiunque altro (0028), e non resta niente da portare avanti.
    assert!(
        !shared.advance_opening().unwrap(),
        "l'apertura annullata è rimasta in mano a qualcuno"
    );
}

#[test]
fn poisoned_opening_phase_still_completes_and_wakes_waiters() {
    let (_dir, shared, _id) = a_vault_to_index();
    let subscription = shared.workspace.read().unwrap().bus().subscribe();
    let end = {
        let opening = shared.opening.read().unwrap();
        Arc::clone(&opening.as_ref().expect("un'apertura in corso").end)
    };
    let waiter_end = Arc::clone(&end);
    let (woke_tx, woke_rx) = std::sync::mpsc::channel();
    let waiter = std::thread::spawn(move || {
        let (done, bell) = &*waiter_end;
        let mut done = match done.lock() {
            Ok(done) => done,
            Err(poisoned) => poisoned.into_inner(),
        };
        while !*done {
            done = match bell.wait(done) {
                Ok(done) => done,
                Err(poisoned) => poisoned.into_inner(),
            };
        }
        woke_tx.send(()).expect("il test riceve il risveglio");
    });

    poison(&shared.flags);
    assert!(
        shared.advance_opening().is_err(),
        "un custode avvelenato resta un errore osservabile"
    );
    assert!(
        woke_rx.recv_timeout(Duration::from_secs(1)).is_ok(),
        "un errore nella fase non deve lasciare il waiter bloccato"
    );
    waiter.join().expect("il waiter è terminato");
    assert_eq!(
        completed(&subscription),
        vec![fub_kernel::INDEX_JOB.to_string()],
        "anche un errore di fase consegna sempre JobDone"
    );
}

#[test]
fn poisoned_workspace_still_emits_opening_completion() {
    let (_dir, shared, _id) = a_vault_to_index();
    let subscription = shared.workspace.read().unwrap().bus().subscribe();
    let end = {
        let opening = shared.opening.read().unwrap();
        Arc::clone(&opening.as_ref().expect("un'apertura in corso").end)
    };

    poison(&shared.workspace);
    assert!(
        shared.advance_opening().is_err(),
        "il workspace avvelenato resta un errore osservabile"
    );
    let done = match end.0.lock() {
        Ok(done) => done,
        Err(poisoned) => poisoned.into_inner(),
    };
    assert!(
        *done,
        "il workspace avvelenato non può impedire il risveglio"
    );
    assert_eq!(
        completed(&subscription),
        vec![fub_kernel::INDEX_JOB.to_string()],
        "il bus indipendente consegna JobDone anche senza workspace"
    );
}

/// **Chi ferma il pool chiude anche l'apertura che nessun thread ha
/// finito** (§15.7).
///
/// Il caso è quello di un worker che vede `stopping` in cima al proprio
/// ciclo ed esce **senza passare da `advance_opening`**: da fuori quel
/// momento non si provoca — dipende da dove il thread si trovava — e qui lo
/// si mette in scena esattamente, con un pool che non ha thread. Senza la
/// riga in fondo a [`JobRunner::stop`] l'apertura resterebbe in mano a
/// nessuno, cioè un job vivo per sempre e un `wait_indexed` che non torna.
#[test]
fn stop_the_pool_from_a_outcome_all_opening_remaining() {
    let (_dir, shared, _id) = a_vault_to_index();
    let end = {
        let opening = shared.opening.read().unwrap();
        Arc::clone(&opening.as_ref().expect("un'apertura in corso").end)
    };
    let mut runner = JobRunner {
        shared: Arc::clone(&shared),
        workers: Vec::new(),
    };

    runner.stop();

    assert!(
        shared.opening.read().unwrap().is_none(),
        "l'apertura è rimasta appesa a pool fermo"
    );
    assert!(
        *end.0.lock().unwrap(),
        "chi aspettava l'indicizzazione non è stato svegliato"
    );
}

/// Una `spawn` fallita **dopo** che un worker è nato non gli consegna una
/// fetta dell'apertura e non prova a fermarlo attraverso il workspace.
///
/// Il turno resta intenzionalmente in mano al chiamante, come dentro
/// `OpeningTransaction`: il vecchio rollback chiamava `stop`, poi aspettava
/// il worker che a sua volta aspettava questo turno. I due canali mettono in
/// scena il punto esatto senza sonni: il secondo tentativo fallisce soltanto
/// dopo che il primo thread è davvero entrato nella propria closure.
#[test]
fn partial_spawn_cancels_and_joins_before_touching_the_opening() {
    let (_dir, shared, _id) = a_vault_to_index();
    let _opening_turn = shared.workspace.write_turn();
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(0);
    let (exited_tx, exited_rx) = std::sync::mpsc::channel();
    let mut entered_tx = Some(entered_tx);
    let mut exited_tx = Some(exited_tx);
    let mut attempts = 0;

    let started = JobRunner::start_workers_with(Arc::clone(&shared), 2, |builder, worker| {
        attempts += 1;
        if attempts == 2 {
            entered_rx.recv().expect("il primo worker è realmente nato");
            let opening = shared.opening.read().expect("l'apertura è leggibile");
            let opening = opening.as_ref().expect("l'apertura resta al chiamante");
            assert_eq!(
                opening.work.done(),
                0,
                "un worker ha portato avanti l'apertura prima del rollback"
            );
            assert!(
                shared
                    .workspace
                    .read()
                    .expect("il workspace è leggibile")
                    .documents()
                    .is_empty(),
                "un worker ha pubblicato documenti prima del rollback"
            );
            return Err(std::io::Error::other("spawn di prova"));
        }

        let entered = entered_tx.take().expect("un solo worker nasce");
        let exited = exited_tx.take().expect("un solo worker termina");
        builder.spawn(move || {
            entered.send(()).expect("il test osserva il worker");
            worker();
            exited.send(()).expect("il test osserva l'uscita");
        })
    });
    let error = match started {
        Err(error) => error,
        Ok(mut runner) => {
            drop(_opening_turn);
            runner.stop();
            panic!("il secondo spawn doveva fallire");
        }
    };

    assert_eq!(attempts, 2, "il guasto arriva dopo un worker reale");
    assert_eq!(
        error,
        PluginError::Io(
            "impossibile avviare il thread del pool: spawn di prova"
                .to_string()
                .into()
        ),
        "il rollback non deve sostituire il guasto di spawn"
    );
    exited_rx
        .recv()
        .expect("il worker parziale termina prima del ritorno");
    assert!(
        matches!(
            exited_rx.try_recv(),
            Err(std::sync::mpsc::TryRecvError::Disconnected)
        ),
        "il worker parziale ha lasciato vivo il proprio canale"
    );
    let opening = shared.opening.read().expect("l'apertura è leggibile");
    assert_eq!(
        opening
            .as_ref()
            .expect("l'apertura non è stata consumata")
            .work
            .done(),
        0,
        "il rollback ha avanzato l'apertura"
    );
    assert!(
        shared
            .workspace
            .read()
            .expect("il workspace è leggibile")
            .documents()
            .is_empty(),
        "il rollback ha modificato il workspace"
    );
}

/// Il cancello che rende **osservabile** un parse lento senza dormire.
///
/// `within` dice al test che il parse è cominciato, `via` gli lascia
/// decidere quando finisce. Finché non è armato il formato parsa come
/// qualunque altro.
#[derive(Default)]
struct Gate {
    within: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    via: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
}

impl Gate {
    fn arm(&self) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
        let (inside_tx, inside_rx) = std::sync::mpsc::channel();
        let (via_tx, via_rx) = std::sync::mpsc::channel();
        *self.within.lock().unwrap() = Some(inside_tx);
        *self.via.lock().unwrap() = Some(via_rx);
        (inside_rx, via_tx)
    }

    fn cross(&self) {
        let within = self.within.lock().unwrap().take();
        let via = self.via.lock().unwrap().take();
        if let (Some(within), Some(via)) = (within, via) {
            within.send(()).expect("il test aspetta il parse");
            via.recv().expect("il test lascia uscire il parse");
        }
    }
}

/// Un formato di testo nudo che, a cancello armato, si ferma dentro `parse`.
struct Slow(Arc<Gate>);

impl fub_abi::FormatProvider for Slow {
    fn descriptor(&self) -> fub_abi::format::FormatDescriptor {
        fub_abi::format::FormatDescriptor::text("prova.lento", "Lento", &["md"])
    }
    fn capabilities(&self) -> fub_abi::format::FormatCapabilities {
        fub_abi::format::FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &fub_abi::format::DocumentSource,
        ctx: &fub_abi::format::ParseContext,
    ) -> Result<fub_abi::model::DocumentModel, fub_abi::error::FormatError> {
        self.0.cross();
        let mut model =
            fub_abi::model::DocumentModel::empty(fub_abi::model::DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }
    fn render_html(
        &self,
        m: &fub_abi::model::DocumentModel,
        _or: &fub_abi::format::RenderOptions,
    ) -> Result<String, fub_abi::error::FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(
        &self,
        m: &fub_abi::model::DocumentModel,
    ) -> Result<String, fub_abi::error::FormatError> {
        Ok(m.text.clone())
    }
}

struct OpeningIndexFeedLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl fub_abi::traits::IndexProvider for OpeningIndexFeedLockProbe {
    fn routes(&self) -> Vec<fub_abi::traits::QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _: &mut dyn fub_abi::traits::HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(
        &mut self,
        _: &[fub_abi::model::DocumentModel],
    ) -> Vec<fub_abi::traits::IndexLoss> {
        self.entered.send(()).expect("il test aspetta il feed");
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .expect("il test lascia uscire il feed");
        Vec::new()
    }

    fn on_documents_removed(
        &mut self,
        _: &[fub_abi::model::DocId],
    ) -> Vec<fub_abi::traits::IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _: &[fub_abi::model::DocId]) -> Vec<fub_abi::traits::IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _: &mut dyn fub_abi::traits::HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _: &mut dyn fub_abi::traits::HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(
        &self,
        _: fub_abi::traits::IndexQuery,
    ) -> Result<fub_abi::traits::IndexResult, PluginError> {
        Err(PluginError::Unserved("feed-only probe".into()))
    }

    fn up_to_date(&self, _: &[fub_abi::traits::VaultEntry]) -> Vec<fub_abi::model::DocId> {
        Vec::new()
    }
}

#[test]
fn reader_enters_while_opening_feeds_an_external_index() {
    let mut formats = fub_kernel::FormatRegistry::new();
    formats
        .register(fub_format_markdown::MarkdownProvider::boxed())
        .expect("un provider di formato solo non confligge");
    let (_dir, shared, _id, _root) = a_vault_scanned(1, formats);
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut ws = shared.workspace.write().expect("il vault è vivo");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::new(
                "fub.audit-index-feed-opening",
                "Audit detached opening index feed",
            ),
            fub_kernel::Trust::Community,
        )
        .expect("l'owner dell'indice si dichiara");
        ws.register_index_provider(
            "fub.audit-index-feed-opening",
            Box::new(OpeningIndexFeedLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("il probe dell'indice si registra");
    }

    let slice = {
        let shared = Arc::clone(&shared);
        std::thread::spawn(move || shared.advance_opening())
    };
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("IndexProvider::on_documents_indexed entra durante l'apertura");
    let reader_progressed = crate::legacy_tests::read_comes_free(&shared.workspace);
    release_tx.send(()).expect("il feed può terminare");
    let outcome = slice.join().expect("il thread dell'apertura non panica");

    assert!(
        reader_progressed,
        "la seconda fase dell'apertura ha tenuto Custody<Workspace> durante \
         IndexProvider::on_documents_indexed"
    );
    assert!(
        outcome.expect("nessun veleno"),
        "c'era una fetta di apertura da portare avanti"
    );
}

/// **La proprietà** (0119, secondo sito): mentre la fetta dell'apertura
/// legge e parsa il disco, chi legge entra nel workspace.
///
/// È la stessa proprietà del lotto del watcher
/// (`tests/il_lotto_del_watcher.rs`) sul percorso dove i file non sono
/// quattro ma quattromila — cioè dove l'attesa è l'app ferma all'avvio di un
/// vault grosso. Qui non si cronometra niente: un tempo su una macchina
/// condivisa non è un segnale, e la proprietà comprata non è «più veloce» —
/// è che *durante* quella lettura il prestito condiviso si prende ancora.
///
/// `try_read` e non `read`: un `read` che aspettasse sarebbe verde anche col
/// prestito esclusivo, perché aspetterebbe la fine del parse e poi
/// passerebbe. La si riprova entro una scadenza, sempre con la fetta ferma
/// al cancello: chi passa per un istante si libera, la fetta no.
#[test]
fn who_reads_enters_while_the_opening_slice_reads_the_disk() {
    let gate: Arc<Gate> = Arc::default();
    let mut formats = fub_kernel::FormatRegistry::new();
    formats
        .register(Box::new(Slow(gate.clone())))
        .expect("un provider solo non va in conflitto");
    // Una nota sola: una fetta sola, quindi il cancello si attraversa una
    // volta e il test non deve indovinare quante.
    let (_dir, shared, _id, _root) = a_vault_scanned(1, formats);

    let (within, via) = gate.arm();
    let slice = {
        let shared = Arc::clone(&shared);
        std::thread::spawn(move || shared.advance_opening())
    };

    // Il parse è cominciato: da qui in poi la fetta sta facendo I/O.
    within.recv().expect("la fetta entra nel parse");
    let read_value =
        crate::legacy_tests::try_read_within(&shared.workspace, crate::legacy_tests::FREE_WITHIN);
    assert!(
        read_value.is_some(),
        "il workspace non si presta mentre la fetta dell'apertura legge il \
         disco: la fase che legge e parsa tiene il prestito esclusivo, e chi \
         guarda il vault appena aperto — la ricerca, l'albero — aspetta \
         un'I/O che non lo riguarda (0024, 0119)"
    );
    // E non è un prestito vuoto: da lì si interroga davvero.
    assert!(read_value
        .expect("il prestito condiviso c'è")
        .query_index(fub_abi::traits::IndexQuery::VaultStatus)
        .is_ok());
    via.send(()).expect("la fetta può finire");
    assert!(
        slice
            .join()
            .expect("il thread finisce")
            .expect("nessun veleno"),
        "c'era un'apertura da portare avanti"
    );

    // E la fetta ha fatto il suo lavoro.
    assert_eq!(
        shared.workspace.read().unwrap().documents().len(),
        1,
        "la fetta ha letto e parsato, ma non ha applicato niente"
    );
}

/// **Un job che il runner non riesce nemmeno a preparare ha comunque un
/// esito** (0028, e il difetto 0203).
///
/// La bandiera nasce prima del corpo, e prenderla vuol dire prendere un
/// lucchetto che con la risposta di questo job non c'entra niente: se è
/// avvelenato il job non parte, ma il canale su cui rispondere — il
/// workspace — è vivo e ha tutto ciò che serve. Un `?` lì buttava via il
/// job insieme al guasto, e chi lo aveva chiesto aspettava un `JobDone`
/// che non sarebbe mai arrivato.
#[test]
fn a_job_that_not_is_succeeds_a_prepare_has_anyway_a_outcome() {
    let (_dir, shared, _id) = a_vault_to_index();
    let subscription = shared.workspace.read().unwrap().bus().subscribe();
    poison(&shared.flags);

    let outcome = shared.run(a_job(7));

    assert!(
        outcome.is_err(),
        "il veleno delle bandiere deve restare visibile: è ciò che ferma il pool"
    );
    assert_eq!(
        completed(&subscription),
        vec!["lavoro-7".to_string()],
        "il job è sparito senza dire niente: chi lo ha chiesto aspetta un \
         `JobDone` che non arriverà, e il workspace era vivo"
    );
}

/// **Un lotto già drenato non sparisce insieme al pool che si ferma.**
///
/// `take_pending_jobs` svuota la coda: da lì in poi quei job stanno solo
/// nelle mani di questo thread, e `refuse_pending` alla chiusura guarda la
/// coda. Un `?` in mezzo al ciclo li portava via tutti — non solo quello su
/// cui si è inciampato — e succedeva nel ramo che si imbocca quando
/// qualcosa è già andato storto, cioè quando nessuno sta guardando.
#[test]
fn a_drained_batch_does_not_disappear_from_pool() {
    let (_dir, shared, _id) = a_vault_to_index();
    let subscription = shared.workspace.read().unwrap().bus().subscribe();
    poison(&shared.flags);

    let outcome = shared.batch(vec![a_job(1), a_job(2), a_job(3)]);

    assert!(
        outcome.is_err(),
        "il guasto che ferma il pool resta un guasto"
    );
    assert_eq!(
        completed(&subscription),
        vec![
            "lavoro-1".to_string(),
            "lavoro-2".to_string(),
            "lavoro-3".to_string()
        ],
        "il lotto è uscito dalla coda e non è arrivato da nessuna parte: \
         chi aveva chiesto quei job li aspetta per sempre"
    );
}

/// Un job da eseguire, di un componente che non esiste: qui non si guarda
/// cosa risponde: si guarda **se** risponde.
fn a_job(id: u64) -> PendingJob {
    PendingJob {
        id: JobId(id),
        plugin: "prova.componente".to_string(),
        spec: fub_abi::traits::JobSpec {
            job: format!("lavoro-{id}"),
            payload: serde_json::Value::Null,
        },
    }
}

/// I job che hanno ricevuto un esito, nell'ordine in cui l'hanno ricevuto.
fn completed(subscription: &fub_kernel::bus::Subscription) -> Vec<String> {
    let mut done = Vec::new();
    while let Ok(notice) = subscription.try_recv() {
        if let fub_abi::Event::JobDone { job, .. } = notice.event {
            done.push(job);
        }
    }
    done
}

/// Avvelena una custodia come la avvelena la vita: un thread che pania
/// tenendo il prestito **esclusivo**. Il panico è di proposito e non deve
/// sporcare l'output del banco: tace solo il suo thread
/// ([`crate::quiet_panic`]), non quelli degli altri test.
fn poison<T: Send + Sync + 'static>(c: &Custody<T>) {
    let copy = c.clone();
    crate::quiet_panic::quietly(move || {
        let _g = copy.write().expect("viva prima del misfatto");
        panic!("a metà");
    });
}

/// Un vault seminato, scansionato e con la sua identità di job: il punto in
/// cui `Host::open` consegna la seconda fase al pool.
fn a_vault_to_index() -> (tempfile::TempDir, Arc<Shared>, JobId) {
    let mut formats = fub_kernel::FormatRegistry::new();
    formats
        .register(fub_format_markdown::MarkdownProvider::boxed())
        .expect("un provider solo non va in conflitto");
    let (dir, shared, id, _) = a_vault_scanned(3, formats);
    (dir, shared, id)
}

/// Lo stesso, con il registro dei formati in mano al chiamante: è la leva
/// con cui il presidio del prestito mette un parse **lento** sul percorso
/// dell'apertura.
fn a_vault_scanned(
    count: usize,
    formats: fub_kernel::FormatRegistry,
) -> (tempfile::TempDir, Arc<Shared>, JobId, camino::Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root =
        camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("una radice utf8");
    for n in 0..count {
        std::fs::write(root.join(format!("Nota{n}.md")), "# Titolo\n\nCorpo.\n").expect("semina");
    }

    let mut ws = Workspace::new(&root, formats).expect("la radice appena creata si apre");
    let work = ws.scan_vault().expect("la scansione riesce");
    assert_eq!(work.total(), count as u64, "le note seminate si leggono");
    let id = ws.begin_index_job();
    let bus = ws.bus().clone();

    let shared = Shared {
        workspace: Custody::new("il vault di prova", ws),
        bundles: Custody::new("i componenti di prova", BundleRegistry::new()),
        bell: Arc::new(JobBell::default()),
        #[cfg(test)]
        stop_race_probe: None,
        bus,
        stopping: AtomicBool::new(false),
        opening: Custody::new(
            "l'apertura di prova",
            Some(InProgress {
                id,
                total: work.total(),
                work,
                unread: Custody::empty("gli scarti di prova"),
                end: Arc::new((Mutex::new(false), Condvar::new())),
            }),
        ),
        flags: Custody::empty("le bandiere di prova"),
        alarms: Custody::empty("le sveglie di prova"),
        in_flight: Arc::new((Mutex::new(InFlight::default()), Condvar::new())),
    };
    (dir, Arc::new(shared), id, root)
}

#[test]
fn a_job_in_wait_of_the_own_turn_is_cancels() {
    let mut flags = Flags::default();
    flags.claim(JobId(4)); // il lotto di un thread
    flags.claim(JobId(5));
    flags.claim(JobId(6)); // il lotto di un altro, già più avanti
    flags.claim(JobId(7));
    flags.live.remove(&JobId(4)); // il 4 è finito
    flags.cancel(JobId(5), 8); // il 5 aspetta ancora il proprio turno
    assert_eq!(flag(&flags, 5), Some(true));
    assert_eq!(flag(&flags, 4), None);
}
// -----------------------------------------------------------------------
// Le due sorgenti di tempo dentro lo stesso quadrante (§22.4, 0091).
// -----------------------------------------------------------------------

fn declare(id: &str, schedule: TimerSchedule) -> (String, fub_abi::traits::TimerSpec) {
    (
        "test.sveglia".to_string(),
        fub_abi::traits::TimerSpec {
            id: id.to_string(),
            schedule,
        },
    )
}

/// **Le due famiglie convivono nello stesso scheduler e non si mescolano.**
///
/// Un `every` prende la propria prossima da `nth_after` e un orario di parete
/// dal calendario, e nessuno dei due passa dalla regola dell'altro: se ci
/// passassero, o «ogni ora» slitterebbe con l'ora legale, o «alle 9»
/// diventerebbe «ogni 86400 secondi da adesso», che è la cosa che questa
/// voce esiste per non fare.
#[test]
fn the_two_families_coexist_in_the_same_quadrant() {
    let mut alarms = Alarms::default();
    let now = Instant::now();
    alarms.reconcile_with_cursors(
        &[
            declare("battito", TimerSchedule::Every { seconds: 3600 }),
            declare(
                "digest",
                // Mezzanotte e un minuto: sempre nel futuro, salvo il minuto
                // in cui questo test giri esattamente lì.
                TimerSchedule::AtWallClock(WallClock::daily(0, 1).anchored("Europe/Rome")),
            ),
        ],
        now,
        "",
        &HashMap::new(),
    );
    assert_eq!(alarms.quadrants.len(), 2);

    let wall = &alarms.quadrants[&("test.sveglia".into(), "digest".into())];
    assert!(
        wall.next.is_some(),
        "una sveglia di parete ha una prossima: gliela dà il calendario"
    );
    assert!(
        wall.position.wait_for.is_some(),
        "e sa quale occorrenza sta aspettando, che è ciò che le fa \
         distinguere una suonata puntuale da un recupero"
    );
    assert_eq!(
        wall.position.wait_for.map(|a| (a.hour, a.minute)),
        Some((0, 1))
    );

    // Il trascorso non ha imparato niente dal calendario: la sua prossima è
    // ancora un'ora dall'ancora, come è sempre stata.
    let elapsed = &alarms.quadrants[&("test.sveglia".into(), "battito".into())];
    assert_eq!(elapsed.position, Position::default());
    assert_eq!(
        elapsed.next,
        Some(elapsed.still + Duration::from_secs(3600))
    );
}

/// **Un fuso che il database non conosce non fa suonare la sveglia.**
///
/// E la voce resta in mappa a non suonare, invece di sparire: sparire
/// vorrebbe dire farla riseminare dalla riconciliazione al giro dopo, e il
/// pool si sveglierebbe a vuoto per sempre.
#[test]
fn a_timezone_unresolvable_not_falls_back_and_not_rings() {
    let mut alarms = Alarms::default();
    let now = Instant::now();
    alarms.reconcile_with_cursors(
        &[declare(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(9, 0).anchored("Europa/Roma")),
        )],
        now,
        "",
        &HashMap::new(),
    );
    let q = &alarms.quadrants[&("test.sveglia".into(), "digest".into())];
    assert_eq!(q.next, None, "non suona");
    assert_eq!(
        alarms.time_until(now),
        None,
        "e chi aspetta non si sveglia per lei"
    );
    assert!(alarms.expired(now, "").is_empty());
    assert_eq!(alarms.quadrants.len(), 1, "ma resta dichiarata");
}

/// Una sveglia di parete che sparisce dal manifest sparisce dai quadranti,
/// come ogni altra: la sorgente resta il manifest a ogni giro.
#[test]
fn also_a_alarm_of_wall_dies_col_manifest() {
    let mut alarms = Alarms::default();
    let now = Instant::now();
    let declared = [declare(
        "digest",
        TimerSchedule::AtWallClock(WallClock::daily(9, 0)),
    )];
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    assert_eq!(alarms.quadrants.len(), 1);
    alarms.reconcile_with_cursors(&[], now, "", &HashMap::new());
    assert!(alarms.quadrants.is_empty());
}

/// **Un recupero di parete calcolato in `reconcile` non si perde**: viene
/// conservato e drenato una volta sola da `expired`.
///
/// È il difetto che aveva `reconcile` a chiamare `wall` e a buttarne via
/// il risultato — [`position`](Quadrant::position) era già avanzato, e la
/// `wall` di `expired` non l'avrebbe più visto. Qui lo si mette in scena senza
/// dormire: si torna indietro l'ultima occorrenza considerata di un giorno,
/// e la riconciliazione successiva la vede come un recupero dovuto.
#[test]
fn a_recovery_of_wall_is_preserves_and_is_drains_a_time() {
    let mut alarms = Alarms::default();
    let now = Instant::now();
    let declared = [declare(
        "digest",
        TimerSchedule::AtWallClock(WallClock::daily(0, 0).catching_up(86400)),
    )];
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());

    // Simula il passare di un'occorrenza mentre il pool dormiva: l'ultima
    // occorrenza considerata torna indietro di un giorno, come se la
    // sveglia fosse stata in letargo dall'occorrenza precedente.
    {
        let q = alarms
            .quadrants
            .get_mut(&("test.sveglia".into(), "digest".into()))
            .expect("la sveglia è dichiarata");
        q.position.last = q.position.last.map(|u| u.prev_day());
    }

    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    let fired = alarms.expired(now, "");
    assert_eq!(
        fired,
        vec![("test.sveglia".to_string(), "digest".to_string())],
        "il recupero accumulato in riconcilia non è arrivato a scadute"
    );
    // Drenato una volta sola: una seconda chiamata non lo ridà.
    assert!(
        alarms.expired(now, "").is_empty(),
        "il recupero drenato si è ripresentato"
    );
}

/// Più riconciliazioni prima di un drenaggio non duplicano il recupero.
#[test]
fn more_reconciliations_not_duplicate_a_recovery() {
    let mut alarms = Alarms::default();
    let now = Instant::now();
    let declared = [declare(
        "digest",
        TimerSchedule::AtWallClock(WallClock::daily(0, 0).catching_up(86400)),
    )];
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    {
        let q = alarms
            .quadrants
            .get_mut(&("test.sveglia".into(), "digest".into()))
            .expect("la sveglia è dichiarata");
        q.position.last = q.position.last.map(|u| u.prev_day());
    }
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    // Una seconda riconciliazione prima che `expired` dreni.
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    assert_eq!(
        alarms.expired(now, "").len(),
        1,
        "due riconciliazioni hanno duplicato un recupero"
    );
}

/// Una sveglia rimossa dal manifest non suona per un recupero accumulato
/// prima di sparire.
#[test]
fn a_alarm_removed_not_recovers() {
    let mut alarms = Alarms::default();
    let now = Instant::now();
    let declared = [declare(
        "digest",
        TimerSchedule::AtWallClock(WallClock::daily(0, 0).catching_up(86400)),
    )];
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    {
        let q = alarms
            .quadrants
            .get_mut(&("test.sveglia".into(), "digest".into()))
            .expect("la sveglia è dichiarata");
        q.position.last = q.position.last.map(|u| u.prev_day());
    }
    alarms.reconcile_with_cursors(&declared, now, "", &HashMap::new());
    // La sveglia sparisce dal manifest: il suo recupero accumulato sparisce
    // con lei.
    alarms.reconcile_with_cursors(&[], now, "", &HashMap::new());
    assert!(
        alarms.expired(now, "").is_empty(),
        "una sveglia rimossa suona per un recupero accumulato prima di sparire"
    );
}
/// Il cursore sopravvive alla ricostruzione dello scheduler: la suonata
/// mancata entro finestra arriva, quella oltre finestra viene consumata, e
/// un timer trascorso futuro non cambia ancora.
#[test]
fn a_wall_clock_cursor_survives_a_restart_with_window_and_future_intact() {
    let now = Instant::now();
    let declared = [
        declare(
            "digest",
            TimerSchedule::AtWallClock(WallClock::daily(9, 0).anchored("UTC").catching_up(3600)),
        ),
        declare("heartbeat", TimerSchedule::Every { seconds: 3600 }),
    ];
    let first_time: Timestamp = "2026-01-15T08:00:00Z".parse().expect("timestamp");
    let mut first = Alarms::default();
    first.reconcile_with_cursors_at(&declared, now, "", &HashMap::new(), first_time);
    let cursors: HashMap<_, _> = first
        .cursors()
        .into_iter()
        .map(|(owner, timer, cursor)| ((owner, timer), cursor))
        .collect();

    let mut resumed = Alarms::default();
    let within_window: Timestamp = "2026-01-15T09:20:00Z".parse().expect("timestamp");
    resumed.reconcile_with_cursors_at(&declared, now, "", &cursors, within_window);
    assert_eq!(
        resumed.expired_at(now, "", within_window),
        vec![("test.sveglia".into(), "digest".into())]
    );
    let elapsed = &resumed.quadrants[&("test.sveglia".into(), "heartbeat".into())];
    assert_eq!(elapsed.next, Some(now + Duration::from_secs(3600)));

    let mut late = Alarms::default();
    let outside_window: Timestamp = "2026-01-15T13:00:00Z".parse().expect("timestamp");
    late.reconcile_with_cursors_at(&declared, now, "", &cursors, outside_window);
    assert!(
        late.expired_at(now, "", outside_window).is_empty(),
        "un'occorrenza oltre catch_up_seconds non deve suonare"
    );
    let elapsed = &late.quadrants[&("test.sveglia".into(), "heartbeat".into())];
    assert_eq!(elapsed.next, Some(now + Duration::from_secs(3600)));
}
