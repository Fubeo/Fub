//! I token dei connettori (Notion, Airtable) salvati su questa macchina.
//!
//! Il connettore non riceve il token negli argomenti: `import.prepare` rifiuta
//! un token grezzo perché finirebbe nel payload del job. Qui l'utente lo salva
//! una volta, in `<config>/connectors/<connettore>.token`, leggibile dal solo
//! proprietario come il token dei servizi; il connettore lo chiede a
//! [`MachineTokens`] quando il job parte. Il token non torna mai indietro:
//! `connector.tokens` dice soltanto **quali** connettori ne hanno uno.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;
use fub_importers::connectors::CONNECTORS;
use fub_importers::ConnectorSecrets;

/// Salva, o toglie con un token vuoto, il token di un connettore.
pub const CONNECTOR_TOKEN: &str = "connector.token";
/// Quali connettori hanno un token salvato.
pub const CONNECTOR_TOKENS: &str = "connector.tokens";

/// La cartella dei token nella configurazione della macchina.
const DIR: &str = "connectors";

const CONNECTOR: &str = "connector";
const TOKEN: &str = "token";

/// Il file del token di `connector`, se la macchina ha una configurazione e il
/// connettore è uno di quelli noti: un nome qualunque non diventa un path.
fn token_path(config: Option<&Utf8Path>, connector: &str) -> Option<Utf8PathBuf> {
    let known = CONNECTORS.iter().find(|known| **known == connector)?;
    config.map(|config| config.join(DIR).join(format!("{known}.token")))
}

/// I token salvati nella configurazione di questa macchina, letti al momento.
pub(crate) struct MachineTokens {
    config: Option<Utf8PathBuf>,
}

impl MachineTokens {
    pub(crate) fn new(config: Option<&Utf8Path>) -> Self {
        MachineTokens {
            config: config.map(Utf8Path::to_owned),
        }
    }
}

impl ConnectorSecrets for MachineTokens {
    fn token(&self, connector: &str) -> Option<String> {
        let path = token_path(self.config.as_deref(), connector)?;
        crate::secret_file::owner_only(path.as_std_path())
    }
}

/// Il nome del prodotto, che non si traduce.
fn display(connector: &str) -> &str {
    match connector {
        "notion" => "Notion",
        "airtable" => "Airtable",
        other => other,
    }
}

fn connector_param() -> ParamSpec {
    let choices = CONNECTORS
        .iter()
        .map(|id| Choice::new(*id, Text::key(format!("host.connector.{id}"))))
        .collect();
    ParamSpec::new(
        CONNECTOR,
        Text::key("host.param.connector"),
        ParamKind::Choice(choices),
    )
    .required()
}

pub(crate) fn specs() -> [CommandSpec; 2] {
    [
        CommandSpec::new(CONNECTOR_TOKEN, Text::key("host.connector.token.title"))
            .describing(Text::key("host.connector.token.desc"))
            .with_param(connector_param())
            .with_param(ParamSpec::new(
                TOKEN,
                Text::key("host.param.connector_token"),
                ParamKind::Text,
            ))
            .with_scope(CommandScope::writing(CommandReach::Settings)),
        CommandSpec::new(CONNECTOR_TOKENS, Text::key("host.connector.tokens.title"))
            .describing(Text::key("host.connector.tokens.desc"))
            .with_scope(CommandScope::read_only()),
    ]
}

/// L'esito che porta quali connettori hanno un token: mai il token.
fn saved_effect(tokens: &MachineTokens) -> CommandEffect {
    let saved: Vec<&str> = CONNECTORS
        .iter()
        .copied()
        .filter(|id| tokens.token(id).is_some())
        .collect();
    CommandEffect::Custom {
        ns: "fub.connector.tokens".into(),
        payload: serde_json::json!({ "saved": saved }),
    }
}

