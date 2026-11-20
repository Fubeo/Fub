//! Il **filo verso fuori**: l'unico client HTTP di questo montaggio (§23.3).
//!
//! Sta qui e non nel kernel per la ragione del watcher, una capacità più in là:
//! il kernel non sa cosa sia una connessione e non deve saperlo. Chi monta
//! decide se questo montaggio ne ha uno — [`Workspace::set_network`] — e un
//! host che non lo monta risponde `unserved`, che è una frase diversa da «non
//! ti è concesso».
//!
//! # Cosa questo modulo NON fa, ed è quasi tutto
//!
//! **Non decide chi può connettersi.** Il permesso e l'allowlist li applica il
//! `Guard` del kernel, prima che una richiesta arrivi qui. Questo modulo riceve
//! richieste già autorizzate e le mette sul filo: se qualcuno ci mettesse un
//! secondo controllo, sarebbero due idee della stessa regola e una delle due
//! invecchierebbe.
//!
//! **Non segue i redirect**, ed è la sola configurazione del client che vale
//! quanto una decisione. Un `302` da un host dichiarato verso uno che non lo è
//! porterebbe fuori dal recinto senza che nessuno l'abbia deciso — e il client
//! non ha l'allowlist per accorgersene, né deve averla. Il `3xx` torna a chi ha
//! chiesto; seguirlo è una seconda chiamata, che ripassa dal cancello.
//!
//! **Non decide quanto aspettare** più di una volta: il tetto è qui, è
//! dell'host, e non attraversa il confine — la regola della
//! [0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md), *un
//! limite dell'host dev'essere visibile quando morde, non interrogabile*. Chi
//! lo supera riceve un `Io` che lo dice, e il numero resta alzabile senza
//! rompere nessuno.

use std::borrow::Cow;
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use fub_abi::net::{HttpHeader, HttpMethod, HttpRequest, HttpResponse, LimitedFetchError};
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;

/// Quanto si aspetta prima di dire che non è arrivato niente.
///
/// Due tetti e non uno, perché falliscono in momenti diversi: uno per stabilire
/// la connessione — dove il guasto tipico è un host che non c'è — e uno per
/// l'intera richiesta, che è ciò che protegge chi annulla un job da una risposta
/// che non finisce mai. Nessuno dei due attraversa il confine.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(60);
/// Finestra massima fra due controlli della cancellazione durante il body.
const CANCEL_POLL: Duration = Duration::from_millis(50);

/// Quanti byte di risposta si accettano.
///
/// C'è per la disciplina del freno degli eventi
/// ([0034](../../../docs/decisions/0184-eventi-accodati-e-job.md)): una
/// capacità senza tetto è un modo di far allocare all'host quanto pare a chi
/// risponde — e qui *chi risponde* non è nemmeno un plugin di cui ci si fida,
/// è una macchina di qualcun altro. Sedici mebibyte stanno larghi su ogni
/// risposta di API e su ogni PDF di un articolo, e chi li supera lo **sente**
/// invece di riceverne sedici e non saperlo.
const MAX_BODY: u64 = 16 * 1024 * 1024;

/// Il client vero.
///
/// Un tipo e non una funzione perché il `ureq::Agent` tiene il pool di
/// connessioni e la configurazione TLS: rifarlo a ogni richiesta vorrebbe dire
/// una stretta di mano TLS per ogni chiamata.
pub struct UreqNetwork {
    agent: ureq::Agent,
    cancellable_agent: ureq::Agent,
}

/// Reader che chiude il trasferimento al primo controllo dopo l'annullamento.
/// Il timeout di ricezione breve è solo per rendere il controllo periodico; il
/// tetto complessivo resta [`TOTAL_TIMEOUT`].
struct CancellationReader<'a, R> {
    inner: R,
    cancelled: &'a AtomicBool,
    /// Scadenza assoluta della richiesta: `ureq` non rinnova il budget globale
    /// a ogni lettura, e una scadenza che il reader riprova resterebbe
    /// invisibile al job.
    deadline: Instant,
}

/// `true` soltanto per il breve timeout di ricezione che serve a controllare
/// l'annullamento. Ogni altra scadenza (globale, per chiamata, connessione)
/// arriva a chi legge: ritentarla non rinnova nulla.
fn is_poll_timeout(error: &io::Error) -> bool {
    match error
        .get_ref()
        .and_then(|source| source.downcast_ref::<ureq::Error>())
    {
        Some(ureq::Error::Timeout(timeout)) => matches!(timeout, ureq::Timeout::RecvBody),
        Some(_) => false,
        None => error.kind() == io::ErrorKind::TimedOut,
    }
}

/// Il segno di una lettura fermata dall'annullamento.
///
/// Non `ErrorKind::Interrupted`: `read_to_end` e `read_exact` ritentano da
/// soli una lettura interrotta, quindi un reader annullato che risponde
/// `Interrupted` a ogni chiamata li fa girare a vuoto per sempre.
#[derive(Debug)]
struct CancelledRead;

