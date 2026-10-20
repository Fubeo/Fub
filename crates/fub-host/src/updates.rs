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
/// pubblicata (404) è un esito, `latest: null`. Una risposta che non si usa —
/// un altro stato, un corpo che non si capisce, un tag che non è una versione
/// — è un esito anch'esso, `{current, failed, status}`: chi chiede ha avuto una
/// risposta, e la shell la dice nella lingua di chi guarda. Errore resta
/// soltanto la rete che non risponde.
fn check(current: &str, host: &mut dyn HostApi) -> Result<serde_json::Value, PluginError> {
    let response = host.fetch(
        HttpRequest::get(LATEST_RELEASE)
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
    if response.status == 404 {
        return Ok(serde_json::json!({
            "current": current,
            "latest": null,
            "newer": false,
            "url": null,
        }));
    }
    if response.status != 200 {
        return failed("status");
    }
    let Ok(release) = serde_json::from_slice::<serde_json::Value>(&response.body) else {
        return failed("unreadable");
    };
    let Some(tag) = release.get("tag_name").and_then(serde_json::Value::as_str) else {
        return failed("unreadable");
    };
    let latest = tag.strip_prefix('v').unwrap_or(tag);
    let (Some(newest), Some(running)) = (Version::parse(latest), Version::parse(current)) else {
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

/// `major.minor.patch` con un eventuale `-pre`: basta a confrontare i tag di
/// questo repository. Una pre-release viene prima della release che anticipa;
/// due pre-release si confrontano come testo.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct Version {
    core: (u64, u64, u64),
    /// `true` ordina dopo `false`: la release vince sulle sue anteprime.
    release: bool,
    pre: String,
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
        Some(Version {
            core: version,
            release: pre.is_none(),
            pre: pre.unwrap_or("").to_string(),
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
