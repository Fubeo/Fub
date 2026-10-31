//! Il segnalibro web (K8), qui «scheda del collegamento» per non confonderlo
//! coi segnalibri della shell: un URL da solo nel suo paragrafo diventa una
//! scheda con titolo, descrizione e icona della pagina. **Solo su richiesta**:
//! la scheda si chiede col clic, e aprire una nota di altri non scarica niente.
//!
//! Il comando `linkcard.fetch` valida l'URL e guarda la cache del bundle: la
//! scheda che c'è torna subito nell'effetto `Custom` con `ns = fub.linkcard`.
//! Se manca e gli è stato chiesto di scaricarla, accoda il job
//! `linkcard.fetch`, che fuori dal lock del workspace scarica la pagina con
//! `fetch`, cioè attraverso la `Guard` e il permesso `fub:network` del bundle,
//! e consegna la scheda col suo `job_done`.
//! Spento l'interruttore del permesso, il job riceve il rifiuto e la nota
//! resta col suo link. Della pagina si leggono soltanto i metadati della testa
//! (`<title>`, `og:*`, `description`, l'icona): niente si esegue, e una pagina
//! più grande di [`MAX_PAGE`] non diventa una scheda. Il tempo è il tetto
//! dell'host (`net.rs`).
//!
//! La cache sta in `.fub/` come ogni cache di bundle, una scheda per URL in
//! `cards/<hash>.json` con la sua [`CARD_VERSION`]: è ricostruibile, e una
//! scheda illeggibile o di un'altra versione vale una scheda che non c'è.

use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandScope, CommandSpec, ParamKind, ParamSpec,
};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{HostApi, JobSpec, Plugin};
use fub_abi::{CommandProvider, PluginError, PluginManifest};

use base64::Engine as _;

/// Id del bundle.
pub const LINK_CARD_ID: &str = "fub.linkcard";
/// Id del comando (stabile: lo nomina la shell).
pub const LINK_CARD_FETCH: &str = "linkcard.fetch";
/// Il job che legge la cache e, se chiesto, la rete.
pub const LINK_CARD_JOB: &str = "linkcard.fetch";
/// La versione delle schede in cache: un'altra si rifà.
pub const CARD_VERSION: u32 = 1;
/// La pagina più grande che diventa una scheda.
pub const MAX_PAGE: usize = 1024 * 1024;
/// L'icona più grande che entra nella scheda.
pub const MAX_ICON: usize = 64 * 1024;
/// L'URL più lungo che si accetta.
pub const MAX_URL: usize = 2048;
const MAX_TITLE: usize = 300;
const MAX_DESCRIPTION: usize = 500;
const MAX_SITE: usize = 100;

fn manifest() -> PluginManifest {
    let mut manifest = PluginManifest::core(LINK_CARD_ID, "Link card");
    // Qualunque host: lo sceglie chi scrive il link, e il recinto è
    // l'interruttore del permesso.
    manifest
        .permissions
        .granted
        .set(fub_abi::options::permission::NETWORK, true);
    manifest.speaking(crate::settings::CORE_DEFAULT_LOCALE, catalog())
}

fn catalog() -> Vec<StringCatalog> {
    let it = StringCatalog::new("it")
        .with("cmd.fetch", "Anteprima del collegamento")
        .with(
            "cmd.fetch.desc",
            "Scarica titolo, descrizione e icona di una pagina web per la sua scheda.",
        )
        .with("cmd.fetch.url", "Indirizzo")
        .with("cmd.fetch.url.desc", "L'URL http o https della pagina.")
        .with("cmd.fetch.fetch", "Scarica")
        .with(
            "cmd.fetch.fetch.desc",
            "Se manca dalla cache, la scarica. Spento: soltanto la cache.",
        )
        .with("bad_url", "`{url}` non è un indirizzo http o https.");
    let en = StringCatalog::new("en")
        .with("cmd.fetch", "Link preview")
        .with(
            "cmd.fetch.desc",
            "Downloads a web page's title, description and icon for its card.",
        )
        .with("cmd.fetch.url", "Address")
        .with("cmd.fetch.url.desc", "The page's http or https URL.")
        .with("cmd.fetch.fetch", "Download")
        .with(
            "cmd.fetch.fetch.desc",
            "If the cache lacks it, downloads it. Off: the cache only.",
        )
        .with("bad_url", "`{url}` is not an http or https address.");
    vec![it, en]
}

