//! Le tre proprietà del lavoro lungo che vede il vault (§9.1, decisione 0027).
//!
//! La voce diceva una cosa sola: `Plugin::run_job` non aveva l'`HostApi`,
//! quindi l'unico modo di dare input a un job era che il **chiamante** leggesse
//! il vault dentro il giro sincrono — cioè facesse lì, in esclusiva sul
//! workspace, esattamente il lavoro che il job doveva togliere da lì. Qui sta
//! ciò che la firma nuova compra, provato invece che detto:
//!
//! 1. un job **cammina** il vault e ci **scrive**, dal proprio thread;
//! 2. mentre cammina, **chi salva entra lo stesso** — non alla fine, come con la
//!    strada di prima, ed è il confronto fra le due a dirlo nella stessa corsa e
//!    sullo stesso vault;
//! 3. se il vault cambia mentre il job calcola, la guardia che se ne accorge è

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::JoinHandle;

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::model::{DocId, Span};
use fub_abi::traits::{HostApi, Plugin, PluginManifest, VaultRead, VaultWrite};
use fub_abi::PluginError;
use fub_host::{Host, JobHost, NoWatcher};

const INVENTORY: &str = "fub.inventario";

/// Il plugin del banco: un job che cammina il vault, legge il modello di ogni
/// nota e scrive il conto in una nota nuova.
///
/// È il pattern che il §9.1 elencava come inesprimibile — import, export, sito
/// statico, embedding, health check camminano tutti il vault e quasi tutti ci
/// scrivono — ridotto al minimo che lo dimostra.
struct Inventory;

impl Plugin for Inventory {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(INVENTORY, "Inventario")
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            "inventario" => {
                let mut titles = 0usize;
                let documents = host.list_documents(None)?;
                for id in &documents.items {
                    // La lettura vera, quella che prima il chiamante doveva fare
                    // per conto del job: rilegge e riparsa dal disco.
                    titles += host.read_model(id)?.outline.len();
                }
                let destination = payload
                    .get("where")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Inventario.md");
                host.create_document(
                    &DocId::new(destination),
                    &format!(
                        "# Inventario\n\n{} note, {titles} titoli\n",
                        documents.total
                    ),
                )?;
                Ok(serde_json::json!({ "note": documents.total, "titoli": titles }))
            }
            other => Err(PluginError::UnknownJob(other.into())),
        }
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault(notes: usize) -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    for the in 0..notes {
        let body = format!(
            "# Note {the}\n\n#prova\n\n## Sezione\n\nUn testo con parole ripetute, \
             abbastanza lungo da costare un parse vero. Vedi [[Note {}]].\n",
            (the + 1) % notes.max(1)
        );
        std::fs::write(root.join(format!("Note {the}.md")), body).unwrap();
    }
    Vault { _dir: dir, root }
}

/// Un vault aperto con il plugin del banco già **dichiarato**: il kernel non
/// presta capacità a una stringa (§7.3), e un `JobHost` intestato a un id che
/// nessuno ha dichiarato nega tutto.
fn open(v: &Vault) -> Host {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("il vault si apre");
    // **Si aspetta l'indicizzazione**, e non è un dettaglio di comodo: da
    // quando l'apertura è a fasi (§15.7,
    // [0070](../../../docs/decisions/0183-composizione-host-kernel.md))
    // `open` torna a indici ancora vuoti, e la seconda fase prende il prestito
    // in esclusiva **una fetta alla volta** su questi stessi thread. Un test di
    // questo file che partisse lì troverebbe il vault occupato da qualcosa che
    // non è il job che sta guardando — e non c'è nessun modo di distinguere le
    // due cose da fuori.
    host.wait_indexed(None).expect("l'indicizzazione finisce");
    host.debug_workspace(None)
        .unwrap()
        .write()
        .unwrap()
        .register_core_feature(INVENTORY, "Inventario")
        .expect("declared");
    host
}

