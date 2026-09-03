//! Le tre proprietà che il `RwLock` del §8.3 compra, provate invece che dette.
//!
//! Il §8.3 chiedeva «`RwLock` sul `Workspace` con `render_view`/`query_index`/
//! `render_*` in prestito condiviso», e la sua prima riga era «misurare prima».
//! La misura sta in [`examples/contesa.rs`](../examples/contesa.rs) e non è un
//! test: dice dei numeri, e i numeri dipendono dalla macchina. Qui stanno le
//! **proprietà** che quei numeri hanno rivelato, ridotte a soglie che una
//! macchina lenta supera lo stesso — perché il modo di perderle non è un
//! rallentamento, è qualcuno che riscrive `read()` in `write()`.
//!
//! Il cambio si perde in silenzio: `write()` al posto di `read()` compila,
//! passa ogni test funzionale, e non si vede in nessuna diff che non sia
//! questa. È esattamente la forma del presidio di
//! `dependency_invariant.rs` — l'invariante che nessuno rompe apposta e che

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};
use fub_abi::custom::{SyntaxMatch, SyntaxProduct, SyntaxRule, SyntaxRuleSpec, SyntaxTrigger};
use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::format::ParseContext;
use fub_abi::model::DocId;
use fub_abi::traits::{
    CommandProvider, HostApi, PluginManifest, ReadApi, ServiceProvider, ViewInstance, ViewProvider,
    ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_features::{VersionStore, VersioningHandler, VERSIONING_ID};
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, Host, NoWatcher};
use fub_kernel::{FormatRegistry, Trust, Workspace};

/// Quanti lettori mettere in campo. Su una macchina a un core la
/// sovrapposizione vera è impossibile, e il test lo dice invece di fallire.
fn readers() -> usize {
    std::thread::available_parallelism().map_or(2, |n| n.get().clamp(2, 8))
}

/// Il banco di misura è uno solo, e **tutti** i test di questo file ci fanno il
/// turno.
///
/// libtest esegue in parallelo i test dello stesso binario, e uno solo di questi
/// quattro cronometra: `writer_does_not_block_readers_for_more_than_one_tick`
/// misura in millisecondi quanto ci mette un salvataggio a passare davanti ai
/// lettori. Ogni altro test di questo file apre un vault, lo indicizza e ci
/// lancia dentro dei thread — cioè **è** la macchina occupata di quella misura,
/// che di macchina occupata muore.
///
/// La regola è «tutti», e non «chi cronometra più i suoi vicini rumorosi»,
/// perché la seconda è un elenco che si dimentica: il turno mancava proprio
/// all'ultimo test aggiunto al file, che è il modo in cui questo elenco si
/// sbaglia sempre. Per chi non misura il turno costa il tempo degli altri tre e
/// non toglie niente, perché nessuno dei tre prova qualcosa che abbia bisogno di
static BENCH: Mutex<()> = Mutex::new(());

/// Prende il turno di banco, avvelenamento compreso.
///
/// Se il test precedente è panicato il `Mutex` resta avvelenato, e qui non
/// vuol dire niente: il dato protetto è `()`, non c'è nessuno stato invariante
/// che un panico possa aver lasciato a metà. L'unica cosa che il turno serializa
/// è il tempo, e il tempo non si corrompe. Ereditarlo e misurare è giusto:
/// l'alternativa sarebbe un secondo rosso che nasconde il primo.
fn bench_turn() -> MutexGuard<'static, ()> {
    BENCH
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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
            "# Note {the}\n\n#test\n\n## Section\n\nA text with repeated words, \
             long enough to cost a real parse. See [[Note {}]].\n",
            (the + 1) % notes.max(1)
        );
        std::fs::write(root.join(format!("Note {the}.md")), body).unwrap();
    }
    Vault { _dir: dir, root }
}

fn open(v: &Vault) -> Host {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("the vault opens");
    host
}