pub struct LinkCardBundle;

impl crate::registry::Bundle for LinkCardBundle {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn trust(&self) -> fub_kernel::Trust {
        fub_kernel::Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(LinkCardPlugin)
    }

    fn register(&self, registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
        match registrar.register_command_provider(Box::new(LinkCardCommands)) {
            Ok(()) => Vec::new(),
            Err(error) => vec![format!("link card commands NOT registered: {error}")],
        }
    }
}

/// L'URL che il comando accetta: `http` o `https`, con un host, senza spazi e
/// non oltre [`MAX_URL`].
pub fn valid_url(url: &str) -> bool {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    url.len() <= MAX_URL
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
        && rest.is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'))
}

pub struct LinkCardCommands;

impl CommandProvider for LinkCardCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(LINK_CARD_FETCH, Text::key("cmd.fetch"))
            .describing(Text::key("cmd.fetch.desc"))
            .with_param(
                ParamSpec::new("url", Text::key("cmd.fetch.url"), ParamKind::Text)
                    .describing(Text::key("cmd.fetch.url.desc"))
                    .required(),
            )
            .with_param(
                ParamSpec::new("fetch", Text::key("cmd.fetch.fetch"), ParamKind::Bool)
                    .describing(Text::key("cmd.fetch.fetch.desc")),
            )
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: fub_abi::command::InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != LINK_CARD_FETCH {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let url = args
            .get("url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !valid_url(url) {
            return Err(PluginError::BadArgs(Text::message(
                "bad_url",
                vec![fub_abi::text::Arg::text("url", url)],
            )));
        }
        let fetch = args
            .get("fetch")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        // La cache risponde subito, senza job: aprire una nota con dieci
        // collegamenti non accende dieci righe nel centro attività.
        let card = cached(url, host);
        let pending = card.is_none() && fetch;
        if pending && !mode.is_dry_run() {
            host.spawn_job(JobSpec {
                job: LINK_CARD_JOB.to_string(),
                payload: serde_json::json!({ "url": url, "fetch": true }),
            })?;
        }
        Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
            ns: LINK_CARD_ID.to_string(),
            payload: serde_json::json!({ "url": url, "card": card, "pending": pending }),
        }))
    }
}

pub struct LinkCardPlugin;

impl Plugin for LinkCardPlugin {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if job != LINK_CARD_JOB {
            return Err(PluginError::UnknownJob(job.to_string().into()));
        }
        let url = payload
            .get("url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !valid_url(url) {
            return Err(PluginError::BadArgs(Text::message(
                "bad_url",
                vec![fub_abi::text::Arg::text("url", url)],
            )));
        }
        let fetch = payload
            .get("fetch")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        card(url, fetch, host)
    }
}

/// La scheda di una pagina, come la cache la tiene e la shell la mostra.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Card {
    pub version: u32,
    pub url: String,
    pub title: String,
    pub description: String,
    pub site: String,
    /// L'icona come `data:` URL, o vuota: la shell non scarica niente.
    pub icon: String,
}

/// Il path in cache della scheda di `url`: FNV-1a a 64 bit, abbastanza per un
/// nome di file; la scheda dentro ripete l'URL, e uno diverso vale assente.
pub fn cache_path(url: &str) -> String {
    format!("cards/{:016x}.json", fub_abi::Fnv1a::hash(url.as_bytes()))
}

/// La scheda in cache, se è leggibile, di questa versione e di questo URL.
fn cached(url: &str, host: &dyn HostApi) -> Option<Card> {
    let bytes = host.cache_read(&cache_path(url)).ok()??;
    let card: Card = serde_json::from_slice(&bytes).ok()?;
    (card.version == CARD_VERSION && card.url == url).then_some(card)
}

