//! L'anteprima di un file Craft fatta dalla riga di comando dell'app, dopo un
//! gesto dell'utente.
//!
//! [`Host::craft_render`] è l'unica porta che mette in coda il job
//! `craft.render`: controlla il componente, il consenso, l'anteprima che c'è
//! già, il programma e il peso, poi rilascia un biglietto legato a vault,
//! documento e misura e mette il job in coda. Il job senza un biglietto buono
//! non avvia niente (`craft::render`). Né il comando `craft.preview`, né un
//! altro componente, né un job chiamato a mano arrivano alla CLI.
//!
//! Il metodo c'è soltanto con la feature `craft`, perché il contratto
//! dell'anteprima vive in `fub-format-craft`. Le regole sono in
//! `docs/reference/craft-formats.md`.

/// Le forme che [`Host::craft_render`] riceve e restituisce, per chi lo chiama
/// attraverso l'host (il comando IPC `craft_render` di `fub-app`): la colla non
/// dipende dal crate dei formati.
#[cfg(feature = "craft")]
pub use fub_format_craft::{CraftPreview, PreviewSize};

#[cfg(feature = "craft")]
mod with_craft {
    use std::time::Instant;

    use fub_abi::command::{CommandEffect, InvokeMode};
    use fub_abi::settings::SettingValue;
    use fub_abi::text::Text;
    use fub_abi::PluginError;
    use fub_format_craft::{
        CraftPreview, Missing, PreviewSize, RenderConsent, PREVIEW_COMMAND, RENDER_JOB,
    };

    use crate::craft::render::{self, Binding};
    use crate::craft::{consent, CRAFT_ID};
    use crate::session::Host;
    use crate::settings::{CRAFT_CLI_PREVIEWS, CRAFT_EDITOR_PATHS};

    fn refused(key: &'static str) -> PluginError {
        PluginError::Unserved(Text::key(key))
    }

    impl Host {
        /// Fa l'anteprima di `doc` con la CLI della sua app, se serve e se
        /// l'utente l'ha permesso. Risponde subito: col `CraftPreview` di
        /// `craft.preview` quando un'anteprima c'è già, altrimenti con
        /// `queued: true` e il job in coda; il risultato arriva con
        /// `Event::JobDone`. Due richieste per lo stesso documento e la stessa
        /// misura avviano una CLI sola.
        pub fn craft_render(
            &self,
            vault: Option<&str>,
            doc: &str,
            size: PreviewSize,
        ) -> Result<CraftPreview, PluginError> {
            let on = self
                .bundles(vault)?
                .iter()
                .any(|bundle| bundle.id == CRAFT_ID && bundle.mounted);
            if !on {
                return Err(refused("host.craft_render.off"));
            }
            let consent = match self.machine.effective(CRAFT_CLI_PREVIEWS) {
                Ok((SettingValue::Text(value), _)) => consent::of_value(&value),
                _ => RenderConsent::Ask,
            };
            if consent != RenderConsent::On {
                return Err(PluginError::PermissionDenied(Text::key(
                    "host.craft_render.no_consent",
                )));
            }
            let mut preview = self.ask_preview(vault, doc, size)?;
            let wanted = matches!(preview.missing, Some(Missing::Absent | Missing::OverLimit));
            if preview.image.is_some() || !wanted {
                return Ok(preview);
            }
            let overrides = match self.machine.effective(CRAFT_EDITOR_PATHS) {
                Ok((SettingValue::List(lines), _)) => lines,
                _ => Vec::new(),
            };
            if render::cli_with(preview.info.app, &overrides).is_none() {
                return Err(PluginError::NotFound(Text::key("host.craft_render.no_cli")));
            }
            if preview.missing == Some(Missing::OverLimit) {
                return Err(refused("host.craft_render.over_limit"));
            }
            if preview.render.is_none() {
                // Già provato per questa revisione, o il file non ha un'app.
                return Ok(preview);
            }
            let root = self.root(vault)?;
            let binding = Binding {
                root: root.clone(),
                doc: doc.to_owned(),
                size,
            };
            let now = Instant::now();
            if render::in_progress(&binding, now) || !render::begin(&binding, now) {
                preview.queued = true;
                return Ok(preview);
            }
            let Some(ranged) = render::reader_of(&root) else {
                render::abandon(&binding);
                return Err(refused("host.craft_render.off"));
            };
            let ticket = match render::issue(binding.clone(), ranged) {
                Ok(ticket) => ticket,
                Err(error) => {
                    render::abandon(&binding);
                    return Err(PluginError::Io(error.to_string().into()));
                }
            };
            let payload = serde_json::json!({
                "doc": doc,
                "size": size.as_str(),
                "ticket": ticket,
            });
            if let Err(error) = self.spawn_job(vault, CRAFT_ID, RENDER_JOB, payload) {
                render::revoke(&ticket);
                render::abandon(&binding);
                return Err(error);
            }
            preview.queued = true;
            Ok(preview)
        }

        /// La risposta di `craft.preview` per `doc`, in sola lettura.
        fn ask_preview(
            &self,
            vault: Option<&str>,
            doc: &str,
            size: PreviewSize,
        ) -> Result<CraftPreview, PluginError> {
            let outcome = self.invoke_user_command(
                vault,
                PREVIEW_COMMAND,
                serde_json::json!({ "doc": doc, "size": size.as_str() }),
                InvokeMode::Apply,
            )?;
            match outcome.effect {
                CommandEffect::Custom { payload, .. } => serde_json::from_value(payload)
                    .map_err(|error| PluginError::Internal(error.to_string().into())),
                _ => Err(refused("host.craft_render.off")),
            }
        }
    }
}