/// **La proprietà che dà il nome alla voce**: due letture del kernel possono
/// essere dentro il workspace *nello stesso momento*.
///
/// **Si costruisce, non si aspetta.** La forma di prima lanciava `readers()`
/// thread in duecento giri ciascuno e chiedeva che il massimo delle letture
/// contemporanee registrate arrivasse a due. Quel massimo è una **statistica**:
/// su una macchina occupata — e questo file la macchina se la occupa da solo,
/// perché gli altri test ci girano insieme — i thread possono entrare e uscire
/// uno per volta senza che il codice abbia niente di sbagliato, e il banco è
/// rosso per il tempo che ha trovato. Peggio del rosso è il verde: quando
/// passava aveva dimostrato che *stavolta* due letture si erano incrociate, non
/// che potessero.
///
/// [`Custody::try_read`] è la domanda giusta e non ha una macchina dentro:
/// «lo posso avere **adesso**?». Il prestito condiviso lo tiene questo thread,
/// un secondo lettore ne chiede un altro senza mettersi in fila. Il test usa
/// direttamente il workspace già reindicizzato, senza il `JobRunner` dell'host:
/// il suo giro di polling prende periodicamente il prestito esclusivo per
/// drenare la coda, e su `std::sync::RwLock` un writer accodato fa rispondere
/// `None` anche a un lettore condiviso. Qui non c'è quindi un writer estraneo
/// alla proprietà misurata; se il workspace tornasse a un prestito esclusivo —
/// un `Mutex` con un altro nome — il secondo lettore resterebbe `None`.
///
/// **L'indicizzazione si fa prima**, in modo sincrono, ed è la sola precauzione
/// che resta: il banco prova il prestito del workspace, non il protocollo del
/// runner.
#[test]
fn two_reads_can_be_in_the_workspace_at_the_same_time() {
    let _turn = bench_turn();
    let v = vault(4);
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("no extension conflict");
    let mut workspace = Workspace::new(&v.root, registry).expect("the vault opens");
    workspace.reindex().expect("indexing finishes");
    let ws = Custody::new("the open vault", workspace);
    let id = DocId::new("Note 0.md");

    // Il primo prestito, tenuto da qui fino in fondo.
    let first = ws.read().expect("the vault is not poisoned");
    first.render_preview(&id).expect("the first read reads");

    // Il secondo, chiesto **da un altro thread** mentre il primo è dentro. Il
    // thread non è un ornamento: un `try_read` chiesto dallo stesso thread che
    // tiene già il prestito non distingue un lucchetto condiviso da uno
    // rientrante, e risponderebbe di sì a tutti e due.
    let entered = {
        let (ws, id) = (ws.clone(), id.clone());
        std::thread::spawn(move || ws.try_read().map(|w| w.render_preview(&id).is_ok()))
            .join()
            .expect("the second reader finishes")
    };
    drop(first);

    assert!(
        entered.is_some(),
        "a second read could not enter the workspace while the first held it: \
         the borrow is not shared. If there is a `write()` where §8.3 asks for \
         a `read()`, the workspace went back to being a `Mutex` with a different \
         name."
    );
    assert_eq!(
        entered,
        Some(true),
        "the second read entered but did not read: entering the workspace \
         together serves to read inside it together."
    );
}

