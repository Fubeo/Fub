//! L'anteprima fatta con la riga di comando di un'app Craft.
//!
//! Parte soltanto dopo un gesto: `Host::craft_render` (la shell principale,
//! quando chi usa Fub preme «Crea l'anteprima») dà un biglietto e mette in coda
//! il job [`RENDER_JOB`](fub_format_craft::RENDER_JOB); il job consuma il
//! biglietto prima di ogni altra cosa e, senza un biglietto buono, risponde
//! `render.no_ticket` e non avvia niente. Così `Call::InvokeJob`, un plugin o
//! ogni altra via che arriva al job per nome non avvia mai un'app.
//!
//! Il biglietto è un valore di `control::fresh_token` legato a `(vault, doc,
//! misura)`, buono una volta sola e per [`TICKET_LIFE`], in una tabella di
//! processo ([`Tickets`], con l'ora passata da chi chiama: i test la
//! iniettano). Non va mai nel log né nell'esito del job. Chiuso il vault, i
//! suoi biglietti non valgono più: il lettore che portano è chiuso, e il
//! vault riaperto ne registra uno nuovo che butta i vecchi.
//!
//! Il job copia il documento, a pezzi e al più per il peso massimo, in una
//! cartella privata nuova sotto la cartella temporanea (0700 su unix): l'app
//! non vede mai il file del vault, e la copia si chiama sempre `in.` più
//! l'estensione ([`input_name`]), mai col nome del file. Avvia la CLI con
//! [`cli_args`], guarda `out.png` (niente link, niente cartelle, al più
//! [`MAX_IMAGE_BYTES`]), e con un PNG o un JPEG buono, riconosciuto dalla
//! firma, risponde `origin: cli` e scrive la cache per la revisione della
//! copia. Un errore è `missing: failed`, e la coppia (revisione,
//! misura) va nell'insieme «già provato» che `craft.preview` legge: la stessa
//! revisione non si riprova finché il file non cambia o Fub non riparte. La
//! cartella si cancella sempre.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_abi::settings::SettingValue;
use fub_abi::text::Text;
use fub_abi::traits::HostApi;
use fub_abi::{PluginError, Revision, RevisionHasher};
use fub_format_craft::{
    cache_key, CraftPreview, Missing, PreviewImage, PreviewOrigin, PreviewSize, PreviewSubject,
    RenderConsent,
};
use fub_kernel::KernelError;

use super::consent;
use super::editors::{self, Env};
use super::launch::{self, CliLimits, LaunchError};
use super::ranged::{self, Ranged, RangedError};

/// Quanto vale un biglietto dopo che è stato dato.
pub const TICKET_LIFE: Duration = Duration::from_secs(60);
/// Il peso massimo dell'immagine che la CLI scrive.
pub const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
/// I byte copiati per volta nella cartella privata.
const COPY_CHUNK: usize = 64 * 1024;
/// I biglietti aperti che la tabella tiene; oltre, il più vecchio si butta.
const TICKETS_KEPT: usize = 256;
/// Le coppie «già provate» che il processo ricorda; piena, si svuota.
const TRIED_KEPT: usize = 4096;
/// Il prefisso della cartella privata di un job.
pub const PRIVATE_PREFIX: &str = "fub-craft-render-";

/// Gli argomenti della CLI che fa l'anteprima di `subject` alla misura
/// `size`, con `input` e `output` assoluti e separati (la tabella «Le app che
/// Fub conosce» del piano N7). `None` per un soggetto la cui app non ha una
/// CLI che Fub sa usare.
///
/// LightCraft sviluppa la foto RAW al lato lungo di 512 o 2048 pixel; PdfCraft
/// disegna solo la prima pagina, a 36 o 144 dpi; WordCraft solo la prima
/// pagina, a metà o a grandezza piena.
pub fn cli_args(
    subject: PreviewSubject,
    size: PreviewSize,
    input: &Path,
    output: &Path,
) -> Option<Vec<OsString>> {
    let (input, output) = (input.as_os_str().to_owned(), output.as_os_str().to_owned());
    match subject {
        PreviewSubject::VectorCraft => {
            let mut args = vec!["convert".into(), input, output];
            if size == PreviewSize::Small {
                args.extend(["--scale".into(), "0.25".into()]);
            }
            Some(args)
        }
        PreviewSubject::PhotoCraft => Some(vec!["convert".into(), input, output]),
        PreviewSubject::FigCraft => Some(vec!["render".into(), input, "-o".into(), output]),
        PreviewSubject::Raw => {
            let side = match size {
                PreviewSize::Small => "512",
                PreviewSize::Large => "2048",
            };
            Some(vec![
                "render".into(),
                input,
                "-o".into(),
                output,
                "--size".into(),
                side.into(),
            ])
        }
        PreviewSubject::Pdf => {
            let dpi = match size {
                PreviewSize::Small => "36",
                PreviewSize::Large => "144",
            };
            Some(vec![
                "render".into(),
                input,
                "--page".into(),
                "1".into(),
                "--dpi".into(),
                dpi.into(),
                "--out".into(),
                output,
            ])
        }
        PreviewSubject::Document => {
            let scale = match size {
                PreviewSize::Small => "0.5",
                PreviewSize::Large => "1",
            };
            Some(vec![
                "render".into(),
                input,
                output,
                "--page".into(),
                "1".into(),
                "--scale".into(),
                scale.into(),
            ])
        }
        PreviewSubject::Xmp => None,
    }
}

