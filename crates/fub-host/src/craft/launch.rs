//! L'avvio delle app Craft, con argomenti separati e mai attraverso una shell.
//!
//! Due modi soli, scritti una volta:
//!
//! - [`spawn_detached`] avvia un'app («Apri con») e la lascia vivere da sola:
//!   stdin, stdout e stderr chiusi, un gruppo di processi suo (su Windows
//!   staccata dalla console di Fub), così chiudere Fub non la chiude. Un
//!   thread `fub-craft-wait` aspetta l'uscita, perché non resti uno zombie, e
//!   la segna nel registro che [`on_exit`] e [`running`] leggono.
//! - [`run_cli`] avvia la riga di comando di un'app e la aspetta, con un tempo
//!   e un peso massimi ([`CliLimits`]): stdout e stderr si leggono da due
//!   thread con un tetto ciascuno, il resto si scarta senza bloccare il
//!   processo; ogni ~100 ms si guardano l'annullamento e il tempo, e allo
//!   scadere si uccide l'intero gruppo e si aspetta che esca. Il gruppo è un
//!   gruppo di processi su unix e un job object su Windows (`job::Job`).
//!
//! Il programma è un percorso assoluto, mai cercato nel `PATH`; gli argomenti
//! arrivano al programma così come sono, senza `sh -c` né `cmd /c`, quindi
//! spazi, virgolette, `;` o `$(…)` non vogliono dire niente. L'ambiente è
//! quello di Fub meno le variabili che cominciano con `FUB_`: un'app non deve
//! trovare un token di Fub. Gli errori ([`LaunchError`]) non hanno testo: lo
//! mettono i chiamanti con le chiavi del loro catalogo.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

/// Il tempo massimo di una CLI (sezione «I limiti» del piano N7).
pub const CLI_TIME: Duration = Duration::from_secs(20);
/// Quanto si tiene di stdout e di stderr di una CLI, ciascuno.
pub const CLI_STREAM: usize = 64 * 1024;
/// Ogni quanto, al più, il job guarda l'annullamento e il tempo.
const POLL_MAX: Duration = Duration::from_millis(100);
/// Il primo sguardo: una CLI veloce non aspetta un giro intero.
const POLL_MIN: Duration = Duration::from_millis(5);
/// Quanto si aspettano i lettori dopo l'uscita del processo. Su unix il
/// gruppo è già stato fermato, quindi i tubi si chiudono subito; il tetto
/// serve solo per chi è scappato dal gruppo e tiene aperto un tubo.
const DRAIN_GRACE: Duration = Duration::from_secs(2);
/// Le uscite già segnate che il registro tiene prima di sfoltirle.
const EXITED_KEPT: usize = 256;

/// Perché un avvio non è andato. Nessun testo: i chiamanti (T10, T11) lo
/// traducono con le chiavi del loro catalogo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchError {
    /// Il programma non c'è (o non è un percorso assoluto, o manca
    /// l'interprete che il suo `#!` nomina).
    NotFound,
    /// Il programma c'è ma non si può eseguire (senza il bit di esecuzione,
    /// una cartella, un permesso negato).
    Denied,
    /// La CLI ha superato [`CliLimits::time`]: è stata fermata.
    TimedOut,
    /// Il job è stato annullato: la CLI è stata fermata, o non è partita.
    Cancelled,
    /// La CLI è uscita con un codice diverso da zero. Su unix un processo
    /// chiuso da un segnale che non ha mandato Fub vale `-segnale`.
    Failed(i32),
    /// Un altro errore del sistema (troppi processi, un tubo che non si apre).
    Io,
}

/// Il tempo e il peso massimi di una CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CliLimits {
    /// Dopo questo tempo la CLI si ferma e l'esito è [`LaunchError::TimedOut`].
    pub time: Duration,
    /// I byte tenuti di stdout e di stderr, ciascuno; il resto si scarta.
    pub stream: usize,
}

impl Default for CliLimits {
    fn default() -> Self {
        CliLimits {
            time: CLI_TIME,
            stream: CLI_STREAM,
        }
    }
}

/// L'esito di una CLI uscita con zero.
#[derive(Debug)]
pub struct CliOutput {
    pub status: ExitStatus,
    /// Al più [`CliLimits::stream`] byte, i primi.
    pub stdout: Vec<u8>,
    /// Al più [`CliLimits::stream`] byte, i primi.
    pub stderr: Vec<u8>,
}

/// Avvia `program` con `args` e lo lascia vivere da solo; torna subito col
/// pid. L'uscita arriva al registro ([`on_exit`], [`running`]).
pub fn spawn_detached(program: &Path, args: &[OsString]) -> Result<u32, LaunchError> {
    let mut command = base_command(program, args, std::env::vars_os())?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    let mut child = command.spawn().map_err(spawn_error)?;
    let pid = child.id();
    // Il registro sa del pid prima che il thread possa segnarne l'uscita.
    exits().started(pid);
    let waiter = thread::Builder::new()
        .name("fub-craft-wait".into())
        .spawn(move || {
            let _ = child.wait();
            exits().finished(pid);
        });
    match waiter {
        Ok(_) => Ok(pid),
        Err(_) => {
            // Senza un thread nessuno aspetta il processo: il `Child` è caduto
            // con la chiusura, l'app resta viva ma il registro non la vedrebbe
            // uscire. La si dà per uscita, e l'avvio per non riuscito.
            exits().finished(pid);
            Err(LaunchError::Io)
        }
    }
}

/// Chiama `callback` quando il processo `pid` avviato da [`spawn_detached`]
/// esce, dal thread che lo aspettava. Se è già uscito, o se non l'ha avviato
/// Fub, la chiama subito, da qui.
pub fn on_exit(pid: u32, callback: Box<dyn FnOnce() + Send>) {
    if let Some(callback) = exits().watch(pid, callback) {
        callback();
    }
}

