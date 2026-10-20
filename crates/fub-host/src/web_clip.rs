//! Una pagina del visore web che diventa una nota: [`WEB_CLIP`].
//!
//! Il visore (`fub-app`, finestra `fub-viewer`) apre soltanto gli host che
//! l'utente ha approvato. Salvare la pagina come nota è la stessa promessa
//! vista dall'altra parte: la pagina si chiede di nuovo, dalla rete dell'host,
//! e soltanto se l'host della pagina è fra quelli che [`VIEWER_HOSTS`] tiene
//! su questa macchina. Il comando non si fida di chi lo chiama per sapere che
//! cosa è stato approvato: lo rilegge lui.
//!
//! Il testo è Markdown, non l'HTML della pagina: lo converte il clipper
//! ([`fub_importers::html_to_markdown`]), lo stesso dell'estensione del
//! browser, e lo scrive la cattura ([`crate::capture`]), con le sue regole di
//! nome, di formato e d'ordine delle scritture. La fonte resta nella nota.
//!
//! Niente si perde in silenzio: una pagina troppo grande, una risposta che non
//! è HTML, un redirect (la rete dell'host non li segue) sono errori che lo
//! dicono, e ciò che il clipper lascia fuori arriva nell'avviso.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::net::HttpRequest;
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;
use serde_json::Value;

use crate::automation::{validate_capture_v1, CaptureMode, CapturePayloadV1, CaptureTarget};
use crate::Host;

/// L'id del comando.
pub const WEB_CLIP: &str = "web.clip";

/// Gli host che il visore web può aprire su questa macchina: la lista che la
/// shell allunga quando l'utente dice «sempre per questo sito».
pub const VIEWER_HOSTS: &str = "viewer.hosts";

/// Se un link https di una nota si apre nel visore invece che nel browser di
/// sistema. È una preferenza della shell: l'host la dichiara e basta.
pub const VIEWER_LINKS: &str = "viewer.links";

/// Quanto HTML si converte, al più: il tetto del clipper.
pub const MAX_PAGE: usize = 2 * 1024 * 1024;

const URL: &str = "url";
const FOLDER: &str = "folder";

pub(crate) fn spec() -> CommandSpec {
    CommandSpec::new(WEB_CLIP, Text::key("host.web.clip.title"))
        .describing(Text::key("host.web.clip.desc"))
        .with_param(ParamSpec::new(URL, Text::key("host.param.url"), ParamKind::Text).required())
        .with_param(ParamSpec::new(
            FOLDER,
            Text::key("host.param.folder"),
            ParamKind::Text,
        ))
        .with_scope(CommandScope::writing(CommandReach::Vault))
}

