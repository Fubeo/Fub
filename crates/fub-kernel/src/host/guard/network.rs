//! Il guard davanti alla rete: gli URL ammessi e il loopback.

use super::*;

impl<H: HostNetwork, P: Policy> Guard<H, P> {
    /// Il cancello di ogni richiesta di rete, qualunque sia il metodo: vedi
    /// [`fetch`](HostNetwork::fetch) qui sotto per l'ordine dei controlli.
    pub(super) fn admit_request(&self, request: &HttpRequest) -> Result<(), PluginError> {
        let (scheme, host) = split_url(&request.url)?;
        self.check(Capability::Network, || format!("connecting to `{host}`"))?;
        if let Some(why) = self.policy.denies_host(&host) {
            return Err(PluginError::PermissionDenied(
                format!("connecting to `{host}`: {why}").into(),
            ));
        }
        // Lo schema si guarda **dopo** i permessi, perché «non ti è concesso»
        // è una frase più utile di «l'URL è fatto male» a chi ha sbagliato
        // tutte e due.
        if scheme != "https" && !is_loopback(&host) {
            return Err(PluginError::BadArgs(
                format!(
                    "`{scheme}` is not `https`: in plaintext the allowlist promises one \
                     host and the network delivers another. The local loop is an \
                     exception, because there is no network to traverse"
                )
                .into(),
            ));
        }
        Ok(())
    }
}

impl<H: HostNetwork, P: Policy> HostNetwork for Guard<H, P> {
    /// **Due cancelli, e il secondo è il primo parametro di permesso che questo
    /// repo legge.** La famiglia dice *se*, l'allowlist dice *dove*, e senza il
    /// secondo il permesso prometterebbe una cosa che non fa — che è la
    /// differenza fra un recinto che perde e una frase falsa scritta dall'app.
    ///
    /// L'ordine conta e non è indifferente: prima la famiglia, così chi non ha
    /// `fub:network` legge *«non hai dichiarato il permesso»* e non un elenco
    /// di host che non lo riguarda.
    ///
    /// L'URL si legge **qui e una volta sola**. Non c'è un campo `host` accanto
    /// nella richiesta apposta: due posti in cui è scritto dove si va sono due
    /// posti che possono non essere d'accordo, e chi controlla ne guarderebbe
    /// uno solo.
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        self.admit_request(&request)?;
        self.inner.fetch(request)
    }

    fn fetch_cancelled(
        &self,
        request: HttpRequest,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<HttpResponse, PluginError> {
        self.admit_request(&request)?;
        self.inner.fetch_cancelled(request, cancelled)
    }

    /// Lo stesso cancello, e il tetto di byte va al filo com'è: senza questo
    /// inoltro il default scaricherebbe tutto e rifiuterebbe dopo.
    fn fetch_limited(
        &self,
        request: HttpRequest,
        cancelled: &std::sync::atomic::AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        self.admit_request(&request)?;
        self.inner.fetch_limited(request, cancelled, max_bytes)
    }
}

/// Lo schema e l'host di un URL, senza tirarsi dietro un parser di URL.
///
/// Fa **una** cosa e la fa stretta: quello che serve al cancello è dove si va,
/// e dove si va sta fra `://` e il primo `/`, `?` o `#`, meno le credenziali e
/// meno la porta. Ciò che questa funzione non sa fare — normalizzare i percorsi,
/// decodificare le sequenze percentuali, capire l'IDN — non le serve, perché non
/// costruisce l'URL: lo legge chi poi si connetterà davvero, e il cancello
/// guarda la stessa stringa.
///
/// Le credenziali (`user:pass@`) si scartano ed è la riga che conta: senza,
/// `https://api.acme.com@evil.example/` avrebbe un «host» che comincia con un
/// nome dichiarato e finisce su una macchina di qualcun altro. È il modo più
/// vecchio di far leggere a un umano un indirizzo e a una macchina un altro.
pub(super) fn split_url(url: &str) -> Result<(String, String), PluginError> {
    let malformed =
        || PluginError::BadArgs(format!("`{url}` is not a readable absolute URL").into());
    let (scheme, rest) = url.split_once("://").ok_or_else(malformed)?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .filter(|a| !a.is_empty())
        .ok_or_else(malformed)?;
    // Dopo l'ultima `@` c'è l'host: prima ci sono le credenziali.
    let hostport = authority.rsplit('@').next().unwrap_or(authority);
    let host = match hostport.strip_prefix('[') {
        // IPv6 letterale: `[::1]:8080`.
        Some(inside) => inside.split(']').next().unwrap_or(inside),
        None => hostport.split(':').next().unwrap_or(hostport),
    };
    if host.is_empty() {
        return Err(malformed());
    }
    Ok((
        scheme.trim().to_ascii_lowercase(),
        normalized_host(host).into_string(),
    ))
}

/// L'host è **questa macchina**?
///
/// Serve a una regola sola e vale la pena scriverla: `http` in chiaro è
/// rifiutato ovunque tranne qui, perché un modello che gira sul computer di chi
/// usa l'app — `http://localhost:11434` — non attraversa nessuna rete, e
/// pretendere TLS verso sé stessi vorrebbe dire escludere dal contratto
/// l'unico modo di usare l'AI senza mandare le proprie note a qualcuno.
///
/// L'indirizzo si **parsa**, e non si confronta come testo: `127.` come prefisso
/// di stringa non è una famiglia di indirizzi, è una famiglia di *nomi*.
/// `127.0.0.1.evil.example` è un nome registrabile — la prima etichetta di un
/// dominio può cominciare con una cifra — e con un `starts_with` si prendeva
/// l'esenzione di questa funzione: `http` in chiaro verso la macchina di
/// qualcun altro, cioè esattamente l'unica cosa che la regola esiste per
/// impedire. Chi è loopback lo dice [`IpAddr`](std::net::IpAddr), che quel
/// conto lo sa fare per `127.0.0.0/8` e per `::1` insieme; `localhost` resta a
/// parte perché è un nome, non un indirizzo.
pub(super) fn is_loopback(host: &str) -> bool {
    host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}
