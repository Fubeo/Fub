//! I `fub://` che il sistema consegna all'app, **in coda** finché la shell
//! non li prende.
//!
//! Il sistema apre un URI quando vuole: a freddo, prima che la webview esista,
//! o con l'app già aperta, dalla seconda istanza. Un evento spinto alla
//! finestra in quel momento si perde se nessuno ascolta ancora, e un URI perso
//! è una cattura del clipper che non arriva. Qui l'URI resta finché la shell
//! non chiede [`URI_PENDING`], all'avvio e a ogni avviso; l'evento è soltanto
//! il campanello.
//!
//! La coda ha un tetto ([`CAPACITY`]): oltre, l'URI si rifiuta e la shell
//! saprà quanti ne sono rimasti fuori, invece di una coda che cresce senza
//! fine per una pagina che apre `fub://` in un ciclo.
//!
//! Nessun URI scrive da solo. [`URI_PENDING`] li classifica con il parser di
//! [`automation`](crate::automation), lo stesso della CLI e del mobile, e con
//! le callback negate; [`URI_APPLY`] esegue un'azione che scrive (`new`,
//! `daily`, `unique`, `capture`) soltanto quando la shell lo chiede dopo la
//! conferma dell'utente, e in prova dice soltanto che cosa farebbe. Aprire e
//! cercare non scrivono, e li esegue la shell.

use std::collections::VecDeque;
use std::sync::Mutex;

use camino::Utf8Path;
use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode,
    ParamKind, ParamSpec,
};
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;
use serde_json::{json, Value};

use crate::automation::{
    parse_fub_uri, validate_callback, validate_capture_v1, CallbackPolicy, CaptureMode,
    CapturePayloadV1, CaptureTarget, FubUri,
};
use crate::Host;

/// Prende gli URI in coda, classificati.
pub const URI_PENDING: &str = "uri.pending";
/// Esegue, o in prova pianifica, l'azione di un URI che scrive.
pub const URI_APPLY: &str = "uri.apply";

/// Quanti URI aspettano la shell, al più.
pub const CAPACITY: usize = 32;

const URI: &str = "uri";

/// La coda della macchina: gli URI arrivano a un'app, non a un vault.
#[derive(Default)]
pub(crate) struct UriInbox {
    state: Mutex<Inbox>,
}

#[derive(Default)]
struct Inbox {
    queue: VecDeque<String>,
    /// Quanti URI il tetto ha rifiutato dall'ultima volta che la shell ha
    /// preso la coda.
    refused: usize,
}

impl UriInbox {
    /// Mette `raw` in coda; `false` se la coda è piena e l'URI resta fuori.
    pub(crate) fn push(&self, raw: &str) -> bool {
        let mut inbox = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if inbox.queue.len() >= CAPACITY {
            inbox.refused += 1;
            return false;
        }
        inbox.queue.push_back(raw.to_string());
        true
    }

    /// Gli URI in coda e quanti ne sono rimasti fuori. `take` li toglie;
    /// senza, li guarda soltanto.
    fn pending(&self, take: bool) -> (Vec<String>, usize) {
        let mut inbox = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if take {
            let refused = std::mem::take(&mut inbox.refused);
            (inbox.queue.drain(..).collect(), refused)
        } else {
            (inbox.queue.iter().cloned().collect(), inbox.refused)
        }
    }
}

pub(crate) fn specs() -> [CommandSpec; 2] {
    [
        CommandSpec::new(URI_PENDING, Text::key("host.uri.pending.title"))
            .describing(Text::key("host.uri.pending.desc"))
            .with_scope(CommandScope::writing(CommandReach::Session)),
        CommandSpec::new(URI_APPLY, Text::key("host.uri.apply.title"))
            .describing(Text::key("host.uri.apply.desc"))
            .with_param(
                ParamSpec::new(URI, Text::key("host.param.uri"), ParamKind::Text).required(),
            )
            .with_scope(CommandScope::writing(CommandReach::Vault)),
    ]
}

pub(crate) fn invoke(
    host: &Host,
    inbox: &UriInbox,
    spec: &CommandSpec,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    spec.validate_args(&args)?;
    if spec.id == URI_PENDING {
        let (raws, refused) = inbox.pending(!mode.is_dry_run());
        let actions: Vec<Value> = raws.iter().map(|raw| describe(host, raw)).collect();
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
            ns: "fub.uri.pending".into(),
            payload: json!({ "actions": actions, "refused": refused }),
        }));
    }
    let raw = Args::new(&args)
        .text(URI)
        .expect("spec validata")
        .to_string();
    apply(host, &raw, mode)
}

