//! Ponte per l'export opzionale `format-links` dello stesso componente formato.

use std::sync::Mutex;

use fub_abi::edit::TextEdit;
use fub_abi::format::{DocumentSource, LinkRewrite, ParseContext};
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