/// Vero se il processo `pid` l'ha avviato [`spawn_detached`] e non è ancora
/// uscito.
pub fn running(pid: u32) -> bool {
    exits().is_running(pid)
}

/// Avvia la CLI `program` con `args` e la aspetta, al più per
/// `limits.time`. `cancelled` si guarda prima di partire e ogni ~100 ms.
pub fn run_cli(
    program: &Path,
    args: &[OsString],
    limits: &CliLimits,
    cancelled: &dyn Fn() -> bool,
) -> Result<CliOutput, LaunchError> {
    let command = base_command(program, args, std::env::vars_os())?;
    run_command(command, limits, cancelled).0
}

/// Il comando senza shell: il programma assoluto, gli argomenti separati,
/// la cartella di lavoro nella home, l'ambiente `ambient` senza `FUB_*`.
fn base_command(
    program: &Path,
    args: &[OsString],
    ambient: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<Command, LaunchError> {
    // Mai una ricerca nel `PATH` o nella cartella corrente: il programma lo
    // dà `editors::find`, già assoluto.
    if !program.is_absolute() {
        return Err(LaunchError::NotFound);
    }
    let mut command = Command::new(program);
    command.args(args).current_dir(working_dir());
    command.env_clear();
    command.envs(ambient.into_iter().filter(|(key, _)| !is_fub_variable(key)));
    Ok(command)
}

/// Le variabili di Fub stesse: cominciano con `FUB_` (su Windows i nomi non
/// distinguono maiuscole e minuscole).
fn is_fub_variable(key: &OsStr) -> bool {
    let Some(prefix) = key.to_str().and_then(|key| key.get(..4)) else {
        return false;
    };
    if cfg!(windows) {
        prefix.eq_ignore_ascii_case("FUB_")
    } else {
        prefix == "FUB_"
    }
}

/// La home, se c'è ed è una cartella; altrimenti la cartella temporanea. Mai
/// la cartella corrente di Fub, che può essere il vault.
fn working_dir() -> PathBuf {
    super::editors::Env::from_process()
        .home
        .filter(|home| home.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

fn spawn_error(error: std::io::Error) -> LaunchError {
    match error.kind() {
        std::io::ErrorKind::NotFound => LaunchError::NotFound,
        std::io::ErrorKind::PermissionDenied => LaunchError::Denied,
        _ => LaunchError::Io,
    }
}

/// Un'app di «Apri con» non muore con Fub: un gruppo suo su unix, staccata
/// dalla console e dal gruppo di Fub su Windows.
fn detach(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
}

/// Una CLI sta nel suo gruppo, perché il tempo scaduto la fermi insieme ai
/// figli; su Linux muore anche col thread di Fub che l'ha avviata, quindi con
/// Fub uscito di colpo. Su Windows parte senza finestra della console e
/// **sospesa**: la fa partire `job::Job::adopt`, dopo averla messa nel job,
/// così nessun figlio nasce prima che il job ci sia.
fn own_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let parent = rustix::process::getpid();
        // SAFETY: la chiusura gira nel figlio fra `fork` ed `exec` e chiama
        // soltanto `prctl` e `getppid`, due chiamate di sistema dirette senza
        // allocazioni né lucchetti, sicure dopo un `fork`.
        unsafe {
            command.pre_exec(move || {
                rustix::process::set_parent_process_death_signal(Some(
                    rustix::process::Signal::KILL,
                ))?;
                // Fub uscito prima della riga sopra: il segnale non arriverebbe
                // più, e la CLI non parte.
                if rustix::process::getppid() != Some(parent) {
                    return Err(std::io::Error::from(std::io::ErrorKind::Other));
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }
}

type Buffer = Arc<Mutex<Vec<u8>>>;

/// Il corpo di [`run_cli`]. Il secondo valore dice se i due lettori hanno
/// finito prima del ritorno (i test lo guardano: nessun thread che resta).
fn run_command(
    mut command: Command,
    limits: &CliLimits,
    cancelled: &dyn Fn() -> bool,
) -> (Result<CliOutput, LaunchError>, bool) {
    if cancelled() {
        return (Err(LaunchError::Cancelled), true);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Su Windows il job c'è prima della CLI: se non si crea, la CLI non parte.
    #[cfg(windows)]
    let job = match job::Job::new() {
        Ok(job) => job,
        Err(_) => return (Err(LaunchError::Io), true),
    };
    own_group(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return (Err(spawn_error(error)), true),
    };
    // La CLI è nata sospesa: entra nel job e poi parte. Se una delle due cose
    // non va, la si ferma prima che abbia eseguito un'istruzione sua.
    #[cfg(windows)]
    if job.adopt(&child).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return (Err(LaunchError::Io), true);
    }
    let (done_tx, done_rx) = mpsc::channel();
    let stdout = Buffer::default();
    let stderr = Buffer::default();
    let mut readers = Vec::with_capacity(2);
    if let Some(pipe) = child.stdout.take() {
        readers.push(reader(
            "fub-craft-out",
            pipe,
            limits.stream,
            &stdout,
            &done_tx,
        ));
    }
    if let Some(pipe) = child.stderr.take() {
        readers.push(reader(
            "fub-craft-err",
            pipe,
            limits.stream,
            &stderr,
            &done_tx,
        ));
    }
    drop(done_tx);

    // Un lettore che non è partito ha lasciato cadere il suo tubo: la CLI
    // vedrebbe un tubo rotto. L'avvio non è andato: la si ferma.
    let outcome = if readers.iter().all(Option::is_some) {
        watch(&mut child, limits, cancelled)
    } else {
        stop(&mut child);
        Err(LaunchError::Io)
    };
    // I figli del figlio rimasti dopo l'uscita li ha già fermati chi l'ha
    // raccolta (`watch`, `stop`), prima della raccolta. Su Windows li ferma il
    // job, chiuso qui: il job ferma i processi che contiene, non dei pid,
    // quindi chiuderlo dopo la raccolta non tocca nessun altro.
    #[cfg(windows)]
    drop(job);

    let started = readers.iter().filter(|reader| reader.is_some()).count();
    let deadline = Instant::now() + DRAIN_GRACE;
    let mut finished = 0;
    while finished < started {
        let left = deadline.saturating_duration_since(Instant::now());
        match done_rx.recv_timeout(left) {
            Ok(()) => finished += 1,
            Err(_) => break,
        }
    }
    let drained = finished == started;
    if drained {
        for handle in readers.into_iter().flatten() {
            let _ = handle.join();
        }
    }
    let take = |buffer: &Buffer| {
        std::mem::take(&mut *buffer.lock().unwrap_or_else(|poison| poison.into_inner()))
    };
    let result = outcome.map(|status| CliOutput {
        status,
        stdout: take(&stdout),
        stderr: take(&stderr),
    });
    (result, drained)
}

/// Aspetta l'uscita guardando l'annullamento e il tempo, al più ogni
/// [`POLL_MAX`]; a tempo scaduto o annullato ferma il processo e lo aspetta.
fn watch(
    child: &mut Child,
    limits: &CliLimits,
    cancelled: &dyn Fn() -> bool,
) -> Result<ExitStatus, LaunchError> {
    let start = Instant::now();
    let mut pause = POLL_MIN;
    loop {
        match exited(child) {
            Ok(true) => {
                // Il capo è uscito ma non è raccolto: il suo id è ancora
                // riservato, e il segnale al gruppo va soltanto alla CLI.
                stop_group(child);
                return match child.wait() {
                    Ok(status) => exit_outcome(status),
                    Err(_) => Err(LaunchError::Io),
                };
            }
            Ok(false) => {}
            Err(()) => {
                stop(child);
                return Err(LaunchError::Io);
            }
        }
        if cancelled() {
            stop(child);
            return Err(LaunchError::Cancelled);
        }
        let elapsed = start.elapsed();
        if elapsed >= limits.time {
            stop(child);
            return Err(LaunchError::TimedOut);
        }
        thread::sleep(pause.min(limits.time - elapsed));
        pause = (pause * 2).min(POLL_MAX);
    }
}

/// Vero se il figlio è uscito, **senza raccoglierlo** su unix (`waitid` con
/// `WNOWAIT`): il pid resta suo finché non lo si aspetta. Altrove lo
/// raccoglie `try_wait`, e [`stop_group`] non fa niente.
fn exited(child: &mut Child) -> Result<bool, ()> {
    #[cfg(unix)]
    {
        use rustix::process::{waitid, Pid, WaitId, WaitIdOptions};
        let Some(pid) = i32::try_from(child.id()).ok().and_then(Pid::from_raw) else {
            return Err(());
        };
        let options = WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT;
        loop {
            match waitid(WaitId::Pid(pid), options) {
                Ok(found) => return Ok(found.is_some()),
                Err(rustix::io::Errno::INTR) => {}
                Err(_) => return Err(()),
            }
        }
    }
    #[cfg(not(unix))]
    {
        child
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|_| ())
    }
}

fn exit_outcome(status: ExitStatus) -> Result<ExitStatus, LaunchError> {
    if status.success() {
        return Ok(status);
    }
    if let Some(code) = status.code() {
        return Err(LaunchError::Failed(code));
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return Err(LaunchError::Failed(-signal));
        }
    }
    Err(LaunchError::Failed(-1))
}

/// Ferma la CLI non ancora raccolta (su unix l'intero gruppo, mentre il pid
/// del capo è ancora riservato) e la aspetta.
fn stop(child: &mut Child) {
    stop_group(child);
    let _ = child.kill();
    let _ = child.wait();
}

/// Su unix ferma con `SIGKILL` ciò che resta del gruppo della CLI. Il gruppo
/// porta il pid del figlio, e finché ha un membro quell'id non passa a un
/// altro processo; un gruppo vuoto risponde solo `ESRCH`. Su Windows qui si
/// ferma solo la CLI ([`stop`]); i suoi figli li ferma `job::Job`, che
/// [`run_command`] chiude appena la CLI è raccolta.
fn stop_group(child: &Child) {
    #[cfg(unix)]
    {
        use rustix::process::{kill_process_group, Pid, Signal};
        if let Some(group) = i32::try_from(child.id()).ok().and_then(Pid::from_raw) {
            let _ = kill_process_group(group, Signal::KILL);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child;
    }
}

/// Il gruppo di una CLI su Windows: un job object con
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. La CLI ci entra sospesa, prima di
/// aver eseguito niente, e ogni processo che avvia ci nasce dentro (non
/// c'è `BREAKAWAY_OK`, quindi nessuno ne esce). Chiudere il job, a tempo
/// scaduto, ad annullamento, dopo l'uscita o perché Fub è morto e il
/// sistema ne chiude gli handle, ferma tutti. Se Fub è già dentro un job
/// (un terminale, un servizio, la CI), Windows 8 e successivi annidano il
/// nostro dentro quello; dove non si può, `adopt` fallisce e la CLI non parte.
#[cfg(windows)]
mod job {
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    /// Un handle che si chiude con chi lo tiene.
    struct Owned(HANDLE);

    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: l'handle è valido e solo nostro: lo ha aperto chi ha
            // costruito `Owned`, e nessun altro lo chiude.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// Il job di una CLI. Cadendo ferma ciò che contiene e si chiude.
    pub(super) struct Job(Owned);

    impl Job {
        /// Un job nuovo, anonimo e non ereditabile, che chiudendosi ferma
        /// i suoi processi.
        pub(super) fn new() -> io::Result<Job> {
            // SAFETY: attributi e nome nulli sono ammessi: un job anonimo
            // con la sicurezza di base, il cui handle non si eredita.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Job(Owned(handle));
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let size = u32::try_from(std::mem::size_of_val(&info))
                .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
            // SAFETY: `info` vive per tutta la chiamata e `size` è la sua
            // misura, quella che la classe `JobObjectExtendedLimitInformation`
            // vuole.
            let set = unsafe {
                SetInformationJobObject(
                    job.0 .0,
                    JobObjectExtendedLimitInformation,
                    std::ptr::from_ref(&info).cast(),
                    size,
                )
            };
            if set == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }

        /// Mette nel job la CLI appena nata sospesa, poi la fa partire.
        pub(super) fn adopt(&self, child: &Child) -> io::Result<()> {
            // SAFETY: tutti e due gli handle sono validi: il job è nostro, e
            // quello del processo lo tiene `child` per tutta la chiamata.
            let assigned =
                unsafe { AssignProcessToJobObject(self.0 .0, child.as_raw_handle().cast()) };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }
            resume(child.id())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // `KILL_ON_JOB_CLOSE` basterebbe se l'handle fosse l'unico; la
            // chiusura esplicita non dipende da chi altro ne abbia uno.
            // SAFETY: l'handle del job è valido finché `self` vive.
            unsafe {
                TerminateJobObject(self.0 .0, 1);
            }
        }
    }

    /// Fa partire i thread del processo `pid`, nato sospeso: è uno solo, il
    /// primo, e `std` non ne restituisce l'handle, quindi lo si cerca in
    /// un'istantanea dei thread. Errore se non se ne trova nessuno.
    fn resume(pid: u32) -> io::Result<()> {
        // SAFETY: una chiamata senza puntatori; l'handle torna a `Owned`.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
            return Err(io::Error::last_os_error());
        }
        let snapshot = Owned(snapshot);
        let size = u32::try_from(std::mem::size_of::<THREADENTRY32>())
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        let mut entry = THREADENTRY32 {
            dwSize: size,
            ..THREADENTRY32::default()
        };
        let mut resumed = 0usize;
        // SAFETY: l'istantanea è valida e `entry` ha `dwSize` impostato.
        let mut more = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
        while more {
            if entry.th32OwnerProcessID == pid {
                // SAFETY: una chiamata senza puntatori; l'handle torna a `Owned`.
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let thread = Owned(thread);
                // SAFETY: l'handle del thread è valido e ha il diritto di
                // ripresa.
                if unsafe { ResumeThread(thread.0) } == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                resumed += 1;
            }
            entry.dwSize = size;
            // SAFETY: come per `Thread32First`.
            more = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
        }
        if resumed == 0 {
            return Err(io::Error::from(io::ErrorKind::NotFound));
        }
        Ok(())
    }
}

/// Un lettore di un tubo: tiene i primi `cap` byte in `buffer`, scarta il
/// resto continuando a leggere (la CLI non si blocca su un tubo pieno) e
/// segnala la fine su `done`. `None` se il thread non è partito.
fn reader(
    name: &str,
    mut pipe: impl Read + Send + 'static,
    cap: usize,
    buffer: &Buffer,
    done: &mpsc::Sender<()>,
) -> Option<thread::JoinHandle<()>> {
    let buffer = Arc::clone(buffer);
    let done = done.clone();
    thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        let mut kept = buffer.lock().unwrap_or_else(|poison| poison.into_inner());
                        let room = cap.saturating_sub(kept.len());
                        kept.extend_from_slice(&chunk[..read.min(room)]);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
            let _ = done.send(());
        })
        .ok()
}

