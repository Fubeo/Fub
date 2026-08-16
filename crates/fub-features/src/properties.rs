//! Il pannello **proprietà** e i comandi che scrivono il frontmatter.
//!
//! La lettura passa dal canale dati (`read_model` → `Frontmatter::properties`).
//! La scrittura è un comando che sostituisce l'intero blocco frontmatter con un
//! YAML nuovo: il corpo resta byte-identico, i commenti/virgolette del YAML no
//! — è il costo dichiarato dalla decisione 0059, che vieta di passare da
//! `FormatProvider::serialize` su un file esistente.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::{
    DateFormats, DateOrder, DocId, DocumentModel, LinkTarget, PropertyValue, Span,
};
use fub_abi::session::{ContextKind, ContextMask};
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec,
    ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del componente (spazio dati/registrazione).
pub const PROPERTIES_ID: &str = "fub.properties";
/// Id della `ViewSpec`.
pub const PROPERTIES_VIEW: &str = "properties";
/// Imposta (o aggiunge) una chiave del frontmatter.
pub const NOTE_PROPERTY_SET: &str = "note.property.set";
/// Toglie una chiave del frontmatter.
pub const NOTE_PROPERTY_REMOVE: &str = "note.property.remove";

/// La chiave del core: formato di data dichiarato dal vault. Non si importa da
/// `fub-kernel` (invariante): il nome è il contratto, ed è lo stesso.
const DATE_FORMAT_KEY: &str = "properties.date-format";

const SET: &str = "set";
const REMOVE: &str = "remove";
const ADD: &str = "add";
const KEY: &str = "key";
const VALUE: &str = "value";
const DOC: &str = "doc";
const NEW_KEY: &str = "new_key";
const NEW_VALUE: &str = "new_value";

const VIEW_TITLE: &str = "view_title";
const EMPTY_NO_NOTE: &str = "empty_no_note";
const EMPTY_NO_PROPS: &str = "empty_no_props";
const ADD_KEY_LABEL: &str = "add_key_label";
const ADD_VALUE_LABEL: &str = "add_value_label";
const ADD_SUBMIT: &str = "add_submit";
const REMOVE_LABEL: &str = "remove_label";
const E_EMPTY_KEY: &str = "e_empty_key";
const E_NO_NOTE: &str = "e_no_note";
const E_YAML: &str = "e_yaml";
const P_SET: &str = "p_set";
const P_REMOVE: &str = "p_remove";
const P_REMOVE_MISSING: &str = "p_remove_missing";
const U_SET: &str = "u_set";
const U_REMOVE: &str = "u_remove";
const FAILED: &str = "failed";