impl std::fmt::Display for CancelledRead {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("network request cancelled")
    }
}

impl std::error::Error for CancelledRead {}

fn cancelled_read() -> io::Error {
    io::Error::other(CancelledRead)
}

fn is_cancelled_read(error: &io::Error) -> bool {
    error
        .get_ref()
        .is_some_and(|inner| inner.is::<CancelledRead>())
}

impl<R: Read> Read for CancellationReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        loop {
            if self.cancelled.load(Ordering::Relaxed) {
                return Err(cancelled_read());
            }
            if Instant::now() >= self.deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "network request exceeded its overall time limit",
                ));
            }
            match self.inner.read(buffer) {
                Err(error) if is_poll_timeout(&error) => continue,
                result => return result,
            }
        }
    }
}

impl Default for UreqNetwork {
    fn default() -> Self {
        UreqNetwork::new()
    }
}

impl UreqNetwork {
    pub fn new() -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(TOTAL_TIMEOUT))
            .max_redirects(0)
            .max_redirects_will_error(false)
            .tls_config(
                ureq::tls::TlsConfig::builder()
                    .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                    .build(),
            )
            .build();
        let cancellable_config = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_global(Some(TOTAL_TIMEOUT))
            .timeout_recv_body(Some(CANCEL_POLL))
            .max_redirects(0)
            .max_redirects_will_error(false)
            .tls_config(
                ureq::tls::TlsConfig::builder()
                    .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                    .build(),
            )
            .build();
        UreqNetwork {
            agent: ureq::Agent::new_with_config(config),
            cancellable_agent: ureq::Agent::new_with_config(cancellable_config),
        }
    }
}

/// `url` come si può mostrare in un errore: schema, host, porta e percorso,
/// senza credenziali (`user:pass@`), query e frammento.
///
/// L'indirizzo si legge col parser di `http` (lo stesso che userà la
/// richiesta), non tagliando a mano: una password con `?`, `#` o `/` dentro
/// confonde un taglio sui caratteri, non un parser. Un indirizzo che non si
/// legge non si mostra: resta lo schema, se c'è.
fn shown_url(url: &str) -> String {
    let unreadable = || match url.split_once("://") {
        Some((scheme, _))
            if !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) =>
        {
            format!("{scheme}://<unreadable address>")
        }
        _ => "<unreadable address>".to_owned(),
    };
    let Ok(uri) = url.parse::<ureq::http::Uri>() else {
        return unreadable();
    };
    let (Some(scheme), Some(host)) = (uri.scheme_str(), uri.host()) else {
        return unreadable();
    };
    let port = uri
        .port_u16()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    // L'autorità, tolte le credenziali, deve essere proprio host e porta: con
    // `user:pa?ss@host` il parser legge `user` come host e `pa` come porta
    // che non è un numero, e un pezzo di credenziale finirebbe in vista.
    let authority = uri.authority().map_or("", |authority| authority.as_str());
    let bare = authority
        .rsplit_once('@')
        .map_or(authority, |(_, bare)| bare);
    if bare != format!("{host}{port}") {
        return unreadable();
    }
    let path = match uri.path() {
        "/" if !url
            .split_once("://")
            .is_some_and(|(_, rest)| rest.contains('/')) =>
        {
            ""
        }
        path => path,
    };
    format!("{scheme}://{host}{port}{path}")
}

/// Il motivo di un errore di trasporto, con parole fisse: il testo di
/// `ureq::Error` può ripetere l'indirizzo intero (un `BadUri` lo porta tale
/// e quale), credenziali e query comprese. Il tetto dell'host si nomina solo
/// quando è lui il motivo.
fn transport_reason(error: &ureq::Error) -> Cow<'static, str> {
    Cow::Borrowed(match error {
        ureq::Error::Timeout(_) => "timed out",
        ureq::Error::HostNotFound => "host not found",
        ureq::Error::ConnectionFailed => "connection failed",
        ureq::Error::Io(io) => return io_reason(io),
        ureq::Error::BodyExceedsLimit(_) => {
            return Cow::Owned(format!(
                "response body above the host ceiling of {MAX_BODY} bytes"
            ))
        }
        ureq::Error::TooManyRedirects | ureq::Error::RedirectFailed => "redirect failed",
        ureq::Error::Tls(_) => "TLS failure",
        ureq::Error::Http(_) | ureq::Error::BadUri(_) => "invalid request",
        ureq::Error::StatusCode(_) => "unexpected status",
        _ => "transport failure",
    })
}

/// Il motivo di un errore di lettura, con parole fisse. Il reader di `ureq`
/// avvolge i suoi errori in un `io::Error`: si riconoscono e si nominano come
/// quelli di trasporto. L'annullamento è solo [`CancelledRead`].
fn io_reason(error: &std::io::Error) -> Cow<'static, str> {
    if is_cancelled_read(error) {
        return Cow::Borrowed("cancelled");
    }
    if let Some(inner) = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<ureq::Error>())
    {
        return transport_reason(inner);
    }
    Cow::Borrowed(match error.kind() {
        std::io::ErrorKind::TimedOut => "timed out",
        std::io::ErrorKind::ConnectionRefused => "connection refused",
        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted => {
            "connection reset"
        }
        std::io::ErrorKind::UnexpectedEof => "connection closed early",
        std::io::ErrorKind::InvalidData => "invalid data",
        _ => "read failure",
    })
}

