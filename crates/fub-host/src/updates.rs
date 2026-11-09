//! Il controllo degli aggiornamenti: **solo su richiesta**, mai in sottofondo.
//!
//! Il comando `updates.check` valida e accoda il job `updates.check`; il job,
//! fuori dal lock del workspace, chiede a GitHub l'ultima release pubblicata
//! del repository e la confronta con la versione di questo binario. Non
//! scarica e non installa niente: dice se c'è una versione più nuova e dove
//! guardarla. Il manifest concede la rete al solo `api.github.com`, così il
//! `Guard` chiude ogni altro host anche se il codice sbagliasse URL.
//!
//! Nessun controllo automatico all'avvio, per scelta: chiedere a un server
//! «che versione hai?» dice a quel server che l'app è aperta, e lo decide
//! l'utente premendo il pulsante.

use fub_abi::command::{CommandOutcome, CommandScope, CommandSpec};
use fub_abi::net::HttpRequest;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{HostApi, JobSpec, Plugin};
use fub_abi::{CommandProvider, PluginError, PluginManifest};

/// Id del bundle.
pub const UPDATES_ID: &str = "fub.updates";
/// Id del comando (stabile: lo nominano la shell e le scorciatoie).
pub const UPDATES_CHECK: &str = "updates.check";
/// Il job che fa la domanda in rete.
pub const UPDATES_CHECK_JOB: &str = "updates.check";

const API_HOST: &str = "api.github.com";
const LATEST_RELEASE: &str = "https://api.github.com/repos/Fubeo/Fub/releases/latest";
/// Le ultime release, pre-release comprese (le bozze non arrivano senza
/// autenticazione): la chiede soltanto chi ha una pre-release.
const RELEASES_LIST: &str = "https://api.github.com/repos/Fubeo/Fub/releases?per_page=30";
/// La pagina di una release si consegna alla shell soltanto se sta qui: un
/// link arrivato dalla rete non diventa un link qualunque nella finestra.
const RELEASES_PAGE: &str = "https://github.com/Fubeo/Fub/releases/";

/// La versione di questo binario, quella che il controllo confronta.
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn manifest() -> PluginManifest {
    let mut manifest = PluginManifest::core(UPDATES_ID, "Updates");
    manifest.permissions.granted.set(
        fub_abi::options::permission::NETWORK,
        serde_json::json!([API_HOST]),
    );
    manifest.speaking(crate::settings::CORE_DEFAULT_LOCALE, catalog())
}

fn catalog() -> Vec<StringCatalog> {
    let it = StringCatalog::new("it")
        .with("cmd.check", "Controlla aggiornamenti")
        .with(
            "cmd.check.desc",
            "Chiede a GitHub qual è l'ultima versione pubblicata di Fub.",
        )
        .with("queued", "Controllo degli aggiornamenti avviato.");
    let en = StringCatalog::new("en")
        .with("cmd.check", "Check for updates")
        .with(
            "cmd.check.desc",
            "Asks GitHub which is the latest published version of Fub.",
        )
        .with("queued", "Update check started.");
    vec![it, en]
}

pub struct UpdatesBundle;

impl crate::registry::Bundle for UpdatesBundle {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn trust(&self) -> fub_kernel::Trust {
        fub_kernel::Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(UpdatesPlugin)
    }

    fn register(&self, registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
        match registrar.register_command_provider(Box::new(UpdatesCommands)) {
            Ok(()) => Vec::new(),
            Err(error) => vec![format!("updates commands NOT registered: {error}")],
        }
    }
}

pub struct UpdatesCommands;

impl CommandProvider for UpdatesCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(UPDATES_CHECK, Text::key("cmd.check"))
            .describing(Text::key("cmd.check.desc"))
            .with_scope(CommandScope::read_only())]
    }

    fn invoke(
        &self,
        command: &str,
        _args: serde_json::Value,
        mode: fub_abi::command::InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != UPDATES_CHECK {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        if !mode.is_dry_run() {
            host.spawn_job(JobSpec {
                job: UPDATES_CHECK_JOB.to_string(),
                payload: serde_json::json!({}),
            })?;
        }
        Ok(CommandOutcome::notify(Text::key("queued")))
    }
}

