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
            // **La riga che vale quanto una decisione.** Vedi la testa del
            // modulo: seguire un redirect è uscire dal recinto senza che
            // nessuno l'abbia deciso.
            .max_redirects(0)
            // Con zero redirect, `ureq` di suo renderebbe un errore invece
            // della risposta `3xx`: qui la vogliamo, perché è ciò che permette
            // a chi ha chiesto di decidere se seguirla.
            .max_redirects_will_error(false)
            .build();
        UreqNetwork {
            agent: ureq::Agent::new_with_config(config),
        }
    }
}

impl HostNetwork for UreqNetwork {
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        let io = |e: ureq::Error| PluginError::Io(format!("{}: {e}", request.url).into());

        let mut builder = ureq::http::Request::builder()
            .method(request.method.as_str())
            .uri(&request.url);
        for header in &request.headers {
            builder = builder.header(&header.name, &header.value);
        }
        // Il corpo cambia il **tipo** della richiesta, quindi i due rami sono
        // due chiamate e non un `if` dentro una: `none` non è un corpo vuoto.
        let mut response = match &request.body {
            Some(body) => {
                let req = builder
                    .body(&body[..])
                    .map_err(|e| PluginError::BadArgs(format!("{}: {e}", request.url).into()))?;
                self.agent.run(req).map_err(io)?
            }
            None => {
                let req = builder
                    .body(())
                    .map_err(|e| PluginError::BadArgs(format!("{}: {e}", request.url).into()))?;
                self.agent.run(req).map_err(io)?
            }
        };

        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                // Un header il cui valore non è testo è un header che non si
                // può rappresentare in questo contratto. Si scarta **lui** e
                // non la risposta: chi cerca `content-type` non deve perdere un
                // PDF perché il server ha mandato un byte storto in un header
                // che non gli interessa.
                value
                    .to_str()
                    .ok()
                    .map(|v| HttpHeader::new(name.as_str(), v))
            })
            .collect();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_BODY)
            .read_to_vec()
            .map_err(|e| {
                PluginError::Io(
                    format!(
                        "{}: il corpo della risposta non si è potuto leggere \
                         (il tetto dell'host è {MAX_BODY} byte): {e}",
                        request.url
                    )
                    .into(),
                )
            })?;

        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Che il client si costruisca **e** che la configurazione sia quella
    /// scritta: un agent con i redirect accesi passerebbe di qui verde, e i
    /// redirect sono la metà del recinto.
    #[test]
    fn il_client_nasce_senza_seguire_i_redirect() {
        let net = UreqNetwork::new();
        assert_eq!(
            net.agent.config().max_redirects(),
            0,
            "seguire un redirect è uscire dall'allowlist senza deciderlo"
        );
        assert!(
            !net.agent.config().max_redirects_will_error(),
            "un `3xx` deve tornare a chi ha chiesto, non diventare un errore: \
             è chi ha chiesto a decidere se seguirlo"
        );
    }

    /// Un URL che non si connette dà `Io` e non `Internal`: non è colpa di chi
    /// chiama, ed è la distinzione che permette a chi disegna di dire «la rete
    /// non risponde» invece di «errore interno del plugin».
    #[test]
    fn un_guasto_del_trasporto_e_io() {
        let net = UreqNetwork::new();
        // La porta 1 dell'anello locale non ascolta: la connessione fallisce
        // senza uscire dalla macchina, quindi questo test non ha bisogno di
        // rete e non diventa rosso su una macchina scollegata.
        let err = net
            .fetch(HttpRequest::get("http://127.0.0.1:1/niente"))
            .expect_err("nessuno ascolta lì");
        assert!(
            matches!(err, PluginError::Io(_)),
            "un guasto del trasporto è I/O, non un difetto di chi chiama: {err}"
        );
    }
}
