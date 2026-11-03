//! Il canale fra Fub e un'app Craft che ha in prestito un file del vault.
//!
//! Un'app Craft avviata da Fub con un token scelto da Fub può ricevere «apri
//! questo file» nella finestra che ha già. Il canale è scritto una volta sola,
//! anche se nessuna app della tabella ([`super::editors`]) lo permette ancora
//! (D-2), e vale soltanto con [`Auth::Token`]: un canale senza autenticazione
//! lo potrebbe usare qualunque programma della macchina, e la «chiave» di
//! WordCraft ha un formato che nessuno ha documentato. [`Channel::for_control`]
//! lo decide con un `match` esaustivo.
//!
//! È un canale diverso da quello di Fub ([`crate::control`]): lì Fub ascolta e
//! la CLI parla, qui Fub parla e l'app ascolta. Del canale di Fub si riusa
//! soltanto il token, 32 byte casuali.
//!
//! Le regole:
//!
//! - l'indirizzo è sempre il loopback, `127.0.0.1` e poi `::1`, costruito da
//!   Fub e mai risolto da un nome; la porta la sa chi ha avviato l'app;
//! - la connessione aspetta al più [`CONNECT_TIME`], ogni risposta al più
//!   [`REPLY_TIME`] in tutto (anche se arriva un byte alla volta);
//! - una richiesta è un oggetto JSON per riga; con [`Framing::JsonRpc2`] porta
//!   `"jsonrpc":"2.0"` e un `id`, e la risposta deve ripetere lo stesso `id`;
//! - una risposta è una riga di al più [`REPLY_MAX`] byte; una risposta con
//!   `error` è [`ChannelError::Refused`];
//! - il token non esce mai: il `Debug` di [`Channel`] lo nasconde, gli errori
//!   non hanno testo e le risposte non si tengono.

use std::fmt;
use std::io::{self, BufRead, BufReader, ErrorKind, Write};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use super::editors::{Auth, Control};

/// La cornice dei messaggi: la stessa della tabella delle app.
pub use super::editors::Protocol as Framing;

/// Quanto si aspetta la connessione.
pub const CONNECT_TIME: Duration = Duration::from_secs(1);
/// Quanto si aspetta una risposta intera, e quanto può durare una scrittura.
pub const REPLY_TIME: Duration = Duration::from_secs(2);
/// Il peso massimo di una risposta, fine riga esclusa.
pub const REPLY_MAX: usize = 64 * 1024;

/// Perché il canale non ha aperto il file. Senza testo: lo mettono i
/// chiamanti con le chiavi del loro catalogo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelError {
    /// Nessuna app ascolta sulla porta, o la connessione è caduta.
    Unreachable,
    /// L'app ha risposto con un errore: al token o al comando.
    Refused,
    /// La risposta non si capisce (troppo lunga, non JSON, un altro `id`,
    /// nessuna risposta), o la richiesta non si può scrivere (un percorso che
    /// non è UTF-8).
    BadReply,
    /// L'app non ha risposto in tempo.
    TimedOut,
}

/// Il canale verso un'app Craft avviata da Fub con il token di [`Channel`].
pub struct Channel {
    port: u16,
    token: String,
    framing: Framing,
}

impl fmt::Debug for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Channel")
            .field("port", &self.port)
            .field("token", &"<nascosto>")
            .field("framing", &self.framing)
            .finish()
    }
}

impl Channel {
    /// Un canale verso `port` con un token nuovo, da dare all'app quando la si
    /// avvia ([`Channel::token`]). Sbaglia soltanto se il sistema non dà
    /// numeri casuali.
    pub fn new(port: u16, framing: Framing) -> io::Result<Channel> {
        Ok(Channel {
            port,
            token: crate::control::fresh_token()?,
            framing,
        })
    }

    /// Il canale di un'app della tabella, se la sua autenticazione lo
    /// permette: soltanto [`Auth::Token`], e soltanto con un metodo che apre
    /// un file. Il `match` è esaustivo perché un'autenticazione nuova debba
    /// decidere qui. Chi lo chiama ha avviato l'app con questo token.
    pub fn for_control(control: &Control, port: u16) -> io::Result<Option<Channel>> {
        let token = match control.auth {
            Auth::Token { .. } => true,
            Auth::None | Auth::Key => false,
        };
        if !token || control.method.is_none() {
            return Ok(None);
        }
        Channel::new(port, control.protocol).map(Some)
    }