pub struct UpdatesPlugin;

impl Plugin for UpdatesPlugin {
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
        _payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if job != UPDATES_CHECK_JOB {
            return Err(PluginError::UnknownJob(job.to_string().into()));
        }
        check(CURRENT_VERSION, host)
    }
}

/// La domanda e la risposta: `{current, latest, newer, url}`. Nessuna release
/// pubblicata (404, o una lista senza release) è un esito, `latest: null`. Una
/// risposta che non si usa — un altro stato, un corpo che non si capisce, un
/// tag che non è una versione — è un esito anch'esso, `{current, failed,
/// status}`: chi chiede ha avuto una risposta, e la shell la dice nella lingua
/// di chi guarda. Errore resta soltanto la rete che non risponde.
///
/// Chi ha una release vera chiede `/releases/latest`, che GitHub dà solo per
/// le release vere: non vede le pre-release. Chi ha una pre-release chiede la
/// lista delle ultime release e prende la versione più alta fra quelle che si
/// leggono, pre-release o no: decide il tag, non il flag `prerelease`.
fn check(current: &str, host: &mut dyn HostApi) -> Result<serde_json::Value, PluginError> {
    let running = Version::parse(current);
    let wants_list = running.as_ref().is_some_and(|version| !version.release);
    let endpoint = if wants_list {
        RELEASES_LIST
    } else {
        LATEST_RELEASE
    };
    let response = host.fetch(
        HttpRequest::get(endpoint)
            .with_header("Accept", "application/vnd.github+json")
            .with_header("User-Agent", format!("Fub/{current}")),
    )?;
    let failed = |why: &str| -> Result<serde_json::Value, PluginError> {
        Ok(serde_json::json!({
            "current": current,
            "failed": why,
            "status": response.status,
        }))
    };
    let nothing_published = || -> Result<serde_json::Value, PluginError> {
        Ok(serde_json::json!({
            "current": current,
            "latest": null,
            "newer": false,
            "url": null,
        }))
    };
    if response.status == 404 {
        return nothing_published();
    }
    if response.status != 200 {
        return failed("status");
    }
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(&response.body) else {
        return failed("unreadable");
    };
    let (latest, newest, release) = if wants_list {
        let Some(releases) = body.as_array() else {
            return failed("unreadable");
        };
        match highest_release(releases) {
            Highest::Found(tag, version, release) => (tag, version, release),
            Highest::NoTags => return nothing_published(),
            Highest::NoVersions => return failed("version"),
        }
    } else {
        let Some(tag) = body.get("tag_name").and_then(serde_json::Value::as_str) else {
            return failed("unreadable");
        };
        let latest = tag.strip_prefix('v').unwrap_or(tag);
        let Some(newest) = Version::parse(latest) else {
            return failed("version");
        };
        (latest, newest, &body)
    };
    let Some(running) = running else {
        return failed("version");
    };
    let url = release
        .get("html_url")
        .and_then(serde_json::Value::as_str)
        .filter(|url| url.starts_with(RELEASES_PAGE));
    Ok(serde_json::json!({
        "current": current,
        "latest": latest,
        "newer": newest > running,
        "url": url,
    }))
}

/// Cosa c'è di più alto in una lista di release di GitHub.
enum Highest<'a> {
    /// Il tag senza `v`, la sua versione e la release da cui viene.
    Found(&'a str, Version, &'a serde_json::Value),
    /// Nessuna release con un tag: per chi chiede, niente di pubblicato.
    NoTags,
    /// Release con un tag, ma nessun tag è una versione.
    NoVersions,
}