/// Il nome della copia nella cartella privata: `in.` più l'estensione, mai
/// il nome del file del vault (uno che comincia con `-` non arriva mai alla
/// CLI). Per i formati dei provider Craft l'estensione è quella canonica; per
/// una foto RAW, un PDF o un documento è quella del nome così come è scritta
/// (`in.CR3`), perché l'app riconosce il formato dal nome, e solo se è una
/// delle estensioni del soggetto: Fub non piega il caso.
fn input_name(subject: PreviewSubject, doc: &DocId) -> Option<String> {
    let extension = match subject {
        PreviewSubject::VectorCraft => "vectorcraft",
        PreviewSubject::PhotoCraft => "pcraft",
        PreviewSubject::FigCraft => "figcraft",
        PreviewSubject::Xmp => return None,
        PreviewSubject::Raw | PreviewSubject::Pdf | PreviewSubject::Document => {
            let name = doc.as_str().rsplit('/').next().unwrap_or_default();
            match name.rsplit_once('.') {
                Some((stem, ext))
                    if !stem.is_empty() && PreviewSubject::of_extension(ext) == Some(subject) =>
                {
                    ext
                }
                _ => return None,
            }
        }
    };
    Some(format!("in.{extension}"))
}

/// Il programma a riga di comando dell'app di `subject`, se Fub lo trova
/// (con le righe di `craft.editor-paths`) e sa come chiamarlo.
pub fn cli_of(host: &dyn HostApi, subject: PreviewSubject) -> Option<PathBuf> {
    let overrides = match host.setting(crate::settings::CRAFT_EDITOR_PATHS) {
        Ok(SettingValue::List(lines)) => lines,
        _ => Vec::new(),
    };
    cli_with(subject, &overrides)
}

/// Come [`cli_of`], con le righe di `craft.editor-paths` già lette.
pub fn cli_with(subject: PreviewSubject, overrides: &[String]) -> Option<PathBuf> {
    let id = subject.editor()?;
    cli_args(
        subject,
        PreviewSize::Small,
        Path::new("in"),
        Path::new("out"),
    )?;
    editors::find(&Env::from_process(), overrides)
        .into_iter()
        .find(|found| found.id == id)?
        .cli
}

/// Un lucchetto di processo che un panico altrove non rende inservibile:
/// le tabelle qui restano coerenti a ogni passo.
fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------
// I lettori dei vault aperti.
// ---------------------------------------------------------------------------

fn readers() -> &'static Mutex<HashMap<Utf8PathBuf, Ranged>> {
    static READERS: OnceLock<Mutex<HashMap<Utf8PathBuf, Ranged>>> = OnceLock::new();
    READERS.get_or_init(Default::default)
}

/// Il lettore del vault a `root`, registrato quando il bundle si monta. I
/// biglietti di un lettore di prima per la stessa radice si buttano.
pub(crate) fn remember_reader(root: Utf8PathBuf, ranged: Ranged) {
    locked(tickets()).drop_root(&root);
    locked(readers()).insert(root, ranged);
}

/// Il lettore del vault a `root`, se c'è ed è ancora aperto.
pub(crate) fn reader_of(root: &Utf8Path) -> Option<Ranged> {
    let mut readers = locked(readers());
    readers.retain(|_, ranged| !closed(ranged));
    readers.get(root).cloned()
}