/// `true` se la risposta porta un corpo che si leggerà: non la porta mai una
/// risposta a `HEAD`, né un `1xx`, un `204` o un `304`, qualunque
/// `Content-Length` dichiarino (RFC 9110, 6.4.1).
fn carries_body(method: HttpMethod, status: u16) -> bool {
    method != HttpMethod::Head && !(100..200).contains(&status) && status != 204 && status != 304
}

impl UreqNetwork {
    /// La richiesta, con l'annullamento se c'è una bandiera e con il tetto di
    /// byte del chiamante se ce n'è uno. Senza tetto non torna mai
    /// [`LimitedFetchError::TooLarge`]: il tetto dell'host morde come `Io`.
    fn fetch_with(
        &self,
        request: HttpRequest,
        cancelled: Option<&AtomicBool>,
        max_bytes: Option<u64>,
    ) -> Result<HttpResponse, LimitedFetchError> {
        let started = Instant::now();
        // Gli errori finiscono nel log e al plugin: l'indirizzo vi entra senza
        // query, frammento e credenziali, dove un chiamante può aver messo un
        // segreto.
        let shown = shown_url(&request.url);
        let io = |and: ureq::Error| {
            LimitedFetchError::Failed(PluginError::Io(
                format!("{shown}: {}", transport_reason(&and)).into(),
            ))
        };
        let bad_request = || {
            LimitedFetchError::Failed(PluginError::BadArgs(
                format!("{shown}: invalid request").into(),
            ))
        };
        let mut builder = ureq::http::Request::builder()
            .method(request.method.as_str())
            .uri(&request.url);
        for header in &request.headers {
            builder = builder.header(&header.name, &header.value);
        }
        let agent = cancelled
            .map(|_| &self.cancellable_agent)
            .unwrap_or(&self.agent);
        let mut response = match &request.body {
            Some(body) => {
                let req = builder.body(&body[..]).map_err(|_| bad_request())?;
                agent.run(req).map_err(io)?
            }
            None => {
                let req = builder.body(()).map_err(|_| bad_request())?;
                agent.run(req).map_err(io)?
            }
        };
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|v| HttpHeader::new(name.as_str(), v))
            })
            .collect();
        // Il tetto del chiamante conta solo se è più stretto di quello
        // dell'host: oltre, risponde il tetto dell'host con il suo `Io`.
        let cap = max_bytes.filter(|cap| *cap < MAX_BODY);
        // Chi dichiara già una lunghezza oltre il tetto non si legge, ma solo
        // dove lo stato porta un corpo: `HEAD`, `1xx`, `204` e `304` dichiarano
        // la lunghezza di un corpo che non arriva. Lo stato va nell'errore, e
        // chi chiama lo guarda prima del tetto.
        if let Some(cap) = cap.filter(|_| carries_body(request.method, status)) {
            let declared = response
                .headers()
                .get(ureq::http::header::CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok());
            if declared.is_some_and(|declared| declared > cap) {
                return Err(LimitedFetchError::TooLarge { limit: cap, status });
            }
        }
        let read = |and: io::Error| {
            LimitedFetchError::Failed(PluginError::Io(
                format!(
                    "{shown}: the response body could not be read: {}",
                    io_reason(&and)
                )
                .into(),
            ))
        };
        let inner = response.body_mut().with_config().limit(MAX_BODY).reader();
        let reader: Box<dyn Read + '_> = match cancelled {
            Some(flag) => Box::new(CancellationReader {
                inner,
                cancelled: flag,
                deadline: started + TOTAL_TIMEOUT,
            }),
            None => Box::new(inner),
        };
        let body = match cap {
            Some(cap) => read_capped(reader, cap)
                .map_err(read)?
                .ok_or(LimitedFetchError::TooLarge { limit: cap, status })?,
            None => {
                let mut body = Vec::new();
                let mut reader = reader;
                reader.read_to_end(&mut body).map_err(read)?;
                body
            }
        };
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

/// Legge il corpo fino alla fine, o fino a un byte oltre `cap`: `None` vuol
/// dire che il corpo supera il tetto, e del resto non si è letto niente.
///
/// `take(cap + 1)` e non un controllo dopo `read_to_end`: è il punto del tetto
/// del chiamante, che un server non possa far leggere all'host più di quanto
/// chi chiede accetterà. Oltre `cap + 1` resta solo ciò che il trasporto ha già
/// nel suo buffer, cioè al più un pezzo di lettura.
fn read_capped(reader: impl Read, cap: u64) -> io::Result<Option<Vec<u8>>> {
    let mut body = Vec::new();
    reader.take(cap.saturating_add(1)).read_to_end(&mut body)?;
    Ok((body.len() as u64 <= cap).then_some(body))
}

