//! **Il costo del passaggio, misurato invece che detto.**
//!
//! La [0164](../../../docs/decisions/0164-il-secondo-backend-una-interfaccia-alla-volta.md)
//! si chiude su un buco dichiarato: «il numero accanto ai 275 KB» non c'è, e
//! «dire un numero non misurato sarebbe peggio che non averlo». Questo file è
//! il modo di riempirlo. Misura lo **stesso** ping nelle sue due incarnazioni —
//! la `struct` Rust di `crates/fub-host/tests/il_primo_plugin.rs` e il
//! componente di `esempi/ping-wasm` — sullo stesso banco, con lo stesso id
//! `demo.ping`, lo stesso job `ping` e lo stesso `read_document` di là dal
//! confine, montati tutt'e due dalla stessa porta `Bundle`.
//!
//! Che il codice di misura sia **uno solo** per i due backend non è economia di
//! righe: è la stessa cosa che il §16.1 promette, vista dal lato del
//! cronometro. Da `misura()` in giù non c'è un ramo che sappia dire quale dei
//! due ha in mano — riceve un `&dyn Bundle` e basta.
//!
//! # Perché un `example` e non un `#[test]`
//!
//! **Perché una soglia temporale in CI è un test che lampeggia.** Un `assert!`
//! su un microsecondo non misura il confine: misura il vicino di rack, il turbo
//! del processore e quanti altri lavori stava già facendo la macchina. Un test
//! così fallisce per ragioni che non riguardano il codice, e un test che
//! fallisce per ragioni che non riguardano il codice viene disattivato dopo la
//! terza volta — portandosi via anche il presidio che serviva davvero. Qui il
//! numero si stampa e lo legge una persona, che sa in che stanza si trova e con
//! quale profilo ha compilato. Il presidio del **comportamento** resta dov'era,
//! in `tests/il_primo_componente.rs`: quello dice che il passaggio funziona,
//! questo dice quanto costa, e sono due mestieri diversi.
//!
//! # Come si esegue
//!
//! ```text
//! cargo run --release -p fub-wasm-host --example il-costo-del-passaggio
//! ```
//!
//! `--release` non è un dettaglio: in debug wasmtime interpreta un cranelift
//! non ottimizzato e il kernel gira senza inline, e il rapporto fra i due
//! numeri non racconta niente di ciò che un utente vedrebbe. Se l'esempio si
//! accorge di essere in debug, lo dice in testa e non lo nasconde.
//!
//! # La disciplina della misura
//!
//! - **Ogni giro è cronometrato da sé**, e si tengono tutte le durate. La media
//!   di un blocco diviso per `n` nasconde la coda, e la coda è ciò che si vede
//!   in un'interfaccia; la mediana è il caso tipico che non si lascia spostare
//!   da un giro sfortunato. Si stampano tutt'e due, più il minimo e il 95°
//!   percentile per la riga che conta di più.
//! - **C'è uno scaldamento**, e non è compreso nelle durate: la prima chiamata
//!   a un'istanza WASM paga pagine di memoria mai toccate e rami mai predetti,
//!   e misurare quella al posto delle mille dopo sarebbe raccontare l'avvio
//!   spacciandolo per il regime.
//! - **Il job fa quasi niente di suo** — legge una nota di sette caratteri e li
//!   conta. È deliberato: ciò che si vuole isolare è il *confine*, e un job che
//!   macinasse per un millisecondo lo seppellirebbe sotto il proprio lavoro. Il
//!   numero che esce è quindi il **peggior caso possibile** per il backend
//!   WASM, ed è l'unico modo di leggerlo.
//! - **Le ripetizioni sono dichiarate** in `RIPETIZIONI_*`, e si stampano
//!   accanto a ogni riga: un numero senza il proprio `n` non è una misura.
//!
//! # Cosa non misura
//!
//! Dichiarato per intero, perché nessuna di queste assenze venga scambiata per
//! un numero che manca per svista.
//!
//! - **Un payload grande.** Il job passa `null` e riceve una settantina di
//!   byte. Ciò che attraversa il confine si copia, e una copia grande è un
//!   costo che cresce col dato: questo numero è l'intercetta, non la pendenza.
//! - **`CommandProvider`.** Non attraversa ancora il confine (0164, «cosa resta
//!   fuori»), quindi non c'è niente da cronometrare — e per non far pagare al
//!   nativo un montaggio più ricco, anche il bundle nativo di qui registra
//!   zero provider.
//! - **Più istanze insieme.** Un solo componente, un solo thread di job. Il
//!   `Mutex` di `WasmPlugin` mette in fila due chiamate sulla stessa istanza, e
//!   quanto costi quella fila è una misura sua, che si farà quando ci sarà un
//!   secondo componente da mettere in fila.

