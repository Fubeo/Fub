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
//!    quella di tutti: la `base` della decisione 0008, e `Conflict`.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::JoinHandle;

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::model::{DocId, Span};
use fub_abi::traits::{HostApi, Plugin, PluginManifest, VaultRead, VaultWrite};
use fub_abi::PluginError;
use fub_host::{Host, JobHost, NoWatcher};

const INVENTARIO: &str = "fub.inventario";

/// Il plugin del banco: un job che cammina il vault, legge il modello di ogni
/// nota e scrive il conto in una nota nuova.
///
/// È il pattern che il §9.1 elencava come inesprimibile — import, export, sito
/// statico, embedding, health check camminano tutti il vault e quasi tutti ci
/// scrivono — ridotto al minimo che lo dimostra.
struct Inventario;

impl Plugin for Inventario {
    fn manifest(&self) -> PluginManifest {
        PluginManifest::core(INVENTARIO, "Inventario")
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
                let mut titoli = 0usize;
                let documenti = host.list_documents(None)?;
                for id in &documenti.items {
                    // La lettura vera, quella che prima il chiamante doveva fare
                    // per conto del job: rilegge e riparsa dal disco.
                    titoli += host.read_model(id)?.outline.len();
                }
                let dove = payload
                    .get("dove")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Inventario.md");
                host.create_document(
                    &DocId::new(dove),
                    &format!(
                        "# Inventario\n\n{} note, {titoli} titoli\n",
                        documenti.total
                    ),
                )?;
                Ok(serde_json::json!({ "note": documenti.total, "titoli": titoli }))
            }
            altro => Err(PluginError::UnknownJob(altro.into())),
        }
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault(note: usize) -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    for i in 0..note {
        let corpo = format!(
            "# Nota {i}\n\n#prova\n\n## Sezione\n\nUn testo con parole ripetute, \
             abbastanza lungo da costare un parse vero. Vedi [[Nota {}]].\n",
            (i + 1) % note.max(1)
        );
        std::fs::write(root.join(format!("Nota {i}.md")), corpo).unwrap();
    }
    Vault { _dir: dir, root }
}

/// Un vault aperto con il plugin del banco già **dichiarato**: il kernel non
/// presta capacità a una stringa (§7.3), e un `JobHost` intestato a un id che
/// nessuno ha dichiarato nega tutto.
fn aperto(v: &Vault) -> Host {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("il vault si apre");
    // **Si aspetta l'indicizzazione**, e non è un dettaglio di comodo: da
    // quando l'apertura è a fasi (§15.7,
    // [0070](../../../docs/decisions/0070-un-vault-si-apre-in-due-tempi.md))
    // `open` torna a indici ancora vuoti, e la seconda fase prende il prestito
    // in esclusiva **una fetta alla volta** su questi stessi thread. Un test di
    // questo file che partisse lì troverebbe il vault occupato da qualcosa che
    // non è il job che sta guardando — e non c'è nessun modo di distinguere le
    // due cose da fuori.
    host.wait_indexed(None).expect("l'indicizzazione finisce");
    host.workspace(None)
        .unwrap()
        .write()
        .unwrap()
        .register_core_feature(INVENTARIO, "Inventario")
        .expect("dichiarato");
    host
}

/// **La proprietà che dà il nome alla voce**: un job vede il vault, e ci scrive.
///
/// Gira sul proprio thread, come lo eseguirà il runner del §9.3, e il thread
/// principale non tiene niente in mano — che è la condizione che il contratto
/// dichiara e l'unica che chi esegue deve rispettare.
#[test]
fn un_job_cammina_il_vault_e_ci_scrive() {
    let v = vault(30);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();

    let esito = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let mut job_host = JobHost::new(ws, INVENTARIO);
            Inventario.run_job("inventario", serde_json::json!({}), &mut job_host)
        })
        .join()
        .expect("il thread del job non pania")
    };

    let esito = esito.expect("il job riesce");
    assert_eq!(esito["note"], 30, "il job ha visto tutte le note del vault");
    assert_eq!(
        esito["titoli"], 60,
        "e di ognuna ha letto il modello parsato, non solo il nome"
    );
    assert_eq!(
        ws.read()
            .unwrap()
            .read_source(&DocId::new("Inventario.md"))
            .expect("la nota scritta dal job esiste"),
        "# Inventario\n\n30 note, 60 titoli\n",
        "il job ha scritto nel vault, dal proprio thread"
    );
}

