//! **Convertire in Excel** un foglio `.fubsheet`: il formato non si modifica
//! più (ADR 0218), e il comando scrive accanto a lui una cartella di Excel con
//! i suoi fogli, valori, formule e stili.
//!
//! La cartella nasce con un nome libero, senza coprire niente, e il
//! `.fubsheet` resta com'è: nel cestino va soltanto se l'utente lo chiede.
//! L'esito dice ciò che la copia perde o calcola diverso, con le note di
//! [`fubsheet::copy`](crate::fubsheet::copy).

use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec,
};
use fub_abi::model::DocId;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi, VaultRead};
use fub_abi::PluginError;
use fub_format_sheet::Workbook as SheetWorkbook;

use crate::fubsheet;

/// Il comando che converte il foglio.
pub const CONVERT: &str = "xlsx.convert";

/// L'estensione della cartella scritta.
const EXTENSION: &str = "xlsx";

/// Se il registro serve `doc` come foglio `.fubsheet`.
pub fn is_fubsheet<H: VaultRead + ?Sized>(host: &H, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == fub_format_sheet::FORMAT_ID)
}

/// Il nome che la cartella vorrebbe: lo stesso del foglio, con `.xlsx`.
fn wanted(doc: &DocId) -> DocId {
    let path = doc.as_str();
    let stem = path.rsplit_once('.').map_or(path, |(stem, _)| stem);
    DocId::new(format!("{stem}.{EXTENSION}"))
}

const T_TITLE: &str = "cmd.xlsx.convert.title";
const T_DESC: &str = "cmd.xlsx.convert.desc";
const T_DOC: &str = "cmd.xlsx.convert.doc";
const T_DONE: &str = "cmd.xlsx.convert.done";
const T_NOTES: &str = "cmd.xlsx.convert.notes";
const T_PLAN: &str = "cmd.xlsx.convert.plan";

/// Il comando «Converti in Excel».
pub struct XlsxCommands;

impl XlsxCommands {
    pub fn boxed() -> Box<dyn CommandProvider> {
        Box::new(XlsxCommands)
    }
}

impl CommandProvider for XlsxCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new(CONVERT, Text::key(T_TITLE))
            .describing(Text::key(T_DESC))
            .with_scope(CommandScope::writing(CommandReach::Vault))
            .with_param(ParamSpec::new("doc", Text::key(T_DOC), ParamKind::Document).required())]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != CONVERT {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let spec = self.commands().remove(0);
        spec.validate_args(&args)?;
        let doc = DocId::new(args["doc"].as_str().unwrap_or_default());
        if !is_fubsheet(&*host, &doc) {
            return Err(PluginError::BadArgs(
                format!("`{doc}` is not a .fubsheet sheet").into(),
            ));
        }
        let source = host.read_document(&doc)?;
        let sheet = SheetWorkbook::parse(&source).map_err(|error| {
            PluginError::BadArgs(format!("`{doc}` cannot be read: {error}").into())
        })?;
        let copy = fubsheet::copy(&sheet).map_err(|error| {
            PluginError::Internal(
                format!("the Excel copy of `{doc}` cannot be written: {error}").into(),
            )
        })?;
        let target = host.free_name(&wanted(&doc));
        let names = vec![
            Arg::text("doc", doc.as_str()),
            Arg::text("copy", target.as_str()),
        ];
        if mode.is_dry_run() {
            return Ok(CommandOutcome::notify(Text::message(T_PLAN, names)));
        }
        // `None`: la cartella nasce, e se nel frattempo il nome è stato preso
        // la scrittura lo dice invece di coprirlo.
        host.write_document_bytes(&target, &copy.bytes, None)?;
        let warnings: Vec<&str> = copy
            .notes
            .iter()
            .filter(|note| note.warning)
            .map(|note| note.text.as_str())
            .collect();
        let message = match warnings.is_empty() {
            true => Text::message(T_DONE, names),
            false => {
                let mut args = names;
                args.push(Arg::int("count", warnings.len() as i64));
                args.push(Arg::text("notes", warnings.join("; ")));
                Text::message(T_NOTES, args)
            }
        };
        Ok(CommandOutcome::notify(message).with_effect(CommandEffect::Navigate { doc: target }))
    }
}

/// Le stringhe del comando.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(T_TITLE, "Converti in Excel")
            .with(
                T_DESC,
                "Scrive accanto al foglio una cartella di Excel con i suoi fogli, valori, \
                 formule e stili, e la apre. Il foglio resta com'è: Fub non modifica più \
                 i .fubsheet.",
            )
            .with(T_DOC, "Foglio")
            .with(
                T_DONE,
                "«{copy}» è la copia in Excel di «{doc}», senza perdite.",
            )
            .with(
                T_NOTES,
                "«{copy}» è la copia in Excel di «{doc}», con {count} avvisi: {notes}",
            )
            .with(
                T_PLAN,
                "Scriverebbe «{copy}», la copia in Excel di «{doc}».",
            ),
        StringCatalog::new("en")
            .with(T_TITLE, "Convert to Excel")
            .with(
                T_DESC,
                "Writes an Excel workbook next to the sheet with its sheets, values, \
                 formulas and styles, and opens it. The sheet stays as it is: Fub no \
                 longer edits .fubsheet files.",
            )
            .with(T_DOC, "Sheet")
            .with(
                T_DONE,
                "“{copy}” is the Excel copy of “{doc}”, with nothing lost.",
            )
            .with(
                T_NOTES,
                "“{copy}” is the Excel copy of “{doc}”, with {count} warnings: {notes}",
            )
            .with(T_PLAN, "Would write “{copy}”, the Excel copy of “{doc}”."),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wanted_name_keeps_the_folder_and_changes_the_extension() {
        assert_eq!(
            wanted(&DocId::new("Fogli/Bilancio.fubsheet")),
            DocId::new("Fogli/Bilancio.xlsx")
        );
        assert_eq!(wanted(&DocId::new("a.b.fubsheet")), DocId::new("a.b.xlsx"));
    }
}