/// La versione più alta della lista. Una bozza (che senza autenticazione non
/// arriva) o una voce senza `tag_name` non è una release pubblicata e non
/// conta; un tag che non è una versione si salta. A parità di versione resta
/// la prima voce, la più recente per GitHub.
fn highest_release(releases: &[serde_json::Value]) -> Highest<'_> {
    let mut tagged = false;
    let mut best: Option<(&str, Version, &serde_json::Value)> = None;
    for release in releases {
        if release.get("draft").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        let Some(tag) = release.get("tag_name").and_then(serde_json::Value::as_str) else {
            continue;
        };
        tagged = true;
        let tag = tag.strip_prefix('v').unwrap_or(tag);
        let Some(version) = Version::parse(tag) else {
            continue;
        };
        if best.as_ref().is_none_or(|(_, top, _)| version > *top) {
            best = Some((tag, version, release));
        }
    }
    match best {
        Some((tag, version, release)) => Highest::Found(tag, version, release),
        None if tagged => Highest::NoVersions,
        None => Highest::NoTags,
    }
}

/// `major.minor.patch` con un eventuale `-pre` e un `+build` che non conta:
/// basta a confrontare i tag di questo repository. Una pre-release viene prima
/// della release che anticipa; due pre-release si confrontano come dice
/// semver, parte per parte.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Version {
    core: (u64, u64, u64),
    /// `true` ordina dopo `false`: la release vince sulle sue anteprime.
    release: bool,
    /// Le parti della pre-release, separate dai punti; vuota per una release.
    /// L'ordine di `Vec` è quello di semver: parte per parte, e a parità la
    /// lista più corta prima.
    pre: Vec<PreIdent>,
}

/// Una parte della pre-release. L'ordine delle varianti è quello di semver:
/// un numero viene prima di un testo; i numeri si confrontano come numeri, i
/// testi come testo (ASCII).
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum PreIdent {
    Number(u64),
    Text(String),
}

impl PreIdent {
    fn parse(part: &str) -> Option<Self> {
        if part.is_empty()
            || !part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return None;
        }
        if part.bytes().all(|byte| byte.is_ascii_digit()) {
            // Un numero che non sta in `u64` resta un testo: si ordina dopo i
            // numeri invece di far cadere tutta la versione.
            if let Ok(number) = part.parse::<u64>() {
                return Some(PreIdent::Number(number));
            }
        }
        Some(PreIdent::Text(part.to_string()))
    }
}