/// Toglie il tetto del chiamante da un esito che non poteva averlo.
fn without_cap(
    result: Result<HttpResponse, LimitedFetchError>,
) -> Result<HttpResponse, PluginError> {
    result.map_err(|error| match error {
        LimitedFetchError::Failed(error) => error,
        too_large @ LimitedFetchError::TooLarge { .. } => {
            PluginError::Io(too_large.to_string().into())
        }
    })
}

fn cancelled_error() -> PluginError {
    PluginError::Cancelled("the network request was cancelled".into())
}

impl HostNetwork for UreqNetwork {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        without_cap(self.fetch_with(request, None, None))
    }

    fn fetch_cancelled(
        &self,
        request: HttpRequest,
        cancelled: &AtomicBool,
    ) -> Result<HttpResponse, PluginError> {
        if cancelled.load(Ordering::Relaxed) {
            return Err(cancelled_error());
        }
        match without_cap(self.fetch_with(request, Some(cancelled), None)) {
            Err(_) if cancelled.load(Ordering::Relaxed) => Err(cancelled_error()),
            result => result,
        }
    }

    /// Il tetto morde **mentre** si legge: oltre `max_bytes + 1` byte il corpo
    /// non si chiede più al trasporto, e una `Content-Length` già oltre il
    /// tetto non fa leggere niente. Annullamento e tetto di tempo restano
    /// quelli di [`fetch_cancelled`](HostNetwork::fetch_cancelled).
    fn fetch_limited(
        &self,
        request: HttpRequest,
        cancelled: &AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        if cancelled.load(Ordering::Relaxed) {
            return Err(cancelled_error().into());
        }
        settle_limited(
            self.fetch_with(request, Some(cancelled), Some(max_bytes)),
            cancelled,
        )
    }
}

