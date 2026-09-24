//! Supporto all'avvio: demo isolata, diagnostica redatta, recovery della
//! configurazione di macchina e aiuto contestuale su errori tipizzati.
//!
//! Questo modulo e` di OnboardingOwner. `lib.rs`, `session.rs`, `mount.rs` e
//! `settings.rs` restano di Main: qui non si tocca il montaggio, non si
//! dichiara nessuna chiave di impostazione e non si aggiunge nessun comando
//! del registro. Chi monta resta `mount()`; chi apre resta `Host::open`.
//!
//! # Cosa sta qui
//!
//! - **Demo isolata** ([`open_demo`]): una radice sola,
//!   `<config>/demo-vault`, posseduta dall'app. Mai un vault utente: aprire,
//!   chiudere, dimenticare e resettare rifiutano qualunque path fuori da quella
//!   radice. Le modifiche demo si conservano finche' l'utente non chiede reset.
//! - **Avvio senza plugin**: qui sta solo la meta` agnostica ([`LimitedStartup`],
//!   una `StartupSource` che non monta niente e lo dichiara in una sola
//!   diagnosi `Cancelled`). La scelta installato/limitato per la singola
//!   apertura vive in `fub-app/src/support.rs` (`SafeStartupSource`), che puo`
//!   nominare `InstalledPluginManager` senza introdurre una dipendenza nuova in
//!   questo crate. Nessun booleano non consumato: la diagnosi e` letta da
//!   `Host::startup_diagnostics` come ogni altra diagnosi di startup.
//! - **Diagnostica redatta** ([`SupportPreview`]): conteggi e code, mai sorgenti
//!   di note e mai segreti. L'anteprima si mostra prima, l'export chiede un
//!   consenso esplicito ([`ExportConsent`]).
//! - **Recovery della configurazione** ([`config_health`], [`recover_config_file`]):
//!   per i tre file di macchina (`settings.json`, `vaults.json`,
//!   `view-state.json`). Backup prima di ogni scrittura, rifiuto delle versioni
//!   future, mai cancellazione di dati sconosciuti, mai reset automatici.
//! - **Aiuto contestuale** ([`help_for_error`]): la specie dell'errore e non la
//!   sua prosa decide cosa suggerire, perche' la prosa e` localizzata.
//!
//! # Integrazione richiesta a Main (una riga)
//!
//! ```rust,ignore
//! pub mod support; // crates/fub-host/src/lib.rs, in ordine alfabetico dopo `shell`
//! ```
//!
//! Nessuna Cargo change: solo `std`, `camino`, `serde/serde_json`, `fub-abi` e
//! `fub-kernel`, gia` dipendenze di questo crate.

use std::io::{Read, Write};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::PluginError;

use crate::Host;

// --- demo isolata -----------------------------------------------------------

/// Il nome della radice demo dentro la cartella di configurazione.
///
/// Sotto `config_dir` per la stessa ragione di `logs/` e `themes/`: l'elenco
/// dei vault non sta in nessun vault, e una demo che viaggiasse con le note
/// sarebbe un vault come gli altri invece di una copia usa-e-getta.
pub const DEMO_DIR_NAME: &str = "demo-vault";

/// Versione delle note seme: se in futuro il contenuto cambia, `ensure_seeded`
/// non sovrascrive le modifiche dell'utente — scrive solo cio` che manca.
const DEMO_SEED_VERSION: u32 = 1;

/// La radice demo per questa installazione, o `None` senza `config_dir`.
///
/// Senza un posto dove scrivere (host in memoria, ambienti senza `HOME`) la
/// demo non esiste: meglio un `Unserved` detto che una cartella scritta dove
/// nessuno l'ha chiesta.
pub fn demo_root(config_dir: Option<&Utf8Path>) -> Option<Utf8PathBuf> {
    config_dir.map(|dir| dir.join(DEMO_DIR_NAME))
}

/// Una nota seme della demo: path relativo alla radice e testo.
struct SeedNote {
    path: &'static str,
    text: &'static str,
}

/// Le note seme, come dati del prodotto.
///
/// Quattro note e una cartella: benvenuto, un collegamento con tag, una lista
/// di cose da fare e una guida breve. Coprono i casi essenziali (link, tag,
/// task, cartella) senza fingere un vault reale pieno.
const SEED_NOTES: &[SeedNote] = &[
    SeedNote {
        path: "Benvenuto.md",
        text: "# Benvenuto nella demo\n\nQuesta e` una copia di prova isolata: cio` che scrivi qui non tocca i tuoi vault.\n\n- Apri `Collegamenti` per vedere un link e un tag.\n- Apri `Da fare` per vedere una lista.\n- Quando hai finito, chiudi la demo e torna ai tuoi vault, oppure azzerala per ricominciare.\n",
    },
    SeedNote {
        path: "Collegamenti.md",
        text: "# Collegamenti\n\nUn link a [[Benvenuto]] e un tag #demo.\n\nI collegamenti e i tag di prova servono a mostrare ricerca e grafo senza i tuoi dati.\n",
    },
    SeedNote {
        path: "Da fare.md",
        text: "# Da fare\n\n- [ ] Aprire un vault proprio\n- [ ] Provare la ricerca qui dentro\n- [x] Capire che la demo non tocca niente di mio\n",
    },
    SeedNote {
        path: "Guide/Scorciatoie.md",
        text: "# Scorciatoie\n\nLa demo ha gli stessi comandi dei tuoi vault: palette, ricerca, grafo.\n\nNiente di cio` che cambi qui esce da questa cartella.\n",
    },
];

