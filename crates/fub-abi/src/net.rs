//! Una richiesta e una risposta, e niente di più (§23.3).
//!
//! Sono i tipi di [`HostNetwork::fetch`](crate::traits::HostNetwork::fetch), la
//! capacità che la [0013](../../../docs/decisions/0013-elenco-delle-capacita.md)
//! aveva tenuto fuori con due bloccanti nominati e la
//! [0097](../../../docs/decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md)
//! ha fatto entrare quando erano caduti tutti e due.
//!
//! # Perché una richiesta e non un metodo per verbo
//!
//! Perché un `record` cresce per aggiunta e un elenco di funzioni no. La
//! [0007](../../../docs/decisions/0007-contesto-di-sessione.md) scrive il
//! criterio — *«un campo in più a un record è una migrazione di ogni provider
//! che lo riceve»*, quindi i campi si mettono **tutti adesso** — e qui il
//! criterio si applica per intero: `method`, `headers` e `body` nascono con la
//! prima versione anche se il primo cliente farà solo dei GET, perché
//! aggiungerli dopo il freeze costerebbe a chi li riceve e un `fetch-post`
//! accanto a `fetch-get` sarebbe la trappola delle due firme per la stessa
//! domanda.
//!
//! # Byte e non testo, che è la 0087 letta al contrario
//!
//! La [0087](../../../docs/decisions/0087-il-testo-che-sta-dentro-gli-allegati.md)
//! ha deciso per i documenti che il testo è il default e i byte gli stanno
//! accanto, con l'argomento che *«chi legge del testo non deve poter dimenticare
//! di decodificare»*. Per una risposta HTTP la stessa regola dà il risultato
//! opposto, e la ragione è una differenza vera fra le due cose: **un file sul
//! disco non dice di che codifica è, una risposta HTTP sì**. Il `Content-Type`
//! è nella risposta, quindi decodificare non è indovinare — ma non è nemmeno
//! sempre giusto: mezza rete risponde `image/png`, `application/pdf`,
//! `application/zip`. Un corpo `string` costringerebbe l'host a decidere per
//! tutti, e a sbagliare per chi scarica un allegato.
//!
//! Quindi il corpo è `list<u8>` e il `Content-Type` sta **dove HTTP lo mette**,
//! fra gli header. Non c'è un campo `content-type` accanto: sarebbe lo stesso
//! dato in due posti, cioè due posti che possono non essere d'accordo — la
//! trappola che la 0007 descrive per `active-document`.
//! [`HttpResponse::content_type`] lo legge dagli header, ed è **codice** e non
//! contratto: una comodità che non può divergere da ciò che è arrivato.

use serde::{Deserialize, Serialize};

/// Il verbo di una richiesta.
///
/// Sono sei e non «quelli che servono adesso», per la ragione del modulo: un
/// caso in fondo a un enum dopo il freeze è una minor, ma un plugin scritto
/// contro un enum che ne aveva due dovrà essere riscritto per usarne un terzo.
/// Non ci sono `CONNECT` e `TRACE`, che non sono verbi applicativi: il primo
/// apre un tunnel — cioè esce dalla domanda che questa capacità sa recintare —
/// e il secondo si fa rimandare indietro la richiesta.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HttpMethod {
    #[default]
    Get,
    Head,
    Post,
    Put,
    Patch,
    Delete,
}

impl HttpMethod {
    /// Il verbo come lo scrive HTTP.
    pub fn as_str(self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Head => "HEAD",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
        }
    }
}

/// Un header, come coppia.
///
/// Una lista di coppie e non una mappa perché HTTP permette lo **stesso nome
/// più volte** (`Set-Cookie` è il caso normale, non l'eccezione), e una mappa
/// perderebbe silenziosamente tutte le occorrenze tranne una. È anche la forma
/// che WIT sa dire, per la stessa ragione per cui [`OptionMap`](crate::options)
/// al confine è una lista di coppie.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpHeader {
    /// Il nome, come lo si è scritto. Il confronto è **senza distinzione di
    /// maiuscole**, perché è così che HTTP lo definisce.
    pub name: String,
    pub value: String,
}

impl HttpHeader {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        HttpHeader {
            name: name.into(),
            value: value.into(),
        }
    }
}

/// Cosa si chiede, e a chi.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpRequest {
    /// L'URL assoluto. È **l'unico posto** in cui sta l'host a cui ci si
    /// connette, ed è quello che l'allowlist del manifest confronta: non c'è un
    /// campo `host` accanto, perché due posti in cui sta scritto dove si va
    /// sono due posti che possono non essere d'accordo, e chi controlla ne
    /// guarderebbe uno solo.
    pub url: String,
    #[serde(default)]
    pub method: HttpMethod,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
    /// Il corpo, per i verbi che ne hanno uno. `None` non è un corpo vuoto: è
    /// *non c'è corpo*, e sono due richieste diverse sul filo.
    #[serde(default)]
    pub body: Option<Vec<u8>>,
}