/// Un job che non tocca l'host resta possibile, e non è un dettaglio: per un
/// calcolo puro la firma di prima era quella giusta, e chi la usava non deve
/// riscrivere niente.
#[test]
fn un_job_che_non_tocca_lhost_resta_un_calcolo_puro() {
    let v = vault(2);
    let host = aperto(&v);
    let mut job_host = JobHost::new(host.workspace(None).unwrap(), INVENTARIO);
    assert!(matches!(
        Inventario.run_job("altro", serde_json::json!({}), &mut job_host),
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
/// resta da chiedere è una domanda sola, e non ha dentro nessun arbitro.
struct Camminata {
    /// «Ho letto la n-esima nota, e adesso sono fermo.»
    fatto: Receiver<usize>,
    /// «Vai avanti.» Chiuderlo fa finire la camminata.
    prosegui: SyncSender<()>,
    thread: JoinHandle<()>,
}

impl Camminata {
    /// Fa leggere **una** nota e torna quante ne ha lette in tutto. Al ritorno
    /// chi cammina è fermo, di sicuro: è la proprietà su cui poggia tutto il
    /// test. `None` quando la camminata è finita.
    fn passo(&self) -> Option<usize> {
        self.prosegui.send(()).ok()?;
        self.fatto.recv().ok()
    }

    fn finisci(self) {
        drop(self.prosegui);
        drop(self.fatto);
        self.thread
            .join()
            .expect("il thread della camminata non pania");
    }
}

/// Avvia una camminata passo-passo. Il corpo riceve i due capi del rendez-vous e
/// deve rispettarne il protocollo: `via.recv()` prima di ogni lettura,
/// `fatto.send(n)` dopo.
fn passo_passo(
    corpo: impl FnOnce(&Receiver<()>, &SyncSender<usize>) + Send + 'static,
) -> Camminata {
    // Capacità **zero** in tutti e due i versi: una `send` che tornasse senza che
    // l'altro l'abbia presa rimetterebbe dentro l'incertezza che questo banco
    // esiste per togliere.
    let (prosegui, via) = sync_channel::<()>(0);
    let (fine_passo, fatto) = sync_channel::<usize>(0);
    let thread = std::thread::spawn(move || corpo(&via, &fine_passo));
    Camminata {
        fatto,
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
/// o una volta sola per tutto il job — non chi vince la coda. Un test che cade
/// per una proprietà del lock di sistema non sta guardando ciò per cui esiste.
#[test]
fn mentre_un_job_cammina_il_vault_chi_salva_non_aspetta() {
    const NOTE: usize = 150;
    let v = vault(NOTE);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();

    // --- la colonna del job: il prestito è **per chiamata** -----------------
    let job = {
        let ws_job = ws.clone();
        passo_passo(move |via, fatto| {
            let job_host = JobHost::new(ws_job, INVENTARIO);
            let documenti = job_host.list_documents(None).unwrap().items;
            for (letti, id) in documenti.iter().enumerate() {
                if via.recv().is_err() {
                    return;
                }
                let _ = job_host.read_model(id);
                if fatto.send(letti + 1).is_err() {
                    return;
                }
            }
        })
    };

    assert_eq!(job.passo(), Some(1), "la camminata ha letto la prima nota");
    // E chi salva entra **qui**, con centoquarantanove note ancora da leggere.
    // Non «prova a entrare»: entra, e scrive davvero.
    let mut chi_salva = ws.try_write().expect(
        "chi salva ha trovato il vault occupato dopo una sola nota su 150: il \
         `JobHost` tiene il prestito per la durata del job invece che per quella \
         di una chiamata, ed è il difetto che la voce esisteva per togliere",
    );
    chi_salva
        .write_document(
            &DocId::new("Nota 0.md"),
            "# Nota 0\n\nsalvata\n",
            WriteBase::Dictated,
        )
        .expect("il salvataggio riesce");
    drop(chi_salva);

    // Non era lo spiraglio del primo passo: ogni passo ne apre uno.
    for _ in 1..NOTE / 2 {
        job.passo().expect("la camminata prosegue");
    }
    assert!(
        ws.try_write().is_ok(),
        "il primo spiraglio c'era e a metà camminata no: il prestito non si \
         rilascia a ogni chiamata"
    );

    let mut ultimo = 0;
    while let Some(n) = job.passo() {
        ultimo = n;
    }
    assert_eq!(
        ultimo, NOTE,
        "la camminata non è arrivata in fondo: chi salva le è passato in mezzo, \
         non addosso"
    );
    job.finisci();

    // --- la colonna di controllo: un prestito solo, per tutta la camminata --
    // È la strada di prima, ed era l'unica che avesse il chiamante di un job.
    let sincrono = {
        let ws_prestito = ws.clone();
        passo_passo(move |via, fatto| {
            let w = ws_prestito.read().unwrap();
            let documenti = w.documents();
            for (letti, id) in documenti.iter().enumerate() {
                if via.recv().is_err() {
                    return;
                }
                let _ = w.read_model(id);
                if fatto.send(letti + 1).is_err() {
                    return;
                }
            }
        })
    };

    // Le stesse due domande della colonna sopra, nello stesso ordine e agli
    // stessi due punti: dopo la prima nota, e a metà camminata.
    assert_eq!(
        sincrono.passo(),
        Some(1),
        "anche di qua la camminata ha letto la prima nota"
    );
    assert!(
        ws.try_write().is_err(),
        "la colonna di controllo non sta più controllando niente: con un \
         prestito solo, tenuto per tutta la camminata, chi salva non può entrare \
         — e dopo una nota su {NOTE} è entrato. È cambiato il senso delle righe \
         qui sopra, non il loro risultato"
    );

    for _ in 1..NOTE / 2 {
        sincrono
            .passo()
            .expect("la camminata di controllo prosegue");
    }
    assert!(
        ws.try_write().is_err(),
        "e a metà camminata nemmeno: dove il prestito per chiamata apriva uno \
         spiraglio, il prestito unico non ne apre nessuno. Se questa riga è rossa \
         non lo tiene più per tutta la camminata, e le due colonne non si stanno \
         più confrontando"
    );
    sincrono.finisci();
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
fn un_job_che_scrive_su_una_base_vecchia_riceve_conflict() {
    let v = vault(3);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();
    let id = DocId::new("Nota 1.md");

    let mut job_host = JobHost::new(ws.clone(), INVENTARIO);
    let base = job_host
        .document_revision(&id)
        .expect("la revisione si legge");

    // L'utente salva mentre il job calcola.
    ws.write()
        .unwrap()
        .write_document(
            &id,
            "# Nota 1\n\nscritta dall'utente\n",
            WriteBase::Dictated,
        )
        .expect("il salvataggio riesce");

    let esito = job_host.apply_edit(
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
        matches!(esito, Err(PluginError::Conflict(_))),
        "un edit calcolato su una revisione superata è stato applicato lo stesso: \
         la guardia della decisione 0008 non arriva fino ai job, e allora il \
         lavoro lungo che scrive è lavoro lungo che sovrascrive"
    );
    assert_eq!(
        ws.read().unwrap().read_source(&id).unwrap(),
        "# Nota 1\n\nscritta dall'utente\n",
        "e ciò che l'utente aveva scritto è ancora lì"
    );
}