impl Version {
    fn parse(text: &str) -> Option<Self> {
        let text = text.split('+').next().unwrap_or(text);
        let (core, pre) = match text.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (text, None),
        };
        let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
        let version = (parts.next()??, parts.next()??, parts.next()??);
        if parts.next().is_some() {
            return None;
        }
        let pre = match pre {
            Some(pre) => pre
                .split('.')
                .map(PreIdent::parse)
                .collect::<Option<Vec<_>>>()?,
            None => Vec::new(),
        };
        Some(Version {
            core: version,
            release: pre.is_empty(),
            pre,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::net::HttpResponse;
    use fub_abi::InvokeMode;
    use fub_sdk::testing::MemoryHost;

    fn answer(status: u16, body: &str) -> HttpResponse {
        HttpResponse {
            status,
            headers: Vec::new(),
            body: body.as_bytes().to_vec(),
        }
    }

    #[test]
    fn the_command_queues_without_touching_the_network() {
        let mut host = MemoryHost::new();
        UpdatesCommands
            .invoke(
                UPDATES_CHECK,
                serde_json::json!({}),
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap();
        assert!(host.network_requests().is_empty());
    }

    #[test]
    fn a_newer_release_is_reported_with_its_page() {
        let mut host = MemoryHost::new().with_response(answer(
            200,
            r#"{"tag_name":"v0.2.0","html_url":"https://github.com/Fubeo/Fub/releases/tag/v0.2.0"}"#,
        ));
        let out = check("0.1.0", &mut host).unwrap();
        assert_eq!(out["latest"], "0.2.0");
        assert_eq!(out["newer"], true);
        assert_eq!(
            out["url"],
            "https://github.com/Fubeo/Fub/releases/tag/v0.2.0"
        );
        let asked = host.network_requests();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].url, LATEST_RELEASE);
        assert!(asked[0]
            .headers
            .iter()
            .any(|h| h.name == "User-Agent" && h.value == "Fub/0.1.0"));
    }

    #[test]
    fn the_same_version_or_a_foreign_link_is_not_an_update() {
        let mut host = MemoryHost::new().with_response(answer(
            200,
            r#"{"tag_name":"v0.1.0","html_url":"https://altrove.example/x"}"#,
        ));
        let out = check("0.1.0", &mut host).unwrap();
        assert_eq!(out["newer"], false);
        assert!(
            out["url"].is_null(),
            "un link fuori dalle release non passa"
        );
    }

    #[test]
    fn no_release_or_an_unusable_answer_is_an_outcome_and_no_network_an_error() {
        let mut host = MemoryHost::new().with_response(answer(404, "{}"));
        let out = check("0.1.0", &mut host).unwrap();
        assert!(out["latest"].is_null());
        assert_eq!(out["newer"], false);

        let mut host = MemoryHost::new().with_response(answer(403, "rate limited"));
        let out = check("0.1.0", &mut host).unwrap();
        assert_eq!(out["failed"], "status");
        assert_eq!(out["status"], 403);

        let mut host = MemoryHost::new().with_response(answer(200, "<html>"));
        assert_eq!(check("0.1.0", &mut host).unwrap()["failed"], "unreadable");

        let mut host = MemoryHost::new().with_response(answer(200, r#"{"tag_name":"nightly"}"#));
        assert_eq!(check("0.1.0", &mut host).unwrap()["failed"], "version");

        let mut host = MemoryHost::new().with_network_fault("offline");
        assert!(check("0.1.0", &mut host).is_err());
    }

    #[test]
    fn versions_order_like_releases() {
        let v = |text| Version::parse(text).unwrap();
        assert!(v("0.2.0") > v("0.1.9"));
        assert!(v("1.0.0") > v("1.0.0-rc.1"));
        assert!(v("1.0.0-rc.2") > v("1.0.0-rc.1"));
        assert!(v("0.10.0") > v("0.9.0"));
        assert!(Version::parse("1.0").is_none());
        assert!(Version::parse("latest").is_none());
        // Le parti della pre-release come dice semver.
        assert!(v("0.2.0-prealpha.10") > v("0.2.0-prealpha.2"));
        assert!(v("0.2.0") > v("0.2.0-prealpha.9"));
        assert!(v("0.2.0-rc.1") > v("0.2.0-prealpha.3"));
        assert!(
            v("1.0.0-alpha.beta") > v("1.0.0-alpha.1"),
            "il numero prima del testo"
        );
        assert!(
            v("1.0.0-alpha.1") > v("1.0.0-alpha"),
            "la lista più corta prima"
        );
        assert!(v("1.0.0-beta.11") > v("1.0.0-beta.2"));
        assert!(v("0.2.0-prealpha.1") > v("0.1.9"));
        assert_eq!(v("0.2.0-prealpha.2+build.7"), v("0.2.0-prealpha.2"));
        assert!(Version::parse("1.0.0-").is_none());
        assert!(Version::parse("1.0.0-rc..1").is_none());
        assert!(Version::parse("1.0.0-rc_1").is_none());
    }

    fn list_check(current: &str, body: &str) -> serde_json::Value {
        let mut host = MemoryHost::new().with_response(answer(200, body));
        let out = check(current, &mut host).unwrap();
        let asked = host.network_requests();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].url, RELEASES_LIST);
        out
    }

    #[test]
    fn a_prerelease_asks_the_list_and_takes_the_highest_version() {
        let out = list_check(
            "0.2.0-prealpha.1",
            r#"[
                {"tag_name":"v0.2.0-prealpha.2","prerelease":true,
                 "html_url":"https://github.com/Fubeo/Fub/releases/tag/v0.2.0-prealpha.2"},
                {"tag_name":"v0.2.0-prealpha.10","prerelease":true,
                 "html_url":"https://github.com/Fubeo/Fub/releases/tag/v0.2.0-prealpha.10"},
                {"tag_name":"v0.1.4","prerelease":false,
                 "html_url":"https://github.com/Fubeo/Fub/releases/tag/v0.1.4"}
            ]"#,
        );
        assert_eq!(out["latest"], "0.2.0-prealpha.10");
        assert_eq!(out["newer"], true);
        assert_eq!(
            out["url"],
            "https://github.com/Fubeo/Fub/releases/tag/v0.2.0-prealpha.10"
        );

        // Una pre-release più vecchia della release vera che c'è: vince la più
        // alta, e decide il tag, non il flag `prerelease`.
        let out = list_check(
            "0.2.0-prealpha.3",
            r#"[
                {"tag_name":"v0.2.0-prealpha.4","prerelease":true},
                {"tag_name":"v0.2.0","prerelease":true,
                 "html_url":"https://github.com/Fubeo/Fub/releases/tag/v0.2.0"}
            ]"#,
        );
        assert_eq!(out["latest"], "0.2.0");
        assert_eq!(out["newer"], true);