type Callback = Box<dyn FnOnce() + Send>;

/// Il registro delle app avviate da [`spawn_detached`]: per pid, chi aspetta
/// l'uscita, o che l'uscita c'è già stata.
enum Watch {
    Running(Vec<Callback>),
    Exited,
}

struct Exits(Mutex<HashMap<u32, Watch>>);

fn exits() -> &'static Exits {
    static EXITS: OnceLock<Exits> = OnceLock::new();
    EXITS.get_or_init(|| Exits(Mutex::new(HashMap::new())))
}

impl Exits {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u32, Watch>> {
        self.0.lock().unwrap_or_else(|poison| poison.into_inner())
    }

    fn started(&self, pid: u32) {
        let mut table = self.lock();
        if table.len() >= EXITED_KEPT {
            table.retain(|_, watch| matches!(watch, Watch::Running(_)));
        }
        // Un pid tornato a un processo nuovo dimentica il vecchio.
        table.insert(pid, Watch::Running(Vec::new()));
    }

    /// Segna l'uscita e chiama chi aspettava, fuori dal lucchetto.
    fn finished(&self, pid: u32) {
        let waiting = match self.lock().insert(pid, Watch::Exited) {
            Some(Watch::Running(waiting)) => waiting,
            _ => Vec::new(),
        };
        for callback in waiting {
            callback();
        }
    }