pub(crate) fn invoke(
    config: Option<&Utf8Path>,
    spec: &CommandSpec,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    spec.validate_args(&args)?;
    let tokens = MachineTokens::new(config);
    if spec.id == CONNECTOR_TOKENS {
        return Ok(CommandOutcome::done().with_effect(saved_effect(&tokens)));
    }
    let args = Args::new(&args);
    let connector = args.text(CONNECTOR).expect("spec validata");
    let token = args.text(TOKEN).unwrap_or("").trim();
    let path = token_path(config, connector)
        .ok_or_else(|| PluginError::Unserved(Text::key("host.connector.no_config")))?;
    let name = Arg::text("connector", display(connector));
    if mode.is_dry_run() {
        let key = if token.is_empty() {
            "host.connector.plan.forget"
        } else {
            "host.connector.plan.save"
        };
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                Text::message(key, vec![name]),
                Vec::new(),
            ))),
        );
    }
    let (written, key) = if token.is_empty() {
        (
            crate::secret_file::forget(path.as_std_path()),
            "host.connector.forgotten",
        )
    } else if token.contains(['\n', '\r']) || token.len() > 4_000 {
        return Err(PluginError::BadArgs(Text::key("host.connector.bad_token")));
    } else {
        (
            crate::secret_file::write_owner_only(path.as_std_path(), token),
            "host.connector.saved",
        )
    };
    written.map_err(|why| {
        PluginError::Internal(Text::message(
            "host.connector.write",
            vec![name.clone(), Arg::text("why", why.to_string())],
        ))
    })?;
    Ok(CommandOutcome::notify(Text::message(key, vec![name])).with_effect(saved_effect(&tokens)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(config: &Utf8Path, id: &str, args: serde_json::Value) -> CommandOutcome {
        let spec = specs().into_iter().find(|spec| spec.id == id).unwrap();
        invoke(Some(config), &spec, args, InvokeMode::Apply).unwrap()
    }

    fn saved(outcome: &CommandOutcome) -> serde_json::Value {
        match &outcome.effect {
            CommandEffect::Custom { payload, .. } => payload["saved"].clone(),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_saved_token_reaches_the_connector_and_never_the_outcome() {
        let dir = tempfile::tempdir().unwrap();
        let config = Utf8Path::from_path(dir.path()).unwrap();
        let outcome = run(
            config,
            CONNECTOR_TOKEN,
            serde_json::json!({ "connector": "notion", "token": " secret_abc \n" }),
        );
        assert_eq!(saved(&outcome), serde_json::json!(["notion"]));
        assert!(!format!("{outcome:?}").contains("secret_abc"));
        assert_eq!(
            MachineTokens::new(Some(config)).token("notion").as_deref(),
            Some("secret_abc")
        );
        assert_eq!(MachineTokens::new(Some(config)).token("airtable"), None);
        assert_eq!(MachineTokens::new(Some(config)).token("../notion"), None);

        let listed = run(config, CONNECTOR_TOKENS, serde_json::json!({}));
        assert_eq!(saved(&listed), serde_json::json!(["notion"]));

        let forgotten = run(
            config,
            CONNECTOR_TOKEN,
            serde_json::json!({ "connector": "notion", "token": "" }),
        );
        assert_eq!(saved(&forgotten), serde_json::json!([]));
        assert_eq!(MachineTokens::new(Some(config)).token("notion"), None);
    }

    #[test]
    fn an_unknown_connector_or_no_configuration_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let config = Utf8Path::from_path(dir.path()).unwrap();
        let spec = &specs()[0];
        assert!(matches!(
            invoke(
                Some(config),
                spec,
                serde_json::json!({ "connector": "dropbox", "token": "x" }),
                InvokeMode::Apply
            ),
            Err(PluginError::BadArgs(_))
        ));
        assert!(matches!(
            invoke(
                None,
                spec,
                serde_json::json!({ "connector": "notion", "token": "x" }),
                InvokeMode::Apply
            ),
            Err(PluginError::Unserved(_))
        ));
        invoke(
            Some(config),
            spec,
            serde_json::json!({ "connector": "notion", "token": "x" }),
            InvokeMode::DryRun,
        )
        .unwrap();
        assert!(!config.join(DIR).exists(), "il dry run non scrive");
    }
}