/// Crea la radice demo e scrive le note seme che mancano.
///
/// Non sovrascrive mai: una nota che c'e` resta com'e` (sono le modifiche
/// dell'utente finche' non chiede reset). Non tocca nient'altro sul disco.
/// Rifiuta una `config_dir` assente con `Unserved` invece di inventare un path.
pub fn ensure_seeded(config_dir: Option<&Utf8Path>) -> Result<Utf8PathBuf, PluginError> {
    let root = demo_root(config_dir).ok_or_else(|| {
        PluginError::Unserved("demo non disponibile senza una cartella di configurazione".into())
    })?;
    // Un nome gia` occupato da un vault utente non diventa una demo: il
    // marcatore deve precedere qualunque semina o apertura.
    let marker = root.join(".fub-demo.json");
    match std::fs::symlink_metadata(root.as_std_path()) {
        Ok(_) => validate_demo_root(&root)?,
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(root.as_std_path()).map_err(|and| {
                PluginError::Io(format!("non riesco a preparare la demo in {root}: {and}").into())
            })?;
            let body = serde_json::json!({ "v": DEMO_SEED_VERSION, "seed": "fub-demo" });
            let bytes = serde_json::to_vec(&body)
                .map_err(|and| PluginError::Internal(format!("demo: {and}").into()))?;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(marker.as_std_path())
                .map_err(|and| {
                    PluginError::Io(format!("non riesco a marcare la demo in {root}: {and}").into())
                })?;
            file.write_all(&bytes).map_err(|and| {
                PluginError::Io(format!("non riesco a marcare la demo in {root}: {and}").into())
            })?;
        }
        Err(and) => {
            return Err(PluginError::Io(
                format!("non riesco a verificare {root}: {and}").into(),
            ))
        }
    }
    for seed in SEED_NOTES {
        let path = root.join(seed.path);
        if path.exists() {
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent.as_std_path()).map_err(|and| {
                PluginError::Io(format!("non riesco a preparare la demo in {root}: {and}").into())
            })?;
        }
        std::fs::write(path.as_std_path(), seed.text).map_err(|and| {
            PluginError::Io(format!("non riesco a scrivere la demo in {root}: {and}").into())
        })?;
    }
    Ok(root)
}

/// Il marcatore e la directory devono appartenere davvero alla demo, non a
/// un vault che occupa casualmente lo stesso nome o a un collegamento.
fn validate_demo_root(root: &Utf8Path) -> Result<(), PluginError> {
    let invalid = || {
        PluginError::BadArgs(
            format!("{root} non sembra una demo di Fub: operazione rifiutata").into(),
        )
    };
    let metadata = std::fs::symlink_metadata(root.as_std_path()).map_err(|_| invalid())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(invalid());
    }
    let marker = root.join(".fub-demo.json");
    let metadata = std::fs::symlink_metadata(marker.as_std_path()).map_err(|_| invalid())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(invalid());
    }
    let bytes = std::fs::read(marker.as_std_path()).map_err(|_| invalid())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if value.get("seed").and_then(serde_json::Value::as_str) != Some("fub-demo")
        || value.get("v").and_then(serde_json::Value::as_u64) != Some(u64::from(DEMO_SEED_VERSION))
    {
        return Err(invalid());
    }
    Ok(())
}

/// Apre la demo e la rende corrente, ricordando da dove si viene.
///
/// Sequenza: seme (senza sovrascrivere) poi `Host::open`. L'apertura registra
/// la demo fra i conosciuti come ogni altro vault — e` memoria di recency, non
/// un marchio — ma non scrive mai dentro un vault utente: l'unico path scritto
/// prima dell'apertura e` la radice demo stessa.
pub fn open_demo(host: &Host, config_dir: Option<&Utf8Path>) -> Result<DemoOpened, PluginError> {
    let previous = host.current();
    let root = ensure_seeded(config_dir)?;
    let info = host.open(&root)?;
    Ok(DemoOpened {
        root: info.root,
        previous: previous.map(|p| p.to_string()),
    })
}

/// L'esito di un'apertura demo: dove si e` andati e da dove si veniva.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DemoOpened {
    /// Radice demo aperta (canonica, come la scrive l'host).
    pub root: String,
    /// Il vault corrente prima della demo, se ce n'era uno.
    pub previous: Option<String>,
}

/// Chiude la demo e torna al vault precedente quando e` ancora aperto.
///
/// Non cancella niente: chiudere e` dimenticare la sessione, non i file. Se il
/// precedente non e` piu` aperto, la demo si chiude e basta — riaprirlo e`
/// compito di chi apre (la shell), non di chi chiude.
pub fn close_demo(
    host: &Host,
    config_dir: &Utf8Path,
    return_to: Option<&Utf8Path>,
) -> Result<Vec<PluginError>, PluginError> {
    let root = demo_root(Some(config_dir)).ok_or_else(|| {
        PluginError::Unserved("demo non disponibile senza una cartella di configurazione".into())
    })?;
    // La chiave e` quella con cui l'host conosce la sessione: se la demo non e`
    // aperta, `close_vault` risponde `NotFound` e lo si dice in chiaro.
    let mut errors = host.close_vault(&root)?;
    if let Some(prev) = return_to {
        match host.set_current(prev) {
            Ok(()) => {}
            Err(PluginError::NotFound(_)) => {
                // Il precedente e` stato chiuso nel frattempo: non e` un errore
                // di questa chiusura, e` uno stato che la shell mostra da se`.
            }
            Err(and) => {
                return Ok({
                    errors.push(and);
                    errors
                })
            }
        }
    }
    Ok(errors)
}