/// **La contropartita, ed è la ragione vera del cambio.**
///
/// Con il `Mutex`, chi salva competeva con i lettori sullo *stesso* prestito
/// esclusivo, e i lettori in ciclo stretto lo scavalcavano: il banco di misura
/// ha visto un salvataggio aspettare **23 secondi**. Con il `RwLock` chi scrive
/// si mette in coda e i lettori nuovi si fermano dietro di lui.
///
/// Ciò che si misura è l'**attesa mediana** di venti salvataggi, non quante
/// scritture passano: in debug e su un vault piccolo passano comunque tutte, ed
/// è per questo che un test sul conteggio sarebbe un falso presidio —
/// passerebbe anche col prestito esclusivo. La separazione sta invece tutta
/// nell'attesa, ed è di tre-quattro ordini di grandezza: da 147 ms a 2,2 s con
/// `write()`, contro 0,2–0,3 ms con `read()`, in ogni taglia di vault provata.
/// La soglia sotto è a 50 ms: 150× sopra ciò che il caso buono misura, 3× sotto
/// il *migliore* dei casi cattivi.
///
/// **Che questo valga dipende da `std`, non da noi**, e va detto: la
/// documentazione di `RwLock` dichiara la politica di priorità dipendente dal
/// sistema operativo e non promette che chi aspetta di scrivere blocchi i
/// lettori nuovi. Su Linux (futex) lo fa. Il giorno che questo test diventasse
/// rosso su una piattaforma, non sarebbe una fiacchezza del test: sarebbe
/// quella piattaforma che dice di non avere la proprietà, e a quel punto la
/// coda equa va scritta da noi.
///
/// **Si guarda la mediana perché il massimo era la statistica sbagliata**, e
/// non perché la soglia sia stata alzata per far tacere il test: la soglia è
/// rimasta a 50 ms, con la taratura di prima — 150× il caso buono, 3× sotto il
/// migliore dei cattivi — intatta. Ciò che è cambiato è quale dei venti
/// campioni si legge, non dove sta l'asticella. Il massimo di venti è, per
/// definizione, il campione più esposto al vicino di banco: basta che
/// *un* lettore venga prelazionato mentre tiene il prestito condiviso perché
/// quel singolo giro incassi un quanto di scheduler intero — su Windows sono
/// 15–30 ms — e la CI ha misurato 101 ms contro i 50 della soglia con sotto il
/// codice giusto, per poi tornare verde al rilancio successivo senza che
/// nessuno avesse toccato niente.
///
/// E quel campione non porta segnale che gli altri non abbiano già: la firma
/// del prestito esclusivo non è *un* giro lento, sono **tutti** i giri lenti.
/// Sotto il `Mutex` che il §8.3 ha tolto ogni salvataggio viene scavalcato da
/// ogni lettore in ciclo stretto, quindi ogni giro aspetta e la mediana sale
/// insieme al massimo — anzi, prima, perché non ha bisogno che il caso peggiore
/// si presenti. Leggere la mediana rinuncia solo alla sensibilità a ciò che non
/// stiamo misurando. Il peggiore resta nel messaggio di fallimento: serve a
/// capire un rosso, non a produrlo.
///
/// Per la stessa ragione i lettori sono `readers()` e non il doppio. Su un
/// runner a quattro core, otto thread in ciclo stretto non aumentano la contesa
/// sul lock — quella satura molto prima — e aggiungono solo thread pronti che
#[test]
fn writer_does_not_block_readers_for_more_than_one_tick() {
    let _turn = bench_turn();
    let v = vault(120);
    let host = open(&v);
    let ws = host.debug_workspace(None).unwrap();

    let stop = Arc::new(AtomicBool::new(false));
    let handles: Vec<_> = (0..readers())
        .map(|t| {
            let (ws, stop) = (ws.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut the = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let w = ws.read().unwrap();
                    let _ = w.render_preview(&DocId::new(format!("Note {}.md", the % 120)));
                    the += 1;
                }
            })
        })
        .collect();

    // I lettori entrano in regime prima che il salvataggio provi a passare.
    std::thread::sleep(Duration::from_millis(150));

    // Si tengono tutte e venti: il verdetto vuole la mediana, il messaggio di
    // fallimento vuole il peggiore, e nessuno dei due si ricava dall'altro.
    let mut waits = Vec::with_capacity(20);
    for pass in 0..20 {
        let t = Instant::now();
        let mut w = ws.write().unwrap();
        waits.push(t.elapsed());
        w.write_document(
            &DocId::new("Note 0.md"),
            &format!("# Note 0\n\nround {pass}\n"),
            WriteBase::Dictated,
        )
        .expect("the save succeeds");
        drop(w);
    }
    stop.store(true, Ordering::Relaxed);
    for h in handles {
        h.join().unwrap();
    }

    waits.sort_unstable();
    let median = waits[waits.len() / 2];
    let worst = *waits.last().expect("twenty rounds, twenty waits");

    assert!(
        median < Duration::from_millis(50),
        "the median wait of a save behind readers is {median:?} \
         (worst of the twenty rounds: {worst:?}). With the shared borrow \
         the measured wait is fractions of a millisecond; tens or hundreds of \
         milliseconds *per pass* are the signature of the exclusive borrow, \
         i.e. of the `Mutex` that §8.3 removed."
    );
}