impl HttpRequest {
    /// Un GET, che è la richiesta che quasi tutti vogliono.
    pub fn get(url: impl Into<String>) -> Self {
        HttpRequest {
            url: url.into(),
            method: HttpMethod::Get,
            headers: Vec::new(),
            body: None,
        }
    }

    pub fn with_method(mut self, method: HttpMethod) -> Self {
        self.method = method;
        self
    }

    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push(HttpHeader::new(name, value));
        self
    }

    pub fn with_body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = Some(body.into());
        self
    }
}

/// Cosa è arrivato.
///
/// **Uno stato 404 o 500 è un `Ok`**, e non è una sottigliezza: chi chiama deve
/// poter distinguere *«ho chiesto e mi hanno detto di no»* da *«non ho potuto
/// chiedere»*, perché le due si correggono in modi opposti — la prima guardando
/// la risposta, la seconda riprovando o dicendolo a chi guarda. È la stessa
/// distinzione che la [0041](../../../docs/decisions/0041-un-errore-e-testo-che-qualcuno-legge.md)
/// fa fra un errore e un esito, applicata al filo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpResponse {
    /// Il codice di stato, com'è arrivato.
    pub status: u16,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
    /// Il corpo, in byte. Vedi la testa del modulo per il perché non è testo.
    #[serde(default)]
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// Il valore del primo header con questo nome, confrontato **senza
    /// distinzione di maiuscole** come vuole HTTP.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str())
    }

    /// Il `Content-Type`, se c'è. È il campo che **non** sta nel record: sta
    /// qui, dove non può divergere da ciò che è arrivato.
    pub fn content_type(&self) -> Option<&str> {
        self.header("content-type")
    }

    /// La risposta dice **vai altrove**? In tal caso il valore è la
    /// destinazione grezza, così com'è nel `Location`.
    ///
    /// Serve perché [`fetch`](crate::traits::HostNetwork::fetch) **non segue i
    /// redirect** — la ragione sta sulla firma — e chi vuole seguirli fa una
    /// seconda chiamata, che ripassa dal cancello.
    pub fn redirect_to(&self) -> Option<&str> {
        matches!(self.status, 301 | 302 | 303 | 307 | 308)
            .then(|| self.header("location"))
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_are_compared_case_insensitively() {
        let r = HttpResponse {
            status: 200,
            headers: vec![HttpHeader::new("Content-Type", "application/json")],
            body: Vec::new(),
        };
        assert_eq!(r.content_type(), Some("application/json"));
        assert_eq!(r.header("CONTENT-TYPE"), Some("application/json"));
    }

    /// Lo stesso nome più volte è HTTP normale, e una mappa lo avrebbe perso.
    #[test]
    fn the_same_header_can_repeat() {
        let r = HttpResponse {
            status: 200,
            headers: vec![
                HttpHeader::new("Set-Cookie", "a=1"),
                HttpHeader::new("Set-Cookie", "b=2"),
            ],
            body: Vec::new(),
        };
        assert_eq!(r.headers.len(), 2, "neither is lost");
        assert_eq!(r.header("set-cookie"), Some("a=1"), "and the first is the first");
    }

    /// Un redirect si **vede** invece di essere seguito: è la proprietà su cui
    /// poggia il fatto che l'allowlist non si possa scavalcare.
    #[test]
    fn a_redirect_is_read_not_followed() {
        let r = HttpResponse {
            status: 302,
            headers: vec![HttpHeader::new("Location", "https://altrove.example/x")],
            body: Vec::new(),
        };
        assert_eq!(r.redirect_to(), Some("https://altrove.example/x"));
        let ok = HttpResponse {
            status: 200,
            headers: vec![HttpHeader::new("Location", "https://altrove.example/x")],
            body: Vec::new(),
        };
        assert_eq!(
            ok.redirect_to(),
            None,
            "a `Location` on a 200 is not a redirect"
        );
    }

    /// Un 404 è una risposta e non un guasto: qui si presidia che il tipo sappia
    /// dirlo, cioè che lo stato ci sia e sia quello arrivato.
    #[test]
    fn an_error_status_remains_a_response() {
        let r = HttpResponse {
            status: 404,
            headers: Vec::new(),
            body: b"not here".to_vec(),
        };
        assert_eq!(r.status, 404);
        assert!(!r.body.is_empty(), "and the body of an error is readable");
    }
}