/// La risposta del job: `{url, card}` con la scheda o `null` se non c'è e non
/// si è chiesto di scaricarla; `{url, failed, status?}` se la pagina c'è ma non
/// fa una scheda. Errore resta la rete che non risponde o il permesso negato.
fn card(url: &str, fetch: bool, host: &mut dyn HostApi) -> Result<serde_json::Value, PluginError> {
    if let Some(card) = cached(url, host) {
        return Ok(serde_json::json!({ "url": url, "card": card, "cached": true }));
    }
    if !fetch {
        return Ok(serde_json::json!({ "url": url, "card": null }));
    }
    // La riga del centro attività dice il sito, che si legge in ogni lingua,
    // invece del nome del job.
    host.report_progress(fub_abi::traits::JobProgress {
        done: 0,
        total: None,
        label: Some(host_of(url).to_string()),
    });
    let response = host.fetch(
        HttpRequest::get(url)
            .with_header("Accept", "text/html,application/xhtml+xml")
            .with_header("User-Agent", format!("Fub/{}", env!("CARGO_PKG_VERSION"))),
    )?;
    let failed = |why: &str, response: &HttpResponse| {
        Ok(serde_json::json!({ "url": url, "failed": why, "status": response.status }))
    };
    if response.status != 200 {
        return failed("status", &response);
    }
    if response.body.len() > MAX_PAGE {
        return failed("too_large", &response);
    }
    let html = response
        .header("Content-Type")
        .is_none_or(|kind| kind.to_ascii_lowercase().contains("html"));
    if !html {
        return failed("not_html", &response);
    }
    let page = Page::read(&String::from_utf8_lossy(&response.body));
    let icon = page
        .icon
        .as_deref()
        .map(|href| resolve(url, href))
        .unwrap_or_else(|| format!("{}/favicon.ico", origin(url)));
    let card = Card {
        version: CARD_VERSION,
        url: url.to_string(),
        title: clipped(page.title.as_deref().unwrap_or(""), MAX_TITLE),
        description: clipped(page.description.as_deref().unwrap_or(""), MAX_DESCRIPTION),
        site: clipped(
            page.site.as_deref().unwrap_or_else(|| host_of(url)),
            MAX_SITE,
        ),
        icon: icon_data(&icon, host).unwrap_or_default(),
    };
    // Una cache che non si scrive non toglie la scheda: la prossima volta si
    // scaricherà di nuovo.
    if let Ok(bytes) = serde_json::to_vec(&card) {
        let _ = host.cache_write(&cache_path(url), &bytes);
    }
    Ok(serde_json::json!({ "url": url, "card": card, "cached": false }))
}

/// L'icona come `data:` URL, se arriva, è un'immagine raster e sta in
/// [`MAX_ICON`]. Un SVG no: è un documento, non un'immagine.
fn icon_data(url: &str, host: &mut dyn HostApi) -> Option<String> {
    if !valid_url(url) {
        return None;
    }
    let response = host.fetch(HttpRequest::get(url)).ok()?;
    if response.status != 200 || response.body.is_empty() || response.body.len() > MAX_ICON {
        return None;
    }
    let declared = response.header("Content-Type").map(|kind| {
        kind.split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
    });
    let kind = sniffed(&response.body)?;
    if declared
        .as_deref()
        .is_some_and(|declared| declared.contains("svg"))
    {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&response.body);
    Some(format!("data:{kind};base64,{encoded}"))
}

/// Il tipo di un'immagine dai suoi primi byte: soltanto quelli che una scheda
/// mostra.
fn sniffed(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else {
        None
    }
}

/// `scheme://host[:port]` di un URL già valido.
fn origin(url: &str) -> &str {
    let after = url.find("://").map_or(0, |at| at + 3);
    let end = url[after..]
        .find(['/', '?', '#'])
        .map_or(url.len(), |at| after + at);
    &url[..end]
}

/// L'host di un URL già valido, senza porta né credenziali.
fn host_of(url: &str) -> &str {
    let origin = origin(url);
    let host = &origin[origin.find("://").map_or(0, |at| at + 3)..];
    let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
    host.split(':').next().unwrap_or(host)
}

/// `href` letto rispetto alla pagina `base`.
fn resolve(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.starts_with("https://") || href.starts_with("http://") {
        return href.to_string();
    }
    if let Some(rest) = href.strip_prefix("//") {
        let scheme = &base[..base.find("://").unwrap_or(0)];
        return format!("{scheme}://{rest}");
    }
    let origin = origin(base);
    if href.starts_with('/') {
        return format!("{origin}{href}");
    }
    let path = &base[origin.len()..];
    let path = path.split(['?', '#']).next().unwrap_or("");
    let dir = path.rsplit_once('/').map_or("", |(dir, _)| dir);
    format!("{origin}{dir}/{href}")
}

/// Al più `max` caratteri, con gli spazi ridotti a uno.
fn clipped(text: &str, max: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match joined.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", joined[..at].trim_end()),
        None => joined,
    }
}