/// Il vault del lettore è chiuso? Il kernel lo dice con un `Io` di specie
/// `NotConnected` prima di guardare il nome.
fn closed(ranged: &Ranged) -> bool {
    match ranged.open(&DocId::new("")) {
        Err(RangedError::Kernel(KernelError::Io { source, .. })) => {
            source.kind() == std::io::ErrorKind::NotConnected
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// I biglietti.
// ---------------------------------------------------------------------------

/// A che cosa è legato un biglietto: il vault (la sua radice), il documento e
/// la misura. È anche la chiave dei lavori in corso.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Binding {
    pub root: Utf8PathBuf,
    pub doc: String,
    pub size: PreviewSize,
}

struct Entry<T> {
    token: String,
    binding: Binding,
    until: Instant,
    value: T,
}

/// I biglietti aperti, ognuno buono una volta sola fino alla sua scadenza.
/// L'ora la passa chi chiama.
pub struct Tickets<T> {
    entries: Vec<Entry<T>>,
}

impl<T> Default for Tickets<T> {
    fn default() -> Self {
        Tickets {
            entries: Vec::new(),
        }
    }
}

impl<T> Tickets<T> {
    /// Apre `token` per `binding`, buono fino a `now` + [`TICKET_LIFE`].
    pub fn issue(&mut self, token: String, binding: Binding, value: T, now: Instant) {
        self.prune(now);
        if self.entries.len() >= TICKETS_KEPT {
            self.entries.remove(0);
        }
        self.entries.push(Entry {
            token,
            binding,
            until: now + TICKET_LIFE,
            value,
        });
    }

    /// Consuma `token` per `doc` alla misura `size`. Un biglietto trovato si
    /// brucia anche quando è di un altro documento o di un'altra misura; uno
    /// scaduto non vale.
    pub fn take(
        &mut self,
        token: &str,
        doc: &str,
        size: PreviewSize,
        now: Instant,
    ) -> Option<(Binding, T)> {
        self.prune(now);
        let index = self
            .entries
            .iter()
            .position(|entry| same_token(token, &entry.token))?;
        let entry = self.entries.remove(index);
        (entry.binding.doc == doc && entry.binding.size == size)
            .then_some((entry.binding, entry.value))
    }

    /// Butta `token` senza usarlo: il job che doveva consumarlo non è
    /// partito.
    pub fn revoke(&mut self, token: &str) {
        self.entries
            .retain(|entry| !same_token(token, &entry.token));
    }

    /// Butta i biglietti del vault a `root`.
    pub fn drop_root(&mut self, root: &Utf8Path) {
        self.entries.retain(|entry| entry.binding.root != root);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn prune(&mut self, now: Instant) {
        self.entries.retain(|entry| now < entry.until);
    }
}

/// Il confronto che non si ferma al primo byte diverso.
fn same_token(given: &str, expected: &str) -> bool {
    let (given, expected) = (given.as_bytes(), expected.as_bytes());
    if given.len() != expected.len() || expected.is_empty() {
        return false;
    }
    given
        .iter()
        .zip(expected)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

fn tickets() -> &'static Mutex<Tickets<Ranged>> {
    static TICKETS: OnceLock<Mutex<Tickets<Ranged>>> = OnceLock::new();
    TICKETS.get_or_init(Default::default)
}

/// Un biglietto nuovo per `binding`, col lettore del suo vault.
pub(crate) fn issue(binding: Binding, ranged: Ranged) -> std::io::Result<String> {
    let token = crate::control::fresh_token()?;
    locked(tickets()).issue(token.clone(), binding, ranged, Instant::now());
    Ok(token)
}

/// Butta un biglietto che non servirà.
pub(crate) fn revoke(token: &str) {
    locked(tickets()).revoke(token);
}

// ---------------------------------------------------------------------------
// I lavori in corso e le revisioni già provate.
// ---------------------------------------------------------------------------

enum Work {
    /// Il biglietto è dato e il job è in coda, fino a quest'ora.
    Queued(Instant),
    /// Il job ha consumato il biglietto e lavora.
    Running,
}

fn work() -> &'static Mutex<HashMap<Binding, Work>> {
    static WORK: OnceLock<Mutex<HashMap<Binding, Work>>> = OnceLock::new();
    WORK.get_or_init(Default::default)
}

/// Segna `binding` in coda; `false` se un lavoro per lo stesso documento e la
/// stessa misura è già in coda o in corso.
pub(crate) fn begin(binding: &Binding, now: Instant) -> bool {
    let mut work = locked(work());
    match work.get(binding) {
        Some(Work::Running) => false,
        Some(Work::Queued(until)) if now < *until => false,
        _ => {
            work.insert(binding.clone(), Work::Queued(now + TICKET_LIFE));
            true
        }
    }
}

/// Un lavoro per `binding` è in coda o in corso.
pub(crate) fn in_progress(binding: &Binding, now: Instant) -> bool {
    match locked(work()).get(binding) {
        Some(Work::Running) => true,
        Some(Work::Queued(until)) => now < *until,
        None => false,
    }
}

/// Toglie `binding` dai lavori: il job non è partito.
pub(crate) fn abandon(binding: &Binding) {
    locked(work()).remove(binding);
}

/// Il lavoro in corso, finché il job non torna.
struct Running(Binding);

impl Running {
    fn start(binding: Binding) -> Running {
        locked(work()).insert(binding.clone(), Work::Running);
        Running(binding)
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        locked(work()).remove(&self.0);
    }
}

fn tried() -> &'static Mutex<HashSet<(String, PreviewSize)>> {
    static TRIED: OnceLock<Mutex<HashSet<(String, PreviewSize)>>> = OnceLock::new();
    TRIED.get_or_init(Default::default)
}

/// La CLI ha già fallito su questa revisione e misura.
pub fn already_tried(revision: &Revision, size: PreviewSize) -> bool {
    locked(tried()).contains(&(revision.0.clone(), size))
}

fn mark_tried(revision: &Revision, size: PreviewSize) {
    let mut tried = locked(tried());
    if tried.len() >= TRIED_KEPT {
        tried.clear();
    }
    tried.insert((revision.0.clone(), size));
}

// ---------------------------------------------------------------------------
// Il job.
// ---------------------------------------------------------------------------

/// Perché la CLI non ha dato un'anteprima: ogni caso è una chiave del
/// catalogo del bundle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    NoCli,
    TimedOut,
    Denied,
    Failed,
    Io,
    BadImage,
    TooBig,
    Copy,
}

