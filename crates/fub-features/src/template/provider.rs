//! `TemplateCommands`: le spec dei comandi e il `CommandProvider` che le
//! smista.

use super::*;

pub struct TemplateCommands;

impl TemplateCommands {
    /// Le spec, anche fuori dal trait: chi disegna una palette nei test le
    /// legge senza montare un workspace, come fa `CoreCommands::specs`.
    ///
    /// Tutte si offrono anche nel menu `/` dell'editor: sono gesti di chi sta
    /// scrivendo, e i parametri che il contesto non riempie li chiede il menu.
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            command(NOTES_FROM_TEMPLATE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_FROM_TEMPLATE, TEMPLATE, ParamKind::Text).required())
                .with_param(parameter(NOTES_FROM_TEMPLATE, NAME, ParamKind::Text))
                .with_param(parameter(NOTES_FROM_TEMPLATE, FOLDER, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_DAILY)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_DAILY, DATE, ParamKind::Text))
                .with_param(parameter(NOTES_DAILY, FOLDER, ParamKind::Text))
                .with_param(parameter(NOTES_DAILY, TEMPLATE, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_UNIQUE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_UNIQUE, NAME, ParamKind::Text))
                .with_param(parameter(NOTES_UNIQUE, RANDOM, ParamKind::Bool))
                .with_param(parameter(NOTES_UNIQUE, TEMPLATE, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_RANDOM)
                .offered_in(CommandSurface::Slash)
                .with_scope(CommandScope::read_only()),
            command(NOTES_INSERT_DATETIME)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_INSERT_DATETIME, DOC, ParamKind::Document))
                .with_param(parameter(NOTES_INSERT_DATETIME, AT, ParamKind::Numbers))
                .with_param(parameter(
                    NOTES_INSERT_DATETIME,
                    FORMAT,
                    ParamKind::Choice(vec![
                        Choice::new("date", Text::key("note.insert_datetime.format.date")),
                        Choice::new("time", Text::key("note.insert_datetime.format.time")),
                        Choice::new(
                            "datetime",
                            Text::key("note.insert_datetime.format.datetime"),
                        ),
                    ]),
                ))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_INSERT_TEMPLATE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_INSERT_TEMPLATE, TEMPLATE, ParamKind::Text).required())
                .with_param(parameter(NOTES_INSERT_TEMPLATE, DOC, ParamKind::Document))
                .with_param(parameter(NOTES_INSERT_TEMPLATE, AT, ParamKind::Numbers))
                .with_param(parameter(NOTES_INSERT_TEMPLATE, MERGE, ParamKind::Bool))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_EXTRACT)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_EXTRACT, NAME, ParamKind::Text))
                .with_param(parameter(NOTES_EXTRACT, TEMPLATE, ParamKind::Text))
                .with_param(parameter(
                    NOTES_EXTRACT,
                    REPLACE,
                    ParamKind::Choice(vec![
                        Choice::new("link", Text::key("note.extract.replace.link")),
                        Choice::new("embed", Text::key("note.extract.replace.embed")),
                        Choice::new("none", Text::key("note.extract.replace.none")),
                    ]),
                ))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_MERGE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_MERGE, FROM, ParamKind::Documents).required())
                .with_param(parameter(NOTES_MERGE, INTO, ParamKind::Document))
                .with_param(parameter(
                    NOTES_MERGE,
                    MODE,
                    ParamKind::Choice(vec![
                        Choice::new("append", Text::key("note.merge.mode.append")),
                        Choice::new("prepend", Text::key("note.merge.mode.prepend")),
                    ]),
                ))
                .with_param(parameter(NOTES_MERGE, SEPARATOR, ParamKind::Text))
                .with_param(parameter(NOTES_MERGE, TRASH_PARAM, ParamKind::Bool))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
        ]
    }

    /// Lo schema delle impostazioni di questo componente: cartelle, template e
    /// formati di giornaliere e inserimenti. Chi monta le registra; chi invoca
    /// le legge via `host.setting`, con i default qui sotto quando nessuno ha
    /// deciso. Tutte `program_writable`: sono profili di vault reversibili e
    /// non toccano la privacy, come i pesi della ricerca.
    pub fn settings() -> Vec<SettingSpec> {
        vec![
            SettingSpec::new(
                DAILY_FOLDER_KEY,
                Text::key(S_DAILY_FOLDER),
                SettingKind::Text {
                    default: FOLDER_DAILY.into(),
                },
            )
            .describing(Text::key(S_DAILY_FOLDER_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                DAILY_TEMPLATE_KEY,
                Text::key(S_DAILY_TEMPLATE),
                SettingKind::Text {
                    default: DAILY_TEMPLATE.into(),
                },
            )
            .describing(Text::key(S_DAILY_TEMPLATE_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                DAILY_FORMAT_KEY,
                Text::key(S_DAILY_FORMAT),
                SettingKind::Text {
                    default: DAILY_FORMAT_DEFAULT.into(),
                },
            )
            .describing(Text::key(S_DAILY_FORMAT_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                DATE_FORMAT_KEY,
                Text::key(S_DATE_FORMAT),
                SettingKind::Text {
                    default: ISO_DATE.into(),
                },
            )
            .describing(Text::key(S_DATE_FORMAT_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                TIME_FORMAT_KEY,
                Text::key(S_TIME_FORMAT),
                SettingKind::Text {
                    default: CLOCK_24.into(),
                },
            )
            .describing(Text::key(S_TIME_FORMAT_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
            SettingSpec::new(
                UNIQUE_PREFIX_KEY,
                Text::key(S_UNIQUE_PREFIX),
                SettingKind::Text {
                    default: UNIQUE_PREFIX_DEFAULT.into(),
                },
            )
            .describing(Text::key(S_UNIQUE_PREFIX_DESC))
            .grouped(Text::key(S_GROUP))
            .program_writable(),
        ]
    }
}

impl CommandProvider for TemplateCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        TemplateCommands::specs()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let args = Args::new(&args);
        match command {
            NOTES_FROM_TEMPLATE => from_template(args, mode, host),
            NOTES_DAILY => daily(args, mode, host),
            NOTES_UNIQUE => unique(args, mode, host),
            NOTES_RANDOM => random(mode, host),
            NOTES_INSERT_DATETIME => insert_datetime(args, mode, host),
            NOTES_INSERT_TEMPLATE => insert_template(args, mode, host),
            NOTES_EXTRACT => extract(args, mode, host),
            NOTES_MERGE => merge(args, mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn command(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}