/// **La quarta, e non era nei tre punti della voce: rileggere una versione è
/// una lettura.**
///
/// `Host::read_version` prendeva il prestito **esclusivo** — non perché servisse
/// a qualcosa, ma perché l'unica strada per arrivare a un host era
/// `Workspace::with_host`, che vuole `&mut`. Una cronologia aperta su una nota
/// grande fermava chi salva per il tempo di una lettura da disco, cioè
/// esattamente il difetto che la 0024 ha misurato e comprato via.
///
/// **Niente cronometro, e niente attesa nel caso buono**: il prestito condiviso
/// lo tiene questo thread, e il lettore ne chiede un altro. Il test usa il
/// `VersionStore` già montato ma chiama direttamente la sua lettura con un
/// secondo `Workspace` read-guard: così il JobRunner dell'host non può mettere
/// un writer estraneo in coda davanti alla proprietà che si sta provando.
/// La scrittura viene poi avviata mentre la prima read è ancora detenuta e si
/// completa appena quella guardia viene rilasciata.
#[test]
fn rereading_a_version_does_not_block_writers() {
    // Il turno di banco vale anche per chi non cronometra: questo test apre un
    // vault e ne indicizza il contenuto, cioè *è* la macchina occupata di
    // quello che cronometra — che di macchina occupata muore.
    let _turn = bench_turn();
    let v = vault(3);
    let mut workspace = {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("no extension conflict");
        Workspace::new(&v.root, registry).expect("the vault opens")
    };
    // La scansione è sincrona e il montaggio del versioning è esplicito: nel
    // test non c'è un `JobRunner` che possa mettere un writer estraneo in coda.
    workspace.reindex().expect("indexing finishes");
    workspace
        .register_core_feature(VERSIONING_ID, "Versioning")
        .expect("versioning registers");
    let store = workspace.with_host(VERSIONING_ID, VersionStore::open);
    let store = store.expect("versioning opens");
    workspace
        .register_event_handler(
            VERSIONING_ID,
            Box::new(VersioningHandler::new(store.clone())),
        )
        .expect("versioning handler registers");
    let id = DocId::new("Note 0.md");
    // Si semina una versione senza il percorso Host: la prova resta sul
    // prestito condiviso di Workspace e sul reader del VersionStore.
    workspace.with_host(VERSIONING_ID, |host| {
        store
            .snapshot(&id, "# Note 0\n\noriginal\n", host)
            .expect("the seed version is stored");
    });
    let ts = store.list(&id).first().expect("the seed version exists").ts;
    let ws = Custody::new("the open vault", workspace);

    {
        let mut ws = ws.write().expect("the vault is not poisoned");
        ws.write_document(&id, "# Note 0\n\nchanged\n", WriteBase::Dictated)
            .expect("the first write succeeds");
    }

    // Il prestito condiviso, tenuto: da qui in poi chi legge è dentro.
    let inside = ws.read().expect("the vault is not poisoned");

    let (senders, responses) = std::sync::mpsc::channel();
    let reader = {
        let (ws, id, store) = (ws.clone(), id.clone(), store.clone());
        std::thread::spawn(move || {
            let result = {
                let shared = ws.read().expect("the vault is not poisoned");
                shared.with_read_host(VERSIONING_ID, |host| store.read(&id, ts, host))
            };
            let _ = senders.send(result);
        })
    };
    let response = responses.recv_timeout(Duration::from_secs(10));

    let writer = {
        let ws = ws.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            let mut ws = ws.write().expect("the vault is not poisoned");
            ws.write_document(&id, "# Note 0\n\nwriter\n", WriteBase::Dictated)
                .expect("the writer succeeds after the read")
        })
    };
    drop(inside);
    reader.join().expect("the reader finishes");
    writer.join().expect("the writer finishes");

    let source = response
        .expect(
            "re-reading a version did not enter the workspace while another \
             read held it: a read that blocks another read is the defect that \
             0024 removed",
        )
        .expect("the version re-reads");
    assert!(
        source.starts_with("# Note 0"),
        "and it is not an empty read: {source:?}"
    );
    let ws = ws.read().expect("the vault is not poisoned");
    assert_eq!(
        ws.read_source(&id).expect("the write is visible"),
        "# Note 0\n\nwriter\n"
    );
}

const LOCK_PROBE: &str = "audit.lock-probe";

/// Un comando che prima **rientra** su una capacità di lettura e poi resta
/// dentro `invoke` finché il test non gli dà il via. Il fermo rende osservabile
/// il punto esatto in cui la callback è attiva senza usare tempo/scheduler.
struct LockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl CommandProvider for LockProbe {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(LOCK_PROBE, "Lock probe").with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        // Questa lettura deve riacquisire la Custody dal proxy: è la prova che
        // uscire dal lock non ha tolto al provider le sue capacità.
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "re-entry read returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("probe was not released".into()))?;
        Ok(CommandOutcome::done())
    }
}

const NESTED_LOCK_PROBE: &str = "audit.nested-lock-probe";

struct NestedLockProbe;

impl CommandProvider for NestedLockProbe {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(NESTED_LOCK_PROBE, "Nested lock probe")
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        host.run_command(LOCK_PROBE, serde_json::Value::Null)?;
        Ok(CommandOutcome::done())
    }
}

