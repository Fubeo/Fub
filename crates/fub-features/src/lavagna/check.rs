//! `canvas.check`: che cosa cambierebbe una lista di operazioni, prima di
//! scriverla, con i suoi problemi e i suoi avvisi. Il controllo è del nucleo
//! (`check`, T7). Qui si aggiunge quello che il nucleo non conosce, cioè la
//! revisione di partenza (`stale_base`), e si porta il rapporto nel payload con
//! la frase di ogni codice: la frase la rende il catalogo, il payload resta
//! strutturato. Non scrive niente.
//!
//! Con un problema, il rapporto non ha né riassunto né lettura di dopo: come in
//! `canvas.apply`, le operazioni valgono tutte o nessuna.

use fub_abi::command::{Args, CommandEffect, CommandOutcome};
use fub_abi::edit::{Fnv1a, Revision};
use fub_abi::error::PluginError;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::HostApi;
use fub_canvas_core::check::{check, Code, Problem};
use fub_canvas_core::commit::Core;
use serde_json::{json, Value};

use super::*;

/// I codici dei problemi nel payload: quelli del nucleo, più `stale_base`. La
/// frase di ciascuno sta nel catalogo come `canvas.check.p_<codice>`. Il
/// catalogo li controlla; in produzione la lista non serve.
#[cfg(test)]
pub(super) const CODES: &[&str] = &[
    "invalid",
    "unknown_op",
    "unknown_field",
    "missing_field",
    "wrong_type",
    "bad_value",
    "unknown_node",
    "unknown_edge",
    "duplicate_id",
    "too_many",
    "stale_base",
];

/// Il messaggio fisso di `stale_base`, in inglese come quelli del nucleo.
const STALE_MESSAGE: &str = "the whiteboard changed since the given revision";

pub(super) fn canvas_check(
    args: Args<'_>,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = canvas_doc(&args, host)?;
    // Il testo che non è JSON non ha una lista da controllare: è un errore degli
    // argomenti, come in `canvas.apply`. Il JSON che non è una lista dà i suoi
    // problemi nel rapporto.
    let list: Value = serde_json::from_str(args.text(OPS).unwrap_or(""))
        .map_err(|error| ops_json(error.to_string(), "-".to_owned()))?;
    let seed = args.text(SEED).map(seed).transpose()?;
    let base = args.text(BASE);

    let revision = host.document_revision(&doc)?;
    // Lo stesso seme di `canvas.apply`: senza seme, la revisione. Così gli id
    // del controllo sono quelli della scrittura.
    let seed = seed.unwrap_or_else(|| Fnv1a::hash(revision.0.as_bytes()));
    let source = host.read_document(&doc)?;
    let core = Core::open(source).map_err(|error| opening(&doc, &error))?;
    let report = check(core.canvas(), &list, seed);

    let stale = base.is_some_and(|base| Revision::new(base) != revision);
    let refused = stale || !report.ok;
    let mut problems: Vec<Value> = Vec::new();
    if stale {
        problems.push(stale_problem());
    }
    problems.extend(report.problems.iter().map(problem));
    let (warnings, omitted, summary, outline) = if refused {
        (Vec::new(), 0, None, None)
    } else {
        (
            report.warnings,
            report.warnings_omitted,
            report.summary,
            report.outline_after,
        )
    };

    let notice = match &summary {
        Some(summary) => Text::message(
            N_CHECK_SUMMARY,
            vec![
                count_arg("added", summary.cards_added.len()),
                count_arg("changed", summary.cards_changed.len()),
                count_arg("removed", summary.cards_removed.len()),
                count_arg(
                    "edges",
                    summary.edges_added.len()
                        + summary.edges_removed.len()
                        + summary.edges_changed.len(),
                ),
                count_arg("warnings", warnings.len() + omitted),
            ],
        ),
        None => Text::message(N_CHECK_REFUSED, vec![count_arg("problems", problems.len())]),
    };
    let payload = json!({
        "version": 1,
        "kind": "check",
        "ok": !refused,
        "problems": problems,
        "warnings": warnings,
        "warnings_omitted": omitted,
        "summary": summary,
        "outline_after": outline,
    });
    Ok(
        CommandOutcome::notify(notice).with_effect(CommandEffect::Custom {
            ns: LAVAGNA_NS.into(),
            payload,
        }),
    )
}

fn count_arg(name: &str, count: usize) -> Arg {
    Arg::int(name, i64::try_from(count).unwrap_or(i64::MAX))
}

/// Un problema del nucleo nel payload: la forma di `Problem`, con il codice come
/// nome e la frase del catalogo per quel codice.
fn problem(problem: &Problem) -> Value {
    let code = code_name(problem.code);
    let mut value = json!({
        "code": code,
        "index": problem.index,
        "path": problem.path,
        "message": problem.message,
        "text": Text::key(format!("canvas.check.p_{code}")),
    });
    if let Some(suggestion) = &problem.suggestion {
        value["suggestion"] = json!(suggestion);
    }
    if let Some(fix) = &problem.fix {
        value["fix"] = fix.clone();
    }
    value
}

/// La revisione data non è quella del file: il problema è della lista, non del
/// nucleo, e riguarda tutta la lavagna (senza posizione).
fn stale_problem() -> Value {
    json!({
        "code": "stale_base",
        "index": null,
        "path": "",
        "message": STALE_MESSAGE,
        "text": Text::key("canvas.check.p_stale_base"),
    })
}

fn code_name(code: Code) -> &'static str {
    match code {
        Code::Invalid => "invalid",
        Code::UnknownOp => "unknown_op",
        Code::UnknownField => "unknown_field",
        Code::MissingField => "missing_field",
        Code::WrongType => "wrong_type",
        Code::BadValue => "bad_value",
        Code::UnknownNode => "unknown_node",
        Code::UnknownEdge => "unknown_edge",
        Code::DuplicateId => "duplicate_id",
        Code::TooMany => "too_many",
    }
}