impl Failure {
    fn key(self) -> &'static str {
        match self {
            Failure::NoCli => "render.no_cli",
            Failure::TimedOut => "render.timed_out",
            Failure::Denied => "render.denied",
            Failure::Failed => "render.failed",
            Failure::Io => "render.io",
            Failure::BadImage => "render.bad_png",
            Failure::TooBig => "render.too_big",
            Failure::Copy => "render.copy",
        }
    }

    /// Un errore della cartella temporanea o del sistema non è colpa del
    /// file: la stessa revisione si può riprovare.
    fn about_the_file(self) -> bool {
        !matches!(self, Failure::Copy | Failure::Io)
    }

    fn of_launch(error: LaunchError) -> Failure {
        match error {
            LaunchError::NotFound => Failure::NoCli,
            LaunchError::Denied => Failure::Denied,
            LaunchError::TimedOut => Failure::TimedOut,
            LaunchError::Failed(_) => Failure::Failed,
            LaunchError::Cancelled | LaunchError::Io => Failure::Io,
        }
    }
}

/// Il job `craft.render { doc, size, ticket }`.
pub fn run(
    payload: &serde_json::Value,
    host: &mut dyn HostApi,
) -> Result<CraftPreview, PluginError> {
    let no_ticket = || PluginError::Unserved(Text::key("render.no_ticket"));
    let text = |field: &str| payload.get(field).and_then(serde_json::Value::as_str);
    let (Some(doc), Some(ticket)) = (text("doc"), text("ticket")) else {
        return Err(no_ticket());
    };
    let size = match text("size") {
        None | Some("small") => PreviewSize::Small,
        Some("large") => PreviewSize::Large,
        Some(_) => return Err(no_ticket()),
    };
    let taken = locked(tickets()).take(ticket, doc, size, Instant::now());
    let Some((binding, ranged)) = taken else {
        return Err(no_ticket());
    };
    let _running = Running::start(binding);
    if closed(&ranged) {
        return Err(no_ticket());
    }
    render(host, &ranged, &DocId::new(doc), size)
}

/// Il lavoro dopo il biglietto: di nuovo il consenso e il peso, la copia, la
/// CLI, l'immagine.
fn render(
    host: &mut dyn HostApi,
    ranged: &Ranged,
    doc: &DocId,
    size: PreviewSize,
) -> Result<CraftPreview, PluginError> {
    let base = super::preview::preview(host, Some(ranged), doc, size)?;
    // La scelta può essere cambiata fra la domanda e il job, e il file pure:
    // senza un'offerta col consenso acceso non parte niente.
    let offered = base.image.is_none()
        && base.missing == Some(Missing::Absent)
        && base
            .render
            .as_ref()
            .is_some_and(|offer| offer.consent == RenderConsent::On);
    if !offered {
        return Ok(base);
    }
    let subject = base.info.app;
    let (Some(program), Some(name)) = (cli_of(&*host, subject), input_name(subject, doc)) else {
        return Ok(failed(base, None, size, Failure::NoCli));
    };
    let max = consent::max_bytes(&*host);
    let Ok(private) = Private::new() else {
        return Ok(failed(base, None, size, Failure::Copy));
    };
    let input = private.path().join(name);
    let output = private.path().join("out.png");
    let start = match copy(ranged, doc, &input, max) {
        Ok(start) => start,
        Err(Copied::Stale) => return Err(PluginError::Conflict(Text::key("changing"))),
        Err(Copied::OverLimit) => {
            let mut preview = base;
            preview.missing = Some(Missing::OverLimit);
            preview.limit_bytes = Some(max);
            preview.render = None;
            return Ok(preview);
        }
        Err(Copied::Gone(error)) => return Err(error),
        Err(Copied::Disk) => return Ok(failed(base, None, size, Failure::Copy)),
    };
    let Some(args) = cli_args(subject, size, &input, &output) else {
        return Ok(failed(base, Some(start), size, Failure::NoCli));
    };
    let outcome = {
        let view: &dyn HostApi = &*host;
        let cancelled = move || consent::current(view) != RenderConsent::On;
        launch::run_cli(&program, &args, &CliLimits::default(), &cancelled)
    };
    match outcome {
        Ok(_) => {}
        Err(LaunchError::Cancelled) => {
            return Err(PluginError::Cancelled(Text::key("render.cancelled")));
        }
        Err(error) => return Ok(failed(base, Some(start), size, Failure::of_launch(error))),
    }
    let image = match read_image(&output) {
        Ok(image) => image,
        Err(failure) => return Ok(failed(base, Some(start), size, failure)),
    };
    drop(private);
    let mut preview = base;
    preview.origin = PreviewOrigin::Cli;
    preview.image = Some(image);
    preview.missing = None;
    preview.limit_bytes = None;
    preview.render = None;
    preview.queued = false;
    preview.revision = Some(start.clone());
    // La cache vale per la revisione della copia: un file cambiato nel
    // frattempo ha già un'altra revisione, e la risposta resta della copia.
    if ranged.revision(doc, max).ok().as_ref() == Some(&start) {
        if let Ok(bytes) = serde_json::to_vec(&preview) {
            let _ = host.cache_write(&cache_key(&start.0, size), &bytes);
        }
    } else {
        tracing::info!(
            doc = %doc,
            key = "render.changed",
            "fub.craft: il file è cambiato mentre la CLI lavorava"
        );
    }
    Ok(preview)
}