/// `ARCH-001`: il codice di un provider **non** gira mentre è detenuto il
/// `Custody<Workspace>`. Il test fallisce con il vecchio `write_workspace`:
/// mentre `LockProbe::invoke` è fermo, `try_read()` risponde `None`.
#[test]
fn a_command_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature("fub.audit-lock-probe", "Audit lock probe")
            .expect("probe declares");
        w.register_command_provider(
            "fub.audit-lock-probe",
            Box::new(LockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("probe registers");
    }

    // L'invocazione possiede l'Host; al thread principale basta la Custody già
    // estratta. Così il test non dipende dal fatto che `Host` sia `Sync`.
    let call = std::thread::spawn(move || {
        host.invoke_user_command(None, LOCK_PROBE, serde_json::Value::Null, InvokeMode::Apply)
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("provider entered after a successful host re-entry");

    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    // Liberare prima degli assert evita di lasciare un thread appeso anche nel
    // caso regressivo, in cui `reader_progressed` è false.
    release_tx.send(()).expect("release provider");
    let outcome = call.join().expect("command thread does not panic");

    assert!(
        reader_progressed,
        "a reader could not enter while CommandProvider::invoke was active: \
         the provider is still running under Custody<Workspace>"
    );
    outcome.expect("the provider keeps working through its per-capability host");
}

/// Anche il **secondo** provider di una macro deve essere staccato: il primo
/// è già fuori lock, ma `JobHost::run_command` prima rientrava con `write()` e
/// teneva la guardia per tutta la callback interna.
#[test]
fn a_nested_command_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature("fub.audit-lock-probe", "Audit lock probe")
            .expect("inner declares");
        w.register_command_provider(
            "fub.audit-lock-probe",
            Box::new(LockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("inner registers");
        w.register_core_feature("fub.audit-nested-probe", "Audit nested probe")
            .expect("outer declares");
        w.register_command_provider("fub.audit-nested-probe", Box::new(NestedLockProbe))
            .expect("outer registers");
    }

    let call = std::thread::spawn(move || {
        host.invoke_user_command(
            None,
            NESTED_LOCK_PROBE,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("inner provider entered through HostApi::run_command");
    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    release_tx.send(()).expect("release inner provider");
    let outcome = call.join().expect("command thread does not panic");

    assert!(
        reader_progressed,
        "HostApi::run_command held Custody<Workspace> across the nested provider"
    );
    outcome.expect("nested provider completes through the detached host");
}

const SERVICE_LOCK_PROBE: &str = "fub.audit-service";
const SERVICE_CALLER: &str = "fub.audit-service-caller.run";

struct ServiceLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl ServiceProvider for ServiceLockProbe {
    fn call(
        &self,
        _service: &str,
        _method: &str,
        _args: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "service re-entry read returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("service probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("service probe was not released".into()))?;
        Ok(serde_json::Value::String("ok".into()))
    }
}

struct ServiceCaller;

impl CommandProvider for ServiceCaller {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(SERVICE_CALLER, "Service caller")
            .with_scope(CommandScope::writing(CommandReach::Session))]
    }

    fn invoke(
        &self,
        _: &str,
        _: serde_json::Value,
        _: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let answer = host.call_service(SERVICE_LOCK_PROBE, "probe", serde_json::Value::Null)?;
        if answer != serde_json::Value::String("ok".into()) {
            return Err(PluginError::Internal(
                "service returned the wrong answer".into(),
            ));
        }
        Ok(CommandOutcome::done())
    }
}

/// `ServiceProvider::call` deve essere staccato anche quando vi si arriva da
/// una capacità annidata di un comando. Il provider è fermo *dopo* una vera
/// re-entry sul vault: in quel punto un reader estraneo deve ancora avanzare.
#[test]
fn a_service_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_plugin(
            PluginManifest::core(SERVICE_LOCK_PROBE, "Audit service")
                .providing(&[SERVICE_LOCK_PROBE]),
            Trust::Core,
        )
        .expect("service declares");
        w.register_service_provider(
            SERVICE_LOCK_PROBE,
            Box::new(ServiceLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("service registers");
        w.register_core_feature("fub.audit-service-caller", "Audit service caller")
            .expect("caller declares");
        w.register_command_provider("fub.audit-service-caller", Box::new(ServiceCaller))
            .expect("caller registers");
    }

    let call = std::thread::spawn(move || {
        host.invoke_user_command(
            None,
            SERVICE_CALLER,
            serde_json::Value::Null,
            InvokeMode::Apply,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("service entered after a successful host re-entry");
    let reader_progressed = {
        let ws = ws.clone();
        std::thread::spawn(move || ws.try_read().is_some())
            .join()
            .expect("reader probe finishes")
    };
    release_tx.send(()).expect("release service provider");
    let outcome = call.join().expect("command thread does not panic");

    assert!(
        reader_progressed,
        "HostApi::call_service held Custody<Workspace> across ServiceProvider::call"
    );
    outcome.expect("service provider completes through its per-capability host");
}

const BEFORE_WRITE_LOCK_PLUGIN: &str = "fub.audit-before-write";

#[test]
fn the_before_write_hook_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    host.wait_indexed(None)
        .expect("initial indexing finishes before the before-write probe");
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let release_rx = Mutex::new(release_rx);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(BEFORE_WRITE_LOCK_PLUGIN, "Audit detached before-write")
            .expect("hook owner declares");
        w.set_before_write_hook(Some((
            BEFORE_WRITE_LOCK_PLUGIN.to_string(),
            Arc::new(move |host, id| {
                let old = host.read_document(id)?;
                if !old.contains("Note 0") {
                    return Err(PluginError::Internal(
                        "before-write re-entry returned the wrong note".into(),
                    ));
                }
                entered_tx.send(()).map_err(|_| {
                    PluginError::Internal("before-write probe receiver disappeared".into())
                })?;
                release_rx
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .recv_timeout(Duration::from_secs(10))
                    .map_err(|_| {
                        PluginError::Internal("before-write probe was not released".into())
                    })?;
                Ok(())
            }),
        )));
    }

    let (outcome_tx, outcome_rx) = std::sync::mpsc::sync_channel(1);
    let call = std::thread::spawn(move || {
        let outcome = host.write_document(
            None,
            &DocId::new("Note 0.md"),
            "# Note 0\nchanged by before-write probe\n",
            WriteBase::Dictated,
        );
        let _ = outcome_tx.send(outcome);
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("before-write hook entered after a real HostApi read");
    let reader_progressed = ws.try_read().is_some();
    let writer_progressed = ws.try_write().is_some();
    release_tx.send(()).expect("release before-write hook");
    let outcome = outcome_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the write returns after the before-write hook is released");
    call.join()
        .expect("the write thread finishes after delivering its outcome");

    assert!(
        reader_progressed,
        "Host::write_document held a write-lock across the before-write hook"
    );
    assert!(
        writer_progressed,
        "Host::write_document held a read-lock across the before-write hook"
    );
    outcome.expect("write completes after detached before-write hook");
}

#[test]
fn a_before_write_error_aborts_the_write_and_the_next_write_still_works() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    host.wait_indexed(None)
        .expect("initial indexing finishes before the before-write error probe");
    let ws = host.debug_workspace(None).expect("debug custody");
    let first = Arc::new(AtomicBool::new(true));
    {
        let mut workspace = ws.write().expect("the vault is alive");
        workspace
            .register_core_feature(BEFORE_WRITE_LOCK_PLUGIN, "Audit detached before-write")
            .expect("hook owner declares");
        workspace.set_before_write_hook(Some((
            BEFORE_WRITE_LOCK_PLUGIN.to_string(),
            {
                let first = Arc::clone(&first);
                Arc::new(move |_host, _id| {
                    if first.swap(false, Ordering::SeqCst) {
                        Err(PluginError::BadArgs(
                            "errore intenzionale del before-write".into(),
                        ))
                    } else {
                        Ok(())
                    }
                })
            },
        )));
    }

    let original = host
        .read_document(None, &DocId::new("Note 0.md"))
        .expect("the original document is readable")
        .0;
    let failed = host.write_document(
        None,
        &DocId::new("Note 0.md"),
        "# Note 0\nshould not be written\n",
        WriteBase::Dictated,
    );
    let read_after_error = ws.try_read().is_some();
    let write_after_error = ws.try_write().is_some();
    let source_after_error = host
        .read_document(None, &DocId::new("Note 0.md"))
        .expect("the document remains readable")
        .0;

    let recovered = host.write_document(
        None,
        &DocId::new("Note 0.md"),
        "# Note 0\nwritten after the hook error\n",
        WriteBase::Dictated,
    );
    let read_after_recovery = ws.try_read().is_some();
    let write_after_recovery = ws.try_write().is_some();

    assert!(
        matches!(&failed, Err(PluginError::BadArgs(_))),
        "the before-write error did not propagate through the write: {failed:?}"
    );
    assert_eq!(
        source_after_error,
        original,
        "a rejected before-write partially finalized the document"
    );
    assert!(
        read_after_error && write_after_error,
        "a before-write error left a workspace guard held"
    );
    recovered.expect("the next write succeeds after the hook recovers");
    assert!(
        read_after_recovery && write_after_recovery,
        "the recovered before-write left the workspace unusable"
    );
}

const PARSE_LOCK_PLUGIN: &str = "com.fub.auditparse";

struct ParseLockRule {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl SyntaxRule for ParseLockRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: format!("{PARSE_LOCK_PLUGIN}:lock"),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["audit-lock".into()],
            },
            order: 0,
            option: None,
            produces: vec![format!("{PARSE_LOCK_PLUGIN}:block")],
        }
    }

    fn apply(
        &self,
        _: &SyntaxMatch,
        _: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        self.entered
            .send(())
            .map_err(|_| FormatError::Parse("parse probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| FormatError::Parse("parse probe was not released".into()))?;
        Ok(None)
    }
}

#[test]
fn a_syntax_rule_during_host_write_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_plugin(
            PluginManifest::new(PARSE_LOCK_PLUGIN, "Audit detached parse"),
            Trust::Community,
        )
        .expect("parse probe plugin registers");
        w.register_syntax_rule(
            PARSE_LOCK_PLUGIN,
            Box::new(ParseLockRule {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("parse probe rule registers");
    }

    let call = std::thread::spawn(move || {
        host.write_document(
            None,
            &DocId::new("ParseProbe.md"),
            "```audit-lock\npayload\n```\n",
            WriteBase::Dictated,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("syntax rule entered during the Host write");
    let (reader_tx, reader_rx) = std::sync::mpsc::sync_channel(1);
    let reader = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let acquired = ws.read().is_ok();
            let _ = reader_tx.send(acquired);
        })
    };
    let reader_progressed = reader_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false);
    release_tx.send(()).expect("release syntax rule");
    reader.join().expect("reader probe finishes");
    let outcome = call.join().expect("write thread does not panic");

    assert!(
        reader_progressed,
        "Host::write_document held Custody<Workspace> across the parse callbacks"
    );
    outcome.expect("write completes after the detached parse");
}

const VIEW_RENDER_LOCK_PLUGIN: &str = "fub.audit-view-render";
const VIEW_RENDER_LOCK_VIEW: &str = "audit-view-render";

struct ViewRenderLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl ViewProvider for ViewRenderLockProbe {
    fn interests(&self, instance: &ViewInstance) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|spec| spec.id == instance.view)
            .map(|spec| fub_abi::traits::ViewInterests {
                refresh: spec.refresh,
                follows: spec.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: VIEW_RENDER_LOCK_VIEW.into(),
            title: "Audit detached render".into(),
            surface: ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }]
    }

    fn render_view(&self, _: &ViewInstance, host: &dyn ReadApi) -> Result<UiNode, PluginError> {
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "view render re-entry returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("view render probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("view render probe was not released".into()))?;
        Ok(UiNode::text("ok"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        unreachable!()
    }
}

#[test]
fn a_view_render_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(VIEW_RENDER_LOCK_PLUGIN, "Audit view render")
            .expect("view declares");
        w.register_view_provider(
            VIEW_RENDER_LOCK_PLUGIN,
            Box::new(ViewRenderLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("view registers");
    }

    let call = std::thread::spawn(move || {
        host.render_view(None, &ViewInstance::only(VIEW_RENDER_LOCK_VIEW))
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("view entered after a successful ReadApi re-entry");
    let (writer_tx, writer_rx) = std::sync::mpsc::sync_channel(1);
    let writer = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let acquired = ws.write().is_ok();
            let _ = writer_tx.send(acquired);
        })
    };
    let writer_progressed = writer_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false);
    release_tx.send(()).expect("release view provider");
    writer.join().expect("writer probe finishes");
    let outcome = call.join().expect("render thread does not panic");

    assert!(
        writer_progressed,
        "Host::render_view held Custody<Workspace> across ViewProvider::render_view"
    );
    outcome.expect("view render completes through its per-capability read host");
}

