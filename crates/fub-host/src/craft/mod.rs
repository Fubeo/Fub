//! I file delle app Craft nel vault (N7): il bundle `fub.craft`.
//!
//! I formati (`.vectorcraft`, `.pcraft`, `.figcraft`, `.xmp`) li monta
//! `mount.rs` da `fub_format_craft::providers()` anche col componente spento:
//! la ricerca, i backlink e i tag restano. Il bundle aggiunge ciò che si vede
//! accanto: il comando [`PREVIEW_COMMAND`], in sola lettura, che risponde col
//! `CraftPreview` del documento nell'effetto `Custom` con `ns = fub.craft`; il
//! comando [`PHOTO_COMMAND`], in sola lettura anche lui, che risponde col
//! `PhotoSidecar` di una foto ([`photo`]: l'XMP accanto e ciò che dice); e il
//! job [`RENDER_JOB`], che fa l'anteprima con la riga di comando dell'app
//! soltanto col biglietto di `Host::craft_render` ([`render`]).
//!
//! Il contratto è in `fub_format_craft::contract`; come si legge l'anteprima,
//! e la cache che la tiene, sono in [`preview`]; le letture a pezzi dalle
//! lease del kernel in [`ranged`]. Fub non scrive mai un file
//! Craft: il bundle legge e basta.

pub mod channel;
pub mod consent;
pub mod editors;
pub mod launch;
pub mod open_with;
pub mod photo;
pub mod preview;
pub mod ranged;
pub mod render;

use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandScope, CommandSpec, ParamKind, ParamSpec,
};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{HostApi, Plugin};
use fub_abi::{CommandProvider, PluginError, PluginManifest};
use fub_format_craft::{PreviewSize, BUNDLE_NS, PHOTO_COMMAND, PREVIEW_COMMAND, RENDER_JOB};

/// Id del bundle: lo stesso spazio dei nomi dell'effetto del comando.
pub const CRAFT_ID: &str = BUNDLE_NS;

fn manifest() -> PluginManifest {
    let mut manifest = PluginManifest::core(CRAFT_ID, "Craft");
    // La riga della mappa dei componenti dice gruppo, specie, servizi usati e
    // pezzi di interfaccia: il manifest li ripete, come i bundle del nucleo.
    if let Some(row) = crate::componenti::riga(CRAFT_ID) {
        manifest.uses = row.uses.iter().map(|id| id.to_string()).collect();
        manifest.kind = row.kind;
        manifest.group = Some(row.gruppo.to_string());
        manifest.ui = row.ui.iter().map(|chunk| chunk.to_string()).collect();
    }
    manifest.speaking(crate::settings::CORE_DEFAULT_LOCALE, catalog())
}

