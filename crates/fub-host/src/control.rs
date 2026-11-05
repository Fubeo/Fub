//! **Il canale di controllo**: un altro processo dell'utente (la CLI, l'host
//! nativo del clipper) che lavora su un vault che l'app tiene aperto.
//!
//! Il lock di scrittura fra processi resta uno: lo tiene la sessione dell'app,
//! e chi arriva dopo trova il vault occupato. Invece di aspettare che l'app si
//! chiuda, chi arriva chiede all'app, e l'app fa il lavoro con le sue porte:
//! le stesse regole, lo stesso `Guard`, gli stessi eventi che ridisegnano la
//! shell e segnalano un conflitto a chi sta scrivendo la stessa nota. Nessun
//! secondo writer, quindi, e nessuna copia della business logic.
//!
//! Le chiamate ([`Call`]) sono le porte generiche dell'host, non i comandi
//! della CLI: indice, registro dei comandi, view, lettura e scrittura con
//! revisione, job. Servono soltanto i vault che l'app ha già aperto; il canale
//! non apre, non chiude e non cambia il vault corrente della finestra.
//!
//! # Fiducia
//!
//! Il server ascolta soltanto sul loopback, su una porta scelta dal sistema, e
//! risponde soltanto a chi porta il token: 32 byte casuali che stanno in
//! [`ENDPOINT`], un file del solo proprietario nella cartella di
//! configurazione. Chi può leggere quel file può già scrivere nei vault
//! dell'utente; chi non può, sulla stessa macchina, non ottiene niente. Il
//! confronto del token non dipende da quanti byte coincidono.
//!
//! # Vita
//!
//! [`ControlServer`] ha un owner: chiuderlo (o lasciarlo cadere) ferma
//! l'ascolto, aspetta il thread e toglie il file, se è ancora il suo. Un file
//! rimasto da un'app caduta punta a una porta che non risponde: chi chiama lo
//! tratta come «nessuna app», e il vault resta occupato come prima.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use camino::Utf8Path;
use fub_abi::command::InvokeMode;
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{IndexQuery, ViewInstance};
use fub_abi::ui::UiAction;
use fub_abi::{DocId, PluginError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Host;

/// Il file dell'indirizzo e del token, nella cartella di configurazione.
pub const ENDPOINT: &str = "control.endpoint";

/// Quanto può essere grande una domanda: un allegato del clipper (25 MiB) in
/// base64 ci sta, un vault intero no.
pub const MAX_REQUEST: u64 = 48 * 1024 * 1024;

/// Quante domande si servono insieme; oltre, si risponde «occupato».
const WORKERS: usize = 8;

/// Quanto si aspetta la domanda di chi si è collegato.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// L'attesa più lunga che un [`Call::WaitIndexed`] può chiedere.
const MAX_WAIT: Duration = Duration::from_secs(5);

/// Una porta dell'host, con il vault che la riguarda (`None`: il corrente
/// dell'app).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Call {
    /// Le radici dei vault aperti nell'app.
    Vaults,
    WaitIndexed {
        vault: Option<String>,
        timeout_ms: u64,
    },
    QueryIndex {
        vault: Option<String>,
        query: IndexQuery,
    },
    Commands {
        vault: Option<String>,
    },
    InvokeCommand {
        vault: Option<String>,
        command: String,
        args: Value,
        mode: InvokeMode,
    },
    InvokeJob {
        vault: Option<String>,
        plugin: String,
        job: String,
        payload: Value,
    },
    ReadDocument {
        vault: Option<String>,
        doc: DocId,
    },
    ReadModel {
        vault: Option<String>,
        doc: DocId,
    },
    WriteDocument {
        vault: Option<String>,
        doc: DocId,
        source: String,
        base: WriteBase,
    },
    WriteBytes {
        vault: Option<String>,
        doc: DocId,
        /// I byte, in base64 standard.
        bytes: String,
        expected: Option<Revision>,
    },
    Views {
        vault: Option<String>,
    },
    RenderView {
        vault: Option<String>,
        instance: ViewInstance,
    },
    ViewAction {
        vault: Option<String>,
        instance: ViewInstance,
        action: UiAction,
    },
    SetPluginEnabled {
        vault: Option<String>,
        id: String,
        enabled: bool,
    },
    SetSetting {
        vault: Option<String>,
        key: String,
        value: SettingValue,
    },
    /// La mappa dei componenti e il loro stato ([`Host::components`]).
    Components {
        vault: Option<String>,
    },
    /// Applica una scelta sui componenti, o la prova senza `apply`
    /// ([`Host::apply_components`]).
    ApplyComponents {
        vault: Option<String>,
        azione: crate::componenti::Azione,
        apply: bool,
    },
    ResetSetting {
        vault: Option<String>,
        key: String,
    },
    SessionNotice,
    StartupDiagnostics {
        vault: Option<String>,
    },
    /// La cattura di [`crate::capture::apply`], senza template.
    Capture {
        vault: Option<String>,
        payload: crate::automation::CapturePayloadV1,
    },
    /// La nota di `fub://new` ([`crate::capture::new_note`]).
    NewNote {
        vault: Option<String>,
        folder: Option<String>,
        name: Option<String>,
        title: Option<String>,
        template: Option<String>,
        mode: InvokeMode,
    },
    /// Le app Craft che aprono `doc` ([`Host::external_editors`]): all'app,
    /// perché «Già aperta» lo sa chi ha avviato i programmi.
    ExternalEditors {
        vault: Option<String>,
        doc: Option<String>,
    },
    /// Apre `path` con l'app `editor` ([`Host::open_with`]).
    OpenWith {
        vault: Option<String>,
        path: String,
        editor: String,
        page: Option<u32>,
    },
}