/// L'host di un indirizzo che il visore può aprire: `https`, senza credenziali
/// e sulla porta 443, come vuole la politica della finestra. In minuscolo.
pub fn viewer_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| {
        url.get(..8)
            .filter(|scheme| scheme.eq_ignore_ascii_case("https://"))
            .map(|_| &url[8..])
    })?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    // Un indirizzo IPv6 fra parentesi non è un sito da approvare per nome.
    if authority.starts_with('[') {
        return None;
    }
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    if port.is_some_and(|port| port != "443") || host.is_empty() {
        return None;
    }
    if host
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '\\' | '%'))
    {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

/// `site` è fra gli host approvati su questa macchina? Il confronto è quello
/// di `fub-app::web_viewer::host_allowed`, che apre la finestra: chi salva e
/// chi apre devono dire sì agli stessi siti.
fn approved(host: &Host, site: &str) -> bool {
    match host.machine.effective(VIEWER_HOSTS) {
        Ok((SettingValue::List(hosts), _)) => hosts
            .iter()
            .any(|entry| entry.trim().eq_ignore_ascii_case(site)),
        _ => false,
    }
}

pub(crate) fn invoke(
    host: &Host,
    vault: Option<&str>,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    let spec = spec();
    spec.validate_args(&args)?;
    let args = Args::new(&args);
    let url = args.text(URL).expect("spec validata").trim().to_string();
    let folder = args
        .text(FOLDER)
        .map(str::trim)
        .filter(|folder| !folder.is_empty())
        .map(str::to_string);
    let Some(site) = viewer_host(&url) else {
        return Err(PluginError::PermissionDenied(Text::message(
            "host.web.clip.not_https",
            vec![Arg::text("url", &url)],
        )));
    };
    if !approved(host, &site) {
        return Err(PluginError::PermissionDenied(Text::message(
            "host.web.clip.not_approved",
            vec![Arg::text("site", &site)],
        )));
    }
    let target = CaptureTarget {
        vault: None,
        folder: folder.clone(),
        note: None,
        mode: CaptureMode::Create,
    };
    if mode.is_dry_run() {
        // La prova non chiama la rete: dice da dove e dove, con i controlli
        // della cattura su un titolo che la pagina non ha ancora dato.
        let payload = CapturePayloadV1 {
            v: 1,
            title: site.clone(),
            // Al posto del testo che non c'è ancora: la cattura ne vuole uno.
            markdown: url.clone(),
            source_url: Some(url.clone()),
            properties: None,
            target,
        };
        // Il nome vero viene dal titolo della pagina, che si sa solo dopo: la
        // prova promette la cartella, non il nome.
        let doc = crate::capture::plan(host, vault, &payload, None)?;
        let summary = match doc.as_str().rsplit_once('/') {
            Some((folder, _)) => Text::message(
                "host.web.clip.plan",
                vec![Arg::text("url", &url), Arg::text("folder", folder)],
            ),
            None => Text::message("host.web.clip.plan_root", vec![Arg::text("url", &url)]),
        };
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                Vec::new(),
            ))),
        );
    }
    let network = host
        .network()
        .ok_or_else(|| PluginError::Unserved(Text::key("host.web.clip.no_network")))?;
    // Nessun prestito è preso qui: la rete dura quanto vuole, il vault no.
    let response = network.fetch(HttpRequest::get(url.as_str()))?;
    if !(200..300).contains(&response.status) {
        return Err(PluginError::Io(Text::message(
            "host.web.clip.status",
            vec![
                Arg::text("url", &url),
                Arg::text("status", response.status.to_string()),
            ],
        )));
    }
    let kind = response.header("content-type");
    if !is_page(kind) {
        return Err(PluginError::BadArgs(Text::message(
            "host.web.clip.not_html",
            vec![Arg::text("kind", kind.unwrap_or_default())],
        )));
    }
    if response.body.len() > MAX_PAGE {
        return Err(PluginError::BadArgs(Text::message(
            "host.web.clip.too_large",
            vec![Arg::text("url", &url)],
        )));
    }
    let html = String::from_utf8_lossy(&response.body);
    let (markdown, _, notes) = fub_importers::html_to_markdown(&html);
    let title = page_title(&html).unwrap_or_else(|| site.clone());
    let payload = CapturePayloadV1 {
        v: 1,
        title,
        markdown: if markdown.trim().is_empty() {
            String::new()
        } else {
            markdown
        },
        source_url: Some(url.clone()),
        properties: None,
        target,
    };
    validate_capture_v1(&payload).map_err(|why| {
        PluginError::BadArgs(Text::message(
            "host.web.clip.refused",
            vec![Arg::text("why", why.to_string())],
        ))
    })?;
    let doc = crate::capture::apply(host, vault, &payload, None)?;
    let left_out: Vec<String> = notes
        .iter()
        .filter(|note| note.level != "info")
        .map(|note| note.message.clone())
        .collect();
    let notify = if left_out.is_empty() {
        Text::message("host.web.clip.done", vec![Arg::text("doc", doc.as_str())])
    } else {
        Text::message(
            "host.web.clip.done_with_notes",
            vec![
                Arg::text("doc", doc.as_str()),
                Arg::text("notes", left_out.join("; ")),
            ],
        )
    };
    Ok(CommandOutcome::notify(notify).with_effect(CommandEffect::Navigate { doc }))
}

/// Una risposta che si può leggere come pagina: HTML o un testo, oppure senza
/// tipo dichiarato. Il tipo di media non distingue il caso (RFC 9110).
fn is_page(kind: Option<&str>) -> bool {
    kind.is_none_or(|kind| {
        let kind = kind.to_ascii_lowercase();
        kind.contains("html") || kind.starts_with("text/")
    })
}

/// Il `<title>` della pagina, in una riga, con le entità più comuni sciolte.
fn page_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let open = lower.find("<title")?;
    let start = open + lower[open..].find('>')? + 1;
    let end = start + lower[start..].find("</title")?;
    let raw = &html[start..end];
    let text = fub_abi::html::unescape(&raw.replace("&nbsp;", " "));
    let flat: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect();
    (!flat.is_empty()).then_some(flat)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_viewer_takes_only_https_on_443_without_credentials() {
        assert_eq!(
            viewer_host("https://Esempio.it/a?b#c").as_deref(),
            Some("esempio.it")
        );
        assert_eq!(
            viewer_host("https://esempio.it:443/").as_deref(),
            Some("esempio.it")
        );
        assert_eq!(viewer_host("http://esempio.it/"), None);
        assert_eq!(viewer_host("https://esempio.it:8443/"), None);
        assert_eq!(viewer_host("https://io@esempio.it/"), None);
        assert_eq!(viewer_host("https:///percorso"), None);
        assert_eq!(viewer_host("file:///etc/passwd"), None);
        assert_eq!(viewer_host("javascript:alert(1)"), None);
    }

    #[test]
    fn the_title_is_one_line_with_entities_resolved() {
        assert_eq!(
            page_title("<html><head><TITLE>\n Lago &amp; monti </TITLE>").as_deref(),
            Some("Lago & monti")
        );
        assert_eq!(page_title("<p>niente</p>"), None);
    }
}