/// Un errore arrivato con la bandiera alzata è l'annullamento, salvo un
/// [`LimitedFetchError::TooLarge`]: quello è già deciso dai byte letti, e
/// resta tale anche se l'annullamento scatta durante l'ultima lettura.
fn settle_limited(
    result: Result<HttpResponse, LimitedFetchError>,
    cancelled: &AtomicBool,
) -> Result<HttpResponse, LimitedFetchError> {
    match result {
        Err(LimitedFetchError::Failed(_)) if cancelled.load(Ordering::Relaxed) => {
            Err(cancelled_error().into())
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Che il client si costruisca **e** che la configurazione sia quella
    /// scritta: un agent con i redirect accesi passerebbe di qui verde, e i
    /// redirect sono la metà del recinto.
    #[test]
    fn client_is_built_without_following_redirects() {
        let net = UreqNetwork::new();
        assert_eq!(
            net.agent.config().max_redirects(),
            0,
            "following a redirect leaves the allowlist without deciding"
        );
        assert!(
            !net.agent.config().max_redirects_will_error(),
            "a `3xx` must return to whoever asked, not become an error: it \
             is the caller who decides whether to follow it"
        );
    }

    /// E che ci si fidi della **macchina** e non delle radici imbarcate. È il
    /// presidio che mancava: la scelta era argomentata in `Cargo.toml` da
    /// quando il filo esiste, il verificatore era compilato dentro, e nessuno
    /// lo nominava — il default di `ureq` è `WebPki`, quindi la decisione era
    /// scritta e disattesa insieme. Se qualcuno toglie la riga, o rimette la
    /// feature-ombrello `rustls` che si porta dietro le radici di Mozilla, qui
    /// diventa rosso invece di diventare un utente in rete aziendale che non
    /// si connette e non sa perché.
    #[test]
    fn we_trust_what_the_platform_trusts() {
        let net = UreqNetwork::new();
        assert!(
            matches!(
                net.agent.config().tls_config().root_certs(),
                ureq::tls::RootCerts::PlatformVerifier
            ),
            "with embedded roots the corporate CA is not valid, and from the \
             app there is no way to fix it (decision 0097)"
        );
    }

    /// Un URL che non si connette dà `Io` e non `Internal`: non è colpa di chi
    /// chiama, ed è la distinzione che permette a chi disegna di dire «la rete
    /// non risponde» invece di «errore interno del plugin».
    #[test]
    fn transport_fault_is_io() {
        let net = UreqNetwork::new();
        // La porta 1 dell'anello locale non ascolta: la connessione fallisce
        // senza uscire dalla macchina, quindi questo test non ha bisogno di
        // rete e non diventa rosso su una macchina scollegata.
        let err = net
            .fetch(HttpRequest::get("http://127.0.0.1:1/nothing"))
            .expect_err("nobody listens there");
        assert!(
            matches!(err, PluginError::Io(_)),
            "a transport fault is I/O, not a caller defect: {err}"
        );
    }
    /// L'errore nomina dove si è andati, non i segreti dell'indirizzo: né la
    /// query, né il frammento, né le credenziali.
    #[test]
    fn errors_name_the_address_without_its_secrets() {
        assert_eq!(
            shown_url("https://u:p@api.esempio.org:8443/v1/x?token=segreto#f"),
            "https://api.esempio.org:8443/v1/x"
        );
        assert_eq!(shown_url("http://h?x=1"), "http://h");
        assert_eq!(shown_url("https://h/"), "https://h/");
        // Una password con `?`, `/` o `#` dentro non confonde il parser: o
        // l'indirizzo si legge e le credenziali spariscono, o non si mostra.
        for url in [
            "https://user:pa?ss@host/x",
            "https://user:p/ss@host/x",
            "https://user:p#ss@host/x",
            "https://user:pa ss@host/x",
        ] {
            let shown = shown_url(url);
            assert!(
                !shown.contains("pa") && !shown.contains("ss@"),
                "{url} -> {shown}"
            );
            assert!(!shown.contains("user"), "{url} -> {shown}");
        }
        assert_eq!(shown_url("non un url?x"), "<unreadable address>");
        assert_eq!(
            shown_url("https://user:pa ss@host/x"),
            "https://<unreadable address>"
        );
        // Il motivo non ripete il testo di `ureq`, che può portare l'indirizzo.
        let bad = ureq::Error::BadUri("https://user:segreto@h/?token=segreto".into());
        assert_eq!(transport_reason(&bad), "invalid request");
        let wrapped = std::io::Error::other(ureq::Error::BadUri("segreto".into()));
        assert_eq!(io_reason(&wrapped), "invalid request");
        let err = UreqNetwork::new()
            .fetch(HttpRequest::get("http://127.0.0.1:1/nothing?token=segreto"))
            .expect_err("nobody listens there");
        let text = err.to_string();
        assert!(!text.contains("segreto"), "{text}");
        assert!(text.contains("127.0.0.1:1/nothing"), "{text}");
    }

    /// Una risposta già in trasferimento vede l'annullamento prima di leggere
    /// il chunk successivo: il reader restituisce `CancelledRead` senza attendere
    /// il tetto globale.
    #[test]
    fn cancellation_stops_an_inflight_body() {
        struct CancelAfterFirst<'a>(&'a AtomicBool);

        impl Read for CancelAfterFirst<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                self.0.store(true, Ordering::Relaxed);
                buffer[0] = b'x';
                Ok(1)
            }
        }

        let cancelled = AtomicBool::new(false);
        let mut reader = CancellationReader {
            inner: CancelAfterFirst(&cancelled),
            cancelled: &cancelled,
            deadline: Instant::now() + TOTAL_TIMEOUT,
        };
        let started = std::time::Instant::now();
        let mut byte = [0; 1];
        assert_eq!(reader.read(&mut byte).expect("first body chunk"), 1);
        let error = reader.read(&mut byte).expect_err("cancelled reader");
        assert!(is_cancelled_read(&error), "{error:?}");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    /// Un reader che fallisce sempre con la stessa scadenza, contando i
    /// tentativi: sblocca un retry infinito senza un server vero.
    struct AlwaysTimesOut {
        timeout: ureq::Timeout,
        attempts: usize,
    }

    impl Read for AlwaysTimesOut {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            self.attempts += 1;
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                ureq::Error::Timeout(self.timeout),
            ))
        }
    }

    /// La scadenza globale di `ureq` non si rinnova ritentando: deve arrivare
    /// al job invece di essere assorbita dal polling.
    #[test]
    fn global_timeout_reaches_the_caller() {
        let cancelled = AtomicBool::new(false);
        let mut reader = CancellationReader {
            inner: AlwaysTimesOut {
                timeout: ureq::Timeout::Global,
                attempts: 0,
            },
            cancelled: &cancelled,
            deadline: Instant::now() + TOTAL_TIMEOUT,
        };
        let error = reader.read(&mut [0; 1]).expect_err("global timeout");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert_eq!(reader.inner.attempts, 1);
    }

    /// Il timeout di polling si ritenta, ma non oltre la scadenza assoluta, e
    /// l'annullamento lo interrompe.
    #[test]
    fn poll_timeout_is_retried_until_the_deadline_or_cancellation() {
        let cancelled = AtomicBool::new(false);
        let mut reader = CancellationReader {
            inner: AlwaysTimesOut {
                timeout: ureq::Timeout::RecvBody,
                attempts: 0,
            },
            cancelled: &cancelled,
            deadline: Instant::now() + Duration::from_millis(30),
        };
        let error = reader.read(&mut [0; 1]).expect_err("deadline");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(reader.inner.attempts > 1, "the poll timeout is retried");

        let mut reader = CancellationReader {
            inner: AlwaysTimesOut {
                timeout: ureq::Timeout::RecvBody,
                attempts: 0,
            },
            cancelled: &cancelled,
            deadline: Instant::now() + TOTAL_TIMEOUT,
        };
        cancelled.store(true, Ordering::Relaxed);
        let error = reader.read(&mut [0; 1]).expect_err("cancelled");
        assert!(is_cancelled_read(&error), "{error:?}");
    }

    /// Un corpo senza fine che conta quanti byte gli si chiedono, a pezzi di
    /// `CHUNK` come un trasporto vero.
    struct Endless {
        served: u64,
    }

    const CHUNK: usize = 16 * 1024;

    impl Read for Endless {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let n = buffer.len().min(CHUNK);
            buffer[..n].fill(b'x');
            self.served += n as u64;
            Ok(n)
        }
    }

    const MIB: u64 = 1024 * 1024;

    /// Il tetto morde mentre si legge: da un corpo senza fine si chiedono al
    /// più il tetto e un pezzo, non il tetto dell'host.
    #[test]
    fn the_caller_cap_stops_reading_past_the_cap() {
        let mut endless = Endless { served: 0 };
        let body = read_capped(&mut endless, MIB).expect("readable");
        assert!(body.is_none(), "a body above the cap is refused");
        assert!(endless.served > MIB);
        assert!(
            endless.served <= MIB + CHUNK as u64,
            "read {} bytes for a cap of {MIB}",
            endless.served
        );
    }

    /// Il confine è incluso: il tetto esatto passa, un byte in più no.
    #[test]
    fn the_caller_cap_is_inclusive() {
        let exact = vec![7u8; MIB as usize];
        let body = read_capped(&exact[..], MIB).expect("readable");
        assert_eq!(body.map(|body| body.len()), Some(MIB as usize));
        let over = vec![7u8; MIB as usize + 1];
        assert_eq!(read_capped(&over[..], MIB).expect("readable"), None);
    }

    /// Un `TooLarge` già deciso resta tale anche se l'annullamento arriva
    /// durante l'ultima lettura; ogni altro errore con la bandiera alzata è
    /// l'annullamento.
    #[test]
    fn a_decided_too_large_survives_a_late_cancellation() {
        let raised = AtomicBool::new(true);
        let too_large = LimitedFetchError::TooLarge {
            limit: MIB,
            status: 200,
        };
        assert_eq!(
            settle_limited(Err(too_large.clone()), &raised),
            Err(too_large)
        );
        let reset = LimitedFetchError::Failed(PluginError::Io("connection reset".into()));
        assert!(matches!(
            settle_limited(Err(reset.clone()), &raised),
            Err(LimitedFetchError::Failed(PluginError::Cancelled(_)))
        ));
        assert_eq!(
            settle_limited(Err(reset.clone()), &AtomicBool::new(false)),
            Err(reset)
        );
    }

    /// Il tetto dell'host compare nel motivo solo quando è lui la causa, e con
    /// il suo valore vero; un tempo scaduto o un reset non lo nominano.
    #[test]
    fn the_host_ceiling_is_named_only_when_it_bites() {
        let over = ureq::Error::BodyExceedsLimit(MAX_BODY);
        assert_eq!(
            transport_reason(&over),
            format!("response body above the host ceiling of {MAX_BODY} bytes")
        );
        let wrapped = io::Error::other(ureq::Error::BodyExceedsLimit(MAX_BODY));
        assert!(io_reason(&wrapped).contains(&MAX_BODY.to_string()));
        for quiet in [
            io::Error::from(io::ErrorKind::TimedOut),
            io::Error::from(io::ErrorKind::ConnectionReset),
            cancelled_read(),
        ] {
            let reason = io_reason(&quiet);
            assert!(!reason.contains("ceiling"), "{reason}");
        }
        // `Interrupted` non è più l'annullamento: solo `CancelledRead` lo è.
        assert_eq!(
            io_reason(&io::Error::from(io::ErrorKind::Interrupted)),
            "read failure"
        );
    }

    /// Le risposte senza corpo per definizione non hanno corpo da leggere.
    #[test]
    fn bodyless_responses_are_recognised() {
        assert!(carries_body(HttpMethod::Get, 200));
        assert!(carries_body(HttpMethod::Get, 302));
        assert!(carries_body(HttpMethod::Get, 404));
        assert!(!carries_body(HttpMethod::Head, 200));
        assert!(!carries_body(HttpMethod::Get, 101));
        assert!(!carries_body(HttpMethod::Get, 204));
        assert!(!carries_body(HttpMethod::Get, 304));
    }

    /// `work` su un filo a parte, con un tetto di tempo: una prova che si
    /// incanta (un ciclo che ritenta una lettura annullata) fallisce in fretta
    /// invece di tenere occupato un processore.
    fn within<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
        let (done, wait) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = done.send(work());
        });
        wait.recv_timeout(Duration::from_secs(20))
            .expect("the test did not end within 20 seconds")
    }

    /// Annullamento e tetto di tempo passano anche sotto il tetto di byte, e
    /// `read_to_end` non ritenta per sempre una lettura annullata (con
    /// `ErrorKind::Interrupted` lo faceva).
    #[test]
    fn cancellation_and_deadline_still_bite_under_a_cap() {
        within(|| {
            let cancelled = AtomicBool::new(true);
            let reader = CancellationReader {
                inner: Endless { served: 0 },
                cancelled: &cancelled,
                deadline: Instant::now() + TOTAL_TIMEOUT,
            };
            let error = read_capped(reader, MIB).expect_err("cancelled");
            assert!(is_cancelled_read(&error), "{error:?}");
            let mut reader = CancellationReader {
                inner: Endless { served: 0 },
                cancelled: &cancelled,
                deadline: Instant::now() + TOTAL_TIMEOUT,
            };
            let error = reader.read_to_end(&mut Vec::new()).expect_err("cancelled");
            assert!(is_cancelled_read(&error), "{error:?}");
            assert_eq!(io_reason(&error), "cancelled");

            let still = AtomicBool::new(false);
            let reader = CancellationReader {
                inner: AlwaysTimesOut {
                    timeout: ureq::Timeout::RecvBody,
                    attempts: 0,
                },
                cancelled: &still,
                deadline: Instant::now() + Duration::from_millis(30),
            };
            let error = read_capped(reader, MIB).expect_err("deadline");
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        });
    }

    /// Come il server manda il corpo.
    #[derive(Clone, Copy)]
    enum Framing {
        Chunked,
        Length,
    }

    /// Un server HTTP di una richiesta sull'anello locale: risponde `status`
    /// (per esempio `"200 OK"`) dichiarando `body` byte e torna quanti ne è
    /// riuscito a scrivere prima che il client chiudesse. A `HEAD`, `204` e
    /// `304` dichiara la lunghezza ma non manda il corpo. Con `stall` manda
    /// solo le intestazioni e aspetta.
    ///
    /// Le scritture hanno un tempo corto e il loro errore chiude il server:
    /// se il client lascia la connessione aperta senza leggere, il server si
    /// arrende in pochi secondi invece di tenere la prova appesa a quando
    /// `ureq` chiude.
    fn serve_once(
        status: &'static str,
        body: u64,
        framing: Framing,
        stall: bool,
    ) -> (String, std::thread::JoinHandle<u64>) {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let url = format!("http://{}/tessera", listener.local_addr().expect("addr"));
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .expect("write timeout");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("read timeout");
            let mut lines = BufReader::new(stream.try_clone().expect("clone"));
            let mut line = String::new();
            let _ = lines.read_line(&mut line);
            let method = if line.starts_with("HEAD ") {
                HttpMethod::Head
            } else {
                HttpMethod::Get
            };
            line.clear();
            while lines.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
                line.clear();
            }
            let code = status[..3].parse::<u16>().expect("status code");
            let sends_body = carries_body(method, code);
            let mut stream = stream;
            let head = match framing {
                Framing::Chunked => format!(
                    "HTTP/1.1 {status}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                ),
                Framing::Length => format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {body}\r\nConnection: close\r\n\r\n"
                ),
            };
            if stream.write_all(head.as_bytes()).is_err() || !sends_body {
                return 0;
            }
            if stall {
                // Il client se ne va per l'annullamento: qui si legge finché
                // chiude.
                let _ = io::copy(&mut lines, &mut io::sink());
                return 0;
            }
            let piece = vec![b'x'; CHUNK];
            let mut written = 0u64;
            while written < body {
                let n = (body - written).min(CHUNK as u64) as usize;
                let sent = match framing {
                    Framing::Chunked => stream
                        .write_all(format!("{n:x}\r\n").as_bytes())
                        .and_then(|()| stream.write_all(&piece[..n]))
                        .and_then(|()| stream.write_all(b"\r\n")),
                    Framing::Length => stream.write_all(&piece[..n]),
                };
                if sent.is_err() {
                    return written;
                }
                written += n as u64;
            }
            if let Framing::Chunked = framing {
                let _ = stream.write_all(b"0\r\n\r\n");
            }
            written
        });
        (url, server)
    }

    /// Dal server vero: il corpo oltre il tetto è `TooLarge`, e il client
    /// chiude ben prima del tetto dell'host. Il server riesce a scrivere
    /// anche ciò che resta nei buffer del sistema, quindi il conto lato server
    /// è un limite largo: quello stretto lo prova `read_capped`.
    #[test]
    fn a_body_above_the_cap_is_refused_without_reading_the_host_ceiling() {
        within(|| refused_above_the_cap(Framing::Chunked));
    }

    /// Una `Content-Length` già oltre il tetto non fa leggere il corpo.
    #[test]
    fn a_declared_length_above_the_cap_is_refused_before_reading() {
        within(|| refused_above_the_cap(Framing::Length));
    }

    fn refused_above_the_cap(framing: Framing) {
        let (url, server) = serve_once("200 OK", 4 * MAX_BODY, framing, false);
        let error = UreqNetwork::new()
            .fetch_limited(HttpRequest::get(url), &AtomicBool::new(false), MIB)
            .expect_err("too large");
        assert_eq!(
            error,
            LimitedFetchError::TooLarge {
                limit: MIB,
                status: 200
            }
        );
        let written = server.join().expect("server");
        assert!(written < MAX_BODY, "the server wrote {written} bytes");
    }

    /// Dal server vero, il confine: il tetto esatto passa, un byte in più no.
    #[test]
    fn a_body_exactly_at_the_cap_passes_and_one_more_byte_does_not() {
        within(exactly_at_the_cap);
    }

    fn exactly_at_the_cap() {
        for framing in [Framing::Chunked, Framing::Length] {
            let (url, server) = serve_once("200 OK", MIB, framing, false);
            let response = UreqNetwork::new()
                .fetch_limited(HttpRequest::get(url), &AtomicBool::new(false), MIB)
                .expect("exactly at the cap");
            assert_eq!(response.body.len() as u64, MIB);
            assert_eq!(server.join().expect("server"), MIB);

            let (url, server) = serve_once("200 OK", MIB + 1, framing, false);
            let error = UreqNetwork::new()
                .fetch_limited(HttpRequest::get(url), &AtomicBool::new(false), MIB)
                .expect_err("one byte over");
            assert_eq!(
                error,
                LimitedFetchError::TooLarge {
                    limit: MIB,
                    status: 200
                }
            );
            server.join().expect("server");
        }
    }

    /// Un corpo che non arriva si annulla anche con il tetto di byte, ed è
    /// `Cancelled`, non `TooLarge` né un errore di rete.
    #[test]
    fn cancellation_reaches_a_capped_request() {
        within(cancelled_while_capped);
    }

    fn cancelled_while_capped() {
        let (url, server) = serve_once("200 OK", MIB, Framing::Chunked, true);
        let cancelled = std::sync::Arc::new(AtomicBool::new(false));
        let flag = std::sync::Arc::clone(&cancelled);
        let raiser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            flag.store(true, Ordering::Relaxed);
        });
        let started = Instant::now();
        let error = UreqNetwork::new()
            .fetch_limited(HttpRequest::get(url), &cancelled, MIB)
            .expect_err("cancelled");
        assert!(
            matches!(error, LimitedFetchError::Failed(PluginError::Cancelled(_))),
            "{error:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        raiser.join().expect("raiser");
        server.join().expect("server");
    }

    /// Un tetto più largo di quello dell'host non lo alza: risponde il tetto
    /// dell'host, come `Io`.
    #[test]
    fn a_cap_above_the_host_ceiling_does_not_raise_it() {
        within(host_ceiling_wins);
    }

    fn host_ceiling_wins() {
        let (url, server) = serve_once("200 OK", MAX_BODY + 1, Framing::Chunked, false);
        let error = UreqNetwork::new()
            .fetch_limited(HttpRequest::get(url), &AtomicBool::new(false), 4 * MAX_BODY)
            .expect_err("host ceiling");
        assert!(
            matches!(error, LimitedFetchError::Failed(PluginError::Io(_))),
            "{error:?}"
        );
        let text = error.to_string();
        assert!(
            text.contains(&format!("host ceiling of {MAX_BODY} bytes")),
            "{text}"
        );
        server.join().expect("server");
    }

    /// Una `Content-Length` oltre il tetto su un redirect è ancora `TooLarge`,
    /// ma con lo stato vero dentro: chi chiama decide guardando prima lo stato.
    /// (Un `4xx` o un `5xx` qui non arriva al corpo: `ureq` lo ferma prima come
    /// stato inatteso.)
    #[test]
    fn a_too_large_error_carries_the_status() {
        within(|| {
            for (status, code) in [("301 Moved Permanently", 301), ("302 Found", 302)] {
                let (url, server) = serve_once(status, 4 * MAX_BODY, Framing::Length, false);
                let error = UreqNetwork::new()
                    .fetch_limited(HttpRequest::get(url), &AtomicBool::new(false), MIB)
                    .expect_err("too large");
                assert_eq!(
                    error,
                    LimitedFetchError::TooLarge {
                        limit: MIB,
                        status: code
                    }
                );
                server.join().expect("server");
            }
        });
    }

    /// `HEAD`, `204` e `304` dichiarano la lunghezza di un corpo che non
    /// arriva: una `Content-Length` oltre il tetto non li rifiuta.
    #[test]
    fn bodyless_responses_pass_whatever_length_they_declare() {
        within(|| {
            for status in ["204 No Content", "304 Not Modified"] {
                let (url, server) = serve_once(status, 4 * MAX_BODY, Framing::Length, false);
                let response = UreqNetwork::new()
                    .fetch_limited(HttpRequest::get(url), &AtomicBool::new(false), MIB)
                    .unwrap_or_else(|error| panic!("{status}: {error:?}"));
                assert!(response.body.is_empty(), "{status}");
                server.join().expect("server");
            }
            let (url, server) = serve_once("200 OK", 4 * MAX_BODY, Framing::Length, false);
            let head = HttpRequest {
                method: HttpMethod::Head,
                ..HttpRequest::get(url)
            };
            let response = UreqNetwork::new()
                .fetch_limited(head, &AtomicBool::new(false), MIB)
                .expect("HEAD");
            assert_eq!(response.status, 200);
            assert!(response.body.is_empty());
            server.join().expect("server");
        });
    }
}