#[derive(Serialize, Deserialize)]
struct Request {
    token: String,
    call: Call,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Reply {
    Ok(Value),
    Err(PluginError),
}

fn to_value<T: Serialize>(value: T) -> Result<Value, PluginError> {
    serde_json::to_value(value).map_err(|error| PluginError::Internal(error.to_string().into()))
}

/// Risponde a `call` con le porte di `host`. È ciò che il server dell'app
/// esegue per ogni domanda.
pub fn answer(host: &Host, call: Call) -> Result<Value, PluginError> {
    match call {
        Call::Vaults => to_value(
            host.vaults()
                .into_iter()
                .map(|root| root.to_string())
                .collect::<Vec<_>>(),
        ),
        Call::WaitIndexed { vault, timeout_ms } => to_value(host.wait_indexed_for(
            vault.as_deref(),
            Duration::from_millis(timeout_ms).min(MAX_WAIT),
        )?),
        Call::QueryIndex { vault, query } => to_value(host.query_index(vault.as_deref(), query)?),
        Call::Commands { vault } => to_value(host.commands(vault.as_deref())?),
        Call::InvokeCommand {
            vault,
            command,
            args,
            mode,
        } => to_value(host.invoke_user_command(vault.as_deref(), &command, args, mode)?),
        Call::InvokeJob {
            vault,
            plugin,
            job,
            payload,
        } => to_value(host.invoke_job(vault.as_deref(), &plugin, &job, payload)?),
        Call::ReadDocument { vault, doc } => to_value(host.read_document(vault.as_deref(), &doc)?),
        Call::ReadModel { vault, doc } => to_value(host.read_model(vault.as_deref(), &doc)?),
        Call::WriteDocument {
            vault,
            doc,
            source,
            base,
        } => to_value(host.write_document(vault.as_deref(), &doc, &source, base)?),
        Call::WriteBytes {
            vault,
            doc,
            bytes,
            expected,
        } => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(bytes)
                .map_err(|_| PluginError::BadArgs(Text::key("host.control.not_base64")))?;
            to_value(host.write_document_bytes(vault.as_deref(), &doc, &bytes, expected)?)
        }
        Call::Views { vault } => to_value(host.views(vault.as_deref())?),
        Call::RenderView { vault, instance } => {
            to_value(host.render_view(vault.as_deref(), &instance)?)
        }
        Call::ViewAction {
            vault,
            instance,
            action,
        } => to_value(host.view_action(vault.as_deref(), &instance, action)?),
        Call::SetPluginEnabled { vault, id, enabled } => {
            to_value(host.set_plugin_enabled(vault.as_deref(), &id, enabled)?)
        }
        Call::Components { vault } => to_value(host.components(vault.as_deref())?),
        Call::ApplyComponents {
            vault,
            azione,
            apply,
        } => to_value(host.apply_components(vault.as_deref(), azione, apply)?),
        Call::SetSetting { vault, key, value } => {
            to_value(host.set_setting_for_user(vault.as_deref(), &key, value)?)
        }
        Call::ResetSetting { vault, key } => {
            to_value(host.reset_setting_for_user(vault.as_deref(), &key)?)
        }
        Call::SessionNotice => to_value(host.session_notice()),
        Call::StartupDiagnostics { vault } => to_value(host.startup_diagnostics(vault.as_deref())?),
        Call::Capture { vault, payload } => to_value(crate::capture::apply(
            host,
            vault.as_deref(),
            &payload,
            None,
        )?),
        Call::NewNote {
            vault,
            folder,
            name,
            title,
            template,
            mode,
        } => {
            let note = crate::capture::NewNote {
                folder: folder.as_deref(),
                name: name.as_deref(),
                title: title.as_deref(),
                template: template.as_deref(),
            };
            to_value(crate::capture::new_note(
                host,
                vault.as_deref(),
                &note,
                mode,
            )?)
        }
        Call::ExternalEditors { vault, doc } => {
            to_value(host.external_editors(vault.as_deref(), doc.as_deref())?)
        }
        Call::OpenWith {
            vault,
            path,
            editor,
            page,
        } => to_value(host.open_with(vault.as_deref(), &path, &editor, page)?),
    }
}