/// L'URI letto con le regole di tutti, callback comprese: l'app non ne apre
/// nessuna, quindi una callback è un rifiuto e non una promessa.
fn parse(raw: &str) -> Result<FubUri, String> {
    let parsed = parse_fub_uri(raw).map_err(|why| why.to_string())?;
    if let FubUri::Capture {
        success_callback,
        error_callback,
        ..
    } = &parsed
    {
        for callback in [success_callback, error_callback].into_iter().flatten() {
            validate_callback(callback, &CallbackPolicy::deny_all())
                .map_err(|why| why.to_string())?;
        }
    }
    Ok(parsed)
}

fn bad_uri(why: &str) -> PluginError {
    PluginError::BadArgs(Text::message(
        "host.uri.invalid",
        vec![Arg::text("why", why)],
    ))
}

fn vault_of(uri: &FubUri) -> Option<&str> {
    match uri {
        FubUri::Open { vault, .. }
        | FubUri::New { vault, .. }
        | FubUri::Daily { vault, .. }
        | FubUri::Unique { vault, .. }
        | FubUri::Search { vault, .. }
        | FubUri::Capture { vault, .. } => vault.as_deref(),
    }
}

/// Il vault che l'URI nomina, fra quelli che questa macchina conosce: per la
/// radice o per il nome che l'utente vede, che è il nome scelto o quello della
/// cartella. Un nome che due vault condividono non sceglie nessuno dei due.
fn known_root(host: &Host, asked: &str) -> Option<String> {
    let entries = host.known_vaults();
    if let Some(entry) = entries
        .iter()
        .find(|entry| Utf8Path::new(&entry.root) == Utf8Path::new(asked))
    {
        return Some(entry.root.clone());
    }
    let mut named = entries.iter().filter(|entry| {
        let shown = match entry.name.as_str() {
            "" => Utf8Path::new(&entry.root).file_name().unwrap_or(""),
            name => name,
        };
        shown == asked
    });
    match (named.next(), named.next()) {
        (Some(entry), None) => Some(entry.root.clone()),
        _ => None,
    }
}

/// Un URI per la shell: che cosa chiede, se scrive, e in quale vault.
fn describe(host: &Host, raw: &str) -> Value {
    let uri = match parse(raw) {
        Ok(uri) => uri,
        Err(why) => return json!({ "raw": raw, "error": why }),
    };
    let current = host.current();
    let vault = vault_of(&uri).map(|asked| {
        let root = known_root(host, asked);
        let is_current = root
            .as_deref()
            .zip(current.as_deref())
            .is_some_and(|(root, current)| Utf8Path::new(root) == current);
        json!({ "asked": asked, "root": root, "current": is_current })
    });
    let mut out = json!({
        "raw": raw,
        "action": uri.action(),
        "writes": !matches!(uri, FubUri::Open { .. } | FubUri::Search { .. }),
        "vault": vault,
    });
    let fields = match &uri {
        FubUri::Open {
            note,
            heading,
            block,
            split,
            window,
            ..
        } => {
            json!({ "note": note, "heading": heading, "block": block, "split": split, "window": window })
        }
        FubUri::New {
            folder,
            name,
            title,
            template,
            ..
        } => json!({ "folder": folder, "name": name, "title": title, "template": template }),
        FubUri::Daily { date, .. } => json!({ "date": date }),
        FubUri::Unique { folder, prefix, .. } => json!({ "folder": folder, "name": prefix }),
        FubUri::Search { q, tag, folder, .. } => json!({ "q": q, "tag": tag, "folder": folder }),
        FubUri::Capture {
            folder,
            note,
            mode,
            title,
            markdown,
            source_url,
            ..
        } => json!({
            "folder": folder, "note": note, "mode": mode.map(|mode| mode.as_str()),
            "title": title, "markdown": markdown, "source_url": source_url,
        }),
    };
    if let (Value::Object(out), Value::Object(fields)) = (&mut out, fields) {
        out.extend(fields);
    }
    out
}