/// Le stringhe del pannello e dei comandi. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stiano qui.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Proprietà")
            .with(EMPTY_NO_NOTE, "Nessuna nota aperta.")
            .with(EMPTY_NO_PROPS, "Questa nota non ha proprietà.")
            .with(ADD_KEY_LABEL, "Chiave")
            .with(ADD_VALUE_LABEL, "Valore")
            .with(ADD_SUBMIT, "Aggiungi")
            .with(REMOVE_LABEL, "Rimuovi")
            .with(E_EMPTY_KEY, "La chiave è vuota.")
            .with(E_NO_NOTE, "Nessuna nota su cui scrivere la proprietà.")
            .with(E_YAML, "Non ho potuto scrivere il frontmatter: {reason}")
            .with(P_SET, "Proprietà «{key}» in {doc}")
            .with(P_REMOVE, "Tolta «{key}» da {doc}")
            .with(P_REMOVE_MISSING, "«{key}» non c'era in {doc}")
            .with(U_SET, "Annulla: proprietà «{key}» in {doc}")
            .with(U_REMOVE, "Annulla: togli «{key}» da {doc}")
            .with(FAILED, "Non ho aggiornato le proprietà: {reason}")
            .with("note.property.set.title", "Imposta proprietà")
            .with("note.property.set.desc", "Scrive una chiave del frontmatter della nota.")
            .with("note.property.set.doc.title", "Nota")
            .with("note.property.set.doc.desc", "La nota da modificare. Assente: quella aperta.")
            .with("note.property.set.key.title", "Chiave")
            .with("note.property.set.key.desc", "Il nome della proprietà.")
            .with("note.property.set.value.title", "Valore")
            .with(
                "note.property.set.value.desc",
                "Frammento YAML (testo, numero, true/false, lista, [[wikilink]]).",
            )
            .with("note.property.remove.title", "Togli proprietà")
            .with("note.property.remove.desc", "Toglie una chiave dal frontmatter della nota.")
            .with("note.property.remove.doc.title", "Nota")
            .with("note.property.remove.doc.desc", "La nota da modificare. Assente: quella aperta.")
            .with("note.property.remove.key.title", "Chiave")
            .with("note.property.remove.key.desc", "Il nome della proprietà da togliere."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Properties")
            .with(EMPTY_NO_NOTE, "No note open.")
            .with(EMPTY_NO_PROPS, "This note has no properties.")
            .with(ADD_KEY_LABEL, "Key")
            .with(ADD_VALUE_LABEL, "Value")
            .with(ADD_SUBMIT, "Add")
            .with(REMOVE_LABEL, "Remove")
            .with(E_EMPTY_KEY, "The key is empty.")
            .with(E_NO_NOTE, "No note to write the property on.")
            .with(E_YAML, "Could not write the frontmatter: {reason}")
            .with(P_SET, "Property «{key}» in {doc}")
            .with(P_REMOVE, "Removed «{key}» from {doc}")
            .with(P_REMOVE_MISSING, "«{key}» was not in {doc}")
            .with(U_SET, "Undo: property «{key}» in {doc}")
            .with(U_REMOVE, "Undo: remove «{key}» from {doc}")
            .with(FAILED, "Could not update properties: {reason}")
            .with("note.property.set.title", "Set property")
            .with("note.property.set.desc", "Writes a frontmatter key of the note.")
            .with("note.property.set.doc.title", "Note")
            .with("note.property.set.doc.desc", "The note to change. Absent: the open one.")
            .with("note.property.set.key.title", "Key")
            .with("note.property.set.key.desc", "The property name.")
            .with("note.property.set.value.title", "Value")
            .with(
                "note.property.set.value.desc",
                "YAML fragment (text, number, true/false, list, [[wikilink]]).",
            )
            .with("note.property.remove.title", "Remove property")
            .with("note.property.remove.desc", "Removes a key from the note's frontmatter.")
            .with("note.property.remove.doc.title", "Note")
            .with("note.property.remove.doc.desc", "The note to change. Absent: the open one.")
            .with("note.property.remove.key.title", "Key")
            .with("note.property.remove.key.desc", "The property name to remove."),
    ]
}

/// Il pannello proprietà della nota aperta.
pub struct PropertiesView;

impl ViewProvider for PropertiesView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask(vec![ContextKind::Document]),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            PROPERTIES_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("properties")
        .ordered(3)
        .open_by_default()]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host, None)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            SET => {
                let Some(key) = action.payload.get(KEY).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let Some(value) = yaml_dal_campo(&action, key) else {
                    return Ok(ViewUpdate::None);
                };
                let mut args = serde_json::json!({ KEY: key, VALUE: value });
                if let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) {
                    args[DOC] = serde_json::Value::String(doc.to_string());
                }
                comando_poi_albero(host, NOTE_PROPERTY_SET, args)
            }
            REMOVE => {
                let Some(key) = action.payload.get(KEY).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let mut args = serde_json::json!({ KEY: key });
                if let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) {
                    args[DOC] = serde_json::Value::String(doc.to_string());
                }
                comando_poi_albero(host, NOTE_PROPERTY_REMOVE, args)
            }
            ADD => {
                let key = action.text_field(NEW_KEY).unwrap_or_default();
                let value = action.text_field(NEW_VALUE).unwrap_or_default();
                let mut args = serde_json::json!({ KEY: key, VALUE: value });
                if let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) {
                    args[DOC] = serde_json::Value::String(doc.to_string());
                }
                comando_poi_albero(host, NOTE_PROPERTY_SET, args)
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn comando_poi_albero(
    host: &mut dyn HostApi,
    id: &str,
    args: serde_json::Value,
) -> Result<ViewUpdate, PluginError> {
    match host.run_command(id, args) {
        Ok(_) => Ok(ViewUpdate::Replace {
            root: tree(host, None)?,
        }),
        Err(e) => Ok(ViewUpdate::Replace {
            root: tree(
                host,
                Some(Text::message(FAILED, vec![Arg::text("reason", e.to_string())])),
            )?,
        }),
    }
}