fn catalog() -> Vec<StringCatalog> {
    let it = StringCatalog::new("it")
        .with("cmd.preview", "Anteprima del file Craft")
        .with(
            "cmd.preview.desc",
            "Mostra l'anteprima e le informazioni di un file di VectorCraft, PhotoCraft, FigCraft o di un XMP.",
        )
        .with("cmd.preview.doc", "Documento")
        .with("cmd.preview.doc.desc", "Il file Craft del vault.")
        .with("cmd.preview.size", "Misura")
        .with(
            "cmd.preview.size.desc",
            "Piccola per la figura nella nota, grande per la scheda.",
        )
        .with("cmd.preview.size.small", "Piccola")
        .with("cmd.preview.size.large", "Grande")
        .with("cmd.preview.render", "Crea l'anteprima")
        .with(
            "cmd.preview.render.desc",
            "Non conta più: il comando non avvia mai l'app che farebbe l'anteprima.",
        )
        .with("cmd.photo", "Dati della foto")
        .with(
            "cmd.photo.desc",
            "Mostra l'XMP che sta accanto a una foto: voto, etichetta, scelta e parole chiave.",
        )
        .with("cmd.photo.doc", "Foto")
        .with("cmd.photo.doc.desc", "La foto del vault.")
        .with("photo.missing", "`{doc}` non è nel vault.")
        .with("not_craft", "`{doc}` non è un file delle app Craft.")
        .with("bad_size", "`{size}` non è una misura: piccola o grande.")
        .with("changing", "Il file cambia mentre lo si legge: riprova fra poco.")
        .with(
            "render.no_cli",
            "Nessuna app Craft installata può fare l'anteprima.",
        )
        .with("render.no_ticket", "L'anteprima con l'app parte solo da un gesto in Fub.")
        .with("render.timed_out", "L'app ci ha messo troppo a fare l'anteprima: fermata.")
        .with("render.failed", "L'app non è riuscita a fare l'anteprima.")
        .with("render.denied", "Fub non può avviare l'app che fa l'anteprima.")
        .with("render.io", "Il sistema non ha lasciato partire l'app che fa l'anteprima.")
        .with("render.bad_png", "L'app non ha scritto un'immagine PNG o JPEG.")
        .with("render.too_big", "L'immagine scritta dall'app supera i 16 MiB.")
        .with("render.copy", "La copia del file per l'app non si scrive nella cartella temporanea.")
        .with("render.cancelled", "L'anteprima con l'app è stata fermata.")
        .with("render.changed", "Il file è cambiato mentre l'app faceva l'anteprima.");
    let en = StringCatalog::new("en")
        .with("cmd.preview", "Craft file preview")
        .with(
            "cmd.preview.desc",
            "Shows the preview and the details of a VectorCraft, PhotoCraft or FigCraft file, or of an XMP.",
        )
        .with("cmd.preview.doc", "Document")
        .with("cmd.preview.doc.desc", "The Craft file in the vault.")
        .with("cmd.preview.size", "Size")
        .with(
            "cmd.preview.size.desc",
            "Small for the figure in the note, large for the card.",
        )
        .with("cmd.preview.size.small", "Small")
        .with("cmd.preview.size.large", "Large")
        .with("cmd.preview.render", "Make the preview")
        .with(
            "cmd.preview.render.desc",
            "No longer used: the command never starts the app that would make the preview.",
        )
        .with("cmd.photo", "Photo details")
        .with(
            "cmd.photo.desc",
            "Shows the XMP next to a photo: rating, label, flag and keywords.",
        )
        .with("cmd.photo.doc", "Photo")
        .with("cmd.photo.doc.desc", "The photo in the vault.")
        .with("photo.missing", "`{doc}` is not in the vault.")
        .with("not_craft", "`{doc}` is not a Craft app file.")
        .with("bad_size", "`{size}` is not a size: small or large.")
        .with("changing", "The file keeps changing while it is read: try again shortly.")
        .with(
            "render.no_cli",
            "No installed Craft app can make the preview.",
        )
        .with("render.no_ticket", "The app makes a preview only after a gesture in Fub.")
        .with("render.timed_out", "The app took too long to make the preview: stopped.")
        .with("render.failed", "The app could not make the preview.")
        .with("render.denied", "Fub cannot start the app that makes the preview.")
        .with("render.io", "The system did not let the app that makes the preview start.")
        .with("render.bad_png", "The app did not write a PNG or JPEG image.")
        .with("render.too_big", "The image the app wrote is larger than 16 MiB.")
        .with("render.copy", "The copy of the file for the app cannot be written to the temporary folder.")
        .with("render.cancelled", "The preview with the app was stopped.")
        .with("render.changed", "The file changed while the app was making the preview.");
    vec![it, en]
}

pub struct CraftBundle;

impl crate::registry::Bundle for CraftBundle {
    fn manifest(&self) -> PluginManifest {
        manifest()
    }

    fn trust(&self) -> fub_kernel::Trust {
        fub_kernel::Trust::Core
    }

    fn plugin(&self) -> Box<dyn Plugin> {
        Box::new(CraftPlugin)
    }

    fn register(&self, registrar: &mut crate::registry::Registrar<'_>) -> Vec<String> {
        // Il lettore delle lease si prende qui, una volta: dentro un comando il
        // bundle non prende mai il lucchetto del workspace. Senza lettore le
        // anteprime passano dall'host, come un supporto senza lease.
        let ranged = match registrar.craft_reader() {
            Ok(reader) => {
                let root = reader.root().to_owned();
                let ranged = ranged::Ranged::new(reader);
                // Il job delle anteprime con la CLI legge da qui, col
                // biglietto che `Host::craft_render` gli dà.
                render::remember_reader(root, ranged.clone());
                // Le cartelle private che un Fub uscito di colpo ha lasciato
                // nella cartella temporanea: soltanto le sue, e ferme.
                render::sweep_left_behind(&std::env::temp_dir(), std::time::SystemTime::now());
                Some(ranged)
            }
            Err(error) => {
                tracing::warn!(%error, "fub.craft: niente letture a pezzi, le anteprime passano dall'host");
                None
            }
        };
        match registrar.register_command_provider(Box::new(CraftCommands { ranged })) {
            Ok(()) => Vec::new(),
            Err(error) => vec![format!("craft commands NOT registered: {error}")],
        }
    }
}

/// La misura dell'argomento `size`: assente vale `small`.
fn size_of(raw: Option<&str>) -> Result<PreviewSize, PluginError> {
    match raw {
        None | Some("small") => Ok(PreviewSize::Small),
        Some("large") => Ok(PreviewSize::Large),
        Some(other) => Err(PluginError::BadArgs(Text::message(
            "bad_size",
            vec![Arg::text("size", other)],
        ))),
    }
}