/// Esegue l'azione di un URI che scrive, nel vault che nomina se è aperto,
/// altrimenti in quello corrente. Aprire un altro vault è un gesto della
/// shell, con la sua conferma: qui un vault non aperto è un rifiuto.
fn apply(host: &Host, raw: &str, mode: InvokeMode) -> Result<CommandOutcome, PluginError> {
    let uri = parse(raw).map_err(|why| bad_uri(&why))?;
    let root = match vault_of(&uri) {
        None => None,
        Some(asked) => Some(known_root(host, asked).ok_or_else(|| {
            PluginError::NotFound(Text::message(
                "host.uri.unknown_vault",
                vec![Arg::text("vault", asked)],
            ))
        })?),
    };
    let vault = root.as_deref();
    if vault.is_none() && !host.has_current_vault() {
        return Err(PluginError::Unserved(Text::key("host.uri.no_vault")));
    }
    let registry =
        |command: &str, args: Value| host.invoke_user_command(vault, command, args, mode);
    match uri {
        FubUri::Open { .. } | FubUri::Search { .. } => Err(PluginError::BadArgs(Text::message(
            "host.uri.reads",
            vec![Arg::text("action", uri.action())],
        ))),
        FubUri::New {
            folder,
            name,
            title,
            template,
            ..
        } => {
            let note = crate::capture::NewNote {
                folder: folder.as_deref(),
                name: name.as_deref(),
                title: title.as_deref(),
                template: template.as_deref(),
            };
            let doc = crate::capture::new_note(host, vault, &note, mode)?;
            Ok(planned_or_done(doc, mode))
        }
        FubUri::Daily { date, .. } => registry(
            "note.daily",
            date.map(|date| json!({ "date": date }))
                .unwrap_or_else(|| json!({})),
        ),
        FubUri::Unique { folder, prefix, .. } => {
            let stem = prefix
                .as_deref()
                .map(str::trim)
                .filter(|stem| !stem.is_empty());
            let mut args = json!({});
            if let Some(stem) = stem {
                let folder = fub_abi::rules::folders::normalized(folder.as_deref().unwrap_or(""));
                let name = match folder {
                    "" => format!("{stem}.md"),
                    folder => format!("{folder}/{stem}.md"),
                };
                args = json!({ "name": name });
            }
            registry("note.unique", args)
        }
        FubUri::Capture {
            vault: asked,
            folder,
            note,
            mode: capture_mode,
            title,
            markdown,
            source_url,
            ..
        } => {
            let missing = |what: &str| {
                PluginError::BadArgs(Text::message(
                    "host.uri.capture_missing",
                    vec![Arg::text("what", what)],
                ))
            };
            let payload = CapturePayloadV1 {
                v: 1,
                title: title.ok_or_else(|| missing("title"))?,
                markdown: markdown.ok_or_else(|| missing("markdown"))?,
                source_url,
                properties: None,
                target: CaptureTarget {
                    // Il vault è già risolto: la cattura lo riceve come
                    // selettore, non come il nome scritto nell'URI.
                    vault: asked.and(root.clone()),
                    folder,
                    note,
                    mode: capture_mode.unwrap_or(CaptureMode::Create),
                },
            };
            validate_capture_v1(&payload).map_err(|why| bad_uri(&why.to_string()))?;
            let doc = if mode.is_dry_run() {
                crate::capture::plan(host, vault, &payload, None)?
            } else {
                crate::capture::apply(host, vault, &payload, None)?
            };
            Ok(planned_or_done(doc, mode))
        }
    }
}

fn planned_or_done(doc: fub_abi::model::DocId, mode: InvokeMode) -> CommandOutcome {
    if mode.is_dry_run() {
        let summary = Text::message("host.uri.plan", vec![Arg::text("doc", doc.as_str())]);
        return CommandOutcome::done().with_effect(CommandEffect::Plan(
            fub_abi::command::CommandPlan::of_edits(summary, Vec::new()).with_doc(doc),
        ));
    }
    CommandOutcome::notify(Text::message(
        "host.uri.done",
        vec![Arg::text("doc", doc.as_str())],
    ))
    .with_effect(CommandEffect::Navigate { doc })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_inbox_keeps_what_arrives_until_taken_and_counts_what_it_refuses() {
        let inbox = UriInbox::default();
        for n in 0..CAPACITY {
            assert!(inbox.push(&format!("fub://open?note={n}.md")));
        }
        assert!(!inbox.push("fub://open?note=oltre.md"));
        let (seen, refused) = inbox.pending(false);
        assert_eq!((seen.len(), refused), (CAPACITY, 1), "guardare non toglie");
        let (taken, refused) = inbox.pending(true);
        assert_eq!(taken[0], "fub://open?note=0.md");
        assert_eq!((taken.len(), refused), (CAPACITY, 1));
        assert_eq!(inbox.pending(true), (Vec::new(), 0));
        assert!(
            inbox.push("fub://open?note=dopo.md"),
            "presa la coda, c'è posto"
        );
    }
}