fn yaml_dal_campo(action: &UiAction, key: &str) -> Option<String> {
    if let Some(b) = action.bool_field(key) {
        return Some(if b { "true" } else { "false" }.into());
    }
    if let Some(n) = action.number_field(key) {
        return Some(numero_yaml(n));
    }
    action.text_field(key).map(str::to_string)
}

fn numero_yaml(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

fn tree(host: &dyn ReadApi, avviso: Option<Text>) -> Result<UiNode, PluginError> {
    let Some(doc) = host.active_context().and_then(|c| c.doc) else {
        return Ok(UiNode::empty_state(Text::key(EMPTY_NO_NOTE)));
    };
    let model = host.read_model(&doc)?;
    let formats = date_formats(host);
    let props = model.frontmatter.properties(&formats);
    let mut figli = Vec::new();
    if let Some(avviso) = avviso {
        figli.push(UiNode::failed(avviso, None));
    }
    if props.is_empty() {
        figli.push(UiNode::empty_state(Text::key(EMPTY_NO_PROPS)));
    } else {
        figli.extend(props.iter().map(|(k, v)| riga(&doc, k, v)));
    }
    figli.push(form_aggiungi(&doc));
    Ok(UiNode::column(1, figli))
}

fn date_formats(host: &dyn ReadApi) -> DateFormats {
    match host.setting(DATE_FORMAT_KEY) {
        Ok(SettingValue::Text(s)) => {
            let s = s.trim();
            if s.is_empty() {
                DateFormats::ISO
            } else {
                DateOrder::from_key(s)
                    .map(DateFormats::declaring)
                    .unwrap_or(DateFormats::ISO)
            }
        }
        _ => DateFormats::ISO,
    }
}

fn riga(doc: &DocId, key: &str, value: &PropertyValue) -> UiNode {
    let payload = serde_json::json!({ KEY: key, DOC: doc.as_str() });
    let campo = widget(key, value, payload.clone());
    let togli = UiNode::button(
        Text::key(REMOVE_LABEL),
        Intent::Danger,
        ActionRef::with(REMOVE, payload),
    );
    UiNode::keyed(
        key,
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Row,
            gap: 1,
            children: vec![campo, togli],
        },
    )
}

fn widget(key: &str, value: &PropertyValue, payload: serde_json::Value) -> UiNode {
    let action = Some(ActionRef::with(SET, payload));
    let label = Some(Text::from(key));
    match value {
        PropertyValue::Text(s) => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: s.clone(),
            placeholder: None,
            action,
        }),
        PropertyValue::Number(n) => UiNode::new(UiKind::Number {
            field: key.to_string(),
            label,
            value: Some(*n),
            min: None,
            max: None,
            step: None,
            action,
        }),
        PropertyValue::Bool(b) => UiNode::new(UiKind::Checkbox {
            field: key.to_string(),
            label: Text::from(key),
            value: *b,
            action,
        }),
        PropertyValue::Date(d) => {
            // v1: il DatePicker è data civile. L'ora, se c'era, si perde in
            // scrittura: il widget manda solo `YYYY-MM-DD`.
            UiNode::new(UiKind::DatePicker {
                field: key.to_string(),
                label,
                value: Some(format!("{:04}-{:02}-{:02}", d.year, d.month, d.day)),
                action,
            })
        }
        PropertyValue::Link(t) => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: mostra_link(t),
            placeholder: None,
            action,
        }),
        PropertyValue::List(items) => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: mostra_lista(items),
            placeholder: None,
            action,
        }),
        PropertyValue::Empty => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: String::new(),
            placeholder: None,
            action,
        }),
        PropertyValue::Unknown(v) => UiNode::new(UiKind::Text {
            content: Text::from(v.to_string()),
        }),
    }
}