/// Dove trovare l'app: l'indirizzo e il token letti da [`ENDPOINT`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub addr: SocketAddr,
    token: String,
}

impl Endpoint {
    /// L'endpoint scritto in `config_dir`, se c'è e se è nella forma che il
    /// server scrive: del solo proprietario, una riga `indirizzo token`.
    pub fn read(config_dir: &Utf8Path) -> Option<Endpoint> {
        let line = crate::secret_file::owner_only(config_dir.join(ENDPOINT).as_std_path())?;
        let (addr, token) = line.split_once(' ')?;
        let addr: SocketAddr = addr.parse().ok()?;
        // Soltanto il loopback: un file che indica altrove non è dell'app.
        if !addr.ip().is_loopback() || token.len() != 64 {
            return None;
        }
        Some(Endpoint {
            addr,
            token: token.to_string(),
        })
    }

    fn line(&self) -> String {
        format!("{} {}", self.addr, self.token)
    }

    /// Fa la domanda e aspetta la risposta. Un'app che non risponde è
    /// [`PluginError::Unserved`].
    pub fn call(&self, call: Call) -> Result<Value, PluginError> {
        let unserved = |error: std::io::Error| {
            spoken(PluginError::Unserved(Text::message(
                "host.control.no_answer",
                vec![Arg::text("reason", error.to_string())],
            )))
        };
        let mut stream =
            TcpStream::connect_timeout(&self.addr, Duration::from_secs(2)).map_err(unserved)?;
        let request = Request {
            token: self.token.clone(),
            call,
        };
        let mut body = serde_json::to_vec(&request)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        body.push(b'\n');
        stream.write_all(&body).map_err(unserved)?;
        stream.flush().map_err(unserved)?;
        let mut reply = Vec::new();
        BufReader::new(stream)
            .take(MAX_REQUEST)
            .read_until(b'\n', &mut reply)
            .map_err(unserved)?;
        match serde_json::from_slice::<Reply>(&reply) {
            Ok(Reply::Ok(value)) => Ok(value),
            Ok(Reply::Err(error)) => Err(error),
            Err(_) => Err(spoken(PluginError::Unserved(Text::key(
                "host.control.closed",
            )))),
        }
    }

    /// Come [`call`](Endpoint::call), con la risposta nel suo tipo.
    pub fn call_as<T: serde::de::DeserializeOwned>(&self, call: Call) -> Result<T, PluginError> {
        let value = self.call(call)?;
        serde_json::from_value(value).map_err(|error| {
            spoken(PluginError::Internal(Text::message(
                "host.control.bad_reply",
                vec![Arg::text("reason", error.to_string())],
            )))
        })
    }
}

type Handler = dyn Fn(Call) -> Result<Value, PluginError> + Send + Sync;

