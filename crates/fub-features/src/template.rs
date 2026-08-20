//! Template nota e note giornaliere.
//!
//! I template vivono nella cartella `Templates/` del vault (convenzione, non
//! recinto). `note.from_template` legge la sorgente, sostituisce
//! `{{date}}`/`{{title}}`/`{{name}}` e crea una nota nuova. `note.daily` apre o
//! crea `Daily/YYYY-MM-DD.md`, usando `Templates/Daily.md` se c'è.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, Undo,
};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::locale::civil_from_days;
use fub_abi::model::DocId;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiNode, ViewUpdate};

pub const TEMPLATE_ID: &str = "fub.template";
pub const TEMPLATE_VIEW: &str = "templates";
pub const NOTES_FROM_TEMPLATE: &str = "note.from_template";
pub const NOTES_DAILY: &str = "note.daily";

const FOLDER_TEMPLATES: &str = "Templates";
const FOLDER_DAILY: &str = "Daily";
const DAILY_TEMPLATE: &str = "Templates/Daily.md";
const EXTENSION: &str = "md";
const TRASH: &str = "note.trash";

const USE: &str = "use";
const TEMPLATE: &str = "template";
const NAME: &str = "name";

const VIEW_TITLE: &str = "view_title";
const EMPTY: &str = "empty";
const E_NO_TEMPLATE: &str = "e_no_template";
const E_EMPTY_TEMPLATE: &str = "e_empty_template";
const P_FROM: &str = "p_from";
const D_FROM: &str = "d_from";
const U_FROM: &str = "u_from";
const P_DAILY: &str = "p_daily";
const D_DAILY: &str = "d_daily";
const U_DAILY: &str = "u_daily";
const D_DAILY_OPEN: &str = "d_daily_open";

pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Template")
            .with(EMPTY, "Nessun template in Templates/.")
            .with(E_NO_TEMPLATE, "Nessun template indicato.")
            .with(E_EMPTY_TEMPLATE, "Il template «{doc}» è vuoto di nome.")
            .with(P_FROM, "Nuova nota da «{template}»")
            .with(D_FROM, "Creata {doc} da «{template}»")
            .with(U_FROM, "Annulla: crea {doc} da template")
            .with(P_DAILY, "Nota del {date}")
            .with(D_DAILY, "Creata la nota del {date}")
            .with(U_DAILY, "Annulla: nota del {date}")
            .with(D_DAILY_OPEN, "Aperta la nota del {date}")
            .with("note.from_template.title", "Nuova nota da template")
            .with(
                "note.from_template.desc",
                "Crea una nota copiando un template, con {{date}} {{title}} {{name}} sostituiti.",
            )
            .with("note.from_template.template.title", "Template")
            .with(
                "note.from_template.template.desc",
                "Il path del template nel vault.",
            )
            .with("note.from_template.name.title", "Nome")
            .with(
                "note.from_template.name.desc",
                "Nome della nota nuova. Assente: quello del template.",
            )
            .with("note.daily.title", "Nota di oggi")
            .with(
                "note.daily.desc",
                "Apre o crea la nota giornaliera di oggi.",
            )
            .with("note.daily.date.title", "Data")
            .with("note.daily.date.desc", "YYYY-MM-DD. Assente: oggi."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Templates")
            .with(EMPTY, "No templates in Templates/.")
            .with(E_NO_TEMPLATE, "No template given.")
            .with(E_EMPTY_TEMPLATE, "Template «{doc}» has no usable name.")
            .with(P_FROM, "New note from «{template}»")
            .with(D_FROM, "Created {doc} from «{template}»")
            .with(U_FROM, "Undo: create {doc} from template")
            .with(P_DAILY, "Note for {date}")
            .with(D_DAILY, "Created the note for {date}")
            .with(U_DAILY, "Undo: note for {date}")
            .with(D_DAILY_OPEN, "Opened the note for {date}")
            .with("note.from_template.title", "New note from template")
            .with(
                "note.from_template.desc",
                "Creates a note by copying a template, substituting {{date}} {{title}} {{name}}.",
            )
            .with("note.from_template.template.title", "Template")
            .with(
                "note.from_template.template.desc",
                "Vault path of the template.",
            )
            .with("note.from_template.name.title", "Name")
            .with(
                "note.from_template.name.desc",
                "Name of the new note. Absent: the template's name.",
            )
            .with("note.daily.title", "Today's note")
            .with("note.daily.desc", "Opens or creates today's daily note.")
            .with("note.daily.date.title", "Date")
            .with("note.daily.date.desc", "YYYY-MM-DD. Absent: today."),
    ]
}

pub struct TemplateView;

impl ViewProvider for TemplateView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            TEMPLATE_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::LeftSidebar,
        )
        .with_icon("template")
        .ordered(4)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if action.action.0 != USE {
            return Ok(ViewUpdate::None);
        }
        let Some(template) = action.payload.get(TEMPLATE).and_then(|v| v.as_str()) else {
            return Ok(ViewUpdate::None);
        };
        match host.run_command(
            NOTES_FROM_TEMPLATE,
            serde_json::json!({ TEMPLATE: template }),
        ) {
            Ok(outcome) => match outcome.effect {
                CommandEffect::Navigate { doc } => Ok(ViewUpdate::Navigate {
                    doc_id: doc.as_str().to_string(),
                }),
                _ => Ok(ViewUpdate::Replace { root: tree(host)? }),
            },
            Err(and) => Ok(ViewUpdate::Replace {
                root: UiNode::failed(Text::from(and.to_string()), None),
            }),
        }
    }
}

fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let prefix = format!("{FOLDER_TEMPLATES}/");
    let mut docs: Vec<DocId> = host
        .list_documents(None)?
        .items
        .into_iter()
        .filter(|d| d.as_str().starts_with(&prefix) && d.as_str().ends_with(".md"))
        .collect();
    docs.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    if docs.is_empty() {
        return Ok(UiNode::empty_state(Text::key(EMPTY)));
    }
    Ok(UiNode::list(
        docs.into_iter()
            .map(|d| {
                let title = file_name(&d);
                UiNode::list_item(
                    Text::from(title),
                    Some(Text::from(d.as_str())),
                    Some(ActionRef::with(
                        USE,
                        serde_json::json!({ TEMPLATE: d.as_str() }),
                    )),
                )
                .with_key(d.0.clone())
            })
            .collect(),
    ))
}

pub struct TemplateCommands;

impl CommandProvider for TemplateCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            command(NOTES_FROM_TEMPLATE)
                .with_param(parameter(NOTES_FROM_TEMPLATE, TEMPLATE, ParamKind::Text).required())
                .with_param(parameter(NOTES_FROM_TEMPLATE, NAME, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_DAILY)
                .with_param(parameter(NOTES_DAILY, "date", ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Vault)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            NOTES_FROM_TEMPLATE => from_template(Args::new(&args), mode, host),
            NOTES_DAILY => daily(Args::new(&args), mode, host),
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

fn from_template(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TEMPLATE)))?;
    let tpl = DocId::new(with_extension(template));
    let title = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| file_name(&tpl));
    if title.is_empty() {
        return Err(PluginError::BadArgs(Text::message(
            E_EMPTY_TEMPLATE,
            vec![Arg::text("doc", tpl.as_str())],
        )));
    }
    let id = host.free_name(&DocId::new(with_extension(&title)));
    let summary = Text::message(P_FROM, vec![Arg::text(TEMPLATE, tpl.as_str())]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let grezzo = host.read_document(&tpl)?;
    let data = today(host);
    let body = expand(&grezzo, &file_name(&id), &data);
    host.create_document(&id, &body)?;
    Ok(created(
        Text::message(
            D_FROM,
            vec![
                Arg::text("doc", id.as_str()),
                Arg::text(TEMPLATE, tpl.as_str()),
            ],
        ),
        Text::message(U_FROM, vec![Arg::text("doc", id.as_str())]),
        id,
    ))
}

fn daily(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let data = args
        .text("date")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| today(host));
    let id = DocId::new(format!("{FOLDER_DAILY}/{data}.{EXTENSION}"));
    let summary = Text::message(P_DAILY, vec![Arg::text("date", &data)]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let exists = host.list_documents(None)?.items.iter().any(|d| d == &id);
    if exists {
        return Ok(CommandOutcome::notify(Text::message(
            D_DAILY_OPEN,
            vec![Arg::text("date", &data)],
        ))
        .with_effect(CommandEffect::Navigate { doc: id }));
    }
    let body = match host.read_document(&DocId::new(DAILY_TEMPLATE)) {
        Ok(grezzo) => expand(&grezzo, &data, &data),
        Err(_) => String::new(),
    };
    host.create_document(&id, &body)?;
    Ok(created(
        Text::message(D_DAILY, vec![Arg::text("date", &data)]),
        Text::message(U_DAILY, vec![Arg::text("date", &data)]),
        id,
    ))
}

fn created(notify: Text, undo: Text, id: DocId) -> CommandOutcome {
    CommandOutcome::notify(notify)
        .undoable(Undo::by_command(
            undo,
            TRASH,
            serde_json::json!({ "doc": id.as_str() }),
        ))
        .with_effect(CommandEffect::Navigate { doc: id })
}

fn plan(summary: Text, id: DocId) -> CommandOutcome {
    CommandOutcome::done().with_effect(CommandEffect::Plan(
        CommandPlan::of_edits(summary, Vec::new()).with_doc(id),
    ))
}

pub(crate) fn expand(src: &str, title: &str, date: &str) -> String {
    // La via breve: nessun segnaposto, nessuna copia. Le `replace` a
    // cascata restano per il caso pieno — una sostituzione può contenere
    // un segnaposto successivo, e una passata sola non lo riprodurrebbe.
    if !src.contains("{{title}}") && !src.contains("{{name}}") && !src.contains("{{date}}") {
        return src.to_string();
    }
    src.replace("{{title}}", title)
        .replace("{{name}}", title)
        .replace("{{date}}", date)
}

fn today(host: &dyn ReadApi) -> String {
    let locale = host.user_locale();
    let civil = locale.to_civil_millis(host.now_unix_millis());
    let days = civil.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn file_name(id: &DocId) -> String {
    let file = id.0.rsplit('/').next().unwrap_or(&id.0);
    file.strip_suffix(".md").unwrap_or(file).to_string()
}

fn with_extension(name: &str) -> String {
    let last = name.rsplit('/').next().unwrap_or(name);
    if last.contains('.') {
        name.to_string()
    } else {
        format!("{name}.{EXTENSION}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_the_three_variables() {
        let s = expand(
            "ciao {{title}} il {{date}} ({{name}})",
            "Nota",
            "2026-08-15",
        );
        assert_eq!(s, "ciao Nota il 2026-08-15 (Nota)");
    }
}