/// Azzera la demo: chiude, dimentica (registro + stato di vista) e ricrea il seme.
///
/// Cancella solo la radice demo: il confronto e` esatto contro
/// `demo_root(config_dir)`, e qualunque altro path e` rifiutato con `BadArgs`
/// prima di toccare il disco. Le modifiche demo si perdono solo qui, cioe`
/// solo su gesto esplicito dell'utente.
pub fn reset_demo(host: &Host, config_dir: &Utf8Path) -> Result<Utf8PathBuf, PluginError> {
    let root = demo_root(Some(config_dir)).ok_or_else(|| {
        PluginError::Unserved("demo non disponibile senza una cartella di configurazione".into())
    })?;
    let owned = match std::fs::symlink_metadata(root.as_std_path()) {
        Ok(_) => {
            validate_demo_root(&root)?;
            true
        }
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => false,
        Err(and) => {
            return Err(PluginError::Io(
                format!("non riesco a verificare {root}: {and}").into(),
            ))
        }
    };
    // Chiudere senza fallire se non era aperta: resettare una demo chiusa e`
    // il caso normale dopo un riavvio.
    match host.close_vault(&root) {
        Ok(_) | Err(PluginError::NotFound(_)) => {}
        Err(and) => return Err(and),
    }
    // Dimenticare toglie registro e stato di vista; se la voce non c'era,
    // `forget_vault` riesce comunque (cancella per forme, senza pretendere).
    host.forget_vault(&root)?;
    if owned {
        std::fs::remove_dir_all(root.as_std_path()).map_err(|and| {
            PluginError::Io(format!("non riesco ad azzerare la demo in {root}: {and}").into())
        })?;
    }
    ensure_seeded(Some(config_dir))
}

// --- avvio senza plugin (meta` agnostica) ------------------------------------

/// Una `StartupSource` che non monta niente e lo dichiara.
///
/// Torna snapshot vuoto con una sola diagnosi `Cancelled` che cita `reason` e
/// quanti montaggi ha saltato (`skipped`). E` la forma agnostica di
/// `InstalledPluginManager::prepare_limited`: il manager la usa con il conto
/// vero delle installazioni, gli host senza manager la usano con zero. La
/// diagnosi resta leggibile da `Host::startup_diagnostics`, quindi la modalita`
/// limitata non e` un flag silenzioso.
pub struct LimitedStartup {
    reason: String,
    skipped: usize,
}

impl LimitedStartup {
    /// Nessun montaggio saltato (host senza sorgente installata).
    pub fn without_installations(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            skipped: 0,
        }
    }

    /// Con il conto delle installazioni saltate (lo passa chi le conosce).
    pub fn skipping(reason: impl Into<String>, skipped: usize) -> Self {
        Self {
            reason: reason.into(),
            skipped,
        }
    }
}

impl crate::registry::StartupSource for LimitedStartup {
    fn prepare(&self) -> Result<crate::registry::StartupSnapshot, PluginError> {
        Ok(crate::registry::StartupSnapshot {
            bundles: Vec::new(),
            formats: crate::PreparedFormatSource::empty(),
            diagnostics: vec![PluginError::Cancelled(
                format!(
                    "modalita` limitata ({}): {} installazioni saltate",
                    self.reason, self.skipped
                )
                .into(),
            )],
            validity: None,
            lease: None,
        })
    }
}

// --- diagnostica redatta -----------------------------------------------------

/// Versione di schema dell'anteprima di supporto (non e` un formato su disco
/// versionato altrove: sta qui perche' l'export la scrive in un file).
pub const SUPPORT_PREVIEW_VERSION: u32 = 1;

/// Consenso esplicito all'export: senza, l'export rifiuta.
///
/// L'anteprima si mostra sempre prima; il consenso dice di averla vista. Non
/// c'e` un default `true`: un export che parte senza gesto e` precisamente cio`
/// che questa voce esiste per non fare.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExportConsent {
    /// L'utente ha visto l'anteprima che sta per esportare.
    pub acknowledged_preview: bool,
    /// Esportare il conto delle righe del log; mai il testo non strutturato.
    pub include_log: bool,
    /// Destinazione scelta dall'utente (fuori dai vault, per non inquinarli).
    pub destination: String,
}

impl ExportConsent {
    /// Il consenso vale solo se l'anteprima e` stata vista e la destinazione
    /// non e` vuota. Il controllo sta qui e non nel comando IPC perche' la
    /// regola e` una sola e vale per ogni chiamante (app, CLI, e2e).
    pub fn check(&self) -> Result<(), PluginError> {
        if !self.acknowledged_preview {
            return Err(PluginError::BadArgs(
                "mostra l'anteprima prima di esportare: il consenso non e` stato dato".into(),
            ));
        }
        if self.destination.trim().is_empty() {
            return Err(PluginError::BadArgs(
                "scegli dove scrivere il rapporto diagnostico".into(),
            ));
        }
        Ok(())
    }
}

/// Diagnostica esportabile: specie e chiave di aiuto, mai il messaggio libero
/// che puo` contenere path, identificatori o segreti restituiti da un plugin.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DiagnosticSummary {
    pub kind: String,
    pub help: String,
}

fn diagnostic_summary(error: &PluginError) -> DiagnosticSummary {
    let kind = match error {
        PluginError::UnknownCommand(_) => "unknown_command",
        PluginError::UnknownView(_) => "unknown_view",
        PluginError::UnknownJob(_) => "unknown_job",
        PluginError::BadArgs(_) => "bad_args",
        PluginError::PermissionDenied(_) => "permission_denied",
        PluginError::Internal(_) => "internal",
        PluginError::Conflict(_) => "conflict",
        PluginError::Unserved(_) => "unserved",
        PluginError::Cancelled(_) => "cancelled",
        PluginError::NotFound(_) => "not_found",
        PluginError::AlreadyExists(_) => "already_exists",
        PluginError::Io(_) => "io",
    };
    DiagnosticSummary {
        kind: kind.to_string(),
        help: help_for_error(error).key.to_string(),
    }
}