fn mostra_link(t: &LinkTarget) -> String {
    match t {
        LinkTarget::Wiki { .. } => match t.wiki_inner() {
            Some(inner) => format!("[[{inner}]]"),
            None => String::new(),
        },
        LinkTarget::Url(s) | LinkTarget::Path(s) => s.clone(),
    }
}

fn mostra_lista(items: &[fub_abi::model::PropertyScalar]) -> String {
    let vals: Vec<serde_json::Value> = items.iter().map(scalare_json).collect();
    match serde_yaml_ng::to_string(&vals) {
        Ok(s) => s.trim().to_string(),
        Err(_) => String::new(),
    }
}

fn scalare_json(s: &fub_abi::model::PropertyScalar) -> serde_json::Value {
    use fub_abi::model::PropertyScalar;
    match s {
        PropertyScalar::Empty => serde_json::Value::Null,
        PropertyScalar::Text(t) => serde_json::Value::String(t.clone()),
        PropertyScalar::Number(n) => serde_json::Number::from_f64(*n)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::String(n.to_string())),
        PropertyScalar::Bool(b) => serde_json::Value::Bool(*b),
        PropertyScalar::Date(d) => serde_json::Value::String(format!(
            "{:04}-{:02}-{:02}",
            d.year, d.month, d.day
        )),
        PropertyScalar::Link(t) => serde_json::Value::String(mostra_link(t)),
        PropertyScalar::Unknown(v) => v.clone(),
    }
}

fn form_aggiungi(doc: &DocId) -> UiNode {
    UiNode::new(UiKind::Form {
        children: vec![
            UiNode::new(UiKind::TextInput {
                field: NEW_KEY.to_string(),
                label: Some(Text::key(ADD_KEY_LABEL)),
                value: String::new(),
                placeholder: None,
                action: None,
            })
            .with_key(NEW_KEY),
            UiNode::new(UiKind::TextInput {
                field: NEW_VALUE.to_string(),
                label: Some(Text::key(ADD_VALUE_LABEL)),
                value: String::new(),
                placeholder: None,
                action: None,
            })
            .with_key(NEW_VALUE),
        ],
        submit_label: Text::key(ADD_SUBMIT),
        submit: ActionRef::with(ADD, serde_json::json!({ DOC: doc.as_str() })),
    })
}

/// I comandi `note.property.set` / `note.property.remove`.
pub struct PropertiesCommands;

impl CommandProvider for PropertiesCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            comando(NOTE_PROPERTY_SET)
                .with_param(parametro(NOTE_PROPERTY_SET, DOC, ParamKind::Document))
                .with_param(parametro(NOTE_PROPERTY_SET, KEY, ParamKind::Text).required())
                .with_param(parametro(NOTE_PROPERTY_SET, VALUE, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Document)),
            comando(NOTE_PROPERTY_REMOVE)
                .with_param(parametro(NOTE_PROPERTY_REMOVE, DOC, ParamKind::Document))
                .with_param(parametro(NOTE_PROPERTY_REMOVE, KEY, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Document)),
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
            NOTE_PROPERTY_SET => set(Args::new(&args), mode, host),
            NOTE_PROPERTY_REMOVE => remove(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn comando(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(format!("{id}.title")))
        .describing(Text::key(format!("{id}.desc")))
}

fn parametro(comando: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{comando}.{name}.title")), kind)
        .describing(Text::key(format!("{comando}.{name}.desc")))
}

fn doc_da(args: Args<'_>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    args.document(DOC)
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_NOTE)))
}

fn chiave_da(args: Args<'_>) -> Result<String, PluginError> {
    let key = args.text(KEY).unwrap_or("").trim();
    if key.is_empty() {
        Err(PluginError::BadArgs(Text::key(E_EMPTY_KEY)))
    } else {
        Ok(key.to_string())
    }
}