    /// Il token, da passare all'app che si avvia (nella variabile della
    /// tabella o come dice il passo). Non va scritto in nessun log.
    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn framing(&self) -> Framing {
        self.framing
    }

    /// L'autenticazione: l'unico punto che la scrive. Il passo non ne dice il
    /// formato; quando un'app lo documenta si cambia qui.
    fn auth_request(&self) -> Value {
        json!({"method": "auth", "params": {"token": self.token}})
    }

    /// Il comando che apre `path` nella finestra che l'app ha già.
    fn open_request(&self, path: &str) -> Value {
        let method = match self.framing {
            Framing::Line => "app.open",
            Framing::JsonRpc2 => "ui.open",
        };
        json!({"method": method, "params": {"path": path}})
    }

    /// Chiede all'app di aprire `path`: prima l'autenticazione, poi il
    /// comando, una risposta per richiesta. Un percorso che non è UTF-8 è
    /// [`ChannelError::BadReply`] prima di connettersi: il JSON vuole UTF-8.
    pub fn open(&self, path: &Path) -> Result<(), ChannelError> {
        let path = path.to_str().ok_or(ChannelError::BadReply)?;
        let requests = [self.auth_request(), self.open_request(path)];
        let mut conn = Conn::connect(self.port)?;
        for (id, request) in (1u64..).zip(requests) {
            let line = self.frame(id, request)?;
            conn.send(&line)?;
            let reply = conn.reply()?;
            self.judge(id, &reply)?;
        }
        Ok(())
    }

    /// La riga di una richiesta, con la cornice.
    fn frame(&self, id: u64, request: Value) -> Result<Vec<u8>, ChannelError> {
        let request = match (self.framing, request) {
            (Framing::Line, request) => request,
            (Framing::JsonRpc2, Value::Object(fields)) => {
                let mut framed = Map::new();
                framed.insert("jsonrpc".into(), Value::from("2.0"));
                framed.insert("id".into(), Value::from(id));
                framed.extend(fields);
                Value::Object(framed)
            }
            (Framing::JsonRpc2, _) => return Err(ChannelError::BadReply),
        };
        let mut line = serde_json::to_vec(&request).map_err(|_| ChannelError::BadReply)?;
        line.push(b'\n');
        Ok(line)
    }

    /// Una risposta: un oggetto JSON; con `error` è un rifiuto.
    fn judge(&self, id: u64, reply: &[u8]) -> Result<(), ChannelError> {
        let Ok(Value::Object(reply)) = serde_json::from_slice::<Value>(reply) else {
            return Err(ChannelError::BadReply);
        };
        if self.framing == Framing::JsonRpc2 {
            if reply.get("id") != Some(&Value::from(id)) {
                return Err(ChannelError::BadReply);
            }
            if !reply.contains_key("result") && !reply.contains_key("error") {
                return Err(ChannelError::BadReply);
            }
        }
        match reply.get("error") {
            None | Some(Value::Null) => Ok(()),
            Some(_) => Err(ChannelError::Refused),
        }
    }
}

/// Una connessione aperta, con quanto si è letto oltre l'ultima riga.
struct Conn {
    reader: BufReader<TcpStream>,
}

impl Conn {
    /// Il loopback, prima IPv4 e poi IPv6: un'app può ascoltare su uno solo.
    fn connect(port: u16) -> Result<Conn, ChannelError> {
        let addrs = [
            SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
        ];
        let mut failure = ChannelError::Unreachable;
        for addr in addrs {
            match TcpStream::connect_timeout(&addr, CONNECT_TIME) {
                Ok(stream) => {
                    stream
                        .set_write_timeout(Some(REPLY_TIME))
                        .map_err(|_| ChannelError::Unreachable)?;
                    // Le richieste sono piccole: partono subito.
                    let _ = stream.set_nodelay(true);
                    return Ok(Conn {
                        reader: BufReader::new(stream),
                    });
                }
                Err(error) if timed_out(&error) => failure = ChannelError::TimedOut,
                Err(_) => {}
            }
        }
        Err(failure)
    }

    fn send(&mut self, line: &[u8]) -> Result<(), ChannelError> {
        self.reader.get_mut().write_all(line).map_err(io_error)
    }