/// Sintesi di un vault aperto: conteggi, mai contenuti.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct VaultSummary {
    pub root: String,
    pub watching: bool,
    pub startup_diagnostics: Vec<DiagnosticSummary>,
}

/// Sintesi di macchina: chiavi e conti, mai valori ne' segreti.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct MachineSummary {
    pub settings_keys: Vec<String>,
    pub known_vaults: usize,
    pub log_path: Option<String>,
}

/// L'anteprima di supporto: cio` che l'export scrivera`, niente di piu`.
///
/// Non contiene sorgenti di note o valori di impostazione. I log non hanno
/// struttura affidabile: si espone soltanto il numero di righe richieste,
/// mai i loro byte. L'utente vede in anteprima cio` che sara` scritto.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SupportPreview {
    pub v: u32,
    pub at: u64,
    pub fub: String,
    pub vault: Option<VaultSummary>,
    pub machine: MachineSummary,
    pub log_tail: Vec<String>,
    pub note: String,
}

/// Raccoglie l'anteprima di supporto.
///
/// - `vault`: `None` = finestra senza vault (il caso in cui serve di piu`).
/// - `log_lines`: massimo numero di righe da contare (0 = nessuna).
/// - Mai valori delle impostazioni o testo dei log: solo chiavi e conti.
pub fn collect_preview(
    host: &Host,
    vault: Option<&str>,
    config_dir: Option<&Utf8Path>,
    log_lines: usize,
) -> Result<SupportPreview, PluginError> {
    // `vault: None` = la corrente; nessun vault aperto = anteprima di macchina,
    // non un errore (il caso della finestra vuota che chiede aiuto).
    let vault_summary = match host.root(vault) {
        Ok(root) => {
            let diagnostics = host
                .startup_diagnostics(vault)
                .unwrap_or_default()
                .iter()
                .map(diagnostic_summary)
                .collect();
            Some(VaultSummary {
                watching: host.is_watching(vault),
                startup_diagnostics: diagnostics,
                root: root.to_string(),
            })
        }
        Err(_) => None,
    };
    let settings_keys: Vec<String> = host
        .machine_settings()
        .into_iter()
        .map(|entry| entry.spec.key)
        .collect();
    let known_vaults = host.known_vaults().len();
    let (log_tail, log_path) = match config_dir {
        Some(dir) => {
            let path = crate::config::log_path(dir);
            let tail = read_log_tail(&path, log_lines);
            (tail, Some(path.to_string()))
        }
        None => (Vec::new(), None),
    };
    Ok(SupportPreview {
        v: SUPPORT_PREVIEW_VERSION,
        at: fub_kernel::time::now_unix_millis(),
        fub: env!("CARGO_PKG_VERSION").to_string(),
        vault: vault_summary,
        machine: MachineSummary {
            settings_keys,
            known_vaults,
            log_path,
        },
        log_tail,
        note: "Anteprima: conteggi e diagnostica tipizzata, nessun contenuto delle note e nessun segreto."
            .to_string(),
    })
}

/// Conta le righe senza copiare il testo del log nel report.
///
/// Un log libero puo` contenere segreti senza nomi prevedibili: una lista di
/// parole chiave non puo` redigerlo in modo affidabile. L'anteprima conserva
/// soltanto il numero di righe selezionate; la scansione usa memoria limitata.
fn read_log_tail(path: &Utf8Path, max_lines: usize) -> Vec<String> {
    if max_lines == 0 {
        return Vec::new();
    }
    let mut file = match std::fs::File::open(path.as_std_path()) {
        Ok(file) => file,
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(_) => return vec!["log non leggibile".to_string()],
    };
    let mut buffer = [0_u8; 8192];
    let (mut lines, mut ends_with_newline, mut any_bytes) = (0_usize, false, false);
    loop {
        let count = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(_) => return vec!["log non leggibile".to_string()],
        };
        any_bytes = true;
        lines = lines.saturating_add(
            buffer[..count]
                .iter()
                .filter(|&&byte| byte == b'\n')
                .count(),
        );
        ends_with_newline = buffer[count - 1] == b'\n';
    }
    if any_bytes && !ends_with_newline {
        lines = lines.saturating_add(1);
    }
    vec!["riga di log omessa".to_string(); lines.min(max_lines.min(200))]
}

/// Scrive il rapporto fuori dai vault aperti e conosciuti. La cartella madre
/// e` canonicalizzata prima del confronto: `..` e symlink non possono
/// riportare il rapporto dentro le note.
pub fn export_preview(
    host: &Host,
    preview: &SupportPreview,
    consent: &ExportConsent,
) -> Result<String, PluginError> {
    consent.check()?;
    let original = Utf8Path::new(&consent.destination);
    let filename = original
        .file_name()
        .ok_or_else(|| PluginError::BadArgs("destinazione non valida".into()))?;
    let parent = original
        .parent()
        .filter(|p| !p.as_str().is_empty())
        .unwrap_or(Utf8Path::new("."));
    let canonical_parent = std::fs::canonicalize(parent.as_std_path()).map_err(|and| {
        PluginError::NotFound(format!("la cartella {parent} non esiste: {and}").into())
    })?;
    let canonical_parent = Utf8PathBuf::from_path_buf(canonical_parent)
        .map_err(|_| PluginError::BadArgs("percorso non UTF-8".into()))?;
    let dest = canonical_parent.join(filename);
    for root in host.vaults().into_iter().chain(
        host.known_vaults()
            .into_iter()
            .map(|entry| Utf8PathBuf::from(entry.root)),
    ) {
        if dest.starts_with(&root) {
            return Err(PluginError::BadArgs(
                format!("scrivi il rapporto fuori dai vault (non dentro {root})").into(),
            ));
        }
    }
    let without_log;
    let exported = if consent.include_log {
        preview
    } else {
        without_log = {
            let mut selected = preview.clone();
            selected.log_tail.clear();
            selected
        };
        &without_log
    };
    let bytes = serde_json::to_vec_pretty(exported)
        .map_err(|and| PluginError::Internal(format!("rapporto: {and}").into()))?;
    write_atomic(&dest, &bytes)?;
    Ok(dest.to_string())
}