    /// Mette `callback` in attesa; la restituisce se va chiamata subito.
    fn watch(&self, pid: u32, callback: Callback) -> Option<Callback> {
        match self.lock().get_mut(&pid) {
            Some(Watch::Running(waiting)) => {
                waiting.push(callback);
                None
            }
            _ => Some(callback),
        }
    }

    fn is_running(&self, pid: u32) -> bool {
        matches!(self.lock().get(&pid), Some(Watch::Running(_)))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    /// Una cartella 0700 coi suoi script `/bin/sh`.
    struct Scripts {
        dir: tempfile::TempDir,
    }

    impl Scripts {
        fn new() -> Scripts {
            let dir = tempfile::Builder::new()
                .prefix("fub-craft-launch-")
                .tempdir()
                .expect("cartella temporanea");
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).expect("0700");
            Scripts { dir }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.dir.path().join(name)
        }

        fn script(&self, name: &str, body: &str) -> PathBuf {
            let path = self.path(name);
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("script");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).expect("eseguibile");
            path
        }

        fn arg(&self, name: &str) -> OsString {
            self.path(name).into_os_string()
        }
    }

    fn never() -> bool {
        false
    }

    fn limits(time: Duration) -> CliLimits {
        CliLimits {
            time,
            ..CliLimits::default()
        }
    }

    /// Il pid scritto da uno script, aspettato al più 5 s.
    fn read_pid(path: &Path) -> i32 {
        let start = Instant::now();
        loop {
            if let Ok(text) = fs::read_to_string(path) {
                if let Ok(pid) = text.trim().parse() {
                    return pid;
                }
            }
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "nessun pid in {path:?}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// Vero quando il processo non c'è più, o è uno zombie che aspetta chi
    /// lo raccolga (su Linux lo dice `/proc`).
    fn gone(raw: i32) -> bool {
        let Some(pid) = rustix::process::Pid::from_raw(raw) else {
            return true;
        };
        if rustix::process::test_kill_process(pid).is_err() {
            return true;
        }
        match fs::read_to_string(format!("/proc/{raw}/stat")) {
            Ok(stat) => stat
                .rsplit_once(')')
                .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z')),
            Err(_) => false,
        }
    }

    fn assert_gone(pid: i32) {
        let start = Instant::now();
        while !gone(pid) {
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "il processo {pid} è ancora vivo"
            );
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn the_defaults_are_the_plan_limits() {
        let limits = CliLimits::default();
        assert_eq!(limits.time, Duration::from_secs(20));
        assert_eq!(limits.stream, 64 * 1024);
    }

    #[test]
    fn a_cli_that_writes_a_file_and_exits_zero_succeeds() {
        let scripts = Scripts::new();
        let cli = scripts.script("scrive", "printf ciao > \"$1\"\necho fatto\necho nota >&2");
        let output = run_cli(
            &cli,
            &[scripts.arg("out.txt")],
            &CliLimits::default(),
            &never,
        )
        .expect("la CLI esce con zero");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"fatto\n");
        assert_eq!(output.stderr, b"nota\n");
        assert_eq!(fs::read(scripts.path("out.txt")).expect("il file"), b"ciao");
    }

    #[test]
    fn the_time_stops_a_sleeping_cli_within_the_limit() {
        let scripts = Scripts::new();
        let cli = scripts.script("dorme", "echo $$ > \"$1\"\nsleep 60");
        let start = Instant::now();
        let error = run_cli(&cli, &[scripts.arg("pid")], &CliLimits::default(), &never)
            .expect_err("il tempo la ferma");
        let elapsed = start.elapsed();
        assert_eq!(error, LaunchError::TimedOut);
        assert!(elapsed >= CLI_TIME, "fermata troppo presto: {elapsed:?}");
        assert!(
            elapsed < Duration::from_secs(25),
            "fermata tardi: {elapsed:?}"
        );
        assert_gone(read_pid(&scripts.path("pid")));
    }

    #[test]
    fn cancelling_stops_a_sleeping_cli_in_under_a_second() {
        let scripts = Scripts::new();
        let cli = scripts.script("dorme", "echo $$ > \"$1\"\nsleep 60");
        let start = Instant::now();
        let cancel = || start.elapsed() > Duration::from_millis(150);
        let error = run_cli(&cli, &[scripts.arg("pid")], &CliLimits::default(), &cancel)
            .expect_err("l'annullamento la ferma");
        let elapsed = start.elapsed();
        assert_eq!(error, LaunchError::Cancelled);
        assert!(elapsed < Duration::from_secs(1), "annullata in {elapsed:?}");
        assert_gone(read_pid(&scripts.path("pid")));
    }

    #[test]
    fn cancelling_before_the_start_launches_nothing() {
        let scripts = Scripts::new();
        let cli = scripts.script("scrive", "printf ciao > \"$1\"");
        let error = run_cli(
            &cli,
            &[scripts.arg("out.txt")],
            &CliLimits::default(),
            &|| true,
        )
        .expect_err("annullata");
        assert_eq!(error, LaunchError::Cancelled);
        thread::sleep(Duration::from_millis(100));
        assert!(!scripts.path("out.txt").exists());
    }

    #[test]
    fn a_flood_on_stdout_keeps_the_cap_and_does_not_block() {
        let scripts = Scripts::new();
        let cli = scripts.script(
            "fiume",
            "head -c 10485760 /dev/zero\nhead -c 10485760 /dev/zero >&2\necho fine > \"$1\"",
        );
        let start = Instant::now();
        let output = run_cli(
            &cli,
            &[scripts.arg("fine")],
            &limits(Duration::from_secs(15)),
            &never,
        )
        .expect("la CLI arriva in fondo");
        assert_eq!(output.stdout.len(), CLI_STREAM);
        assert_eq!(output.stderr.len(), CLI_STREAM);
        assert!(output.stdout.iter().all(|byte| *byte == 0));
        assert!(scripts.path("fine").exists());
        assert!(start.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn a_non_zero_exit_is_failed_with_its_code() {
        let scripts = Scripts::new();
        let cli = scripts.script("tre", "exit 3");
        let error = run_cli(&cli, &[], &CliLimits::default(), &never).expect_err("esce 3");
        assert_eq!(error, LaunchError::Failed(3));
        let killed = scripts.script("segnale", "kill -9 $$");
        let error = run_cli(&killed, &[], &CliLimits::default(), &never).expect_err("segnale");
        assert_eq!(error, LaunchError::Failed(-9));
    }

    #[test]
    fn fub_variables_do_not_reach_the_program() {
        let scripts = Scripts::new();
        let cli = scripts.script("ambiente", "env");
        let ambient = std::env::vars_os().chain([
            (OsString::from("FUB_SEGRETO"), OsString::from("token")),
            (OsString::from("FUB_"), OsString::from("vuoto")),
            (OsString::from("FUBNO"), OsString::from("resta")),
            (OsString::from("fub_minuscolo"), OsString::from("resta")),
        ]);
        let command = base_command(&cli, &[], ambient).expect("comando");
        let (output, drained) = run_command(command, &CliLimits::default(), &never);
        assert!(drained);
        let output = String::from_utf8(output.expect("env").stdout).expect("utf-8");
        assert!(
            !output.lines().any(|line| line.starts_with("FUB_")),
            "{output}"
        );
        assert!(output.lines().any(|line| line == "FUBNO=resta"), "{output}");
        assert!(output.lines().any(|line| line == "fub_minuscolo=resta"));
        // Il resto dell'ambiente passa com'è.
        if let Some(path) = std::env::var_os("PATH") {
            let line = format!("PATH={}", path.to_string_lossy());
            assert!(output.lines().any(|seen| seen == line), "{output}");
        }
        // Anche per la via pubblica, con l'ambiente vero del processo.
        let output = run_cli(&cli, &[], &CliLimits::default(), &never).expect("env");
        let output = String::from_utf8(output.stdout).expect("utf-8");
        assert!(!output.lines().any(|line| line.starts_with("FUB_")));
    }

    #[test]
    fn the_working_directory_is_the_home_not_the_vault() {
        let scripts = Scripts::new();
        let cli = scripts.script("dove", "pwd -P");
        let output = run_cli(&cli, &[], &CliLimits::default(), &never).expect("pwd");
        let seen = PathBuf::from(String::from_utf8(output.stdout).expect("utf-8").trim());
        let expected = working_dir().canonicalize().expect("cartella di lavoro");
        assert_eq!(seen, expected);
    }

    #[test]
    fn arguments_arrive_intact_without_a_shell() {
        let scripts = Scripts::new();
        let cli = scripts.script(
            "eco",
            "out=\"$1\"\nshift\nfor arg in \"$@\"; do printf '%s\\n' \"$arg\"; done > \"$out\"",
        );
        let marker = scripts.path("non-deve-esistere");
        let marker_text = marker.to_string_lossy().into_owned();
        let tricky = [
            "con spazi".to_string(),
            "\"virgolette\" e 'apici'".to_string(),
            format!("a; touch {marker_text}"),
            format!("$(touch {marker_text})"),
            format!("`touch {marker_text}`"),
            "-meno".to_string(),
        ];
        let mut args = vec![scripts.arg("args.txt")];
        args.extend(tricky.iter().map(OsString::from));
        run_cli(&cli, &args, &CliLimits::default(), &never).expect("eco");
        let written = fs::read_to_string(scripts.path("args.txt")).expect("argomenti");
        let expected: Vec<&str> = tricky.iter().map(String::as_str).collect();
        assert_eq!(written.lines().collect::<Vec<_>>(), expected);
        assert!(!marker.exists());
        // La stessa cosa per «Apri con».
        fs::remove_file(scripts.path("args.txt")).expect("pulizia");
        let pid = spawn_detached(&cli, &args).expect("avviata");
        let (tx, rx) = mpsc::channel();
        on_exit(pid, Box::new(move || tx.send(()).expect("canale")));
        rx.recv_timeout(Duration::from_secs(10)).expect("uscita");
        let written = fs::read_to_string(scripts.path("args.txt")).expect("argomenti");
        assert_eq!(written.lines().collect::<Vec<_>>(), expected);
        assert!(!marker.exists());
    }

    #[test]
    fn a_missing_program_is_not_found_and_a_plain_file_is_denied() {
        let scripts = Scripts::new();
        let missing = scripts.path("non-c-e");
        assert_eq!(
            run_cli(&missing, &[], &CliLimits::default(), &never).unwrap_err(),
            LaunchError::NotFound
        );
        assert_eq!(
            spawn_detached(&missing, &[]).unwrap_err(),
            LaunchError::NotFound
        );
        // Un nome relativo non si cerca nel `PATH`.
        assert_eq!(
            run_cli(Path::new("sh"), &[], &CliLimits::default(), &never).unwrap_err(),
            LaunchError::NotFound
        );
        let plain = scripts.script("senza-bit", "exit 0");
        fs::set_permissions(&plain, fs::Permissions::from_mode(0o600)).expect("0600");
        assert_eq!(
            run_cli(&plain, &[], &CliLimits::default(), &never).unwrap_err(),
            LaunchError::Denied
        );
        assert_eq!(
            spawn_detached(&plain, &[]).unwrap_err(),
            LaunchError::Denied
        );
    }

    #[test]
    fn a_cli_that_closes_stdout_and_stays_alive_is_stopped_by_the_time() {
        let scripts = Scripts::new();
        let cli = scripts.script("muta", "echo $$ > \"$1\"\nexec >&- 2>&-\nsleep 60");
        let start = Instant::now();
        let error = run_cli(
            &cli,
            &[scripts.arg("pid")],
            &limits(Duration::from_secs(1)),
            &never,
        )
        .expect_err("il tempo la ferma");
        assert_eq!(error, LaunchError::TimedOut);
        assert!(
            start.elapsed() < Duration::from_secs(4),
            "{:?}",
            start.elapsed()
        );
        assert_gone(read_pid(&scripts.path("pid")));
    }

    #[test]
    fn the_group_takes_a_grandchild_after_the_time_and_after_the_exit() {
        let scripts = Scripts::new();
        // Il nipote tiene aperti stdout e stderr: senza il gruppo i lettori
        // aspetterebbero i suoi 60 s.
        let stuck = scripts.script("nonno", "sleep 60 &\necho $! > \"$1\"\nwait");
        let start = Instant::now();
        let error = run_cli(
            &stuck,
            &[scripts.arg("nipote")],
            &limits(Duration::from_secs(1)),
            &never,
        )
        .expect_err("il tempo la ferma");
        assert_eq!(error, LaunchError::TimedOut);
        assert!(
            start.elapsed() < Duration::from_secs(4),
            "{:?}",
            start.elapsed()
        );
        assert_gone(read_pid(&scripts.path("nipote")));

        let leaves = scripts.script("lascia", "sleep 60 &\necho $! > \"$1\"\nexit 0");
        let start = Instant::now();
        let command =
            base_command(&leaves, &[scripts.arg("orfano")], std::env::vars_os()).expect("comando");
        let (output, drained) = run_command(command, &CliLimits::default(), &never);
        output.expect("esce con zero");
        assert!(drained, "un lettore è rimasto appeso");
        assert!(
            start.elapsed() < Duration::from_secs(4),
            "{:?}",
            start.elapsed()
        );
        assert_gone(read_pid(&scripts.path("orfano")));
    }

    #[test]
    fn the_group_is_stopped_before_the_exit_is_collected() {
        // `watch` da solo: chi raccoglie l'uscita ha già fermato il gruppo,
        // così il segnale non arriva mai a un id passato a un altro processo.
        let scripts = Scripts::new();
        let leaves = scripts.script("lascia", "sleep 60 &\necho $! > \"$1\"\nexit 0");
        let mut command =
            base_command(&leaves, &[scripts.arg("orfano")], std::env::vars_os()).expect("comando");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        own_group(&mut command);
        let mut child = command.spawn().expect("avviata");
        let status = watch(&mut child, &CliLimits::default(), &never).expect("esce con zero");
        assert!(status.success());
        assert_gone(read_pid(&scripts.path("orfano")));
        assert!(child.try_wait().expect("raccolta").is_some());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_cli_dies_with_the_thread_that_started_it() {
        // `PR_SET_PDEATHSIG` guarda il thread che ha avviato la CLI: quando
        // esce, la CLI riceve `SIGKILL`. Qui il thread esce senza aspettarla.
        let scripts = Scripts::new();
        let cli = scripts.script("dorme", "echo $$ > \"$1\"\nsleep 60");
        let mut command =
            base_command(&cli, &[scripts.arg("pid")], std::env::vars_os()).expect("comando");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // Il thread resta vivo finché la CLI non ha scritto il suo pid: così
        // la morte arriva solo dopo, e solo perché il thread è uscito.
        let pid_file = scripts.path("pid");
        let (mut child, pid) = thread::spawn(move || {
            own_group(&mut command);
            let child = command.spawn().expect("avviata");
            let pid = read_pid(&pid_file);
            assert!(!gone(pid), "la CLI è morta prima che il thread uscisse");
            (child, pid)
        })
        .join()
        .expect("il thread");
        assert_gone(pid);
        let status = child.wait().expect("raccolta");
        use std::os::unix::process::ExitStatusExt;
        assert_eq!(status.signal(), Some(9));
    }

    #[test]
    fn a_hundred_launches_in_a_row_leave_no_thread_behind() {
        let scripts = Scripts::new();
        let cli = scripts.script("svelta", "echo ok");
        for _ in 0..100 {
            let command = base_command(&cli, &[], std::env::vars_os()).expect("comando");
            let (output, drained) = run_command(command, &CliLimits::default(), &never);
            assert_eq!(output.expect("ok").stdout, b"ok\n");
            assert!(drained, "un lettore è rimasto vivo");
        }
        let (tx, rx) = mpsc::channel();
        let mut pids = Vec::new();
        for _ in 0..100 {
            let pid = spawn_detached(&cli, &[]).expect("avviata");
            let tx = tx.clone();
            on_exit(pid, Box::new(move || tx.send(pid).expect("canale")));
            pids.push(pid);
        }
        drop(tx);
        let mut exited: Vec<u32> = Vec::new();
        while exited.len() < pids.len() {
            exited.push(rx.recv_timeout(Duration::from_secs(10)).expect("uscita"));
        }
        exited.sort_unstable();
        pids.sort_unstable();
        assert_eq!(exited, pids);
        // L'uscita si segna prima di chiamare chi aspetta.
        assert!(pids.iter().all(|pid| !running(*pid)));
    }

    #[test]
    fn spawn_detached_returns_at_once_and_the_exit_reaches_the_registry() {
        let scripts = Scripts::new();
        let app = scripts.script("app", "echo $$ > \"$1\"\nsleep 1");
        let start = Instant::now();
        let pid = spawn_detached(&app, &[scripts.arg("pid")]).expect("avviata");
        assert!(
            start.elapsed() < Duration::from_millis(500),
            "{:?}",
            start.elapsed()
        );
        assert!(running(pid));
        let raw = i32::try_from(pid).expect("pid");
        assert_eq!(read_pid(&scripts.path("pid")), raw);
        // Un gruppo suo: non muore con quello di Fub.
        let own = rustix::process::Pid::from_raw(raw).expect("pid");
        assert_eq!(rustix::process::getpgid(Some(own)).expect("gruppo"), own);
        let (tx, rx) = mpsc::channel();
        on_exit(pid, Box::new(move || tx.send(()).expect("canale")));
        rx.recv_timeout(Duration::from_secs(10))
            .expect("l'uscita arriva");
        assert!(!running(pid));
        // Dopo l'uscita chi chiede la sente subito.
        let (tx, rx) = mpsc::channel();
        on_exit(pid, Box::new(move || tx.send(()).expect("canale")));
        rx.try_recv().expect("chiamata subito");
        assert_gone(raw);
        // Un pid che Fub non ha avviato non è «in corso».
        assert!(!running(u32::MAX));
    }
}

/// Le prove del job object: girano solo nella CI Windows. Il programma di
/// prova è questo stesso binario di test, rilanciato su [`helper`] con un
/// ruolo nell'ambiente: c'è su ogni macchina che fa girare i test, non
/// dipende da `cmd.exe` né da PowerShell, e scrive i pid in un file senza
/// doverli pescare dall'output di una shell.
#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::fs;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    /// Il ruolo del binario rilanciato: `dorme` (avvia un figlio e dorme),
    /// `esce` (avvia un figlio ed esce), `figlio` (dorme). Senza `FUB_`
    /// davanti, perché `base_command` lo lascerebbe fuori.
    const ROLE: &str = "CRAFT_LAUNCH_PROVA_RUOLO";
    /// La cartella dove il programma di prova scrive i pid.
    const DIR: &str = "CRAFT_LAUNCH_PROVA_CARTELLA";

    fn never() -> bool {
        false
    }

    /// Gli argomenti che fanno girare al binario di test solo [`helper`].
    fn helper_args() -> Vec<OsString> {
        let module = module_path!()
            .split_once("::")
            .map_or(module_path!(), |(_, rest)| rest);
        [
            format!("{module}::helper"),
            "--exact".into(),
            "--ignored".into(),
            "--nocapture".into(),
            "--test-threads=1".into(),
        ]
        .into_iter()
        .map(OsString::from)
        .collect()
    }

    fn helper_command(role: &str, dir: &Path) -> Command {
        let exe = std::env::current_exe().expect("il binario di test");
        let ambient = std::env::vars_os().chain([
            (OsString::from(ROLE), OsString::from(role)),
            (OsString::from(DIR), dir.as_os_str().to_owned()),
        ]);
        base_command(&exe, &helper_args(), ambient).expect("comando")
    }

    /// Scrive il pid tutto in una volta: un file temporaneo e poi il nome.
    fn write_pid(path: &Path, pid: u32) {
        let partial = path.with_extension("parziale");
        fs::write(&partial, pid.to_string()).expect("pid");
        fs::rename(&partial, path).expect("pid");
    }

    /// Il pid scritto dal programma di prova, aspettato al più 8 s.
    fn read_pid(path: &Path) -> u32 {
        let start = Instant::now();
        loop {
            if let Ok(text) = fs::read_to_string(path) {
                if let Ok(pid) = text.trim().parse() {
                    return pid;
                }
            }
            assert!(
                start.elapsed() < Duration::from_secs(8),
                "nessun pid in {path:?}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    /// Un processo aperto mentre è vivo: aspettarlo non si confonde con un
    /// altro processo che riprenda il suo pid.
    struct Process(HANDLE);

    impl Process {
        fn open(pid: u32) -> Option<Process> {
            // SAFETY: una chiamata senza puntatori; l'handle torna a `Process`.
            let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
            (!handle.is_null()).then_some(Process(handle))
        }

        fn exited_within(&self, time: Duration) -> bool {
            let millis = u32::try_from(time.as_millis()).unwrap_or(u32::MAX);
            // SAFETY: l'handle è valido e ha il diritto di attesa.
            unsafe { WaitForSingleObject(self.0, millis) == WAIT_OBJECT_0 }
        }
    }

    impl Drop for Process {
        fn drop(&mut self) {
            // SAFETY: l'handle è valido e solo nostro.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// Il programma di prova, non una prova: senza ruolo non fa niente.
    #[test]
    #[ignore = "il programma di prova delle prove del job, rilanciato da loro"]
    fn helper() {
        let Some(role) = std::env::var_os(ROLE) else {
            return;
        };
        let dir = PathBuf::from(std::env::var_os(DIR).expect("la cartella"));
        match role.to_str() {
            Some("figlio") => thread::sleep(Duration::from_secs(60)),
            Some(role @ ("dorme" | "esce")) => {
                // Il figlio eredita stdout e stderr: se restasse vivo, i
                // lettori di Fub aspetterebbero lui. Non lo si aspetta apposta:
                // fermarlo è il compito del job sotto prova.
                #[allow(clippy::zombie_processes)]
                let child = Command::new(std::env::current_exe().expect("il binario"))
                    .args(helper_args())
                    .env(ROLE, "figlio")
                    .spawn()
                    .expect("il figlio");
                write_pid(&dir.join("figlio"), child.id());
                write_pid(&dir.join("padre"), std::process::id());
                if role == "dorme" {
                    thread::sleep(Duration::from_secs(60));
                }
            }
            other => panic!("ruolo sconosciuto: {other:?}"),
        }
    }

    #[test]
    fn the_time_stops_the_cli_and_its_child() {
        let dir = tempfile::tempdir().expect("cartella temporanea");
        let command = helper_command("dorme", dir.path());
        let limits = CliLimits {
            time: Duration::from_secs(10),
            ..CliLimits::default()
        };
        let start = Instant::now();
        let runner = thread::spawn(move || run_command(command, &limits, &never));
        // I due processi si aprono mentre sono vivi, prima dello scadere.
        let parent = Process::open(read_pid(&dir.path().join("padre"))).expect("il padre vive");
        let child = Process::open(read_pid(&dir.path().join("figlio"))).expect("il figlio vive");
        let (result, drained) = runner.join().expect("il thread");
        assert_eq!(
            result.expect_err("il tempo la ferma"),
            LaunchError::TimedOut
        );
        assert!(drained, "un lettore è rimasto appeso al figlio");
        assert!(
            start.elapsed() < Duration::from_secs(14),
            "{:?}",
            start.elapsed()
        );
        assert!(
            parent.exited_within(Duration::from_secs(5)),
            "il padre vive"
        );
        assert!(
            child.exited_within(Duration::from_secs(5)),
            "il figlio vive"
        );
    }

    #[test]
    fn a_cli_that_exits_by_itself_leaves_no_child() {
        let dir = tempfile::tempdir().expect("cartella temporanea");
        let command = helper_command("esce", dir.path());
        let start = Instant::now();
        let (result, drained) = run_command(command, &CliLimits::default(), &never);
        result.expect("esce con zero");
        // Il figlio teneva stdout e stderr: se i lettori hanno finito, il
        // job lo ha fermato.
        assert!(drained, "un lettore è rimasto appeso al figlio");
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "{:?}",
            start.elapsed()
        );
        let child = read_pid(&dir.path().join("figlio"));
        if let Some(child) = Process::open(child) {
            assert!(
                child.exited_within(Duration::from_secs(5)),
                "il figlio vive"
            );
        }
    }

    #[test]
    fn a_missing_program_is_still_not_found() {
        let dir = tempfile::tempdir().expect("cartella temporanea");
        let missing = dir.path().join("non-c-e.exe");
        assert_eq!(
            run_cli(&missing, &[], &CliLimits::default(), &never).unwrap_err(),
            LaunchError::NotFound
        );
    }
}
