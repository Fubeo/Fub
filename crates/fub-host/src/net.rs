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
//! [0094](../../../docs/decisions/0094-un-tetto-che-si-fa-sentire.md), *un
//! limite dell'host dev'essere visibile quando morde, non interrogabile*. Chi
//! lo supera riceve un `Io` che lo dice, e il numero resta alzabile senza
//! rompere nessuno.

use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use fub_abi::net::{HttpHeader, HttpRequest, HttpResponse};
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
/// ([0034](../../../docs/decisions/0034-il-freno-e-il-raggruppamento.md)): una
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
}

fn is_timeout(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::TimedOut
        || error
            .get_ref()
            .and_then(|source| source.downcast_ref::<ureq::Error>())
            .is_some_and(|error| matches!(error, ureq::Error::Timeout(_)))
}

impl<R: Read> Read for CancellationReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        loop {
            if self.cancelled.load(Ordering::Relaxed) {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "network request cancelled",
                ));
            }
            match self.inner.read(buffer) {
                Err(error) if is_timeout(&error) => continue,
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

impl UreqNetwork {
    fn fetch_with(
        &self,
        request: HttpRequest,
        cancelled: Option<&AtomicBool>,
    ) -> Result<HttpResponse, PluginError> {
        let io = |and: ureq::Error| PluginError::Io(format!("{}: {and}", request.url).into());
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
                let req = builder.body(&body[..]).map_err(|and| {
                    PluginError::BadArgs(format!("{}: {and}", request.url).into())
                })?;
                agent.run(req).map_err(io)?
            }
            None => {
                let req = builder.body(()).map_err(|and| {
                    PluginError::BadArgs(format!("{}: {and}", request.url).into())
                })?;
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
        let body = match cancelled {
            Some(flag) => {
                let mut reader = CancellationReader {
                    inner: response.body_mut().with_config().limit(MAX_BODY).reader(),
                    cancelled: flag,
                };
                let mut body = Vec::new();
                reader.read_to_end(&mut body).map_err(|and| {
                    PluginError::Io(format!("{}: the response body could not be read (host ceiling is {MAX_BODY} bytes): {and}", request.url).into())
                })?;
                body
            }
            None => response.body_mut().with_config().limit(MAX_BODY).read_to_vec().map_err(|and| {
                PluginError::Io(format!("{}: the response body could not be read (host ceiling is {MAX_BODY} bytes): {and}", request.url).into())
            })?,
        };
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

impl HostNetwork for UreqNetwork {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.fetch_with(request, None)
    }

    fn fetch_cancelled(
        &self,
        request: HttpRequest,
        cancelled: &AtomicBool,
    ) -> Result<HttpResponse, PluginError> {
        if cancelled.load(Ordering::Relaxed) {
            return Err(PluginError::Cancelled(
                "the network request was cancelled".into(),
            ));
        }
        match self.fetch_with(request, Some(cancelled)) {
            Err(_) if cancelled.load(Ordering::Relaxed) => Err(PluginError::Cancelled(
                "the network request was cancelled".into(),
            )),
            result => result,
        }
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
    /// Una risposta già in trasferimento vede l'annullamento prima di leggere
    /// il chunk successivo: il reader restituisce `Interrupted` senza attendere
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
        };
        let started = std::time::Instant::now();
        let mut byte = [0; 1];
        assert_eq!(reader.read(&mut byte).expect("first body chunk"), 1);
        let error = reader.read(&mut byte).expect_err("cancelled reader");
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