/// Un file temporaneo unico evita di troncare un precedente omonimo. Scrive
/// nella stessa directory e sostituisce il target solo dopo flush su disco.
fn write_atomic(dest: &Utf8Path, bytes: &[u8]) -> Result<(), PluginError> {
    let parent = dest
        .parent()
        .ok_or_else(|| PluginError::BadArgs("destinazione non valida".into()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent.as_std_path())
        .map_err(|and| PluginError::Io(format!("non riesco a preparare {dest}: {and}").into()))?;
    tmp.write_all(bytes)
        .and_then(|()| tmp.as_file().sync_all())
        .map_err(|and| PluginError::Io(format!("non riesco a scrivere {dest}: {and}").into()))?;
    tmp.persist(dest.as_std_path())
        .map_err(|and| PluginError::Io(format!("non riesco a pubblicare {dest}: {and}").into()))?;
    Ok(())
}

// --- recovery della configurazione ------------------------------------------

/// Quale file di macchina si sta guardando.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFileKind {
    MachineSettings,
    VaultRegistry,
    ViewState,
}

/// Come sta un file di macchina.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConfigReport {
    pub kind: ConfigFileKind,
    pub path: String,
    pub status: ConfigStatus,
}

/// Lo stato, detto in chiaro: sano, assente (normale al primo avvio),
/// illeggibile, o scritto da una versione futura.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConfigStatus {
    Healthy,
    Missing,
    Unreadable { reason: String },
    FutureVersion { found: String, supported: u32 },
}

/// Cosa fare di un file rotto. `BackupOnly` non scrive mai il file: copia i
/// byte attuali in un `.bak` e si ferma. Le altre due fanno backup prima.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoverAction {
    BackupOnly,
    RestoreBackup { backup: String },
    ResetEmpty,
}

/// L'esito di un recovery: dove sta il backup e cosa si e` fatto.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecoverOutcome {
    pub backup: Option<String>,
    pub detail: String,
    pub restart_required: bool,
}

/// Fotografa i tre file di macchina.
///
/// `Missing` non e` un errore: e` un'installazione nuova. `FutureVersion` non
/// si ripara: si dice di aggiornare, e il file non si tocca. Il controllo
/// legge solo il campo `version` (o `v`): mai i valori, mai i contenuti.
pub fn config_health(config_dir: Option<&Utf8Path>) -> Vec<ConfigReport> {
    let Some(dir) = config_dir else {
        return Vec::new();
    };
    [
        (
            ConfigFileKind::MachineSettings,
            crate::config::machine_settings_path(dir),
        ),
        (
            ConfigFileKind::VaultRegistry,
            crate::config::vault_registry_path(dir),
        ),
        (
            ConfigFileKind::ViewState,
            crate::config::view_states_path(dir),
        ),
    ]
    .into_iter()
    .map(|(kind, path)| {
        let status = inspect_config_file(&path);
        ConfigReport {
            kind,
            path: path.to_string(),
            status,
        }
    })
    .collect()
}

/// Legge un file di configurazione e ne dice lo stato senza scriverlo.
fn inspect_config_file(path: &Utf8Path) -> ConfigStatus {
    let raw = match std::fs::read(path.as_std_path()) {
        Ok(raw) => raw,
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => return ConfigStatus::Missing,
        Err(and) => {
            return ConfigStatus::Unreadable {
                reason: format!("non riesco a leggere {path}: {and}"),
            }
        }
    };
    let value: serde_json::Value = match serde_json::from_slice(&raw) {
        Ok(value) => value,
        Err(and) => {
            return ConfigStatus::Unreadable {
                reason: format!("{path} non e` un JSON valido: {and}"),
            }
        }
    };
    let found = value
        .get("version")
        .or_else(|| value.get("v"))
        .and_then(serde_json::Value::as_u64);
    match found {
        None => ConfigStatus::Unreadable {
            reason: format!("{path} non ha un campo `version` leggibile"),
        },
        Some(found) if found <= u64::from(supported_schema_version()) => ConfigStatus::Healthy,
        Some(found) => ConfigStatus::FutureVersion {
            found: found.to_string(),
            supported: supported_schema_version(),
        },
    }
}

/// La versione di schema che questa copia legge per i tre file di macchina
/// (oggi tutti a 1: `settings.json`, `vaults.json`, `view-state.json`).
fn supported_schema_version() -> u32 {
    1
}