/// **La proprietà che dà il nome alla voce**: un job vede il vault, e ci scrive.
///
/// Gira sul proprio thread, come lo eseguirà il runner del §9.3, e il thread
/// principale non tiene niente in mano — che è la condizione che il contratto
/// dichiara e l'unica che chi esegue deve rispettare.
#[test]
fn a_job_walks_the_vault_and_there_writes() {
    let v = vault(30);
    let host = open(&v);
    let ws = host.debug_workspace(None).unwrap();

    let outcome = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let mut job_host = JobHost::new(ws, INVENTORY);
            Inventory.run_job("inventario", serde_json::json!({}), &mut job_host)
        })
        .join()
        .expect("il thread del job non pania")
    };

    let outcome = outcome.expect("the job succeeds");
    assert_eq!(outcome["note"], 30, "the job saw all the vault's notes");
    assert_eq!(
        outcome["titoli"], 60,
        "and read every note's parsed model, not just the name"
    );
    assert_eq!(
        ws.read()
            .unwrap()
            .read_source(&DocId::new("Inventario.md"))
            .expect("la nota scritta dal job esiste"),
        "# Inventario\n\n30 note, 60 titoli\n",
        "the job wrote to the vault, from its own thread"
    );
}

/// Un job che non tocca l'host resta possibile, e non è un dettaglio: per un
/// calcolo puro la firma di prima era quella giusta, e chi la usava non deve
/// riscrivere niente.
#[test]
fn a_job_that_not_touches_the_host_remains_a_calculation_pure() {
    let v = vault(2);
    let host = open(&v);
    let mut job_host = JobHost::new(host.debug_workspace(None).unwrap(), INVENTORY);
    assert!(matches!(
        Inventory.run_job("altro", serde_json::json!({}), &mut job_host),
        Err(PluginError::UnknownJob(j)) if j == "altro"
    ));
}

/// **Una camminata che si ferma dopo ogni nota**, e che riparte solo quando
/// glielo si dice.
///
/// È il banco delle due colonne, ed è ciò che toglie di mezzo la corsa. Finché
/// chi cammina correva libero, la domanda «chi salva è entrato durante?» aveva
/// **due** incognite: dove fosse arrivata la camminata, e se chi salva avesse
/// fatto in tempo a mettersi in coda prima che finisse. La seconda non la decide
/// questo repo — la decide lo scheduler — ed è quella che rendeva il test rosso
/// una volta su dieci con il codice giusto sotto.
///
/// Col rendez-vous la seconda incognita **non esiste**. Quando `fatto` consegna
/// un numero, chi cammina è tornato a `via.recv()`: non ha in mano nessun
/// prestito e non ne può prendere uno finché non gli si dà il via. Quello che
struct Walk {
    /// «Ho letto la n-esima nota, e adesso sono fermo.»
    done: Receiver<usize>,
    /// «Vai avanti.» Chiuderlo fa finire la camminata.
    prosegui: SyncSender<()>,
    thread: JoinHandle<()>,
}

impl Walk {
    /// Fa leggere **una** nota e torna quante ne ha lette in tutto. Al ritorno
    /// chi cammina è fermo, di sicuro: è la proprietà su cui poggia tutto il
    /// test. `None` quando la camminata è finita.
    fn step(&self) -> Option<usize> {
        self.prosegui.send(()).ok()?;
        self.done.recv().ok()
    }

    fn finish(self) {
        drop(self.prosegui);
        drop(self.done);
        self.thread
            .join()
            .expect("il thread of camminata non pania");
    }
}

/// Avvia una camminata passo-passo. Il corpo riceve i due capi del rendez-vous e
/// deve rispettarne il protocollo: `via.recv()` prima di ogni lettura,
/// `fatto.send(n)` dopo.
fn step_step(body: impl FnOnce(&Receiver<()>, &SyncSender<usize>) + Send + 'static) -> Walk {
    // Capacità **zero** in tutti e due i versi: una `send` che tornasse senza che
    // l'altro l'abbia presa rimetterebbe dentro l'incertezza che questo banco
    // esiste per togliere.
    let (prosegui, via) = sync_channel::<()>(0);
    let (step_done, done) = sync_channel::<usize>(0);
    let thread = std::thread::spawn(move || body(&via, &step_done));
    Walk {
        done,
        prosegui,
        thread,
    }
}