    /// Una riga di risposta, senza la fine riga, entro [`REPLY_TIME`] in tutto
    /// e [`REPLY_MAX`] byte; quanto arriva dopo la riga resta per la prossima.
    fn reply(&mut self) -> Result<Vec<u8>, ChannelError> {
        let deadline = Instant::now() + REPLY_TIME;
        let mut line = Vec::new();
        loop {
            let left = deadline
                .checked_duration_since(Instant::now())
                .filter(|left| !left.is_zero())
                .ok_or(ChannelError::TimedOut)?;
            self.reader
                .get_ref()
                .set_read_timeout(Some(left))
                .map_err(|_| ChannelError::Unreachable)?;
            let (used, done) = {
                let chunk = match self.reader.fill_buf() {
                    Ok(chunk) => chunk,
                    Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                    Err(error) => return Err(io_error(error)),
                };
                if chunk.is_empty() {
                    // L'app ha chiuso senza finire la riga.
                    return Err(ChannelError::BadReply);
                }
                let end = chunk.iter().position(|byte| *byte == b'\n');
                let body = end.unwrap_or(chunk.len());
                if line.len() + body > REPLY_MAX {
                    return Err(ChannelError::BadReply);
                }
                line.extend_from_slice(&chunk[..body]);
                match end {
                    Some(end) => (end + 1, true),
                    None => (body, false),
                }
            };
            self.reader.consume(used);
            if done {
                return Ok(line);
            }
        }
    }
}

fn timed_out(error: &io::Error) -> bool {
    matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock)
}