/// Recupera un file di macchina con backup obbligatorio.
///
/// - Il file attuale (anche corrotto) e` copiato in `<path>.bak.<millis>`
///   prima di qualunque scrittura: il precedente non si perde mai.
/// - `FutureVersion` non si resetta mai: sovrascrivere cio` che una versione
///   nuova ha scritto con uno stato vuoto e` perdita di dati certa.
/// - `ResetEmpty` su un file sano e` rifiutato: azzerare cio` che si legge e`
///   un gesto che non serve a niente e perde le scelte.
/// - Dopo un recovery su `vaults.json` illeggibile serve riavviare: il registro
///   rifiuta di riscrivere cio` che non ha letto (`readable == false`), e solo
///   una riapertura pulisce quel cancello. Lo si dice in chiaro invece di
///   fingere effetto immediato.
pub fn recover_config_file(
    path: &Utf8Path,
    action: RecoverAction,
) -> Result<RecoverOutcome, PluginError> {
    let current = match std::fs::read(path.as_std_path()) {
        Ok(bytes) => Some(bytes),
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => None,
        Err(and) => {
            return Err(PluginError::Io(
                format!("non riesco a leggere {path}: {and}").into(),
            ))
        }
    };
    let backup = match &current {
        Some(bytes) => Some(backup_copy(path, bytes)?),
        None => None,
    };
    if !matches!(action, RecoverAction::BackupOnly) {
        if let Some(Ok(value)) = current
            .as_ref()
            .map(|bytes| serde_json::from_slice::<serde_json::Value>(bytes))
        {
            if let Some(version) = value.get("version").or_else(|| value.get("v")) {
                let found = version.as_u64().ok_or_else(|| PluginError::BadArgs(
                    format!("{path} ha una versione non rappresentabile: nessuna scrittura possibile").into()
                ))?;
                if found > u64::from(supported_schema_version()) {
                    return Err(PluginError::BadArgs(
                        format!("{path} e` scritto nella versione {found} (letta fino alla {}): aggiorna Fub invece di azzerare", supported_schema_version()).into()
                    ));
                }
            }
        }
    }
    match action {
        RecoverAction::BackupOnly => Ok(RecoverOutcome {
            backup,
            detail: "Backup scritto, file invariato.".to_string(),
            restart_required: false,
        }),
        RecoverAction::RestoreBackup { backup: from } => {
            let from = Utf8PathBuf::from(from);
            let bytes = std::fs::read(from.as_std_path()).map_err(|and| {
                PluginError::NotFound(format!("backup {from} non leggibile: {and}").into())
            })?;
            // Il backup deve essere almeno un JSON con versione nota: ripristinare
            // byte a caso sopra la configurazione e` un secondo guasto.
            let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|and| {
                PluginError::BadArgs(format!("backup {from} non valido: {and}").into())
            })?;
            let found = value
                .get("version")
                .or_else(|| value.get("v"))
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| {
                    PluginError::BadArgs(format!("backup {from} senza versione leggibile").into())
                })?;
            if found > u64::from(supported_schema_version()) {
                return Err(PluginError::BadArgs(
                    format!("backup {from} e` di una versione futura ({found}): non ripristinato")
                        .into(),
                ));
            }
            write_atomic(path, &bytes)?;
            Ok(RecoverOutcome {
                backup,
                detail: format!("Ripristinato da {from}."),
                restart_required: true,
            })
        }
        RecoverAction::ResetEmpty => {
            // Mai azzerare un file sano; una versione futura o non
            // rappresentabile e` gia` stata rifiutata prima del match.
            if inspect_config_file(path).is_healthy() {
                return Err(PluginError::BadArgs(
                    format!(
                        "{path} si legge: azzerarlo perderebbe le scelte senza riparare niente"
                    )
                    .into(),
                ));
            }
            let empty = empty_config_bytes(path);
            write_atomic(path, &empty)?;
            Ok(RecoverOutcome {
                backup,
                detail: "File ricreato vuoto (versione corrente), precedente in backup."
                    .to_string(),
                restart_required: true,
            })
        }
    }
}

impl ConfigStatus {
    fn is_healthy(&self) -> bool {
        matches!(self, ConfigStatus::Healthy)
    }
}

/// Copia i byte in un backup esclusivo: due recovery nello stesso millisecondo
/// non sovrascrivono il backup precedente.
fn backup_copy(path: &Utf8Path, bytes: &[u8]) -> Result<String, PluginError> {
    let parent = path
        .parent()
        .ok_or_else(|| PluginError::BadArgs("configurazione senza cartella".into()))?;
    let prefix = format!(
        "{}.bak.{}.",
        path.file_name().unwrap_or("config"),
        fub_kernel::time::now_unix_millis()
    );
    let mut backup = tempfile::Builder::new()
        .prefix(&prefix)
        .tempfile_in(parent.as_std_path())
        .map_err(|and| PluginError::Io(format!("non riesco a salvare {path}: {and}").into()))?;
    backup
        .write_all(bytes)
        .and_then(|()| backup.as_file().sync_all())
        .map_err(|and| PluginError::Io(format!("non riesco a salvare {path}: {and}").into()))?;
    let (_, persisted) = backup.keep().map_err(|and| {
        PluginError::Io(format!("non riesco a conservare il backup di {path}: {and}").into())
    })?;
    let persisted = Utf8PathBuf::from_path_buf(persisted)
        .map_err(|_| PluginError::BadArgs("percorso del backup non UTF-8".into()))?;
    Ok(persisted.to_string())
}

/// Il contenuto vuoto per ciascun file, nella sua forma con versione.
fn empty_config_bytes(path: &Utf8Path) -> Vec<u8> {
    let name = path.file_name().unwrap_or_default();
    let body = match name {
        "settings.json" => serde_json::json!({ "version": 1, "values": {} }),
        "vaults.json" => serde_json::json!({ "version": 1, "vaults": [] }),
        _ => serde_json::json!({ "version": 1, "vaults": {} }),
    };
    serde_json::to_vec_pretty(&body).unwrap_or_else(|_| b"{}".to_vec())
}

// --- aiuto contestuale -------------------------------------------------------

/// Quanto pesa il guasto, per chi disegna il tono dell'avviso.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelpSeverity {
    Info,
    Error,
}