/// I metadati della testa di una pagina.
#[derive(Debug, Default, PartialEq, Eq)]
struct Page {
    title: Option<String>,
    description: Option<String>,
    site: Option<String>,
    icon: Option<String>,
}

impl Page {
    /// Legge la testa: fino a `</head>`, o tutta la pagina se non la chiude.
    /// `og:` vince sui tag semplici, perché è il titolo che la pagina dà di sé
    /// quando la si condivide.
    fn read(html: &str) -> Page {
        let lower = html.to_ascii_lowercase();
        let end = lower.find("</head").unwrap_or(html.len());
        let (html, lower) = (&html[..end], &lower[..end]);
        let mut page = Page::default();
        let mut og_title = None;
        let mut og_description = None;
        for (at, _) in lower.match_indices("<meta") {
            let Some(attrs) = tag_attrs(&html[at..]) else {
                continue;
            };
            let key = attr(&attrs, "property").or_else(|| attr(&attrs, "name"));
            let content = attr(&attrs, "content").map(|c| decoded(&c));
            let (Some(key), Some(content)) = (key, content) else {
                continue;
            };
            match key.to_ascii_lowercase().as_str() {
                "og:title" => og_title = Some(content),
                "og:description" => og_description = Some(content),
                "description" if page.description.is_none() => page.description = Some(content),
                "og:site_name" => page.site = Some(content),
                _ => {}
            }
        }
        if let Some(open) = lower.find("<title") {
            let start = lower[open..].find('>').map(|at| open + at + 1);
            if let Some(start) = start {
                let stop = lower[start..].find("</title").map_or(end, |at| start + at);
                page.title = Some(decoded(&html[start..stop]));
            }
        }
        for (at, _) in lower.match_indices("<link") {
            let Some(attrs) = tag_attrs(&html[at..]) else {
                continue;
            };
            let rel = attr(&attrs, "rel").unwrap_or_default().to_ascii_lowercase();
            if rel.split_whitespace().any(|word| word == "icon") {
                if let Some(href) = attr(&attrs, "href") {
                    page.icon = Some(decoded(&href));
                    break;
                }
            }
        }
        if og_title.is_some() {
            page.title = og_title;
        }
        if og_description.is_some() {
            page.description = og_description;
        }
        page.title = page.title.filter(|t| !t.trim().is_empty());
        page.description = page.description.filter(|t| !t.trim().is_empty());
        page.site = page.site.filter(|t| !t.trim().is_empty());
        page
    }
}

/// Gli attributi di un tag che comincia in `tag` (`<meta …>`), nome in
/// minuscolo e valore com'è scritto.
fn tag_attrs(tag: &str) -> Option<Vec<(String, String)>> {
    let body = &tag[tag.find(|c: char| c.is_whitespace())?..];
    let mut out = Vec::new();
    let mut rest = body;
    loop {
        rest = rest.trim_start();
        if rest.is_empty() || rest.starts_with('>') || rest.starts_with("/>") {
            return Some(out);
        }
        let name_end = rest
            .find(|c: char| c.is_whitespace() || c == '=' || c == '>' || c == '/')
            .unwrap_or(rest.len());
        if name_end == 0 {
            rest = &rest[1..];
            continue;
        }
        let name = rest[..name_end].to_ascii_lowercase();
        rest = rest[name_end..].trim_start();
        let mut value = String::new();
        if let Some(after) = rest.strip_prefix('=') {
            let after = after.trim_start();
            if let Some(quote) = after.chars().next().filter(|c| *c == '"' || *c == '\'') {
                let inner = &after[1..];
                let close = inner.find(quote).unwrap_or(inner.len());
                value = inner[..close].to_string();
                rest = inner.get(close + 1..).unwrap_or("");
            } else {
                let stop = after
                    .find(|c: char| c.is_whitespace() || c == '>')
                    .unwrap_or(after.len());
                value = after[..stop].to_string();
                rest = &after[stop..];
            }
        }
        out.push((name, value));
    }
}