fn set(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_da(args, host)?;
    let key = chiave_da(args)?;
    let grezzo = args.text(VALUE).unwrap_or("");
    let valore = parse_yaml_valore(grezzo);
    riscrivi(
        host,
        &doc,
        mode,
        Text::message(
            P_SET,
            vec![Arg::text(KEY, &key), Arg::text(DOC, doc.as_str())],
        ),
        Text::message(
            U_SET,
            vec![Arg::text(KEY, &key), Arg::text(DOC, doc.as_str())],
        ),
        |mappa| {
            mappa.insert(key.clone(), valore.clone());
            Ok(())
        },
    )
}

fn remove(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_da(args, host)?;
    let key = chiave_da(args)?;
    let model = host.read_model(&doc)?;
    if model.frontmatter.get(&key).is_none() {
        return Ok(CommandOutcome::notify(Text::message(
            P_REMOVE_MISSING,
            vec![Arg::text(KEY, &key), Arg::text(DOC, doc.as_str())],
        )));
    }
    riscrivi(
        host,
        &doc,
        mode,
        Text::message(
            P_REMOVE,
            vec![Arg::text(KEY, &key), Arg::text(DOC, doc.as_str())],
        ),
        Text::message(
            U_REMOVE,
            vec![Arg::text(KEY, &key), Arg::text(DOC, doc.as_str())],
        ),
        |mappa| {
            mappa.remove(&key);
            Ok(())
        },
    )
}

fn riscrivi(
    host: &mut dyn HostApi,
    doc: &DocId,
    mode: InvokeMode,
    summary: Text,
    undo_label: Text,
    mut muta: impl FnMut(&mut serde_json::Map<String, serde_json::Value>) -> Result<(), PluginError>,
) -> Result<CommandOutcome, PluginError> {
    let source = host.read_document(doc)?;
    let model = host.read_model(doc)?;
    let mut mappa = model.frontmatter.0.clone();
    muta(&mut mappa)?;
    let edit = edit_frontmatter(&source, &model, &mappa)?;
    let revision = host.document_revision(doc)?;
    let request = EditRequest::new(revision, vec![edit]);
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                vec![PlannedEdit::new(doc.clone(), request)],
            ))),
        );
    }
    let report = host.apply_edit(doc, request)?;
    Ok(CommandOutcome::notify(summary)
        .undoable(Undo::of_edits(
            undo_label,
            vec![PlannedEdit::new(doc.clone(), report.inverse())],
        ))
        .with_effect(CommandEffect::Done))
}

/// Parsa un frammento YAML in JSON. Se non è YAML, resta una stringa.
pub(crate) fn parse_yaml_valore(s: &str) -> serde_json::Value {
    let t = s.trim();
    // `[[page]]` è YAML flow-sequence, non un wikilink. Si tiene stringa
    // **prima** del parse, altrimenti diventa `[["page"]]`.
    if t.starts_with("[[") && t.ends_with("]]") {
        return serde_json::Value::String(t.to_string());
    }
    match serde_yaml_ng::from_str::<serde_json::Value>(s) {
        Ok(v) => v,
        Err(_) => serde_json::Value::String(s.to_string()),
    }
}

/// L'edit che sostituisce (o inserisce) il blocco frontmatter. Il corpo dopo
/// lo span resta intatto.
pub(crate) fn edit_frontmatter(
    source: &str,
    model: &DocumentModel,
    mappa: &serde_json::Map<String, serde_json::Value>,
) -> Result<TextEdit, PluginError> {
    let start = inizio_sorgente(source);
    let blocco = serializza_blocco(mappa)?;
    if model.frontmatter_present {
        let end = fine_frontmatter(source, model);
        Ok(TextEdit::replace(Span::new(start, end), blocco))
    } else {
        let mut text = blocco;
        if start < source.len() {
            if !text.ends_with('\n') {
                text.push('\n');
            }
            text.push('\n');
        }
        Ok(TextEdit::insert(start, text))
    }
}

pub(crate) fn inizio_sorgente(source: &str) -> usize {
    if source.starts_with('\u{FEFF}') {
        '\u{FEFF}'.len_utf8()
    } else {
        0
    }
}