        // La stessa pre-release che gira non è un aggiornamento.
        let out = list_check(
            "0.2.0-prealpha.2",
            r#"[{"tag_name":"v0.2.0-prealpha.2"},{"tag_name":"v0.1.0"}]"#,
        );
        assert_eq!(out["latest"], "0.2.0-prealpha.2");
        assert_eq!(out["newer"], false);
        assert!(out["url"].is_null());
    }

    #[test]
    fn the_list_skips_drafts_and_tags_that_are_not_versions() {
        // Una lista vuota: niente di pubblicato.
        let out = list_check("0.2.0-prealpha.1", "[]");
        assert!(out["latest"].is_null());
        assert_eq!(out["newer"], false);
        assert!(out.get("failed").is_none());

        // Una bozza senza `tag_name` non conta, né da sola né in mezzo.
        let out = list_check("0.2.0-prealpha.1", r#"[{"draft":true,"name":"bozza"}]"#);
        assert!(out["latest"].is_null());
        let out = list_check(
            "0.2.0-prealpha.1",
            r#"[{"draft":true},{"draft":true,"tag_name":"v9.0.0"},{"tag_name":"v0.2.0-prealpha.2"}]"#,
        );
        assert_eq!(out["latest"], "0.2.0-prealpha.2");
        assert_eq!(out["newer"], true);

        // Un tag che non è una versione si salta; se non ne resta nessuna è
        // l'esito `version`.
        let out = list_check(
            "0.2.0-prealpha.1",
            r#"[{"tag_name":"nightly"},{"tag_name":"v0.2.0-prealpha.3"}]"#,
        );
        assert_eq!(out["latest"], "0.2.0-prealpha.3");
        let out = list_check("0.2.0-prealpha.1", r#"[{"tag_name":"nightly"}]"#);
        assert_eq!(out["failed"], "version");
        assert_eq!(out["status"], 200);

        // Una lista che non è un array.
        let out = list_check("0.2.0-prealpha.1", r#"{"tag_name":"v0.2.0-prealpha.2"}"#);
        assert_eq!(out["failed"], "unreadable");
    }

    #[test]
    fn a_real_release_does_not_see_prereleases() {
        let mut host = MemoryHost::new().with_response(answer(
            200,
            r#"{"tag_name":"v0.1.4","html_url":"https://github.com/Fubeo/Fub/releases/tag/v0.1.4"}"#,
        ));
        let out = check("0.1.4", &mut host).unwrap();
        assert_eq!(out["newer"], false);
        assert_eq!(host.network_requests()[0].url, LATEST_RELEASE);
    }

    #[test]
    fn the_manifest_reaches_only_github() {
        let manifest = manifest();
        assert_eq!(
            manifest
                .permissions
                .granted
                .get(fub_abi::options::permission::NETWORK),
            Some(&serde_json::json!([API_HOST]))
        );
    }
}