/// I comandi del bundle, col lettore a pezzi del vault su cui è montato.
pub struct CraftCommands {
    ranged: Option<ranged::Ranged>,
}

impl CommandProvider for CraftCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(PREVIEW_COMMAND, Text::key("cmd.preview"))
                .describing(Text::key("cmd.preview.desc"))
                .with_param(
                    ParamSpec::new("doc", Text::key("cmd.preview.doc"), ParamKind::Document)
                        .describing(Text::key("cmd.preview.doc.desc"))
                        .required(),
                )
                .with_param(
                    ParamSpec::new(
                        "size",
                        Text::key("cmd.preview.size"),
                        ParamKind::Choice(vec![
                            Choice::new("small", Text::key("cmd.preview.size.small")),
                            Choice::new("large", Text::key("cmd.preview.size.large")),
                        ]),
                    )
                    .describing(Text::key("cmd.preview.size.desc")),
                )
                // Dichiarato perché chi parla la forma della versione 1 non sia
                // rifiutato; `invoke` non lo legge.
                .with_param(
                    ParamSpec::new("render", Text::key("cmd.preview.render"), ParamKind::Bool)
                        .describing(Text::key("cmd.preview.render.desc")),
                )
                .with_scope(CommandScope::read_only()),
            CommandSpec::new(PHOTO_COMMAND, Text::key("cmd.photo"))
                .describing(Text::key("cmd.photo.desc"))
                .with_param(
                    ParamSpec::new("doc", Text::key("cmd.photo.doc"), ParamKind::Document)
                        .describing(Text::key("cmd.photo.doc.desc"))
                        .required(),
                )
                .with_scope(CommandScope::read_only()),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        _mode: fub_abi::command::InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command == PHOTO_COMMAND {
            let args = Args::new(&args);
            let Some(doc) = args.document("doc") else {
                return Err(PluginError::BadArgs(Text::message(
                    "photo.missing",
                    vec![Arg::text("doc", "")],
                )));
            };
            return custom(&photo::photo(&*host, self.ranged.as_ref(), &doc)?);
        }
        if command != PREVIEW_COMMAND {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let args = Args::new(&args);
        let Some(doc) = args.document("doc") else {
            return Err(PluginError::BadArgs(Text::message(
                "not_craft",
                vec![Arg::text("doc", "")],
            )));
        };
        // Soltanto `doc` e `size`: il comando non avvia mai niente, e un
        // `render` nella domanda (la forma della versione 1, ancora
        // dichiarato) si ignora.
        let size = size_of(args.text("size"))?;
        let preview = preview::preview(host, self.ranged.as_ref(), &doc, size)?;
        custom(&preview)
    }
}

/// L'esito di un comando del bundle: `value` nell'effetto `Custom` con
/// `ns = fub.craft`.
fn custom(value: &impl serde::Serialize) -> Result<CommandOutcome, PluginError> {
    let payload = serde_json::to_value(value)
        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
    Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
        ns: CRAFT_ID.to_string(),
        payload,
    }))
}

pub struct CraftPlugin;

impl Plugin for CraftPlugin {
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
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        if job != RENDER_JOB {
            return Err(PluginError::UnknownJob(job.to_string().into()));
        }
        // Senza il biglietto di `Host::craft_render` non parte niente.
        let preview = render::run(&payload, host)?;
        serde_json::to_value(&preview)
            .map_err(|error| PluginError::Internal(error.to_string().into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_size_defaults_to_small_and_refuses_the_unknown() {
        assert_eq!(size_of(None).unwrap(), PreviewSize::Small);
        assert_eq!(size_of(Some("large")).unwrap(), PreviewSize::Large);
        assert!(matches!(
            size_of(Some("Large")),
            Err(PluginError::BadArgs(_))
        ));
    }

    #[test]
    fn the_job_without_a_ticket_starts_nothing() {
        let mut host = fub_sdk::testing::MemoryHost::new();
        let error = CraftPlugin
            .run_job(RENDER_JOB, serde_json::json!({}), &mut host)
            .unwrap_err();
        assert!(
            matches!(&error, PluginError::Unserved(text)
                if text.as_message().is_some_and(|m| m.key == "render.no_ticket")),
            "{error:?}"
        );
        let error = CraftPlugin
            .run_job("altro", serde_json::json!({}), &mut host)
            .unwrap_err();
        assert!(matches!(error, PluginError::UnknownJob(_)), "{error:?}");
    }
}