fn io_error(error: io::Error) -> ChannelError {
    if timed_out(&error) {
        ChannelError::TimedOut
    } else {
        ChannelError::Unreachable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::thread::{self, JoinHandle};

    /// Quanto il server di prova aspetta il client prima di arrendersi: più
    /// di [`REPLY_TIME`], perché un test non finisca prima del client.
    const SERVER_WAIT: Duration = Duration::from_secs(10);

    /// Un'app finta su `127.0.0.1:0`: accetta una connessione, la passa a
    /// `script` e restituisce quello che `script` restituisce. Il thread si
    /// unisce sempre nel test, così nessun socket resta vivo.
    fn app<T: Send + 'static>(
        script: impl FnOnce(&mut BufReader<TcpStream>) -> T + Send + 'static,
    ) -> (u16, JoinHandle<T>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let thread = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            stream.set_read_timeout(Some(SERVER_WAIT)).expect("timeout");
            stream
                .set_write_timeout(Some(SERVER_WAIT))
                .expect("timeout");
            let mut reader = BufReader::new(stream);
            script(&mut reader)
        });
        (port, thread)
    }

    fn request(reader: &mut BufReader<TcpStream>) -> Value {
        let mut line = String::new();
        reader.read_line(&mut line).expect("richiesta");
        serde_json::from_str(&line).expect("json")
    }

    fn answer(reader: &mut BufReader<TcpStream>, reply: &Value) {
        let mut line = serde_json::to_vec(reply).expect("json");
        line.push(b'\n');
        reader.get_mut().write_all(&line).expect("risposta");
    }

    /// Aspetta che il client chiuda: un server che non risponde non deve
    /// chiudere per primo.
    fn until_closed(reader: &mut BufReader<TcpStream>) {
        let mut rest = Vec::new();
        let _ = reader.read_to_end(&mut rest);
    }

    fn file() -> PathBuf {
        PathBuf::from("/vault/disegni/logo.vectorcraft")
    }

    #[test]
    fn line_sends_auth_then_app_open_and_accepts_the_replies() {
        let (port, server) = app(|conn| {
            let auth = request(conn);
            answer(conn, &json!({"result": "ok"}));
            let open = request(conn);
            answer(conn, &json!({"ok": true}));
            (auth, open)
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Ok(()));
        let (auth, open) = server.join().expect("server");
        assert_eq!(
            auth,
            json!({"method": "auth", "params": {"token": channel.token()}})
        );
        assert_eq!(
            open,
            json!({"method": "app.open", "params": {"path": "/vault/disegni/logo.vectorcraft"}})
        );
    }

    #[test]
    fn json_rpc_frames_both_requests_with_their_ids() {
        let (port, server) = app(|conn| {
            let auth = request(conn);
            answer(conn, &json!({"jsonrpc": "2.0", "id": 1, "result": null}));
            let open = request(conn);
            answer(conn, &json!({"jsonrpc": "2.0", "id": 2, "result": {}}));
            (auth, open)
        });
        let channel = Channel::new(port, Framing::JsonRpc2).expect("canale");
        assert_eq!(channel.open(&file()), Ok(()));
        let (auth, open) = server.join().expect("server");
        assert_eq!(
            auth,
            json!({"jsonrpc": "2.0", "id": 1, "method": "auth",
                   "params": {"token": channel.token()}})
        );
        assert_eq!(
            open,
            json!({"jsonrpc": "2.0", "id": 2, "method": "ui.open",
                   "params": {"path": "/vault/disegni/logo.vectorcraft"}})
        );
    }

    #[test]
    fn two_replies_in_one_write_are_read_one_per_request() {
        let (port, server) = app(|conn| {
            request(conn);
            conn.get_mut()
                .write_all(b"{\"result\":1}\n{\"result\":2}\n")
                .expect("risposte");
            request(conn)
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Ok(()));
        assert_eq!(server.join().expect("server")["method"], "app.open");
    }

    #[test]
    fn an_error_to_the_auth_is_refused_and_the_command_is_not_sent() {
        let (port, server) = app(|conn| {
            request(conn);
            answer(conn, &json!({"error": {"code": 401}}));
            let mut rest = Vec::new();
            let _ = conn.read_to_end(&mut rest);
            rest
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::Refused));
        assert!(server.join().expect("server").is_empty());
    }

    #[test]
    fn an_error_to_the_command_is_refused() {
        let (port, server) = app(|conn| {
            request(conn);
            answer(conn, &json!({"jsonrpc": "2.0", "id": 1, "result": true}));
            request(conn);
            answer(
                conn,
                &json!({"jsonrpc": "2.0", "id": 2, "error": {"code": -32000, "message": "no"}}),
            );
        });
        let channel = Channel::new(port, Framing::JsonRpc2).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::Refused));
        server.join().expect("server");
    }

    #[test]
    fn a_reply_that_is_not_json_is_bad() {
        let (port, server) = app(|conn| {
            request(conn);
            conn.get_mut().write_all(b"ciao\n").expect("risposta");
            until_closed(conn);
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::BadReply));
        server.join().expect("server");
    }

    #[test]
    fn a_reply_with_another_id_is_bad() {
        let (port, server) = app(|conn| {
            request(conn);
            answer(conn, &json!({"jsonrpc": "2.0", "id": 7, "result": true}));
            until_closed(conn);
        });
        let channel = Channel::new(port, Framing::JsonRpc2).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::BadReply));
        server.join().expect("server");
    }

    #[test]
    fn a_json_rpc_reply_without_result_or_error_is_bad() {
        let (port, server) = app(|conn| {
            request(conn);
            answer(conn, &json!({"jsonrpc": "2.0", "id": 1}));
            until_closed(conn);
        });
        let channel = Channel::new(port, Framing::JsonRpc2).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::BadReply));
        server.join().expect("server");
    }

    #[test]
    fn a_reply_of_one_mebibyte_without_newline_stops_at_the_limit() {
        let (port, server) = app(|conn| {
            request(conn);
            // Il client smette di leggere: la scrittura può fallire, va bene.
            let _ = conn.get_mut().write_all(&vec![b'x'; 1024 * 1024]);
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::BadReply));
        server.join().expect("server");
    }

    #[test]
    fn a_reply_of_exactly_the_limit_is_read() {
        let (port, server) = app(|conn| {
            request(conn);
            // `{"result":"…"}` lungo esattamente REPLY_MAX byte.
            let filler = "x".repeat(REPLY_MAX - "{\"result\":\"\"}".len());
            answer(conn, &json!({"result": filler}));
            request(conn);
            answer(conn, &json!({"result": true}));
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Ok(()));
        server.join().expect("server");
    }

    #[test]
    fn a_server_that_closes_without_replying_is_bad() {
        let (port, server) = app(|conn| {
            request(conn);
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        assert_eq!(channel.open(&file()), Err(ChannelError::BadReply));
        server.join().expect("server");
    }

    #[test]
    fn a_server_that_accepts_and_never_replies_times_out_in_two_seconds() {
        let (port, server) = app(|conn| {
            request(conn);
            until_closed(conn);
        });
        let channel = Channel::new(port, Framing::JsonRpc2).expect("canale");
        let started = Instant::now();
        assert_eq!(channel.open(&file()), Err(ChannelError::TimedOut));
        let took = started.elapsed();
        assert!(took >= REPLY_TIME, "{took:?}");
        assert!(took < REPLY_TIME + Duration::from_secs(3), "{took:?}");
        server.join().expect("server");
    }

    #[test]
    fn a_reply_dripping_a_byte_at_a_time_still_times_out_in_two_seconds() {
        let (port, server) = app(|conn| {
            request(conn);
            let stream = conn.get_mut();
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(5) {
                if stream.write_all(b" ").is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(200));
            }
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        let started = Instant::now();
        assert_eq!(channel.open(&file()), Err(ChannelError::TimedOut));
        assert!(started.elapsed() < REPLY_TIME + Duration::from_secs(1));
        server.join().expect("server");
    }

    #[test]
    fn a_closed_port_is_unreachable_at_once() {
        let port = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
            listener.local_addr().expect("addr").port()
        };
        let channel = Channel::new(port, Framing::Line).expect("canale");
        let started = Instant::now();
        assert_eq!(channel.open(&file()), Err(ChannelError::Unreachable));
        assert!(started.elapsed() < CONNECT_TIME, "{:?}", started.elapsed());
    }

    #[cfg(unix)]
    #[test]
    fn a_path_that_is_not_utf8_is_bad_before_connecting() {
        use std::os::unix::ffi::OsStrExt;
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        listener.set_nonblocking(true).expect("nonblocking");
        let port = listener.local_addr().expect("addr").port();
        let channel = Channel::new(port, Framing::Line).expect("canale");
        let path = Path::new(std::ffi::OsStr::from_bytes(b"/vault/logo\xff.vectorcraft"));
        assert_eq!(channel.open(path), Err(ChannelError::BadReply));
        let accepted = listener.accept();
        assert!(
            matches!(&accepted, Err(error) if error.kind() == ErrorKind::WouldBlock),
            "nessuna connessione: {accepted:?}"
        );
    }

    #[test]
    fn a_reply_that_repeats_the_token_does_not_leak_it() {
        let (port, server) = app(|conn| {
            let auth = request(conn);
            let token = auth["params"]["token"].clone();
            answer(conn, &json!({"error": {"message": token}}));
            until_closed(conn);
        });
        let channel = Channel::new(port, Framing::Line).expect("canale");
        let outcome = channel.open(&file());
        assert_eq!(outcome, Err(ChannelError::Refused));
        server.join().expect("server");
        let token = channel.token();
        assert!(!format!("{outcome:?}").contains(token));
        assert!(!format!("{channel:?}").contains(token));
        assert!(!format!("{channel:#?}").contains(token));
    }

    #[test]
    fn every_channel_gets_its_own_token() {
        let one = Channel::new(1, Framing::Line).expect("canale");
        let two = Channel::new(1, Framing::Line).expect("canale");
        assert_eq!(one.token().len(), 64);
        assert_ne!(one.token(), two.token());
    }

    #[test]
    fn only_a_token_auth_with_a_method_makes_a_channel() {
        use super::super::editors::{editor, Protocol};
        let made = |id: &str| {
            let control = editor(id).expect("app").control;
            Channel::for_control(&control, 4242).expect("token")
        };
        // Auth::None e Auth::Key: mai un canale.
        assert!(made("vectorcraft").is_none());
        assert!(made("wordcraft").is_none());
        // Senza metodo nemmeno, anche con un token.
        let silent = Control {
            method: None,
            protocol: Protocol::Line,
            auth: Auth::Token { env: None },
            port_known: true,
        };
        assert!(Channel::for_control(&silent, 4242)
            .expect("token")
            .is_none());
        // Auth::Token con un metodo: la cornice viene dalla tabella.
        let pdf = made("pdfcraft").expect("canale");
        assert_eq!((pdf.port(), pdf.framing()), (4242, Framing::JsonRpc2));
        let grid = made("gridcraft").expect("canale");
        assert_eq!(grid.framing(), Framing::Line);
    }
}