/// L'anteprima di un tentativo andato male: niente immagine, niente offerta,
/// e (se è colpa del file) la revisione segnata come già provata.
fn failed(
    mut preview: CraftPreview,
    revision: Option<Revision>,
    size: PreviewSize,
    failure: Failure,
) -> CraftPreview {
    tracing::warn!(
        doc = %preview.doc,
        size = size.as_str(),
        key = failure.key(),
        "fub.craft: l'anteprima della CLI non è riuscita"
    );
    if revision.is_some() {
        preview.revision = revision;
    }
    if let Some(revision) = preview.revision.as_ref() {
        if failure.about_the_file() {
            mark_tried(revision, size);
        }
    }
    preview.origin = PreviewOrigin::None;
    preview.image = None;
    preview.missing = Some(Missing::Failed);
    preview.render = None;
    preview.queued = false;
    preview
}

/// Perché la copia non c'è.
enum Copied {
    /// Il file è cambiato fra due pezzi.
    Stale,
    /// Il file supera il peso massimo: niente è stato copiato.
    OverLimit,
    /// Il file non si apre più (rinominato, cancellato): l'errore dell'host.
    Gone(PluginError),
    /// La cartella temporanea non prende la copia (piena, negata).
    Disk,
}

/// Copia `doc` in `input`, a pezzi e al più per `max` byte, e torna la
/// revisione dei byte copiati: la stessa che calcola il kernel.
fn copy(ranged: &Ranged, doc: &DocId, input: &Path, max: u64) -> Result<Revision, Copied> {
    let mut file = match ranged.open(doc) {
        Ok(file) => file,
        Err(RangedError::Stale) => return Err(Copied::Stale),
        Err(RangedError::OverLimit { .. }) => return Err(Copied::OverLimit),
        Err(RangedError::Kernel(error)) => return Err(Copied::Gone(error.into())),
    };
    if file.len() > max {
        return Err(Copied::OverLimit);
    }
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(input)
        .map_err(|_| Copied::Disk)?;
    let mut hasher = RevisionHasher::new();
    let mut buffer = vec![0u8; COPY_CHUNK];
    let mut copied = 0u64;
    loop {
        let read = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) if ranged::is_stale(&error) => return Err(Copied::Stale),
            Err(_) => return Err(Copied::Stale),
        };
        copied += read as u64;
        if copied > max {
            return Err(Copied::OverLimit);
        }
        hasher.update(&buffer[..read]);
        out.write_all(&buffer[..read]).map_err(|_| Copied::Disk)?;
    }
    out.flush().map_err(|_| Copied::Disk)?;
    Ok(hasher.finish())
}

/// La firma di un PNG.
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
/// L'inizio di un JPEG: SOI e il primo marcatore.
const JPEG_SIGNATURE: &[u8] = &[0xFF, 0xD8, 0xFF];

/// L'immagine che la CLI ha scritto: un file vero (mai un link o una
/// cartella), al più [`MAX_IMAGE_BYTES`], un PNG o un JPEG riconosciuto dalla
/// firma (non dal nome) e con misure lecite. Un JPEG vale così com'è
/// (orientamento 1): l'app lo scrive già girato.
fn read_image(output: &Path) -> Result<PreviewImage, Failure> {
    let meta = std::fs::symlink_metadata(output).map_err(|_| Failure::BadImage)?;
    if !meta.file_type().is_file() {
        return Err(Failure::BadImage);
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(Failure::TooBig);
    }
    let file = std::fs::File::open(output).map_err(|_| Failure::BadImage)?;
    let opened = file.metadata().map_err(|_| Failure::BadImage)?;
    if !opened.is_file() {
        return Err(Failure::BadImage);
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::BadImage)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(Failure::TooBig);
    }
    let image = if bytes.starts_with(PNG_SIGNATURE) {
        PreviewImage::from_png(&bytes)
    } else if bytes.starts_with(JPEG_SIGNATURE) {
        PreviewImage::from_jpeg(&bytes, 1)
    } else {
        None
    };
    image.ok_or(Failure::BadImage)
}

/// La cartella privata di un job: si cancella sempre quando il job la lascia,
/// anche dopo un errore o un annullamento.
struct Private(Option<tempfile::TempDir>);

