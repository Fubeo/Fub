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
                .map_err(|_| PluginError::BadArgs("byte non in base64".into()))?;
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
            PluginError::Unserved(
                format!("l'app non risponde sul canale di controllo: {error}").into(),
            )
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
            Err(_) => Err(PluginError::Unserved(
                "l'app ha chiuso il canale di controllo senza rispondere".into(),
            )),
        }
    }

    /// Come [`call`](Endpoint::call), con la risposta nel suo tipo.
    pub fn call_as<T: serde::de::DeserializeOwned>(&self, call: Call) -> Result<T, PluginError> {
        let value = self.call(call)?;
        serde_json::from_value(value)
            .map_err(|error| PluginError::Internal(format!("risposta del canale: {error}").into()))
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

fn fresh_token() -> std::io::Result<String> {
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
                Reply::Err(PluginError::Unserved(
                    "l'app sta già servendo troppe domande: riprova".into(),
                )),
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
        Ok(_) if !line.ends_with(b"\n") => Reply::Err(PluginError::BadArgs(
            "domanda troppo grande o interrotta".into(),
        )),
        Ok(_) => match serde_json::from_slice::<Request>(&line) {
            Err(_) => Reply::Err(PluginError::BadArgs("domanda illeggibile".into())),
            Ok(request) if !same_token(&request.token, token) => {
                tracing::warn!(target: "fub.host", "canale di controllo: token rifiutato");
                Reply::Err(PluginError::PermissionDenied(
                    "token del canale non valido".into(),
                ))
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
    let mut body = serde_json::to_vec(&reply).map_err(std::io::Error::other)?;
    body.push(b'\n');
    stream.write_all(&body)?;
    stream.flush()
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

    #[test]
    fn the_token_compare_wants_every_byte() {
        assert!(same_token("abcd", "abcd"));
        assert!(!same_token("abce", "abcd"));
        assert!(!same_token("abc", "abcd"));
    }
}
