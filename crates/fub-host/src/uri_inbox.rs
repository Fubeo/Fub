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
//! `fub://capture` non è autenticato: qualunque pagina lo apre, e l'`origin`
//! della busta è un'etichetta che la pagina sceglie. Per questo una cattura
//! chiede sempre conferma nella shell (nessuna impostazione la salta), e qui
//! ha due limiti in più. Le catture in coda sono al più
//! [`CAPTURE_CAPACITY`], ognuna fino a 2 MiB e una conferma a testa: oltre si
//! rifiutano e si contano. Il `nonce` lega i tentativi di una stessa cattura:
//! uno già in coda non si accoda di nuovo, e uno già scritto non si riscrive
//! ([`URI_APPLY`] lo rifiuta come conflitto), anche se l'utente lo conferma.
//! L'app ricorda gli ultimi [`NONCE_MEMORY`] `nonce` scritti, finché resta
//! aperta.
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
/// Quante catture aspettano la shell, al più, dentro [`CAPACITY`].
pub const CAPTURE_CAPACITY: usize = 4;
/// Quanti `nonce` di catture scritte l'app ricorda.
pub const NONCE_MEMORY: usize = 256;

const URI: &str = "uri";

/// La coda della macchina: gli URI arrivano a un'app, non a un vault.
#[derive(Default)]
pub(crate) struct UriInbox {
    state: Mutex<Inbox>,
}

#[derive(Default)]
struct Inbox {
    queue: VecDeque<Queued>,
    /// Quanti URI il tetto ha rifiutato dall'ultima volta che la shell ha
    /// preso la coda.
    refused: usize,
    /// I `nonce` delle catture scritte (o in scrittura), i più vecchi prima.
    written: VecDeque<String>,
}

struct Queued {
    raw: String,
    /// `Some` per una cattura: il suo `nonce`, se lo porta.
    capture: Option<Option<String>>,
}

/// Che cosa la coda ha fatto di un URI.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Received {
    /// In coda, la shell lo prenderà.
    Queued,
    /// Lo stesso `nonce` di una cattura già in coda o già scritta: è un nuovo
    /// tentativo della stessa, e non si accoda una seconda volta.
    Duplicate,
    /// Fuori: la coda, o la parte delle catture, è piena.
    Refused,
}

impl UriInbox {
    /// Mette `raw` in coda, con i tetti e i `nonce` delle catture.
    pub(crate) fn push(&self, raw: &str) -> Received {
        // Si legge fuori dal lock: un URI può pesare 2 MiB.
        let capture = match parse_fub_uri(raw) {
            Ok(FubUri::Capture { nonce, .. }) => Some(nonce),
            _ => None,
        };
        let mut inbox = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(Some(nonce)) = &capture {
            let queued = inbox
                .queue
                .iter()
                .any(|item| matches!(&item.capture, Some(Some(other)) if other == nonce));
            if queued || inbox.written.contains(nonce) {
                return Received::Duplicate;
            }
        }
        let captures = inbox
            .queue
            .iter()
            .filter(|item| item.capture.is_some())
            .count();
        if inbox.queue.len() >= CAPACITY || (capture.is_some() && captures >= CAPTURE_CAPACITY) {
            inbox.refused += 1;
            return Received::Refused;
        }
        inbox.queue.push_back(Queued {
            raw: raw.to_string(),
            capture,
        });
        Received::Queued
    }

    /// Prenota `nonce` per una scrittura: `false` se è già stato scritto, o
    /// se un'altra scrittura lo tiene. Chi lo prenota e poi fallisce lo
    /// rilascia con [`Self::release`].
    fn claim(&self, nonce: &str) -> bool {
        let mut inbox = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if inbox.written.iter().any(|seen| seen == nonce) {
            return false;
        }
        if inbox.written.len() >= NONCE_MEMORY {
            inbox.written.pop_front();
        }
        inbox.written.push_back(nonce.to_string());
        true
    }

    fn release(&self, nonce: &str) {
        let mut inbox = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if let Some(at) = inbox.written.iter().position(|seen| seen == nonce) {
            inbox.written.remove(at);
        }
    }

