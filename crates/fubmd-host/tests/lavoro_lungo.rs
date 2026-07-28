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

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, RwLock};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fubmd_abi::edit::{EditRequest, TextEdit};
use fubmd_abi::model::{DocId, Span};
use fubmd_abi::traits::{HostApi, Plugin, PluginManifest, VaultRead, VaultWrite};
use fubmd_abi::PluginError;
use fubmd_host::{Host, JobHost, NoWatcher};
use fubmd_kernel::Workspace;

const INVENTARIO: &str = "fubmd.inventario";

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

/// **Dove era arrivata la camminata** quando un salvataggio che l'ha trovata in
/// corso è finalmente entrato — e, per chi legge il messaggio di un fallimento,
/// quanto ha aspettato l'orologio.
///
/// È la misura del §8.3, riusata qui perché la domanda è la stessa vista da
/// un'altra parte: là si chiedeva se una lettura facesse aspettare chi salva,
/// qui se lo faccia un lavoro lungo.
///
/// Un salvataggio solo, e non un ciclo: il ciclo misurerebbe anche la contesa
/// dei salvataggi fra loro, che non è ciò di cui si discute qui, e costerebbe al
/// banco un indice ricommittato mille volte. La `camminata` riceve la barriera e
/// la sblocca **quando è partita** — è quel momento a definire l'intervallo, e
/// una `sleep` al suo posto misurerebbe la macchina invece della proprietà.
///
/// Il contatore lo incrementa chi cammina, **dopo** ogni lettura; chi salva lo
/// legge quando ha ottenuto il prestito esclusivo, cioè quando l'altro è per
/// forza fermo. Che possa sbagliare di un documento — l'incremento sta appena
/// fuori dalla lettura — non tocca nessuna delle due asserzioni, che distinguono
/// «durante» da «alla fine».
struct Ingresso {
    /// Quante note la camminata aveva letto quando chi salva è entrato.
    letti: usize,
    /// Quanto ha aspettato. Non ci si asserisce sopra — vedi
    /// [`mentre_un_job_cammina_il_vault_chi_salva_non_aspetta`] — ma è ciò che
    /// rende leggibile un fallimento.
    atteso: Duration,
}

fn ingresso_di_chi_salva(
    ws: &Arc<RwLock<Workspace>>,
    camminata: impl FnOnce(&Barrier, &AtomicUsize),
) -> Ingresso {
    let via = Arc::new(Barrier::new(2));
    let letti = Arc::new(AtomicUsize::new(0));
    let salvatore = {
        let (ws, via, letti) = (ws.clone(), via.clone(), letti.clone());
        std::thread::spawn(move || {
            via.wait();
            let t = Instant::now();
            let mut w = ws.write().unwrap();
            let ingresso = Ingresso {
                letti: letti.load(Ordering::SeqCst),
                atteso: t.elapsed(),
            };
            w.write_document(&DocId::new("Nota 0.md"), "# Nota 0\n\nsalvata\n")
                .expect("il salvataggio riesce");
            ingresso
        })
    };
    camminata(&via, &letti);
    salvatore.join().expect("il thread di chi salva non pania")
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
/// Ciò che si asserisce è **dove chi salva riesce a entrare**: durante la
/// camminata da una parte, solo alla sua fine dall'altra. E non quanto aspetta.
///
/// La differenza non è cosmetica, ed è costata una CI rossa. La prima stesura
/// chiedeva un **rapporto** fra i due tempi — dieci a uno — ragionando che una
/// macchina lenta allunga entrambe le colonne e lascia intatta la distanza. È
/// vero della velocità della macchina e falso di ciò che decide davvero questa
/// attesa, che è **come il sistema operativo arbitra un `RwLock`**. Su Linux chi
/// salva entra in poche centinaia di nanosecondi: il futex mette in coda chi
/// scrive e i lettori che arrivano dopo non lo scavalcano, e il rapporto misurato
/// è nell'ordine delle diecimila volte. Su macOS chi legge può rientrare mentre
/// chi scrive è in coda, e la stessa riga ha misurato 3,46 ms su 10,5 ms di
/// camminata: rapporto tre, e rosso — con il codice giusto sotto.
///
/// Un test che cade per una proprietà del lock di sistema non sta guardando ciò
/// per cui esiste. Quello che il `JobHost` decide è **quando il prestito viene
/// rilasciato**: per chiamata, o una volta sola per tutto il job. Chi salva
/// entrerà nel primo spiraglio che quella scelta apre — al primo se il sistema
/// accoda chi scrive, dopo cinquanta se lo lascia affamare — ma *uno spiraglio
/// esiste*, e con il prestito unico non ne esiste nessuno fino alla fine. Quello
/// è il confine netto, vale su ogni sistema e a ogni velocità, e cade
/// esattamente sul difetto che questa voce esisteva per togliere.
#[test]
fn mentre_un_job_cammina_il_vault_chi_salva_non_aspetta() {
    const NOTE: usize = 150;
    let v = vault(NOTE);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();

    let con_job = {
        let ws_job = ws.clone();
        ingresso_di_chi_salva(&ws, |via, letti| {
            let job_host = JobHost::new(ws_job, INVENTARIO);
            let documenti = job_host.list_documents(None).unwrap().items;
            via.wait();
            for id in &documenti {
                let _ = job_host.read_model(id);
                letti.fetch_add(1, Ordering::SeqCst);
            }
        })
    };

    let nel_giro_sincrono = {
        let ws_prestito = ws.clone();
        ingresso_di_chi_salva(&ws, |via, letti| {
            // Un prestito solo, tenuto per tutta la camminata: è la strada di
            // prima, ed era l'unica che avesse il chiamante di un job.
            let w = ws_prestito.read().unwrap();
            let documenti = w.documents();
            via.wait();
            for id in &documenti {
                let _ = w.read_model(id);
                letti.fetch_add(1, Ordering::SeqCst);
            }
        })
    };

    assert!(
        con_job.letti < NOTE,
        "chi salva è entrato dopo {} note su {NOTE} — cioè a camminata finita, \
         avendo aspettato {:?}: il `JobHost` tiene il prestito per la durata del \
         job invece che per quella di una chiamata, ed è il difetto che la voce \
         esisteva per togliere",
        con_job.letti,
        con_job.atteso
    );
    assert_eq!(
        nel_giro_sincrono.letti, NOTE,
        "la colonna di controllo non sta più controllando niente: con un prestito \
         solo, tenuto per tutta la camminata, chi salva non può entrare prima \
         della fine — se ci è entrato dopo {} note su {NOTE} (attesa {:?}), è \
         cambiato il senso della riga qui sopra, non il risultato",
        nel_giro_sincrono.letti, nel_giro_sincrono.atteso
    );
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
        .write_document(&id, "# Nota 1\n\nscritta dall'utente\n")
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