use std::hint::black_box;
use std::sync::Arc;
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::event::Event;
use fub_abi::model::DocId;
use fub_abi::options::permission;
use fub_abi::traits::{HostApi, JobSpec, Plugin, PluginManifest, PluginPermissions};
use fub_abi::PluginError;
use fub_host::registry::Bundle;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust, Workspace};
use fub_wasm_host::{Component, WasmBundle};

/// L'id che i due backend si contendono. È **lo stesso** di proposito: due
/// bundle con lo stesso id non stanno mai nella stessa sessione, e ognuno dei
/// due gira sul proprio banco appena costruito.
const ID: &str = "demo.ping";

/// Quante volte si attraversa il confine per la misura che conta. Mille è il
/// numero oltre il quale la mediana smette di muoversi fra due esecuzioni su
/// questa macchina; sotto le poche centinaia si legge ancora il rumore.
const REPEATS_JOB: usize = 1000;
/// Quanti montaggi (istanza + `activate` + inventario) e altrettanti smontaggi.
/// Meno del job perché un montaggio costa già di suo, e duecento bastano.
const REPEATS_MOUNT: usize = 200;
/// Quante volte si ricarica il bundle da zero. Nove, ed è un numero dispari
/// apposta: la mediana è allora un giro davvero osservato. È un costo che si
/// paga una volta all'avvio, ma sono anche nove compilazioni vere, e non se ne
/// fanno mille per gentilezza verso chi esegue. Se la riga «di cui compilare»
/// esce **più grande** del caricamento che la contiene, il numero non è del
/// codice: è della macchina, che stava facendo altro. Si rilegge a macchina
/// ferma.
const REPEATS_LOAD: usize = 9;
/// Quanti giri interi dal pool: accodare un job e aspettare il suo `JobDone`.
/// È la riga che dice **da che punto in poi il confine non conta più**, e ogni
/// giro coinvolge un risveglio di thread: duecento sono già lunghi da fare.
const POOL_REPETITIONS: usize = 200;
/// I giri buttati prima di far partire il cronometro, per ogni misura ripetuta.
const WARMUP: usize = 50;

/// Il numero della [0146](../../../docs/decisions/0146-il-contratto-attraversa-il-confine.md):
/// il varco — un componente che implementa il contratto **intero** e non fa
/// niente — pesa tanto, in release. È l'unico numero di questo file che non è
/// stato misurato qui, ed è citato con la sua fonte proprio per questo.
const GATE_0146: u64 = 275_073;

// ---------------------------------------------------------------------------
// La statistica
// ---------------------------------------------------------------------------

/// Le durate di una misura ripetuta, **già ordinate**.
///
/// Ordinate all'ingresso e non a ogni domanda: mediana e percentile sono due
/// letture della stessa lista, e ordinarla due volte sarebbe pagare due volte
/// per la stessa cosa.
struct Sample {
    durations: Vec<Duration>,
}

