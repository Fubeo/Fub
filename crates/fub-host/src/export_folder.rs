//! L'export **in una cartella**: il vault intero, o una sua cartella, verso
//! una cartella nuova del disco fuori dal vault.
//!
//! `export.run` resta la via di un plugin e di un documento solo: i byte
//! tornano nel rapporto, col tetto di
//! [`PLUGIN_EXPORT_LIMIT`](fub_kernel::transfer::PLUGIN_EXPORT_LIMIT), e la
//! shell li salva uno per uno. Per un vault non basta né l'uno né l'altro:
//! qui gli artefatti vanno direttamente dove l'utente ha scelto, attraverso il
//! [`DirectorySink`], che non esce dalla cartella e non sovrascrive un
//! artefatto già consegnato.
//!
//! La cartella è **nuova**, con le regole della destinazione di uno snapshot:
//! un export non sovrascrive mai niente. Se l'export fallisce a metà la
//! cartella, che è di questo comando, si toglie: un albero per metà
//! sembrerebbe un export riuscito. Gli avvisi dell'exporter (un allegato che
//! non c'è, un documento che la destinazione non sa scrivere) tornano nel
//! rapporto e nella notifica: niente si perde in silenzio.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::text::{Arg, Text};
use fub_abi::transfer::{
    ArtifactContent, ArtifactSink, ExportReport, ExportRequest, ExportSelection, ExportTarget,
    NoteLevel,
};
use fub_abi::PluginError;
use fub_kernel::host::authorize_export;
use fub_kernel::transfer::DirectorySink;
use fub_kernel::{Guard, ReadOnly, Workspace};

use crate::custody::Custody;
use crate::jobs::JobHost;

/// L'id del comando.
pub const EXPORT_FOLDER: &str = "vault.export";

const FORMAT: &str = "format";
const FOLDER: &str = "folder";
const TARGET: &str = "target";
const OPTIONS: &str = "options_json";

/// La spec, con le destinazioni registrate adesso come scelte: chi compila il
/// form vede i formati invece di indovinarne l'id.
pub(crate) fn spec(targets: &[ExportTarget]) -> CommandSpec {
    let choices = targets
        .iter()
        .map(|target| Choice::new(target.id.clone(), target.name.clone()))
        .collect();
    CommandSpec::new(EXPORT_FOLDER, Text::key("host.export.title"))
        .describing(Text::key("host.export.desc"))
        .with_param(
            ParamSpec::new(
                FORMAT,
                Text::key("host.param.export_format"),
                ParamKind::Choice(choices),
            )
            .required(),
        )
        .with_param(ParamSpec::new(
            FOLDER,
            Text::key("host.param.export_folder"),
            ParamKind::Text,
        ))
        .with_param(
            ParamSpec::new(
                TARGET,
                Text::key("host.param.export_target"),
                ParamKind::Text,
            )
            .required(),
        )
        .with_param(ParamSpec::new(
            OPTIONS,
            Text::key("host.param.export_options"),
            ParamKind::Text,
        ))
        .with_scope(CommandScope::read_only())
}