impl Private {
    fn new() -> std::io::Result<Private> {
        let mut builder = tempfile::Builder::new();
        builder.prefix(PRIVATE_PREFIX);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        Ok(Private(Some(builder.tempdir_in(std::env::temp_dir())?)))
    }

    fn path(&self) -> &Path {
        self.0.as_ref().map_or(Path::new(""), |dir| dir.path())
    }
}

impl Drop for Private {
    fn drop(&mut self) {
        if let Some(dir) = self.0.take() {
            if let Err(error) = dir.close() {
                tracing::warn!(%error, "fub.craft: la cartella privata dell'anteprima non si cancella");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(doc: &str, size: PreviewSize) -> Binding {
        Binding {
            root: Utf8PathBuf::from("/vault"),
            doc: doc.into(),
            size,
        }
    }

    const TOKEN: &str = "ab12";
    const DOC: &str = "a.vectorcraft";
    const SMALL: PreviewSize = PreviewSize::Small;

    #[test]
    fn a_ticket_is_good_once() {
        let now = Instant::now();
        let mut table = Tickets::default();
        table.issue(TOKEN.into(), binding(DOC, SMALL), 7, now);
        let taken = table.take(TOKEN, DOC, SMALL, now).map(|(_, value)| value);
        assert_eq!(taken, Some(7));
        assert!(table.take(TOKEN, DOC, SMALL, now).is_none(), "già usato");
    }

    #[test]
    fn an_invented_or_empty_ticket_is_refused() {
        let now = Instant::now();
        let mut table = Tickets::default();
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        for wrong in ["", "ab1", "ab13", "ab12 ", "AB12"] {
            assert!(table.take(wrong, DOC, SMALL, now).is_none(), "{wrong:?}");
        }
        assert_eq!(table.len(), 1, "uno inventato non brucia quello vero");
        let mut empty = Tickets::default();
        empty.issue(String::new(), binding(DOC, SMALL), 1, now);
        assert!(empty.take("", DOC, SMALL, now).is_none());
    }

    #[test]
    fn a_ticket_of_another_document_or_size_is_refused_and_burned() {
        let now = Instant::now();
        let mut table = Tickets::default();
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        assert!(table.take(TOKEN, "b.vectorcraft", SMALL, now).is_none());
        assert!(table.take(TOKEN, DOC, SMALL, now).is_none(), "bruciato");
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        assert!(table.take(TOKEN, DOC, PreviewSize::Large, now).is_none());
        assert!(table.is_empty());
    }

    #[test]
    fn a_ticket_expires_after_sixty_seconds() {
        let now = Instant::now();
        let mut table = Tickets::default();
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        assert!(table.take(TOKEN, DOC, SMALL, now + TICKET_LIFE).is_none());
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        let almost = now + TICKET_LIFE - Duration::from_millis(1);
        assert!(table.take(TOKEN, DOC, SMALL, almost).is_some());
    }

    #[test]
    fn closing_a_vault_drops_its_tickets() {
        let now = Instant::now();
        let mut table = Tickets::default();
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        let mut other = binding(DOC, SMALL);
        other.root = Utf8PathBuf::from("/altro");
        table.issue("cd34".into(), other, 2, now);
        table.drop_root(Utf8Path::new("/vault"));
        assert!(table.take(TOKEN, DOC, SMALL, now).is_none());
        assert!(table.take("cd34", DOC, SMALL, now).is_some());
    }

    #[test]
    fn a_revoked_ticket_is_gone() {
        let now = Instant::now();
        let mut table = Tickets::default();
        table.issue(TOKEN.into(), binding(DOC, SMALL), 1, now);
        table.revoke(TOKEN);
        assert!(table.take(TOKEN, DOC, SMALL, now).is_none());
    }

    #[test]
    fn the_table_stays_small() {
        let now = Instant::now();
        let mut table = Tickets::default();
        for n in 0..(TICKETS_KEPT + 10) {
            table.issue(format!("t{n}"), binding(DOC, SMALL), n, now);
        }
        assert_eq!(table.len(), TICKETS_KEPT);
        assert!(table.take("t0", DOC, SMALL, now).is_none());
    }

    #[test]
    fn one_work_per_document_and_size() {
        let now = Instant::now();
        let first = Binding {
            root: Utf8PathBuf::from("/lavori-unici"),
            doc: DOC.into(),
            size: SMALL,
        };
        assert!(begin(&first, now));
        assert!(!begin(&first, now), "in coda");
        assert!(in_progress(&first, now));
        let mut large = first.clone();
        large.size = PreviewSize::Large;
        assert!(begin(&large, now), "un'altra misura");
        assert!(begin(&first, now + TICKET_LIFE), "una coda scaduta si rifà");
        {
            let _running = Running::start(first.clone());
            assert!(!begin(&first, now + TICKET_LIFE * 2), "in corso");
        }
        assert!(!in_progress(&first, now));
        assert!(begin(&first, now));
        abandon(&first);
        abandon(&large);
    }

    #[test]
    fn the_arguments_follow_the_table() {
        let (input, output) = (Path::new("/t/in"), Path::new("/t/out.png"));
        let args = |subject, size| -> Vec<String> {
            cli_args(subject, size, input, output)
                .unwrap()
                .into_iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect()
        };
        assert_eq!(
            args(PreviewSubject::VectorCraft, SMALL),
            ["convert", "/t/in", "/t/out.png", "--scale", "0.25"]
        );
        assert_eq!(
            args(PreviewSubject::VectorCraft, PreviewSize::Large),
            ["convert", "/t/in", "/t/out.png"]
        );
        assert_eq!(
            args(PreviewSubject::PhotoCraft, SMALL),
            ["convert", "/t/in", "/t/out.png"]
        );
        assert_eq!(
            args(PreviewSubject::FigCraft, PreviewSize::Large),
            ["render", "/t/in", "-o", "/t/out.png"]
        );
        assert_eq!(
            args(PreviewSubject::Raw, SMALL),
            ["render", "/t/in", "-o", "/t/out.png", "--size", "512"]
        );
        assert_eq!(
            args(PreviewSubject::Raw, PreviewSize::Large),
            ["render", "/t/in", "-o", "/t/out.png", "--size", "2048"]
        );
        assert_eq!(
            args(PreviewSubject::Pdf, SMALL),
            [
                "render",
                "/t/in",
                "--page",
                "1",
                "--dpi",
                "36",
                "--out",
                "/t/out.png"
            ]
        );
        assert_eq!(
            args(PreviewSubject::Pdf, PreviewSize::Large),
            [
                "render",
                "/t/in",
                "--page",
                "1",
                "--dpi",
                "144",
                "--out",
                "/t/out.png"
            ]
        );
        assert_eq!(
            args(PreviewSubject::Document, SMALL),
            [
                "render",
                "/t/in",
                "/t/out.png",
                "--page",
                "1",
                "--scale",
                "0.5"
            ]
        );
        assert_eq!(
            args(PreviewSubject::Document, PreviewSize::Large),
            [
                "render",
                "/t/in",
                "/t/out.png",
                "--page",
                "1",
                "--scale",
                "1"
            ]
        );
        assert!(cli_args(PreviewSubject::Xmp, SMALL, input, output).is_none());
    }

    #[test]
    fn a_job_without_a_good_ticket_starts_nothing() {
        let mut host = fub_sdk::testing::MemoryHost::new();
        for payload in [
            serde_json::json!({}),
            serde_json::json!({ "doc": DOC, "size": "small" }),
            serde_json::json!({ "doc": DOC, "size": "small", "ticket": "00" }),
            serde_json::json!({ "doc": DOC, "size": "enorme", "ticket": "00" }),
        ] {
            let error = run(&payload, &mut host).unwrap_err();
            assert!(
                matches!(&error, PluginError::Unserved(text)
                    if text.as_message().is_some_and(|m| m.key == "render.no_ticket")),
                "{error:?}"
            );
        }
    }

    #[test]
    fn the_private_folder_is_private_and_goes_away() {
        let private = Private::new().unwrap();
        let path = private.path().to_path_buf();
        std::fs::write(path.join("in.vectorcraft"), b"{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        drop(private);
        assert!(!path.exists());
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = PNG_SIGNATURE.to_vec();
        out.extend_from_slice(&13u32.to_be_bytes());
        out.extend_from_slice(b"IHDR");
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(b"IEND");
        out.extend_from_slice(&[0, 0, 0, 0]);
        out
    }

    /// Un JPEG minimo: SOI, SOF0 con le misure, SOS, EOI.
    fn jpeg(width: u16, height: u16) -> Vec<u8> {
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xC0, 0, 11, 8];
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&[1, 1, 0x11, 0]);
        out.extend_from_slice(&[0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0]);
        out.extend_from_slice(&[0x55; 16]);
        out.extend_from_slice(&[0xFF, 0xD9]);
        out
    }

    #[test]
    fn the_image_must_be_a_small_real_png_or_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out.png");
        assert_eq!(read_image(&out).unwrap_err(), Failure::BadImage, "manca");
        std::fs::write(&out, b"non sono un png").unwrap();
        assert_eq!(read_image(&out).unwrap_err(), Failure::BadImage);
        std::fs::write(&out, png(32, 16)).unwrap();
        let image = read_image(&out).unwrap();
        assert_eq!(
            (image.media_type.as_str(), image.width, image.height),
            ("image/png", 32, 16)
        );
        // Un JPEG in `out.png`: conta la firma, non il nome.
        std::fs::write(&out, jpeg(300, 200)).unwrap();
        let image = read_image(&out).unwrap();
        assert_eq!(
            (image.media_type.as_str(), image.width, image.height),
            ("image/jpeg", 300, 200)
        );
        assert_eq!(image.orientation, 1);
        // Una firma giusta senza misure lecite non è un'immagine.
        std::fs::write(&out, &jpeg(300, 200)[..4]).unwrap();
        assert_eq!(read_image(&out).unwrap_err(), Failure::BadImage);
        std::fs::write(&out, &png(32, 16)[..12]).unwrap();
        assert_eq!(read_image(&out).unwrap_err(), Failure::BadImage);
        std::fs::remove_file(&out).unwrap();
        std::fs::create_dir(&out).unwrap();
        assert_eq!(
            read_image(&out).unwrap_err(),
            Failure::BadImage,
            "una cartella"
        );
    }

    #[test]
    fn the_copy_is_always_named_in_with_the_extension_as_written() {
        let name = |subject, doc: &str| input_name(subject, &DocId::new(doc));
        assert_eq!(
            name(PreviewSubject::VectorCraft, "a/-x.vectorcraft").as_deref(),
            Some("in.vectorcraft")
        );
        assert_eq!(
            name(PreviewSubject::PhotoCraft, "-rm -rf.pcraft").as_deref(),
            Some("in.pcraft")
        );
        assert_eq!(
            name(PreviewSubject::FigCraft, "b.figcraft").as_deref(),
            Some("in.figcraft")
        );
        assert_eq!(
            name(PreviewSubject::Raw, "Foto/IMG_0001.CR3").as_deref(),
            Some("in.CR3")
        );
        assert_eq!(
            name(PreviewSubject::Raw, "Foto/-IMG.nef").as_deref(),
            Some("in.nef")
        );
        assert_eq!(
            name(PreviewSubject::Pdf, "Libri/--help.pdf").as_deref(),
            Some("in.pdf")
        );
        assert_eq!(
            name(PreviewSubject::Document, "Lettere/vecchia.doc").as_deref(),
            Some("in.doc")
        );
        assert_eq!(
            name(PreviewSubject::Document, "Lettere/nuova.Docx").as_deref(),
            Some("in.Docx")
        );
        // Un nome che non è del soggetto, senza estensione o solo estensione.
        for (subject, doc) in [
            (PreviewSubject::Raw, "Foto/IMG_0001.jpg"),
            (PreviewSubject::Pdf, "Libri/manuale.docx"),
            (PreviewSubject::Document, "Lettere/senza"),
            (PreviewSubject::Pdf, ".pdf"),
            (PreviewSubject::Xmp, "Foto/IMG_0001.xmp"),
        ] {
            assert_eq!(name(subject, doc), None, "{doc}");
        }
    }

    /// Il consenso ritirato fra la domanda e il job: col biglietto buono e la
    /// CLI trovata, il job risponde con l'offerta e non avvia niente.
    #[cfg(unix)]
    #[test]
    fn the_consent_withdrawn_before_the_job_starts_nothing() {
        use std::os::unix::fs::PermissionsExt as _;
        let tools = tempfile::tempdir().unwrap();
        let marker = tools.path().join("partita");
        let script = tools.path().join("fub-craft-test-cli.sh");
        std::fs::write(
            &script,
            format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        let vault = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(vault.path().to_path_buf()).unwrap();
        std::fs::write(
            root.join(DOC),
            br#"{"format_version":4,"title":"Ritirato","layers":[]}"#,
        )
        .unwrap();
        let workspace =
            fub_kernel::Workspace::new(&root, fub_kernel::FormatRegistry::new()).unwrap();
        let ranged = Ranged::new(workspace.resource_reader());

        let spec = |key: &str| {
            crate::settings::core_settings()
                .into_iter()
                .find(|spec| spec.key == key)
                .unwrap()
        };
        let mut host = fub_sdk::testing::MemoryHost::new()
            .with_binary_document(DOC, &std::fs::read(root.join(DOC)).unwrap());
        for provider in fub_format_craft::providers() {
            let format = fub_abi::format::DocumentFormat {
                descriptor: provider.descriptor(),
                capabilities: provider.capabilities(),
            };
            for ext in format.descriptor.extensions.clone() {
                host = host.with_format(&ext, format.clone());
            }
        }
        let mut host = host
            .with_value(
                spec(crate::settings::CRAFT_EDITOR_PATHS),
                SettingValue::List(vec![format!("vectorcraft-cli={}", script.display())]),
            )
            .with_value(
                spec(crate::settings::CRAFT_CLI_PREVIEWS),
                SettingValue::Text("ask".into()),
            );
        let token = issue(
            Binding {
                root: root.clone(),
                doc: DOC.into(),
                size: PreviewSize::Small,
            },
            ranged,
        )
        .unwrap();
        let payload = serde_json::json!({ "doc": DOC, "size": "small", "ticket": token });
        let preview = run(&payload, &mut host).unwrap();
        let offer = preview.render.expect("the CLI is found and offered");
        assert_eq!(offer.consent, RenderConsent::Ask);
        assert!(preview.image.is_none());
        std::thread::sleep(Duration::from_millis(100));
        assert!(!marker.exists(), "the CLI did not start");
        // Il biglietto era buono una volta sola.
        assert!(run(&payload, &mut host).is_err());
    }
}