impl Sample {
    fn new(mut durations: Vec<Duration>) -> Self {
        assert!(!durations.is_empty(), "an empty sample has no median");
        durations.sort_unstable();
        Sample { durations }
    }

    fn rounds(&self) -> usize {
        self.durations.len()
    }

    /// Il caso tipico. Su un numero pari di giri si prende il maggiore dei due
    /// centrali invece di mediarli: mediare due durate produce un numero che
    /// nessun giro ha mai impiegato, e qui si preferisce un valore osservato.
    fn median(&self) -> Duration {
        self.durations[self.durations.len() / 2]
    }

    fn mean(&self) -> Duration {
        let sum: Duration = self.durations.iter().sum();
        sum / self.durations.len() as u32
    }

    fn minimum(&self) -> Duration {
        self.durations[0]
    }

    /// Il 95°: uno su venti va peggio di così. È la coda, cioè la parte che una
    /// media non racconta.
    fn p95(&self) -> Duration {
        let the = (self.durations.len() as f64 * 0.95) as usize;
        self.durations[the.min(self.durations.len() - 1)]
    }
}

/// Cronometra `n` giri di `f`, uno per uno, dopo `warmup` giri buttati.
///
/// Lo scaldamento è un parametro e non la costante: cinquanta giri a vuoto
/// costano niente su una chiamata di microsecondi e sono cinquanta
/// **compilazioni** su un caricamento, cioè minuti buttati per scaldare una
/// cosa che si fa una volta sola nella vita di un processo.
fn sample(n: usize, warmup: usize, mut f: impl FnMut()) -> Sample {
    for _ in 0..warmup {
        f();
    }
    let mut durations = Vec::with_capacity(n);
    for _ in 0..n {
        let start = Instant::now();
        f();
        durations.push(start.elapsed());
    }
    Sample::new(durations)
}

// ---------------------------------------------------------------------------
// Il banco: lo stesso dei due test, in una funzione sola
// ---------------------------------------------------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    chars: usize,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        let text = "# Nota\n";
        std::fs::write(root.join("Nota.md"), text).expect("la nota si scrive");
        Vault {
            _dir: dir,
            root,
            chars: text.chars().count(),
        }
    }
}

/// Accoda un job come lo accoderebbe una feature: dall'`HostApi`, e basta.
fn ask(host: &Host, job: &str) {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("accodato");
    })
    .expect("aperto");
}

/// Il primo `JobDone` che arriva, o il panico di chi aspettava.
fn status(events: &Subscription) -> Result<serde_json::Value, PluginError> {
    let expiration = Instant::now() + Duration::from_secs(10);
    while Instant::now() < expiration {
        if let Ok(notice) = events.recv_timeout(Duration::from_millis(200)) {
            if let Event::JobDone { result, .. } = notice.event {
                return result;
            }
        }
    }
    panic!("nessun job è mai tornato: la coda non la drena nessuno");
}

// ---------------------------------------------------------------------------
// Il ping nativo: lo stesso di `il_primo_plugin.rs`, riga per riga
// ---------------------------------------------------------------------------

/// Il plugin nativo, **ridotto a ciò che il componente sa fare**.
///
/// Una differenza sola rispetto a `il_primo_plugin.rs`, e va dichiarata perché
/// altrimenti il confronto sarebbe truccato: qui `run_job` non chiama
/// `report_progress`. La famiglia `host-events` non è linkata nel backend WASM
/// (lo scrive la 0164 fra ciò che resta fuori), quindi il componente non ha
/// modo di raccontarsi — e lasciare quella riga di qua vorrebbe dire far pagare
/// al nativo un lavoro che al WASM non si chiede. Tutto il resto è identico:
/// stesso permesso, stesso `read_document`, stesso conteggio di caratteri,
/// stesso JSON con dentro l'istante dell'attivazione.
struct PingNativo {
    /// L'istante in cui `activate` ha guardato l'orologio: il diario del plugin
    /// nativo nell'unica forma che attraversa un confine, cioè un numero.
    on: u64,
}