/// Esegue l'export. L'exporter gira **fuori** dal prestito del workspace, con
/// un host di sola lettura intestato a chi lo ha registrato, come il job di
/// `export.run`: un export lungo non tiene in fila chi scrive.
pub(crate) fn invoke(
    root: &Utf8Path,
    workspace: &Custody<Workspace>,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    let prepared = workspace.read()?.prepare_export();
    spec(&prepared.targets()).validate_args(&args)?;
    let args = Args::new(&args);
    let format = args.text(FORMAT).expect("spec validata");
    let folder =
        fub_abi::rules::folders::normalized(args.text(FOLDER).unwrap_or("").trim()).to_owned();
    let target =
        crate::session::new_outside_folder(root, args.text(TARGET).expect("spec validata"))?;
    let options = match args
        .text(OPTIONS)
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
    {
        None => serde_json::Value::Null,
        Some(raw) => serde_json::from_str(raw).map_err(|why| {
            PluginError::BadArgs(Text::message(
                "host.export.options",
                vec![Arg::text("why", why.to_string())],
            ))
        })?,
    };
    let request =
        ExportRequest::new(format, ExportSelection::Folder(folder.clone())).with_options(options);
    let owner = {
        let ws = workspace.read()?;
        authorize_export(&ws.granted_policy(crate::settings::CORE_ID), &request)?;
        let at = prepared.choose(format)?;
        (at, prepared.owner(at).to_owned())
    };
    if mode.is_dry_run() {
        let summary = if folder.is_empty() {
            Text::message(
                "host.export.plan.vault",
                vec![Arg::text("target", target.as_str())],
            )
        } else {
            Text::message(
                "host.export.plan.folder",
                vec![
                    Arg::text("folder", folder.as_str()),
                    Arg::text("target", target.as_str()),
                ],
            )
        };
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                Vec::new(),
            ))),
        );
    }
    std::fs::create_dir(target.as_std_path()).map_err(|why| {
        PluginError::Internal(Text::message(
            "host.export.create",
            vec![
                Arg::text("target", target.as_str()),
                Arg::text("why", why.to_string()),
            ],
        ))
    })?;
    let exported = (|| {
        let (at, owner) = &owner;
        let host = Guard::new(
            JobHost::new(workspace.clone(), owner.clone()),
            ReadOnly {
                why: "un export legge soltanto",
            },
        );
        let mut sink = DirectorySink::new(target.as_std_path());
        let report = deliver_in_hand(prepared.invoke(*at, &request, &host, &mut sink)?, &mut sink)?;
        if report.artifacts.is_empty() {
            // Una cartella che non c'è, o che non ha niente che questo formato
            // sappia scrivere: un export vuoto riuscito direbbe il falso.
            return Err(PluginError::NotFound(if folder.is_empty() {
                Text::key("host.export.empty.vault")
            } else {
                Text::message(
                    "host.export.empty.folder",
                    vec![Arg::text("folder", folder.as_str())],
                )
            }));
        }
        Ok(report)
    })();
    let report = match exported {
        Ok(report) => report,
        Err(error) => {
            // La cartella l'ha creata questo comando un momento fa: ciò che
            // contiene è un export a metà, non un dato dell'utente.
            if let Err(why) = std::fs::remove_dir_all(target.as_std_path()) {
                tracing::warn!(target: "fub.export", "pulizia di {target}: {why}");
            }
            return Err(error);
        }
    };
    Ok(outcome(&target, report))
}

/// Gli artefatti che l'exporter ha restituito in mano invece di versarli: il
/// contratto ammette le due strade, e chi ha scelto una cartella li vuole lì
/// tutti.
fn deliver_in_hand(
    mut report: ExportReport,
    sink: &mut DirectorySink,
) -> Result<ExportReport, PluginError> {
    for artifact in &mut report.artifacts {
        let ArtifactContent::Bytes(bytes) = &artifact.content else {
            continue;
        };
        let handle = sink.open_artifact(&artifact.path, &artifact.media_type)?;
        sink.write_artifact(handle, bytes)?;
        *artifact = sink.close_artifact(handle)?;
    }
    Ok(report)
}

fn outcome(target: &Utf8PathBuf, report: ExportReport) -> CommandOutcome {
    let warnings = report
        .log
        .iter()
        .filter(|note| note.level != NoteLevel::Info)
        .count();
    let bytes: u64 = report.artifacts.iter().map(|artifact| artifact.len()).sum();
    let key = if warnings == 0 {
        "host.export.done"
    } else {
        "host.export.done_with_notes"
    };
    CommandOutcome::notify(Text::message(
        key,
        vec![
            Arg::text("target", target.as_str()),
            Arg::int("count", report.artifacts.len() as i64),
            Arg::int("notes", warnings as i64),
        ],
    ))
    .with_effect(CommandEffect::Custom {
        ns: "fub.vault.exported".into(),
        payload: serde_json::json!({
            "target": target,
            "artifacts": report.artifacts.len(),
            "bytes": bytes.to_string(),
            "log": report.log,
        }),
    })
}