/// Cosa fare dopo aver letto l'aiuto: riprovare, scegliere altro, o riparare.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelpAction {
    Retry,
    ChooseOther,
    Repair,
    Report,
}

/// Un rimando all'aiuto: la chiave di stringa (IT/EN in `strings.ts` via
/// FrontendIntegration) e non la prosa, perche' la prosa e` localizzata e la
/// specie no.
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct HelpRef {
    /// Chiave dell'aiuto (es. `help.io`): la shell la risolve nella lingua.
    pub key: &'static str,
    pub severity: HelpSeverity,
    pub action: HelpAction,
}

/// L'aiuto per un errore tipizzato: la specie decide, la prosa segue.
///
/// Dodici specie, dodici aiuti: esaustivo di proposito come il `match` su
/// `PluginError::message` — una variante nuova non compila finche' non ha il
/// suo aiuto. Le chiavi qui sotto sono il contratto con FrontendIntegration,
/// che le accoglie in `strings.ts` con testi IT/EN.
pub fn help_for_error(error: &PluginError) -> HelpRef {
    match error {
        PluginError::NotFound(_) => HelpRef {
            key: "help.not_found",
            severity: HelpSeverity::Info,
            action: HelpAction::ChooseOther,
        },
        PluginError::AlreadyExists(_) => HelpRef {
            key: "help.already_exists",
            severity: HelpSeverity::Info,
            action: HelpAction::ChooseOther,
        },
        PluginError::Conflict(_) => HelpRef {
            key: "help.conflict",
            severity: HelpSeverity::Error,
            action: HelpAction::Retry,
        },
        PluginError::Io(_) => HelpRef {
            key: "help.io",
            severity: HelpSeverity::Error,
            action: HelpAction::Retry,
        },
        PluginError::PermissionDenied(_) => HelpRef {
            key: "help.permission_denied",
            severity: HelpSeverity::Error,
            action: HelpAction::Repair,
        },
        PluginError::BadArgs(_) => HelpRef {
            key: "help.bad_args",
            severity: HelpSeverity::Info,
            action: HelpAction::ChooseOther,
        },
        PluginError::UnknownCommand(_)
        | PluginError::UnknownView(_)
        | PluginError::UnknownJob(_) => HelpRef {
            key: "help.unknown",
            severity: HelpSeverity::Info,
            action: HelpAction::Report,
        },
        PluginError::Unserved(_) => HelpRef {
            key: "help.unserved",
            severity: HelpSeverity::Info,
            action: HelpAction::Repair,
        },
        PluginError::Cancelled(_) => HelpRef {
            key: "help.cancelled",
            severity: HelpSeverity::Info,
            action: HelpAction::Retry,
        },
        PluginError::Internal(_) => HelpRef {
            key: "help.internal",
            severity: HelpSeverity::Error,
            action: HelpAction::Report,
        },
    }
}

/// Le chiavi di aiuto che FrontendIntegration accoglie in `strings.ts`.
///
/// Dodici chiavi di aiuto piu` le sezioni onboarding/demo/supporto/recupero:
/// l'elenco esaustivo e` nel messaggio a FrontendIntegration e Main.
pub const HELP_KEYS: &[&str] = &[
    "help.not_found",
    "help.already_exists",
    "help.conflict",
    "help.io",
    "help.permission_denied",
    "help.bad_args",
    "help.unknown",
    "help.unserved",
    "help.cancelled",
    "help.internal",
];

/// Diagnostica di schema futura, detta in chiaro per il recovery.
///
/// Torna `Some((found, supported))` se i byte sono un JSON con versione oltre
/// quella supportata, `None` altrimenti. Serve a chi deve decidere fra
/// «ripara» e «aggiorna» senza aprire il file a mano.
pub fn future_schema_of(raw: &[u8]) -> Option<(u64, u32)> {
    let value: serde_json::Value = serde_json::from_slice(raw).ok()?;
    let found = value
        .get("version")
        .or_else(|| value.get("v"))
        .and_then(serde_json::Value::as_u64)?;
    let supported = supported_schema_version();
    (found > u64::from(supported)).then_some((found, supported))
}