/// Come `fine_del_frontmatter` in `fub-format-markdown`: fine = inizio riga del
/// primo blocco del body (attraverso soli space/tab), o `source.len()` se il
/// body è vuoto.
fn fine_frontmatter(source: &str, model: &DocumentModel) -> usize {
    match model.body.first() {
        Some(first) => {
            let contenuto = first.span().start;
            let contenuto = contenuto.min(source.len());
            let riga = source[..contenuto]
                .rfind(['\n', '\r'])
                .map(|i| i + 1)
                .unwrap_or(0);
            if source
                .get(riga..contenuto)
                .is_some_and(|s| s.chars().all(|c| c == ' ' || c == '\t'))
            {
                riga
            } else {
                contenuto
            }
        }
        None => source.len(),
    }
}

pub(crate) fn serializza_blocco(
    mappa: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, PluginError> {
    if mappa.is_empty() {
        return Ok("---\n\n---\n".to_string());
    }
    let yaml = serde_yaml_ng::to_string(&serde_json::Value::Object(mappa.clone())).map_err(|e| {
        PluginError::BadArgs(Text::message(
            E_YAML,
            vec![Arg::text("reason", e.to_string())],
        ))
    })?;
    let yaml = yaml
        .trim_start_matches("---")
        .trim_start_matches('\n')
        .trim_start_matches('\r');
    Ok(format!("---\n{yaml}---\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializza_vuoto_tiene_i_delimitatori() {
        let s = serializza_blocco(&serde_json::Map::new()).unwrap();
        assert_eq!(s, "---\n\n---\n");
    }

    #[test]
    fn serializza_preserva_ordine_chiavi() {
        let mut m = serde_json::Map::new();
        m.insert("title".into(), serde_json::json!("ciao"));
        m.insert("done".into(), serde_json::json!(true));
        let s = serializza_blocco(&m).unwrap();
        let i_title = s.find("title").expect("title");
        let i_done = s.find("done").expect("done");
        assert!(i_title < i_done, "{s}");
        assert!(s.starts_with("---\n"));
        assert!(s.contains("ciao"));
    }

    #[test]
    fn parse_yaml_fallback_a_stringa() {
        assert_eq!(parse_yaml_valore("true"), serde_json::json!(true));
        assert_eq!(parse_yaml_valore("3"), serde_json::json!(3));
        assert_eq!(
            parse_yaml_valore("[[page]]"),
            serde_json::json!("[[page]]")
        );
    }

    #[test]
    fn wikilink_a_mano() {
        assert_eq!(
            mostra_link(&LinkTarget::wiki("page")),
            "[[page]]"
        );
        assert_eq!(
            mostra_link(&LinkTarget::Wiki {
                page: "page".into(),
                heading: Some("H".into()),
                block: None,
            }),
            "[[page#H]]"
        );
        assert_eq!(
            mostra_link(&LinkTarget::Wiki {
                page: "page".into(),
                heading: None,
                block: Some("b".into()),
            }),
            "[[page#^b]]"
        );
        assert_eq!(
            mostra_link(&LinkTarget::Url("https://esempio.test".into())),
            "https://esempio.test"
        );
    }

    #[test]
    fn bom_non_entra_nello_span() {
        let s = format!("\u{FEFF}# ciao\n");
        assert_eq!(inizio_sorgente(&s), 3);
        assert_eq!(inizio_sorgente("# ciao\n"), 0);
    }

    #[test]
    fn insert_senza_frontmatter_lascia_il_corpo() {
        let source = "# Hello\n\nresto\n";
        let model = DocumentModel::empty(DocId::new("a.md"));
        let mut m = serde_json::Map::new();
        m.insert("title".into(), serde_json::json!("x"));
        let edit = edit_frontmatter(source, &model, &m).unwrap();
        assert_eq!(edit.span.start, 0);
        assert_eq!(edit.span.end, 0);
        let mut out = source.to_string();
        out.insert_str(0, &edit.text);
        assert!(out.ends_with("# Hello\n\nresto\n"), "{out}");
        assert!(out.starts_with("---\n"));
        let corpo = &out[edit.text.len()..];
        assert_eq!(corpo, source);
    }
}
