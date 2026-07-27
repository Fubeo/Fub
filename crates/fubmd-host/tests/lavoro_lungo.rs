//! Le tre proprietà del lavoro lungo che vede il vault (§9.1, decisione 0027).
//!
//! La voce diceva una cosa sola: `Plugin::run_job` non aveva l'`HostApi`,
//! quindi l'unico modo di dare input a un job era che il **chiamante** leggesse
//! il vault dentro il giro sincrono — cioè facesse lì, in esclusiva sul
//! workspace, esattamente il lavoro che il job doveva togliere da lì. Qui sta
//! ciò che la firma nuova compra, provato invece che detto:
//!
//! 1. un job **cammina** il vault e ci **scrive**, dal proprio thread;
//! 2. mentre cammina, **chi salva non aspetta** — ed è il confronto con la
//!    strada di prima a dirlo, nella stessa corsa e sullo stesso vault;
//! 3. se il vault cambia mentre il job calcola, la guardia che se ne accorge è
//!    quella di tutti: la `base` della decisione 0008, e `Conflict`.

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
            altro => Err(PluginError::UnknownJob(altro.to_string())),
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
    host.workspace()
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
    let ws = host.workspace().unwrap();

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
    let mut job_host = JobHost::new(host.workspace().unwrap(), INVENTARIO);
    assert!(matches!(
        Inventario.run_job("altro", serde_json::json!({}), &mut job_host),
        Err(PluginError::UnknownJob(j)) if j == "altro"
    ));
}

/// Quanto aspetta **un** salvataggio che arriva mentre `camminata` gira.
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
fn attesa_di_chi_salva(ws: &Arc<RwLock<Workspace>>, camminata: impl FnOnce(&Barrier)) -> Duration {
    let via = Arc::new(Barrier::new(2));
    let salvatore = {
        let (ws, via) = (ws.clone(), via.clone());
        std::thread::spawn(move || {
            via.wait();
            let t = Instant::now();
            let mut w = ws.write().unwrap();
            let atteso = t.elapsed();
            w.write_document(&DocId::new("Nota 0.md"), "# Nota 0\n\nsalvata\n")
                .expect("il salvataggio riesce");
            atteso
        })
    };
    camminata(&via);
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
/// Il confronto è un **rapporto** e non una soglia in millisecondi: le due
/// colonne girano sulla stessa macchina nella stessa corsa, quindi una macchina
/// lenta le allunga tutte e due. Ciò che non si allunga è la distanza — chi
/// salva aspetta *una* lettura da una parte, *tutte* dall'altra.
#[test]
fn mentre_un_job_cammina_il_vault_chi_salva_non_aspetta() {
    let v = vault(150);
    let host = aperto(&v);
    let ws = host.workspace().unwrap();

    let con_job = {
        let ws_job = ws.clone();
        attesa_di_chi_salva(&ws, |via| {
            let job_host = JobHost::new(ws_job, INVENTARIO);
            let documenti = job_host.list_documents(None).unwrap().items;
            via.wait();
            for id in &documenti {
                let _ = job_host.read_model(id);
            }
        })
    };

    let nel_giro_sincrono = {
        let ws_prestito = ws.clone();
        attesa_di_chi_salva(&ws, |via| {
            // Un prestito solo, tenuto per tutta la camminata: è la strada di
            // prima, ed era l'unica che avesse il chiamante di un job.
            let w = ws_prestito.read().unwrap();
            let documenti = w.documents();
            via.wait();
            for id in &documenti {
                let _ = w.read_model(id);
            }
        })
    };

    assert!(
        con_job * 10 < nel_giro_sincrono,
        "chi salva ha aspettato {con_job:?} mentre il job camminava il vault, \
         contro {nel_giro_sincrono:?} con la camminata dentro un prestito solo: \
         le due strade costano ormai lo stesso, cioè il `JobHost` tiene il \
         prestito per la durata del job invece che per quella di una chiamata — \
         ed è il difetto che la voce esisteva per togliere"
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
    let ws = host.workspace().unwrap();
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