impl Plugin for PingNativo {
    fn manifest(&self) -> PluginManifest {
        manifest_native()
    }

    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.on = host.now_unix_millis();
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        _payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match job {
            "ping" => {
                let text = host.read_document(&DocId::new("Nota.md"))?;
                Ok(serde_json::json!({
                    "nota": "Nota.md",
                    "caratteri": text.chars().count(),
                    "acceso": self.on,
                }))
            }
            other => Err(PluginError::UnknownJob(other.into())),
        }
    }
}

fn manifest_native() -> PluginManifest {
    PluginManifest::new(ID, "Demo Ping (native)")
        .granting(PluginPermissions::of(&[permission::READ_VAULT]))
}

/// Il bundle nativo. **Non c'è niente da caricare**: il codice del plugin è già
/// dentro questo eseguibile, compilato una volta da `cargo`, e «caricare» qui
/// vuol dire costruire una `struct`. È esattamente la riga che il confronto
/// deve rendere visibile, non un difetto della misura.
struct NativeBundle;

impl Bundle for NativeBundle {
    fn manifest(&self) -> PluginManifest {
        manifest_native()
    }

    fn trust(&self) -> Trust {
        Trust::Community
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(PingNativo { on: 0 })
    }

    fn register(&self, _ws: &mut Workspace) -> Vec<String> {
        // Vuoto come quello del `WasmBundle`: il quarto passo del montaggio non
        // attraversa ancora il confine, e registrare un `CommandProvider` di
        // qua e non di là renderebbe i due montaggi due cose diverse.
        Vec::new()
    }
}

// ---------------------------------------------------------------------------
// Il componente
// ---------------------------------------------------------------------------

/// Compila `esempi/ping-wasm` per `wasm32-wasip2` e restituisce il `.wasm`.
///
/// Lo compila da sé, come fa il test, invece di cercare un artefatto che
/// qualcun altro dovrebbe aver prodotto: un numero misurato su un `.wasm`
/// vecchio di tre commit è peggio di nessun numero. La `--target-dir` è **sua**
/// e non quella dei test: le tre varianti dell'esempio condividono un solo
/// `ping_wasm.wasm`, e due `cargo` con feature diverse sulla stessa cartella si
/// sovrascriverebbero l'artefatto a vicenda. Qui serve solo la variante base.
fn build_component() -> Utf8PathBuf {
    let root = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = root.join("target/tmp/ping-wasm-misura");

    eprintln!("compiling the component (first time takes about a minute)…");
    let status = std::process::Command::new(option_env!("CARGO").unwrap_or("cargo"))
        .arg("build")
        .arg("--release")
        .arg("--target")
        .arg("wasm32-wasip2")
        .arg("--manifest-path")
        .arg(root.join("esempi/ping-wasm/Cargo.toml"))
        .arg("--target-dir")
        .arg(&output)
        .output()
        .expect("cargo si esegue");
    assert!(
        status.status.success(),
        "the example component does not compile.\n\
         If the target is missing: `rustup target add wasm32-wasip2`.\n{}",
        String::from_utf8_lossy(&status.stderr)
    );

    let wasm = output.join("wasm32-wasip2/release/ping_wasm.wasm");
    assert!(wasm.exists(), "the compiled component is not at {wasm}");
    wasm
}

// ---------------------------------------------------------------------------
// La misura, uguale per i due backend
// ---------------------------------------------------------------------------