/// Quante note seme porta la demo (per l'anteprima e i presidi).
pub fn seed_note_paths() -> Vec<&'static str> {
    SEED_NOTES.iter().map(|s| s.path).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_refuses_unowned_vault_without_changing_session_or_files() {
        let temp = tempfile::tempdir().unwrap();
        let config = Utf8Path::from_path(temp.path()).unwrap();
        let root = demo_root(Some(config)).unwrap();
        std::fs::create_dir(&root).unwrap();
        let note = root.join("important.md");
        std::fs::write(&note, "contenuto da conservare").unwrap();
        let host = Host::without_watcher().with_config_dir(config);
        host.open(&root).unwrap();
        let known_before = host.known_vaults();
        assert!(ensure_seeded(Some(config)).is_err());
        assert!(reset_demo(&host, config).is_err());
        assert_eq!(host.known_vaults(), known_before);
        assert!(host.vaults().contains(&root));
        assert_eq!(
            std::fs::read_to_string(note).unwrap(),
            "contenuto da conservare"
        );
        assert!(!root.join(".fub-demo.json").exists());
    }

    #[test]
    fn support_export_never_contains_unstructured_log_secrets() {
        let temp = tempfile::tempdir().unwrap();
        let config = Utf8Path::from_path(temp.path()).unwrap();
        let log = config.join("diagnostic.log");
        std::fs::write(
            &log,
            b"TOKEN=abc123\nAuthorization: Bearer secret\nunlabeled-private-data",
        )
        .unwrap();
        let mut preview = collect_preview(&Host::without_watcher(), None, None, 0).unwrap();
        preview.log_tail = read_log_tail(&log, 200);
        assert_eq!(preview.log_tail.len(), 3);
        let destination = config.join("report.json");
        let consent = ExportConsent {
            acknowledged_preview: true,
            include_log: true,
            destination: destination.to_string(),
        };
        export_preview(&Host::without_watcher(), &preview, &consent).unwrap();
        let exported = std::fs::read_to_string(&destination).unwrap();
        for secret in [
            "abc123",
            "Authorization",
            "secret",
            "unlabeled-private-data",
        ] {
            assert!(!exported.contains(secret), "{secret} leaked");
        }
        let consent = ExportConsent {
            include_log: false,
            ..consent
        };
        export_preview(&Host::without_watcher(), &preview, &consent).unwrap();
        let exported: SupportPreview =
            serde_json::from_slice(&std::fs::read(&destination).unwrap()).unwrap();
        assert!(exported.log_tail.is_empty());
    }

    #[test]
    fn support_diagnostic_keeps_kind_but_drops_free_text() {
        let secret = "Bearer abc123 /home/alice/private";
        let summary = diagnostic_summary(&PluginError::Internal(secret.into()));
        let wire = serde_json::to_string(&summary).unwrap();
        assert_eq!(summary.kind, "internal");
        assert_eq!(summary.help, "help.internal");
        assert!(!wire.contains(secret));
        assert!(!wire.contains("abc123"));
    }

    #[test]
    fn support_report_cannot_enter_closed_vault_through_alias() {
        let temp = tempfile::tempdir().unwrap();
        let config = Utf8Path::from_path(temp.path()).unwrap();
        let vault = config.join("vault");
        std::fs::create_dir(&vault).unwrap();
        let host = Host::without_watcher().with_config_dir(config);
        host.open(&vault).unwrap();
        host.close_vault(&vault).unwrap();
        let preview = collect_preview(&host, None, None, 0).unwrap();
        let consent = ExportConsent {
            acknowledged_preview: true,
            include_log: false,
            destination: vault.join("report.json").to_string(),
        };
        assert!(export_preview(&host, &preview, &consent).is_err());
        assert!(!vault.join("report.json").exists());
        #[cfg(unix)]
        {
            let alias = config.join("alias");
            std::os::unix::fs::symlink(&vault, &alias).unwrap();
            let consent = ExportConsent {
                destination: alias.join("report.json").to_string(),
                ..consent
            };
            assert!(export_preview(&host, &preview, &consent).is_err());
            assert!(!vault.join("report.json").exists());
        }
    }

    #[test]
    fn future_config_is_never_reset() {
        let temp = tempfile::tempdir().unwrap();
        let path = Utf8Path::from_path(temp.path())
            .unwrap()
            .join("settings.json");
        let known = Utf8Path::from_path(temp.path()).unwrap().join("safe.json");
        std::fs::write(&known, br#"{"version":1,"values":{}}"#).unwrap();
        for (version, reported) in [
            ("4294967297", Some("4294967297")),
            ("9007199254740993", Some("9007199254740993")),
            ("18446744073709551616", None),
        ] {
            let raw = format!(r#"{{"version":{version},"values":{{"important":true}}}}"#);
            std::fs::write(&path, &raw).unwrap();
            assert_eq!(
                future_schema_of(raw.as_bytes())
                    .map(|v| v.0.to_string())
                    .as_deref(),
                reported
            );
            if let Some(expected) = reported {
                let ConfigStatus::FutureVersion { found, .. } = inspect_config_file(&path) else {
                    panic!("versione futura non riconosciuta: {version}");
                };
                assert_eq!(found, expected);
            }
            assert!(recover_config_file(&path, RecoverAction::ResetEmpty).is_err());
            assert!(recover_config_file(
                &path,
                RecoverAction::RestoreBackup {
                    backup: known.to_string()
                }
            )
            .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), raw.as_bytes());
        }
    }

    #[test]
    fn recovery_backup_never_replaces_previous_copy() {
        let temp = tempfile::tempdir().unwrap();
        let path = Utf8Path::from_path(temp.path())
            .unwrap()
            .join("settings.json");
        let first = br#"{"version":1,"values":{"saved":"first"}}"#;
        let second = br#"{"version":1,"values":{"saved":"second"}}"#;
        std::fs::write(&path, first).unwrap();
        let original = recover_config_file(&path, RecoverAction::BackupOnly)
            .unwrap()
            .backup
            .unwrap();
        std::fs::write(&path, second).unwrap();
        let later = recover_config_file(&path, RecoverAction::BackupOnly)
            .unwrap()
            .backup
            .unwrap();
        assert_ne!(original, later);
        assert_eq!(std::fs::read(original).unwrap(), first);
        assert_eq!(std::fs::read(later).unwrap(), second);
        assert_eq!(std::fs::read(path).unwrap(), second);
    }

    #[test]
    fn export_consent_is_explicit_or_refused() {
        let no_preview = ExportConsent {
            acknowledged_preview: false,
            include_log: true,
            destination: "/tmp/report.json".to_string(),
        };
        assert!(
            no_preview.check().is_err(),
            "senza anteprima non si esporta"
        );
        let no_dest = ExportConsent {
            acknowledged_preview: true,
            include_log: false,
            destination: "  ".to_string(),
        };
        assert!(
            no_dest.check().is_err(),
            "senza destinazione non si esporta"
        );
        let ok = ExportConsent {
            acknowledged_preview: true,
            include_log: false,
            destination: "/tmp/report.json".to_string(),
        };
        assert!(ok.check().is_ok());
    }
}