/// **La contropartita, ed è la ragione vera della voce.**
///
/// Le due colonne fanno lo stesso lavoro sullo stesso vault nella stessa corsa:
/// leggere il modello di ogni nota. La prima lo fa da un job, con l'host che
/// prende il prestito **per chiamata**; la seconda come deve farlo oggi chi non
/// ha un job che vede il vault — un prestito solo, tenuto per tutta la
/// camminata, che è la forma esatta di ciò che il §9.1 chiamava «fare lì, in
/// esclusiva sul workspace, il lavoro che il job doveva togliere da lì».
///
/// Ciò che si asserisce è **se chi salva può entrare mentre l'altro cammina**:
/// da una parte sì, a metà camminata come al primo passo; dall'altra no, fino
/// alla fine. E non quanto aspetta.
///
/// La differenza non è cosmetica, ed è costata una CI rossa **due volte**.
///
/// La prima stesura chiedeva un **rapporto** fra i due tempi — dieci a uno —
/// ragionando che una macchina lenta allunga entrambe le colonne e lascia
/// intatta la distanza. È vero della velocità della macchina e falso di ciò che
/// decide davvero quell'attesa, che è **come il sistema operativo arbitra un
/// `RwLock`**. Su Linux chi salva entra in poche centinaia di nanosecondi: il
/// futex mette in coda chi scrive e i lettori che arrivano dopo non lo
/// scavalcano. Su macOS chi legge può rientrare mentre chi scrive è in coda, e
/// la stessa riga ha misurato 3,46 ms su 10,5 ms di camminata: rapporto tre, e
/// rosso — con il codice giusto sotto.
///
/// La seconda ha tolto l'orologio e ha chiesto **dove** fosse arrivata la
/// camminata quando chi salva è entrato, con due thread lanciati insieme da una
/// barriera. Meglio, e ancora una corsa: la barriera dice che chi cammina è
/// *partito*, non che chi salva sia riuscito a **mettersi in coda** prima che i
/// centocinquanta parse finissero. Se lo scheduler non gli dà la CPU in tempo,
/// chi salva arriva a lock libero e a camminata finita, e la riga è rossa senza
/// che niente sia rotto. Misurato su questo repo: **2 fallimenti su 20 corse**,
/// anche eseguendo il solo binario.
///
/// Questa stesura toglie l'ultima incognita invece di allargarne la tolleranza.
/// La camminata si ferma dopo ogni nota ([`Camminata`]), quindi *dove* si trova
/// l'altro non è più una domanda; e ciò che resta si chiede con `try_write`, che
/// non ha dentro nessun arbitro — è «il prestito è libero **adesso**?» invece di
/// «quanto devo aspettare?». Ed è esattamente la domanda della voce: quello che
/// il `JobHost` decide è **quando il prestito viene rilasciato** — per chiamata,
#[test]
fn while_a_job_walks_the_vault_who_saves_does_not_wait() {
    const NOTE: usize = 150;
    let v = vault(NOTE);
    let host = open(&v);
    let ws = host.debug_workspace(None).unwrap();

    // --- la colonna del job: il prestito è **per chiamata** -----------------
    let job = {
        let ws_job = ws.clone();
        step_step(move |via, done| {
            let job_host = JobHost::new(ws_job, INVENTORY);
            let documents = job_host.list_documents(None).unwrap().items;
            for (read, id) in documents.iter().enumerate() {
                if via.recv().is_err() {
                    return;
                }
                let _ = job_host.read_model(id);
                if done.send(read + 1).is_err() {
                    return;
                }
            }
        })
    };

    assert_eq!(job.step(), Some(1), "the walk read the first note");
    // E chi salva entra **qui**, con centoquarantanove note ancora da leggere.
    // Non «prova a entrare»: entra, e scrive davvero.
    let mut who_save = ws.try_write().expect(
        "a saver found the vault occupied after just one note out of 150: the `JobHost`
         holds the borrow for the job's duration instead of one call's, which is
         the defect the entry existed to remove",
    );
    who_save
        .write_document(
            &DocId::new("Note 0.md"),
            "# Note 0\n\nsalvata\n",
            WriteBase::Dictated,
        )
        .expect("the save succeeds");
    drop(who_save);

    // Non era lo spiraglio del primo passo: ogni passo ne apre uno.
    for _ in 1..NOTE / 2 {
        job.step().expect("the walk continues");
    }
    assert!(
        ws.try_write().is_some(),
        "the first gap was there and at mid-walk it is not: the borrow is not released
         per call"
    );

    let mut last = 0;
    while let Some(n) = job.step() {
        last = n;
    }
    assert_eq!(
        last, NOTE,
        "the walk did not reach the end: the saver cut across it, not into it"
    );
    job.finish();

    // --- la colonna di controllo: un prestito solo, per tutta la camminata --
    // È la strada di prima, ed era l'unica che avesse il chiamante di un job.
    let synchronous = {
        let ws_loan = ws.clone();
        step_step(move |via, done| {
            let w = ws_loan.read().unwrap();
            let documents = w.documents();
            for (read, id) in documents.iter().enumerate() {
                if via.recv().is_err() {
                    return;
                }
                let _ = w.read_model(id);
                if done.send(read + 1).is_err() {
                    return;
                }
            }
        })
    };

    // Le stesse due domande della colonna sopra, nello stesso ordine e agli
    // stessi due punti: dopo la prima nota, e a metà camminata.
    assert_eq!(
        synchronous.step(),
        Some(1),
        "from this side too the walk read the first note"
    );
    assert!(
        ws.try_write().is_none(),
        "the control column is no longer controlling anything: with a single borrow,
         held for the entire walk, a saver cannot enter — but after one note out
         of {NOTE} it entered. The meaning of the lines above has changed, not
         their result"
    );

    for _ in 1..NOTE / 2 {
        synchronous.step().expect("the control walk continues");
    }
    assert!(
        ws.try_write().is_none(),
        "and at mid-walk neither: where the per-call borrow opened a gap, the single
         borrow opens none. If this line is red it no longer holds for the entire
         walk, and the two columns are no longer comparing"
    );
    synchronous.finish();
}