const VIEW_ACTION_LOCK_PLUGIN: &str = "fub.audit-view-action";
const VIEW_ACTION_LOCK_VIEW: &str = "audit-view-action";

struct ViewActionLockProbe {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl ViewProvider for ViewActionLockProbe {
    fn interests(&self, _: &ViewInstance) -> fub_abi::traits::ViewInterests {
        fub_abi::traits::ViewInterests::default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: VIEW_ACTION_LOCK_VIEW.into(),
            title: "Audit detached action".into(),
            surface: ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }]
    }

    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("action probe"))
    }

    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        let source = host.read_document(&DocId::new("Note 0.md"))?;
        if !source.contains("Note 0") {
            return Err(PluginError::Internal(
                "view action re-entry returned the wrong note".into(),
            ));
        }
        self.entered
            .send(())
            .map_err(|_| PluginError::Internal("view action probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| PluginError::Internal("view action probe was not released".into()))?;
        Ok(ViewUpdate::None)
    }
}

#[test]
fn a_view_action_provider_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(VIEW_ACTION_LOCK_PLUGIN, "Audit view action")
            .expect("view declares");
        w.register_view_provider(
            VIEW_ACTION_LOCK_PLUGIN,
            Box::new(ViewActionLockProbe {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("view registers");
    }

    let call = std::thread::spawn(move || {
        host.view_action(
            None,
            &ViewInstance::only(VIEW_ACTION_LOCK_VIEW),
            UiAction::new("probe"),
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("view action entered after a successful HostApi re-entry");
    let (reader_tx, reader_rx) = std::sync::mpsc::sync_channel(1);
    let reader = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let acquired = ws.read().is_ok();
            let _ = reader_tx.send(acquired);
        })
    };
    let reader_progressed = reader_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false);
    release_tx.send(()).expect("release view action provider");
    reader.join().expect("reader probe finishes");
    let outcome = call.join().expect("view action thread does not panic");

    assert!(
        reader_progressed,
        "Host::view_action held Custody<Workspace> across ViewProvider::on_action"
    );
    assert_eq!(
        outcome.expect("view action completes through its per-capability host"),
        ViewUpdate::None
    );
}