fn attr(attrs: &[(String, String)], name: &str) -> Option<String> {
    attrs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

/// Le entità HTML più comuni, nominate e numeriche; le altre restano scritte.
fn decoded(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(semi) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..semi];
        let named = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => None,
        };
        let numeric = entity
            .strip_prefix('#')
            .and_then(|n| match n.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => n.parse().ok(),
            });
        match named.or_else(|| numeric.and_then(char::from_u32)) {
            Some(c) => {
                out.push(c);
                rest = &rest[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::net::HttpHeader;
    use fub_abi::traits::{DataRead, DataWrite};
    use fub_abi::InvokeMode;
    use fub_sdk::testing::MemoryHost;

    fn answer(status: u16, kind: &str, body: &[u8]) -> HttpResponse {
        HttpResponse {
            status,
            headers: vec![HttpHeader {
                name: "Content-Type".into(),
                value: kind.into(),
            }],
            body: body.to_vec(),
        }
    }

    const PAGE: &str = r#"<!doctype html><html><head>
        <title>Il titolo &amp; basta</title>
        <meta name="description" content="Una descrizione semplice.">
        <meta property='og:title' content="Il titolo condiviso">
        <meta property="og:site_name" content="Esempio">
        <link rel="shortcut icon" href="/img/icona.png">
        <script>alert(1)</script>
        </head><body><meta property="og:title" content="nel corpo"></body></html>"#;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000";

    #[test]
    fn the_command_answers_from_the_cache_and_queues_only_when_asked() {
        let mut host = MemoryHost::new();
        let effect = |host: &mut MemoryHost, fetch: bool| {
            let outcome = LinkCardCommands
                .invoke(
                    LINK_CARD_FETCH,
                    serde_json::json!({ "url": "https://esempio.it/a", "fetch": fetch }),
                    InvokeMode::Apply,
                    host,
                )
                .unwrap();
            match outcome.effect {
                CommandEffect::Custom { ns, payload } if ns == LINK_CARD_ID => payload,
                other => panic!("{other:?}"),
            }
        };
        let out = effect(&mut host, false);
        assert!(out["card"].is_null() && out["pending"] == false, "{out}");
        let out = effect(&mut host, true);
        assert_eq!(out["pending"], true);
        assert!(host.network_requests().is_empty());

        // Una scheda in cache risponde senza job.
        let card = Card {
            version: CARD_VERSION,
            url: "https://esempio.it/a".into(),
            title: "A".into(),
            description: String::new(),
            site: "esempio.it".into(),
            icon: String::new(),
        };
        host.cache_write(&cache_path(&card.url), &serde_json::to_vec(&card).unwrap())
            .unwrap();
        let out = effect(&mut host, true);
        assert_eq!(out["card"]["title"], "A");
        assert_eq!(out["pending"], false);
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://",
            "https:///x",
            "https://a b",
        ] {
            let error = LinkCardCommands
                .invoke(
                    LINK_CARD_FETCH,
                    serde_json::json!({ "url": bad }),
                    InvokeMode::Apply,
                    &mut host,
                )
                .unwrap_err();
            assert!(matches!(error, PluginError::BadArgs(_)), "{bad}");
        }
    }

    #[test]
    fn a_page_becomes_a_card_with_its_icon_and_lands_in_the_cache() {
        let mut host = MemoryHost::new()
            .with_response(answer(200, "text/html; charset=utf-8", PAGE.as_bytes()))
            .with_response(answer(200, "image/png", PNG));
        let out = card("https://esempio.it/articoli/uno?x=1", true, &mut host).unwrap();
        let card = &out["card"];
        assert_eq!(card["title"], "Il titolo condiviso");
        assert_eq!(card["description"], "Una descrizione semplice.");
        assert_eq!(card["site"], "Esempio");
        assert!(card["icon"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        let asked = host.network_requests();
        assert_eq!(asked[1].url, "https://esempio.it/img/icona.png");
        assert!(host
            .cache_read(&cache_path("https://esempio.it/articoli/uno?x=1"))
            .unwrap()
            .is_some());

        // La seconda volta risponde la cache, senza rete.
        let again = super::card("https://esempio.it/articoli/uno?x=1", true, &mut host).unwrap();
        assert_eq!(again["cached"], true);
        assert_eq!(host.network_requests().len(), 2);
    }

    #[test]
    fn without_asking_only_the_cache_answers() {
        let mut host = MemoryHost::new();
        let out = card("https://esempio.it/", false, &mut host).unwrap();
        assert!(out["card"].is_null());
        assert!(host.network_requests().is_empty());
    }

    #[test]
    fn a_huge_or_foreign_answer_is_an_outcome_and_nothing_is_cached() {
        let huge = vec![b'a'; MAX_PAGE + 1];
        let mut host = MemoryHost::new().with_response(answer(200, "text/html", &huge));
        let out = card("https://esempio.it/", true, &mut host).unwrap();
        assert_eq!(out["failed"], "too_large");
        assert!(host
            .cache_read(&cache_path("https://esempio.it/"))
            .unwrap()
            .is_none());

        let mut host = MemoryHost::new().with_response(answer(404, "text/html", b""));
        assert_eq!(
            card("https://esempio.it/", true, &mut host).unwrap()["failed"],
            "status"
        );

        let mut host = MemoryHost::new().with_response(answer(200, "application/pdf", b"%PDF"));
        assert_eq!(
            card("https://esempio.it/", true, &mut host).unwrap()["failed"],
            "not_html"
        );
    }

    #[test]
    fn a_network_that_does_not_answer_is_an_error() {
        let mut host = MemoryHost::new().with_network_fault("timed out");
        assert!(card("https://esempio.it/", true, &mut host).is_err());
    }

    #[test]
    fn a_ruined_cache_is_rebuilt() {
        let url = "https://esempio.it/";
        let mut host = MemoryHost::new()
            .with_response(answer(200, "text/html", b"<title>Nuovo</title>"))
            .with_network_fault("no icon");
        host.cache_write(&cache_path(url), b"{not json").unwrap();
        let out = card(url, true, &mut host).unwrap();
        assert_eq!(out["card"]["title"], "Nuovo");
        assert_eq!(out["card"]["icon"], "");
        let bytes = host.cache_read(&cache_path(url)).unwrap().unwrap();
        let rebuilt: Card = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(rebuilt.version, CARD_VERSION);

        // Un'altra versione vale una scheda che non c'è.
        let old = serde_json::to_vec(&Card {
            version: 0,
            ..rebuilt
        })
        .unwrap();
        host.cache_write(&cache_path(url), &old).unwrap();
        let out = card(url, false, &mut host).unwrap();
        assert!(out["card"].is_null());
    }

    #[test]
    fn an_svg_or_oversized_icon_is_left_out() {
        let mut host = MemoryHost::new()
            .with_response(answer(
                200,
                "text/html",
                b"<link rel=icon href=i.svg><title>T</title>",
            ))
            .with_response(answer(200, "image/svg+xml", b"<svg onload=alert(1)>"));
        assert_eq!(
            card("https://esempio.it/a/b", true, &mut host).unwrap()["card"]["icon"],
            ""
        );
        assert_eq!(host.network_requests()[1].url, "https://esempio.it/a/i.svg");

        let big = [PNG, &vec![0; MAX_ICON][..]].concat();
        let mut host = MemoryHost::new()
            .with_response(answer(200, "text/html", b"<title>T</title>"))
            .with_response(answer(200, "image/png", &big));
        let out = card("https://esempio.it:8080/x", true, &mut host).unwrap();
        assert_eq!(out["card"]["icon"], "");
        assert_eq!(out["card"]["site"], "esempio.it");
        assert_eq!(
            host.network_requests()[1].url,
            "https://esempio.it:8080/favicon.ico"
        );
    }

    #[test]
    fn the_head_is_read_without_running_anything() {
        let page = Page::read(
            "<TITLE>\n  Spazi   e &#233;&#x20AC; </TITLE><meta content=\"x\" name=description>",
        );
        assert_eq!(
            page.title.as_deref().map(|t| clipped(t, 99)).as_deref(),
            Some("Spazi e é€")
        );
        assert_eq!(page.description.as_deref(), Some("x"));
        assert_eq!(clipped(&"a".repeat(10), 4), "aaaa…");
        assert_eq!(decoded("a & b &bogus; &amp;"), "a & b &bogus; &");
    }

    #[test]
    fn relative_links_resolve_against_the_page() {
        assert_eq!(
            resolve("https://a.it/x/y?q", "z.png"),
            "https://a.it/x/z.png"
        );
        assert_eq!(resolve("https://a.it/x/y", "/z.png"), "https://a.it/z.png");
        assert_eq!(
            resolve("http://a.it", "//cdn.it/z.png"),
            "http://cdn.it/z.png"
        );
        assert_eq!(host_of("https://u:p@a.it:9/x"), "a.it");
    }

    #[test]
    fn the_manifest_asks_for_the_network() {
        assert_eq!(
            manifest()
                .permissions
                .granted
                .get(fub_abi::options::permission::NETWORK),
            Some(&serde_json::json!(true))
        );
    }
}