/// **Cosa succede se il vault cambia mentre il job calcola**, che era la seconda
/// delle due strade della voce — e la risposta è che non serviva una semantica
/// nuova: c'era già, ed è quella della decisione 0008.
///
/// Il job chiede la revisione, qualcun altro scrive, il job consegna l'edit
/// calcolato su quella revisione: `Conflict`, e non una sovrascrittura in
/// silenzio. Che le due chiamate del job stiano ai lati della scrittura altrui
/// **sullo stesso thread** è a sua volta la prova che fra una capacità e l'altra
/// il prestito non c'è: se ci fosse, questa riga non tornerebbe mai.
#[test]
fn a_job_that_writes_on_a_base_old_receives_conflict() {
    let v = vault(3);
    let host = open(&v);
    let ws = host.debug_workspace(None).unwrap();
    let id = DocId::new("Note 1.md");

    let mut job_host = JobHost::new(ws.clone(), INVENTORY);
    let base = job_host
        .document_revision(&id)
        .expect("the revision is readable");

    // L'utente salva mentre il job calcola.
    ws.write()
        .unwrap()
        .write_document(
            &id,
            "# Note 1\n\nscritta dall'utente\n",
            WriteBase::Dictated,
        )
        .expect("the save succeeds");

    let outcome = job_host.apply_edit(
        &id,
        EditRequest {
            base,
            edits: vec![TextEdit {
                span: Span { start: 0, end: 0 },
                text: "calcolato dal job\n".into(),
            }],
        },
    );
    assert!(
        matches!(outcome, Err(PluginError::Conflict(_))),
        "an edit calculated on a superseded revision was applied anyway: the guard from
         decision 0008 does not reach jobs, and then long work that writes is
         long work that overwrites"
    );
    assert_eq!(
        ws.read().unwrap().read_source(&id).unwrap(),
        "# Note 1\n\nscritta dall'utente\n",
        "and what the user wrote is still there"
    );
}