    fn written(&self, nonce: &str) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .written
            .iter()
            .any(|seen| seen == nonce)
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
            (
                inbox.queue.drain(..).map(|item| item.raw).collect(),
                refused,
            )
        } else {
            (
                inbox.queue.iter().map(|item| item.raw.clone()).collect(),
                inbox.refused,
            )
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
    apply(host, inbox, &raw, mode)
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
        FubUri::ChooseVault => None,
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
        "writes": !matches!(
            uri,
            FubUri::Open { .. } | FubUri::Search { .. } | FubUri::ChooseVault
        ),
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
        FubUri::ChooseVault => json!({}),
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
fn apply(
    host: &Host,
    inbox: &UriInbox,
    raw: &str,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
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
        FubUri::Open { .. } | FubUri::Search { .. } | FubUri::ChooseVault => {
            Err(PluginError::BadArgs(Text::message(
                "host.uri.reads",
                vec![Arg::text("action", uri.action())],
            )))
        }
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
            nonce,
            properties,
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
                properties,
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
            let replayed = || PluginError::Conflict(Text::key("host.uri.capture_replayed"));
            let doc = if mode.is_dry_run() {
                if nonce.as_deref().is_some_and(|nonce| inbox.written(nonce)) {
                    return Err(replayed());
                }
                crate::capture::plan(host, vault, &payload, None)?
            } else {
                // Il `nonce` si prenota prima di scrivere e si rilascia se la
                // scrittura fallisce: due conferme dello stesso ritaglio non
                // scrivono due volte, nemmeno insieme.
                if nonce.as_deref().is_some_and(|nonce| !inbox.claim(nonce)) {
                    return Err(replayed());
                }
                crate::capture::apply(host, vault, &payload, None).inspect_err(|_| {
                    if let Some(nonce) = nonce.as_deref() {
                        inbox.release(nonce);
                    }
                })?
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
            assert_eq!(
                inbox.push(&format!("fub://open?note={n}.md")),
                Received::Queued
            );
        }
        assert_eq!(inbox.push("fub://open?note=oltre.md"), Received::Refused);
        let (seen, refused) = inbox.pending(false);
        assert_eq!((seen.len(), refused), (CAPACITY, 1), "guardare non toglie");
        let (taken, refused) = inbox.pending(true);
        assert_eq!(taken[0], "fub://open?note=0.md");
        assert_eq!((taken.len(), refused), (CAPACITY, 1));
        assert_eq!(inbox.pending(true), (Vec::new(), 0));
        assert_eq!(
            inbox.push("fub://open?note=dopo.md"),
            Received::Queued,
            "presa la coda, c'è posto"
        );
    }

    fn capture(n: usize, nonce: Option<&str>) -> String {
        let nonce = nonce
            .map(|nonce| format!("&nonce={nonce}"))
            .unwrap_or_default();
        format!("fub://capture?title=T{n}&markdown=x{nonce}")
    }

    #[test]
    fn captures_have_their_own_cap_inside_the_queue() {
        let inbox = UriInbox::default();
        for n in 0..CAPTURE_CAPACITY {
            assert_eq!(inbox.push(&capture(n, None)), Received::Queued);
        }
        assert_eq!(inbox.push(&capture(99, None)), Received::Refused);
        assert_eq!(
            inbox.push("fub://open?note=a.md"),
            Received::Queued,
            "il tetto delle catture non ferma il resto"
        );
        let (taken, refused) = inbox.pending(true);
        assert_eq!((taken.len(), refused), (CAPTURE_CAPACITY + 1, 1));
        assert_eq!(inbox.push(&capture(5, None)), Received::Queued);
    }

    #[test]
    fn the_same_nonce_is_queued_once_and_written_once() {
        let inbox = UriInbox::default();
        assert_eq!(inbox.push(&capture(1, Some("n-1"))), Received::Queued);
        assert_eq!(inbox.push(&capture(2, Some("n-1"))), Received::Duplicate);
        assert_eq!(inbox.pending(true).0.len(), 1);
        assert!(inbox.claim("n-1"));
        assert!(!inbox.claim("n-1"), "una seconda scrittura è un conflitto");
        assert_eq!(
            inbox.push(&capture(3, Some("n-1"))),
            Received::Duplicate,
            "già scritta: non chiede di nuovo"
        );
        inbox.release("n-1");
        assert!(inbox.claim("n-1"), "rilasciato dopo un errore, si riprova");
    }

    #[test]
    fn the_memory_of_written_nonces_is_bounded() {
        let inbox = UriInbox::default();
        for n in 0..=NONCE_MEMORY {
            assert!(inbox.claim(&format!("n-{n}")));
        }
        assert!(inbox.claim("n-0"), "il più vecchio è uscito");
        assert!(!inbox.claim(&format!("n-{NONCE_MEMORY}")));
    }
}