/// Il server dell'app. Chi lo apre lo possiede; [`close`](ControlServer::close)
/// o il `Drop` lo fermano.
pub struct ControlServer {
    endpoint: Endpoint,
    path: PathBuf,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl ControlServer {
    /// Ascolta sul loopback e scrive [`ENDPOINT`] in `config_dir`. `handler`
    /// risponde alle domande: di solito `|call| answer(&host, call)`.
    pub fn start(
        config_dir: &Utf8Path,
        handler: impl Fn(Call) -> Result<Value, PluginError> + Send + Sync + 'static,
    ) -> std::io::Result<ControlServer> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let addr = listener.local_addr()?;
        let endpoint = Endpoint {
            addr,
            token: fresh_token()?,
        };
        let path = config_dir.join(ENDPOINT).into_std_path_buf();
        crate::secret_file::write_owner_only(&path, &endpoint.line())?;
        let stop = Arc::new(AtomicBool::new(false));
        let handler: Arc<Handler> = Arc::new(handler);
        let thread = {
            let stop = Arc::clone(&stop);
            let token = endpoint.token.clone();
            std::thread::Builder::new()
                .name("fub-control".into())
                .spawn(move || accept_loop(listener, stop, token, handler))?
        };
        Ok(ControlServer {
            endpoint,
            path,
            stop,
            thread: Some(thread),
        })
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// Ferma l'ascolto e toglie il file. Le domande già accettate finiscono.
    pub fn close(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        let Some(thread) = self.thread.take() else {
            return;
        };
        self.stop.store(true, Ordering::SeqCst);
        // `accept` non ha un timeout: lo si sveglia con una connessione.
        let _ = TcpStream::connect_timeout(&self.endpoint.addr, Duration::from_secs(1));
        let _ = thread.join();
        // Il file si toglie soltanto se è ancora questo: un'altra app partita
        // dopo ha scritto il suo.
        if crate::secret_file::owner_only(&self.path).as_deref() == Some(&self.endpoint.line()) {
            let _ = crate::secret_file::forget(&self.path);
        }
    }
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub(crate) fn fresh_token() -> std::io::Result<String> {
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| std::io::Error::other("random non disponibile"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Il confronto che non si ferma al primo byte diverso.
fn same_token(given: &str, expected: &str) -> bool {
    let (given, expected) = (given.as_bytes(), expected.as_bytes());
    given.len() == expected.len()
        && given
            .iter()
            .zip(expected)
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn accept_loop(listener: TcpListener, stop: Arc<AtomicBool>, token: String, handler: Arc<Handler>) {
    let active = Arc::new(AtomicUsize::new(0));
    let token: Arc<str> = token.into();
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = stream else {
            continue;
        };
        if active.fetch_add(1, Ordering::SeqCst) >= WORKERS {
            active.fetch_sub(1, Ordering::SeqCst);
            let _ = respond(
                &stream,
                Reply::Err(PluginError::Unserved(Text::key("host.control.busy"))),
            );
            continue;
        }
        let (active, token, handler) = (
            Arc::clone(&active),
            Arc::clone(&token),
            Arc::clone(&handler),
        );
        let spawned = std::thread::Builder::new()
            .name("fub-control-call".into())
            .spawn(move || {
                serve(stream, &token, &*handler);
                active.fetch_sub(1, Ordering::SeqCst);
            });
        if spawned.is_err() {
            tracing::warn!(target: "fub.host", "canale di controllo: thread non avviato");
        }
    }
}

fn serve(stream: TcpStream, token: &str, handler: &Handler) {
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let mut line = Vec::new();
    let read = BufReader::new(&stream)
        .take(MAX_REQUEST)
        .read_until(b'\n', &mut line);
    let reply = match read {
        Err(_) => return,
        Ok(_) if !line.ends_with(b"\n") => {
            Reply::Err(PluginError::BadArgs(Text::key("host.control.too_large")))
        }
        Ok(_) => match serde_json::from_slice::<Request>(&line) {
            Err(_) => Reply::Err(PluginError::BadArgs(Text::key("host.control.unreadable"))),
            Ok(request) if !same_token(&request.token, token) => {
                tracing::warn!(target: "fub.host", "canale di controllo: token rifiutato");
                Reply::Err(PluginError::PermissionDenied(Text::key(
                    "host.control.bad_token",
                )))
            }
            Ok(request) => match handler(request.call) {
                Ok(value) => Reply::Ok(value),
                Err(error) => Reply::Err(error),
            },
        },
    };
    let _ = respond(&stream, reply);
}

fn respond(mut stream: &TcpStream, reply: Reply) -> std::io::Result<()> {
    let reply = match reply {
        Reply::Err(error) => Reply::Err(spoken(error)),
        ok => ok,
    };
    let mut body = serde_json::to_vec(&reply).map_err(std::io::Error::other)?;
    body.push(b'\n');
    stream.write_all(&body)?;
    stream.flush()
}

/// Un errore del canale detto in parole: dall'altra parte c'è un terminale, che
/// non ha un catalogo e stamperebbe la chiave. Le chiavi sono del core, e
/// senza un vault di cui leggere la lingua vale quella di serie del core.
fn spoken(mut error: PluginError) -> PluginError {
    let catalogs = crate::settings::core_catalog_assembled();
    let locale = fub_abi::locale::Locale::default();
    fub_abi::text::Strings::new(&catalogs, crate::settings::CORE_DEFAULT_LOCALE, &locale)
        .localize(&mut error);
    error
}

/// La cartella che il server e i client usano per [`ENDPOINT`]: quella data,
/// o quella dell'host.
pub fn endpoint_path(config_dir: &Utf8Path) -> PathBuf {
    config_dir.join(ENDPOINT).into_std_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> (tempfile::TempDir, camino::Utf8PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let path = camino::Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).unwrap();
        (tmp, path)
    }

    #[test]
    fn a_call_with_the_token_is_answered_and_one_without_is_refused() {
        let (_tmp, dir) = dir();
        let server = ControlServer::start(&dir, |call| match call {
            Call::Vaults => Ok(serde_json::json!(["/v"])),
            _ => Err(PluginError::NotFound("no".into())),
        })
        .unwrap();
        let endpoint = Endpoint::read(&dir).expect("il file del server");
        assert_eq!(&endpoint, server.endpoint());
        let vaults: Vec<String> = endpoint.call_as(Call::Vaults).unwrap();
        assert_eq!(vaults, ["/v"]);
        assert!(matches!(
            endpoint.call(Call::SessionNotice),
            Err(PluginError::NotFound(_))
        ));
        let forged = Endpoint {
            token: "0".repeat(64),
            ..endpoint.clone()
        };
        assert!(matches!(
            forged.call(Call::Vaults),
            Err(PluginError::PermissionDenied(_))
        ));
        server.close();
        assert!(!endpoint_path(&dir).exists());
        assert!(matches!(
            endpoint.call(Call::Vaults),
            Err(PluginError::Unserved(_))
        ));
    }

    #[test]
    fn closing_leaves_the_file_of_a_newer_server() {
        let (_tmp, dir) = dir();
        let old = ControlServer::start(&dir, |_| Ok(Value::Null)).unwrap();
        let new = ControlServer::start(&dir, |_| Ok(Value::Null)).unwrap();
        drop(old);
        assert_eq!(Endpoint::read(&dir).as_ref(), Some(new.endpoint()));
        drop(new);
        assert_eq!(Endpoint::read(&dir), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_others_can_read_is_not_an_endpoint() {
        use std::os::unix::fs::PermissionsExt;
        let (_tmp, dir) = dir();
        let server = ControlServer::start(&dir, |_| Ok(Value::Null)).unwrap();
        let path = endpoint_path(&dir);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(Endpoint::read(&dir), None);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        drop(server);
    }

    /// Il tag `op` di ogni chiamata. Il `match` senza `_` obbliga chi aggiunge
    /// una chiamata a dargli un nome qui, e quindi a metterla in
    /// [`every_call`].
    fn op(call: &Call) -> &'static str {
        match call {
            Call::Vaults => "vaults",
            Call::WaitIndexed { .. } => "wait_indexed",
            Call::QueryIndex { .. } => "query_index",
            Call::Commands { .. } => "commands",
            Call::InvokeCommand { .. } => "invoke_command",
            Call::InvokeJob { .. } => "invoke_job",
            Call::ReadDocument { .. } => "read_document",
            Call::ReadModel { .. } => "read_model",
            Call::WriteDocument { .. } => "write_document",
            Call::WriteBytes { .. } => "write_bytes",
            Call::Views { .. } => "views",
            Call::RenderView { .. } => "render_view",
            Call::ViewAction { .. } => "view_action",
            Call::SetPluginEnabled { .. } => "set_plugin_enabled",
            Call::SetSetting { .. } => "set_setting",
            Call::Components { .. } => "components",
            Call::ApplyComponents { .. } => "apply_components",
            Call::ResetSetting { .. } => "reset_setting",
            Call::SessionNotice => "session_notice",
            Call::StartupDiagnostics { .. } => "startup_diagnostics",
            Call::Capture { .. } => "capture",
            Call::NewNote { .. } => "new_note",
            Call::ExternalEditors { .. } => "external_editors",
            Call::OpenWith { .. } => "open_with",
        }
    }

    const CALLS: usize = 24;

    fn every_call() -> Vec<Call> {
        let vault = || Some("/v".to_string());
        let doc = || DocId::new("Note/a.md");
        let instance = ViewInstance::only("fub.graph");
        vec![
            Call::Vaults,
            Call::WaitIndexed {
                vault: vault(),
                timeout_ms: 100,
            },
            Call::QueryIndex {
                vault: vault(),
                query: IndexQuery::Tags {
                    matching: Default::default(),
                    page: None,
                },
            },
            Call::Commands { vault: None },
            Call::InvokeCommand {
                vault: vault(),
                command: "note.create".into(),
                args: serde_json::json!({ "name": "a.md" }),
                mode: InvokeMode::DryRun,
            },
            Call::InvokeJob {
                vault: vault(),
                plugin: "fub.craft".into(),
                job: "craft.render".into(),
                payload: serde_json::json!({}),
            },
            Call::ReadDocument {
                vault: vault(),
                doc: doc(),
            },
            Call::ReadModel {
                vault: None,
                doc: doc(),
            },
            Call::WriteDocument {
                vault: vault(),
                doc: doc(),
                source: "# A\n".into(),
                base: WriteBase::DescendsFrom(Revision::new("1")),
            },
            Call::WriteBytes {
                vault: vault(),
                doc: doc(),
                bytes: "AA==".into(),
                expected: None,
            },
            Call::Views { vault: vault() },
            Call::RenderView {
                vault: vault(),
                instance: instance.clone(),
            },
            Call::ViewAction {
                vault: vault(),
                instance,
                action: UiAction {
                    action: fub_abi::ui::ActionId("open".into()),
                    payload: Value::Null,
                    fields: Vec::new(),
                },
            },
            Call::SetPluginEnabled {
                vault: vault(),
                id: "fub.graph".into(),
                enabled: false,
            },
            Call::SetSetting {
                vault: vault(),
                key: "craft.cli-previews".into(),
                value: SettingValue::Text("ask".into()),
            },
            Call::Components { vault: vault() },
            Call::ApplyComponents {
                vault: vault(),
                azione: crate::componenti::Azione::Accendi {
                    id: "fub.graph".into(),
                },
                apply: false,
            },
            Call::ResetSetting {
                vault: vault(),
                key: "craft.cli-previews".into(),
            },
            Call::SessionNotice,
            Call::StartupDiagnostics { vault: None },
            Call::Capture {
                vault: vault(),
                payload: crate::automation::CapturePayloadV1 {
                    v: 1,
                    title: "T".into(),
                    markdown: "x".into(),
                    source_url: None,
                    properties: None,
                    target: crate::automation::CaptureTarget {
                        vault: None,
                        folder: None,
                        note: None,
                        mode: crate::automation::CaptureMode::Create,
                    },
                },
            },
            Call::NewNote {
                vault: vault(),
                folder: Some("Note".into()),
                name: None,
                title: Some("T".into()),
                template: None,
                mode: InvokeMode::Apply,
            },
            Call::ExternalEditors {
                vault: vault(),
                doc: Some("Disegni/logo.vectorcraft".into()),
            },
            Call::OpenWith {
                vault: None,
                path: "Documenti/carta.pdf".into(),
                editor: "pdfcraft".into(),
                page: Some(3),
            },
        ]
    }

    #[test]
    fn every_call_crosses_json_with_its_op_and_comes_back_the_same() {
        let calls = every_call();
        let ops: std::collections::BTreeSet<&str> = calls.iter().map(op).collect();
        assert_eq!(ops.len(), CALLS, "one sample for each call");
        assert_eq!(calls.len(), CALLS);
        for call in calls {
            let json = serde_json::to_value(&call).unwrap();
            assert_eq!(json["op"], op(&call), "{json}");
            let request = Request {
                token: "t".into(),
                call: call.clone(),
            };
            let line = serde_json::to_vec(&request).unwrap();
            let back: Request = serde_json::from_slice(&line).unwrap();
            assert_eq!(back.call, call, "{json}");
        }
        // Le forme delle due chiamate di «Apri con», come le scrive la CLI.
        assert_eq!(
            serde_json::to_value(Call::ExternalEditors {
                vault: None,
                doc: None
            })
            .unwrap(),
            serde_json::json!({ "op": "external_editors", "vault": null, "doc": null })
        );
        assert_eq!(
            serde_json::from_value::<Call>(serde_json::json!({
                "op": "open_with", "vault": "/v", "path": "a.pdf", "editor": "pdfcraft", "page": null
            }))
            .unwrap(),
            Call::OpenWith {
                vault: Some("/v".into()),
                path: "a.pdf".into(),
                editor: "pdfcraft".into(),
                page: None,
            }
        );
    }

    /// Un vault vuoto aperto da un host senza watcher, con la sua configurazione.
    fn opened() -> (tempfile::TempDir, Host) {
        let tmp = tempfile::tempdir().unwrap();
        let root = camino::Utf8PathBuf::from_path_buf(tmp.path().join("vault")).unwrap();
        std::fs::create_dir_all(root.join("Disegni")).unwrap();
        std::fs::write(root.join("Disegni/logo.vectorcraft"), b"{}").unwrap();
        let config = camino::Utf8PathBuf::from_path_buf(tmp.path().join("config")).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let host = Host::without_watcher().with_config_dir(&config);
        host.open(&root).unwrap();
        (tmp, host)
    }

    fn key_of(error: &PluginError) -> Option<String> {
        let text = match error {
            PluginError::BadArgs(text)
            | PluginError::NotFound(text)
            | PluginError::Unserved(text)
            | PluginError::Io(text) => text,
            _ => return None,
        };
        text.as_message().map(|message| message.key.clone())
    }

    #[test]
    fn the_open_with_calls_are_answered_by_the_host_methods() {
        let (_tmp, host) = opened();
        let editors: Vec<crate::open_with::ExternalEditor> = serde_json::from_value(
            answer(
                &host,
                Call::ExternalEditors {
                    vault: None,
                    doc: Some("Disegni/logo.vectorcraft".into()),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            editors,
            host.external_editors(None, Some("Disegni/logo.vectorcraft"))
                .unwrap()
        );
        let unknown = answer(
            &host,
            Call::OpenWith {
                vault: None,
                path: "Disegni/logo.vectorcraft".into(),
                editor: "paintcraft".into(),
                page: None,
            },
        )
        .unwrap_err();
        #[cfg(feature = "craft")]
        {
            let ids: Vec<&str> = editors.iter().map(|editor| editor.id.as_str()).collect();
            assert_eq!(ids, ["vectorcraft"]);
            // Nessuna app avviata da questo host: nessuna è «Già aperta».
            assert!(editors.iter().all(|editor| !editor.running));
            assert!(matches!(unknown, PluginError::BadArgs(_)), "{unknown:?}");
            assert_eq!(
                key_of(&unknown).as_deref(),
                Some("host.open_with.unknown_editor")
            );
        }
        #[cfg(not(feature = "craft"))]
        {
            assert!(editors.is_empty());
            assert_eq!(key_of(&unknown).as_deref(), Some("host.open_with.off"));
        }
    }

    #[test]
    fn the_open_with_calls_cross_the_channel() {
        let (_tmp, host) = opened();
        let host = Arc::new(host);
        let (config_tmp, config) = dir();
        let served = Arc::clone(&host);
        let server = ControlServer::start(&config, move |call| answer(&served, call)).unwrap();
        let endpoint = Endpoint::read(&config).unwrap();
        let editors: Vec<crate::open_with::ExternalEditor> = endpoint
            .call_as(Call::ExternalEditors {
                vault: None,
                doc: None,
            })
            .unwrap();
        assert_eq!(editors, host.external_editors(None, None).unwrap());
        // L'errore torna col suo tipo, detto in parole per il terminale.
        let error = endpoint
            .call(Call::OpenWith {
                vault: None,
                path: "Disegni/logo.vectorcraft".into(),
                editor: "paintcraft".into(),
                page: None,
            })
            .unwrap_err();
        #[cfg(feature = "craft")]
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        #[cfg(not(feature = "craft"))]
        assert!(matches!(error, PluginError::Unserved(_)), "{error:?}");
        server.close();
        drop(config_tmp);
    }

    #[test]
    fn the_token_compare_wants_every_byte() {
        assert!(same_token("abcd", "abcd"));
        assert!(!same_token("abce", "abcd"));
        assert!(!same_token("abc", "abcd"));
    }
}