/// Una view che pania mentre disegna.
struct Explodes;

impl ViewProvider for Explodes {
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: "esplode".into(),
            title: "Esplode".into(),
            surface: ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }]
    }
    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        panic!("the provider exploded while drawing");
    }
    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn fub_abi::HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        unreachable!()
    }
}

/// **Il terzo effetto, e non era nei tre punti della voce.** Un `Mutex` si
/// avvelena quando chi lo tiene pania: con il workspace dietro un `Mutex`, una
/// view che esplodeva *mentre disegnava* rendeva il vault irraggiungibile a
/// ogni chiamata successiva — `.unwrap()` su un lock avvelenato è un panico, e
/// i panici erano ventidue, uno per comando.
///
/// Un `RwLock` si avvelena **solo** se a paniare è chi tiene il prestito
/// esclusivo (`std::sync::RwLock`: «may only be poisoned if a panic occurs
/// while it is locked exclusively»). Disegnare è una lettura, quindi il caso
/// più probabile — e l'unico che un provider di terzi produrrà davvero, perché
/// disegnare è ciò che un provider fa più spesso — smette di portarsi via il
/// vault.
///
/// **E adesso non attraversa più nemmeno il chiamante** (§9.3,
/// decisione 0032). Questa prova diceva l'opposto: «il panico attraversa ancora
/// chi ha chiamato, e quello che cambia è che si porta via *quella chiamata*
/// invece del vault». Era la metà che la 0024 poteva comprare da sola; l'altra
/// metà è la rete al confine, che traduce il panico in un `PluginError` che
/// **nomina** il colpevole. Ciò che la 0024 ha comprato resta e non è
/// ridondante: la rete si può bucare — la prova qui sotto la buca apposta da un
#[test]
fn a_view_that_panics_while_drawing_does_not_poison_the_vault() {
    // Il turno di banco vale anche per chi non misura, e questo test è quello
    // che se lo era dimenticato: apre un vault, lo indicizza e ci lancia dentro
    // un thread che pania, tutto mentre l'unico test che cronometra di questo
    // file misura dei millisecondi.
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).unwrap();
    {
        // Prima si dichiara, poi si registra: il kernel non presta capacità a
        // una stringa (§7.3, decisione 0021).
        let mut w = ws.write().unwrap();
        w.register_core_feature("fub.esplode", "Esplode")
            .expect("declared");
        w.register_view_provider("fub.esplode", Box::new(Explodes))
            .expect("registered");
    }

    // Il panico non esce più dal kernel: torna come errore, e dice di chi è.
    // Il panico non esce più dal kernel: torna come errore, e dice di chi è.
    let outcome = ws
        .read()
        .unwrap()
        .render_view(&ViewInstance::only("esplode"));
    let error = outcome.expect_err("a panicking view does not yield a tree");
    assert!(
        error.to_string().contains("fub.esplode")
            && error.to_string().contains("è andato in panico"),
        "the error must name who exploded: {error}"
    );

    // E se qualcuno lo bucasse, la seconda rete regge: un panico su un prestito
    // **condiviso** non avvelena. Il thread serve solo a non far morire il test.
    // **condiviso** non avvelena. Il thread serve solo a non far morire il test.
    let paniced = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let w = ws.read().unwrap();
            let _ = w.views();
            panic!("someone panics while holding the shared borrow");
        })
        .join()
    };
    assert!(paniced.is_err(), "the thread was supposed to panic");

    // E il vault risponde ancora — in lettura e in scrittura.
    assert!(
        ws.read()
            .unwrap()
            .read_source(&DocId::new("Note 0.md"))
            .is_ok(),
        "the lock is poisoned: a provider that panics while drawing took the vault with it"
    );
    ws.write()
        .unwrap()
        .write_document(
            &DocId::new("Note 0.md"),
            "# Note 0\n\nafter the panic\n",
            WriteBase::Dictated,
        )
        .expect("writing still works");
}