/// Ciò che si è misurato su un backend. Nessun campo dice **quale**: da qui in
/// giù i due sono indistinguibili, ed è il punto del §16.1 visto col cronometro
/// in mano.
struct Measures {
    /// Costruire il bundle: per il nativo una `struct`, per il WASM
    /// compilazione più il manifest chiesto all'istanza che poi si butta.
    loading: Sample,
    /// La sola compilazione, senza chiedere al componente chi è. Il nativo non
    /// ha niente di corrispondente: la sua compilazione è già avvenuta.
    compilation: Option<Sample>,
    /// Montare: istanziare, attivare, entrare nell'inventario del §7.6.
    mount: Sample,
    /// `run_job` chiamato al confine, senza pool di mezzo.
    job: Sample,
    /// Lo stesso job dal pool: accodare e aspettare il `JobDone`.
    pool: Sample,
    /// La risposta del job, per provare che i due hanno fatto lo stesso lavoro.
    answer: serde_json::Value,
}

/// Il giro intero su un backend: apre un banco, monta, misura, chiude.
///
/// `carica` è ciò che ricostruisce il bundle da zero — per il nativo è una
/// `struct`, per il WASM è `WasmBundle::da_file`. Sta come chiusura e non come
/// valore perché il caricamento è **una delle misure**, e va rifatto.
fn measure_backend(bundle: &dyn Bundle, mut load: impl FnMut()) -> Measures {
    let v = Vault::new();
    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    // La seconda fase dell'apertura è un job come gli altri, e su un banco a un
    // thread solo occuperebbe l'unico turno: si aspetta che abbia finito prima
    // di cronometrare qualunque cosa.
    host.wait_indexed(None).expect("l'apertura ha finito");
    let events = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");

    // 1. Caricare. Fuori dalla sessione: non tocca né workspace né registry.
    //    Un giro solo di scaldamento, che serve a togliere di mezzo la prima
    //    lettura del file dal disco — il resto è compilazione vera e non si
    //    scalda.
    let loading = sample(REPEATS_LOAD, 1, &mut load);

    // 2. Montare, e restare montati per le due misure che vengono dopo.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(bundle, &mut ws)
            .expect("il bundle si monta");
    })
    .expect("aperto");

    // 3. Il confine nudo: `run_job` chiamato dal corpo che il registry
    //    possiede, con l'`HostApi` che il kernel presta — le stesse due cose
    //    che il runner del §9.3 tiene in mano quando esegue un job vero, senza
    //    la coda e senza il risveglio di thread in mezzo. Il prestito dell'host
    //    sta **fuori** dal ciclo: dentro ci resta solo la chiamata.
    let (job, answer) = host
        .with_session(None, |s| {
            let mut ws = s.workspace().write().unwrap();
            let body: Arc<dyn Plugin> = s
                .bundles()
                .read()
                .unwrap()
                .body(ID)
                .expect("il bundle è montato");
            ws.with_host(ID, |h| {
                let answer = body
                    .run_job("ping", serde_json::json!(null), h)
                    .expect("il ping risponde");
                let sample = sample(REPEATS_JOB, WARMUP, || {
                    let status = body.run_job("ping", serde_json::json!(null), h);
                    black_box(status).expect("il ping risponde");
                });
                (sample, answer)
            })
        })
        .expect("aperto");

    // 4. Lo stesso job dalla porta da cui arriva davvero: accodato e atteso.
    //    È la riga che dice quanto pesa il confine **in proporzione a ciò che
    //    lo circonda**, cioè la sola proporzione che un utente sperimenta.
    let pool = {
        // Dieci giri di scaldamento e non cinquanta: qui ogni giro sveglia un
        // thread, e ciò che si scalda — la coda, il pool, l'istanza — è già
        // caldo dopo pochissimi.
        for _ in 0..10 {
            ask(&host, "ping");
            status(&events).expect("il ping risponde");
        }
        let mut durations = Vec::with_capacity(POOL_REPETITIONS);
        for _ in 0..POOL_REPETITIONS {
            let start = Instant::now();
            ask(&host, "ping");
            let answer = status(&events);
            durations.push(start.elapsed());
            black_box(answer).expect("il ping risponde");
        }
        Sample::new(durations)
    };

    // 5. Montare e smontare, a ripetizione. Solo il montaggio è cronometrato:
    //    lo smontaggio è la pulizia che serve a poter rimontare, non la misura.
    let mount = host
        .with_session(None, |s| {
            let mut ws = s.workspace().write().unwrap();
            let mut reg = s.bundles().write().unwrap();
            let errors = reg.unmount(&mut ws, ID);
            assert!(errors.is_empty(), "lo smount è pulito: {errors:?}");

            let mut durations = Vec::with_capacity(REPEATS_MOUNT);
            for round in 0..REPEATS_MOUNT + WARMUP {
                let start = Instant::now();
                reg.mount(bundle, &mut ws).expect("il bundle si monta");
                let elapsed = start.elapsed();
                if round >= WARMUP {
                    durations.push(elapsed);
                }
                let errors = reg.unmount(&mut ws, ID);
                assert!(errors.is_empty(), "lo smount è pulito: {errors:?}");
            }
            Sample::new(durations)
        })
        .expect("aperto");

    host.close();

    assert_eq!(
        answer["caratteri"].as_u64().unwrap() as usize,
        v.chars,
        "il job ha letto la nota vera: {answer:?}"
    );

    Measures {
        loading,
        compilation: None,
        mount,
        job,
        pool,
        answer,
    }
}

