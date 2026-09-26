//! Ponte per gli export opzionali `format-links` e `format-edits` dello stesso
//! componente formato.

use std::sync::Mutex;

use fub_abi::edit::TextEdit;
use fub_abi::format::{DocumentSource, LinkInsert, LinkRewrite, ParseContext};
use fub_abi::model::TaskMarker;
use fub_abi::FormatError;

use crate::component::{enter_instance, instance_identity, Instance};
use crate::translate as tr;

/// Assenza dell'export = capability assente, non fallback raw. Una risposta
/// presente deve coprire tutte le richieste o fallire; gli span sono validati
/// dal percorso che applica gli edit con CAS.
pub(crate) fn call_rewrite_links(
    inner: &Mutex<Instance>,
    source: &DocumentSource,
    ctx: &ParseContext,
    rewrites: &[LinkRewrite],
) -> Result<Option<Vec<TextEdit>>, FormatError> {
    let source_wit = tr::to_document_source(source);
    let ctx_wit = tr::to_parse_context(ctx);
    let rewrites_wit: Vec<_> = rewrites.iter().map(tr::to_link_rewrite).collect();
    let _guard = enter_instance(instance_identity(inner))
        .map_err(|_| FormatError::Parse("re-entrant component call".into()))?;
    let mut locked = inner
        .lock()
        .map_err(|_| FormatError::Parse("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *locked;
    let links = match interfaces.format_links.as_ref() {
        Some(links) => links,
        None => return Ok(None),
    };
    crate::limits::renew(&mut *store);
    let answered = links
        .call_rewrite_links(&mut *store, &source_wit, &ctx_wit, &rewrites_wit)
        .map_err(|error| FormatError::Parse(format!("il componente è caduto: {error:#}")))?
        .map_err(tr::from_format_error)?;
    let Some(edits) = answered else {
        return Ok(None);
    };
    if !rewrites.is_empty() && edits.is_empty() {
        return Err(FormatError::Parse(
            "il formato non ha riscritto alcun riferimento richiesto".into(),
        ));
    }
    edits
        .into_iter()
        .map(tr::from_link_edit)
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
        .map_err(|error| FormatError::Parse(format!("riscrittura non traducibile: {error}")))
}

/// `format-edits.format-link`. Assenza dell'export = il formato non sa
/// scrivere il riferimento, come un provider nativo che non implementa il
/// metodo.
pub(crate) fn call_format_link(
    inner: &Mutex<Instance>,
    ctx: &ParseContext,
    link: &LinkInsert,
) -> Result<Option<String>, FormatError> {
    let ctx_wit = tr::to_parse_context(ctx);
    let link_wit = tr::to_link_insert(link);
    let _guard = enter_instance(instance_identity(inner))
        .map_err(|_| FormatError::Serialize("re-entrant component call".into()))?;
    let mut locked = inner
        .lock()
        .map_err(|_| FormatError::Serialize("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *locked;
    let Some(edits) = interfaces.format_edits.as_ref() else {
        return Ok(None);
    };
    crate::limits::renew(&mut *store);
    edits
        .call_format_link(&mut *store, &ctx_wit, &link_wit)
        .map_err(|error| FormatError::Serialize(format!("il componente è caduto: {error:#}")))?
        .map_err(tr::from_format_error)
}

/// `format-edits.set-task-state`. Gli span restituiti li ricontrolla il
/// kernel contro la sorgente, e poi l'applicazione con CAS.
pub(crate) fn call_set_task_state(
    inner: &Mutex<Instance>,
    source: &DocumentSource,
    marker: &TaskMarker,
    done: bool,
) -> Result<Option<Vec<TextEdit>>, FormatError> {
    let source_wit = tr::to_document_source(source);
    let marker_wit = tr::to_task_marker(marker);
    let _guard = enter_instance(instance_identity(inner))
        .map_err(|_| FormatError::Parse("re-entrant component call".into()))?;
    let mut locked = inner
        .lock()
        .map_err(|_| FormatError::Parse("component instance is poisoned".into()))?;
    let Instance { store, interfaces } = &mut *locked;
    let Some(edits) = interfaces.format_edits.as_ref() else {
        return Ok(None);
    };
    crate::limits::renew(&mut *store);
    let answered = edits
        .call_set_task_state(&mut *store, &source_wit, marker_wit, done)
        .map_err(|error| FormatError::Parse(format!("il componente è caduto: {error:#}")))?
        .map_err(tr::from_format_error)?;
    let Some(edits) = answered else {
        return Ok(None);
    };
    edits
        .into_iter()
        .map(tr::from_link_edit)
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
        .map_err(|error| FormatError::Parse(format!("modifica non traducibile: {error}")))
}
