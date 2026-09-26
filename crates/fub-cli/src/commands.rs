//! Output strutturato: gli stessi tipi su stdout, sempre.
//!
//! `ok:true` con `data`, `ok:false` con `kind/message/code`. Formati:
//! text (umano), json, jsonl, tsv, csv, md. Nessun segreto passa di qui:
//! chi chiama redact prima di costruire il valore.

use super::cli::GlobalArgs;

#[derive(Clone, Debug)]
pub struct Failure {
    pub code: i32,
    pub kind: &'static str,
    pub message: String,
}

impl Failure {
    pub fn new(code: i32, kind: &'static str, message: impl Into<String>) -> Self {
        Failure {
            code,
            kind,
            message: message.into(),
        }
    }
    pub fn bad_args(message: impl Into<String>) -> Self {
        Self::new(2, "bad_args", message)
    }
    pub fn local(message: impl Into<String>) -> Self {
        Self::new(1, "local", message)
    }
    pub fn from_plugin(error: &fub_abi::PluginError) -> Self {
        let (code, kind) = match error {
            fub_abi::PluginError::BadArgs(_) => (2, "bad_args"),
            fub_abi::PluginError::UnknownCommand(_)
            | fub_abi::PluginError::UnknownView(_)
            | fub_abi::PluginError::UnknownJob(_) => (2, "bad_args"),
            fub_abi::PluginError::PermissionDenied(_) => (4, "denied"),
            fub_abi::PluginError::NotFound(_) => (1, "not_found"),
            fub_abi::PluginError::Conflict(_) | fub_abi::PluginError::AlreadyExists(_) => {
                (5, "conflict")
            }
            fub_abi::PluginError::Unserved(_) => (3, "unavailable"),
            fub_abi::PluginError::Cancelled(_) => (1, "cancelled"),
            fub_abi::PluginError::Io(_) | fub_abi::PluginError::Internal(_) => (1, "local"),
        };
        Self::new(code, kind, render_error_text(error))
    }
    pub fn from_automation(error: &fub_host::automation::AutomationError) -> Self {
        use fub_host::automation::AutomationKind;
        let (code, kind) = match error.kind() {
            AutomationKind::BadArgs => (2, "bad_args"),
            AutomationKind::Unavailable => (3, "unavailable"),
            AutomationKind::Denied => (4, "denied"),
            AutomationKind::NotFound => (1, "not_found"),
            AutomationKind::Conflict => (5, "conflict"),
        };
        Self::new(code, kind, error.to_string())
    }
}

/// Testo leggibile di un PluginError: Literal com'è, Message con chiave+argomenti.
pub fn render_error_text(error: &fub_abi::PluginError) -> String {
    error.to_string()
}

pub fn render_text_value(text: &fub_abi::Text) -> String {
    match text {
        fub_abi::Text::Literal(s) => s.clone(),
        fub_abi::Text::Message(m) => {
            if m.args.is_empty() {
                m.key.clone()
            } else {
                let args = m
                    .args
                    .iter()
                    .map(|a| format!("{}={}", a.name, render_arg_value(&a.value)))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{}({args})", m.key)
            }
        }
    }
}

fn render_arg_value(value: &fub_abi::ArgValue) -> String {
    match value {
        fub_abi::ArgValue::Text(s) => s.clone(),
        fub_abi::ArgValue::Int(n) => n.to_string(),
        fub_abi::ArgValue::Float(n) => n.to_string(),
        fub_abi::ArgValue::Timestamp(n) => n.to_string(),
    }
}

/// Il lock di scrittura fra processi lo prende l'host aprendo il vault e lo
/// tiene finché la sessione vive: la CLI non ne possiede uno suo.
pub struct Connection {
    pub host: fub_host::Host,
    vault: Option<String>,
}

impl Connection {
    pub fn open(global: &GlobalArgs) -> Result<Self, Failure> {
        Self::new(global, false, true)
    }

    pub fn unmounted(global: &GlobalArgs) -> Result<Self, Failure> {
        Self::new(global, false, false)
    }

    pub fn watch(global: &GlobalArgs) -> Result<Self, Failure> {
        Self::new(global, !global.no_watcher, true)
    }

    fn new(global: &GlobalArgs, watcher: bool, mount: bool) -> Result<Self, Failure> {
        let mut host = if watcher {
            fub_host::Host::new()
        } else {
            fub_host::Host::without_watcher()
        };
        if let Some(dir) = global.config_dir.as_deref() {
            if dir.trim().is_empty() {
                return Err(Failure::bad_args("--config-dir vuota"));
            }
            host = host.with_config_dir(camino::Utf8Path::new(dir));
        } else if let Ok(dir) = std::env::var("FUB_CONFIG_DIR") {
            if !dir.trim().is_empty() {
                host = host.with_config_dir(camino::Utf8Path::new(&dir));
            } else if let Some(dir) = fub_host::config_dir() {
                host = host.with_config_dir(dir.as_path());
            }
        } else if let Some(dir) = fub_host::config_dir() {
            host = host.with_config_dir(dir.as_path());
        }
        let vault = global.vault.clone().or_else(|| {
            std::env::var("FUB_VAULT")
                .ok()
                .filter(|s| !s.trim().is_empty())
        });
        let mut connection = Connection { host, vault };
        if mount {
            connection.ensure_open()?;
        }
        Ok(connection)
    }