// ---------------------------------------------------------------------------
// La stampa
// ---------------------------------------------------------------------------

/// Una durata con l'unità che le sta bene e quattro cifre significative.
fn fmt_time(d: Duration) -> String {
    let ns = d.as_secs_f64() * 1e9;
    let (value, unit) = if ns < 1_000.0 {
        (ns, "ns")
    } else if ns < 1_000_000.0 {
        (ns / 1e3, "µs")
    } else if ns < 1_000_000_000.0 {
        (ns / 1e6, "ms")
    } else {
        (ns / 1e9, "s")
    };
    let decimals = if value < 10.0 {
        2
    } else if value < 100.0 {
        1
    } else {
        0
    };
    format!("{value:.decimals$} {unit}")
}

/// Un numero di byte a gruppi di tre, come si scrivono in italiano.
fn byte(n: u64) -> String {
    let digits = n.to_string();
    let mut outside = String::new();
    for (the, c) in digits.chars().enumerate() {
        if the > 0 && (digits.len() - the).is_multiple_of(3) {
            outside.push(' ');
        }
        outside.push(c);
    }
    outside
}

/// Quante volte il secondo è più lento del primo.
fn ratio(native: Duration, wasm: Duration) -> String {
    let n = native.as_secs_f64();
    if n <= 0.0 {
        return "—".to_string();
    }
    let r = wasm.as_secs_f64() / n;
    if r >= 100.0 {
        format!("{r:.0}×")
    } else if r >= 10.0 {
        format!("{r:.1}×")
    } else {
        format!("{r:.2}×")
    }
}