    fn ensure_open(&mut self) -> Result<(), Failure> {
        let Some(vault) = self.vault.clone() else {
            // Nessun vault nominato: si lavora sul corrente o si apre l'ultimo noto.
            if self.host.has_current_vault() {
                return Ok(());
            }
            if let Some(last) = self.host.last_vault() {
                self.vault = Some(last.clone());
                self.open_vault(&last)?;
                return Ok(());
            }
            return Ok(());
        };
        let path = camino::Utf8Path::new(&vault);
        // `open` su vault già aperto lo rende corrente senza rimontare.
        self.open_vault(path.as_str())?;
        Ok(())
    }

    pub fn open_vault(&mut self, root: &str) -> Result<(), Failure> {
        std::path::Path::new(root)
            .canonicalize()
            .map_err(|error| Failure::local(format!("vault: {error}")))?;
        self.host
            .open(camino::Utf8Path::new(root))
            .map_err(|error| {
                if fub_host::automation::is_writer_busy(&error) {
                    Failure::new(
                        5,
                        "busy",
                        "vault già aperto da un writer: usa l'istanza proprietaria o riprova",
                    )
                } else {
                    Failure::from_plugin(&error)
                }
            })?;
        self.vault = Some(root.to_string());
        self.wait_indexed()
    }

    /// Aspetta che l'apertura abbia indicizzato il vault. Un comando secco
    /// apre, domanda ed esce: senza questa attesa backlink, vicini, tag,
    /// proprietà e wikilink risponderebbero vuoti con `ok: true`, e il piano
    /// di un `--dry-run` che chiede i backlink sottostimerebbe le note toccate.
    /// L'attesa si interrompe con SIGINT come le altre della CLI.
    fn wait_indexed(&self) -> Result<(), Failure> {
        const TICK: std::time::Duration = std::time::Duration::from_millis(100);
        while !self
            .host
            .wait_indexed_for(self.vault_selector(), TICK)
            .map_err(|error| Failure::from_plugin(&error))?
        {
            if crate::interrupted() {
                return Err(Failure::new(130, "cancelled", "interrotto da SIGINT"));
            }
        }
        Ok(())
    }

    pub fn vault_selector(&self) -> Option<&str> {
        // `""` = corrente per Host::with_session; None = corrente.
        self.vault.as_deref()
    }

    pub fn describe(&self) -> String {
        self.vault
            .clone()
            .unwrap_or_else(|| "(corrente)".to_string())
    }

    pub fn command_names(&self) -> Vec<String> {
        self.host
            .commands(self.vault_selector())
            .map(|specs| specs.into_iter().map(|s| s.id).collect())
            .unwrap_or_default()
    }
}

/// Paginazione locale su elenchi già in memoria: offset oltre la fine = pagina
/// vuota, mai errore. Il totale resta quello vero.
pub fn paginate<T: Clone>(items: Vec<T>, offset: u32, limit: Option<u32>) -> (Vec<T>, u32) {
    let total = items.len() as u32;
    let start = (offset as usize).min(items.len());
    let end = match limit {
        Some(n) => start.saturating_add(n as usize).min(items.len()),
        None => items.len(),
    };
    (items[start..end].to_vec(), total)
}

pub fn doc_id(raw: &str) -> Result<fub_abi::DocId, Failure> {
    fub_host::doc_id(raw).map_err(|error| Failure::from_plugin(&error))
}

pub fn read_stdin_text() -> Result<String, Failure> {
    use std::io::Read;
    let mut buf = String::new();
    std::io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| Failure::local(format!("stdin: {e}")))?;
    Ok(buf)
}

pub fn read_file_text(path: &str) -> Result<String, Failure> {
    std::fs::read_to_string(path).map_err(|e| Failure::new(1, "local", format!("{path}: {e}")))
}

pub fn parse_json_object(raw: &str) -> Result<serde_json::Value, Failure> {
    if raw.trim().is_empty() {
        return Ok(serde_json::Value::Object(Default::default()));
    }
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| Failure::bad_args(format!("JSON non valido: {e}")))?;
    match value {
        serde_json::Value::Object(_) | serde_json::Value::Null => Ok(value),
        _ => Err(Failure::bad_args("gli argomenti sono un oggetto JSON")),
    }
}