/// La macchina su cui questi numeri valgono. Un numero senza la propria
/// macchina è un numero che qualcuno confronterà con la sua.
fn machine() -> String {
    let cpu = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|text| {
            text
                .lines()
                .find(|row| row.starts_with("model name"))
                .and_then(|row| row.split_once(':'))
                .map(|(_, value)| value.trim().to_string())
        })
        .unwrap_or_else(|| "processore sconosciuto".to_string());
    let parallelism = std::thread::available_parallelism()
        .map(|n| n.get().to_string())
        .unwrap_or_else(|_| "?".to_string());
    format!(
        "{cpu} · {parallelism} thread · {}/{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

/// La larghezza della tabella grande: due di rientro, trenta di etichetta,
/// cinque di giri, quattro colonne da tredici e dieci di rapporto.
const WIDTH: usize = 99;

/// Una riga della tabella. **I giri li dice il campione**, non una costante
/// ripetuta a mano accanto alla chiamata: un `n` scritto due volte è un `n` che
/// prima o poi mente.
fn row(label: &str, native: Option<&Sample>, wasm: Option<&Sample>) {
    let empty = "—".to_string();
    let (n_med, n_avg) = native.map_or((empty.clone(), empty.clone()), |c| {
        (fmt_time(c.median()), fmt_time(c.mean()))
    });
    let (w_med, w_avg) = wasm.map_or((empty.clone(), empty.clone()), |c| {
        (fmt_time(c.median()), fmt_time(c.mean()))
    });
    let rap = match (native, wasm) {
        (Some(n), Some(w)) => ratio(n.median(), w.median()),
        _ => empty,
    };
    let rounds = native.or(wasm).map(Sample::rounds).unwrap_or(0);
    println!("  {label:<30}{rounds:>5}{n_med:>13}{n_avg:>13}{w_med:>13}{w_avg:>13}{rap:>10}");
}

fn main() {
    let wasm = build_component();
    let size = std::fs::metadata(&wasm).expect("il .wasm si legge").len();

    println!();
    println!("{:═^WIDTH$}", " il costo del passaggio ");
    println!();
    println!("  {:<12}{}", "macchina", machine());
    println!(
        "  {:<12}{}",
        "profilo",
        if cfg!(debug_assertions) {
            "DEBUG — questi numeri non valgono niente: rieseguire con `--release`"
        } else {
            "--release"
        }
    );
    println!(
        "  {:<12}un vault temporaneo con una nota sola, host headless, un thread di job,",
        "banco"
    );
    println!(
        "  {:<12}lo stesso id `demo.ping` e lo stesso job `ping` per tutt'e due i backend",
        ""
    );
    println!(
        "  {:<12}{WARMUP} giri buttati prima di ogni cronometro (uno solo per il loading:",
        "scaldamento"
    );
    println!(
        "  {:<12}cinquanta compilazioni per scaldare non le paga nessuno)",
        ""
    );
    println!();

    // Le due righe che dicono quale backend è sotto il cronometro stanno **qui**
    // e non dentro `misura`: quella funzione non ha un nome da stampare, e
    // dargliene uno vorrebbe dire darle anche il primo ramo che distingue i due.
    // Vanno su `stderr`, che è dove sta ciò che non è il risultato.
    eprintln!("misuro il ping native…");
    let native = measure_backend(&NativeBundle, || {
        black_box(NativeBundle);
    });

    eprintln!("misuro il ping WASM…");
    let mut wasm_measures = measure_backend(
        &WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica"),
        || {
            let b = WasmBundle::from_file(&wasm, Trust::Community).expect("il componente si carica");
            black_box(b);
        },
    );
    // La compilazione **da sola**, cioè senza l'istanza che `WasmBundle::da_file`
    // fabbrica e butta per chiedere al componente chi è. La differenza fra le
    // due righe è il prezzo di quella domanda, e vale la pena vederlo separato:
    // è l'unico pezzo del caricamento che si potrebbe evitare mettendo il
    // manifest in un file accanto — cioè tornando al modello che il §16.1 ha
    // scartato, dove ciò che un plugin dichiara e ciò che è possono divergere.
    wasm_measures.compilation = Some(sample(REPEATS_LOAD, 1, || {
        let c = Component::from_file(&wasm).expect("il componente si compila");
        black_box(c);
    }));

    println!(
        "  {:<30}{:>5}{:>13}{:>13}{:>13}{:>13}{:>10}",
        "misura", "giri", "native med.", "native media", "WASM med.", "WASM media", "rapporto"
    );
    println!("  {}", "─".repeat(WIDTH - 2));
    row(
        "caricare il bundle",
        Some(&native.loading),
        Some(&wasm_measures.loading),
    );
    row(
        "  di cui compilare il .wasm",
        None,
        wasm_measures.compilation.as_ref(),
    );
    row(
        "montare (istanza + activate)",
        Some(&native.mount),
        Some(&wasm_measures.mount),
    );
    row(
        "run_job \"ping\" al confine",
        Some(&native.job),
        Some(&wasm_measures.job),
    );
    row(
        "lo stesso job, dal pool",
        Some(&native.pool),
        Some(&wasm_measures.pool),
    );
    println!();
    println!(
        "  * «caricare il bundle» per il native vuol dire costruire una `struct`: il codice del"
    );
    println!(
        "    plugin sta già dentro questo eseguibile, compilato una volta da `cargo`. Quel numero"
    );
    println!(
        "    è il fondo dello strumento e non un costo, e il rapporto della prima riga confronta"
    );
    println!("    due cose diverse — che è esattamente ciò che ha da dire.");
    println!();

    // La coda della riga che conta: una mediana da sola non dice se il caso
    // brutto è vicino o lontano, e il caso brutto è ciò che si nota.
    println!("  la dispersione di `run_job` al confine ({REPEATS_JOB} giri)");
    println!("  {}", "─".repeat(82));
    println!(
        "  {:<30}{:>13}{:>13}{:>13}{:>13}",
        "", "minimo", "mediana", "media", "p95"
    );
    for (name, c) in [("native", &native.job), ("WASM", &wasm_measures.job)] {
        println!(
            "  {name:<30}{:>13}{:>13}{:>13}{:>13}",
            fmt_time(c.minimum()),
            fmt_time(c.median()),
            fmt_time(c.mean()),
            fmt_time(c.p95())
        );
    }
    println!();

    println!("  il size del componente");
    println!("  {}", "─".repeat(71));
    println!(
        "  {:<52}{:>14} byte",
        "il ping di `esempi/ping-wasm` (release, strip)",
        byte(size)
    );
    println!(
        "  {:<52}{:>14} byte",
        "il varco della 0146: il contratto intero, a vuoto",
        byte(GATE_0146)
    );
    println!(
        "  {:<52}{:>14}",
        "quanto il ping pesa rispetto al varco",
        format!("{:.0}%", size as f64 / GATE_0146 as f64 * 100.0)
    );
    println!();

    // Ciò che il numero dice, calcolato dai numeri appena stampati e da niente
    // altro. Non è un commento: se il rapporto cambia, cambiano anche queste
    // righe, perché sono la stessa misura detta in italiano.
    let surcharge = wasm_measures
        .job
        .median()
        .saturating_sub(native.job.median());
    let one_percent_threshold = surcharge * 100;
    let quota_in_the_pool = surcharge.as_secs_f64() / wasm_measures.pool.median().as_secs_f64();
    let chars = native.answer["caratteri"].as_u64().unwrap_or(0);
    println!("{:═^WIDTH$}", " cosa dicono ");
    println!();
    println!(
        "  Il confine costa {} in più per chiamata, su un job che di lavoro vero ne fa",
        fmt_time(surcharge)
    );
    println!(
        "  quasi niente: legge una nota di {chars} caratteri e li conta. È il peggior caso"
    );
    println!("  possibile per il backend WASM, ed è l'unico modo di leggere quel numero.");
    println!(
        "  Il sovrapprezzo è quasi fisso, quindi si diluisce: un job che duri più di {}",
        fmt_time(one_percent_threshold)
    );
    println!("  paga il passaggio meno dell'un percento del proprio tempo.");
    println!("  Nello stesso giro visto dal pool — accodare, svegliare un thread, tornare —");
    println!(
        "  quel sovrapprezzo è il {:.1}% del totale: la coda costa già più del confine, e",
        quota_in_the_pool * 100.0
    );
    println!("  da lì in poi chi paga non è più wasmtime.");
    println!();
    println!("  Le due risposte, per non lasciare dubbi che sia lo stesso lavoro:");
    println!("    native  {}", native.answer);
    println!("    WASM    {}", wasm_measures.answer);
    println!();
}
